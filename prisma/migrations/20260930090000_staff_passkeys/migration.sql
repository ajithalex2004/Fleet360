-- Staff passkeys (WebAuthn) for step-up before high-impact admin actions.
--
--   staff_passkeys        one row per registered passkey: the credential's
--                         public key and signature counter, bound to the
--                         relying party (rp_id) it was registered for.
--   step_up_challenges    single-use WebAuthn challenges (2-minute TTL),
--                         deleted when consumed.
--
-- Written and read by src/lib/auth/passkeys.ts only, in platform context
-- (withPlatformAdmin): the rows belong to a user, not a tenant, so no tenant
-- context may see them. The driver app's biometric login keeps its own
-- tables (webauthn_credentials / webauthn_challenges).
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS staff_passkeys (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL,
  rp_id         TEXT NOT NULL,
  public_key    TEXT NOT NULL,
  counter       BIGINT NOT NULL DEFAULT 0,
  transports    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  device_name   TEXT NOT NULL,
  created_at    TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ(6)
);

CREATE INDEX IF NOT EXISTS idx_staff_passkeys_user ON staff_passkeys (user_id);

CREATE TABLE IF NOT EXISTS step_up_challenges (
  challenge   TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('register', 'assert')),
  expires_at  TIMESTAMPTZ(6) NOT NULL,
  created_at  TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_step_up_challenges_user ON step_up_challenges (user_id, kind);

DO $$
DECLARE pol record;
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_passkeys', 'step_up_challenges'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fleet360_app') THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO fleet360_app', t);
    END IF;
    FOR pol IN SELECT policyname FROM pg_policies
                WHERE schemaname = 'public' AND tablename = t LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, t);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    -- Platform context only: credentials belong to a user across tenants.
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL
         USING (current_setting(''app.tenant_id'', true) = ''*'')
         WITH CHECK (current_setting(''app.tenant_id'', true) = ''*'')',
      t || '_platform_only', t);
  END LOOP;
END $$;
