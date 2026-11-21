import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';
import { FIXTURE } from '../fixture';

// Kibana parity for the Visualize XY chart (docs/dev/pending/PARITY-XYCHART.md, docs/spec/20-lens.md
// "XY chart behaviour"): crosshair tooltip, Line without stacking, brushing from a bar, stable colours
// and count-ordered legend, nice ticks, round time ticks, plain lines, separators, no blank frame on a
// type switch, legend colour picker. Fixture levels: info 28,265 · warn 6,080 · debug 3,984 · error 3,191.

const timeLens = (chartType: string, breakdown = true, extra: object = {}) =>
  JSON.stringify({
    chartType,
    subType: 'stacked',
    buckets: [
      { kind: 'date_histogram', id: 'x', field: 'Timestamp', label: 'Timestamp', interval: 'auto' },
      ...(breakdown ? [{ kind: 'terms', id: 'b', field: 'SeverityText', label: 'SeverityText', size: 9 }] : []),
    ],
    metrics: [{ kind: 'metric', id: 'm0', op: 'count' }],
    ...extra,
  });

const serviceBars = () =>
  JSON.stringify({
    chartType: 'bar',
    subType: 'stacked',
    buckets: [
      { kind: 'terms', id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 9 },
      { kind: 'terms', id: 'b1', field: 'SeverityText', label: 'SeverityText', size: 9 },
    ],
    metrics: [{ kind: 'metric', id: 'm0', op: 'count' }],
  });

const plot = (page: Page) => page.getByTestId('lens-plot-area');
const lensParam = (page: Page) => JSON.parse(new URL(page.url()).searchParams.get('lens') ?? '{}');

test('hover shows a crosshair tooltip with every series at that time, separators, the hovered one highlighted', async ({
  page,
}) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: timeLens('bar') });
  const box = (await plot(page).boundingBox())!;
  // The middle of an info bar (the first stacked series), so the pointer is on a bar, not in a gap.
  const info = (await viz.chart.getByRole('button', { name: / · info: / }).nth(10).boundingBox())!;
  await page.mouse.move(info.x + info.width / 2, info.y + info.height / 2);
  const tip = page.getByTestId('lens-tooltip');
  await expect(tip).toBeVisible();
  await expect(tip).toContainText('2026 @');
  const rows = tip.getByTestId('lens-tooltip-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText('info');
  await expect(tip.locator('[data-highlighted="true"]')).toHaveCount(1);
  // Clicks still reach the bar under the tooltip (it ignores the pointer).
  await page.mouse.move(box.x - 20, box.y - 20);
  await expect(tip).toHaveCount(0);
});

test('keyboard: focusing a bar shows its tooltip', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: timeLens('bar', false) });
  await viz.chart
    .getByRole('button', { name: / · Count of records: / })
    .first()
    .focus();
  await expect(page.getByTestId('lens-tooltip')).toBeVisible();
  await expect(page.getByTestId('lens-tooltip-row')).toHaveCount(1);
});

test('legend and stack follow the total count (info, warn, debug, error), the same in every XY type', async ({
  page,
}) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: timeLens('bar') });
  const legend = viz.chart.getByRole('list', { name: 'Legend' }).getByRole('listitem');
  await expect(legend).toHaveText([/^info/, /^warn/, /^debug/, /^error/]);
  await page.getByRole('button', { name: 'Chart type: Bar' }).click();
  await page.getByRole('option', { name: /^Line/ }).click();
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'line');
  await expect(legend).toHaveText([/^info/, /^warn/, /^debug/, /^error/]);
});

test('Line has no sub-type; an old line + stacked link still loads as a plain line', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: timeLens('line') });
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'line');
  await expect(page.getByRole('radio', { name: 'Stacked', exact: true })).toHaveCount(0);
  await expect(page.getByText('Line stacked')).toHaveCount(0);
  // Bar keeps the stored sub-type.
  await page.getByRole('button', { name: 'Chart type: Line' }).click();
  await page.getByRole('option', { name: /^Bar Compare/ }).click();
  await expect(page.getByRole('radio', { name: 'Stacked', exact: true })).toBeChecked();
});

test('a drag that starts on a bar brushes the time range; a click on a bar still filters', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: timeLens('bar', false) });
  const bar = viz.chart.getByRole('button', { name: / · Count of records: / }).nth(10);
  const b = (await bar.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height - 4);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 150, b.y + b.height - 4, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => new URL(page.url()).searchParams.get('from')).not.toBe(String(FIXTURE.from));
  await expect(page.getByRole('dialog', { name: 'Select filters to apply' })).toHaveCount(0);
  await expect(page.getByTestId('filter-pills').getByRole('button', { name: /^Filter actions: / })).toHaveCount(0);

  // A press without movement is a click: the time bucket filter applies (single dimension → no chooser).
  const from = new URL(page.url()).searchParams.get('from');
  await viz.chart
    .getByRole('button', { name: / · Count of records: / })
    .nth(2)
    .click();
  await expect.poll(() => new URL(page.url()).searchParams.get('from')).not.toBe(from);
});

test('a series keeps its colour after a click-filter and across chart types', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: serviceBars() });
  // Every series keeps its colour when a filter removes the others, the smaller ones too
  // (session colour memory in seriesColors.ts).
  for (const level of ['error', 'warn']) {
    const fill = () => viz.chart.getByRole('button', { name: new RegExp(`^payments · ${level}: `) }).getAttribute('fill');
    const before = await fill();
    expect(before).toBeTruthy();
    await page.getByRole('button', { name: `Legend actions for ${level}` }).click();
    await page.getByRole('menuitem', { name: 'Filter for' }).click();
    await expect(viz.chart.getByRole('button', { name: /· info: / })).toHaveCount(0);
    await expect.poll(fill).toBe(before);
    await viz.open({ lens: serviceBars() });
  }
});

test('value axis: nice ticks with separators, no K, no fractions on counts', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: serviceBars() });
  const ticks = viz.chart.getByTestId('lens-value-tick');
  await expect(ticks.first()).toHaveText('0');
  const texts = await ticks.allTextContents();
  expect(texts.every((t) => /^\d{1,3}(,\d{3})*$/.test(t))).toBe(true);
  // payments' 9,264 is the peak: the axis ends on the next tick step, not on 20,000.
  expect(texts[texts.length - 1]).toBe('10,000');
  await expect(viz.chart.getByRole('button', { name: /^payments · error: 1,575$/ })).toBeVisible();
});

test('time axis: round-time ticks, the date under the first one, no automatic title, partial buckets shaded', async ({
  page,
}) => {
  const viz = new VisualizePage(page);
  // Start the range 1 h into a bucket so the first one is partial.
  await viz.open({ lens: timeLens('line', false), from: String(FIXTURE.from + 3_600_000) });
  await expect(viz.chart.getByTestId('lens-category-tick').first()).toBeVisible();
  await expect(viz.chart.getByTestId('lens-category-subtick').first()).toContainText('2026');
  await expect(viz.chart.getByTestId('lens-axis-title-bottom')).toHaveCount(0);
  await expect(viz.chart.getByTestId('lens-axis-title-left')).toHaveText('Count of records');
  await expect(viz.chart.getByTestId('lens-partial-bucket').first()).toBeVisible();
  // No tick label is clipped by the right edge (last tick dropped when it would not fit).
  const box = await viz.chart.locator('svg').first().boundingBox();
  for (const tk of await viz.chart.getByTestId('lens-category-tick').all()) {
    const b = await tk.boundingBox();
    expect(b!.x + b!.width).toBeLessThanOrEqual(box!.x + box!.width);
  }
  // Plain lines: no dot on every point.
  await expect(viz.chart.locator('circle[data-point-visible="true"]')).toHaveCount(0);
});

test('switching chart type keeps the previous chart on screen until the new one is drawn', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: timeLens('bar') });
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'bar');
  await page.evaluate(() => {
    (window as any).__chartGone = false;
    const obs = new MutationObserver(() => {
      if (!document.querySelector('[data-testid="lens-chart"]')) {
        (window as any).__chartGone = true;
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  });
  await page.getByRole('button', { name: 'Chart type: Bar' }).click();
  await page.getByRole('option', { name: /^Area/ }).click();
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'area');
  expect(await page.evaluate(() => (window as any).__chartGone)).toBe(false);
});

test('legend ⋮ → colour: the series takes it, it is in the URL, kept on reload, no new query', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: serviceBars() });
  await expect(viz.chart.getByRole('button', { name: /^payments · error: / })).toBeVisible();
  let queries = 0;
  page.on('request', (r) => r.url().includes('/api/ds/query') && queries++);
  await page.getByRole('button', { name: 'Legend actions for warn' }).click();
  await page.getByRole('menuitemradio', { name: 'Color purple' }).click();
  await expect.poll(() => lensParam(page).style?.colors?.warn).toMatch(/^#[0-9a-f]{6}$/);
  const picked = lensParam(page).style.colors.warn;
  await expect(viz.chart.getByRole('button', { name: /^payments · warn: / })).toHaveAttribute('fill', picked);
  expect(queries).toBe(0);
  await page.reload();
  await expect(viz.chart.getByRole('button', { name: /^payments · warn: / })).toHaveAttribute('fill', picked);
  await page.getByRole('button', { name: 'Legend actions for warn' }).click();
  await page.getByRole('menuitem', { name: 'Reset color' }).click();
  await expect.poll(() => lensParam(page).style?.colors).toBeUndefined();
});
