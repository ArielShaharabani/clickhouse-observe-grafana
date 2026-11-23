# R6-SEC: defensive security pass

SQL impact: none (no query text changes).

## CHANGELOG
- Security: dependencies updated to the latest compatible releases (all published at least 2 weeks ago); transitive advisories fixed in the lockfile and with scoped `overrides` (dompurify, js-cookie, moment, uuid, basic-ftp). Nothing flagged ships in `dist/module.js` except `react-router-dom` (see below).
- Security: matched-term highlighting no longer backtracks on a hostile shared-link query (many `*` wildcards) and scans at most 5000 characters per cell.
- Security: the remembered trace-view lookup ignores inherited keys (`constructor`, `__proto__`) and non-object storage values.
- CI/dev: release workflow uses `npm ci`, no persisted checkout credentials and no `${{ }}` expansion inside shell; `cp-update` gets `contents: read`; dev docker-compose publishes ClickHouse, Ollama and OTLP ports on 127.0.0.1 only.

## Findings
| Severity | Where | Exploit path | Status |
|---|---|---|---|
| Low | src/sql/kql/highlight.ts (valuePattern, splitHighlights) | A shared link with `q=aa*aa*aa*aa*aa*aa*bb` built one lazy-gap regex (`.*?` x N); a log cell that almost matches backtracked n^N and froze the tab | Fixed (max one gap per pattern, 5000-char scan cap, tests) |
| Low | src/data/traceViewChoice.ts:getRememberedView | Datasource uid `constructor`/`__proto__` in a trace-to-logs link returned an inherited function as the "remembered view id" | Fixed (own-property + string check, tests) |
| Low | .github/workflows/release.yml | `npm install` ignores the lockfile in a job with `contents: write`; `${{ github.ref_name }}` expanded inside `run:` | Fixed (`npm ci`, env vars, persist-credentials false) |
| Low | .github/workflows/cp-update.yml | No `permissions:` block (token default) | Fixed (`contents: read`; the job uses its own PAT) |
| Low (dev) | docker-compose.yaml | Passwordless ClickHouse `default` user, Ollama `OLLAMA_ORIGINS=*` and OTLP published on 0.0.0.0 of the dev host | Fixed for the 5 ports in this file (127.0.0.1). Grafana :3000/:2345 come from `.config/docker-compose-base.yaml` (not editable) and anonymous Admin is dev-only: not fixed |
| Info | src/types.ts:224, AppConfig.tsx | AI token is in plain `jsonData`; any signed-in user can read plugin settings and see it. Already documented in code. A real fix needs `secureJsonData` plus a backend proxy. Also the base URL is not scheme-checked, so an `http://` URL sends the bearer in clear | Not changed (product decision) |
| Info | src/sql/queryBuilder.ts:259-264, 436-440, 664, 1072 | Data-view column mappings (`columns.*`, `partitionTimestamp`) are emitted as raw SQL expressions by design. They come from admin `jsonData` or the user's own localStorage, never from URLs, dashboards or saved searches (verified: discoverSource/panelSource/urlState carry only q/filters/cols/sort/ds, and cols/sort go through isSafeColumnExpr/isSafeAlias) | Not changed (trust boundary = whoever can edit data views) |
| Info | .github/workflows/* | Actions pinned by tag, not commit SHA (checkout/setup-node/upload-artifact, grafana/plugin-actions) | Not changed; Dependabot (5-day cooldown) is configured |
| Info | docker-compose.yaml | `ollama/ollama` image unpinned (dev only); `otel-collector-contrib:0.114.0` is old | Not changed |

Checked and found sound (no change needed): no `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`postMessage`; the only `window.open` is `noopener` to a fixed Grafana path; return URLs (`ret`, `returnTo`, `dash`/`panel`/`dfrom`/`dto`) are rebuilt as query params under the plugin route or validated by shape; dashboard and short-URL API paths accept only Grafana uid shapes; identifiers and strings go through quoteIdentPart/quoteString (lexer-faithful regexes), alias/sort/columns through isSafeAlias/isSafeColumnExpr; AI replies are only accepted when they name an existing column; JSON decoders type-check and storage reads are try/catch; user regexes in Visualize are only compiled for validation (execution is server-side RE2); CSV export guards `= + - @ TAB CR` and quotes headers; diagnostics bundle redacts literals, identifiers and config; permission helpers only gate UI (Grafana enforces on the API); no secrets in HEAD or history (pattern scan); lockfile: 1228 packages, all from registry.npmjs.org with integrity; `.npmrc` has `ignore-scripts=true`; install scripts only in @swc/core, @parcel/watcher, fsevents; licenses all permissive (MIT/Apache/ISC/BSD/BlueOak/0BSD/CC0, MPL-2.0 dual).

## Dependencies
`npm audit` before: 36 (all), 17 (prod tree). After: 5 moderate, all the react-router family.

| Package | Before -> after | Note |
|---|---|---|
| @grafana/plugin-e2e | 3.9.1 -> 3.15.4 | dev |
| @grafana/sign-plugin | 3.3.1 -> 3.3.3 | dev |
| @playwright/test | 1.61.1 -> 1.65.0 | dev (1.65.1 is 9 days old, skipped) |
| @swc/core (+win32 optional) | 1.15.43 -> 1.16.22 | dev |
| @swc/helpers, @swc/jest, swc-loader | 0.5.23 -> 0.5.24, -> 0.2.39, -> 0.2.7 | dev |
| @testing-library/react | 16.3.2 -> 16.3.3 | dev |
| @types/node | 24.13.2 -> 24.19.2 | dev |
| @typescript-eslint/* | 8.62.0 -> 8.72.1 | dev (8.73.0 too new) |
| eslint | 9.39.4 -> 9.39.5 | dev |
| css-loader, sass, semver, prettier, terser-webpack-plugin, webpack, other eslint plugins | patch/minor bumps | dev |
| glob | 11.1.0 -> 14.0.4 | dev, advisory fix; `.config` uses it, build verified |
| @tanstack/react-virtual | 3.14.5 -> 3.14.26 | SHIPS in dist (3.14.28 is 1 day old, skipped) |
| react-router-dom | 6.30.4 -> 6.30.6 | SHIPS in dist |
| dompurify, js-cookie, moment, uuid, basic-ftp | overrides to ^3.4.17, ^3.0.8, ^2.31.0, ^11.1.1, ^6.2.6 | dev/type-only or Grafana-provided externals |

Remaining advisories (5 moderate): react-router 6.x, react-router-dom, react-router-dom-v5-compat (via @grafana/ui) and the @grafana/ui and @grafana/runtime nodes that depend on them. No fix exists on the v6 line (the fix is react-router 7.18.6, a major). Shipped part: `react-router-dom` 6.30.6 is bundled; `react-router` and `@grafana/*` are webpack externals (Grafana provides them at runtime). Not exploitable here: the only redirect is `<Navigate>` to a fixed route (`App.tsx:291`), there is no user-supplied `<Link>`/`navigate` target, and no SSR `deserializeErrors`.

Deferred majors: @grafana/data|ui|runtime|schema|i18n 13.0.2 -> 13.3.1 (keeps types at the minimum supported Grafana, `grafanaDependency >=13.0.0`; a bump would allow APIs missing at 13.0), @emotion/css 11.10.6 (Grafana's version, external), React 18 -> 19 (Grafana provides 18), jest 29 -> 30 and jest-environment-jsdom, eslint 9 -> 10 and eslint-plugin-jsdoc 52 -> 65, @grafana/eslint-config 10, @grafana/sign-plugin 4, @testing-library/jest-dom 8 (6.10.0 is deprecated; kept 6.9.1), @types/jest 30, @types/react(-dom) 19, typescript 7, webpack-cli 7, sass-loader 17, eslint-webpack-plugin 6, react-router-dom 7 (would clear the advisory but is a risky major).

Pins: the clickhouse datasource plugin 4.20.0 and `clickhouse-server:26.3-alpine` are pinned; the Grafana base image 13.0.2 is pinned in `.config`.

## Decision
Raw SQL, personal data views and the AI token location are left as designed; changing them needs a product decision.

## TESTING
Full jest after the dependency update: 143 suites, 1957 tests green. After the code fixes: sql + data suites 883 green. typecheck 0 errors, lint 0 errors (27 pre-existing warnings), build green. e2e: none affected (not run).

## Deferred
SHA-pinning of GitHub Actions; ollama image pin; moving the AI token to secureJsonData with a backend proxy; @grafana/* 13.3 bump.
