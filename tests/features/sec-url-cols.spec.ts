import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// SEC-URL-COLS: a crafted shared link must not reach SQL through `cols` (column expression /
// alias) or `sort`. The page renders normally without the injected column.

const core = [
  { id: 'timestamp', key: '__timestamp', sqlExpr: 'Timestamp', displayName: 'Time', type: 'time', isCore: true },
  { id: 'body', key: '__body', sqlExpr: 'Body', displayName: 'Message', type: 'text', isCore: true },
];
const injected = {
  id: 'evil',
  key: 'x` FROM system.users --',
  sqlExpr: '1) FROM system.users --',
  displayName: 'Injected',
  type: 'string',
  isCore: false,
};

test('a crafted cols link renders without the injected column', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ cols: JSON.stringify([...core, injected]) });
  await logs.expectRowCount(FIXTURE.counts.total);
  const headers = logs.grid.locator('thead th');
  await expect(headers.filter({ hasText: 'Time' })).toHaveCount(1);
  await expect(headers.filter({ hasText: 'Message' })).toHaveCount(1);
  await expect(headers.filter({ hasText: 'Injected' })).toHaveCount(0);
  await expect(logs.grid.locator('tbody tr').first()).toBeVisible();
});

test('a core column with a hostile expression uses the view mapping', async ({ page }) => {
  const logs = new LogsPage(page);
  const hostileCore = { ...core[1], sqlExpr: '(SELECT name FROM system.users)', key: '__body, 1' };
  await logs.open({ cols: JSON.stringify([core[0], hostileCore]) });
  await logs.expectRowCount(FIXTURE.counts.total);
  await expect(logs.grid.locator('thead th').filter({ hasText: 'Message' })).toHaveCount(1);
});

test('a hostile sort falls back to the default sort', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ sort: '__body, (SELECT 1):asc' });
  await logs.expectRowCount(FIXTURE.counts.total);
  await expect(logs.grid.locator('tbody tr').first()).toBeVisible();
});

test('a legitimate Map key column from a link is kept', async ({ page }) => {
  const logs = new LogsPage(page);
  const status = {
    id: 'map:LogAttributes:http.status_code',
    key: 'anything at all',
    sqlExpr: "LogAttributes['http.status_code']",
    displayName: 'http.status_code',
    type: 'exact',
    isCore: false,
  };
  await logs.open({ cols: JSON.stringify([...core, status]) });
  await logs.expectRowCount(FIXTURE.counts.total);
  await expect(logs.grid.locator('thead th').filter({ hasText: 'http.status_code' })).toHaveCount(1);
});
