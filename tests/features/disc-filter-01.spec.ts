import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// DISC-FILTER-01 filter pills (docs/spec/10-discover.md) + integration IT-B (pill mutations
// re-query; a pinned pill follows the user to a page opened without it).

const errorPill = { id: 'e2e-error', field: 'SeverityText', op: '=', value: 'error' };
const { total } = FIXTURE.counts;
const errors = FIXTURE.counts.byLevel.error;

test('disabling a pill re-runs without it but keeps it visible; re-enabling applies it again', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ filters: JSON.stringify([errorPill]) });
  await logs.expectRowCount(errors);
  await logs.pillAction('SeverityText', 'Temporarily disable');
  await logs.expectRowCount(total);
  await expect(logs.pill('SeverityText')).toHaveAccessibleName(/\(disabled\)$/);
  await logs.pillAction('SeverityText', 'Re-enable');
  await logs.expectRowCount(errors);
});

test('excluding a pill negates it; deleting it removes the condition', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ filters: JSON.stringify([errorPill]) });
  await logs.pillAction('SeverityText', 'Exclude results');
  await logs.expectRowCount(total - errors);
  await expect(logs.pill('SeverityText')).toHaveAccessibleName(/SeverityText ≠ error/);
  await logs.filterBar.getByRole('button', { name: /^Remove filter SeverityText/ }).click();
  await logs.expectRowCount(total);
  await expect(logs.filterBar).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('filters')).toBeNull();
});

test('a pinned pill follows the user to a page opened without filters until unpinned', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ filters: JSON.stringify([errorPill]) });
  await logs.pillAction('SeverityText', 'Pin across pages');
  await expect(logs.pill('SeverityText')).toHaveAccessibleName(/\(pinned\)/);

  await logs.open(); // fresh page, no filters in the URL
  await expect(logs.pill('SeverityText')).toHaveAccessibleName(/\(pinned\)/);
  await logs.expectRowCount(errors);

  await logs.pillAction('SeverityText', 'Unpin');
  await logs.open();
  await expect(logs.filterBar).toHaveCount(0);
  await logs.expectRowCount(total);
});

test('deleting a pinned pill unpins it', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ filters: JSON.stringify([errorPill]) });
  await logs.pillAction('SeverityText', 'Pin across pages');
  await logs.filterBar.getByRole('button', { name: /^Remove filter SeverityText/ }).click();
  await logs.open();
  await expect(logs.filterBar).toHaveCount(0);
});
