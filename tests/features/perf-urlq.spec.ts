import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { VisualizePage } from '../pages/VisualizePage';

// PERF-URLQ: a page opened with a query (`q=`) or `filters=` in the URL runs its list and histogram
// queries once, not again after field discovery. The list query is a newest-first windowed search
// (it may widen the window), so "once" means no (from, to) window is requested twice.

interface Sent {
  kind: 'list' | 'volume' | 'lens' | 'other';
  window: string;
}

/** Collects every /api/ds/query request the page sends: what it is and the time window it asked for. */
function collectQueries(page: Page): Sent[] {
  const sent: Sent[] = [];
  page.on('request', (req) => {
    if (!req.url().includes('/api/ds/query') || req.method() !== 'POST') {
      return;
    }
    try {
      const body = JSON.parse(req.postData() ?? '{}');
      for (const q of body.queries ?? []) {
        const sql = String(q.rawSql ?? '');
        const kind = sql.includes('AS __timestamp')
          ? 'list'
          : sql.includes('GROUP BY time')
            ? 'volume'
            : q.refId === 'lens' || sql.includes('WITH top0')
              ? 'lens'
              : 'other';
        sent.push({ kind, window: `${body.from}-${body.to}` });
      }
    } catch {
      sent.push({ kind: 'other', window: '' });
    }
  });
  return sent;
}

const windowsOf = (sent: Sent[], kind: Sent['kind']) => sent.filter((s) => s.kind === kind).map((s) => s.window);

function expectNoRepeatedWindow(windows: string[]) {
  expect(windows.length).toBeGreaterThan(0);
  expect(new Set(windows).size).toBe(windows.length);
}

test('Discover with q= runs the list and the histogram once each', async ({ page }) => {
  const sent = collectQueries(page);
  const logs = new LogsPage(page);
  await logs.open({ q: 'SeverityText : error' });
  await expect(logs.grid).toBeVisible();
  await page.waitForLoadState('networkidle');

  expectNoRepeatedWindow(windowsOf(sent, 'list'));
  expect(windowsOf(sent, 'volume')).toHaveLength(1);
});

test('Discover with filters= runs the list and the histogram once each', async ({ page }) => {
  const sent = collectQueries(page);
  const logs = new LogsPage(page);
  const filters = [{ id: 'f1', field: 'SeverityText', operator: 'is', value: 'error' }];
  await logs.open({ filters: JSON.stringify(filters) });
  await expect(logs.grid).toBeVisible();
  await page.waitForLoadState('networkidle');

  expectNoRepeatedWindow(windowsOf(sent, 'list'));
  expect(windowsOf(sent, 'volume')).toHaveLength(1);
});

test('Visualize with q= and a lens runs the chart query once', async ({ page }) => {
  const sent = collectQueries(page);
  const viz = new VisualizePage(page);
  const lens = {
    chartType: 'table',
    buckets: [{ kind: 'terms', id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 9 }],
    metrics: [{ kind: 'metric', id: 'm0', op: 'count' }],
  };
  await viz.open({ q: 'SeverityText : error', lens: JSON.stringify(lens) });
  await page.waitForLoadState('networkidle');

  expect(windowsOf(sent, 'lens')).toHaveLength(1);
});
