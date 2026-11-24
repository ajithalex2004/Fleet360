import {
  defineRailway,
  github,
  preserve,
  project,
  service,
  type VariableValue,
} from "railway/iac";

function preserveKeys(keys: readonly string[]): Record<string, VariableValue> {
  return Object.fromEntries(keys.map((key) => [key, preserve()]));
}

const APP_SHARED_ENV_KEYS = [
  "ALLOWED_ORIGINS",
  "CRON_SECRET",
  "DATABASE_URL",
  "DB_CONNECT_RETRIES",
  "DB_CONNECT_TIMEOUT_MS",
  "DB_CONN_MAX_IDLE_SECONDS",
  "DB_CONN_MAX_LIFETIME_SECONDS",
  "DB_KEEPALIVE_INTERVAL_MS",
  "DB_MAX_IDLE_CONNS",
  "DB_MAX_OPEN_CONNS",
  "DB_OPERATION_RETRIES",
  "DEPLOYMENT_HEALTH_SECRET",
  "FLEET360_ENABLE_LOCAL_MIRROR",
  "FLEET360_SKIP_DB_PREWARM",
  "GEMINI_API_KEY",
  "GOOGLE_MAPS_API_KEY",
  "GO_BACKEND_URL",
  "GO_ENV",
  "JWT_SECRET",
  "LOGISTICS_GO_PROXY_ENABLED",
  "LOG_FORMAT",
  "LOG_LEVEL",
  "MAPBOX_TOKEN",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_BASE_URL",
  "NEXT_PUBLIC_GOOGLE_MAPS_EMBED_API_KEY",
  "NEXT_PUBLIC_MAPBOX_TOKEN",
  "NODE_ENV",
  "OPENAI_API_KEY",
  "PHASE0_DATABASE_URL",
  "PUSH_CRON_SECRET",
  "RUNTIME_DIRECT_DATABASE_URL",
  "S3_ACCESS_KEY",
  "S3_BUCKET",
  "S3_ENDPOINT",
  "S3_KEY_PREFIX",
  "S3_REGION",
  "S3_SECRET_KEY",
  "SESSION_SECRET",
  "SSO_ENCRYPTION_KEY",
  "STORAGE_BACKEND",
  "THESYS_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_WHATSAPP_NUMBER",
  "UPSTASH_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_REST_URL",
] as const;

// Production runtime strictly omits migration-owner DB URLs (DIRECT_URL / MIGRATION_DATABASE_URL)
// and optional unprovisioned integrations (Stripe, SendGrid, Sentry) until genuinely configured.
const APP_PRODUCTION_ONLY_ENV_KEYS = ["SMTP_ALLOW_INSECURE_TLS"] as const;

const APP_STAGING_ONLY_ENV_KEYS = [
  "DIRECT_DATABASE_URL",
  "DIRECT_URL",
  "DISABLE_OUTBOUND_NOTIFICATIONS",
  "EMAIL_DELIVERY_MODE",
  "EMAIL_SANDBOX_HOST",
  "EMAIL_SANDBOX_PASSWORD",
  "EMAIL_SANDBOX_PORT",
  "EMAIL_SANDBOX_USERNAME",
  "ENVIRONMENT",
  "MIGRATION_DATABASE_URL",
  "MOCK_NOTIFICATIONS",
] as const;

const BACKEND_SHARED_ENV_KEYS = [
  "DATABASE_URL",
  "JWT_SECRET",
  "PORT",
  "S3_ACCESS_KEY",
  "S3_BUCKET",
  "S3_ENDPOINT",
  "S3_KEY_PREFIX",
  "S3_SECRET_KEY",
] as const;

export default defineRailway((ctx) => {
  const isProduction = ctx.isEnvironment("production");
  const region = isProduction ? "asia-southeast1-eqsg3a" : "us-east4-eqdc4a";

  const appEnvKeys = isProduction
    ? [...APP_SHARED_ENV_KEYS, ...APP_PRODUCTION_ONLY_ENV_KEYS]
    : [...APP_SHARED_ENV_KEYS, ...APP_STAGING_ONLY_ENV_KEYS];

  const fleet360App = service("fleet360-app", {
    source: github("ajithalex2004/Fleet360", {
      branch: "main",
      checkSuites: false,
    }),
    build: {
      buildEnvironment: "V3",
      builder: "RAILPACK",
    },
    deploy: {
      // Ordinary web replicas must never run Prisma migrations on startup/restart.
      // Controlled migrations run explicitly via `npm run db:migrate:deploy` under DIRECT_URL.
      // Note: Railway's default restart policy (ON_FAILURE, 10 retries) is normalized to null
      // in environment config by Railway's API; omitting it prevents perpetual plan drift while
      // preserving ON_FAILURE / 10 retries at deploy time.
      startCommand: "npm start",
    },
    replicas: { [region]: 1 },
    env: preserveKeys(appEnvKeys),
  });

  const fleet360Backend = service("fleet360-backend", {
    source: github("ajithalex2004/Fleet360", {
      branch: "main",
      checkSuites: false,
      rootDirectory: "/backend",
    }),
    build: {
      buildEnvironment: "V3",
      builder: "DOCKERFILE",
      dockerfilePath: "/backend/Dockerfile",
    },
    deploy: {
      startCommand: "",
      healthcheckPath: "/healthz",
      healthcheckTimeout: 100,
    },
    replicas: { [region]: 1 },
    env: preserveKeys(BACKEND_SHARED_ENV_KEYS),
  });

  return project("fleet360-railway", {
    resources: [fleet360App, fleet360Backend],
  });
});
