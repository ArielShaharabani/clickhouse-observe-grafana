/**
 * Discover with session tabs (DISC-NAV-01). Owns the tab list; the URL's `_tab` names the active
 * tab, and the rest of the URL is that tab's Discover state. LogsExplorer decodes its URL once at
 * mount, so it is keyed by the tab id: switching tabs navigates to the target tab's params and
 * remounts it. LogsExplorer keeps `_tab` in every URL it writes, and each write is saved back into
 * the active tab (so the shared search context / last search follow the active tab as before).
 *
 * Arriving without a known `_tab`:
 *  - no `_tab` and no Discover state (Grafana's side-menu entry): reopen the active tab;
 *  - no `_tab` but Discover state (a link, Explore in Discover, a trace deep link): load it into
 *    the active tab;
 *  - an unknown `_tab` (a link from another session): open it as a new tab.
 */
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DataViewContext } from '../components/App/App';
import { DiscoverTabs } from '../components/DiscoverTabs/DiscoverTabs';
import {
  activate,
  addTab,
  clearClosed,
  closeTab,
  DiscoverTabsState,
  duplicateTab,
  hasDiscoverState,
  initialTabsState,
  loadTabsState,
  moveTab,
  paramsWithoutTab,
  renameTab,
  restoreClosed,
  saveTabsState,
  setTabParams,
  TAB_PARAM,
} from '../state/discoverTabs';
import { LogsExplorer } from './LogsExplorer';

function withTab(params: string, id: string): URLSearchParams {
  const sp = new URLSearchParams(params);
  sp.set(TAB_PARAM, id);
  return sp;
}

export function DiscoverTabsHost() {
  const { views } = useContext(DataViewContext);
  const viewIds = useMemo(() => views.map((v) => v.id), [views]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [state, setState] = useState<DiscoverTabsState>(() => loadTabsState(viewIds) ?? initialTabsState());
  const urlTab = searchParams.get(TAB_PARAM);
  const known = urlTab !== null && state.tabs.some((t) => t.id === urlTab);

  // Persist every change.
  useEffect(() => saveTabsState(state), [state]);

  // Resolve a URL without a known tab (see the header), then render the tab it lands on.
  useEffect(() => {
    if (known) {
      return;
    }
    const current = paramsWithoutTab(searchParams);
    if (urlTab === null && !hasDiscoverState(searchParams)) {
      const active = state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0];
      setSearchParams(withTab(active.params, active.id), { replace: true });
      return;
    }
    if (urlTab === null) {
      // Syncing from an external source (the URL), not deriving render state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState((s) => setTabParams(s, s.activeId, current));
      setSearchParams(withTab(current, state.activeId), { replace: true });
      return;
    }
    const next = addTab(state, current);
    if (next === state) {
      // At the tab limit: the link replaces the active tab's state instead.
      setState((s) => setTabParams(s, s.activeId, current));
      setSearchParams(withTab(current, state.activeId), { replace: true });
      return;
    }
    setState(next);
    setSearchParams(withTab(current, next.activeId), { replace: true });
  }, [known, urlTab, searchParams, setSearchParams, state]);

  // The active tab follows the URL (back / forward between tabs), and its state follows every
  // URL write LogsExplorer makes.
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
  const newTabParams = useCallback(() => {
    const ds = searchParams.get('ds');
    return ds ? new URLSearchParams({ ds }).toString() : '';
  }, [searchParams]);

  const strip = (
    <DiscoverTabs
      state={state}
      onSelect={(id) => go(activate(state, id))}
      onAdd={() => go(addTab(state, newTabParams()))}
      onDuplicate={(id) => go(duplicateTab(state, id))}
      onRename={(id, title) => setState((s) => renameTab(s, id, title))}
      onClose={(id) => go(closeTab(state, id))}
      onMove={(id, to) => setState((s) => moveTab(s, id, to))}
      onRestore={(id) => go(restoreClosed(state, id))}
      onClearClosed={() => setState((s) => clearClosed(s))}
    />
  );

  if (!known || !urlTab) {
    return null;
  }
  return (
    <LogsExplorer
      key={urlTab}
      tabId={urlTab}
      tabStrip={strip}
      onTitle={(title) => setState((s) => renameTab(s, urlTab, title))}
    />
  );
}
