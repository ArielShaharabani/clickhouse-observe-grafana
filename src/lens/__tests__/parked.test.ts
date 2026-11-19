import { addField, switchChart } from '../suggest';
import { addBucket, queryShape } from '../dimensions';
import { decodeLens, EMPTY_LENS, LensField, LensState, sanitizeLens } from '../state';

// Switching to a chart that can't show something parks it; switching back restores it (Kibana keeps
// a layer's unused columns). A time field dropped on Metric / Pie goes back to a time chart.
const ctx = { timeField: { sqlExpr: 'Timestamp', label: 'Timestamp' } };
const f = (sqlExpr: string, type: LensField['type']): LensField => ({ id: `col:${sqlExpr}`, sqlExpr, label: sqlExpr, type });
const TS = f('Timestamp', 'time');
const SERVICE = f('ServiceName', 'string');

const barOverTime = (): LensState =>
  switchChart([TS, SERVICE].reduce<LensState>((s, x) => addField(s, x, ctx), EMPTY_LENS), 'bar', ctx);
const kinds = (s: LensState) => s.buckets.map((b) => `${b.kind}:${b.field}`);

describe('parked dimensions', () => {
  it('Bar over time → Metric parks the date histogram; → Bar restores X and the breakdown', () => {
    const bar = barOverTime();
    expect(kinds(bar)).toEqual(['date_histogram:Timestamp', 'terms:ServiceName']);
    const metric = switchChart(bar, 'metric', ctx);
    expect(kinds(metric)).toEqual(['terms:ServiceName']);
    expect(metric.parked).toMatchObject({ chartType: 'bar', buckets: [{ kind: 'date_histogram', field: 'Timestamp' }] });
    const back = switchChart(metric, 'bar', ctx);
    expect(kinds(back)).toEqual(['date_histogram:Timestamp', 'terms:ServiceName']);
    // Same dimension (id and interval), not a fresh one.
    expect(back.buckets[0]).toEqual(bar.buckets[0]);
    expect(back.parked).toBeUndefined();
  });

  it('Metric → Pie → Line keeps the parked date and restores it', () => {
    const pie = switchChart(switchChart(barOverTime(), 'metric', ctx), 'pie', ctx);
    expect(pie.parked?.buckets.map((b) => b.kind)).toEqual(['date_histogram']);
    expect(kinds(switchChart(pie, 'line', ctx))).toEqual(['date_histogram:Timestamp', 'terms:ServiceName']);
  });

  it('a time field dropped on Metric goes back to the chart it came from, with the parked date', () => {
    const metric = switchChart(barOverTime(), 'metric', ctx);
    const s = addField(metric, TS, ctx);
    expect(s.chartType).toBe('bar');
    expect(kinds(s)).toEqual(['date_histogram:Timestamp', 'terms:ServiceName']);
    expect(s.buckets[0].id).toBe(metric.parked!.buckets[0].id);
    expect(s.parked).toBeUndefined();
  });

  it('a time field dropped on a Metric built from scratch becomes a line over time', () => {
    const metric = switchChart(addField(EMPTY_LENS, SERVICE, ctx), 'metric', ctx);
    expect(metric.parked).toBeUndefined();
    const s = addField(metric, TS, ctx);
    expect(s.chartType).toBe('line');
    expect(kinds(s)[0]).toBe('date_histogram:Timestamp');
  });

  it('a time field dropped on a bucket slot is a date histogram, not top values', () => {
    const metric = switchChart(barOverTime(), 'metric', ctx);
    const { state, id } = addBucket(metric, TS, ctx);
    expect(state.chartType).toBe('bar');
    expect(state.buckets.find((b) => b.id === id)?.kind).toBe('date_histogram');
    const bar = addBucket(switchChart(addField(EMPTY_LENS, SERVICE, ctx), 'bar', ctx), TS, ctx).state;
    expect(kinds(bar)[0]).toBe('date_histogram:Timestamp');
  });

  it('is display state: not part of the chart query', () => {
    const metric = switchChart(barOverTime(), 'metric', ctx);
    expect(queryShape(metric).parked).toBeUndefined();
    expect(queryShape(metric)).toEqual(queryShape({ ...metric, parked: undefined }));
  });

  it('survives the URL; hostile or unknown parked input is dropped', () => {
    const metric = switchChart(barOverTime(), 'metric', ctx);
    expect(decodeLens(JSON.stringify(metric))?.parked).toEqual(metric.parked);
    const hostile = (parked: unknown) => decodeLens(JSON.stringify({ ...metric, parked }))?.parked;
    expect(hostile({ chartType: 'evil', buckets: metric.parked!.buckets })).toBeUndefined();
    expect(hostile('x')).toBeUndefined();
    expect(hostile({ chartType: 'bar', buckets: [{ kind: 'sql', id: 'b', field: 'x', label: 'x' }] })).toBeUndefined();
    const many = Array.from({ length: 50 }, (_, i) => ({ kind: 'terms', id: `b${i}`, field: 'ServiceName', label: 'S', size: 5 }));
    expect(hostile({ chartType: 'bar', buckets: many })?.buckets).toHaveLength(8);
  });

  it('sanitizeLens drops parked buckets on fields the view does not have', () => {
    const metric = switchChart(barOverTime(), 'metric', ctx);
    expect(sanitizeLens(metric, new Set(['ServiceName', 'Timestamp'])).parked).toEqual(metric.parked);
    expect(sanitizeLens(metric, new Set(['ServiceName'])).parked).toBeUndefined();
  });
});
