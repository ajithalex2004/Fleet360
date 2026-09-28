#!/usr/bin/env node
/**
 * Fleet360 security harness: live evidence of tenant isolation and
 * role-based access on a deployment. See docs/security/SECURITY_HARNESS.md.
 *
 *   node scripts/security-harness/run.mjs --base https://staging.example.com \
 *        [--go https://go.staging.example.com] [--accounts harness.accounts.json] \
 *        [--phases identity,roles,go,cross-tenant,database] [--out security-evidence] \
 *        [--strict] [--writes]
 *
 * Phases:
 *   identity      deployed commit, sign-in of every test account
 *   roles         every account × every probe of plan.json as a dry run
 *                 (nothing executes): live decision against the policy's
 *                 expectation for the account's role; invariants; when
 *                 AUTHZ_MODE=enforce, denied reads really answer 403
 *   go            the Go backend's dry-run decisions equal Next.js's
 *   cross-tenant  tenant A reads, lists, filters and (with --writes)
 *                 edits tenant B's records by id, with spoofed identity
 *                 headers too: must see none of them
 *   database      (HARNESS_DB_URL) RLS proved as the runtime role
 *
 * Secrets never go on the command line or in files: passwords (and TOTP
 * secrets) come from environment variables named in the accounts file.
 * Exit code 1 when any check fails.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  Results, dryRun, expectedAnswers, extractIds, leaks, login, probePath, renderMarkdown, request, stable,
} from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PHASES = ['identity', 'roles', 'go', 'cross-tenant', 'database'];

function args(argv) {
  const a = { phases: PHASES, strict: false, writes: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--base') a.base = next();
    else if (k === '--go') a.go = next();
    else if (k === '--accounts') a.accounts = next();
    else if (k === '--phases') a.phases = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (k === '--out') a.out = next();
    else if (k === '--strict') a.strict = true;
    else if (k === '--writes') a.writes = true;
    else if (k === '--help' || k === '-h') a.help = true;
    else throw new Error(`unknown argument ${k}`);
  }
  a.base = (a.base ?? process.env.HARNESS_BASE_URL ?? '').replace(/\/+$/, '');
  a.go = (a.go ?? process.env.HARNESS_GO_URL ?? '').replace(/\/+$/, '') || null;
  a.accounts = a.accounts ?? process.env.HARNESS_ACCOUNTS ?? 'harness.accounts.json';
  return a;
}

export async function main(argv = process.argv.slice(2), { env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  const opts = args(argv);
  if (opts.help || !opts.base) {
    log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
    return opts.help ? 0 : 2;
  }
  const plan = JSON.parse(fs.readFileSync(path.join(HERE, 'plan.json'), 'utf8'));
  const accounts = JSON.parse(fs.readFileSync(opts.accounts, 'utf8'));
  const results = new Results();
  const http = { fetchImpl };
  const meta = {
    startedAt: new Date().toISOString(),
    base: opts.base,
    go: opts.go,
    planPolicy: plan.policyVersion,
    harnessSha: (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return null; } })(),
    accounts: [],
    roleMatrix: [],
  };
  if (opts.writes) {
    const allowed = env.HARNESS_ALLOW_WRITES;
    if (!allowed || allowed !== new URL(opts.base).host) {
      throw new Error(`--writes edits records: set HARNESS_ALLOW_WRITES=${new URL(opts.base).host} to confirm this target is a test environment`);
    }
  }

  const A = accounts.tenants?.A;
  const B = accounts.tenants?.B;
  if (!A?.id || !A.accounts?.length) throw new Error('accounts file: tenants.A with id and accounts is required');

  // ── identity ──
  const health = await request(`${opts.base}/api/health`, {}, http).then((r) => r.json()).catch(() => ({}));
  meta.deployedSha = health.release && health.release !== 'unknown' ? health.release : null;
  results.add('identity', 'deployed commit reported by /api/health', meta.deployedSha ? 'pass' : 'warn',
    meta.deployedSha ? `commit ${meta.deployedSha}` : 'no commit reported (set GIT_COMMIT_SHA on the service)');

  const sessions = { A: [], B: [] };
  for (const [key, tenant] of [['A', A], ['B', B]]) {
    for (const account of tenant?.accounts ?? []) {
      try {
        const s = await login(opts.base, account, tenant.id, { ...http, env });
        sessions[key].push(s);
        meta.accounts.push(`${key}: ${s.label}`);
        results.add('identity', `sign in ${key}: ${s.label}`, 'pass',
          `role ${s.user.roleCode}${s.user.isTenantOverride ? ' (tenant override)' : ''}, plan ${s.tenant.plan}, Go token ${s.backendToken ? 'yes' : 'no'}`);
      } catch (err) {
        results.add('identity', `sign in ${key}: ${account.role ?? account.email}`, 'fail', err.message);
      }
    }
  }

  // ── roles ──
  if (opts.phases.includes('roles')) {
    const probes = plan.probes.map((p, i) => ({ ...p, i })).filter((p) => p.backend === 'next');
    for (const s of [...sessions.A, ...sessions.B]) {
      const role = s.user.originalRoleCode ?? s.user.roleCode;
      const expected = expectedAnswers(plan, role, s.tenant.plan);
      const other = s.tenant.id === A.id ? (B?.id ?? '00000000-0000-4000-8000-000000000000') : A.id;
      const drift = [];
      const allowedByArea = new Map();
      let answered = 0;
      for (const p of probes) {
        const d = await dryRun(s, p.method, probePath(p.path, s.tenant.id, other), http);
        if (d.answered) {
          answered++;
          if (!meta.deployedPolicy) Object.assign(meta, { deployedPolicy: d.policy, authzMode: d.mode, stepUpMode: d.stepUpMode });
        }
        if (d.allow) {
          const area = p.label.split(':')[0];
          allowedByArea.set(area, [...(allowedByArea.get(area) ?? []), p.label.split(': ')[1] ?? p.method]);
        }
        // Invariants, whatever the role's configuration.
        if (d.allow && p.path.includes('{other}') && role !== 'SUPER_ADMIN') {
          results.add('roles', `${s.label}: naming another tenant is refused`, 'fail', `${p.method} ${p.path} allowed`);
        }
        if (plan.stepUp[p.i] === '1' && d.answered && d.stepUp !== 'required') {
          results.add('roles', `${s.label}: ${p.id} needs a passkey step-up`, 'fail', `x-step-up: ${d.stepUp}`);
        }
        if (expected && expected[p.i] !== d.allow) drift.push(`${p.id}: live ${d.allow ? 'allow' : 'deny'} (${d.reason ?? d.status}), policy ${expected[p.i] ? 'allow' : 'deny'}`);
        // Enforcement proof: a denied read really answers 403 (reads are safe to send).
        if (!d.allow && d.answered && d.outcome === 'refused' && p.method === 'GET') {
          const real = await request(`${s.base}${probePath(p.path, s.tenant.id, other)}`, { headers: { cookie: s.cookie } }, http);
          if (real.status !== 403) results.add('roles', `${s.label}: denied ${p.id} answers 403`, 'fail', `answered ${real.status}`);
        }
      }
      results.add('roles', `${s.label}: dry runs answered`, answered === probes.length ? 'pass' : 'warn', `${answered}/${probes.length}`);
      if (!expected) {
        results.add('roles', `${s.label}: role ${role} has no policy baseline`, 'warn', 'custom role: see the live role matrix');
      } else if (drift.length === 0) {
        results.add('roles', `${s.label}: every decision matches the policy for ${role}`, 'pass', `${probes.length} probes`);
      } else {
        const override = s.user.isTenantOverride ? ' (tenant override in force)' : '';
        results.add('roles', `${s.label}: ${drift.length} decisions differ from the policy for ${role}${override}`,
          opts.strict ? 'fail' : 'warn', drift.slice(0, 20).join('; ') + (drift.length > 20 ? '; …' : ''));
      }
      for (const [area, allowed] of allowedByArea) meta.roleMatrix.push({ account: s.label, area, allowed });
    }
    if (meta.deployedPolicy && meta.deployedPolicy !== plan.policyVersion) {
      results.add('roles', 'deployed policy matches the harness plan', 'warn', `deployed ${meta.deployedPolicy}, plan ${plan.policyVersion}: run the harness from the deployed commit`);
    }
    if (meta.authzMode && meta.authzMode !== 'enforce') {
      results.add('roles', 'AUTHZ_MODE is enforce', 'warn', `AUTHZ_MODE is ${meta.authzMode}: denials are logged, not refused`);
    }
    if (meta.stepUpMode && meta.stepUpMode !== 'enforce') {
      results.add('roles', 'STEP_UP_MODE is enforce', 'warn', `STEP_UP_MODE is ${meta.stepUpMode}`);
    }
  }

  // ── go ──
  if (opts.phases.includes('go')) {
    if (!opts.go) {
      results.add('go', 'Go backend parity', 'skip', 'no --go URL');
    } else {
      const probes = plan.probes.map((p, i) => ({ ...p, i })).filter((p) => p.backend === 'go');
      for (const s of sessions.A.slice(0, 3)) {
        if (!s.backendToken) { results.add('go', `${s.label}: Go token`, 'fail', 'sign-in returned no backend token'); continue; }
        const expected = expectedAnswers(plan, s.user.originalRoleCode ?? s.user.roleCode, s.tenant.plan);
        let same = 0;
        for (const p of probes) {
          const pathFor = probePath(p.path, s.tenant.id, B?.id ?? '');
          const [n, g] = await Promise.all([dryRun(s, p.method, pathFor, http), dryRun(s, p.method, pathFor, { ...http, go: opts.go })]);
          // Next.js answers dry runs for staff APIs; paths it serves before the
          // session step (stored files) are compared with the policy instead.
          const reference = n.answered ? { allow: n.allow, reason: n.reason, from: 'next' } : expected ? { allow: expected[p.i], reason: null, from: 'policy' } : null;
          if (!g.answered) results.add('go', `${s.label}: ${p.id} dry run`, 'fail', `Go answered ${g.status}`);
          else if (!reference) { results.add('go', `${s.label}: ${p.id}`, 'skip', 'no Next.js answer and no policy baseline for this role'); same++; }
          else if (g.allow !== reference.allow || (reference.reason && sameReason(g.reason) !== sameReason(reference.reason))) {
            results.add('go', `${s.label}: ${p.id} same decision as Next.js`, 'fail', `go ${g.allow ? 'allow' : 'deny'} (${g.reason}), ${reference.from} ${reference.allow ? 'allow' : 'deny'}${reference.reason ? ` (${reference.reason})` : ''}`);
          } else same++;
        }
        results.add('go', `${s.label}: Go decisions equal Next.js`, same === probes.length ? 'pass' : 'fail', `${same}/${probes.length}`);
      }
    }
  }

  // ── cross-tenant ──
  if (opts.phases.includes('cross-tenant')) {
    const a = sessions.A[0];
    const b = sessions.B[0];
    if (!a || !b) {
      results.add('cross-tenant', 'two tenants signed in', 'skip', 'needs an account in tenant A and tenant B');
    } else {
      await crossTenant({ plan, a, b, go: opts.go, writes: opts.writes, results, http, log });
    }
  }

  // ── database ──
  if (opts.phases.includes('database')) {
    if (!env.HARNESS_DB_URL) {
      results.add('database', 'runtime-role RLS probes', 'skip', 'HARNESS_DB_URL not set');
    } else if (!B?.id) {
      results.add('database', 'runtime-role RLS probes', 'skip', 'needs tenants.B.id');
    } else {
      const { runDbPhase } = await import('./db-phase.mjs');
      await runDbPhase({ url: env.HARNESS_DB_URL, tenantA: A.id, tenantB: B.id, results, log });
    }
  }

  meta.finishedAt = new Date().toISOString();
  const dir = opts.out ?? path.join('security-evidence', meta.startedAt.replace(/[:.]/g, '-'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify({ meta, checks: results.checks }, null, 2));
  fs.writeFileSync(path.join(dir, 'report.md'), renderMarkdown(meta, results));
  log(`\n${results.failed ? 'FAIL' : 'PASS'}: ${results.count('pass')} passed, ${results.count('fail')} failed, ${results.count('warn')} warnings, ${results.count('skip')} not covered`);
  log(`evidence: ${path.join(dir, 'report.md')}`);
  return results.failed ? 1 : 0;
}

/** Next.js names an admin route refusal admin-gate:<level>, Go admin-level:<level>: the same answer. */
const sameReason = (reason) => String(reason ?? '').replace(/^admin-gate:/, 'admin-level:');

/** Tenant A tries to reach tenant B's records every way it can. */
async function crossTenant({ plan, a, b, go, writes, results, http, log }) {
  const phase = 'cross-tenant';
  const get = (s, p, extra = {}) => request(`${s.base}${p}`, { headers: { cookie: s.cookie, ...extra } }, http);
  const body = async (res) => { const t = await res.text(); try { return { text: t, json: JSON.parse(t) } } catch { return { text: t, json: null }; } };
  let covered = 0;

  for (const r of plan.resources) {
    const listB = await get(b, r.list);
    if (listB.status !== 200) { results.add(phase, `${r.list}`, 'skip', `tenant B cannot list it (${listB.status})`); continue; }
    const idsB = extractIds((await body(listB)).json).slice(0, 3);
    if (!idsB.length) { results.add(phase, `${r.list}`, 'skip', 'tenant B has no records here'); continue; }
    covered++;
    const secrets = [...idsB, b.tenant.id];

    // A's own list, and the list with every spoofing trick.
    const variants = [
      ['list', r.list, {}],
      ['list ?tenantId=B', `${r.list}?tenantId=${b.tenant.id}`, {}],
      ['list with x-tenant-id: B', r.list, { 'x-tenant-id': b.tenant.id, 'x-requested-tenant-id': b.tenant.id }],
    ];
    for (const [label, p, headers] of variants) {
      const res = await get(a, p, headers);
      const found = res.status < 400 ? leaks((await body(res)).text, secrets) : [];
      results.add(phase, `${r.list}: ${label} shows none of B's records`, found.length ? 'fail' : 'pass', found.length ? `leaked ${found.join(', ')}` : `status ${res.status}`);
    }

    for (const id of idsB) {
      const detail = r.detail.replace('{id}', encodeURIComponent(id));
      const before = await body(await get(b, detail));
      for (const [label, headers] of [['read by id', {}], ['read by id with x-tenant-id: B', { 'x-tenant-id': b.tenant.id }]]) {
        const res = await get(a, detail, headers);
        const text = (await body(res)).text;
        const ok = res.status === 403 || res.status === 404 || (res.status < 400 && !leaks(text, [id]).length);
        results.add(phase, `${detail.replace(id, '{B id}')}: ${label}`, ok ? 'pass' : 'fail', `status ${res.status}${ok ? '' : ': returned tenant B’s record'}`);
      }
      if (writes && r.writes.includes('PATCH')) {
        const res = await request(`${a.base}${detail}`, { method: 'PATCH', headers: { cookie: a.cookie, 'content-type': 'application/json' }, body: '{}' }, http);
        const after = await body(await get(b, detail));
        const unchanged = stable(after.json) === stable(before.json);
        results.add(phase, `${detail.replace(id, '{B id}')}: edit refused`, res.status >= 400 && unchanged ? 'pass' : 'fail',
          `status ${res.status}${unchanged ? '' : '; tenant B’s record changed'}`);
      }
      if (go && a.backendToken && r.list.startsWith('/api/fleet/vehicles')) {
        const res = await request(`${go}/api/v1/fleet/vehicles/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${a.backendToken}` } }, http);
        const text = await res.text();
        const ok = res.status === 403 || res.status === 404 || !text.includes(id);
        results.add(phase, `Go /api/v1/fleet/vehicles/{B id}: read by id`, ok ? 'pass' : 'fail', `status ${res.status}`);
      }
    }
  }
  results.add(phase, `resources with tenant B records tested`, covered ? 'pass' : 'warn', `${covered}/${plan.resources.length}`);
  log(`  cross-tenant: ${covered} resources tested`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().then((code) => process.exit(code), (err) => { console.error(`harness: ${err.message}`); process.exit(2); });
}
