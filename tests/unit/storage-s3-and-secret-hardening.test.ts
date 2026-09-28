/**
 * Private object storage (S3-compatible) behind the existing /uploads URLs,
 * content checks on uploads, and the constant-time scheduler/webhook secret
 * checks that replaced plain `===` and built-in fallback secrets.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const s3 = vi.hoisted(() => ({
  objects: new Map<string, Uint8Array>(),
  sent: [] as Array<{ name: string; input: Record<string, unknown> }>,
  configs: [] as unknown[],
}));

vi.mock('@aws-sdk/client-s3', () => {
  class Command {
    constructor(public input: Record<string, unknown>) {}
  }
  class PutObjectCommand extends Command {}
  class GetObjectCommand extends Command {}
  class DeleteObjectCommand extends Command {}
  class NoSuchKey extends Error {
    name = 'NoSuchKey';
  }
  class S3Client {
    constructor(config: unknown) {
      s3.configs.push(config);
    }
    async send(cmd: Command) {
      const name = cmd.constructor.name;
      s3.sent.push({ name, input: cmd.input });
      const key = String(cmd.input.Key);
      if (name === 'PutObjectCommand') {
        s3.objects.set(key, new Uint8Array(cmd.input.Body as Buffer));
        return {};
      }
      if (name === 'GetObjectCommand') {
        const body = s3.objects.get(key);
        if (!body) throw new NoSuchKey('missing');
        return { Body: { transformToByteArray: async () => body } };
      }
      s3.objects.delete(key);
      return {};
    }
  }
  return { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, NoSuchKey };
});

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { secretsEqual, bearerToken } from '@/lib/secure-compare';
import { detectFileKind, fileContentProblem } from '@/lib/storage/file-type';
import { stripIdentityHeaders } from '@/lib/identity-headers';

const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]);
const HTML = Buffer.from('<!doctype html><script>alert(1)</script>');
const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]);

const S3_ENV = {
  STORAGE_BACKEND: 's3', S3_BUCKET: 'fleet360-docs', S3_REGION: 'me-central-1',
  S3_ACCESS_KEY: 'AKIA-test', S3_SECRET_KEY: 'secret-test',
};

async function freshStorage(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return import('@/lib/storage');
}

const savedEnv = { ...process.env };
beforeEach(() => {
  s3.objects.clear();
  s3.sent.length = 0;
  s3.configs.length = 0;
});
afterEach(() => {
  process.env = { ...savedEnv };
});

describe('S3 configuration', () => {
  it('uses the AWS regional endpoint when S3_ENDPOINT is empty or AWS', async () => {
    const { s3ConfigFromEnv } = await freshStorage({});
    expect(s3ConfigFromEnv({ ...S3_ENV } as unknown as NodeJS.ProcessEnv)).toMatchObject({
      region: 'me-central-1', endpoint: undefined, forcePathStyle: false,
    });
    expect(s3ConfigFromEnv({ ...S3_ENV, S3_ENDPOINT: 's3.amazonaws.com' } as unknown as NodeJS.ProcessEnv).endpoint).toBeUndefined();
  });

  it('builds a URL for R2 or MinIO and uses path-style addressing', async () => {
    const { s3ConfigFromEnv } = await freshStorage({});
    expect(s3ConfigFromEnv({ ...S3_ENV, S3_ENDPOINT: 'minio:9000', S3_USE_SSL: 'false' } as unknown as NodeJS.ProcessEnv))
      .toMatchObject({ endpoint: 'http://minio:9000', forcePathStyle: true });
    expect(s3ConfigFromEnv({ ...S3_ENV, S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com', S3_KEY_PREFIX: '/next/' } as unknown as NodeJS.ProcessEnv))
      .toMatchObject({ endpoint: 'https://acc.r2.cloudflarestorage.com', keyPrefix: 'next' });
  });

  it('names every missing variable instead of falling back to local disk', async () => {
    const { s3ConfigFromEnv } = await freshStorage({});
    expect(() => s3ConfigFromEnv({ STORAGE_BACKEND: 's3', S3_BUCKET: 'b' } as unknown as NodeJS.ProcessEnv))
      .toThrow(/S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY are not set/);
  });

  it('refuses an unknown backend', async () => {
    const { getStorage } = await freshStorage({ STORAGE_BACKEND: 'ftp' });
    expect(() => getStorage()).toThrow(/Unknown STORAGE_BACKEND/);
  });
});

describe('S3 storage', () => {
  it('stores privately under the same /uploads key and reads it back', async () => {
    const { getStorage, readStoredFile } = await freshStorage({ ...S3_ENV, S3_KEY_PREFIX: 'next' });
    const stored = await getStorage().upload({ buffer: PDF, originalName: 'trade licence.pdf', mimeType: 'application/pdf', prefix: 'leasing/lessee/abc' });
    expect(stored.url).toMatch(/^\/uploads\/leasing\/lessee\/abc\/[0-9a-f-]{36}-trade_licence\.pdf$/);
    const put = s3.sent.find((c) => c.name === 'PutObjectCommand')!;
    expect(put.input).toMatchObject({ Bucket: 'fleet360-docs', Key: `next/${stored.key}`, CacheControl: 'private, no-store' });
    expect(put.input).not.toHaveProperty('ACL');
    expect(Buffer.from((await readStoredFile(stored.key))!)).toEqual(PDF);
  });

  it('falls back to local disk for files uploaded before the switch', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'uploads-'));
    await fs.mkdir(path.join(dir, 'rental', 'handover', 'b1'), { recursive: true });
    await fs.writeFile(path.join(dir, 'rental', 'handover', 'b1', 'sig.png'), PNG);
    const { readStoredFile } = await freshStorage({ ...S3_ENV, FILE_STORAGE_DIR: dir });
    expect(Buffer.from((await readStoredFile('rental/handover/b1/sig.png'))!)).toEqual(PNG);
    expect(await readStoredFile('rental/handover/b1/missing.png')).toBeNull();
    expect(await readStoredFile('../etc/passwd')).toBeNull();
  });

  it('keeps using local disk by default', async () => {
    const { getStorage } = await freshStorage({ STORAGE_BACKEND: undefined });
    expect(getStorage().backend).toBe('local');
    expect(s3.configs).toHaveLength(0);
  });
});

describe('upload content checks', () => {
  it('identifies files by their bytes', () => {
    expect(detectFileKind(PDF)).toBe('pdf');
    expect(detectFileKind(PNG)).toBe('png');
    expect(detectFileKind(JPEG)).toBe('jpeg');
    expect(detectFileKind(Buffer.from('plate,km\nD-1,120\n'))).toBe('text');
    expect(detectFileKind(HTML)).toBeNull();
    expect(detectFileKind(EXE)).toBeNull();
  });

  it('refuses a page or program renamed as a document, and a mismatched extension', () => {
    const docs = ['pdf', 'png', 'jpeg'] as const;
    expect(fileContentProblem('licence.pdf', PDF, docs)).toBeNull();
    expect(fileContentProblem('licence.pdf', HTML, docs)).toMatch(/not accepted/);
    expect(fileContentProblem('licence.pdf', EXE, docs)).toMatch(/not accepted/);
    expect(fileContentProblem('licence.png', PDF, docs)).toMatch(/don't match/);
    expect(fileContentProblem('notes.txt', Buffer.from('hello'), docs)).toMatch(/not accepted/);
  });
});

describe('secret comparison', () => {
  it('matches only the exact secret, and never an empty or unset one', () => {
    expect(secretsEqual('s3cret-value', 's3cret-value')).toBe(true);
    for (const wrong of ['s3cret-valuE', 's3cret-valu', 's3cret-value-', '', null, undefined]) {
      expect(secretsEqual(wrong, 's3cret-value')).toBe(false);
    }
    expect(secretsEqual('', '')).toBe(false);
    expect(secretsEqual('x', undefined)).toBe(false);
  });

  it('reads bearer tokens', () => {
    expect(bearerToken(new Headers({ authorization: 'Bearer abc' }))).toBe('abc');
    expect(bearerToken(new Headers({ authorization: 'Basic abc' }))).toBeNull();
    // Schedulers set up before sending the scheme still work.
    expect(bearerToken(new Headers({ authorization: 'abc' }))).toBe('abc');
    expect(bearerToken(new Headers())).toBeNull();
  });

  it('strips a client-sent requested tenant with the other identity headers', () => {
    const h = stripIdentityHeaders(new Headers({ 'x-requested-tenant-id': 'victim', 'x-tenant-id': 'victim', accept: 'x' }));
    expect(h.has('x-requested-tenant-id')).toBe(false);
    expect(h.get('accept')).toBe('x');
  });
});

describe('SLA sweep scheduler secret', () => {
  async function sweep(headers: Record<string, string>, query = '?tenantId=t1', env: Record<string, string | undefined> = {}) {
    vi.resetModules();
    vi.doMock('@/lib/service-tickets/active-sla-engine', () => ({ runSlaEscalationSweep: vi.fn(async () => ({ escalated: 0 })) }));
    vi.doMock('@/lib/prisma', () => ({ prisma: { $queryRawUnsafe: vi.fn(async () => []) } }));
    vi.doMock('@/lib/rls', () => ({
      withTenantRls: vi.fn(async (_p: unknown, _t: string, fn: () => unknown) => fn()),
      withPlatformAdmin: vi.fn(async (_p: unknown, fn: () => unknown) => fn()),
    }));
    delete process.env.CRON_SECRET;
    delete process.env.SLA_SWEEP_SECRET;
    Object.assign(process.env, env);
    const { POST } = await import('@/app/api/service-tickets/sla/sweep/route');
    return POST(new NextRequest(`http://localhost/api/service-tickets/sla/sweep${query}`, { method: 'POST', headers }));
  }

  it('no longer accepts the old built-in secret or a secret in the URL', async () => {
    const builtIn = { authorization: 'Bearer fleet360-sla-sweep-internal-secret' };
    expect((await sweep(builtIn)).status).toBe(401);
    const res = await sweep({}, '?tenantId=t1&secret=cron-secret-123', { CRON_SECRET: 'cron-secret-123' });
    expect(res.status).toBe(401);
  });

  it('accepts the configured scheduler secret as a bearer token or header', async () => {
    expect((await sweep({ authorization: 'Bearer cron-secret-123' }, '?tenantId=t1', { CRON_SECRET: 'cron-secret-123' })).status).toBe(200);
    expect((await sweep({ 'x-cron-secret': 'sla-only' }, '?tenantId=t1', { SLA_SWEEP_SECRET: 'sla-only' })).status).toBe(200);
  });
});
