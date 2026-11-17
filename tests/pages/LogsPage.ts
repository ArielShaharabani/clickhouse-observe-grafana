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

  get searchInput() {
    return this.page.getByRole('textbox').first();
  }

  /** The "N rows (count)" summary under the histogram. */
  get rowCount() {
    return this.page.getByText(/[\d,]+ rows \(count\)/);
  }

  async expectRowCount(n: number) {
    await expect(this.rowCount).toContainText(`${n.toLocaleString('en-US')} rows`);
  }
}
