-- Fleet360 Exchange: the tenant that onboarded a transport partner, and
-- invitations that create a partner's users.
--
-- Partner companies are onboarded by a tenant. A partner's staff are users of
-- that tenant (its User Master), and each is also linked to the partner
-- (partner_users) so they can use the partner portal and marketplace.
-- /admin/exchange-partners invites them by email into the onboarding tenant;
-- accepting the invitation creates the user, the tenant membership and the
-- partner membership together.
--
-- Additive only: nullable columns and an index. Existing partners have no
-- onboarding tenant until an administrator sets one.

ALTER TABLE transport_partners ADD COLUMN IF NOT EXISTS onboarded_by_tenant_id TEXT;
CREATE INDEX IF NOT EXISTS idx_partners_onboarded_by ON transport_partners (onboarded_by_tenant_id);

-- Set on invitations sent from /admin/exchange-partners: the partner the new
-- user will act for, and their partner role (PARTNER_ADMIN, _OPERATIONS,
-- _FINANCE or _VIEWER). NULL on ordinary tenant invitations.
ALTER TABLE tenant_invitations ADD COLUMN IF NOT EXISTS partner_id TEXT;
ALTER TABLE tenant_invitations ADD COLUMN IF NOT EXISTS partner_role TEXT;
CREATE INDEX IF NOT EXISTS idx_tenant_invitations_partner ON tenant_invitations (partner_id) WHERE partner_id IS NOT NULL;
