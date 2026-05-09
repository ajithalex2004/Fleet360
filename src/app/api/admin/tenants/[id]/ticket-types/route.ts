/**
 * /api/admin/tenants/[id]/ticket-types
 *
 * GET — return the full access matrix (one row per ticket type, with
 *       defaults filled in for unconfigured types).
 * PUT — bulk replace. Body: { rows: [{ ticketType, enabled, slaOverrideHours? }] }
 *
 * Authorization: SUPER_ADMIN, or that tenant's TENANT_ADMIN.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getTenantAccessMatrix, replaceTenantAccessMatrix } from '@/lib/service-tickets/access';
import { loadServiceConfig } from '@/lib/service-config/load';
import { TICKET_TYPES_ORDER } from '@/types/service-tickets';
import type { TicketType } from '@/types/service-tickets';
import type { ServiceTone } from '@/types/service-config';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

interface RouteParams { params: Promise<{ id: string }>; }

function authorize(req: NextRequest, tenantId: string): { ok: true; userId: string } | { ok: false; res: NextResponse } {
  const role     = req.headers.get('x-user-role')   ?? '';
  const userId   = req.headers.get('x-user-id')     ?? '';
  const ctxTenant = req.headers.get('x-tenant-id')  ?? '';
  if (!userId) return { ok: false, res: NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 }) };
  if (role !== 'SUPER_ADMIN' && ctxTenant !== tenantId) {
    return { ok: false, res: NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 }) };
  }
  return { ok: true, userId };
}

export async function GET(req: NextRequest, { params }: RouteParams) {
  const { id: tenantId } = await params;
  const auth = authorize(req, tenantId);
  if (!auth.ok) return auth.res;

  const matrix = await getTenantAccessMatrix(tenantId);

  // Enrich each row with presentation metadata sourced from the Service
  // Configuration Engine. The matrix UI uses this to render the type
  // label, icon, tone, prefix and default SLA without depending on the
  // legacy TICKET_TYPE_CONFIG file.
  const enriched = await Promise.all(matrix.map(async (row) => {
    const cfg = await loadServiceConfig(tenantId, row.ticketType);
    const meta = cfg ? {
      label: cfg.type.name,
      description: cfg.type.description ?? '',
      iconName: cfg.type.icon,
      tone: cfg.type.tone as ServiceTone,
      prefix: cfg.rules.ticketing.ticketPrefix || '',
      defaultSlaHours: cfg.rules.ticketing.priorityMatrix.Medium,
    } : null;
    return { ...row, meta };
  }));

  return NextResponse.json({ ok: true, matrix: enriched });
}

export async function PUT(req: NextRequest, { params }: RouteParams) {
  const { id: tenantId } = await params;
  const auth = authorize(req, tenantId);
  if (!auth.ok) return auth.res;

  let body: { rows?: Array<{ ticketType?: string; enabled?: boolean; slaOverrideHours?: number | null }> };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 }); }

  if (!Array.isArray(body.rows)) {
    return NextResponse.json({ ok: false, error: '`rows` must be an array.' }, { status: 400 });
  }

  // Validate every row + reject unknown types.
  const validTypes = new Set<string>(TICKET_TYPES_ORDER);
  const cleaned = body.rows.map(r => {
    if (!r.ticketType || !validTypes.has(r.ticketType)) {
      throw new Error(`Unknown ticketType: ${r.ticketType}`);
    }
    const sla = r.slaOverrideHours;
    if (sla !== undefined && sla !== null && (typeof sla !== 'number' || sla < 0 || sla > 8760)) {
      throw new Error(`slaOverrideHours must be between 0 and 8760, got ${sla}`);
    }
    return {
      ticketType: r.ticketType as TicketType,
      enabled: r.enabled !== false,
      slaOverrideHours: sla ?? null,
    };
  });

  try {
    await replaceTenantAccessMatrix(tenantId, cleaned, auth.userId);

    void logAudit({
      tenantId,
      userId: auth.userId,
      userRole: 'TENANT_ADMIN',
      entityType: 'TenantTicketTypeAccess',
      action: 'UPDATE',
      details: `Service-Ticket type access updated. Enabled: ${cleaned.filter(r => r.enabled).map(r => r.ticketType).join(',') || 'none'}.`,
    });

    const matrix = await getTenantAccessMatrix(tenantId);
    return NextResponse.json({ ok: true, matrix });
  } catch (err) {
    if (err instanceof Error && /Unknown ticketType|slaOverrideHours/.test(err.message)) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 400 });
    }
    captureException(err, { context: 'admin.tenant-ticket-types.put' });
    return NextResponse.json({ ok: false, error: 'Failed to save access matrix' }, { status: 500 });
  }
}
