/**
 * /api/operations/simple-chat
 * A straightforward SSE streaming endpoint for the custom chat UI.
 * Returns newline-delimited JSON events:
 *   {"type":"text","content":"..."}
 *   {"type":"tool_call","name":"showFleetStatus","args":{...}}
 *   {"type":"done"}
 *   {"type":"error","message":"..."}
 */

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { logInteraction } from '@/lib/agents/ops-assistant/agent';

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
- Anticipate follow-up needs
- Flag critical issues proactively

TOOL USAGE RULES:
- ALWAYS call a tool to show data — never describe fleet numbers as plain text
- For general status questions → call showFleetStatus
- For "show me vehicles / available / which cars" → call showVehicles
- For "maintenance / repairs / work orders" → call showMaintenanceRequests
- For "alerts / warnings / issues" → call showAlerts
- For "bookings / rentals / reservations" → call showBookings
- For "KPI / overview / summary / dashboard" → call showKPIDashboard`;

const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'showFleetStatus',
      description: 'Display real-time fleet status card.',
      parameters: {
        type: 'object',
        properties: {
          highlight: { type: 'string', enum: ['availability', 'maintenance', 'compliance', 'utilization', 'all'] },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'showVehicles',
      description: 'Show a filterable list of fleet vehicles.',
      parameters: {
        type: 'object',
        properties: {
          status:  { type: 'string' },
          usage:   { type: 'string' },
          segment: { type: 'string' },
          title:   { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'showMaintenanceRequests',
      description: 'Show maintenance requests and work orders.',
      parameters: {
        type: 'object',
        properties: {
          priority: { type: 'string' },
          status:   { type: 'string' },
          title:    { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'showAlerts',
      description: 'Show system alerts and compliance warnings.',
      parameters: {
        type: 'object',
        properties: {
          severity: { type: 'string' },
          title:    { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'showBookings',
      description: 'Show current and recent bookings.',
      parameters: {
        type: 'object',
        properties: {
          status: { type: 'string' },
          limit:  { type: 'number' },
          title:  { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'showKPIDashboard',
      description: 'Show comprehensive KPI and operations overview dashboard.',
      parameters: {
        type: 'object',
        properties: {
          greeting: { type: 'string' },
        },
      },
    },
  },
];

// Simple in-memory history (per-session via threadId)
const threads = new Map<string, OpenAI.Chat.ChatCompletionMessageParam[]>();

function enc(obj: unknown) {
  return 'data: ' + JSON.stringify(obj) + '\n\n';
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  const { message, threadId } = await req.json() as { message: string; threadId: string };

  const client = new OpenAI({
    baseURL: 'https://api.thesys.dev/v1/embed/',
    apiKey: process.env.THESYS_API_KEY ?? '',
  });

  if (!threads.has(threadId)) {
    threads.set(threadId, [{ role: 'system', content: SYSTEM_PROMPT }]);
  }
  const history = threads.get(threadId)!;
  history.push({ role: 'user', content: message });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(new TextEncoder().encode(enc(obj)));

      try {
        const completion = await client.chat.completions.create({
          model: 'c1/openai/gpt-5/v-20250915',
          messages: history,
          tools: TOOLS,
          stream: true,
        });

        let textAccum    = '';
        let toolName     = '';
        let toolArgsRaw  = '';

        for await (const chunk of completion) {
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          // Streaming text
          if (delta.content) {
            textAccum += delta.content;
            send({ type: 'text', content: delta.content });
          }

          // Tool call streaming
          if (delta.tool_calls?.[0]) {
            const tc = delta.tool_calls[0];
            if (tc.function?.name)      toolName     += tc.function.name;
            if (tc.function?.arguments) toolArgsRaw  += tc.function.arguments;
          }
        }

        // Emit tool call as one event when complete
        if (toolName) {
          let args = {};
          try { args = JSON.parse(toolArgsRaw); } catch { /* partial args */ }
          send({ type: 'tool_call', name: toolName, args });
          history.push({ role: 'assistant', content: null, tool_calls: [{ id: 'tc1', type: 'function', function: { name: toolName, arguments: toolArgsRaw } }] });
          history.push({ role: 'tool', tool_call_id: 'tc1', content: `[${toolName} displayed to user]` });
        } else if (textAccum) {
          history.push({ role: 'assistant', content: textAccum });
        }

        // Log to agent_runs for ecosystem visibility (fire-and-forget)
        logInteraction({
          threadId,
          toolsInvoked: toolName ? [toolName] : [],
          messageCount: history.length,
          durationMs:   Date.now() - t0,
        });

        send({ type: 'done' });
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection':    'keep-alive',
    },
  });
}
