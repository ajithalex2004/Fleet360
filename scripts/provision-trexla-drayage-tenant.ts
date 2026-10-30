/**
 * scripts/provision-trexla-drayage-tenant.ts
 *
 * Provisions "Trexla Logistics" (TRX-LOG-001) as a standalone
 * Port & Container Drayage System tenant with:
 *   1. Tenant record (ENTERPRISE plan, UAE TRN, domain verified)
 *   2. Standalone Drayage module set (`drayage`, `fleet`, `driver-mgmt`,
 *      `finance`, `compliance`, `maintenance`, `customer-mgmt`,
 *      `mobile-apps`, `service-tickets`, `admin`) — `logistics` kept OFF
 *      so Sidebar isolates `/logistics/drayage/*`.
 *   3. Feature flags enabled for Driver PWA, DVIR, Fuel, Salik, VAT.
 *   4. Tenant Admin (`admin@trexla-logistics.ae` / `Trexla@2026!`) and
 *      Drayage Driver (`driver@trexla-logistics.ae` / `Trexla@2026!`).
 *   5. Full Port & Container Drayage operational workspace seed.
 */

import * as crypto from 'crypto';

// Bypass Next.js server-only guard for standalone CLI execution
(require.cache as Record<string, unknown>)[require.resolve('server-only')] = {
  id: 'server-only',
  filename: 'server-only',
  loaded: true,
  exports: {},
};

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

async function detectUserTableName(prisma: any): Promise<string> {
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN ('User', 'users')
     LIMIT 1`
  )) as Array<{ table_name: string }>;
  return rows[0]?.table_name === 'users' ? 'users' : '"User"';
}

async function main() {
  console.log('=== PROVISIONING TENANT: TREXLA LOGISTICS (Standalone Port & Container Drayage) ===\n');

  const { prisma } = await import('../src/lib/prisma');
  const { withPlatformAdmin, withTenantRls } = await import('../src/lib/rls');
  const { defaultFeatureFlags } = await import('../src/lib/module-features');
  const { writeTenantFeatureFlags } = await import('../src/lib/tenant-features');
  const { canOpenModule } = await import('../src/lib/nav/module-visibility');
  const { systemRolePermissions } = await import('../src/lib/authz/session-permissions');
  const {
    ensureDrayageSchema,
    getDrayageWorkspaceData,
    calculateMissingAllowances,
  } = await import('../src/lib/logistics/drayage-domain');

  const TENANT_CODE = 'TRX-LOG-001';
  const TENANT_NAME = 'Trexla Logistics';
  const TENANT_DOMAIN = 'trexla-logistics.ae';
  const ADMIN_EMAIL = 'admin@trexla-logistics.ae';
  const DRIVER_EMAIL = 'driver@trexla-logistics.ae';
  const DEFAULT_PASSWORD = 'Trexla@2026!';

  // Standalone Port & Container Drayage modules (explicitly excludes 'logistics' so Sidebar isolates '/logistics/drayage/*')
  const STANDALONE_DRAYAGE_MODULES = [
    'drayage',
    'fleet',
    'driver-mgmt',
    'finance',
    'compliance',
    'maintenance',
    'customer-mgmt',
    'mobile-apps',
    'service-tickets',
    'admin',
  ];

  const userTable = await detectUserTableName(prisma);
  const passwordHash = hashPassword(DEFAULT_PASSWORD);

  const provisioned = await withPlatformAdmin(prisma, async (tx) => {
    // 1. Upsert Tenant "Trexla Logistics"
    let tenant = await tx.tenant.findFirst({
      where: {
        OR: [{ code: TENANT_CODE }, { domain: TENANT_DOMAIN }, { name: TENANT_NAME }],
      },
    });

    if (!tenant) {
      tenant = await tx.tenant.create({
        data: {
          id: crypto.randomUUID(),
          name: TENANT_NAME,
          code: TENANT_CODE,
          domain: TENANT_DOMAIN,
          plan: 'ENTERPRISE',
          industry: 'PORT_DRAYAGE_LOGISTICS',
          address: 'Plot S-412, Jebel Ali Free Zone (JAFZA South), Dubai, UAE',
          contactName: 'Capt. Tariq Al-Mansoori',
          contactEmail: ADMIN_EMAIL,
          contactPhone: '+971 4 881 9400',
          defaultLanguage: 'en',
          supportedLanguages: 'en,ar',
          isActive: true,
          dataResidency: 'GLOBAL',
        },
      });
      console.log(`1. Created Tenant: ${tenant.name} (ID: ${tenant.id}, Code: ${tenant.code})`);
    } else {
      tenant = await tx.tenant.update({
        where: { id: tenant.id },
        data: {
          name: TENANT_NAME,
          code: TENANT_CODE,
          domain: TENANT_DOMAIN,
          plan: 'ENTERPRISE',
          industry: 'PORT_DRAYAGE_LOGISTICS',
          address: 'Plot S-412, Jebel Ali Free Zone (JAFZA South), Dubai, UAE',
          contactName: 'Capt. Tariq Al-Mansoori',
          contactEmail: ADMIN_EMAIL,
          contactPhone: '+971 4 881 9400',
          isActive: true,
        },
      });
      console.log(`1. Updated Existing Tenant: ${tenant.name} (ID: ${tenant.id}, Code: ${tenant.code})`);
    }

    // Set TRN & mark domain verified if columns exist
    await tx.$executeRawUnsafe(
      `UPDATE tenants SET trn = '100492817400003', domain_verified_at = NOW(), domain_verification_method = 'ADMIN_PROVISIONED' WHERE id = $1`,
      tenant.id,
    ).catch(() => {});

    // 2. Replace TenantModules with the exact Standalone Drayage module set
    await tx.tenantModule.deleteMany({ where: { tenantId: tenant.id } });
    await tx.tenantModule.createMany({
      data: STANDALONE_DRAYAGE_MODULES.map((module) => ({
        id: crypto.randomUUID(),
        tenantId: tenant.id,
        module,
        isEnabled: true,
      })),
      skipDuplicates: true,
    });
    console.log(`2. Enabled Standalone Drayage Modules (${STANDALONE_DRAYAGE_MODULES.length}): ${STANDALONE_DRAYAGE_MODULES.join(', ')}`);

    // 3. Configure Feature Flags
    const flags = {
      ...defaultFeatureFlags(),
      'mobile-apps.driver-app': true,
      'mobile-apps.offline-mode': true,
      'driver-mgmt.dvir': true,
      'driver-mgmt.performance-scoring': true,
      'fleet.fuel-management': true,
      'fleet.traffic-fines': true,
      'fleet.tco-analysis': true,
      'compliance.expiry-alerts': true,
      'compliance.salik': true,
      'finance.vat-compliance': true,
      'finance.dunning': true,
      'maintenance.preventive-plans': true,
      'maintenance.quotations': true,
      'service-tickets.sla-tracking': true,
    };
    await writeTenantFeatureFlags(tx, tenant.id, flags);
    console.log('3. Configured Tenant Feature Flags (Driver PWA, DVIR, Fuel, Salik, UAE 5% VAT).');

    // 4. Upsert TENANT_ADMIN & DRIVER Roles for Trexla Logistics
    let adminRole = await tx.role.findFirst({
      where: { tenantId: tenant.id, code: 'TENANT_ADMIN' },
    });
    if (!adminRole) {
      adminRole = await tx.role.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: tenant.id,
          name: 'Tenant Admin',
          code: 'TENANT_ADMIN',
          isSystem: false,
          description: 'Full administrative access for Trexla Logistics Port & Container Drayage',
        },
      });
    }

    let driverRole = await tx.role.findFirst({
      where: { tenantId: tenant.id, code: 'DRIVER' },
    });
    if (!driverRole) {
      driverRole = await tx.role.create({
        data: {
          id: crypto.randomUUID(),
          tenantId: tenant.id,
          name: 'Heavy Truck Driver',
          code: 'DRIVER',
          isSystem: false,
          description: 'Port & Container Drayage Prime Mover Driver',
        },
      });
    }

    // Attach permissions for Drayage, Logistics, Fleet, Driver-Mgmt, Finance, Compliance, Maintenance
    const allPerms = await tx.permission.findMany({
      where: {
        module: {
          in: [
            'drayage',
            'logistics',
            'fleet',
            'driver-mgmt',
            'finance',
            'compliance',
            'maintenance',
            'customer-mgmt',
            'service-tickets',
            'admin',
          ],
        },
      },
    });
    if (allPerms.length > 0) {
      await tx.rolePermission.createMany({
        data: allPerms.map((p) => ({
          roleId: adminRole.id,
          permissionId: p.id,
        })),
        skipDuplicates: true,
      });
    }

    // 5. Upsert Tenant Admin User (`admin@trexla-logistics.ae`)
    let adminUser = await tx.user.findUnique({ where: { email: ADMIN_EMAIL } });
    if (!adminUser) {
      adminUser = await tx.user.create({
        data: {
          id: crypto.randomUUID(),
          username: ADMIN_EMAIL,
          email: ADMIN_EMAIL,
          firstName: 'Tariq',
          lastName: 'Al-Mansoori',
          isActive: true,
          updatedAt: new Date(),
        },
      });
    }
    await tx.$executeRawUnsafe(
      `UPDATE ${userTable} SET password_hash = $1 WHERE id = $2`,
      passwordHash,
      adminUser.id,
    );

    const existingAdminUt = await tx.userTenant.findFirst({
      where: { userId: adminUser.id, tenantId: tenant.id },
    });
    if (!existingAdminUt) {
      await tx.userTenant.create({
        data: {
          id: crypto.randomUUID(),
          userId: adminUser.id,
          tenantId: tenant.id,
          roleId: adminRole.id,
          isActive: true,
        },
      });
    }

    // 6. Upsert Drayage Driver User (`driver@trexla-logistics.ae`)
    let driverUser = await tx.user.findUnique({ where: { email: DRIVER_EMAIL } });
    if (!driverUser) {
      driverUser = await tx.user.create({
        data: {
          id: crypto.randomUUID(),
          username: DRIVER_EMAIL,
          email: DRIVER_EMAIL,
          firstName: 'Rashid',
          lastName: 'Al-Marri',
          isActive: true,
          updatedAt: new Date(),
        },
      });
    }
    await tx.$executeRawUnsafe(
      `UPDATE ${userTable} SET password_hash = $1 WHERE id = $2`,
      passwordHash,
      driverUser.id,
    );

    const existingDriverUt = await tx.userTenant.findFirst({
      where: { userId: driverUser.id, tenantId: tenant.id },
    });
    if (!existingDriverUt) {
      await tx.userTenant.create({
        data: {
          id: crypto.randomUUID(),
          userId: driverUser.id,
          tenantId: tenant.id,
          roleId: driverRole.id,
          isActive: true,
        },
      });
    }

    return { tenant, adminUser, driverUser };
  });

  // 7. Seed Drayage Operational Data (Terminals, Warehouses, Trailers, Containers, Jobs, Geofences, Allowances)
  console.log('\n4. Bootstrapping Port & Container Drayage Operational Workspace for Trexla Logistics...');
  await ensureDrayageSchema(prisma);
  const workspace = await withTenantRls(prisma, provisioned.tenant.id, async (tx) => {
    const ws = await getDrayageWorkspaceData(tx, provisioned.tenant.id);
    await calculateMissingAllowances(tx, provisioned.tenant.id);
    return getDrayageWorkspaceData(tx, provisioned.tenant.id);
  });

  console.log(`   - Port Terminals Seeded    : ${workspace.terminals.length}`);
  console.log(`   - Consignee Warehouses     : ${workspace.warehouses.length}`);
  console.log(`   - Skeletal Trailers        : ${workspace.trailers.length}`);
  console.log(`   - Tracked Containers       : ${workspace.containers.length}`);
  console.log(`   - Drayage Jobs (L1/L2/EXP) : ${workspace.jobs.length}`);
  console.log(`   - Driver Allowance Ledger  : ${workspace.allowances.length}`);

  // 8. Verify Sidebar & Module Visibility Rules for Trexla Logistics
  const adminPerms = systemRolePermissions('TENANT_ADMIN');
  const viewer = {
    roleCode: 'TENANT_ADMIN',
    enabledModules: STANDALONE_DRAYAGE_MODULES,
    permissions: adminPerms,
  };

  const drayageVisible = canOpenModule('drayage', viewer);
  const fleetVisible = canOpenModule('fleet', viewer);
  const rentalVisible = canOpenModule('rental', viewer);
  const schoolBusVisible = canOpenModule('school-bus', viewer);
  const busOpsVisible = canOpenModule('bus-ops', viewer);

  if (!drayageVisible || !fleetVisible || rentalVisible || schoolBusVisible || busOpsVisible) {
    throw new Error(
      `Unexpected module visibility: drayage=${drayageVisible}, fleet=${fleetVisible}, rental=${rentalVisible}, schoolBus=${schoolBusVisible}, busOps=${busOpsVisible}`
    );
  }
  console.log('\n5. [PASS] Verified Standalone Navigation Isolation: Drayage & Fleet are visible; RAC, School Bus, and Bus Ops are hidden.');
  console.log('\n====================================================================');
  console.log('TREXLA LOGISTICS TENANT READY');
  console.log('====================================================================');
  console.log(`Tenant Name      : ${provisioned.tenant.name}`);
  console.log(`Tenant Code      : ${provisioned.tenant.code}`);
  console.log(`Tenant ID        : ${provisioned.tenant.id}`);
  console.log(`Company Domain   : ${provisioned.tenant.domain}`);
  console.log(`Admin Login      : ${ADMIN_EMAIL}  | Password: ${DEFAULT_PASSWORD}`);
  console.log(`Driver PWA Login : ${DRIVER_EMAIL} | Password: ${DEFAULT_PASSWORD}`);
  console.log('====================================================================');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[FAIL]', err);
    process.exit(1);
  });
