/**
 * scripts/explain-hot-queries.mjs
 *
 * PostgreSQL Query Plan Diagnostic & Performance Profiler
 *
 * Connects as `fleet360_app` and executes `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`
 * on hot production query patterns inside `withTenantRls`.
 *
 * Metrics extracted:
 *   - Execution Time (ms inside PostgreSQL engine, excluding network/driver)
 *   - Planning Time (ms)
 *   - Scan Method (Index Scan / Index Only Scan vs Seq Scan)
 *   - Index Used
 *   - Shared Hit / Read Blocks (Buffer cache effectiveness)
 *   - Rows Processed & Filtered
 */

import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import crypto from 'crypto';

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
  console.log('POSTGRESQL HOT-QUERY EXECUTION PLAN & BUFFER ANALYSIS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  const client = new PrismaClient({
    datasourceUrl: phase0Url,
    log: [{ level: 'error', emit: 'stdout' }],
  });

  const testTenant = crypto.randomUUID();

  try {
    // 1. Verify role with retry to allow compute endpoint wakeup
    const roles = await executeWithRetry(() =>
      client.$queryRawUnsafe(`
        SELECT current_user, rolcanlogin, rolbypassrls, rolsuper
        FROM pg_roles
        WHERE rolname = current_user
      `),
    );
    const role = roles[0];
    console.log(`Connected Role: ${role.current_user} (bypassrls=${role.rolbypassrls}, super=${role.rolsuper})`);

    const queries = [
      {
        name: 'TripSchedule (by tenant + status)',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT * FROM public.trip_schedules
              WHERE "tenantId" = '${testTenant}' AND "status" = 'SCHEDULED'
              ORDER BY "departureTime" ASC LIMIT 50;`,
      },
      {
        name: 'Vehicle (by tenant + availability)',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT * FROM public.vehicles
              WHERE "tenantId" = '${testTenant}' AND "status" = 'AVAILABLE'
              LIMIT 50;`,
      },
      {
        name: 'Invoice (by tenant + status)',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT * FROM public.invoices
              WHERE "tenantId" = '${testTenant}' AND "status" = 'PENDING'
              LIMIT 50;`,
      },
      {
        name: 'Driver (by tenant + active status)',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT * FROM public.drivers
              WHERE "tenantId" = '${testTenant}' AND "status" = 'ACTIVE'
              LIMIT 50;`,
      },
      {
        name: 'Place / Geofence (by tenant)',
        sql: `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
              SELECT * FROM public.places
              WHERE "tenantId" = '${testTenant}'
              LIMIT 50;`,
      },
    ];

    console.log('\n--- EXPLAIN (ANALYZE, BUFFERS) RESULTS ---\n');

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
        const execTimeMs = planRoot['Execution Time'];
        const planTimeMs = planRoot['Planning Time'];
        const nodeType = plan['Node Type'];
        const indexName = plan['Index Name'] || 'None (Sequential Scan)';
        const hitBlocks = plan['Shared Hit Blocks'] || 0;
        const readBlocks = plan['Shared Read Blocks'] || 0;
        const totalRows = plan['Actual Rows'];

        console.log(`📌 Query: ${q.name}`);
        console.log(`   Engine Execution Time: ${execTimeMs.toFixed(3)} ms`);
        console.log(`   Planning Time:         ${planTimeMs.toFixed(3)} ms`);
        console.log(`   Scan Node Type:        ${nodeType}`);
        console.log(`   Index Utilized:        ${indexName}`);
        console.log(`   Buffer Cache Hits:     ${hitBlocks} hits / ${readBlocks} disk reads`);
        console.log(`   Rows Returned:         ${totalRows}\n`);
      } catch (err) {
        console.log(`📌 Query: ${q.name}`);
        console.log(`   Execution note: ${err.message.split('\n')[0]}\n`);
      }
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ POSTGRESQL QUERY PROFILING COMPLETE');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  } finally {
    await client.$disconnect();
  }
}

explainHotQueries();
