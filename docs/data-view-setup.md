# Data view setup: performance tips

## Wildcard text search (`Body : *Timeout*`)

A KQL wildcard or substring term compiles to `Body ILIKE '%Timeout%'`, which reads and scans the whole
message column over the time range (about 1.8 s at 50M rows). If the message column has an
`ngrambf_v1` skip index on its **lower-cased** value, the plugin detects it (from
`system.data_skipping_indices`, read-only) and compiles the same search to
`lower(Body) LIKE '%timeout%'`, which ClickHouse can use to skip granules. The rows returned are the
same: both forms fold ASCII case.

```sql
ALTER TABLE otel_logs
  ADD INDEX idx_body_ngram lower(Body) TYPE ngrambf_v1(3, 32768, 3, 0) GRANULARITY 1;
-- Index existing parts too (optional, runs in the background):
ALTER TABLE otel_logs MATERIALIZE INDEX idx_body_ngram;
```

Notes:

- The indexed expression must be exactly `lower(<message column>)`. An index on the plain column
  only speeds up case-sensitive `LIKE`, so the plugin leaves those searches as `ILIKE`.
- The first number is the n-gram size (3 here). Needles shorter than it, patterns with a wildcard
  in the middle (`*a*b*`) and non-ASCII needles keep the plain `ILIKE`.
- Size the Bloom filter (second number, bytes) to your data; too small a filter matches everything
  and gives no speed-up.
- `tokenbf_v1` and `text` indexes are not used for `*term*`: they match whole tokens, so
  `hasToken(Body, 'timeout')` would miss `timeouts` or `ReadTimeoutError`, which the substring
  search finds.
- The plugin never creates indexes. Detection happens when the data view's fields load; use
  "Reload fields" after adding the index.

## Long-range filters

The document list searches the newest window first (1 h, then 6 h, 36 h, then the full range) and
stops when the page is full, so a selective filter over a long range returns its newest rows
without scanning the whole range. No setup is needed; the histogram and total count still cover the
full range.
