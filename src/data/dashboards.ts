/**
 * Thin wrappers around the Grafana dashboard REST API.
 * Mirrors the getBackendSrv() pattern already used in AppConfig.updatePlugin
 * (src/components/AppConfig/AppConfig.tsx) — no dashboard API was called anywhere before this.
 */
import { config, getBackendSrv } from '@grafana/runtime';
import { isDashboardUid } from '../lens/panelSource';
import { errMsg } from '../errMsg';

export interface DashboardHit {
  uid: string;
  title: string;
  url: string;
  folderTitle?: string;
  tags?: string[];
}

export interface DashboardGetResult {
  dashboard: Record<string, unknown>;
  meta: { folderUid?: string; provisioned?: boolean; canSave?: boolean };
}

export interface SaveDashboardResult {
  uid: string;
  url: string;
}

/** Search existing dashboards (type=dash-db excludes folders) for the "add to existing" picker. */
export async function searchDashboards(query = ''): Promise<DashboardHit[]> {
  const params = new URLSearchParams({ type: 'dash-db' });
  if (query.trim()) {
    params.set('query', query.trim());
  }
  return getBackendSrv().get<DashboardHit[]>(`/api/search?${params.toString()}`);
}

/** Fetch a dashboard's full JSON model by uid, so panels can be appended to it. */
export async function getDashboard(uid: string): Promise<DashboardGetResult> {
  // The uid can come from a URL or dashboard JSON: only Grafana's uid shape reaches the API path.
  if (!isDashboardUid(uid)) {
    throw new Error('Invalid dashboard uid');
  }
  const res = await getBackendSrv().get<DashboardGetResult>(`/api/dashboards/uid/${uid}`, undefined, undefined, {
    showErrorAlert: false,
  });
  if (!res || typeof res !== 'object' || !res.dashboard || typeof res.dashboard !== 'object') {
    throw new Error('Unexpected dashboard response');
  }
  return {
    dashboard: res.dashboard,
    meta: {
      folderUid: typeof res.meta?.folderUid === 'string' ? res.meta.folderUid : undefined,
      provisioned: res.meta?.provisioned === true,
      canSave: res.meta?.canSave !== false,
    },
  };
}

export const V2_MESSAGE =
  'This dashboard uses the newer (v2) dashboard schema, which Visualize cannot edit yet. Convert it to the classic JSON schema or use Save as new.';

/**
 * Throws V2_MESSAGE when the dashboard is stored in the v2 schema (tabs, auto grid). Grafana hands
 * such a dashboard to the classic API already converted, with nothing to tell; saving that copy
 * back would flatten its layout for good. Grafana without the v2 API can't store one.
 */
export async function assertClassicStored(uid: string): Promise<void> {
  if (!isDashboardUid(uid)) {
    throw new Error('Invalid dashboard uid');
  }
  let stored: unknown;
  try {
    const res = await getBackendSrv().get<{ status?: { conversion?: { storedVersion?: unknown } } }>(
      `/apis/dashboard.grafana.app/v1/namespaces/${encodeURIComponent(config.namespace || 'default')}/dashboards/${uid}`,
      undefined,
      undefined,
      { showErrorAlert: false }
    );
    stored = res?.status?.conversion?.storedVersion;
  } catch (e) {
    if ((e as { status?: number } | undefined)?.status === 404) {
      return;
    }
    throw e;
  }
  if (typeof stored === 'string' && /^v2/i.test(stored)) {
    throw new Error(V2_MESSAGE);
  }
}

/** Create or update a dashboard. Set overwrite=true when saving an appended-to existing dashboard. */
export async function saveDashboard(
  dashboard: Record<string, unknown>,
  opts: { folderUid?: string; overwrite?: boolean; message?: string } = {}
): Promise<SaveDashboardResult> {
  if (typeof dashboard.uid === 'string' && dashboard.uid) {
    await assertClassicStored(dashboard.uid);
  }
  // Errors are shown by the dialogs (dashboardSaveError), not as a second Grafana toast.
  return getBackendSrv().post<SaveDashboardResult>(
    '/api/dashboards/db',
    { dashboard, folderUid: opts.folderUid, overwrite: opts.overwrite ?? false, ...(opts.message ? { message: opts.message } : {}) },
    { showErrorAlert: false }
  );
}

/**
 * A readable message for a failed dashboard save. Grafana answers 412 with `status`
 * `version-mismatch` (someone saved the dashboard in between: optimistic locking on `version`) or
 * `name-exists` (a dashboard with that title is already in the folder).
 */
export function dashboardSaveError(e: unknown, title?: string): string {
  const err = e as { status?: number; data?: { status?: unknown; message?: unknown } } | undefined;
  const status = typeof err?.data?.status === 'string' ? err.data.status : '';
  if (status === 'version-mismatch') {
    return 'Someone else changed this dashboard since you opened the panel. Open the dashboard again to get the latest version, or use Save as new.';
  }
  if (status === 'name-exists') {
    return `A dashboard named "${title ?? ''}" already exists in this folder. Choose another title or add to the existing dashboard.`;
  }
  if (err?.status === 404 || status === 'not-found') {
    return 'The dashboard no longer exists.';
  }
  if (err?.status === 403) {
    return 'You do not have permission to save this dashboard.';
  }
  const msg = typeof err?.data?.message === 'string' ? err.data.message : '';
  return msg || errMsg(e);
}

/** Dashboards whose title is exactly `title` (case-insensitive), for the duplicate-title warning. */
export async function findDashboardsByTitle(title: string): Promise<DashboardHit[]> {
  const t = title.trim();
  if (!t) {
    return [];
  }
  const hits = await getBackendSrv().get<DashboardHit[]>(
    `/api/search?${new URLSearchParams({ type: 'dash-db', query: t }).toString()}`,
    undefined,
    undefined,
    { showErrorAlert: false }
  );
  return (Array.isArray(hits) ? hits : []).filter(
    (h) => typeof h?.title === 'string' && h.title.toLowerCase() === t.toLowerCase()
  );
}

export interface LibraryPanelRef {
  uid: string;
  name: string;
}

/**
 * Create a library panel from a panel model (POST /api/library-elements, kind 1 = panel), in the
 * General folder unless a folder is given. Dashboards reference it as `{ libraryPanel: { uid, name } }`.
 */
export async function createLibraryPanel(
  name: string,
  model: Record<string, unknown>,
  folderUid?: string
): Promise<LibraryPanelRef> {
  const res = await getBackendSrv().post<{ result: LibraryPanelRef }>('/api/library-elements', {
    name,
    model,
    kind: 1,
    ...(folderUid ? { folderUid } : {}),
  });
  return { uid: res.result.uid, name: res.result.name };
}

export async function deleteLibraryPanel(uid: string): Promise<void> {
  await getBackendSrv().delete(`/api/library-elements/${encodeURIComponent(uid)}`);
}

/** The model of a library panel (a dashboard only holds a reference to it). */
export async function getLibraryPanelModel(uid: string): Promise<Record<string, unknown>> {
  if (!isDashboardUid(uid)) {
    throw new Error('Invalid library panel uid');
  }
  const res = await getBackendSrv().get<{ result?: { model?: unknown } }>(
    `/api/library-elements/${uid}`,
    undefined,
    undefined,
    { showErrorAlert: false }
  );
  const model = res?.result?.model;
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    throw new Error('Unexpected library panel response');
  }
  return model as Record<string, unknown>;
}
