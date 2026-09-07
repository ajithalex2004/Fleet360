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

import { requireAuthorizedTenant } from '@/lib/tenant-context';
const SYSTEM_PROMPT = `You are the Fleet360 Operations Assistant — an expert AI embedded in a Smart Transport Management Platform used by fleet operators, dispatchers, and operations managers in the UAE.

You have real-time access to the following live operational and BI reporting data via tools:
- Fleet status (vehicle counts by status, lifecycle, and usage)
- Live vehicle inventory (available, rented, maintenance, reserved)
- Maintenance requests and work orders
- System alerts and compliance warnings
- Active bookings and dispatch
- Comprehensive KPI dashboards
- Transport Services Domain KPI Tiles:
  * Rent-A-Car (RAC) KPI (ADR, utilization, active agreements, overdue returns, fines)
  * Staff Transportation (STS) KPI (PCE optimization, shift occupancy, route adherence)
  * School Bus Transportation KPI (RFID student attendance, guardian alerts, DOT safety)
  * Logistics & Heavy Freight KPI (trips in transit, ePOD completion rate, cold chain telematics)
  * Corporate Long-Term Leasing KPI (active leases, monthly lease billing, contract renewals)
  * VIP Limousine & Chauffeur KPI (luxury utilization, VIP airport trips, guest CSAT)
- Fleet Utilization BI Reports (utilization %, uptime, idle & workshop days)
- Revenue & Financial BI Reports (multi-LOB breakdown, RAC, STS, Leasing, Logistics)
- Maintenance & Workshop BI Cost Reports (repair costs, average cost per asset, top failure categories)
- Automated Scheduled BI Reports (managing and configuring automated PDF/CSV report crons)

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
- For "KPI / overview / summary / dashboard" → call showKPIDashboard
- For "RAC / Rent-A-Car KPI / rental counter / ADR / daily rate" → call showRACKPI
- For "Staff Bus / STS / staff transportation / PCE / shift occupancy" → call showStaffBusKPI
- For "School Bus / student attendance / RFID / guardian alerts / DOT" → call showSchoolBusKPI
- For "Logistics / freight / heavy trucks / ePOD / cold chain / cargo" → call showLogisticsKPI
- For "Leasing / long-term leases / lease renewals / B2B contracts" → call showLeasingKPI
- For "Limousine / VIP Chauffeur / luxury fleet / airport transfer" → call showChauffeurKPI
- For "utilization report / fleet utilization / asset uptime / idle days" → call generateUtilizationReport
- For "revenue report / financial report / LOB breakdown / income analytics" → call generateRevenueReport
- For "maintenance cost report / repair spend / workshop TCO / parts costs" → call generateMaintenanceCostReport
- For "schedule report / automated report / email report weekly / recurring BI export" → call scheduleReport`;

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
  {
    type: 'function',
    function: {
      name: 'showRACKPI',
      description: 'Display specialized Rent-A-Car (RAC) KPI tile with ADR, fleet utilization, active agreements, overdue returns, and unbilled fines.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'showStaffBusKPI',
      description: 'Display specialized Staff Transportation (STS) KPI tile with PCE optimization, shift loads, on-time departure rate, and driver rosters.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'showSchoolBusKPI',
      description: 'Display specialized School Bus Transportation KPI tile with student RFID scan rates, guardian WhatsApp SMS rate, and DOT compliance.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'showLogisticsKPI',
      description: 'Display specialized Heavy Freight & Logistics KPI tile with trips in transit, digital ePOD completion, and cold chain telematics.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'showLeasingKPI',
      description: 'Display specialized Long-Term Leasing KPI tile with active corporate leases, monthly run-rate billing, and upcoming renewals.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'showChauffeurKPI',
      description: 'Display specialized Limousine & VIP Chauffeur KPI tile with luxury fleet utilization, VIP airport transfers, and guest CSAT.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generateUtilizationReport',
      description: 'Generate and display a Fleet Utilization BI Report analyzing asset uptime, active/idle/maintenance days, and vehicle revenue.',
      parameters: {
        type: 'object',
        properties: {
          fromDate: { type: 'string', description: 'ISO date or YYYY-MM-DD starting date' },
          toDate:   { type: 'string', description: 'ISO date or YYYY-MM-DD ending date' },
          title:    { type: 'string', description: 'Custom report title' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generateRevenueReport',
      description: 'Generate and display a Revenue & Financial BI Report with breakdown across business lines (Rent-a-Car, Staff Transport, Leasing, Logistics).',
      parameters: {
        type: 'object',
        properties: {
          period: { type: 'string', enum: ['monthly', 'quarterly', 'yearly'] },
          title:  { type: 'string', description: 'Custom report title' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'generateMaintenanceCostReport',
      description: 'Generate and display a Workshop & Maintenance Cost BI Report showing repair spends, cost per vehicle, and category breakdown.',
      parameters: {
        type: 'object',
        properties: {
          fromDate: { type: 'string', description: 'ISO date or YYYY-MM-DD starting date' },
          toDate:   { type: 'string', description: 'ISO date or YYYY-MM-DD ending date' },
          title:    { type: 'string', description: 'Custom report title' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scheduleReport',
      description: 'Display active automated BI report cron schedules or confirm a newly requested automated report schedule.',
      parameters: {
        type: 'object',
        properties: {
          reportType: { type: 'string', description: 'Type of report (e.g., Fleet Utilization, Revenue BI, Maintenance Costs)' },
          frequency:  { type: 'string', enum: ['daily', 'weekly', 'monthly'] },
          title:      { type: 'string', description: 'Custom title' },
        },
      },
    },
  },
];

import { sessionStore } from '@/lib/agents/conversational-guardrails';

function enc(obj: unknown) {
  return 'data: ' + JSON.stringify(obj) + '\n\n';
}

export async function POST(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  const t0 = Date.now();
  const { message, threadId } = await req.json() as { message: string; threadId: string };

  const client = new OpenAI({
    baseURL: 'https://api.thesys.dev/v1/embed/',
    apiKey: process.env.THESYS_API_KEY ?? '',
  });

  const existing = sessionStore.getMessages(tenantId, threadId);
  if (existing.length === 0) {
    sessionStore.addMessage(tenantId, threadId, { role: 'system', content: SYSTEM_PROMPT });
  }
  sessionStore.addMessage(tenantId, threadId, { role: 'user', content: message });

  const messagesToSend = sessionStore.getOpenAICompatibleMessageList(tenantId, threadId, { maxTotalMessages: 16 });

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(new TextEncoder().encode(enc(obj)));

      try {
        const completion = await client.chat.completions.create({
          model: 'c1/openai/gpt-5/v-20250915',
          messages: messagesToSend,
          tools: TOOLS,
          max_tokens: 1500,
          stream: true,
        });

        let textAccum = '';
        // Accumulate each distinct tool call by its stream index — a single
        // turn can request multiple tools (e.g. "show me the full dashboard"),
        // and each gets its own index in delta.tool_calls[].
        const toolCallsByIndex = new Map<number, { name: string; argsRaw: string }>();

        for await (const chunk of completion) {
          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          // Streaming text
          if (delta.content) {
            textAccum += delta.content;
            send({ type: 'text', content: delta.content });
          }

          // Tool call streaming — one or more calls, each identified by index
          for (const tc of delta.tool_calls ?? []) {
            const idx = tc.index ?? 0;
            const entry = toolCallsByIndex.get(idx) ?? { name: '', argsRaw: '' };
            if (tc.function?.name)      entry.name    += tc.function.name;
            if (tc.function?.arguments) entry.argsRaw += tc.function.arguments;
            toolCallsByIndex.set(idx, entry);
          }
        }

        const toolCalls = [...toolCallsByIndex.values()].filter(tc => tc.name);

        // Emit each completed tool call as its own event
        if (toolCalls.length > 0) {
          toolCalls.forEach((tc, i) => {
            let args = {};
            try { args = JSON.parse(tc.argsRaw); } catch { /* partial args */ }
            send({ type: 'tool_call', name: tc.name, args, callId: `tc${i}` });
          });
          sessionStore.addMessage(tenantId, threadId, {
            role: 'assistant',
            content: null,
            tool_calls: toolCalls.map((tc, i) => ({
              id: `tc${i}`, type: 'function',
              function: { name: tc.name, arguments: tc.argsRaw },
            })),
          });
          toolCalls.forEach((tc, i) => {
            sessionStore.addMessage(tenantId, threadId, {
              role: 'tool',
              tool_call_id: `tc${i}`,
              content: `[${tc.name} displayed to user]`,
            });
          });
        } else if (textAccum) {
          sessionStore.addMessage(tenantId, threadId, { role: 'assistant', content: textAccum });
        }

        // Log to agent_runs for ecosystem visibility (fire-and-forget)
        logInteraction({
          threadId,
          toolsInvoked: toolCalls.map(tc => tc.name),
          messageCount: sessionStore.getMessages(tenantId, threadId).length,
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
