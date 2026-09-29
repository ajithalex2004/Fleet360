export const dynamic = 'force-dynamic';

/**
 * Company profile — /api/admin/company-profile
 *
 * The signed-in user's own company identity as it appears on tax invoices
 * and Peppol e-invoices: TRN, registered address, Arabic name and finance
 * contact. GET is open to any member (invoice screens read it); PATCH is for
 * the company's administrators (src/lib/admin-access.ts). Both act only on
 * the caller's own tenant — there is no tenant id in the path.
 *
 * The legal name is shown but not editable here: it identifies the company
 * across the platform, so renaming stays with platform support.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { logAudit } from '@/lib/audit';
import { withAuditedAction } from '@/lib/audited-action';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { emirateOf, isValidTrn, normalizeTrn } from '@/lib/finance/uae';

export const runtime = 'nodejs';

const MAX = 240;

type Profile = {
  name: string;
  arabicName: string | null;
  trn: string | null;
  trnValid: boolean;
  address: string | null;
  emirate: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  updatedAt: Date | null;
};

function parseLocalized(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function toProfile(t: {
  name: string; localizedName: string | null; trn: string | null; address: string | null;
  contactName: string | null; contactEmail: string | null; contactPhone: string | null; updatedAt: Date | null;
}): Profile {
  return {
    name: t.name,
    arabicName: parseLocalized(t.localizedName).ar ?? null,
    trn: t.trn,
    trnValid: isValidTrn(t.trn),
    address: t.address,
    emirate: emirateOf(t.address) ?? null,
    contactName: t.contactName,
    contactEmail: t.contactEmail,
    contactPhone: t.contactPhone,
    updatedAt: t.updatedAt,
  };
}

const SELECT = {
  name: true, localizedName: true, trn: true, address: true,
  contactName: true, contactEmail: true, contactPhone: true, updatedAt: true,
} as const;

export async function GET(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    const t = await tx.tenant.findUnique({ where: { id: tenantId }, select: SELECT });
    if (!t) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    return NextResponse.json({ profile: toProfile(t) });
  });
}

// Trimmed string, '' → null (clear the field), undefined → leave unchanged.
function text(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  return s ? s.slice(0, MAX) : null;
}

async function handlePATCH(req: NextRequest) {
  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId, userId } = authz;

  let body: Record<string, unknown>;
  try {
    body = stripTenantOwnershipFields(await req.json());
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const errors: Record<string, string> = {};

  let trn: string | null | undefined = text(body.trn);
  if (typeof trn === 'string') {
    trn = normalizeTrn(trn);
    if (!isValidTrn(trn)) errors.trn = 'TRN must be 15 digits starting with 100.';
  }

  const address = text(body.address);
  const contactName = text(body.contactName);
  const contactPhone = text(body.contactPhone);
  if (typeof contactPhone === 'string' && !/^\+?[\d\s()-]{7,20}$/.test(contactPhone)) {
    errors.contactPhone = 'Enter a valid phone number, e.g. +971 4 123 4567.';
  }
  const contactEmail = text(body.contactEmail);
  if (typeof contactEmail === 'string' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
    errors.contactEmail = 'Enter a valid email address.';
  }
  const arabicName = text(body.arabicName);

  if (Object.keys(errors).length) {
    return NextResponse.json({ error: Object.values(errors)[0], fields: errors }, { status: 400 });
  }

  let audit: Parameters<typeof logAudit>[0] | null = null;

  const response = await withTenantRls(prisma, tenantId, async (tx) => {
    const current = await tx.tenant.findUnique({ where: { id: tenantId }, select: SELECT });
    if (!current) return NextResponse.json({ error: 'Company not found' }, { status: 404 });

    const data: Record<string, string | null> = {};
    if (trn !== undefined) data.trn = trn;
    if (address !== undefined) data.address = address;
    if (contactName !== undefined) data.contactName = contactName;
    if (contactEmail !== undefined) data.contactEmail = contactEmail;
    if (contactPhone !== undefined) data.contactPhone = contactPhone;
    if (arabicName !== undefined) {
      const localized = parseLocalized(current.localizedName);
      if (arabicName) localized.ar = arabicName; else delete localized.ar;
      data.localizedName = Object.keys(localized).length ? JSON.stringify(localized) : null;
    }

    const changed = Object.entries(data)
      .filter(([k, v]) => (current as Record<string, unknown>)[k] !== v)
      .map(([k]) => k);
    if (!changed.length) return NextResponse.json({ profile: toProfile(current) });

    const updated = await tx.tenant.update({
      where: { id: tenantId },
      data: { ...data, updatedAt: new Date() },
      select: SELECT,
    });

    audit = {
      tenantId, tenantName: current.name,
      userId: userId ?? undefined, userRole: req.headers.get('x-user-role') ?? 'TENANT_ADMIN',
      entityType: 'CompanyProfile',
      entityId: tenantId,
      action: 'UPDATE',
      details: `Company profile updated: ${changed.join(', ')}` +
        (changed.includes('trn') ? ` (TRN ${current.trn ?? 'none'} → ${updated.trn ?? 'none'})` : '') + '.',
    };
    return NextResponse.json({ profile: toProfile(updated) });
  });

  if (audit) await logAudit(audit);
  return response;
}

// Privileged writes are always audited (src/lib/audited-action.ts).
export const PATCH = withAuditedAction(handlePATCH);
