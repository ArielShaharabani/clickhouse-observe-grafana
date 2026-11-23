/**
 * Discover with session tabs (DISC-NAV-01, see useSessionTabs). LogsExplorer decodes its URL once
 * at mount, so it is keyed by the tab id; it keeps `_tab` in every URL it writes.
 */
import React from 'react';
import { DiscoverTabs } from '../components/DiscoverTabs/DiscoverTabs';
import { DISCOVER_TABS } from '../state/discoverTabs';
import { LogsExplorer } from './LogsExplorer';
import { useSessionTabs } from './useSessionTabs';

export function DiscoverTabsHost() {
  const tabs = useSessionTabs(DISCOVER_TABS);
  if (!tabs.tabId) {
    return null;
  }
  return (
    <LogsExplorer
      key={tabs.tabId}
      tabId={tabs.tabId}
      tabStrip={<DiscoverTabs {...tabs.stripProps} />}
      onTitle={tabs.rename}
    />
  );
}
