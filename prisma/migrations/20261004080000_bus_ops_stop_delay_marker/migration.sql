-- A committed marker and the corresponding outbox event are written in one
-- transaction. Repeated GPS pings / ETA polls cannot generate duplicate alerts.
ALTER TABLE public.trip_stop_visits
  ADD COLUMN IF NOT EXISTS delay_notified_at timestamptz;
