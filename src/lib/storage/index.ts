/**
 * File storage adapter — abstract over local fs vs S3 vs Vercel Blob.
 *
 * v1.0 implementation: local filesystem under {FILE_STORAGE_DIR}/{prefix}/{uuid}-{name}
 * (default public/uploads, where earlier releases wrote). Stored URLs have the
 * form `/uploads/{prefix}/{uuid}-{name}`, but they are never served as static
 * files: middleware routes every /uploads/* request to /api/files/*, which
 * checks the caller against the file's owning record before streaming it
 * (src/lib/storage/file-access.ts). Files under public/ are otherwise served
 * by Next.js to anyone, without any route's authorization check.
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

const UPLOADS_DIR = path.resolve(
  process.env.FILE_STORAGE_DIR || path.join(process.cwd(), 'public', 'uploads'),
);

/** URL prefix of stored files; see the header comment. */
export const UPLOAD_URL_PREFIX = '/uploads/';

const KEY_SEGMENT = /^[A-Za-z0-9._-]+$/;

/**
 * Validates a storage key taken from a URL: relative, '/'-separated, every
 * segment made of safe characters, no '.' or '..' segments. Returns null for
 * anything else so a crafted path can never leave the storage directory.
 */
export function normalizeStorageKey(raw: string): string | null {
  if (!raw || raw.length > 512) return null;
  const segments = raw.split('/');
  for (const seg of segments) {
    if (!KEY_SEGMENT.test(seg) || seg === '.' || seg === '..') return null;
  }
  return segments.join('/');
}

/** Absolute path for a validated key, confined to the storage directory. */
function absolutePathForKey(key: string): string | null {
  const safe = normalizeStorageKey(key);
  if (!safe) return null;
  const abs = path.join(UPLOADS_DIR, ...safe.split('/'));
  return abs.startsWith(UPLOADS_DIR + path.sep) ? abs : null;
}

/**
 * Reads a stored file. Returns null when the key is invalid or the file does
 * not exist. Callers must authorize the key first (file-access.ts).
 */
export async function readStoredFile(key: string): Promise<Buffer | null> {
  const abs = absolutePathForKey(key);
  if (!abs) return null;
  try {
    return await fs.readFile(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

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
      url: `${UPLOAD_URL_PREFIX}${key}`,
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
