/**
 * PERF-URLQ: opening Discover with `q=` / `filters=` ran the list and histogram queries twice (the
 * second run, after field discovery, cancelled the first). A re-run is now only issued when the SQL
 * built with the discovered field index differs from the SQL that already ran.
 */
import { discoveryReconcileTargets } from '../_discoveryReconcile';
import { buildLogsQuery, buildVolumeQuery } from '../../sql/queryBuilder';
import { buildFieldIndex } from '../../sql/fields';
import { FieldModel } from '../../sql/fieldModel';
import { DEFAULT_LOGS_QUERY_STATE, OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

const config: SourceConfig = {
  datasourceUid: 'test',
  database: 'default',
  logsTable: 'otel_logs',
  isOtel: true,
  columns: OTEL_COLUMN_MAPPING,
};

const col = (name: string, type: FieldModel['type'] = 'string'): FieldModel => ({
  id: `col:${name}`,
  name,
  displayName: name,
  sqlExpr: name,
  type,
  source: 'column',
});
const logAttributes: FieldModel = { ...col('LogAttributes', 'map') };
const discovered = buildFieldIndex([col('SeverityText'), col('ServiceName'), logAttributes]);

const pageOf = (search: string, index?: ReturnType<typeof buildFieldIndex>) => {
  const state = { ...DEFAULT_LOGS_QUERY_STATE, search };
  return {
    logs: buildLogsQuery(config, state, { limit: 200, offset: 0 }, { projection: 'grid' }, index),
    volume: buildVolumeQuery(
      config,
      state,
      { interval: { unit: 'HOUR', value: 3 }, breakdown: { kind: 'none' } },
      index
    ),
  };
};

describe('discoveryReconcileTargets', () => {
  it('re-runs nothing when the discovered index compiles the same SQL', () => {
    const before = pageOf('SeverityText : error');
    const after = pageOf('SeverityText : error', discovered);
    expect(after.logs).toBe(before.logs);
    expect(
      discoveryReconcileTargets({
        prevLogs: before.logs,
        nextLogs: after.logs,
        prevVolume: before.volume,
        nextVolume: after.volume,
      })
    ).toEqual({ logs: false, volume: false });
  });

  it('re-runs both when a Map key only resolves once discovery has the column', () => {
    const q = 'LogAttributes.http.method : GET';
    const before = pageOf(q);
    const after = pageOf(q, discovered);
    const t = discoveryReconcileTargets({
      prevLogs: before.logs,
      nextLogs: after.logs,
      prevVolume: before.volume,
      nextVolume: after.volume,
    });
    expect(after.logs).not.toBe(before.logs);
    expect(t).toEqual({ logs: true, volume: true });
  });

  it('leaves a query that has not run yet to its pending fetch (no duplicate request)', () => {
    expect(discoveryReconcileTargets({ prevLogs: null, nextLogs: 'a', prevVolume: null, nextVolume: 'b' })).toEqual({
      logs: false,
      volume: false,
    });
  });
});
