# Tenant Access Pipeline Migration Guide

**Date:** 2026-08-24  
**Status:** Active Migration

## Overview

This guide provides step-by-step instructions for migrating API routes to follow the mandatory tenant access pipeline:

```
Request → requireAuthorizedTenant() → withTenantRls() → tenant-scoped query → Postgres RLS
```

## Prerequisites

Before migrating routes, ensure you understand:

1. **The Mandatory Pipeline** - See [TENANT_ACCESS_PIPELINE_AUDIT.md](./TENANT_ACCESS_PIPELINE_AUDIT.md)
2. **RLS Wrapper Functions** - See [src/lib/rls.ts](../src/lib/rls.ts)
3. **Authorization Helpers** - See [src/lib/tenant-context.ts](../src/lib/tenant-context.ts)

## Quick Reference

### When to Use Each RLS Wrapper

| Pattern | When to Use | Example Routes |
|---------|-------------|----------------|
| `withTenantRls(prisma, tenantId, fn)` | 99% of routes - single-tenant operations | `/api/fleet/vehicles`, `/api/service-tickets` |
| `withPlatformAdmin(prisma, fn)` | Cross-tenant admin operations | `/api/admin/tenants`, `/api/admin/users` |
| `withSystemJob(prisma, fn, opts)` | Background jobs iterating all tenants | `/api/cron/billing-sweep` |
| `withWebhookTenant(prisma, identifyFn, handleFn)` | External webhooks without tenant header | `/api/webhooks/stripe` |

## Migration Patterns

### Pattern 1: Prisma ORM Query (No RLS Wrapper)

**Symptom:** Route uses `requireAuthorizedTenant()` but calls `prisma.model.find*()` directly without RLS wrapper.

**Risk Level:** 🔴 High - No database-level isolation

#### Before (Non-Compliant)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  // ❌ Direct Prisma query - no RLS wrapper
  const vehicles = await prisma.vehicle.findMany({
    where: { tenantId, deletedAt: null },
    include: { type: true },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(vehicles);
}
```

#### After (Compliant)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';  // ← Add import

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  // ✅ Wrapped in withTenantRls - database-level isolation enforced
  return withTenantRls(prisma, tenantId, async (tx) => {
    const vehicles = await tx.vehicle.findMany({
      where: { tenantId, deletedAt: null },  // Defense-in-depth filter
      include: { type: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(vehicles);
  });
}
```

#### Key Changes

1. Import `withTenantRls` from `@/lib/rls`
2. Wrap the database operation in `withTenantRls(prisma, tenantId, async (tx) => { ... })`
3. Replace `prisma` with `tx` inside the wrapper
4. Return the `NextResponse` from inside the wrapper
5. Keep the explicit `where: { tenantId }` filter for defense-in-depth

---

### Pattern 2: Raw SQL with `$queryRawUnsafe` (No RLS Wrapper)

**Symptom:** Route uses `prisma.$queryRawUnsafe()` directly without RLS wrapper.

**Risk Level:** 🔴 High - No database-level isolation, relies on manual WHERE clause

#### Before (Non-Compliant)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const status = req.nextUrl.searchParams.get('status');

  // ❌ Direct raw SQL - no RLS wrapper
  const rows = await prisma.$queryRawUnsafe<Vehicle[]>(
    `SELECT v.*, vt.name AS type_name
     FROM vehicles v
     LEFT JOIN vehicle_types vt ON vt.id::text = v.vehicle_type_id
     WHERE v.tenant_id = $1 AND v.deleted_at IS NULL
       ${status ? `AND v.status = $2` : ''}
     ORDER BY v.created_at DESC`,
    tenantId,
    ...(status ? [status] : []),
  );

  return NextResponse.json(rows);
}
```

#### After (Compliant)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';  // ← Add import

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const status = req.nextUrl.searchParams.get('status');

  // ✅ Wrapped in withTenantRls - database-level isolation enforced
  return withTenantRls(prisma, tenantId, async (tx) => {
    const rows = await tx.$queryRawUnsafe<Vehicle[]>(
      `SELECT v.*, vt.name AS type_name
       FROM vehicles v
       LEFT JOIN vehicle_types vt ON vt.id::text = v.vehicle_type_id
       WHERE v.tenant_id = $1 AND v.deleted_at IS NULL
         ${status ? `AND v.status = $2` : ''}
       ORDER BY v.created_at DESC`,
      tenantId,  // Keep explicit tenant filter for defense-in-depth
      ...(status ? [status] : []),
    );
    return NextResponse.json(rows);
  });
}
```

#### Key Changes

1. Import `withTenantRls` from `@/lib/rls`
2. Wrap the database operation in `withTenantRls(prisma, tenantId, async (tx) => { ... })`
3. Replace `prisma` with `tx` inside the wrapper
4. Keep the explicit `WHERE tenant_id = $1` clause for defense-in-depth
5. Return the `NextResponse` from inside the wrapper

---

### Pattern 3: Missing Tenant Filter in Raw SQL

**Symptom:** Route uses RLS wrapper but forgot to include tenant filter in SQL WHERE clause.

**Risk Level:** 🟡 Medium - RLS enforces isolation, but defense-in-depth layer missing

#### Before (Partially Compliant)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    // ⚠️ Missing explicit tenant_id filter - relies only on RLS
    const rows = await tx.$queryRawUnsafe<Vehicle[]>(
      `SELECT * FROM vehicles WHERE deleted_at IS NULL`
    );
    return NextResponse.json(rows);
  });
}
```

#### After (Fully Compliant)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    // ✅ Explicit tenant_id filter added for defense-in-depth
    const rows = await tx.$queryRawUnsafe<Vehicle[]>(
      `SELECT * FROM vehicles 
       WHERE tenant_id = $1 AND deleted_at IS NULL`,
      tenantId
    );
    return NextResponse.json(rows);
  });
}
```

#### Key Changes

1. Add `WHERE tenant_id = $1` to the SQL query
2. Pass `tenantId` as the first parameter to `$queryRawUnsafe`
3. Adjust subsequent parameter indices if needed (`$2`, `$3`, etc.)

---

### Pattern 4: POST/PUT/PATCH Handler (Missing Body Sanitization)

**Symptom:** Route accepts request body with `tenantId` field from client, creating a security hole.

**Risk Level:** 🔴 Critical - Client can specify arbitrary tenant

#### Before (Non-Compliant)

```typescript
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const body = await req.json();

  // ❌ Body may contain tenantId from client - security hole!
  return withTenantRls(prisma, tenantId, async (tx) => {
    const vehicle = await tx.vehicle.create({
      data: {
        ...body,           // ❌ Dangerous - body.tenantId overrides context
        tenantId: tenantId, // This line is overridden if body.tenantId exists!
      },
    });
    return NextResponse.json(vehicle, { status: 201 });
  });
}
```

#### After (Compliant)

```typescript
import { stripTenantOwnershipFields } from '@/lib/tenant-context';  // ← Add import

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const bodyRaw = await req.json();
  // ✅ Strip tenant ownership fields from untrusted input
  const body = stripTenantOwnershipFields(bodyRaw);

  return withTenantRls(prisma, tenantId, async (tx) => {
    const vehicle = await tx.vehicle.create({
      data: {
        ...body,
        tenantId,  // ✅ Server-controlled, never from client
      },
    });
    return NextResponse.json(vehicle, { status: 201 });
  });
}
```

#### Key Changes

1. Import `stripTenantOwnershipFields` from `@/lib/tenant-context`
2. Rename `body` to `bodyRaw`
3. Call `stripTenantOwnershipFields(bodyRaw)` to remove `tenantId` and `tenant_id` fields
4. Spread the sanitized `body` first, then explicitly set `tenantId` from context

---

### Pattern 5: Admin Route (Cross-Tenant Read)

**Symptom:** Route needs to query across all tenants (admin UI, platform dashboard).

**Risk Level:** 🟢 Low - Intentional cross-tenant access, but must use named exception

#### Before (Implicit Cross-Tenant)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  // ❌ Implicit cross-tenant read - no RLS wrapper makes intent unclear
  const tenants = await prisma.tenant.findMany({
    include: { modules: true, _count: { select: { userTenants: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json(tenants);
}
```

#### After (Named Exception - Explicit Intent)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withPlatformAdmin } from '@/lib/rls';  // ← Add import

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }

  // ✅ Named exception: withPlatformAdmin makes cross-tenant intent explicit
  // This route is for platform admin UI - intentional cross-tenant read
  return withPlatformAdmin(prisma, async (tx) => {
    const tenants = await tx.tenant.findMany({
      include: { modules: true, _count: { select: { userTenants: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(tenants);
  });
}
```

#### Key Changes

1. Import `withPlatformAdmin` from `@/lib/rls`
2. Wrap the cross-tenant query in `withPlatformAdmin(prisma, async (tx) => { ... })`
3. Replace `prisma` with `tx` inside the wrapper
4. Add a comment explaining why cross-tenant access is intentional
5. Document this route in `docs/TENANT_BYPASS_REGISTRY.md` (see below)

---

### Pattern 6: Multiple Database Operations in One Handler

**Symptom:** Route performs multiple queries/mutations that need to be atomic.

**Risk Level:** 🟡 Medium - Transaction boundaries unclear

#### Before (Non-Compliant)

```typescript
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const body = await req.json();

  // ❌ Multiple operations without RLS wrapper or transaction
  const vehicle = await prisma.vehicle.create({
    data: { ...body, tenantId },
  });

  await prisma.auditLog.create({
    data: {
      tenantId,
      entityType: 'Vehicle',
      entityId: vehicle.id,
      action: 'CREATE',
    },
  });

  return NextResponse.json(vehicle, { status: 201 });
}
```

#### After (Compliant - Atomic Transaction)

```typescript
import { stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const bodyRaw = await req.json();
  const body = stripTenantOwnershipFields(bodyRaw);

  // ✅ All operations in one RLS-wrapped transaction
  return withTenantRls(prisma, tenantId, async (tx) => {
    const vehicle = await tx.vehicle.create({
      data: { ...body, tenantId },
    });

    await tx.auditLog.create({
      data: {
        tenantId,
        entityType: 'Vehicle',
        entityId: vehicle.id,
        action: 'CREATE',
      },
    });

    return NextResponse.json(vehicle, { status: 201 });
  });
}
```

#### Key Changes

1. Wrap all database operations in a single `withTenantRls()` call
2. The wrapper automatically provides a transaction - all operations are atomic
3. If one operation fails, all are rolled back
4. RLS enforcement applies to every query in the transaction

---

### Pattern 7: Background Job / Cron Handler

**Symptom:** Route needs to iterate all tenants (billing sweep, dunning, expiry sweep).

**Risk Level:** 🟢 Low - Intentional multi-tenant iteration, but must use named exception

#### Before (Manual Iteration)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  // ❌ No authorization check - cron routes are exempt but should validate cron secret
  // ❌ Manual tenant iteration without RLS wrapper

  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
  });

  const results = [];
  for (const tenant of tenants) {
    const expired = await prisma.rentalAgreement.findMany({
      where: {
        tenantId: tenant.id,
        status: 'ACTIVE',
        endDate: { lt: new Date() },
      },
    });

    for (const agreement of expired) {
      await prisma.rentalAgreement.update({
        where: { id: agreement.id },
        data: { status: 'EXPIRED' },
      });
    }

    results.push({ tenantId: tenant.id, expiredCount: expired.length });
  }

  return NextResponse.json({ results });
}
```

#### After (Named Exception - withSystemJob)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withSystemJob } from '@/lib/rls';  // ← Add import

export async function POST(req: NextRequest) {
  // ✅ Validate cron secret (optional but recommended)
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ✅ Named exception: withSystemJob iterates tenants with RLS isolation per tenant
  const results = await withSystemJob(
    prisma,
    async ({ tx, tenantId }) => {
      // tx is tenant-scoped - RLS ensures queries only see this tenant's data
      const expired = await tx.rentalAgreement.findMany({
        where: {
          tenantId,  // Defense-in-depth filter
          status: 'ACTIVE',
          endDate: { lt: new Date() },
        },
      });

      for (const agreement of expired) {
        await tx.rentalAgreement.update({
          where: { id: agreement.id },
          data: { status: 'EXPIRED' },
        });
      }

      return { expiredCount: expired.length };
    },
    { timeoutMs: 30_000 },  // Per-tenant timeout
  );

  return NextResponse.json({ results });
}
```

#### Key Changes

1. Import `withSystemJob` from `@/lib/rls`
2. Replace manual tenant iteration with `withSystemJob(prisma, fn, opts)`
3. The callback receives `{ tx, tenantId }` - `tx` is already tenant-scoped
4. Each tenant's work runs in its own RLS-wrapped transaction
5. If one tenant's work fails, others continue (fault isolation)
6. Return value becomes `{ tenantId, result }[]`

---

## Special Cases

### Case 1: Webhook Handler (No Tenant Context Yet)

Webhooks arrive without `x-tenant-id` header. You must identify the tenant from the payload first.

#### Pattern

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withWebhookTenant } from '@/lib/rls';

export async function POST(req: NextRequest) {
  // ✅ Validate webhook signature first
  const signature = req.headers.get('stripe-signature');
  if (!isValidStripeSignature(signature, await req.text())) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = await req.json();

  // ✅ Use withWebhookTenant to identify tenant, then run handler in tenant context
  const result = await withWebhookTenant(
    prisma,
    // Step 1: Identify tenant from webhook payload (runs with cross-tenant access)
    async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { stripeCustomerId: event.data.object.customer },
      });
      return tenant?.id ?? null;
    },
    // Step 2: Handle webhook in tenant-scoped context (runs with RLS isolation)
    async ({ tx, tenantId }) => {
      await tx.invoice.create({
        data: {
          tenantId,
          stripeInvoiceId: event.data.object.id,
          amount: event.data.object.amount_due,
          status: 'PAID',
        },
      });
      return { ok: true };
    },
  );

  if (!result) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  return NextResponse.json(result);
}
```

### Case 2: Public API (No Authentication Required)

Some routes are intentionally public (tracking links, status pages). These should be in `src/app/api/public/`.

#### Pattern

```typescript
// src/app/api/public/tracking/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin } from '@/lib/rls';

interface RouteParams { params: Promise<{ id: string }>; }

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id } = await params;

  // ✅ Public route - no requireAuthorizedTenant()
  // ✅ Use withPlatformAdmin to search across all tenants
  const result = await withPlatformAdmin(prisma, async (tx) => {
    const shipment = await tx.shipment.findFirst({
      where: {
        trackingCode: id,
        isPublicTrackingEnabled: true,
      },
      select: {
        id: true,
        status: true,
        estimatedDelivery: true,
        // Don't expose tenant-specific or sensitive fields
      },
    });
    return shipment;
  });

  if (!result) {
    return NextResponse.json({ error: 'Tracking code not found' }, { status: 404 });
  }

  return NextResponse.json(result);
}
```

**Important:** Document public routes in `docs/TENANT_BYPASS_REGISTRY.md`.

---

## Migration Checklist

For each route file you migrate:

- [ ] Import `withTenantRls` (or appropriate RLS wrapper) from `@/lib/rls`
- [ ] Wrap all database operations in the RLS wrapper
- [ ] Replace `prisma` with `tx` inside the wrapper
- [ ] For POST/PUT/PATCH: Import and use `stripTenantOwnershipFields()`
- [ ] For raw SQL: Keep explicit `WHERE tenant_id = $N` clause
- [ ] For Prisma queries: Keep explicit `where: { tenantId }` filter
- [ ] Return `NextResponse` from inside the wrapper
- [ ] Test the route with your tenant's data
- [ ] Test that cross-tenant access is blocked (try accessing another tenant's resource)
- [ ] Update any tests that mock database calls
- [ ] If using `withPlatformAdmin`, `withSystemJob`, or `withWebhookTenant`, document in bypass registry

---

## Testing Migrations

### Manual Testing

1. **Positive test:** Verify the route works for your tenant's data
   ```bash
   curl -H "x-tenant-id: your-tenant-id" \
        -H "x-user-id: your-user-id" \
        http://localhost:3000/api/fleet/vehicles
   ```

2. **Cross-tenant isolation test:** Try accessing another tenant's resource
   ```bash
   # Should return 404 or empty result, NOT another tenant's data
   curl -H "x-tenant-id: your-tenant-id" \
        -H "x-user-id: your-user-id" \
        http://localhost:3000/api/fleet/vehicles/other-tenant-vehicle-id
   ```

3. **Missing tenant context test:** Try calling without tenant header
   ```bash
   # Should return 401 or 403
   curl http://localhost:3000/api/fleet/vehicles
   ```

### Automated Testing

Update your integration tests to verify RLS isolation:

```typescript
describe('GET /api/fleet/vehicles', () => {
  it('returns only vehicles for the authenticated tenant', async () => {
    const tenant1 = await createTestTenant();
    const tenant2 = await createTestTenant();
    
    await createVehicle({ tenantId: tenant1.id, make: 'Toyota' });
    await createVehicle({ tenantId: tenant2.id, make: 'Honda' });
    
    const res = await request(app)
      .get('/api/fleet/vehicles')
      .set('x-tenant-id', tenant1.id)
      .set('x-user-id', 'test-user');
    
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].make).toBe('Toyota');
  });
  
  it('blocks access to other tenant resources', async () => {
    const tenant1 = await createTestTenant();
    const tenant2 = await createTestTenant();
    
    const vehicle2 = await createVehicle({ tenantId: tenant2.id });
    
    const res = await request(app)
      .get(`/api/fleet/vehicles/${vehicle2.id}`)
      .set('x-tenant-id', tenant1.id)
      .set('x-user-id', 'test-user');
    
    expect(res.status).toBe(404);
  });
});
```

---

## Documenting Named Exceptions

Every route using `withPlatformAdmin()`, `withSystemJob()`, or `withWebhookTenant()` must be documented in the bypass registry.

Create or update `docs/TENANT_BYPASS_REGISTRY.md`:

```markdown
# Tenant Access Bypass Registry

This document lists all routes that intentionally bypass single-tenant isolation using named exceptions.

## withPlatformAdmin() Routes

Routes that read or write across multiple tenants for platform admin purposes.

| Route | Purpose | Authorized Roles | Review Date |
|-------|---------|-----------------|-------------|
| `/api/admin/tenants` | List all tenants for admin UI | SUPER_ADMIN | 2026-08-24 |
| `/api/admin/users` | Cross-tenant user management | SUPER_ADMIN | 2026-08-24 |
| `/api/admin/audit-logs` | Platform-wide audit log search | SUPER_ADMIN | 2026-08-24 |

## withSystemJob() Routes

Background jobs that iterate all tenants.

| Route | Purpose | Trigger | Review Date |
|-------|---------|---------|-------------|
| `/api/cron/billing-sweep` | Bill all tenants monthly | Cron (1st of month) | 2026-08-24 |
| `/api/cron/expiry-sweep` | Expire old agreements | Cron (daily) | 2026-08-24 |

## withWebhookTenant() Routes

Webhooks that identify tenant from external payload.

| Route | Purpose | External Service | Review Date |
|-------|---------|-----------------|-------------|
| `/api/webhooks/stripe` | Stripe payment events | Stripe | 2026-08-24 |
| `/api/webhooks/twilio` | SMS delivery status | Twilio | 2026-08-24 |

## Public Routes (No Authentication)

Routes in `src/app/api/public/` that intentionally have no authentication.

| Route | Purpose | Rate Limit | Review Date |
|-------|---------|-----------|-------------|
| `/api/public/tracking/[id]` | Public shipment tracking | 100 req/min per IP | 2026-08-24 |
| `/api/public/health` | Health check for monitoring | None | 2026-08-24 |
```

---

## Batch Migration Strategy

If you have many routes to migrate (~200+), follow this phased approach:

### Phase 1: High-Risk Routes (Week 1)

Prioritize routes that:
- Handle financial data (payments, invoices, billing)
- Expose PII (user profiles, customer data)
- Perform mutations (POST/PUT/PATCH/DELETE)

### Phase 2: High-Traffic Routes (Week 2)

Prioritize routes that:
- Appear in API analytics top 20
- Are called from critical user flows (booking, dispatch, fleet ops)

### Phase 3: Remaining Routes (Weeks 3-4)

Migrate all other routes systematically by module:
- `/api/fleet/*`
- `/api/dispatch/*`
- `/api/leasing/*`
- `/api/finance/*`
- etc.

### Phase 4: Admin & System Routes (Week 5)

Migrate admin and cron routes, documenting each in the bypass registry.

---

## Common Pitfalls

### Pitfall 1: Forgetting to Return from Inside Wrapper

❌ **Wrong:**
```typescript
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  withTenantRls(prisma, tenantId, async (tx) => {
    const data = await tx.vehicle.findMany({ where: { tenantId } });
    return NextResponse.json(data);  // ❌ This return is inside the arrow function, not the handler
  });
  
  // ❌ Handler implicitly returns undefined → 500 error
}
```

✅ **Correct:**
```typescript
export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {  // ✅ Return the wrapper call
    const data = await tx.vehicle.findMany({ where: { tenantId } });
    return NextResponse.json(data);
  });
}
```

### Pitfall 2: Nesting RLS Wrappers

❌ **Wrong:**
```typescript
return withTenantRls(prisma, tenantId, async (tx) => {
  const vehicle = await tx.vehicle.findUnique({ where: { id } });
  
  // ❌ Don't nest another RLS wrapper - already inside one
  return withTenantRls(prisma, tenantId, async (tx2) => {
    await tx2.auditLog.create({ data: { ... } });
  });
});
```

✅ **Correct:**
```typescript
return withTenantRls(prisma, tenantId, async (tx) => {
  const vehicle = await tx.vehicle.findUnique({ where: { id } });
  
  // ✅ Use the same tx - already tenant-scoped
  await tx.auditLog.create({ data: { ... } });
  
  return NextResponse.json(vehicle);
});
```

### Pitfall 3: Using `prisma` Instead of `tx` Inside Wrapper

❌ **Wrong:**
```typescript
return withTenantRls(prisma, tenantId, async (tx) => {
  // ❌ Using 'prisma' bypasses RLS - use 'tx' instead
  const data = await prisma.vehicle.findMany({ where: { tenantId } });
  return NextResponse.json(data);
});
```

✅ **Correct:**
```typescript
return withTenantRls(prisma, tenantId, async (tx) => {
  // ✅ Use 'tx' - it's RLS-scoped
  const data = await tx.vehicle.findMany({ where: { tenantId } });
  return NextResponse.json(data);
});
```

### Pitfall 4: Forgetting Defense-in-Depth Filters

⚠️ **Works but not recommended:**
```typescript
return withTenantRls(prisma, tenantId, async (tx) => {
  // ⚠️ RLS enforces isolation, but explicit filter is missing
  const data = await tx.vehicle.findMany({ where: { deletedAt: null } });
  return NextResponse.json(data);
});
```

✅ **Correct:**
```typescript
return withTenantRls(prisma, tenantId, async (tx) => {
  // ✅ Explicit tenantId filter makes intent visible + defense-in-depth
  const data = await tx.vehicle.findMany({
    where: { tenantId, deletedAt: null },
  });
  return NextResponse.json(data);
});
```

---

## Automated Migration Tools

### Find Routes Needing Migration

```bash
# Find routes with direct database queries (no RLS wrapper)
npm run tenant:find-unwrapped
```

This script scans for:
- `prisma.$queryRaw` / `prisma.$executeRaw` without `withTenantRls`
- `prisma.model.find*()` without `withTenantRls`
- POST/PUT/PATCH handlers without `stripTenantOwnershipFields()`

### Validate Migration

```bash
# Check if a route follows the pipeline pattern
npm run tenant:check-rls -- src/app/api/fleet/vehicles/route.ts
```

---

## Getting Help

If you encounter issues during migration:

1. **Check this guide first** - Most patterns are covered above
2. **Review the RLS wrapper source** - [src/lib/rls.ts](../src/lib/rls.ts)
3. **Look at migrated examples** - `/api/admin/tenants/route.ts` (withPlatformAdmin), `/api/fleet/drivers/route.ts` (withTenantRls)
4. **Ask in #security or #architecture channels** - Tag someone who's already migrated routes

---

## Success Criteria

A route is considered fully migrated when:

- ✅ Uses `requireAuthorizedTenant()` at request boundary
- ✅ All database operations are inside `withTenantRls()` (or named exception)
- ✅ POST/PUT/PATCH handlers use `stripTenantOwnershipFields()`
- ✅ Explicit tenant filters present in all queries (defense-in-depth)
- ✅ Returns `NextResponse` from inside the RLS wrapper
- ✅ Manual testing passes (positive + cross-tenant isolation tests)
- ✅ If using named exception, documented in bypass registry

---

## Related Documentation

- [TENANT_ACCESS_PIPELINE_AUDIT.md](./TENANT_ACCESS_PIPELINE_AUDIT.md) - Current state assessment
- [TENANT_SAFETY_CONTRACT.md](./TENANT_SAFETY_CONTRACT.md) - The contract definition
- [TENANT_SAFETY_ENFORCEMENT.md](./TENANT_SAFETY_ENFORCEMENT.md) - Enforcement mechanisms
- [src/lib/rls.ts](../src/lib/rls.ts) - RLS wrapper implementations
- [src/lib/tenant-context.ts](../src/lib/tenant-context.ts) - Authorization helpers
