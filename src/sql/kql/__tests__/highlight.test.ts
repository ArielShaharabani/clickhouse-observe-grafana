import {
  compileColumnHighlighter,
  extractHighlightTerms,
  HighlightContext,
  MAX_HIGHLIGHT_CHARS,
  splitHighlights,
} from '../highlight';
import { buildFieldIndex } from '../../fields';
import { FieldModel } from '../../fieldModel';
import { FilterPill, OTEL_COLUMN_MAPPING, SelectedColumn, SourceConfig } from '../../../types';

const config: SourceConfig = {
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'spec_logs',
  isOtel: true,
  columns: { ...OTEL_COLUMN_MAPPING, partitionTimestamp: '-' },
};
const fields: FieldModel[] = [
  { id: 'col:ServiceName', name: 'ServiceName', displayName: 'ServiceName', sqlExpr: 'ServiceName', type: 'string', source: 'column' },
  { id: 'col:SeverityText', name: 'SeverityText', displayName: 'SeverityText', sqlExpr: 'SeverityText', type: 'string', source: 'column' },
  { id: 'col:Body', name: 'Body', displayName: 'Body', sqlExpr: 'Body', type: 'string', source: 'column' },
  {
    id: 'map:LogAttributes:http.method',
    name: 'http.method',
    displayName: 'LogAttributes.http.method',
    sqlExpr: "LogAttributes['http.method']",
    type: 'string',
    source: 'map',
    mapColumn: 'LogAttributes',
  },
];
const ctx: HighlightContext = { config, fieldIndex: buildFieldIndex(fields) };
const col = (sqlExpr: string, over: Partial<SelectedColumn> = {}): SelectedColumn => ({
  id: sqlExpr,
  key: sqlExpr,
  sqlExpr,
  displayName: sqlExpr,
  type: 'string',
  isCore: false,
  ...over,
});
const pill = (over: Partial<FilterPill>): FilterPill => ({ id: 'p', field: 'ServiceName', op: '=', value: 'payments', ...over });
const marked = (text: string, re: RegExp | null) =>
  splitHighlights(text, re)
    .filter((r) => r.match)
    .map((r) => r.text);

describe('DISC-SEARCH-02: highlight terms follow the SQL that matched', () => {
  it('maps field terms to their resolved column and bare terms to the body', () => {
    const terms = extractHighlightTerms('ServiceName:payments and declined', [], ctx);
    expect(marked('payments', compileColumnHighlighter(terms, col('ServiceName'), 'Body'))).toEqual(['payments']);
    expect(marked('Payment declined', compileColumnHighlighter(terms, col('Body'), 'Body'))).toEqual(['declined']);
    expect(compileColumnHighlighter(terms, col('TraceId'), 'Body')).toBeNull();
  });

  it('resolves dotted Map keys like the query does', () => {
    const terms = extractHighlightTerms('LogAttributes.http.method:POST', [], ctx);
    expect(marked('POST', compileColumnHighlighter(terms, col("LogAttributes['http.method']"), 'Body'))).toEqual(['POST']);
  });

  it('expands field-name wildcards against discovered fields', () => {
    const terms = extractHighlightTerms('Servi*:payments', [], ctx);
    expect(marked('payments', compileColumnHighlighter(terms, col('ServiceName'), 'Body'))).toEqual(['payments']);
  });

  it('highlights the raw text in the body for an unresolvable field:value', () => {
    const terms = extractHighlightTerms('http://example.com', [], ctx);
    expect(marked('GET http://example.com ok', compileColumnHighlighter(terms, col('Body'), 'Body'))).toEqual([
      'http://example.com',
    ]);
  });

  it('keeps wildcard fragments in order and ignores one-character fragments', () => {
    const terms = extractHighlightTerms('pay*d', [], ctx);
    expect(marked('Payment declined', compileColumnHighlighter(terms, col('Body'), 'Body'))).toEqual(['Payment d']);
    expect(extractHighlightTerms('*s*', [], ctx)).toEqual([]);
  });

  it('matches quoted phrases on word boundaries only', () => {
    const terms = extractHighlightTerms('"req-59"', [], ctx);
    expect(marked('req-592 then req-59 done', compileColumnHighlighter(terms, col('Body'), 'Body'))).toEqual(['req-59']);
  });

  it('skips negated, exists and range terms, and returns nothing for an unparsable query', () => {
    expect(extractHighlightTerms('not SeverityText:debug and ServiceName:* and SeverityNumber > 5', [], ctx)).toEqual([]);
    expect(extractHighlightTerms('level:(', [], ctx)).toEqual([]);
  });

  it('adds enabled positive filters, ignoring whitespace-only values', () => {
    const terms = extractHighlightTerms(
      '',
      [
        pill({}),
        pill({ id: 'q', op: '!=', value: 'auth' }),
        pill({ id: 'r', disabled: true, value: 'checkout' }),
        pill({ id: 's', field: 'SeverityText', op: 'one_of', value: '', values: ['error', ' '] }),
        pill({ id: 't', field: 'Body', op: 'contains', value: ' ' }),
      ],
      ctx
    );
    expect(terms.map((t) => t.pattern)).toEqual(['payments', 'error']);
  });

  it('returns no terms in raw SQL mode', () => {
    expect(extractHighlightTerms('declined', [pill({})], ctx, true)).toEqual([]);
  });
});

describe('DISC-SEARCH-02: splitting cell text into highlighted runs', () => {
  it('SEC: a value with many wildcards cannot make one cell backtrack (shared-link ReDoS)', () => {
    const terms = extractHighlightTerms('aa*aa*aa*aa*aa*aa*aa*aa*bb', [], ctx);
    expect(terms).toHaveLength(1);
    const re = compileColumnHighlighter(terms, col('Body'), 'Body');
    const started = Date.now();
    splitHighlights('a'.repeat(MAX_HIGHLIGHT_CHARS * 2), re);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('SEC: text past the scan cap is left plain', () => {
    const re = compileColumnHighlighter([{ sqlExprs: null, pattern: 'zz' }], col('Body'), 'Body');
    const runs = splitHighlights('x'.repeat(MAX_HIGHLIGHT_CHARS) + 'zz', re);
    expect(runs.some((r) => r.match)).toBe(false);
  });

  it('marks every case-insensitive occurrence and keeps the original casing', () => {
    const re = compileColumnHighlighter([{ sqlExprs: null, pattern: 'declined' }], col('Body'), 'Body');
    expect(splitHighlights('Payment declined; DECLINED again', re)).toEqual([
      { text: 'Payment ', match: false },
      { text: 'declined', match: true },
      { text: '; ', match: false },
      { text: 'DECLINED', match: true },
      { text: ' again', match: false },
    ]);
  });

  it('returns the text unchanged when there is nothing to highlight', () => {
    expect(splitHighlights('hello', null)).toEqual([{ text: 'hello', match: false }]);
  });
});
