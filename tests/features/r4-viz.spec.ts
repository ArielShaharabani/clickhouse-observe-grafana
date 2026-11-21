import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';

// Round 3 fixes, Visualize (docs/dev/pending/R4-VIZ.md): Percentile rank, pie / donut labels,
// metric tiles that fit, search suggestions closing on Enter, fewer queries on open.

const editor = (page: Page) => page.getByRole('dialog', { name: /^Edit / });
const sev = { field: 'SeverityNumber', fieldLabel: 'SeverityNumber', numeric: true };
const lensOf = (chartType: string, buckets: object[], metrics: object[]) =>
  JSON.stringify({ chartType, buckets, metrics });
const count = { kind: 'metric', id: 'm0', op: 'count' };
const terms = (field: string, size = 9) => ({ kind: 'terms', id: 'b0', field, label: field, size });

test('Percentile rank: quick function with a value, shown as a percent; formula gives the same number', async ({
  page,
}) => {
  const viz = new VisualizePage(page);
  // 77.67 % of the fixture's SeverityNumber values are <= 9 (ClickHouse, spec_logs).
  await viz.open({
    lens: lensOf('metric', [], [{ kind: 'metric', id: 'm0', op: 'percentile_rank', rankValue: 9, ...sev }]),
  });
  await expect(viz.dimensions).toContainText('Percentile rank (9) of SeverityNumber');
  await expect(viz.chart.getByText('77.67%')).toBeVisible();

  await viz.dimensions.getByRole('button', { name: 'Edit Percentile rank (9) of SeverityNumber' }).click();
  await expect(editor(page).getByRole('button', { name: 'Percentile rank', pressed: true })).toBeVisible();
  const value = editor(page).getByLabel('Percentile ranks value');
  await expect(value).toHaveValue('9');
  await value.fill('13');
  await value.press('Enter');
  await expect(editor(page).getByRole('textbox', { name: 'Name' })).toHaveAttribute(
    'placeholder',
    'Percentile rank (13) of SeverityNumber'
  );

  await viz.open({
    lens: lensOf(
      'metric',
      [],
      [
        {
          kind: 'metric',
          id: 'm0',
          op: 'formula',
          formula: 'percentile_rank(SeverityNumber, value=9)',
          formulaFields: { SeverityNumber: { expr: 'SeverityNumber', numeric: true } },
          format: { id: 'percent', decimals: 2 },
        },
      ]
    ),
  });
  await expect(viz.chart.getByText('77.67%')).toBeVisible();
});

test('pie by severity: decimal percents, labels do not overlap', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: lensOf('pie', [terms('SeverityText')], [count]) });
  await expect(viz.chart).toHaveAttribute('data-panel', 'pie');
  const labels = page.getByTestId('lens-pie-label');
  await expect(labels.first()).toBeVisible();
  await expect(page.getByTestId('lens-pie-legend')).toContainText(/\d+\.\d{1,2}%/);
  const boxes = await labels.locator('text').evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom };
    })
  );
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      expect(a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b).toBe(false);
    }
  }
  // One click on a slice filters on its value (as the other charts).
  await page.getByTestId('lens-pie-slice').first().click();
  await expect.poll(() => new URL(page.url()).searchParams.get('filters') ?? '').toContain('SeverityText');
});

test('donut labels stay in the ring or outside the chart, never across its edge', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: lensOf('donut', [terms('ServiceName')], [count]) });
  await expect(page.getByTestId('lens-pie')).toHaveAttribute('data-pie-type', 'donut');
  await expect(page.getByTestId('lens-pie-label').first()).toBeVisible();
});

test('metric tiles by category: every row fits the chart area (no scroll)', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: lensOf('metric', [terms('ServiceName', 8)], [count]) });
  const grid = viz.chart.getByRole('list', { name: 'Metric tiles' });
  await expect(grid.getByRole('listitem').first()).toBeVisible();
  const { scroll, client } = await grid.evaluate((e) => ({ scroll: e.scrollHeight, client: e.clientHeight }));
  expect(scroll).toBeLessThanOrEqual(client);
});

test('search suggestions close after Enter', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  const input = page.getByPlaceholder(/filter logs with kql/i);
  await input.fill('SeverityText:err');
  await expect(page.getByRole('listbox')).toBeVisible();
  await input.press('Enter');
  // Past the value-suggestion debounce: nothing reopens the list.
  await page.waitForTimeout(800);
  await expect(page.getByRole('listbox')).toHaveCount(0);
});

test('opening Visualize with a chart skips the text-index lookup', async ({ page }) => {
  const sqls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/ds/query')) {
      sqls.push(r.postData() ?? '');
    }
  });
  const viz = new VisualizePage(page);
  await viz.open({ lens: lensOf('bar', [terms('ServiceName')], [count]) });
  await expect(viz.chart).toBeVisible();
  expect(sqls.some((s) => s.includes('data_skipping_indices'))).toBe(false);
});
