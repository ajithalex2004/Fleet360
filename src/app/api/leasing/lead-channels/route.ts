/**
 * GET /api/leasing/lead-channels
 *
 * Channel registry annotated with per-channel inbound counts (LeaseInquiry
 * rows whose inquiryNumber starts with the channel prefix) and a configured
 * flag (shared secret present in env). Powers the admin page.
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { LEAD_CHANNELS } from '@/lib/leasing-lead-channels';

export const runtime = 'nodejs';

const PREFIX_BY_KEY: Record<string, string> = {
  WEB_FORM:         'WEB-',
  WHATSAPP_INBOUND: 'WA-',
  AGENT_REFERRAL:   'AGT-',
  EMAIL_INQUIRY:    'EMAIL-',
  CARTRADE:         'CTRD-',
  DUBIZZLE:         'DBZL-',
  PROPERTY_FINDER:  'PF-',
};

export async function GET() {
  const inquiries = await prisma.leaseInquiry.findMany({
    where: { deletedAt: null, inquiryNumber: { not: null } },
    select: { inquiryNumber: true, createdAt: true },
  });

  const out = LEAD_CHANNELS.map(c => {
    const prefix = PREFIX_BY_KEY[c.key];
    const matched = prefix
      ? inquiries.filter(i => i.inquiryNumber!.startsWith(prefix))
      : [];
    const lastAt = matched.length > 0
      ? matched.reduce((max, i) => (i.createdAt && i.createdAt > max ? i.createdAt : max), new Date(0))
      : null;
    return {
      key: c.key,
      label: c.label,
      category: c.category,
      supportsInboundWebhook: c.supportsInboundWebhook,
      configured: c.secretEnvVar ? Boolean(process.env[c.secretEnvVar]) : true,
      description: c.description,
      leadCount: matched.length,
      lastLeadAt: lastAt && lastAt.getTime() > 0 ? lastAt.toISOString() : null,
    };
  });

  return NextResponse.json(out);
}
