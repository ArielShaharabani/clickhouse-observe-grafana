# SHARED-A11Y-01 pending notes (#33)

**No SQL changed.** Keyboard, focus and ARIA only; no query, URL or saved-state format changes.

## CHANGELOG

### Added
- **Keyboard and screen-reader support** (#33, SHARED-A11Y-01; spec 30-shared.md "Keyboard and accessibility").
  - **Popovers are dialogs:** the field popover, Add filter, Edit filter, histogram bucket actions, histogram legend actions, cell Expand, Breakdown picker, Display options, field type filter and the Visualize dimension editor are announced as dialogs with "You are in a dialog. Press Escape, or click outside the dialog, to close." Escape closes them (also when they were opened by mouse and focus is still on the page), focus moves in when they open and goes back to the opener when they close.
  - **Menus:** the filter pill menu and the Visualize legend ⋮ menu are real menus: focus starts on the first item, ↑ / ↓ / Home / End move, Escape or Tab closes and returns to the pill or ⋮ button.
  - **Field buttons:** Discover field rows have a `Preview log.level: string` button that opens the field popover from the keyboard; the row's actions (`Add log.level as column`, exists / missing) show while the row has keyboard focus. Visualize keeps `Add log.level to workspace`.
  - **Keyboard drag and drop on Visualize:** each field has a `Drag <field>` handle. Space or Enter lifts the field, the arrow keys move between the drop targets that accept it (the workspace and each dimension group's slot, highlighted), Space or Enter drops it, Escape cancels. Every step is spoken through a live region ("Lifted ServiceName. 3 drop targets. Over the workspace…", "Dropped ServiceName on Breakdown.").
  - **Results grid:** the keyboard cell is exposed through `aria-activedescendant`; column headers sort with a button (and carry `aria-sort`); column actions are named per column (`Move ServiceName left`, `Remove column ServiceName`) and show on keyboard focus.
  - The hit count under the histogram is a status region (the new count is spoken after each search); the KQL bar, SQL editor, rows-per-page, document-detail search and data view search have accessible names.

### Fixed
- Visualize: the Style toolbar button used an icon name that no longer exists in @grafana/ui 13 (`paint-brush` → `palette`), and the Intervals granularity slider lacked the now-required `inputId`; both broke `npm run typecheck` on batch-4.

## Decision

SHARED-A11Y-01 (#33). Grafana's own components (Modal, Drawer, Dropdown / Menu, Combobox, Toggletip) already trap or manage focus and close on Escape, so they are kept as they are; only Toggletip gets a `role="dialog"` wrapper because it sets no role. The plugin's custom Portal popovers share one hook, `usePopoverDialog` (`src/components/a11y/dialog.tsx`): role dialog, the Kibana hint as `aria-describedby`, Escape inside (respecting an Escape a child already used, e.g. an open Combobox list — downshift calls `preventDefault`) and on the page while focus is still outside, focus into the popover on the next frame unless a child focused something, and focus back to the opener (or a given element, e.g. the pill button) on close only when focus would otherwise be lost (on `<body>`), so a click on another control keeps its focus. The opener is captured during the first render, before any child effect can move focus. The inline dimension editor only reacts to Escape from inside (`escapeFromPage: false`), so Escape in another popover or the Inspector drawer does not also close it. Menus use `role="menu"` / `menuitem` with arrow-key movement (`moveMenuFocus`); the filter pill menu's buttons became menuitems (e2e page object updated). Keyboard drag and drop (`src/lens/keyboardDnd.ts`) follows Kibana: a separate focusable handle per field (the row stays the mouse drag source), targets computed from the current chart on every key (same set as the mouse drop zones, same `onAdd` / `addToGroup` calls), focus stays on the handle while lifted, blur cancels, messages through a polite live region. Discover keeps its button alternatives instead of a keyboard drag mode: Add as column (field → grid), Move left / right (column reordering) and the tab menu's Move left / right (tab reordering). The grid keeps DOM focus on the grid element (D12) and points `aria-activedescendant` at the cursor cell; cells stay `td` (role cell) because e2e selects them that way.

## TESTING

| Case | Status |
| --- | --- |
| Audit: custom popovers (field, Add / Edit filter, pill menu, bucket actions, histogram legend, cell Expand, Breakdown picker, legend ⋮ menu, dimension editor) | fixed: dialog / menu roles, hint, Escape, focus in and back |
| Audit: Grafana Modal / Drawer / Dropdown / Combobox (Save, Share, Inspector, Query menu, session actions, tab menus, filter chooser) | already OK (Grafana built-in) |
| Audit: Grafana Toggletip (Display options, field type filter) | Escape / focus already OK; role dialog + hint added |
| Audit: Chart type switcher (custom listbox), formula editor suggestions, KQL suggestions | already OK (listbox / combobox, Escape) |
| Audit: grid arrows, Home / End, Ctrl+Home / End, PgUp / PgDn, Enter, Shift+Enter, Esc (DISC-TABLE-01) | already OK; `aria-activedescendant`, sort button, `aria-sort`, named column actions added |
| Audit: drag and drop (Discover field → grid, column reorder, tab reorder; Visualize field → workspace / group) | Discover: button alternatives already present (actions now visible on focus); Visualize: keyboard drag mode added |
| Audit: icon-only buttons / unlabeled inputs | buttons all named; 5 inputs labeled (KQL bar, SQL editor, rows per page, detail search, data view search) |
| `usePopoverDialog`: role / description, focus in, Escape inside and from the page, ignores a used Escape, focus back, keeps user-moved focus; `moveMenuFocus` (jest `src/components/a11y/__tests__/a11y.test.tsx`) | ✅ |
| Pill menu menuitems, arrows, Escape / Tab back to the pill; Edit filter dialog back to the pill; Add filter dialog back to the trigger (jest) | ✅ |
| Field `Preview log.level: string` opens the field dialog, Escape returns focus; row action names (jest) | ✅ |
| Grid `aria-activedescendant` follows the cursor; sort button + `aria-sort`; `Move X left/right`, `Remove column X`; Expand / bucket / Toggletip dialogs carry the hint (jest) | ✅ |
| Keyboard drag: lift / move / drop / cancel / blur, spoken messages, Escape does not reach the page (jest `src/lens/__tests__/a11y.test.tsx`) | ✅ |
| Legend ⋮ menu focus / arrows / Escape back to ⋮; dimension editor Escape closes, page Escape does not, focus to the dimension (jest) | ✅ |
| E2E (`tests/features/shared-a11y-01.spec.ts`): field Preview + Escape focus return; pill menu arrows / Escape / Edit filter dialog; Add filter dialog; grid active descendant + Expand; Display options; Visualize keyboard drag to the workspace and to Breakdown with live messages, editor Escape back to the dimension, cancel; legend ⋮ menu | not run (coordinator) |
| E2E selector updates: `LogsPage.pillAction` and `disc-doc-02` pick pill menu items by role `menuitem` (were `button`) | not run (coordinator) |

## Deferred
- A keyboard drag mode on Discover (field → grid column, column / tab reordering): the button alternatives cover the same actions.
- Moving dimensions between Visualize groups by drag (mouse or keyboard): still deferred from LENS-DIM-01.
- Focus trapping inside the custom popovers (Kibana traps; ours are non-modal, Tab may leave them; menus close on Tab).
- Grid cells as `gridcell` with row / column counts (`aria-rowcount`), and a ⌨ Keyboard shortcuts help popover (DISC-TABLE-01 toolbar).
- A full screen-reader pass (NVDA / VoiceOver) and an automated axe scan in e2e.
