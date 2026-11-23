import { LENS_TABS, lensTabInUse, sanitizeLensTabParams } from '../lensTabs';
import { MAX_PARAMS_LENGTH } from '../discoverTabs';

const LENS = JSON.stringify({
  chartType: 'bar',
  buckets: [],
  metrics: [{ kind: 'metric', id: 'm0', op: 'count' }],
});
const EMPTY = JSON.stringify({ chartType: 'bar', buckets: [], metrics: [] });
const tab = (params: string) => ({ id: 'taaa0000', title: 'T', params });

describe('LENS_TABS', () => {
  it('uses its own storage key', () => {
    expect(LENS_TABS.key).toBe('clickhouse-observe.lensTabs');
  });

  it.each(['lens=x', 'pi=abc', 'dash=d1&panel=2', 'q=a', 'from=now-1h', 'ds=v1', 'filters=%5B%5D'])(
    '%s counts as state (a link)',
    (qs) => {
      expect(LENS_TABS.hasState(new URLSearchParams(qs))).toBe(true);
    }
  );

  it('no params is the side-menu entry', () => {
    expect(LENS_TABS.hasState(new URLSearchParams('_tab=x'))).toBe(false);
  });
});

describe('sanitizeLensTabParams', () => {
  it.each([undefined, null, 5, {}, '', 'x'.repeat(MAX_PARAMS_LENGTH * 4 + 1)])('rejects %p', (raw) => {
    expect(sanitizeLensTabParams(raw)).toBe('');
  });

  it('keeps a valid lens and drops unknown params', () => {
    const out = new URLSearchParams(sanitizeLensTabParams(`lens=${encodeURIComponent(LENS)}&evil=1`));
    expect(JSON.parse(out.get('lens')!).metrics).toHaveLength(1);
    expect(out.has('evil')).toBe(false);
  });

  it('drops an invalid or empty lens', () => {
    expect(new URLSearchParams(sanitizeLensTabParams('lens=notjson&q=a')).has('lens')).toBe(false);
    expect(new URLSearchParams(sanitizeLensTabParams(`lens=${encodeURIComponent(EMPTY)}&q=a`)).has('lens')).toBe(false);
  });

  it('keeps search context and does not invent a time range', () => {
    const out = new URLSearchParams(sanitizeLensTabParams(`q=errors&lens=${encodeURIComponent(LENS)}`));
    expect(out.get('q')).toBe('errors');
    expect(out.has('from')).toBe(false);
    expect(out.has('to')).toBe(false);
  });

  it('keeps a given time range', () => {
    const out = new URLSearchParams(sanitizeLensTabParams('q=a&from=now-1h&to=now'));
    expect(out.get('from')).toBe('now-1h');
    expect(out.get('to')).toBe('now');
  });

  it('keeps dashboard return params only when valid', () => {
    const ok = new URLSearchParams(sanitizeLensTabParams('dash=abc_1&panel=7&dfrom=now-6h&dto=now&pi=tok1.k'));
    expect(ok.get('dash')).toBe('abc_1');
    expect(ok.get('panel')).toBe('7');
    expect(ok.get('pi')).toBe('tok1.k');
    const bad = new URLSearchParams(
      sanitizeLensTabParams('dash=a%20b&panel=7&pi=tok1&lens=' + encodeURIComponent(LENS))
    );
    expect(bad.has('dash')).toBe(false);
    expect(bad.has('panel')).toBe(false);
    expect(bad.has('pi')).toBe(false);
  });

  it('drops a malformed import token', () => {
    const out = new URLSearchParams(sanitizeLensTabParams('dash=d1&panel=7&pi=<script>'));
    expect(out.has('pi')).toBe(false);
    expect(out.get('dash')).toBe('d1');
  });
});

describe('lensTabInUse', () => {
  it('is true for a chart', () => {
    expect(lensTabInUse(tab(`lens=${encodeURIComponent(LENS)}`))).toBe(true);
  });
  it('is true for an open dashboard panel', () => {
    expect(lensTabInUse(tab('dash=d1&panel=3'))).toBe(true);
  });
  it('is false for an empty tab, search context only, an empty chart or a bad panel', () => {
    expect(lensTabInUse(tab(''))).toBe(false);
    expect(lensTabInUse(tab('q=a&from=now-1h&to=now'))).toBe(false);
    expect(lensTabInUse(tab(`lens=${encodeURIComponent(EMPTY)}`))).toBe(false);
    expect(lensTabInUse(tab('dash=d1&panel=0'))).toBe(false);
    expect(lensTabInUse(tab('lens=garbage'))).toBe(false);
  });
});
