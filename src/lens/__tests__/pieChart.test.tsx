/**
 * Round 3 #18: Visualize's pie / donut labels — decimal percents, inside the slice (the donut's
 * ring) when they fit, outside with a leader line otherwise, and never overlapping.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DONUT_HOLE, PieChart, PieLayout, pieLayout, pctText } from '../render/PieChart';

const CHAR_W = 6.9;
const LINE_H = 15;

/** Label boxes (x0, y0, x1, y1) as drawn. */
function boxes(l: PieLayout) {
  return l.slices
    .filter((s) => s.label)
    .map((s) => {
      const lab = s.label!;
      const w = Math.max(...lab.lines.map((t) => t.length * CHAR_W));
      const h = lab.lines.length * LINE_H;
      const x0 = lab.anchor === 'middle' ? lab.x - w / 2 : lab.anchor === 'start' ? lab.x : lab.x - w;
      return { s, x0, x1: x0 + w, y0: lab.y - h / 2, y1: lab.y + h / 2 };
    });
}
const overlaps = (a: ReturnType<typeof boxes>[number], b: ReturnType<typeof boxes>[number]) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

function expectNoOverlap(l: PieLayout) {
  const bs = boxes(l);
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      expect([bs[i].s.label!.lines.join(' '), bs[j].s.label!.lines.join(' '), overlaps(bs[i], bs[j])]).toEqual([
        bs[i].s.label!.lines.join(' '),
        bs[j].s.label!.lines.join(' '),
        false,
      ]);
    }
  }
}

const SEV = { names: ['info', 'error', 'warn', 'debug'], values: [1371, 1292, 264, 194] };
const SVC = { names: ['payments', 'checkout', 'auth', 'frontend', 'inventory'], values: [1584, 385, 384, 384, 384] };

describe('pctText', () => {
  it('shows up to two decimals, as Kibana', () => {
    expect(pctText(0.43934)).toBe('43.93%');
    expect(pctText(0.414)).toBe('41.4%');
    expect(pctText(0.5)).toBe('50%');
    expect(pctText(1)).toBe('100%');
  });
});

describe('pieLayout', () => {
  it('pie by severity: every slice labelled with a decimal percent, no two labels overlap', () => {
    const l = pieLayout(SEV.values, SEV.names, 620, 440, false);
    expect(l.slices).toHaveLength(4);
    const text = l.slices.map((s) => s.label?.lines.join(' '));
    expect(text).toEqual(['info 43.93%', 'error 41.4%', 'warn 8.46%', 'debug 6.22%']);
    expectNoOverlap(l);
    // The big slices are labelled inside.
    expect(l.slices[0].label!.inside).toBe(true);
    expect(l.slices[1].label!.inside).toBe(true);
  });

  it('outside labels sit beyond the pie with a leader line', () => {
    const l = pieLayout([1000, 5, 4, 3, 2, 1], ['big', 'a', 'b', 'c', 'd', 'e'], 600, 400, false);
    const out = l.slices.filter((s) => s.label && !s.label.inside);
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) {
      expect(Math.abs(s.label!.x - l.cx)).toBeGreaterThan(l.r);
      expect(s.label!.line).toHaveLength(3);
    }
    expectNoOverlap(l);
  });

  it('donut: labels are inside the ring or outside the pie, never across the edge', () => {
    const l = pieLayout(SVC.values, SVC.names, 620, 440, true);
    expect(l.inner).toBeCloseTo(l.r * DONUT_HOLE);
    for (const b of boxes(l)) {
      if (b.s.label!.inside) {
        for (const [x, y] of [
          [b.x0, b.y0],
          [b.x1, b.y0],
          [b.x0, b.y1],
          [b.x1, b.y1],
        ]) {
          const d = Math.hypot(x - l.cx, y - l.cy);
          expect(d).toBeLessThanOrEqual(l.r);
          expect(d).toBeGreaterThanOrEqual(l.inner);
        }
      } else {
        expect(Math.min(Math.abs(b.x0 - l.cx), Math.abs(b.x1 - l.cx))).toBeGreaterThan(l.r);
      }
    }
    expectNoOverlap(l);
  });

  it('many thin slices: labels that cannot fit vertically are dropped (smallest first), the rest do not overlap', () => {
    const values = [500, ...Array.from({ length: 40 }, (_, i) => 1 + (i % 3))];
    const names = values.map((_, i) => `v${i}`);
    const l = pieLayout(values, names, 500, 200, false);
    expectNoOverlap(l);
    expect(l.slices.filter((s) => s.label).length).toBeLessThan(values.length);
    expect(l.slices[0].label).toBeDefined();
  });

  it('a single slice is a full circle; empty and negative values get no slice', () => {
    const l = pieLayout([10, 0, -3], ['only', 'zero', 'neg'], 400, 300, false);
    expect(l.slices).toHaveLength(1);
    expect(l.slices[0].path.match(/A /g)).toHaveLength(2);
    expect(l.slices[0].label!.lines.join(' ')).toBe('only 100%');
  });
});

describe('PieChart', () => {
  it('slices are named buttons that filter on click and Enter; the legend gives value and percent', () => {
    const ro = global.ResizeObserver;
    global.ResizeObserver = class {
      constructor(private cb: ResizeObserverCallback) {}
      observe() {
        this.cb([{ contentRect: { width: 800, height: 400 } } as ResizeObserverEntry], this as never);
      }
      unobserve() {}
      disconnect() {}
    } as never;
    try {
      const onSelect = jest.fn();
      render(
        <PieChart
          names={SEV.names}
          values={SEV.values}
          colors={['#111111', '#222222', '#333333', '#444444']}
          donut={false}
          onSelect={onSelect}
        />
      );
      const warn = screen.getByRole('button', { name: 'warn: 264 (8.46%)' });
      fireEvent.click(warn);
      expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ xIndex: 2, seriesIndex: 0 }));
      fireEvent.keyDown(screen.getByRole('button', { name: 'debug: 194 (6.22%)' }), { key: 'Enter' });
      expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ xIndex: 3 }));
      const legend = screen.getByTestId('lens-pie-legend');
      expect(legend).toHaveTextContent('info1,37143.93%');
      fireEvent.mouseMove(warn);
      expect(screen.getByRole('tooltip')).toHaveTextContent('warn2648.46%');
    } finally {
      global.ResizeObserver = ro;
    }
  });
});
