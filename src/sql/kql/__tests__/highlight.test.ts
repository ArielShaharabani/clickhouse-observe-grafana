import { extractHighlightTerms, splitHighlights, termsForColumn } from '../highlight';
import { FilterPill, SelectedColumn } from '../../../types';

const col = (over: Partial<SelectedColumn>): SelectedColumn => ({
  id: 'c',
  key: 'k',
  sqlExpr: 'X',
  displayName: 'X',
  type: 'string',
  isCore: false,
  ...over,
});
const pill = (over: Partial<FilterPill>): FilterPill => ({ id: 'p', field: 'ServiceName', op: '=', value: 'payments', ...over });

describe('DISC-SEARCH-02: highlight terms from the query and filters', () => {
  it('takes field:value and bare terms, splitting wildcards into literal parts', () => {
    expect(extractHighlightTerms('ServiceName:payments and declin* and "Order 1"', [])).toEqual([
      { field: 'ServiceName', text: 'payments' },
      { field: null, text: 'declin' },
      { field: null, text: 'Order 1' },
    ]);
  });

  it('skips negated, exists and range terms', () => {
    expect(extractHighlightTerms('not level:debug and ServiceName:* and duration > 5', [])).toEqual([]);
  });

  it('returns no terms for an unparsable query instead of throwing', () => {
    expect(extractHighlightTerms('level:(', [])).toEqual([]);
  });

  it('adds enabled positive filter values, including one_of sets', () => {
    const terms = extractHighlightTerms('', [
      pill({}),
      pill({ id: 'q', op: '!=', value: 'auth' }),
      pill({ id: 'r', disabled: true, value: 'checkout' }),
      pill({ id: 's', field: 'SeverityText', op: 'one_of', value: '', values: ['error', 'warn'] }),
      pill({ id: 't', field: 'Body', op: 'contains', value: 'timeout' }),
    ]);
    expect(terms).toEqual([
      { field: 'ServiceName', text: 'payments' },
      { field: 'SeverityText', text: 'error' },
      { field: 'SeverityText', text: 'warn' },
      { field: 'Body', text: 'timeout' },
    ]);
  });

  it('assigns field terms to their column and bare terms to the body column', () => {
    const terms = [
      { field: 'servicename', text: 'payments' },
      { field: null, text: 'declined' },
    ];
    expect(termsForColumn(terms, col({ sqlExpr: 'ServiceName', displayName: 'Service' }), 'Body')).toEqual(['payments']);
    expect(termsForColumn(terms, col({ sqlExpr: 'Body', displayName: 'Message' }), 'Body')).toEqual(['declined']);
    expect(termsForColumn(terms, col({ sqlExpr: 'TraceId' }), 'Body')).toEqual([]);
  });
});

describe('DISC-SEARCH-02: splitting cell text into highlighted runs', () => {
  it('marks every case-insensitive occurrence and keeps the original casing', () => {
    expect(splitHighlights('Payment declined; DECLINED again', ['declined'])).toEqual([
      { text: 'Payment ', match: false },
      { text: 'declined', match: true },
      { text: '; ', match: false },
      { text: 'DECLINED', match: true },
      { text: ' again', match: false },
    ]);
  });

  it('treats regex characters literally and prefers the longest overlapping term', () => {
    expect(splitHighlights('a.b(c) abc', ['a.b(c)', 'a'])).toEqual([
      { text: 'a.b(c)', match: true },
      { text: ' ', match: false },
      { text: 'a', match: true },
      { text: 'bc', match: false },
    ]);
  });

  it('returns the text unchanged when there is nothing to highlight', () => {
    expect(splitHighlights('hello', [])).toEqual([{ text: 'hello', match: false }]);
    expect(splitHighlights('hello', ['zzz'])).toEqual([{ text: 'hello', match: false }]);
  });
});
