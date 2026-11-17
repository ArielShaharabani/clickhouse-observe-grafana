import { test, expect } from './fixtures';

test('config page lists the provisioned shared data views', async ({ appConfigPage, page }) => {
  await expect(page.getByRole('heading', { name: 'Shared Data Views' })).toBeVisible();
  await expect(page.getByText('Spec fixture logs').first()).toBeVisible();
  await expect(page.getByText('OTel demo logs').first()).toBeVisible();
});
