R4-DASH: round-3 dashboards / saved searches / sharing (rows 5, 6, 7, 15, 16, 17). SQL impact: none (saved Visualize panels get `maxDataPoints: 60`, so Grafana's `$__interval` / `$__timeInterval` give ~60 buckets per range; the SQL text is unchanged).

## CHANGELOG
- Saved Visualize panels with a date histogram bucket like Visualize's auto interval (about 60 bars) instead of ~1-minute buckets drawn as hairlines.
- Add to dashboard: panel and dashboard titles start empty with placeholders (`Logs`, `Log volume`, `Discover export`) instead of prefilled text. A Logs table capped at 1,000 rows is titled `Logs (newest 1,000)` by default, and its info text states how many documents matched when it was added.
- Cancel in Visualize (edit from a dashboard) also asks `Leave with unsaved changes?` when the dashboard could not be loaded; the baseline is taken from the URL at entry.
- Short links drop `?orgId=1` (`/goto/<uid>`).

## Decision
- Row 6: paging past 1,000 needs a count or a larger query on every dashboard load; not done. The cap is now visible in the title and the description gives the true count (a snapshot at add time, not live). A live count would need a second target and a frame selector on the table panel.
- Row 7: the confirm already existed in the code (SaveActions); the round-3 script may have hit a state where the baseline was never set (dashboard load pending or failing). Fixed by a URL-at-entry fallback baseline. Could not reproduce without running Observe; verify in the e2e run.
- Row 15: deferred (see Deferred).
- Row 17: only `orgId=1` is dropped (other orgs keep it, so their links still resolve). 41 characters here against Kibana's 35; the rest is Grafana's 14-character uid and `/goto/`.

## TESTING
| Check | Result |
| --- | --- |
| jest: panel `maxDataPoints`, capped table title/description, short URL without orgId | passes |
| e2e: Add to dashboard shows empty title fields with placeholders | not run (coordinator) |
| e2e: Cancel after a chart type change shows `Leave with unsaved changes?`; Cancel unchanged goes straight back | not run (coordinator) |
| e2e: short link matches `/goto/<uid>` without `orgId=1` and opens | not run (coordinator) |

## Deferred
- Row 15 (saved searches listed among dashboards): they are Grafana dashboards by design (folder `Observe saved searches` + tag `observe-saved-search` already group them). Grafana has no hidden or custom object type for the dashboard list. The `(ss_<id>)` suffix in the title guarantees a unique title in the folder (overwrite is off) and is what lookup by id searches, so existing searches depend on it; shortening it would break them. Needs a product decision (e.g. a tag-based id and a migration).
- Row 6 paging past 1,000 and a live row count.
