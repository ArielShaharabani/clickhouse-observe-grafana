/**
 * The data view's time field as SQL (PLAN #16d).
 *
 * A data view maps one column as its time field (`columns.timestamp`). Usually that column is a
 * ClickHouse Date / DateTime / DateTime64 and is used as is. A table can also keep event time as an
 * epoch number or as text; the view then records how to read it (`timestampFormat`) and every query
 * reads the column through a ClickHouse conversion instead. `timeExpr` is the one place that turns
 * a view into that SQL, so the time filter, histogram, sort, detail lookup, samples and the Lens
 * time axis all read the same expression.
 *
 * Security: the expression is built only from the mapped column (through `quoteIdentifier`) and a
 * fixed template per format. `timestampFormat` comes from stored config (plugin jsonData or the
 * browser's personal views), so it is checked against the enum and anything unknown is treated as
 * a native column — it is never inserted into SQL itself.
 */
import { SourceConfig, TimestampFormat } from '../types';
import { quoteIdentifier, tableRef } from './queryBuilder';
import { configSettingsFragments, withSettings } from './settings';

export const TIMESTAMP_FORMATS: Record<TimestampFormat, { label: string; description: string }> = {
  native: { label: 'Date / time column', description: 'Used as is.' },
  epoch_s: { label: 'Epoch seconds', description: 'Number of seconds since 1970-01-01 UTC.' },
  epoch_ms: { label: 'Epoch milliseconds', description: 'Number of milliseconds since 1970-01-01 UTC.' },
  epoch_us: { label: 'Epoch microseconds', description: 'Number of microseconds since 1970-01-01 UTC.' },
  epoch_ns: { label: 'Epoch nanoseconds', description: 'Number of nanoseconds since 1970-01-01 UTC.' },
  string: {
    label: 'Text date',
    description:
      'Parsed with parseDateTime64BestEffort (ISO 8601 and common formats); text without a zone is read as UTC.',
  },
};

export const EPOCH_FORMATS: TimestampFormat[] = ['epoch_s', 'epoch_ms', 'epoch_us', 'epoch_ns'];

/** Shown wherever a converted time field is chosen. */
export const CONVERTED_TIME_NOTE =
  'Converted time field: ClickHouse converts the value on every row, so time filtering and sorting are slower than on a native DateTime column and cannot use the table’s time index.';

export function isTimestampFormat(v: unknown): v is TimestampFormat {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(TIMESTAMP_FORMATS, v);
}

/** Stored value → a known format; missing or unknown means a native column. */
export function normalizeTimestampFormat(v: unknown): TimestampFormat {
  return isTimestampFormat(v) ? v : 'native';
}

/** True when the view reads its time field through a conversion. */
export function isConvertedTimestamp(config: Pick<SourceConfig, 'columns' | 'timestampFormat'>): boolean {
  return Boolean(config.columns.timestamp) && normalizeTimestampFormat(config.timestampFormat) !== 'native';
}

/**
 * The time field as SQL: '' when the view has no time field; the mapped column unchanged for a
 * native column (byte-identical to the SQL before converted fields existed); otherwise the quoted
 * column wrapped in its format's conversion.
 */
export function timeExpr(config: Pick<SourceConfig, 'columns' | 'timestampFormat'>): string {
  const col = config.columns.timestamp;
  if (!col) {
    return '';
  }
  const format = normalizeTimestampFormat(config.timestampFormat);
  if (format === 'native') {
    return col;
  }
  const q = quoteIdentifier(col);
  switch (format) {
    case 'epoch_s':
      return `toDateTime64(toInt64(${q}), 3)`;
    case 'epoch_ms':
      return `fromUnixTimestamp64Milli(toInt64(${q}))`;
    case 'epoch_us':
      return `fromUnixTimestamp64Micro(toInt64(${q}))`;
    case 'epoch_ns':
      return `fromUnixTimestamp64Nano(toInt64(${q}))`;
    case 'string':
      return `parseDateTime64BestEffortOrNull(toString(${q}), 9, 'UTC')`;
  }
}

/** Strips Nullable(...) / LowCardinality(...) wrappers from a ClickHouse type name. */
function baseType(chType: string): string {
  let t = chType.trim();
  for (;;) {
    const m = /^(?:Nullable|LowCardinality)\((.*)\)$/.exec(t);
    if (!m) {
      return t;
    }
    t = m[1].trim();
  }
}

export type TimeColumnKind = 'datetime' | 'number' | 'text' | null;

/** How a column of this ClickHouse type can serve as a time field (null = it can't). */
export function timeColumnKind(chType: string): TimeColumnKind {
  const t = baseType(chType);
  if (/^Date(32|Time(64)?)?\b/.test(t)) {
    return 'datetime';
  }
  if (/^U?Int(32|64|128|256)$/.test(t) || /^Decimal/.test(t) || /^Float64$/.test(t)) {
    return 'number';
  }
  if (/^(String|FixedString\(\d+\))$/.test(t)) {
    return 'text';
  }
  return null;
}

/** The formats a column of this kind can be read with (the first one is the default). */
export function formatsForKind(kind: TimeColumnKind): TimestampFormat[] {
  switch (kind) {
    case 'datetime':
      return ['native'];
    case 'number':
      return ['epoch_ms', 'epoch_s', 'epoch_us', 'epoch_ns'];
    case 'text':
      return ['string'];
    default:
      return [];
  }
}

/**
 * Best guess of an epoch unit from one sample value (digits in the current era: 10 → seconds,
 * 13 → ms, 16 → µs, 19 → ns). Only a default for the picker; the user can change it.
 */
export function guessEpochFormat(sample: unknown): TimestampFormat {
  const s = String(sample ?? '')
    .replace(/^-/, '')
    .split('.')[0];
  if (!/^\d+$/.test(s)) {
    return 'epoch_ms';
  }
  if (s.length <= 11) {
    return 'epoch_s';
  }
  if (s.length <= 14) {
    return 'epoch_ms';
  }
  if (s.length <= 17) {
    return 'epoch_us';
  }
  return 'epoch_ns';
}

/**
 * One recent non-zero value of a candidate time column, read to guess its epoch unit
 * (`guessEpochFormat`). Column and table go through the identifier quoting helpers.
 */
export function buildTimeSampleQuery(config: SourceConfig, table: string, column: string): string {
  const q = quoteIdentifier(column);
  return withSettings(
    [`SELECT toString(${q}) AS v`, `FROM ${tableRef(config, table)}`, `WHERE ${q} != 0`, `LIMIT 1`],
    configSettingsFragments(config)
  );
}
