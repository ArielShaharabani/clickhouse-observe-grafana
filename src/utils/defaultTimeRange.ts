import { createContext } from 'react';
import { dateMath, dateTime, TimeRange } from '@grafana/data';

/**
 * Admin default time range (app config `jsonData.defaultTimeRange`), the counterpart of Kibana's
 * `timepicker:timeDefaults`: the range Discover and Visualize open on when the URL carries none.
 * Each bound is a Grafana time expression (`now-1h`, `now`) or an absolute ISO date.
 */
export interface DefaultTimeRangeSetting {
  from: string;
  to: string;
}

const FALLBACK: DefaultTimeRangeSetting = { from: 'now-1h', to: 'now' };
const MAX_LEN = 64;

/**
 * jsonData is admin-editable and could hold anything: keep the setting only when both bounds are
 * short strings that parse as times and `from` is before `to`; otherwise fall back to the last hour.
 */
export function cleanDefaultTimeRange(raw: unknown): DefaultTimeRangeSetting {
  if (!raw || typeof raw !== 'object') {
    return FALLBACK;
  }
  const { from, to } = raw as Record<string, unknown>;
  if (typeof from !== 'string' || typeof to !== 'string') {
    return FALLBACK;
  }
  const f = from.trim();
  const t = to.trim();
  if (!f || !t || f.length > MAX_LEN || t.length > MAX_LEN) {
    return FALLBACK;
  }
  const pf = dateMath.parse(f, false);
  const pt = dateMath.parse(t, true);
  if (!pf?.isValid() || !pt?.isValid() || pf.valueOf() >= pt.valueOf()) {
    return FALLBACK;
  }
  return { from: f, to: t };
}

/** The setting resolved to a TimeRange now (relative bounds are evaluated at call time). */
export function resolveDefaultTimeRange(setting: DefaultTimeRangeSetting = FALLBACK): TimeRange {
  const s = cleanDefaultTimeRange(setting);
  const from = dateMath.parse(s.from, false) ?? dateTime(Date.now() - 3600 * 1000);
  const to = dateMath.parse(s.to, true) ?? dateTime(Date.now());
  return { from, to, raw: { from: s.from, to: s.to } };
}

/** Provided by App from the plugin's jsonData (already cleaned). */
export const DefaultTimeRangeContext = createContext<DefaultTimeRangeSetting>(FALLBACK);
