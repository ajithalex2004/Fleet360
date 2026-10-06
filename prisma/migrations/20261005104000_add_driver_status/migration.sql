ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE';

CREATE INDEX IF NOT EXISTS idx_drivers_status
  ON public.drivers (status);
