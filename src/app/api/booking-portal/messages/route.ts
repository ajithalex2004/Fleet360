export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { ChatMessage } from '@/lib/omnichannel-communication';

// Tenant-scoped in-memory storage fallback for live chat threads
const activeChatStore = new Map<string, ChatMessage[]>();

function threadKey(tenantId: string, bookingRef: string): string {
  return `${tenantId}:${bookingRef}`;
}

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const { searchParams } = new URL(req.url);
  const bookingRef = searchParams.get('bookingRef') || 'DEFAULT';
  const key = threadKey(tenantId, bookingRef);

  if (!activeChatStore.has(key)) {
    activeChatStore.set(key, [
      {
        id: 'msg-sys-1',
        bookingRef,
        sender: 'SYSTEM',
        senderName: 'Fleet360 Dispatch Bot',
        text: `Live channel connected for booking ${bookingRef}. Messages are shared directly with your assigned chauffeur and fleet operations.`,
        timestamp: new Date(Date.now() - 1000 * 60 * 5).toISOString(),
      },
      {
        id: 'msg-drv-1',
        bookingRef,
        sender: 'DRIVER',
        senderName: 'Chauffeur Ahmed',
        text: `Hello! I am on my way to your pickup point in the Lexus ES300 (DXB A 10293). Feel free to message me if your flight gate changes.`,
        timestamp: new Date(Date.now() - 1000 * 60 * 2).toISOString(),
      },
    ]);
  }

  const messages = activeChatStore.get(key) || [];
  return NextResponse.json({ bookingRef, messages });
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  try {
    const rawBody = await req.json();
    const body = stripTenantOwnershipFields(rawBody) as Partial<{
      bookingRef: string;
      sender: 'PASSENGER' | 'DRIVER' | 'DISPATCHER';
      senderName: string;
      text: string;
    }>;
    const {
      bookingRef = 'DEFAULT',
      sender = 'PASSENGER',
      senderName = 'Passenger',
      text,
    } = body;

    if (!text || text.trim() === '') {
      return NextResponse.json({ error: 'Message text cannot be empty' }, { status: 400 });
    }

    const key = threadKey(tenantId, bookingRef);
    if (!activeChatStore.has(key)) {
      activeChatStore.set(key, []);
    }

    const newMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      bookingRef,
      sender,
      senderName,
      text: text.trim(),
      timestamp: new Date().toISOString(),
    };

    const thread = activeChatStore.get(key)!;
    thread.push(newMessage);

    return NextResponse.json({ success: true, message: newMessage, totalMessages: thread.length });
  } catch (err) {
    console.error('[api/booking-portal/messages POST]', err);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
