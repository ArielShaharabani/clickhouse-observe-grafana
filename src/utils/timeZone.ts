import { useSyncExternalStore } from 'react';
import {
  DateTime,
  dateTimeForTimeZone,
  getTimeZone,
  getZone,
  InternalTimeZones,
  RawTimeRange,
  rangeUtil,
  TimeRange,
  TimeZone,
} from '@grafana/data';

/**
 * The time zone every user-visible time is shown in, and the fiscal year start month relative
 * ranges (`now/fQ`) resolve against. The default is Grafana's own preference (user / org / server);
 * the picker in the time range popup overrides it, persisted per browser in localStorage.
 */
export interface TimeZoneSettings {
  timeZone: TimeZone;
  /** 0 = January ... 11 = December. */
  fiscalYearStartMonth: number;
}

const STORAGE_KEY = 'clickhouse-observe.timeSettings';
const IANA_RE = /^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+){0,3}$/;

/** 'browser', 'utc' or an IANA id that both moment-timezone (formatting) and Intl (the browser) know. */
export function isValidTimeZone(v: unknown): v is TimeZone {
  if (typeof v !== 'string') {
    return false;
  }
  if (v === InternalTimeZones.localBrowserTime || v === InternalTimeZones.utc) {
    return true;
  }
  if (v.length > 64 || !IANA_RE.test(v)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
    return getZone(v) !== null;
  } catch {
    return false;
  }
}

/** A zone name safe to hand to ClickHouse as a timezone argument ('utc' -> 'UTC'; the browser's own IANA id). */
export function toServerTimeZone(tz: TimeZone): string | undefined {
  if (tz === InternalTimeZones.utc || tz.toLowerCase() === 'utc') {
    return 'UTC';
  }
  if (tz === InternalTimeZones.localBrowserTime) {
    try {
      const id = Intl.DateTimeFormat().resolvedOptions().timeZone;
      return isValidTimeZone(id) ? id : undefined;
    } catch {
      return undefined;
    }
  }
  return isValidTimeZone(tz) ? tz : undefined;
}

export const validFiscalMonth = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 11;

interface Pick {
  timeZone?: TimeZone;
  fiscalYearStartMonth?: number;
}

/** localStorage is untrusted: keep only the two validated fields. */
function readPick(): Pick {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: Pick = {};
    if (o && typeof o === 'object') {
      if (isValidTimeZone(o.timeZone)) {
        out.timeZone = o.timeZone;
      }
      if (validFiscalMonth(o.fiscalYearStartMonth)) {
        out.fiscalYearStartMonth = o.fiscalYearStartMonth;
      }
    }
    return out;
  } catch {
    return {};
  }
}

function writePick(p: Pick) {
  try {
    if (p.timeZone === undefined && p.fiscalYearStartMonth === undefined) {
      window.localStorage.removeItem(STORAGE_KEY);
    } else {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
    }
  } catch {
    // Storage blocked: the choice lasts for this page load only.
  }
}

let pick: Pick | undefined;
let snapshot: TimeZoneSettings | undefined;
const listeners = new Set<() => void>();

function grafanaZone(): TimeZone {
  try {
    const z = getTimeZone();
    return z && (isValidTimeZone(z) || z === InternalTimeZones.default) ? z || 'browser' : 'browser';
  } catch {
    return 'browser';
  }
}

export function getTimeZoneSettings(): TimeZoneSettings {
  pick = pick ?? readPick();
  const timeZone = pick.timeZone ?? grafanaZone();
  const fiscalYearStartMonth = pick.fiscalYearStartMonth ?? 0;
  if (!snapshot || snapshot.timeZone !== timeZone || snapshot.fiscalYearStartMonth !== fiscalYearStartMonth) {
    snapshot = { timeZone, fiscalYearStartMonth };
  }
  return snapshot;
}

function emit() {
  listeners.forEach((l) => l());
}

/** What the picker emits: a zone, or '' / undefined for its "Default" option (back to Grafana's preference). */
export function setTimeZone(tz: string | undefined) {
  pick = { ...(pick ?? readPick()) };
  if (tz === undefined || tz === InternalTimeZones.default) {
    delete pick.timeZone;
  } else if (isValidTimeZone(tz)) {
    pick.timeZone = tz;
  } else {
    return;
  }
  writePick(pick);
  emit();
}

export function setFiscalYearStartMonth(month: number) {
  if (!validFiscalMonth(month)) {
    return;
  }
  pick = { ...(pick ?? readPick()) };
  if (month === 0) {
    delete pick.fiscalYearStartMonth;
  } else {
    pick.fiscalYearStartMonth = month;
  }
  writePick(pick);
  emit();
}

/** Test hook: forget the cached pick so the next read goes to localStorage again. */
export function resetTimeZoneStoreForTests() {
  pick = undefined;
  snapshot = undefined;
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Re-renders the component when the zone or fiscal month changes. */
export function useTimeZoneSettings(): TimeZoneSettings {
  return useSyncExternalStore(subscribe, getTimeZoneSettings, getTimeZoneSettings);
}

/** The instant as a DateTime in the chosen zone (format with `.format(...)`). */
export function zonedDateTime(ms: number | DateTime, tz: TimeZone = getTimeZoneSettings().timeZone): DateTime {
  return dateTimeForTimeZone(tz, typeof ms === 'number' ? ms : ms.valueOf());
}

/** Format an instant in the chosen zone. */
export function formatInZone(ms: number, format: string, tz?: TimeZone): string {
  return zonedDateTime(ms, tz).format(format);
}

/** Parse wall-clock text (e.g. 'YYYY-MM-DD HH:mm') as being in the chosen zone. */
export function parseInZone(text: string, format: string, tz: TimeZone = getTimeZoneSettings().timeZone): DateTime {
  return dateTimeForTimeZone(tz, text, format);
}

/** Resolve a raw (possibly relative, rounded) range in the chosen zone and fiscal month. */
export function resolveRange(raw: RawTimeRange, s: TimeZoneSettings = getTimeZoneSettings()): TimeRange {
  return rangeUtil.convertRawToRange(raw, s.timeZone, s.fiscalYearStartMonth);
}

/** Re-resolve a range whose bounds are relative; absolute ranges come back untouched (same instants). */
export function reresolveRange(range: TimeRange, s: TimeZoneSettings = getTimeZoneSettings()): TimeRange {
  const { from, to } = range.raw;
  if (typeof from !== 'string' && typeof to !== 'string') {
    return range;
  }
  return resolveRange(range.raw, s);
}
