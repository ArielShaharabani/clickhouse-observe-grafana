/**
 * Visualize side of "Edit in Visualize" for any panel (R6-PANELS). A link with `pi=1` names a
 * dashboard panel only; this hook loads the dashboard (read only), converts the panel
 * (`importPanel`), switches to the matching data view, writes the chart / search / filters into the
 * URL once (`pi=<token>.k`: applied) and, when the view's fields are known, runs `finishImport`. The result
 * says what was not carried over; the save actions use it (SaveActions). A reload keeps `.k`:
 * the analysis runs again but the URL, which may hold the user's edits, is left alone.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { SetURLSearchParams } from 'react-router-dom';
import { errMsg } from '../errMsg';
import { DataView } from '../types';
import { finishImport, importPanel, PanelImport } from './panelImport';
import { loadDashboardPanel } from './panelImportLoad';
import { IMPORT_PARAM, readDashboardReturn } from './panelSource';
import { encodeLens, isEmptyLens, LensField } from './state';

interface Stage {
  key: string;
  r?: PanelImport;
  error?: string;
  apply: boolean;
  applied: boolean;
  finished: boolean;
}

interface Args {
  paramsKey: string;
  setSearchParams: SetURLSearchParams;
  views: DataView[];
  activeViewId?: string;
  setActiveViewId: (id: string) => void;
  fields: LensField[];
  /** The active view's fields are published and discovery is done. */
  fieldsReady: boolean;
  timestamp: string;
}

export interface PanelImportState {
  /** Undefined when the page was not opened by converting a panel (or it has not loaded yet). */
  imported?: PanelImport;
  /** Loading, converting or waiting for the data view's fields. */
  pending: boolean;
  error?: string;
}

export function usePanelImport(a: Args): PanelImportState {
  const { paramsKey, setSearchParams, views, activeViewId, setActiveViewId, fields, fieldsReady, timestamp } = a;
  const sp = useMemo(() => new URLSearchParams(paramsKey), [paramsKey]);
  const ret = readDashboardReturn(sp);
  const tm = /^([a-z0-9]{1,12})(\.k)?$/.exec(sp.get(IMPORT_PARAM) ?? '');
  const token = tm?.[1] ?? '';
  const applyMode = !!tm && !tm[2];
  const key = ret && tm ? `${ret.uid}:${ret.panelId}:${token}` : '';
  const [stage, setStage] = useState<Stage | null>(null);
  const viewsRef = useRef(views);
  useLayoutEffect(() => {
    viewsRef.current = views;
  });

  // Load and convert (once per link).
  useEffect(() => {
    if (!key || !ret) {
      return;
    }
    let cancelled = false;
    loadDashboardPanel(ret.uid, ret.panelId).then(
      (lp) => {
        if (!cancelled) {
          const r = importPanel(lp.panel, viewsRef.current);
          setStage({ key, r, apply: applyMode, applied: false, finished: false });
        }
      },
      (e) => {
        if (!cancelled) {
          setStage({ key, error: errMsg(e), apply: false, applied: true, finished: true });
          if (applyMode) {
            setSearchParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.set(IMPORT_PARAM, `${token}.k`);
                return next;
              },
              { replace: true }
            );
          }
        }
      }
    );
    return () => {
      cancelled = true;
    };
    // One load per link; views are read as they are then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const cur = stage && stage.key === key ? stage : null;

  // Apply: the data view first (the page's own view-switch handling rewrites filters), then the URL.
  useEffect(() => {
    if (!cur?.r || !cur.apply || cur.applied) {
      return;
    }
    const r = cur.r;
    if (r.view && activeViewId !== r.view.id) {
      setActiveViewId(r.view.id);
      return;
    }
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const k of ['lens', 'q', 'filters']) {
          next.delete(k);
        }
        if (r.view) {
          next.set('ds', r.view.id);
        }
        if (r.lens && !isEmptyLens(r.lens)) {
          next.set('lens', encodeLens(r.lens));
        }
        if (r.search) {
          next.set('q', r.search);
        }
        if (r.filters.length > 0) {
          next.set('filters', JSON.stringify(r.filters));
        }
        next.set(IMPORT_PARAM, `${token}.k`);
        return next;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStage({ ...cur, applied: true, finished: !r.lens });
  }, [cur, activeViewId, setActiveViewId, setSearchParams, token]);

  // Finish: once the view's fields are known, keep only real fields, say what was dropped.
  useEffect(() => {
    if (!cur?.r?.lens || cur.finished || !cur.applied || !fieldsReady || (cur.r.view && activeViewId !== cur.r.view.id)) {
      return;
    }
    const r = cur.r;
    const fin = finishImport(r.lens!, fields, timestamp);
    const notes = [...r.notes, ...fin.notes];
    const empty = isEmptyLens(fin.lens);
    const next: PanelImport = empty
      ? { ...r, kind: 'unsupported', lens: undefined, reason: fin.notes[0] ?? 'The chart could not be converted', notes: [fin.notes[0] ?? 'The chart could not be converted'] }
      : { ...r, lens: fin.lens, notes, kind: r.kind === 'ok' && fin.notes.length > 0 ? 'partial' : r.kind };
    if (cur.apply && encodeLens(fin.lens) !== encodeLens(r.lens!)) {
      setSearchParams(
        (prev) => {
          const sp2 = new URLSearchParams(prev);
          if (empty) {
            sp2.delete('lens');
          } else {
            sp2.set('lens', encodeLens(fin.lens));
          }
          return sp2;
        },
        { replace: true }
      );
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStage({ ...cur, r: next, finished: true });
  }, [cur, fieldsReady, fields, timestamp, activeViewId, setSearchParams]);

  return {
    imported: cur?.r,
    pending: !!key && (!cur || (!cur.error && !cur.finished)),
    error: cur?.error,
  };
}
