import React, { createContext, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { startAutoEnrichment } from '../../diag/autoEnrich';
import { AppRootProps, getDefaultTimeRange, PageLayoutType } from '@grafana/data';
import { PluginPage } from '@grafana/runtime';
import { LoadingPlaceholder } from '@grafana/ui';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { prefixRoute } from '../../utils/utils.routing';
import { useFieldDiscovery } from '../FieldsContext';
import {
  AiProviderConfig,
  AppJsonData,
  DataView,
  DEFAULT_SOURCE_CONFIG,
  SourceConfig,
} from '../../types';
import {
  deletePersonalView as deletePVStorage,
  getActiveViewId,
  loadPersonalViews,
  mergeViews,
  migrateLegacyConfig,
  persistActiveViewId,
  savePersonalView,
  updatePersonalView as updatePVStorage,
} from '../../data/dataViews';
import { decodeLogsState } from '../../data/urlState';
import { getRememberedView, rememberView, resolveTraceLanding, TraceLanding } from '../../data/traceViewChoice';
import { TraceViewPickerModal } from '../TraceViewPickerModal';
import { cleanDefaultTimeRange, DefaultTimeRangeContext } from '../../utils/defaultTimeRange';

// Visualize is its own chunk: Discover users never pay for it.
const LensPage = React.lazy(() => import('../../lens/LensPage').then((m) => ({ default: m.LensPage })));

// Surrounding documents (DISC-DOC-02), reached from the detail panel.
const ContextView = React.lazy(() => import('../../pages/ContextView').then((m) => ({ default: m.ContextView })));
const SingleDocView = React.lazy(() => import('../../pages/SingleDocView').then((m) => ({ default: m.SingleDocView })));

// Discover with its session tabs (DISC-NAV-01) wrapping LogsExplorer.
const LogsExplorer = React.lazy(() =>
  import('../../pages/DiscoverTabsHost').then((m) => ({ default: m.DiscoverTabsHost }))
);

/** Shared context so all pages can access the current SourceConfig (= active DataView). */
export const SourceConfigContext = createContext<SourceConfig>(DEFAULT_SOURCE_CONFIG);

/** AI column-mapping assist settings (admin-configured) — null when never configured. */
export const AiConfigContext = createContext<AiProviderConfig | null>(null);

export interface DataViewContextValue {
  views: DataView[];
  activeView: DataView | null;
  setActiveViewId: (id: string) => void;
  createPersonalView: (view: Omit<DataView, 'id' | 'createdAt' | 'origin'>) => DataView;
  updatePersonalView: (id: string, updates: Omit<DataView, 'id' | 'createdAt' | 'origin'>) => void;
  deletePersonalView: (id: string) => void;
}

export const DataViewContext = createContext<DataViewContextValue>({
  views: [],
  activeView: null,
  setActiveViewId: () => {},
  createPersonalView: () => { throw new Error('DataViewContext not mounted'); },
  updatePersonalView: () => {},
  deletePersonalView: () => {},
});

// Stable fallback so `jsonData` doesn't get a fresh object identity every render when
// `props.meta.jsonData` is unset — otherwise the useMemo below would never hit its cache.
const EMPTY_JSON_DATA: AppJsonData = {};

function App(props: AppRootProps<AppJsonData>) {
  const jsonData = props.meta.jsonData ?? EMPTY_JSON_DATA;

  // Shared views from jsonData (admin-managed); migrate from legacy sourceConfig if needed.
  const sharedViews = useMemo(() => migrateLegacyConfig(jsonData), [jsonData]);
  const defaultTime = useMemo(() => cleanDefaultTimeRange(jsonData.defaultTimeRange), [jsonData]);

  // Personal views from localStorage (per-browser, per-user).
  const [personalViews, setPersonalViews] = useState<DataView[]>(() => loadPersonalViews());

  const allViews = useMemo(() => mergeViews(sharedViews, personalViews), [sharedViews, personalViews]);

  // Inbound trace->logs deep link (?traceId=&dsUid=…, see data/traceToLogsLink.ts). Decoded once
  // at mount, independent of react-router — App.tsx renders above LogsExplorer's <Route>-less
  // Suspense boundary and must resolve which Data View to activate *before* LogsExplorer (and its
  // queries) mounts, so it can't wait on router context the way LogsExplorer's own useSearchParams
  // does. window.location.search is read here for that reason, not out of router-avoidance alone.
  const [dsUid] = useState<string | undefined>(
    () => decodeLogsState(new URLSearchParams(window.location.search)).dsUid
  );
  const [urlViewId] = useState<string | undefined>(
    () => new URLSearchParams(window.location.search).get('ds') ?? undefined
  );
  // Once a view is picked (automatically, or via the picker modal below) for this dsUid, later
  // manual view switches during this mount refine the remembered preference for it — see
  // setActiveViewId below. Doesn't persist across an unrelated future visit without its own
  // dsUid, by design: the preference is scoped to "arrived here via a trace from this datasource".
  const traceDsUidRef = useRef<string | undefined>(dsUid);

  // Resolves dsUid -> a single Data View, or flags that a user choice is needed (several views on
  // that datasource, or none) — see traceViewChoice.ts's doc comment for why this can't be a
  // silent guess. `status: 'none'` (no dsUid at all) is the everyday case and short-circuits
  // immediately.
  const [traceLanding, setTraceLanding] = useState<TraceLanding>(() =>
    resolveTraceLanding(allViews, dsUid, dsUid ? getRememberedView(dsUid) : null)
  );

  // Active view ID: an already-resolved trace landing wins over everything else — it's a link the
  // user just clicked, more specific than whatever was merely left over from a prior session.
  // Otherwise: prefer stored value, fall back to defaultDataViewId, then first view.
  const [activeViewId, setActiveViewIdState] = useState<string | null>(() => {
    if (traceLanding.status === 'resolved') {
      return traceLanding.viewId;
    }
    const available = [...sharedViews, ...loadPersonalViews()];
    // A link's `ds` that names a known view wins over the stored/default one: the page would
    // switch to it right after mount anyway (LogsExplorer / LensPage), and mounting on the
    // default view first made App discover that view's schema for nothing (PERF-METADATA).
    const urlView = urlViewId ? available.find((v) => v.id === urlViewId) : undefined;
    if (urlView) {
      return urlView.id;
    }
    const stored = getActiveViewId();
    if (stored && available.some((v) => v.id === stored)) {
      return stored;
    }
    return jsonData.defaultDataViewId ?? available[0]?.id ?? null;
  });

  const activeView = useMemo(
    () => allViews.find((v) => v.id === activeViewId) ?? allViews[0] ?? null,
    [allViews, activeViewId]
  );

  const setActiveViewId = useCallback((id: string) => {
    setActiveViewIdState(id);
    persistActiveViewId(id);
    // This session was reached via a trace link — a manual switch afterward is the user
    // correcting/refining which view that datasource's traces should land on, so update the
    // remembered choice too (see traceViewChoice.ts).
    if (traceDsUidRef.current) {
      rememberView(traceDsUidRef.current, id);
    }
  }, []);

  const createPersonalView = useCallback(
    (view: Omit<DataView, 'id' | 'createdAt' | 'origin'>) => {
      const saved = savePersonalView(view);
      setPersonalViews((prev) => [...prev, saved]);
      return saved;
    },
    []
  );

  const updatePersonalView = useCallback(
    (id: string, updates: Omit<DataView, 'id' | 'createdAt' | 'origin'>) => {
      const saved = updatePVStorage(id, updates);
      if (saved) {
        setPersonalViews((prev) => prev.map((v) => (v.id === id ? saved : v)));
      }
    },
    []
  );

  const deletePersonalView = useCallback((id: string) => {
    deletePVStorage(id);
    setPersonalViews((prev) => prev.filter((v) => v.id !== id));
    // If deleted view was active, fall back to first remaining view.
    setActiveViewIdState((prev) => {
      if (prev !== id) {
        return prev;
      }
      const remaining = allViews.filter((v) => v.id !== id);
      return remaining[0]?.id ?? null;
    });
  }, [allViews]);

  // The active view (a DataView) is assignable to SourceConfig — existing consumers unchanged.
  const rawSourceConfig: SourceConfig = activeView ?? DEFAULT_SOURCE_CONFIG;

  // Stable placeholder — Phase A discovery (system.columns) doesn't filter by time, so this only
  // exists to give useFieldDiscovery a TimeRange argument; a fresh object every render would churn
  // its coarse-bucket effect dependency for no reason.
  const [discoveryTimeRange] = useState(() => getDefaultTimeRange());
  // Runtime fallback so an already-persisted view benefits from index pruning (item 0) without
  // being re-saved: useFieldDiscovery detects a coarse prune column from system.columns' widened
  // metadata (see sql/pruneColumn.ts); if this view never explicitly configured
  // columns.partitionTimestamp ('' = auto-detect), fill in whatever was detected. An explicit
  // '-' (off) or a literal column name from the persisted view always wins over detection.
  // Every query-building consumer reads SourceConfig through SourceConfigContext below, so this is
  // the one place this fallback needs to be applied.
  const { detectedPartitionTimestamp } = useFieldDiscovery(rawSourceConfig, discoveryTimeRange, { columnsOnly: true });
  const sourceConfig: SourceConfig = useMemo(() => {
    if (rawSourceConfig.columns.partitionTimestamp) {
      // Already explicit (a real column name, or '-' for off) — never overridden by detection.
      return rawSourceConfig;
    }
    if (!detectedPartitionTimestamp) {
      return rawSourceConfig;
    }
    return {
      ...rawSourceConfig,
      columns: { ...rawSourceConfig.columns, partitionTimestamp: detectedPartitionTimestamp },
    };
  }, [rawSourceConfig, detectedPartitionTimestamp]);

  // Diagnostics' server-side enrichment tier (see diag/autoEnrich.ts) is wired once here, at the
  // top of the app, rather than inside LogsExplorer — capture must happen regardless of which page
  // is mounted or whether the diagnostics drawer is open (see the diagnostics plan's "Capture
  // scope"). The context getter reads a ref, not `sourceConfig` directly, since
  // startAutoEnrichment subscribes exactly once (see its own idempotency doc comment) and the
  // closure it's given must still see the *current* active view on every later call, not the one
  // that was active at mount.
  const sourceConfigRef = useRef(sourceConfig);
  useLayoutEffect(() => {
    sourceConfigRef.current = sourceConfig;
  });
  useEffect(() => {
    return startAutoEnrichment(() => {
      const config = sourceConfigRef.current;
      return config.datasourceUid ? { datasourceUid: config.datasourceUid, config } : undefined;
    });
  }, []);

  const handleTraceViewChoice = useCallback(
    (view: DataView, remember: boolean) => {
      setActiveViewId(view.id);
      if (remember && traceDsUidRef.current) {
        rememberView(traceDsUidRef.current, view.id);
      }
      setTraceLanding({ status: 'resolved', viewId: view.id });
    },
    [setActiveViewId]
  );

  // Dismissed without picking — activeViewId was already computed via the ordinary
  // stored/default chain (the 'choosing' branch never wins that initializer), so unblocking
  // LogsExplorer here just lets it mount against whatever that chain already picked.
  const handleTraceViewDismiss = useCallback(() => {
    setTraceLanding({ status: 'none' });
  }, []);

  return (
    <DataViewContext.Provider
      value={{ views: allViews, activeView, setActiveViewId, createPersonalView, updatePersonalView, deletePersonalView }}
    >
      <AiConfigContext.Provider value={jsonData.ai ?? null}>
        <SourceConfigContext.Provider value={sourceConfig}>
          <DefaultTimeRangeContext.Provider value={defaultTime}>
          {traceLanding.status === 'choosing' ? (
            <TraceViewPickerModal
              landing={traceLanding}
              onChoose={handleTraceViewChoice}
              onDismiss={handleTraceViewDismiss}
            />
          ) : (
            <Suspense fallback={<LoadingPlaceholder text="Loading…" />}>
              <AppRoutes />
            </Suspense>
          )}
          </DefaultTimeRangeContext.Provider>
        </SourceConfigContext.Provider>
      </AiConfigContext.Provider>
    </DataViewContext.Provider>
  );
}

/**
 * Page routes, relative to the app root (`/a/<plugin-id>/`). Every page shares the providers
 * above (data views, source config, AI config). Unknown paths fall back to `logs`, keeping the
 * query string so shared links that predate a page still open with their state.
 */
function AppRoutes() {
  const location = useLocation();
  return (
    <Routes>
      <Route path="logs" element={<LogsExplorer />} />
      <Route path="context/:viewId/:anchor" element={<ContextView />} />
      <Route path="doc/:viewId/:anchor" element={<SingleDocView />} />
      <Route
        path="visualize"
        element={
          <React.Suspense fallback={<LoadingPlaceholder text="Loading Visualize…" />}>
            {/* PluginPage ties the page to its nav entry, so the side menu always marks Visualize active (as Discover does). */}
            <PluginPage layout={PageLayoutType.Custom}>
              <LensPage />
            </PluginPage>
          </React.Suspense>
        }
      />
      <Route path="*" element={<Navigate to={{ pathname: prefixRoute('logs'), search: location.search }} replace />} />
    </Routes>
  );
}

export default App;
