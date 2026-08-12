-- Migration: 20260805100000_webauthn_credentials
--
-- WebAuthn credential store for the driver mobile app's biometric
-- login. Two tables:
--   - webauthn_credentials — one row per (user × device). Holds the
--     public key, the anti-replay counter, the friendly device name,
--     and a last_used_at for the "My devices" page.
--   - webauthn_challenges — single-use challenges for register and
--     login ceremonies. Short TTL (2 minutes); deleted on consume.
--
-- RLS: webauthn_credentials has a tenant_id so RLS scoping is possible
-- if we ever expose "list my devices" across a tenant admin context.
-- For now, the API layer only ever reads by user_id, so the policy is
-- permissive — we don't want a buggy RLS rule to brick biometric
-- login. Tighten if/when a tenant-admin "manage user devices" UI
-- lands.
--
-- Applied via docs/apply_webauthn_migration.py (bypassing
-- prisma migrate deploy because of the pre-existing failed migration
-- 20260625120000_add_tenant_id_to_dispatch_tables).

CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id              TEXT PRIMARY KEY,
  user_id         UUID        NOT NULL,
  tenant_id       UUID        NOT NULL,
  public_key      TEXT        NOT NULL,
  counter         BIGINT      NOT NULL DEFAULT 0,
  device_name     TEXT        NOT NULL DEFAULT 'Device',
  -- The transports the credential was registered with. iOS / Android
  -- typically report ['internal']. Stored as text[] for future-proof
  -- against 'usb' / 'nfc' / 'ble' if we ever support roaming keys.
  transports      TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  last_used_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webauthn_credentials_user_idx
  ON webauthn_credentials (user_id);
CREATE INDEX IF NOT EXISTS webauthn_credentials_tenant_idx
  ON webauthn_credentials (tenant_id);

CREATE TABLE IF NOT EXISTS webauthn_challenges (
  -- The challenge string from generateRegistrationOptions /
  -- generateAuthenticationOptions. We store it as a TEXT key and
  -- delete on consume. The (user_id, kind) lookup pattern means we
  -- don't strictly need an index, but a single-row LIMIT 1 is cheap
  -- either way.
  challenge       TEXT PRIMARY KEY,
  user_id         UUID        NOT NULL,
  kind            TEXT        NOT NULL CHECK (kind IN ('register', 'login')),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webauthn_challenges_user_kind_idx
  ON webauthn_challenges (user_id, kind);

-- Belt-and-braces: clean up expired challenges every minute via a
-- background sweeper. We don't want abandoned challenges accumulating
-- forever. Done as a pg_cron-style statement that's a no-op without
-- the extension, so the migration works on vanilla Postgres too.
-- (If the operator has pg_cron, this picks it up; otherwise the
-- driver API tolerates expired challenges by returning 'no challenge
-- in flight' on stale reads.)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'webauthn-cleanup',
      '* * * * *',
      $cron$DELETE FROM webauthn_challenges WHERE expires_at < NOW()$cron$
    );
  END IF;
END$$;
