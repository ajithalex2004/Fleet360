ALTER TABLE public."User"
  ADD COLUMN IF NOT EXISTS password_hash TEXT;
