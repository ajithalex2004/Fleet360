-- Architectural risk #7 — per-gateway BLE HMAC secrets.
--
-- Before: every gateway signed with a single shared env secret
--   BLE_GATEWAY_SHARED_SECRET. Rotating the secret rotated it for
--   every gateway at once — big blast radius, no per-device recovery.
-- After: each ble_gateways row carries its own secret. Rotation is
--   per-gateway via POST /api/bus-ops/gateways/[id]/rotate-secret.
--   The env var stays as a fallback for gateways whose per-row secret
--   is still NULL — backward-compat during rollout, kept until every
--   gateway is rotated at least once.

ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS secret TEXT;
ALTER TABLE ble_gateways ADD COLUMN IF NOT EXISTS secret_rotated_at TIMESTAMPTZ;
