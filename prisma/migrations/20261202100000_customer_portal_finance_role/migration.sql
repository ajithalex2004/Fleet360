-- Customer Portal: a Finance role in every portal.
--
-- FINANCE views everything, signs agreements and pays invoices, but cannot
-- raise requests (the Rental-car portal's RAC_B2B_FINANCE, made available in
-- the common Customer Portal). Widens the role CHECK on
-- customer_portal_user_roles; no data changes.

ALTER TABLE customer_portal_user_roles DROP CONSTRAINT IF EXISTS customer_portal_user_roles_role_check;
ALTER TABLE customer_portal_user_roles ADD CONSTRAINT customer_portal_user_roles_role_check
  CHECK (role IN ('ADMIN', 'REQUESTER', 'FINANCE', 'VIEWER'));
