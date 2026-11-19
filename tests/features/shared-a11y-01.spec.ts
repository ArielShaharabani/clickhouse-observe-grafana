import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { VisualizePage } from '../pages/VisualizePage';
import { FIXTURE } from '../fixture';

// SHARED-A11Y-01 keyboard and accessibility (docs/spec/30-shared.md): popovers are dialogs that
// close on Escape and give focus back, the grid moves by arrow keys, Visualize's drag and drop has
// a keyboard mode with spoken instructions, field buttons have descriptive names.

const HINT = /You are in a dialog\. Press Escape/;
const errorPill = { id: 'e2e-a11y', field: 'SeverityText', op: '=', value: 'error' };

test('field Preview button: Enter opens the field dialog, Escape closes it and focus returns', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  const preview = page
    .getByRole('region', { name: 'Available fields' })
    .getByRole('button', { name: /^Preview TraceId: / });
  await preview.focus();
  // The row's actions show while the row has keyboard focus, with specific names.
  await expect(page.getByRole('button', { name: 'Add TraceId as column' })).toBeVisible();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'TraceId', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(HINT);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(preview).toBeFocused();
});

test('pill menu: arrows move between items, Escape returns to the pill; Edit filter is a dialog', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ filters: JSON.stringify([errorPill]) });
  await logs.expectRowCount(FIXTURE.counts.byLevel.error);
  const pill = logs.pill('SeverityText');
  await pill.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Filter actions' });
  await expect(menu.getByRole('menuitem', { name: 'Pin across pages' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Edit filter' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(pill).toBeFocused();

  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const editor = page.getByRole('dialog', { name: 'Edit filter' });
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAccessibleDescription(HINT);
  // Escape may first close an open field list; the second always closes the editor.
  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden({ timeout: 1000 });
  }).toPass({ timeout: 10000 });
  await expect(pill).toBeFocused();
  await logs.expectRowCount(FIXTURE.counts.byLevel.error); // nothing changed
});

test('Add filter is a dialog; Escape closes it and focus returns to the button', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  const trigger = page.getByRole('button', { name: 'Add filter' });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Add filter' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription(HINT);
  await expect(async () => {
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 1000 });
  }).toPass({ timeout: 10000 });
  await expect(trigger).toBeFocused();
});

test('grid: arrow keys move the active cell, announced through aria-activedescendant', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  await logs.grid.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  const active = async () => {
    const id = await logs.grid.getAttribute('aria-activedescendant');
    return id ? page.locator(`[id="${id}"]`).getAttribute('data-cell') : null;
  };
  await expect.poll(active).toBe('0:1');
  await page.keyboard.press('ArrowDown');
  await expect.poll(active).toBe('1:1');
  await page.keyboard.press('Home');
  await expect.poll(active).toBe('1:0');
  // Enter expands the cell; Escape closes it and the grid keeps focus.
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: /^Value of / });
  await expect(dialog).toHaveAccessibleDescription(HINT);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(logs.grid).toBeFocused();
});

test('Display options is a dialog closed by Escape', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await page.getByRole('button', { name: 'Display options' }).click();
  const dialog = page.getByRole('dialog', { name: 'Display options' });
  await expect(dialog).toHaveAccessibleDescription(HINT);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('Visualize: keyboard drag and drop with spoken instructions', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  const live = page.getByTestId('lens-dnd-live');
  const search = viz.fields.getByRole('textbox', { name: 'Search field names' });

  // Field → workspace.
  await search.fill('ServiceName');
  const service = viz.fields.getByRole('button', { name: 'Drag ServiceName' });
  await expect(service).toHaveAccessibleDescription(/Press Space or Enter to start dragging/);
  await service.focus();
  await page.keyboard.press('Space');
  await expect(live).toContainText('Lifted ServiceName. 1 drop target. Over the workspace.');
  await page.keyboard.press('Enter');
  await expect(live).toHaveText('Dropped ServiceName on the workspace.');
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'bar');
  await expect(viz.group('Horizontal axis')).toContainText('ServiceName');

  // Field → Breakdown: arrows walk the targets (workspace, Vertical axis, Breakdown).
  await search.fill('SeverityText');
  const severity = viz.fields.getByRole('button', { name: 'Drag SeverityText' });
  await severity.focus();
  await page.keyboard.press('Enter');
  await expect(live).toContainText('Lifted SeverityText. 3 drop targets.');
  await page.keyboard.press('ArrowDown');
  await expect(live).toHaveText('SeverityText over Vertical axis. Press Space or Enter to drop.');
  await page.keyboard.press('ArrowDown');
  await expect(live).toHaveText('SeverityText over Breakdown. Press Space or Enter to drop.');
  await page.keyboard.press('Space');
  await expect(live).toHaveText('Dropped SeverityText on Breakdown.');

  // The drop opens the Breakdown editor; Escape closes it and focus lands on the new dimension.
  const editor = page.getByRole('dialog', { name: 'Edit Breakdown' });
  await expect(editor).toBeVisible();
  await expect(editor).toHaveAccessibleDescription(HINT);
  await editor.focus();
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  const dim = viz.group('Breakdown').getByRole('button', { name: /^Edit .*SeverityText/ });
  await expect(dim).toBeFocused();

  // Escape cancels a keyboard drag without changing the chart.
  await severity.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(live).toHaveText('Cancelled dragging SeverityText.');
  await expect(viz.group('Breakdown')).toContainText('SeverityText');
});

test('Visualize legend ⋮ menu: focus moves in, Escape returns to the button', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('ServiceName');
  await viz.addField('SeverityText');
  const more = page.getByRole('button', { name: 'Legend actions for debug' });
  await more.focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Actions for debug' });
  await expect(menu.getByRole('menuitem', { name: 'Filter for' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Filter out' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
});
