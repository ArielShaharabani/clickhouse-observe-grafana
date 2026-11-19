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
  /** "3 of 200" (loaded rows), undefined when the open document isn't among them. */
  label?: string;
}

export function docNavTargets(index: number, loaded: number, canLoadMore: boolean): DocNavTargets {
  if (index < 0 || index >= loaded) {
    return { prev: null, next: null, first: null, last: null };
  }
  const lastLoaded = loaded - 1;
  return {
    prev: index > 0 ? index - 1 : null,
    next: index < lastLoaded || canLoadMore ? index + 1 : null,
    first: index > 0 ? 0 : null,
    last: index < lastLoaded ? lastLoaded : null,
    label: `${index + 1} of ${loaded}`,
  };
}

/** Grid page (0-based) that holds row `index`. */
export function pageOfIndex(index: number, pageSize: number): number {
  return pageSize > 0 ? Math.floor(index / pageSize) : 0;
}
