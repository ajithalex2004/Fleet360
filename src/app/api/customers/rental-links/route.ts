export const dynamic = 'force-dynamic';

/**
 * Customer onboarding — link a customer to its Rental customer, so the
 * Customer Portal can show the company's rentals (Rent-a-Car category).
 *
 * GET ?customerId=…   the customer's linked rental customer (or null)
 * GET ?q=…            rental customers matching a search (at most 20)
 * PUT { customerId, rentalCustomerId | null }   link, change or remove the link
 *   TENANT_ADMIN / SUPER_ADMIN only; audited.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { authorizeServiceConfig, requireAdmin } from '@/lib/service-config/auth';
import { withAuditedAction } from '@/lib/audited-action';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';
import {
  RentalLinkError, getRentalLink, searchRentalCustomers, setRentalLink,
} from '@/lib/customer-portal/rental-links';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const customerId = req.nextUrl.searchParams.get('customerId');
  try {
    if (customerId) return NextResponse.json({ ok: true, link: await getRentalLink(auth.tenantId, customerId) });
    const options = await searchRentalCustomers(auth.tenantId, req.nextUrl.searchParams.get('q') ?? '');
    return NextResponse.json({ ok: true, options });
  } catch (err) {
    captureException(err, { context: 'customers.rental-links.read' });
    return NextResponse.json({ ok: false, error: 'Failed to load rental customers' }, { status: 500 });
  }
}

async function handlePUT(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) return NextResponse.json({ error: authz.error }, { status: authz.status });
  const auth = authorizeServiceConfig(req);
  if (!auth.ok) return auth.res;
  const admin = requireAdmin(auth);
  if (!admin.ok) return admin.res;
  const body = stripTenantOwnershipFields((await req.json().catch(() => ({}))) as Record<string, unknown>);
  const customerId = String(body.customerId ?? '');
  const rentalCustomerId = body.rentalCustomerId == null || body.rentalCustomerId === '' ? null : String(body.rentalCustomerId);
  if (!customerId) return NextResponse.json({ ok: false, error: 'customerId is required' }, { status: 400 });
  try {
    const link = await setRentalLink(auth.tenantId, customerId, rentalCustomerId, auth.userId);
    void logAudit({
      tenantId: auth.tenantId, userId: auth.userId, userRole: auth.role || undefined, entityType: 'CustomerRentalLink',
      entityId: customerId, entityName: link?.companyName ?? link?.name ?? 'none', action: 'UPDATE',
      details: link ? `Linked customer ${customerId} to rental customer ${link.id} (${link.companyName ?? link.name})` : `Removed the rental link of customer ${customerId}`,
    });
    return NextResponse.json({ ok: true, link });
  } catch (err) {
    if (err instanceof RentalLinkError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    captureException(err, { context: 'customers.rental-links.update' });
    return NextResponse.json({ ok: false, error: 'Failed to update the link' }, { status: 500 });
  }
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PUT = withAuditedAction(handlePUT);
