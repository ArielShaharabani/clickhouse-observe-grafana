import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// LENS-INTERACT-02 / DISC-CHART-03 Discover ↔ Lens hand-off (docs/spec/20-lens.md, 10-discover.md).
// IT-G: Discover → Lens keeps query, filters and time. IT-H: Lens → Discover adds the bucket
// fields as columns, and counts match on both sides.

const KEEP = ['q', 'filters', 'from', 'to', 'ds'];

test('IT-G: field popover Visualize opens the field chart with the same search context', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'ServiceName:payments' });
  await logs.expectRowCount(FIXTURE.counts.payments);
  const before = new URL(page.url()).searchParams;

  await page.getByTitle('SeverityText', { exact: true }).click();
  await page.getByRole('button', { name: 'Visualize SeverityText' }).click();

  await expect(page).toHaveURL(/\/visualize\?/);
  const viz = new VisualizePage(page);
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'bar');
  await expect(viz.group('Horizontal axis')).toContainText('Top 9 values of SeverityText');
  await expect(viz.group('Vertical axis')).toContainText('Count of records');
  // The query still applies: payments' errors only (1,575).
  await expect(viz.chart.getByRole('button', { name: /^error · Count of records: 1\.6K$/ })).toBeVisible();
  const after = new URL(page.url()).searchParams;
  for (const k of KEEP) {
    expect(after.get(k)).toBe(before.get(k));
  }
});

test('DISC-CHART-03: histogram Edit visualization opens Bar over time with the breakdown', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ bd: 'severity' });
  await logs.expectRowCount(FIXTURE.counts.total);
  await page.getByRole('link', { name: 'Edit visualization' }).click();

  await expect(page).toHaveURL(/\/visualize\?/);
  const viz = new VisualizePage(page);
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'bar');
  await expect(viz.group('Horizontal axis')).toContainText('Timestamp');
  await expect(viz.group('Vertical axis')).toContainText('Count of records');
  await expect(viz.group('Breakdown')).toContainText('Top 9 values of SeverityText');
  await expect(page.getByRole('button', { name: 'Chart type: Bar' })).toBeVisible();
});

test('IT-H: Explore in Discover opens a new tab with the bucket fields as columns and the same count', async ({
  page,
  context,
}) => {
  const viz = new VisualizePage(page);
  await viz.open({ q: 'SeverityText:error' });
  await viz.addField('LogAttributes.http.method');
  await expect(viz.chart.getByRole('button', { name: /^GET · Count of records: / })).toBeVisible();

  const [tab] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('link', { name: 'Explore in Discover' }).click(),
  ]);
  await tab.waitForLoadState();
  await expect(tab).toHaveURL(/\/logs\?/);
  const logs = new LogsPage(tab);
  await logs.expectRowCount(FIXTURE.counts.byLevel.error);
  // A fresh tab may open Grafana's "What's new" dialog, which hides the page from a11y queries.
  const whatsNew = tab.getByRole('dialog', { name: "What's new in Grafana" });
  await expect(whatsNew.or(logs.grid)).toBeVisible();
  if (await whatsNew.isVisible()) {
    await whatsNew.getByRole('button', { name: 'Close' }).click();
  }
  // The view's default columns stay; the chart's bucket field is added.
  for (const name of [/^Time/, /^Message/, /LogAttributes\.http\.method/]) {
    await expect(logs.grid.getByRole('columnheader', { name })).toBeVisible();
  }
  const sp = new URL(tab.url()).searchParams;
  expect(sp.get('q')).toBe('SeverityText:error');
  expect(sp.get('ds')).toBe(FIXTURE.dataViewId);
  const cols: Array<{ displayName: string }> = JSON.parse(sp.get('cols') ?? '[]');
  expect(cols[0].displayName).toBe('Time');
  expect(cols[cols.length - 1].displayName).toBe('LogAttributes.http.method');
});
