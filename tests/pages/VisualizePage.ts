import type { Page } from '@playwright/test';
import { expect } from '@grafana/plugin-e2e';
import pluginJson from '../../src/plugin.json';
import { FIXTURE } from '../fixture';

/** Page object for the Visualize (Lens) page. */
export class VisualizePage {
  constructor(readonly page: Page) {}

  async open(params: Record<string, string> = {}) {
    const qs = new URLSearchParams({
      ds: FIXTURE.dataViewId,
      from: String(FIXTURE.from),
      to: String(FIXTURE.to),
      ...params,
    });
    await this.page.goto(`/a/${pluginJson.id}/visualize?${qs.toString()}`);
    await expect(this.fields.getByRole('textbox', { name: 'Search field names' })).toBeVisible();
  }

  get fields() {
    return this.page.getByRole('region', { name: 'Fields' });
  }

  get chart() {
    return this.page.getByTestId('lens-chart');
  }

  get dimensions() {
    return this.page.getByRole('region', { name: 'Dimensions' });
  }

  group(name: string) {
    return this.dimensions.getByRole('group', { name, exact: true });
  }

  async addField(label: string) {
    await this.fields.getByRole('textbox', { name: 'Search field names' }).fill(label);
    await this.fields.getByRole('button', { name: `Add ${label} to workspace` }).click();
    await this.fields.getByRole('textbox', { name: 'Search field names' }).fill('');
  }

  suggestion(title: string) {
    return this.page.getByRole('button', { name: `Suggestion: ${title}` });
  }
}
