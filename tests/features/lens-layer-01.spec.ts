import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { FIXTURE } from '../fixture';
import { VisualizePage } from '../pages/VisualizePage';

// LENS-LAYER-01 Layers (docs/spec/20-lens.md): reference lines (static / computed), annotations
// (manual / KQL query), layer actions. Fixture: five services, payments 9,264, the others 8,064 each.

const barByService = (layers?: object) =>
  JSON.stringify({
    chartType: 'bar',
    subType: 'stacked',
    buckets: [{ kind: 'terms', id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 9 }],
    metrics: [{ kind: 'metric', id: 'm0', op: 'count' }],
    ...(layers ? { layers } : {}),
  });

const barOverTime = (layers?: object) =>
  JSON.stringify({
    chartType: 'bar',
    subType: 'stacked',
    buckets: [{ kind: 'date_histogram', id: 'b0', field: 'Timestamp', label: 'Timestamp', interval: 'auto' }],
    metrics: [{ kind: 'metric', id: 'm0', op: 'count' }],
    ...(layers ? { layers } : {}),
  });

const lensParam = (page: Page) => JSON.parse(new URL(page.url()).searchParams.get('lens') ?? '{}');
const bars = (viz: VisualizePage) => viz.chart.getByRole('group', { name: 'bar chart' }).getByRole('button');
const radio = (page: Page, group: string, option: string) =>
  page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: option, exact: true });

test('Reference line: add a static line from Add layer, label it, kept in the URL with no new chart query', async ({
  page,
}) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: barByService() });
  await expect(bars(viz)).toHaveCount(5);
  let queries = 0;
  page.on('request', (r) => r.url().includes('/api/ds/query') && queries++);

  await viz.dimensions.getByRole('button', { name: 'Add layer' }).click();
  const menu = page.getByRole('menu', { name: 'Select layer type' });
  await expect(menu.getByRole('menuitem', { name: /Visualization/ })).toBeDisabled();
  // A category chart has no time axis for annotations.
  await expect(menu.getByRole('menuitem', { name: /Annotations/ })).toBeDisabled();
  await menu.getByRole('menuitem', { name: 'Reference lines' }).click();

  const layer = viz.dimensions.getByRole('group', { name: 'Reference lines layer' });
  await layer.getByRole('button', { name: '+ Add reference line' }).click();
  const editor = page.getByRole('region', { name: 'Reference line settings' });
  const value = editor.getByRole('textbox', { name: 'Reference line value' });
  await value.fill('8500');
  await value.press('Enter');
  await editor.getByRole('textbox', { name: 'Label' }).fill('Target');
  await radio(page, 'Line style', 'Dashed').click();

  const line = viz.chart.getByTestId('lens-reference-line');
  await expect(line).toHaveAttribute('data-value', '8500');
  await expect(line.getByTestId('lens-reference-label')).toHaveText('Target');
  await expect
    .poll(() => lensParam(page).layers?.[0]?.lines?.[0])
    .toMatchObject({ value: 8500, label: 'Target', lineStyle: 'dashed' });
  expect(queries).toBe(0);

  await page.reload();
  await expect(viz.chart.getByTestId('lens-reference-line')).toHaveAttribute('data-value', '8500');
  // Back from the editor shows the layer card with the line.
  await viz.dimensions
    .getByRole('group', { name: 'Reference lines layer' })
    .getByRole('button', { name: 'Edit Target' })
    .click();
  await page.getByRole('region', { name: 'Reference line settings' }).getByRole('button', { name: 'Back' }).click();
  await expect(viz.group('Vertical axis')).toBeVisible();
});

test('Reference line: a computed value (count) and an invalid value is refused', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: barByService([{ kind: 'referenceLine', id: 'L', lines: [{ id: 'r', value: 100 }] }]) });
  await expect(viz.chart.getByTestId('lens-reference-line')).toHaveAttribute('data-value', '100');

  await viz.dimensions.getByRole('button', { name: 'Edit Static value: 100' }).click();
  const editor = page.getByRole('region', { name: 'Reference line settings' });
  const value = editor.getByRole('textbox', { name: 'Reference line value' });
  await value.fill('abc');
  await value.press('Enter');
  await expect(editor.getByText('Enter a number')).toBeVisible();
  expect(lensParam(page).layers[0].lines[0].value).toBe(100);

  // Computed: Count of records over the chart's data = the fixture total.
  await radio(page, 'Value', 'Computed').click();
  await editor.getByRole('combobox', { name: 'Function' }).click();
  await page.getByRole('option', { name: 'Count', exact: true }).click();
  await expect(viz.chart.getByTestId('lens-reference-line')).toHaveAttribute(
    'data-value',
    String(FIXTURE.counts.total)
  );
});

test('Annotations: manual range and KQL query markers on a time chart', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: barOverTime() });
  await expect(viz.chart.getByTestId('lens-plot-area')).toBeVisible();

  await viz.dimensions.getByRole('button', { name: 'Add layer' }).click();
  await page.getByRole('menu', { name: 'Select layer type' }).getByRole('menuitem', { name: 'Annotations' }).click();
  const layer = viz.dimensions.getByRole('group', { name: 'Annotations layer' });
  await layer.getByRole('button', { name: '+ Add annotation' }).click();
  const editor = page.getByRole('region', { name: 'Annotation settings' });
  await editor.getByRole('textbox', { name: 'Label' }).fill('Incident');
  const start = editor.getByRole('textbox', { name: 'Annotation date' });
  await start.fill('2026-01-05 09:00');
  await start.press('Enter');
  const end = editor.getByRole('textbox', { name: 'End date (range, optional)' });
  await end.fill('2026-01-05 11:00');
  await end.press('Enter');
  const marker = viz.chart.getByTestId('lens-annotation');
  await expect(marker).toHaveCount(1);
  await expect(marker).toHaveAttribute('aria-label', /^Annotation: Incident at 2026-01-05 \d\d:00:00 to /);

  // Query annotation: the newest 100 payments documents.
  await editor.getByRole('button', { name: 'Back' }).click();
  await viz.dimensions
    .getByRole('group', { name: 'Annotations layer' })
    .getByRole('button', { name: '+ Add annotation' })
    .click();
  await radio(page, 'Type', 'Query').click();
  const q = page.getByRole('region', { name: 'Annotation settings' }).getByRole('textbox', { name: 'Query (KQL)' });
  await q.fill('ServiceName : (');
  await q.press('Enter');
  await expect(page.getByRole('region', { name: 'Annotation settings' }).getByRole('alert')).toBeVisible();
  await q.fill('ServiceName : payments');
  await q.press('Enter');
  await expect(viz.chart.getByTestId('lens-annotation')).toHaveCount(101);
  await expect
    .poll(() => lensParam(page).layers[0].annotations[1])
    .toMatchObject({
      type: 'query',
      query: 'ServiceName : payments',
    });
});

test('Layer actions: duplicate, clear and remove a layer; switching to Table drops layers', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({
    lens: barByService([{ kind: 'referenceLine', id: 'L', lines: [{ id: 'r', value: 100, label: 'A' }] }]),
  });
  const cards = viz.dimensions.getByRole('group', { name: 'Reference lines layer' });
  await expect(cards).toHaveCount(1);
  await cards.first().getByRole('button', { name: 'Layer actions for Reference lines' }).click();
  await page.getByRole('menuitem', { name: 'Duplicate layer' }).click();
  await expect(cards).toHaveCount(2);
  await expect(viz.chart.getByTestId('lens-reference-line')).toHaveCount(2);

  await cards.nth(1).getByRole('button', { name: 'Layer actions for Reference lines' }).click();
  await page.getByRole('menuitem', { name: 'Clear layer' }).click();
  await expect(viz.chart.getByTestId('lens-reference-line')).toHaveCount(1);
  await cards.nth(1).getByRole('button', { name: 'Layer actions for Reference lines' }).click();
  await page.getByRole('menuitem', { name: 'Remove layer' }).click();
  await expect(cards).toHaveCount(1);
  await expect.poll(() => lensParam(page).layers).toHaveLength(1);
});

test('a shared link with hostile layers keeps only valid ones, labels as text', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({
    lens: barByService([
      {
        kind: 'referenceLine',
        id: 'L',
        lines: [
          { id: 'ok', value: 5000, label: '<img src=x onerror=alert(1)>' },
          { id: 'bad', value: 'NaN' },
          { id: 'sql', computed: { op: 'max', field: 'x"); DROP TABLE spec_logs; --' } },
        ],
      },
      { kind: 'script', id: 'x' },
    ]),
  });
  const line = viz.chart.getByTestId('lens-reference-line');
  await expect(line).toHaveCount(1);
  await expect(line.getByTestId('lens-reference-label')).toHaveText('<img src=x onerror=alert(1)>');
  await expect(viz.chart.locator('img')).toHaveCount(0);
  // The computed line on an unknown field is dropped before any SQL runs: only the valid line is listed.
  await expect(
    viz.dimensions.getByRole('group', { name: 'Reference lines layer' }).getByRole('button', { name: /^Edit / })
  ).toHaveCount(1);
});
