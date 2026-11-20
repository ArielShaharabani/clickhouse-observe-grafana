import { formatAxisNumber } from '../axisNumber';
import { formatAxisNumber as fromXy } from '../../lens/render/XyChart';

describe('formatAxisNumber (shared by Visualize and the Discover histogram)', () => {
  it('uses separators below a million and abbreviates from a million up', () => {
    expect(formatAxisNumber(0)).toBe('0');
    expect(formatAxisNumber(25_000)).toBe('25,000');
    expect(formatAxisNumber(999_999)).toBe('999,999');
    expect(formatAxisNumber(1_000_000)).toBe('1M');
    expect(formatAxisNumber(50_000_000)).toBe('50M');
    expect(formatAxisNumber(1_500_000_000)).toBe('1.5B');
  });
  it('Visualize re-exports the same function', () => {
    expect(fromXy).toBe(formatAxisNumber);
  });
});
