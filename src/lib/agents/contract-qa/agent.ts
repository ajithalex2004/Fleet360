/**
 * Contract Q&A Agent — tool-calling assistant grounded on real lease data.
 *
 * The agent answers natural-language questions about a lease contract by
 * calling a small set of tools that query the database. Tools return
 * structured snapshots; the model then formats a friendly answer in the
 * same language as the question (EN or AR).
 *
 * Tools:
 *   - get_contract(contractId)        — basic contract details
 *   - get_payment_schedule(contractId) — invoice + payment timeline
 *   - get_mileage_history(contractId)  — readings, overage status
 *   - get_invoices(contractId)         — invoices and balances
 *   - get_lessee(contractId)           — lessee bill-to + KYC info
 *
 * Tool returns are JSON. The model's final answer should reference
 * specific dates / numbers / amounts pulled from the tools (no hallucinated
 * figures).
 */

import OpenAI from 'openai';
import { prisma } from '@/lib/prisma';
import { env, hasOpenAI } from '@/lib/env';

/* ── Tool schemas (OpenAI tool-call format) ──────────────────────────────── */

const TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_contract',
      description:
        'Get the basic details of the lease contract (number, type, dates, monthly rate, vehicles, status, mileage cap).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['contractId'],
        properties: { contractId: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_payment_schedule',
      description:
        'Get the upcoming and past invoice schedule for the contract — issue date, due date, amount, status.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['contractId'],
        properties: { contractId: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_mileage_history',
      description:
        'Get the mileage readings for the contract and any overage records, including km used, km allowed, and any overage charges.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['contractId'],
        properties: { contractId: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_invoices',
      description:
        'Get invoices linked to the contract\'s lessee with totals, paid status, and outstanding balance.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['contractId'],
        properties: { contractId: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_lessee',
      description: 'Get the lessee (customer) for this contract — name, type (B2B/B2C), KYC ids, contact info.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        required: ['contractId'],
        properties: { contractId: { type: 'string' } },
      },
    },
  },
];

/* ── Tool implementations (DB-backed) ────────────────────────────────────── */

async function tool_get_contract(contractId: string) {
  const c = await prisma.leaseContract2.findUnique({
    where: { id: contractId },
    include: {
      vehicles: true,
    },
  });
  if (!c) return { error: 'Contract not found' };
  const lessee = await prisma.lessee.findUnique({
    where: { id: c.lesseeId },
    select: { name: true, type: true },
  });
  return {
    contractNumber: c.contractNumber,
    agreementType: c.agreementType,
    leaseType: c.leaseType,
    status: c.status,
    startDate: c.startDate.toISOString().slice(0, 10),
    endDate: c.endDate.toISOString().slice(0, 10),
    durationMonths: Math.ceil(
      (c.endDate.getTime() - c.startDate.getTime()) / (30.44 * 86400000),
    ),
    monthlyRate: Number(c.monthlyRate),
    totalContractValue: c.totalContractValue ? Number(c.totalContractValue) : null,
    currency: c.currency ?? 'AED',
    mileageCapPerMonth: c.mileageCap ?? null,
    mileageOverageRate: c.mileageOverageRate ? Number(c.mileageOverageRate) : 0.5,
    securityDeposit: c.securityDeposit ? Number(c.securityDeposit) : null,
    insuranceIncluded: c.insuranceIncluded ?? false,
    maintenanceIncluded: c.maintenanceIncluded ?? false,
    driverIncluded: c.driverIncluded ?? false,
    vehicles: (c.vehicles ?? []).map((v) => ({
      vehicleType: v.vehicleType,
      make: v.make,
      model: v.model,
      year: v.year,
      monthlyRate: v.monthlyRate ? Number(v.monthlyRate) : null,
    })),
    lessee: lessee ? { name: lessee.name, type: lessee.type } : null,
  };
}

async function tool_get_payment_schedule(contractId: string) {
  const c = await prisma.leaseContract2.findUnique({
    where: { id: contractId },
    select: { lesseeId: true, contractNumber: true },
  });
  if (!c) return { error: 'Contract not found' };

  const invoices = await prisma.leaseInvoice.findMany({
    where: { lesseeId: c.lesseeId },
    orderBy: { issueDate: 'asc' },
  });

  return {
    contractNumber: c.contractNumber,
    invoices: invoices.map(i => ({
      invoiceNo: i.invoiceNo,
      issueDate: i.issueDate.toISOString().slice(0, 10),
      dueDate: i.dueDate.toISOString().slice(0, 10),
      totalAmount: Number(i.totalAmount),
      status: i.status,
      paidAt: i.paidAt ? i.paidAt.toISOString().slice(0, 10) : null,
    })),
  };
}

async function tool_get_mileage_history(contractId: string) {
  const readings = await prisma.leaseMileageReading.findMany({
    where: { contractId },
    orderBy: { readingDate: 'asc' },
  });
  const overages = await prisma.leaseMileageOverage.findMany({
    where: { contractId },
    orderBy: { periodTo: 'asc' },
  });
  const contract = await prisma.leaseContract2.findUnique({
    where: { id: contractId },
    select: { mileageCap: true, startDate: true, endDate: true },
  });

  // Compute current usage so the model can answer "how many km left?"
  const delivery = readings.find(r => r.readingType === 'DELIVERY');
  const latest = readings.length > 0 ? readings[readings.length - 1] : null;
  const kmUsedSinceDelivery = delivery && latest && latest.id !== delivery.id
    ? latest.mileage - delivery.mileage
    : null;

  return {
    mileageCapPerMonth: contract?.mileageCap ?? null,
    readings: readings.map(r => ({
      readingDate: r.readingDate.toISOString().slice(0, 10),
      readingType: r.readingType,
      mileage: r.mileage,
    })),
    overages: overages.map(o => ({
      periodFrom: o.periodFrom.toISOString().slice(0, 10),
      periodTo: o.periodTo.toISOString().slice(0, 10),
      allowedKm: o.allowedKm,
      actualKm: o.actualKm,
      overageKm: o.overageKm,
      ratePerKm: Number(o.ratePerKm),
      overageAmount: Number(o.overageAmount),
      status: o.status,
      invoiceRef: o.invoiceRef,
    })),
    summary: {
      kmUsedSinceDelivery,
      latestReadingDate: latest?.readingDate.toISOString().slice(0, 10) ?? null,
    },
  };
}

async function tool_get_invoices(contractId: string) {
  const c = await prisma.leaseContract2.findUnique({
    where: { id: contractId },
    select: { lesseeId: true },
  });
  if (!c) return { error: 'Contract not found' };

  const invoices = await prisma.leaseInvoice.findMany({
    where: { lesseeId: c.lesseeId },
    include: { lines: true },
    orderBy: { issueDate: 'desc' },
  });

  const totalIssued = invoices.reduce((s, i) => s + Number(i.totalAmount ?? 0), 0);
  const totalPaid = invoices
    .filter(i => i.status === 'PAID')
    .reduce((s, i) => s + Number(i.totalAmount ?? 0), 0);
  const outstanding = totalIssued - totalPaid;

  return {
    summary: { totalIssued, totalPaid, outstanding, count: invoices.length },
    invoices: invoices.slice(0, 20).map(i => ({
      invoiceNo: i.invoiceNo,
      issueDate: i.issueDate.toISOString().slice(0, 10),
      dueDate: i.dueDate.toISOString().slice(0, 10),
      total: Number(i.totalAmount),
      status: i.status,
      lineCount: i.lines?.length ?? 0,
    })),
  };
}

async function tool_get_lessee(contractId: string) {
  const c = await prisma.leaseContract2.findUnique({
    where: { id: contractId },
    select: { lesseeId: true },
  });
  if (!c) return { error: 'Contract not found' };
  const l = await prisma.lessee.findUnique({ where: { id: c.lesseeId } });
  if (!l) return { error: 'Lessee not found' };
  return {
    name: l.name,
    type: l.type,
    tradeLicense: l.tradeLicense,
    emiratesId: l.emiratesId,
    nationality: l.nationality,
    email: l.email,
    phone: l.phone,
    address: l.address,
  };
}

const TOOL_IMPLS: Record<string, (contractId: string) => Promise<unknown>> = {
  get_contract: tool_get_contract,
  get_payment_schedule: tool_get_payment_schedule,
  get_mileage_history: tool_get_mileage_history,
  get_invoices: tool_get_invoices,
  get_lessee: tool_get_lessee,
};

/* ── Agent loop ──────────────────────────────────────────────────────────── */

const SYSTEM_PROMPT = `You are a helpful assistant for a UAE vehicle leasing platform. Your job is to answer questions about a specific lease contract.

You have tools to look up the contract, its payment schedule, mileage history, invoices, and the lessee (customer). Always call tools to get factual data — never make up dates, amounts, or numbers.

Rules:
1. Answer in the same language as the question (English, Arabic, or both if the user uses both).
2. Be concise. Lead with the direct answer, then 1-2 supporting facts. Avoid long explanations unless asked.
3. All money is in AED unless the contract uses a different currency.
4. Quote dates as DD MMM YYYY (e.g. "15 Aug 2026") — UAE convention.
5. If a tool returns { error: ... }, tell the user the data isn't available rather than guessing.
6. If you're asked about a topic outside the contract scope (e.g. "who is the CEO?"), politely redirect.
7. If the question is ambiguous about which contract, the contractId in the user message is the one to use.
8. NEVER expose raw IDs (UUIDs) in answers — use contract numbers, invoice numbers, etc.`;

export interface QAResult {
  ok: true;
  answer: string;
  toolsCalled: string[];
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}
export interface QAError {
  ok: false;
  error: string;
  detail?: unknown;
}

export async function answerContractQuestion(
  contractId: string,
  question: string,
): Promise<QAResult | QAError> {
  if (!hasOpenAI) {
    return { ok: false, error: 'Contract Q&A unavailable — OPENAI_API_KEY not configured.' };
  }
  if (!question || question.trim().length < 3) {
    return { ok: false, error: 'Question is too short.' };
  }

  const t0 = Date.now();
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const toolsCalled: string[] = [];

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Contract ID: ${contractId}\n\nQuestion: ${question.trim()}` },
  ];

  // Tool-calling loop. Cap at 4 iterations to avoid runaway.
  let iterations = 0;
  let promptTokensTotal = 0;
  let completionTokensTotal = 0;
  let modelUsed = 'gpt-4o-mini';

  try {
    while (iterations < 4) {
      iterations += 1;
      const completion = await client.chat.completions.create({
        model: 'gpt-4o-mini', // cost-effective; switches to 4o if needed in future
        messages,
        tools: TOOLS,
        tool_choice: 'auto',
        temperature: 0.1,
        max_tokens: 800,
      });

      modelUsed = completion.model;
      promptTokensTotal += completion.usage?.prompt_tokens ?? 0;
      completionTokensTotal += completion.usage?.completion_tokens ?? 0;

      const msg = completion.choices[0]?.message;
      if (!msg) {
        return { ok: false, error: 'Empty response from model.' };
      }

      // Tool calls requested → execute and loop.
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        messages.push(msg);
        for (const call of msg.tool_calls) {
          const fnName = call.function.name;
          const impl = TOOL_IMPLS[fnName];
          toolsCalled.push(fnName);
          let result: unknown;
          if (!impl) {
            result = { error: `Unknown tool: ${fnName}` };
          } else {
            try {
              // All our tools take a single contractId; ignore extra args.
              result = await impl(contractId);
            } catch (err) {
              result = { error: err instanceof Error ? err.message : String(err) };
            }
          }
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result),
          });
        }
        continue;
      }

      // No more tool calls → final answer.
      return {
        ok: true,
        answer: msg.content ?? '',
        toolsCalled,
        modelUsed,
        promptTokens: promptTokensTotal,
        completionTokens: completionTokensTotal,
        durationMs: Date.now() - t0,
      };
    }

    return { ok: false, error: 'Tool-calling loop exceeded 4 iterations.' };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'OpenAI API error',
      detail: err,
    };
  }
}
