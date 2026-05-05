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

  SETUP_SECRET: z.string().optional(),

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

function parse<T extends z.ZodObject<z.ZodRawShape>>(schema: T, raw: Record<string, unknown>): z.infer<T> {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map(i => `  • ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    const msg = `\n[env] Invalid environment configuration:\n${issues}\n\nSee .env.example for the full list.\n`;
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
