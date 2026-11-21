/**
 * PERF-METADATA: a page bootstrap issues each metadata query once per table, even when several
 * consumers (App's columns-only discovery and the page's own discovery) start at the same time,
 * and the Map-key samples are time-bounded.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { TimeRange, dateTime } from '@grafana/data';
import { useFieldDiscovery } from '../FieldsContext';
import { runQueryRows } from '../../data/runQuery';
import { __resetKeysCacheForTests } from '../../sql/keys';
import { __resetMetadataCacheForTests, invalidateMetadata, loadMetadata } from '../../sql/metadataCache';
import { buildDiscoveryWindowConditions, buildDiscoveryWindows, buildMapKeysQuery } from '../../sql/introspection';
import { DEFAULT_SOURCE_CONFIG, OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

jest.mock('../../data/runQuery');
const mockRunQueryRows = runQueryRows as jest.MockedFunction<typeof runQueryRows>;

const config: SourceConfig = {
  ...DEFAULT_SOURCE_CONFIG,
  datasourceUid: 'ds-perf',
  database: 'default',
  logsTable: 'perf_logs_50m',
  columns: { ...OTEL_COLUMN_MAPPING, timestamp: 'Timestamp' },
};

const timeRange: TimeRange = {
  from: dateTime('2026-01-01T00:00:00Z'),
  to: dateTime('2026-01-01T01:00:00Z'),
  raw: { from: 'now-1h', to: 'now' },
};

function installSchema() {
  mockRunQueryRows.mockImplementation(async ({ sql }) => {
    if (sql.includes('system.columns')) {
      return [
        { name: 'Timestamp', type: 'DateTime64(9)' },
        { name: 'Body', type: 'String' },
        { name: 'Payload', type: 'JSON' },
        { name: 'LogAttributes', type: 'Map(LowCardinality(String), String)' },
        { name: 'ResourceAttributes', type: 'Map(LowCardinality(String), String)' },
        { name: 'ScopeAttributes', type: 'Map(LowCardinality(String), String)' },
      ];
    }
    if (sql.includes('distinctJSONPaths')) {
      return [{ paths: JSON.stringify(['a.b']) }];
    }
    if (sql.includes('mapKeys')) {
      return [{ k: 'host', total: 10 }];
    }
    return [];
  });
}

const count = (needle: string) => mockRunQueryRows.mock.calls.filter(([a]) => a.sql.includes(needle)).length;

describe('page bootstrap query counts', () => {
  beforeEach(() => {
    mockRunQueryRows.mockReset();
    __resetMetadataCacheForTests();
    __resetKeysCacheForTests();
  });

  it('runs system.columns, distinctJSONPaths and each map-key sample exactly once for two concurrent consumers', async () => {
    installSchema();
    // App.tsx's bootstrap (columns only) and the page's own discovery, mounted together.
    const app = renderHook(() => useFieldDiscovery(config, timeRange, { columnsOnly: true }));
    const page = renderHook(() => useFieldDiscovery(config, timeRange));
    await waitFor(() => expect(page.result.current.fields.some((f) => f.source === 'map')).toBe(true));
    await waitFor(() => expect(app.result.current.loading).toBe(false));

    expect(count('system.columns')).toBe(1);
    expect(count('distinctJSONPaths')).toBe(1);
    expect(count('mapKeys')).toBe(3); // one per map column
    expect(count('data_skipping_indices')).toBe(1); // text-index lookup (PERF-SEARCH), page only
    expect(mockRunQueryRows).toHaveBeenCalledTimes(6);
  });

  it('two full discoveries of the same table still share every query', async () => {
    installSchema();
    const a = renderHook(() => useFieldDiscovery(config, timeRange));
    const b = renderHook(() => useFieldDiscovery(config, timeRange));
    await waitFor(() => expect(a.result.current.fields.some((f) => f.source === 'map')).toBe(true));
    await waitFor(() => expect(b.result.current.fields.some((f) => f.source === 'map')).toBe(true));
    expect(count('system.columns')).toBe(1);
    expect(count('distinctJSONPaths')).toBe(1);
    expect(count('mapKeys')).toBe(3);
  });

  it('looks up text indexes alongside the columns, not after them (round 3 #8)', async () => {
    let releaseColumns: () => void = () => {};
    const columnsGate = new Promise<void>((r) => (releaseColumns = r));
    installSchema();
    const base = mockRunQueryRows.getMockImplementation()!;
    mockRunQueryRows.mockImplementation(async (a) => {
      if (a.sql.includes('system.columns')) {
        await columnsGate;
      }
      return base(a);
    });
    const other = { ...config, logsTable: 'perf_logs_10m' };
    const { result } = renderHook(() => useFieldDiscovery(other, timeRange));
    // Both metadata reads are in flight before the columns answer.
    await waitFor(() => expect(count('data_skipping_indices')).toBe(1));
    expect(count('system.columns')).toBe(1);
    releaseColumns();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(count('data_skipping_indices')).toBe(1);
  });

  it('Visualize skips the text-index lookup (its queries do not use it)', async () => {
    installSchema();
    const other = { ...config, logsTable: 'perf_logs_1m' };
    const { result } = renderHook(() => useFieldDiscovery(other, timeRange, { textIndexes: false }));
    await waitFor(() => expect(result.current.fields.some((f) => f.source === 'map')).toBe(true));
    expect(count('data_skipping_indices')).toBe(0);
    expect(count('system.columns')).toBe(1);
  });

  it('refresh() invalidates the metadata so the next load re-queries', async () => {
    installSchema();
    const { result } = renderHook(() => useFieldDiscovery(config, timeRange));
    await waitFor(() => expect(result.current.fields.some((f) => f.source === 'map')).toBe(true));
    result.current.refresh();
    await waitFor(() => expect(count('system.columns')).toBe(2));
  });
});

describe('metadata cache', () => {
  beforeEach(() => __resetMetadataCacheForTests());
  const key = { datasourceUid: 'u', database: 'd', table: 't', kind: 'columns' as const };

  it('shares an in-flight request and does not cache a rejection', async () => {
    const fetch = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValue(1);
    const p1 = loadMetadata(key, fetch);
    const p2 = loadMetadata(key, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(p1).rejects.toThrow('x');
    await expect(p2).rejects.toThrow('x');
    await expect(loadMetadata(key, fetch)).resolves.toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keys by table: another table is a separate entry, invalidate drops only its table', async () => {
    const fetch = jest.fn().mockResolvedValue(1);
    await loadMetadata(key, fetch);
    await loadMetadata({ ...key, table: 'other' }, fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    invalidateMetadata('u', 'd', 't');
    await loadMetadata(key, fetch);
    await loadMetadata({ ...key, table: 'other' }, fetch);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

describe('time-bounded map-key samples', () => {
  it('the discovery window is the current range plus a LIMIT, never a bare table read', () => {
    const conds = buildDiscoveryWindowConditions(config);
    expect(conds.join(' ')).toContain('$__fromTime');
    expect(conds.join(' ')).toContain('$__toTime');
    const sql = buildMapKeysQuery(config, 'LogAttributes', { table: 'perf_logs_50m', conditions: conds });
    expect(sql).toMatch(/WHERE .*\$__fromTime/);
    expect(sql).toContain('LIMIT 500');
    expect(sql).toContain('max_execution_time');
  });

  it('the sparse-key fallback is a wider but still bounded window', () => {
    const wide = buildDiscoveryWindowConditions(config, 'wide').join(' ');
    expect(wide).toContain('$__toTime - INTERVAL 7 DAY');
  });

  it('the recent window is the last hour of the range with a day-padded partition bound', () => {
    const recent = buildDiscoveryWindowConditions(config, 'recent').join(' ');
    expect(recent).toContain('$__toTime - INTERVAL 1 HOUR');
    expect(recent).not.toContain('$__fromTime');
    expect(recent).toContain('$__toTime - INTERVAL 25 HOUR');
  });

  it('windows run recent -> range -> wide, skipping the ones the range already covers', () => {
    const day = 86_400_000;
    expect(buildDiscoveryWindows(config, 15 * 60_000)).toHaveLength(2); // range, wide
    expect(buildDiscoveryWindows(config, 2 * 3_600_000)).toHaveLength(3); // recent, range, wide
    const long = buildDiscoveryWindows(config, 7 * day); // recent, range
    expect(long).toHaveLength(2);
    expect(long[0].join(' ')).toContain('INTERVAL 1 HOUR');
    expect(long[1].join(' ')).toContain('$__fromTime');
  });

  it('a full sample with no keys (an empty column) is not retried wider', async () => {
    mockRunQueryRows.mockReset();
    __resetMetadataCacheForTests();
    __resetKeysCacheForTests();
    mockRunQueryRows.mockImplementation(async ({ sql }) => {
      if (sql.includes('system.columns')) {
        return [
          { name: 'Timestamp', type: 'DateTime64(9)' },
          { name: 'ScopeAttributes', type: 'Map(LowCardinality(String), String)' },
        ];
      }
      return [{ k: '', total: 500 }];
    });
    const cfg = { ...config, logsTable: 'empty_map_tbl' };
    renderHook(() => useFieldDiscovery(cfg, timeRange));
    await waitFor(() => expect(mockRunQueryRows.mock.calls.some(([a]) => a.sql.includes('mapKeys'))).toBe(true));
    await new Promise((r) => setTimeout(r, 50));
    const samples = mockRunQueryRows.mock.calls.map(([a]) => a.sql).filter((q) => q.includes('mapKeys'));
    expect(samples).toHaveLength(1);
  });

  it('the field-list sample sends the window, and retries wider only when it finds nothing', async () => {
    mockRunQueryRows.mockReset();
    __resetMetadataCacheForTests();
    __resetKeysCacheForTests();
    mockRunQueryRows.mockImplementation(async ({ sql }) => {
      if (sql.includes('system.columns')) {
        return [
          { name: 'Timestamp', type: 'DateTime64(9)' },
          { name: 'LogAttributes', type: 'Map(LowCardinality(String), String)' },
        ];
      }
      // Empty in the narrow window, keys only in the 7-day window.
      return sql.includes('INTERVAL 7 DAY') ? [{ k: 'rare', total: 5 }] : [];
    });
    const cfg = { ...config, logsTable: 'sparse_tbl' };
    const { result } = renderHook(() => useFieldDiscovery(cfg, timeRange));
    await waitFor(() => expect(result.current.fields.some((f) => f.source === 'map')).toBe(true));
    const samples = mockRunQueryRows.mock.calls.map(([a]) => a.sql).filter((s) => s.includes('mapKeys'));
    expect(samples).toHaveLength(2);
    expect(samples[0]).toContain('$__fromTime');
    expect(samples[0]).not.toContain('INTERVAL 7 DAY');
    expect(samples[1]).toContain('INTERVAL 7 DAY');
  });
});
