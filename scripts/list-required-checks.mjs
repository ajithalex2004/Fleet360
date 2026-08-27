#!/usr/bin/env node
/**
 * Emit the EXACT status-check names that are safe to mark Required on main.
 *
 * WHY THIS EXISTS
 *
 * A branch-protection required check is matched by the JOB name, not the
 * workflow name and not "workflow / job". Getting it wrong does not fail
 * loudly — GitHub reports the check as "Expected — waiting for status to be
 * reported" and blocks every merge, forever, waiting for something that will
 * never arrive.
 *
 * Two ways to arrive at that state:
 *
 *   1. Guessing the name. An implementation plan listed four required checks —
 *      "Phase 0 — Cross-tenant isolation tests / phase0", "Tenant RLS Check /
 *      tenant-rls-check", "Migration Safety / migration-safety", "CI / ci".
 *      All four were wrong. The real names are "Cross-tenant isolation",
 *      "Check Tenant RLS Compliance", "Destructive Migration Check" and "ci".
 *
 *   2. Requiring a PATH-FILTERED workflow. If `on.pull_request.paths` excludes
 *      the files a PR touches, the workflow never runs, so the check never
 *      reports, so the merge blocks — on PRs that have nothing to do with it.
 *      This is the subtler failure: the name is right and it still deadlocks.
 *
 * So this reads the workflows and prints what is actually true, rather than
 * anyone writing the list by hand a second time.
 *
 * Usage:
 *   node scripts/list-required-checks.mjs            human-readable
 *   node scripts/list-required-checks.mjs --json     for scripting
 *   node scripts/list-required-checks.mjs --gh       ready-to-run gh command
 *
 * Exit 0 always — this reports, it does not gate.
 */

import fs from 'node:fs';
import path from 'node:path';

const DIR = '.github/workflows';
const AS_JSON = process.argv.includes('--json');
const AS_GH = process.argv.includes('--gh');
const REPO = 'ajithalex2004/Fleet360';

/**
 * Minimal YAML reading for the two things needed: job names and whether
 * pull_request carries a paths filter.
 *
 * Deliberately not a YAML parser — no dependency, and the shapes here are
 * fixed. A workflow this cannot read is reported as unknown rather than
 * silently assumed safe.
 */
function parse(src) {
  const lines = src.split(/\r?\n/);
  const out = { name: null, prFilter: null, prPresent: false, jobs: [] };

  let i = 0;
  for (; i < lines.length; i++) {
    const m = /^name:\s*(.+)$/.exec(lines[i]);
    if (m) { out.name = m[1].trim().replace(/^['"]|['"]$/g, ''); break; }
  }

  // on: block — find pull_request and any paths under it.
  const onStart = lines.findIndex(l => /^on:\s*$/.test(l) || /^on:\s*\{/.test(l));
  if (onStart >= 0) {
    for (let j = onStart + 1; j < lines.length; j++) {
      if (/^[a-zA-Z]/.test(lines[j])) break;            // left the on: block
      if (/^\s{2}pull_request:\s*$/.test(lines[j])) {
        out.prPresent = true;
        // Look ahead for `paths:` before the next 2-space key.
        for (let k = j + 1; k < lines.length; k++) {
          if (/^\s{2}\S/.test(lines[k]) || /^[a-zA-Z]/.test(lines[k])) break;
          if (/^\s{4}paths:\s*$/.test(lines[k])) {
            const paths = [];
            for (let n = k + 1; n < lines.length; n++) {
              const p = /^\s{6}-\s*(.+)$/.exec(lines[n]);
              if (!p) break;
              paths.push(p[1].trim().replace(/^['"]|['"]$/g, ''));
            }
            out.prFilter = paths;
            break;
          }
        }
      }
    }
  }

  // jobs: block — each 2-space key is a job id; its `name:` is the check name.
  const jobsStart = lines.findIndex(l => /^jobs:\s*$/.test(l));
  if (jobsStart >= 0) {
    for (let j = jobsStart + 1; j < lines.length; j++) {
      const id = /^\s{2}([a-zA-Z0-9_-]+):\s*$/.exec(lines[j]);
      if (!id) continue;
      let display = id[1];
      for (let k = j + 1; k < lines.length && !/^\s{2}\S/.test(lines[k]); k++) {
        const nm = /^\s{4}name:\s*(.+)$/.exec(lines[k]);
        if (nm) { display = nm[1].trim().replace(/^['"]|['"]$/g, ''); break; }
      }
      out.jobs.push(display);
    }
  }
  return out;
}

const files = fs.readdirSync(DIR).filter(f => /\.ya?ml$/.test(f));
const safe = [];
const unsafe = [];

for (const f of files) {
  const wf = parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
  for (const job of wf.jobs) {
    const entry = { check: job, workflow: wf.name ?? f, file: f, prFilter: wf.prFilter };
    if (!wf.prPresent) {
      unsafe.push({ ...entry, reason: 'no pull_request trigger — never reports on a PR' });
    } else if (wf.prFilter) {
      unsafe.push({ ...entry, reason: `pull_request is path-filtered (${wf.prFilter.join(', ')}) — will not report on PRs outside those paths, blocking the merge` });
    } else {
      safe.push(entry);
    }
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ safe, unsafe }, null, 2));
} else if (AS_GH) {
  const names = safe.map(s => `"${s.check}"`).join(' ');
  console.log(`# Required status checks that will actually report on every PR:`);
  console.log(`gh api -X PUT repos/${REPO}/branches/main/protection/required_status_checks \\`);
  console.log(`  -F strict=true \\`);
  safe.forEach(s => console.log(`  -f 'contexts[]=${s.check}' \\`));
  console.log(`  # ${safe.length} checks`);
  void names;
} else {
  console.log(`\nStatus checks SAFE to require (${safe.length}) — these report on every PR:\n`);
  for (const s of safe) console.log(`  ${s.check.padEnd(36)} ${s.workflow}`);

  if (unsafe.length) {
    console.log(`\nNOT safe to require (${unsafe.length}) — requiring these blocks merges:\n`);
    for (const u of unsafe) {
      console.log(`  ${u.check.padEnd(36)} ${u.workflow}`);
      console.log(`     └─ ${u.reason}`);
    }
  }
  console.log('\nMatch on the JOB name exactly as printed above. Not the workflow');
  console.log('name, and not "workflow / job".\n');
}
