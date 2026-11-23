/**
 * Session tabs of a page (DISC-NAV-01): owns the tab list; the URL's `_tab` names the active tab,
 * and the rest of the URL is that tab's state. The page is keyed by the tab id: switching tabs
 * navigates to the target tab's params and remounts it, and every URL the page writes (it keeps
 * `_tab`) is saved back into the active tab.
 *
 * Arriving without a known `_tab`:
 *  - no `_tab` and no state (Grafana's side-menu entry): reopen the active tab;
 *  - no `_tab` but state (a link): into the active tab, or a tab of its own (`linkNeedsTab`);
 *  - an unknown `_tab` (a link from another session): open it as a new tab.
 */
import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DataViewContext } from '../components/App/App';
import {
  activate,
  addTab,
  clearClosed,
  closeTab,
  DiscoverTab,
  DiscoverTabsState,
  duplicateTab,
  initialTabsState,
  loadTabsState,
  moveTab,
  paramsWithoutTab,
  renameTab,
  restoreClosed,
  saveTabsState,
  setTabParams,
  TAB_PARAM,
  TabsStore,
} from '../state/discoverTabs';

function withTab(params: string, id: string): URLSearchParams {
  const sp = new URLSearchParams(params);
  sp.set(TAB_PARAM, id);
  return sp;
}

/** `linkNeedsTab`: a link must not replace this active tab (it holds work of its own). */
export function useSessionTabs(store: TabsStore, linkNeedsTab?: (active: DiscoverTab) => boolean) {
  const { views } = useContext(DataViewContext);
  const viewIds = useMemo(() => views.map((v) => v.id), [views]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<DiscoverTabsState>(() => loadTabsState(viewIds, store) ?? initialTabsState());
  const urlTab = searchParams.get(TAB_PARAM);
  const known = urlTab !== null && state.tabs.some((t) => t.id === urlTab);
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  });

  // Persist every change.
  useEffect(() => saveTabsState(state, store), [state, store]);

  // Resolve a URL without a known tab (see the header), then render the tab it lands on.
  useEffect(() => {
    if (known) {
      return;
    }
    const current = paramsWithoutTab(searchParams);
    const active = state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0];
    if (urlTab === null && !store.hasState(searchParams)) {
      // Visualize: a tab with no chart holds nothing to come back to: follow the last search context.
      const params = linkNeedsTab && !linkNeedsTab(active) ? '' : active.params;
      setSearchParams(withTab(params, active.id), { replace: true });
      return;
    }
    const next = urlTab !== null || linkNeedsTab?.(active) ? addTab(state, current) : state;
    if (next === state) {
      // Into the active tab (also at the tab limit).
      // Syncing from an external source (the URL), not deriving render state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState((s) => setTabParams(s, s.activeId, current));
      setSearchParams(withTab(current, state.activeId), { replace: true });
      return;
    }
    setState(next);
    setSearchParams(withTab(current, next.activeId), { replace: true });
  }, [known, urlTab, searchParams, setSearchParams, state, store, linkNeedsTab]);

  // The active tab follows the URL (back / forward between tabs), and its state follows every
  // URL write the page makes.
  useEffect(() => {
    if (known && urlTab) {
      // Syncing from an external source (the URL), not deriving render state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState((s) => setTabParams(activate(s, urlTab), urlTab, paramsWithoutTab(searchParams)));
    }
  }, [known, urlTab, searchParams]);

  const go = useCallback(
    (next: DiscoverTabsState) => {
      setState(next);
      const tab = next.tabs.find((t) => t.id === next.activeId);
      if (tab && tab.id !== urlTab) {
        setSearchParams(withTab(tab.params, tab.id));
      }
    },
    [setSearchParams, urlTab]
  );

  // A new tab keeps the current data view, nothing else.
  const newTabParams = () => {
    const ds = searchParams.get('ds');
    return ds ? new URLSearchParams({ ds }).toString() : '';
  };

  return {
    /** The open tab; undefined until the URL is resolved. */
    tabId: known && urlTab ? urlTab : undefined,
    stripProps: {
      state,
      onSelect: (id: string) => go(activate(state, id)),
      onAdd: () => go(addTab(state, newTabParams())),
      onDuplicate: (id: string) => go(duplicateTab(state, id)),
      onRename: (id: string, title: string) => setState((s) => renameTab(s, id, title)),
      onClose: (id: string) => go(closeTab(state, id)),
      onMove: (id: string, to: number) => setState((s) => moveTab(s, id, to)),
      onRestore: (id: string) => go(restoreClosed(state, id)),
      onClearClosed: () => setState((s) => clearClosed(s)),
    },
    rename: (title: string) => {
      if (urlTab) {
        setState((s) => renameTab(s, urlTab, title));
      }
    },
    /**
     * The page is being left and its tab is finished: closed (into Recently closed) for the next
     * visit. Storage only: the page still shows the tab until the navigation unmounts it.
     */
    finishOnLeave: () => {
      const s = stateRef.current;
      const id = urlTab;
      if (id) {
        saveTabsState(closeTab(s.tabs.length > 1 ? s : addTab({ ...s, activeId: id }, ''), id), store);
      }
    },
  };
}
