-- Legacy environments created trip_stop_visits outside tracked migrations.
-- Fresh replay must provision it before adding the durable delay marker.
-- IF NOT EXISTS preserves all visit/notification evidence on existing databases.
CREATE TABLE IF NOT EXISTS public.trip_stop_visits (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  tenant_id TEXT NOT NULL,
  schedule_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  approached_at TIMESTAMPTZ,
  entered_at TIMESTAMPTZ,
  left_at TIMESTAMPTZ,
  approach_notified_at TIMESTAMPTZ,
  CONSTRAINT uniq_trip_stop_visit UNIQUE (schedule_id, stop_id)
);
-- Marker and corresponding outbox event are committed in one transaction.
ALTER TABLE public.trip_stop_visits
  ADD COLUMN IF NOT EXISTS delay_notified_at TIMESTAMPTZ;
ALTER TABLE public.trip_stop_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trip_stop_visits FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'trip_stop_visits'
      AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON public.trip_stop_visits
      USING (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.tenant_id', true) = '*')
      WITH CHECK (tenant_id = current_setting('app.tenant_id', true) OR current_setting('app.tenant_id', true) = '*');
  END IF;
END $$;
