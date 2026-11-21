/**
 * #16b data view picker on Visualize, #16c Explore in Visualize + side-menu context restore.
 * Pure parts: the entry URL (visualizeEntry), filters on a view switch (filtersForViewSwitch), the
 * tab's last search context (lastSearch), and the Explore in Visualize link (visualizeUrl).
 */
import { rangeUtil } from '@grafana/data';
import { decodeLogsState } from '../../data/urlState';
import { DEFAULT_SOURCE_CONFIG, DataView, FilterPill } from '../../types';
import { filtersForViewSwitch, StoredPin } from '../../state/sharedSearch';
import { hasSearchContext, LAST_SEARCH_KEY, rememberSearchContext, restoreSearchContext } from '../../state/lastSearch';
import { visualizeEntry, VisualizeEntryInput } from '../entry';
import { decodeLens, EMPTY_LENS, LensState, lensFieldsPending, RECORDS_FIELD } from '../state';
import { addField } from '../suggest';
import { visualizeUrl } from '../handoff';

const view = (id: string, table: string, database = 'default'): DataView => ({
  ...DEFAULT_SOURCE_CONFIG,
  id,
  name: id,
  origin: 'shared',
  createdAt: '2026-01-01T00:00:00Z',
  datasourceUid: 'ch',
  database,
  logsTable: table,
});
const SPEC = view('spec-fixture', 'spec_logs');
const OTEL = view('otel-demo', 'otel_logs');
const SPEC2 = view('spec-copy', 'spec_logs');
const VIEWS = [SPEC, OTEL, SPEC2];
const pill = (id: string, extra: Partial<FilterPill> = {}): FilterPill => ({
  id,
  field: 'ServiceName',
  op: '=',
  value: id,
  ...extra,
});
const lensWithRecords: LensState = addField(EMPTY_LENS, RECORDS_FIELD, {});

function entry(params: string, over: Partial<VisualizeEntryInput> = {}) {
  return visualizeEntry({
    params: new URLSearchParams(params),
    views: VIEWS,
    activeView: SPEC,
    storedPins: [],
    restoreContext: () => undefined,
    ...over,
  });
}

beforeEach(() => window.sessionStorage.clear());

describe('#16b visualizeEntry: the data view Visualize opens on', () => {
  it("applies the URL's known view and writes it", () => {
    const e = entry('ds=otel-demo&q=x');
    expect(e.view?.id).toBe('otel-demo');
    expect(e.params.get('ds')).toBe('otel-demo');
    expect(e.params.get('q')).toBe('x');
  });

  it('falls back to the active view for an unknown or missing ds, and writes it', () => {
    expect(entry('ds=nope&q=x').params.get('ds')).toBe('spec-fixture');
    expect(entry('q=x').view?.id).toBe('spec-fixture');
  });

  it('with no views at all, has no view and no ds', () => {
    const e = entry('ds=x&q=y', { views: [], activeView: null });
    expect(e.view).toBeUndefined();
    expect(e.params.has('ds')).toBe(false);
  });

  it('merges stored pins only when the URL has no filters, disabled when pinned on another table', () => {
    const pins: StoredPin[] = [
      { ...pill('a'), pinned: true, pinnedTable: 'default.spec_logs' },
      { ...pill('b'), pinned: true, pinnedTable: 'default.otel_logs' },
    ];
    const merged = decodeLogsState(entry('q=x', { storedPins: pins }).params).filters!;
    expect(merged.map((f) => [f.value, !!f.disabled])).toEqual([
      ['a', false],
      ['b', true],
    ]);
    // A link that carries filters is reproduced exactly (pins are not appended).
    const linked = decodeLogsState(entry('filters=[]&q=x', { storedPins: pins }).params).filters;
    expect(linked).toEqual([]);
  });

  it('takes the chart from the URL only: an open without lens starts empty (round 3 #19)', () => {
    // An earlier session's chart in this tab does not come back on a fresh open (Kibana starts empty).
    window.sessionStorage.setItem('clickhouse-observe.lensDraft', JSON.stringify({ scope: 'x', lens: '{}' }));
    expect(entry('ds=otel-demo&q=x').params.has('lens')).toBe(false);
    expect(entry('').params.has('lens')).toBe(false);
    // A URL lens (a reload, a shared link) is kept as is.
    const lens = encodeURIComponent(JSON.stringify(lensWithRecords));
    expect(decodeLens(entry(`ds=otel-demo&q=x&lens=${lens}`).params.get('lens'))?.metrics).toHaveLength(1);
  });
});

describe('#16c visualizeEntry: side-menu entry restores the last context', () => {
  it('restores only when the URL has no search context', () => {
    const restore = jest.fn(() => new URLSearchParams('q=restored&ds=otel-demo&from=now-7d&to=now'));
    const e = entry('', { restoreContext: restore });
    expect(restore).toHaveBeenCalledWith(['spec-fixture', 'otel-demo', 'spec-copy']);
    expect(e.params.get('q')).toBe('restored');
    expect(e.params.get('from')).toBe('now-7d');
    expect(e.view?.id).toBe('otel-demo');

    const r2 = jest.fn(() => new URLSearchParams('q=restored'));
    expect(entry('q=mine', { restoreContext: r2 }).params.get('q')).toBe('mine');
    expect(r2).not.toHaveBeenCalled();
    // A lens alone is not a search context: the context is still restored.
    const r3 = jest.fn(() => new URLSearchParams('q=restored'));
    expect(entry('lens=x', { restoreContext: r3 }).params.get('q')).toBe('restored');
  });
});

describe('#16c last search context (session storage)', () => {
  it('remembers only the context params, and ignores URLs without context', () => {
    rememberSearchContext(new URLSearchParams('q=a&cols=[1]&lens=x&from=now-1h&to=now&ds=otel-demo&sort=t:asc'));
    expect(new URLSearchParams(window.sessionStorage.getItem(LAST_SEARCH_KEY)!).toString()).toBe(
      'q=a&from=now-1h&to=now&ds=otel-demo'
    );
    rememberSearchContext(new URLSearchParams('lens=x'));
    expect(window.sessionStorage.getItem(LAST_SEARCH_KEY)).toContain('q=a');
  });

  it('restores through the URL codec: relative time stays relative, absolute stays epoch ms', () => {
    rememberSearchContext(new URLSearchParams('q=a&from=now-7d&to=now&ds=otel-demo'));
    expect(restoreSearchContext(['otel-demo'])!.toString()).toBe('q=a&from=now-7d&to=now&ds=otel-demo');
    rememberSearchContext(new URLSearchParams('from=1767225600000&to=1767830400000'));
    const r = restoreSearchContext([])!;
    expect([r.get('from'), r.get('to')]).toEqual(['1767225600000', '1767830400000']);
  });

  it('treats stored text as untrusted: malformed filters/time and unknown views are dropped', () => {
    window.sessionStorage.setItem(
      LAST_SEARCH_KEY,
      new URLSearchParams({
        q: 'ok',
        filters: JSON.stringify([pill('good'), { id: 'x', field: 'a', op: 'DROP TABLE', value: '1' }, 'junk']),
        from: 'yesterday-ish',
        to: 'now',
        ds: 'deleted-view',
      }).toString()
    );
    const r = restoreSearchContext(['spec-fixture'])!;
    expect(r.get('q')).toBe('ok');
    expect(decodeLogsState(r).filters!.map((f) => f.value)).toEqual(['good']);
    expect(r.has('from')).toBe(false);
    expect(r.has('ds')).toBe(false);
  });

  it('returns undefined when nothing usable is stored or storage throws', () => {
    expect(restoreSearchContext([])).toBeUndefined();
    window.sessionStorage.setItem(LAST_SEARCH_KEY, 'ds=gone');
    expect(restoreSearchContext(['other'])).toBeUndefined();
    const spy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(restoreSearchContext([])).toBeUndefined();
    spy.mockRestore();
  });

  it('hasSearchContext', () => {
    expect(hasSearchContext(new URLSearchParams('lens=x&cols=y'))).toBe(false);
    expect(hasSearchContext(new URLSearchParams('ds=x'))).toBe(true);
  });
});

describe('#16b filtersForViewSwitch (D7)', () => {
  const S = 'default.spec_logs';
  const O = 'default.otel_logs';

  it('same table: pills unchanged', () => {
    const f = [pill('a'), pill('b', { disabled: true })];
    expect(filtersForViewSwitch(f, [], S, S)).toEqual(f);
  });

  it('different table: unpinned pills arrive disabled', () => {
    expect(filtersForViewSwitch([pill('a')], [], S, O)).toEqual([pill('a', { disabled: true })]);
  });

  it('pinned pills are enabled only on the table they were pinned on, both ways', () => {
    const stored: StoredPin[] = [{ ...pill('p'), pinned: true, pinnedTable: S }];
    const there = filtersForViewSwitch([pill('p', { pinned: true })], stored, S, O);
    expect(there).toEqual([pill('p', { pinned: true, disabled: true })]);
    const back = filtersForViewSwitch(there, stored, O, S);
    expect(back).toEqual([pill('p', { pinned: true })]);
  });

  it('appends stored pins that are missing, and ignores foreign pin flags', () => {
    const stored: StoredPin[] = [{ ...pill('p'), pinned: true, pinnedTable: O }];
    const out = filtersForViewSwitch([pill('x', { pinned: true })], stored, S, O);
    expect(out.map((f) => [f.value, !!f.pinned, !!f.disabled])).toEqual([
      ['x', false, true],
      ['p', true, false],
    ]);
  });
});

describe('#16c Explore in Visualize link', () => {
  it('without a chart carries query, filters, relative time and view, and no lens', () => {
    const range = rangeUtil.convertRawToRange({ from: 'now-7d', to: 'now' });
    const url = visualizeUrl({ search: 'a:b', filters: [pill('f')], timeRange: range, viewId: 'otel-demo' });
    const sp = new URLSearchParams(url.split('?')[1]);
    expect(url).toMatch(/\/visualize\?/);
    expect([sp.get('q'), sp.get('from'), sp.get('to'), sp.get('ds')]).toEqual(['a:b', 'now-7d', 'now', 'otel-demo']);
    expect(decodeLogsState(sp).filters).toEqual([pill('f')]);
    expect(sp.has('lens')).toBe(false);
  });
});

describe('round 3 #8: when the chart can run during field discovery', () => {
  const allowed = new Set(['Timestamp', 'ServiceName']);
  const onColumns = addField(EMPTY_LENS, RECORDS_FIELD, {});
  const onJsonPath: LensState = {
    chartType: 'bar',
    buckets: [{ kind: 'terms', id: 'b0', field: '"Payload"."user.id"', label: 'Payload.user.id', size: 5 }],
    metrics: [{ kind: 'metric', id: 'm0', op: 'count' }],
  };

  it('waits until this view’s columns are published', () => {
    expect(lensFieldsPending(false, true, onColumns, allowed)).toBe(true);
    expect(lensFieldsPending(false, false, onColumns, allowed)).toBe(true);
  });

  it('runs on known columns without waiting for the rest of the discovery', () => {
    expect(lensFieldsPending(true, true, onColumns, allowed)).toBe(false);
  });

  it('a chart on a field not known yet (a JSON path) waits for the whole discovery', () => {
    expect(lensFieldsPending(true, true, onJsonPath, allowed)).toBe(true);
    expect(lensFieldsPending(true, false, onJsonPath, allowed)).toBe(false);
  });
});
