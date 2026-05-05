import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { transformStream } from '@crayonai/stream';
import { DBMessage, getMessageStore } from '../../chat/messageStore';

const SYSTEM_PROMPT = `You are the XL AI Smart Mobility Operations Assistant — an expert AI embedded in a Smart Transport Management Platform used by fleet operators, dispatchers, and operations managers in the UAE.

You have real-time access to the following live data via tools:
- Fleet status (vehicle counts by status, lifecycle, and usage)
- Live vehicle inventory (available, rented, maintenance, reserved)
- Maintenance requests and work orders
- System alerts and compliance warnings
- Active bookings and dispatch
- Comprehensive KPI dashboards

YOUR PERSONALITY:
- Professional, precise, proactive
- Always show data visually using tools — never just type numbers as plain text
- Anticipate follow-up needs (e.g., after showing maintenance requests, suggest acknowledging them)
- Use operational language: "AoR" (Area of Responsibility), "dispatch", "turnaround", "utilisation rate"
- Flag critical issues (expired docs, overdue maintenance, unacknowledged incidents) proactively

TOOL USAGE RULES:
- ALWAYS call a tool to show data — never describe fleet numbers as plain text
- For general status questions → call showFleetStatus
- For "show me vehicles / what's available / which cars" → call showVehicles
- For "maintenance / repairs / work orders" → call showMaintenanceRequests
- For "alerts / warnings / issues" → call showAlerts
- For "bookings / rentals / reservations" → call showBookings
- For "KPI / overview / summary / dashboard" → call showKPIDashboard
- For creating a booking → call createBooking

GREETING: When the user first connects, immediately call showKPIDashboard to show the full operations overview.`;

export async function POST(req: NextRequest) {
  try {
  const body = await req.json();
  const { prompt, threadId, responseId } = body as {
    prompt: DBMessage;
    threadId: string;
    responseId: string;
  };

  const client = new OpenAI({
    baseURL: 'https://api.thesys.dev/v1/embed/',
    apiKey: process.env.THESYS_API_KEY ?? 'missing-key',
  });

  const messageStore = getMessageStore(`ops-${threadId}`);

  // Inject system prompt on first message
  if (messageStore.messageList.length === 0) {
    messageStore.addMessage({ role: 'system', content: SYSTEM_PROMPT });
  }

  messageStore.addMessage(prompt);

  const llmStream = await client.chat.completions.create({
    model: 'c1/openai/gpt-5/v-20250915',
    messages: messageStore.getOpenAICompatibleMessageList(),
    stream: true,
    tools: [
      // ── 1. Fleet Status ───────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'showFleetStatus',
          description: 'Display a real-time fleet status card showing vehicle counts by operational status, lifecycle stage, and compliance alerts. Call this for general fleet overview questions.',
          parameters: {
            type: 'object',
            properties: {
              highlight: {
                type: 'string',
                enum: ['availability', 'maintenance', 'compliance', 'utilization', 'all'],
                description: 'Which aspect to visually highlight',
              },
            },
          },
        },
      },
      // ── 2. Vehicles List ─────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'showVehicles',
          description: 'Show a filterable live list of fleet vehicles. Use when the user asks about specific vehicles, availability, or wants to browse the fleet.',
          parameters: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                description: 'Filter by status: AVAILABLE, RENTED, MAINTENANCE, RESERVED, INACTIVE, SOLD',
              },
              usage: {
                type: 'string',
                description: 'Filter by usage: RENTAL, STAFF, SCHOOL_BUS, LOGISTICS, AMBULANCE, POOL, EXECUTIVE',
              },
              segment: {
                type: 'string',
                description: 'Filter by segment: ECONOMY, COMPACT, MID_SIZE, FULL_SIZE, COMPACT_SUV, MID_SIZE_SUV, FULL_SIZE_SUV, LUXURY, PREMIUM, VAN, PICKUP, BUS',
              },
              title: {
                type: 'string',
                description: 'A short contextual title for the card, e.g. "Available Rental Vehicles"',
              },
            },
          },
        },
      },
      // ── 3. Maintenance Requests ──────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'showMaintenanceRequests',
          description: 'Show pending maintenance requests and fleet work orders. Call this when the user asks about repairs, servicing, or vehicle issues.',
          parameters: {
            type: 'object',
            properties: {
              priority: {
                type: 'string',
                description: 'Filter by priority: Critical, High, Medium, Low',
              },
              status: {
                type: 'string',
                description: 'Filter by status: Open, In_Progress, Pending_Parts',
              },
              title: {
                type: 'string',
                description: 'Contextual title, e.g. "Critical Maintenance Backlog"',
              },
            },
          },
        },
      },
      // ── 4. Alerts ────────────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'showAlerts',
          description: 'Show current system alerts, warnings, and compliance violations. Call this for alerts, issues, warnings, or anything flagged.',
          parameters: {
            type: 'object',
            properties: {
              severity: {
                type: 'string',
                description: 'Filter by severity: CRITICAL, HIGH, MEDIUM, LOW',
              },
              title: {
                type: 'string',
                description: 'Contextual title, e.g. "Critical System Alerts"',
              },
            },
          },
        },
      },
      // ── 5. Bookings ──────────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'showBookings',
          description: 'Show current and recent bookings across all modules (rental, staff, logistics). Call this for booking queries, dispatch status, or active reservations.',
          parameters: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                description: 'Filter by status: PENDING, CONFIRMED, ACTIVE, COMPLETED, CANCELLED',
              },
              limit: {
                type: 'number',
                description: 'Number of bookings to show (default 10)',
              },
              title: {
                type: 'string',
                description: 'Contextual title, e.g. "Active Dispatched Trips"',
              },
            },
          },
        },
      },
      // ── 6. KPI Dashboard ─────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'showKPIDashboard',
          description: 'Show a comprehensive KPI and operations overview dashboard. Use this as a greeting or when user asks for summary, overview, or dashboard.',
          parameters: {
            type: 'object',
            properties: {
              greeting: {
                type: 'string',
                description: 'A short personalized greeting message shown above the dashboard, e.g. "Good morning! Here is your operations snapshot:"',
              },
            },
          },
        },
      },
      // ── 7. Create Booking ────────────────────────────────────────────────
      {
        type: 'function',
        function: {
          name: 'createBooking',
          description: 'Open an interactive form to create a new booking or dispatch request.',
          parameters: {
            type: 'object',
            properties: {
              origin: {
                type: 'string',
                description: 'The pickup/origin location if provided',
              },
              destination: {
                type: 'string',
                description: 'The destination location if provided',
              },
            },
          },
        },
      },
    ],
  });

  const responseStream = transformStream(
    llmStream,
    (chunk) => chunk.choices?.[0]?.delta?.content ?? '',
    {
      onEnd: ({ accumulated }) => {
        const message = accumulated.filter(Boolean).join('');
        messageStore.addMessage({ role: 'assistant', content: message, id: responseId });
      },
    },
  ) as ReadableStream<string>;

  return new NextResponse(responseStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
  } catch (err: unknown) {
    console.error('[ops-chat] Error:', err);
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
