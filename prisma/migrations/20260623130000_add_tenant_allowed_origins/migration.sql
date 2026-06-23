-- Multi-tenant CORS: each tenant records the browser origins allowed to
-- call the Go backend on its behalf, eliminating the previous hardcoded
-- `http://localhost:3000` allow-list. Onboarding a new enterprise tenant
-- becomes a single UPDATE on this column — no recompile, no container
-- restart, no .env edit.
--
-- Format: comma-separated origins (scheme + host + optional port), e.g.
--   https://fleet.clientA.com,https://staging.fleet.clientA.com
-- This mirrors the existing `supported_languages` convention on the same
-- table rather than introducing a JSON / array column for a value that
-- two small services need to consume.
--
-- NULL means this tenant has no tenant-specific origins; in that case it
-- still gets the system-wide ALLOWED_ORIGINS env baseline (dev + internal
-- admin domains) via the Go backend's CORS middleware.
ALTER TABLE "tenants"
  ADD COLUMN "allowed_origins" TEXT;
