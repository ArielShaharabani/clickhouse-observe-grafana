import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';
import pluginJson from '../../src/plugin.json';

// DISC-NAV-01 Discover session tabs (docs/spec/10-discover.md).

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Discover tabs' });
const tab = (page: Page, name: string) => tabs(page).getByRole('tab', { name, exact: true });
const tabMenu = async (page: Page, name: string, item: string) => {
  await page.getByRole('button', { name: `Tab actions: ${name}` }).click();
  await page.getByRole('menuitem', { name: item }).click();
};
const param = (page: Page, k: string) => new URL(page.url()).searchParams.get(k);

test('each tab keeps its own query; + opens a tab on the same data view', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'ServiceName:payments' });
  await logs.expectRowCount(FIXTURE.counts.payments);
  const first = param(page, '_tab');
  expect(first).toBeTruthy();

  await page.getByRole('button', { name: 'New tab' }).click();
  await expect(tab(page, 'Untitled 2')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => param(page, '_tab')).not.toBe(first);
  expect(param(page, 'q')).toBeNull();
  expect(param(page, 'ds')).toBe(FIXTURE.dataViewId);
  await expect(logs.searchInput).toHaveValue('');

  await tab(page, 'Untitled').click();
  await expect.poll(() => param(page, '_tab')).toBe(first);
  await expect(logs.searchInput).toHaveValue('ServiceName:payments');
  await logs.expectRowCount(FIXTURE.counts.payments);
});

test('duplicate starts with identical state; close lists the tab under Recently closed for restore', async ({
  page,
}) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'SeverityText:error' });
  await logs.expectRowCount(FIXTURE.counts.byLevel.error);

  await tabMenu(page, 'Untitled', 'Duplicate');
  await expect(tab(page, 'Untitled (copy)')).toHaveAttribute('aria-selected', 'true');
  await expect(logs.searchInput).toHaveValue('SeverityText:error');
  await logs.expectRowCount(FIXTURE.counts.byLevel.error);

  await page.getByRole('button', { name: 'Close tab: Untitled (copy)' }).click();
  await expect(tab(page, 'Untitled (copy)')).toHaveCount(0);
  await expect(tab(page, 'Untitled')).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('button', { name: 'All tabs' }).click();
  const closed = page.getByRole('menuitem', { name: /Untitled \(copy\)/ });
  await expect(closed).toContainText(/seconds? ago/);
  await closed.click();
  await expect(tab(page, 'Untitled (copy)')).toHaveAttribute('aria-selected', 'true');
  await expect(logs.searchInput).toHaveValue('SeverityText:error');
});

test('rename survives a reload; the side-menu entry reopens the active tab', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'ServiceName:auth' });
  await tabMenu(page, 'Untitled', 'Rename');
  const input = page.getByRole('textbox', { name: 'Tab name' });
  await input.fill('Auth logs');
  await input.press('Enter');
  await expect(tab(page, 'Auth logs')).toBeVisible();

  await page.reload();
  await expect(tab(page, 'Auth logs')).toHaveAttribute('aria-selected', 'true');

  // Grafana's side-menu link carries no state: the active tab comes back.
  await page.goto(`/a/${pluginJson.id}/logs`);
  await expect(tab(page, 'Auth logs')).toHaveAttribute('aria-selected', 'true');
  await expect(logs.searchInput).toHaveValue('ServiceName:auth');
  await logs.expectRowCount(FIXTURE.counts.byService.auth);
});

test('Visualize from the side menu restores the active tab’s search context', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'ServiceName:checkout' });
  await page.getByRole('button', { name: 'New tab' }).click();
  await expect(tab(page, 'Untitled 2')).toHaveAttribute('aria-selected', 'true');
  await logs.searchInput.fill('ServiceName:inventory');
  await logs.searchInput.press('Enter');
  await expect.poll(() => param(page, 'q')).toBe('ServiceName:inventory');

  await page.goto(`/a/${pluginJson.id}/visualize`);
  await expect.poll(() => param(page, 'q')).toBe('ServiceName:inventory');
});

test('a tampered tab store never reaches the query', async ({ page }) => {
  await page.goto(`/a/${pluginJson.id}/logs`);
  await page.evaluate(
    ([dsId]) => {
      window.sessionStorage.setItem(
        'clickhouse-observe.discoverTabs',
        JSON.stringify({
          tabs: [
            {
              id: 'tevil000',
              title: '<b>bold</b>',
              params: `ds=${dsId}&q=ServiceName:auth&cols=${encodeURIComponent(
                JSON.stringify([{ id: 'x', key: 'x FROM system.users --', sqlExpr: 'name', name: 'x' }])
              )}&from=now-1h&to=now`,
            },
          ],
          activeId: 'tevil000',
        })
      );
    },
    [FIXTURE.dataViewId]
  );
  await page.goto(`/a/${pluginJson.id}/logs`);
  await expect(tab(page, '<b>bold</b>')).toBeVisible();
  await expect(page.locator('b', { hasText: 'bold' })).toHaveCount(0);
  await expect(new LogsPage(page).searchInput).toHaveValue('ServiceName:auth');
  await expect(page.getByText(/system\.users/)).toHaveCount(0);
});
