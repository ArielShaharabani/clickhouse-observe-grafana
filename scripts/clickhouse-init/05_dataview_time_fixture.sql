-- Fixture for converted time fields (data view time field, PLAN #16d): the deterministic
-- default.spec_logs rows (04_spec_fixture.sql) with the event time stored as epoch numbers and as
-- text instead of a DateTime column. A plain VIEW, so it costs no storage and always returns
-- exactly the spec_logs rows (same counts as tests/fixture.ts).
--
-- On a ClickHouse volume created before this file existed, load it once by hand:
--   docker exec -i clickhouse-observe-grafana-dev-clickhouse-1 clickhouse-client --multiquery < scripts/clickhouse-init/05_dataview_time_fixture.sql
-- (CREATE OR REPLACE makes it safe to run again.)

CREATE OR REPLACE VIEW default.spec_logs_epoch AS
SELECT
    toUnixTimestamp(Timestamp) AS ts_s,          -- UInt32 seconds
    toUnixTimestamp64Milli(Timestamp) AS ts_ms,  -- Int64 milliseconds
    toUnixTimestamp64Nano(Timestamp) AS ts_ns,   -- Int64 nanoseconds
    formatDateTime(Timestamp, '%Y-%m-%dT%H:%i:%S.%fZ', 'UTC') AS ts_text, -- String, ISO 8601 UTC
    Body,
    SeverityText,
    SeverityNumber,
    ServiceName,
    TraceId
FROM default.spec_logs;
