import { readFileSync } from 'node:fs';
import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';

// DISC-SESSION-01 Save / share / export / overflow (docs/spec/10-discover.md). Saving itself is
// the Saved searches menu (covered by its own spec); this covers Share and the ⋮ menu.
//
// Fixture facts (default.spec_logs): "Order 22364 created" is exactly one document.

test.describe.configure({ timeout: 120_000 });

const ONE_DOC = 'Order 22364 created';

test('Share: relative link by default, absolute when toggled, unsaved warning, Copy link', async ({ page }) => {
  const logs = new LogsPage(page);
  // A relative range that still covers the January 2026 fixture.
  await logs.open({ q: 'payments', from: 'now-2y', to: 'now' });
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Share this Discover session' });
  await expect(modal).toBeVisible();

  const link = modal.getByLabel('Share link');
  await expect(link).toHaveValue(/[?&]q=payments(&|$)/);
  await expect(link).toHaveValue(/from=now-2y/);
  await expect(modal.getByText('You have unsaved changes')).toBeVisible();
  await expect(modal.getByRole('button', { name: /Copy link/ })).toBeVisible();

  await modal.getByRole('switch').click({ force: true });
  await expect(link).toHaveValue(/from=\d{13}/);
  await expect(link).toHaveValue(/to=\d{13}/);

  // The link reproduces the search when opened.
  const url = await link.inputValue();
  await page.goto(url);
  await expect(logs.searchInput).toHaveValue('payments');
});

test('Share: an absolute range is shared as is (toggle disabled)', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Share this Discover session' });
  await expect(modal.getByRole('switch')).toBeDisabled();
  await expect(modal.getByText('The current range is already absolute.')).toBeVisible();
});

test('⋮ Export tab results (CSV) downloads the current search', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: `"${ONE_DOC}"` });
  await logs.expectRowCount(1);
  await page.getByRole('button', { name: 'More Discover actions' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: /Export tab results \(CSV\)/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^discover-.+\.csv$/);
  const csv = readFileSync((await download.path())!, 'utf-8').replace(/^﻿/, '');
  const lines = csv.trim().split('\r\n');
  expect(lines).toHaveLength(2);
  expect(lines[0]).toMatch(/Time/);
  expect(lines[1]).toContain(ONE_DOC);
});

test('⋮ Create alert rule opens Grafana alerting prefilled with the search count', async ({ page, context }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: `"${ONE_DOC}"` });
  await page.getByRole('button', { name: 'More Discover actions' }).click();
  const [popup] = await Promise.all([
    context.waitForEvent('page'),
    page.getByRole('menuitem', { name: /Create alert rule/ }).click(),
  ]);
  const url = new URL(popup.url());
  expect(url.pathname).toMatch(/\/alerting\/new\/alerting$/);
  const defaults = JSON.parse(url.searchParams.get('defaults')!);
  expect(defaults.condition).toBe('B');
  expect(defaults.queries[0].model.rawSql).toContain('count()');
  expect(defaults.queries[0].model.rawSql).toContain(ONE_DOC);
  expect(defaults.queries[1].model.type).toBe('threshold');
  await popup.close();
});

test('⋮ Inspect opens the diagnostics drawer; New session clears the search', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: `"${ONE_DOC}"` });
  await page.getByRole('button', { name: 'More Discover actions' }).click();
  await page.getByRole('menuitem', { name: 'Inspect' }).click();
  await expect(page.getByText('Query timings, SQL, and warnings for recent actions in this session.')).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'More Discover actions' }).click();
  await page.getByRole('menuitem', { name: 'New session' }).click();
  await expect(page).not.toHaveURL(/[?&]q=/);
  await expect(page).toHaveURL(/[?&]ds=spec-fixture/);
  await expect(logs.searchInput).toHaveValue('');
});
