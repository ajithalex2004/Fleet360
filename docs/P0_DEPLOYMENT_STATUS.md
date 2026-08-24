# P0 Critical Security Migrations - Current Status

**Date:** 2026-08-24  
**Status:** ⚠️ DEPLOYMENT IN PROGRESS - FAILED ON ASSET TABLES  
**Issue:** Schema mismatch - migration doesn't match actual database structure

## Current Deployment Status

### ✅ Successfully Applied (3 migrations)
1. `20260901000000_p0_baseline_audit_logs` - ✅ Applied
2. `20260901000001_p0_audit_logs_rls` - ✅ Applied
3. `20260902000000_p0_baseline_asset_tables` - ❌ **FAILED**

### ❌ Failed Migration Details

**Migration:** `20260902000000_p0_baseline_asset_tables`  
**Error:** `column "registry_id" does not exist`  
**Table:** `stock_transactions`  
**Issue:** The migration references `registry_id` but the actual database table has a different structure

### ⏳ Not Yet Applied (3 migrations)
4. `20260902000001_p0_asset_tables_rls` - Blocked by failed migration
5. `20260903000000_p0_baseline_spm_tables` - Blocked by failed migration
6. `20260903000001_p0_spm_tables_rls` - Blocked by failed migration

## Root Cause

The asset tables are created at runtime by `src/lib/assets/schema.ts`, and the actual database structure doesn't perfectly match what we captured in the migration. Specifically:

- The migration file was created based on reading `src/lib/assets/schema.ts`
- However, there may be differences between what the code creates and what's actually in the database
- The error indicates `stock_transactions` table exists but with different columns

## Immediate Next Steps

### When Database Connection is Stable:

#### Step 1: Mark Failed Migration as Rolled Back
```bash
npx prisma migrate resolve --rolled-back 20260902000000_p0_baseline_asset_tables
```

#### Step 2: Inspect Actual Database Schema
```sql
-- Get actual structure of stock_transactions
SELECT 
  column_name, 
  data_type, 
  is_nullable,
  column_default
FROM information_schema.columns 
WHERE table_name = 'stock_transactions' 
ORDER BY ordinal_position;

-- Check all asset-related tables
SELECT tablename 
FROM pg_tables 
WHERE schemaname = 'public' 
  AND (tablename LIKE '%asset%' 
    OR tablename LIKE '%ble%' 
    OR tablename LIKE '%medical%'
    OR tablename LIKE '%dispatch%'
    OR tablename LIKE '%personnel%')
ORDER BY tablename;
```

#### Step 3: Fix Migration to Match Actual Schema

We need to read the actual database schema and update the migration file to use `CREATE TABLE IF NOT EXISTS` with the exact structure that exists, or use `ALTER TABLE ADD COLUMN IF NOT EXISTS` for any missing columns.

#### Step 4: Alternative Approach - Skip Baseline, Go Straight to RLS

Since the tables already exist (created by runtime DDL), we could:
1. Skip the baseline migration entirely
2. Create a simpler migration that just adds RLS policies to existing tables
3. Assume the tables already have the correct structure

## Alternative Solution: Direct RLS Application

Create a new simplified migration that:
- Assumes all 12 asset tables already exist
- Just ensures `tenant_id` is NOT NULL
- Applies RLS policies directly

This would look like:

```sql
-- Ensure tenant_id exists and is NOT NULL on all tables
DO $$
DECLARE
  tables TEXT[] := ARRAY['asset_registry', 'hva_assets', ...];
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    -- Add tenant_id if missing
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS tenant_id TEXT NOT NULL DEFAULT ''default''', tbl);
    
    -- Set NOT NULL
    EXECUTE format('ALTER TABLE %I ALTER COLUMN tenant_id SET NOT NULL', tbl);
  END LOOP;
END $$;

-- Then apply RLS policies...
```

## Current Security Status

### ✅ PROTECTED (2 tables)
- `audit_logs` - Has RLS policies ✅
  - Tenant isolation enabled
  - Immutable (no UPDATE/DELETE)
  - Super admin can see all tenants

### ❌ STILL VULNERABLE (18 tables)
- 12 asset tables - NO RLS yet
- 6 SPM tables - NO RLS yet

**Risk:** Cross-tenant data access still possible on 18 tables

## Recommended Action Plan

### Option A: Fix and Retry (Recommended)
1. Wait for stable database connection
2. Inspect actual schema of all 12 asset tables
3. Rewrite baseline migration to match exactly
4. Mark failed migration as rolled back
5. Deploy corrected migration

### Option B: Skip Baseline (Faster)
1. Delete the baseline asset migration
2. Create simplified RLS-only migration
3. Assume tables exist with tenant_id
4. Apply RLS policies directly

### Option C: Manual Application
1. Connect to database directly
2. Apply RLS policies manually via SQL
3. Mark migrations as applied manually
4. Document what was done

## Files That Need Updates

### If Going with Option A (Fix and Retry):
- `prisma/migrations/20260902000000_p0_baseline_asset_tables/migration.sql` - Needs rewrite to match actual schema

### If Going with Option B (Skip Baseline):
- Delete: `prisma/migrations/20260902000000_p0_baseline_asset_tables/`
- Rename: `20260902000001_p0_asset_tables_rls` to `20260902000000_p0_asset_tables_rls`
- Update RLS migration to add tenant_id if missing

## Key Learnings

1. **Runtime DDL is dangerous** - The actual database structure diverged from the code
2. **Always inspect before migrating** - Should have queried actual schema first
3. **Migrations need to be idempotent** - Should handle already-existing tables gracefully
4. **Schema drift is real** - Runtime-created tables may not match latest code

## Next Session TODO

When you return to this:

1. Check database connection: `npx prisma db execute --stdin <<< "SELECT 1;"`
2. If connected, run inspection queries above
3. Decide on Option A, B, or C based on findings
4. Execute chosen approach
5. Verify all 19 tables have RLS enabled
6. Run `npm run tenant:check-rls -- --strict` to verify fixes

## Contact Info

If you need help during deployment:
- Check: `docs/P0_DEPLOYMENT_GUIDE.md` for full deployment procedures
- Check: `docs/P0_CRITICAL_MIGRATIONS_SUMMARY.md` for migration details
- Check: This file for current status

---

**Last Updated:** 2026-08-24  
**Next Action:** Wait for stable database connection, then inspect actual schema  
**Critical:** 18 tables still vulnerable to cross-tenant access
