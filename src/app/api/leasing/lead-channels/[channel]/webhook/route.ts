/**
 * POST /api/leasing/lead-channels/[channel]/webhook
 *
 * Inbound multi-source lead capture. Mirrors the RAC channel webhook pattern.
 * Each external source posts native payload + HMAC-SHA256 signature in
 * `x-channel-signature`. We verify, normalize via the channel adapter, and
 * upsert a LeaseInquiry. Dedup by externalRef stored as inquiryNumber.
 *
 * Failures are logged + returned as structured errors. Auth/normalization
 * failures return 4xx; persist failures return 500 only on unexpected errors.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  getLeadChannel,
  normalizeLeadPayload,
  verifyLeadSignature,
  type LeadChannelKey,
  type NormalizedLead,
} from '@/lib/leasing-lead-channels';
import { logAudit } from '@/lib/audit';
import { captureException } from '@/lib/sentry';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ channel: string }> }) {
  const { channel: channelParam } = await params;
  const descriptor = getLeadChannel(channelParam);

  if (!descriptor) {
    return NextResponse.json({ ok: false, error: `Unknown lead channel: ${channelParam}` }, { status: 404 });
  }
  if (!descriptor.supportsInboundWebhook) {
    return NextResponse.json({ ok: false, error: `Channel ${descriptor.key} does not accept inbound webhooks` }, { status: 400 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('x-channel-signature');
  const secret = descriptor.secretEnvVar ? process.env[descriptor.secretEnvVar] : null;

  if (!secret) {
    captureException(
      new Error(`Lead channel ${descriptor.key} hit but ${descriptor.secretEnvVar} not configured`),
      { context: 'leasing.lead-channels.no_secret', tags: { channel: descriptor.key } },
    );
    return NextResponse.json({ ok: false, error: 'Channel not configured on this environment' }, { status: 503 });
  }
  if (!verifyLeadSignature(secret, rawBody, signature)) {
    return NextResponse.json({ ok: false, error: 'Invalid signature' }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON payload' }, { status: 400 });
  }

  let lead: NormalizedLead;
  try {
    lead = normalizeLeadPayload(descriptor.key as LeadChannelKey, payload);
  } catch (err) {
    captureException(err, { context: 'leasing.lead-channels.normalize', tags: { channel: descriptor.key } });
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to normalize lead payload',
    }, { status: 400 });
  }

  if (!lead.customerName || lead.customerName.trim().length === 0) {
    return NextResponse.json({ ok: false, error: 'customerName is required after normalization' }, { status: 400 });
  }

  try {
    // Idempotency: dedup by externalRef stored as inquiryNumber.
    const existing = await prisma.leaseInquiry.findUnique({
      where: { inquiryNumber: lead.externalRef },
    });
    if (existing) {
      return NextResponse.json({ ok: true, inquiryId: existing.id, status: existing.status, dedup: true });
    }

    const inquiry = await prisma.leaseInquiry.create({
      data: {
        inquiryNumber: lead.externalRef,
        customerName: lead.customerName.trim(),
        customerEmail: lead.customerEmail,
        customerPhone: lead.customerPhone,
        companyName: lead.companyName,
        vehicleType: lead.vehicleType,
        vehicleCount: lead.vehicleCount,
        leaseType: lead.leaseType,
        durationMonths: lead.durationMonths,
        notes: [`[${lead.sourceTag}]`, lead.notes].filter(Boolean).join('\n\n'),
        status: 'NEW',
      },
    });

    void logAudit({
      tenantId: req.headers.get('x-tenant-id') ?? undefined,
      userId: `channel:${descriptor.key}`,
      userRole: 'CHANNEL',
      entityType: 'LeaseInquiry',
      entityId: inquiry.id,
      action: 'CREATE',
      details: `Inbound lead from ${descriptor.label}: ${lead.externalRef} — ${lead.customerName}${lead.companyName ? ` (${lead.companyName})` : ''}.`,
    });

    return NextResponse.json({ ok: true, inquiryId: inquiry.id, status: inquiry.status, dedup: false });
  } catch (err) {
    captureException(err, {
      context: 'leasing.lead-channels.persist',
      tags: { channel: descriptor.key, externalRef: lead.externalRef },
    });
    console.error('[lead webhook] persist error:', err);
    return NextResponse.json({ ok: false, error: 'Failed to persist lead' }, { status: 500 });
  }
}
