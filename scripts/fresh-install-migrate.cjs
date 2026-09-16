#!/usr/bin/env node
// scripts/fresh-install-migrate.cjs
//
// Reliable migration runner for provisioning a NEW environment (a genuinely
// empty database) — staging, DR, or a new client deployment.
//
// `npx prisma migrate deploy` alone is not reliable here: a number of
// tracked migrations assume state that was only ever created out-of-band on
// real environments (never captured as a tracked migration itself). The
// exact, VERIFIED fix — an ordered list of `prisma migrate resolve
// --applied <name>` steps, each one immediately followed by a later,
// additive migration that closes the actual gap — is documented in
// docs/FRESH_DATABASE_SETUP.md ("Full resolve chain"). That doc is the
// source of truth: it was produced by an actual empty-database replay,
// start to finish, with no shortcuts (see its own text for the full
// history — GitHub issues #77/#78).
//
// This script does NOT hard-code that list. It reads it straight out of
// docs/FRESH_DATABASE_SETUP.md every run, so the two can never drift apart
// silently — if that doc is updated with a new resolve step, this script
// picks it up automatically the next time it runs.
//
// Usage:  node scripts/fresh-install-migrate.cjs
// (wired up as `npm run db:migrate:fresh`)

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DOC_PATH = path.join(__dirname, '..', 'docs', 'FRESH_DATABASE_SETUP.md');

function loadKnownResolveChain() {
  if (!fs.existsSync(DOC_PATH)) {
    console.warn(
      `Warning: ${path.relative(process.cwd(), DOC_PATH)} not found — running ` +
        `a plain "migrate deploy" with no known resolve steps.`
    );
    return [];
  }
  const text = fs.readFileSync(DOC_PATH, 'utf8');
  const fenceMatch = text.match(/## Full resolve chain[\s\S]*?```bash([\s\S]*?)```/);
  if (!fenceMatch) {
    console.warn(
      `Warning: could not find the "Full resolve chain" code block in ` +
        `${path.relative(process.cwd(), DOC_PATH)} — running a plain "migrate ` +
        `deploy" with no known resolve steps. If that doc's structure changed, ` +
        `update the parser in this script to match.`
    );
    return [];
  }
  const block = fenceMatch[1];
  const names = [];
  const lineRe = /^npx prisma migrate resolve --applied (\S+)\s*$/gm;
  let m;
  while ((m = lineRe.exec(block)) !== null) {
    names.push(m[1]);
  }
  return names;
}

function tryDeploy(label) {
  console.log(`\n--- prisma migrate deploy (${label}) ---`);
  try {
    const out = execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'pipe'],
    });
    process.stdout.write(out);
    return { ok: true };
  } catch (err) {
    const out = `${err.stdout || ''}${err.stderr || ''}`;
    process.stdout.write(out);
    return { ok: false, output: out };
  }
}

function main() {
  const knownChain = loadKnownResolveChain();
  console.log(
    `Loaded ${knownChain.length} known resolve step(s) from ` +
      `${path.relative(process.cwd(), DOC_PATH)}.`
  );

  const remaining = [...knownChain];
  let attempt = 1;

  for (;;) {
    const result = tryDeploy(`attempt ${attempt}`);
    if (result.ok) {
      console.log('\nAll migrations applied. Environment is ready.');
      return;
    }

    const idx = remaining.findIndex(name => result.output.includes(name));
    if (idx === -1) {
      console.error(
        '\nmigrate deploy failed on a migration that is not in the documented ' +
          `resolve chain (${path.relative(process.cwd(), DOC_PATH)}). Read the ` +
          'error above — it names the failing migration and the underlying ' +
          'database error. This is either a genuinely new problem, or the doc ' +
          'is out of date; either way, do not blindly resolve past it — ' +
          'investigate first, the way every prior entry in that doc was ' +
          'investigated (confirm against the real production schema, write a ' +
          'corrective migration, update the doc, then re-run this script).'
      );
      process.exitCode = 1;
      return;
    }

    const name = remaining[idx];
    remaining.splice(0, idx + 1); // this one and any we skipped over
    console.log(
      `\nKnown, documented gap: "${name}". Applying the verified workaround ` +
        `(marking it resolved, not run) and continuing.`
    );
    try {
      execFileSync('npx', ['prisma', 'migrate', 'resolve', '--applied', name], {
        encoding: 'utf8',
        stdio: 'inherit',
      });
    } catch (err) {
      console.error(`\n"migrate resolve --applied ${name}" itself failed — stopping here.`);
      process.exitCode = 1;
      return;
    }
    attempt += 1;
  }
}

main();
