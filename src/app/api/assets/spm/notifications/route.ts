/**
 * GET  /api/assets/spm/notifications?user_id=xxx  — fetch notifications for a user
 * PATCH /api/assets/spm/notifications              — mark notifications as read
 *   body: { ids: string[] }  or  { user_id: string, mark_all: true }
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ensureSpmSchema } from '@/lib/assets/spm-schema';

type Row = Record<string, unknown>;
const query = <T = Row>(sql: string, ...v: unknown[]) =>
  prisma.$queryRawUnsafe<T[]>(sql, ...v).catch(() => [] as T[]);
const exec = (sql: string, ...v: unknown[]) =>
  prisma.$executeRawUnsafe(sql, ...v).catch(() => 0);

function ser<T>(v: T): T {
  return JSON.parse(JSON.stringify(v, (_, val) =>
    typeof val === 'bigint' ? Number(val) : val instanceof Date ? val.toISOString() : val
  ));
}

export async function GET(req: NextRequest) {
  try {
    await ensureSpmSchema();
    const sp = req.nextUrl.searchParams;
    const userId  = sp.get('user_id');
    const unread  = sp.get('unread'); // 'true' to filter unread only

    const conditions: string[] = [`tenant_id = 'default'`];
    const params: unknown[] = [];

    if (userId) {
      params.push(userId);
      conditions.push(`user_id = $${params.length}`);
    }
    if (unread === 'true') {
      conditions.push(`is_read = FALSE`);
    }

    const rows = await query(`
      SELECT n.*,
             t.ticket_code, t.asset_name AS ticket_asset,
             c.cycle_code,  c.name AS cycle_name
      FROM spm_notifications n
      LEFT JOIN spm_tickets t ON n.ticket_id = t.id
      LEFT JOIN spm_cycles  c ON n.cycle_id  = c.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY n.created_at DESC
      LIMIT 50
    `, ...params);

    // Unread count
    const countConditions = [`tenant_id = 'default'`, `is_read = FALSE`];
    if (userId) countConditions.push(`user_id = '${userId}'`);
    const [countRow] = await query<{ count: bigint }>(`
      SELECT COUNT(*) AS count FROM spm_notifications WHERE ${countConditions.join(' AND ')}
    `);

    return NextResponse.json(ser({
      notifications: rows,
      unread_count: Number(countRow?.count ?? 0),
    }));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await ensureSpmSchema();
    const body = await req.json();

    if (body.mark_all && body.user_id) {
      await exec(`
        UPDATE spm_notifications
        SET is_read = TRUE, read_at = NOW()
        WHERE tenant_id = 'default' AND user_id = $1 AND is_read = FALSE
      `, body.user_id);
      return NextResponse.json({ success: true });
    }

    if (Array.isArray(body.ids) && body.ids.length > 0) {
      const placeholders = body.ids.map((_: string, i: number) => `$${i + 1}`).join(', ');
      await exec(`
        UPDATE spm_notifications
        SET is_read = TRUE, read_at = NOW()
        WHERE id IN (${placeholders}) AND tenant_id = 'default'
      `, ...body.ids);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: 'Provide ids[] or mark_all + user_id' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
