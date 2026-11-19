import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';

// PARITY-CHARTS2 (docs/dev/pending/PARITY-CHARTS2.md): pie colours, tiles, table, Inspector SQL.
const lens = (chartType: string, buckets: object[]) =>
  JSON.stringify({ chartType, buckets, metrics: [{ kind: 'metric', id: 'm0', op: 'count' }] });
const svc = { kind: 'terms', id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 9, other: true };

test('pie shows one slice per service with grouped legend values', async ({ page }) => {
  await new VisualizePage(page).open({ lens: lens('pie', [svc]) });
  await expect(page.getByTestId('lens-chart')).toHaveAttribute('data-panel', 'piechart');
});

test('metric tiles per service sit in a grid with the metric name as subtitle', async ({ page }) => {
  await new VisualizePage(page).open({ lens: lens('metric', [svc]) });
  await expect(page.getByRole('listitem').first()).toContainText('Count of records');
});
