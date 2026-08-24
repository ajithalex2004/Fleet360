# P0: Schema Tenant Isolation Fix

## Status: CRITICAL - CI Check Failing

The Schema Tenant Isolation Check is **failing** on PR #43, blocking full tenant safety enforcement.

## Root Cause

The validation script checks if tenant isolation migrations exist in the migration files. Several migrations have been created but **not applied to the database**:

### Unapplied Migrations (from `prisma migrate status`):
1. `20260816000000_route_consolidation_phase2_schema`
2. `20260821000000_vehicle_route_zone_tagging`
3. `20260821140000_rls_with_check_cmd_guard`
4. `20260824000000_add_tenant_constraints_and_indexes`

### Affected Tables (12 violations):

**Rental tables** (handled by `20260815140000_tenant_001_leasing_rental_isolation`):
- RentalCustomer ❌ Missing NOT NULL constraint
- RentalBooking ❌ Missing NOT NULL constraint  
- RentalAgreement ❌ Missing NOT NULL constraint
- RentalInvoice ❌ Missing NOT NULL constraint
- RentalPayment ❌ Missing NOT NULL constraint
- RentalAncillary ❌ Missing NOT NULL + index

**Fleet tables** (handled by `20260623140000_add_tenant_id_to_fleet_tables`):
- Vehicle ❌ Missing NOT NULL constraint
- Driver ❌ Missing NOT NULL constraint
- MaintenanceRequest ❌ Missing NOT NULL constraint

**Missing migrations**:
- Customer ❌ Missing NOT NULL + index
- TripPassenger ❌ Missing NOT NULL + index
- WorkOrder ❌ Missing NOT NULL + index

## Why This is P0

**Security Risk:**
- Without NOT NULL constraints, rows can be inserted without `tenant_id`
- Such rows would be visible to ALL tenants (data leakage)
- The application-level checks in API routes are NOT sufficient
- Database-level enforcement is required for defense-in-depth

**CI Pipeline Blocked:**
- Schema validation will fail on every PR
- Cannot enforce tenant safety contract if CI is broken
- Team cannot merge PRs until this is fixed

## Solution Options

### Option 1: Apply All Pending Migrations (RECOMMENDED)

**Pros:**
- Proper migration flow
- Maintains migration history
- Safe and reversible

**Cons:**
- Requires database access
- May have conflicts with existing data
- Need to coordinate with team

**Steps:**
```bash
# Review what will be applied
npx prisma migrate status

# Apply in development
npx prisma migrate dev

# OR apply in production
npx prisma migrate deploy
```

### Option 2: Apply Only Tenant Isolation Migrations

Cherry-pick and apply specific migrations:

```bash
# Run the fleet tables migration
psql $DATABASE_URL -f prisma/migrations/20260623140000_add_tenant_id_to_fleet_tables/migration.sql

# Run the rental tables migration  
psql $DATABASE_URL -f prisma/migrations/20260815140000_tenant_001_leasing_rental_isolation/migration.sql

# Run the new missing tables migration
psql $DATABASE_URL -f prisma/migrations/20260824000000_add_tenant_constraints_and_indexes/migration.sql
```

### Option 3: Use `prisma db push` (RISKY)

**Pros:**
- Bypasses migrations
- Quick fix

**Cons:**
- Loses migration history
- Can cause schema drift
- Not recommended for production

```bash
npx prisma db push --skip-generate
```

### Option 4: Temporarily Disable Schema Check in CI

**Pros:**
- Unblocks PR merges immediately

**Cons:**
- Doesn't fix the actual problem
- Still security risk
- Should only be temporary

```yaml
# .github/workflows/tenant-safety.yml
# Comment out the schema check job temporarily
```

## Recommended Action Plan

### Immediate (Today):

1. **Get database access** - Connect to the dev/staging database
2. **Apply migrations** - Run `npx prisma migrate deploy` or manually apply SQL
3. **Verify fix** - Run `npm run tenant:check-schema` locally
4. **Push update** - Commit and push to trigger CI re-run
5. **Monitor CI** - Ensure Schema Tenant Isolation Check passes

### If Database Not Accessible:

1. **Temporarily disable schema check** in CI (Option 4)
2. **Merge PR #43** to activate API route enforcement
3. **Schedule database migration** as separate P0 task
4. **Re-enable schema check** once migrations applied

## Verification

After applying migrations, verify with:

```bash
# Check schema compliance
npm run tenant:check-schema

# Expected output:
# Total models:     12
# ✅ Compliant:      12  
# ❌ Violations:     0
```

## Owner

@ajithalex2004

## Timeline

- **Critical:** Fix within 24 hours
- **Blocker:** Prevents full tenant safety enforcement
- **Impact:** High - Security vulnerability if not fixed

## Related

- PR #43: Tenant Safety Contract Enforcement
- Migration `20260815140000_tenant_001_leasing_rental_isolation`
- Migration `20260623140000_add_tenant_id_to_fleet_tables`
- CI Workflow: `.github/workflows/tenant-safety.yml`
