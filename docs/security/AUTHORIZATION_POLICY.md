# Authorization policy

Every staff API request gets **one** authorization decision, from one
function (`decide()` in `src/lib/authz/policy.ts`), using one versioned
matrix (`src/lib/authz/policy-matrix.ts`) and one permission set (the
permission claim signed into the session). The generated matrix is in
[`AUTHZ_MATRIX.md`](./AUTHZ_MATRIX.md); a test fails when the two differ.

## Which model decides what

Before this policy, three models decided independently:

| Model | Where | Enforced on | Status now |
|---|---|---|---|
| Admin route levels (`ADMIN_ROUTE_POLICY`) | `src/lib/admin-access.ts` | `/api/admin/*` (middleware) | Unchanged, and the matrix's `admin-level` rule for `/api/admin/*` |
| Role permissions (catalogue `ALL_PERMISSIONS`, `SYSTEM_ROLES`, tenant roles in `role_permissions`) | `src/lib/permissions.ts` | UI menus and 2 API routes | The matrix's `module` rule for every module API area |
| Plan write gate (`canWrite` / `assertCanWrite`) | `src/lib/access-control.ts` | 3 API routes | Part of the `module` rule: trial tenants are read-only outside `TRIAL_FREE_MODULES` |
| `custom_role_permissions` table | Prisma schema | nothing (never written or read) | Not used by the policy |

Rule kinds in the matrix:

| Rule | Decided by |
|---|---|
| `module` | the session's permissions: action from the method (GET view, POST create, PUT/PATCH edit, DELETE delete; `approve`/`reject`/`decision` path segments approve; `export`/`.csv` export), resource from the path when the catalogue has it |
| `admin-level` | `ADMIN_ROUTE_POLICY` (platform / admin / member) |
| `tenant-admin` | TENANT_ADMIN or SUPER_ADMIN: tenant configuration (billing, integrations, workflows, user creation, …) |
| `platform` | SUPER_ADMIN only |
| `self` | any signed-in member; the handler scopes to the caller |
| `partner` | Exchange partner membership (`requirePartnerContext`) |
| `external` | the area's own credential (portal or driver session, scheduler or webhook secret); public in middleware |

Handlers keep their own record-level checks (ownership, tenant scope, RLS).
The policy decides whether the role may perform the action at all.

## Where permissions come from

`resolveSessionPermissions()` (`src/lib/authz/session-permissions.ts`),
used by every session issuer (login, session refresh, invitation accept,
SSO, impersonation, tenant provisioning) and by the login response the UI
uses, so the UI hides exactly what the policy denies:

- a **platform system role** with no tenant override: the code catalogue
  `SYSTEM_ROLES` (authoritative; the database copy seeded by
  `POST /api/admin/seed` can lag);
- a **tenant override** or a tenant's **custom role**: its `role_permissions`;
- platform **SUPER_ADMIN**: the wildcard `*:*:*`. A tenant role coded
  SUPER_ADMIN gets no wildcard;
- no active membership, or a role owned by **another tenant**: nothing.

The permissions travel in the session as a compact claim (a bitset over the
catalogue, `src/lib/authz/permission-claim.ts`). A session signed against a
different catalogue version, or without a claim, holds no permissions.

## Fail-closed cases

A missing role, an unknown role (no permissions), a session without a
permission claim, a request naming another tenant (`?tenantId=`, except for
SUPER_ADMIN), and an API path outside the matrix are all denied.

## Modes (`AUTHZ_MODE`)

| Value | Effect |
|---|---|
| `report` (default) | denials are logged as `{"authz":"would-deny",…}` with the policy version, route, reason and required permission; the request continues |
| `enforce` | denials answer 403 `{ error, reason, required }` |
| `off` | not evaluated |

### Moving to enforce

1. Deploy in `report` mode. Sessions issued before the deploy carry no
   claim; they roll over within 24 hours (session lifetime).
2. Review `would-deny` log lines for a representative week. Each is either
   a role that needs a permission (grant it: `SYSTEM_ROLES` for system
   roles, the role editor for tenant roles) or a correct denial.
3. Tenants that customised a system role (an override) only hold the
   permissions they saved; overrides saved before the new modules existed
   hold none in them.
4. Set `AUTHZ_MODE=enforce`.

## Versioning

`POLICY_VERSION` in `policy-matrix.ts` is bumped with every matrix change
and logged with every decision. The permission catalogue has its own
version (`CATALOGUE_VERSION`, a hash of `ALL_PERMISSIONS`); new permissions
are appended to the catalogue so existing claims keep their meaning.

## Session revocation (60 seconds)

A change to someone's access ends the sessions issued before it, on every
instance, within `REVOCATION_RECHECK_MS` (60 s). They sign in again and get
a session with their current role and permissions.

A revocation records "sessions issued before this moment are invalid" for
one of three scopes, in `session_revocations` (one row per scope):

| Scope | Triggered by |
|---|---|
| user, every tenant | user deactivated or deleted, module access changed, password reset / changed / set by an admin, "sign out everywhere" (`POST /api/auth/logout-all`), a platform admin revoking a user (`POST /api/admin/users/[id]/revoke-sessions`) |
| user in one tenant | role changed, membership removed, a tenant admin revoking a member |
| tenant | tenant deactivated or its plan changed, a tenant role's permissions or code changed or the role deleted, a role override created |

A platform role change revokes every user holding that role
(`holdersOfRole` / `revokeRoleHolders` in `src/lib/auth/session-revocation.ts`).
Each revocation is audited (entity `Session`).

Where it is checked:

- **Next.js** (`verifySession`, edge middleware): sessions carry `iat`; the
  three "not before" moments are read from the **Upstash Redis** mirror
  (`sess:nbf:*`) in one MGET, cached per instance for 60 s. Without Redis
  configured, revocations do not reach Next.js sessions (they expire after
  24 h as before) and a warning is logged on each revocation.
- **Go backend** (`auth.Middleware`): reads `session_revocations` directly,
  cached per (user, tenant) for 60 s; compares at whole seconds (JWT `iat`).

Both fail open on store errors (last known value, else not revoked): an
outage must not sign everyone out. Changing your own password signs you out
everywhere, including the current browser.

`/api/users` now lists and reads only members of the caller's tenant; it no
longer creates, edits or deletes users (use `/api/admin/users`).

## Not yet covered (next steps)

- **Step-up authentication** (WebAuthn) for high-impact admin actions.
- **Go handlers:** requests proxied through Next.js (`/api/<module>` →
  Go) are decided here first; direct calls to Go check only the tenant.
- **Audit coverage** of privileged admin routes.
