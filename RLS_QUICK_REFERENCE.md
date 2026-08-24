# RLS Quick Reference Card

**Fleet360 Multi-Tenant RLS - Developer Guide**

---

## 🚀 Quick Start

### Standard Route Pattern
```typescript
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import prisma from '@/lib/prisma';

export async function GET(req: NextRequest) {
  const tenantId = await requireAuthorizedTenant(req);
  
  return withTenantRls(prisma, tenantId, async (tx) => {
    const data = await tx.vehicle.findMany({
      where: { status: 'active' }
    });
    return NextResponse.json(data);
  });
}

export async function POST(req: NextRequest) {
  const tenantId = await requireAuthorizedTenant(req);
  const body = stripTenantOwnershipFields(await req.json());
  
  return withTenantRls(prisma, tenantId, async (tx) => {
    const result = await tx.vehicle.create({ data: body });
    return NextResponse.json(result);
  });
}
```

---

## 📋 Three-Layer Defense Checklist

Every tenant-scoped route MUST have:

1. **✅ Authorization** - `requireAuthorizedTenant(req)`
2. **✅ RLS Wrapper** - `withTenantRls(prisma, tenantId, fn)`
3. **✅ Body Sanitization** - `stripTenantOwnershipFields(body)` (mutations only)

---

## 🛠️ Core Functions

### Authentication
```typescript
// Extract tenant ID from session
const tenantId = await requireAuthorizedTenant(req);
```

### RLS Wrappers
```typescript
// Single tenant operations (most routes)
withTenantRls(prisma, tenantId, async (tx) => { ... })

// Cross-tenant admin operations
withPlatformAdmin(prisma, async (tx) => { ... })

// Background jobs (iterate all tenants)
withSystemJob(prisma, async ({ tx, tenantId }) => { ... })

// Webhook handlers (identify tenant first)
withWebhookTenant(
  prisma,
  async (tx) => identifyTenant(tx, payload),
  async ({ tx, tenantId }) => handleWebhook(tx, payload)
)
```

### Body Sanitization
```typescript
// Remove tenant_id, organizationId, etc.
const cleanBody = stripTenantOwnershipFields(body);
```

---

## ⚠️ Common Mistakes

### ❌ Don't Do This
```typescript
// Missing authorization
export async function GET(req: NextRequest) {
  const data = await prisma.vehicle.findMany(); // ❌ No tenant check
  return NextResponse.json(data);
}

// No RLS wrapper
export async function GET(req: NextRequest) {
  const tenantId = await requireAuthorizedTenant(req);
  const data = await prisma.vehicle.findMany({ // ❌ Direct Prisma access
    where: { tenant_id: tenantId }
  });
  return NextResponse.json(data);
}

// No body sanitization
export async function POST(req: NextRequest) {
  const tenantId = await requireAuthorizedTenant(req);
  const body = await req.json(); // ❌ Not sanitized
  
  return withTenantRls(prisma, tenantId, async (tx) => {
    const result = await tx.vehicle.create({ data: body }); // ❌ Injection risk
    return NextResponse.json(result);
  });
}
```

### ✅ Do This Instead
```typescript
export async function POST(req: NextRequest) {
  const tenantId = await requireAuthorizedTenant(req);
  const body = stripTenantOwnershipFields(await req.json());
  
  return withTenantRls(prisma, tenantId, async (tx) => {
    const result = await tx.vehicle.create({ data: body });
    return NextResponse.json(result);
  });
}
```

---

## 🔍 Validation Commands

```bash
# Before committing (automatic via git hook)
node scripts/check-tenant-rls.js --files="path/to/route.ts"

# Fast smoke test
node scripts/rls-smoke-test.js

# Full codebase scan
node scripts/check-tenant-rls.js

# Complete validation suite
node scripts/final-validation.js
```

---

## 🚫 Exempt Routes

Routes that DON'T need RLS (automatically excluded):

- `api/auth/**` - Authentication endpoints
- `api/public/**` - Public APIs
- `api/webhooks/**` - Webhook handlers (use `withWebhookTenant`)
- `api/health/**` - Health checks
- `api/setup/**` - Initial setup flow
- `api/track/**` - Public tracking endpoints

---

## 🐛 Troubleshooting

### "Missing requireAuthorizedTenant"
**Fix:** Add authentication at the top of your handler
```typescript
const tenantId = await requireAuthorizedTenant(req);
```

### "Missing RLS wrapper"
**Fix:** Wrap all Prisma calls with `withTenantRls`
```typescript
return withTenantRls(prisma, tenantId, async (tx) => {
  // Use 'tx' instead of 'prisma' here
});
```

### "Missing body sanitization"
**Fix:** Sanitize request bodies in POST/PUT/PATCH/DELETE
```typescript
const body = stripTenantOwnershipFields(await req.json());
```

### "set_config returned null"
**Cause:** Using connection pooler instead of direct connection
**Fix:** Update `DATABASE_URL` to use direct connection (not `-pooler`)

---

## 📚 Documentation

- **Complete Guide:** [CI_INTEGRATION_GUIDE.md](CI_INTEGRATION_GUIDE.md)
- **Project Summary:** [PROJECT_SUMMARY.md](PROJECT_SUMMARY.md)
- **Deployment:** [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)
- **Test Results:** [INTEGRATION_TEST_RESULTS.md](INTEGRATION_TEST_RESULTS.md)
- **Final Status:** [RLS_MIGRATION_FINAL_STATUS.md](RLS_MIGRATION_FINAL_STATUS.md)

---

## 🎯 Key Principles

1. **Never trust client input** - Always sanitize request bodies
2. **Database-level isolation** - RLS policies are the primary defense
3. **Defense in depth** - Three layers catch different attack vectors
4. **Fail closed** - Missing tenant ID throws error, not returns all data
5. **Validate early** - Pre-commit hooks catch issues before PR

---

## 📊 Current Status

```
✅ 684 routes scanned
✅ 0 violations
✅ 352 compliant routes (51%)
✅ CI/CD pipeline active
✅ Ready for deployment
```

---

## 🆘 Quick Help

**Question:** Do I need RLS for this route?  
**Answer:** If it accesses tenant-scoped data, YES. If unsure, add it.

**Question:** What if I need cross-tenant access?  
**Answer:** Use `withPlatformAdmin` (requires platform admin role)

**Question:** How do I test my changes?  
**Answer:** Run `node scripts/check-tenant-rls.js --files="your-file.ts"`

**Question:** CI check failed, now what?  
**Answer:** See [CI_INTEGRATION_GUIDE.md](CI_INTEGRATION_GUIDE.md) troubleshooting section

---

**Last Updated:** 2026-08-23  
**Version:** 1.0  
**Status:** Production Ready ✅
