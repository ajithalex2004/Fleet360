import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getLeasingDocumentEntityOptions, type LeasingDocumentEntityType } from '@/lib/leasing-document-entities';
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const entityType = searchParams.get('entityType');
    const entityId   = searchParams.get('entityId');
    const docs = await prisma.leaseDocument.findMany({
      where: {
        ...(entityType ? { entityType } : {}),
        ...(entityId   ? { entityId   } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    const options = await getLeasingDocumentEntityOptions();
    const lookups = Object.fromEntries(
      Object.entries(options).map(([type, entries]) => [
        type,
        new Map(entries.map((entry) => [entry.id, entry])),
      ]),
    ) as unknown as Record<LeasingDocumentEntityType, Map<string, { label: string; secondaryLabel?: string | null; status?: string | null }>>;

    return NextResponse.json(
      docs.map((doc) => {
        const option = (doc.entityType in lookups
          ? lookups[doc.entityType as LeasingDocumentEntityType]?.get(doc.entityId)
          : undefined);
        return {
          ...doc,
          entityLabel: option?.label ?? doc.entityId,
          entitySecondaryLabel: option?.secondaryLabel ?? null,
        };
      }),
    );
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const doc = await prisma.leaseDocument.create({ data: body });
    return NextResponse.json(doc, { status: 201 });
  } catch { return NextResponse.json({ error: 'Failed' }, { status: 500 }); }
}
