import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { VisualizePage } from '../pages/VisualizePage';

// PERF-METADATA: a page load shares its metadata queries (system.columns, distinctJSONPaths, Map-key
// samples) instead of repeating them, and doesn't read the default view's schema when the URL names
// another view. Counts the datasource queries a cold load sends.

/** Collects the SQL of every /api/ds/query request the page sends. */
function collectSql(page: Page): string[] {
  const sqls: string[] = [];
  page.on('request', (req) => {
    if (!req.url().includes('/api/ds/query') || req.method() !== 'POST') {
      return;
    }
    try {
      const body = JSON.parse(req.postData() ?? '{}');
      for (const q of body.queries ?? []) {
        sqls.push(String(q.rawSql ?? ''));
      }
    } catch {
      sqls.push('');
    }
  });
  return sqls;
}

const countOf = (sqls: string[], needle: string) => sqls.filter((s) => s.includes(needle)).length;

// Before: 11-15 queries per load. After: the page's own queries (logs, volume) + one system.columns,
// at most one distinctJSONPaths per JSON column and one bounded sample per Map column. Generous cap.
const MAX_QUERIES_PER_LOAD = 12;

test('Discover load: each metadata query runs once, none is unbounded or a trace probe', async ({ page }) => {
  const sqls = collectSql(page);
  const logs = new LogsPage(page);
  await logs.open();
  await page.waitForLoadState('networkidle');

  expect(countOf(sqls, 'FROM system.columns')).toBe(1);
  expect(countOf(sqls, 'distinctJSONPaths')).toBeLessThanOrEqual(1);
  expect(countOf(sqls, "SELECT '' AS traceID")).toBe(0);
  for (const s of sqls.filter((q) => q.includes('arrayJoin(mapKeys'))) {
    expect(s).toContain('$__fromTime');
  }
  expect(sqls.length).toBeLessThanOrEqual(MAX_QUERIES_PER_LOAD);
});

test('Visualize load: each metadata query runs once', async ({ page }) => {
  const sqls = collectSql(page);
  const viz = new VisualizePage(page);
  await viz.open();
  await page.waitForLoadState('networkidle');

  expect(countOf(sqls, 'FROM system.columns')).toBe(1);
  expect(countOf(sqls, 'distinctJSONPaths')).toBeLessThanOrEqual(1);
  expect(sqls.length).toBeLessThanOrEqual(MAX_QUERIES_PER_LOAD);
});
