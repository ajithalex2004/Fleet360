/**
 * File storage adapter: local filesystem or S3-compatible object storage.
 *
 * Stored URLs have the form `/uploads/{prefix}/{uuid}-{name}` whatever the
 * backend, and they are never served directly: middleware routes every
 * /uploads/* request to /api/files/*, which checks the caller against the
 * file's owning record before streaming it (src/lib/storage/file-access.ts).
 * The bucket stays private; no object is ever public or addressed by the
 * browser.
 *
 * Backends (STORAGE_BACKEND):
 *   local (default)  {FILE_STORAGE_DIR}/{key}, default public/uploads. Lost on
 *                    redeploy unless FILE_STORAGE_DIR is on a mounted volume.
 *   s3               Any S3-compatible store (AWS S3, Cloudflare R2, MinIO).
 *                    Configured like the Go backend's objectstore package:
 *                      S3_ENDPOINT    host[:port] or URL; empty or *.amazonaws.com
 *                                     means AWS (endpoint derived from region)
 *                      S3_REGION      e.g. me-central-1 (UAE); "auto" for R2
 *                      S3_ACCESS_KEY / S3_SECRET_KEY
 *                      S3_BUCKET      must exist and must not be public
 *                      S3_USE_SSL     "false" only for local MinIO over HTTP
 *                      S3_KEY_PREFIX  optional folder inside the bucket
 *                      S3_FORCE_PATH_STYLE  default true for non-AWS endpoints
 *                    A missing variable fails the first upload or read
 *                    loudly instead of silently writing to local disk.
 *
 * With the s3 backend, reads fall back to the local directory for files
 * uploaded before the switch, until scripts/migrate-uploads-to-s3.ts has
 * copied them into the bucket.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { captureException } from '@/lib/sentry';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

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

  /** The stored bytes, or null when there is no such object. `key` must be normalized. */
  read(key: string): Promise<Buffer | null>;

  delete(key: string): Promise<void>;

  readonly backend: 'local' | 's3';
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

async function readLocalFile(key: string): Promise<Buffer | null> {
  const abs = absolutePathForKey(key);
  if (!abs) return null;
  try {
    return await fs.readFile(abs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

/**
 * Reads a stored file. Returns null when the key is invalid or the file does
 * not exist. Callers must authorize the key first (file-access.ts).
 */
export async function readStoredFile(key: string): Promise<Buffer | null> {
  const safe = normalizeStorageKey(key);
  if (!safe) return null;
  const storage = getStorage();
  const body = await storage.read(safe);
  if (body || storage.backend === 'local') return body;
  // Not in the bucket yet: uploaded before the switch to S3.
  return readLocalFile(safe);
}

class LocalFileStorage implements FileStorage {
  readonly backend = 'local' as const;

  read(key: string): Promise<Buffer | null> {
    return readLocalFile(key);
  }

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

/* ── S3-compatible object storage ───────────────────────────────────────── */

export interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Undefined for AWS, where the SDK derives the endpoint from the region. */
  endpoint?: string;
  forcePathStyle: boolean;
  keyPrefix: string;
}

/** Reads the S3_* variables (same names as backend/objectstore); throws naming what is missing. */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config {
  const get = (name: string) => (env[name] ?? '').trim();
  const missing = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'].filter((n) => !get(n));
  if (missing.length) {
    throw new Error(`STORAGE_BACKEND=s3 but ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set`);
  }
  const rawEndpoint = get('S3_ENDPOINT');
  const aws = !rawEndpoint || /(^|\.)amazonaws\.com(:\d+)?(\/|$)/i.test(rawEndpoint.replace(/^https?:\/\//i, ''));
  let endpoint: string | undefined;
  if (!aws) {
    const useSsl = get('S3_USE_SSL').toLowerCase() !== 'false';
    endpoint = /^https?:\/\//i.test(rawEndpoint) ? rawEndpoint : `${useSsl ? 'https' : 'http'}://${rawEndpoint}`;
  }
  const pathStyle = get('S3_FORCE_PATH_STYLE').toLowerCase();
  return {
    bucket: get('S3_BUCKET'),
    region: get('S3_REGION'),
    accessKeyId: get('S3_ACCESS_KEY'),
    secretAccessKey: get('S3_SECRET_KEY'),
    endpoint,
    forcePathStyle: pathStyle ? pathStyle === 'true' : !aws,
    keyPrefix: get('S3_KEY_PREFIX').replace(/^\/+|\/+$/g, ''),
  };
}

type S3Sender = Pick<S3Client, 'send'>;

export class S3FileStorage implements FileStorage {
  readonly backend = 's3' as const;

  constructor(private readonly config: S3Config, private readonly client: S3Sender = new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  })) {}

  private objectKey(key: string): string {
    return this.config.keyPrefix ? `${this.config.keyPrefix}/${key}` : key;
  }

  async upload({ buffer, originalName, mimeType, prefix }: {
    buffer: Buffer;
    originalName: string;
    mimeType: string;
    prefix: string;
  }): Promise<StoredFile> {
    const key = path.posix.join(prefix, `${crypto.randomUUID()}-${sanitizeFilename(originalName)}`);
    if (!normalizeStorageKey(key)) throw new Error(`refused: invalid storage key ${key}`);
    await this.client.send(new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: this.objectKey(key),
      Body: buffer,
      ContentType: mimeType,
      ContentLength: buffer.length,
      // Never public, never cached by intermediaries.
      CacheControl: 'private, no-store',
    }));
    return { url: `${UPLOAD_URL_PREFIX}${key}`, key, size: buffer.length, mimeType, originalName };
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.config.bucket, Key: this.objectKey(key) }));
      if (!res.Body) return null;
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (err instanceof NoSuchKey || (err as { name?: string }).name === 'NoSuchKey'
        || (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.config.bucket, Key: this.objectKey(key) }));
    } catch (err) {
      captureException(err, { context: 'storage.s3.delete', extra: { key } });
    }
  }
}

/* ── Adapter selection ───────────────────────────────────────────────────── */

let cached: FileStorage | null = null;

export function getStorage(): FileStorage {
  if (cached) return cached;
  const backend = (process.env.STORAGE_BACKEND ?? 'local').trim().toLowerCase();
  if (backend === 's3') cached = new S3FileStorage(s3ConfigFromEnv());
  else if (backend === 'local' || backend === '') cached = new LocalFileStorage();
  else throw new Error(`Unknown STORAGE_BACKEND "${backend}" (expected local or s3)`);
  return cached;
}

/** Tests only: forget the cached adapter so the next getStorage() re-reads the environment. */
export function resetStorageForTests(): void {
  cached = null;
}
