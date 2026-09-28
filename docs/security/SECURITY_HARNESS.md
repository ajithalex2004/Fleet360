# Security harness: live tenant-isolation and access evidence

`scripts/security-harness/run.mjs` tests a running deployment (local,
staging or production) and writes a timestamped evidence report. Run it
before every release. The exit code is 1 when any check fails, so it can
gate a release.

```bash
HARNESS_A_ADMIN_PASSWORD=… HARNESS_B_ADMIN_PASSWORD=… \
HARNESS_DB_URL=postgresql://<runtime role>@<host>/<db> \
npm run security:harness -- --base https://staging.example.com \
  --go https://go.staging.example.com --accounts harness.accounts.json
```

The evidence is written to `security-evidence/<timestamp>/report.md` (for
people) and `results.json` (every check).

## What it proves

| Phase | Proves | Needs |
|---|---|---|
| `identity` | The deployed commit (`/api/health` release), and that every test account signs in | accounts |
| `roles` | Each account's live decision, for all 460 probes, equals what the policy gives its role. Naming another tenant is always refused. Every passkey action asks for a passkey. With `AUTHZ_MODE=enforce`, every denied read really answers 403 | accounts |
| `go` | The Go backend decides every Go route exactly as Next.js does (or as the policy says, where Next.js has no dry-run answer) | `--go` |
| `cross-tenant` | Tenant A cannot see tenant B's records, for every tenant-owned list/detail pair the harness discovers. It tries A's own list, `?tenantId=B`, spoofed `x-tenant-id` headers, and read by id. With `--writes`, it also tries to edit them | an account in each tenant; records in tenant B |
| `database` | Connected as the runtime role (not a superuser, no `BYPASSRLS`), and for every table with `tenant_id`: RLS is on (forced where the role owns the table); tenant A sees no row of tenant B; nothing is visible without a tenant context; B's rows cannot be updated; a row cannot be inserted for B or moved to B | `HARNESS_DB_URL` (the app's runtime role, never the owner) |

A check that cannot run is reported as **not covered**, never as passed.
Examples: tenant B has no records for a resource, or no database URL was
given.

## Safe against production

- **Role probes are dry runs.** Each request carries `x-authz-dry-run: 1`
  (`src/lib/authz/dry-run.ts`, `backend/authz`). The middleware answers
  the admin gate, passkey and policy decision in headers and returns 204:
  no handler, proxy or database write runs. It reveals only the caller's
  own authorization.
- **Enforcement proof uses reads only.** Real requests are sent only as
  GETs the policy denies, and only when the deployment is in enforce mode.
- **Database probes are rolled back.** Each probe runs in a savepoint,
  inside a transaction that is always rolled back.
- **Edits need confirmation.** `--writes` sends `PATCH {}` to tenant B's
  records as tenant A, then checks B's record is unchanged. It refuses to
  run unless `HARNESS_ALLOW_WRITES=<target host>` confirms the target is a
  test environment.
- **No secrets in files or reports.** Passwords (and TOTP secrets, for test
  accounts with MFA) come from environment variables named in the accounts
  file. Reports mask email addresses.
- **What it cannot automate.** It never performs a passkey step-up; it only
  verifies step-ups are required.

## Setting up

1. **Test tenants.** Create two tenants, A and B, on a paid plan, with the
   modules you want covered. In tenant A, create one user per role to test
   (at least `TENANT_ADMIN`, one operator role and `VIEWER`). In tenant B,
   create a `TENANT_ADMIN`. Give tenant B a few records in each module:
   cross-tenant coverage only reaches resources where B has data.
2. **Accounts file.** Copy `scripts/security-harness/accounts.example.json`
   to `harness.accounts.json` (git-ignored), and fill in the tenant ids and
   emails. Put the passwords in the environment variables it names.
3. **Database URL.** Set `HARNESS_DB_URL` to the runtime role the
   application connects as (e.g. `fleet360_app`), not the owner.
4. **Deployment commit.** Set `GIT_COMMIT_SHA` on the service if the
   platform does not already set `RAILWAY_GIT_COMMIT_SHA` or
   `VERCEL_GIT_COMMIT_SHA`, so the report names the deployed commit.
5. **Harness version.** Run the harness from the same commit as the
   deployment: the report warns when the deployed policy version differs
   from the harness plan.

### Local rehearsal

`scripts/security-harness/local-fixture.mjs` creates tenants A and B,
users and a few vehicles in a **local** database (it refuses any other
host), and prints the accounts file. Then:
1. Build and start the app as the runtime role.
2. Optionally start the Go backend with the same `JWT_SECRET`.
3. Run the harness against `http://localhost:3000`.

## Reading the report

- **Failures** are isolation or access defects. Fix them before release.
- **Warnings** are configuration to review:
  - `AUTHZ_MODE` is not `enforce`;
  - the deployed policy is not the harness's;
  - a role's live decisions differ from the policy (for example a tenant
    role override). `--strict` makes these failures.
- **Not covered** lists what the run could not test and why.
- **Live role matrix** lists what each account may do, by area: evidence
  for access reviews.

## Keeping it current

`scripts/security-harness/plan.json` is generated from the policy and the
route files. It holds the probes, the expected answer for every system role
and plan, and the resource catalogue. `tests/unit/security-harness-plan.test.ts`
fails when the plan is stale. Regenerate it with:

```bash
UPDATE_SECURITY_HARNESS=1 npx vitest run tests/unit/security-harness-plan.test.ts
```

## First run (local rehearsal, commit 5cb5c210)

Run against a production build connected as the runtime role, with two
fixture tenants (four accounts) and the Go backend:

- **Roles:** all 4 accounts matched the policy on all 460 probes. In
  enforce mode, 110 denied reads were really refused with 403.
- **Go:** matched Next.js on every Go route.
- **Cross-tenant:** vehicles were isolated on every path. **Finding:** the
  chart of accounts (`finance.finance_chart_of_accounts`) has no tenant
  column, so every tenant sees, and can edit, the same accounts.
- **Database:** 267 tenant tables. **Finding:** 55 have `tenant_id` but
  RLS is not enabled in a database built from the migrations, mostly
  logistics and service-configuration tables, among others. The
  application's queries filter by tenant, but the database backstop is
  missing. Run the database phase against staging to see whether
  production matches.
