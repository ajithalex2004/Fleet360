/**
 * Validated environment access.
 *
 * Import as `import { env } from '@/lib/env'` for type-safe, validated config.
 * Validates on first use and throws with a clear error if a required var is
 * missing in production. In dev/test, missing vars degrade to safe defaults
 * so the app still boots for partial work.
 *
 * Server-only vars (DATABASE_URL, SESSION_SECRET, etc.) live on `env`.
 * Client-exposed vars (NEXT_PUBLIC_*) live on `clientEnv` and are also
 * inlined at build time by Next.js — they are safe to use in client code.
 */

import { z } from 'zod';

const isProd = process.env.NODE_ENV === 'production';

/* ── Server schema ────────────────────────────────────────────────────────── */

const serverSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid postgres URL'),
  LOCAL_DATABASE_URL: z.string().url().optional(),

  SESSION_SECRET: isProd
    ? z.string().min(32, 'SESSION_SECRET must be ≥32 chars in production')
    : z.string().min(8).default('dev-session-secret-min-8-chars-only'),

  THESYS_API_KEY: isProd ? z.string().min(1) : z.string().default('dev-thesys-key'),
  OPENAI_API_KEY: isProd ? z.string().min(1) : z.string().default('dev-openai-key'),
  GEMINI_API_KEY: z.string().optional(),
  GOOGLE_AI_API_KEY: z.string().optional(),

  SETUP_SECRET: z.string().optional(),

  // Upstash Redis — used for distributed rate limiting and session revocation.
  // Optional: when absent the app falls back to in-process rate limiting and
  // logout-only session invalidation (safe for dev, not recommended in prod).
  UPSTASH_REDIS_REST_URL:   z.string().url().optional().or(z.literal('disabled')).or(z.literal('')),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // Enterprise data-residency regional databases.
  // Each var points to a separate Neon project for that region.
  // When absent the app falls back to DATABASE_URL for that region.
  // Only required if you have ENTERPRISE tenants with that residency set.
  DATABASE_URL_EU:  z.string().url().optional(),
  DATABASE_URL_UAE: z.string().url().optional(),
  DATABASE_URL_US:  z.string().url().optional(),

  // Email — at least SMTP_HOST OR SENDGRID_API_KEY required for prod email.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  SENDGRID_API_KEY: z.string().optional(),

  // WhatsApp / Twilio
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_NUMBER: z.string().optional(),

  // Maps (server-side)
  MAPBOX_TOKEN: z.string().optional(),
  GOOGLE_MAPS_API_KEY: z.string().optional(),

  // Operations escalation
  OPERATIONS_PHONE: z.string().optional(),
  OPERATIONS_EMAIL: z.string().email().optional().or(z.literal('')),

  // Rent-A-Car (RAC) Payment & Pre-Authorization Gateways (Telr / N-Genius / Stripe / Sandbox)
  RAC_PAYMENT_PROVIDER: z.enum(['sandbox', 'telr', 'ngenius', 'stripe']).optional().or(z.literal('')),
  STRIPE_SECRET_KEY: z.string().optional(),
  TELR_STORE_ID: z.string().optional(),
  TELR_AUTH_KEY: z.string().optional(),
  TELR_API_URL: z.string().url().optional().or(z.literal('')),
  TELR_TEST_MODE: z.enum(['0', '1']).optional().or(z.literal('')),
  NGENIUS_API_KEY: z.string().optional(),
  NGENIUS_OUTLET_REF: z.string().optional(),
  NGENIUS_ENV: z.enum(['sandbox', 'live']).optional().or(z.literal('')),
  NGENIUS_API_BASE_URL: z.string().url().optional().or(z.literal('')),

  // UAE Regulatory Renter Reporting (RTA Tarrashud / Dubai Police / Abu Dhabi ITC)
  RTA_TARRASHUD_API_URL: z.string().url().optional().or(z.literal('')),
  RTA_TARRASHUD_API_KEY: z.string().optional(),
  DUBAI_POLICE_TARRASHUD_URL: z.string().url().optional().or(z.literal('')),
  DUBAI_POLICE_TARRASHUD_KEY: z.string().optional(),
  ABU_DHABI_ITC_API_URL: z.string().url().optional().or(z.literal('')),
  ABU_DHABI_ITC_API_KEY: z.string().optional(),

  // RAC OTA & Mobility Channel Webhook Master Secrets (fallback when per-tenant DB secret is unset)
  RENTALCARS_COM_WEBHOOK_SECRET: z.string().optional(),
  BOOKING_COM_WEBHOOK_SECRET: z.string().optional(),
  CARRENTALS_COM_WEBHOOK_SECRET: z.string().optional(),
  EXPEDIA_WEBHOOK_SECRET: z.string().optional(),
  KAYAK_WEBHOOK_SECRET: z.string().optional(),
  VIPCARS_WEBHOOK_SECRET: z.string().optional(),
  YANGO_DRIVE_WEBHOOK_SECRET: z.string().optional(),
  SELFDRIVE_AE_WEBHOOK_SECRET: z.string().optional(),
  ONECLICKDRIVE_WEBHOOK_SECRET: z.string().optional(),
  HALA_CAREEM_WEBHOOK_SECRET: z.string().optional(),
  DIRECT_API_WEBHOOK_SECRET: z.string().optional(),

  // Sentry (server)
  SENTRY_DSN: z.string().url().optional().or(z.literal('')),
});

const clientSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_BASE_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_MAPBOX_TOKEN: z.string().optional(),
  NEXT_PUBLIC_SENTRY_DSN: z.string().url().optional().or(z.literal('')),
});

/* ── Parse with friendly error reporting ──────────────────────────────────── */

function cleanRaw(raw: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = { ...raw };
  for (const [k, v] of Object.entries(cleaned)) {
    if (v === '[SENSITIVE]') {
      if (k === 'DATABASE_URL' || k.startsWith('DATABASE_URL_') || k.includes('DIRECT_DATABASE_URL')) {
        cleaned[k] = 'postgres://fleet360_app:dummy@localhost:5432/fleet360_test';
      } else if (k === 'SESSION_SECRET') {
        cleaned[k] = 'dummy-session-secret-for-build-and-prebuilt-packaging-minimum-32-chars';
      } else if (k === 'RAC_PAYMENT_PROVIDER') {
        cleaned[k] = 'sandbox';
      } else if (k === 'TELR_TEST_MODE') {
        cleaned[k] = '1';
      } else if (k === 'NGENIUS_ENV') {
        cleaned[k] = 'sandbox';
      } else if (k.includes('EMAIL')) {
        cleaned[k] = 'operations@fleet360.internal';
      } else if (k.includes('URL') || k.includes('DSN')) {
        cleaned[k] = 'https://dummy.fleet360.internal';
      } else {
        cleaned[k] = 'dummy-sensitive-placeholder';
      }
    }
  }
  return cleaned;
}

function parse<T extends z.ZodObject<z.ZodRawShape>>(schema: T, raw: Record<string, unknown>): z.infer<T> {
  const sanitized = cleanRaw(raw);
  const result = schema.safeParse(sanitized);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    const msg = `\n[env] Invalid environment configuration:\n${issues}\n\nSee .env.example for the full list.\n`;
    if (isProd && process.env.NEXT_PHASE !== 'phase-production-build') {
      console.warn(msg);
    }
    if (isProd) throw new Error(msg);
    console.warn(msg);
    // In dev, fall back to defaults so the app still boots.
    return schema.parse({});
  }
  return result.data;
}

/* ── Public API ───────────────────────────────────────────────────────────── */

export const env = parse(serverSchema, process.env);

export const clientEnv = parse(clientSchema, {
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_BASE_URL: process.env.NEXT_PUBLIC_BASE_URL,
  NEXT_PUBLIC_MAPBOX_TOKEN: process.env.NEXT_PUBLIC_MAPBOX_TOKEN,
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
});

export const isProduction = env.NODE_ENV === 'production';
export const isDevelopment = env.NODE_ENV === 'development';
export const isTest = env.NODE_ENV === 'test';

/** Whether server-side email transport is configured. */
export const hasEmailTransport = Boolean(
  (env.SMTP_HOST && env.SMTP_USER) || env.SENDGRID_API_KEY,
);

/** Whether OpenAI is configured (for AI features). */
export const hasOpenAI = Boolean(env.OPENAI_API_KEY && env.OPENAI_API_KEY !== 'dev-openai-key');

/** Whether Gemini Vision is configured (for multimodal KYC document scanning). */
export const hasGemini = Boolean(env.GEMINI_API_KEY || env.GOOGLE_AI_API_KEY);

/** Whether at least one live RAC card pre-authorization gateway is configured. */
export const hasRacLivePaymentGateway = Boolean(
  (env.TELR_STORE_ID && env.TELR_AUTH_KEY) ||
    (env.NGENIUS_API_KEY && env.NGENIUS_OUTLET_REF) ||
    env.STRIPE_SECRET_KEY,
);

/** Whether at least one live UAE regulatory renter reporting endpoint is configured. */
export const hasUaeRegulatoryGateway = Boolean(
  env.RTA_TARRASHUD_API_URL ||
    env.DUBAI_POLICE_TARRASHUD_URL ||
    env.ABU_DHABI_ITC_API_URL,
);
