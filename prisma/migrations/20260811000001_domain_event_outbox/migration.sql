-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 1 – Domain Event Infrastructure
-- Tables: event_outbox, event_consumer_inbox
--
-- event_outbox      → transactional outbox; rows written atomically with the
--                     business mutation, then published by the outbox-publisher job
-- event_consumer_inbox → per-consumer idempotency guard; prevents double-processing
-- ─────────────────────────────────────────────────────────────────────────────

-- ── event_outbox ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_outbox (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  event_type      TEXT        NOT NULL,            -- e.g. 'trip.completed'
  event_version   TEXT        NOT NULL DEFAULT '1',
  aggregate_type  TEXT        NOT NULL,            -- e.g. 'TripSchedule'
  aggregate_id    TEXT        NOT NULL,
  source_module   TEXT        NOT NULL,            -- e.g. 'bus-ops'
  tenant_id       UUID        NOT NULL,
  correlation_id  UUID        NULL,
  causation_id    UUID        NULL,
  actor           TEXT        NULL,                -- userId or 'system'
  payload         JSONB       NOT NULL,            -- event-specific data
  occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at    TIMESTAMPTZ NULL,                -- set by outbox-publisher on success
  failed_at       TIMESTAMPTZ NULL,
  failure_reason  TEXT        NULL,
  retry_count     INT         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_outbox_unpublished
  ON event_outbox (created_at ASC)
  WHERE published_at IS NULL AND failed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_event_outbox_tenant
  ON event_outbox (tenant_id, event_type);

CREATE INDEX IF NOT EXISTS idx_event_outbox_aggregate
  ON event_outbox (aggregate_type, aggregate_id);

-- ── event_consumer_inbox ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS event_consumer_inbox (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  consumer_name   TEXT        NOT NULL,            -- e.g. 'finance-trip'
  event_id        UUID        NOT NULL,            -- matches event_outbox.event_id
  event_type      TEXT        NOT NULL,
  tenant_id       UUID        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'PROCESSED',  -- PROCESSED | FAILED | SKIPPED
  processed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  error_message   TEXT        NULL,
  CONSTRAINT uq_consumer_event UNIQUE (consumer_name, event_id)
);

CREATE INDEX IF NOT EXISTS idx_consumer_inbox_event
  ON event_consumer_inbox (event_id);

CREATE INDEX IF NOT EXISTS idx_consumer_inbox_consumer_tenant
  ON event_consumer_inbox (consumer_name, tenant_id, processed_at DESC);
