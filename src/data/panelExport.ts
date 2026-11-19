/**
 * Build Grafana dashboard-panel JSON from the Logs Explorer's current query state.
 * Pure functions, no React — the current filters/search/columns/sort are already baked into
 * the generated SQL (buildLogsQuery / buildVolumeQuery), and the SQL uses $__fromTime/$__toTime
 * (+ $__timeInterval for the histogram bucket width), so exported panels stay time-picker-aware
 * on the destination dashboard instead of freezing the range/interval at export time.
 */
import { TimeRange } from '@grafana/data';
import { LogsQueryState, SelectedColumn, SourceConfig } from '../types';
import { buildLogsQuery, buildVolumeQuery, CORE_ALIAS, VolumeBreakdown } from '../sql/queryBuilder';
import { FieldIndex } from '../sql/fields';
import { DISCOVER_SOURCE_KEY } from './discoverSource';

export const CH_DATASOURCE_TYPE = 'grafana-clickhouse-datasource';

export interface DataSourceRef {
  type: string;
  uid: string;
}

export interface GridPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ExportedPanel {
  id: number;
  type: string;
  title: string;
  gridPos: GridPos;
  datasource: DataSourceRef;
  targets: Array<{
    refId: string;
    datasource: DataSourceRef;
    editorType: 'sql';
    format: number;
    rawSql: string;
    /** Visualize state of a panel added from Visualize ("Edit in Visualize", lens/panelSource.ts). */
    observeVisualize?: string;
    /** Discover search of a logs panel added from Discover ("Open in Discover", data/discoverSource.ts). */
    observeDiscover?: string;
  }>;
  transformations?: Array<{ id: string; options: Record<string, unknown> }>;
  options?: Record<string, unknown>;
  fieldConfig?: { defaults: Record<string, unknown>; overrides: unknown[] };
}

// The ClickHouse datasource's query-editor Format enum — Table=1 is confirmed in src/data/runQuery.ts.
// Both exported panels use Table + client-side (transformation) shaping rather than guessing at
// an unverified TimeSeries enum value, so this stays correct regardless of the installed CH
// datasource version.
/** ClickHouse datasource query format "Table". */
export const FORMAT_TABLE = 1;

export function chDatasourceRef(datasourceUid: string): DataSourceRef {
  return { type: CH_DATASOURCE_TYPE, uid: datasourceUid };
}

export interface PanelExportOpts {
  id: number;
  title?: string;
  gridPos: GridPos;
  /** `discoverSourceOf(...)`: lets the dashboard panel menu reopen the search in Discover. */
  source?: string;
}

/**
 * `$` inside string literals and quoted identifiers → `\x24` (the same escape Lens panels use).
 * Grafana interpolates `$name` / `${name}` template variables in a panel's SQL before the
 * ClickHouse datasource expands its own `$__` macros, so a searched value like `$__toTime` or
 * `${var}` would otherwise be rewritten on the dashboard. Text outside quotes (our macros) is kept.
 */
export function escapeDollarInLiterals(sql: string): string {
  let out = '';
  let quote: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      if (ch === '\\' && i + 1 < sql.length) {
        out += sql[i + 1] === '$' ? '\\x24' : ch + sql[i + 1];
        i++;
        continue;
      }
      if (ch === quote) {
        if (sql[i + 1] === quote) {
          out += ch + ch;
          i++;
          continue;
        }
        quote = null;
      }
      out += ch === '$' ? '\\x24' : ch;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    }
    out += ch;
  }
  return out;
}

/** Fixed widths for the narrow core columns, so the message gets the rest of the panel. */
const CORE_WIDTHS: Record<string, number> = {
  [CORE_ALIAS.timestamp]: 190,
  [CORE_ALIAS.severity]: 90,
  [CORE_ALIAS.serviceName]: 140,
  [CORE_ALIAS.traceId]: 260,
};

/**
 * Discover's grid as a dashboard table: the grid projection (core values under their `__` aliases,
 * user columns under their keys), then one `organize` step that keeps exactly Discover's columns,
 * in Discover's order, under the names Discover shows (Time, Level, Service, Message, …).
 */
function columnLayout(columns: SelectedColumn[]): {
  organize: { id: string; options: Record<string, unknown> };
  overrides: unknown[];
} {
  const indexByName: Record<string, number> = {};
  const renameByName: Record<string, string> = {};
  columns.forEach((c, i) => {
    indexByName[c.key] = i;
    renameByName[c.key] = c.displayName;
  });
  // The grid projection always selects every mapped core value; hide the ones Discover doesn't show.
  const excludeByName: Record<string, boolean> = {};
  for (const alias of Object.values(CORE_ALIAS)) {
    if (!(alias in indexByName)) {
      excludeByName[alias] = true;
    }
  }
  const overrides = columns
    .filter((c) => CORE_WIDTHS[c.key] !== undefined)
    .map((c) => ({
      matcher: { id: 'byName', options: c.displayName },
      properties: [{ id: 'custom.width', value: CORE_WIDTHS[c.key] }],
    }));
  return { organize: { id: 'organize', options: { indexByName, renameByName, excludeByName } }, overrides };
}

/**
 * Build a "table" panel showing Discover's documents: Discover's columns in Discover's order with
 * readable names, the message wrapping in the remaining width, a row count in the footer, and the
 * search stored on the target for "Open in Discover". A table rather than Grafana's `logs` panel:
 * the logs panel shows one line of text per row with every other field hidden behind a details
 * toggle, so it can't show the columns the user chose in Discover side by side.
 */
export function buildTablePanel(
  config: SourceConfig,
  state: LogsQueryState,
  opts: PanelExportOpts,
  index?: FieldIndex
): ExportedPanel {
  const datasource = chDatasourceRef(config.datasourceUid);
  // Grid projection only when there are columns to lay out (raw SQL mode keeps the user's SQL).
  const grid = state.columns.length > 0 && !state.useRawSql;
  const rawSql = escapeDollarInLiterals(
    buildLogsQuery(config, state, undefined, grid ? { projection: 'grid' } : undefined, index)
  );
  const layout = grid ? columnLayout(state.columns) : undefined;
  const message = grid ? state.columns.find((c) => c.key === CORE_ALIAS.body) : undefined;
  return {
    id: opts.id,
    type: 'table',
    title: opts.title?.trim() || 'Logs',
    gridPos: opts.gridPos,
    datasource,
    targets: [
      {
        refId: 'A',
        datasource,
        editorType: 'sql',
        format: FORMAT_TABLE,
        rawSql,
        ...(opts.source !== undefined ? { [DISCOVER_SOURCE_KEY]: opts.source } : {}),
      },
    ],
    ...(layout ? { transformations: [layout.organize] } : {}),
    options: {
      showHeader: true,
      cellHeight: 'sm',
      // "Count: N" under the table (the documents shown; the query keeps Discover's row limit).
      footer: { show: true, reducer: ['count'], countRows: true, fields: '' },
    },
    fieldConfig: {
      defaults: { custom: { align: 'auto', inspect: true } },
      overrides: [
        ...(layout?.overrides ?? []),
        ...(message
          ? [
              {
                matcher: { id: 'byName', options: message.displayName },
                properties: [{ id: 'custom.cellOptions', value: { type: 'auto', wrapText: true } }],
              },
            ]
          : []),
      ],
    },
  };
}

/**
 * Build a "timeseries" panel (rendered as bars) showing the current volume histogram.
 * `breakdown` should already be resolved via resolveVolumeBreakdown() from the UI-level
 * BreakdownSel, same as the live in-app histogram query.
 * The long time/level/count rows are pivoted into per-level series via transformations,
 * since the query itself always runs in Table format.
 *
 * Deliberately NOT a "barchart" panel — barchart treats every row as a discrete category
 * (Grafana's own docs: "for large amounts of time-series data, we recommend that you use the
 * time series visualization" instead), so a ~50-60-bucket histogram rendered as a barchart
 * produced one raw-epoch category tick per bucket, all overlapping/unreadable, with bars grouped
 * side-by-side instead of stacked. `prepareTimeSeries`'s `format: 'many'` output (one frame per
 * series, each with a real time-typed field) is the shape a timeseries panel expects — pairing it
 * with `drawStyle: 'bars'` + `stacking` reproduces the barchart look while keeping a proper,
 * auto-formatted/decimated time axis.
 */
export function buildHistogramPanel(
  config: SourceConfig,
  state: LogsQueryState,
  breakdown: VolumeBreakdown,
  opts: PanelExportOpts,
  index?: FieldIndex
): ExportedPanel {
  const datasource = chDatasourceRef(config.datasourceUid);
  const rawSql = escapeDollarInLiterals(
    buildVolumeQuery(config, state, { interval: { macro: true }, breakdown }, index)
  );
  // After partitioning, every series is the `count` field labelled with its level, which Grafana
  // names "count error". Show the level alone (a single series without a breakdown: "Count").
  const displayName = breakdown.kind === 'none' ? 'Count' : '${__field.labels.level}';
  return {
    id: opts.id,
    type: 'timeseries',
    title: opts.title?.trim() || 'Log volume',
    gridPos: opts.gridPos,
    datasource,
    targets: [{ refId: 'A', datasource, editorType: 'sql', format: FORMAT_TABLE, rawSql }],
    // Pivot long rows (time, level, count) into one series per level, then into per-series
    // time-series frames — the shape a timeseries panel consumes — same grouping the app already
    // does client-side in LogsExplorer's volume-row folding logic.
    transformations: [
      { id: 'partitionByValues', options: { fields: ['level'], keepFields: false } },
      { id: 'prepareTimeSeries', options: { format: 'many' } },
    ],
    options: {},
    fieldConfig: {
      defaults: { custom: { drawStyle: 'bars', fillOpacity: 100, stacking: { mode: 'normal', group: 'A' } } },
      overrides: [{ matcher: { id: 'byName', options: 'count' }, properties: [{ id: 'displayName', value: displayName }] }],
    },
  };
}

/** A dashboard time range from the page's range: relative strings (`now-15m`) kept, else ISO. */
export function dashboardTime(r: TimeRange): { from: string; to: string } {
  const raw = (v: unknown, d: { toISOString: () => string }) => (typeof v === 'string' ? v : d.toISOString());
  return { from: raw(r.raw.from, r.from), to: raw(r.raw.to, r.to) };
}

/** A new dashboard holding `panels`, opening on `time` (default: the last hour). */
export function buildNewDashboard(
  panels: ExportedPanel[],
  title: string,
  time: { from: string; to: string } = { from: 'now-1h', to: 'now' }
): Record<string, unknown> {
  return {
    title,
    panels,
    schemaVersion: 39,
    version: 0,
    time,
    timezone: '',
    editable: true,
  };
}

/**
 * Append panels to an existing dashboard's JSON model, offsetting gridPos.y below whatever is
 * already there and assigning ids that don't collide with existing panel ids.
 */
export function appendPanelsToDashboard(
  dashboard: Record<string, unknown>,
  panels: ExportedPanel[]
): Record<string, unknown> {
  const existingPanels = Array.isArray(dashboard.panels)
    ? (dashboard.panels as Array<{ id?: number; gridPos?: GridPos }>)
    : [];
  const maxY = existingPanels.reduce((m, p) => (p.gridPos ? Math.max(m, p.gridPos.y + p.gridPos.h) : m), 0);
  // Ids must be unique across the dashboard, including panels inside collapsed rows.
  const maxId = existingPanels.reduce(
    (m, p) =>
      Math.max(
        m,
        Number(p.id) || 0,
        ...(Array.isArray((p as { panels?: unknown }).panels)
          ? ((p as { panels: Array<{ id?: number }> }).panels.map((c) => Number(c?.id) || 0))
          : [])
      ),
    0
  );
  const offsetPanels = panels.map((p, i) => ({
    ...p,
    id: maxId + i + 1,
    gridPos: { ...p.gridPos, y: maxY + p.gridPos.y },
  }));
  return { ...dashboard, panels: [...existingPanels, ...offsetPanels] };
}

export class PanelNotFoundError extends Error {
  constructor() {
    super('The panel is no longer on the dashboard. Use Save as new to add the chart again.');
    this.name = 'PanelNotFoundError';
  }
}

type PanelLike = { id?: unknown; type?: unknown; gridPos?: GridPos; panels?: unknown };

/**
 * Replace the panel with id `panelId` (top level or inside a collapsed row) by `panel`, keeping the
 * original's id and position: Kibana's Save and return. Everything else on the dashboard (other
 * panels, time, variables, version) is untouched. Throws PanelNotFoundError when it is gone.
 */
export function replacePanelInDashboard(
  dashboard: Record<string, unknown>,
  panelId: number,
  panel: ExportedPanel
): Record<string, unknown> {
  let found = false;
  const swap = (list: unknown[]): unknown[] =>
    list.map((raw) => {
      const p = raw as PanelLike;
      if (!p || typeof p !== 'object') {
        return raw;
      }
      if (!found && p.id === panelId && p.type !== 'row') {
        found = true;
        const gridPos = isGridPos(p.gridPos) ? p.gridPos : panel.gridPos;
        return { ...panel, id: panelId, gridPos };
      }
      return p.type === 'row' && Array.isArray(p.panels) ? { ...p, panels: swap(p.panels) } : raw;
    });
  const panels = Array.isArray(dashboard.panels) ? swap(dashboard.panels) : [];
  if (!found) {
    throw new PanelNotFoundError();
  }
  return { ...dashboard, panels };
}

/** The panel with id `panelId` (top level or in a row), or undefined. */
export function findDashboardPanel(dashboard: Record<string, unknown>, panelId: number): Record<string, unknown> | undefined {
  const walk = (list: unknown): Record<string, unknown> | undefined => {
    if (!Array.isArray(list)) {
      return undefined;
    }
    for (const raw of list) {
      const p = raw as PanelLike & Record<string, unknown>;
      if (!p || typeof p !== 'object') {
        continue;
      }
      if (p.id === panelId && p.type !== 'row') {
        return p;
      }
      const inner = p.type === 'row' ? walk(p.panels) : undefined;
      if (inner) {
        return inner;
      }
    }
    return undefined;
  };
  return walk(dashboard.panels);
}

function isGridPos(g: unknown): g is GridPos {
  const v = g as GridPos | undefined;
  return !!v && [v.x, v.y, v.w, v.h].every((n) => typeof n === 'number' && Number.isFinite(n));
}
