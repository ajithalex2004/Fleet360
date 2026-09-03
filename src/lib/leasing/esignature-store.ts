import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { ensureSelfServiceTables } from './self-service-schema';

export interface ESignature {
  id: string;
  tenantId: string;
  lesseeId: string;
  entityType: string;
  entityId: string;
  signerName: string;
  signerEmail: string;
  ipAddress: string | null;
  userAgent: string | null;
  acceptedText: string;
  contentHash: string;
  signedAt: string;
}

interface Row {
  id: string;
  tenant_id: string;
  lessee_id: string;
  entity_type: string;
  entity_id: string;
  signer_name: string;
  signer_email: string;
  ip_address: string | null;
  user_agent: string | null;
  accepted_text: string;
  content_hash: string;
  signed_at: string;
}

const SELECT = `id::text, tenant_id, lessee_id, entity_type, entity_id, signer_name,
  signer_email, ip_address, user_agent, accepted_text, content_hash, signed_at::text`;

function rowToApi(r: Row): ESignature {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    lesseeId: r.lessee_id,
    entityType: r.entity_type,
    entityId: r.entity_id,
    signerName: r.signer_name,
    signerEmail: r.signer_email,
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
    acceptedText: r.accepted_text,
    contentHash: r.content_hash,
    signedAt: r.signed_at,
  };
}

/** Seals signerName + acceptedText + signedAt-ish nonce into a hash so the
 *  record can be verified not to have been altered after the fact. */
function sealSignature(signerName: string, acceptedText: string, entityId: string): string {
  return crypto.createHash('sha256').update(`${entityId}:${signerName}:${acceptedText}`).digest('hex');
}

export async function getSignature(tenantId: string, entityType: string, entityId: string): Promise<ESignature | null> {
  await ensureSelfServiceTables();
  const rows = await prisma.$queryRawUnsafe<Row[]>(
    `SELECT ${SELECT} FROM lease_esignatures
      WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3
      LIMIT 1`,
    tenantId, entityType, entityId,
  );
  return rows[0] ? rowToApi(rows[0]) : null;
}

/** Single signature per (entityType, entityId) — enforced by the unique
 *  index in self-service-schema.ts. Returns null if already signed. */
export async function createSignature(args: {
  tenantId: string;
  lesseeId: string;
  entityType: string;
  entityId: string;
  signerName: string;
  signerEmail: string;
  ipAddress: string | null;
  userAgent: string | null;
  acceptedText: string;
}): Promise<ESignature | null> {
  await ensureSelfServiceTables();
  const contentHash = sealSignature(args.signerName, args.acceptedText, args.entityId);
  try {
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `INSERT INTO lease_esignatures
         (tenant_id, lessee_id, entity_type, entity_id, signer_name, signer_email,
          ip_address, user_agent, accepted_text, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING ${SELECT}`,
      args.tenantId, args.lesseeId, args.entityType, args.entityId, args.signerName,
      args.signerEmail, args.ipAddress, args.userAgent, args.acceptedText, contentHash,
    );
    return rows[0] ? rowToApi(rows[0]) : null;
  } catch (e) {
    // Unique violation — already signed.
    if (e instanceof Error && /unique/i.test(e.message)) return null;
    throw e;
  }
}
