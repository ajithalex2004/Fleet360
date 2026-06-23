import { spawnSync } from 'node:child_process';

const required = [
  ['Production env readiness', 'npm', ['run', 'check:prod']],
  ['Prisma client generation', 'npx', ['prisma', 'generate']],
];

if (process.env.SKIP_DB_DEPLOY_CHECKS !== 'true') {
  required.push(['Prisma migration status', 'npx', ['prisma', 'migrate', 'status']]);
} else {
  console.log('SKIP Prisma migration status - SKIP_DB_DEPLOY_CHECKS=true.');
}

const optional = [
  ['Targeted Admin tenant E2E', 'npx', ['playwright', 'test', 'tests/e2e/admin-tenants.spec.ts', '--grep', 'ADM-TEN-02']],
];

const runOptional = process.argv.includes('--with-e2e');
let failed = false;

console.log('Fleet360 deploy readiness\n');

for (const [label, command, args] of required) {
  if (!runStep(label, command, args, true)) failed = true;
}

if (runOptional) {
  for (const [label, command, args] of optional) {
    if (!runStep(label, command, args, false)) failed = true;
  }
} else {
  console.log('SKIP Targeted Admin tenant E2E - pass --with-e2e to include browser validation.');
}

if (failed) {
  console.error('\nDeploy readiness failed. Resolve required failures before release.');
  process.exit(1);
}

console.log('\nDeploy readiness passed.');

function runStep(label, command, args, requiredStep) {
  console.log(`\n== ${label} ==`);
  const result = spawnSync(resolveCommand(command), args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (result.status === 0) {
    console.log(`PASS ${label}`);
    return true;
  }
  const tag = requiredStep ? 'FAIL' : 'WARN';
  console.error(`${tag} ${label} exited with code ${result.status ?? 'unknown'}`);
  return !requiredStep;
}

function resolveCommand(command) {
  return command;
}
