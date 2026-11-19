import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';
import { FIXTURE } from '../fixture';

// LENS-SAVE-01 save and reuse (docs/spec/20-lens.md).

const unique = (name: string) => `${name} ${Date.now().toString(36)}`;

async function openSave(page: Page) {
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save Lens visualization' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('save a metric to a new dashboard: the panel runs the same query (payments = 9,264)', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ q: 'ServiceName:payments' });
  await viz.addField('Records');
  await page.getByRole('button', { name: /^Chart type: / }).click();
  await page.getByRole('option', { name: /^Metric/ }).click();
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'metric');

  const title = unique('Payments volume');
  const dialog = await openSave(page);
  await expect(dialog.getByLabel(/^Title/)).toHaveValue('Count of records');
  await dialog.getByLabel(/^Title/).fill(title);
  await expect(dialog.getByLabel(/^Dashboard title/)).toHaveValue(title); // follows the panel title until edited
  await dialog.getByLabel('Description').fill('From the Lens e2e');
  await dialog.getByRole('radio', { name: 'New' }).check({ force: true });
  await dialog.getByRole('button', { name: 'Save and go to dashboard' }).click();

  await expect(page).toHaveURL(/\/d\//);
  const panel = page.getByTestId(/data-testid Panel header/).filter({ hasText: title });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/^9,?264$|^9\.26\s?K$/)).toBeVisible();
});

test('save to an existing dashboard appends the panel', async ({ page }) => {
  const dashTitle = unique('Lens target');
  const created = await page.request.post('/api/dashboards/db', {
    data: { dashboard: { title: dashTitle, panels: [], schemaVersion: 39 }, overwrite: false },
  });
  expect(created.ok()).toBeTruthy();
  const { uid } = await created.json();

  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('ServiceName');
  const dialog = await openSave(page);
  const title = unique('By service');
  await dialog.getByLabel(/^Title/).fill(title);
  await dialog.getByRole('radio', { name: 'Existing' }).check({ force: true });
  await dialog.getByLabel('Select dashboard').click();
  await dialog.getByLabel('Select dashboard').fill(dashTitle);
  await page.getByRole('option', { name: dashTitle }).click();
  await dialog.getByRole('button', { name: 'Save and go to dashboard' }).click();

  await expect(page).toHaveURL(new RegExp(`/d/${uid}`));
  const saved = await (await page.request.get(`/api/dashboards/uid/${uid}`)).json();
  expect(saved.dashboard.panels.map((p: { title: string; type: string }) => [p.title, p.type])).toEqual([[title, 'barchart']]);
});

test('save to the library only: a library panel is created, no navigation', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('SeverityText');
  const dialog = await openSave(page);
  const title = unique('Levels');
  await dialog.getByLabel(/^Title/).fill(title);
  await dialog.getByRole('radio', { name: 'None' }).check({ force: true });
  await expect(dialog.getByRole('button', { name: 'Save to library' })).toBeDisabled();
  await dialog.getByLabel('Add to library').check({ force: true });
  await dialog.getByRole('button', { name: 'Save to library' }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/visualize\?/);

  const res = await (await page.request.get(`/api/library-elements?searchString=${encodeURIComponent(title)}`)).json();
  const found = res.result.elements.filter((e: { name: string }) => e.name === title);
  expect(found).toHaveLength(1);
  expect(found[0].model.type).toBe('barchart');
  expect(found[0].model.targets[0].rawSql).toContain('SeverityText');
});

test('unsaved chart survives opening Visualize without it (session draft)', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('ServiceName');
  await expect(viz.chart.getByRole('button', { name: /^payments · Count of records: 9,264$/ })).toBeVisible();

  await viz.open(); // no `lens` in the URL
  await expect(viz.group('Horizontal axis')).toContainText('Top 9 values of ServiceName');
  await expect.poll(() => new URL(page.url()).searchParams.get('lens')).toContain('ServiceName');
  expect(FIXTURE.counts.payments).toBe(9264);
});
