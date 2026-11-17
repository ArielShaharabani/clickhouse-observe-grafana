## Master interaction inventory

Every observed interaction in one checklist, grouped by area. “State change” says what an implementation must update.

| ID | Element | Location | Trigger | Result | State change |
| --- | --- | --- | --- | --- | --- |
| I-01 | Field name | Sidebar | Click | Field stats popover | none |
| I-02 | ⊕ on field row | Sidebar (hover) | Click | Adds column (Discover) / adds to chart (Lens) | `columns` / Lens dims |
| I-03 | Field row | Sidebar | Drag | Drop on grid column area or Lens drop zone | `columns` / Lens dims |
| I-04 | Top value ⊕ / ⊖ | Field popover | Click | Filter for / out value | `filters` + re-query |
| I-05 | 📊 icon | Field popover header | Click | Set histogram breakdown | `breakdownField` |
| I-06 | Filter icon | Field popover header | Click | Add `exists` filter | `filters` |
| I-07 | Visualize | Field popover footer | Click | Open Lens with auto chart (Maps for geo) | navigation |
| I-08 | Top values \| Distribution | Number field popover | Toggle | Switch view | none |
| I-09 | Type filter | Sidebar search | Click | Filter list by type with counts | local |
| I-10 | KQL input | Search bar | Type | Field then value suggestions | draft query; button → `Update` |
| I-11 | KQL input | Search bar | Enter | Run query | `query` |
| I-12 | Query menu ⋮ | Search bar | Click | Apply to all, Clear all, Load/Save query, language | `query`, `filters` |
| I-13 | ⊕ Add filter | Search bar | Click | Filter builder popover | `filters` |
| I-14 | Filter pill | Filter row | Click | Pin / Edit / Exclude / Disable / Delete | filter `meta` |
| I-15 | Pill × | Filter row | Click | Delete filter | `filters` |
| I-16 | Filter count badge | Search bar | Click | Collapse/expand filter row | local |
| I-17 | Time picker | Search bar | Click / type | Presets, Recent, Calendar, Custom, shorthand | `time` |
| I-18 | ‹ ⊕ › | Search bar | Click | Shift back / zoom out / shift forward | `time` |
| I-19 | Refresh / Update | Search bar | Click | Run; split → Send to background | query run |
| I-20 | Interval select | Chart toolbar | Choose | Re-bucket histogram | `interval` |
| I-21 | Breakdown select | Chart toolbar | Choose | Stack by field | `breakdownField` |
| I-22 | Hide sidebar / chart / table | Chart toolbar | Click | Collapse region | layout |
| I-23 | Histogram | Chart | Hover | Tooltip with per-series counts | none |
| I-24 | Histogram | Chart | Drag | Set absolute time | `time` |
| I-25 | Histogram bar | Chart | Right-click | Pinned tooltip: Filter by time, Filter N selected series | `time` / `filters` |
| I-26 | Legend item | Chart | Click / Ctrl+click | Isolate / hide series | local |
| I-27 | Legend ⋮ | Chart | Click | Filter for / Filter out | `filters` |
| I-28 | Edit visualization | Chart toolbar | Click | Open histogram in Lens | navigation |
| I-29 | Cell | Grid | Hover / focus | Action bar: filter for, filter out, copy, expand | none |
| I-30 | Cell expand | Grid | Click | Popover with full value + actions | none |
| I-31 | Column header ⋮ | Grid | Click | Remove, Sort A-Z/Z-A, Move, Copy name/column, Edit field | `columns`, `sort` |
| I-32 | Column border | Grid | Drag | Resize | column width |
| I-33 | Row checkbox | Grid | Click | Select rows (compare, copy) | selection |
| I-34 | Row ⤢ | Grid | Click | Doc flyout | `expandedDoc` |
| I-35 | Flyout nav | Flyout | Click | Prev/next document | `expandedDoc` |
| I-36 | Flyout row | Flyout | Hover | Pin field; value actions; field actions (exists, toggle column) | pins, `columns`, `filters` |
| I-37 | Selected only / Hide null | Flyout | Toggle | Filter the field table | local |
| I-38 | Surrounding documents | Flyout actions | Click | Context route, filters disabled | navigation |
| I-39 | Load N newer/older | Context view | Click | Fetch more neighbours | local |
| I-40 | Pattern row ⊕/⊖ | Patterns tab | Click | Filter for/out pattern | `filters` |
| I-41 | Pattern rows + Selected | Patterns tab | Tick + menu | Multi-pattern filter | `filters` |
| I-42 | Pattern ⚙ | Patterns tab | Click | Min time range, sampling | local |
| I-43 | Field stats row › | Field statistics tab | Click | Expanded stats | none |
| I-44 | Display options | Grid toolbar | Click | Sample size, density, header/body lines | `sampleSize`, `rowHeight` |
| I-45 | Tab +, ⋮, list | Session bar | Click | New / rename / duplicate / restore tabs | `tabs` |
| I-46 | Query in ES\|QL | Session bar | Click | Switch to ES\|QL editor | `dataSource`, `query` |
| I-47 | Lens field ⊕ | Lens sidebar | Click | Auto chart via suggestions | Lens state |
| I-48 | Suggestion card | Lens | Click | Replace visualization | Lens state |
| I-49 | Chart switcher | Lens | Choose | Remap dimensions to new type | Lens state |
| I-50 | Dimension | Lens panel | Click | Dimension editor flyout | Lens state |
| I-51 | Dimension | Lens panel | Drag | Move / reorder / replace / swap | Lens state |
| I-52 | Chart value | Lens | Click | Filter (chooser if several dims) | `filters` |
| I-53 | Explore in Discover | Lens nav | Click | Discover with filters + columns | navigation |
| I-54 | Inspect | Lens / Discover | Click | Data table (with filter actions) / Requests | none |
| I-55 | Export | Lens nav | Click | PDF / PNG / CSV | none |
