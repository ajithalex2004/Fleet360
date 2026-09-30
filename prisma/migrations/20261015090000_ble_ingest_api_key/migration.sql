-- BLE gateways authenticate to /api/assets/ble/ingest with an API key; the
-- route finds the gateway by the key's SHA-256. The unique index makes that
-- lookup fast and guarantees a key can only ever belong to one gateway. Keys
-- are 256 random bits, so no existing rows can collide.
--
-- The ble_tags columns are the ones the ingest route writes on every
-- detection of a known tag. 20261009090000_missing_module_tables only added
-- them where ble_tags already existed when it ran, and the runtime role may
-- not add them itself, so a database could be left without them and every
-- known-tag detection would fail. Safe to re-run.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ble_gateways_api_key_hash ON public.ble_gateways (api_key_hash) WHERE api_key_hash IS NOT NULL;
ALTER TABLE IF EXISTS public.ble_tags ADD COLUMN IF NOT EXISTS tag_type TEXT DEFAULT 'GENERIC';
ALTER TABLE IF EXISTS public.ble_tags ADD COLUMN IF NOT EXISTS tag_model TEXT;
ALTER TABLE IF EXISTS public.ble_tags ADD COLUMN IF NOT EXISTS advertisement_interval_ms INT;
ALTER TABLE IF EXISTS public.ble_tags ADD COLUMN IF NOT EXISTS current_gateway_id TEXT;
ALTER TABLE IF EXISTS public.ble_tags ADD COLUMN IF NOT EXISTS current_gateway_zone TEXT;
ALTER TABLE IF EXISTS public.ble_tags ADD COLUMN IF NOT EXISTS tx_power INT;
