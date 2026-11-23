import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import pluginJson from '../../src/plugin.json';
import { FIXTURE } from '../fixture';

// Configuration > Edit in Visualize links: adds the panel link to existing ClickHouse panels.

const stamp = Date.now().toString(36);
const A = `r7la${stamp}`;
const B = `r7lb${stamp}`;
const ds = { type: 'grafana-clickhouse-datasource', uid: 'clickhouse-dev' };
const panel = (id: number) => ({
  id,
  type: 'timeseries',
  title: `Plain ${id}`,
  gridPos: { x: 0, y: id * 8, w: 12, h: 8 },
  datasource: ds,
  targets: [
    {
      refId: 'A', datasource: ds, editorType: 'sql', format: 1,
      rawSql: 'SELECT $__timeInterval(Timestamp) AS time, count() AS c FROM default.spec_logs WHERE $__timeFilter(Timestamp) GROUP BY time ORDER BY time',
    },
  ],
});

test.afterAll(async ({ request }) => {
  for (const uid of [A, B]) {
    await request.delete(`/api/dashboards/uid/${uid}`);
  }
});

test('finds panels without the link, adds it to the ticked dashboard only, and it opens in edit mode', async ({ page }) => {
  test.setTimeout(120_000);
  for (const uid of [A, B]) {
    const r = await page.request.post('/api/dashboards/db', {
      data: {
        dashboard: {
          uid, title: `Links ${uid}`, schemaVersion: 39, panels: [panel(1), { id: 2, type: 'text', title: 'Text', gridPos: { x: 12, y: 0, w: 6, h: 4 } }],
          time: { from: new Date(FIXTURE.from).toISOString(), to: new Date(FIXTURE.to).toISOString() },
        },
      },
    });
    expect(r.ok()).toBe(true);
  }
  await page.goto(`/plugins/${pluginJson.id}`);
  const get = async (uid: string) => (await (await page.request.get(`/api/dashboards/uid/${uid}`)).json()).dashboard;
  const list = page.getByRole('group', { name: 'Dashboards without the link' });
  const box = (uid: string) => list.getByRole('checkbox', { name: new RegExp(`Links ${uid}$`) });
  // Search indexing of new dashboards lags a little.
  await expect(async () => {
    await page.getByRole('button', { name: 'Find panels without the link' }).click();
    await expect(box(A)).toBeVisible({ timeout: 8000 });
    await expect(box(B)).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 60_000 });
  expect((await get(A)).version).toBe(1);

  await box(A).check({ force: true });
  await page.getByRole('button', { name: 'Add links to 1 dashboard' }).click();
  await expect(list.getByText('Added to 1 panel')).toBeVisible();
  const a = await get(A);
  expect(a.panels[0].links).toHaveLength(1);
  expect(a.panels[1].links ?? []).toHaveLength(0);
  expect((await get(B)).version).toBe(1);

  await page.goto(`/d/${A}?editPanel=1`);
  await page.getByRole('button', { name: 'Back to dashboard' }).click();
  await page.locator('a[href*="pi=link"]').first().click();
  await expect(page).toHaveURL(/\/visualize\?/);
  await expect(page.getByTestId('lens-chart')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save and return' })).toBeVisible();
});
