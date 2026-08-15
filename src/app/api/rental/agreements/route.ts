import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { paginate, paginatedResponse } from '@/lib/pagination';
import { assertCanWrite } from '@/lib/access-control';

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({headers: req.headers, nextUrl: req.nextUrl});
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const sp = req.nextUrl.searchParams;
    const status = sp.get('status');
    const customerId = sp.get('customerId');
    const { take, skip, page, limit } = paginate(sp);
    const where = {
      tenantId,
      ...(status ? { status } : {}),
      ...(customerId ? { customerId } : {}),
    };
    const [data, total] = await Promise.all([
      prisma.rentalAgreement.findMany({
        where,
        include: {
          booking: {
            select: {
              id: true,
              bookingRef: true,
              pickupDate: true,
              dropoffDate: true,
              customer: { select: { id: true, fullName: true, phone: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.rentalAgreement.count({ where }),
    ]);
    return NextResponse.json(paginatedResponse(data, total, page, limit));
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({headers: req.headers, nextUrl: req.nextUrl});
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const guard = assertCanWrite(req, 'rental');
  if (guard) return guard;

  try {
    const bodyRaw = await req.json();
    const body = {
      ...stripTenantOwnershipFields(
        (bodyRaw && typeof bodyRaw === 'object' ? bodyRaw : {}) as Record<string, unknown>,
      ),
      tenantId,
    };
    const count = await prisma.rentalAgreement.count({ where: { tenantId } });
    const agreementNo = (body as any).agreementNo ?? `AGR-${String(count + 1).padStart(5, '0')}`;
    const agreement = await withTenantRls(prisma, tenantId, async (tx) =>
      tx.rentalAgreement.create({ data: { ...stripTenantOwnershipFields((body && typeof body === "object" ? body : {}) as Record<string, unknown>), tenantId,  agreementNo } as any,
    }),
    );
    return NextResponse.json(agreement, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
