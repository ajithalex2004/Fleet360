import { config } from 'dotenv';

config({ path: '.env' });
config({ path: '.env.local', override: true });

const checks = [
  {
    key: 'DATABASE_URL',
    required: true,
    ok: isNeonUrl(process.env.DATABASE_URL),
    message: 'DATABASE_URL must be a Neon Postgres URL.',
  },
  {
    key: 'SESSION_SECRET',
    required: true,
    ok: hasLongSecret(process.env.SESSION_SECRET),
    message: 'SESSION_SECRET must be at least 32 characters.',
  },
  {
    key: 'NEXT_PUBLIC_APP_URL',
    required: true,
    ok: hasUrl(process.env.NEXT_PUBLIC_APP_URL),
    message: 'NEXT_PUBLIC_APP_URL must be set to the public app origin.',
  },
  {
    key: 'SSO_ENCRYPTION_KEY',
    required: true,
    ok: hasLongSecret(process.env.SSO_ENCRYPTION_KEY),
    message: 'SSO_ENCRYPTION_KEY must be at least 32 characters.',
  },
  {
    key: 'FLEET360_ENABLE_LOCAL_MIRROR',
    required: false,
    ok: process.env.FLEET360_ENABLE_LOCAL_MIRROR !== 'true',
    message: 'Local DB mirror should be false/unset for production.',
  },
  {
    key: 'STRIPE_SECRET_KEY',
    required: false,
    ok: hasValue(process.env.STRIPE_SECRET_KEY),
    message: 'Stripe is not configured; billing checkout/portal will be unavailable.',
  },
  {
    key: 'EMAIL',
    required: false,
    ok:
      (hasValue(process.env.SENDGRID_API_KEY) && hasValue(process.env.EMAIL_FROM ?? process.env.SMTP_FROM)) ||
      (hasValue(process.env.SMTP_HOST) && hasValue(process.env.SMTP_USER) && hasValue(process.env.SMTP_PASS)),
    message: 'Email is not configured; invitations and notifications may not send.',
  },
  {
    key: 'SENTRY_DSN',
    required: false,
    ok: hasValue(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN),
    message: 'Sentry is not configured; production errors will not be reported.',
  },
  {
    key: 'UPTIME_MONITOR_URL',
    required: false,
    ok: hasValue(process.env.UPTIME_MONITOR_URL),
    message: 'No external uptime monitor URL recorded for /api/health.',
  },
  {
    key: 'NEON_BACKUP_POLICY_CONFIRMED',
    required: false,
    ok: process.env.NEON_BACKUP_POLICY_CONFIRMED === 'true',
    message: 'Neon backup/PITR policy has not been confirmed for this environment.',
  },
];

const requiredFailures = checks.filter(check => check.required && !check.ok);
const recommendedFailures = checks.filter(check => !check.required && !check.ok);

for (const check of checks) {
  const icon = check.ok ? 'OK ' : check.required ? 'ERR' : 'WARN';
  console.log(`${icon} ${check.key} - ${check.ok ? 'configured' : check.message}`);
}

if (requiredFailures.length > 0) {
  console.error(`\nProduction readiness failed: ${requiredFailures.length} required item(s) need attention.`);
  process.exit(1);
}

if (recommendedFailures.length > 0) {
  console.warn(`\nProduction readiness passed with ${recommendedFailures.length} warning(s).`);
  process.exit(0);
}

console.log('\nProduction readiness passed.');

function hasValue(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasLongSecret(value) {
  return hasValue(value) && value.trim().length >= 32;
}

function hasUrl(value) {
  if (!hasValue(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isNeonUrl(value) {
  if (!hasValue(value)) return false;
  try {
    const parsed = new URL(value);
    return ['postgres:', 'postgresql:'].includes(parsed.protocol) && parsed.hostname.endsWith('.neon.tech');
  } catch {
    return false;
  }
}
