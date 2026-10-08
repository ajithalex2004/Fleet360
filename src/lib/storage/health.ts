/**
 * Is uploaded-file storage durable, and does it work? Reported by
 * /api/health so a deploy that writes uploads to the container's own disk —
 * wiped on every redeploy — is visible instead of silently losing files.
 *
 *   backend  's3' (object store) or 'local' (FILE_STORAGE_DIR, default
 *            public/uploads inside the container)
 *   durable  s3, or local with FILE_STORAGE_DIR set (meant to be a mounted
 *            volume). Plain local storage in production is not durable.
 *   ok       for s3, a small write → read → delete round trip succeeded
 *            (cached 10 minutes); for local, always true.
 */
import { getStorage, s3ConfigFromEnv } from '@/lib/storage';

export interface StorageStatus {
  backend: 'local' | 's3' | 'misconfigured';
  durable: boolean;
  ok: boolean;
  error?: string;
  checkedAt: string;
}

const CACHE_MS = 10 * 60_000;
let cached: { status: StorageStatus; at: number } | null = null;

function backendName(): string {
  return (process.env.STORAGE_BACKEND ?? 'local').trim().toLowerCase() || 'local';
}

async function probe(): Promise<StorageStatus> {
  const checkedAt = new Date().toISOString();
  const backend = backendName();
  if (backend !== 's3') {
    return {
      backend: 'local',
      durable: !!process.env.FILE_STORAGE_DIR?.trim() || process.env.NODE_ENV !== 'production',
      ok: true,
      checkedAt,
    };
  }
  try {
    s3ConfigFromEnv(); // names any missing variable
    const storage = getStorage();
    const body = Buffer.from(`fleet360 storage probe ${checkedAt}`);
    const stored = await storage.upload({ buffer: body, originalName: 'probe.txt', mimeType: 'text/plain', prefix: 'health' });
    try {
      const back = await storage.read(stored.key);
      if (!back || !back.equals(body)) throw new Error('read back did not match what was written');
    } finally {
      await storage.delete(stored.key).catch(() => undefined);
    }
    return { backend: 's3', durable: true, ok: true, checkedAt };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[storage-health] object storage check failed:', error);
    return { backend: 's3', durable: true, ok: false, error: error.slice(0, 200), checkedAt };
  }
}

export async function storageStatus(opts: { fresh?: boolean } = {}): Promise<StorageStatus> {
  if (!opts.fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.status;
  let status: StorageStatus;
  try {
    status = await probe();
  } catch (e) {
    status = { backend: 'misconfigured', durable: false, ok: false, error: e instanceof Error ? e.message : String(e), checkedAt: new Date().toISOString() };
  }
  cached = { status, at: Date.now() };
  return status;
}

/** Tests only. */
export function resetStorageStatusForTests(): void {
  cached = null;
}
