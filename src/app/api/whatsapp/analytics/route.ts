import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    // Messages today
    const todayRows = await prisma.$queryRawUnsafe<{ count: string }[]>(
      `SELECT COUNT(*)::text AS count FROM whatsapp_messages WHERE created_at >= CURRENT_DATE`
    ).catch(() => [{ count: '0' }]);

    // Total unique conversations (unique inbound numbers)
    const convoRows = await prisma.$queryRawUnsafe<{ count: string }[]>(
      `SELECT COUNT(DISTINCT from_number)::text AS count FROM whatsapp_messages WHERE direction = 'INBOUND'`
    ).catch(() => [{ count: '0' }]);

    // Auto-replied %
    const autoRepliedRows = await prisma.$queryRawUnsafe<{ auto: string; total: string }[]>(
      `SELECT
         COUNT(*) FILTER (WHERE auto_replied = true)::text AS auto,
         COUNT(*)::text AS total
       FROM whatsapp_messages WHERE direction = 'INBOUND'`
    ).catch(() => [{ auto: '0', total: '0' }]);

    // Resolution rate
    const resolvedRows = await prisma.$queryRawUnsafe<{ resolved: string; total: string }[]>(
      `SELECT
         COUNT(DISTINCT from_number) FILTER (WHERE resolved = true)::text AS resolved,
         COUNT(DISTINCT from_number)::text AS total
       FROM whatsapp_messages WHERE direction = 'INBOUND'`
    ).catch(() => [{ resolved: '0', total: '0' }]);

    // Intent breakdown
    const intentBreakdown = await prisma.$queryRawUnsafe<{ intent: string; count: string }[]>(
      `SELECT intent, COUNT(*)::text AS count FROM whatsapp_messages WHERE direction = 'INBOUND' GROUP BY intent ORDER BY COUNT(*) DESC`
    ).catch(() => []);

    // Module breakdown
    const moduleBreakdown = await prisma.$queryRawUnsafe<{ module: string; count: string }[]>(
      `SELECT module, COUNT(*)::text AS count FROM whatsapp_messages WHERE direction = 'INBOUND' GROUP BY module ORDER BY COUNT(*) DESC`
    ).catch(() => []);

    // Top 5 phone numbers by message count
    const topNumbers = await prisma.$queryRawUnsafe<{ from_number: string; customer_name: string; count: string }[]>(
      `SELECT from_number, MAX(customer_name) AS customer_name, COUNT(*)::text AS count
       FROM whatsapp_messages WHERE direction = 'INBOUND'
       GROUP BY from_number ORDER BY COUNT(*) DESC LIMIT 5`
    ).catch(() => []);

    // Messages by hour of day (last 7 days)
    const hourlyRows = await prisma.$queryRawUnsafe<{ hour: string; count: string }[]>(
      `SELECT EXTRACT(HOUR FROM created_at)::text AS hour, COUNT(*)::text AS count
       FROM whatsapp_messages
       WHERE created_at >= NOW() - INTERVAL '7 days'
       GROUP BY EXTRACT(HOUR FROM created_at)
       ORDER BY hour`
    ).catch(() => []);

    // Messages by day (last 30 days)
    const dailyRows = await prisma.$queryRawUnsafe<{ day: string; inbound: string; outbound: string }[]>(
      `SELECT
         DATE(created_at)::text AS day,
         COUNT(*) FILTER (WHERE direction = 'INBOUND')::text AS inbound,
         COUNT(*) FILTER (WHERE direction = 'OUTBOUND')::text AS outbound
       FROM whatsapp_messages
       WHERE created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY day`
    ).catch(() => []);

    const autoNum = parseInt(autoRepliedRows[0]?.auto ?? '0', 10);
    const autoTotal = parseInt(autoRepliedRows[0]?.total ?? '0', 10);
    const autoRepliedPct = autoTotal > 0 ? Math.round((autoNum / autoTotal) * 100) : 0;

    const resNum = parseInt(resolvedRows[0]?.resolved ?? '0', 10);
    const resTotal = parseInt(resolvedRows[0]?.total ?? '0', 10);
    const resolutionRate = resTotal > 0 ? Math.round((resNum / resTotal) * 100) : 0;

    return NextResponse.json({
      kpis: {
        messagesToday: parseInt(todayRows[0]?.count ?? '0', 10),
        totalConversations: parseInt(convoRows[0]?.count ?? '0', 10),
        autoRepliedPct,
        resolutionRate,
      },
      intentBreakdown,
      moduleBreakdown,
      topNumbers,
      hourlyActivity: hourlyRows,
      dailyActivity: dailyRows,
    });
  } catch (err) {
    console.error('[WhatsApp Analytics]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
