import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getMyPendingApprovals } from '@/lib/workflow-db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionUserId = req.headers.get('x-user-id') ?? '';
    const requestedEmail = searchParams.get('email')?.trim().toLowerCase() ?? '';
    let email = requestedEmail;

    if (sessionUserId) {
      const user = await prisma.user.findUnique({
        where: { id: sessionUserId },
        select: { email: true },
      });
      email = user?.email?.trim().toLowerCase() ?? '';
    }

    if (!email) {
      return NextResponse.json({ error: 'Authenticated user email not found' }, { status: 400 });
    }

    const approvals = await getMyPendingApprovals(email);
    return NextResponse.json({ actorEmail: email, approvals });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed to load approvals' }, { status: 500 });
  }
}
