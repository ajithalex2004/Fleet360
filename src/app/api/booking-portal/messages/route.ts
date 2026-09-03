export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { ChatMessage } from '@/lib/omnichannel-communication';

// In-memory or session storage fallback for live chat threads
const activeChatStore = new Map<string, ChatMessage[]>();

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const bookingRef = searchParams.get('bookingRef') || 'DEFAULT';

  if (!activeChatStore.has(bookingRef)) {
    activeChatStore.set(bookingRef, [
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

  const messages = activeChatStore.get(bookingRef) || [];
  return NextResponse.json({ bookingRef, messages });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      bookingRef = 'DEFAULT',
      sender = 'PASSENGER',
      senderName = 'Passenger',
      text,
    }: {
      bookingRef: string;
      sender: 'PASSENGER' | 'DRIVER' | 'DISPATCHER';
      senderName: string;
      text: string;
    } = body;

    if (!text || text.trim() === '') {
      return NextResponse.json({ error: 'Message text cannot be empty' }, { status: 400 });
    }

    if (!activeChatStore.has(bookingRef)) {
      activeChatStore.set(bookingRef, []);
    }

    const newMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      bookingRef,
      sender,
      senderName,
      text: text.trim(),
      timestamp: new Date().toISOString(),
    };

    const thread = activeChatStore.get(bookingRef)!;
    thread.push(newMessage);

    return NextResponse.json({ success: true, message: newMessage, totalMessages: thread.length });
  } catch (err) {
    console.error('[api/booking-portal/messages POST]', err);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}
