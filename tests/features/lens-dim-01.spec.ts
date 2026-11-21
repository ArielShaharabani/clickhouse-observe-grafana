import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';
import { FIXTURE } from '../fixture';

// LENS-DIM-01 / LENS-DIM-02 dimension groups + editor (docs/spec/20-lens.md).

const editor = (page: Page, group: string) => page.getByRole('dialog', { name: `Edit ${group}` });

async function pickField(page: Page, group: string, name: string) {
  const box = editor(page, group).getByRole('combobox', { name: 'Field' });
  // A function switch auto-picks a field asynchronously, and the combobox writes the selected
  // label into the input shortly after focus, so a bare fill() can append to it
  // ("TraceFlagsSeverityNumber"). Retry until the input holds exactly what was typed.
  await expect(async () => {
    await box.click();
    await box.fill('');
    await box.pressSequentially(name);
    await expect(box).toHaveValue(name, { timeout: 1000 });
  }).toPass({ timeout: 15000 });
  await page.getByRole('option', { name, exact: true }).click();
}

test('metric editor: function change keeps the field, label follows until renamed', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('Records');
  await viz.dimensions.getByRole('button', { name: 'Edit Count of records' }).click();
  const ed = editor(page, 'Vertical axis');
  await expect(ed).toBeVisible();

  await ed.getByRole('button', { name: 'Maximum' }).click();
  await pickField(page, 'Vertical axis', 'SeverityNumber');
  await expect(ed.getByRole('button', { name: 'Maximum' })).toHaveAttribute('aria-pressed', 'true');
  await ed.getByRole('button', { name: 'Percentile', exact: true }).click();
  await expect(ed.getByRole('textbox', { name: 'Name' })).toHaveAttribute(
    'placeholder',
    '95th percentile of SeverityNumber'
  );

  // Free typing: clear and type 50, applied on Enter (not clamped per keystroke).
  await ed.getByRole('spinbutton', { name: 'Percentile' }).fill('50');
  await ed.getByRole('spinbutton', { name: 'Percentile' }).press('Enter');
  await expect(ed.getByRole('textbox', { name: 'Name' })).toHaveAttribute(
    'placeholder',
    '50th percentile of SeverityNumber'
  );
  await ed.getByRole('textbox', { name: 'Name' }).fill('Severity p95');
  await ed.getByRole('button', { name: 'Minimum' }).click();
  await ed.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(viz.group('Vertical axis')).toContainText('Severity p95');
});

test('Maximum of SeverityNumber computes on ClickHouse (17 in every bucket)', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('Records');
  await viz.dimensions.getByRole('button', { name: 'Edit Count of records' }).click();
  await editor(page, 'Vertical axis').getByRole('button', { name: 'Maximum' }).click();
  await pickField(page, 'Vertical axis', 'SeverityNumber');
  await editor(page, 'Vertical axis').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Chart type: Line' }).click();
  await page.getByRole('option', { name: /^Table/ }).click();
  await expect(viz.chart.getByText('17', { exact: true }).first()).toBeVisible();
  await expect(viz.chart.getByText('Maximum of SeverityNumber')).toBeVisible();
});

test('top values: number of values, and "+ Add" slots open the editor', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('ServiceName');
  await viz.dimensions.getByRole('button', { name: 'Edit Top 9 values of ServiceName' }).click();
  const ed = editor(page, 'Horizontal axis');
  await ed.getByRole('spinbutton', { name: 'Number of values' }).fill('1');
  await ed.getByRole('spinbutton', { name: 'Number of values' }).press('Enter');
  await ed.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(viz.group('Horizontal axis')).toContainText('Top 1 values of ServiceName');
  await page.getByRole('button', { name: 'Chart type: Bar' }).click();
  await page.getByRole('option', { name: /^Table/ }).click();
  await expect(viz.chart.getByText(FIXTURE.counts.payments.toLocaleString('en-US'), { exact: true })).toBeVisible();
  await expect(viz.chart.getByText('checkout', { exact: true })).toHaveCount(0);

  await viz.dimensions.getByRole('button', { name: 'Add to Metrics' }).click();
  await expect(editor(page, 'Metrics')).toBeVisible();
  await editor(page, 'Metrics').getByRole('button', { name: 'Remove dimension' }).click();
  await expect(viz.group('Metrics')).toContainText('Count of records');
});
