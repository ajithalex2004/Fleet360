-- Task 6 — BoardingEvent.method → Postgres ENUM
--
-- boarding_events.method was TEXT (comment: 'QR|NFC|BLE|MANUAL'). Task
-- spec requires an enforced enum. Adds two new variants used by other
-- ingest paths: DRIVER_APP (driver app taps a check-off) and GEOFENCE
-- (server-derived from stop-arrival + roster match).
--
-- Prisma model updated in the same commit:
--   BoardingEvent.method String → BoardingEventSource
--
-- BLE ingest (POST /api/bus-ops/gateway/events) already writes BoardingEvent
-- rows with method='BLE'. Now the type is enforced.

CREATE TYPE boarding_event_source AS ENUM (
  'BLE', 'QR', 'NFC', 'MANUAL', 'DRIVER_APP', 'GEOFENCE'
);

ALTER TABLE boarding_events
  ALTER COLUMN method DROP DEFAULT,
  ALTER COLUMN method TYPE boarding_event_source USING method::boarding_event_source;
