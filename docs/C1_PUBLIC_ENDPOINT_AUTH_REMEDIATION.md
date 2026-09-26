# C1: Public endpoint identity boundary

Separated for staging on 2026-09-26. Branch `codex/c1-staging` is based on `origin/develop` at `efca40f93b656a6859b932d715bb712f3cb7cdd3`. Not deployed; production closure requires staging verification.

The original combined implementation remains intact at `fa465fbb` on `codex/c1-c2-staging`. This branch excludes C2 storage changes, private-file routes, legacy-URL retirement, Prisma changes/migration, AWS SDK dependencies, and the independent mobile TypeScript configuration change. No storage/scanner provisioning is needed for C1, and this release does not fix C2.

Existing staging driver-session injection, admin-role checks, fail-closed role validation, and data-residency enforcement are preserved. Only the remaining C1 changes were integrated; do not merge the older combined branch wholesale over these newer security fixes.

## Changes

- Middleware removes caller-supplied tenant, user, role, impersonation and residency identity headers before public/static early returns. Protected routes and the existing driver-session domain receive identity derived from verified sessions.
- Push subscribe, unsubscribe and test handlers independently verify the signed `xl-session` cookie and require active user/tenant membership plus an active, non-deleted staff record linked by `User.employeeId`. A submitted employee ID cannot select another staff member. Subscription updates and revocations are constrained to that owner and tenant.
- The VAPID public-key endpoint remains anonymous; it exposes no tenant data.
- Public scheduler handlers require a valid scheduler secret or an authorized signed session. Missing secrets never enable anonymous development access. Global legacy outbox draining requires a scheduler credential or SUPER_ADMIN, not a tenant administrator.
- Middleware's scheduler session bypass is limited to an explicit POST sweep allowlist. A cron credential cannot authorize arbitrary APIs.
- Legacy tenant headers on public jobs are retained only as untrusted selectors (`x-requested-tenant-id`), honored after credential verification. Internal job forwarding takes tenant scope from authorized job context rather than caller search parameters.
- CI has a blocking C1 TypeScript check (`tsconfig.c1.json`) and four identity-boundary suites, separate from the existing advisory full unit suite.

## Verification

- Nine suites passed: 311 tests across public-endpoint-auth, middleware-identity-boundary, middleware-identity-headers, push-run-scheduler-auth, tenant-session, auth-route-policies, data-residency, admin-access and partner-portal-auth.
- The initial run passed 310 tests and timed out on one existing admin test while attempting sandbox-blocked Redis requests. Final run disabled Redis for the child test process only (`UPSTASH_REDIS_REST_URL=https://redis-disabled.invalid`, `UPSTASH_REDIS_REST_TOKEN` empty) and passed all 311. No local env files or deployed settings were changed. This uses the existing in-memory fallback; it is not live Redis validation.
- Focused C1 semantic TypeScript check passed: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.c1.json --pretty false`. This is not a full-project or mobile typecheck.
- ESLint passed for all changed/new TypeScript and JavaScript files. `git diff --check` passed.
- Tenant authorization source check: 811 routes, zero violations. This is a static check, not live database isolation proof.
- No live database, provider delivery, production proxy or deployment smoke test was performed. Unit tests mock database and delivery effects.

## Rollout requirements

1. Configure SESSION_SECRET and required CRON_SECRET/PUSH_CRON_SECRET values. Scheduler credentials remain platform-wide secrets: keep them server-side. Prefer bearer authorization over legacy query-string secrets.
2. Push callers need a real signed session, active tenant membership and `User.employeeId` linked to their active staff record. Employee ID alone and demo roster cookies no longer authenticate push operations. Provision these links before rollout; do not restore header-only authentication for compatibility.
3. In staging, test two tenants through the actual ingress: forged headers, own/other staff subscription creation and revocation, anonymous VAPID retrieval, scoped scheduler execution and denied tenant-admin global outbox execution.
4. Verify middleware executes for deployed public APIs and that application servers cannot be reached through an alternate ingress bypassing it. Protected helpers that consume middleware identity still rely on this deployment boundary.

## Scope limits

This addresses C1's caller-controlled identity trust and adds regression protection. It does not close separate audit findings concerning database/RLS coverage, webhook signature verification, session revocation availability, public storage or overall release gates. A passing C1 test run is not a 10/10 enterprise-readiness claim.
