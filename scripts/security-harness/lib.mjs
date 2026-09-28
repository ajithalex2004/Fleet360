/**
 * Security harness: helpers shared by run.mjs and its tests
 * (tests/unit/security-harness-lib.test.ts). No dependencies beyond Node 20.
 */
import crypto from 'node:crypto';

// ── HTTP ─────────────────────────────────────────────────────────────────────

/** A signed-in caller: the xl-session cookie and the Go backend token. */
export class Session {
  constructor({ base, cookie, backendToken, user, tenant, label }) {
    Object.assign(this, { base, cookie, backendToken, user, tenant, label });
  }
}

/** fetch with a timeout and one polite retry on 429 (Retry-After). */
export async function request(url, init = {}, { timeoutMs = 20_000, fetchImpl = fetch } = {}) {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, { ...init, signal: ctrl.signal, redirect: 'manual' });
      if (res.status === 429 && attempt === 0) {
        const wait = Math.min(Number(res.headers.get('retry-after') ?? '5'), 60) * 1000;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }
      return res;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** RFC 6238 TOTP (30 s, 6 digits) for test accounts with MFA on. */
export function totp(secretBase32, at = Date.now()) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const c of secretBase32.replace(/=+$/, '').toUpperCase()) {
    const v = alphabet.indexOf(c);
    if (v < 0) throw new Error('invalid base32 TOTP secret');
    bits += v.toString(2).padStart(5, '0');
  }
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 1000 / 30)));
  const h = crypto.createHmac('sha1', key).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, '0');
}

/** Sign in; the password (and TOTP secret) come from environment variables named in the accounts file. */
export async function login(base, account, tenantId, opts = {}) {
  const env = opts.env ?? process.env;
  const password = env[account.passwordEnv];
  if (!password) throw new Error(`${account.email}: environment variable ${account.passwordEnv} is not set`);
  const body = { email: account.email, password, tenantId };
  if (account.totpSecretEnv) {
    const secret = env[account.totpSecretEnv];
    if (!secret) throw new Error(`${account.email}: environment variable ${account.totpSecretEnv} is not set`);
    body.mfaCode = totp(secret);
  }
  const res = await request(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status !== 200) throw new Error(`${account.email}: sign-in failed (${res.status} ${data.message ?? data.error ?? ''})`);
  const cookie = (res.headers.getSetCookie?.() ?? [res.headers.get('set-cookie') ?? ''])
    .map((c) => c.split(';')[0])
    .find((c) => c.startsWith('xl-session='));
  if (!cookie) throw new Error(`${account.email}: no session cookie in the sign-in response`);
  if (data.tenant?.id !== tenantId) throw new Error(`${account.email}: signed in to tenant ${data.tenant?.id}, expected ${tenantId}`);
  return new Session({
    base,
    cookie,
    backendToken: data.backendToken ?? null,
    user: data.user,
    tenant: data.tenant,
    label: `${account.role ?? data.user?.roleCode} (${maskEmail(account.email)})`,
  });
}

export function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  return `${name.slice(0, 2)}***@${domain ?? ''}`;
}

// ── Dry runs ─────────────────────────────────────────────────────────────────

/** The decision headers of a dry run (src/lib/authz/dry-run.ts, backend/authz). */
export function parseDryRun(res) {
  const h = (k) => res.headers.get(k) ?? '';
  if (res.status !== 204 || !h('x-authz-decision')) {
    // The admin gate or another middleware step refused before the dry run.
    return { answered: false, status: res.status, allow: res.status < 400 };
  }
  return {
    answered: true,
    status: res.status,
    backend: h('x-authz-backend'),
    policy: h('x-authz-policy'),
    mode: h('x-authz-mode'),
    allow: h('x-authz-decision') === 'allow',
    reason: h('x-authz-reason'),
    area: h('x-authz-area'),
    required: h('x-authz-required'),
    outcome: h('x-authz-outcome'),
    stepUp: h('x-step-up'),
    stepUpMode: h('x-step-up-mode'),
  };
}

export async function dryRun(session, method, path, { go = null, ...opts } = {}) {
  const headers = { 'x-authz-dry-run': '1' };
  let url;
  if (go) {
    if (!session.backendToken) throw new Error(`${session.label}: no Go backend token (JWT_SECRET unset?)`);
    headers.authorization = `Bearer ${session.backendToken}`;
    url = `${go}${path.replace(/^\/api\//, '/api/v1/')}`;
  } else {
    headers.cookie = session.cookie;
    url = `${session.base}${path}`;
  }
  return parseDryRun(await request(url, { method, headers }, opts));
}

// ── Cross-tenant ─────────────────────────────────────────────────────────────

/** Record ids from a list response: arrays at the top level or under a common key. */
export function extractIds(body) {
  const lists = [];
  const visit = (v, depth) => {
    if (depth > 2 || !v) return;
    if (Array.isArray(v)) { lists.push(v); return; }
    if (typeof v === 'object') for (const k of ['data', 'items', 'results', 'rows', 'records', ...Object.keys(v)]) visit(v[k], depth + 1);
  };
  visit(body, 0);
  const ids = new Set();
  for (const list of lists) {
    for (const row of list) {
      const id = row && typeof row === 'object' ? row.id ?? row.uuid : null;
      if (typeof id === 'string' || typeof id === 'number') ids.add(String(id));
    }
  }
  return [...ids];
}

/** Whether a response body mentions any of the other tenant's ids or its tenant id. */
export function leaks(text, secrets) {
  return secrets.filter((s) => s && s.length >= 6 && text.includes(s));
}

/** A record's JSON without fields that change on every read or write. */
export function stable(body) {
  return JSON.stringify(body, (k, v) => (/^(updatedAt|updated_at|lastSeenAt|last_seen_at|serverTime|generatedAt)$/.test(k) ? undefined : v));
}

// ── Plan ─────────────────────────────────────────────────────────────────────

export const expectedAnswers = (plan, role, tenantPlan) => {
  const byPlan = plan.expected[role];
  if (!byPlan) return null;
  const bits = byPlan[tenantPlan === 'TRIAL' ? 'TRIAL' : 'PRO'];
  return bits.split('').map((c) => c === '1');
};

export const probePath = (path, tenant, other) => path.replace(/\{tenant\}/g, tenant).replace(/\{other\}/g, other);

// ── Results and report ───────────────────────────────────────────────────────

export class Results {
  constructor() {
    this.checks = [];
  }
  /** status: pass | fail | warn | skip */
  add(phase, name, status, detail = '') {
    this.checks.push({ phase, name, status, detail });
  }
  count(status, phase) {
    return this.checks.filter((c) => c.status === status && (!phase || c.phase === phase)).length;
  }
  get failed() {
    return this.count('fail') > 0;
  }
}

export function renderMarkdown(meta, results) {
  const phases = [...new Set(results.checks.map((c) => c.phase))];
  const lines = [
    '# Fleet360 security harness evidence',
    '',
    `- **Result:** ${results.failed ? 'FAIL' : 'PASS'}`,
    `- **Run:** ${meta.startedAt} → ${meta.finishedAt}`,
    `- **Target:** ${meta.base}${meta.go ? ` (Go: ${meta.go})` : ''}`,
    `- **Deployed commit:** ${meta.deployedSha ?? 'unknown'}`,
    `- **Policy version:** harness ${meta.planPolicy}, deployed ${meta.deployedPolicy ?? 'unknown'}`,
    `- **Modes:** AUTHZ_MODE ${meta.authzMode ?? 'unknown'}, STEP_UP_MODE ${meta.stepUpMode ?? 'unknown'}`,
    `- **Harness commit:** ${meta.harnessSha ?? 'unknown'}`,
    `- **Accounts:** ${meta.accounts.join('; ')}`,
    '',
    '| Phase | Pass | Fail | Warn | Skipped |',
    '|---|---:|---:|---:|---:|',
    ...phases.map((p) => `| ${p} | ${results.count('pass', p)} | ${results.count('fail', p)} | ${results.count('warn', p)} | ${results.count('skip', p)} |`),
    '',
  ];
  for (const status of ['fail', 'warn', 'skip']) {
    const rows = results.checks.filter((c) => c.status === status);
    if (!rows.length) continue;
    lines.push(`## ${{ fail: 'Failures', warn: 'Warnings', skip: 'Not covered' }[status]} (${rows.length})`, '');
    for (const c of rows.slice(0, 500)) lines.push(`- **[${c.phase}] ${c.name}**${c.detail ? `: ${c.detail}` : ''}`);
    if (rows.length > 500) lines.push(`- … ${rows.length - 500} more in results.json`);
    lines.push('');
  }
  if (meta.roleMatrix?.length) {
    lines.push('## Live role matrix (dry runs)', '', 'Allowed actions per role on this deployment, by area.', '');
    lines.push('| Account | Area | Allowed |', '|---|---|---|');
    for (const r of meta.roleMatrix) lines.push(`| ${r.account} | ${r.area} | ${r.allowed.join(', ') || '—'} |`);
    lines.push('');
  }
  return lines.join('\n');
}
