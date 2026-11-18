export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';

// `catch (e)` is typed `unknown` under strict mode — `e?.message`/`e?.code`
// don't compile (an optional-chained `unknown` narrows to `{}`, which has
// no known properties). These narrow it safely instead of casting to `any`.
function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}
function errorCode(e: unknown): string | undefined {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = (e as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export async function GET(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const { searchParams } = new URL(req.url);
        const status       = searchParams.get('status');
        const customerType = searchParams.get('customerType');
        const search       = searchParams.get('search');

        // Clean up any legacy Drayage Client rows (`cli-%`) that were previously mirrored into `customers`
        await tx.$executeRawUnsafe(
          `DELETE FROM customers WHERE tenant_id = $1 AND id LIKE 'cli-%'`,
          tenantId,
        ).catch(() => {});

        const whereClauses: string[] = [
          `c.tenant_id = $1`,
          `c.deleted_at IS NULL`,
          `c.id NOT LIKE 'cli-%'`,
        ];
        const params: unknown[] = [tenantId];

        if (status) {
          params.push(status);
          whereClauses.push(`c.status = $${params.length}`);
        }
        if (customerType) {
          params.push(customerType);
          whereClauses.push(`c.customer_type = $${params.length}`);
        }
        if (search) {
          params.push(`%${search}%`);
          const sIdx = params.length;
          whereClauses.push(`(c.name_en ILIKE $${sIdx} OR c.customer_code ILIKE $${sIdx} OR c.email ILIKE $${sIdx} OR c.mobile_number ILIKE $${sIdx} OR c.account_code ILIKE $${sIdx})`);
        }

        const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

        const customers = await tx.$queryRawUnsafe(`
          SELECT c.*,
            r.id as region_id_j, r.name as region_name,
            d.id as dept_id_j,   d.name as dept_name,
            u.id as unit_id_j,   u.name as unit_name
          FROM customers c
          LEFT JOIN customer_hierarchy r ON c.region_id     = r.id
          LEFT JOIN customer_hierarchy d ON c.department_id = d.id
          LEFT JOIN customer_hierarchy u ON c.unit_id       = u.id
          ${whereSql}
          ORDER BY c.created_at DESC
        `, ...params);

        // Shape the response to match the frontend 'Customer' interface (camelCase)
        const shaped = (customers as any[]).map(c => ({
          id: c.id,
          customerCode: c.customer_code,
          customerType: c.customer_type,
          priority: c.priority,
          accountCode: c.account_code,
          tradeLicense: c.trade_license,
          nameEn: c.name_en,
          nameAr: c.name_ar,
          descriptionEn: c.description_en,
          descriptionAr: c.description_ar,
          email: c.email,
          mobileNumber: c.mobile_number,
          mobileCountryCode: c.mobile_country_code,
          communicationLanguage: c.communication_language,
          regionId: c.region_id,
          departmentId: c.department_id,
          unitId: c.unit_id,
          contactPerson: c.contact_person,
          contactPersonPhone: c.contact_person_phone,
          contactPersonEmail: c.contact_person_email,
          addressLine1: c.address_line1,
          addressLine2: c.address_line2,
          city: c.city,
          state: c.state,
          country: c.country,
          poBox: c.po_box,
          taxRegistrationNumber: c.tax_registration_number,
          taxApplicable: c.tax_applicable,
          tollExempt: c.toll_exempt,
          creditLimit: c.credit_limit,
          creditDays: c.credit_days,
          allowedPaymentMethods: c.allowed_payment_methods,
          defaultPaymentMethod: c.default_payment_method,
          billingCycle: c.billing_cycle,
          invoiceFrequency: c.invoice_frequency,
          invoiceDeliveryMethod: c.invoice_delivery_method,
          paymentReminderDays: c.payment_reminder_days,
          lateFeePercentage: c.late_fee_percentage,
          autoInvoice: c.auto_invoice,
          allowedWaitingTimeMin: c.allowed_waiting_time_min,
          cancellationAllowedMin: c.cancellation_allowed_min,
          allowedBookingModifications: c.allowed_booking_modifications,
          skipApproval: c.skip_approval,
          preferredChannel: c.preferred_channel,
          notificationEmail: c.notification_email,
          notificationSmsCode: c.notification_sms_code,
          notificationSms: c.notification_sms,
          marketingCommunications: c.marketing_communications,
          bookingNotifications: c.booking_notifications,
          status: c.status,
          region:     c.region_name     ? { id: c.region_id,  name: c.region_name  } : null,
          department: c.dept_name       ? { id: c.department_id,    name: c.dept_name    } : null,
          unit:       c.unit_name       ? { id: c.unit_id,    name: c.unit_name    } : null,
        }));
        return NextResponse.json(shaped);
      } catch (e) {
        console.error('GET /api/customers error:', e);
        return NextResponse.json({ error: errorMessage(e, 'Failed to fetch customers') }, { status: 500 });
      }
  });
}


export async function POST(req: NextRequest) {

  const authz = requireAuthorizedTenant({ headers: req.headers, nextUrl: req.nextUrl });
  if (!authz.ok) {
    return NextResponse.json({ error: authz.error }, { status: authz.status });
  }
  const { tenantId } = authz;

  return withTenantRls(prisma, tenantId, async (tx) => {
    try {
        const bodyRaw = await req.json();
      const body = stripTenantOwnershipFields(bodyRaw);

        if (!body.nameEn?.trim()) {
          return NextResponse.json({ error: 'Customer name (English) is required' }, { status: 400 });
        }
        if (!body.customerType) {
          return NextResponse.json({ error: 'Customer type is required' }, { status: 400 });
        }

        const id = randomUUID();

        // customer_code is unique per tenant: migration
        // 20261107090000_customers_code_unique_per_tenant (this used to run as DDL here).

        // Auto-generate collision-free customer code
        if (!body.customerCode) {
          const prefix = body.customerType === 'INTERNAL' ? 'INT' :
                         body.customerType === 'CORPORATE' ? 'CORP' :
                         body.customerType === 'VIP'       ? 'VIP' :
                         body.customerType === 'WALK_IN'   ? 'WLK' : 'CUST';
          const existingCodes = await prisma.$queryRawUnsafe<Array<{ customer_code: string | null }>>(
            `SELECT customer_code FROM customers WHERE customer_code LIKE $1`,
            `${prefix}%`,
          ).catch(() => []);
          const usedSet = new Set(
            existingCodes.map((r) => String(r.customer_code ?? '').trim().toUpperCase()).filter(Boolean)
          );
          let maxSeq = 0;
          for (const code of usedSet) {
            const numPart = code.slice(prefix.length).replace(/\D/g, '');
            const parsed = parseInt(numPart, 10);
            if (Number.isFinite(parsed) && parsed > maxSeq && parsed < 1000000) {
              maxSeq = parsed;
            }
          }
          let candidate = `${prefix}${String(maxSeq + 1).padStart(4, '0')}`;
          if (usedSet.has(candidate)) {
            candidate = `${prefix}-${id.slice(0, 6).toUpperCase()}`;
          }
          body.customerCode = candidate;
        }

        const now = new Date().toISOString();

        // Validate hierarchy foreign keys (regionId, departmentId, unitId) before INSERT so 23503 FK errors never happen
        const cleanRegionId = typeof body.regionId === 'string' && body.regionId.trim() ? body.regionId.trim() : null;
        const cleanDepartmentId = typeof body.departmentId === 'string' && body.departmentId.trim() ? body.departmentId.trim() : null;
        const cleanUnitId = typeof body.unitId === 'string' && body.unitId.trim() ? body.unitId.trim() : null;
        const candidateHIds = [cleanRegionId, cleanDepartmentId, cleanUnitId].filter((x): x is string => Boolean(x));
        const validHIds = new Set<string>();
        if (candidateHIds.length > 0) {
          const hRows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
            `SELECT id FROM customer_hierarchy WHERE id = ANY($1::text[])`,
            candidateHIds,
          ).catch(() => []);
          for (const r of hRows) validHIds.add(r.id);
        }
        const resolvedRegionId = cleanRegionId && validHIds.has(cleanRegionId) ? cleanRegionId : null;
        const resolvedDepartmentId = cleanDepartmentId && validHIds.has(cleanDepartmentId) ? cleanDepartmentId : null;
        const resolvedUnitId = cleanUnitId && validHIds.has(cleanUnitId) ? cleanUnitId : null;

        const insertCols = [
          'id', 'tenant_id', 'created_at', 'updated_at', 'customer_code', 'customer_type', 'priority',
          'account_code', 'trade_license', 'name_en', 'name_ar', 'description_en', 'description_ar',
          'email', 'mobile_number', 'mobile_country_code', 'communication_language',
          'region_id', 'department_id', 'unit_id',
          'contact_person', 'contact_person_phone', 'contact_person_email',
          'address_line1', 'address_line2', 'city', 'state', 'country', 'po_box',
          'tax_registration_number', 'tax_applicable', 'toll_exempt',
          'credit_limit', 'credit_days', 'allowed_payment_methods', 'default_payment_method',
          'billing_cycle', 'invoice_frequency', 'invoice_delivery_method',
          'payment_reminder_days', 'late_fee_percentage', 'auto_invoice',
          'allowed_waiting_time_min', 'cancellation_allowed_min', 'allowed_booking_modifications',
          'skip_approval', 'preferred_channel', 'notification_email',
          'notification_sms_code', 'notification_sms',
          'marketing_communications', 'booking_notifications', 'status'
        ];
        const insertVals = [
          id, tenantId, now, now, body.customerCode ?? null, body.customerType, body.priority ?? null,
          body.accountCode ?? null, body.tradeLicense ?? null, body.nameEn, body.nameAr ?? null, body.descriptionEn ?? null, body.descriptionAr ?? null,
          body.email ?? null, body.mobileNumber ?? null, body.mobileCountryCode ?? '+971', body.communicationLanguage ?? 'en',
          resolvedRegionId, resolvedDepartmentId, resolvedUnitId,
          body.contactPerson ?? null, body.contactPersonPhone ?? null, body.contactPersonEmail ?? null,
          body.addressLine1 ?? null, body.addressLine2 ?? null, body.city ?? null, body.state ?? null, body.country ?? 'UAE', body.poBox ?? null,
          body.taxRegistrationNumber ?? null, body.taxApplicable !== false, body.tollExempt === true,
          body.creditLimit != null ? Number(body.creditLimit) : null, body.creditDays != null ? Number(body.creditDays) : null,
          body.allowedPaymentMethods ?? null, body.defaultPaymentMethod ?? null,
          body.billingCycle ?? null, body.invoiceFrequency ?? null, body.invoiceDeliveryMethod ?? null,
          body.paymentReminderDays != null ? Number(body.paymentReminderDays) : null,
          body.lateFeePercentage != null ? Number(body.lateFeePercentage) : null,
          body.autoInvoice === true,
          body.allowedWaitingTimeMin != null ? Number(body.allowedWaitingTimeMin) : null,
          body.cancellationAllowedMin != null ? Number(body.cancellationAllowedMin) : null,
          body.allowedBookingModifications != null ? Number(body.allowedBookingModifications) : null,
          body.skipApproval === true, body.preferredChannel ?? null, body.notificationEmail ?? null,
          body.notificationSmsCode ?? '+971', body.notificationSms ?? null,
          body.marketingCommunications === true, body.bookingNotifications !== false,
          body.status ?? 'ACTIVE',
        ];
        const placeholders = insertVals.map((_, i) => `$${i + 1}`).join(', ');

        await tx.$executeRawUnsafe(
          `INSERT INTO customers (${insertCols.join(', ')}) VALUES (${placeholders})`,
          ...insertVals,
        );

        // Also auto-create a linked Lessee if type is CORPORATE or INDIVIDUAL (wrapped in SAVEPOINT so tx never aborts)
        if (['CORPORATE','INDIVIDUAL','VIP'].includes(body.customerType)) {
          await tx.$executeRawUnsafe(`SAVEPOINT sp_create_lessee`);
          try {
            const lesseeId = randomUUID();
            await tx.$executeRawUnsafe(`
              INSERT INTO lessees (id, tenant_id, created_at, updated_at, name, type, trade_license, contact_person, email, phone, customer_id)
              VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
              ON CONFLICT DO NOTHING
            `,
              lesseeId,
              tenantId,
              now,
              now,
              body.nameEn,
              body.customerType === 'INDIVIDUAL' ? 'individual' : 'corporate',
              body.tradeLicense ?? null,
              body.contactPerson ?? null,
              body.email ?? null,
              body.mobileNumber ?? null,
              id,
            );
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT sp_create_lessee`);
          } catch (e) {
            await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT sp_create_lessee`).catch(() => {});
            console.warn('Could not auto-create lessee:', e);
          }
        }

        const rows = await tx.$queryRawUnsafe(`SELECT * FROM customers WHERE id = $1 AND tenant_id = $2`, id, tenantId);
        return NextResponse.json((rows as any[])[0], { status: 201 });
        } catch (e) {
        console.error('POST /api/customers error:', e);
        if (errorMessage(e, '').includes('unique') || errorCode(e) === '23505') {
          return NextResponse.json({ error: 'Customer code already exists' }, { status: 409 });
        }
        return NextResponse.json({ error: errorMessage(e, 'Failed to create customer') }, { status: 500 });
      }
  });
}

