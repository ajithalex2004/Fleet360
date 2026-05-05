import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const direction = searchParams.get('direction');
    const module = searchParams.get('module');
    const intent = searchParams.get('intent');
    const resolved = searchParams.get('resolved');
    const from_number = searchParams.get('from_number');
    const date_from = searchParams.get('date_from');
    const date_to = searchParams.get('date_to');
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10)));
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (direction) { conditions.push(`direction = $${idx++}`); params.push(direction); }
    if (module) { conditions.push(`module = $${idx++}`); params.push(module); }
    if (intent) { conditions.push(`intent = $${idx++}`); params.push(intent); }
    if (resolved !== null && resolved !== '') {
      conditions.push(`resolved = $${idx++}`);
      params.push(resolved === 'true');
    }
    if (from_number) { conditions.push(`from_number = $${idx++}`); params.push(from_number); }
    if (date_from) { conditions.push(`created_at >= $${idx++}`); params.push(date_from); }
    if (date_to) { conditions.push(`created_at <= $${idx++}`); params.push(date_to); }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // Fetch paginated messages
    const messages = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT * FROM whatsapp_messages ${whereClause} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      ...params, limit, offset
    );

    // Total count
    const countRows = await prisma.$queryRawUnsafe<{ total: string }[]>(
      `SELECT COUNT(*)::text AS total FROM whatsapp_messages ${whereClause}`,
      ...params
    );
    const total = parseInt(countRows[0]?.total ?? '0', 10);

    // Summary counts by intent
    const intentCounts = await prisma.$queryRawUnsafe<{ intent: string; count: string }[]>(
      `SELECT intent, COUNT(*)::text AS count FROM whatsapp_messages GROUP BY intent ORDER BY COUNT(*) DESC`
    ).catch(() => []);

    // Summary counts by module
    const moduleCounts = await prisma.$queryRawUnsafe<{ module: string; count: string }[]>(
      `SELECT module, COUNT(*)::text AS count FROM whatsapp_messages GROUP BY module ORDER BY COUNT(*) DESC`
    ).catch(() => []);

    // Unresolved count
    const unresolvedRows = await prisma.$queryRawUnsafe<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM whatsapp_messages WHERE direction = 'INBOUND' AND resolved = false`
    ).catch(() => [{ count: '0' }]);

    return NextResponse.json({
      messages,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      summary: {
        byIntent: intentCounts,
        byModule: moduleCounts,
        unresolvedCount: parseInt(unresolvedRows[0]?.count ?? '0', 10),
      },
    });
  } catch (err) {
    console.error('[Messages GET]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as {
      id?: string;
      from_number?: string;
      resolved: boolean;
      resolved_by?: string;
    };

    const { id, from_number, resolved, resolved_by } = body;

    if (id) {
      await prisma.$executeRawUnsafe(
        `UPDATE whatsapp_messages SET resolved = $1, resolved_by = $2, resolved_at = CASE WHEN $1 THEN NOW() ELSE NULL END WHERE id = $3`,
        resolved, resolved_by ?? null, id
      );
    } else if (from_number) {
      // Resolve entire conversation thread
      await prisma.$executeRawUnsafe(
        `UPDATE whatsapp_messages SET resolved = $1, resolved_by = $2, resolved_at = CASE WHEN $1 THEN NOW() ELSE NULL END WHERE from_number = $3 AND direction = 'INBOUND'`,
        resolved, resolved_by ?? null, from_number
      );
    } else {
      return NextResponse.json({ error: 'id or from_number required' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Messages PATCH]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
