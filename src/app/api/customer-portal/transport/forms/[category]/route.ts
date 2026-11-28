export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Customer Portal — the request form for one Transport category, as this
 * tenant has set it up, with tenant-configured default field values and the
 * contact fields prefilled from the signed-in account. Only categories given
 * to the customer (and still offered) are available.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCustomerPortal } from '@/lib/customer-portal/session';
import { getPortalUserById } from '@/lib/customer-portal/users';
import { customerTransportCategories } from '@/lib/transport-catalog/store';
import type { RequestValues } from '@/lib/transport-catalog/form-schema';

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

  // Merge tenant-configured field defaults with signed-in user's contact profile.
  const prefill: RequestValues = {
    ...cat.defaultValues,
    ...(account?.fullName ? { requestorName: account.fullName } : cat.defaultValues.requestorName !== undefined ? {} : { requestorName: '' }),
    ...(account?.email || ctx.user.email
      ? { requestorEmail: account?.email ?? ctx.user.email }
      : cat.defaultValues.requestorEmail !== undefined
        ? {}
        : { requestorEmail: '' }),
    ...(account?.mobile ? { phone: account.mobile } : cat.defaultValues.phone !== undefined ? {} : { phone: '' }),
  };

  return NextResponse.json({
    ok: true,
    category: {
      category: cat.category,
      title: cat.title,
      description: cat.description,
      approvalRequired: cat.approvalRequired,
      isCustom: cat.isCustom,
      icon: cat.icon,
    },
    form: cat.effectiveForm,
    prefill,
  });
}
