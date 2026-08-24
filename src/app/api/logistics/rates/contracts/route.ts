/**
 * /api/logistics/rates/contracts
 *
 *   GET   list the tenant's rate contracts (optional ?search= ?status= ?limit=)
 *   POST  create or update a contract (upsert keyed on tenant_id + contract_no)
 *
 * This is the write/read surface the /logistics/rate-contracts editor talks to.
 * It's a thin wrapper over the existing domain.ts functions — contract
 * authoring stays in Next.js/Prisma until the L4d cutover; the Go side only
 * READS contracts to compute quotes.
 *
 * The rate basis (per-km / per-kg / breakpoints) is persisted inside the
 * contract's metadata JSONB under `rateBasis`, in the exact shape the Go engine
 * parses (rateengine.ParseRateBasis). There is no rate_basis column — keeping
 * the dimension additive means no migration and no schema-ownership change.
 *
 * Auth: tenant operator session. tenantId comes from the middleware-set
 *       x-tenant-id header (derived from the verified xl-session), never the
 *       request body — a client cannot author a contract in another tenant.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import {
  listRateContracts,
  upsertRateContract,
  type LogisticsRateContractInput,
} from '@/lib/logistics/domain';

export const runtime = 'nodejs';

// ── GET ─────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  const sp = req.nextUrl.searchParams;
  const search = sp.get('search');
  const status = sp.get('status');
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '200', 10) || 200, 1), 500);

  try {
    const data = await listRateContracts({ tenantId, search, status, limit });
    return NextResponse.json({ data }, {
      headers: { 'Cache-Control': 'private, max-age=15' },
    });
    } catch (e) {
    console.error('[rates/contracts GET]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to list contracts' },
      { status: 500 },
    );
  }
}

// ── POST (upsert) ─────────────────────────────────────────────────────────────

interface ContractBody {
  contractNo?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  carrierId?: string | null;
  laneOrigin?: string | null;
  laneDestination?: string | null;
  vehicleType?: string | null;
  serviceLevel?: string | null;
  currency?: string | null;
  baseRate?: number | string | null;
  minCharge?: number | string | null;
  fuelSurchargePct?: number | string | null;
  accessorialRules?: unknown;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  status?: string | null;
  metadata?: Record<string, unknown> | null;
  rateBasis?: unknown;
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });

  if (!authz.ok) {

    return NextResponse.json({ error: authz.error }, { status: authz.status });

  }

  const { tenantId } = authz;

  let body: ContractBody;
  try { body = (await req.json()) as ContractBody; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const laneOrigin = (body.laneOrigin ?? '').trim();
  const laneDestination = (body.laneDestination ?? '').trim();
  if (!laneOrigin || !laneDestination) {
    return NextResponse.json(
      { error: 'Lane origin and destination are required' },
      { status: 400 },
    );
  }

  // Canonicalize the rate basis (accept it either top-level or nested in
  // metadata) and fold it back into metadata.rateBasis. A flat / empty basis
  // is removed so the engine treats the contract as flat.
  const rawBasis = body.rateBasis ?? (body.metadata as Record<string, unknown> | null)?.rateBasis;
  const rateBasis = sanitizeRateBasis(rawBasis);
  const metadata: Record<string, unknown> = { ...(body.metadata ?? {}) };
  if (rateBasis) metadata.rateBasis = rateBasis;
  else delete metadata.rateBasis;

  const input: LogisticsRateContractInput = {
    tenantId, // authoritative — never from the body
    contractNo: body.contractNo?.trim() || null,
    customerId: body.customerId?.trim() || null,
    customerName: body.customerName?.trim() || null,
    carrierId: body.carrierId?.trim() || null,
    laneOrigin,
    laneDestination,
    vehicleType: body.vehicleType?.trim() || null,
    serviceLevel: body.serviceLevel?.trim() || null,
    currency: body.currency?.trim() || 'AED',
    baseRate: num(body.baseRate) ?? 0,
    minCharge: num(body.minCharge),
    fuelSurchargePct: num(body.fuelSurchargePct),
    accessorialRules: body.accessorialRules ?? {},
    effectiveFrom: body.effectiveFrom || null,
    effectiveTo: body.effectiveTo || null,
    status: body.status?.trim() || 'ACTIVE',
    metadata,
  };

  try {
    const contract = await upsertRateContract(input);
    return NextResponse.json(contract, { status: 201 });
    } catch (e) {
    console.error('[rates/contracts POST]', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'failed to save contract' },
      { status: 500 },
    );
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function nonNeg(v: unknown): number {
  const n = num(v);
  return n != null && n > 0 ? n : 0;
}

type SanitizedTier = { minQuantity: number; ratePerUnit?: number; flatAmount?: number };
type SanitizedBasis = { mode: 'per_km' | 'per_kg'; ratePerUnit: number; breakpoints: SanitizedTier[] };

/**
 * Coerce a client-supplied rate basis into the canonical persisted shape, or
 * null when it's flat / has nothing to price. Mirrors the tolerance of the Go
 * ParseRateBasis: only per_km / per_kg are quantity modes; a tier needs a
 * positive per-unit rate or a positive flat amount (flat wins when both set);
 * a basis with no floor rate and no usable tier collapses to null (flat).
 */
function sanitizeRateBasis(raw: unknown): SanitizedBasis | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const mode = normalizeMode(typeof r.mode === 'string' ? r.mode : '');
  if (mode === null) return null;

  const ratePerUnit = nonNeg(r.ratePerUnit);

  const breakpoints: SanitizedTier[] = [];
  if (Array.isArray(r.breakpoints)) {
    for (const item of r.breakpoints) {
      if (!item || typeof item !== 'object') continue;
      const t = item as Record<string, unknown>;
      const minQuantity = nonNeg(t.minQuantity);
      const flat = nonNeg(t.flatAmount);
      const rate = nonNeg(t.ratePerUnit);
      if (flat > 0) breakpoints.push({ minQuantity, flatAmount: flat });
      else if (rate > 0) breakpoints.push({ minQuantity, ratePerUnit: rate });
      // tiers with neither a positive rate nor flat amount are dropped
    }
  }

  if (ratePerUnit <= 0 && breakpoints.length === 0) return null;
  return { mode, ratePerUnit, breakpoints };
}

function normalizeMode(s: string): 'per_km' | 'per_kg' | null {
  switch (s.trim().toLowerCase()) {
    case 'per_km': case 'perkm': case 'per-km': case 'km': case 'distance':
      return 'per_km';
    case 'per_kg': case 'perkg': case 'per-kg': case 'kg': case 'weight':
      return 'per_kg';
    default:
      return null; // flat / unknown → no basis
  }
}
