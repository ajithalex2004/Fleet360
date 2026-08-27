/**
 * Unified Security Context — Enterprise Multi-Tenant SaaS Standard
 *
 * Defines the canonical security context attached to every execution path
 * across HTTP requests, background jobs, webhooks, and administrative operations.
 */

export type SecurityMode =
  | 'TENANT'          // Standard tenant request (strictly scoped to a single tenantId)
  | 'PLATFORM_ADMIN'  // Platform super-admin cross-tenant operations (wildcard '*')
  | 'SYSTEM_JOB'      // Automated internal jobs (default: per-tenant iteration)
  | 'BOOTSTRAP'       // Pre-tenant registration & domain verification
  | 'WEBHOOK';        // External integration (Stripe, WhatsApp) with dynamic resolution

export type ActorType = 'USER' | 'SYSTEM' | 'WEBHOOK';

export interface SecurityContext {
  /** The tenant ID active for this execution. Null for global bootstrap/platform operations. */
  tenantId: string | null;
  /** Authenticated user ID (if triggered by an authenticated operator). */
  userId?: string;
  /** Role code (e.g. 'TENANT_ADMIN', 'SUPER_ADMIN', 'DRIVER', etc.) */
  role: string;
  /** Permissions granted for the current session/context. */
  permissions: string[];
  /** Execution mode governing RLS and database boundary constraints. */
  mode: SecurityMode;
  /** Type of actor initiating the execution. */
  actorType: ActorType;
  /** Operational source (e.g. 'web-app', 'driver-mobile', 'waitlist-sweep', 'stripe-webhook'). */
  source: string;
  /** Tracing correlation ID across distributed systems and asynchronous workers. */
  correlationId: string;
  /** Causation ID linking this execution to an upstream event or command. */
  causationId?: string;
  /** Ingress HTTP request ID. */
  requestId?: string;
  /** Subscription plan code (e.g. 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE'). */
  plan?: string;
  /** Impersonating user ID (if operating under super-admin user impersonation). */
  impersonatedBy?: string;
  /** Resolved data residency region for Enterprise routing ('GLOBAL' | 'EU' | 'UAE' | 'US'). */
  dataResidency?: string;
}
