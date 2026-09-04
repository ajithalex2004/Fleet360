/**
 * WhatsApp & Omnichannel NLP Ingestion Engine (Hybrid 2-Tier Architecture)
 *
 * Tier 1: Deterministic Fast Regex & Heuristic Parser ($0.00 / <5ms)
 *   - Extracts UAE vehicle plate numbers (Dubai, Abu Dhabi, Sharjah, Ajman, RAK, Fujairah, UAQ)
 *   - Matches emergency breakdown keywords (TOWING, PUNCTURE, AC, BRAKE, ACCIDENT, OVERHEAT)
 *
 * Tier 2: Google Gemini 2.0 Flash NLP Model (~$0.00005 / <300ms)
 *   - Contextual parsing of unstructured multilingual messages (Arabic, Urdu, English, Hindi, Tagalog)
 *   - Outputs typed JSON matching the Service Ticket schema
 *   - Graceful fallback to Tier 1 when offline or API key is unconfigured
 */

import { prisma } from '@/lib/prisma';
import { nextReadableId } from './schema';
import type { TicketType, TicketPriority } from '@/types/service-tickets';

export interface InboundMessageParams {
  from: string; // e.g. "whatsapp:+971501234567"
  body: string;
  customerName?: string | null;
  mediaUrl?: string | null;
  tenantId?: string;
}

export interface ParsedTicketIntent {
  ticketType: TicketType;
  priority: TicketPriority;
  title: string;
  description: string;
  extractedPlateNumber?: string | null;
  extractedLocation?: string | null;
  confidence: number; // 0.0 to 1.0
  tierUsed: 'TIER_1_REGEX' | 'TIER_2_GEMINI_FLASH' | 'FALLBACK';
  category: string;
  suggestedAutoReply: string;
}

// ── Robust UAE Vehicle Plate Extractor ─────────────────────────────────────────
export function extractUaePlateNumber(text: string): string | null {
  // 1. Explicit prefix: plate[:\s] [Emirate] [Code] [Number]
  const explicitMatch = text.match(
    /(?:plate\s*(?:no|number)?[:\s]+)(?:(Dubai|DXB|Abu\s*Dhabi|AUH|Sharjah|SHJ|Ajman|AJM|RAK|Ras\s*Al\s*Khaimah|Fujairah|FUJ|UAQ|Umm\s*Al\s*Quwain)\s*)?([A-Za-z]|\d{1,2})?\s*[-/]?\s*(\d{2,6})\b/i
  );
  if (explicitMatch) {
    const emirate = explicitMatch[1] ? explicitMatch[1].trim() : '';
    const code = explicitMatch[2] ? explicitMatch[2].trim().toUpperCase() : '';
    const num = explicitMatch[3] ? explicitMatch[3].trim() : '';
    if (num && num.length >= 2) {
      return [emirate, code, num].filter(Boolean).join(' ');
    }
  }

  // 2. Named Emirate with letter code: e.g. "Dubai B 45210", "Dubai A 12345"
  const emirateWithLetterMatch = text.match(
    /\b(Dubai|DXB|Abu\s*Dhabi|AUH|Sharjah|SHJ|Ajman|AJM|RAK|Ras\s*Al\s*Khaimah|Fujairah|FUJ|UAQ|Umm\s*Al\s*Quwain)\s+([A-Za-z]{1,2})\s*[-/]?\s*(\d{2,6})\b/i
  );
  if (emirateWithLetterMatch) {
    const emirate = emirateWithLetterMatch[1].trim();
    const code = emirateWithLetterMatch[2].trim().toUpperCase();
    const num = emirateWithLetterMatch[3].trim();
    return `${emirate} ${code} ${num}`;
  }

  // 3. Abu Dhabi with numeric category code: e.g. "Abu Dhabi 5 99882"
  const abuDhabiNumericMatch = text.match(
    /\b(Abu\s*Dhabi|AUH)\s+(\d{1,2})\s+[-/]?\s*(\d{4,6})\b/i
  );
  if (abuDhabiNumericMatch) {
    const emirate = abuDhabiNumericMatch[1].trim();
    const code = abuDhabiNumericMatch[2].trim();
    const num = abuDhabiNumericMatch[3].trim();
    return `${emirate} ${code} ${num}`;
  }

  // 4. Named Emirate with pure number: e.g. "Sharjah 4412", "Dubai 98124"
  const emiratePureNumberMatch = text.match(
    /\b(Dubai|DXB|Abu\s*Dhabi|AUH|Sharjah|SHJ|Ajman|AJM|RAK|Ras\s*Al\s*Khaimah|Fujairah|FUJ|UAQ|Umm\s*Al\s*Quwain)\s+(\d{2,6})\b/i
  );
  if (emiratePureNumberMatch) {
    const emirate = emiratePureNumberMatch[1].trim();
    const num = emiratePureNumberMatch[2].trim();
    return `${emirate} ${num}`;
  }

  return null;
}

// ── Emergency Keyword Patterns (English + Arabic + Urdu) ──────────────────────
const EMERGENCY_KEYWORDS: Array<{
  type: TicketType;
  priority: TicketPriority;
  category: string;
  keywords: string[];
}> = [
  {
    type: 'TOWING',
    priority: 'High',
    category: 'BREAKDOWN_RECOVERY',
    keywords: [
      'tow',
      'towing',
      'recovery',
      'breakdown',
      'broke down',
      'stuck',
      'flatbed',
      'سحب',
      'ونش',
      'ريكفري',
      'تعطلت',
      'خراب',
      'gari band',
      'kharab',
    ],
  },
  {
    type: 'INCIDENT',
    priority: 'High',
    category: 'ROAD_ACCIDENT',
    keywords: [
      'accident',
      'crash',
      'hit',
      'collision',
      'police report',
      'saed',
      'حادث',
      'صدمة',
      'تقرير شرطة',
      'saeed',
      'takkar',
    ],
  },
  {
    type: 'MAINTENANCE',
    priority: 'High',
    category: 'PUNCTURE_OR_TYRE',
    keywords: [
      'puncture',
      'flat tyre',
      'flat tire',
      'burst tyre',
      'tyre blown',
      'بنشر',
      'اطار',
      'تاير',
      'panchar',
    ],
  },
  {
    type: 'MAINTENANCE',
    priority: 'High',
    category: 'ENGINE_OVERHEAT',
    keywords: [
      'overheat',
      'overheating',
      'smoke',
      'coolant',
      'radiator',
      'حرارة',
      'دخان',
      'رديتر',
      'gari garam',
      'dhuan',
    ],
  },
  {
    type: 'MAINTENANCE',
    priority: 'Medium',
    category: 'AC_FAILURE',
    keywords: [
      'ac not working',
      'ac hot',
      'no cooling',
      'air condition',
      'مكيف',
      'تبريد',
      'ac kharab',
    ],
  },
  {
    type: 'MAINTENANCE',
    priority: 'Medium',
    category: 'BRAKES_SUSPENSION',
    keywords: [
      'brake',
      'brakes',
      'grinding noise',
      'abs light',
      'فرامل',
      'بريك',
      'awaz',
    ],
  },
  {
    type: 'CLEANING',
    priority: 'Low',
    category: 'FLEET_WASH_DETAIL',
    keywords: [
      'cleaning',
      'car wash',
      'spill',
      'dirty bus',
      'vomit',
      'غسيل',
      'تنظيف',
      'safai',
    ],
  },
  {
    type: 'RENEWAL',
    priority: 'Low',
    category: 'MULKIYA_RENEWAL',
    keywords: [
      'mulkiya',
      'registration renewal',
      'passing',
      'insurance renewal',
      'ملكية',
      'تجديد',
    ],
  },
  {
    type: 'COMPLAINT',
    priority: 'Medium',
    category: 'DRIVER_OR_SERVICE_COMPLAINT',
    keywords: [
      'complaint',
      'rude driver',
      'late bus',
      'rash driving',
      'speeding',
      'شكوى',
      'سائق',
      'shikayat',
    ],
  },
];

/**
 * Tier 1: Deterministic Fast Regex & Keyword Extraction (<5ms)
 */
export function parseTier1Regex(body: string): ParsedTicketIntent | null {
  const normalized = body.trim();
  const lower = normalized.toLowerCase();

  // Extract Plate using refined extractor
  const extractedPlateNumber = extractUaePlateNumber(normalized);

  // Match Keyword Categories
  for (const item of EMERGENCY_KEYWORDS) {
    const matchedKeyword = item.keywords.find((k) => lower.includes(k));
    if (matchedKeyword) {
      const typeLabel =
        item.type === 'TOWING'
          ? 'Emergency Towing & Recovery'
          : item.type === 'INCIDENT'
          ? 'Road Incident / Accident'
          : item.type === 'MAINTENANCE'
          ? `Vehicle Maintenance (${item.category.replace(/_/g, ' ')})`
          : `${item.type} Request`;

      const title = extractedPlateNumber
        ? `${typeLabel} - ${extractedPlateNumber}`
        : `${typeLabel} from WhatsApp`;

      const suggestedAutoReply =
        item.type === 'TOWING' || item.priority === 'High'
          ? `🚨 Emergency breakdown logged for ${extractedPlateNumber || 'your vehicle'}. Our dispatch team has received your ticket and is coordinating assistance immediately.`
          : `✅ Thank you. Your request for ${extractedPlateNumber || 'your vehicle'} has been logged. Our service team will follow up shortly.`;

      return {
        ticketType: item.type,
        priority: item.priority,
        title,
        description: normalized,
        extractedPlateNumber,
        confidence: 0.92,
        tierUsed: 'TIER_1_REGEX',
        category: item.category,
        suggestedAutoReply,
      };
    }
  }

  return null;
}

/**
 * Tier 2: Google Gemini 2.0 Flash / 1.5 Flash Caller
 */
export async function parseTier2GeminiFlash(
  body: string,
  apiKey?: string
): Promise<ParsedTicketIntent> {
  const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY;

  if (!key) {
    // Fallback if no Gemini API Key is configured
    return fallbackIntent(body, 'FALLBACK');
  }

  const systemInstruction = `
You are Fleet360's Automotive & Fleet Support NLP Triage Agent.
Your job is to parse unstructured driver and customer messages (in English, Arabic, Urdu, Hindi, or Tagalog) and extract structured service ticket parameters.

Target Ticket Types:
- TOWING (Vehicle breakdown on road, engine dead, stuck, needs recovery)
- INCIDENT (Accident, collision, bumper hit, police report required)
- MAINTENANCE (Tyre puncture, overheating, AC hot, brake squeal, oil leak, dashboard lights)
- CLEANING (Bus wash, cabin interior spills, dirty seats)
- RENEWAL (Mulkiya registration expiry, vehicle testing/passing)
- COMPLAINT (Driver reckless driving, delayed arrival, rude behavior)
- SUPPORT (General inquiry, lost item, keys locked inside)

Priorities:
- High (Breakdown, Towing, Accident, Overheat, Brake failure, Stuck on highway)
- Medium (AC failure, warning light, complaint, oil service)
- Low (Cleaning, general inquiries, renewal)

Respond ONLY with a valid JSON object:
{
  "ticketType": "TOWING" | "INCIDENT" | "MAINTENANCE" | "CLEANING" | "RENEWAL" | "COMPLAINT" | "SUPPORT",
  "priority": "Low" | "Medium" | "High",
  "title": "Brief concise title (e.g. Towing Required - Dubai B 45210)",
  "description": "Clean English summary of the issue",
  "extractedPlateNumber": "e.g. Dubai B 45210 or null",
  "extractedLocation": "e.g. E11 near Exit 36 or null",
  "category": "e.g. ENGINE_OVERHEAT or TYRE_PUNCTURE",
  "confidence": 0.98,
  "suggestedAutoReply": "Polite confirmation message to send back to the driver on WhatsApp"
}
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [{ text: `User Message: "${body}"` }],
          },
        ],
        systemInstruction: {
          parts: [{ text: systemInstruction }],
        },
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      console.warn(`Gemini 2.0 Flash returned HTTP ${response.status}, falling back`);
      return fallbackIntent(body, 'FALLBACK');
    }

    const data = await response.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      return fallbackIntent(body, 'FALLBACK');
    }

    const parsed = JSON.parse(candidateText);
    return {
      ticketType: parsed.ticketType || 'SUPPORT',
      priority: parsed.priority || 'Medium',
      title: parsed.title || 'Support Request from WhatsApp',
      description: parsed.description || body,
      extractedPlateNumber: parsed.extractedPlateNumber || null,
      extractedLocation: parsed.extractedLocation || null,
      confidence: parsed.confidence || 0.95,
      tierUsed: 'TIER_2_GEMINI_FLASH',
      category: parsed.category || 'GENERAL_SUPPORT',
      suggestedAutoReply:
        parsed.suggestedAutoReply ||
        'Thank you. Your request has been logged and our team is assisting.',
    };
  } catch (err) {
    console.warn('Gemini 2.0 Flash call error:', err);
    return fallbackIntent(body, 'FALLBACK');
  }
}

function fallbackIntent(body: string, tier: 'FALLBACK'): ParsedTicketIntent {
  const plate = extractUaePlateNumber(body);

  return {
    ticketType: 'SUPPORT',
    priority: 'Medium',
    title: plate ? `Support Request - ${plate}` : 'WhatsApp Support Request',
    description: body,
    extractedPlateNumber: plate,
    confidence: 0.7,
    tierUsed: tier,
    category: 'GENERAL_SUPPORT',
    suggestedAutoReply:
      'Thank you! Your message has been logged with our support dispatch team. We will review and follow up shortly.',
  };
}

/**
 * Main Hybrid Orchestrator
 * Checks Tier 1 Fast Regex first; if confidence is low or unstructured, runs Tier 2 Gemini Flash.
 */
export async function parseInboundMessage(
  params: InboundMessageParams,
  customGeminiKey?: string
): Promise<ParsedTicketIntent> {
  const { body } = params;

  // 1. Try Tier 1 Fast Regex
  const tier1 = parseTier1Regex(body);
  if (tier1 && tier1.confidence >= 0.9) {
    return tier1;
  }

  // 2. Try Tier 2 Gemini 2.0 Flash
  return await parseTier2GeminiFlash(body, customGeminiKey);
}

/**
 * Creates a Service Ticket in the database from the parsed intent
 */
export async function createTicketFromParsedIntent(
  intent: ParsedTicketIntent,
  rawParams: InboundMessageParams,
  tenantId: string
): Promise<{ ticketId: string; readableId: string; autoReply: string }> {
  const typePrefix =
    intent.ticketType === 'MAINTENANCE'
      ? 'MNT'
      : intent.ticketType === 'TOWING'
      ? 'TOW'
      : intent.ticketType === 'INCIDENT'
      ? 'INC'
      : intent.ticketType === 'CLEANING'
      ? 'CLN'
      : intent.ticketType === 'RENEWAL'
      ? 'RNW'
      : intent.ticketType === 'COMPLAINT'
      ? 'CMP'
      : 'SUP';

  const readableId = await nextReadableId(tenantId, intent.ticketType, typePrefix);

  // Try to find matching vehicle in this tenant by extracted plate
  let vehicleId: string | null = null;
  if (intent.extractedPlateNumber) {
    const cleanPlate = intent.extractedPlateNumber.replace(/\s+/g, '');
    const vehicle = await prisma.vehicle.findFirst({
      where: {
        tenantId,
        deletedAt: null,
        plateNumber: { contains: cleanPlate, mode: 'insensitive' },
      },
      select: { id: true },
    });
    vehicleId = vehicle?.id ?? null;
  }

  // Calculate SLA due date
  const now = new Date();
  const slaHours = intent.priority === 'High' ? 4 : intent.priority === 'Medium' ? 24 : 48;
  const dueDate = new Date(now.getTime() + slaHours * 60 * 60 * 1000)
    .toISOString()
    .split('T')[0];

  const history = [
    {
      status: 'Pending',
      date: now.toISOString(),
      actor: 'WhatsApp AI Agent (Gemini Flash)',
      note: `Auto-created via WhatsApp message from ${rawParams.from} (NLP Tier: ${intent.tierUsed}, Confidence: ${(intent.confidence * 100).toFixed(0)}%)`,
    },
  ];

  const customFields = {
    source: 'WHATSAPP_OMNICHANNEL',
    fromNumber: rawParams.from,
    category: intent.category,
    nlpTierUsed: intent.tierUsed,
    nlpConfidence: intent.confidence,
    extractedLocation: intent.extractedLocation || null,
    mediaUrl: rawParams.mediaUrl || null,
  };

  const [row] = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO service_tickets (
       tenant_id, ticket_type, readable_id, requestor_id, requestor_name,
       vehicle_id, title, description, priority, status, due_date,
       history, custom_fields
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, 'Pending', $10::date, $11::jsonb, $12::jsonb
     ) RETURNING id`,
    tenantId,
    intent.ticketType,
    readableId,
    rawParams.from,
    rawParams.customerName || rawParams.from.replace('whatsapp:', ''),
    vehicleId,
    intent.title,
    intent.description,
    intent.priority,
    dueDate,
    JSON.stringify(history),
    JSON.stringify(customFields)
  );

  const formattedReply = `${intent.suggestedAutoReply}\n\n📌 Ticket Reference: *${readableId}*\n⏱️ Priority: ${intent.priority} | Target SLA: ${slaHours} Hours\n\n— Smart Fleet Support Team`;

  return {
    ticketId: row.id,
    readableId,
    autoReply: formattedReply,
  };
}
