/**
 * Photos on a service request. Shared by POST /api/service-tickets/[id]/attachments
 * (staff) and the Customer Portal.
 *
 * Images only (PNG, JPEG, WebP, GIF; content-sniffed), up to 10 MB each and 6
 * per upload, stored under service-tickets/{tenantId}/{ticketId}/… and appended
 * to the request's attachments. src/lib/storage/file-access.ts decides who
 * may read them. `customerId` (portal) also requires the request to belong to
 * that customer.
 */

import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { getStorage } from '@/lib/storage';
import { fileContentProblem } from '@/lib/storage/file-type';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 6;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface StoredPhoto {
  id: string; type: 'PHOTO'; fileName: string; url: string; size: number; mimeType: string;
  uploadedAt: string; uploadedBy: string | null;
}

export type PhotoUploadResult =
  | { ok: true; attachments: StoredPhoto[]; readableId: string | null }
  | { ok: false; status: number; error: string };

export async function saveTicketPhotos(args: {
  tenantId: string; ticketId: string; files: File[]; uploadedBy: string | null; customerId?: string;
}): Promise<PhotoUploadResult> {
  const { tenantId, ticketId, files, uploadedBy, customerId } = args;
  if (!UUID_RE.test(ticketId)) return { ok: false, status: 400, error: 'Invalid request id' };
  if (files.length === 0) return { ok: false, status: 400, error: 'No photo attached' };
  if (files.length > MAX_FILES) return { ok: false, status: 400, error: `Attach at most ${MAX_FILES} photos` };

  // The request must exist in the tenant (and belong to the customer) before any bytes are stored.
  const [ticket] = await withTenantRls(prisma, tenantId, (tx) =>
    tx.$queryRawUnsafe<Array<{ id: string; readable_id: string | null; customer_id: string | null }>>(
      `SELECT id::text, readable_id, to_jsonb(service_tickets) ->> 'customer_id' AS customer_id
         FROM service_tickets WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
      ticketId, tenantId,
    ),
  ).catch(() => []);
  if (!ticket || (customerId && ticket.customer_id !== customerId)) {
    return { ok: false, status: 404, error: 'Service request not found' };
  }

  const storage = getStorage();
  const added: StoredPhoto[] = [];
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) return { ok: false, status: 400, error: `${file.name} is larger than 10 MB` };
    const buffer = Buffer.from(await file.arrayBuffer());
    const problem = fileContentProblem(file.name, buffer, ['png', 'jpeg', 'webp', 'gif']);
    if (problem) return { ok: false, status: 400, error: `${file.name}: ${problem}` };
    const stored = await storage.upload({
      buffer, originalName: file.name, mimeType: file.type || 'image/jpeg',
      prefix: `service-tickets/${tenantId}/${ticketId}`,
    });
    added.push({
      id: crypto.randomUUID(), type: 'PHOTO', fileName: file.name, url: stored.url, size: stored.size,
      mimeType: stored.mimeType, uploadedAt: new Date().toISOString(), uploadedBy,
    });
  }

  await withTenantRls(prisma, tenantId, (tx) =>
    tx.$executeRawUnsafe(
      `UPDATE service_tickets
          SET attachments = COALESCE(attachments, '[]'::jsonb) || $3::jsonb, updated_at = NOW()
        WHERE id = $1::uuid AND tenant_id = $2`,
      ticketId, tenantId, JSON.stringify(added),
    ),
  );
  return { ok: true, attachments: added, readableId: ticket.readable_id };
}

/** The image files posted as `file` fields. */
export function photoFilesFrom(form: FormData): File[] {
  return form.getAll('file').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f);
}
