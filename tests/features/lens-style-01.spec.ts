import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';

// LENS-STYLE-01 Style and Legend panels (docs/spec/20-lens.md). Display-only: no setting re-runs
// the chart query. Fixture: five services, payments 9,264, the others 8,064 each.

const barByService = (style?: object) =>
  JSON.stringify({
    chartType: 'bar',
    subType: 'stacked',
    buckets: [{ kind: 'terms', id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 9 }],
    metrics: [{ kind: 'metric', id: 'm0', op: 'count' }],
    ...(style ? { style } : {}),
  });

const radio = (page: Page, group: string, option: string) =>
  page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: option, exact: true });

const bars = (viz: VisualizePage) => viz.chart.getByRole('group', { name: 'bar chart' }).getByRole('button');

const lensParam = (page: Page) => JSON.parse(new URL(page.url()).searchParams.get('lens') ?? '{}');

test('Style: horizontal bars and bar values, kept in the URL, with no new query', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: barByService() });
  await expect(bars(viz)).toHaveCount(5);
  let queries = 0;
  page.on('request', (r) => r.url().includes('/api/ds/query') && queries++);

  await viz.dimensions.getByRole('button', { name: 'Style' }).click();
  const panel = page.getByRole('region', { name: 'Style settings' });
  await expect(panel).toBeVisible();
  await radio(page, 'Bar orientation', 'Horizontal').click();
  await expect(page.getByTestId('lens-xy')).toHaveAttribute('data-orientation', 'horizontal');
  await radio(page, 'Bar values', 'Show, if able').click();
  // Values with thousands separators (Kibana), not abbreviated.
  await expect(viz.chart.getByTestId('lens-bar-value').filter({ hasText: '9,264' })).toHaveCount(1);
  await expect.poll(() => lensParam(page).style).toMatchObject({ orientation: 'horizontal', barValues: 'show' });
  expect(queries).toBe(0);

  // Reload keeps it; Back returns to the dimensions.
  await page.reload();
  await expect(page.getByTestId('lens-xy')).toHaveAttribute('data-orientation', 'horizontal');
  await viz.dimensions.getByRole('button', { name: 'Style' }).click();
  await page.getByRole('region', { name: 'Style settings' }).getByRole('button', { name: 'Back' }).click();
  await expect(viz.group('Vertical axis')).toBeVisible();
});

test('Style: axis title (custom / none), log scale, custom bounds', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: barByService() });
  await expect(page.getByTestId('lens-axis-title-left')).toHaveText('Count of records');

  await viz.dimensions.getByRole('button', { name: 'Style' }).click();
  const left = page.getByRole('region', { name: 'Left axis' });
  await left
    .getByRole('radiogroup', { name: 'Axis title' })
    .getByRole('radio', { name: 'Custom', exact: true })
    .click();
  await left.getByRole('textbox', { name: 'Left axis title' }).fill('Documents');
  await expect(page.getByTestId('lens-axis-title-left')).toHaveText('Documents');
  await left.getByRole('radiogroup', { name: 'Axis title' }).getByRole('radio', { name: 'None', exact: true }).click();
  await expect(page.getByTestId('lens-axis-title-left')).toHaveCount(0);

  await left
    .getByRole('radiogroup', { name: 'Axis scale' })
    .getByRole('radio', { name: 'Logarithmic', exact: true })
    .click();
  await expect(viz.chart.getByTestId('lens-value-tick').first()).toHaveText(/^1(\.0)?$/);

  await left
    .getByRole('radiogroup', { name: 'Axis scale' })
    .getByRole('radio', { name: 'Linear', exact: true })
    .click();
  await left.getByRole('radiogroup', { name: 'Bounds' }).getByRole('radio', { name: 'Custom', exact: true }).click();
  const upper = left.getByRole('textbox', { name: 'Upper bound' });
  await upper.fill('20000');
  await upper.press('Enter');
  await expect(viz.chart.getByTestId('lens-value-tick').last()).toHaveText('20,000');
  // An inverted range is refused, not applied.
  const lower = left.getByRole('textbox', { name: 'Lower bound' });
  await lower.fill('50000');
  await lower.press('Enter');
  await expect(left.getByText('The lower bound must be below the upper bound')).toBeVisible();
  expect(lensParam(page).style.left.min).toBeUndefined();
});

test('Legend: auto hides a lone series; show, right side, inside corner, hide', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: barByService() });
  await expect(bars(viz)).toHaveCount(5);
  await expect(viz.chart.getByRole('list', { name: 'Legend' })).toHaveCount(0);

  await viz.dimensions.getByRole('button', { name: 'Legend' }).click();
  await radio(page, 'Visibility', 'Show').click();
  const legend = viz.chart.getByRole('list', { name: 'Legend' });
  await expect(legend).toBeVisible();
  await radio(page, 'Alignment', 'Right').click();
  await expect(legend).toHaveAttribute('data-legend-alignment', 'right');
  await radio(page, 'Position', 'Inside').click();
  await expect(legend).toHaveAttribute('data-legend-position', 'inside');
  await radio(page, 'Alignment', 'Bottom Left').click();
  await expect(legend).toHaveAttribute('data-legend-alignment', 'bottom-left');
  await radio(page, 'Layout', 'Grid').click();
  await expect(legend).toHaveAttribute('data-legend-layout', 'grid');
  await radio(page, 'Visibility', 'Hide').click();
  await expect(legend).toHaveCount(0);
});

test('a shared link with a hostile style keeps only valid settings', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({
    lens: barByService({
      orientation: 'horizontal',
      barValues: '<img src=x onerror=alert(1)>',
      left: { title: 'custom', titleText: '<b>Docs</b>', bounds: 'custom', min: 'x' },
      legend: { visibility: 'show', alignment: 'top-left' },
    }),
  });
  await expect(page.getByTestId('lens-xy')).toHaveAttribute('data-orientation', 'horizontal');
  // Plain text, not markup.
  await expect(page.getByTestId('lens-axis-title-left')).toHaveText('<b>Docs</b>');
  await expect(viz.chart.getByTestId('lens-bar-value')).toHaveCount(0);
  // An inside corner is not an outside alignment: the legend falls back to below the chart.
  await expect(viz.chart.getByRole('list', { name: 'Legend' })).toHaveAttribute('data-legend-alignment', 'bottom');
});
