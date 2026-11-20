/**
 * Kibana-parity fixes for the Discover histogram (PARITY-HISTOGRAM; docs/spec/10-discover.md
 * DISC-CHART-01, 30-shared.md SHARED-STATE): exact brush, inclusive end bucket, scaled intervals,
 * round axis ticks, partial buckets, the caption-safe axis band.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { dateTime, TimeRange } from '@grafana/data';
import { VolumeHistogram } from '../VolumeHistogram';
import {
  brushRange,
  calcBucketInterval,
  fillEmptyBuckets,
  isPartialBucket,
  resolveInterval,
  ResolvedInterval,
} from '../_histogramInterval';
import { timeTicks } from '../_histogramTicks';
import { VolumeDataPoint } from '../../types';

const SEC = 1000;
const MIN = 60 * SEC;
const H = 60 * MIN;
const DAY = 24 * H;
const JAN1 = Date.UTC(2026, 0, 1);
const JAN5 = Date.UTC(2026, 0, 5);

function range(fromMs: number, toMs: number): TimeRange {
  return { from: dateTime(fromMs), to: dateTime(toMs), raw: { from: dateTime(fromMs), to: dateTime(toMs) } };
}

describe('auto interval (Kibana ~50-60 bars)', () => {
  it('7 days auto-buckets at 3 hours (56 bars), not 6 hours', () => {
    expect(calcBucketInterval(range(JAN1, JAN1 + 7 * DAY))).toBe(3 * 3600);
    expect(resolveInterval('auto', range(JAN1, JAN1 + 7 * DAY)).label).toBe('Auto - 3 hours');
  });

  it('24 hours auto-buckets at 30 minutes, 4 hours at 5 minutes', () => {
    expect(calcBucketInterval(range(JAN1, JAN1 + DAY))).toBe(1800);
    expect(calcBucketInterval(range(JAN5 + 8 * H, JAN5 + 12 * H))).toBe(300);
  });
});

describe('fixed interval too fine for the range is scaled, not disabled', () => {
  it('Minute over 7 days scales to 15 minutes (672 bars, within the 1,000 cap) with a notice', () => {
    const r = resolveInterval('minute', range(JAN1, JAN1 + 7 * DAY));
    expect(r).toEqual({
      unit: 'SECOND',
      value: 900,
      label: 'Minute, scaled to 15 minutes',
      intervalMs: 900_000,
      scaledTo: '15 minutes',
    });
  });

  it('Second over 1 hour scales to 10 seconds; Second over 10 minutes stays Second', () => {
    expect(resolveInterval('second', range(0, H)).scaledTo).toBe('10 seconds');
    expect(resolveInterval('second', range(0, 10 * MIN))).toEqual({
      unit: 'SECOND',
      value: 1,
      label: 'Second',
      intervalMs: 1000,
    });
  });

  it('Millisecond (round 2 #21): exact under 1,000 buckets, scaled through ms steps, then seconds', () => {
    expect(resolveInterval('millisecond', range(0, 500))).toEqual({
      unit: 'MILLISECOND',
      value: 1,
      label: 'Millisecond',
      intervalMs: 1,
    });
    const tenSec = resolveInterval('millisecond', range(0, 10 * SEC));
    expect(tenSec).toMatchObject({ unit: 'MILLISECOND', value: 10, intervalMs: 10, scaledTo: '10 milliseconds' });
    const hour = resolveInterval('millisecond', range(0, H));
    expect(hour.unit).toBe('SECOND');
    expect(hour.scaledTo).toBe('10 seconds');
    expect(hour.label).toBe('Millisecond, scaled to 10 seconds');
  });

  it('Hour over 7 days (168 bars) is not scaled; the scaled step is a multiple of the unit', () => {
    expect(resolveInterval('hour', range(JAN1, JAN1 + 7 * DAY)).scaledTo).toBeUndefined();
    const r = resolveInterval('hour', range(JAN1, JAN1 + 90 * DAY)); // 2,160 hours
    expect(r.value % 3600).toBe(0);
    expect(Math.ceil((90 * DAY) / r.intervalMs)).toBeLessThanOrEqual(1000);
    expect(r.scaledTo).toBe('3 hours');
  });
});

describe('inclusive end: the bucket holding a row at `to` is kept (2,161 not 2,160)', () => {
  const resolved: ResolvedInterval = { unit: 'SECOND', value: 300, label: 'Auto - 5 minutes', intervalMs: 300_000 };
  const r = range(JAN5 + 8 * H, JAN5 + 12 * H);

  it('keeps a returned bucket starting exactly at the range end, so the total matches the SQL count', () => {
    const points: VolumeDataPoint[] = [
      { time: JAN5 + 8 * H, levels: { info: 20 } },
      { time: JAN5 + 12 * H - 300_000, levels: { info: 20 } },
      { time: JAN5 + 12 * H, levels: { info: 1 } },
    ];
    const filled = fillEmptyBuckets(points, resolved, r);
    expect(filled).toHaveLength(49);
    expect(filled[48]).toEqual({ time: JAN5 + 12 * H, levels: { info: 1 } });
    const total = filled.reduce((s, p) => s + Object.values(p.levels).reduce((a, b) => a + b, 0), 0);
    expect(total).toBe(41);
  });

  it('adds no empty filler bucket at the end when the query returned none there', () => {
    expect(fillEmptyBuckets([], resolved, r)).toHaveLength(48);
  });
});

describe('partial buckets', () => {
  const r = range(JAN5 + 7 * H + 43 * MIN, JAN5 + 12 * H);
  it('a bucket starting before `from` or ending after `to` is partial; one ending at `to` is whole', () => {
    expect(isPartialBucket(JAN5 + 7 * H + 40 * MIN, 5 * MIN, r)).toBe(true);
    expect(isPartialBucket(JAN5 + 7 * H + 45 * MIN, 5 * MIN, r)).toBe(false);
    expect(isPartialBucket(JAN5 + 12 * H - 5 * MIN, 5 * MIN, r)).toBe(false);
    expect(isPartialBucket(JAN5 + 12 * H, 5 * MIN, r)).toBe(true);
  });
});

describe('brushRange: exact dragged times, never empty', () => {
  // 24 one-hour buckets from 00:00, drawn 960 px wide (40 px per bucket).
  const bars = Array.from({ length: 24 }, (_, i) => ({ time: JAN5 + i * H }));

  it('uses the pointer times, not bucket edges (4.8 h → 14.4 h, not 06:00 → 12:00)', () => {
    expect(brushRange(20, 60, bars, H, 960)).toEqual({ from: JAN5 + 4.8 * H, to: JAN5 + 14.4 * H });
  });

  it('order of the drag does not matter', () => {
    expect(brushRange(60, 20, bars, H, 960)).toEqual(brushRange(20, 60, bars, H, 960));
  });

  it('a drag inside one bucket keeps its own times (from < to)', () => {
    const r = brushRange(31, 32, bars, H, 960)!;
    expect(r.from).toBe(JAN5 + Math.floor((0.31 * 24 * H) / SEC) * SEC);
    expect(r.to).toBeGreaterThan(r.from);
    expect(r.to - r.from).toBeLessThan(H);
  });

  it('rounds outwards to whole seconds', () => {
    const r = brushRange(10.00001, 10.00002, bars, H, 960)!;
    expect(r.from % SEC).toBe(0);
    expect(r.to % SEC).toBe(0);
  });

  it('a zero-width brush still spans at least one pixel of time (90 s here) and one second', () => {
    const r = brushRange(50, 50, bars, H, 960)!;
    expect(r.to - r.from).toBe(90 * SEC);
    const tiny = brushRange(
      50,
      50,
      Array.from({ length: 60 }, (_, i) => ({ time: i * SEC })),
      SEC,
      6000
    )!;
    expect(tiny.to - tiny.from).toBe(SEC);
  });

  it('a drag past the edges stops at the chart extent', () => {
    expect(brushRange(-20, 140, bars, H, 960)).toEqual({ from: JAN5, to: JAN5 + 24 * H });
  });

  it('returns null with no bars', () => {
    expect(brushRange(10, 20, [], H, 960)).toBeNull();
  });
});

describe('axis ticks on round times without collisions', () => {
  function assertNoOverlap(ticks: ReturnType<typeof timeTicks>, width: number) {
    for (let i = 1; i < ticks.length; i++) {
      const gapPx = ((ticks[i].pct - ticks[i - 1].pct) / 100) * width;
      expect(gapPx).toBeGreaterThanOrEqual(ticks[i].label.length * 6.5 + 8);
    }
  }

  it('7 days: one tick per day labelled 1st … 7th, "January 2026" under the first', () => {
    const ticks = timeTicks(JAN1, JAN1 + 7 * DAY, 800);
    expect(ticks.map((t) => t.label)).toEqual(['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th']);
    expect(ticks[0].subLabel).toBe('January 2026');
    expect(ticks.slice(1).every((t) => t.subLabel === null)).toBe(true);
    expect(ticks.every((t) => t.time % DAY === 0)).toBe(true);
    assertNoOverlap(ticks, 800);
  });

  it('7 days on a narrow chart steps by 2 days instead of colliding', () => {
    const ticks = timeTicks(JAN1, JAN1 + 7 * DAY, 300);
    expect(ticks.map((t) => t.label)).toEqual(['1st', '3rd', '5th', '7th']);
    assertNoOverlap(ticks, 300);
  });

  it('4 hours: ticks every 30 minutes on round times, the date only on the first', () => {
    const ticks = timeTicks(JAN5 + 8 * H, JAN5 + 12 * H, 800);
    expect(ticks[0].label).toBe('08:00');
    expect(ticks[1].label).toBe('08:30');
    expect(ticks.every((t) => t.time % (30 * MIN) === 0)).toBe(true);
    expect(ticks[0].subLabel).toBe('Jan 5, 2026');
    expect(ticks.filter((t) => t.subLabel)).toHaveLength(1);
    assertNoOverlap(ticks, 800);
  });

  it('a range crossing midnight marks the new day under its midnight tick', () => {
    const ticks = timeTicks(JAN5 - 6 * H, JAN5 + 6 * H, 800);
    const midnight = ticks.find((t) => t.time === JAN5)!;
    expect(midnight.label).toBe('00:00');
    expect(midnight.subLabel).toBe('Jan 5, 2026');
  });

  it('starts on the first round time inside an unround range (brushed 07:43 → 11:48)', () => {
    const ticks = timeTicks(JAN5 + 7 * H + 43 * MIN, JAN5 + 11 * H + 48 * MIN, 800);
    expect(ticks[0].label).toBe('08:00');
  });

  it('multi-year ranges label months ("Jan 2026"), still on midnight ticks', () => {
    const ticks = timeTicks(JAN1, JAN1 + 730 * DAY, 800);
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks[0].label).toBe('Jan 2026');
    expect(ticks.every((t) => /^[A-Z][a-z]{2} \d{4}$/.test(t.label) && t.subLabel === null)).toBe(true);
    assertNoOverlap(ticks, 800);
  });

  it('empty domain gives no ticks', () => {
    expect(timeTicks(JAN1, JAN1, 800)).toEqual([]);
  });
});

describe('VolumeHistogram: brush, click, partial buckets, axis', () => {
  const T0 = JAN5;
  const data: VolumeDataPoint[] = Array.from({ length: 24 }, (_, i) => ({ time: T0 + i * H, levels: { info: 10 } }));
  let rectSpy: jest.SpyInstance;
  beforeEach(() => {
    rectSpy = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 960,
      bottom: 100,
      width: 960,
      height: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => rectSpy.mockRestore());

  function renderChart(timeRange = range(T0, T0 + 24 * H)) {
    const onSelectRange = jest.fn();
    const utils = render(
      <VolumeHistogram
        data={data}
        timeRange={timeRange}
        colorMode="single"
        bucketMs={H}
        onSelectRange={onSelectRange}
      />
    );
    const svg = utils.container.querySelector('svg')!;
    return { ...utils, svg, onSelectRange };
  }

  it('a drag selects the exact dragged times', () => {
    const { svg, onSelectRange } = renderChart();
    fireEvent.mouseDown(svg, { button: 0, clientX: 192 }); // 20% → 04:48
    fireEvent.mouseMove(window, { clientX: 576 });
    fireEvent.mouseUp(window, { clientX: 576 }); // 60% → 14:24
    expect(onSelectRange).toHaveBeenCalledWith(T0 + 4.8 * H, T0 + 14.4 * H);
  });

  it('a short drag inside one bucket never gives from == to', () => {
    const { svg, onSelectRange } = renderChart();
    fireEvent.mouseDown(svg, { button: 0, clientX: 300 });
    fireEvent.mouseUp(window, { clientX: 315 }); // both inside bucket 7 (280-320 px)
    const [from, to] = onSelectRange.mock.calls[0];
    expect(to).toBeGreaterThan(from);
    expect(to - from).toBeLessThan(H);
  });

  it('a click zooms to the clicked bucket, start to end', () => {
    const { svg, onSelectRange } = renderChart();
    fireEvent.mouseDown(svg, { button: 0, clientX: 100 }); // bucket 2
    fireEvent.mouseUp(window, { clientX: 100 });
    expect(onSelectRange).toHaveBeenCalledWith(T0 + 2 * H, T0 + 3 * H);
  });

  it('shades buckets only partly inside the range', () => {
    const { container } = renderChart(range(T0 + 30 * MIN, T0 + 23 * H + 30 * MIN));
    const bands = screen.getAllByTestId('histogram-partial-bucket');
    expect(bands).toHaveLength(2);
    expect(container.querySelectorAll('g[opacity="0.45"]')).toHaveLength(2);
  });

  it('a whole-range chart has no partial buckets', () => {
    renderChart();
    expect(screen.queryAllByTestId('histogram-partial-bucket')).toHaveLength(0);
  });

  it('the axis row grows to two lines when a tick has a date line, so it cannot overlap the caption', () => {
    renderChart();
    const axis = screen.getByTestId('histogram-x-axis');
    expect(axis.style.height).toBe('32px');
    expect(screen.getAllByTestId('histogram-x-tick')[0].textContent).toBe('00:00');
  });
});
