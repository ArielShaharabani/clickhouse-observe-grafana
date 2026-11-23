import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { VisualizePage } from '../pages/VisualizePage';
import { FIXTURE } from '../fixture';

// LENS-DIM-05 date histogram editor (PLAN 16e; docs/spec/20-lens.md): custom minimum interval,
// Include empty rows, Drop partial intervals, and the Discover hand-off keeping the interval.

// Day buckets follow the user's time zone; the fixture is whole UTC days.
test.use({ timezoneId: 'UTC' });

const DAY = 86_400_000;
const editor = (page: Page) => page.getByRole('dialog', { name: 'Edit Horizontal axis' });
const bars = (viz: VisualizePage) => viz.chart.getByRole('group', { name: 'bar chart' }).getByRole('button');

const dateLens = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    chartType: 'bar',
    subType: 'stacked',
    buckets: [{ kind: 'date_histogram', id: 'b0', field: 'Timestamp', label: 'Timestamp', interval: 'auto', ...extra }],
    metrics: [{ kind: 'metric', id: 'm0', op: 'count' }],
  });

test('typed minimum interval: one bar per day, then per 12 hours; the URL keeps it', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: dateLens() });
  await viz.dimensions.getByRole('button', { name: 'Edit Timestamp' }).click();
  const ed = editor(page);
  await expect(ed.getByRole('status')).toHaveText(/^Auto: /);

  await ed.getByRole('switch', { name: 'Customize time interval' }).click({ force: true });
  const box = ed.getByRole('combobox', { name: /Minimum interval/ });
  await expect(box).toBeVisible();
  await expect(async () => {
    await box.click();
    await box.fill('');
    await box.pressSequentially('1d');
    await expect(box).toHaveValue('1d', { timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await page.getByRole('option', { name: /^1d/ }).first().click();
  await expect(ed.getByRole('status')).toHaveText('Bucket size: 1 day');
  await expect(bars(viz)).toHaveCount(7); // fixture: 7 days
  expect(new URL(page.url()).searchParams.get('lens')).toContain('"interval":"1d"');

  // Presets are there too; a reload keeps the interval.
  await page.reload();
  await expect(bars(viz)).toHaveCount(7);
  await viz.dimensions.getByRole('button', { name: 'Edit Timestamp' }).click();
  // A typed value equal to a preset is shown by the preset's name (Kibana: "Day").
  await expect(editor(page).getByRole('combobox', { name: /Minimum interval/ })).toHaveValue(/^(1d|Day)$/);
});

test('an invalid interval is rejected and never applied', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: dateLens({ interval: '1d' }) });
  await expect(bars(viz)).toHaveCount(7);
  await viz.dimensions.getByRole('button', { name: 'Edit Timestamp' }).click();
  const box = editor(page).getByRole('combobox', { name: /Minimum interval/ });
  await expect(async () => {
    await box.click();
    await box.fill('');
    await box.pressSequentially('1x');
    await expect(box).toHaveValue('1x', { timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await page.getByRole('option', { name: /^1x/ }).first().click();
  await expect(editor(page).getByText(/Use a whole number and a unit/)).toBeVisible();
  expect(new URL(page.url()).searchParams.get('lens')).toContain('"interval":"1d"');
  await expect(bars(viz)).toHaveCount(7);
});

test('a hostile interval in a shared link drops the dimension instead of reaching SQL', async ({ page }) => {
  const viz = new VisualizePage(page);
  const queries: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/ds/query')) {
      queries.push(r.postData() ?? '');
    }
  });
  await viz.open({ lens: dateLens({ interval: '1h)) * 1000 AS b0, (SELECT name FROM system.users) AS x --' }) });
  await expect(viz.dimensions).toBeVisible();
  await expect(viz.dimensions).not.toContainText('Timestamp');
  expect(queries.join('\n')).not.toContain('system.users');
});

test('Drop partial intervals and Include empty rows', async ({ page }) => {
  const viz = new VisualizePage(page);
  // Picker starts at 06:00 on day 1: the first daily bucket is only partly covered.
  await viz.open({ lens: dateLens({ interval: '1d' }), from: String(FIXTURE.from + DAY / 4) });
  await expect(bars(viz)).toHaveCount(7);
  await viz.dimensions.getByRole('button', { name: 'Edit Timestamp' }).click();
  await editor(page).getByRole('checkbox', { name: 'Drop partial intervals' }).check({ force: true });
  await expect(bars(viz)).toHaveCount(6);

  await editor(page).getByRole('checkbox', { name: 'Drop partial intervals' }).uncheck({ force: true });
  await editor(page).getByRole('checkbox', { name: 'Include empty rows' }).uncheck({ force: true });
  expect(new URL(page.url()).searchParams.get('lens')).toContain('"emptyRows":false');
});

test('Discover histogram interval → Edit visualization keeps it', async ({ page }) => {
  const logs = new LogsPage(page);
  // No breakdown: with the default severity split each day is several stacked bar segments.
  await logs.open({ interval: 'day', bd: 'none' });
  const href = await page.getByRole('link', { name: 'Explore in Visualize' }).getAttribute('href');
  const lens = new URLSearchParams(href!.split('?')[1]).get('lens') ?? '';
  expect(lens).toContain('"interval":"1d"');
  await page.getByRole('link', { name: 'Explore in Visualize' }).click();
  const viz = new VisualizePage(page);
  await expect(bars(viz)).toHaveCount(7);
  // Explore in Discover carries it back.
  const back = await page.getByRole('link', { name: 'Explore in Discover' }).getAttribute('href');
  expect(new URLSearchParams(back!.split('?')[1]).get('interval')).toBe('day');
});

// PLAN 16f: Intervals and Filters bucket functions. Tables and bars show plain numbers with separators.
const tableLens = (bucket: Record<string, unknown>) =>
  JSON.stringify({ chartType: 'table', buckets: [bucket], metrics: [{ kind: 'metric', id: 'm0', op: 'count' }] });
const compact = (v: number) => v.toLocaleString('en-US');

test('Filters: one bucket per KQL query, counted on ClickHouse', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({
    lens: tableLens({
      kind: 'filters',
      id: 'b0',
      field: '',
      label: 'Filters',
      filters: [{ query: 'SeverityText : error', label: 'Errors' }, { query: 'ServiceName : payments' }, { query: '' }],
    }),
  });
  await expect(viz.chart.getByText('Errors', { exact: true })).toBeVisible();
  await expect(viz.chart.getByText(FIXTURE.counts.byLevel.error.toLocaleString('en-US'), { exact: true })).toBeVisible();
  await expect(viz.chart.getByText('ServiceName : payments', { exact: true })).toBeVisible();
  await expect(viz.chart.getByText(FIXTURE.counts.payments.toLocaleString('en-US'), { exact: true })).toBeVisible();
  await expect(viz.chart.getByText('All records', { exact: true })).toBeVisible();
  await expect(viz.chart.getByText(FIXTURE.counts.total.toLocaleString('en-US'), { exact: true })).toBeVisible();
});

test('Intervals: automatic buckets are labelled by their range; custom ranges by their label', async ({ page }) => {
  const viz = new VisualizePage(page);
  const field = { id: 'b0', field: 'SeverityNumber', label: 'SeverityNumber', numeric: true };
  await viz.open({ lens: tableLens({ kind: 'range', ...field }) });
  await expect(viz.chart.getByText(/^\d+ – \d+$/).first()).toBeVisible();
  await viz.open({ lens: tableLens({ kind: 'range', ...field, ranges: [{ label: 'Everything' }] }) });
  await expect(viz.chart.getByText('Everything', { exact: true })).toBeVisible();
  await expect(viz.chart.getByText(FIXTURE.counts.total.toLocaleString('en-US'), { exact: true })).toBeVisible();
});

test('Functions grid: Date histogram → Intervals with custom ranges; Filters with an invalid query', async ({
  page,
}) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('Records'); // Count of records over time
  await viz.dimensions.getByRole('button', { name: 'Edit Timestamp' }).click();
  const ed = editor(page);
  await ed.getByRole('button', { name: 'Intervals' }).click();
  await expect(ed.getByRole('button', { name: 'Intervals' })).toHaveAttribute('aria-pressed', 'true');
  await ed.getByRole('switch', { name: 'Create custom ranges' }).click({ force: true });
  await ed.getByRole('textbox', { name: 'Range 1 to' }).fill('13');
  await ed.getByRole('textbox', { name: 'Range 1 to' }).press('Enter');
  await ed.getByRole('button', { name: 'Add range' }).click();
  await expect(ed.getByRole('textbox', { name: 'Range 2 from' })).toHaveValue('13');
  expect(new URL(page.url()).searchParams.get('lens')).toContain('"ranges":[{"from":0,"to":13},{"from":13}]');

  await ed.getByRole('button', { name: 'Filters' }).click();
  await ed.getByRole('textbox', { name: 'Filter 1 query' }).fill('SeverityText : (');
  await ed.getByRole('textbox', { name: 'Filter 1 query' }).press('Enter');
  await expect(ed.getByRole('alert')).toContainText('Invalid KQL');
  await ed.getByRole('textbox', { name: 'Filter 1 query' }).fill('SeverityText : error');
  await ed.getByRole('textbox', { name: 'Filter 1 query' }).press('Enter');
  await expect(
    viz.chart.getByRole('button', { name: new RegExp(`: ${compact(FIXTURE.counts.byLevel.error)}$`) }).first()
  ).toBeVisible();
});
