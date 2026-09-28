#!/usr/bin/env node
/**
 * Copies files stored on local disk (FILE_STORAGE_DIR, default public/uploads)
 * into the S3-compatible bucket used by STORAGE_BACKEND=s3, under the same
 * keys, so the stored /uploads/{key} URLs keep working unchanged.
 *
 *   node scripts/migrate-uploads-to-s3.mjs --dry-run   list what would be copied
 *   node scripts/migrate-uploads-to-s3.mjs             copy
 *
 * Reads the same S3_* variables as src/lib/storage/index.ts. Idempotent:
 * objects already in the bucket with the same size are skipped. Local files
 * are left in place; the app reads them as a fallback until they are deleted
 * by hand once the copy has been checked.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

const dryRun = process.argv.includes('--dry-run');
const env = (name) => (process.env[name] ?? '').trim();

const missing = ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'].filter((n) => !env(n));
if (missing.length) {
  console.error(`Missing ${missing.join(', ')}`);
  process.exit(1);
}

const rawEndpoint = env('S3_ENDPOINT');
const aws = !rawEndpoint || /(^|\.)amazonaws\.com(:\d+)?(\/|$)/i.test(rawEndpoint.replace(/^https?:\/\//i, ''));
const endpoint = aws ? undefined
  : /^https?:\/\//i.test(rawEndpoint) ? rawEndpoint
  : `${env('S3_USE_SSL').toLowerCase() === 'false' ? 'http' : 'https'}://${rawEndpoint}`;
const pathStyle = env('S3_FORCE_PATH_STYLE').toLowerCase();
const bucket = env('S3_BUCKET');
const keyPrefix = env('S3_KEY_PREFIX').replace(/^\/+|\/+$/g, '');

const client = new S3Client({
  region: env('S3_REGION'),
  endpoint,
  forcePathStyle: pathStyle ? pathStyle === 'true' : !aws,
  credentials: { accessKeyId: env('S3_ACCESS_KEY'), secretAccessKey: env('S3_SECRET_KEY') },
});

const root = path.resolve(env('FILE_STORAGE_DIR') || path.join(process.cwd(), 'public', 'uploads'));
const SEGMENT = /^[A-Za-z0-9._-]+$/;
const CONTENT_TYPES = {
  '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.txt': 'text/plain', '.csv': 'text/csv',
};

async function* walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

async function sizeInBucket(objectKey) {
  try {
    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: objectKey }));
    return head.ContentLength ?? null;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404 || err?.name === 'NotFound') return null;
    throw err;
  }
}

const totals = { copied: 0, skipped: 0, invalid: 0, failed: 0 };
try {
  await fs.access(root);
} catch {
  console.log(`Nothing to migrate: ${root} does not exist.`);
  process.exit(0);
}

for await (const file of walk(root)) {
  const key = path.relative(root, file).split(path.sep).join('/');
  if (!key.split('/').every((s) => SEGMENT.test(s) && s !== '.' && s !== '..')) {
    console.warn(`invalid key, not copied: ${key}`);
    totals.invalid++;
    continue;
  }
  const objectKey = keyPrefix ? `${keyPrefix}/${key}` : key;
  try {
    const body = await fs.readFile(file);
    if ((await sizeInBucket(objectKey)) === body.length) {
      totals.skipped++;
      continue;
    }
    if (dryRun) {
      console.log(`would copy ${key} (${body.length} bytes)`);
    } else {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: body,
        ContentType: CONTENT_TYPES[path.extname(key).toLowerCase()] ?? 'application/octet-stream',
        CacheControl: 'private, no-store',
      }));
      console.log(`copied ${key}`);
    }
    totals.copied++;
  } catch (err) {
    console.error(`failed ${key}: ${err?.message ?? err}`);
    totals.failed++;
  }
}

console.log(`${dryRun ? 'Would copy' : 'Copied'} ${totals.copied}, already present ${totals.skipped}, invalid ${totals.invalid}, failed ${totals.failed}.`);
process.exit(totals.failed ? 1 : 0);
