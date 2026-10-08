/**
 * tests/unit/storage-health.test.ts
 *
 * Production stored uploads on the web container's own disk, which every
 * redeploy wipes, and nothing reported it. /api/health now carries
 * storageStatus(): the backend, whether it is durable, and (for an object
 * store) a write → read → delete round trip. The round trip runs against a
 * real S3-compatible server when STORAGE_S3_TEST_ENDPOINT is set (e.g.
 * adobe/s3mock with a bucket "fleet360-test"); skipped otherwise.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resetStorageForTests } from '@/lib/storage';
import { resetStorageStatusForTests, storageStatus } from '@/lib/storage/health';

afterEach(() => {
  vi.unstubAllEnvs();
  resetStorageForTests();
  resetStorageStatusForTests();
});

describe('storageStatus', () => {
  it('reports container-local storage in production as not durable', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STORAGE_BACKEND', '');
    vi.stubEnv('FILE_STORAGE_DIR', '');
    expect(await storageStatus({ fresh: true })).toMatchObject({ backend: 'local', durable: false, ok: true });
  });

  it('treats local storage on a configured directory (a mounted volume) as durable', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('STORAGE_BACKEND', 'local');
    vi.stubEnv('FILE_STORAGE_DIR', '/data/uploads');
    expect(await storageStatus({ fresh: true })).toMatchObject({ backend: 'local', durable: true });
  });

  it('names what is missing when the object store is half configured', async () => {
    vi.stubEnv('STORAGE_BACKEND', 's3');
    vi.stubEnv('S3_BUCKET', 'fleet360-uploads');
    vi.stubEnv('S3_REGION', '');
    vi.stubEnv('S3_ACCESS_KEY', '');
    vi.stubEnv('S3_SECRET_KEY', '');
    const s = await storageStatus({ fresh: true });
    expect(s).toMatchObject({ backend: 's3', ok: false });
    expect(s.error).toContain('S3_REGION');
  });

  const endpoint = process.env.STORAGE_S3_TEST_ENDPOINT;
  (endpoint ? it : it.skip)('round-trips a file through a real S3-compatible store', async () => {
    vi.stubEnv('STORAGE_BACKEND', 's3');
    vi.stubEnv('S3_ENDPOINT', endpoint!);
    vi.stubEnv('S3_USE_SSL', 'false');
    vi.stubEnv('S3_REGION', 'auto');
    vi.stubEnv('S3_BUCKET', 'fleet360-test');
    vi.stubEnv('S3_ACCESS_KEY', 'test');
    vi.stubEnv('S3_SECRET_KEY', 'test');
    vi.stubEnv('S3_KEY_PREFIX', 'production/web');
    const s = await storageStatus({ fresh: true });
    expect(s, s.error).toMatchObject({ backend: 's3', durable: true, ok: true });
    // Cached: a second call does not touch the store again.
    expect((await storageStatus()).checkedAt).toBe(s.checkedAt);
  });
});
