import { tabDropIndex, tabShift } from '../DiscoverTabs/tabDropIndex';

const spans = [0, 1, 2, 3].map((i) => ({ left: i * 100, right: i * 100 + 96 }));

describe('tabDropIndex', () => {
  it('stays until the leading edge passes a neighbour midpoint (half a tab)', () => {
    expect(tabDropIndex(1, 0, spans)).toBe(1);
    expect(tabDropIndex(1, 51, spans)).toBe(1);
    expect(tabDropIndex(1, -51, spans)).toBe(1);
  });
  it('moves after about half a tab, either way', () => {
    expect(tabDropIndex(1, 54, spans)).toBe(2);
    expect(tabDropIndex(1, -54, spans)).toBe(0);
    expect(tabDropIndex(0, 160, spans)).toBe(2);
    expect(tabDropIndex(3, -160, spans)).toBe(1);
  });
  it('works past either end of the strip', () => {
    expect(tabDropIndex(2, -5000, spans)).toBe(0);
    expect(tabDropIndex(1, 9000, spans)).toBe(3);
  });
  it('is safe on bad input', () => {
    expect(tabDropIndex(9, 10, spans)).toBe(3);
    expect(tabDropIndex(1, NaN, spans)).toBe(1);
    expect(tabDropIndex(0, 5, [{ left: 0, right: 10 }])).toBe(0);
  });
});

describe('tabShift', () => {
  it('slides tabs between the old and new slot toward the gap', () => {
    expect([0, 1, 2, 3].map((i) => tabShift(i, 0, 2, 100))).toEqual([0, -100, -100, 0]);
    expect([0, 1, 2, 3].map((i) => tabShift(i, 3, 1, 100))).toEqual([0, 100, 100, 0]);
    expect([0, 1, 2].map((i) => tabShift(i, 1, 1, 100))).toEqual([0, 0, 0]);
  });
});
