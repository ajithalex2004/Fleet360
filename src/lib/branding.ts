/**
 * Per-tenant branding helpers.
 *
 * Stored on the `tenants` table as discrete columns (lazy-added via
 * ALTER TABLE … IF NOT EXISTS). We deliberately avoid a separate JSONB
 * column so the values are easy to query / index / migrate later.
 *
 * The colour fields drive runtime CSS variables — see BrandingProvider.
 */

import { prisma } from '@/lib/prisma';

let _ensured = false;

export async function ensureBrandingColumns(): Promise<void> {
  if (_ensured) return;
  await prisma.$executeRawUnsafe(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_product_name   TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_tagline        TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_logo_url       TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_favicon_url    TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_primary_color  TEXT`);
  await prisma.$executeRawUnsafe(`ALTER TABLE tenants ADD COLUMN IF NOT EXISTS brand_accent_color   TEXT`);
  _ensured = true;
}

export interface Branding {
  productName:   string | null;
  tagline:       string | null;
  logoUrl:       string | null;
  faviconUrl:    string | null;
  primaryColor:  string | null;
  accentColor:   string | null;
}

interface BrandingRow {
  brand_product_name:  string | null;
  brand_tagline:       string | null;
  brand_logo_url:      string | null;
  brand_favicon_url:   string | null;
  brand_primary_color: string | null;
  brand_accent_color:  string | null;
}

function rowToBranding(r: BrandingRow): Branding {
  return {
    productName:  r.brand_product_name,
    tagline:      r.brand_tagline,
    logoUrl:      r.brand_logo_url,
    faviconUrl:   r.brand_favicon_url,
    primaryColor: r.brand_primary_color,
    accentColor:  r.brand_accent_color,
  };
}

export async function getBranding(tenantId: string): Promise<Branding | null> {
  await ensureBrandingColumns();
  const rows = await prisma.$queryRawUnsafe<BrandingRow[]>(
    `SELECT brand_product_name, brand_tagline, brand_logo_url, brand_favicon_url,
            brand_primary_color, brand_accent_color
     FROM tenants WHERE id = $1 LIMIT 1`,
    tenantId,
  ).catch(() => []);
  return rows[0] ? rowToBranding(rows[0]) : null;
}

/**
 * Public lookup by tenant code (for the unauthenticated login page when
 * the user arrives at /login?tenant=ACM3411). Only returns visible
 * fields — no secrets exposed.
 */
export async function getBrandingByCode(code: string): Promise<(Branding & { tenantId: string; tenantName: string }) | null> {
  await ensureBrandingColumns();
  const rows = await prisma.$queryRawUnsafe<(BrandingRow & { id: string; name: string })[]>(
    `SELECT id, name, brand_product_name, brand_tagline, brand_logo_url, brand_favicon_url,
            brand_primary_color, brand_accent_color
     FROM tenants
     WHERE code = $1 AND COALESCE(is_active, TRUE) = TRUE
     LIMIT 1`,
    code,
  ).catch(() => []);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { ...rowToBranding(r), tenantId: r.id, tenantName: r.name };
}

/** Public lookup by tenant domain (login page sniffs from email). */
export async function getBrandingByDomain(domain: string): Promise<(Branding & { tenantId: string; tenantName: string }) | null> {
  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain.toLowerCase())) return null;
  await ensureBrandingColumns();
  const rows = await prisma.$queryRawUnsafe<(BrandingRow & { id: string; name: string })[]>(
    `SELECT id, name, brand_product_name, brand_tagline, brand_logo_url, brand_favicon_url,
            brand_primary_color, brand_accent_color
     FROM tenants
     WHERE LOWER(domain) = $1 AND COALESCE(is_active, TRUE) = TRUE
     LIMIT 1`,
    domain.toLowerCase(),
  ).catch(() => []);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { ...rowToBranding(r), tenantId: r.id, tenantName: r.name };
}

/** Permissive validation: accept #RGB / #RRGGBB. Returns null if invalid. */
export function normalizeHexColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim();
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return null;
  return v.toLowerCase();
}

/** Permissive URL validation. http(s) only — must NOT be javascript: etc. */
export function normalizeUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  const v = input.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}
