# Making RLS actually enforce: the connection-role change

**Status:** drafted, not applied
**Priority:** P0 — every RLS policy in this database is currently decorative

---

## The problem

The application connects as `neondb_owner`, which has **`rolbypassrls = true`**.
`BYPASSRLS` overrides even `FORCE ROW LEVEL SECURITY`, so **none of the 256
RLS-enabled tables are protected at the database level.**

Reproduce it:

```
node -r dotenv/config scripts/check-rls-enforcement.mjs dotenv_config_path=.env
```

Current output:

```
connected as : neondb_owner
BYPASSRLS    : true

probe table  : public.audit_logs
  as platform '*'     : 731
  as unrelated tenant : 731

❌ RLS IS NOT ENFORCED — an unrelated tenant sees 731 row(s).
```

This is not specific to any recent migration. `bus_routes`, whose RLS predates
the current tenant-safety work, leaks identically — all 53 rows visible to an
unrelated tenant.

### What this means

Tenant isolation today rests **entirely** on application-level `tenantId`
filtering inside queries. The `withTenantRls()` wrapper sets `app.tenant_id`
correctly and the policies read it correctly — the database simply never
applies them.

It also reframes the `tenantId`-shadowing bugs fixed in #47, where a raw
request header shadowed the authorised tenant. Those were described at the time
as defence-in-depth failing. They were not: they were **the only line of
defence** failing.

---

## Why this is smaller than it looks

Three things are already in place.

**1. The role exists.** `fleet360_app` is already created with the right
attributes — it is simply not being used:

```
fleet360_app    super=false  bypassrls=false  createrole=false
neondb_owner    super=false  bypassrls=true   createrole=true    <-- app connects as this
```

**2. Nothing goes dark.** All 256 RLS-enabled tables have at least one policy.
There are **zero** tables with RLS on and no policy, which would otherwise
deny-all the moment enforcement began.

**3. The application is ~97% ready.** Of 685 API route files, **636 already use
a tenant-scoped wrapper** (`withTenantRls` / `withPlatformAdmin` /
`withSystemJob` / `withWebhookTenant`). Only **20** query without one.

---

## What's missing

Measured, not assumed:

| gap | current |
|---|---|
| `USAGE` on `finance`, `ai`, `workforce`, `fleet`, `operations`, `spatial` | missing — all six |
| Table DML grants | 332 of 364 tables |
| `CREATE` on `public` | missing |
| Default privileges for future tables outside `public` | missing |
| Sequence grants | none needed — the database has 0 sequences |

`scripts/sql/grant-fleet360-app.sql` closes all of these. It is idempotent,
grant-only, and refuses to run if `fleet360_app` somehow has `BYPASSRLS`.

### The `CREATE` grant is deliberate, and temporary

~95 source files still perform runtime DDL — `ensureAuditTable`,
`ensureFleetSchema`, `ensureBrandingColumns`, `ensureShipperPortalTables` and
others. Without `CREATE`, those calls fail and take their routes with them.

So the grant script includes `CREATE`. **Revoke it once
[`RETIRE_RUNTIME_DDL_PLAN.md`](./RETIRE_RUNTIME_DDL_PLAN.md) is delivered** — it
is the one privilege here that should not be permanent.

Note the side effect: tables created at runtime by `fleet360_app` are *owned* by
it, and owners bypass RLS unless `FORCE` is set. Runtime-created tables have no
RLS today either way, but this makes retiring runtime DDL more than housekeeping.

---

## The 20 routes that query without a tenant wrapper

These are almost all legitimately pre-authentication or cross-tenant, so most
need `withPlatformAdmin` (which sets `app.tenant_id = '*'`) rather than
`withTenantRls`:

**Auth — runs before a tenant context exists (12)**
`auth/login`, `auth/me`, `auth/session`, `auth/forgot-password`,
`auth/reset-password`, `auth/sso/callback`, `auth/invitation/[token]`,
`auth/invitation/accept`, `auth/mfa/enroll`, `auth/mfa/enroll/verify`,
`auth/mfa/disable`, `auth/mfa/status`

**Other (8)**
`carrier-portal/app/loads`, `carrier-portal/app/loads/[id]`,
`shipper-portal/stats`, `track/[ref]`, `webhooks/whatsapp`,
`cron/outbox-publish`, `setup/super-admin`, `health`

`health` touches no tenant data. The rest need review: each must either wrap in
`withPlatformAdmin` or be confirmed as touching only non-tenant tables.

**This is the work that must happen before the switch.** Anything left
unwrapped will silently return zero rows once RLS enforces — silent, not
loud, which is the dangerous failure mode.

---

## Rollout

Deliberately staged. Step 3 is the point of no easy return within a request.

**1. Grant** — safe, reversible, no behaviour change while the app still
connects as `neondb_owner`:

```
npx prisma db execute --file scripts/sql/grant-fleet360-app.sql --schema prisma/schema.prisma
```

**2. Audit the 20 routes.** Wrap each in `withPlatformAdmin`, or document why it
needs no tenant context. Do not skip this.

**3. Switch `DATABASE_URL`** to connect as `fleet360_app` in a **non-production
environment first**. Leave `DIRECT_URL` as `neondb_owner` so migrations keep
working — migrations must retain owner rights.

**4. Verify:**

```
node -r dotenv/config scripts/check-rls-enforcement.mjs dotenv_config_path=.env
```

Expect `✅ RLS IS ENFORCED`, exit 0. Then exercise the app: log in, load each
module, run a report. Empty lists where data is expected mean a code path that
isn't setting `app.tenant_id`.

**5. Production**, with the rollback below to hand.

---

## Rollback

Point `DATABASE_URL` back at `neondb_owner` and redeploy. The grants are
additive and can be left in place; nothing needs undoing at the database level.

Rollback restores the *current* behaviour, which is unprotected. It buys time
to fix a broken code path — it is not a resting state.

---

## Do not "fix" this by removing BYPASSRLS from `neondb_owner`

Tempting, since it is one statement. Don't:

- `neondb_owner` **owns** every table, and owners are exempt from RLS unless
  `FORCE` is set. 240 of 256 RLS tables have `FORCE`; **16 do not**, and those
  would stay unprotected while appearing fixed.
- Migrations, `db execute` and admin tooling all run as `neondb_owner` and
  legitimately need to cross tenants.
- It flips every environment at once with no staging step.

A separate, non-owning, non-bypassing application role is the correct shape.

---

## Still unprotected afterwards

**7 tables have a `tenant_id` column but RLS switched off.** They will remain
unprotected after this change. Identify and fix them separately:

```sql
SELECT n.nspname||'.'||c.relname
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r' AND NOT c.relrowsecurity
   AND EXISTS (SELECT 1 FROM information_schema.columns col
                WHERE col.table_schema = n.nspname
                  AND col.table_name = c.relname
                  AND col.column_name = 'tenant_id');
```

**16 RLS tables lack `FORCE`.** Harmless once the app is a non-owner, but they
should get `FORCE` so ownership stops mattering.

---

## Related

- `scripts/check-rls-enforcement.mjs` — enforcement probe, exit 1 if bypassed
- `scripts/sql/grant-fleet360-app.sql` — the grants
- `docs/RETIRE_RUNTIME_DDL_PLAN.md` — prerequisite for revoking `CREATE`
- PR #54 — where the bypass was found
- PR #47 — the shadowing bugs this reframes
