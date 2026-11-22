/**
 * useFieldDiscovery covers three phases: A (system.columns), B (Tuple elements, parsed from A's own
 * type strings) and C (paths inside native JSON columns, one distinctJSONPaths query per column).
 * Phase D publishes the keys of each Map column (an unfiltered sample of the latest rows, capped)
 * as ordinary `source: 'map'` fields; it never blocks the fields already published.
 *
 * Note the module-level caches survive between tests in this file, so each test uses its own
 * logsTable name rather than trying to clear them.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { discoveryKey, useFieldDiscovery } from '../FieldsContext';
import { runQueryRows } from '../../data/runQuery';
import { DEFAULT_SOURCE_CONFIG, OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';
import { TimeRange, dateTime } from '@grafana/data';

jest.mock('../../data/runQuery');

const mockRunQueryRows = runQueryRows as jest.MockedFunction<typeof runQueryRows>;

const config: SourceConfig = {
  ...DEFAULT_SOURCE_CONFIG,
  datasourceUid: 'ds-uid-1',
  database: 'default',
  logsTable: 'otel_logs',
};

const timeRange: TimeRange = {
  from: dateTime('2026-01-01T00:00:00Z'),
  to: dateTime('2026-01-01T01:00:00Z'),
  raw: { from: 'now-1h', to: 'now' },
};

describe('useFieldDiscovery — columns (Phase A)', () => {
  beforeEach(() => {
    mockRunQueryRows.mockReset();
  });

  it('publishes discovered columns from system.columns', async () => {
    mockRunQueryRows.mockImplementation(async ({ sql }) => {
      if (sql.includes('system.columns')) {
        return [
          { name: 'Timestamp', type: 'DateTime64(9)' },
          { name: 'Body', type: 'String' },
          { name: 'LogAttributes', type: 'Map(LowCardinality(String), String)' },
        ];
      }
      return [];
    });

    const { result } = renderHook(() => useFieldDiscovery(config, timeRange));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
    expect(result.current.fields.map((f) => f.name).sort()).toEqual(['Body', 'LogAttributes', 'Timestamp']);
    // No keys came back from the Map sample: a Map column is published only as itself.
    expect(result.current.fields.every((f) => f.source === 'column')).toBe(true);
    // system.columns + the skip-index lookup + one Map key sample.
    expect(mockRunQueryRows).toHaveBeenCalledTimes(3);
  });

  it('publishes Map keys as first-class fields, sorted and capped, and survives a failed sample', async () => {
    mockRunQueryRows.mockImplementation(async ({ sql }) => {
      if (sql.includes('system.columns')) {
        return [
          { name: 'Body', type: 'String' },
          { name: 'ResourceAttributes', type: 'Map(LowCardinality(String), String)' },
          { name: 'LogAttributes', type: 'Map(LowCardinality(String), String)' },
        ];
      }
      if (sql.includes('mapKeys') && sql.includes('ResourceAttributes')) {
        const keys = ['service.name', 'host.name', ...Array.from({ length: 150 }, (_, i) => `k${String(i).padStart(3, '0')}`)];
        return keys.map((k) => ({ k, total: 500 }));
      }
      throw new Error('boom');
    });
    const keyCfg = { ...config, logsTable: 'otel_logs_mapkeys' };
    const { result } = renderHook(() => useFieldDiscovery(keyCfg, timeRange));
    await waitFor(() => expect(result.current.fields.some((f) => f.source === 'map')).toBe(true));
    const mapFields = result.current.fields.filter((f) => f.source === 'map');
    expect(mapFields).toHaveLength(100);
    expect(mapFields[0].displayName).toBe('ResourceAttributes.host.name');
    expect(mapFields[0].sqlExpr).toBe("ResourceAttributes['host.name']");
    expect(mapFields.every((f) => f.mapColumn === 'ResourceAttributes')).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('surfaces a system.columns failure as `error`, with no fields published', async () => {
    mockRunQueryRows.mockImplementation(async ({ sql }) => {
      if (sql.includes('system.columns')) {
        throw new Error('Timeout exceeded: max_execution_time = 25');
      }
      return [];
    });

    const { result } = renderHook(() => useFieldDiscovery({ ...config, logsTable: 'failing_table' }, timeRange));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toMatch(/Timeout exceeded/);
    expect(result.current.fields).toHaveLength(0);
  });

  it('leaves error null when discovery succeeds', async () => {
    mockRunQueryRows.mockImplementation(async ({ sql }) => {
      if (sql.includes('system.columns')) {
        return [{ name: 'Body', type: 'String' }];
      }
      return [];
    });

    const { result } = renderHook(() => useFieldDiscovery({ ...config, logsTable: 'plain_logs' }, timeRange));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toBeNull();
  });
});

// ── JSON paths (Phase C) — one distinctJSONPaths query per JSON column, published as fields ──
describe('useFieldDiscovery — JSON paths', () => {
  beforeEach(() => {
    mockRunQueryRows.mockReset();
  });

  function mockSchema(columns: Array<{ name: string; type: string }>, paths: Record<string, string[]>) {
    mockRunQueryRows.mockImplementation(async ({ sql }) => {
      if (sql.includes('system.columns')) {
        return columns;
      }
      const col = Object.keys(paths).find((c) => sql.includes(`distinctJSONPaths(${c})`));
      if (col) {
        return [{ paths: JSON.stringify(paths[col]) }];
      }
      return [];
    });
  }

  it('publishes each discovered path as a first-class field, typed from the declared JSON(...) paths', async () => {
    mockSchema(
      [
        { name: 'Body', type: 'String' },
        { name: 'Payload', type: 'JSON(user.id UInt32, max_dynamic_paths=8)' },
      ],
      { Payload: ['user.id', 'user.name'] }
    );

    const { result } = renderHook(() => useFieldDiscovery({ ...config, logsTable: 'json_table' }, timeRange));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const jsonFields = result.current.fields.filter((f) => f.source === 'json');
    expect(jsonFields).toEqual([
      expect.objectContaining({
        id: 'json:Payload:user.id',
        name: 'user.id',
        displayName: 'Payload.user.id',
        sqlExpr: 'Payload.user.id',
        type: 'number',
        jsonColumn: 'Payload',
        jsonPath: 'user.id',
      }),
      // Dynamic path: no declared type, so it falls back to 'string'.
      expect.objectContaining({ id: 'json:Payload:user.name', type: 'string' }),
    ]);
    // The container column stays in `fields` — LogDetailDrawer derives its JSON-column list from it.
    expect(result.current.fields.some((f) => f.source === 'column' && f.type === 'json')).toBe(true);
  });

  it('quotes a path segment that is not a bare identifier', async () => {
    mockSchema([{ name: 'Payload', type: 'JSON' }], { Payload: ['user-id'] });

    const { result } = renderHook(() => useFieldDiscovery({ ...config, logsTable: 'json_escape_table' }, timeRange));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.fields.find((f) => f.source === 'json')!.sqlExpr).toBe('Payload."user-id"');
  });

  it('reports a failing column but still publishes every other field', async () => {
    mockRunQueryRows.mockImplementation(async ({ sql }) => {
      if (sql.includes('system.columns')) {
        return [
          { name: 'Body', type: 'String' },
          { name: 'Payload', type: 'JSON' },
        ];
      }
      throw new Error('Timeout exceeded: max_execution_time = 25');
    });

    const { result } = renderHook(() => useFieldDiscovery({ ...config, logsTable: 'json_fail_table' }, timeRange));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.error).toMatch(/Payload/);
    expect(result.current.fields.map((f) => f.name)).toEqual(['Body', 'Payload']);
  });

  it('does not re-query paths when the time range changes (the query is time-independent)', async () => {
    mockSchema([{ name: 'Payload', type: 'JSON' }], { Payload: ['a'] });

    const { result, rerender } = renderHook(
      ({ tr }: { tr: TimeRange }) => useFieldDiscovery({ ...config, logsTable: 'json_cache_table' }, tr),
      { initialProps: { tr: timeRange } }
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    const callsAfterFirstLoad = mockRunQueryRows.mock.calls.length;

    rerender({
      tr: {
        from: dateTime('2026-02-02T00:00:00Z'),
        to: dateTime('2026-02-02T06:00:00Z'),
        raw: { from: 'now-6h', to: 'now' },
      },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(mockRunQueryRows.mock.calls.filter((c) => c[0].sql.includes('distinctJSONPaths'))).toHaveLength(1);
    expect(mockRunQueryRows.mock.calls.length).toBe(callsAfterFirstLoad);
  });
});

// ── Tuple elements (Phase B) — synchronous parse from system.columns' own type string, no scan ──
describe('useFieldDiscovery — tuple elements still derived synchronously', () => {
  beforeEach(() => {
    mockRunQueryRows.mockReset();
  });

  it('flattens a Tuple-typed column into per-element fields without an extra query', async () => {
    mockRunQueryRows.mockImplementation(async ({ sql }) => {
      if (sql.includes('system.columns')) {
        return [{ name: 'MyTuple', type: 'Tuple(a String, b Int64)' }];
      }
      return [];
    });

    const { result } = renderHook(() => useFieldDiscovery({ ...config, logsTable: 'tuple_table' }, timeRange));

    await waitFor(() => expect(result.current.loading).toBe(false));

    const tupleFields = result.current.fields.filter((f) => f.source === 'tuple');
    expect(tupleFields.map((f) => f.name).sort()).toEqual(['a', 'b']);
    // Only system.columns and the skip-index lookup fired — no per-tuple scan.
    expect(mockRunQueryRows).toHaveBeenCalledTimes(2);
  });
});

// ── Coarse index-pruning column auto-detection (perf plan item 0) ────────────────────────────
describe('useFieldDiscovery — detectedPartitionTimestamp', () => {
  beforeEach(() => {
    mockRunQueryRows.mockReset();
  });

  it('detects a toDate(...) partition-key column derived from the mapped timestamp', async () => {
    mockRunQueryRows.mockImplementation(async ({ sql }) => {
      if (sql.includes('system.columns')) {
        return [
          {
            name: 'Timestamp',
            type: 'DateTime64(9)',
            default_kind: '',
            default_expression: '',
            is_in_partition_key: 0,
            is_in_primary_key: 0,
            position: 1,
          },
          {
            name: 'TimestampTime',
            type: 'DateTime',
            default_kind: 'DEFAULT',
            default_expression: 'toDate(Timestamp)',
            is_in_partition_key: 1,
            is_in_primary_key: 1,
            position: 2,
          },
        ];
      }
      return [];
    });

    const { result } = renderHook(() =>
      useFieldDiscovery({ ...config, logsTable: 'prune_detect_table', columns: OTEL_COLUMN_MAPPING }, timeRange)
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.detectedPartitionTimestamp).toBe('TimestampTime');
  });

  it('detects nothing when no column qualifies (e.g. the mapped timestamp is itself the sort key)', async () => {
    mockRunQueryRows.mockImplementation(async ({ sql }) => {
      if (sql.includes('system.columns')) {
        return [
          {
            name: 'Timestamp',
            type: 'DateTime64(9)',
            default_kind: '',
            default_expression: '',
            is_in_partition_key: 0,
            is_in_primary_key: 1,
            position: 1,
          },
        ];
      }
      return [];
    });

    const { result } = renderHook(() =>
      useFieldDiscovery({ ...config, logsTable: 'no_prune_table', columns: OTEL_COLUMN_MAPPING }, timeRange)
    );

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.detectedPartitionTimestamp).toBe('');
  });
});

describe('useFieldDiscovery — fieldsFor (#16b view switch)', () => {
  beforeEach(() => {
    mockRunQueryRows.mockReset();
  });

  it('names the table the published fields belong to, and keeps the old name until the new table publishes', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    mockRunQueryRows.mockImplementation(async ({ sql }) => {
      if (sql.includes("'switch_b'")) {
        await gate;
        return [{ name: 'other_col', type: 'String' }];
      }
      return [{ name: 'Body', type: 'String' }];
    });
    const a = { ...config, logsTable: 'switch_a' };
    const b = { ...config, logsTable: 'switch_b' };
    const { result, rerender } = renderHook(({ c }: { c: SourceConfig }) => useFieldDiscovery(c, timeRange), {
      initialProps: { c: a },
    });
    expect(result.current.fieldsFor).toBe('');
    await waitFor(() => expect(result.current.fieldsFor).toBe(discoveryKey(a)));

    rerender({ c: b });
    // Still table A's fields: a consumer comparing fieldsFor with discoveryKey(b) waits.
    expect(result.current.fields.map((f) => f.name)).toEqual(['Body']);
    expect(result.current.fieldsFor).toBe(discoveryKey(a));
    expect(result.current.fieldsFor).not.toBe(discoveryKey(b));

    release();
    await waitFor(() => expect(result.current.fieldsFor).toBe(discoveryKey(b)));
    expect(result.current.fields.map((f) => f.name)).toEqual(['other_col']);
  });

  it('discoveryKey separates datasource, database and table', () => {
    const keys = new Set([
      discoveryKey(config),
      discoveryKey({ ...config, datasourceUid: 'other' }),
      discoveryKey({ ...config, database: 'other' }),
      discoveryKey({ ...config, logsTable: 'other' }),
    ]);
    expect(keys.size).toBe(4);
    expect(discoveryKey(config, 'x')).toBe(discoveryKey({ ...config, logsTable: 'x' }));
  });
});

describe('useFieldDiscovery — unmount (R5-TABS)', () => {
  beforeEach(() => {
    mockRunQueryRows.mockReset();
  });

  it('starts no Map-key samples once the page is gone (a Discover tab switch)', async () => {
    let answerColumns: (rows: Array<Record<string, unknown>>) => void = () => undefined;
    mockRunQueryRows.mockImplementation(({ sql }) => {
      if (sql.includes('system.columns')) {
        return new Promise((resolve) => (answerColumns = resolve));
      }
      return Promise.resolve([]);
    });
    const cfg = { ...config, logsTable: 'otel_logs_unmount' };
    const { unmount } = renderHook(() => useFieldDiscovery(cfg, timeRange));
    await waitFor(() => expect(mockRunQueryRows.mock.calls.some(([o]) => o.sql.includes('system.columns'))).toBe(true));
    unmount();
    answerColumns([
      { name: 'Body', type: 'String' },
      { name: 'LogAttributes', type: 'Map(LowCardinality(String), String)' },
    ]);
    await new Promise((r) => setTimeout(r, 0));
    expect(mockRunQueryRows.mock.calls.some(([o]) => o.sql.includes('mapKeys'))).toBe(false);
  });
});
