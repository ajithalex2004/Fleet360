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

## Passkey step-up for high-impact actions

High-impact admin actions need a passkey check, on top of the session and
the role policy. The check must come from the person behind the session,
within the last 5 minutes. High-impact means:
- changes to who can do what;
- removing people or tenants;
- handing out credentials;
- platform-wide operations.

The list is `STEP_UP_ROUTES` in `src/lib/auth/step-up-policy.ts`. It is
enforced in `src/middleware.ts` (step 4b'), so a handler cannot forget it.
A test fails if the list names a route or method that does not exist.
Protective actions are left out so they stay one click away in an incident:
revoking sessions, an API key or an invitation.

| Area | Actions needing a passkey |
|---|---|
| Users | create, edit, deactivate, delete, hard-delete, set password, reset passkeys |
| Access | tenant memberships (add/remove), invitations, roles (create/edit/delete), role permissions, role overrides, nav permissions |
| Tenants | create, edit (plan, residency, …), deactivate, hard-delete, modules, SSO, API keys |
| Platform | impersonation, platform settings, migrations, seeds, outbox replay, Exchange partner users |

How it works:

- **Challenge.** Without a check, the API answers
  `403 { error: 'step_up_required' }`.
- **Prompt and retry.** `StepUpProvider`, mounted in the root layout, asks
  for the passkey (fingerprint, face, device PIN or a security key), then
  retries the request once. Pages need no changes.
- **Step-up token.** A passed check sets the httpOnly `xl-step-up` cookie
  (path `/api`, SameSite strict). The token is signed with a key derived
  from `SESSION_SECRET` and bound to the session: user, tenant, issue time,
  and who checked. Signing in again, switching tenant or starting an
  impersonation needs a new check.
- **Impersonation.** The impersonating platform admin checks *their own*
  passkey. Passkeys cannot be added or removed while impersonating.
- **Replay protection.** Challenges are single-use, consumed atomically,
  and expire after 2 minutes. User verification is required. Signature
  counters are enforced.
- **Audit.** Step-ups (passed and failed), and passkeys added, removed and
  reset, are audited (entities `StepUp` and `Passkey`).

Enrolment (Admin → Passkeys, or offered in the prompt):

- **First passkey.** The user re-enters their password, plus the
  authenticator code or a recovery code when MFA is on. A user without a
  password (SSO) must have signed in within the last 10 minutes. Adding a
  passkey counts as a step-up.
- **Further passkeys, and removing one.** These need a step-up with an
  existing passkey, so a stolen session cannot add its own.
- **Lost every passkey.** A platform admin resets them with
  `DELETE /api/admin/users/[id]/passkeys` (itself step-up protected). The
  user then adds a new one with their password.

Configuration:

- **Relying party.** Set `WEBAUTHN_RP_ID` (e.g. `app.example.com`) and
  `WEBAUTHN_ORIGINS` (comma-separated, e.g. `https://app.example.com`).
  Otherwise the value comes from `NEXT_PUBLIC_APP_URL`, and localhost is
  used in development. It is never taken from request headers.
- **Missing configuration.** Without a relying party in production,
  passkeys answer 503, so high-impact actions are blocked while in enforce
  mode.
- **Domain changes.** Passkeys belong to the RP ID they were registered
  under, so they must be reset after a domain change.
- **`STEP_UP_MODE`.** `enforce` is the default. `report` logs `would-require`
  and lets the request through. `off` is an emergency switch, for example
  when the only platform admin has lost every passkey.

The Go backend's own admin endpoints cannot see the step-up cookie: in
enforce mode it refuses the step-up actions with `step_up_required`, and
they are performed in the admin console. Those are the actions above plus
the Go-only tenant suspend and offboard (`GO_STEP_UP_ROUTES`). See below.

## The Go backend enforces the same policy

`backend/authz` makes the same decision as the Next.js middleware for every
`/api/v1/<path>` request, read as `/api/<path>`. It runs after the token
and revocation checks (`auth.Middleware`).

- **One policy.** `backend/authz/policy.json` is generated from the Next.js
  policy by `src/lib/authz/go-policy.ts`, and embedded in Go. It carries:
  - the matrix and the admin route levels;
  - the permission catalogue and its version;
  - module aliases and the trial rules;
  - the step-up actions.

  `Decide` is a port of `decide()`.
- **Proof they agree.** `backend/authz/testdata/vectors.json` holds
  requests with the decision Next.js makes. It covers every Go route,
  thirteen subjects (system roles, custom and legacy permissions, no claim,
  trial plan, the shipper portal, no role) and every decision reason. The
  Go tests require the same decision, reason, area and required permission
  for each one, and the same step-up answer.
  `tests/unit/authz-go-policy.test.ts` fails when either file is out of
  date. Regenerate them with
  `UPDATE_AUTHZ_GO_POLICY=1 npx vitest run tests/unit/authz-go-policy.test.ts`.
- **Same inputs.** The Go token now carries the session's permission claim
  (`perms`, the same bitset) and the tenant's `plan`. Login and the proxy
  sign both. A token issued before this change holds no module permissions
  in Go: report mode stays quiet about those until the tokens roll over
  (24 h), and enforce mode denies them.
- **Same modes.** `AUTHZ_MODE`: `report` is the default and logs
  `{"authz":"would-deny","backend":"go",…}`; `enforce` answers 403; `off`
  does not evaluate. `STEP_UP_MODE` is the same as in Next.js, `enforce` by
  default. Set both on the Go service too.
- **Go-only paths** are part of the matrix (`GO_ONLY_AREAS`):
  - `service` → maintenance;
  - `alerts/configs` → tenant admin;
  - `dispatch/ambulance-calls` → incidents;
  - `logistics/rates/quote` → self, the shipper portal's price check.

  A shipper-portal token reaches only that route.
- **Behaviour changes in Go under enforce.**
  - A tenant admin can no longer PATCH their own tenant's row (plan,
    modules): that is platform-only, as in Next.js.
  - Tenant audit, plan, suspend and offboard are platform-only.

## Privileged actions are recorded in the audit log

Every privileged request leaves a row in `audit_logs` (Admin → Audit log),
from both backends, with the same shape:
- entity type `AdminAction`;
- entity name `<METHOD> <route template>`;
- the target id;
- the actor's user id and role, and any impersonator;
- IP address and user agent;
- the outcome in `details`.

| Outcome | Action |
|---|---|
| Succeeded (2xx/3xx) | `CREATE` / `UPDATE` / `DELETE` by method |
| Refused (401/403, including a step-up refusal in Go) | `DENIED` |
| Server error, or the handler threw | `FAILED` |
| Invalid request (other 4xx) | not recorded: nothing changed |

- **Next.js.** Every write handler in an area whose writes need an
  administrator is wrapped by `withAuditedAction`
  (`src/lib/audited-action.ts`). That covers `/api/admin/*` and the
  tenant-admin and platform areas: 105 handlers in 85 files.
  - If the handler already wrote its own, more detailed row with
    `logAudit`, no second row is added, except for refusals.
  - `tests/unit/privileged-audit.test.ts` fails when a privileged write
    handler is not wrapped.
  - The tenant guards (`check-tenant-auth`, `check-tenant-rls`) inspect the
    wrapped handlers exactly as before (`scripts/route-handler-source.js`).
- **Go.** The authz middleware records writes to admin-level, tenant-admin
  and platform areas, and every denial of one, in the actor's tenant
  context. In report mode, a request the policy would deny is recorded with
  "policy would deny <reason>".

## Not yet covered (next steps)

- **Enforce.** Both backends run in report mode until `AUTHZ_MODE=enforce`
  is set: review the `would-deny` logs first.
- **Go handlers** keep their own role checks as a second line; per-object
  checks (row ownership) are still per handler.
