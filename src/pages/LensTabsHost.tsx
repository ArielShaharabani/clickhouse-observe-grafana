/**
 * Visualize with session tabs (see useSessionTabs). A link (Edit visualization, Edit in Visualize,
 * Open panel, a shared chart) opens in its own tab when the active one holds a chart, so it never
 * replaces work.
 */
import React from 'react';
import { DiscoverTabs } from '../components/DiscoverTabs/DiscoverTabs';
import { LensPage } from '../lens/LensPage';
import { DEFAULT_TITLE } from '../state/discoverTabs';
import { LENS_TABS, lensTabInUse } from '../state/lensTabs';
import { useSessionTabs } from './useSessionTabs';

const UNNAMED = new RegExp(`^${DEFAULT_TITLE}( \\d+)?$`);

export function LensTabsHost() {
  const tabs = useSessionTabs(LENS_TABS, lensTabInUse);
  if (!tabs.tabId) {
    return null;
  }
  const current = tabs.stripProps.state.tabs.find((t) => t.id === tabs.tabId);
  return (
    <LensPage
      key={tabs.tabId}
      tabStrip={<DiscoverTabs {...tabs.stripProps} label="Visualize tabs" />}
      // A name the user gave the tab is kept.
      onTitle={(title) => current && UNNAMED.test(current.title) && tabs.rename(title)}
      onLeave={tabs.finishOnLeave}
    />
  );
}
