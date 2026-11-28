/**
 * Runtime FSM Automation Execution Engine
 *
 * Executes every rule configured in Admin → Service Configuration → Automation
 * (`service_rules` category = 'automation'):
 *   1. AI Classification & Priority Calibration (deterministic fast-path + optional Gemini Flash)
 *   2. AI Routing & Auto-Assignment (maps to active tenant departments & default assignee)
 *   3. Auto Status Update (advances status on create / assign / approve without bypassing approvals)
 *   4. Multi-Channel Notification Fan-Out (Email via Resend/SMTP, WhatsApp & SMS via Twilio)
 *   5. Scheduled Sweeps:
 *      - Auto-Closure after configurable quiet period on Resolved / Completed tickets
 *      - Periodic Reminder Notifications to assignees on open tickets (idempotent interval guard)
 *
 * Zero schema migrations required: per-ticket automation metadata is persisted inside
 * `service_tickets.custom_fields.automation` and every transition is appended to `history`
 * and written to `logAudit`.
 */

import { prisma } from '@/lib/prisma';
import { sendEmail } from '@/lib/email';
import { sendWhatsApp } from '@/lib/whatsapp';
import { sendSms } from '@/lib/sms';
import { aiGateway } from '@/lib/agents/gateway';
import { logAudit } from '@/lib/audit';
import { loadServiceConfig, type ResolvedServiceConfig } from '@/lib/service-config/load';
import type { ResolvedDepartment } from '@/lib/service-tickets/departments';
import {
  DEFAULT_AUTOMATION_RULES,
  type AutomationRules,
  type TicketingRules,
} from '@/types/service-rules';
import type { TicketPriority } from '@/types/service-tickets';

export interface TicketAutomationMeta {
  aiTags?: string[];
  aiMethod?: 'DETERMINISTIC' | 'GEMINI';
  aiConfidence?: number;
  aiSuggestedPriority?: TicketPriority | null;
  aiSuggestedDepartment?: string | null;
  autoRoutedDepartment?: string | null;
  autoAssignedTo?: string | null;
  autoStatusAdvancedTo?: string | null;
  lastReminderAt?: string | null;
  reminderCount?: number;
  autoClosedAt?: string | null;
}

export interface ClassificationResult {
  tags: string[];
  suggestedDepartment: string | null;
  suggestedPriority: TicketPriority | null;
  confidence: number;
  method: 'DETERMINISTIC' | 'GEMINI';
}

export interface RoutingResult {
  department: string;
  routed: boolean;
  assignedTo: string | null;
  autoAssigned: boolean;
  reason?: string;
}

export interface ChannelDispatchOutcome {
  channel: 'email' | 'whatsapp' | 'sms';
  attempted: boolean;
  sent: boolean;
  recipient?: string | null;
  reason?: string;
}

export interface NotificationDispatchSummary {
  event: AutomationNotificationEvent;
  email: ChannelDispatchOutcome;
  whatsapp: ChannelDispatchOutcome;
  sms: ChannelDispatchOutcome;
}

export type AutomationNotificationEvent =
  | 'CREATED'
  | 'STATUS_CHANGED'
  | 'ASSIGNED'
  | 'FORWARDED'
  | 'REMINDER'
  | 'AUTO_CLOSED';

export interface AutomationSweepAutoClosedItem {
  id: string;
  readableId: string | null;
  ticketType: string;
  title: string;
  inactiveHours: number;
  thresholdHours: number;
}

export interface AutomationSweepReminderItem {
  id: string;
  readableId: string | null;
  ticketType: string;
  title: string;
  assignedTo: string | null;
  hoursSinceActivity: number;
  intervalHours: number;
  channels: {
    email: boolean;
    whatsapp: boolean;
    sms: boolean;
  };
}

export interface AutomationSweepReport {
  tenantId: string;
  dryRun: boolean;
  executedAt: string;
  evaluatedTickets: number;
  autoClosedCount: number;
  remindersSentCount: number;
  autoClosed: AutomationSweepAutoClosedItem[];
  remindersSent: AutomationSweepReminderItem[];
}

const PRIORITY_RANK: Record<TicketPriority, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CLOSED_OR_TERMINAL_STATUSES = new Set(['Resolved', 'Completed', 'Closed', 'Rejected']);
const AUTO_CLOSE_ELIGIBLE_STATUSES = new Set(['Resolved', 'Completed']);

/** Merge partial rule JSON safely with platform defaults. */
export function resolveAutomationRules(
  rules?: Partial<AutomationRules> | null,
): AutomationRules {
  return {
    ...DEFAULT_AUTOMATION_RULES,
    ...(rules ?? {}),
  };
}

/** Return the higher of two priorities (never downgrades a user/catalog priority). */
export function maxPriority(a: TicketPriority, b: TicketPriority | null | undefined): TicketPriority {
  if (!b) return a;
  return PRIORITY_RANK[b] > PRIORITY_RANK[a] ? b : a;
}

// ── 1. Deterministic + Optional Gemini AI Classification ─────────────────────

interface KeywordClassifierRule {
  tag: string;
  department: string;
  priority: TicketPriority | null;
  patterns: RegExp[];
}

const CLASSIFIER_RULES: KeywordClassifierRule[] = [
  {
    tag: 'urgent-safety',
    department: 'FM_HARD_SERVICES',
    priority: 'Critical',
    patterns: [
      /\b(trapped|entrapment|stuck in lift|stuck in elevator)\b/i,
      /\b(fire|smoke|burning smell|gas leak|electrocution|sparks|short circuit)\b/i,
      /(حريق|دخان|تسرب غاز|محصور|انفجار)/i,
    ],
  },
  {
    tag: 'accident-safety',
    department: 'SAFETY_COMPLIANCE',
    priority: 'Critical',
    patterns: [
      /\b(accident|collision|crash|injury|police report|saed|saeed)\b/i,
      /(حادث|صدمة|تقرير شرطة|إصابة)/i,
    ],
  },
  {
    tag: 'breakdown-recovery',
    department: 'RECOVERY_DISPATCH',
    priority: 'High',
    patterns: [
      /\b(towing|flatbed|recovery|breakdown|broke down|won't start|stranded)\b/i,
      /(سحب|ونش|ريكفري|تعطلت|gari band)/i,
    ],
  },
  {
    tag: 'hvac',
    department: 'FM_HARD_SERVICES',
    priority: 'High',
    patterns: [
      /\b(hvac|air\s*conditioning|chiller|thermostat|no cooling|too hot|ac\s+(fault|leak|not working|down))\b/i,
      /(تكييف|مكيف)/i,
    ],
  },
  {
    tag: 'electrical',
    department: 'FM_HARD_SERVICES',
    priority: 'High',
    patterns: [
      /\b(power outage|no power|blackout|breaker|tripped|electrical|lighting|socket|generator)\b/i,
      /(كهرباء|انقطاع التيار)/i,
    ],
  },
  {
    tag: 'plumbing',
    department: 'FM_HARD_SERVICES',
    priority: 'High',
    patterns: [
      /\b(water leak|plumbing|flood|burst pipe|blocked drain|no water|washroom leak|sewage)\b/i,
      /(تسرب مياه|سباكة|انسداد)/i,
    ],
  },
  {
    tag: 'lift',
    department: 'FM_HARD_SERVICES',
    priority: 'High',
    patterns: [/\b(lift|elevator|escalator)\b/i, /(مصعد|سلم كهربائي)/i],
  },
  {
    tag: 'fire-safety',
    department: 'FM_HARD_SERVICES',
    priority: 'Critical',
    patterns: [/\b(fire alarm|sprinkler|extinguisher|smoke detector|emergency exit)\b/i],
  },
  {
    tag: 'cleaning',
    department: 'FM_SOFT_SERVICES',
    priority: null,
    patterns: [/\b(cleaning|spill|sanitiz|housekeeping|pantry|washroom clean)\b/i, /(تنظيف|نظافة)/i],
  },
  {
    tag: 'pest-control',
    department: 'FM_SOFT_SERVICES',
    priority: null,
    patterns: [/\b(pest|rodent|cockroach|insects|termite|fumigat)\b/i, /(مكافحة حشرات|حشرات)/i],
  },
  {
    tag: 'waste',
    department: 'FM_SOFT_SERVICES',
    priority: null,
    patterns: [/\b(waste|garbage|bin collection|recycling|bulky item)\b/i],
  },
  {
    tag: 'workplace',
    department: 'FM_WORKPLACE',
    priority: null,
    patterns: [/\b(meeting room|access card|badge|parking|desk move|furniture|relocation)\b/i],
  },
  {
    tag: 'security',
    department: 'FM_SECURITY_SAFETY',
    priority: 'High',
    patterns: [/\b(cctv|camera|security breach|unauthorized|gate barrier|door lock)\b/i],
  },
  {
    tag: 'maintenance',
    department: 'WORKSHOP_MAINTENANCE',
    priority: null,
    patterns: [/\b(brake|engine|overheat|puncture|flat tyre|flat tire|oil leak|battery|workshop)\b/i, /(بنشر|فرامل|محرك)/i],
  },
];

/** Deterministic fast-path ticket classifier ($0, <1ms, works offline). */
export function classifyTicketDeterministic(input: {
  ticketType: string;
  title: string;
  description?: string | null;
  currentPriority: TicketPriority;
}): ClassificationResult {
  const haystack = `${input.title} ${input.description ?? ''}`.trim();
  const tags = new Set<string>();
  let suggestedDepartment: string | null = null;
  let suggestedPriority: TicketPriority | null = null;

  for (const rule of CLASSIFIER_RULES) {
    if (rule.patterns.some((re) => re.test(haystack))) {
      tags.add(rule.tag);
      if (!suggestedDepartment) suggestedDepartment = rule.department;
      if (rule.priority) {
        suggestedPriority = suggestedPriority
          ? maxPriority(suggestedPriority, rule.priority)
          : rule.priority;
      }
    }
  }

  // Fallback tag derived from ticket type key (e.g. FM_HVAC -> fm-hvac)
  if (tags.size === 0 && input.ticketType) {
    tags.add(input.ticketType.toLowerCase().replace(/_/g, '-'));
  }

  const confidence = suggestedDepartment ? (tags.size >= 2 ? 0.92 : 0.85) : 0.55;
  return {
    tags: Array.from(tags).slice(0, 6),
    suggestedDepartment,
    suggestedPriority,
    confidence,
    method: 'DETERMINISTIC',
  };
}

/**
 * Classifies a ticket using the deterministic fast-path first, optionally calling
 * Gemini Flash via aiGateway when deterministic confidence is low and an API key exists.
 * Never throws — always returns a valid ClassificationResult.
 */
export async function classifyTicketWithAi(input: {
  tenantId?: string;
  ticketType: string;
  title: string;
  description?: string | null;
  currentPriority: TicketPriority;
  availableDepartments: string[];
}): Promise<ClassificationResult> {
  const base = classifyTicketDeterministic(input);
  const hasAiKey = Boolean(
    process.env.GOOGLE_AI_API_KEY || process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY,
  );
  if (base.confidence >= 0.85 || !hasAiKey || process.env.NODE_ENV === 'test') {
    return base;
  }

  try {
    const systemPrompt =
      'You classify enterprise Fleet & Field Service tickets into strict JSON: {"tags": string[], "suggestedDepartment": string|null, "suggestedPriority": "Low"|"Medium"|"High"|"Critical"|null, "confidence": number}.';
    const userPrompt = [
      `Ticket Type: ${input.ticketType}`,
      `Title: ${input.title}`,
      `Description: ${input.description ?? ''}`,
      `Current Priority: ${input.currentPriority}`,
      `Available Departments: ${input.availableDepartments.join(', ')}`,
    ].join('\n');

    const res = await aiGateway.chat(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      {
        capabilityAlias: 'ECONOMY_TEXT',
        responseFormat: 'json',
        tenantId: input.tenantId,
        agentId: 'fsm-automation-engine',
        eventType: 'FSM_TICKET_CLASSIFY',
      },
    );

    let cleaned = res.content.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```\s*/, '').replace(/\s*```$/, '');

    const ai = JSON.parse(cleaned) as {
      tags?: unknown[];
      suggestedDepartment?: string | null;
      suggestedPriority?: string | null;
      confidence?: number;
    };

    const validPriorities = new Set<TicketPriority>(['Low', 'Medium', 'High', 'Critical']);
    const aiPriority =
      ai?.suggestedPriority && validPriorities.has(ai.suggestedPriority as TicketPriority)
        ? (ai.suggestedPriority as TicketPriority)
        : null;
    const aiDept =
      ai?.suggestedDepartment && input.availableDepartments.includes(ai.suggestedDepartment)
        ? ai.suggestedDepartment
        : base.suggestedDepartment;
    const mergedTags = Array.from(
      new Set([
        ...base.tags,
        ...(Array.isArray(ai?.tags)
          ? ai.tags
              .filter((t: unknown): t is string => typeof t === 'string' && t.trim().length > 0)
              .map((t: string) => t.trim().toLowerCase().slice(0, 32))
          : []),
      ]),
    ).slice(0, 6);

    return {
      tags: mergedTags,
      suggestedDepartment: aiDept,
      suggestedPriority: aiPriority ?? base.suggestedPriority,
      confidence: typeof ai?.confidence === 'number' && ai.confidence > 0 ? Math.min(1, ai.confidence) : 0.78,
      method: 'GEMINI',
    };
  } catch {
    return base;
  }
}

// ── 2. AI Routing & Auto-Assignment ─────────────────────────────────────────

const TYPE_TO_PREFERRED_DEPARTMENTS: Record<string, string[]> = {
  // Facilities Management (Hard Services)
  FM_HVAC: ['FM_HARD_SERVICES', 'WORKSHOP_MAINTENANCE'],
  FM_ELECTRICAL: ['FM_HARD_SERVICES', 'WORKSHOP_MAINTENANCE'],
  FM_PLUMBING: ['FM_HARD_SERVICES', 'WORKSHOP_MAINTENANCE'],
  FM_LIFT: ['FM_HARD_SERVICES'],
  FM_FIRE_SAFETY: ['FM_HARD_SERVICES', 'FM_SECURITY_SAFETY', 'SAFETY_COMPLIANCE'],
  FM_FABRIC: ['FM_HARD_SERVICES'],
  // Facilities Management (Soft Services)
  FM_CLEANING: ['FM_SOFT_SERVICES', 'FACILITIES_CLEANING'],
  FM_PEST: ['FM_SOFT_SERVICES', 'FACILITIES_CLEANING'],
  FM_WASTE: ['FM_SOFT_SERVICES', 'FACILITIES_CLEANING'],
  FM_LANDSCAPING: ['FM_SOFT_SERVICES', 'FACILITIES_CLEANING'],
  // Facilities Management (Workplace)
  FM_MOVE: ['FM_WORKPLACE', 'CUSTOMER_SERVICE'],
  FM_MEETING_ROOM: ['FM_WORKPLACE', 'CUSTOMER_SERVICE'],
  FM_ACCESS_CARD: ['FM_WORKPLACE', 'FM_SECURITY_SAFETY'],
  FM_PARKING: ['FM_WORKPLACE', 'FM_SECURITY_SAFETY'],
  // Facilities Management (Security & Safety)
  FM_SECURITY: ['FM_SECURITY_SAFETY', 'SAFETY_COMPLIANCE'],
  FM_CCTV: ['FM_SECURITY_SAFETY', 'SAFETY_COMPLIANCE'],
  // Core Fleet / System types
  TOWING: ['RECOVERY_DISPATCH'],
  MAINTENANCE: ['WORKSHOP_MAINTENANCE'],
  INCIDENT: ['SAFETY_COMPLIANCE'],
  CLEANING: ['FACILITIES_CLEANING', 'FM_SOFT_SERVICES'],
  COMPLAINT: ['CUSTOMER_SERVICE'],
  SUPPORT: ['CUSTOMER_SERVICE'],
  RENEWAL: ['CUSTOMER_SERVICE'],
};

/**
 * Pure routing resolver: maps a ticket sitting in OPERATIONS_TRIAGE to the best active
 * tenant department and optionally assigns `ticketingRules.defaultAssignee`.
 */
export function resolveAutomationRouting(input: {
  ticketType: string;
  currentDepartment: string;
  currentAssignee: string | null;
  availableDepartments: Pick<ResolvedDepartment, 'key' | 'isActive'>[];
  ticketingRules?: Partial<TicketingRules> | null;
  aiRoutingEnabled: boolean;
  aiSuggestedDepartment?: string | null;
}): RoutingResult {
  const activeSet = new Set(
    input.availableDepartments.filter((d) => d.isActive !== false).map((d) => d.key),
  );

  let department = input.currentDepartment || 'OPERATIONS_TRIAGE';
  let routed = false;
  let reason: string | undefined;

  if (input.aiRoutingEnabled && department === 'OPERATIONS_TRIAGE') {
    const candidates: string[] = [];
    if (input.aiSuggestedDepartment && input.aiSuggestedDepartment !== 'OPERATIONS_TRIAGE') {
      candidates.push(input.aiSuggestedDepartment);
    }
    const byType = TYPE_TO_PREFERRED_DEPARTMENTS[input.ticketType];
    if (byType) candidates.push(...byType);
    if (input.ticketType.startsWith('FSM_')) {
      candidates.push('FM_HARD_SERVICES', 'WORKSHOP_MAINTENANCE', 'CUSTOMER_SERVICE');
    } else if (input.ticketType.startsWith('FM_')) {
      candidates.push('FM_HARD_SERVICES', 'FM_SOFT_SERVICES');
    }

    const chosen = candidates.find((c) => activeSet.has(c) && c !== 'OPERATIONS_TRIAGE');
    if (chosen) {
      department = chosen;
      routed = true;
      reason =
        chosen === input.aiSuggestedDepartment
          ? `AI-routed to ${chosen}`
          : `Auto-routed ${input.ticketType} to ${chosen}`;
    }
  }

  let assignedTo = input.currentAssignee?.trim() || null;
  let autoAssigned = false;
  const shouldAutoAssign = Boolean(input.aiRoutingEnabled || input.ticketingRules?.autoAssignment);
  const defaultAssignee = input.ticketingRules?.defaultAssignee?.trim() || null;
  if (shouldAutoAssign && !assignedTo && defaultAssignee && EMAIL_RE.test(defaultAssignee)) {
    assignedTo = defaultAssignee;
    autoAssigned = true;
  }

  return { department, routed, assignedTo, autoAssigned, reason };
}

// ── 3. Auto Status Update ───────────────────────────────────────────────────

/**
 * Computes automated status advancement on ticket creation.
 * Never bypasses 'Awaiting Approval'.
 */
export function computeAutoStatusOnCreate(input: {
  initialStatus: string;
  assignedDepartment: string;
  assignedTo: string | null;
  autoStatusUpdate: boolean;
}): string {
  if (!input.autoStatusUpdate) return input.initialStatus;
  if (input.initialStatus !== 'Pending') return input.initialStatus;
  if (input.assignedDepartment === 'OPERATIONS_TRIAGE') return input.initialStatus;
  return input.assignedTo ? 'Assigned' : 'Acknowledged';
}

/**
 * Computes automated status advancement on ticket PATCH.
 * Respects Triage governance and approval gates.
 */
export function computeAutoStatusOnUpdate(input: {
  currentStatus: string;
  requestedStatus?: string;
  prevAssignedTo: string | null;
  nextAssignedTo: string | null;
  assignedDepartment: string;
  autoStatusUpdate: boolean;
}): string | undefined {
  if (!input.autoStatusUpdate) return input.requestedStatus;
  if (input.assignedDepartment === 'OPERATIONS_TRIAGE') return input.requestedStatus;

  // Approving a ticket that already has an assignee advances straight to Assigned.
  if (
    input.currentStatus === 'Awaiting Approval' &&
    input.requestedStatus === 'Pending' &&
    input.nextAssignedTo
  ) {
    return 'Assigned';
  }

  // Setting an assignee on an open Pending/Acknowledged ticket advances to Assigned.
  const newlyAssigned = Boolean(
    input.nextAssignedTo && input.nextAssignedTo.trim() !== (input.prevAssignedTo ?? '').trim(),
  );
  if (
    newlyAssigned &&
    !input.requestedStatus &&
    (input.currentStatus === 'Pending' || input.currentStatus === 'Acknowledged')
  ) {
    return 'Assigned';
  }

  return input.requestedStatus;
}

// ── 4. Pure Sweep Evaluators (Auto-Closure & Reminders) ─────────────────────

export function evaluateTicketForAutoClosure(input: {
  status: string;
  updatedAt: string | Date;
  rules: AutomationRules;
  now?: Date;
}): { eligible: boolean; inactiveHours: number; thresholdHours: number } {
  const threshold = Number(input.rules.autoClosureAfterHours ?? 0);
  if (!input.rules.autoClosure || !Number.isFinite(threshold) || threshold <= 0) {
    return { eligible: false, inactiveHours: 0, thresholdHours: threshold };
  }
  if (!AUTO_CLOSE_ELIGIBLE_STATUSES.has(input.status)) {
    return { eligible: false, inactiveHours: 0, thresholdHours: threshold };
  }
  const now = input.now ?? new Date();
  const updatedMs = new Date(input.updatedAt).getTime();
  if (!Number.isFinite(updatedMs)) {
    return { eligible: false, inactiveHours: 0, thresholdHours: threshold };
  }
  const inactiveHours = Math.max(0, (now.getTime() - updatedMs) / 3_600_000);
  return {
    eligible: inactiveHours >= threshold,
    inactiveHours: Math.round(inactiveHours * 10) / 10,
    thresholdHours: threshold,
  };
}

export function evaluateTicketForReminder(input: {
  status: string;
  createdAt: string | Date;
  updatedAt: string | Date;
  lastReminderAt?: string | Date | null;
  rules: AutomationRules;
  now?: Date;
}): { eligible: boolean; hoursSinceActivity: number; intervalHours: number } {
  const interval = Number(input.rules.reminderIntervalHours ?? 0);
  if (!input.rules.reminderNotifications || !Number.isFinite(interval) || interval <= 0) {
    return { eligible: false, hoursSinceActivity: 0, intervalHours: interval };
  }
  if (CLOSED_OR_TERMINAL_STATUSES.has(input.status)) {
    return { eligible: false, hoursSinceActivity: 0, intervalHours: interval };
  }
  const now = input.now ?? new Date();
  const anchorRaw = input.lastReminderAt || input.updatedAt || input.createdAt;
  const anchorMs = new Date(anchorRaw).getTime();
  if (!Number.isFinite(anchorMs)) {
    return { eligible: false, hoursSinceActivity: 0, intervalHours: interval };
  }
  const hoursSinceActivity = Math.max(0, (now.getTime() - anchorMs) / 3_600_000);
  return {
    eligible: hoursSinceActivity >= interval,
    hoursSinceActivity: Math.round(hoursSinceActivity * 10) / 10,
    intervalHours: interval,
  };
}

// ── 5. Multi-Channel Notification Fan-Out (Email / WhatsApp / SMS) ──────────

function buildNotificationCopy(input: {
  event: AutomationNotificationEvent;
  readableId: string;
  title: string;
  status: string;
  priority: string;
  serviceTypeName: string;
  assignedDepartment?: string | null;
  assignedTo?: string | null;
  note?: string | null;
}): { subject: string; body: string } {
  const ref = input.readableId;
  switch (input.event) {
    case 'CREATED':
      return {
        subject: `[Fleet360 FSM] New ${input.serviceTypeName} ${ref} (${input.priority})`,
        body: `New ${input.serviceTypeName} ticket ${ref}: "${input.title}" (Priority: ${input.priority}, Status: ${input.status}${input.assignedDepartment ? `, Dept: ${input.assignedDepartment}` : ''}).`,
      };
    case 'ASSIGNED':
      return {
        subject: `[Fleet360 FSM] Ticket ${ref} assigned`,
        body: `Ticket ${ref} ("${input.title}") has been assigned to ${input.assignedTo ?? 'your team'} (Priority: ${input.priority}, Status: ${input.status}).`,
      };
    case 'FORWARDED':
      return {
        subject: `[Fleet360 FSM] Ticket ${ref} forwarded to ${input.assignedDepartment ?? 'operations'}`,
        body: `Ticket ${ref} ("${input.title}") was forwarded to ${input.assignedDepartment ?? 'operations'}${input.assignedTo ? ` (${input.assignedTo})` : ''}.${input.note ? ` Note: ${input.note}` : ''}`,
      };
    case 'REMINDER':
      return {
        subject: `[Fleet360 FSM] Reminder: Open ticket ${ref} awaiting action`,
        body: `Reminder: ${input.serviceTypeName} ticket ${ref} ("${input.title}") is still ${input.status} (Priority: ${input.priority}). Please review and update.`,
      };
    case 'AUTO_CLOSED':
      return {
        subject: `[Fleet360 FSM] Ticket ${ref} automatically closed`,
        body: `Ticket ${ref} ("${input.title}") has been automatically closed after inactivity following resolution.${input.note ? ` ${input.note}` : ''}`,
      };
    case 'STATUS_CHANGED':
    default:
      return {
        subject: `[Fleet360 FSM] Ticket ${ref} status updated to ${input.status}`,
        body: `Ticket ${ref} ("${input.title}") is now ${input.status} (Priority: ${input.priority}).${input.note ? ` ${input.note}` : ''}`,
      };
  }
}

export interface NotificationDispatchDeps {
  sendEmailFn?: typeof sendEmail;
  sendWhatsAppFn?: typeof sendWhatsApp;
  sendSmsFn?: typeof sendSms;
}

/**
 * Best-effort fan-out honoring the service type's Automation notification toggles
 * (`emailNotifications`, `whatsappNotifications`, `smsNotifications`) and
 * `mapping.notificationEngineEnabled`. Never throws into request handlers.
 */
export async function dispatchTicketAutomationNotifications(
  input: {
    event: AutomationNotificationEvent;
    rules: AutomationRules;
    notificationEngineEnabled?: boolean;
    readableId: string;
    title: string;
    status: string;
    priority: string;
    serviceTypeName: string;
    assignedDepartment?: string | null;
    assignedTo?: string | null;
    recipientEmails?: Array<string | null | undefined>;
    recipientPhone?: string | null;
    note?: string | null;
  },
  deps: NotificationDispatchDeps = {},
): Promise<NotificationDispatchSummary> {
  const skipped = (channel: 'email' | 'whatsapp' | 'sms', reason: string): ChannelDispatchOutcome => ({
    channel,
    attempted: false,
    sent: false,
    reason,
  });

  if (input.notificationEngineEnabled === false) {
    return {
      event: input.event,
      email: skipped('email', 'notification_engine_disabled'),
      whatsapp: skipped('whatsapp', 'notification_engine_disabled'),
      sms: skipped('sms', 'notification_engine_disabled'),
    };
  }

  const copy = buildNotificationCopy(input);
  const emails = Array.from(
    new Set(
      [input.assignedTo, ...(input.recipientEmails ?? [])]
        .map((e) => (typeof e === 'string' ? e.trim() : ''))
        .filter((e) => EMAIL_RE.test(e)),
    ),
  );
  const phone = typeof input.recipientPhone === 'string' ? input.recipientPhone.trim() : '';

  const emailSender = deps.sendEmailFn ?? sendEmail;
  const waSender = deps.sendWhatsAppFn ?? sendWhatsApp;
  const smsSender = deps.sendSmsFn ?? sendSms;

  const emailPromise: Promise<ChannelDispatchOutcome> = !input.rules.emailNotifications
    ? Promise.resolve(skipped('email', 'toggle_disabled'))
    : emails.length === 0
      ? Promise.resolve(skipped('email', 'no_recipient'))
      : emailSender({ to: emails, subject: copy.subject, text: copy.body })
          .then((r) => ({
            channel: 'email' as const,
            attempted: true,
            sent: r.sent,
            recipient: emails.join(', '),
            reason: r.reason,
          }))
          .catch((e) => ({
            channel: 'email' as const,
            attempted: true,
            sent: false,
            recipient: emails.join(', '),
            reason: e instanceof Error ? e.message : 'error',
          }));

  const waPromise: Promise<ChannelDispatchOutcome> = !input.rules.whatsappNotifications
    ? Promise.resolve(skipped('whatsapp', 'toggle_disabled'))
    : !phone
      ? Promise.resolve(skipped('whatsapp', 'no_phone'))
      : waSender({ to: phone, body: copy.body })
          .then((r) => ({
            channel: 'whatsapp' as const,
            attempted: true,
            sent: r.sent,
            recipient: phone,
            reason: r.reason,
          }))
          .catch((e) => ({
            channel: 'whatsapp' as const,
            attempted: true,
            sent: false,
            recipient: phone,
            reason: e instanceof Error ? e.message : 'error',
          }));

  const smsPromise: Promise<ChannelDispatchOutcome> = !input.rules.smsNotifications
    ? Promise.resolve(skipped('sms', 'toggle_disabled'))
    : !phone
      ? Promise.resolve(skipped('sms', 'no_phone'))
      : smsSender({ to: phone, body: copy.body })
          .then((r) => ({
            channel: 'sms' as const,
            attempted: true,
            sent: r.sent,
            recipient: phone,
            reason: r.reason,
          }))
          .catch((e) => ({
            channel: 'sms' as const,
            attempted: true,
            sent: false,
            recipient: phone,
            reason: e instanceof Error ? e.message : 'error',
          }));

  const [email, whatsapp, sms] = await Promise.all([emailPromise, waPromise, smsPromise]);
  return { event: input.event, email, whatsapp, sms };
}

// ── 6. Scheduled Tenant Sweep (Auto-Closure + Periodic Reminders) ───────────

interface SweepTicketRow {
  id: string;
  ticket_type: string;
  readable_id: string | null;
  title: string;
  priority: string;
  status: string;
  assigned_to: string | null;
  history: unknown;
  custom_fields: unknown;
  created_at: string;
  updated_at: string;
}

/**
 * Runs the FSM Automation Sweep for a single tenant (must be called inside `withTenantRls`).
 * Processes:
 *   1. Auto-Closure for Resolved/Completed tickets past `autoClosureAfterHours`.
 *   2. Periodic Reminders for open tickets past `reminderIntervalHours`.
 */
export async function runTicketAutomationSweep(
  tenantId: string,
  opts: { dryRun?: boolean; now?: Date; actorId?: string } = {},
): Promise<AutomationSweepReport> {
  const dryRun = Boolean(opts.dryRun);
  const now = opts.now ?? new Date();
  const actorId = opts.actorId ?? 'system:automation-engine';

  const rows = await prisma.$queryRawUnsafe<SweepTicketRow[]>(
    `SELECT id::text, ticket_type, readable_id, title, priority, status, assigned_to,
            history, custom_fields, created_at::text, updated_at::text
       FROM service_tickets
      WHERE tenant_id = $1
        AND deleted_at IS NULL
        AND status NOT IN ('Closed', 'Rejected')
      ORDER BY updated_at ASC
      LIMIT 500`,
    tenantId,
  );

  // Resolve service config once per distinct ticket_type present in this batch.
  const distinctTypes = Array.from(new Set(rows.map((r) => r.ticket_type)));
  const configMap = new Map<string, ResolvedServiceConfig | null>();
  await Promise.all(
    distinctTypes.map(async (tt) => {
      const cfg = await loadServiceConfig(tenantId, tt).catch(() => null);
      configMap.set(tt, cfg);
    }),
  );

  const autoClosed: AutomationSweepAutoClosedItem[] = [];
  const remindersSent: AutomationSweepReminderItem[] = [];

  for (const row of rows) {
    const cfg = configMap.get(row.ticket_type);
    if (!cfg) continue;

    const rules = resolveAutomationRules(cfg.rules.automation);
    const customFields: Record<string, unknown> =
      row.custom_fields && typeof row.custom_fields === 'object'
        ? { ...(row.custom_fields as Record<string, unknown>) }
        : {};
    const autoMeta: TicketAutomationMeta =
      customFields.automation && typeof customFields.automation === 'object'
        ? { ...(customFields.automation as TicketAutomationMeta) }
        : {};
    const readableId = row.readable_id ?? row.id.slice(0, 8);
    const contactEmail = typeof customFields.contactEmail === 'string' ? customFields.contactEmail : null;
    const contactMobile = typeof customFields.contactMobile === 'string' ? customFields.contactMobile : null;
    const assignedDepartment =
      typeof customFields.assignedDepartment === 'string' ? customFields.assignedDepartment : null;

    // A. Auto-Closure on Resolved / Completed tickets
    const closeEval = evaluateTicketForAutoClosure({
      status: row.status,
      updatedAt: row.updated_at,
      rules,
      now,
    });
    if (closeEval.eligible) {
      if (!dryRun) {
        const note = `Auto-closed by Automation Engine after ${closeEval.inactiveHours}h of inactivity (threshold: ${closeEval.thresholdHours}h).`;
        const nextHistory = [
          ...(Array.isArray(row.history) ? row.history : []),
          { status: 'Closed', date: now.toISOString(), actor: 'Automation Engine', note },
        ];
        const nextCustomFields = {
          ...customFields,
          automation: { ...autoMeta, autoClosedAt: now.toISOString() },
        };
        const updatedCount = await prisma.$executeRawUnsafe(
          `UPDATE service_tickets
              SET status = 'Closed',
                  history = $1::jsonb,
                  custom_fields = $2::jsonb,
                  updated_at = NOW()
            WHERE id = $3::uuid
              AND tenant_id = $4
              AND deleted_at IS NULL
              AND status IN ('Resolved', 'Completed')`,
          JSON.stringify(nextHistory),
          JSON.stringify(nextCustomFields),
          row.id,
          tenantId,
        );
        if (Number(updatedCount) > 0) {
          void logAudit({
            tenantId,
            userId: actorId,
            entityType: 'ServiceTicket',
            entityId: row.id,
            entityName: readableId,
            action: 'UPDATE',
            details: note,
          });
          await dispatchTicketAutomationNotifications({
            event: 'AUTO_CLOSED',
            rules,
            notificationEngineEnabled: cfg.mapping?.notificationEngineEnabled,
            readableId,
            title: row.title,
            status: 'Closed',
            priority: row.priority,
            serviceTypeName: cfg.type.name,
            assignedDepartment,
            assignedTo: row.assigned_to,
            recipientEmails: [contactEmail],
            recipientPhone: contactMobile,
            note,
          });
          autoClosed.push({
            id: row.id,
            readableId: row.readable_id,
            ticketType: row.ticket_type,
            title: row.title,
            inactiveHours: closeEval.inactiveHours,
            thresholdHours: closeEval.thresholdHours,
          });
        }
      } else {
        autoClosed.push({
          id: row.id,
          readableId: row.readable_id,
          ticketType: row.ticket_type,
          title: row.title,
          inactiveHours: closeEval.inactiveHours,
          thresholdHours: closeEval.thresholdHours,
        });
      }
      continue;
    }

    // B. Periodic Reminder Notifications on open tickets
    const remindEval = evaluateTicketForReminder({
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastReminderAt: autoMeta.lastReminderAt ?? null,
      rules,
      now,
    });
    if (remindEval.eligible) {
      let sentChannels = {
        email: rules.emailNotifications,
        whatsapp: rules.whatsappNotifications,
        sms: rules.smsNotifications,
      };
      if (!dryRun) {
        const nextCount = (Number(autoMeta.reminderCount) || 0) + 1;
        const note = `Periodic automation reminder #${nextCount} triggered after ${remindEval.hoursSinceActivity}h (interval: ${remindEval.intervalHours}h).`;
        const nextHistory = [
          ...(Array.isArray(row.history) ? row.history : []),
          { status: row.status, date: now.toISOString(), actor: 'Automation Engine', note },
        ];
        const nextCustomFields = {
          ...customFields,
          automation: {
            ...autoMeta,
            lastReminderAt: now.toISOString(),
            reminderCount: nextCount,
          },
        };
        // Claim reminder timestamp before sending notifications so concurrent sweeps cannot double-send.
        const claimed = await prisma.$executeRawUnsafe(
          `UPDATE service_tickets
              SET history = $1::jsonb,
                  custom_fields = $2::jsonb
            WHERE id = $3::uuid
              AND tenant_id = $4
              AND deleted_at IS NULL
              AND status NOT IN ('Resolved', 'Completed', 'Closed', 'Rejected')
              AND COALESCE(custom_fields -> 'automation' ->> 'lastReminderAt', '') = $5`,
          JSON.stringify(nextHistory),
          JSON.stringify(nextCustomFields),
          row.id,
          tenantId,
          autoMeta.lastReminderAt ?? '',
        );
        if (Number(claimed) > 0) {
          const delivery = await dispatchTicketAutomationNotifications({
            event: 'REMINDER',
            rules,
            notificationEngineEnabled: cfg.mapping?.notificationEngineEnabled,
            readableId,
            title: row.title,
            status: row.status,
            priority: row.priority,
            serviceTypeName: cfg.type.name,
            assignedDepartment,
            assignedTo: row.assigned_to,
            recipientEmails: [contactEmail],
            recipientPhone: contactMobile,
            note,
          });
          sentChannels = {
            email: delivery.email.sent,
            whatsapp: delivery.whatsapp.sent,
            sms: delivery.sms.sent,
          };
          void logAudit({
            tenantId,
            userId: actorId,
            entityType: 'ServiceTicket',
            entityId: row.id,
            entityName: readableId,
            action: 'UPDATE',
            details: note,
          });
          remindersSent.push({
            id: row.id,
            readableId: row.readable_id,
            ticketType: row.ticket_type,
            title: row.title,
            assignedTo: row.assigned_to,
            hoursSinceActivity: remindEval.hoursSinceActivity,
            intervalHours: remindEval.intervalHours,
            channels: sentChannels,
          });
        }
      } else {
        remindersSent.push({
          id: row.id,
          readableId: row.readable_id,
          ticketType: row.ticket_type,
          title: row.title,
          assignedTo: row.assigned_to,
          hoursSinceActivity: remindEval.hoursSinceActivity,
          intervalHours: remindEval.intervalHours,
          channels: sentChannels,
        });
      }
    }
  }

  return {
    tenantId,
    dryRun,
    executedAt: now.toISOString(),
    evaluatedTickets: rows.length,
    autoClosedCount: autoClosed.length,
    remindersSentCount: remindersSent.length,
    autoClosed,
    remindersSent,
  };
}
