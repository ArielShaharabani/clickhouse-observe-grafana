/**
 * The data view's time field picker (PLAN #16d), shared by "Create data view" and the shared data
 * views on the Configuration page.
 *
 * Lists every column that can serve as event time: Date / DateTime columns as is, and numeric or
 * text columns read through a conversion (epoch unit / date parsing, see src/sql/timeExpr.ts). A
 * converted choice is flagged here, since ClickHouse then converts the value on every row.
 */
import React, { useEffect, useMemo, useRef } from 'react';
import { css } from '@emotion/css';
import { dateTime, GrafanaTheme2, SelectableValue, TimeRange } from '@grafana/data';
import { Field, Select, useStyles2 } from '@grafana/ui';
import { SourceConfig, TimestampFormat } from '../../types';
import { runQueryRows } from '../../data/runQuery';
import {
  buildTimeSampleQuery,
  CONVERTED_TIME_NOTE,
  guessEpochFormat,
  EPOCH_FORMATS,
  formatsForKind,
  normalizeTimestampFormat,
  TIMESTAMP_FORMATS,
  TimeColumnKind,
  timeColumnKind,
} from '../../sql/timeExpr';

export const NO_TIME_VALUE = '__no_time__';

export const NO_TIME_NOTE =
  'Without a time field there is no time range: every search reads the whole table, and the histogram and time picker are hidden. Fine for small reference tables; event and log tables should use a time column.';

export interface TimeFieldColumn {
  name: string;
  type: string;
}

interface TimeFieldSelectProps {
  /** The table's columns (name + ClickHouse type); empty while unknown. */
  columns: TimeFieldColumn[];
  /** Mapped time column ('' = no time field); undefined = nothing chosen yet. */
  timestamp: string | undefined;
  format: TimestampFormat | undefined;
  onChange: (timestamp: string, format: TimestampFormat) => void;
  /** Reads one value of a numeric column and guesses its epoch unit; omitted = epoch_ms default. */
  guessEpoch?: (column: string) => Promise<TimestampFormat | undefined>;
  /** Free-typed column names (when the column list can't be loaded); read as a native column. */
  allowCustomValue?: boolean;
  width?: number;
}

const KIND_DESCRIPTION: Record<Exclude<TimeColumnKind, null>, string> = {
  datetime: 'date/time type',
  number: 'number — converted from epoch',
  text: 'text — parsed as a date',
};

export function TimeFieldSelect({
  columns,
  timestamp,
  format,
  onChange,
  guessEpoch,
  allowCustomValue,
  width = 36,
}: TimeFieldSelectProps) {
  const styles = useStyles2(getStyles);
  const kindByName = useMemo(() => new Map(columns.map((c) => [c.name, timeColumnKind(c.type)])), [columns]);

  const options = useMemo(() => {
    const opts: Array<SelectableValue<string>> = [{ label: '— No time field', value: NO_TIME_VALUE }];
    // Native date/time columns first: they are the usual choice and the only ones the time index helps.
    for (const kind of ['datetime', 'number', 'text'] as const) {
      for (const c of columns) {
        if (timeColumnKind(c.type) === kind) {
          opts.push({ label: c.name, value: c.name, description: `${KIND_DESCRIPTION[kind]} (${c.type})` });
        }
      }
    }
    if (timestamp && !kindByName.has(timestamp)) {
      opts.push({ label: timestamp, value: timestamp });
    }
    return opts;
  }, [columns, kindByName, timestamp]);

  const kind = timestamp ? (kindByName.get(timestamp) ?? null) : null;
  const current = normalizeTimestampFormat(format);
  const converted = Boolean(timestamp) && current !== 'native';

  // A guess lands asynchronously; drop it if the user picked something else meanwhile.
  const latest = useRef(timestamp);
  useEffect(() => {
    latest.current = timestamp;
  }, [timestamp]);

  function pickColumn(col: string) {
    if (col === NO_TIME_VALUE) {
      onChange('', 'native');
      return;
    }
    const k = kindByName.get(col) ?? null;
    const formats = formatsForKind(k);
    // Unknown type (typed by hand, or columns not loaded): read as a native column.
    const first: TimestampFormat = formats[0] ?? 'native';
    latest.current = col;
    onChange(col, first);
    if (k === 'number' && guessEpoch) {
      guessEpoch(col)
        .then((g) => {
          if (g && latest.current === col && g !== first) {
            onChange(col, g);
          }
        })
        .catch(() => {
          // Keep the default unit; the user can change it.
        });
    }
  }

  const value = timestamp === undefined ? undefined : timestamp || NO_TIME_VALUE;
  const epochOptions = EPOCH_FORMATS.map((f) => ({
    label: TIMESTAMP_FORMATS[f].label,
    value: f,
    description: TIMESTAMP_FORMATS[f].description,
  }));

  return (
    <>
      <Field
        label="Timestamp field"
        description='The column that holds the event time, or "No time field" for timeless tables. Number and text columns are converted to a time.'
        required
      >
        <Select
          width={width}
          value={value}
          options={options}
          onChange={(opt) => pickColumn(opt?.value ?? NO_TIME_VALUE)}
          placeholder="Select timestamp column…"
          aria-label="Timestamp field"
          allowCustomValue={allowCustomValue}
          onCreateOption={allowCustomValue ? (v) => pickColumn(v.trim()) : undefined}
        />
      </Field>
      {timestamp && (kind === 'number' || EPOCH_FORMATS.includes(current)) && (
        <Field label="Epoch unit" description="How the number counts time since 1970-01-01 UTC.">
          <Select
            width={width}
            value={EPOCH_FORMATS.includes(current) ? current : undefined}
            options={epochOptions}
            onChange={(opt) => onChange(timestamp, opt?.value ?? 'epoch_ms')}
            aria-label="Epoch unit"
          />
        </Field>
      )}
      {timestamp === '' && (
        <div className={styles.note} data-testid="no-time-note">
          {NO_TIME_NOTE}
        </div>
      )}
      {converted && (
        <div className={styles.note} data-testid="converted-time-note">
          <strong>{TIMESTAMP_FORMATS[current].label}.</strong>{' '}
          {current === 'string' ? `${TIMESTAMP_FORMATS.string.description} ` : ''}
          {CONVERTED_TIME_NOTE}
        </div>
      )}
    </>
  );
}

const getStyles = (theme: GrafanaTheme2) => ({
  note: css`
    margin: ${theme.spacing(-1, 0, 2)};
    padding: ${theme.spacing(1)};
    border-left: 3px solid ${theme.colors.warning.border};
    background: ${theme.colors.background.secondary};
    color: ${theme.colors.text.secondary};
    font-size: ${theme.typography.bodySmall.fontSize};
    max-width: 640px;
  `,
});

/** `guessEpoch` for a table: reads one value (buildTimeSampleQuery) and guesses its unit. */
export function epochGuesser(config: SourceConfig, table: string) {
  return async (column: string): Promise<TimestampFormat | undefined> => {
    const rows = await runQueryRows({
      datasourceUid: config.datasourceUid,
      sql: buildTimeSampleQuery(config, table, column),
      timeRange: schemaTimeRange(),
      op: 'wizardTimeSample',
    });
    return rows.length > 0 ? guessEpochFormat(rows[0]['v']) : undefined;
  };
}

/** A minimal valid time range for schema-only queries (they carry no time filter). */
export function schemaTimeRange(): TimeRange {
  const now = Date.now();
  return { from: dateTime(now - 3600 * 1000), to: dateTime(now), raw: { from: 'now-1h', to: 'now' } };
}
