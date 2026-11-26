export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Customer Portal — the request form for one Transport category, as this
 * tenant has set it up, with the contact fields prefilled from the account.
 * Only categories given to the customer (and still offered) are available.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCustomerPortal } from '@/lib/customer-portal/session';
import { getPortalUserById } from '@/lib/customer-portal/users';
import { customerTransportCategories } from '@/lib/transport-catalog/store';

type Params = { params: Promise<{ category: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  const ctx = await requireCustomerPortal(req, { portal: 'TRANSPORT' });
  if (ctx instanceof NextResponse) return ctx;
  const { category } = await params;
  const [cats, account] = await Promise.all([
    customerTransportCategories(ctx.tenantId, ctx.customerId),
    getPortalUserById(ctx.tenantId, ctx.user.id),
  ]);
  const cat = cats.find((c) => c.category === category);
  if (!cat) return NextResponse.json({ ok: false, error: 'This request type is not available for your company' }, { status: 404 });
  return NextResponse.json({
    ok: true,
    category: { category: cat.category, title: cat.title, description: cat.description, approvalRequired: cat.approvalRequired },
    form: cat.effectiveForm,
    prefill: {
      requestorName: account?.fullName ?? '',
      requestorEmail: account?.email ?? ctx.user.email,
      phone: account?.mobile ?? '',
    },
  });
}
