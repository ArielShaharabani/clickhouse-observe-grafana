import { fitTimeTicks, timeTicks } from '../render/timeTicks';
import { pieDisplayLabels } from '../render/LensChart';

describe('fitTimeTicks (finding 24)', () => {
  const t0 = new Date(2026, 0, 5, 6).getTime();
  const t1 = new Date(2026, 0, 5, 14).getTime();
  const ticks = timeTicks(t0, t1, 8);
  const W = 800;
  const posOf = (t: number) => ((t - t0) / (t1 - t0)) * W;

  it('drops a last tick whose label would run past the edge', () => {
    expect(ticks[ticks.length - 1].label).toBe('14:00');
    const fit = fitTimeTicks(ticks, posOf, W);
    expect(fit[fit.length - 1].label).toBe('13:00');
  });

  it('keeps everything with room, and with no limit (rotated labels)', () => {
    expect(fitTimeTicks(ticks, posOf, W + 100)).toHaveLength(ticks.length);
    expect(fitTimeTicks(ticks, posOf, Infinity)).toHaveLength(ticks.length);
  });

  it('keeps the date row when the first tick is dropped', () => {
    const fit = fitTimeTicks(ticks, (t) => (t === ticks[0].t ? 9999 : posOf(t) - 50), W);
    expect(fit[0].sub).toBe(ticks[0].sub);
  });
});

describe('pieDisplayLabels (finding 23)', () => {
  it('labels slices when all are wide enough', () => {
    expect(pieDisplayLabels([50, 30, 20])).toEqual(['name', 'percent']);
  });
  it('drops on-slice labels when a slice is under 5%', () => {
    expect(pieDisplayLabels([80, 15, 4])).toEqual([]);
  });
  it('ignores empty slices and an empty pie', () => {
    expect(pieDisplayLabels([60, 40, 0])).toEqual(['name', 'percent']);
    expect(pieDisplayLabels([])).toEqual(['name', 'percent']);
  });
});
