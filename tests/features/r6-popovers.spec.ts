import { expect } from '@grafana/plugin-e2e';
import type { Locator, Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { VisualizePage } from '../pages/VisualizePage';

// R6 popovers: a menu opens next to its button whatever the panel widths or window size, stays
// inside the window and closes on Escape / a click outside. Fixture: five services.

const barByService = (layers?: object) =>
  JSON.stringify({
    chartType: 'bar',
    subType: 'stacked',
    buckets: [{ kind: 'terms', id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 9 }],
    metrics: [{ kind: 'metric', id: 'm0', op: 'count' }],
    ...(layers ? { layers } : {}),
  });

const lineByService = JSON.stringify({
  chartType: 'line',
  buckets: [
    { kind: 'date_histogram', id: 'b0', field: 'Timestamp', label: 'Timestamp', interval: 'auto' },
    { kind: 'terms', id: 'b1', field: 'ServiceName', label: 'ServiceName', size: 9 },
  ],
  metrics: [{ kind: 'metric', id: 'm0', op: 'count' }],
});

/** Dimensions pane at its narrowest or widest (saved splitter sizes); the window size is part of the case. */
const CASES = [
  { name: 'narrow panel, 1000x700', size: { width: 1000, height: 700 }, dims: '0.94', fields: '0.06' },
  { name: 'wide panel, 1000x700', size: { width: 1000, height: 700 }, dims: '0.3', fields: '0.4' },
  { name: 'wide panel, 1600x900', size: { width: 1600, height: 900 }, dims: '0.3', fields: '0.4' },
];

async function openViz(page: Page, lens: string, c: (typeof CASES)[number]) {
  await page.setViewportSize(c.size);
  await page.addInitScript(
    ([d, f]) => {
      localStorage.setItem('clickhouse-observe.lens.dimsSplit', d);
      localStorage.setItem('clickhouse-observe.lens.fieldsSplit', f);
    },
    [c.dims, c.fields]
  );
  const viz = new VisualizePage(page);
  await viz.open({ lens });
  return viz;
}

type Box = { x: number; y: number; width: number; height: number };

/** The popup is inside the window and lines up with the trigger's edge, near it, under or over. */
async function expectAnchored(page: Page, t: Box, popup: Locator) {
  const p = (await popup.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(p.x).toBeGreaterThanOrEqual(-1);
  expect(p.y).toBeGreaterThanOrEqual(-1);
  expect(p.x + p.width).toBeLessThanOrEqual(vp.width + 1);
  expect(p.y + p.height).toBeLessThanOrEqual(vp.height + 1);
  const edgeDx = Math.min(Math.abs(p.x - t.x), Math.abs(p.x + p.width - (t.x + t.width)));
  expect(edgeDx).toBeLessThanOrEqual(2);
  const gap = Math.min(Math.abs(p.y - (t.y + t.height)), Math.abs(t.y - (p.y + p.height)));
  expect(gap).toBeLessThanOrEqual(100); // flipped menus can float a little off the button on a short window
}

for (const c of CASES) {
  test(`Add layer menu opens at its button: ${c.name}`, async ({ page }) => {
    const viz = await openViz(page, barByService(), c);
    const add = viz.dimensions.getByRole('button', { name: 'Add layer' });
    await add.scrollIntoViewIfNeeded();
    const box = (await add.boundingBox())!;
    await add.click();
    const menu = page.getByRole('menu', { name: 'Select layer type' });
    await expect(menu).toBeVisible();
    await expectAnchored(page, box, menu);
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(add).toBeFocused();
    await add.click();
    await expect(menu).toBeVisible();
    await page.mouse.click(c.size.width / 2, 3);
    await expect(menu).toBeHidden();
  });

  test(`layer actions menu opens at its button: ${c.name}`, async ({ page }) => {
    const viz = await openViz(page, barByService([{ kind: 'referenceLine', id: 'L1', lines: [] }]), c);
    const actions = viz.dimensions.getByRole('button', { name: 'Layer actions for Reference lines' });
    await actions.scrollIntoViewIfNeeded();
    const box = (await actions.boundingBox())!;
    await actions.click();
    const menu = page.getByRole('menu', { name: 'Reference lines layer actions' });
    await expect(menu).toBeVisible();
    await expectAnchored(page, box, menu);
    await expect(menu.getByRole('menuitem', { name: 'Clear layer' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
  });

  test(`chart type list stays inside the window: ${c.name}`, async ({ page }) => {
    await openViz(page, barByService(), c);
    await page.getByRole('button', { name: /^Chart type:/ }).click();
    const list = page.getByRole('listbox', { name: 'Visualizations' });
    await expect(list).toBeVisible();
    const vp = page.viewportSize()!;
    const boxes = [await list.boundingBox(), await page.getByRole('combobox', { name: 'Search visualizations' }).boundingBox()];
    for (const box of boxes) {
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(vp.height);
    }
  });
}

test('legend actions menu closes on a click outside', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: lineByService });
  await viz.chart.getByRole('button', { name: /^Legend actions for/ }).first().click();
  const menu = page.getByRole('menu', { name: /^Actions for/ });
  await expect(menu).toBeVisible();
  await page.mouse.click(page.viewportSize()!.width / 2, 3);
  await expect(menu).toBeHidden();
});

test('data view picker and saved searches close on Escape', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await page.getByRole('button', { name: /^Data view/ }).click();
  const search = page.getByRole('textbox', { name: 'Search data views' });
  await expect(search).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).toBeHidden();

  await page.getByRole('button', { name: 'Saved searches' }).click();
  const header = page.getByText('Saved searches', { exact: true }).nth(1);
  await expect(header).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(header).toBeHidden();
});
