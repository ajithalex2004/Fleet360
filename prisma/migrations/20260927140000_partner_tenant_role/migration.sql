-- Fleet360 Exchange: the "Partner" tenant role.
--
-- Staff of a transport partner are users of the tenant that onboarded the
-- partner (see 20260927090000_partner_onboarding_tenant_and_invitations), so
-- they need a role in that tenant. They are outsiders, so the role grants
-- nothing in the tenant's own app: it has no permissions, and the middleware
-- (src/lib/exchange/partner-role.ts) lets a PARTNER session reach only the
-- partner portal and its APIs. What they may do for their partner comes from
-- their partner role (partner_users.role), not from this one.
--
-- A platform role template (tenant_id NULL, is_system true), like VIEWER.
-- Additive and idempotent.

INSERT INTO roles (id, tenant_id, name, code, description, is_system)
SELECT gen_random_uuid()::text, NULL, 'Partner', 'PARTNER',
       'Transport partner staff: partner portal only, no access to the tenant''s own modules',
       true
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE tenant_id IS NULL AND code = 'PARTNER');
