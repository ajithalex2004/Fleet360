-- =============================================================================
-- Pillar 3: Unified Identity Link (User.id <-> Driver.id Foreign Key)
-- =============================================================================
-- 1. Add explicit user_id column on public.drivers referencing public."User"(id)
ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS user_id TEXT REFERENCES public."User"(id) ON DELETE SET NULL;

-- 2. Partial unique index ensuring 1-to-1 identity mapping for active drivers
CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_user_id_unique
  ON public.drivers (user_id)
  WHERE user_id IS NOT NULL AND deleted_at IS NULL;

-- 3. Composite index for O(1) tenant + user_id driver lookup on login & dispatch
CREATE INDEX IF NOT EXISTS idx_drivers_tenant_user_id
  ON public.drivers (tenant_id, user_id)
  WHERE deleted_at IS NULL;

-- 4. Backfill Step A: Direct UUID parity (drivers.id == "User".id)
UPDATE public.drivers d
SET user_id = u.id,
    updated_at = NOW()
FROM public."User" u
WHERE d.user_id IS NULL
  AND d.deleted_at IS NULL
  AND u.id = d.id::text
  AND NOT EXISTS (
    SELECT 1 FROM public.drivers d2
    WHERE d2.user_id = u.id AND d2.deleted_at IS NULL
  );

-- 5. Backfill Step B: Deterministic tenant-scoped identity matching
--    (email -> employeeId -> username -> exact full name)
WITH candidate_matches AS (
  SELECT DISTINCT ON (d.id)
    d.id AS driver_id,
    u.id AS matched_user_id
  FROM public.drivers d
  JOIN public.user_tenants ut
    ON ut.tenant_id::text = d.tenant_id::text
  JOIN public."User" u
    ON u.id = ut.user_id
  WHERE d.user_id IS NULL
    AND d.deleted_at IS NULL
    AND (
      (NULLIF(TRIM(d.email), '') IS NOT NULL AND LOWER(TRIM(u.email)) = LOWER(TRIM(d.email)))
      OR (NULLIF(TRIM(d.employee_id), '') IS NOT NULL AND LOWER(TRIM(COALESCE(u."employeeId", ''))) = LOWER(TRIM(d.employee_id)))
      OR (NULLIF(TRIM(d.employee_id), '') IS NOT NULL AND LOWER(TRIM(COALESCE(u.username, ''))) = LOWER(TRIM(d.employee_id)))
      OR (
        NULLIF(TRIM(d.name), '') IS NOT NULL
        AND LOWER(REGEXP_REPLACE(TRIM(CONCAT(COALESCE(u."firstName", ''), ' ', COALESCE(u."lastName", ''))), '\s+', ' ', 'g'))
          = LOWER(REGEXP_REPLACE(TRIM(d.name), '\s+', ' ', 'g'))
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.drivers d2
      WHERE d2.user_id = u.id AND d2.deleted_at IS NULL
    )
  ORDER BY
    d.id,
    CASE
      WHEN NULLIF(TRIM(d.email), '') IS NOT NULL AND LOWER(TRIM(u.email)) = LOWER(TRIM(d.email)) THEN 1
      WHEN NULLIF(TRIM(d.employee_id), '') IS NOT NULL AND LOWER(TRIM(COALESCE(u."employeeId", ''))) = LOWER(TRIM(d.employee_id)) THEN 2
      WHEN NULLIF(TRIM(d.employee_id), '') IS NOT NULL AND LOWER(TRIM(COALESCE(u.username, ''))) = LOWER(TRIM(d.employee_id)) THEN 3
      ELSE 4
    END ASC,
    u."createdAt" ASC
),
deduped_matches AS (
  SELECT DISTINCT ON (matched_user_id)
    driver_id,
    matched_user_id
  FROM candidate_matches
  ORDER BY matched_user_id, driver_id
)
UPDATE public.drivers d
SET user_id = dm.matched_user_id,
    updated_at = NOW()
FROM deduped_matches dm
WHERE d.id = dm.driver_id
  AND d.user_id IS NULL;

-- 6. Synchronize User.employeeId from linked drivers where User.employeeId is missing
UPDATE public."User" u
SET "employeeId" = d.employee_id
FROM public.drivers d
WHERE d.user_id = u.id
  AND d.deleted_at IS NULL
  AND NULLIF(TRIM(COALESCE(u."employeeId", '')), '') IS NULL
  AND NULLIF(TRIM(COALESCE(d.employee_id, '')), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public."User" u2
    WHERE u2.id <> u.id AND LOWER(COALESCE(u2."employeeId", '')) = LOWER(TRIM(d.employee_id))
  );
