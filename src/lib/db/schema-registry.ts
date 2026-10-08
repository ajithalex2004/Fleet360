/**
 * Every module that checks its schema at request time (provisionSchemaOnce),
 * with the tables and columns it needs. The readiness and health checks, and
 * Admin > Schema status, report anything here that is missing from the
 * database (architecture audit A9): a missing table shows up at deploy time,
 * not as a later request failing with "relation does not exist".
 *
 * Add a module here when it starts using provisionSchemaOnce;
 * tests/unit/schema-readiness.test.ts fails if one is left out.
 */
import { findMissingObjects, type SchemaSpec } from '@/lib/db/schema-init';
import { runOutsideRlsScope } from '@/lib/rls-scope';
import { AGENTS_SCHEMA } from '@/lib/agents/schema';
import { BLE_HW_SCHEMA } from '@/lib/assets/ble-hw-schema';
import { ASSETS_SCHEMA } from '@/lib/assets/schema';
import { SPM_SCHEMA } from '@/lib/assets/spm-schema';
import { DISPATCH_SCHEMA } from '@/lib/dispatch/schema';
import { HOS_SCHEMA } from '@/lib/fleet/hos-schema';
import { FLEET_SCHEMA } from '@/lib/fleet/schema';
import { GEOFENCE_SCHEMA } from '@/lib/logistics/geofence-schema';
import { ROUTE_OPTIMIZER_SCHEMA } from '@/lib/logistics/route-optimizer-schema';

/**
 * Columns that only runtime code (since removed) used to create, now owned by
 * migration 20261024090000_runtime_ddl_catchup. Listed so a deploy whose
 * migrations were not applied shows up in readiness, not as a failing
 * rental close or billing page.
 */
const MIGRATED_COLUMNS: SchemaSpec = {
  tables: [],
  columns: [
    ['vehicles', 'year_of_manufacture'],
    ['vehicles', 'stop_mode_comm_frequency'],
    ['pricing_rules', 'name'],
    ['pricing_rules', 'updated_at'],
    ['pricing_rules', 'base_hourly_rate'],
    ['pricing_rules', 'weekend_daily_rate'],
    ['pricing_rules', 'exchange_rate_to_aed'],
    ['pricing_rules', 'customer_type'],
    ['pricing_rules', 'corporate_account_id'],
    ['pricing_rules', 'airline_code'],
    ['pricing_rules', 'frequent_flyer_prog'],
    ['pricing_rules', 'credit_card_type'],
    ['pricing_rules', 'pickup_location_code'],
    ['pricing_rules', 'dropoff_location_code'],
    ['pricing_rules', 'is_airport_rate'],
    ['pricing_rules', 'is_domestic'],
    ['pricing_rules', 'channel'],
    ['pricing_rules', 'online_discount'],
    ['pricing_rules', 'grace_period_min'],
    ['pricing_rules', 'late_fee_per_hour'],
    ['pricing_rules', 'late_fee_cap'],
    ['pricing_rules', 'min_rental_days'],
    ['pricing_rules', 'min_rental_hours'],
    ['pricing_rules', 'insurance_plans'],
    ['pricing_rules', 'promo_code'],
    ['pricing_rules', 'promo_discount_pct'],
    ['pricing_rules', 'promo_valid_from'],
    ['pricing_rules', 'promo_valid_to'],
    ['pricing_rules', 'promo_max_uses'],
    ['pricing_rules', 'promo_used_count'],
    ['pricing_rules', 'included_km_per_day'],
    ['pricing_rules', 'excess_km_rate'],
    ['pricing_rules', 'priority'],
    ['pricing_rules', 'notes'],
    ['rental_invoice_payments', 'payment_date'],
    ['rental_agreements', 'actual_return_date'],
    ['rental_agreements', 'pickup_fuel_level'],
    ['rental_agreements', 'return_fuel_level'],
    ['rental_agreements', 'pickup_odometer'],
    ['rental_agreements', 'return_odometer'],
    ['rental_agreements', 'late_fee'],
    ['rental_agreements', 'excess_km_fee'],
    ['rental_agreements', 'fuel_surcharge'],
    ['rental_agreements', 'closed_by'],
    ['rental_agreements', 'closing_notes'],
    ['rental_agreements', 'pickup_location_code'],
    ['rental_agreements', 'dropoff_location_code'],
    ['rental_agreements', 'customer_type'],
    ['rental_agreements', 'channel'],
    ['rental_agreements', 'promo_code'],
    ['rental_agreements', 'billing_mode'],
    ['rental_agreements', 'additional_charges'],
    ['rental_agreements', 'customer_name'],
    ['tenants', 'stripe_customer_id'],
    ['tenants', 'stripe_subscription_id'],
    ['tenants', 'subscription_status'],
    ['tenants', 'current_period_end'],
    ['tenants', 'trial_ends_at'],
    ['tenants', 'billing_email'],
    ['tenants', 'domain_verification_token'],
    ['tenants', 'domain_verification_method'],
    ['tenants', 'domain_verified_at'],
    ['tenants', 'brand_product_name'],
    ['tenants', 'brand_tagline'],
    ['tenants', 'brand_logo_url'],
    ['tenants', 'brand_favicon_url'],
    ['tenants', 'brand_primary_color'],
    ['tenants', 'brand_accent_color'],
  ],
};

export const REQUIRED_SCHEMAS: Readonly<Record<string, SchemaSpec>> = {
  agents: AGENTS_SCHEMA,
  'ble-hw': BLE_HW_SCHEMA,
  assets: ASSETS_SCHEMA,
  spm: SPM_SCHEMA,
  dispatch: DISPATCH_SCHEMA,
  hos: HOS_SCHEMA,
  fleet: FLEET_SCHEMA,
  geofence: GEOFENCE_SCHEMA,
  'route-optimizer': ROUTE_OPTIMIZER_SCHEMA,
  'migrated-columns': MIGRATED_COLUMNS,
};

export interface SchemaReport {
  status: 'ok' | 'incomplete' | 'unknown';
  /** Module → missing tables / table.column. Only modules with something missing. */
  missing: Record<string, string[]>;
  missingCount: number;
  checkedAt: string;
  error?: string;
}

let cached: { report: SchemaReport; at: number } | null = null;
const CACHE_MS = 30_000;

/** Check every module's schema (cached briefly: health and readiness are polled). */
export async function schemaReport(opts: { fresh?: boolean } = {}): Promise<SchemaReport> {
  if (!opts.fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.report;
  const checkedAt = new Date().toISOString();
  let report: SchemaReport;
  try {
    const entries = await runOutsideRlsScope(() => Promise.all(
      Object.entries(REQUIRED_SCHEMAS).map(async ([name, spec]) => [name, await findMissingObjects(spec)] as const),
    ));
    const missing = Object.fromEntries(entries.filter(([, m]) => m.length > 0));
    const missingCount = Object.values(missing).reduce((n, m) => n + m.length, 0);
    report = { status: missingCount ? 'incomplete' : 'ok', missing, missingCount, checkedAt };
  } catch (e) {
    // The database could not be asked; that is the db check's to report.
    report = { status: 'unknown', missing: {}, missingCount: 0, checkedAt, error: e instanceof Error ? e.message : String(e) };
  }
  cached = { report, at: Date.now() };
  return report;
}
