import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';
import { FIXTURE } from '../fixture';

// LENS-START-01 / LENS-AUTO-01 / LENS-SUGG-01 (docs/spec/20-lens.md) on the deterministic fixture.

test('empty workspace invites dropping fields', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await expect(page.getByText('Drop some fields here to start')).toBeVisible();
});

test('Records → line over time with Count of records; survives a reload (IT-K)', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('Records');
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'line');
  await expect(viz.chart).toHaveAttribute('data-panel', 'timeseries');
  await expect(viz.group('Horizontal axis')).toContainText('Timestamp');
  await expect(viz.group('Vertical axis')).toContainText('Count of records');
  await expect(viz.suggestion('Current visualization')).toHaveAttribute('aria-current', 'true');
  await expect(viz.suggestion('Area stacked')).toBeVisible();

  await page.reload();
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'line');
  await expect(viz.group('Vertical axis')).toContainText('Count of records');
});

test('keyword × keyword → stacked bar; Table suggestion shows exact counts', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('ServiceName');
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'bar');
  await expect(viz.chart).toHaveAttribute('data-panel', 'barchart');
  await viz.addField('SeverityText');
  await expect(viz.group('Breakdown')).toContainText('Top 9 values of SeverityText');
  await expect(viz.suggestion('ServiceName for each SeverityText')).toBeVisible(); // flip

  await viz.suggestion('Table').click();
  await expect(viz.chart).toHaveAttribute('data-panel', 'table');
  await expect(viz.group('Rows')).toContainText('Top 9 values of ServiceName');
  await expect(viz.group('Rows')).toContainText('Top 9 values of SeverityText');
  // payments × error in the fixture.
  await expect(viz.chart.getByText(String(FIXTURE.counts.paymentsErrors), { exact: true })).toBeVisible();
});

test('uses the shared query: a Discover search narrows the chart', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ q: 'ServiceName:payments' });
  await viz.addField('ServiceName');
  await viz.suggestion('Table').click();
  await expect(viz.chart.getByText(String(FIXTURE.counts.payments), { exact: true })).toBeVisible();
  await expect(viz.chart.getByText('checkout', { exact: true })).toHaveCount(0);
});

test('removing a dimension keeps the rest; Clear workspace resets', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('Records');
  await viz.addField('ServiceName');
  await expect(viz.group('Breakdown')).toContainText('Top 9 values of ServiceName');
  await viz.dimensions.getByRole('button', { name: 'Remove Top 9 values of ServiceName' }).click();
  await expect(viz.group('Breakdown')).toContainText('+ Add or drag-and-drop a field');
  await expect(viz.group('Vertical axis')).toContainText('Count of records');
  await page.getByRole('button', { name: 'Clear workspace' }).click();
  await expect(page.getByText('Drop some fields here to start')).toBeVisible();
});

test('a shared link cannot carry its own SQL: unknown fields are dropped', async ({ page }) => {
  const hostile = {
    chartType: 'bar',
    buckets: [{ kind: 'terms', id: 'b', field: '(SELECT groupArray(name) FROM system.users)', label: 'x', size: 9 }],
    metrics: [{ kind: 'metric', id: 'm', op: 'count' }],
  };
  const viz = new VisualizePage(page);
  await viz.open({ lens: JSON.stringify(hostile) });
  // Only the safe Count of records survives; no bucket on the hostile expression.
  await expect(viz.group('Primary metric')).toContainText('Count of records');
  await expect(page.getByText('system.users')).toHaveCount(0);
});
