-- public.bookings has row level security forced but, on a fresh install, no
-- policy: 20260915200000_fresh_replay_bookings_hierarchy_tenant only rebuilds
-- policies that already exist, and the one production has came from the old
-- baseline that fresh installs never run. With no policy, the runtime role
-- can neither read nor write a single booking, so every portal booking save
-- fails. This creates the standard tenant_isolation policy. tenant_id is
-- compared as text so the policy works whether the column is uuid or text.
-- Safe to re-run; on production it replaces the policy with the same rule.
ALTER TABLE IF EXISTS public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.bookings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.bookings;
CREATE POLICY tenant_isolation ON public.bookings FOR ALL USING ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true))) WITH CHECK ((current_setting('app.tenant_id', true) = '*') OR ((tenant_id)::text = current_setting('app.tenant_id', true)));
