## CHANGELOG
### Added
- **Typed time shorthand next to the time picker** (`-7d`, `-30m`, `now-1h`, `td`, `yd`, `tw`, `tm`, `ty`): Enter or Update applies it; relative ranges stay relative in the URL (`from=now-7d`). Spec DISC-TIME-01 gap (`src/utils/timeShorthand.ts`, `src/components/TimeShorthandInput.tsx`).
- **Duration badge** (`~7d`, `~17h`) beside the picker showing the window length.
- **Pending-time cue**: typed-but-unapplied shorthand shows a green Update button (DISC-TIME-02 dirty state for time).
### Changed
- **URL `from`/`to` also accept ISO-8601** (as Kibana writes `_g.time`); the plugin still writes epoch ms.
- Bad `from`/`to` no longer risk `NaN` dates; the time param is dropped instead.

## Decision
DISC-TIME-01/02 were mostly met by Grafana's picker, shift and zoom controls. We added a small shorthand input beside the picker, not a replacement for it, so the Grafana picker (presets, recent, calendar, custom range, time zone) keeps working unchanged. The shorthand input is also the only source of a pending time: text typed but not applied shows an Update button, and Refresh stays the clean-state action (D9 said time had no dirty state because the picker applies at once; this refines it). Whole-day shorthand ranges (td/yd) end at 23:59:59.999, so the badge rounds to the second (`~1d`). Absolute ranges are written to the URL as epoch ms (existing links, Lens, saved searches), not ISO: ISO is decoded but never written, so IT-D's "URL ISO time" is met on the read side only. Known limits: no inline "Nov 15, 01:22 -> 18:43" label (Grafana's picker shows its own absolute format), no "Send to background" action (no background search feature exists), shorthand `tw`/`tm`/`ty` are the whole calendar period (not "until now"), Recent tab is Grafana's "Recently used ranges". No SQL generation changed.

## TESTING
| Case | Status |
| --- | --- |
| IT-C | Query + time dirty states -> Update -> count/grid/URL refresh ✅ (`tests/integration/it-c-d-time.spec.ts`) |
| IT-D | Brush (epoch-ms URL, interval recomputed), Filter by time (interval kept), shift/zoom (interval kept), shorthand + reload ✅ (`tests/integration/it-c-d-time.spec.ts`); Lens brush and Empty-field grouping not covered (grouping exists only with FIELD features) |

## Acceptance
| Criterion | Test / status |
| --- | --- |
| Picker shows the range and a duration badge | `tests/features/disc-time-01.spec.ts` "duration badge ~7d"; unit `formatDurationBadge` |
| Typed shorthand `-7d`, `td`, `yd` | e2e "typing -3h...", "td and yd..."; unit `parseTimeShorthand` |
| Invalid shorthand rejected | e2e "invalid shorthand"; component test |
| Presets / Recent tabs, Calendar, Custom range, time zone | Grafana's picker, unchanged (no test) |
| Previous / Next shift one window; Zoom out doubles it | e2e "previous / next shift..."; unit `shiftTimeRange`/`zoomOutTimeRange` |
| Time changes written to URL (absolute and relative), ISO accepted | e2e ISO link; `urlState.test.ts`; IT-D |
| Refresh when clean / Update when query or time changed but not run | disc-search-02 (query), e2e "Update state..." (time), IT-C |
| Send to background | gap left: no background search feature exists |
| Inline "Nov 15, 01:22 -> 18:43" label | gap left: Grafana's picker label kept |
