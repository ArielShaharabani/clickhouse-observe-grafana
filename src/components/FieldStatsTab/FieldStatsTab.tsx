import React, { Fragment, useContext, useEffect, useMemo, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, TimeRange } from '@grafana/data';
import { Button, Icon, IconButton, Input, Pagination, Switch, useStyles2, useTheme2 } from '@grafana/ui';
import { FieldModel } from '../../sql/fieldModel';
import { buildFieldIndex } from '../../sql/fields';
import { buildWhereConditions } from '../../sql/queryBuilder';
import { fetchFieldStatsBatch, fetchFieldStatsFullScan, FieldStats } from '../../sql/fieldStats';
import { scanCaption, ScanStatus } from '../../sql/fullScan';
import { lensFieldOf } from '../../lens/handoff';
import { isLensField } from '../../lens/suggest';
import { copyToClipboard, valueActions } from '../../actions/registry';
import { FilterPill, LogsQueryState, SourceConfig } from '../../types';
import { errMsg } from '../../errMsg';
import { SourceConfigContext } from '../App/App';
import { useFields } from '../FieldsContext';
import { FIELD_TYPE_ICONS } from '../FieldSidebar/fieldIcons';
import { fieldTypeColor } from '../FieldSidebar/fieldTypeColors';
import { sampleCaption, STATS_SAMPLE_SIZE } from '../FieldSidebar/FieldStatsPopover';

/** Fields profiled per query (one table page = one batch). */
export const FIELD_STATS_PAGE_SIZE = 25;

const fmt = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const pct = (n: number, of: number) => (of > 0 ? (n / of) * 100 : 0);
const pctText = (n: number, of: number) => {
  const p = pct(n, of);
  return `${p === 100 || p === 0 ? p.toFixed(0) : p.toFixed(1)}%`;
};

/** An empty string is a value, shown like Kibana's "(blank)". */
export const BLANK_LABEL = '(blank)';
const valueLabel = (v: string) => (v === '' ? BLANK_LABEL : v);

/** Containers are profiled through their keys / paths, not as a whole (same rule as the field list). */
export function isProfilableField(f: FieldModel): boolean {
  return !(f.source === 'column' && (f.type === 'map' || f.type === 'json' || f.type === 'tuple'));
}

interface FieldStatsTabProps {
  queryState: LogsQueryState;
  timeRange: TimeRange;
  onAddFilter: (f: FilterPill) => void;
  /** Open the field on Visualize (Lens hand-off); absent = no action. */
  onVisualize?: (field: FieldModel) => void;
}

interface BatchResult {
  key: string;
  stats?: Record<string, FieldStats>;
  error?: string;
  /** Set for a full-range scan result (R5-SAMPLING). */
  scan?: ScanStatus;
  /** Full-range scan: some counts are estimates. */
  approximate?: boolean;
}

/** DISC-FIELDSTATS-01: every field of the data view with its documents %, distinct values and a
 *  mini distribution, profiled over the same sample as the field popover. */
export function FieldStatsTab({ queryState, timeRange, onAddFilter, onVisualize }: FieldStatsTabProps) {
  const styles = useStyles2(getStyles);
  const config: SourceConfig = useContext(SourceConfigContext);
  const { fields, loading: fieldsLoading } = useFields();
  const fieldIndex = useMemo(() => buildFieldIndex(fields), [fields]);
  const [nameFilter, setNameFilter] = useState('');
  const [showDist, setShowDist] = useState(true);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const listed = useMemo(() => {
    const lc = nameFilter.toLowerCase();
    return fields
      .filter(isProfilableField)
      .filter((f) => !lc || f.displayName.toLowerCase().includes(lc) || f.name.toLowerCase().includes(lc))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [fields, nameFilter]);

  const pages = Math.max(1, Math.ceil(listed.length / FIELD_STATS_PAGE_SIZE));
  const curPage = Math.min(page, pages);
  const pageFields = useMemo(
    () => listed.slice((curPage - 1) * FIELD_STATS_PAGE_SIZE, curPage * FIELD_STATS_PAGE_SIZE),
    [listed, curPage]
  );

  const conditions = useMemo(
    () => buildWhereConditions(config, queryState, fieldIndex),
    [config, queryState, fieldIndex]
  );
  // "Scan full range" (R5-SAMPLING): on for the scope (view, query, filters, time) it was pressed
  // in, across pages; any scope change falls back to the sample.
  const scopeKey = useMemo(
    () =>
      JSON.stringify([config.datasourceUid, config.database, config.logsTable, conditions, timeRange.from.valueOf(), timeRange.to.valueOf()]),
    [config, conditions, timeRange]
  );
  const [fullRangeScope, setFullRangeScope] = useState<string | null>(null);
  const fullRange = fullRangeScope === scopeKey;
  const requestKey = useMemo(
    () => JSON.stringify([scopeKey, pageFields.map((f) => f.id), fullRange]),
    [scopeKey, pageFields, fullRange]
  );
  const [result, setResult] = useState<BatchResult | null>(null);

  useEffect(() => {
    if (!config.datasourceUid || pageFields.length === 0) {
      return;
    }
    const ctrl = new AbortController();
    const targets = pageFields.map((f) => ({
      sqlExpr: f.sqlExpr,
      numeric: f.type === 'number',
      time: f.type === 'time' && f.source !== 'map',
      blankIsValue: f.source !== 'map',
    }));
    const toRecord = (list: FieldStats[]) => {
      const stats: Record<string, FieldStats> = {};
      pageFields.forEach((f, i) => (stats[f.id] = list[i]));
      return stats;
    };
    const onError = (e: unknown) => !ctrl.signal.aborted && setResult({ key: requestKey, error: errMsg(e) });
    if (fullRange) {
      fetchFieldStatsFullScan(config, targets, { table: config.logsTable, conditions, timeRange, signal: ctrl.signal }).then(
        ({ stats, status }) =>
          !ctrl.signal.aborted &&
          setResult({
            key: requestKey,
            // Time limit hit = no result at all: say so instead of a table of zeros.
            stats: stats.length > 0 ? toRecord(stats) : undefined,
            error: stats.length > 0 ? undefined : scanCaption(status),
            scan: status,
            approximate: stats.some((x) => x.approximate),
          }),
        onError
      );
    } else {
      fetchFieldStatsBatch(config, targets, {
        table: config.logsTable,
        conditions,
        sampleSize: STATS_SAMPLE_SIZE,
        timeRange,
        signal: ctrl.signal,
      }).then((list) => !ctrl.signal.aborted && setResult({ key: requestKey, stats: toRecord(list) }), onError);
    }
    return () => ctrl.abort();
  }, [config, conditions, timeRange, pageFields, requestKey, fullRange]);

  const current = result?.key === requestKey ? result : null;
  const sampled = current?.stats ? (Object.values(current.stats)[0]?.sampled ?? 0) : 0;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div className={styles.wrap} data-testid="field-stats-tab">
      <div className={styles.toolbar}>
        <Input
          className={styles.search}
          prefix={<Icon name="search" />}
          placeholder="Filter fields by name"
          aria-label="Filter fields by name"
          value={nameFilter}
          onChange={(e) => {
            setNameFilter(e.currentTarget.value);
            setPage(1);
          }}
        />
        <span className={styles.muted}>{listed.length.toLocaleString()} fields</span>
        <div className={styles.spacer} />
        {fullRange ? (
          <Button size="sm" variant="secondary" fill="text" icon="history" onClick={() => setFullRangeScope(null)}>
            Back to sample
          </Button>
        ) : (
          <Button
            size="sm"
            variant="secondary"
            fill="text"
            icon="search"
            onClick={() => setFullRangeScope(scopeKey)}
            tooltip="Profile every matching document of the time range instead of the newest 5,000 (budgeted: a large range may give a partial result)"
          >
            Scan full range
          </Button>
        )}
        <label className={styles.distToggle}>
          <Icon name={showDist ? 'eye' : 'eye-slash'} />
          <span>Distributions</span>
          <Switch value={showDist} onChange={() => setShowDist((v) => !v)} aria-label="Show distributions" />
        </label>
      </div>

      {current?.error && <div className={styles.error}>{current.error}</div>}
      {!fieldsLoading && listed.length === 0 && (
        <div className={styles.muted}>No fields{nameFilter ? ' match' : ''}</div>
      )}

      {listed.length > 0 && (
        <table className={styles.table} aria-label="Field statistics">
          <thead>
            <tr>
              <th className={styles.narrow} />
              <th className={styles.narrow}>Type</th>
              <th>Name</th>
              <th title="Sampled documents that have a value for this field">Documents (%)</th>
              <th>Distinct values</th>
              {showDist && <th>Distributions</th>}
              <th className={styles.narrow}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pageFields.map((f) => {
              const s = current?.stats?.[f.id];
              const open = expanded.has(f.id);
              const canVisualize = onVisualize && isLensField(lensFieldOf(f));
              return (
                <Fragment key={f.id}>
                  <tr data-testid={`field-stats-row-${f.displayName}`}>
                    <td>
                      <IconButton
                        name={open ? 'angle-down' : 'angle-right'}
                        aria-label={`${open ? 'Collapse' : 'Expand'} ${f.displayName}`}
                        aria-expanded={open}
                        onClick={() => toggle(f.id)}
                      />
                    </td>
                    <td>
                      <TypeIcon field={f} />
                    </td>
                    <td className={styles.name}>{f.displayName}</td>
                    <td>{s ? `${s.docs.toLocaleString()} (${pctText(s.docs, s.sampled)})` : <Loading />}</td>
                    <td>{s ? s.distinct.toLocaleString() : <Loading />}</td>
                    {showDist && <td>{s ? <MiniDistribution field={f} stats={s} /> : <Loading />}</td>}
                    <td>
                      {canVisualize && (
                        <IconButton
                          name="chart-line"
                          aria-label={`Visualize ${f.displayName}`}
                          tooltip={`Visualize ${f.displayName}`}
                          onClick={() => onVisualize!(f)}
                        />
                      )}
                    </td>
                  </tr>
                  {open && (
                    <tr className={styles.expandedRow}>
                      <td colSpan={showDist ? 7 : 6}>
                        {s ? <ExpandedStats field={f} stats={s} onAddFilter={onAddFilter} /> : <Loading />}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      )}

      <div className={styles.footer}>
        {current?.scan && current.stats && (
          <span className={styles.muted} data-testid="field-stats-scan-status">
            {scanCaption(current.scan)}
            {current.approximate && ' Counts of high-cardinality fields and distributions are approximate.'}
          </span>
        )}
        {fullRange && !current && <span className={styles.muted}>Scanning the full time range…</span>}
        {!current?.scan && sampled > 0 && (
          <span className={styles.muted}>
            {/* "sample" only when the cap was hit; fewer rows means every matching document was used. */}
            {sampleCaption('Calculated', sampled, STATS_SAMPLE_SIZE)}
            {sampled >= STATS_SAMPLE_SIZE && ' (the most recent documents matching the query)'}
          </span>
        )}
        <div className={styles.spacer} />
        {pages > 1 && <Pagination currentPage={curPage} numberOfPages={pages} onNavigate={setPage} />}
      </div>
    </div>
  );
}

function Loading() {
  const styles = useStyles2(getStyles);
  return <span className={styles.muted}>…</span>;
}

function TypeIcon({ field }: { field: FieldModel }) {
  const theme = useTheme2();
  return (
    <span title={field.type} aria-label={`Type ${field.type}`}>
      <Icon
        name={(FIELD_TYPE_ICONS[field.type] ?? 'question-circle') as any}
        style={{ color: fieldTypeColor(theme, field.type) }}
      />
    </span>
  );
}

/** Keyword: bar strip of the top values + category count. Number: density sparkline with min / max. */
function MiniDistribution({ field, stats }: { field: FieldModel; stats: FieldStats }) {
  const styles = useStyles2(getStyles);
  if (stats.docs === 0) {
    return <span className={styles.muted}>No values</span>;
  }
  const num = stats.numeric;
  if (stats.range) {
    return (
      <div className={styles.mini} aria-label={`${field.displayName} from ${stats.range.min} to ${stats.range.max}`}>
        <span className={styles.muted}>{stats.range.min}</span>
        <span className={styles.muted}>→</span>
        <span className={styles.muted}>{stats.range.max}</span>
      </div>
    );
  }
  if (num && num.count > 0) {
    const peak = Math.max(...num.buckets, 1);
    return (
      <div
        className={styles.mini}
        aria-label={`${field.displayName} distribution from ${fmt(num.min)} to ${fmt(num.max)}`}
      >
        <span className={styles.muted}>{fmt(num.min)}</span>
        <span className={styles.spark}>
          {num.buckets.map((c, i) => (
            <span
              key={i}
              className={styles.sparkBar}
              style={{ height: `${c > 0 ? Math.max(8, (c / peak) * 100) : 0}%` }}
            />
          ))}
        </span>
        <span className={styles.muted}>{fmt(num.max)}</span>
      </div>
    );
  }
  const shown = stats.top.length;
  const label =
    stats.distinct > shown
      ? `top ${shown} of ${stats.distinct.toLocaleString()} categories`
      : `${stats.distinct} ${stats.distinct === 1 ? 'category' : 'categories'}`;
  return (
    <div className={styles.mini}>
      <span className={styles.strip}>
        {stats.top.map((t) => (
          <span
            key={t.value}
            className={styles.stripBar}
            style={{ flexGrow: Math.max(1, t.count) }}
            title={`${valueLabel(t.value)}: ${pctText(t.count, stats.docs)}`}
          />
        ))}
      </span>
      <span className={styles.muted}>{label}</span>
    </div>
  );
}

function ExpandedStats({
  field,
  stats,
  onAddFilter,
}: {
  field: FieldModel;
  stats: FieldStats;
  onAddFilter: (f: FilterPill) => void;
}) {
  const styles = useStyles2(getStyles);
  const num = stats.numeric && stats.numeric.count > 0 ? stats.numeric : undefined;
  return (
    <div className={styles.expanded} data-testid={`field-stats-expanded-${field.displayName}`}>
      <section>
        <h6 className={styles.sectionTitle}>Documents stats</h6>
        <dl className={styles.dl}>
          <dt>Count</dt>
          <dd>{stats.docs.toLocaleString()}</dd>
          <dt>Percentage</dt>
          <dd>{pctText(stats.docs, stats.sampled)}</dd>
          <dt>Distinct values</dt>
          <dd>{stats.distinct.toLocaleString()}</dd>
        </dl>
        {stats.range && (
          <>
            <h6 className={styles.sectionTitle}>Range</h6>
            <dl className={styles.dl}>
              <dt>earliest</dt>
              <dd>{stats.range.min}</dd>
              <dt>latest</dt>
              <dd>{stats.range.max}</dd>
            </dl>
          </>
        )}
        {num && (
          <>
            <h6 className={styles.sectionTitle}>Summary</h6>
            <dl className={styles.dl}>
              <dt>min</dt>
              <dd>{fmt(num.min)}</dd>
              <dt>median</dt>
              <dd>{fmt(num.median)}</dd>
              <dt>max</dt>
              <dd>{fmt(num.max)}</dd>
            </dl>
          </>
        )}
      </section>
      <section className={styles.grow}>
        {!stats.range && <h6 className={styles.sectionTitle}>Top values</h6>}
        {!stats.range && stats.top.length === 0 && <span className={styles.muted}>No values in the sample</span>}
        {(stats.range ? [] : stats.top).map((t) => (
          <div key={t.value} className={styles.valueRow}>
            <div className={styles.valueBar} style={{ width: `${Math.max(2, pct(t.count, stats.docs))}%` }} />
            <span className={styles.value}>{valueLabel(t.value)}</span>
            <span className={styles.muted}>
              {t.count.toLocaleString()} ({pctText(t.count, stats.docs)})
            </span>
            {valueActions(
              { field: field.sqlExpr, value: t.value },
              { addFilter: onAddFilter, copyText: copyToClipboard },
              ['filterFor', 'filterOut']
            ).map((a) => (
              <IconButton
                key={a.id}
                name={a.icon}
                size="sm"
                aria-label={a.ariaLabel}
                tooltip={a.ariaLabel}
                onClick={a.run}
              />
            ))}
          </div>
        ))}
      </section>
      {num && (
        <section className={styles.grow}>
          <h6 className={styles.sectionTitle}>Distribution</h6>
          <BucketChart numeric={num} />
        </section>
      )}
    </div>
  );
}

function BucketChart({ numeric }: { numeric: NonNullable<FieldStats['numeric']> }) {
  const styles = useStyles2(getStyles);
  const peak = Math.max(...numeric.buckets, 1);
  const width = (numeric.max - numeric.min) / 10;
  return (
    <div className={styles.bucketChart}>
      {numeric.buckets.map((c, i) => {
        const from = numeric.min + i * width;
        const to = i === 9 ? numeric.max : numeric.min + (i + 1) * width;
        return (
          <div
            key={i}
            className={styles.bucketCol}
            title={`${fmt(from)} – ${fmt(to)}: ${c.toLocaleString()} records`}
            aria-label={`${fmt(from)} to ${fmt(to)}: ${c} records`}
          >
            <span className={styles.bucketBar} style={{ height: `${c > 0 ? Math.max(4, (c / peak) * 100) : 0}%` }} />
          </div>
        );
      })}
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  wrap: css`
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(1)};
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: ${theme.spacing(0, 1, 1)};
  `,
  toolbar: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
  `,
  search: css`
    max-width: 280px;
  `,
  spacer: css`
    flex: 1;
  `,
  distToggle: css`
    display: inline-flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
  `,
  muted: css`
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    white-space: nowrap;
  `,
  error: css`
    color: ${theme.colors.error.text};
  `,
  table: css`
    width: 100%;
    border-collapse: collapse;
    th,
    td {
      padding: ${theme.spacing(0.5, 1)};
      border-bottom: 1px solid ${theme.colors.border.weak};
      text-align: left;
      vertical-align: middle;
    }
    th {
      color: ${theme.colors.text.secondary};
      font-weight: ${theme.typography.fontWeightMedium};
      font-size: ${theme.typography.bodySmall.fontSize};
    }
  `,
  narrow: css`
    width: 1%;
    white-space: nowrap;
  `,
  name: css`
    font-family: ${theme.typography.fontFamilyMonospace};
    word-break: break-all;
  `,
  mini: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
  `,
  strip: css`
    display: flex;
    gap: 1px;
    width: 120px;
    height: 10px;
  `,
  stripBar: css`
    background: ${theme.colors.primary.main};
    opacity: 0.75;
    border-radius: 1px;
  `,
  spark: css`
    display: flex;
    align-items: flex-end;
    gap: 1px;
    width: 100px;
    height: 20px;
  `,
  sparkBar: css`
    flex: 1;
    background: ${theme.colors.primary.main};
    opacity: 0.75;
  `,
  expandedRow: css`
    background: ${theme.colors.background.secondary};
  `,
  expanded: css`
    display: flex;
    gap: ${theme.spacing(3)};
    padding: ${theme.spacing(1)};
    flex-wrap: wrap;
  `,
  grow: css`
    flex: 1;
    min-width: 240px;
  `,
  sectionTitle: css`
    font-size: ${theme.typography.bodySmall.fontSize};
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: ${theme.colors.text.secondary};
    margin: ${theme.spacing(0, 0, 0.5)};
  `,
  dl: css`
    display: grid;
    grid-template-columns: auto auto;
    gap: ${theme.spacing(0.25, 2)};
    margin-bottom: ${theme.spacing(1)};
    dt {
      color: ${theme.colors.text.secondary};
    }
    dd {
      margin: 0;
      font-family: ${theme.typography.fontFamilyMonospace};
    }
  `,
  valueRow: css`
    position: relative;
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    padding: 1px ${theme.spacing(0.5)};
  `,
  valueBar: css`
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: ${theme.colors.primary.transparent};
    pointer-events: none;
  `,
  value: css`
    position: relative;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ${theme.typography.fontFamilyMonospace};
  `,
  bucketChart: css`
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 80px;
  `,
  bucketCol: css`
    flex: 1;
    height: 100%;
    display: flex;
    align-items: flex-end;
  `,
  bucketBar: css`
    width: 100%;
    background: ${theme.colors.primary.main};
  `,
  footer: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
  `,
});
