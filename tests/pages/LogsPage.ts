import type { Page } from '@playwright/test';
import { expect } from '@grafana/plugin-e2e';
import pluginJson from '../../src/plugin.json';
import { FIXTURE } from '../fixture';

/** Page object for the Logs explorer (Discover-equivalent) page. */
export class LogsPage {
  constructor(readonly page: Page) {}

  /** Open the logs page on the deterministic fixture view and time range. */
  async open(params: Record<string, string> = {}) {
    const qs = new URLSearchParams({
      ds: FIXTURE.dataViewId,
      from: String(FIXTURE.from),
      to: String(FIXTURE.to),
      ...params,
    });
    await this.page.goto(`/a/${pluginJson.id}/logs?${qs.toString()}`);
    await expect(this.searchInput).toBeVisible();
  }

  /** The KQL search bar (input, suggestions, search/Update button). */
  get searchBar() {
    return this.page.getByTestId('kql-search-bar');
  }

  get searchInput() {
    return this.searchBar.getByRole('textbox');
  }

  /** The filter pill bar. */
  get filterBar() {
    return this.page.getByTestId('filter-pills');
  }

  /** A pill's body button (opens its action menu), matched by the start of its label. */
  pill(labelStart: string) {
    return this.filterBar.getByRole('button', { name: new RegExp(`^Filter actions: ${labelStart}`) });
  }

  /** Open a pill's menu and pick an action. */
  async pillAction(labelStart: string, action: string | RegExp) {
    await this.pill(labelStart).click();
    await this.page.getByRole('menu', { name: 'Filter actions' }).getByRole('button', { name: action }).click();
  }

  /** The results grid. */
  get grid() {
    return this.page.getByRole('grid');
  }

  /** The "N rows (count)" summary under the histogram. */
  get rowCount() {
    return this.page.getByText(/[\d,]+ rows \(count\)/);
  }

  async expectRowCount(n: number) {
    await expect(this.rowCount).toContainText(`${n.toLocaleString('en-US')} rows`);
  }
}
