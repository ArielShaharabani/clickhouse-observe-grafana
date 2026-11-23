/**
 * Minimal RBAC gate for actions that write dashboards (e.g. "Add to dashboard").
 * No permission-checking existed anywhere in this plugin before — this is the first one.
 */
import { config } from '@grafana/runtime';

/**
 * True when the signed-in user is allowed to create/save dashboards.
 * Prefers fine-grained RBAC (`dashboards:create`) when the permissions map is present
 * (Enterprise / RBAC-enabled Grafana); falls back to org role for OSS installs where
 * `user.permissions` is never populated.
 */
export function canCreateDashboards(): boolean {
  const user = config.bootData?.user;
  if (!user) {
    return false;
  }
  const perms = (user as unknown as { permissions?: Record<string, boolean> }).permissions;
  if (perms && 'dashboards:create' in perms) {
    return Boolean(perms['dashboards:create']);
  }
  return user.orgRole !== 'Viewer' && user.orgRole !== '';
}

/** True when the user may create alert rules (`alert.rules:create`, else Editor or above). */
export function canCreateAlertRules(): boolean {
  const user = config.bootData?.user;
  if (!user) {
    return false;
  }
  const perms = (user as unknown as { permissions?: Record<string, boolean> }).permissions;
  if (perms && 'alert.rules:create' in perms) {
    return Boolean(perms['alert.rules:create']);
  }
  return user.orgRole !== 'Viewer' && user.orgRole !== '';
}

/** True when the user may read dashboards (`dashboards:read`; every signed-in user otherwise). */
export function canViewDashboards(): boolean {
  const user = config.bootData?.user;
  if (!user) {
    return false;
  }
  const perms = (user as unknown as { permissions?: Record<string, boolean> }).permissions;
  return perms && 'dashboards:read' in perms ? Boolean(perms['dashboards:read']) : true;
}
