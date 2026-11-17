import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import { dateTime, GrafanaTheme2, toUtc } from '@grafana/data';
import { Button, Checkbox, Portal, useStyles2 } from '@grafana/ui';
import { makeFilter } from '../sql/filters';
import { FilterPill } from '../types';

export interface BucketSeries {
  name: string;
  count: number;
  color: string;
}

interface Props {
  /** Bucket start (ms) and width (ms). */
  time: number;
  bucketMs: number;
  /** Series in this bucket that can be filtered on (empty when there's no breakdown target). */
  series: BucketSeries[];
  clientX: number;
  clientY: number;
  /** Field the series split on; with `onAddFilter`, enables "Filter N selected series". */
  field?: string;
  onAddFilter?: (pill: FilterPill) => void;
  onSelectRange?: (from: number, to: number) => void;
  onClose: () => void;
}

const DAY_MS = 86_400_000;

/**
 * End of a bucket. Month and year buckets are calendar units (ClickHouse toStartOfMonth /
 * toStartOfYear, UTC), whose length varies, so they end at the next calendar boundary rather than
 * after the nominal `bucketMs`.
 */
export function bucketEnd(start: number, bucketMs: number): number {
  if (bucketMs >= 365 * DAY_MS) {
    return toUtc(start).add(1, 'year').valueOf();
  }
  if (bucketMs >= 28 * DAY_MS) {
    return toUtc(start).add(1, 'month').valueOf();
  }
  return start + bucketMs;
}

/** The filter for a set of ticked series: `field = v` for one, `field is one of [...]` for more. */
export function seriesFilter(field: string, values: string[]): FilterPill {
  return values.length === 1 ? makeFilter(field, values[0], '=') : makeFilter(field, '', 'one_of', { values });
}

/**
 * Pinned tooltip opened by right-clicking a histogram bucket (spec DISC-CHART-01): bucket time,
 * a checkbox per series, "Filter by time" (zoom to the bucket) and "Filter N selected series".
 */
export function BucketActionsPopover({ time, bucketMs, series, clientX, clientY, field, onAddFilter, onSelectRange, onClose }: Props) {
  const styles = useStyles2(getStyles);
  const ref = useRef<HTMLDivElement>(null);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [pos, setPos] = useState({ left: clientX, top: clientY });
  useEffect(() => {
    ref.current?.focus();
  }, []);
  // Keep the whole popover on screen (it's position: fixed, so nothing can scroll to it).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(clientX, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(clientY, window.innerHeight - height - 8)),
    });
  }, [clientX, clientY, series.length]);
  const canFilterSeries = !!field && !!onAddFilter && series.length > 0;
  const toggle = (name: string) =>
    setChecked((c) => {
      const next = new Set(c);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  // Only ticked series still present in the bucket count (a refresh can drop one).
  const selected = series.filter((s) => checked.has(s.name));
  const n = selected.length;
  return (
    <Portal>
      <div className={styles.backdrop} onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()} />
      <div
        ref={ref}
        role="dialog"
        aria-label="Bucket actions"
        tabIndex={-1}
        className={styles.popover}
        style={pos}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
        }}
      >
        <div className={styles.time}>{dateTime(time).format('YYYY-MM-DD HH:mm:ss')}</div>
        {canFilterSeries &&
          series.map((s) => (
            <label key={s.name} className={styles.row}>
              <Checkbox value={checked.has(s.name)} onChange={() => toggle(s.name)} aria-label={`Select series ${s.name || '(empty)'}`} />
              <span className={styles.swatch} style={{ background: s.color }} />
              <span className={styles.name}>{s.name || '(empty)'}</span>
              <span className={styles.count}>{s.count.toLocaleString()}</span>
            </label>
          ))}
        <div className={styles.actions}>
          {onSelectRange && (
            <Button
              size="sm"
              variant="secondary"
              icon="clock-nine"
              onClick={() => {
                onSelectRange(time, bucketEnd(time, bucketMs));
                onClose();
              }}
            >
              Filter by time
            </Button>
          )}
          {canFilterSeries && (
            <Button
              size="sm"
              variant="primary"
              icon="filter"
              disabled={n === 0}
              onClick={() => {
                onAddFilter!(seriesFilter(field!, selected.map((s) => s.name)));
                onClose();
              }}
            >
              {`Filter ${n} selected series`}
            </Button>
          )}
        </div>
      </div>
    </Portal>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  backdrop: css`
    position: fixed;
    inset: 0;
    z-index: 9999;
  `,
  popover: css`
    position: fixed;
    z-index: 10000;
    min-width: 220px;
    max-width: 280px;
    padding: ${theme.spacing(1)};
    background: ${theme.colors.background.primary};
    border: 1px solid ${theme.colors.border.medium};
    border-radius: ${theme.shape.radius.default};
    box-shadow: ${theme.shadows.z3};
    display: flex;
    flex-direction: column;
    gap: ${theme.spacing(0.5)};
    outline: none;
  `,
  time: css`
    font-weight: ${theme.typography.fontWeightMedium};
    font-variant-numeric: tabular-nums;
  `,
  row: css`
    display: flex;
    align-items: center;
    gap: ${theme.spacing(1)};
    cursor: pointer;
  `,
  swatch: css`
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex-shrink: 0;
  `,
  name: css`
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  `,
  count: css`
    color: ${theme.colors.text.secondary};
    font-variant-numeric: tabular-nums;
  `,
  actions: css`
    display: flex;
    flex-wrap: wrap;
    gap: ${theme.spacing(0.5)};
    margin-top: ${theme.spacing(0.5)};
  `,
});
