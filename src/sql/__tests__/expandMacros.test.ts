import { expandTimeMacros } from '../expandMacros';

describe('expandTimeMacros', () => {
  it('replaces the time macros with the range values', () => {
    const range = { from: { valueOf: () => 1700000000999 }, to: { valueOf: () => 1700003600000 } } as never;
    expect(expandTimeMacros('ts >= $__fromTime AND ts <= $__toTime', range)).toBe(
      'ts >= toDateTime(1700000000) AND ts <= toDateTime(1700003600)'
    );
  });
});
