import { describe, it, expect, vi, beforeEach } from 'vitest';
import zlib from 'zlib';
import { checkErpUrl, erpFetch, ErpAddressBlockedError } from '@/lib/agents/enterprise-bridge/erp-fetch';
import { readZipEntries, ZipLimitError } from '@/lib/agents/document-intelligence/pipeline/zip-reader';
import { toPublicConnection, webhookSecretOf } from '@/lib/agents/enterprise-bridge/connection-secrets';

// ── Webhook route dependencies ───────────────────────────────────────────────
const h = vi.hoisted(() => ({
  connection: null as Record<string, unknown> | null,
  dispatch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/rls', () => {
  const tx = {
    $queryRawUnsafe: vi.fn(async () => (h.connection ? [h.connection] : [])),
    $executeRawUnsafe: vi.fn(async () => 1),
  };
  return {
    withPlatformAdmin: vi.fn((_p: unknown, fn: (t: unknown) => unknown) => fn(tx)),
    withTenantRls: vi.fn((_p: unknown, _t: string, fn: (t: unknown) => unknown) => fn(tx)),
  };
});
vi.mock('@/lib/agents/schema', () => ({ ensureAgentSchema: vi.fn(async () => undefined) }));
vi.mock('@/lib/agents/orchestrator', () => ({ dispatch: h.dispatch }));
vi.mock('@/lib/agents/registry', () => ({
  getAgentsForEvent: vi.fn(async () => [{ id: 'enterprise-bridge' }]),
}));

const { POST: webhookPOST } = await import('@/app/api/integrations/enterprise/webhook/[id]/route');

const CONN_ID = '11111111-1111-4111-8111-111111111111';
const SECRET = 'whsec_0123456789abcdefghijklmnop';

function webhook(headers: Record<string, string>, body: unknown = { entityType: 'ROSTER' }, query = '') {
  const req = new Request(`http://localhost/api/integrations/enterprise/webhook/${CONN_ID}${query}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const nextReq = Object.assign(req, { nextUrl: new URL(req.url) });
  return webhookPOST(nextReq as never, { params: Promise.resolve({ id: CONN_ID }) });
}

describe('enterprise webhook authentication', () => {
  beforeEach(() => {
    h.dispatch.mockClear();
    h.connection = {
      id: CONN_ID,
      tenant_id: 'tenant-a',
      system_type: 'CUSTOM_REST',
      system_name: 'ERP',
      is_active: true,
      auth_credentials: { apiKey: 'erp-api-key-value', webhookSecret: SECRET },
      headers: { 'x-webhook-secret': 'header-config-value' },
    };
  });

  it('refuses every request to a connection that has no webhook secret', async () => {
    h.connection!.auth_credentials = { apiKey: 'erp-api-key-value' };
    expect((await webhook({})).status).toBe(401);
    expect((await webhook({ 'x-webhook-secret': 'erp-api-key-value' })).status).toBe(401);
  });

  it('accepts only the webhook secret, in a header', async () => {
    expect((await webhook({ 'x-webhook-secret': SECRET })).status).toBe(200);
    expect((await webhook({ authorization: `Bearer ${SECRET}` })).status).toBe(200);
    // The ERP's own API key, a configured header value, or a query parameter are not the secret.
    expect((await webhook({ 'x-webhook-secret': 'erp-api-key-value' })).status).toBe(401);
    expect((await webhook({ 'x-api-key': SECRET })).status).toBe(401);
    expect((await webhook({ 'x-webhook-secret': 'header-config-value' })).status).toBe(401);
    expect((await webhook({}, undefined, `?secret=${SECRET}`)).status).toBe(401);
  });

  it('dispatches only agents that handle inbound ERP events', async () => {
    const bad = await webhook({ 'x-webhook-secret': SECRET }, { targetAgent: 'dispatch-optimiser' });
    expect(bad.status).toBe(400);
    expect(h.dispatch).not.toHaveBeenCalled();

    const good = await webhook({ 'x-webhook-secret': SECRET }, { targetAgent: 'enterprise-bridge', entityId: 'E1' });
    expect(good.status).toBe(200);
    expect(h.dispatch).toHaveBeenCalledWith(expect.objectContaining({ agent_id: 'enterprise-bridge', tenant_id: 'tenant-a' }));
  });
});

describe('connection serialisation', () => {
  it('never returns credentials or header values', () => {
    const pub = toPublicConnection({
      id: 'c1',
      tenant_id: 't',
      base_url: 'https://erp.example.com',
      auth_credentials: { apiKey: 'k', webhookSecret: SECRET },
      headers: { Authorization: 'Bearer token-value' },
    });
    const json = JSON.stringify(pub);
    expect(json).not.toContain('token-value');
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain('"k"');
    expect(pub.hasWebhookSecret).toBe(true);
    expect(webhookSecretOf({ webhookSecret: 'short' })).toBeNull();
  });
});

describe('ERP URL guard (SSRF)', () => {
  it('accepts only https URLs to public hosts without credentials', () => {
    expect(checkErpUrl('https://erp.example.com/api').ok).toBe(true);
    expect(checkErpUrl('https://erp.example.com:8443').ok).toBe(true);
    for (const bad of [
      'http://erp.example.com',
      'https://user:pw@erp.example.com',
      'https://169.254.169.254/latest/meta-data',
      'https://10.0.0.5',
      'https://[::1]/',
      'https://localhost:3000',
      'https://fleet360-backend.railway.internal',
      'https://backend',
      'ftp://erp.example.com',
      'not a url',
    ]) {
      expect(checkErpUrl(bad).ok, bad).toBe(false);
    }
  });

  it('refuses at connect time a host name that resolves to a private address (DNS rebinding)', async () => {
    for (const address of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '::ffff:192.168.1.10']) {
      const lookup = ((_host: string, _opts: unknown, cb: (e: null, a: Array<{ address: string; family: number }>) => void) =>
        cb(null, [{ address, family: address.includes(':') ? 6 : 4 }])) as never;
      await expect(erpFetch('https://erp.example.com/health', {}, lookup)).rejects.toBeInstanceOf(ErpAddressBlockedError);
    }
  });
});

// ── ZIP limits ───────────────────────────────────────────────────────────────

/** A real ZIP: local headers, central directory, EOCD. */
function buildZip(files: Array<{ name: string; data: Buffer; deflate?: boolean; streamed?: boolean }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const body = f.deflate ? zlib.deflateRawSync(f.data) : f.data;
    const name = Buffer.from(f.name);
    const flags = f.streamed ? 0x08 : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(flags, 6);
    lh.writeUInt16LE(f.deflate ? 8 : 0, 8);
    lh.writeUInt32LE(f.streamed ? 0 : body.length, 18);
    lh.writeUInt32LE(f.streamed ? 0 : f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    const dd = f.streamed ? Buffer.alloc(16) : Buffer.alloc(0);
    if (f.streamed) {
      dd.writeUInt32LE(0x08074b50, 0);
      dd.writeUInt32LE(body.length, 8);
      dd.writeUInt32LE(f.data.length, 12);
    }
    locals.push(lh, name, body, dd);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(flags, 8);
    ch.writeUInt16LE(f.deflate ? 8 : 0, 10);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + body.length + dd.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

describe('bounded ZIP reader', () => {
  it('reads streamed entries (sizes in a data descriptor) from the central directory', () => {
    const zip = buildZip([
      { name: 'a.txt', data: Buffer.from('Invoice INV-1 total AED 100'), deflate: true, streamed: true },
      { name: 'docs/b.txt', data: Buffer.from('second'), deflate: false },
      { name: '__MACOSX/._a.txt', data: Buffer.from('x') },
    ]);
    const entries = readZipEntries(zip);
    expect(entries.map((e) => e.name)).toEqual(['a.txt', 'docs/b.txt']);
    expect(entries[0].data.toString()).toBe('Invoice INV-1 total AED 100');
  });

  it('refuses a ZIP bomb, even one that understates its size', () => {
    const limits = { maxEntries: 10, maxEntryBytes: 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 };
    const big = Buffer.alloc(8 * 1024 * 1024); // 8 MiB of zeros deflates to ~8 KiB
    expect(() => readZipEntries(buildZip([{ name: 'bomb.txt', data: big, deflate: true }]), limits)).toThrow(ZipLimitError);

    // Declared uncompressed size patched down to 10 bytes: maxOutputLength still stops it.
    const lying = buildZip([{ name: 'bomb.txt', data: big, deflate: true }]);
    const cdStart = lying.readUInt32LE(lying.length - 22 + 16);
    lying.writeUInt32LE(10, cdStart + 24);
    expect(() => readZipEntries(lying, limits)).toThrow(ZipLimitError);
  });

  it('refuses too many entries and too much in total', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.from('x') }));
    expect(() => readZipEntries(buildZip(many), { maxEntries: 4, maxEntryBytes: 100, maxTotalBytes: 1000 })).toThrow(/entries/);
    const total = Array.from({ length: 3 }, (_, i) => ({ name: `f${i}.txt`, data: Buffer.alloc(60) }));
    expect(() => readZipEntries(buildZip(total), { maxEntries: 10, maxEntryBytes: 100, maxTotalBytes: 150 })).toThrow(/exceed/);
  });
});

describe('enterprise webhook is reachable without a session, and reveals nothing', () => {
  it('only the webhook path is public', async () => {
    const { isPublicPath } = await import('@/lib/auth-route-policies');
    expect(isPublicPath(`/api/integrations/enterprise/webhook/${CONN_ID}`)).toBe(true);
    expect(isPublicPath('/api/integrations/enterprise/connections')).toBe(false);
    expect(isPublicPath(`/api/integrations/enterprise/connections/${CONN_ID}/webhook-secret`)).toBe(false);
    expect(isPublicPath('/api/integrations/enterprise/sync')).toBe(false);
  });

  it('answers an unknown connection, one without a secret and a wrong secret identically', async () => {
    const bodies: string[] = [];
    h.connection = null;
    let res = await webhook({ 'x-webhook-secret': SECRET });
    expect(res.status).toBe(401);
    bodies.push(JSON.stringify(await res.json()));

    h.connection = { id: CONN_ID, tenant_id: 't', is_active: true, auth_credentials: {} };
    res = await webhook({ 'x-webhook-secret': SECRET });
    expect(res.status).toBe(401);
    bodies.push(JSON.stringify(await res.json()));

    h.connection = { id: CONN_ID, tenant_id: 't', is_active: true, auth_credentials: { webhookSecret: SECRET } };
    res = await webhook({ 'x-webhook-secret': 'whsec_wrong_wrong_wrong_wrong_wrong' });
    expect(res.status).toBe(401);
    bodies.push(JSON.stringify(await res.json()));

    expect(new Set(bodies).size).toBe(1);
  });

  it('refuses a malformed connection id before touching the database', async () => {
    const req = new Request('http://localhost/api/integrations/enterprise/webhook/not-a-uuid', { method: 'POST', body: '{}' });
    const res = await webhookPOST(Object.assign(req, { nextUrl: new URL(req.url) }) as never, { params: Promise.resolve({ id: 'not-a-uuid' }) });
    expect(res.status).toBe(401);
  });
});
