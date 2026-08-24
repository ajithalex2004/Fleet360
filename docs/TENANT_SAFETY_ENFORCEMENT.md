# Tenant Safety Contract - Enforcement Guide

## Overview

This document describes the enforcement mechanisms that ensure all API routes follow the tenant safety contract defined in [TENANT_SAFETY_CONTRACT.md](./TENANT_SAFETY_CONTRACT.md).

## Enforcement Layers

### 1. Pre-Commit Hook (Local Development)

**Location:** `.git/hooks/pre-commit`

**What it does:** Scans all staged API route files and blocks commits if they don't use `requireAuthorizedTenant()`.

**When it runs:** Every time you run `git commit`

**How to use:**
```bash
# Normal commit - hook runs automatically
git commit -m "fix: update customer route"

# Emergency bypass (use sparingly)
git commit --no-verify -m "urgent hotfix"
```

**What gets checked:**
- All `route.ts` files in `src/app/api/`
- Presence of `requireAuthorizedTenant` import
- Presence of `requireAuthorizedTenant()` call in each handler (GET, POST, PUT, PATCH, DELETE)

**Exemptions:**
Routes in these directories are exempt from enforcement:
- `src/app/api/public/` - Public APIs (tracking links, etc.)
- `src/app/api/webhooks/` - External webhooks (should use `withWebhookTenant()`)
- `src/app/api/auth/` - Authentication endpoints (no tenant context yet)
- `src/app/api/health` - Health check endpoints
- `src/app/api/cron/` - Scheduled job endpoints

### 2. CI Pipeline (Pull Request Gate)

**Location:** `.github/workflows/tenant-safety.yml`

**What it does:** Runs comprehensive tenant safety checks on every PR and push to main/develop.

**Jobs:**
1. **api-route-check** - Validates all API routes use `requireAuthorizedTenant()`
2. **schema-validation** - Validates all tenant-owned models have proper `tenantId` fields and indexes
3. **enforcement-summary** - Generates a summary report

**When it runs:**
- Every pull request to main or develop
- Every push to main or develop
- Manual workflow dispatch for ad-hoc audits

**How to view results:**
- Check the "Actions" tab in GitHub
- PR checks must pass before merge
- Failed checks show which files violate the contract

### 3. Manual Audit (Development & CI)

**NPM Scripts:**

```bash
# Check API route authorization compliance
npm run tenant:check-auth

# Check schema tenant isolation compliance
npm run tenant:check-schema

# Run both checks
npm run tenant:audit
```

**Check with fix suggestions:**
```bash
npm run tenant:check-auth -- --fix
```

## Baseline Status (2026-08-23)

### API Routes
- **Total routes:** 684
- **Exempt:** 18 (public/webhooks/auth/health)
- **✅ Compliant:** 126 (18%)
- **❌ Violations:** 540 (82%)

### Schema Models
- **Total models checked:** 12
- **✅ Compliant:** 0 (0%)
- **❌ Violations:** 12 (100%)

**Target:** 100% compliance for both checks

## Fixing Violations

### API Route Violations

**Non-compliant pattern (WRONG):**
```typescript
export async function GET(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id');
  if (!tenantId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }
  // ... rest of handler
}
```

**Compliant pattern (CORRECT):**
```typescript
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({headers: req.headers, nextUrl: req.nextUrl});
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  
  // ... rest of handler with proper tenantId
}
```

**For POST/PUT/PATCH handlers, also strip tenant fields from request body:**
```typescript
export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({headers: req.headers, nextUrl: req.nextUrl});
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;
  
  const bodyRaw = await req.json();
  const body = {
    ...stripTenantOwnershipFields(bodyRaw),
    tenantId, // Server-controlled, never from request body
  };
  
  // ... create resource with body
}
```

### Schema Violations

**Models missing tenantId:**
```prisma
model WorkOrder {
  id        String   @id @default(cuid())
  // ... other fields
  
  // ADD:
  tenantId  String   @db.Uuid()
  
  @@index([tenantId])
}
```

**Models missing index:**
```prisma
model RentalCustomer {
  id        String   @id @default(cuid())
  tenantId  String   @db.Uuid()
  
  // ADD:
  @@index([tenantId])
}
```

**Create migration for NOT NULL constraint:**
```bash
# Create a new migration
npx prisma migrate dev --name add_tenant_id_to_work_orders

# In the generated migration SQL, ensure:
ALTER TABLE work_orders ADD COLUMN tenant_id UUID NOT NULL DEFAULT 'default-tenant-id';
CREATE INDEX idx_work_orders_tenant_id ON work_orders(tenant_id);
```

## Exemption Process

If a route legitimately cannot use `requireAuthorizedTenant()`:

1. **Identify the reason:**
   - Public API (no authentication required)
   - Webhook (external authentication method)
   - Auth endpoint (bootstrapping authentication)
   - Health check (monitoring, no tenant context)

2. **Move to exempt directory:**
   ```bash
   # Example: moving a public tracking endpoint
   mv src/app/api/tracking/route.ts src/app/api/public/tracking/route.ts
   ```

3. **Document in this file:**
   - Add to the exemption list above
   - Explain why the exemption is necessary
   - Describe alternative security measures

4. **Use appropriate alternative:**
   - For webhooks: Use `withWebhookTenant()` from `@/lib/rls`
   - For public APIs: Use rate limiting and validate inputs carefully
   - For auth: Bootstrap tenant context after authentication succeeds

## Troubleshooting

### Pre-commit hook not running

**Cause:** Hook file may not be executable (Unix systems)

**Fix:**
```bash
chmod +x .git/hooks/pre-commit
```

### False positives in checker

**Cause:** Complex route structure confuses regex-based detection

**Fix:**
1. Ensure `requireAuthorizedTenant` import is on its own line
2. Ensure handler function declarations are standard format
3. If still failing, report to team for script improvement

### CI workflow not triggering

**Cause:** Workflow file may not be in main branch yet

**Fix:**
```bash
# Ensure workflow is committed and pushed
git add .github/workflows/tenant-safety.yml
git commit -m "ci: add tenant safety enforcement"
git push
```

## Maintenance

### Adding new exempt patterns

Edit `scripts/check-tenant-auth.js`:

```javascript
const EXEMPT_PATTERNS = [
  /^src\/app\/api\/public\//,
  /^src\/app\/api\/webhooks\//,
  /^src\/app\/api\/auth\//,
  /^src\/app\/api\/health/,
  /^src\/app\/api\/cron\//,
  // ADD NEW PATTERN HERE
];
```

### Updating model checklist

Edit `scripts/validate-tenant-schema.js`:

```javascript
const TENANT_OWNED_MODELS = [
  'RentalCustomer',
  'RentalBooking',
  // ADD NEW MODEL NAME HERE
];
```

## Success Metrics

**Goal:** 100% compliance rate

**Current Progress:**
- API Routes: 126/666 compliant (18%)
- Schema Models: 0/12 compliant (0%)

**Track progress:**
```bash
# Run audit regularly
npm run tenant:audit

# Compare against baseline in this document
```

## Related Documentation

- [TENANT_SAFETY_CONTRACT.md](./TENANT_SAFETY_CONTRACT.md) - The contract itself
- [src/lib/tenant-context.ts](../src/lib/tenant-context.ts) - Implementation of `requireAuthorizedTenant()`
- [src/lib/rls.ts](../src/lib/rls.ts) - RLS helpers (`withTenantRls`, `withWebhookTenant`)
- [.claude/plan.md](../.claude/plan.md) - Implementation plan for enforcement

## Questions?

If you encounter issues or have questions about tenant safety enforcement:

1. Check this document first
2. Review [TENANT_SAFETY_CONTRACT.md](./TENANT_SAFETY_CONTRACT.md)
3. Run `npm run tenant:check-auth -- --fix` for pattern examples
4. Ask the team in #security or #architecture channels
