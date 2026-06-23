export type ReadinessState = 'configured' | 'missing';
export type ReadinessSeverity = 'required' | 'recommended' | 'optional';

export interface ReadinessCheck {
  key: string;
  label: string;
  severity: ReadinessSeverity;
  configured: boolean;
  env: string[];
}

export interface ProductionReadiness {
  status: 'ready' | 'degraded';
  checks: ReadinessCheck[];
  missingRequired: string[];
  missingRecommended: string[];
  missingOptional: string[];
  integrations: Record<string, boolean>;
}

function hasValue(value?: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasLongSecret(value?: string | null, minLength = 32): boolean {
  return hasValue(value) && value!.trim().length >= minLength;
}

export function getProductionReadiness(): ProductionReadiness {
  const checks: ReadinessCheck[] = [
    {
      key: 'sessionSecret',
      label: 'Session signing secret',
      severity: 'required',
      configured: hasLongSecret(process.env.SESSION_SECRET),
      env: ['SESSION_SECRET'],
    },
    {
      key: 'appUrl',
      label: 'Application URL',
      severity: 'required',
      configured: hasValue(process.env.NEXT_PUBLIC_APP_URL),
      env: ['NEXT_PUBLIC_APP_URL'],
    },
    {
      key: 'ssoEncryption',
      label: 'SSO encryption key',
      severity: 'required',
      configured: hasLongSecret(process.env.SSO_ENCRYPTION_KEY),
      env: ['SSO_ENCRYPTION_KEY'],
    },
    {
      key: 'stripe',
      label: 'Stripe billing',
      severity: 'recommended',
      configured: hasValue(process.env.STRIPE_SECRET_KEY),
      env: ['STRIPE_SECRET_KEY'],
    },
    {
      key: 'email',
      label: 'Outbound email',
      severity: 'recommended',
      configured:
        (hasValue(process.env.SENDGRID_API_KEY) && hasValue(process.env.EMAIL_FROM ?? process.env.SMTP_FROM)) ||
        (hasValue(process.env.SMTP_HOST) && hasValue(process.env.SMTP_USER) && hasValue(process.env.SMTP_PASS)),
      env: ['SENDGRID_API_KEY', 'EMAIL_FROM', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM'],
    },
    {
      key: 'sentry',
      label: 'Error monitoring',
      severity: 'recommended',
      configured: hasValue(process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN),
      env: ['SENTRY_DSN', 'NEXT_PUBLIC_SENTRY_DSN'],
    },
    {
      key: 'uptimeMonitor',
      label: 'Uptime monitor',
      severity: 'recommended',
      configured: hasValue(process.env.UPTIME_MONITOR_URL),
      env: ['UPTIME_MONITOR_URL'],
    },
    {
      key: 'backupPolicy',
      label: 'Backup policy confirmation',
      severity: 'recommended',
      configured: process.env.NEON_BACKUP_POLICY_CONFIRMED === 'true',
      env: ['NEON_BACKUP_POLICY_CONFIRMED'],
    },
    {
      key: 'setupSecret',
      label: 'Setup endpoint secret',
      severity: 'optional',
      configured: hasLongSecret(process.env.SETUP_SECRET, 16),
      env: ['SETUP_SECRET'],
    },
  ];

  const missingRequired = checks
    .filter(check => check.severity === 'required' && !check.configured)
    .map(check => check.key);
  const missingRecommended = checks
    .filter(check => check.severity === 'recommended' && !check.configured)
    .map(check => check.key);
  const missingOptional = checks
    .filter(check => check.severity === 'optional' && !check.configured)
    .map(check => check.key);

  return {
    status: missingRequired.length > 0 ? 'degraded' : 'ready',
    checks,
    missingRequired,
    missingRecommended,
    missingOptional,
    integrations: Object.fromEntries(checks.map(check => [check.key, check.configured])),
  };
}
