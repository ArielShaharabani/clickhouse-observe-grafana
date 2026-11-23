/**
 * Adds the "Edit in Visualize" panel link (lens/panelSource.ts) to the ClickHouse panels of existing
 * dashboards, from the Configuration page. Panels saved from Visualize get theirs on save.
 */
import { withEditLink } from '../lens/panelSource';
import { errMsg } from '../errMsg';
import { assertClassicStored, DashboardHit, dashboardSaveError, getDashboard, saveDashboard, searchDashboards } from './dashboards';
import { CH_DATASOURCE_TYPE } from './panelExport';
import { SAVED_SEARCH_TAG } from './savedSearches';

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x);
const dsType = (x: unknown) => (isObj(x) && isObj(x.datasource) ? x.datasource.type : undefined);

/** A panel of its own (not a row, not a library panel reference) that queries ClickHouse. */
function isClickHousePanel(p: Obj): boolean {
  if (p.type === 'row' || isObj(p.libraryPanel) || !Number.isInteger(p.id) || (p.id as number) <= 0) {
    return false;
  }
  const targets = Array.isArray(p.targets) ? p.targets.filter(isObj) : [];
  return targets.length > 0 && (dsType(p) === CH_DATASOURCE_TYPE || targets.some((t) => dsType(t) === CH_DATASOURCE_TYPE));
}

/** The dashboard with the link on every ClickHouse panel; `changed` lists the panels that got it (or a corrected one). */
export function addEditLinks(dashboard: Obj): { dashboard: Obj; changed: string[] } {
  const changed: string[] = [];
  const walk = (list: unknown[]): unknown[] =>
    list.map((p) => {
      if (!isObj(p)) {
        return p;
      }
      if (p.type === 'row') {
        return Array.isArray(p.panels) ? { ...p, panels: walk(p.panels) } : p;
      }
      if (!isClickHousePanel(p)) {
        return p;
      }
      const next = withEditLink(p as Obj & { targets?: unknown; links?: unknown }, p.id as number, true);
      // Unchanged (also the order of the user's own links): nothing to save.
      if (JSON.stringify(next.links) === JSON.stringify(p.links)) {
        return p;
      }
      changed.push(typeof p.title === 'string' && p.title ? p.title.slice(0, 200) : `Panel ${String(p.id)}`);
      return next;
    });
  const panels = Array.isArray(dashboard.panels) ? walk(dashboard.panels) : [];
  return changed.length > 0 ? { dashboard: { ...dashboard, panels }, changed } : { dashboard, changed };
}

export interface LinkScan {
  uid: string;
  title: string;
  folder?: string;
  /** Panels that need the link. */
  panels: string[];
  /** Why the dashboard can't be changed. */
  blocked?: string;
}

/** Reads `hit`; undefined when no panel needs the link. Nothing is changed. */
async function scanOne(hit: DashboardHit): Promise<LinkScan | undefined> {
  const base = { uid: hit.uid, title: hit.title, folder: hit.folderTitle };
  try {
    const { dashboard, meta } = await getDashboard(hit.uid);
    const { changed } = addEditLinks(dashboard);
    if (changed.length === 0) {
      return undefined;
    }
    const scan = { ...base, panels: changed };
    if (meta.provisioned) {
      return { ...scan, blocked: 'Provisioned from a file: change it there' };
    }
    if (meta.canSave === false) {
      return { ...scan, blocked: 'You do not have permission to save it' };
    }
    try {
      await assertClassicStored(hit.uid);
    } catch {
      return { ...scan, blocked: 'Uses a newer layout (tabs or auto grid), which this cannot save without flattening it' };
    }
    return scan;
  } catch (e) {
    return { ...base, panels: [], blocked: `Could not be read: ${errMsg(e)}` };
  }
}

const PARALLEL = 4;

/** Every dashboard with ClickHouse panels that lack the link. */
export async function scanEditLinks(onProgress?: (done: number, total: number) => void): Promise<LinkScan[]> {
  const hits = (await searchDashboards()).filter((h) => !h.tags?.includes(SAVED_SEARCH_TAG));
  const out: Array<LinkScan | undefined> = new Array(hits.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < hits.length) {
      const i = next++;
      out[i] = await scanOne(hits[i]);
      onProgress?.(++done, hits.length);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return out.filter((x): x is LinkScan => x !== undefined);
}

/** Adds the links to one dashboard, read again now (its version guards against a save in between). */
export async function applyEditLinks(uid: string): Promise<number> {
  const { dashboard, meta } = await getDashboard(uid);
  const { dashboard: next, changed } = addEditLinks(dashboard);
  if (changed.length === 0) {
    return 0;
  }
  try {
    await saveDashboard(next, {
      folderUid: meta.folderUid,
      overwrite: false,
      message: 'Added "Edit in Visualize" panel links (ClickHouse Observe)',
    });
  } catch (e) {
    throw new Error(dashboardSaveError(e));
  }
  return changed.length;
}
