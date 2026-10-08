export const dynamic = 'force-dynamic';

/**
 * POST /api/tenants/provision
 * Public endpoint — no auth required.
 * Onboards a new company: creates Tenant, admin User, UserTenant, TenantModules,
 * sends a domain verification email, and sets an xl-session cookie.
 */

import { systemRolePermissions } from '@/lib/authz/session-permissions';
import { NextRequest, NextResponse } from 'next/server';
import { canServeResidency, residencySessionClaim } from '@/lib/data-residency';
import { tenantBootstrapHandler } from '@/lib/handlers/tenant-bootstrap-handler';
import { z } from 'zod';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { appUrl, sendTemplatedEmail } from '@/lib/email-templates';
import { signSession } from '@/lib/tenant-session';
// ── Free email domains blocklist ─────────────────────────────────────────────
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com',
  'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com',
  'protonmail.com', 'tutanota.com', 'gmx.com',
]);

// ── Zod schema ───────────────────────────────────────────────────────────────
const ProvisionSchema = z.object({
  companyName:          z.string().min(2),
  domain:               z.string().min(3),
  contactEmail:         z.string().email(),
  contactName:          z.string().min(2),
  contactPhone:         z.string().optional(),
  country:              z.string().optional(),
  plan:                 z.enum(['TRIAL', 'STANDARD', 'PROFESSIONAL', 'ENTERPRISE']).default('TRIAL'),
  selectedModules:      z.array(z.string()).min(0),
  adminFirstName:       z.string().min(1),
  adminLastName:        z.string().min(1),
  adminPassword:        z.string().min(8),
  trn:                  z.string().optional(),
  preVerificationId:    z.string().optional(), // from pre-registration domain verification
  /**
   * ENTERPRISE data-residency region. Only honoured when plan = ENTERPRISE.
   * Defaults to GLOBAL (shared primary DB).
   */
  dataResidency:        z.enum(['GLOBAL', 'EU', 'UAE', 'US']).default('GLOBAL'),
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateCode(name: string): string {
  const prefix = name.replace(/[^a-zA-Z]/g, '').slice(0, 3).toUpperCase().padEnd(3, 'X');
  const digits  = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}${digits}`;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function emailDomain(email: string): string {
  return email.split('@')[1]?.toLowerCase() ?? '';
}

/**
 * Asks the new organisation's administrator to verify its domain, in the
 * platform's wording (Admin > Email templates > Account). The link is built
 * from NEXT_PUBLIC_APP_URL, never the request's Host header, and the token
 * is never logged.
 */
async function sendVerificationEmail(opts: {
  to: string; tenantName: string; token: string; tenantId: string;
}): Promise<void> {
  const verifyUrl = appUrl(
    `/api/tenants/verify-domain?token=${encodeURIComponent(opts.token)}&tenantId=${encodeURIComponent(opts.tenantId)}`,
  );
  const sent = await sendTemplatedEmail({
    tenantId: opts.tenantId,
    key: 'account.domain_verification_link',
    to: opts.to,
    values: { organisationName: opts.tenantName, verifyUrl },
  });
  if (!sent.sent) console.warn(`[provision] domain verification email for tenant ${opts.tenantId} not sent (${sent.reason ?? 'unknown'})`);
}


// ── Detect the actual User table name ONCE before the transaction ─────────────
// Prisma maps model "User" → table "User" (capital U, no @@map).
// Some deployments use lowercase "users". We query information_schema to be sure
// so we never need try/catch inside a transaction (which poisons PG's tx state).
async function detectUserTableName(): Promise<string> {
  try {
    type Row = { table_name: string };
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('User', 'users')
       LIMIT 1`,
    );
    if (rows.length > 0) {
      return rows[0].table_name === 'User' ? '"User"' : 'users';
    }
  } catch (e) {
    console.warn('[provision] detectUserTableName failed, defaulting to "User":', e);
  }
  return '"User"';
}

// ── Detect whether domain verification columns exist ──────────────────────────
async function detectDomainVerifColumnsExist(): Promise<boolean> {
  try {
    type Row = { count: string };
    const rows = await prisma.$queryRawUnsafe<Row[]>(
      `SELECT COUNT(*) AS count FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name   = 'tenants'
         AND column_name  = 'domain_verification_token'`,
    );
    return parseInt(rows[0]?.count ?? '0', 10) > 0;
  } catch {
    return false;
  }
}

// ── POST handler ──────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // The columns this handler uses (User.password_hash, tenants.trn and the
  // domain-verification columns) come from migrations; it runs no DDL.
  const [userTable, domainVerifColumnsExist] = await Promise.all([
    detectUserTableName(),
    detectDomainVerifColumnsExist(),
  ]);
  console.log(`[provision] userTable=${userTable} domainVerifCols=${domainVerifColumnsExist}`);

  // Assigned inside the transaction callback below, invoked only after
  // tenantBootstrapHandler has fully returned - see the comment at the
  // assignment site for why these can't fire from inside the transaction.
  const deferred: { run: (() => void) | null } = { run: null };

  const bootstrapResponse = await tenantBootstrapHandler(request, 'create_pending_tenant', async ({ tx, rescopeToTenant }) => {
    try {
        const body   = await request.json();
        const parsed = ProvisionSchema.safeParse(body);

        if (!parsed.success) {
          return NextResponse.json(
            { error: 'Validation Error', details: parsed.error.flatten() },
            { status: 422 },
          );
        }

        const data = parsed.data;

        // Refuse a residency region this deployment cannot honour, rather
        // than storing the promise and keeping the data in the global DB.
        if (data.plan === 'ENTERPRISE' && !canServeResidency(data.dataResidency)) {
          return NextResponse.json(
            {
              error: 'Validation Error',
              code: 'DATA_RESIDENCY_UNAVAILABLE',
              message: `Data residency region ${data.dataResidency} is not available on this deployment.`,
            },
            { status: 422 },
          );
        }

        // Block free email domains
        const contactEmailDomain = emailDomain(data.contactEmail);
        if (FREE_EMAIL_DOMAINS.has(contactEmailDomain)) {
          return NextResponse.json(
            { error: 'Validation Error', message: 'Please use your company email, not a free email provider.' },
            { status: 422 },
          );
        }

        // Email domain must match company domain
        const normalizedDomain = data.domain.replace(/^www\./, '').toLowerCase().trim();
        if (contactEmailDomain !== normalizedDomain) {
          return NextResponse.json(
            { error: 'Validation Error', message: `Email domain (${contactEmailDomain}) must match company domain (${normalizedDomain}).` },
            { status: 422 },
          );
        }

        // Duplicate domain check
        const existingTenant = await tx.tenant.findFirst({
          where: { domain: normalizedDomain },
          select: { id: true },
        });
        if (existingTenant) {
          return NextResponse.json(
            { error: 'Conflict', message: `A tenant with domain "${normalizedDomain}" already exists.` },
            { status: 409 },
          );
        }

        // ── Check pre-verification (if provided) ─────────────────────────────────
        let domainPreVerified = false;
        if (data.preVerificationId) {
          try {
            type PreRow = { domain: string; verified: boolean; expires_at: string };
            const preRows = await tx.$queryRawUnsafe<PreRow[]>(
              `SELECT domain, verified, expires_at FROM domain_pre_verifications WHERE id = $1`,
              data.preVerificationId,
            );
            if (
              preRows.length &&
              preRows[0].verified &&
              preRows[0].domain === normalizedDomain &&
              new Date(preRows[0].expires_at) > new Date()
            ) {
              domainPreVerified = true;
            }
          } catch {
            // Table may not exist yet — treat as not pre-verified
          }
        }

        // Prepare IDs
        const tenantId          = crypto.randomUUID();
        const userId            = crypto.randomUUID();
        const passwordHash      = hashPassword(data.adminPassword);
        const verificationToken = crypto.randomBytes(32).toString('hex');
        const allModules        = Array.from(new Set(['admin', 'platform', ...data.selectedModules]));

        // userTable / domainVerifColumnsExist come from the closure - computed
        // above, genuinely before this transaction started. See the comment
        // there for why they can't be computed here instead.

        // ── DB transaction ────────────────────────────────────────────────────────
        // No inner transaction: withTenantRls / withPlatformAdmin has already
        // opened one, and Prisma strips $transaction from a TransactionClient,
        // so this threw "tx.$transaction is not a function". The IIFE keeps the
        // callback's `tx` parameter so the body is unchanged; atomicity already
        // comes from the outer transaction.
        const { tenant, user } = await (async (tx, rescopeToTenant) => {
          // 1. Create Tenant
          const tenant = await tx.tenant.create({
            data: {
              id:           tenantId,
              name:         data.companyName,
              domain:       normalizedDomain,
              contactEmail: data.contactEmail,
              contactName:  data.contactName,
              contactPhone: data.contactPhone,
              plan:         data.plan,
              isActive:     true,
              code:         generateCode(data.companyName),
              // data_residency — only meaningful for ENTERPRISE; store for all
              // tiers so it's always a valid column value.
              dataResidency: data.plan === 'ENTERPRISE' ? data.dataResidency : 'GLOBAL',
            },
          });

          // 1a. Re-scope the bootstrap transaction to the tenant just created.
          // withBootstrap() pins app.tenant_id to BOOTSTRAP_SENTINEL_TENANT_ID
          // (the nil UUID) for the whole transaction so a fresh signup can't
          // read any existing tenant's data. Must go through rescopeToTenant(),
          // not a raw call on `tx` - see its definition in
          // tenant-bootstrap-handler.ts for why calling $executeRawUnsafe
          // directly on the restricted proxy silently runs outside the actual
          // transaction instead of erroring.
          await rescopeToTenant(tenant.id);

          // 1b. Set TRN via raw SQL (handles case where Prisma client is stale)
          if (data.trn) {
            await tx.$executeRawUnsafe(
              `UPDATE tenants SET trn = $1 WHERE id = $2`,
              data.trn,
              tenantId,
            );
          }

          // 2. Create TenantModules
          await tx.tenantModule.createMany({
            data: allModules.map(module => ({
              id:        crypto.randomUUID(),
              tenantId:  tenant.id,
              module,
              isEnabled: true,
            })),
            skipDuplicates: true,
          });

          // 3. Create User via Prisma ORM (handles table/column names correctly)
          let user;
          try {
            user = await tx.user.create({
              data: {
                id:        userId,
                username:  data.contactEmail,
                email:     data.contactEmail,
                firstName: data.adminFirstName,
                lastName:  data.adminLastName,
                isActive:  true,
                updatedAt: new Date(),
              },
            });
            } catch (e) {
            // If email already exists, fetch the existing user
            const msg = e instanceof Error ? e.message : '';
            if (msg.includes('Unique constraint') || msg.includes('unique')) {
              user = await tx.user.findUniqueOrThrow({ where: { email: data.contactEmail } });
            } else {
              throw e;
            }
          }

          // 4. Store password hash — use pre-detected table name (no try/catch inside tx)
          await tx.$executeRawUnsafe(
            `UPDATE ${userTable} SET password_hash = $1 WHERE id = $2`,
            passwordHash,
            user.id,
          );

          // 5. Find or create TENANT_ADMIN role (scoped to this tenant).
          //    The first admin of a newly provisioned organisation is a Tenant Admin,
          //    NOT a platform-level Super Admin. Super Admin is reserved for the
          //    platform operator and is managed separately via /admin.
          let role = await tx.role.findFirst({ where: { code: 'TENANT_ADMIN', tenantId: tenant.id } });

          if (!role) {
            role = await tx.role.create({
              data: {
                id:          crypto.randomUUID(),
                name:        'Tenant Admin',
                code:        'TENANT_ADMIN',
                tenantId:    tenant.id,
                // NOT a global template role - chk_roles_system_template requires
                // (tenant_id IS NULL) = is_system, so isSystem: true here (paired
                // with a real tenantId) violates the constraint on every signup.
                // This is a per-tenant admin role, which is exactly what isSystem
                // false + a real tenantId means.
                isSystem:    false,
                description: 'Full administrative access within this organisation',
              },
            });
          }

          // 6. Create UserTenant
          await tx.userTenant.create({
            data: {
              id:       crypto.randomUUID(),
              userId:   user.id,
              tenantId: tenant.id,
              roleId:   role.id,
              isActive: true,
            },
          });

          // 7. Store domain verification token — only if columns confirmed to exist pre-flight.
          //    No try/catch here: any error inside a PG transaction aborts it with 25P02.
          if (domainVerifColumnsExist) {
            if (domainPreVerified) {
              await tx.$executeRawUnsafe(
                `UPDATE tenants SET domain_verification_token = $1, domain_verified_at = NOW(), domain_verification_method = 'PRE_REGISTRATION' WHERE id = $2`,
                verificationToken,
                tenant.id,
              );
            } else {
              await tx.$executeRawUnsafe(
                `UPDATE tenants SET domain_verification_token = $1, domain_verification_method = 'EMAIL' WHERE id = $2`,
                verificationToken,
                tenant.id,
              );
            }
          } else {
            console.warn('[provision] domain verification columns not yet in DB — skipping token storage for tenant', tenant.id);
          }

          return { tenant, user };
        })(tx, rescopeToTenant);

        // Defer the verification email + trial bootstrap until AFTER this
        // transaction has actually committed (invoked once tenantBootstrapHandler
        // returns, below). Both are fire-and-forget, but firing them from inside
        // this callback would inherit the active RLS scope via AsyncLocalStorage
        // and route their prisma.$executeRawUnsafe calls onto THIS transaction's
        // pinned connection. startTrialForTenant then ran ensureBillingColumns()
        // (since removed: billing columns come from migrations) — unguarded
        // ALTER TABLEs with no per-statement try/catch; fleet360_app
        // has no DDL grant, so the first ALTER throws and aborts the transaction
        // — right as (or just before) the real COMMIT, which Postgres then
        // treats as a no-op rollback on an aborted transaction. The route still
        // returned 201/ok:true with a real-looking tenantId, but nothing was
        // ever persisted. Confirmed live via pg_stat_activity: the ALTER TABLE
        // ran on this transaction's own pid immediately after the last real
        // statement, then "COMMIT" landed on an already-aborted transaction.
        deferred.run = () => {
          if (!domainPreVerified) {
            sendVerificationEmail({
              to: user.email ?? data.contactEmail,
              tenantName: tenant.name,
              token: verificationToken,
              tenantId: tenant.id,
            }).catch(() => {});
          }
          void import('@/lib/billing').then(m => m.startTrialForTenant(tenant.id)).catch(() => {});
        };

        // Set session cookie — newly provisioned users always start as TENANT_ADMIN
        const effectivePlan = tenant.plan ?? 'TRIAL';
        const sessionToken = await signSession({
          userId:        user.id,
          tenantId:      tenant.id,
          plan:          effectivePlan,
          role:          'TENANT_ADMIN',
          permissions:   systemRolePermissions('TENANT_ADMIN'),
          // Embed residency in the token so middleware can refuse tenants whose
          // region this deployment does not serve, without a DB lookup.
          ...residencySessionClaim(tenant.dataResidency),
        });

        const payload: Record<string, unknown> = {
          ok:                   true,
          tenantId:             tenant.id,
          userId:               user.id,
          verificationRequired: !domainPreVerified,
          domainVerified:       domainPreVerified,
          domain:               normalizedDomain,
        };
        if (process.env.NODE_ENV !== 'production') {
          payload.verificationToken = verificationToken;
        }

        const isSecure = process.env.NODE_ENV === 'production';
        const response = NextResponse.json(payload, { status: 201 });

        // Explicitly delete any existing session first (prevents stale admin session
        // from being returned on client-side navigations that reuse cookie state).
        response.cookies.delete('xl-session');

        // Set the new session for the freshly provisioned tenant.
        response.cookies.set('xl-session', sessionToken, {
          httpOnly: true,
          sameSite: 'lax',
          secure:   isSecure,
          maxAge:   86_400,
          path:     '/',
        });
        return response;

      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[tenants/provision] ERROR:', message, err);
        return NextResponse.json(
          {
            error:   'Internal Server Error',
            message: `Provisioning failed: ${message}`,
            detail:  message,
          },
          { status: 500 },
        );
      }
  });

  deferred.run?.();
  return bootstrapResponse;
}

