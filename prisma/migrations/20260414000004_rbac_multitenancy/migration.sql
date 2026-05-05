-- RBAC Multi-Tenancy Migration

CREATE TABLE IF NOT EXISTS "tenants" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6), "name" TEXT NOT NULL, "code" TEXT,
    "plan" TEXT DEFAULT 'STANDARD', "industry" TEXT,
    "contact_name" TEXT, "contact_email" TEXT, "contact_phone" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_code_key" ON "tenants"("code");

CREATE TABLE IF NOT EXISTS "tenant_modules" (
    "id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "module" TEXT NOT NULL,
    "is_enabled" BOOLEAN DEFAULT true,
    CONSTRAINT "tenant_modules_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "tenant_modules_tenant_module_key" ON "tenant_modules"("tenant_id", "module");
ALTER TABLE "tenant_modules" DROP CONSTRAINT IF EXISTS "tm_tenant_fk";
ALTER TABLE "tenant_modules" ADD CONSTRAINT "tm_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "roles" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "tenant_id" TEXT, "name" TEXT NOT NULL, "code" TEXT NOT NULL,
    "description" TEXT, "is_system" BOOLEAN DEFAULT false,
    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "roles_tenant_code_key" ON "roles"("tenant_id", "code");
ALTER TABLE "roles" DROP CONSTRAINT IF EXISTS "roles_tenant_fk";
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "permissions" (
    "id" TEXT NOT NULL, "module" TEXT NOT NULL, "action" TEXT NOT NULL,
    "resource" TEXT DEFAULT '*', "label" TEXT, "description" TEXT,
    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "permissions_module_action_resource_key" ON "permissions"("module", "action", "resource");

CREATE TABLE IF NOT EXISTS "role_permissions" (
    "id" TEXT NOT NULL, "role_id" TEXT NOT NULL, "permission_id" TEXT NOT NULL,
    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "role_permissions_role_perm_key" ON "role_permissions"("role_id", "permission_id");
ALTER TABLE "role_permissions" DROP CONSTRAINT IF EXISTS "rp_role_fk";
ALTER TABLE "role_permissions" ADD CONSTRAINT "rp_role_fk" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE;
ALTER TABLE "role_permissions" DROP CONSTRAINT IF EXISTS "rp_perm_fk";
ALTER TABLE "role_permissions" ADD CONSTRAINT "rp_perm_fk" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "user_tenants" (
    "id" TEXT NOT NULL, "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "user_id" TEXT NOT NULL, "tenant_id" TEXT NOT NULL, "role_id" TEXT NOT NULL,
    "is_active" BOOLEAN DEFAULT true,
    CONSTRAINT "user_tenants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_tenants_user_tenant_key" ON "user_tenants"("user_id", "tenant_id");
ALTER TABLE "user_tenants" DROP CONSTRAINT IF EXISTS "ut_tenant_fk";
ALTER TABLE "user_tenants" ADD CONSTRAINT "ut_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;
ALTER TABLE "user_tenants" DROP CONSTRAINT IF EXISTS "ut_role_fk";
ALTER TABLE "user_tenants" ADD CONSTRAINT "ut_role_fk" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT;
