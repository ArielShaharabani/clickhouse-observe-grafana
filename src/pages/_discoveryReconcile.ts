/**
 * PERF-URLQ: a page opened with a search/filters already active (shared link, saved search) runs
 * its list + histogram queries immediately, with whatever field index exists at that moment. When
 * field discovery then finishes, the queries only need to run again if the WHERE clause they would
 * build NOW differs from the SQL that actually ran — i.e. the search/filter names a discovered
 * Map key / JSON path that was unknown at first. A bare config-column filter (SeverityText :
 * error) compiles identically either way, so re-running would only repeat (and cancel) the
 * in-flight request.
 */
export interface ReconcileSql {
  /** SQL of the list query as last issued, or null when it has not run yet: the initial (debounced)
   *  fetch is then still pending and builds its SQL with the discovered index when it fires, so a
   *  re-run would only send the same query twice. */
  prevLogs: string | null;
  /** SQL the list query would build now (with the discovered field index). */
  nextLogs: string;
  prevVolume: string | null;
  nextVolume: string;
}

export function discoveryReconcileTargets(s: ReconcileSql): { logs: boolean; volume: boolean } {
  return {
    logs: s.prevLogs !== null && s.prevLogs !== s.nextLogs,
    volume: s.prevVolume !== null && s.prevVolume !== s.nextVolume,
  };
}
