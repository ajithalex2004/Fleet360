import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { randomUUID } from 'crypto';

function addMonths(d: Date, m: number) { const r = new Date(d); r.setMonth(r.getMonth() + m); return r; }
function ago(days: number) { return new Date(Date.now() - days * 86400000); }

export async function POST(req: NextRequest) {
  try {
    const results: Record<string, number> = {};

    //  1. Customer Hierarchy 
    const regionDefs = [
      { id: 'reg-DXB', name: 'Dubai',            code: 'DXB' },
      { id: 'reg-AUH', name: 'Abu Dhabi',         code: 'AUH' },
      { id: 'reg-SHJ', name: 'Sharjah',           code: 'SHJ' },
      { id: 'reg-NE',  name: 'Northern Emirates', code: 'NE'  },
    ];
    for (const r of regionDefs) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO customer_hierarchy (id, level, name, code, is_active)
        VALUES ('${r.id}', 'REGION', '${r.name}', '${r.code}', true)
        ON CONFLICT (id) DO NOTHING
      `);
    }
    const regions = regionDefs;

    const deptDefs = [
      { id: 'dept-dxb-fleet', name: 'Fleet Division',    code: 'FLT',  parentId: 'reg-DXB' },
      { id: 'dept-dxb-corp',  name: 'Corporate Accounts',code: 'CORP', parentId: 'reg-DXB' },
      { id: 'dept-auh-fleet', name: 'Fleet Operations',  code: 'FOP',  parentId: 'reg-AUH' },
      { id: 'dept-shj-ops',   name: 'Operations',        code: 'OPS',  parentId: 'reg-SHJ' },
    ];
    for (const d of deptDefs) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO customer_hierarchy (id, level, name, code, parent_id, is_active)
        VALUES ('${d.id}', 'DEPARTMENT', '${d.name}', '${d.code}', '${d.parentId}', true)
        ON CONFLICT (id) DO NOTHING
      `);
    }
    const depts = deptDefs;

    const unitDefs = [
      { id: 'unit-dxb-vip', name: 'VIP Services',       code: 'VIP', parentId: 'dept-dxb-fleet' },
      { id: 'unit-dxb-sme', name: 'SME Leasing',        code: 'SME', parentId: 'dept-dxb-corp'  },
      { id: 'unit-auh-gov', name: 'Government Accounts', code: 'GOV', parentId: 'dept-auh-fleet' },
    ];
    for (const u of unitDefs) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO customer_hierarchy (id, level, name, code, parent_id, is_active)
        VALUES ('${u.id}', 'UNIT', '${u.name}', '${u.code}', '${u.parentId}', true)
        ON CONFLICT (id) DO NOTHING
      `);
    }
    const units = unitDefs;
    results.hierarchy = regions.length + depts.length + units.length;

    //  2. UAE Customers + Linked Lessees 
    const customerDefs = [
      {
        id: 'cust-slb', code: 'CORP0001', type: 'CORPORATE', nameEn: 'Schlumberger Middle East',
        email: 'info@slb.com', mobile: '554321100', accountCode: 'SLB001',
        tradeLicense: 'TL-DXB-2019-001234', city: 'Dubai', state: 'Dubai',
        creditLimit: 500000, creditDays: 60, regionId: 'reg-DXB', departmentId: 'dept-dxb-corp',
        taxReg: '100123456789015', priority: 'HIGH', contactPerson: 'Mohammed Al-Rashidi',
        contactPhone: '+971 4 321 0000', contactEmail: 'fleet@slb.com',
        billingCycle: 'MONTHLY', invoiceDelivery: 'EMAIL',
        allowedWaiting: 15, cancellationMin: 60, preferredChannel: 'EMAIL',
        notifEmail: 'fleet@slb.com', bookingNotifications: true,
      },
      {
        id: 'cust-emaar', code: 'CORP0002', type: 'CORPORATE', nameEn: 'Emaar Properties PJSC',
        email: 'fleet@emaar.ae', mobile: '556789012', accountCode: 'EMAAR001',
        tradeLicense: 'TL-DXB-2015-005678', city: 'Dubai', state: 'Dubai',
        creditLimit: 750000, creditDays: 45, regionId: 'reg-DXB', departmentId: 'dept-dxb-corp',
        taxReg: '100987654321012', priority: 'VIP', contactPerson: 'Sarah Al-Maktoum',
        contactPhone: '+971 4 888 0000', contactEmail: 'fleet@emaar.ae',
        billingCycle: 'MONTHLY', invoiceDelivery: 'PORTAL',
        allowedWaiting: 20, cancellationMin: 120, preferredChannel: 'EMAIL',
        notifEmail: 'fleet@emaar.ae', bookingNotifications: true,
      },
      {
        id: 'cust-adnoc', code: 'CORP0003', type: 'CORPORATE', nameEn: 'ADNOC Distribution',
        email: 'fleet@adnoc.ae', mobile: '501234567', accountCode: 'ADNOC001',
        tradeLicense: 'TL-AUH-2010-009876', city: 'Abu Dhabi', state: 'Abu Dhabi',
        creditLimit: 1000000, creditDays: 60, regionId: 'reg-AUH', departmentId: 'dept-auh-fleet', unitId: 'unit-auh-gov',
        taxReg: '100456789123456', priority: 'VIP', contactPerson: 'Khalid Al-Falasi',
        contactPhone: '+971 2 666 0000', contactEmail: 'procurement@adnoc.ae',
        billingCycle: 'MONTHLY', invoiceDelivery: 'EMAIL',
        allowedWaiting: 10, cancellationMin: 30, preferredChannel: 'EMAIL',
        notifEmail: 'fleet@adnoc.ae', bookingNotifications: true,
      },
      {
        id: 'cust-dp', code: 'CORP0004', type: 'CORPORATE', nameEn: 'DP World UAE',
        email: 'fleet@dpworld.com', mobile: '554567890', accountCode: 'DPW001',
        tradeLicense: 'TL-DXB-2005-002345', city: 'Dubai', state: 'Dubai',
        creditLimit: 300000, creditDays: 30, regionId: 'reg-DXB', departmentId: 'dept-dxb-fleet',
        taxReg: '100234567890123', priority: 'HIGH', contactPerson: 'Ahmad Al-Yafei',
        contactPhone: '+971 4 811 0000', contactEmail: 'fleet@dpworld.com',
        billingCycle: 'MONTHLY', invoiceDelivery: 'EMAIL',
        allowedWaiting: 10, cancellationMin: 60, preferredChannel: 'SMS',
        notifEmail: 'fleet@dpworld.com', bookingNotifications: true,
      },
      {
        id: 'cust-etisalat', code: 'CORP0005', type: 'CORPORATE', nameEn: 'e& (Etisalat) UAE',
        email: 'fleetmgmt@etisalat.ae', mobile: '502345678', accountCode: 'ETS001',
        tradeLicense: 'TL-AUH-2000-000001', city: 'Abu Dhabi', state: 'Abu Dhabi',
        creditLimit: 600000, creditDays: 45, regionId: 'reg-AUH', departmentId: 'dept-auh-fleet',
        taxReg: '100345678901234', priority: 'VIP', contactPerson: 'Fatima Al-Hammadi',
        contactPhone: '+971 2 628 0000', contactEmail: 'fleet@etisalat.ae',
        billingCycle: 'QUARTERLY', invoiceDelivery: 'EMAIL',
        allowedWaiting: 15, cancellationMin: 30, preferredChannel: 'WHATSAPP',
        notifEmail: 'fleet@etisalat.ae', bookingNotifications: true,
      },
      {
        id: 'cust-gfh', code: 'CORP0006', type: 'CORPORATE', nameEn: 'Gulf Finance House',
        email: 'operations@gfh.com', mobile: '503456789', accountCode: 'GFH001',
        tradeLicense: 'TL-DXB-2008-007890', city: 'Dubai', state: 'Dubai',
        creditLimit: 200000, creditDays: 30, regionId: 'reg-DXB', departmentId: 'dept-dxb-corp', unitId: 'unit-dxb-sme',
        taxReg: '100567890123456', priority: 'MEDIUM', contactPerson: 'Nasser Al-Blooshi',
        contactPhone: '+971 4 312 0000', contactEmail: 'fleet@gfh.com',
        billingCycle: 'MONTHLY', invoiceDelivery: 'EMAIL',
        allowedWaiting: 10, cancellationMin: 45, preferredChannel: 'EMAIL',
        notifEmail: 'fleet@gfh.com', bookingNotifications: true,
      },
      {
        id: 'cust-alex', code: 'CORP0007', type: 'CORPORATE', nameEn: 'EXL Solutions FZE',
        email: 'alex@exlsolutions.ae', mobile: '502681318', accountCode: 'EXL2601',
        tradeLicense: 'TL-DXB-2020-EXL001', city: 'Dubai', state: 'Dubai',
        creditLimit: 50000, creditDays: 30, regionId: 'reg-DXB', departmentId: 'dept-dxb-corp',
        taxReg: '100678901234567', priority: 'MEDIUM', contactPerson: 'Alex Thomas',
        contactPhone: '+971 502681318', contactEmail: 'alex@exlsolutions.ae',
        billingCycle: 'MONTHLY', invoiceDelivery: 'EMAIL',
        allowedWaiting: 10, cancellationMin: 30, preferredChannel: 'EMAIL',
        notifEmail: 'alex@exlsolutions.ae', bookingNotifications: true,
      },
    ];

    let custCount = 0, lesseeCount = 0;
    const customerIds: string[] = [];

    for (const cd of customerDefs) {
      const now = new Date().toISOString();
      const nameEn = cd.nameEn.replace(/'/g, "''");
      const tradeLicense = (cd.tradeLicense ?? '').replace(/'/g, "''");
      const contactPerson = cd.contactPerson.replace(/'/g, "''");
      const unitIdSql = (cd as any).unitId ? "'" + (cd as any).unitId + "'" : 'NULL';
      const insertSql = "INSERT INTO customers (id, created_at, updated_at, customer_code, customer_type, name_en," +
        " email, mobile_number, mobile_country_code, account_code, trade_license," +
        " city, state, country, credit_limit, credit_days," +
        " region_id, department_id, unit_id," +
        " tax_registration_number, tax_applicable, toll_exempt," +
        " priority, contact_person, contact_person_phone, contact_person_email," +
        " billing_cycle, invoice_delivery_method," +
        " allowed_payment_methods, default_payment_method, payment_reminder_days, auto_invoice," +
        " allowed_waiting_time_min, cancellation_allowed_min," +
        " preferred_channel, notification_email," +
        " booking_notifications, marketing_communications, status)" +
        " VALUES (" +
        "'" + cd.id + "', '" + now + "', '" + now + "', '" + cd.code + "', '" + cd.type + "', '" + nameEn + "'," +
        "'" + cd.email + "', '" + cd.mobile + "', '+971', '" + cd.accountCode + "', '" + tradeLicense + "'," +
        "'" + cd.city + "', '" + cd.state + "', 'UAE', " + cd.creditLimit + ", " + cd.creditDays + "," +
        "'" + cd.regionId + "', '" + cd.departmentId + "', " + unitIdSql + "," +
        "'" + cd.taxReg + "', true, false," +
        "'" + cd.priority + "', '" + contactPerson + "', '" + cd.contactPhone + "', '" + cd.contactEmail + "'," +
        "'" + cd.billingCycle + "', '" + cd.invoiceDelivery + "'," +
        "'[\"BANK_TRANSFER\",\"CHEQUE\",\"CREDIT_CARD\"]', 'BANK_TRANSFER', 7, false," +
        cd.allowedWaiting + ", " + cd.cancellationMin + "," +
        "'" + cd.preferredChannel + "', '" + cd.notifEmail + "'," +
        "true, false, 'ACTIVE'" +
        ") ON CONFLICT (id) DO NOTHING";
      await prisma.$executeRawUnsafe(insertSql);
      const selectSql = "SELECT id FROM customers WHERE id = '" + cd.id + "'";
      const custRows = await prisma.$queryRawUnsafe(selectSql);
      const customer = (custRows as any[])[0];
      customerIds.push(cd.id);
      custCount++;

      // Create linked Lessee (Corporate type maps to Lessee)
      const lesseeId = `lessee-${cd.id}`;
      await prisma.lessee.upsert({
        where: { id: lesseeId },
        create: {
          id: lesseeId,
          name: cd.nameEn,
          type: 'corporate',
          tradeLicense: cd.tradeLicense ?? null,
          contactPerson: cd.contactPerson ?? null,
          email: cd.email ?? null,
          phone: cd.mobile ?? null,
          address: `${cd.city}, ${cd.state}, UAE`,
          customerId: cd.id,
        },
        update: { customerId: cd.id },
      });
      lesseeCount++;
    }
    results.customers = custCount;
    results.lessees   = lesseeCount;

    //  3. Lease Inquiries 
    const inquiries = [
      { id:'inq-001', customerId:'cust-slb',    lesseeId:'lessee-cust-slb',    name:'Schlumberger Middle East',  vehicleType:'SUV',        count:10, duration:24, type:'LONG_TERM',  status:'QUOTATION_SENT', assignedTo:'Fatima Khan', daysAgo:45 },
      { id:'inq-002', customerId:'cust-emaar',  lesseeId:'lessee-cust-emaar',  name:'Emaar Properties PJSC',    vehicleType:'SEDAN',       count:15, duration:36, type:'LONG_TERM',  status:'CONVERTED',      assignedTo:'Mohammed Hassan', daysAgo:60 },
      { id:'inq-003', customerId:'cust-adnoc',  lesseeId:'lessee-cust-adnoc',  name:'ADNOC Distribution',       vehicleType:'TRUCK',       count:5,  duration:12, type:'SHORT_TERM', status:'NEW',            assignedTo:'Layla Omar', daysAgo:5 },
      { id:'inq-004', customerId:'cust-dp',     lesseeId:'lessee-cust-dp',     name:'DP World UAE',             vehicleType:'VAN',         count:8,  duration:24, type:'LONG_TERM',  status:'CONTACTED',      assignedTo:'Fatima Khan', daysAgo:15 },
      { id:'inq-005', customerId:'cust-gfh',    lesseeId:'lessee-cust-gfh',    name:'Gulf Finance House',       vehicleType:'SEDAN',       count:3,  duration:12, type:'LONG_TERM',  status:'QUOTATION_SENT', assignedTo:'Ahmed Salem', daysAgo:20 },
    ];
    let inqCount = 0;
    for (const inq of inquiries) {
      await prisma.leaseInquiry.upsert({
        where: { id: inq.id },
        create: {
          id: inq.id, inquiryNumber: `INQ-${inq.id.slice(-3).toUpperCase()}`,
          customerName: inq.name, companyName: inq.name,
          vehicleType: inq.vehicleType, vehicleCount: inq.count,
          leaseType: inq.type as any, durationMonths: inq.duration,
          startDate: addMonths(new Date(), 1),
          requiresInsurance: true, requiresMaintenance: true, requiresDriver: false,
          status: inq.status,
          assignedTo: inq.assignedTo,
          notes: `Initial inquiry from ${inq.name} for ${inq.count} ${inq.vehicleType}(s).`,
        },
        update: {},
      });
      inqCount++;
    }
    results.inquiries = inqCount;

    //  4. Lease Quotations 
    const quotationDefs = [
      {
        id: 'quot-001', lesseeId: 'lessee-cust-emaar', leaseType: 'LONG_TERM',
        duration: 36, startDate: addMonths(new Date(), 1),
        baseMonthlyRate: 3800, insuranceCost: 500, maintenanceCost: 300,
        vehicleType: 'SEDAN', vehicleCount: 15, mileageCap: 3000,
        securityDeposit: 57000, status: 'CUSTOMER_APPROVED', daysAgo: 55,
      },
      {
        id: 'quot-002', lesseeId: 'lessee-cust-slb', leaseType: 'LONG_TERM',
        duration: 24, startDate: addMonths(new Date(), 1),
        baseMonthlyRate: 5200, insuranceCost: 650, maintenanceCost: 400,
        vehicleType: 'SUV', vehicleCount: 10, mileageCap: 4000,
        securityDeposit: 52000, status: 'SENT_TO_CUSTOMER', daysAgo: 40,
      },
      {
        id: 'quot-003', lesseeId: 'lessee-cust-dp', leaseType: 'LONG_TERM',
        duration: 24, startDate: addMonths(new Date(), 1),
        baseMonthlyRate: 4500, insuranceCost: 0, maintenanceCost: 350,
        vehicleType: 'VAN', vehicleCount: 8, mileageCap: 5000,
        securityDeposit: 36000, status: 'NEW', daysAgo: 10,
      },
    ];
    let quotCount = 0;
    for (const q of quotationDefs) {
      const totalMonthly = (q.baseMonthlyRate + q.insuranceCost + q.maintenanceCost) * q.vehicleCount;
      const endDate = addMonths(q.startDate, q.duration);
      await prisma.leaseQuotation.upsert({
        where: { id: q.id },
        create: {
          id: q.id,
          quotationNumber: `QUO-${q.id.slice(-3).toUpperCase()}`,
          lesseeId: q.lesseeId,
          leaseType: q.leaseType as any,
          durationMonths: q.duration,
          startDate: q.startDate,
          endDate,
          vehicleType: q.vehicleType as any,
          vehicleCount: q.vehicleCount,
          baseMonthlyRate: q.baseMonthlyRate,
          insuranceCost: q.insuranceCost || null,
          maintenanceCost: q.maintenanceCost || null,
          totalMonthlyRate: totalMonthly,
          totalContractValue: totalMonthly * q.duration,
          mileageCap: q.mileageCap,
          securityDeposit: q.securityDeposit,
          currency: 'AED',
          insuranceIncluded: q.insuranceCost > 0,
          maintenanceIncluded: q.maintenanceCost > 0,
          driverIncluded: false,
          validUntil: addMonths(new Date(), 1),
          status: q.status,
        },
        update: {},
      });
      quotCount++;
    }
    results.quotations = quotCount;

    //  5. Lease Contracts (Agreements) 
    const contractDefs = [
      {
        id: 'cont-001', lesseeId: 'lessee-cust-emaar', quotationId: 'quot-001',
        leaseType: 'LONG_TERM', duration: 36,
        startDate: ago(90), monthlyRate: 87000, securityDeposit: 87000,
        mileageCap: 3000, vehicleType: 'SEDAN', vehicleCount: 15,
        insuranceIncluded: true, maintenanceIncluded: true, status: 'ACTIVE',
      },
      {
        id: 'cont-002', lesseeId: 'lessee-cust-adnoc', quotationId: null,
        leaseType: 'LONG_TERM', duration: 24,
        startDate: ago(180), monthlyRate: 32500, securityDeposit: 65000,
        mileageCap: 4000, vehicleType: 'TRUCK', vehicleCount: 5,
        insuranceIncluded: true, maintenanceIncluded: false, status: 'ACTIVE',
      },
      {
        id: 'cont-003', lesseeId: 'lessee-cust-etisalat', quotationId: null,
        leaseType: 'LONG_TERM', duration: 24,
        startDate: ago(365), monthlyRate: 118000, securityDeposit: 118000,
        mileageCap: 3500, vehicleType: 'SEDAN', vehicleCount: 20,
        insuranceIncluded: true, maintenanceIncluded: true, status: 'ACTIVE',
      },
      {
        id: 'cont-004', lesseeId: 'lessee-cust-gfh', quotationId: null,
        leaseType: 'SHORT_TERM', duration: 12,
        startDate: ago(60), monthlyRate: 21000, securityDeposit: 21000,
        mileageCap: 2500, vehicleType: 'SEDAN', vehicleCount: 3,
        insuranceIncluded: true, maintenanceIncluded: true, status: 'ACTIVE',
      },
      {
        id: 'cont-005', lesseeId: 'lessee-cust-alex', quotationId: null,
        leaseType: 'MONTHLY', duration: 12,
        startDate: ago(30), monthlyRate: 12000, securityDeposit: 12000,
        mileageCap: 3000, vehicleType: 'SUV', vehicleCount: 2,
        insuranceIncluded: true, maintenanceIncluded: false, status: 'ACTIVE',
      },
    ];
    let contCount = 0;
    for (const cd of contractDefs) {
      const endDate = addMonths(cd.startDate, cd.duration);
      const contract = await prisma.leaseContract2.upsert({
        where: { id: cd.id },
        create: {
          id: cd.id,
          contractNumber: `LC-2024-${cd.id.slice(-3).toUpperCase()}`,
          agreementType: 'INDIVIDUAL',
          lesseeId: cd.lesseeId,
          quotationId: cd.quotationId ?? null,
          leaseType: cd.leaseType as any,
          startDate: cd.startDate,
          endDate,
          monthlyRate: cd.monthlyRate,
          totalContractValue: cd.monthlyRate * cd.duration,
          securityDeposit: cd.securityDeposit,
          mileageCap: cd.mileageCap,
          currency: 'AED',
          insuranceIncluded: cd.insuranceIncluded,
          maintenanceIncluded: cd.maintenanceIncluded,
          driverIncluded: false,
          status: cd.status,
        },
        update: {},
      });

      // Contract vehicles
      await prisma.leaseContractVehicle.upsert({
        where: { id: `cv-${cd.id}` },
        create: {
          id: `cv-${cd.id}`, contractId: cd.id,
          vehicleType: cd.vehicleType,
          make: cd.vehicleType === 'SEDAN' ? 'Toyota' : cd.vehicleType === 'SUV' ? 'Nissan' : cd.vehicleType === 'TRUCK' ? 'Isuzu' : 'Ford',
          model: cd.vehicleType === 'SEDAN' ? 'Camry' : cd.vehicleType === 'SUV' ? 'Patrol' : cd.vehicleType === 'TRUCK' ? 'Forward Truck' : 'Transit Van',
          year: 2023, quantity: cd.vehicleCount, monthlyRate: cd.monthlyRate / cd.vehicleCount,
          mileageStart: Math.floor(Math.random() * 5000) + 1000, status: 'ACTIVE',
        },
        update: {},
      });

      // Payment schedule (3 months of payments)
      for (let m = 0; m < 6; m++) {
        const dueDate = addMonths(cd.startDate, m + 1);
        const isPaid  = dueDate < new Date();
        const payId   = `pay-${cd.id}-${m}`;
        await prisma.leasePayment2.upsert({
          where: { id: payId },
          create: {
            id: payId, contractId: cd.id,
            periodMonth: dueDate.getMonth() + 1, periodYear: dueDate.getFullYear(),
            dueDate, amount: cd.monthlyRate, vatAmount: cd.monthlyRate * 0.05,
            totalAmount: cd.monthlyRate * 1.05, currency: 'AED',
            status: isPaid ? 'PAID' : 'PENDING',
            paidDate: isPaid ? dueDate : null,
          },
          update: {},
        });
      }
      contCount++;
    }
    results.contracts = contCount;

    //  6. Traffic Fines 
    const finesDefs = [
      { id:'fine-001', contractId:'cont-001', type:'SPEEDING',   auth:'DUBAI_POLICE',  loc:'Sheikh Zayed Road',      amount:1000, disc:0,   daysAgo:20 },
      { id:'fine-002', contractId:'cont-001', type:'PARKING',    auth:'RTA',           loc:'Downtown Dubai',          amount:200,  disc:0,   daysAgo:15 },
      { id:'fine-003', contractId:'cont-002', type:'RED_LIGHT',  auth:'ABU_DHABI_POLICE',loc:'Hamdan Street Abu Dhabi',amount:800,  disc:200, daysAgo:30 },
      { id:'fine-004', contractId:'cont-003', type:'SALIK',      auth:'RTA',           loc:'Al Maktoum Bridge',       amount:4,    disc:0,   daysAgo:10 },
      { id:'fine-005', contractId:'cont-005', type:'SPEEDING',   auth:'RTA',           loc:'Al Khail Road',           amount:600,  disc:0,   daysAgo:5 },
    ];
    let fineCount = 0;
    for (const f of finesDefs) {
      await (prisma as any).leaseTrafficFine.upsert({
        where: { id: f.id },
        create: {
          id: f.id, contractId: f.contractId, violationDate: ago(f.daysAgo),
          violationType: f.type, authority: f.auth, location: f.loc,
          fineAmount: f.amount, discountAmount: f.disc, finalAmount: f.amount - f.disc,
          currency: 'AED', billedToLessee: true, billingStatus: f.daysAgo > 14 ? 'INVOICED' : 'PENDING',
        },
        update: {},
      });
      fineCount++;
    }
    results.trafficFines = fineCount;

    //  7. Fuel Logs 
    const fuelDefs = [
      { id:'fuel-001', contractId:'cont-001', liters:45.2, cost:3.01, station:'ENOC Dubai Marina', mileage:12450, daysAgo:7  },
      { id:'fuel-002', contractId:'cont-001', liters:38.6, cost:3.01, station:'ADNOC Business Bay', mileage:12180, daysAgo:14 },
      { id:'fuel-003', contractId:'cont-002', liters:80.0, cost:2.89, station:'ADNOC Industrial', mileage:8900,  daysAgo:5  },
      { id:'fuel-004', contractId:'cont-003', liters:52.3, cost:3.01, station:'ENOC Sheikh Zayed', mileage:19500, daysAgo:3  },
      { id:'fuel-005', contractId:'cont-005', liters:41.0, cost:3.01, station:'EMARAT JBR',        mileage:6700,  daysAgo:8  },
    ];
    let fuelCount = 0;
    for (const f of fuelDefs) {
      await (prisma as any).leaseFuelLog.upsert({
        where: { id: f.id },
        create: {
          id: f.id, contractId: f.contractId, fuelDate: ago(f.daysAgo),
          liters: f.liters, costPerLiter: f.cost, totalCost: f.liters * f.cost,
          station: f.station, mileageAtFuel: f.mileage, currency: 'AED',
          billedToLessee: true, billingStatus: 'PENDING',
        },
        update: {},
      });
      fuelCount++;
    }
    results.fuelLogs = fuelCount;

    //  8. Insurance Policies 
    const insuranceDefs = [
      { id:'ins-001', contractId:'cont-001', insurer:'AXA Gulf Insurance',        coverage:'COMPREHENSIVE', premium:82500, start: ago(90),   expiry: addMonths(ago(90), 12) },
      { id:'ins-002', contractId:'cont-002', insurer:'Emirates Insurance',        coverage:'COMPREHENSIVE', premium:18750, start: ago(180),  expiry: addMonths(ago(180), 12) },
      { id:'ins-003', contractId:'cont-003', insurer:'Orient Insurance',          coverage:'FLEET',         premium:142000,start: ago(365),  expiry: addMonths(ago(365), 12) },
      { id:'ins-004', contractId:'cont-004', insurer:'Oman Insurance',            coverage:'THIRD_PARTY',   premium:9450,  start: ago(60),   expiry: addMonths(ago(60), 12) },
      { id:'ins-005', contractId:'cont-005', insurer:'Dubai Insurance',           coverage:'COMPREHENSIVE', premium:14400, start: ago(30),   expiry: addMonths(ago(30), 12) },
    ];
    let insCount = 0;
    for (const ins of insuranceDefs) {
      await (prisma as any).leaseInsurancePolicy.upsert({
        where: { id: ins.id },
        create: {
          id: ins.id, contractId: ins.contractId,
          policyNo: `POL-${ins.id.slice(-3).toUpperCase()}-2024`,
          insurer: ins.insurer, coverageType: ins.coverage,
          premium: ins.premium, currency: 'AED',
          startDate: ins.start, expiryDate: ins.expiry,
          renewalReminderDays: 30, status: 'ACTIVE', deductible: 2000,
        },
        update: {},
      });
      insCount++;
    }
    results.insurancePolicies = insCount;

    //  9. Mileage Readings 
    const mileageDefs = [
      { id:'mile-001', contractId:'cont-001', mileage:11000, type:'DELIVERY', daysAgo:90 },
      { id:'mile-002', contractId:'cont-001', mileage:12450, type:'MONTHLY',  daysAgo:30 },
      { id:'mile-003', contractId:'cont-002', mileage:7200,  type:'DELIVERY', daysAgo:180 },
      { id:'mile-004', contractId:'cont-002', mileage:8900,  type:'MONTHLY',  daysAgo:30 },
      { id:'mile-005', contractId:'cont-003', mileage:18000, type:'DELIVERY', daysAgo:365 },
      { id:'mile-006', contractId:'cont-003', mileage:19500, type:'MONTHLY',  daysAgo:30 },
    ];
    let mileCount = 0;
    for (const m of mileageDefs) {
      await (prisma as any).leaseMileageReading.upsert({
        where: { id: m.id },
        create: {
          id: m.id, contractId: m.contractId, readingDate: ago(m.daysAgo),
          mileage: m.mileage, readingType: m.type, source: 'MANUAL', capturedBy: 'System',
        },
        update: {},
      });
      mileCount++;
    }
    results.mileageReadings = mileCount;

    //  10. Lease Receipts 
    const receiptDefs = [
      { id:'rcpt-001', contractId:'cont-001', type:'MONTHLY',  amount:87000,  method:'BANK_TRANSFER', ref:'TXN-2024-001', daysAgo:60 },
      { id:'rcpt-002', contractId:'cont-001', type:'MONTHLY',  amount:87000,  method:'BANK_TRANSFER', ref:'TXN-2024-002', daysAgo:30 },
      { id:'rcpt-003', contractId:'cont-002', type:'MONTHLY',  amount:32500,  method:'CHEQUE',        ref:'CHQ-445678',   daysAgo:55 },
      { id:'rcpt-004', contractId:'cont-003', type:'MONTHLY',  amount:118000, method:'BANK_TRANSFER', ref:'TXN-2024-010', daysAgo:60 },
      { id:'rcpt-005', contractId:'cont-001', type:'DEPOSIT',  amount:87000,  method:'BANK_TRANSFER', ref:'DEP-2024-001', daysAgo:91 },
    ];
    let rcptCount = 0;
    for (const r of receiptDefs) {
      await prisma.leaseReceipt.upsert({
        where: { id: r.id },
        create: {
          id: r.id, contractId: r.contractId, receiptNumber: `RCT-${r.id.slice(-3).toUpperCase()}`,
          paymentType: r.type as any, amount: r.amount, currency: 'AED',
          receivedDate: ago(r.daysAgo), paymentMethod: r.method as any,
          bankRef: r.method === 'BANK_TRANSFER' ? r.ref : null,
          chequeNo: r.method === 'CHEQUE' ? r.ref : null,
          receivedBy: 'Finance Team',
        },
        update: {},
      });
      rcptCount++;
    }
    results.receipts = rcptCount;

    //  11. Lease Renewals 
    await (prisma as any).leaseRenewal.upsert({
      where: { id: 'rnw-001' },
      create: {
        id: 'rnw-001', renewalNo: 'RNW-001', originalContractId: 'cont-004',
        renewalType: 'SAME_TERMS',
        proposedStartDate: addMonths(ago(60), 12),
        proposedEndDate:   addMonths(ago(60), 24),
        proposedMonthlyRate: 21000, initiatedBy: 'Sales Team',
        status: 'PROPOSED',
        notes: 'Customer Gulf Finance House interested in 12-month renewal at same terms.',
      },
      update: {},
    });
    results.renewals = 1;

    //  12. Credit Assessments 
    const creditDefs = [
      { id:'ca-001', lesseeId:'lessee-cust-emaar',    limit:750000, score:850, risk:'LOW',    exposure:522000 },
      { id:'ca-002', lesseeId:'lessee-cust-slb',      limit:500000, score:820, risk:'LOW',    exposure:312000 },
      { id:'ca-003', lesseeId:'lessee-cust-adnoc',    limit:1000000,score:900, risk:'LOW',    exposure:390000 },
      { id:'ca-004', lesseeId:'lessee-cust-etisalat', limit:600000, score:875, risk:'LOW',    exposure:708000 },
      { id:'ca-005', lesseeId:'lessee-cust-gfh',      limit:200000, score:710, risk:'MEDIUM', exposure:63000  },
    ];
    let caCount = 0;
    for (const ca of creditDefs) {
      await (prisma as any).leaseCreditAssessment.upsert({
        where: { id: ca.id },
        create: {
          id: ca.id, lesseeId: ca.lesseeId,
          assessmentDate: ago(30), creditLimit: ca.limit, creditScore: ca.score,
          riskRating: ca.risk, annualRevenue: ca.limit * 50, yearsInBusiness: 10,
          paymentHistory: 'EXCELLENT', currentExposure: ca.exposure,
          recommendedLimit: ca.limit, assessedBy: 'Credit Team',
          validUntil: addMonths(new Date(), 12), status: 'ACTIVE',
        },
        update: {},
      });
      caCount++;
    }
    results.creditAssessments = caCount;

    // Summary
    const total = Object.values(results).reduce((s,v) => s+v, 0);
    return NextResponse.json({
      success: true,
      message: `UAE Leasing demo data seeded successfully. ${total} records created/updated.`,
      breakdown: results,
    });

  } catch (e: any) {
    console.error('Seed error:', e);
    return NextResponse.json({ error: e?.message ?? 'Seed failed', stack: e?.stack }, { status: 500 });
  }
}
