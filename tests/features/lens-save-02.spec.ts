import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';

// LENS-SAVE-02 "Edit in Visualize" from a dashboard panel (Kibana: Edit visualization in Lens).

const unique = (name: string) => `${name} ${Date.now().toString(36)}`;

test('a panel added from Visualize reopens there from the panel menu, with chart, query and data view', async ({
  page,
}) => {
  const viz = new VisualizePage(page);
  await viz.open({ q: 'SeverityText:error' });
  await viz.addField('ServiceName');
  await expect(viz.dimensions).toContainText('ServiceName');

  const title = unique('Errors by service');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save Lens visualization' });
  await dialog.getByLabel(/^Title/).fill(title);
  await dialog.getByRole('radio', { name: 'New' }).check({ force: true });
  await dialog.getByRole('button', { name: 'Save and go to dashboard' }).click();
  await expect(page).toHaveURL(/\/d\//);

  const header = page.getByTestId(/data-testid Panel header/).filter({ hasText: title });
  await expect(header).toBeVisible();
  await header.hover();
  await header.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: 'Extensions' }).hover();
  await page.getByRole('menuitem', { name: 'Edit in Visualize' }).click();

  await expect(page).toHaveURL(/\/visualize\?/);
  const sp = new URL(page.url()).searchParams;
  expect(sp.get('q')).toBe('SeverityText:error');
  expect(sp.get('ds')).toBe('spec-fixture');
  expect(sp.get('lens')).toContain('ServiceName');
  await expect(viz.dimensions).toContainText('ServiceName');
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'bar');
});

test('a panel not added from Visualize has no Edit in Visualize item', async ({ page }) => {
  const created = await page.request.post('/api/dashboards/db', {
    data: {
      dashboard: {
        title: unique('Plain'),
        schemaVersion: 39,
        panels: [{ id: 1, type: 'text', title: 'Plain text', gridPos: { x: 0, y: 0, w: 12, h: 6 }, targets: [{ refId: 'A' }] }],
      },
      overwrite: false,
    },
  });
  const { url } = await created.json();
  await page.goto(url);
  const header = page.getByTestId(/data-testid Panel header/).filter({ hasText: 'Plain text' });
  await header.hover();
  await header.getByRole('button', { name: /menu/i }).click();
  await expect(page.getByRole('menuitem', { name: 'View' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Edit in Visualize' })).toHaveCount(0);
});
