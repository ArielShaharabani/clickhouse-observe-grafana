import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';

// R4-DASH: Add to dashboard shows empty title fields with placeholders.
test.describe.configure({ timeout: 120_000 });

test('Add to dashboard starts with empty titles and placeholders', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'SeverityText:error' });
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add to dashboard' });
  const title = dialog.getByRole('textbox', { name: /Dashboard title/ });
  await expect(title).toHaveValue('');
  await expect(title).toHaveAttribute('placeholder', 'Discover export');
  await expect(dialog.getByLabel('Logs table panel title')).toHaveValue('');
  await expect(dialog.getByLabel('Logs table panel title')).toHaveAttribute('placeholder', 'Logs');
});
