-- Make human-facing sequence numbers unique per tenant instead of globally.
--
-- request_no, trip_number and report_no were each globally @unique. Their
-- generators counted rows with no tenant predicate:
--
--     const count = await tx.staffTransportRequest.count();
--     const requestNo = `REQ-${String(count + 1).padStart(5, '0')}`;
--
-- That is why those three call sites could not simply be given a tenantId
-- filter, which is what the tenant-scoping work wanted to do: a per-tenant
-- count produces a number that a global unique index will reject as soon as
-- any other tenant already holds it. The constraint had to move first.
--
-- Two consequences worth stating plainly:
--
--   * Tenants could infer each other's volume. REQ-00042 told you the platform
--     held 41 requests, across everyone.
--   * Numbering jumped unpredictably per tenant — a tenant creating its second
--     request could receive REQ-00087.
--
-- The generators are also being changed to derive from MAX(suffix) rather than
-- COUNT(*). Counting is wrong independently of tenancy: delete a row and the
-- next number collides with one already issued. The composite index below now
-- rejects that instead of silently duplicating, so the generator change is not
-- optional.
--
-- Safe on current data: 7 / 9 / 0 rows, and zero (tenant_id, number) duplicates,
-- so the new constraints are satisfiable without a backfill.
--
-- NOT covered: incidents.incident_no. TripIncident maps to public.incidents,
-- which does not exist in this database — the endpoint fails with 42P01 before
-- it can reach a uniqueness problem. That is schema drift needing its own fix.
--
-- Idempotent throughout.

-- 1. Drop the global unique indexes.
--    Not destructive to data: an index carries none. Dropping before adding
--    avoids a window where a per-tenant insert is rejected by the old global
--    constraint.
DROP INDEX IF EXISTS public.staff_transport_requests_request_no_key;
DROP INDEX IF EXISTS public.trip_schedules_trip_number_key;
DROP INDEX IF EXISTS public.breakdown_reports_report_no_key;

-- 2. Composite uniqueness, per tenant.
--    Partial on IS NOT NULL because all three columns are nullable and rows
--    without a number must stay insertable — Postgres treats NULLs as distinct
--    anyway, but the partial index makes the intent explicit and keeps the
--    index smaller.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_staff_transport_requests_tenant_request_no
  ON public.staff_transport_requests (tenant_id, request_no)
  WHERE request_no IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_trip_schedules_tenant_trip_number
  ON public.trip_schedules (tenant_id, trip_number)
  WHERE trip_number IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_breakdown_reports_tenant_report_no
  ON public.breakdown_reports (tenant_id, report_no)
  WHERE report_no IS NOT NULL;
