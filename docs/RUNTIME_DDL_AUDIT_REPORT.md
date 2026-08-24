# Fleet360 Runtime DDL Audit Report

**Audit Date:** 2026-08-24  
**Auditor:** Platform Architecture Team  
**Scope:** All TypeScript and Go code in Fleet360 codebase

## Executive Summary

**Total Runtime DDL Files Found:** 11 TypeScript files with active runtime DDL  
**Go Backend Status:** AutoMigrate disabled ✅ (but models exist for future risk)  
**Estimated Migration Work:** 8-12 weeks for full cleanup  
**Priority:** P0 - Critical tenant isolation risk

## TypeScript Runtime DDL Inventory

### Category 1: Workflow Engine (P1)
**File:** `src/lib/workflow-db.ts`  
**Pattern:** `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`  
**Tables Created:**
- `WorkflowDefinition` (with multiple ALTER TABLE additions)
- `WorkflowStep` (with multiple ALTER TABLE additions)
- `WorkflowInstance`
- `WorkflowStepInstance`

**Tenant Safety Status:**
- ✅ Has `tenantId` column
- ❌ No RLS policies
- ❌ No tenant-scoped unique constraints
- ✅ Has tenant indexes

**Risk Level:** HIGH - tenant data created at runtime without RLS

**Code Sample:**
```typescript
// src/lib/workflow-db.ts:19
CREATE TABLE IF NOT EXISTS "WorkflowDefinition" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  ...
)

// Later additions via ALTER TABLE
ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "serviceTypeId" TEXT;
ALTER TABLE "WorkflowDefinition" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
```

**Migration Strategy:**
1. Capture current schema from production
2. Create baseline migration `20260901000000_baseline_workflow_tables`
3. Create follow-up migration `20260901000001_add_workflow_rls`
4. Remove runtime DDL from `workflow-db.ts`
5. Add startup check to verify tables exist

---

### Category 2: MFA/Authentication (P1)
**File:** `src/lib/auth-mfa-schema.ts`  
**Pattern:** `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS`  
**Tables Modified:**
- `User` (adds MFA columns)

**Columns Added:**
- `mfa_enabled` BOOLEAN NOT NULL DEFAULT FALSE
- `mfa_secret` TEXT
- `pending_mfa_secret` TEXT
- `mfa_recovery_codes` JSONB
- `mfa_enrolled_at` TIMESTAMPTZ

**Tenant Safety Status:**
- ✅ User table already has tenant isolation (UserTenant join table)
- ⚠️ MFA columns are user-level, not tenant-level

**Risk Level:** MEDIUM - modifying core auth table at runtime

**Code Sample:**
```typescript
// src/lib/auth-mfa-schema.ts:15
await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS mfa_secret TEXT`);
```

**Migration Strategy:**
1. Add MFA columns to Prisma schema.prisma
2. Create migration `20260902000000_add_mfa_columns`
3. Remove runtime DDL from `auth-mfa-schema.ts`
4. Update function to verify columns exist instead of creating them

---

### Category 3: Telemetry Settings (P1)
**File:** `src/lib/bus-ops/telemetry-settings.ts`  
**Pattern:** `CREATE TABLE IF NOT EXISTS`  
**Tables Created:**
- `bus_ops_telemetry_settings`

**Tenant Safety Status:**
- ✅ Has `tenant_id` column
- ❌ No RLS policies
- ❌ No indexes on tenant_id
- ❌ No unique constraint on (tenant_id, setting_key)

**Risk Level:** HIGH - tenant data without RLS

**Code Sample:**
```typescript
// src/lib/bus-ops/telemetry-settings.ts:43
CREATE TABLE IF NOT EXISTS bus_ops_telemetry_settings (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  api_key TEXT,
  ...
)
```

**Migration Strategy:**
1. Create migration `20260903000000_baseline_bus_ops_telemetry`
2. Create follow-up migration `20260903000001_add_telemetry_rls`
3. Add tenant-scoped unique constraint
4. Remove runtime DDL

---

### Category 4: Audit Logs (P0)
**File:** `src/lib/audit.ts`  
**Pattern:** `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`  
**Tables Created:**
- `audit_logs`

**Columns Added Later:**
- `branch_id` TEXT
- `branch_name` TEXT

**Tenant Safety Status:**
- ✅ Has `tenant_id` column
- ✅ Has indexes on tenant_id, user_id, entity_type, created_at
- ❌ No RLS policies
- ⚠️ Audit logs should be immutable (INSERT-only policy)

**Risk Level:** CRITICAL - P0
- Audit logs without RLS = tenant A can read tenant B's audit trail
- Security compliance violation

**Code Sample:**
```typescript
// src/lib/audit.ts:41
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT,
  user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT,
  ...
)

// Later additions
await prisma.$executeRawUnsafe(`ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS branch_id TEXT`);
```

**Migration Strategy:**
1. **URGENT:** Create migration `20260904000000_baseline_audit_logs`
2. **URGENT:** Create migration `20260904000001_add_audit_logs_rls` with INSERT-only policy
3. Add immutability constraints (no UPDATE/DELETE)
4. Remove runtime DDL

---

### Category 5: Tenant Branding (P2)
**File:** `src/lib/branding.ts`  
**Pattern:** `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS`  
**Tables Modified:**
- `tenants`

**Columns Added:**
- `brand_product_name` TEXT
- `brand_tagline` TEXT
- `brand_logo_url` TEXT
- `brand_favicon_url` TEXT
- `brand_primary_color` TEXT
- `brand_accent_color` TEXT

**Tenant Safety Status:**
- ✅ Tenants table is already tenant-isolated (it defines tenants)
- ⚠️ Branding columns should be in Prisma schema

**Risk Level:** LOW - but violates migration-only principle

**Code Sample:**
```typescript
// src/lib/branding.ts:17
await prisma.$executeRawUnsafe(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_product_name TEXT`);
```

**Migration Strategy:**
1. Add branding columns to Prisma schema.prisma Tenant model
2. Create migration `20260905000000_add_tenant_branding`
3. Remove runtime DDL from `branding.ts`

---

### Category 6: SSO Configuration (P1)
**File:** `src/lib/sso.ts`  
**Pattern:** `CREATE TABLE IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`  
**Tables Created:**
- `tenant_sso_configs`

**Tenant Safety Status:**
- ✅ Has `tenant_id` column
- ✅ Has partial index on `is_active`
- ❌ No RLS policies
- ❌ No tenant-scoped unique constraint

**Risk Level:** HIGH - SSO configs without RLS = security breach

**Code Sample:**
```typescript
// src/lib/sso.ts:22
CREATE TABLE IF NOT EXISTS tenant_sso_configs (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  ...
)
```

**Migration Strategy:**
1. Check if table already exists in Prisma (TenantSsoConfig model)
2. If not, create migration `20260906000000_baseline_sso_configs`
3. Create migration `20260906000001_add_sso_rls`
4. Remove runtime DDL

---

### Category 7: Billing/Stripe Integration (P1)
**File:** `src/lib/billing.ts`  
**Pattern:** `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS` + `CREATE INDEX IF NOT EXISTS`  
**Tables Modified:**
- `tenants`

**Columns Added:**
- `stripe_customer_id` TEXT
- `stripe_subscription_id` TEXT
- `subscription_status` TEXT
- `current_period_end` TIMESTAMPTZ
- `trial_ends_at` TIMESTAMPTZ
- `billing_email` TEXT

**Indexes Created:**
- `idx_tenants_stripe_customer` (partial index)
- `idx_tenants_stripe_sub` (partial index)

**Tenant Safety Status:**
- ✅ Tenants table (no cross-tenant risk)
- ⚠️ Billing columns should be in Prisma schema

**Risk Level:** MEDIUM - billing data modification at runtime

**Code Sample:**
```typescript
// src/lib/billing.ts:62
await prisma.$executeRawUnsafe(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`);
await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS idx_tenants_stripe_customer ON tenants (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL`);
```

**Migration Strategy:**
1. Add billing columns to Prisma schema.prisma Tenant model
2. Create migration `20260907000000_add_tenant_billing`
3. Remove runtime DDL from `billing.ts`

---

### Category 8: SPM (Scheduled Preventive Maintenance) (P1)
**File:** `src/lib/assets/spm-schema.ts`  
**Pattern:** `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN IF NOT EXISTS`  
**Tables Created:**
- `spm_cycles`
- `spm_tickets`
- `spm_checklist_templates`
- `spm_ticket_checks`
- `spm_audit_logs`
- `spm_notifications`

**Tenant Safety Status:**
- ✅ All tables have `tenant_id` column
- ✅ All tables have tenant_id indexes
- ❌ No RLS policies on any table
- ❌ No tenant-scoped unique constraints

**Risk Level:** HIGH - entire SPM domain without RLS

**Code Sample:**
```typescript
// src/lib/assets/spm-schema.ts:20
CREATE TABLE IF NOT EXISTS spm_cycles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  ...
)

// Later additions
ALTER TABLE spm_cycles ADD COLUMN IF NOT EXISTS assigned_to_user_id TEXT;
ALTER TABLE spm_cycles ADD COLUMN IF NOT EXISTS assigned_to_email TEXT;
```

**Migration Strategy:**
1. Capture all 6 table schemas from production
2. Create migration `20260908000000_baseline_spm_tables`
3. Create migration `20260908000001_add_spm_rls` (6 policies)
4. Add tenant-scoped unique constraints
5. Remove runtime DDL from `spm-schema.ts`

---

### Category 9: Asset Management (P1)
**File:** `src/lib/assets/schema.ts`  
**Pattern:** `CREATE TABLE IF NOT EXISTS`  
**Tables Created:**
- `asset_categories`
- `asset_registry`
- `hva_assets` (High Value Assets)
- `medical_assets`
- `medical_seal_logs`
- `ble_tags` (Bluetooth Low Energy)
- `ble_gateways`
- `asset_movements`
- `stock_transactions`
- `field_dispatch`
- `field_dispatch_items`
- `personnel_stock`

**Tenant Safety Status:**
- ✅ All tables have `tenant_id` column
- ⚠️ Some tables have indexes, some don't
- ❌ No RLS policies on any table
- ❌ No tenant-scoped unique constraints

**Risk Level:** CRITICAL - P0
- 12 tables managing tenant assets without RLS
- BLE tracking data without isolation
- Medical assets without isolation (compliance risk)

**Code Sample:**
```typescript
// src/lib/assets/schema.ts:36
CREATE TABLE IF NOT EXISTS asset_registry (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  asset_tag TEXT NOT NULL,
  category_id TEXT,
  ...
)
```

**Migration Strategy:**
1. Capture all 12 table schemas from production
2. Create migration `20260909000000_baseline_asset_tables`
3. Create migration `20260909000001_add_asset_rls` (12 policies)
4. Add tenant-scoped unique constraints (especially for asset_tag, ble_tag_mac, etc.)
5. Remove runtime DDL from `schema.ts`

---

## Go Backend Audit

### Status: AutoMigrate Disabled ✅

**File:** `backend/database/db.go`

**Current State:**
```go
// Line 51 - AutoMigrate is COMMENTED OUT
/* err = DB.AutoMigrate(
	&models.Shipment{},
	&models.ShipmentStop{},
	// ... more models
)
*/
```

**Risk Assessment:** LOW
- AutoMigrate is already disabled in production
- Go models exist but don't create schema
- Models documented as mapping to Prisma-created tables

**Go Files Referencing Schema Ownership:**
1. `backend/models/logistics.go` - Documents that Prisma owns schema
2. `backend/models/logistics_planner.go` - Notes AutoMigrate is disabled
3. `backend/models/logistics_execution.go` - References ALTER TABLE in comments (but not executed)
4. `backend/models/logistics_accessorial_catalog.go` - References CREATE TABLE in comments
5. `backend/models/dispatch.go` - Documents AutoMigrate is disabled

**Recommendation:**
- ✅ Keep AutoMigrate disabled
- ✅ Add schema version check at Go app startup
- ✅ Consider code-generating Go models from Prisma schema

---

## Summary Statistics

### Runtime DDL by Type

| DDL Type | Count | Files |
|----------|-------|-------|
| `CREATE TABLE` | 25+ tables | 4 files |
| `ALTER TABLE ADD COLUMN` | 30+ columns | 6 files |
| `CREATE INDEX` | 20+ indexes | 4 files |
| `CREATE POLICY` | 0 | 0 files |
| **TOTAL** | **75+ DDL statements** | **11 files** |

### Tenant Safety Analysis

| Category | Tables | Has tenant_id | Has RLS | Has Indexes | Risk |
|----------|--------|---------------|---------|-------------|------|
| Workflow | 4 | ✅ | ❌ | ✅ | HIGH |
| Auth/MFA | 1 (columns) | N/A | N/A | N/A | MEDIUM |
| Telemetry | 1 | ✅ | ❌ | ❌ | HIGH |
| Audit Logs | 1 | ✅ | ❌ | ✅ | **CRITICAL** |
| Branding | 1 (columns) | N/A | N/A | N/A | LOW |
| SSO | 1 | ✅ | ❌ | ✅ | HIGH |
| Billing | 1 (columns) | N/A | N/A | ✅ | MEDIUM |
| SPM | 6 | ✅ | ❌ | ✅ | HIGH |
| Assets | 12 | ✅ | ❌ | ⚠️ | **CRITICAL** |
| **TOTAL** | **27+ tables** | **21** | **0** | **~15** | **5 CRITICAL/HIGH** |

### P0 Tables (Immediate Action Required)

1. **audit_logs** - Security compliance violation
2. **asset_registry** - 12 asset tables without RLS
3. **medical_assets** - Healthcare compliance risk
4. **spm_cycles** - Maintenance tracking exposed

### Migration Work Estimate

| Phase | Tables | Migrations | Effort | Timeline |
|-------|--------|------------|--------|----------|
| Phase 1: Baseline | 27 | 9 | 2 weeks | Week 1-2 |
| Phase 2: RLS Policies | 27 | 9 | 3 weeks | Week 3-5 |
| Phase 3: Remove Runtime DDL | 11 files | N/A | 1 week | Week 6 |
| Phase 4: Testing | All | N/A | 2 weeks | Week 7-8 |
| Phase 5: Unique Constraints | 27 | 9 | 2 weeks | Week 9-10 |
| **TOTAL** | | **27 migrations** | **10 weeks** | **8-12 weeks** |

---

## Recommended Migration Order

### Week 1-2: P0 Critical Security (Immediate)
1. ✅ `audit_logs` - Security compliance
2. ✅ `asset_registry` + 11 related asset tables
3. ✅ `medical_assets` + `medical_seal_logs`

### Week 3-4: P1 High Risk (High Priority)
4. ✅ `spm_cycles` + 5 related SPM tables
5. ✅ `tenant_sso_configs`
6. ✅ `WorkflowDefinition` + 3 related workflow tables
7. ✅ `bus_ops_telemetry_settings`

### Week 5-6: P1 Medium Risk
8. ✅ MFA columns on `User` table
9. ✅ Billing columns on `tenants` table
10. ✅ Branding columns on `tenants` table

### Week 7-8: Remove Runtime DDL + Testing
11. Remove all runtime DDL from 11 TypeScript files
12. Add startup schema version checks
13. Full regression testing

### Week 9-10: Unique Constraints + Polish
14. Add tenant-scoped unique constraints to all tables
15. Performance testing
16. Documentation updates

---

## Next Steps

1. **Get stakeholder approval** for 10-week timeline
2. **Assign Phase 1 work** to platform team (Week 1-2)
3. **Create tracking board** with all 27 migrations
4. **Schedule daily standups** during critical phase
5. **Prepare rollback plans** for each migration
6. **Set up staging environment** matching production data volume
7. **Begin Phase 1: audit_logs migration** (P0)

---

## Risk Mitigation

### Deployment Strategy
- All migrations deployed during **low-traffic maintenance windows**
- **Blue-green deployment** for app code changes
- **Database snapshots** before each migration
- **Rollback scripts** prepared for each migration

### Testing Strategy
- **Staging environment** with production-like data
- **Multi-tenant test scenarios** for every table
- **Performance benchmarks** before/after RLS
- **Security audit** after RLS deployment

### Monitoring
- **RLS policy violations** logged and alerted
- **Query performance** monitored (RLS overhead)
- **Failed tenant isolation** causes instant rollback

---

**Report Status:** DRAFT  
**Next Review:** After stakeholder approval  
**Owner:** Platform Architecture Team
