import {
  addTab,
  clearClosed,
  closeTab,
  DISCOVER_TABS_KEY,
  duplicateTab,
  initialTabsState,
  loadTabsState,
  MAX_CLOSED,
  MAX_TABS,
  moveTab,
  nextUntitled,
  parseTabsState,
  relativeTime,
  renameTab,
  restoreClosed,
  sanitizeTabParams,
  setTabParams,
} from '../discoverTabs';

const params = (o: Record<string, string>) => new URLSearchParams(o).toString();

describe('sanitizeTabParams', () => {
  it('round-trips a normal Discover state', () => {
    const raw = params({ q: 'service:api', from: 'now-1h', to: 'now', ds: 'v1', interval: 'minute', bd: 'severity' });
    const sp = new URLSearchParams(sanitizeTabParams(raw, ['v1']));
    expect(sp.get('q')).toBe('service:api');
    expect(sp.get('from')).toBe('now-1h');
    expect(sp.get('ds')).toBe('v1');
    expect(sp.get('interval')).toBe('minute');
    expect(sp.get('bd')).toBe('severity');
  });

  it('drops unknown views, unknown params, malformed filters and inbound-only trace params', () => {
    const raw = params({
      q: 'x',
      ds: 'gone',
      filters: '{"not":"an array"}',
      evil: '1',
      traceId: 'abc',
      dsUid: 'u',
      _tab: 'tabc1234',
    });
    const sp = new URLSearchParams(sanitizeTabParams(raw, ['v1']));
    expect(sp.has('ds')).toBe(false);
    expect(sp.has('filters')).toBe(false);
    expect(sp.has('evil')).toBe(false);
    expect(sp.has('traceId')).toBe(false);
    expect(sp.has('_tab')).toBe(false);
    expect(sp.get('q')).toBe('x');
  });

  it('drops filter pills the pill sanitizer rejects', () => {
    const raw = params({ filters: JSON.stringify([{ field: 'a', op: 'DROP TABLE', value: 'x' }]), q: 'k' });
    const sp = new URLSearchParams(sanitizeTabParams(raw));
    const filters = sp.get('filters');
    expect(filters === null || !filters.includes('DROP TABLE')).toBe(true);
  });

  it('rejects non-strings, empty state and oversized input', () => {
    expect(sanitizeTabParams(42)).toBe('');
    expect(sanitizeTabParams('foo=bar')).toBe('');
    expect(sanitizeTabParams(`q=${'a'.repeat(20000)}`)).toBe('');
  });
});

describe('parseTabsState', () => {
  it('keeps valid tabs and clamps the active id', () => {
    const s = parseTabsState({
      tabs: [
        { id: 'tabc1234', title: 'One', params: params({ q: 'a' }) },
        { id: 'BAD ID!', title: 'x', params: '' },
        { id: 'tabc1234', title: 'dup', params: '' },
      ],
      activeId: 'nope0000',
      closed: [
        { tab: { id: 'tdef5678', title: 'Old', params: '' }, closedAt: 5 },
        { tab: null, closedAt: 1 },
      ],
    });
    expect(s?.tabs.map((t) => t.id)).toEqual(['tabc1234']);
    expect(s?.activeId).toBe('tabc1234');
    expect(s?.closed).toHaveLength(1);
  });

  it('cleans titles (control chars, length, empty)', () => {
    const s = parseTabsState({ tabs: [{ id: 'tabc1234', title: '\u0000\u0007 ', params: '' }] });
    expect(s?.tabs[0].title).toBe('Untitled');
    const long = parseTabsState({ tabs: [{ id: 'tabc1234', title: 'x'.repeat(500), params: '' }] });
    expect(long?.tabs[0].title.length).toBe(80);
  });

  it('returns undefined for garbage', () => {
    expect(parseTabsState(null)).toBeUndefined();
    expect(parseTabsState({ tabs: 'x' })).toBeUndefined();
    expect(parseTabsState({ tabs: [] })).toBeUndefined();
  });

  it('caps the tab and closed lists', () => {
    const tabs = Array.from({ length: 30 }, (_, i) => ({
      id: `tab${String(i).padStart(4, '0')}`,
      title: 't',
      params: '',
    }));
    const closed = Array.from({ length: 30 }, (_, i) => ({
      tab: { id: `cls${String(i).padStart(4, '0')}`, title: 'c', params: '' },
      closedAt: i,
    }));
    const s = parseTabsState({ tabs, closed });
    expect(s?.tabs).toHaveLength(MAX_TABS);
    expect(s?.closed).toHaveLength(MAX_CLOSED);
  });
});

describe('storage', () => {
  beforeEach(() => window.sessionStorage.clear());

  it('survives malformed JSON', () => {
    window.sessionStorage.setItem(DISCOVER_TABS_KEY, '{not json');
    expect(loadTabsState()).toBeUndefined();
  });
});

describe('updates', () => {
  const base = initialTabsState(params({ q: 'a' }), 'taaa0000');

  it('adds after the active tab with the next Untitled title', () => {
    const s = addTab(base, '', undefined, 'tbbb0000');
    expect(s.tabs.map((t) => t.title)).toEqual(['Untitled', 'Untitled 2']);
    expect(s.activeId).toBe('tbbb0000');
    expect(nextUntitled(s.tabs)).toBe('Untitled 3');
  });

  it('duplicates with identical state', () => {
    const s = duplicateTab(base, 'taaa0000', 'tccc0000');
    expect(s.tabs[1]).toEqual({ id: 'tccc0000', title: 'Untitled (copy)', params: base.tabs[0].params });
    expect(s.activeId).toBe('tccc0000');
  });

  it('closes into Recently closed and activates a neighbour; never closes the last tab', () => {
    expect(closeTab(base, 'taaa0000')).toBe(base);
    const two = addTab(base, '', undefined, 'tbbb0000');
    const closed = closeTab(two, 'tbbb0000', 1000);
    expect(closed.tabs.map((t) => t.id)).toEqual(['taaa0000']);
    expect(closed.activeId).toBe('taaa0000');
    expect(closed.closed[0]).toEqual({ tab: two.tabs[1], closedAt: 1000 });
    const restored = restoreClosed(closed, 'tbbb0000');
    expect(restored.tabs.map((t) => t.id)).toEqual(['taaa0000', 'tbbb0000']);
    expect(restored.activeId).toBe('tbbb0000');
    expect(restored.closed).toHaveLength(0);
    expect(clearClosed(closed).closed).toHaveLength(0);
  });

  it('renames, moves and updates params', () => {
    let s = addTab(base, '', undefined, 'tbbb0000');
    s = renameTab(s, 'tbbb0000', '  errors  ');
    expect(s.tabs[1].title).toBe('errors');
    s = moveTab(s, 'tbbb0000', 0);
    expect(s.tabs.map((t) => t.id)).toEqual(['tbbb0000', 'taaa0000']);
    expect(setTabParams(s, 'taaa0000', s.tabs[1].params)).toBe(s);
    expect(setTabParams(s, 'taaa0000', 'q=z').tabs[1].params).toBe('q=z');
  });

  it('stops at MAX_TABS', () => {
    let s = base;
    for (let i = 0; i < MAX_TABS + 3; i++) {
      s = addTab(s, '');
    }
    expect(s.tabs).toHaveLength(MAX_TABS);
    expect(duplicateTab(s, s.activeId)).toBe(s);
  });
});

describe('relativeTime', () => {
  it('formats seconds to days', () => {
    expect(relativeTime(0, 17_000)).toBe('17 seconds ago');
    expect(relativeTime(0, 60_000)).toBe('1 minute ago');
    expect(relativeTime(0, 2 * 3_600_000)).toBe('2 hours ago');
    expect(relativeTime(0, 86_400_000)).toBe('1 day ago');
  });
});
