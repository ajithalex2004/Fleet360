-- esign_requests.failed_attempts: per-request counter of wrong signing OTPs.
--
-- src/app/api/esign/verify/route.ts used to add this column at request time
-- (ensureFailedAttemptsColumn) in a platform-admin savepoint, ignoring
-- failures. That tripped the runtime-DDL guard
-- (scripts/check-no-runtime-ddl.mjs). Moved here verbatim. The route still
-- falls back to its in-memory attempt map if the column is ever missing.
--
-- IF NOT EXISTS: a no-op where the request-time ALTER already ran.
ALTER TABLE esign_requests
  ADD COLUMN IF NOT EXISTS failed_attempts INT NOT NULL DEFAULT 0;
