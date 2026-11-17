-- Deterministic fixture for the spec-driven test suite (docs/dev/TESTING.md).
-- Fixed absolute window 2026-01-01 00:00:00 → 2026-01-08 00:00:00 UTC, so counts never age out
-- and tests can assert exact numbers. No TTL (otel_logs has a 30-day TTL that would delete it).
CREATE TABLE IF NOT EXISTS default.spec_logs AS default.otel_logs
ENGINE = MergeTree()
PARTITION BY toDate(TimestampTime)
ORDER BY (ServiceName, TimestampTime, Timestamp);

-- Base traffic: one row every 15 s for 7 days = 40,320 rows.
--   service  = 5 services, round-robin on number
--   level    = cityHash64(number) % 100: <70 info, <85 warn, <95 debug, else error
--   message  = one of 8 templates with variable parts (exercises pattern analysis)
INSERT INTO default.spec_logs
    (Timestamp, TraceId, SpanId, SeverityText, SeverityNumber, ServiceName, Body, ResourceAttributes, LogAttributes)
SELECT
    toDateTime64(toDateTime('2026-01-01 00:00:00', 'UTC') + toIntervalSecond(number * 15), 9, 'UTC') AS Timestamp,
    lower(hex(cityHash64(number, 1)))                                   AS TraceId,
    lower(hex(cityHash64(number, 2)))                                   AS SpanId,
    multiIf(h < 70, 'info', h < 85, 'warn', h < 95, 'debug', 'error')   AS SeverityText,
    -- OTel severity numbers: DEBUG 5, INFO 9, WARN 13, ERROR 17
    multiIf(h < 70, 9, h < 85, 13, h < 95, 5, 17)                       AS SeverityNumber,
    ['checkout','frontend','payments','inventory','auth'][1 + (number % 5)] AS ServiceName,
    [
      concat('Request completed in ', toString(10 + cityHash64(number, 3) % 900), 'ms'),
      concat('User user', toString(cityHash64(number, 4) % 500), ' logged in'),
      concat('Cache hit for key ', lower(hex(cityHash64(number, 5) % 4294967295))),
      concat('Order ', toString(10000 + cityHash64(number, 6) % 90000), ' created'),
      concat('Retrying request to auth (attempt ', toString(1 + number % 5), ')'),
      concat('Slow query detected: ', toString(1000 + cityHash64(number, 7) % 9000), 'ms on table orders'),
      concat('Payment declined for order ', toString(10000 + cityHash64(number, 8) % 90000), ': insufficient funds'),
      concat('Timeout after ', toString(100 + cityHash64(number, 9) % 5000), 'ms calling inventory')
    ][1 + (cityHash64(number, 10) % 8)]                                 AS Body,
    map('service.name', ['checkout','frontend','payments','inventory','auth'][1 + (number % 5)],
        'host.name', concat('node-0', toString(1 + number % 8)),
        'cloud.region', ['us-east-1','eu-west-1','ap-south-1'][1 + (number % 3)]) AS ResourceAttributes,
    map('http.method', ['GET','POST','PUT'][1 + (number % 3)],
        'http.status_code', if(h >= 95, '500', '200'),
        'duration_ms', toString(5 + cityHash64(number, 11) % 2000))     AS LogAttributes
FROM (SELECT number, cityHash64(number) % 100 AS h FROM numbers(40320));

-- Incident: 2026-01-05 09:00–11:00 UTC, payments emits 1,200 extra error rows (one every 6 s)
-- with "Payment declined" / "Timeout" messages and slow durations.
INSERT INTO default.spec_logs
    (Timestamp, TraceId, SpanId, SeverityText, SeverityNumber, ServiceName, Body, ResourceAttributes, LogAttributes)
SELECT
    toDateTime64(toDateTime('2026-01-05 09:00:00', 'UTC') + toIntervalSecond(number * 6), 9, 'UTC'),
    lower(hex(cityHash64(number, 21))),
    lower(hex(cityHash64(number, 22))),
    'error',
    17,
    'payments',
    if(number % 2 = 0,
       concat('Payment declined for order ', toString(10000 + cityHash64(number, 23) % 90000), ': insufficient funds'),
       concat('Timeout after ', toString(3000 + cityHash64(number, 24) % 5000), 'ms calling inventory')),
    map('service.name', 'payments', 'host.name', concat('node-0', toString(1 + number % 8)), 'cloud.region', 'eu-west-1'),
    map('http.method', 'POST', 'http.status_code', '503', 'duration_ms', toString(3000 + cityHash64(number, 25) % 5000))
FROM numbers(1200);
