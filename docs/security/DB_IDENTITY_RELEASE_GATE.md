# Database identity release gate

**Rule:** no release goes to production until every runtime database connection (Next.js web, background workers, Go backend and any direct connection) is shown to use the restricted application identity, and that identity can neither bypass RLS nor change the schema.

Row-level security only protects data when the connection is subject to it. It protects **nothing** when the connection:

- is a superuser or holds `BYPASSRLS`, directly or through a role it inherits;
- **owns** the tables: owners skip RLS unless `FORCE ROW LEVEL SECURITY` is set, and can `ALTER` or `DROP` them;
- sets the wrong tenant context. That is covered by the application tests, not this gate.

## Identities

| Identity | Purpose | Expected privileges |
|---|---|---|
| `fleet360_app` | **Runtime**: every request, job and worker, in Next.js and Go | `SELECT/INSERT/UPDATE/DELETE` on tables, sequence usage, function execute. **No** table ownership, **no** `CREATE` on schemas or the database, **no** `BYPASSRLS`, not a superuser, no inherited role with any of those |
| Migration identity (`DIRECT_URL` / `MIGRATION_DATABASE_URL`) | Schema changes (`prisma migrate deploy`) only, from CI or release tooling | Owns the schema. Must be a **different** role from the runtime identity, and never configured on a running service |
| `fleet360_api_role` / `fleet360_api` | Group role from an earlier schema design (`20260810000005_introduce_domain_schemas`) | Nothing in the code connects as it. Confirm whether it exists and has members; if it grants anything to the runtime identity, the gate lists it under "member of" |

The migrations grant table access to `fleet360_app` directly, and the existing checks (`scripts/assert-deployment-roles.mjs`, `scripts/check-app-role-privileges.cjs`, `scripts/check-rls-effective.mjs`) expect it. **Which identity each deployed process actually uses has not been verified**, and that is the purpose of this gate.

## Running the gate

`scripts/security/verify-db-identity.mjs` is read-only: it runs catalog `SELECT`s only. It must run with **each service's own environment**. The Neon SQL editor connects as the database owner, so running queries there says nothing about what the app uses.

With the Railway CLI, from a checkout of this repository:

```bash
# Next.js web service (and any worker service it has)
railway run --service <web-service> -- node scripts/security/verify-db-identity.mjs \
  runtime=DATABASE_URL runtime-direct=RUNTIME_DIRECT_DATABASE_URL

# Go backend service (uses DATABASE_URL too)
railway run --service <go-service> -- node scripts/security/verify-db-identity.mjs runtime=DATABASE_URL

# Migration identity, to confirm it differs from the runtime one
railway run --service <web-service> -- node scripts/security/verify-db-identity.mjs \
  runtime=DATABASE_URL migration=DIRECT_URL
```

Repeat for **staging and production**. Keep the output as release evidence.

For each connection it reports:
- `session_user` and `current_user`, and every role inherited;
- superuser, `BYPASSRLS`, `CREATEROLE` and `CREATEDB` status;
- the tables owned, and whether RLS is forced on them;
- `CREATE` rights on schemas and the database;
- tenant tables without RLS enabled, listed by name.

It exits with code 1 if any runtime connection fails a check, including when any tenant table has RLS disabled, or if a migration connection shares an identity with a runtime one.

The first production run (2026-09-25) found 22 tenant tables without RLS (10 on staging). Migration `20260925130000_rls_for_unprotected_tenant_tables` enables and forces it on them.

The script was tested against PostgreSQL 16 with four set-ups:
- an owner connection (fails, and lists the owned tables);
- the restricted role (passes);
- the restricted role inheriting the owner role (fails);
- a shared runtime and migration identity (fails).

## If a runtime connection fails

- **It connects as the owner, or as a role with `BYPASSRLS`:** RLS is not protecting that service today. This is the top priority, but **do not revoke privileges or switch roles in place**. Follow the order below.
- **It connects as `fleet360_app` but has `CREATE` on a schema:** this is the "remove DDL privileges" step below.

## Order of changes (no step skipped)

1. **Separate the migration identity.** Migrations run from CI or release tooling with `DIRECT_URL`/`MIGRATION_DATABASE_URL` set to the owner role. No running service carries that URL.
2. **Remove runtime DDL.** Move the schema changes the app currently makes while running into reviewed migrations. The app role must not need `CREATE`, `ALTER` or ownership for anything. Until then, revoking breaks those code paths; some already fail with `42501` on the restricted role.
3. **Rehearse on staging.**
   - Point the staging services at `fleet360_app`.
   - Run `scripts/check-app-role-privileges.cjs fleet360_app` and `scripts/check-rls-effective.mjs`.
   - Run this gate, the integration suites and a smoke test of every module.
   - Fix any `42501 permission denied` error: it points at a missing grant or at leftover runtime DDL.
4. **Switch production** the same way in a change window, with the previous connection string ready for rollback. Run this gate immediately afterwards.
5. **Revoke** `CREATE` on schemas and the database from `fleet360_app` (and from `PUBLIC` on `public`), then run the gate again.

## Automation (follow-up)

Once a staging secret with the runtime connection string exists in GitHub, add a workflow step that runs this gate before promoting a release. Until then it is a manual release checklist item.
