/**
 * scripts/explain-hot-queries.mjs
 *
 * PostgreSQL Query Plan Diagnostic & Performance Profiler
 *
 * Connects as `fleet360_app` and executes `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`
 * on 10 hot production query patterns inside `withTenantRls`.
 *
 * Extracts and records:
 *   - planning_ms
 *   - execution_ms
 *   - plan_type
 *   - index_used
 *   - rows_actual
 *   - rows_filtered
 *   - shared_hits
 *   - shared_reads
 *
 * Outputs console breakdown and writes `staging_query_performance_baseline.json`.
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import crypto from 'crypto';
import fs from 'fs';

dotenv.config({ path: '.env.test' });
dotenv.config({ path: '.env' });

const phase0Url = process.env.DATABASE_URL || process.env.PHASE0_DATABASE_URL;

async function executeWithRetry(fn, retries = 5, delayMs = 1500) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((r) => setTimeout(r, delayMs * Math.pow(1.5, i)));
    }
  }
}

async function explainHotQueries() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('FLEET360 POSTGRESQL 10 HOT-QUERY PERFORMANCE PROFILER');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const client = new PrismaClient({
    datasourceUrl: phase0Url,
    log: [{ level: 'error', emit: 'stdout' }],
  });

  const testTenant = crypto.randomUUID();
  const baselineResults = [];

  try {
    // 1. Verify role
    const roles = await executeWithRetry(() =>
      client.$queryRawUnsafe(`
        SELECT current_user, rolcanlogin, rolbypassrls, rolsuper
        FROM pg_roles
        WHERE rolname = current_user
      `),
    );
    const role = roles[0];
    console.log(`Connected Role: ${role.current_user} (bypassrls=${role.rolbypassrls}, super=${role.rolsuper})\n`);

    const queries = [
      {
        id: 'Q1_TRIP_SCHEDULES',
        name: 'Trip Schedules (by tenant + departure order)',
        domain: 'Bus-Ops',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT id, tenant_id, trip_number, route_id, vehicle_id, driver_id, departure_time, status
              FROM public.trip_schedules
              WHERE tenant_id = '${testTenant}'
              ORDER BY departure_time ASC
              LIMIT 50;`,
      },
      {
        id: 'Q2_VEHICLES_AVAILABLE',
        name: 'Vehicles Available (by tenant + status)',
        domain: 'Rental / Fleet',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT id, tenant_id, plate_number, make, model, year, status
              FROM public.vehicles
              WHERE tenant_id = '${testTenant}' AND status = 'AVAILABLE'
              LIMIT 50;`,
      },
      {
        id: 'Q3_BUS_ROUTES_ACTIVE',
        name: 'Bus Routes Active (by tenant + is_active)',
        domain: 'Bus-Ops / School',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT id, tenant_id, code, name, origin, destination, is_active
              FROM public.bus_routes
              WHERE tenant_id = '${testTenant}' AND is_active = true
              LIMIT 50;`,
      },
      {
        id: 'Q4_LEASE_INQUIRIES',
        name: 'Lease Inquiries (by tenant + status)',
        domain: 'Commercial Leasing',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT id, tenant_id, customer_name, company_name, vehicle_type, duration_months, status
              FROM public.lease_inquiries
              WHERE tenant_id = '${testTenant}' AND status = 'PENDING'
              LIMIT 50;`,
      },
      {
        id: 'Q5_DRIVERS_ACTIVE',
        name: 'Drivers Active (by tenant + status)',
        domain: 'Workforce & Drivers',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT id, tenant_id, name, contact_number, license_number, license_expiry, status
              FROM public.drivers
              WHERE tenant_id = '${testTenant}' AND status = 'ACTIVE'
              LIMIT 50;`,
      },
      {
        id: 'Q6_MAINTENANCE_REQUESTS',
        name: 'Maintenance Requests (by tenant + status)',
        domain: 'Maintenance',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT id, tenant_id, vehicle_id, description, status, estimated_cost
              FROM public.maintenance_requests
              WHERE tenant_id = '${testTenant}' AND status = 'APPROVED'
              LIMIT 50;`,
      },
      {
        id: 'Q7_BREAKDOWN_REPORTS',
        name: 'Breakdown Reports (by tenant + high severity)',
        domain: 'Maintenance',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT id, tenant_id, report_no, breakdown_type, severity, status
              FROM public.breakdown_reports
              WHERE tenant_id = '${testTenant}' AND severity = 'HIGH'
              LIMIT 50;`,
      },
      {
        id: 'Q8_PLACES_GEOFENCES',
        name: 'Places & Geofences (by tenant)',
        domain: 'Spatial & Telematics',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT id, tenant_id, name, type, address
              FROM spatial.places
              WHERE tenant_id = '${testTenant}'
              LIMIT 50;`,
      },
      {
        id: 'Q9_QUOTATIONS_APPROVED',
        name: 'Quotations & Billing (by tenant + status)',
        domain: 'Finance',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT id, tenant_id, quotation_date, grand_total, status
              FROM public.quotations
              WHERE tenant_id = '${testTenant}' AND status = 'APPROVED'
              LIMIT 50;`,
      },
      {
        id: 'Q10_OPERATIONS_INCIDENTS',
        name: 'Trip Incidents (operations schema by tenant)',
        domain: 'Operations',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT id, tenant_id, incident_no, incident_type, severity, status
              FROM operations.incidents
              WHERE tenant_id = '${testTenant}'
              LIMIT 50;`,
      },
    ];

    console.log('--- EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) PROFILE ---\n');

    for (const q of queries) {
      try {
        const result = await executeWithRetry(() =>
          client.$transaction(async (tx) => {
            await tx.$executeRawUnsafe(`SELECT set_config('app.current_tenant_id', '${testTenant}', true);`);
            return tx.$queryRawUnsafe(q.sql);
          }),
        );

        const planRoot = result[0]['QUERY PLAN'][0];
        const plan = planRoot['Plan'];
        const executionMs = Number(planRoot['Execution Time']);
        const planningMs = Number(planRoot['Planning Time']);
        const planType = plan['Node Type'];
        const indexUsed = plan['Index Name'] || 'None (Sequential Scan)';
        const sharedHits = plan['Shared Hit Blocks'] || 0;
        const sharedReads = plan['Shared Read Blocks'] || 0;
        const rowsActual = plan['Actual Rows'] ?? 0;
        const rowsFiltered = plan['Rows Removed by Filter'] || 0;

        const metrics = {
          id: q.id,
          name: q.name,
          domain: q.domain,
          planning_ms: planningMs,
          execution_ms: executionMs,
          plan_type: planType,
          index_used: indexUsed,
          rows_actual: rowsActual,
          rows_filtered: rowsFiltered,
          shared_hits: sharedHits,
          shared_reads: sharedReads,
        };

        baselineResults.push(metrics);

        console.log(`📌 [${q.domain}] ${q.name}`);
        console.log(`   Planning Time:     ${planningMs.toFixed(3)} ms`);
        console.log(`   Execution Time:    ${executionMs.toFixed(3)} ms`);
        console.log(`   Plan Type:         ${planType}`);
        console.log(`   Index Used:        ${indexUsed}`);
        console.log(`   Buffer Hits/Reads: ${sharedHits} hits / ${sharedReads} reads`);
        console.log(`   Rows Filtered:     ${rowsFiltered} removed\n`);
      } catch (err) {
        console.log(`📌 [${q.domain}] ${q.name}`);
        console.log(`   Execution note: ${err.message.split('\n')[0]}\n`);
      }
    }

    // Write baseline JSON artifact
    const artifactPath = 'staging_query_performance_baseline.json';
    fs.writeFileSync(
      artifactPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          environment: 'staging',
          connectedRole: role.current_user,
          bypassRls: role.rolbypassrls,
          queries: baselineResults,
        },
        null,
        2,
      ),
    );
    console.log(`✅ Staging performance baseline artifact written to ${artifactPath}`);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ POSTGRESQL QUERY PROFILING COMPLETE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } finally {
    await client.$disconnect();
  }
}

explainHotQueries().catch(console.error);
