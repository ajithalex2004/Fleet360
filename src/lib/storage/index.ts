/**
 * File storage adapter — abstract over local fs vs S3 vs Vercel Blob.
 *
 * v1.0 implementation: local filesystem under public/uploads/{prefix}/{uuid}-{name}.
 * The file is reachable via URL `/uploads/{prefix}/{uuid}-{name}` because
 * Next.js serves anything under public/ statically.
 *
 * Production swap path: implement S3FileStorage or VercelBlobStorage that
 * conforms to the same FileStorage interface. Pick via env var STORAGE_BACKEND.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { captureException } from '@/lib/sentry';

export interface StoredFile {
  /** Public URL the browser can fetch. */
  url: string;
  /** Internal storage key — opaque to callers. */
  key: string;
  /** Size in bytes. */
  size: number;
  /** MIME type. */
  mimeType: string;
  /** Original filename uploaded by the user. */
  originalName: string;
}

export interface FileStorage {
  upload(input: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    /** Logical bucket — e.g. "leasing/documents". */
    prefix: string;
  }): Promise<StoredFile>;

  delete(key: string): Promise<void>;
}

/* ── Local filesystem implementation ─────────────────────────────────────── */

const PUBLIC_ROOT = path.join(process.cwd(), 'public');
const UPLOADS_DIR = path.join(PUBLIC_ROOT, 'uploads');

class LocalFileStorage implements FileStorage {
  async upload({ buffer, originalName, mimeType, prefix }: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    prefix: string;
  }): Promise<StoredFile> {
    const safeName = sanitizeFilename(originalName);
    const id = crypto.randomUUID();
    const key = path.posix.join(prefix, `${id}-${safeName}`);
    const absDir = path.join(UPLOADS_DIR, ...prefix.split('/'));
    const absPath = path.join(absDir, `${id}-${safeName}`);

    await fs.mkdir(absDir, { recursive: true });
    await fs.writeFile(absPath, buffer);

    return {
      url: `/uploads/${key}`,
      key,
      size: buffer.length,
      mimeType,
      originalName,
    };
  }

  async delete(key: string): Promise<void> {
    try {
      const safeKey = path.normalize(key).replace(/^([\\/])+/, '');
      const absPath = path.join(UPLOADS_DIR, safeKey);
      // Defence-in-depth: refuse to delete outside UPLOADS_DIR
      if (!absPath.startsWith(UPLOADS_DIR)) {
        throw new Error('refused: path outside uploads dir');
      }
      await fs.unlink(absPath);
    } catch (err) {
      captureException(err, { context: 'storage.local.delete', extra: { key } });
    }
  }
}

/** Strip path-traversal characters and limit length. */
function sanitizeFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 200);
}

/* ── Adapter selection (extensible for S3/Vercel Blob) ───────────────────── */

let cached: FileStorage | null = null;

export function getStorage(): FileStorage {
  if (cached) return cached;
  // Future: read STORAGE_BACKEND env var to switch.
  cached = new LocalFileStorage();
  return cached;
}
