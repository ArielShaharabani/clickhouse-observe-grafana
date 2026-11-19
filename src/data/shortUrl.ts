/**
 * Short links for Share (Discover and Visualize), through Grafana's own short URL API:
 * `POST /api/short-urls { path }` → `{ uid, url }`, where `url` is `<root>/goto/<uid>?orgId=…`.
 *
 * `path` is relative to Grafana's root URL (no leading slash, no sub-path), as Grafana's own share
 * dialogs send it. The response is untrusted: only a same-origin `/goto/` URL is used; anything
 * else (or an error) falls back to the full link, so Copy link always has something to copy.
 */
import { config, getBackendSrv } from '@grafana/runtime';

/** `fullUrl` as a path relative to Grafana's root, or undefined when it is not under this Grafana. */
export function relativeGrafanaPath(fullUrl: string, origin: string, appSubUrl = ''): string | undefined {
  let u: URL;
  try {
    u = new URL(fullUrl);
  } catch {
    return undefined;
  }
  if (u.origin !== origin) {
    return undefined;
  }
  const sub = appSubUrl.replace(/\/+$/, '');
  let path = u.pathname;
  if (sub) {
    if (path !== sub && !path.startsWith(`${sub}/`)) {
      return undefined;
    }
    path = path.slice(sub.length);
  }
  const rel = `${path.replace(/^\/+/, '')}${u.search}`;
  return rel && !rel.includes('..') ? rel : undefined;
}

/** A short URL from Grafana's response, or undefined when it is not a same-origin `/goto/` link. */
export function validShortUrl(res: unknown, origin: string): string | undefined {
  const url = (res as { url?: unknown } | undefined)?.url;
  if (typeof url !== 'string' || url.length > 2048) {
    return undefined;
  }
  try {
    const u = new URL(url, origin);
    return u.origin === origin && /\/goto\/[A-Za-z0-9_-]+$/.test(u.pathname) ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** Short link for `fullUrl`; resolves to `fullUrl` itself when shortening fails. Never rejects. */
export async function shortenUrl(fullUrl: string): Promise<string> {
  const origin = window.location.origin;
  const path = relativeGrafanaPath(fullUrl, origin, config.appSubUrl ?? '');
  if (!path) {
    return fullUrl;
  }
  try {
    const res = await getBackendSrv().post('/api/short-urls', { path }, { showErrorAlert: false });
    return validShortUrl(res, origin) ?? fullUrl;
  } catch {
    return fullUrl;
  }
}
