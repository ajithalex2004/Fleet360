-- Architectural risk #6 — drop the dead `public.incidents` table.
--
-- Origin: this 24-column table was authored as the original cross-module
-- incidents design (photo_urls, latitude/longitude, insurance_claim,
-- reported_by, assigned_to, resolution) but was never wired to any
-- endpoint or Prisma model. Task 7 relocated the real bus-ops incident
-- table into operations.incidents (with a moduleSource discriminator),
-- leaving this dead sibling behind.
--
-- Verified before drop: zero rows, zero callers in src/. CASCADE covers
-- any orphan FK we didn't see.

DROP TABLE IF EXISTS public.incidents CASCADE;
