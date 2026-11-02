/**
 * Outbound HTTP for tenant-configured ERP endpoints (enterprise connections,
 * document webhooks).
 *
 * A connection's base URL is typed in by a tenant user, so a plain fetch to
 * it is an SSRF primitive: Railway's private network, 169.254.169.254, the
 * Go backend. Unlike agent callbacks (callback-url.ts) there can be no host
 * allowlist — each tenant's ERP lives on its own host — so the control is
 * the address actually connected to:
 *
 *   - https only (connections carry credentials), no credentials in the URL;
 *   - every address is checked when the socket connects (the `lookup` hook
 *     of node:https), so a name cannot resolve to a public address for a
 *     check and a private one for the request (DNS rebinding);
 *   - IP-literal hosts must be public too;
 *   - redirects are not followed (a 3xx is returned as is);
 *   - a timeout and a cap on the response body.
 *
 * Returns a standard Response so callers keep using res.ok / res.json().
 */
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { isIP } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';
import { isPublicAddress } from '@/lib/agents/callback-url';

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;

export type ErpUrlCheck = { ok: true; url: URL } | { ok: false; error: string };

/** Shape checks on a connection base URL (no DNS); used when saving one too. */
export function checkErpUrl(raw: unknown): ErpUrlCheck {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) {
    return { ok: false, error: 'baseUrl must be a URL' };
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: 'baseUrl is not a valid URL' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: 'baseUrl must use https' };
  if (url.username || url.password) return { ok: false, error: 'baseUrl must not contain credentials' };
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host) && !isPublicAddress(host)) return { ok: false, error: 'baseUrl must be a public address' };
  if (!isIP(host) && (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || !host.includes('.'))) {
    return { ok: false, error: 'baseUrl must be a public host name' };
  }
  return { ok: true, url };
}

export class ErpAddressBlockedError extends Error {
  constructor(host: string) {
    super(`ERP host ${host} resolves to a non-public address; the request was not sent.`);
    this.name = 'ErpAddressBlockedError';
  }
}

type Lookup = typeof dnsLookup;

/** dns.lookup that refuses non-public addresses (runs at connect time). */
function guardedLookup(base: Lookup): Lookup {
  return ((hostname: string, options: unknown, callback: unknown) => {
    const cb = (typeof options === 'function' ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void;
    const opts = (typeof options === 'object' && options !== null ? options : {}) as { all?: boolean };
    base(hostname, { ...opts, all: true }, (err, addresses) => {
      if (err) return cb(err, opts.all ? [] : '');
      const list = addresses as LookupAddress[];
      if (list.length === 0 || !list.every((a) => isPublicAddress(a.address))) {
        return cb(new ErpAddressBlockedError(hostname), opts.all ? [] : '');
      }
      if (opts.all) return cb(null, list);
      return cb(null, list[0].address, list[0].family);
    });
  }) as Lookup;
}

export interface ErpFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

function toHeaders(raw: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  return headers;
}

/**
 * fetch() for an ERP endpoint, with the checks above. Rejects (like fetch)
 * on a blocked address, a bad URL, a timeout or an oversized response.
 */
export function erpFetch(rawUrl: string, init: ErpFetchInit = {}, lookupImpl: Lookup = dnsLookup): Promise<Response> {
  const check = checkErpUrl(rawUrl);
  if (!check.ok) return Promise.reject(new Error(check.error));
  const { url } = check;

  return new Promise<Response>((resolve, reject) => {
    const req = httpsRequest(
      url,
      {
        method: init.method ?? 'GET',
        headers: init.headers,
        lookup: guardedLookup(lookupImpl),
        signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            res.destroy(new Error(`ERP response exceeded ${MAX_RESPONSE_BYTES} bytes`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          const code = res.statusCode ?? 0;
          const status = code >= 200 && code <= 599 ? code : 502;
          const noBody = status === 204 || status === 205 || status === 304;
          resolve(
            new Response(noBody ? null : Buffer.concat(chunks), {
              status,
              statusText: res.statusMessage ?? '',
              headers: toHeaders(res.headers),
            }),
          );
        });
      },
    );
    req.on('error', reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}
