import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { GrafanaTheme2, TimeRange } from '@grafana/data';
import { Icon, RadioButtonGroup, useStyles2, useTheme2 } from '@grafana/ui';
import { FieldModel } from '../../sql/fieldModel';
import { FIELD_TYPE_ICONS } from './fieldIcons';
import { fieldTypeColor } from './fieldTypeColors';
import { buildWhereConditions } from '../../sql/queryBuilder';
import { buildFieldIndex } from '../../sql/fields';
import {
  buildValuesCacheKey,
  fetchFieldValuesWithTotal,
  fetchNumericStats,
  isValuesCacheEntryFresh,
  NumericStats,
  valuesCache,
} from '../../sql/kql/_values';
import { copyToClipboard, fieldActions, valueActions } from '../../actions/registry';
import { ActionIconButton } from '../../actions/ActionIconButton';
import { FilterPill, LogsQueryState, SourceConfig } from '../../types';
import { errMsg } from '../../errMsg';
import { SourceConfigContext } from '../App/App';
import { useFields } from '../FieldsContext';

interface TopValue {
  value: string;
  count: number;
  pct: number;
}

/** Same field+filter context used by the KQL autocomplete cache key (kql/_values.ts) — this
 *  popover shares that cache (via valuesCache/buildValuesCacheKey) so the two never disagree on
 *  a field's top values, they just format the request options differently (whole-page filter
 *  state vs. a single arbitrary cacheKey string). */
function toValuesOpts(config: SourceConfig, queryState: LogsQueryState, timeRange: TimeRange, fieldIndex: ReturnType<typeof buildFieldIndex>) {
  return {
    table: config.logsTable,
    conditions: buildWhereConditions(config, queryState, fieldIndex),
    timeRange,
    cacheKey: JSON.stringify([queryState.search, queryState.filters]),
    limit: 10,
    sampleSize: STATS_SAMPLE_SIZE,
  };
}

/** Rows the popover's statistics are computed from (spec DISC-SIDEBAR-02: 5,000 sample records). */
export const STATS_SAMPLE_SIZE = 5000;

/** Field types a histogram breakdown makes sense for (single scalar values). */
const BREAKDOWN_TYPES = new Set(['string', 'number', 'boolean']);

type StatsView = 'top' | 'distribution';

const formatNum = (n: number) =>
  Number.isInteger(n) ? n.toLocaleString() : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

interface FieldStatsPopoverProps {
  field: FieldModel;
  queryState: LogsQueryState;
  timeRange: TimeRange;
  onAddFilter: (f: FilterPill) => void;
  onAddColumn: () => void;
  isSelected: boolean;
  /** Break the histogram down by this field; omitted -> no breakdown action. */
  onSetBreakdown?: (field: FieldModel) => void;
}

export function FieldStatsPopover({
  field,
  queryState,
  timeRange,
  onAddFilter,
  onAddColumn,
  isSelected,
  onSetBreakdown,
}: FieldStatsPopoverProps) {
  const styles = useStyles2(getStyles);
  const theme = useTheme2();
  const config: SourceConfig = useContext(SourceConfigContext);
  // Same discovered-fields index every other WHERE-builder call site threads through (see
  // LogsExplorer's fieldIndex / hydratePage) — without it, a filter on a Map/JSON field falls
  // back to resolveField's unindexed heuristics here while the rest of the page resolves it
  // correctly, so this popover's top-values could silently reflect a different WHERE clause than
  // what's actually applied to the grid.
  const { fields } = useFields();
  const fieldIndex = useMemo(() => buildFieldIndex(fields), [fields]);
  const [values, setValues] = useState<TopValue[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    if (!config.datasourceUid) {
      return;
    }

    const opts = toValuesOpts(config, queryState, timeRange, fieldIndex);
    const key = buildValuesCacheKey(config.datasourceUid, field.sqlExpr, timeRange, opts);
    const cached = valuesCache.get(key);
    if (cached && isValuesCacheEntryFresh(cached)) {
      setValues(cached.values.map((v) => ({ ...v, pct: cached.total > 0 ? (v.count / cached.total) * 100 : 0 })));
      setTotal(cached.total);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // Not loadFieldValuesWithTotal (which swallows a query failure into an empty result, right
      // for autocomplete) — this popover shows a real error banner on failure, so it needs the
      // throwing fetch and does its own cache write.
      const { values: rawValues, total: sampleTotal } = await fetchFieldValuesWithTotal(config, field.sqlExpr, opts);
      if (!mountedRef.current) {
        return;
      }

      const mapped: TopValue[] = rawValues.map((v) => ({
        ...v,
        pct: sampleTotal > 0 ? (v.count / sampleTotal) * 100 : 0,
      }));

      valuesCache.set(key, { values: rawValues, total: sampleTotal, fetchedAt: Date.now() });
      setValues(mapped);
      setTotal(sampleTotal);
    } catch (e) {
      if (mountedRef.current) {
        setError(errMsg(e));
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [config, field.sqlExpr, queryState, timeRange, fieldIndex]);

  // load() fetches top values async and mirrors the result into state — an external fetch
  // synced to React, not a render-time update.
  useEffect(() => {
    mountedRef.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  // Numeric fields: Top values | Distribution (DISC-SIDEBAR-02). Distribution loads on demand.
  const isNumeric = field.type === 'number';
  const [view, setView] = useState<StatsView>('top');
  const [numeric, setNumeric] = useState<NumericStats | null>(null);
  const [numericError, setNumericError] = useState<string | null>(null);
  useEffect(() => {
    if (!isNumeric || view !== 'distribution' || !config.datasourceUid) {
      return;
    }
    let cancelled = false;
    const opts = toValuesOpts(config, queryState, timeRange, fieldIndex);
    fetchNumericStats(config, field.sqlExpr, opts).then(
      (s) => {
        if (!cancelled) {
          setNumeric(s);
          setNumericError(null);
        }
      },
      (e) => {
        if (!cancelled) {
          setNumericError(errMsg(e));
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [isNumeric, view, config, field.sqlExpr, queryState, timeRange, fieldIndex]);

  const headerActions = useMemo(
    () =>
      fieldActions(
        { field: field.sqlExpr },
        {
          copyText: copyToClipboard,
          setBreakdown: onSetBreakdown && BREAKDOWN_TYPES.has(field.type) ? () => onSetBreakdown(field) : undefined,
        },
        ['breakdown', 'visualize']
      ),
    [field, onSetBreakdown]
  );

  const typeIcon = FIELD_TYPE_ICONS[field.type] ?? 'question-circle';

  return (
    <div className={styles.panel}>
      {/* Header: type icon + field name */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Icon
            name={typeIcon as any}
            size="sm"
            className={styles.headerIcon}
            style={{ color: fieldTypeColor(theme, field.type) }}
          />
          <span className={styles.fieldName}>{field.displayName}</span>
        </div>
        {headerActions.map((a) => (
          <ActionIconButton key={a.id} action={a} />
        ))}
        <button
          className={`${styles.colBtn} ${isSelected ? styles.colBtnActive : ''}`}
          onClick={onAddColumn}
          title={isSelected ? 'Remove column' : 'Add as column'}
        >
          <Icon name={isSelected ? 'minus' : 'plus'} size="sm" />
          {isSelected ? ' Remove' : ' Add column'}
        </button>
      </div>

      {/* Field type subheader */}
      <div className={styles.typeLabel}>{field.type}</div>

      {isNumeric ? (
        <RadioButtonGroup<StatsView>
          size="sm"
          fullWidth
          className={styles.viewToggle}
          options={[
            { label: 'Top values', value: 'top' },
            { label: 'Distribution', value: 'distribution' },
          ]}
          value={view}
          onChange={setView}
        />
      ) : (
        <div className={styles.sectionLabel}>Top values</div>
      )}

      {view === 'distribution' && <NumericDistribution stats={numeric} error={numericError} styles={styles} />}

      {view === 'top' && loading && <div className={styles.loading}>Loading…</div>}
      {view === 'top' && error && <div className={styles.errorText}>{error}</div>}
      {view === 'top' && !loading && !error && values.length === 0 && (
        <div className={styles.empty}>No field data for the current search</div>
      )}

      {view === 'top' &&
        !loading &&
        !error &&
        values.map((v) => (
          <div key={v.value} className={styles.row} title={`${v.count.toLocaleString()} records`}>
            {/* % bar background */}
            <div className={styles.barBg} style={{ width: `${Math.max(2, v.pct)}%` }} />

            {/* Value text */}
            <span className={styles.value}>{v.value || '(empty)'}</span>

            {/* Percentage */}
            <span className={styles.pct}>{v.pct.toFixed(1)}%</span>

            {/* Filter buttons — revealed on row hover via CSS */}
            <div className={`${styles.filterBtns} field-filter-btns`}>
              {valueActions(
                { field: field.sqlExpr, value: v.value },
                { addFilter: onAddFilter, copyText: copyToClipboard },
                ['filterFor', 'filterOut']
              ).map((a) => (
                <button key={a.id} className={styles.filterBtn} title={a.ariaLabel} aria-label={a.ariaLabel} onClick={a.run}>
                  <Icon name={a.icon} size="xs" />
                </button>
              ))}
            </div>
          </div>
        ))}

      {/* "Calculated from N records" caption */}
      {view === 'top' && !loading && !error && total > 0 && (
        <div className={styles.caption}>Calculated from {total.toLocaleString()} sample records.</div>
      )}
    </div>
  );
}

/** 10-bucket distribution + min / median / max for a numeric field. */
function NumericDistribution({
  stats,
  error,
  styles,
}: {
  stats: NumericStats | null;
  error: string | null;
  styles: ReturnType<typeof getStyles>;
}) {
  if (error) {
    return <div className={styles.errorText}>{error}</div>;
  }
  if (!stats) {
    return <div className={styles.loading}>Loading…</div>;
  }
  if (stats.count === 0) {
    return <div className={styles.empty}>No numeric values in the sample</div>;
  }
  const peak = Math.max(...stats.buckets.map((b) => b.count), 1);
  return (
    <div data-testid="numeric-distribution">
      <div className={styles.summary}>
        <span>min {formatNum(stats.min)}</span>
        <span>median {formatNum(stats.median)}</span>
        <span>max {formatNum(stats.max)}</span>
      </div>
      {stats.buckets.map((b, i) => (
        <div
          key={i}
          className={styles.row}
          title={`${formatNum(b.from)} – ${formatNum(b.to)}: ${b.count.toLocaleString()} records`}
          aria-label={`${formatNum(b.from)} to ${formatNum(b.to)}: ${b.count} records`}
        >
          <div className={styles.barBg} style={{ width: `${b.count > 0 ? Math.max(2, (b.count / peak) * 100) : 0}%` }} />
          <span className={styles.value}>{formatNum(b.from)}</span>
          <span className={styles.pct}>{b.count.toLocaleString()}</span>
        </div>
      ))}
      <div className={styles.caption}>Calculated from {stats.count.toLocaleString()} sample records.</div>
    </div>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  viewToggle: css`
    margin: ${theme.spacing(1, 0, 0.5)};
  `,
  summary: css`
    display: flex;
    justify-content: space-between;
    font-family: ${theme.typography.fontFamilyMonospace};
    font-size: ${theme.typography.bodySmall.fontSize};
    color: ${theme.colors.text.secondary};
    margin: ${theme.spacing(0.5, 0)};
  `,
  panel: css`
    width: 300px;
    padding: ${theme.spacing(1.5)};
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z2};
    font-size: ${theme.typography.body.fontSize};
  `,
  header: css`
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: ${theme.spacing(1)};
    margin-bottom: 2px;
  `,
  headerLeft: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    overflow: hidden;
  `,
  headerIcon: css`
    flex-shrink: 0;
  `,
  fieldName: css`
    font-weight: ${theme.typography.fontWeightMedium};
    color: ${theme.colors.text.primary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ${theme.typography.fontFamilyMonospace};
  `,
  colBtn: css`
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 6px;
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    background: transparent;
    color: ${theme.colors.text.secondary};
    cursor: pointer;
    font-size: 13px;
    white-space: nowrap;
    flex-shrink: 0;
    &:hover {
      background: ${theme.colors.action.hover};
      color: ${theme.colors.text.primary};
    }
  `,
  colBtnActive: css`
    border-color: ${theme.colors.primary.border};
    color: ${theme.colors.primary.text};
  `,
  typeLabel: css`
    color: ${theme.colors.text.disabled};
    font-size: 13px;
    margin-bottom: ${theme.spacing(1)};
    text-transform: capitalize;
  `,
  sectionLabel: css`
    font-weight: ${theme.typography.fontWeightMedium};
    color: ${theme.colors.text.secondary};
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-bottom: ${theme.spacing(0.5)};
  `,
  loading: css`
    color: ${theme.colors.text.secondary};
    padding: ${theme.spacing(1)} 0;
    text-align: center;
  `,
  errorText: css`
    color: ${theme.colors.error.text};
    padding: ${theme.spacing(0.5)} 0;
  `,
  empty: css`
    color: ${theme.colors.text.secondary};
    padding: ${theme.spacing(0.5)} 0;
  `,
  row: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(0.5)};
    position: relative;
    padding: 3px 0;
    overflow: hidden;
    border-radius: 2px;

    &:hover .field-filter-btns {
      opacity: 1;
    }
  `,
  barBg: css`
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: ${theme.colors.primary.transparent};
    border-radius: 2px;
    z-index: 0;
    pointer-events: none;
  `,
  value: css`
    position: relative;
    z-index: 1;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: ${theme.colors.text.primary};
    font-family: ${theme.typography.fontFamilyMonospace};
    font-size: 13px;
  `,
  pct: css`
    position: relative;
    z-index: 1;
    color: ${theme.colors.text.secondary};
    min-width: 38px;
    text-align: right;
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  `,
  filterBtns: css`
    position: relative;
    z-index: 1;
    display: flex;
    gap: 1px;
    opacity: 0;
    transition: opacity 0.1s;
    flex-shrink: 0;
  `,
  filterBtn: css`
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 0 2px;
    color: ${theme.colors.text.secondary};
    display: flex;
    align-items: center;
    &:hover {
      color: ${theme.colors.text.primary};
    }
  `,
  caption: css`
    margin-top: ${theme.spacing(1)};
    color: ${theme.colors.text.disabled};
    font-size: 13px;
    font-style: italic;
  `,
});
