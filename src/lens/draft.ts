/**
 * Unsaved Lens chart in per-tab session storage (spec LENS-SAVE-01: "unsaved state is kept in the
 * URL and session storage, so refresh does not lose work"). The URL wins; the draft only fills a
 * Visualize page opened without `lens`. The stored value is untrusted like the URL: it goes through
 * `decodeLens` here and `sanitizeLens` on the page.
 */
import { decodeLens, encodeLens, isEmptyLens, LensState } from './state';

export const LENS_DRAFT_KEY = 'clickhouse-observe.lensDraft';

/** `scope` names the source the chart was built on (datasource + table); a draft only restores there. */
export function saveLensDraft(scope: string, s: LensState): void {
  try {
    if (isEmptyLens(s)) {
      window.sessionStorage.removeItem(LENS_DRAFT_KEY);
    } else {
      window.sessionStorage.setItem(LENS_DRAFT_KEY, JSON.stringify({ scope, lens: encodeLens(s) }));
    }
  } catch {
    // Storage unavailable: the URL still carries the chart.
  }
}

export function loadLensDraft(scope: string): LensState | undefined {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(LENS_DRAFT_KEY) ?? 'null');
    if (!stored || stored.scope !== scope || typeof stored.lens !== 'string') {
      return undefined;
    }
    const s = decodeLens(stored.lens);
    return s && !isEmptyLens(s) ? s : undefined;
  } catch {
    return undefined;
  }
}
