import { NextRequest, NextResponse } from 'next/server';
import { countWorkflowNotificationEvents, listWorkflowNotificationEvents, markWorkflowNotificationEventsRead } from '@/lib/workflow-db';
import { requireAdminPermission } from '@/lib/admin-policy';
import { prisma } from '@/lib/prisma';

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'view', 'workflows');
    if (auth instanceof NextResponse) return auth;

    const { searchParams } = new URL(req.url);
    const workflowId = searchParams.get('workflowId') ?? undefined;
    const unreadOnly = searchParams.get('unreadOnly') === 'true';
    const limit = Number(searchParams.get('limit') ?? 50);
    let recipientEmail = searchParams.get('recipientEmail') ?? undefined;
    if (!recipientEmail) {
      const user = await prisma.user.findUnique({
        where: { id: auth.ctx.userId },
        select: { email: true },
      });
      recipientEmail = user?.email ?? undefined;
    }

    const [events, unreadCount] = await Promise.all([
      listWorkflowNotificationEvents({
        workflowId,
        recipientEmail,
        unreadOnly,
        limit,
      }),
      countWorkflowNotificationEvents({
        recipientEmail,
        unreadOnly: true,
      }),
    ]);

    return NextResponse.json({
      events,
      unreadCount,
      workflowId,
      recipientEmail: recipientEmail ?? null,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requireAdminPermission(req, 'view', 'workflows');
    if (auth instanceof NextResponse) return auth;

    const body = await req.json().catch(() => ({}));
    const user = await prisma.user.findUnique({
      where: { id: auth.ctx.userId },
      select: { email: true },
    });
    if (!user?.email) {
      return NextResponse.json({ error: 'Current admin email not found' }, { status: 400 });
    }

    await markWorkflowNotificationEventsRead({
      recipientEmail: user.email,
      notificationIds: Array.isArray(body.notificationIds) ? body.notificationIds.map(String) : [],
      markAll: body.markAll === true,
    });

    const unreadCount = await countWorkflowNotificationEvents({
      recipientEmail: user.email,
      unreadOnly: true,
    });

    return NextResponse.json({ ok: true, unreadCount });
  } catch (e: unknown) {
    return NextResponse.json({ error: errorMessage(e) }, { status: 500 });
  }
}
