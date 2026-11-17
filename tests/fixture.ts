/**
 * Deterministic data from scripts/clickhouse-init/04_spec_fixture.sql (table default.spec_logs,
 * data view "spec-fixture"). Expected counts are computed by that generator — keep them in sync.
 */
export const FIXTURE = {
  dataViewId: 'spec-fixture',
  from: Date.UTC(2026, 0, 1), // 2026-01-01T00:00:00Z
  to: Date.UTC(2026, 0, 8), // 2026-01-08T00:00:00Z
  incident: { from: Date.UTC(2026, 0, 5, 9), to: Date.UTC(2026, 0, 5, 11) },
  counts: {
    total: 41520,
    byLevel: { info: 28265, warn: 6080, debug: 3984, error: 3191 },
    paymentsErrors: 1575,
  },
} as const;
