import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';

// R3-CHARTS new chart types (docs/spec/20-lens.md LENS-TYPE-01): Bar horizontal, Donut, Heat map,
// Gauge. Fixture (whole week, SeverityText : error): payments 1,575 · checkout 445 · inventory 414 ·
// auth 384 · frontend 373.

const ERRORS = 'SeverityText : error';
const svc = { kind: 'terms', id: 'b1', field: 'ServiceName', label: 'ServiceName', size: 9 };
const count = { kind: 'metric', id: 'm0', op: 'count' };
const lensParam = (page: Page) => JSON.parse(new URL(page.url()).searchParams.get('lens') ?? '{}');

async function pickChart(page: Page, search: string, option: RegExp) {
  await page.getByRole('button', { name: /^Chart type: / }).click();
  await page.getByRole('combobox', { name: 'Search visualizations' }).fill(search);
  await page.getByRole('option', { name: option }).click();
}

function countQueries(page: Page) {
  const c = { n: 0 };
  page.on('request', (r) => r.url().includes('/api/ds/query') && c.n++);
  return c;
}

test('heat map: errors per service over time, ranked rows, no new query on switch, click filters', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ q: ERRORS });
  await viz.addField('Records');
  await viz.addField('ServiceName');
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'line');
  const q = countQueries(page);

  await pickChart(page, 'heat', /^Heat map/);
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'heatmap');
  await expect(viz.group('Horizontal axis')).toContainText('Timestamp');
  await expect(viz.group('Vertical axis')).toContainText('ServiceName');
  await expect(viz.group('Cell value')).toContainText('Count of records');
  // Rows in rank order: payments (the incident) on top.
  await expect(viz.chart.getByTestId('lens-heatmap-y').first()).toContainText('payments');
  await expect(viz.chart.getByTestId('lens-heatmap-legend')).toBeVisible();
  expect(q.n).toBe(0);

  // Hover → tooltip with time, service and value; click → the filter chooser (time bucket + service).
  const cell = viz.chart.getByRole('gridcell', { name: /payments: [\d,]+$/ }).first();
  await cell.hover();
  await expect(page.getByTestId('lens-tooltip')).toContainText('payments');
  await cell.click();
  await expect(page.getByRole('dialog', { name: /Select filters to apply/ })).toBeVisible();
  await page.keyboard.press('Escape');

  await pickChart(page, 'line', /^Line/);
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'line');
  expect(q.n).toBe(0);
});

test('bar horizontal: its own switcher entry, categories on the vertical axis, back to vertical bars', async ({
  page,
}) => {
  const viz = new VisualizePage(page);
  await viz.open({ q: ERRORS });
  await viz.addField('ServiceName');
  const q = countQueries(page);
  await pickChart(page, 'horizontal', /^Bar horizontal/);
  await expect(page.getByTestId('lens-xy')).toHaveAttribute('data-orientation', 'horizontal');
  await expect(page.getByRole('button', { name: 'Chart type: Bar horizontal' })).toBeVisible();
  await expect(viz.group('Vertical axis')).toContainText('ServiceName');
  await expect(viz.group('Horizontal axis')).toContainText('Count of records');
  // Largest on top, full labels.
  await expect(viz.chart.getByTestId('lens-category-tick').first()).toContainText('payments');
  await expect.poll(() => lensParam(page).style).toMatchObject({ orientation: 'horizontal' });
  // Percentage works horizontally too.
  await page.getByRole('radio', { name: 'Percentage' }).check({ force: true });
  await expect(page.getByTestId('lens-xy')).toHaveAttribute('data-orientation', 'horizontal');

  await pickChart(page, 'bar', /^Bar Compare/);
  await expect(page.getByTestId('lens-xy')).toHaveAttribute('data-orientation', 'vertical');
  expect(q.n).toBe(0);
});

test('donut: same roles as pie, drawn as a ring', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ q: ERRORS });
  await viz.addField('ServiceName');
  await pickChart(page, 'donut', /^Donut/);
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'donut');
  await expect(viz.chart).toHaveAttribute('data-panel', 'piechart');
  await expect(viz.group('Slice by')).toContainText('ServiceName');
  await expect(viz.chart.getByText('payments').first()).toBeVisible();
});

test('gauge: one gauge per service; shape, maximum and bands are display-only and kept in the URL', async ({
  page,
}) => {
  const viz = new VisualizePage(page);
  await viz.open({
    q: ERRORS,
    lens: JSON.stringify({ chartType: 'bar', subType: 'stacked', buckets: [svc], metrics: [count] }),
  });
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'bar');
  const q = countQueries(page);
  await pickChart(page, 'gauge', /^Gauge/);
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'gauge');
  await expect(viz.chart.getByTestId('lens-gauge')).toHaveCount(5);
  await expect(viz.chart.getByRole('img', { name: /^payments: 1575/ })).toBeVisible();

  const opts = page.getByRole('region', { name: 'Gauge options' });
  await opts.getByRole('textbox', { name: 'Maximum' }).fill('2000');
  await opts.getByRole('textbox', { name: 'Maximum' }).press('Enter');
  await opts
    .getByRole('radiogroup', { name: 'Color bands' })
    .getByRole('radio', { name: 'Low is good' })
    .check({ force: true });
  await opts
    .getByRole('radiogroup', { name: 'Shape' })
    .getByRole('radio', { name: 'Horizontal bar' })
    .check({ force: true });
  await expect(viz.chart).toHaveAttribute('data-panel', 'bargauge');
  await expect.poll(() => lensParam(page).gauge).toEqual({ shape: 'bar', max: 2000, bands: 'low' });
  expect(q.n).toBe(0);
  await page.reload();
  await expect(viz.chart).toHaveAttribute('data-panel', 'bargauge');
});

test('save a heat map and a gauge to a dashboard: native heatmap / gauge panels', async ({ page }) => {
  const viz = new VisualizePage(page);
  for (const [lens, type] of [
    [
      {
        chartType: 'heatmap',
        buckets: [{ kind: 'date_histogram', id: 'b0', field: 'Timestamp', label: 'Timestamp', interval: 'auto' }, svc],
        metrics: [count],
      },
      'heatmap',
    ],
    [{ chartType: 'gauge', buckets: [svc], metrics: [count], gauge: { bands: 'low' } }, 'gauge'],
  ] as const) {
    await viz.open({ q: ERRORS, lens: JSON.stringify(lens) });
    await expect(viz.chart).toHaveAttribute('data-chart-type', lens.chartType);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Save Lens visualization' });
    const title = `r3 ${type} ${Date.now().toString(36)}`;
    await dialog.getByLabel(/^Title/).fill(title);
    await dialog.getByRole('radio', { name: 'New' }).check({ force: true });
    await dialog.getByRole('button', { name: 'Save and go to dashboard' }).click();
    await expect(page).toHaveURL(/\/d\//);
    const uid = new URL(page.url()).pathname.split('/')[2];
    const json = await (await page.request.get(`/api/dashboards/uid/${uid}`)).json();
    expect(json.dashboard.panels[0].type).toBe(type);
    await expect(page.getByTestId(/data-testid Panel header/).filter({ hasText: title })).toBeVisible();
  }
});
