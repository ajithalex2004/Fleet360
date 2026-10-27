/**
 * Outbound callback URL guard for POST /api/agents/ingest.
 *
 * An ingest caller may ask for the AgentRunResult to be POSTed to a
 * callback_url. Left open, that is an SSRF primitive (cloud metadata at
 * 169.254.169.254, internal services) and a way to stream a run's output to
 * any host. A callback is only sent when:
 *
 *   - the URL is https, on the default port, with no credentials;
 *   - its host is on AGENT_CALLBACK_ALLOWED_HOSTS (comma-separated; an entry
 *     starting with "." matches subdomains, e.g. ".partner.example.com").
 *     Unset or empty = callbacks disabled;
 *   - the host is a DNS name (no IP literals) and every address it resolves
 *     to is public.
 *
 * The send itself does not follow redirects (a redirect would leave the
 * allowlist) and times out. Resolution happens before the fetch, so DNS
 * rebinding between the two is still possible; the allowlist is the control
 * that matters, the address check is a second layer.
 */
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';

const MAX_URL_LENGTH = 2048;
const CALLBACK_TIMEOUT_MS = 10_000;

const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(net, prefix, 'ipv6');

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !blocked.check(address, 'ipv4');
  if (family === 6) {
    // IPv4-mapped (::ffff:a.b.c.d) is the IPv4 address underneath.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
    if (mapped) return isPublicAddress(mapped[1]);
    return !blocked.check(address, 'ipv6');
  }
  return false;
}

function allowedHosts(): string[] {
  return (process.env.AGENT_CALLBACK_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

function hostAllowed(host: string, allowlist: string[]): boolean {
  return allowlist.some((entry) =>
    entry.startsWith('.') ? host.endsWith(entry) && host.length > entry.length : host === entry,
  );
}

export type CallbackUrlCheck = { ok: true; url: URL } | { ok: false; error: string };

export async function validateCallbackUrl(
  raw: unknown,
  resolve: (host: string) => Promise<string[]> = async (host) =>
    (await lookup(host, { all: true, verbatim: true })).map((a) => a.address),
): Promise<CallbackUrlCheck> {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH) {
    return { ok: false, error: 'callback_url must be a URL string' };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'callback_url is not a valid URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'callback_url must use https' };
  if (url.username || url.password) return { ok: false, error: 'callback_url must not contain credentials' };
  if (url.port && url.port !== '443') return { ok: false, error: 'callback_url must use the default https port' };

  const host = url.hostname.toLowerCase();
  if (isIP(host) || host.startsWith('[')) return { ok: false, error: 'callback_url must use a host name, not an IP address' };

  const allowlist = allowedHosts();
  if (allowlist.length === 0) return { ok: false, error: 'callback_url is not enabled on this server' };
  if (!hostAllowed(host, allowlist)) return { ok: false, error: 'callback_url host is not allowed' };

  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    return { ok: false, error: 'callback_url host does not resolve' };
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
    return { ok: false, error: 'callback_url host resolves to a non-public address' };
  }
  return { ok: true, url };
}

/** Best-effort POST of a run result to an already-validated callback URL. */
export async function sendCallback(url: URL, body: unknown): Promise<void> {
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(CALLBACK_TIMEOUT_MS),
  });
}
