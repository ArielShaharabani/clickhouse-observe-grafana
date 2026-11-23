/**
 * Loading a dashboard's panels for "Edit in Visualize" / "Open panel" (R6-PANELS). Reading only:
 * opening a panel never changes the dashboard.
 */
import { getDashboard, getLibraryPanelModel } from '../data/dashboards';
import { findDashboardPanel } from '../data/panelExport';
import { isTimeParam } from './panelSource';

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

export const V2_MESSAGE =
  'This dashboard uses the newer (v2) dashboard schema, which Visualize cannot edit yet. Convert it to the classic JSON schema or use Save as new.';

/** Throws a clear message for a dashboard that is not the classic JSON model. */
export function assertClassicDashboard(d: Record<string, unknown>): void {
  const v = typeof d.apiVersion === 'string' ? d.apiVersion : '';
  if (/v2/i.test(v) || isObj(d.elements) || (isObj(d.spec) && isObj((d.spec as Record<string, unknown>).elements))) {
    throw new Error(V2_MESSAGE);
  }
}

export interface LoadedPanel {
  dashboard: Record<string, unknown>;
  folderUid?: string;
  /** The panel model (a library panel's model is loaded; its reference stays in `libraryPanel`). */
  panel: Record<string, unknown>;
  dashboardTitle: string;
  /** The dashboard's own time range. */
  from?: string;
  to?: string;
}

/** A library panel reference holds no model in the dashboard JSON: fetch it, keep the reference. */
export async function withLibraryModel(panel: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ref = panel.libraryPanel;
  if (isObj(ref) && typeof ref.uid === 'string' && !Array.isArray(panel.targets)) {
    const model = await getLibraryPanelModel(ref.uid);
    return { ...model, id: panel.id, gridPos: panel.gridPos, libraryPanel: ref, title: panel.title ?? model.title };
  }
  return panel;
}

export async function loadDashboardPanel(uid: string, panelId: number): Promise<LoadedPanel> {
  const { dashboard, meta } = await getDashboard(uid);
  assertClassicDashboard(dashboard);
  const found = findDashboardPanel(dashboard, panelId);
  if (!found) {
    throw new Error('The panel is no longer on the dashboard.');
  }
  const t = isObj(dashboard.time) ? dashboard.time : {};
  return {
    dashboard,
    folderUid: meta.folderUid,
    panel: await withLibraryModel(found),
    dashboardTitle: typeof dashboard.title === 'string' ? dashboard.title.slice(0, 200) : uid,
    from: isTimeParam(t.from) ? t.from : undefined,
    to: isTimeParam(t.to) ? t.to : undefined,
  };
}

export interface PanelListItem {
  id: number;
  title: string;
  type: string;
  /** The row it sits in (collapsed rows hold their panels). */
  row?: string;
  /** The panel JSON as in the dashboard (library panels are a reference only). */
  panel: Record<string, unknown>;
}

/** Every panel of a dashboard with an id, including those inside rows (not the rows themselves). */
export function listDashboardPanels(dashboard: Record<string, unknown>): PanelListItem[] {
  const out: PanelListItem[] = [];
  const walk = (list: unknown, row?: string) => {
    if (!Array.isArray(list)) {
      return;
    }
    for (const raw of list) {
      if (!isObj(raw)) {
        continue;
      }
      if (raw.type === 'row') {
        const title = typeof raw.title === 'string' ? raw.title.slice(0, 100) : 'Row';
        walk(raw.panels, title);
        continue;
      }
      if (typeof raw.id === 'number' && Number.isInteger(raw.id) && raw.id > 0) {
        out.push({
          id: raw.id,
          title: typeof raw.title === 'string' && raw.title ? raw.title.slice(0, 200) : `Panel ${raw.id}`,
          type: typeof raw.type === 'string' ? raw.type.slice(0, 40) : isObj(raw.libraryPanel) ? 'library panel' : '?',
          ...(row ? { row } : {}),
          panel: raw,
        });
      }
    }
  };
  assertClassicDashboard(dashboard);
  walk(dashboard.panels);
  return out;
}
