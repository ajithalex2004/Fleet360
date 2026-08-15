# Tenant Safety Contract

**Applies to:** every tenant-owned model in Fleet360 (Leasing, Rental, Fleet, Finance, Bus Ops, …)  
**Origin:** TENANT-001 hardening (2026-08-15)

## Invariant

> Every tenant-owned record must have an unambiguous tenant owner, and every
> read/write path must be constrained to the authorized tenant at both the
> application and database layers.

## Identity chain

```
Session / JWT
    → User
    → Tenant membership
    → Authorized tenant
    → TenantContext
    → withTenantRls()
    → Prisma transaction
         ├─ Application where: { tenantId }
         └─ PostgreSQL RLS (USING + WITH CHECK)
```

`x-tenant-id` is a **selector** injected by middleware from the verified session.
It is **not** proof of identity by itself. Request-body `tenantId` is never
authoritative.

## Rules for every tenant-owned model

1. `tenant_id` MUST exist  
2. `tenant_id` MUST be `NOT NULL` in steady state  
3. `tenant_id` MUST be indexed  
4. Tenant ownership MUST be assigned server-side (never from normal business input)  
5. All application reads MUST be tenant-scoped  
6. All mutations MUST be tenant-scoped  
7. RLS MUST protect the table (`ENABLE` + prefer `FORCE`)  
8. RLS MUST apply to reads **and** writes (`USING` + `WITH CHECK`)  
9. Background jobs MUST establish tenant context (prefer per-tenant iteration)  
10. Cross-tenant parent/child relationships MUST be impossible (composite FK)  
11. Appropriate unique constraints MUST include `tenant_id`  
12. Tenant isolation MUST be tested using the production-equivalent app DB role  

## Parent / child integrity

Child rows that reference a tenant-owned parent MUST:

- Carry their own `tenant_id`
- Use a composite foreign key `(parent_id, tenant_id) → parent(id, tenant_id)`

## Platform scope

`app.tenant_id = '*'` is restricted to controlled platform-admin paths
(`withPlatformAdmin`). Prefer tenant iteration for background jobs.

## Checklist for new models

Before merge:

- [ ] `tenantId` on Prisma model + migration  
- [ ] Index + RLS policy (USING + WITH CHECK)  
- [ ] Handler uses `requireAuthorizedTenant` + `withTenantRls`  
- [ ] Isolation test covers cross-tenant read/write denial  
- [ ] No `tenantId` accepted from request body for ownership  

## Related

- `src/lib/tenant-context.ts` — `requireAuthorizedTenant`, `stripTenantOwnershipFields`  
- `src/lib/rls.ts` — `withTenantRls`, `withPlatformAdmin`, `withSystemJob`  
- `prisma/migrations/20260815140000_tenant_001_leasing_rental_isolation`  
- `docs/KNOWN_GAPS.md` — TENANT-001 status  
