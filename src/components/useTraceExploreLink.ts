/**
 * Resolves a trace id to a ClickHouse Explore trace-view URL, backed by the per-datasource
 * link template in ../data/traceLinks. Returns `undefined` per trace id while the template is
 * loading or when the datasource has no Traces config — callers should treat that as "no link".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { TimeRange } from '@grafana/data';
import { buildTraceExploreHref, getTraceLinkTemplate, TraceLinkTemplate } from '../data/traceLinks';

interface Resolved {
  datasourceUid: string;
  template: TraceLinkTemplate | null;
}

export function useTraceExploreLink(
  datasourceUid: string | undefined,
  timeRange: TimeRange
): (traceId: string) => string | undefined {
  const [resolved, setResolved] = useState<Resolved | null>(null);
  // Guards against a stale resolution (from a previous datasourceUid) landing after the uid
  // has already changed again.
  const requestId = useRef(0);
  // The probe (`SELECT '' AS traceID`, to read the datasource's "View trace" link template) is
  // lazy: it only runs once something asks for a link (the detail drawer on a trace id), not on
  // every page load. Reset when the datasource changes.
  const [wanted, setWanted] = useState<string | null>(null);
  const timeRangeRef = useRef(timeRange);
  useEffect(() => {
    timeRangeRef.current = timeRange;
  });

  useEffect(() => {
    if (!datasourceUid || wanted !== datasourceUid) {
      return;
    }
    const thisRequest = ++requestId.current;
    getTraceLinkTemplate(datasourceUid, timeRangeRef.current).then((template) => {
      if (requestId.current === thisRequest) {
        setResolved({ datasourceUid, template });
      }
    });
    // Only re-probe when the datasource changes — the template has no time-range dependency
    // (see traceLinks.ts).
  }, [datasourceUid, wanted]);

  // Derived during render (not stored) so a template resolved for a since-replaced datasourceUid
  // is never used — no dedicated "reset on prop change" effect/ref needed.
  const template = resolved && resolved.datasourceUid === datasourceUid ? resolved.template : null;

  return useCallback(
    (traceId: string) => {
      if (!template && datasourceUid && wanted !== datasourceUid) {
        // Called during render: schedule the state update instead of making it inline.
        queueMicrotask(() => setWanted(datasourceUid));
      }
      return template ? buildTraceExploreHref(template, traceId, timeRange) : undefined;
    },
    [template, timeRange, datasourceUid, wanted]
  );
}
