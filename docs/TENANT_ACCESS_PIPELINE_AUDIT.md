# Tenant Access Pipeline Audit

**Date:** 2026-08-24  
**Status:** Initial Assessment

## Executive Summary

This audit assesses whether the codebase follows the recommended tenant access pipeline architecture:

```
Request → requireAuthorizedTenant() → withTenantRls() → tenant-scoped query → Postgres RLS
```

### Key Findings

1. ✅ **Request Authorization Layer:** 100% compliant (666/666 routes use `requireAuthorizedTenant()`)
2. ⚠️ **Database Isolation Layer:** Partial adoption (~37% of routes use RLS wrappers)
3. ⚠️ **Defense-in-Depth Filters:** Inconsistent application of tenant filters in raw SQL
4. ✅ **Schema Enforcement:** 100% compliant (12/12 models have NOT NULL tenant_id + indexes)

## Recommended Architecture

### The Mandatory Pipeline

Every tenant-owned request must follow this pattern:

```typescript
export async function GET(req: NextRequest) {
  // 1. Authentication & Authorization (MANDATORY)
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  // 2. Database Isolation with RLS (MANDATORY)
  return withTenantRls(prisma, tenantId, async (tx) => {
    // 3. Defense-in-depth tenant filters (REQUIRED)
    return tx.vehicle.findMany({
      where: {
        tenantId: tenantId,  // Explicit filter makes intent visible
        deletedAt: null,
      },
    });
  });
}
```

For raw SQL:

```typescript
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    return tx.$queryRawUnsafe<Vehicle[]>(
      `SELECT * FROM vehicles 
       WHERE tenant_id = $1 AND deleted_at IS NULL`,
      tenantId
    );
  });
}
```

### Named Exceptions

Only these three patterns are allowed to bypass the standard pipeline:

1. **`withPlatformAdmin(prisma, fn)`** - Cross-tenant admin operations
2. **`withSystemJob(prisma, fn)`** - Background jobs iterating all tenants
3. **`withWebhookTenant(prisma, identifyFn, handleFn)`** - External webhooks

## Current State Analysis

### 1. Request Authorization Layer ✅

**Status:** Fully compliant  
**Coverage:** 666/666 routes (100%)

All API routes now use `requireAuthorizedTenant()` at the request boundary. This was achieved through systematic enforcement.

**Implementation:** All routes follow this pattern:
```typescript
const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
if (!authz.ok) {
  return NextResponse.json({ error: authz.error }, { status: authz.status });
}
const { tenantId } = authz;
```

### 2. Database Isolation Layer ⚠️

**Status:** Partial adoption  
**RLS wrapper usage:** ~304 routes use `withTenantRls`, `withPlatformAdmin`, `withSystemJob`, or `withWebhookTenant`  
**Direct queries:** ~1,289 database operations bypass RLS wrappers  
**Routes with DB operations:** ~508 files

#### Current Patterns Found

**Pattern A: Compliant (withTenantRls + explicit filter)**
```typescript
// ✅ COMPLIANT - Uses both RLS wrapper and explicit filter
return withTenantRls(prisma, tenantId, async (tx) => {
  return tx.vehicle.findMany({
    where: { tenantId, deletedAt: null },
  });
});
```

**Pattern B: Non-compliant (direct query with manual filter)**
```typescript
// ❌ NON-COMPLIANT - No RLS wrapper
const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
const { tenantId } = authz;

const rows = await prisma.$queryRawUnsafe<Row[]>(
  `SELECT * FROM vehicles WHERE tenant_id = $1 AND deleted_at IS NULL`,
  tenantId
);
```

**Pattern C: Admin operations (withPlatformAdmin)**
```typescript
// ✅ COMPLIANT - Named exception for cross-tenant admin
const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });

return withPlatformAdmin(prisma, async (tx) => {
  return tx.tenant.findMany({
    include: { modules: true },
  });
});
```

### 3. Defense-in-Depth Filters ⚠️

**Status:** Inconsistently applied

Many routes use direct database queries with manual tenant filtering but without the RLS wrapper:

**Example from `src/app/api/fleet/vehicles/route.ts`:**
```typescript
// Missing withTenantRls wrapper
const [countResult, rows] = await Promise.all([
  prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT COUNT(*) as count
     FROM vehicles v
     LEFT JOIN vehicle_types vt ON vt.id::text = v.vehicle_type_id
     WHERE ${where}`,  // ⚠️ No tenant_id filter in WHERE clause
    ...countParams,
  ),
  // ...
]);
```

This relies entirely on the fact that queries are scoped by context, but:
- No RLS enforcement at database level
- No explicit tenant filter in SQL
- Vulnerable if tenant context is accidentally bypassed

### 4. Schema-Level Enforcement ✅

**Status:** Fully compliant  
**Coverage:** 12/12 tenant-scoped models (100%)

All tenant-owned models have:
- ✅ `tenantId String @db.Uuid()` field
- ✅ `@@index([tenantId])` index
- ✅ `NOT NULL` constraint in migrations
- ✅ Foreign key to `tenants(id)` with `ON DELETE RESTRICT`

**Postgres RLS Policies:** Applied via migration `20260803000000_rls_tenant_isolation_all_tables`

RLS policy structure:
```sql
USING (
  tenant_id IS NULL
  OR current_setting('app.tenant_id', true) = '*'
  OR tenant_id::text = current_setting('app.tenant_id', true)
)
```

This means RLS **is configured** but only enforced when queries run inside `withTenantRls()` or `withPlatformAdmin()`.

## Gap Analysis

### Critical Gaps

1. **Missing RLS Wrapper Coverage (~63% of DB operations)**
   - **Impact:** High - Database-level tenant isolation not enforced
   - **Risk:** If `requireAuthorizedTenant()` is bypassed (middleware bug, route misconfiguration), queries can leak cross-tenant data
   - **Example:** `src/app/api/fleet/vehicles/route.ts` lines 68-86

2. **Inconsistent Tenant Filtering in Raw SQL**
   - **Impact:** Medium - Defense-in-depth layer incomplete
   - **Risk:** Queries may miss tenant_id filter, relying only on context
   - **Example:** Some queries build dynamic WHERE clauses without always including tenant_id

3. **No Enforcement of Pipeline Pattern**
   - **Impact:** Medium - Pattern compliance is manual, not automated
   - **Risk:** New routes or refactors may not follow the pipeline
   - **Current state:** Only `requireAuthorizedTenant()` is enforced via CI

### Architecture Violations

**Current: Five competing patterns**
1. `requireAuthorizedTenant()` + direct Prisma query
2. `requireAuthorizedTenant()` + `withTenantRls()` + Prisma query
3. `requireAuthorizedTenant()` + `withPlatformAdmin()` + Prisma query
4. `requireAuthorizedTenant()` + direct raw SQL with manual tenant filter
5. `requireAuthorizedTenant()` + `withTenantRls()` + raw SQL with manual tenant filter

**Recommended: One mandatory pipeline**
```
requireAuthorizedTenant() → withTenantRls() → tenant-scoped query
```

With only three named exceptions:
- `withPlatformAdmin()` for cross-tenant admin
- `withSystemJob()` for tenant iteration
- `withWebhookTenant()` for external webhooks

## Recommendations

### Priority 1: Enforce RLS Wrapper Usage

**Goal:** 100% of tenant-scoped database operations must execute inside `withTenantRls()` or a named exception.

**Action Items:**

1. **Update enforcement script** (`scripts/check-tenant-auth.js`)
   - Check for database operations (`prisma.$queryRaw`, `prisma.$executeRaw`, `tx.model.find*`, etc.)
   - Verify they're inside `withTenantRls()`, `withPlatformAdmin()`, `withSystemJob()`, or `withWebhookTenant()`
   - Flag violations

2. **Add CI check:** `npm run tenant:check-rls`
   - Block PRs that add direct database queries without RLS wrappers
   - Exempt only files in `src/app/api/public/`, `src/app/api/webhooks/`, `src/app/api/auth/`

3. **Create migration guide:**
   - Document how to wrap existing queries
   - Provide before/after examples
   - Offer automated codemod if feasible

**Estimated effort:** 2-3 weeks to update ~200+ route files

### Priority 2: Standardize Defense-in-Depth Filters

**Goal:** Every query inside `withTenantRls()` must include explicit tenant filtering.

**Action Items:**

1. **Pattern enforcement:**
   - Prisma queries: Always include `where: { tenantId }`
   - Raw SQL: Always include `WHERE tenant_id = $N`

2. **Linting rule:**
   - Add ESLint rule to detect queries missing tenant filter when inside RLS wrapper
   - Allow exceptions for `withPlatformAdmin()` context

**Estimated effort:** 1 week

### Priority 3: Document Named Exceptions

**Goal:** Clear audit trail for all routes that use `withPlatformAdmin()`, `withSystemJob()`, or `withWebhookTenant()`.

**Action Items:**

1. **Create registry:**
   - `docs/TENANT_BYPASS_REGISTRY.md`
   - List every route using a named exception
   - Document why the exception is necessary
   - Require code review approval for new exceptions

2. **Add inline comments:**
   - Every `withPlatformAdmin()` call must have a comment explaining why

**Estimated effort:** 2-3 days

### Priority 4: Update Documentation

**Goal:** Single source of truth for tenant access pipeline.

**Action Items:**

1. **Update `docs/TENANT_SAFETY_CONTRACT.md`:**
   - Replace five patterns with one mandatory pipeline
   - Document the three named exceptions
   - Add code examples

2. **Update `docs/TENANT_SAFETY_ENFORCEMENT.md`:**
   - Add RLS wrapper enforcement to baseline metrics
   - Update violation fixes to show pipeline pattern

3. **Create `docs/TENANT_ACCESS_PIPELINE.md`:**
   - Architecture diagram
   - Layer-by-layer explanation
   - Migration guide for existing routes

**Estimated effort:** 1 week

## Metrics

### Current Baseline (2026-08-24)

| Layer | Metric | Status |
|-------|--------|--------|
| **Request Authorization** | `requireAuthorizedTenant()` usage | ✅ 666/666 (100%) |
| **Database Isolation** | RLS wrapper usage | ⚠️ ~304/508 (60%*) |
| **Defense-in-Depth** | Explicit tenant filters | ⚠️ Not measured |
| **Schema Enforcement** | NOT NULL + indexes | ✅ 12/12 (100%) |
| **Postgres RLS Policies** | Applied to tables | ✅ All tenant-scoped tables |

*Estimate based on grep analysis; exact number requires deeper inspection.

### Target State

| Layer | Metric | Target |
|-------|--------|--------|
| **Request Authorization** | `requireAuthorizedTenant()` usage | 100% (maintained) |
| **Database Isolation** | RLS wrapper usage | 100% (enforced) |
| **Defense-in-Depth** | Explicit tenant filters | 100% (enforced) |
| **Schema Enforcement** | NOT NULL + indexes | 100% (maintained) |
| **Postgres RLS Policies** | Applied to tables | 100% (maintained) |

## Next Steps

1. ✅ **Complete this audit** - Document current state
2. ⏳ **Create enforcement script** - `scripts/check-tenant-rls.js`
3. ⏳ **Update CI pipeline** - Add RLS wrapper check
4. ⏳ **Migrate routes** - Wrap direct queries in `withTenantRls()`
5. ⏳ **Document exceptions** - Create bypass registry
6. ⏳ **Update contract docs** - Replace five patterns with one pipeline

## Related Documentation

- [TENANT_SAFETY_CONTRACT.md](./TENANT_SAFETY_CONTRACT.md) - Current contract definition
- [TENANT_SAFETY_ENFORCEMENT.md](./TENANT_SAFETY_ENFORCEMENT.md) - Current enforcement mechanisms
- [src/lib/rls.ts](../src/lib/rls.ts) - RLS wrapper implementations
- [src/lib/tenant-context.ts](../src/lib/tenant-context.ts) - Authorization helper

## Appendix: Example Migrations

### Example 1: Raw SQL Query

**Before (non-compliant):**
```typescript
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const rows = await prisma.$queryRawUnsafe<Vehicle[]>(
    `SELECT * FROM vehicles WHERE deleted_at IS NULL`,
  );
  
  return NextResponse.json(rows);
}
```

**After (compliant):**
```typescript
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<Vehicle[]>(
      `SELECT * FROM vehicles 
       WHERE tenant_id = $1 AND deleted_at IS NULL`,
      tenantId
    );
    return NextResponse.json(rows);
  });
}
```

### Example 2: Prisma Query

**Before (non-compliant):**
```typescript
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const vehicles = await prisma.vehicle.findMany({
    where: { tenantId, deletedAt: null },
  });
  
  return NextResponse.json(vehicles);
}
```

**After (compliant):**
```typescript
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const vehicles = await tx.vehicle.findMany({
      where: { tenantId, deletedAt: null },
    });
    return NextResponse.json(vehicles);
  });
}
```

### Example 3: Admin Route (Named Exception)

**Before (implicit cross-tenant):**
```typescript
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  const tenants = await prisma.tenant.findMany({
    include: { modules: true },
  });
  
  return NextResponse.json(tenants);
}
```

**After (explicit named exception):**
```typescript
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  // Named exception: platform admin listing all tenants
  // This is an intentional cross-tenant read for admin UI
  return withPlatformAdmin(prisma, async (tx) => {
    const tenants = await tx.tenant.findMany({
      include: { modules: true },
    });
    return NextResponse.json(tenants);
  });
}
```
