-- Exclusive delivery claims for event_outbox (architecture audit A2/A3).
--
-- The publisher claims a batch in one statement (UPDATE … WHERE id IN
-- (SELECT … FOR UPDATE SKIP LOCKED)), stamping an owner token and an
-- expiry. Another run, replica or overlapping tick skips rows with a live
-- claim, so an event is delivered by one worker at a time. A crashed
-- worker's claim lapses at claim_expires_at and the row is picked up again.
-- Additive and nullable: existing rows need no backfill.

ALTER TABLE public.event_outbox
  ADD COLUMN IF NOT EXISTS claimed_by       TEXT        NULL,
  ADD COLUMN IF NOT EXISTS claim_expires_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_event_outbox_claimable
  ON public.event_outbox (created_at)
  WHERE published_at IS NULL;
