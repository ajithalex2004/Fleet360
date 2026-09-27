-- Fleet360 Exchange: partner activation.
--
-- A transport partner onboarded by a tenant starts Pending Activation
-- (onboarding_status DRAFT, marketplace_status NOT_APPLIED) and stays out of
-- the marketplace until that tenant's administrators have reviewed its
-- compliance documents and activated it (src/lib/exchange/partner-activation.ts).
--
--  - transport_partners.emirate: where the partner operates from; decides
--    which transport permit is mandatory (RTA in Dubai, ITC in Abu Dhabi, ...).
--  - PartnerServiceDomain SCHOOL_TRANSPORT: school transport operators need a
--    school transport permit.
--  - marketplace_status now defaults to NOT_APPLIED instead of APPROVED, so a
--    partner created by any path starts outside the marketplace.
--
-- Existing partners are left as they are; the gating in the application
-- treats any partner whose onboarding_status is not APPROVED as pending.
-- Additive and idempotent.

ALTER TYPE "PartnerServiceDomain" ADD VALUE IF NOT EXISTS 'SCHOOL_TRANSPORT';

ALTER TABLE transport_partners ADD COLUMN IF NOT EXISTS emirate TEXT;

ALTER TABLE transport_partners ALTER COLUMN marketplace_status SET DEFAULT 'NOT_APPLIED';
