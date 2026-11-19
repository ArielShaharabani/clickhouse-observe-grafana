import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import pluginJson from '../../src/plugin.json';
import { VisualizePage } from '../pages/VisualizePage';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// #16b (LENS-AUTO-01 gap): data view picker on Visualize. #16c (LENS-INTERACT-02 gap): labeled
// "Explore in Visualize" on Discover, and Visualize opened from Grafana's side menu (a static link
// with no params) restores the tab's last search context. Spec docs/spec/20-lens.md:10.

/** A personal view on default.eval_otel: Timestamp, Body, SeverityText, ServiceName, TraceId only. */
const EVAL_VIEW = {
  id: 'eval-otel',
  name: 'Eval OTel',
  origin: 'personal',
  createdAt: '2026-01-01T00:00:00Z',
  datasourceUid: 'clickhouse-dev',
  database: 'default',
  logsTable: 'eval_otel',
  isOtel: true,
  sequentialConsistency: false,
  columns: {
    timestamp: 'Timestamp',
    body: 'Body',
    severity: 'SeverityText',
    traceId: 'TraceId',
    serviceName: 'ServiceName',
    spanAttributes: '',
    partitionTimestamp: '-',
  },
};
const seedPersonalView = (v: object) => {
  if (!window.localStorage.getItem('poortuna-clickhouse-observe:data-views')) {
    window.localStorage.setItem('poortuna-clickhouse-observe:data-views', JSON.stringify([v]));
  }
};
const seedPins = (p: object[]) => {
  window.sessionStorage.setItem('clickhouse-observe.pinnedFilters', JSON.stringify(p));
};

const paymentsPill = { id: 'f1', field: 'ServiceName', op: '=', value: 'payments' };
const errorPin = {
  id: 'p1',
  field: 'SeverityText',
  op: '=',
  value: 'error',
  pinned: true,
  pinnedTable: 'default.spec_logs',
};

async function pickView(page: Page, name: string) {
  await page.getByRole('button', { name: /^Data view/ }).click();
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
}
const pill = (page: Page, text: RegExp) => page.getByRole('button', { name: text });
// The active table is in the picker's tooltip; the carried query / filters in the context summary.
const picker = (page: Page) => page.getByRole('button', { name: /^Data view/ });
const expectTable = (page: Page, table: string) =>
  expect(picker(page)).toHaveAttribute('title', `Switch data view (default.${table})`);
const ctxLabel = (page: Page) => page.getByTestId('lens-context');

test('#16b: Visualize has a data view picker; switching keeps query and time, drops fields the view lacks', async ({
  page,
}) => {
  await page.addInitScript(seedPersonalView, EVAL_VIEW);
  const viz = new VisualizePage(page);
  await viz.open({ q: 'SeverityText:error' });
  await expect(page.getByRole('button', { name: /^Data view.*Spec fixture logs/ })).toBeVisible();
  await expectTable(page, 'spec_logs');

  await viz.addField('ServiceName');
  await viz.addField('SeverityNumber');
  await expect(viz.dimensions).toContainText('SeverityNumber');
  await expect(viz.dimensions).toContainText('ServiceName');

  await pickView(page, 'Eval OTel');
  await expectTable(page, 'eval_otel');
  // SeverityNumber is not a column of eval_otel: its dimension is dropped, ServiceName stays.
  await expect(viz.dimensions).not.toContainText('SeverityNumber');
  await expect(viz.dimensions).toContainText('ServiceName');
  const sp = new URL(page.url()).searchParams;
  expect(sp.get('ds')).toBe('eval-otel');
  expect(sp.get('q')).toBe('SeverityText:error');
  expect(sp.get('from')).toBe(String(FIXTURE.from));
  expect(sp.get('to')).toBe(String(FIXTURE.to));
  expect(sp.get('lens')).not.toContain('SeverityNumber');
  // The field list is the new view's.
  await viz.fields.getByRole('textbox', { name: 'Search field names' }).fill('SeverityNumber');
  await expect(viz.fields.getByRole('button', { name: 'Add SeverityNumber to workspace' })).toHaveCount(0);
});

test('#16b: the chart re-queries the new view (counts follow the table)', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('ServiceName');
  const paymentsBar = viz.chart.getByRole('button', { name: /^payments · Count of records: 9\.3K$/ });
  await expect(paymentsBar).toBeVisible();

  // otel_logs has no rows in the fixture week: the same chart has no payments bar there.
  await pickView(page, 'OTel demo logs');
  await expectTable(page, 'otel_logs');
  await expect(viz.dimensions).toContainText('ServiceName');
  await expect(paymentsBar).toHaveCount(0);

  await pickView(page, 'Spec fixture logs');
  await expect(paymentsBar).toBeVisible();
});

test('#16b / D7: on another table plain filters arrive disabled, pinned ones follow their table', async ({ page }) => {
  await page.addInitScript(seedPins, [errorPin]);
  const viz = new VisualizePage(page);
  // No filters in the URL: the stored pin is merged (D7 on Visualize).
  await viz.open();
  await expect(pill(page, /^Filter actions: .*error \(pinned\)$/)).toBeVisible();
  // A link with a plain filter and the pinned one.
  await viz.open({ filters: JSON.stringify([paymentsPill, { ...errorPin, pinnedTable: undefined }]) });
  await expect(pill(page, /^Filter actions: .*payments$/)).toBeVisible();

  await pickView(page, 'OTel demo logs');
  await expect(pill(page, /^Filter actions: .*payments \(disabled\)$/)).toBeVisible();
  await expect(pill(page, /^Filter actions: .*error \(pinned\) \(disabled\)$/)).toBeVisible();

  await pickView(page, 'Spec fixture logs');
  // The pin is enabled again on its own table; the plain filter stays disabled until re-enabled.
  await expect(pill(page, /^Filter actions: .*error \(pinned\)$/)).toBeVisible();
  await expect(pill(page, /^Filter actions: .*payments \(disabled\)$/)).toBeVisible();
});

test('#16b: the URL data view applies on Visualize, and Explore in Discover carries it', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ ds: 'otel-demo' });
  await expectTable(page, 'otel_logs');
  await expect(page.getByRole('button', { name: /^Data view.*OTel demo logs/ })).toBeVisible();
  const href = await page.getByRole('link', { name: 'Explore in Discover' }).getAttribute('href');
  expect(new URLSearchParams(href!.split('?')[1]).get('ds')).toBe('otel-demo');
});

test('#16c / IT-G: Explore in Visualize keeps query, filters, relative time and data view', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ from: 'now-1y', to: 'now', filters: JSON.stringify([paymentsPill]), q: 'SeverityText:error' });
  await logs.expectRowCount(FIXTURE.counts.paymentsErrors);
  const before = new URL(page.url()).searchParams;

  await page.getByRole('link', { name: 'Explore in Visualize' }).click();
  await expect(page).toHaveURL(/\/visualize\?/);
  const viz = new VisualizePage(page);
  // Same chart as the histogram's Edit visualization: Bar over time.
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'bar');
  await expect(viz.group('Horizontal axis')).toContainText('Timestamp');
  const after = new URL(page.url()).searchParams;
  for (const k of ['q', 'filters', 'ds']) {
    expect(after.get(k)).toBe(before.get(k));
  }
  expect([after.get('from'), after.get('to')]).toEqual(['now-1y', 'now']);
});

test('#16c: Visualize from the side menu (no params) restores the tab context', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'ServiceName:payments', ds: 'otel-demo' });
  await expect(page.getByRole('button', { name: /^Data view.*OTel demo logs/ })).toBeVisible();
  const before = new URL(page.url()).searchParams;

  await page.goto(`/a/${pluginJson.id}/visualize`);
  await expectTable(page, 'otel_logs');
  await expect(ctxLabel(page)).toHaveText(/ServiceName:payments/);
  const after = new URL(page.url()).searchParams;
  for (const k of ['q', 'from', 'to', 'ds']) {
    expect(after.get(k)).toBe(before.get(k));
  }
});

test('#16c: a Visualize link with its own context is not overridden by the remembered one', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'ServiceName:payments' });
  await logs.expectRowCount(FIXTURE.counts.payments);
  const viz = new VisualizePage(page);
  await viz.open({ q: 'ServiceName:auth' });
  await expect(ctxLabel(page)).toHaveText(/ServiceName:auth/);
  expect(new URL(page.url()).searchParams.get('q')).toBe('ServiceName:auth');
});
