# Fleet360: Retire Runtime DDL - Implementation Plan

## Executive Summary

**Priority:** P1 Platform Architecture Fix  
**Goal:** Eliminate all runtime schema creation and move to migration-only schema management  
**Target:** Zero DDL in application code; all schema changes via versioned migrations

## Current State Assessment

### Runtime DDL Patterns Found

1. **TypeScript/Next.js Routes**
   - 250+ files matched DDL patterns (mostly false positives from comments/strings)
   - Need detailed audit to identify actual runtime DDL

2. **Go Backend (GORM)**
   - `AutoMigrate()` calls in production
   - Runtime `ensure*Schema()` functions
   - Need inventory of Go models using AutoMigrate

3. **Prisma Migrations**
   - ✅ Already using versioned migrations
   - Some migrations use `CREATE TABLE IF NOT EXISTS` (should be removed)
   - Missing tenant isolation on many tables

## Target Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Application Code                      │
│              (Next.js API routes + Go)                   │
│                                                           │
│  ✅ Assumes schema already exists                        │
│  ❌ Zero DDL (no CREATE/ALTER/DROP)                      │
│  ✅ Can verify expected schema version                   │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                  Deployment Pipeline                     │
│                                                           │
│  1. Run Prisma migrations (npx prisma migrate deploy)    │
│  2. Run custom SQL migrations (for RLS/triggers/etc)     │
│  3. Verify migration success                             │
│  4. Deploy application code                              │
└─────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────┐
│                       Database                           │
│                                                           │
│  ✅ Schema version is known and auditable                │
│  ✅ All changes have migration history                   │
│  ✅ Rollback capability via down migrations              │
└─────────────────────────────────────────────────────────┘
```

## Migration Authority Hierarchy

### 1. Prisma Migrations (Primary)
**Use for:** 
- Tables, columns, data types
- Simple indexes
- Foreign keys
- NOT NULL constraints
- Unique constraints (tenant-scoped)
- Default values

**Example:**
```prisma
// prisma/migrations/20260901000000_add_vehicle_telematics/migration.sql
ALTER TABLE "vehicles" ADD COLUMN "telematics_device_id" TEXT;
ALTER TABLE "vehicles" ADD COLUMN "last_ping_at" TIMESTAMPTZ;
CREATE INDEX "idx_vehicles_telematics_device_id" ON "vehicles"("telematics_device_id");
```

### 2. Custom SQL Migrations (Advanced Features)
**Use for:**
- RLS policies (USING + WITH CHECK)
- FORCE ROW LEVEL SECURITY
- Triggers
- Functions/stored procedures
- PostGIS spatial indexes
- Partial/conditional indexes
- GiST/GIN indexes
- Check constraints with expressions
- Composite foreign keys (tenant-aware)

**Example:**
```sql
-- prisma/migrations/20260901000001_add_vehicles_rls/migration.sql
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON vehicles;
CREATE POLICY tenant_isolation ON vehicles FOR ALL
  USING (
    current_setting('app.tenant_id', true) = '*'
    OR tenant_id::text = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) = '*'
    OR tenant_id::text = current_setting('app.tenant_id', true)
  );
```

### 3. Go/GORM (Schema Consumer)
**Must:**
- ❌ Disable `AutoMigrate()` in production
- ✅ Define models matching existing schema
- ✅ Use struct tags to map to Prisma-created tables
- ✅ Verify schema compatibility at startup (read-only check)

**Example:**
```go
// Correct: Model maps to existing schema
type Vehicle struct {
    ID                  string    `gorm:"primaryKey;type:uuid"`
    TenantID            string    `gorm:"type:text;not null;index"`
    TelematicsDeviceID  *string   `gorm:"type:text;index"`
    LastPingAt          *time.Time `gorm:"type:timestamptz"`
}

// In main.go - startup check only
func VerifySchemaVersion(db *gorm.DB) error {
    var version string
    err := db.Raw("SELECT version FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 1").Scan(&version).Error
    if err != nil {
        return fmt.Errorf("cannot read migration version: %w", err)
    }
    
    requiredVersion := "20260901000001_add_vehicles_rls"
    if version < requiredVersion {
        return fmt.Errorf("database schema too old: found %s, require >= %s", version, requiredVersion)
    }
    
    return nil
}

// ❌ Never do this in production:
// db.AutoMigrate(&Vehicle{})
```

## Tenant Safety Migration Checklist

Every migration touching tenant-owned data must answer:

- [ ] **Does the table have `tenant_id TEXT NOT NULL`?**
- [ ] **Is `tenant_id` indexed?** (`CREATE INDEX idx_<table>_tenant_id`)
- [ ] **Are child foreign keys tenant-aware?** (Composite: `(parent_id, tenant_id)`)
- [ ] **Is RLS enabled?** (`ALTER TABLE <table> ENABLE ROW LEVEL SECURITY`)
- [ ] **Is FORCE RLS set?** (`ALTER TABLE <table> FORCE ROW LEVEL SECURITY`)
- [ ] **Does a USING policy exist?** (Filter reads by tenant)
- [ ] **Does a WITH CHECK policy exist?** (Filter writes by tenant)
- [ ] **Are unique constraints tenant-scoped?** (`UNIQUE (tenant_id, business_key)`)
- [ ] **Are there composite unique indexes for parent tables?** (`UNIQUE (id, tenant_id)`)

### Standard Tenant Migration Template

```sql
-- Template: Add tenant isolation to existing table
-- Usage: Replace <table>, <parent_table>, <parent_id> placeholders

-- 1. Add tenant_id column
ALTER TABLE <table> ADD COLUMN IF NOT EXISTS tenant_id TEXT;

-- 2. Backfill from parent (if child table)
UPDATE <table> c
SET tenant_id = p.tenant_id
FROM <parent_table> p
WHERE c.<parent_id> = p.id AND c.tenant_id IS NULL;

-- 3. Backfill orphans to default tenant (if root table)
DO $$
DECLARE
  default_tenant TEXT;
BEGIN
  SELECT id INTO default_tenant FROM tenants ORDER BY created_at LIMIT 1;
  UPDATE <table> SET tenant_id = default_tenant WHERE tenant_id IS NULL;
END $$;

-- 4. Assert no NULL tenant_id remains
DO $$
DECLARE n bigint;
BEGIN
  SELECT COUNT(*) INTO n FROM <table> WHERE tenant_id IS NULL;
  IF n > 0 THEN
    RAISE EXCEPTION '<table>: % rows still have NULL tenant_id', n;
  END IF;
END $$;

-- 5. Set NOT NULL
ALTER TABLE <table> ALTER COLUMN tenant_id SET NOT NULL;

-- 6. Create index
CREATE INDEX IF NOT EXISTS idx_<table>_tenant_id ON <table>(tenant_id);

-- 7. Enable RLS
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <table> FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON <table>;
CREATE POLICY tenant_isolation ON <table> FOR ALL
  USING (
    current_setting('app.tenant_id', true) = '*'
    OR tenant_id::text = current_setting('app.tenant_id', true)
  )
  WITH CHECK (
    current_setting('app.tenant_id', true) = '*'
    OR tenant_id::text = current_setting('app.tenant_id', true)
  );

-- 8. Convert global unique constraints to tenant-scoped
ALTER TABLE <table> DROP CONSTRAINT IF EXISTS <table>_<business_key>_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_<table>_tenant_<business_key>
  ON <table>(tenant_id, <business_key>)
  WHERE <business_key> IS NOT NULL;

-- 9. Create composite parent unique index (if parent table)
CREATE UNIQUE INDEX IF NOT EXISTS uq_<table>_id_tenant ON <table>(id, tenant_id);

-- 10. Add composite foreign key (if child table)
ALTER TABLE <table> DROP CONSTRAINT IF EXISTS <table>_<parent_id>_fkey;
ALTER TABLE <table>
  ADD CONSTRAINT <table>_<parent>_tenant_fkey
  FOREIGN KEY (<parent_id>, tenant_id)
  REFERENCES <parent_table>(id, tenant_id);
```

## Implementation Roadmap

### Phase 0: Inventory (Week 1)
**Owner:** Platform team  
**Priority:** P0

1. **Audit TypeScript/Next.js:**
   - [ ] Grep for actual DDL execution (not just comments)
   - [ ] List all files with runtime `CREATE TABLE`, `ALTER TABLE`, etc.
   - [ ] Document what each runtime schema creates

2. **Audit Go backend:**
   - [ ] Find all `AutoMigrate()` calls
   - [ ] Find all `ensure*Schema()` functions
   - [ ] List models using GORM auto-migration
   - [ ] Document Go-owned tables

3. **Audit current schema:**
   - [ ] Export live schema from production (pg_dump --schema-only)
   - [ ] Compare with Prisma schema.prisma
   - [ ] Identify tables missing from Prisma
   - [ ] Identify tables missing tenant_id
   - [ ] Identify tables missing RLS

4. **Create tracking spreadsheet:**
   ```
   Table Name | Owned By | Has tenant_id | Has RLS | Has Prisma Model | P0/P1/P2
   -----------|----------|---------------|---------|------------------|----------
   vehicles   | Prisma   | ✅            | ❌      | ✅               | P0
   ```

### Phase 1: Baseline Migrations (Week 2-3)
**Owner:** Platform team  
**Priority:** P1

For every table currently created at runtime:

1. **Capture current schema:**
   ```bash
   # Export just this table's schema
   pg_dump --schema-only --table=<table_name> > /tmp/<table_name>_schema.sql
   ```

2. **Create baseline migration:**
   ```bash
   # Create empty migration
   npx prisma migrate dev --name baseline_<table_name> --create-only
   
   # Copy captured schema into migration
   # Edit to remove IF NOT EXISTS
   # Add tenant_id if missing (see Phase 2)
   ```

3. **Mark as applied (no-op on prod):**
   ```bash
   # In production, mark migration as already applied
   npx prisma migrate resolve --applied baseline_<table_name>
   ```

### Phase 2: Add Tenant Isolation (Week 3-5)
**Owner:** Platform team  
**Priority:** P0 for tenant-owned data, P1 for shared/system tables

For every tenant-owned table missing tenant_id:

1. **Create tenant isolation migration** using template above
2. **Test on staging with multi-tenant data**
3. **Verify RLS policies block cross-tenant access**
4. **Apply to production during maintenance window**

**Priority order:**
- P0: Rental, Leasing, Finance domain tables
- P0: Fleet, Dispatch domain tables
- P1: Bus Ops, School Bus domain tables
- P1: Assets, Ambulance domain tables
- P2: System tables (notifications, audit logs)

### Phase 3: Remove Runtime DDL (Week 5-6)
**Owner:** Full team  
**Priority:** P1

1. **TypeScript/Next.js:**
   ```typescript
   // ❌ Before (runtime DDL)
   await sql`CREATE TABLE IF NOT EXISTS custom_table (...)`
   
   // ✅ After (assume schema exists)
   // Create migration: prisma/migrations/20260915000000_add_custom_table/
   // Application code just uses the table
   const result = await prisma.customTable.findMany(...)
   ```

2. **Go backend:**
   ```go
   // ❌ Before (AutoMigrate in main.go)
   db.AutoMigrate(&Vehicle{}, &Driver{}, &Trip{})
   
   // ✅ After (verify only)
   if err := VerifySchemaVersion(db); err != nil {
       log.Fatalf("Schema version check failed: %v", err)
   }
   ```

3. **Remove ensure*Schema() functions:**
   - Delete functions
   - Add Prisma migrations for what they created
   - Update callers to assume schema exists

### Phase 4: CI/CD Enforcement (Week 6-7)
**Owner:** DevOps + Platform team  
**Priority:** P1

1. **Add CI checks (.github/workflows/schema-validation.yml):**
   ```yaml
   - name: Reject runtime DDL
     run: |
       # Fail if runtime DDL found in application code
       if grep -r "CREATE TABLE\|ALTER TABLE\|DROP TABLE\|CREATE INDEX\|AutoMigrate" \
          src/ --exclude-dir=migrations \
          | grep -v "// example\|// comment"; then
         echo "❌ Runtime DDL detected in application code"
         exit 1
       fi
   
   - name: Validate tenant safety
     run: |
       # Run tenant safety checker on new migrations
       node scripts/validate-tenant-schema.js --strict
   ```

2. **Update deployment pipeline:**
   ```yaml
   deploy:
     steps:
       - name: Run Prisma migrations
         run: npx prisma migrate deploy
       
       - name: Verify migration success
         run: |
           LATEST=$(npx prisma migrate status | grep "applied")
           if [ -z "$LATEST" ]; then
             echo "❌ Migrations failed"
             exit 1
           fi
       
       - name: Deploy application
         run: # ... deploy step
   ```

3. **Add schema version check to app startup:**
   ```typescript
   // src/lib/db/startup-check.ts
   export async function verifySchemaVersion() {
     const latest = await prisma.$queryRaw<{version: string}[]>`
       SELECT version FROM _prisma_migrations 
       ORDER BY finished_at DESC LIMIT 1
     `;
     
     const required = process.env.REQUIRED_SCHEMA_VERSION;
     if (latest[0].version < required) {
       throw new Error(
         `Database schema too old: ${latest[0].version}, require >= ${required}`
       );
     }
   }
   ```

### Phase 5: Documentation & Training (Week 7-8)
**Owner:** Platform team  
**Priority:** P2

1. **Create migration guide** (docs/MIGRATION_GUIDE.md)
2. **Update CONTRIBUTING.md** with DDL rules
3. **Add tenant safety checklist** to PR template
4. **Hold team training session** on new workflow
5. **Document rollback procedures**

## Success Criteria

- [ ] Zero runtime DDL in application code (enforced by CI)
- [ ] All tables have Prisma models or documented SQL-only migrations
- [ ] All tenant-owned tables have tenant_id + RLS
- [ ] Schema changes blocked until migrations run
- [ ] Deployment pipeline runs migrations before app deploy
- [ ] Schema version checked at application startup
- [ ] Team trained on new workflow

## Risk Mitigation

### Risk: Breaking production on migration failure
**Mitigation:**
- Test all migrations on staging with production-like data
- Use transactions in migrations where possible
- Have rollback scripts ready
- Deploy during low-traffic windows
- Keep previous app version deployable

### Risk: Forgot to add tenant_id to new table
**Mitigation:**
- CI validates all new migrations
- PR template includes tenant safety checklist
- Code review requires platform team approval for schema changes
- Linter flags `CREATE TABLE` without `tenant_id`

### Risk: Go backend gets out of sync with Prisma schema
**Mitigation:**
- Generate Go structs from Prisma schema (code generation)
- Schema version check fails startup if DB too old
- CI validates Go models match Prisma models

## Open Questions

1. **How to handle emergency schema fixes in production?**
   - Proposal: Create migration file, apply manually, commit migration to repo
   
2. **Should we support down migrations (rollback)?**
   - Proposal: Yes, but only for additive changes (add column can drop column)
   - Breaking changes (drop column) require forward-compatible deployments

3. **How to handle schema differences between dev/staging/prod?**
   - Proposal: All environments use same migration files
   - Staging must match prod schema before production deploy
   - Dev can run experimental migrations (not committed until tested)

## Next Steps

1. **Get buy-in from team leads** (review this document)
2. **Assign Phase 0 inventory task** (1 week, platform team)
3. **Review inventory results** and adjust timeline
4. **Begin Phase 1 baseline migrations** for highest-risk tables
5. **Track progress** in project management tool

## References

- [Prisma Migrations Documentation](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [PostgreSQL RLS Documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [TENANT-001 Migration](prisma/migrations/20260815140000_tenant_001_leasing_rental_isolation/migration.sql)
- [Tenant Schema Validator](scripts/validate-tenant-schema.js)

---

**Document Owner:** Platform Architecture Team  
**Last Updated:** 2026-08-24  
**Next Review:** After Phase 0 inventory complete
