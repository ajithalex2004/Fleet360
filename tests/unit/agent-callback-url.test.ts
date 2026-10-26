import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isPublicAddress, validateCallbackUrl } from '@/lib/agents/callback-url';

const publicDns = async () => ['93.184.216.34'];

describe('agent ingest callback_url guard', () => {
  const saved = process.env.AGENT_CALLBACK_ALLOWED_HOSTS;
  beforeEach(() => {
    process.env.AGENT_CALLBACK_ALLOWED_HOSTS = 'hooks.partner.example, .fleetco.example';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.AGENT_CALLBACK_ALLOWED_HOSTS;
    else process.env.AGENT_CALLBACK_ALLOWED_HOSTS = saved;
  });

  it('accepts an allowlisted https host that resolves publicly', async () => {
    expect((await validateCallbackUrl('https://hooks.partner.example/agent', publicDns)).ok).toBe(true);
    expect((await validateCallbackUrl('https://api.fleetco.example/cb', publicDns)).ok).toBe(true);
  });

  it('is disabled when no allowlist is configured', async () => {
    delete process.env.AGENT_CALLBACK_ALLOWED_HOSTS;
    expect((await validateCallbackUrl('https://hooks.partner.example/agent', publicDns)).ok).toBe(false);
  });

  it.each([
    'http://hooks.partner.example/agent',
    'https://evil.example/agent',
    'https://fleetco.example.evil.example/',
    'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/',
    'https://user:pw@hooks.partner.example/',
    'https://hooks.partner.example:8443/',
    'file:///etc/passwd',
    'not a url',
  ])('rejects %s', async (url) => {
    expect((await validateCallbackUrl(url, publicDns)).ok).toBe(false);
  });

  it('rejects an allowlisted host that resolves to a private address', async () => {
    for (const addr of ['127.0.0.1', '10.1.2.3', '169.254.169.254', '::1', 'fd00::1', '::ffff:192.168.1.1']) {
      const check = await validateCallbackUrl('https://hooks.partner.example/agent', async () => [addr]);
      expect(check.ok, addr).toBe(false);
    }
  });

  it('classifies addresses', () => {
    expect(isPublicAddress('8.8.8.8')).toBe(true);
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
    expect(isPublicAddress('100.64.0.1')).toBe(false);
    expect(isPublicAddress('fe80::1')).toBe(false);
  });
});
