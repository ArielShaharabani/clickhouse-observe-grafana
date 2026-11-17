## End-to-end user flows

These five flows were run step by step on the telemetry data, which contains a payments error spike on Nov 15 09:00–11:00. Each step lists the expected state, so the flows double as E2E test scripts.

### FLOW-1 Find the cause of an error spike (Discover only)

1. Open Discover on `Telemetry logs`, Last 7 days. → Documents (149,982), flat histogram, Summary column.
2. Click field `log.level` → popover Top values info 69.6%, warn 15.4%, debug 9.9%, error 5.2%. Click ⊕ on `error`. → Pill `log.level: error`; Documents (7,635); histogram shows one tall bar on the 15th; `log.level` moves to Popular fields.
3. Type ` service.name :  ` in KQL; pick `"payments"` from value suggestions; Enter. → Documents (1,688); matched terms highlighted in Summary.
4. Breakdown → `host.name`. → Stacked bars and legend node-01…node-08; spike spread over all hosts (not one bad node).
5. Click-drag across the spike. → Time `Nov 15, 01:22 → 18:43 ~17h`, interval 30 minutes, Documents (366).
6. Add columns `service.name`, `log.level`, `message`. → Messages visible: “Payment declined…”, “NullPointerException at OrderService.java…”.
7. Expand the first row → flyout; Actions → View surrounding documents. → Context view with filters disabled, anchor row highlighted, neighbouring info/debug lines from other services.

### FLOW-2 From a field to a chart and back

1. In Discover click `service.name` → `Visualize`. → Lens: Bar, `Top 9 values of service.name` × Count of records; suggestions Heat map, Treemap, Count of records, Pie, Waffle.
2. Add `log.level`. → It becomes Breakdown; stacked bars.
3. Click the bottom segment of `checkout`. → Modal `Select filters to apply` with `service.name: checkout` and `log.level: info` ticked. Apply. → Two pills; chart shows one bar.
4. Click `Explore in Discover`. → New tab: Discover with both filters, columns `service.name`, `log.level`, Documents (21,123).

### FLOW-3 Recognise noisy log patterns

1. Discover → `Patterns` tab. → `Patterns (12)`; top rows `Cache hit for key …` 33,910, `User … logged in` 26,510.
2. Expand row 1. → Tokens `Cache for key`, Regex `.*?Cache.+?for.+?key.*?`, 4 examples.
3. Tick rows 1 and 3 → `Selected 2` → `Filter out patterns`. → Expected (menu observed, action not run): one filter excluding both patterns is added.

### FLOW-4 Profile an unknown dataset

1. Discover → `Field statistics` tab. → One row per field with Documents (%), Distinct values and a mini distribution.
2. Expand `event.duration`. → count 5000, distinct 471, min 1,000,000, median 54,367,253.669, max 3,650,000,000 and top values with ⊕/⊖.
3. Click the row's Lens action. → Lens opens with that field charted.

### FLOW-5 Aggregate with a piped query

1. Click `Query in ES|QL`. → Editor shows `FROM logs-app-*`; status `1K documents processed`.
2. Append `| STATS c = COUNT(*) BY service.name`; Ctrl+Enter. → Bar chart by service, sidebar shows `c` and `service.name`, table `5 groups` with expandable rows.
3. Type `|` → command autocomplete (CHANGE\_POINT, DEDUP, DISSECT, DROP, ENRICH, EVAL, …).
