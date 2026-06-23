import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';
import {
  ensureCorporateCustomerIdentityTables,
  replaceCustomerDomains,
} from '@/lib/corporate-customer-identity';

type CustomerRow = Record<string, unknown> & {
  id: string;
  customer_code?: string | null;
  customer_type?: string | null;
  tenant_id?: string | null;
  domains?: string[] | null;
  region_name?: string | null;
  dept_name?: string | null;
  unit_name?: string | null;
  region_id?: string | null;
  department_id?: string | null;
  unit_id?: string | null;
};

type CountRow = { count: bigint | number | string };

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error ? err.message : fallback;
}

function requestContext(req: NextRequest) {
  const tenantId = req.headers.get('x-tenant-id') ?? '';
  const userId = req.headers.get('x-user-id') ?? '';
  const role = req.headers.get('x-user-role') ?? '';
  if (!tenantId || !userId) return null;
  return { tenantId, userId, role, isSuperAdmin: role === 'SUPER_ADMIN' };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const status       = searchParams.get('status');
    const customerType = searchParams.get('customerType');
    const search       = searchParams.get('search');
    const requestedTenantId = searchParams.get('tenantId');
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (requestedTenantId && requestedTenantId !== ctx.tenantId && !ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden', message: 'Tenant boundary violation' }, { status: 403 });
    }
    const scopedTenantId = requestedTenantId && ctx.isSuperAdmin ? requestedTenantId : ctx.tenantId;

    let whereClause = `WHERE c.deleted_at IS NULL AND c.tenant_id::text = '${scopedTenantId.replace(/'/g,"''")}'`;
    if (status)       whereClause += ` AND c.status = '${status.replace(/'/g,"''")}'`;
    if (customerType) whereClause += ` AND c.customer_type = '${customerType.replace(/'/g,"''")}'`;
    if (search) {
      const s = search.replace(/'/g, "''");
      whereClause += ` AND (c.name_en ILIKE '%${s}%' OR c.customer_code ILIKE '%${s}%' OR c.email ILIKE '%${s}%' OR c.mobile_number ILIKE '%${s}%' OR c.account_code ILIKE '%${s}%')`;
    }

    const customers = await prisma.$queryRawUnsafe<CustomerRow[]>(`
      SELECT c.*,
        COALESCE(cd.domains, ARRAY[]::text[]) AS domains,
        r.id as region_id_j, r.name as region_name,
        d.id as dept_id_j,   d.name as dept_name,
        u.id as unit_id_j,   u.name as unit_name
      FROM customers c
      LEFT JOIN LATERAL (
        SELECT ARRAY_AGG(domain ORDER BY domain) AS domains
        FROM customer_domains
        WHERE tenant_id = c.tenant_id::text AND customer_id = c.id::text
      ) cd ON TRUE
      LEFT JOIN customer_hierarchy r ON c.region_id     = r.id
      LEFT JOIN customer_hierarchy d ON c.department_id = d.id
      LEFT JOIN customer_hierarchy u ON c.unit_id       = u.id
      ${whereClause}
      ORDER BY c.created_at DESC
    `);

    // Shape the response to match the frontend 'Customer' interface (camelCase)
    const shaped = customers.map(c => ({
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
      tenantId: c.tenant_id,
      domains: Array.isArray(c.domains) ? c.domains : [],
      region:     c.region_name     ? { id: c.region_id,  name: c.region_name  } : null,
      department: c.dept_name       ? { id: c.department_id,    name: c.dept_name    } : null,
      unit:       c.unit_name       ? { id: c.unit_id,    name: c.unit_name    } : null,
    }));
    return NextResponse.json(shaped);
  } catch (e: unknown) {
    console.error('GET /api/customers error:', e);
    return NextResponse.json({ error: errorMessage(e, 'Failed to fetch customers') }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ctx = requestContext(req);
    if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    await ensureCorporateCustomerIdentityTables();

    if (!body.nameEn?.trim()) {
      return NextResponse.json({ error: 'Customer name (English) is required' }, { status: 400 });
    }
    if (!body.customerType) {
      return NextResponse.json({ error: 'Customer type is required' }, { status: 400 });
    }

    const id = randomUUID();

    // Auto-generate customer code
    if (!body.customerCode) {
      const prefix = body.customerType === 'INTERNAL' ? 'INT' :
                     body.customerType === 'CORPORATE' ? 'CORP' :
                     body.customerType === 'VIP'       ? 'VIP' :
                     body.customerType === 'WALK_IN'   ? 'WLK' : 'CUST';
      const countResult = await prisma.$queryRaw<CountRow[]>`SELECT COUNT(*) as count FROM customers`;
      const count = Number(countResult[0]?.count ?? 0);
      body.customerCode = `${prefix}${String(count + 1).padStart(4, '0')}`;
    }

    const now = new Date().toISOString();
    await prisma.$executeRawUnsafe(`
      INSERT INTO customers (
        id, created_at, updated_at, tenant_id, customer_code, customer_type, priority,
        account_code, trade_license, name_en, name_ar, description_en, description_ar,
        email, mobile_number, mobile_country_code, communication_language,
        region_id, department_id, unit_id,
        contact_person, contact_person_phone, contact_person_email,
        address_line1, address_line2, city, state, country, po_box,
        tax_registration_number, tax_applicable, toll_exempt,
        credit_limit, credit_days, allowed_payment_methods, default_payment_method,
        billing_cycle, invoice_frequency, invoice_delivery_method,
        payment_reminder_days, late_fee_percentage, auto_invoice,
        allowed_waiting_time_min, cancellation_allowed_min, allowed_booking_modifications,
        skip_approval, preferred_channel, notification_email,
        notification_sms_code, notification_sms,
        marketing_communications, booking_notifications, status
      ) VALUES (
        '${id}', '${now}', '${now}', '${ctx.tenantId.replace(/'/g,"''")}',
        ${body.customerCode ? `'${body.customerCode.replace(/'/g,"''")}'` : 'NULL'},
        '${body.customerType}',
        ${body.priority ? `'${body.priority}'` : 'NULL'},
        ${body.accountCode ? `'${body.accountCode.replace(/'/g,"''")}'` : 'NULL'},
        ${body.tradeLicense ? `'${body.tradeLicense.replace(/'/g,"''")}'` : 'NULL'},
        '${body.nameEn.replace(/'/g,"''")}',
        ${body.nameAr ? `'${body.nameAr.replace(/'/g,"''")}'` : 'NULL'},
        ${body.descriptionEn ? `'${body.descriptionEn.replace(/'/g,"''")}'` : 'NULL'},
        ${body.descriptionAr ? `'${body.descriptionAr.replace(/'/g,"''")}'` : 'NULL'},
        ${body.email ? `'${body.email.replace(/'/g,"''")}'` : 'NULL'},
        ${body.mobileNumber ? `'${body.mobileNumber.replace(/'/g,"''")}'` : 'NULL'},
        ${body.mobileCountryCode ? `'${body.mobileCountryCode}'` : "'+971'"},
        ${body.communicationLanguage ? `'${body.communicationLanguage}'` : "'en'"},
        ${body.regionId ? `'${body.regionId}'` : 'NULL'},
        ${body.departmentId ? `'${body.departmentId}'` : 'NULL'},
        ${body.unitId ? `'${body.unitId}'` : 'NULL'},
        ${body.contactPerson ? `'${body.contactPerson.replace(/'/g,"''")}'` : 'NULL'},
        ${body.contactPersonPhone ? `'${body.contactPersonPhone.replace(/'/g,"''")}'` : 'NULL'},
        ${body.contactPersonEmail ? `'${body.contactPersonEmail.replace(/'/g,"''")}'` : 'NULL'},
        ${body.addressLine1 ? `'${body.addressLine1.replace(/'/g,"''")}'` : 'NULL'},
        ${body.addressLine2 ? `'${body.addressLine2.replace(/'/g,"''")}'` : 'NULL'},
        ${body.city ? `'${body.city.replace(/'/g,"''")}'` : 'NULL'},
        ${body.state ? `'${body.state.replace(/'/g,"''")}'` : 'NULL'},
        ${body.country ? `'${body.country.replace(/'/g,"''")}'` : "'UAE'"},
        ${body.poBox ? `'${body.poBox.replace(/'/g,"''")}'` : 'NULL'},
        ${body.taxRegistrationNumber ? `'${body.taxRegistrationNumber.replace(/'/g,"''")}'` : 'NULL'},
        ${body.taxApplicable !== false ? 'true' : 'false'},
        ${body.tollExempt === true ? 'true' : 'false'},
        ${body.creditLimit != null ? Number(body.creditLimit) : 'NULL'},
        ${body.creditDays != null ? Number(body.creditDays) : 'NULL'},
        ${body.allowedPaymentMethods ? `'${body.allowedPaymentMethods.replace(/'/g,"''")}'` : 'NULL'},
        ${body.defaultPaymentMethod ? `'${body.defaultPaymentMethod}'` : 'NULL'},
        ${body.billingCycle ? `'${body.billingCycle}'` : 'NULL'},
        ${body.invoiceFrequency ? `'${body.invoiceFrequency}'` : 'NULL'},
        ${body.invoiceDeliveryMethod ? `'${body.invoiceDeliveryMethod}'` : 'NULL'},
        ${body.paymentReminderDays != null ? Number(body.paymentReminderDays) : 'NULL'},
        ${body.lateFeePercentage != null ? Number(body.lateFeePercentage) : 'NULL'},
        ${body.autoInvoice === true ? 'true' : 'false'},
        ${body.allowedWaitingTimeMin != null ? Number(body.allowedWaitingTimeMin) : 'NULL'},
        ${body.cancellationAllowedMin != null ? Number(body.cancellationAllowedMin) : 'NULL'},
        ${body.allowedBookingModifications != null ? Number(body.allowedBookingModifications) : 'NULL'},
        ${body.skipApproval === true ? 'true' : 'false'},
        ${body.preferredChannel ? `'${body.preferredChannel}'` : 'NULL'},
        ${body.notificationEmail ? `'${body.notificationEmail.replace(/'/g,"''")}'` : 'NULL'},
        ${body.notificationSmsCode ? `'${body.notificationSmsCode}'` : "'+971'"},
        ${body.notificationSms ? `'${body.notificationSms.replace(/'/g,"''")}'` : 'NULL'},
        ${body.marketingCommunications === true ? 'true' : 'false'},
        ${body.bookingNotifications !== false ? 'true' : 'false'},
        '${body.status ?? 'ACTIVE'}'
      )
    `);

    // Also auto-create a linked Lessee if type is CORPORATE or INDIVIDUAL
    if (['CORPORATE','INDIVIDUAL','VIP'].includes(body.customerType)) {
      try {
        const lesseeId = randomUUID();
        await prisma.$executeRawUnsafe(`
          INSERT INTO lessees (id, created_at, updated_at, name, type, trade_license, contact_person, email, phone, customer_id)
          VALUES (
            '${lesseeId}', '${now}', '${now}',
            '${body.nameEn.replace(/'/g,"''")}',
            '${body.customerType === 'INDIVIDUAL' ? 'individual' : 'corporate'}',
            ${body.tradeLicense ? `'${body.tradeLicense.replace(/'/g,"''")}'` : 'NULL'},
            ${body.contactPerson ? `'${body.contactPerson.replace(/'/g,"''")}'` : 'NULL'},
            ${body.email ? `'${body.email.replace(/'/g,"''")}'` : 'NULL'},
            ${body.mobileNumber ? `'${body.mobileNumber.replace(/'/g,"''")}'` : 'NULL'},
            '${id}'
          )
          ON CONFLICT DO NOTHING
        `);
      } catch (le) {
        console.warn('Could not auto-create lessee:', le);
      }
    }
    const domains = Array.isArray(body.domains ?? body.allowedDomains ?? body.customerDomains)
      ? (body.domains ?? body.allowedDomains ?? body.customerDomains)
      : [];
    if (domains.length > 0) {
      await replaceCustomerDomains({
        tenantId: ctx.tenantId,
        customerId: id,
        domains,
        actorUserId: ctx.userId,
        verificationMethod: 'ADMIN',
      });
    }

    const rows = await prisma.$queryRawUnsafe<CustomerRow[]>(`SELECT * FROM customers WHERE id = '${id}'`);
    const created = rows[0];
    const domainRows = await prisma.$queryRawUnsafe<Array<{ domain: string }>>(
      `SELECT domain FROM customer_domains WHERE tenant_id = $1 AND customer_id = $2 ORDER BY domain`,
      ctx.tenantId,
      id,
    ).catch(() => []);
    return NextResponse.json({ ...created, domains: domainRows.map(row => row.domain) }, { status: 201 });
  } catch (e: unknown) {
    console.error('POST /api/customers error:', e);
    const message = errorMessage(e, 'Failed to create customer');
    if (message.includes('unique') || (typeof e === 'object' && e !== null && 'code' in e && e.code === '23505')) {
      return NextResponse.json({ error: 'Customer code already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
