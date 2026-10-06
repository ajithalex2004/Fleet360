/**
 * Tenant attachments: the Attachment Type master (attachment_types) and the
 * documents uploaded for a tenant (tenant_attachments). Tables come from
 * migration 20261022090000_tenant_attachments.
 *
 * Files are stored under tenant-attachments/{tenantId}/ and served only
 * through /api/files, which checks the caller against the tenant_attachments
 * row (src/lib/storage/file-access.ts).
 *
 * Callers pass the transaction client of an RLS scope covering the tenant.
 */
import type { TxClient } from '@/lib/rls';
import { getStorage, type StoredFile } from '@/lib/storage';
import { fileContentProblem, type FileKind } from '@/lib/storage/file-type';

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_KINDS: readonly FileKind[] = ['pdf', 'png', 'jpeg', 'webp'];
export const ATTACHMENT_ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp';

export interface AttachmentType {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isMandatory: boolean;
  requiresExpiry: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface TenantAttachmentRow {
  id: string;
  attachmentTypeId: string;
  typeCode: string;
  typeName: string;
  fileUrl: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  documentNumber: string | null;
  expiryDate: string | null;
  uploadedBy: string | null;
  createdAt: string;
}

/** The attachment tables do not exist yet: the migration has not been applied. */
export class AttachmentsNotMigratedError extends Error {
  constructor() {
    super('Tenant attachments are not set up on this database yet: apply migration 20261022090000_tenant_attachments.');
  }
}

function isMissingTable(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes('42P01') || /relation "(attachment_types|tenant_attachments)" does not exist/.test(msg);
}

async function guardMissing<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (e) { if (isMissingTable(e)) throw new AttachmentsNotMigratedError(); throw e; }
}

export async function listAttachmentTypes(tx: TxClient, opts: { activeOnly?: boolean } = {}): Promise<AttachmentType[]> {
  return guardMissing(() => tx.$queryRawUnsafe<AttachmentType[]>(
    `SELECT id::text, code, name, description,
            is_mandatory AS "isMandatory", requires_expiry AS "requiresExpiry",
            is_active AS "isActive", sort_order AS "sortOrder"
       FROM attachment_types
      ${opts.activeOnly ? 'WHERE is_active = true' : ''}
      ORDER BY sort_order, name`,
  ));
}

export async function listTenantAttachments(tx: TxClient, tenantId: string): Promise<TenantAttachmentRow[]> {
  return guardMissing(() => tx.$queryRawUnsafe<TenantAttachmentRow[]>(
    `SELECT a.id::text, a.attachment_type_id::text AS "attachmentTypeId", t.code AS "typeCode", t.name AS "typeName",
            a.file_url AS "fileUrl", a.original_name AS "originalName", a.mime_type AS "mimeType",
            a.size_bytes AS "sizeBytes", a.document_number AS "documentNumber",
            to_char(a.expiry_date, 'YYYY-MM-DD') AS "expiryDate", a.uploaded_by AS "uploadedBy",
            a.created_at AS "createdAt"
       FROM tenant_attachments a
       JOIN attachment_types t ON t.id = a.attachment_type_id
      WHERE a.tenant_id = $1 AND a.deleted_at IS NULL
      ORDER BY t.sort_order, t.name, a.created_at DESC`,
    tenantId,
  ));
}

/** An attachment chosen for upload: the file plus its optional details. */
export interface AttachmentUpload {
  attachmentTypeId: string;
  file: File;
  documentNumber?: string | null;
  expiryDate?: string | null;
}

/**
 * Check uploads against the active types: every type known and active,
 * file size and real content (not just the extension) acceptable, expiry
 * date given where the type requires one, and, when `requireMandatory`,
 * every mandatory type present. Returns the first problem, or null.
 */
export async function attachmentUploadProblem(
  uploads: readonly AttachmentUpload[],
  types: readonly AttachmentType[],
  opts: { requireMandatory: boolean },
): Promise<string | null> {
  const byId = new Map(types.filter((t) => t.isActive).map((t) => [t.id, t]));
  for (const u of uploads) {
    const type = byId.get(u.attachmentTypeId);
    if (!type) return 'Unknown or inactive attachment type';
    if (u.file.size === 0) return `${type.name}: the file is empty`;
    if (u.file.size > ATTACHMENT_MAX_BYTES) return `${type.name}: files can be at most 10 MB`;
    const problem = fileContentProblem(u.file.name, new Uint8Array(await u.file.arrayBuffer()), ALLOWED_KINDS);
    if (problem) return `${type.name}: ${problem} Upload a PDF, PNG, JPEG or WebP file.`;
    if (u.expiryDate && !/^\d{4}-\d{2}-\d{2}$/.test(u.expiryDate)) return `${type.name}: expiry date must be YYYY-MM-DD`;
    if (type.requiresExpiry && !u.expiryDate) return `${type.name}: expiry date is required`;
  }
  if (opts.requireMandatory) {
    const given = new Set(uploads.map((u) => u.attachmentTypeId));
    const missing = types.filter((t) => t.isActive && t.isMandatory && !given.has(t.id));
    if (missing.length > 0) return `Required attachment missing: ${missing.map((t) => t.name).join(', ')}`;
  }
  return null;
}

/** Write the files to storage. On failure, files already written are removed. */
export async function storeAttachmentFiles(tenantId: string, uploads: readonly AttachmentUpload[]): Promise<StoredFile[]> {
  const storage = getStorage();
  const stored: StoredFile[] = [];
  try {
    for (const u of uploads) {
      stored.push(await storage.upload({
        buffer: Buffer.from(await u.file.arrayBuffer()),
        originalName: u.file.name,
        mimeType: u.file.type || 'application/octet-stream',
        prefix: `tenant-attachments/${tenantId}`,
      }));
    }
    return stored;
  } catch (e) {
    await removeStoredFiles(stored);
    throw e;
  }
}

/** Best-effort cleanup of stored files (e.g. when the database write failed). */
export async function removeStoredFiles(files: readonly StoredFile[]): Promise<void> {
  const storage = getStorage();
  await Promise.all(files.map((f) => storage.delete(f.key).catch(() => {})));
}

/** Insert tenant_attachments rows for files already stored (same order as `uploads`). */
export async function insertTenantAttachments(
  tx: TxClient,
  tenantId: string,
  uploads: readonly AttachmentUpload[],
  stored: readonly StoredFile[],
  uploadedBy: string | null,
): Promise<void> {
  await guardMissing(async () => {
    for (let i = 0; i < uploads.length; i++) {
      const u = uploads[i];
      const f = stored[i];
      await tx.$executeRawUnsafe(
        `INSERT INTO tenant_attachments
           (tenant_id, attachment_type_id, file_url, original_name, mime_type, size_bytes, document_number, expiry_date, uploaded_by)
         VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8::date, $9)`,
        tenantId, u.attachmentTypeId, f.url, u.file.name, u.file.type || 'application/octet-stream', u.file.size,
        u.documentNumber?.trim() || null, u.expiryDate || null, uploadedBy,
      );
    }
  });
}

/**
 * Read attachments from multipart form data: for each type, a `file:<typeId>`
 * file and optional `documentNumber:<typeId>` / `expiryDate:<typeId>` fields.
 */
export function uploadsFromFormData(form: FormData): AttachmentUpload[] {
  const uploads: AttachmentUpload[] = [];
  for (const [name, value] of form.entries()) {
    if (!name.startsWith('file:') || !(value instanceof File)) continue;
    const typeId = name.slice('file:'.length);
    const text = (field: string) => {
      const v = form.get(`${field}:${typeId}`);
      return typeof v === 'string' && v.trim() ? v.trim() : null;
    };
    uploads.push({ attachmentTypeId: typeId, file: value, documentNumber: text('documentNumber'), expiryDate: text('expiryDate') });
  }
  return uploads;
}
