/**
 * Document panel navigation (DISC-DOC-01, PARITY-GRID): which document each control opens.
 * Navigation covers every loaded row of the result (not just the grid page); with more rows to
 * fetch, "next" past the last loaded row is still offered and the caller loads the next chunk.
 */
export interface DocNavTargets {
  prev: number | null;
  next: number | null;
  first: number | null;
  last: number | null;
  /** "3 of 1,207" (the total when known, else the loaded rows), undefined when the open document isn't among them. */
  label?: string;
}

export function docNavTargets(
  index: number,
  loaded: number,
  canLoadMore: boolean,
  total?: number
): DocNavTargets {
  if (index < 0 || index >= loaded) {
    return { prev: null, next: null, first: null, last: null };
  }
  const lastLoaded = loaded - 1;
  return {
    prev: index > 0 ? index - 1 : null,
    next: index < lastLoaded || canLoadMore ? index + 1 : null,
    first: index > 0 ? 0 : null,
    last: index < lastLoaded ? lastLoaded : null,
    label: `${(index + 1).toLocaleString()} of ${(total !== undefined && total >= loaded ? total : loaded).toLocaleString()}`,
  };
}

/**
 * Total number of matching documents, taken from the histogram's count (no extra query), or
 * undefined when it is not trustworthy: raw SQL / no time field (no histogram), histogram still
 * loading or empty, or a count below the rows already loaded (a stale histogram).
 */
export function knownTotal(opts: {
  hasHistogram: boolean;
  rawSql: boolean;
  volLoading: boolean;
  histogramCount: number;
  loaded: number;
}): number | undefined {
  const { hasHistogram, rawSql, volLoading, histogramCount, loaded } = opts;
  if (!hasHistogram || rawSql || volLoading || histogramCount <= 0 || histogramCount < loaded) {
    return undefined;
  }
  return histogramCount;
}

/** Rows fetched per load-more when the user pages past the loaded rows. */
export const LOAD_MORE_CHUNK = 200;
/** "Load all" is offered when the matching documents number at most this many. */
export const LOAD_ALL_MAX = 5000;

/** Grid page (0-based) that holds row `index`. */
export function pageOfIndex(index: number, pageSize: number): number {
  return pageSize > 0 ? Math.floor(index / pageSize) : 0;
}
