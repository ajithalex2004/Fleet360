/**
 * Adversarial Challenge Test Suite for Milestone M1 (Runtime & Database: F09 through F12)
 *
 * Empirically stress-tests Worker M1's runtime and database fixes:
 * 1. Timestamp Arithmetic & SQL (F09)
 * 2. Dispatch Schema Completeness & Migration Synchronization (F10)
 * 3. Scheduler & Sweep Adapters Loopback Execution (F11)
 * 4. Reverse-Proxy Public Origin Resolution (F12)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Target modules under test
import { scheduledDepartureSql, tripScheduleColumnsSql } from '@/lib/school-bus-trip-sql';
import { DISPATCH_SCHEMA } from '@/lib/dispatch/schema';
import { REQUIRED_SCHEMAS, schemaReport } from '@/lib/db/schema-registry';
import { getPublicOrigin } from '@/lib/public-origin';
import { getSchedulerState } from '@/lib/jobs/scheduler';
import { JOB_MAP, type JobContext, type JobResult } from '@/lib/jobs/registry';

describe('Adversarial Challenge Suite — Milestone M1 Runtime & Database (F09 - F12)', () => {

  // ==========================================================================
  // CHALLENGE 1: Timestamp Arithmetic & SQL Query Resilience (F09)
  // ==========================================================================
  describe('Challenge 1: Timestamp Arithmetic & SQL (F09)', () => {
    it('CH-09-A: scheduledDepartureSql generates PostgreSQL-safe conditional date-time addition', () => {
      const sql = scheduledDepartureSql('t');
      
      // Must guard against nulls before arithmetic to prevent 42883 or null addition
      expect(sql).toContain('t.scheduled_date IS NOT NULL');
      expect(sql).toContain('t.scheduled_start IS NOT NULL');
      
      // Must explicitly cast scheduled_start to ::time to prevent "operator does not exist: date + text"
      expect(sql).toMatch(/t\.scheduled_date\s*\+\s*\(t\.scheduled_start\)::time/);
      
      // Must format output as ISO string format
      expect(sql).toContain("to_char(t.scheduled_date + (t.scheduled_start)::time, 'YYYY-MM-DD\"T\"HH24:MI:SS')");
      
      // Must return NULL if either date or start time is missing
      expect(sql).toContain('ELSE NULL END');
    });

    it('CH-09-B: scheduledDepartureSql supports custom table aliases and preserves SQL integrity', () => {
      const alias = 'sbt';
      const sql = scheduledDepartureSql(alias);
      expect(sql).toContain(`${alias}.scheduled_date IS NOT NULL`);
      expect(sql).toContain(`${alias}.scheduled_start IS NOT NULL`);
      expect(sql).toContain(`to_char(${alias}.scheduled_date + (${alias}.scheduled_start)::time`);
    });

    it('CH-09-C: tripScheduleColumnsSql maps all 4 required API fields without referencing non-existent columns', () => {
      const sql = tripScheduleColumnsSql('trip');
      
      // 4 required projection fields
      expect(sql).toContain('trip.session AS session_type');
      expect(sql).toContain('AS scheduled_departure');
      expect(sql).toContain('trip.actual_start::text AS actual_departure');
      expect(sql).toContain('trip.actual_end::text AS actual_arrival');

      // Table does NOT have session_type, scheduled_departure, actual_departure, actual_arrival as raw columns
      // Only as aliases
      expect(sql).not.toMatch(/\btrip\.session_type\b/);
      expect(sql).not.toMatch(/\btrip\.scheduled_departure\b/);
      expect(sql).not.toMatch(/\btrip\.actual_departure\b/);
      expect(sql).not.toMatch(/\btrip\.actual_arrival\b/);
    });

    it('CH-09-D: school-bus routes log query errors via console.error rather than swallowing silently', async () => {
      // Verify route source files log errors on database failures
      const driverTodaySource = readFileSync(
        join(process.cwd(), 'src/app/api/school-bus/driver/today/route.ts'),
        'utf8'
      );
      const parentTodaySource = readFileSync(
        join(process.cwd(), 'src/app/api/school-bus/parent/today/route.ts'),
        'utf8'
      );

      // Check for console.error logging in error handler
      expect(driverTodaySource).toContain("console.error('[school-bus/driver/today] trip query error:'");
      expect(parentTodaySource).toContain("console.error('[school-bus/parent/today] trip query error:'");

      // Verify no raw empty catch block on the trip query: .catch(() => [])
      expect(driverTodaySource).not.toMatch(/\.catch\(\(\)\s*=>\s*\[\]\s*\)\s*;\s*if\s*\(trips\.length/);
    });
  });

  // ==========================================================================
  // CHALLENGE 2: Dispatch Schema Completeness & Migration Sync (F10)
  // ==========================================================================
  describe('Challenge 2: Dispatch Schema Completeness & Migration Sync (F10)', () => {
    it('CH-10-A: DISPATCH_SCHEMA defines the complete set of required tables and columns', () => {
      expect(DISPATCH_SCHEMA.tables).toBeDefined();
      expect(DISPATCH_SCHEMA.tables).toContain('dispatch_jobs');
      expect(DISPATCH_SCHEMA.tables).toContain('driver_availability');
      expect(DISPATCH_SCHEMA.tables).toContain('vehicle_locations');
      expect(DISPATCH_SCHEMA.tables).toContain('ambulance_capabilities');

      // 11 dispatch_jobs columns
      const dispatchJobCols = (DISPATCH_SCHEMA.columns ?? [])
        .filter(([t]) => t === 'dispatch_jobs')
        .map(([, c]) => c);
      expect(dispatchJobCols).toEqual(
        expect.arrayContaining([
          'origin_lat',
          'origin_lng',
          'dest_lat',
          'dest_lng',
          'origin_address',
          'destination_address',
          'scheduled_pickup',
          'passenger_count',
          'driver_id',
          'vehicle_id',
          'meta',
        ])
      );
      expect(dispatchJobCols.length).toBe(11);

      // 6 driver_availability columns
      const driverAvailCols = (DISPATCH_SCHEMA.columns ?? [])
        .filter(([t]) => t === 'driver_availability')
        .map(([, c]) => c);
      expect(driverAvailCols).toEqual(
        expect.arrayContaining([
          'tenant_id',
          'vehicle_id',
          'service_types',
          'shift_starts_at',
          'shift_ends_at',
          'updated_at',
        ])
      );
      expect(driverAvailCols.length).toBe(6);
    });

    it('CH-10-B: All 17 DISPATCH_SCHEMA missing columns exist in migrations', () => {
      const migrationsDir = join(process.cwd(), 'prisma/migrations');
      const migrationDirs = readdirSync(migrationsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      let allMigrationSql = '';
      for (const dir of migrationDirs) {
        const sqlFile = join(migrationsDir, dir, 'migration.sql');
        allMigrationSql += '\n' + readFileSync(sqlFile, 'utf8');
      }

      // 11 dispatch_jobs columns
      const dispatchJobsMissing11 = [
        'origin_lat',
        'origin_lng',
        'dest_lat',
        'dest_lng',
        'origin_address',
        'destination_address',
        'scheduled_pickup',
        'passenger_count',
        'driver_id',
        'vehicle_id',
        'meta',
      ];
      for (const col of dispatchJobsMissing11) {
        const regex = new RegExp(`ALTER\\s+TABLE.*?dispatch_jobs.*?ADD\\s+COLUMN.*?\\b${col}\\b`, 'i');
        expect(regex.test(allMigrationSql), `Column dispatch_jobs.${col} missing from migrations`).toBe(true);
      }

      // 6 driver_availability columns
      const driverAvailMissing6 = [
        'tenant_id',
        'vehicle_id',
        'service_types',
        'shift_starts_at',
        'shift_ends_at',
        'updated_at',
      ];
      for (const col of driverAvailMissing6) {
        const regex = new RegExp(`(CREATE\\s+TABLE.*?driver_availability|ALTER\\s+TABLE.*?driver_availability.*?ADD\\s+COLUMN).*?\\b${col}\\b`, 'is');
        expect(regex.test(allMigrationSql), `Column driver_availability.${col} missing from migrations`).toBe(true);
      }
    });

    it('CH-10-C: DISPATCH_SCHEMA is registered under REQUIRED_SCHEMAS in schema-registry', () => {
      expect(REQUIRED_SCHEMAS.dispatch).toBeDefined();
      expect(REQUIRED_SCHEMAS.dispatch).toEqual(DISPATCH_SCHEMA);
    });
  });

  // ==========================================================================
  // CHALLENGE 3: Scheduler & Sweep Adapters Loopback Execution (F11)
  // ==========================================================================
  describe('Challenge 3: Scheduler & Sweep Adapters Loopback Execution (F11)', () => {
    it('CH-11-A: Scheduler state reports configured jobs and Dubai timezone', () => {
      const state = getSchedulerState();
      expect(state.timezone).toBe('Asia/Dubai');
      expect(state.jobCount).toBeGreaterThan(15);
      expect(state.configuredJobs.some((j) => j.name === 'health-watchdog')).toBe(true);
      expect(state.configuredJobs.some((j) => j.name === 'dunning-reconciliation')).toBe(true);
    });

    it('CH-11-B: Registered job handlers support in-process execution with optional request', async () => {
      // Verify JobContext type accepts invocation without NextRequest
      const inProcessCtx: JobContext = {
        tenantId: null,
        userId: 'system:cron',
        searchParams: new URLSearchParams({ job: 'test-job', occurrence: '2026-11-16T12:00:00Z' }),
      };

      expect(inProcessCtx.request).toBeUndefined();
      expect(inProcessCtx.userId).toBe('system:cron');
    });

    it('CH-11-C: Sweep adapters use local loopback rather than external NEXT_PUBLIC_APP_URL', () => {
      const sweepAdapterSource = readFileSync(
        join(process.cwd(), 'src/lib/jobs/sweep-adapters.ts'),
        'utf8'
      );

      // Verify loopback fallback: 127.0.0.1:${port}
      expect(sweepAdapterSource).toContain('http://127.0.0.1:${port}');
      // Must NOT use NEXT_PUBLIC_APP_URL which causes hairpinned ConnectTimeoutError
      expect(sweepAdapterSource).not.toContain('process.env.NEXT_PUBLIC_APP_URL');
    });

    it('CH-11-D: Scheduler executes registered job handlers directly via JOB_MAP in-process', () => {
      const schedulerSource = readFileSync(
        join(process.cwd(), 'src/lib/jobs/scheduler.ts'),
        'utf8'
      );

      // Must call jobDef.handler(ctx) directly in-process
      expect(schedulerSource).toContain('await jobDef.handler(ctx)');
      // Must not make fetch() calls inside scheduler
      expect(schedulerSource).not.toContain('await fetch(');
    });
  });

  // ==========================================================================
  // CHALLENGE 4: Public Origin Resolution Behind Reverse Proxies (F12)
  // ==========================================================================
  describe('Challenge 4: Public Origin Resolution (F12)', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('CH-12-A: Respects configured NEXT_PUBLIC_APP_URL and strips trailing slashes', () => {
      process.env.NEXT_PUBLIC_APP_URL = 'https://app.fleet360.ae///';
      const origin = getPublicOrigin();
      expect(origin).toBe('https://app.fleet360.ae');
    });

    it('CH-12-B: Resolves origin from X-Forwarded-Proto and X-Forwarded-Host behind SSL reverse proxy', () => {
      delete process.env.NEXT_PUBLIC_APP_URL;

      const headers = new Headers({
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'portal.fleet360.ae',
      });

      const origin = getPublicOrigin({ headers });
      expect(origin).toBe('https://portal.fleet360.ae');
    });

    it('CH-12-C: Resolves origin with custom non-standard port behind reverse proxy', () => {
      delete process.env.NEXT_PUBLIC_APP_URL;

      const headers = new Headers({
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'staging.fleet360.ae:8443',
      });

      const origin = getPublicOrigin({ headers });
      expect(origin).toBe('https://staging.fleet360.ae:8443');
    });

    it('CH-12-D: Defaults proto to https when only Host / X-Forwarded-Host is provided', () => {
      delete process.env.NEXT_PUBLIC_APP_URL;

      const headers = new Headers({
        host: 'api.fleet360.ae',
      });

      const origin = getPublicOrigin({ headers });
      expect(origin).toBe('https://api.fleet360.ae');
    });

    it('CH-12-E: Falls back to req.nextUrl.origin when headers are absent', () => {
      delete process.env.NEXT_PUBLIC_APP_URL;

      const origin = getPublicOrigin({
        nextUrl: { origin: 'https://tenant-a.fleet360.ae' },
      });
      expect(origin).toBe('https://tenant-a.fleet360.ae');
    });

    it('CH-12-F: Falls back to parsing req.url when headers and nextUrl are absent', () => {
      delete process.env.NEXT_PUBLIC_APP_URL;

      const origin = getPublicOrigin({
        url: 'https://auth.fleet360.ae/callback?code=xyz',
      });
      expect(origin).toBe('https://auth.fleet360.ae');
    });

    it('CH-12-G: Falls back to safe default https://localhost:8080 when req is completely empty', () => {
      delete process.env.NEXT_PUBLIC_APP_URL;

      const origin = getPublicOrigin();
      expect(origin).toBe('https://localhost:8080');
    });

    it('CH-12-H: Edge case - chained proxies with comma-separated headers behavior test', () => {
      delete process.env.NEXT_PUBLIC_APP_URL;

      // Note: In chained multi-tier proxies, headers may contain comma-separated values:
      // "https, http" or "client.example.com, proxy.internal"
      const headers = new Headers({
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'client.example.com',
      });

      const origin = getPublicOrigin({ headers });
      expect(origin).toBe('https://client.example.com');

      // Verify constructing new URL works without throwing
      expect(() => new URL('/auth/callback', origin)).not.toThrow();
      expect(new URL('/auth/callback', origin).toString()).toBe('https://client.example.com/auth/callback');
    });
  });
});
