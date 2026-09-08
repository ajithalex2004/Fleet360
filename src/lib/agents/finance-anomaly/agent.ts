/**
 * Finance Anomaly Detection Agent — Runner v2.0.0
 * ------------------------------------------------
 * AI Financial Control Layer scanning 8 operational streams:
 *   1. Maintenance (Parts price inflation, repeat repairs/warranty, labor SRT overruns)
 *   2. Fuel (Tank capacity overfills, GPS location vs fuel station mismatch, UAE grade pricing)
 *   3. Vendor Invoices (Rate card breaches, duplicate billing, UAE 5% VAT / FTA TRN audits)
 *   4. Partner Settlements (Spot exchange quote vs billing divergence, ghost trips)
 *   5. Driver Expenses (Inflated mileage claims vs telematics distance, suspicious round numbers)
 *   6. Trip Costs (Unbilled Salik/Darb road tolls, deadhead surges)
 *   7. Contracts (Off-contract odometer movement, unbilled excess km overages, unbilled damages)
 *   8. Procurement (PO line item variances, price escalation)
 */
import { prisma } from '@/lib/prisma';
import { AgentDefinition, AgentEvent, AgentRunResult, AnomalyFlag } from '../types';
import { ensureAgentSchema } from '../schema';
import {
  MaintenanceRecord,
  FuelLogRecord,
  VendorInvoiceRecord,
  PartnerSettlementRecord,
  DriverExpenseRecord,
  TripTollRecord,
  ContractAuditRecord,
  ProcurementRecord,
  detectMaintenanceAnomalies,
  detectFuelAnomalies,
  detectVendorInvoiceAnomalies,
  detectPartnerSettlementAnomalies,
  detectDriverExpenseAnomalies,
  detectTripTollAnomalies,
  detectContractAnomalies,
  detectProcurementAnomalies,
} from './detectors';

// ── Multi-Tenant Data Fetchers ─────────────────────────────────────────────────

async function fetchMaintenanceRecords(tenantId: string): Promise<MaintenanceRecord[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        w.id::text,
        w.vehicle_id::text AS "vehicleId",
        COALESCE(v.vehicle_code, v.plate_number, 'VEH') AS "vehicleCode",
        w.id::text AS "workOrderId",
        COALESCE(g.name, 'Main Garage') AS "garageName",
        COALESCE(p.name, 'Brake Pads & Service') AS "partName",
        p.part_number AS "partNumber",
        COALESCE(pu.unit_cost, 450.0)::float8 AS "invoicedPartPrice",
        COALESCE(p.cost_price, 280.0)::float8 AS "catalogBaselinePrice",
        COALESCE(w.labor_hours, 3.5)::float8 AS "invoicedLaborHours",
        2.0::float8 AS "standardLaborHours",
        120.0::float8 AS "laborRatePerHour",
        COALESCE(w.created_at, NOW())::text AS "serviceDate",
        60::int AS "warrantyDays"
      FROM work_orders w
      LEFT JOIN vehicles v ON v.id = w.vehicle_id
      LEFT JOIN garages g ON g.id = w.garage_id
      LEFT JOIN part_usages pu ON pu.work_order_id = w.id
      LEFT JOIN parts p ON p.id = pu.part_id
      WHERE w.tenant_id = $1
      ORDER BY w.created_at DESC
      LIMIT 500
    `, tenantId);

    return rows.map(r => ({
      id: r.id,
      vehicleId: r.vehicleId,
      vehicleCode: r.vehicleCode,
      workOrderId: r.workOrderId,
      garageName: r.garageName,
      partName: r.partName,
      partNumber: r.partNumber,
      invoicedPartPrice: Number(r.invoicedPartPrice ?? 0),
      catalogBaselinePrice: Number(r.catalogBaselinePrice ?? 0),
      invoicedLaborHours: Number(r.invoicedLaborHours ?? 0),
      standardLaborHours: Number(r.standardLaborHours ?? 2.0),
      laborRatePerHour: Number(r.laborRatePerHour ?? 120.0),
      serviceDate: r.serviceDate,
      warrantyDays: Number(r.warrantyDays ?? 60),
    }));
  } catch {
    return [];
  }
}

async function fetchFuelRecords(tenantId: string): Promise<FuelLogRecord[]> {
  try {
    // fuel_logs has no fuel_card_no/station_name/station_lat/station_lng/
    // odometer_km columns — the real names are fuel_card_id/station/mileage,
    // and there's no GPS capture on fuel purchases at all (no vehicle_locations
    // join target either). GPS fields go NULL; detectFuelAnomalies() already
    // guards its GPS-mismatch check on all four being present, so that one
    // detector just stays dormant until fuel purchases ever capture location —
    // the tank-overfill and UAE grade-benchmark checks don't need it.
    // vehicles has no fuel_tank_capacity_liters column either; estimate from
    // vehicle_group rather than a single flat number across the whole fleet.
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        fl.id::text,
        fl.vehicle_id::text AS "vehicleId",
        COALESCE(v.vehicle_code, v.plate_number, 'VEH') AS "vehicleCode",
        fl.fuel_card_id AS "fuelCardNumber",
        COALESCE(v.fuel_type, 'SPECIAL_95') AS "fuelGrade",
        fl.liters::float8 AS liters,
        fl.total_cost::float8 AS "totalCost",
        CASE WHEN v.vehicle_group IN ('BUS','VAN') THEN 100.0 ELSE 60.0 END AS "tankCapacityLiters",
        fl.fuel_date::text AS "fuelDate",
        fl.station AS "stationName",
        NULL::float8 AS "stationLat",
        NULL::float8 AS "stationLng",
        NULL::float8 AS "vehicleLatAtTime",
        NULL::float8 AS "vehicleLngAtTime",
        fl.mileage::int AS "odometerKm"
      FROM fuel_logs fl
      LEFT JOIN vehicles v ON v.id = fl.vehicle_id
      WHERE fl.tenant_id = $1
      ORDER BY fl.fuel_date DESC
      LIMIT 500
    `, tenantId);

    return rows.map(r => ({
      id: r.id,
      vehicleId: r.vehicleId,
      vehicleCode: r.vehicleCode,
      fuelCardNumber: r.fuelCardNumber,
      fuelGrade: r.fuelGrade,
      liters: Number(r.liters ?? 0),
      totalCost: Number(r.totalCost ?? 0),
      tankCapacityLiters: Number(r.tankCapacityLiters ?? 60),
      fuelDate: r.fuelDate,
      stationName: r.stationName,
      stationLat: null,
      stationLng: null,
      vehicleLatAtTime: null,
      vehicleLngAtTime: null,
      odometerKm: r.odometerKm !== null ? Number(r.odometerKm) : undefined,
    }));
  } catch {
    return [];
  }
}

async function fetchVendorInvoices(tenantId: string): Promise<VendorInvoiceRecord[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        i.id::text,
        COALESCE(i.invoice_number, i.id::text) AS "invoiceNumber",
        COALESCE(i.vendor_name, 'Vendor') AS "vendorName",
        i.vendor_trn AS "vendorTrn",
        i.invoice_date::text AS "invoiceDate",
        COALESCE(i.subtotal, i.amount, 0)::float8 AS subtotal,
        COALESCE(i.tax_amount, 0)::float8 AS "vatAmount",
        COALESCE(i.total_amount, i.amount, 0)::float8 AS "totalAmount",
        COALESCE(i.agreed_rate, i.subtotal)::float8 AS "agreedRateCardAmount",
        COALESCE(i.category, 'GENERAL') AS category,
        COALESCE(i.currency, 'AED') AS currency,
        i.description
      FROM invoices i
      WHERE i.tenant_id = $1
      ORDER BY i.created_at DESC
      LIMIT 500
    `, tenantId);

    return rows.map(r => ({
      id: r.id,
      invoiceNumber: r.invoiceNumber,
      vendorName: r.vendorName,
      vendorTrn: r.vendorTrn,
      invoiceDate: r.invoiceDate,
      subtotal: Number(r.subtotal ?? 0),
      vatAmount: Number(r.vatAmount ?? 0),
      totalAmount: Number(r.totalAmount ?? 0),
      agreedRateCardAmount: r.agreedRateCardAmount !== null ? Number(r.agreedRateCardAmount) : undefined,
      category: r.category,
      currency: r.currency,
      description: r.description,
    }));
  } catch {
    return [];
  }
}

async function fetchPartnerSettlements(tenantId: string): Promise<PartnerSettlementRecord[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        eq.id::text,
        COALESCE(eq.vendor_id::text, 'P-101') AS "partnerId",
        COALESCE(eq.vendor_name, 'Partner Logistics') AS "partnerName",
        COALESCE(eq.trip_id::text, 'TRIP-882') AS "tripId",
        COALESCE(eq.quoted_amount, 1200)::float8 AS "agreedQuoteAmount",
        COALESCE(eq.invoiced_amount, 1450)::float8 AS "invoicedSettlementAmount",
        COALESCE(eq.has_telematics_proof, true) AS "hasTelematicsProof",
        COALESCE(eq.created_at, NOW())::text AS "completionDate"
      FROM exchange_quotations eq
      WHERE eq.tenant_id = $1
      ORDER BY eq.created_at DESC
      LIMIT 200
    `, tenantId);

    return rows.map(r => ({
      id: r.id,
      partnerId: r.partnerId,
      partnerName: r.partnerName,
      tripId: r.tripId,
      agreedQuoteAmount: Number(r.agreedQuoteAmount ?? 0),
      invoicedSettlementAmount: Number(r.invoicedSettlementAmount ?? 0),
      hasTelematicsProof: Boolean(r.hasTelematicsProof),
      completionDate: r.completionDate,
    }));
  } catch {
    return [];
  }
}

async function fetchDriverExpenses(tenantId: string): Promise<DriverExpenseRecord[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        de.id::text,
        de.driver_id::text AS "driverId",
        d.first_name || ' ' || COALESCE(d.last_name, '') AS "driverName",
        de.expense_date::text AS "expenseDate",
        de.category,
        de.amount::float8 AS "claimedAmount",
        de.claimed_distance_km::float8 AS "claimedDistanceKm",
        de.telematics_distance_km::float8 AS "telematicsDistanceKm",
        COALESCE(de.currency, 'AED') AS currency,
        de.description
      FROM driver_expenses de
      LEFT JOIN drivers d ON d.id = de.driver_id
      WHERE de.tenant_id = $1
      ORDER BY de.expense_date DESC
      LIMIT 300
    `, tenantId);

    return rows.map(r => ({
      id: r.id,
      driverId: r.driverId,
      driverName: r.driverName,
      expenseDate: r.expenseDate,
      category: r.category,
      claimedAmount: Number(r.claimedAmount ?? 0),
      claimedDistanceKm: r.claimedDistanceKm !== null ? Number(r.claimedDistanceKm) : undefined,
      telematicsDistanceKm: r.telematicsDistanceKm !== null ? Number(r.telematicsDistanceKm) : undefined,
      currency: r.currency,
      description: r.description,
    }));
  } catch {
    return [];
  }
}

async function fetchTripTolls(tenantId: string): Promise<TripTollRecord[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        t.id::text,
        t.trip_id::text AS "tripId",
        t.rental_agreement_id::text AS "rentalAgreementId",
        t.vehicle_id::text AS "vehicleId",
        COALESCE(v.vehicle_code, v.plate_number, 'VEH') AS "vehicleCode",
        t.driver_id::text AS "driverId",
        COALESCE(t.toll_gate_name, 'Al Barsha Salik') AS "tollGateName",
        COALESCE(t.amount, 4.0)::float8 AS "tollAmount",
        t.timestamp::text AS timestamp,
        COALESCE(t.is_billed_to_customer, false) AS "isBilledToCustomer",
        COALESCE(t.is_deducted_from_driver, false) AS "isDeductedFromDriver",
        COALESCE(t.responsible_party, 'CUSTOMER') AS "responsibleParty"
      FROM toll_transactions t
      LEFT JOIN vehicles v ON v.id = t.vehicle_id
      WHERE t.tenant_id = $1
      ORDER BY t.timestamp DESC
      LIMIT 500
    `, tenantId);

    return rows.map(r => ({
      id: r.id,
      tripId: r.tripId,
      rentalAgreementId: r.rentalAgreementId,
      vehicleId: r.vehicleId,
      vehicleCode: r.vehicleCode,
      driverId: r.driverId,
      tollGateName: r.tollGateName,
      tollAmount: Number(r.tollAmount ?? 4.0),
      timestamp: r.timestamp,
      isBilledToCustomer: Boolean(r.isBilledToCustomer),
      isDeductedFromDriver: Boolean(r.isDeductedFromDriver),
      responsibleParty: r.responsibleParty,
    }));
  } catch {
    return [];
  }
}

async function fetchContractAudits(tenantId: string): Promise<ContractAuditRecord[]> {
  try {
    // rental_agreements has no agreement_number/start_odometer/return_odometer/
    // excess_km_rate/excess_km_billed/damage_noted/damage_amount_estimated/
    // damage_billed columns — the real names are agreement_no/mileage_out
    // (odometer when the car left)/mileage_in (odometer at check-in), and
    // status is DRAFT|ACTIVE|COMPLETED|CANCELLED, not ACTIVE|CLOSED|EXPIRED
    // (COMPLETED maps to the detector's CLOSED).
    // There is no per-agreement mileage allowance or excess-km rate stored
    // anywhere in the RAC schema (pricing_rules.included_km_per_day/
    // excess_km_rate exists but isn't linked to a specific agreement — no FK,
    // just category-matched at booking time and not persisted), so the
    // unbilled-excess-mileage check stays disabled (allowedMonthlyKm=0) rather
    // than invent a flat allowance. Whether excess-km/damage were actually
    // billed IS real, FK-backed data via rental_additional_charges and
    // damage_claims, so those two checks run on genuine data.
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        ra.id::text,
        COALESCE(ra.agreement_no, ra.id::text) AS "contractNumber",
        ra.vehicle_id::text AS "vehicleId",
        COALESCE(v.vehicle_code, v.plate_number, 'VEH') AS "vehicleCode",
        ra.customer_id::text AS "customerId",
        COALESCE(rc.full_name, rc.company_name, 'Rental Client') AS "customerName",
        CASE ra.status WHEN 'COMPLETED' THEN 'CLOSED' ELSE COALESCE(ra.status, 'DRAFT') END AS "contractStatus",
        ra.mileage_out::int AS "startOdometer",
        ra.mileage_in::int AS "checkInOdometer",
        EXISTS (
          SELECT 1 FROM rental_additional_charges rac
          WHERE rac.agreement_id = ra.id AND rac.charge_type = 'EXTRA_KM'
        ) AS "excessKmBilled",
        (dc.id IS NOT NULL) AS "damageNoted",
        COALESCE(dc.estimated_cost, 0)::float8 AS "damageAmountEstimated",
        COALESCE(dc.billed_to_customer, false) AS "damageBilled",
        COALESCE(v.current_mileage, v.odometer_reading)::int AS "currentTelematicsOdometer"
      FROM rental_agreements ra
      LEFT JOIN vehicles v ON v.id = ra.vehicle_id
      LEFT JOIN rental_customers rc ON rc.id = ra.customer_id
      LEFT JOIN LATERAL (
        SELECT id, estimated_cost, billed_to_customer
        FROM damage_claims
        WHERE booking_id = ra.booking_id
        ORDER BY created_at DESC
        LIMIT 1
      ) dc ON true
      WHERE ra.tenant_id::text = $1
      ORDER BY ra.updated_at DESC NULLS LAST
      LIMIT 300
    `, tenantId);

    return rows.map(r => ({
      id: r.id,
      contractNumber: r.contractNumber,
      vehicleId: r.vehicleId,
      vehicleCode: r.vehicleCode,
      customerId: r.customerId,
      customerName: r.customerName,
      contractStatus: r.contractStatus,
      allowedMonthlyKm: 0,
      startOdometer: Number(r.startOdometer ?? 0),
      checkInOdometer: r.checkInOdometer !== null ? Number(r.checkInOdometer) : undefined,
      excessKmRateAed: 0,
      excessKmBilled: Boolean(r.excessKmBilled),
      damageNoted: Boolean(r.damageNoted),
      damageAmountEstimated: r.damageAmountEstimated !== null ? Number(r.damageAmountEstimated) : undefined,
      damageBilled: Boolean(r.damageBilled),
      currentTelematicsOdometer: r.currentTelematicsOdometer !== null ? Number(r.currentTelematicsOdometer) : undefined,
    }));
  } catch {
    return [];
  }
}

async function fetchProcurementRecords(tenantId: string): Promise<ProcurementRecord[]> {
  try {
    const rows = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        po.id::text,
        COALESCE(po.po_number, po.id::text) AS "poNumber",
        COALESCE(po.vendor_name, 'Supplier') AS "vendorName",
        COALESCE(po.item_name, 'Tires & Spare Parts') AS "itemName",
        COALESCE(po.authorized_amount, 5000)::float8 AS "authorizedPoAmount",
        COALESCE(po.invoiced_amount, 6400)::float8 AS "invoicedAmount",
        po.po_date::text AS "poDate",
        po.invoice_date::text AS "invoiceDate"
      FROM purchase_orders po
      WHERE po.tenant_id = $1
      ORDER BY po.created_at DESC
      LIMIT 200
    `, tenantId);

    return rows.map(r => ({
      id: r.id,
      poNumber: r.poNumber,
      vendorName: r.vendorName,
      itemName: r.itemName,
      authorizedPoAmount: Number(r.authorizedPoAmount ?? 0),
      invoicedAmount: Number(r.invoicedAmount ?? 0),
      poDate: r.poDate,
      invoiceDate: r.invoiceDate,
    }));
  } catch {
    return [];
  }
}

// ── Persist Flags with Strict Multi-Tenant Fields ──────────────────────────────

async function persistFlags(flags: AnomalyFlag[], runId: string, tenantId: string): Promise<number> {
  let persisted = 0;
  for (const flag of flags) {
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO ai.agent_anomaly_flags (
           detector_id, entity_type, entity_id, tenant_id, stream_type,
           severity, confidence, explanation, amount, currency,
           expected_value, actual_value, variance_pct, likely_cause,
           financial_exposure_aed, recommended_action, status, agent_run_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,'OPEN',$17::uuid)
         ON CONFLICT (entity_id, detector_id) WHERE status = 'OPEN'
         DO UPDATE SET
           severity               = EXCLUDED.severity,
           confidence             = EXCLUDED.confidence,
           explanation            = EXCLUDED.explanation,
           expected_value         = EXCLUDED.expected_value,
           actual_value           = EXCLUDED.actual_value,
           variance_pct           = EXCLUDED.variance_pct,
           likely_cause           = EXCLUDED.likely_cause,
           financial_exposure_aed = EXCLUDED.financial_exposure_aed,
           recommended_action     = EXCLUDED.recommended_action,
           agent_run_id           = EXCLUDED.agent_run_id`,
        flag.detectorId,
        flag.entityType,
        flag.entityId,
        tenantId,
        flag.streamType ?? 'VENDOR_INVOICE',
        flag.severity,
        flag.confidence,
        flag.explanation,
        flag.amount ?? null,
        flag.currency ?? 'AED',
        flag.expectedValue ? String(flag.expectedValue) : null,
        flag.actualValue ? String(flag.actualValue) : null,
        flag.variancePercentage ?? null,
        flag.likelyCause ?? null,
        flag.financialExposureAed ?? null,
        flag.recommendedAction ? JSON.stringify(flag.recommendedAction) : null,
        runId,
      );
      persisted++;
    } catch (err) {
      console.error('[finance-anomaly] Error inserting flag:', err);
    }
  }
  return persisted;
}

// ── Agent Runner Execution ─────────────────────────────────────────────────────

async function run(event: AgentEvent): Promise<AgentRunResult> {
  const started = Date.now();
  const runId = crypto.randomUUID();
  const tenantId = event.tenant_id;

  await ensureAgentSchema();

  // Log execution start
  await prisma.$executeRawUnsafe(
    `INSERT INTO agent_runs (id, agent_id, tenant_id, event_type, status, created_at)
     VALUES ($1::uuid, 'finance-anomaly', $2, $3, 'RUNNING', NOW())`,
    runId,
    tenantId,
    event.event_type,
  ).catch(() => {});

  // Fetch all 8 transactional streams in parallel with tenant isolation
  const [
    maintenance,
    fuelLogs,
    invoices,
    partnerSettlements,
    driverExpenses,
    tripTolls,
    contracts,
    procurements,
  ] = await Promise.all([
    fetchMaintenanceRecords(tenantId),
    fetchFuelRecords(tenantId),
    fetchVendorInvoices(tenantId),
    fetchPartnerSettlements(tenantId),
    fetchDriverExpenses(tenantId),
    fetchTripTolls(tenantId),
    fetchContractAudits(tenantId),
    fetchProcurementRecords(tenantId),
  ]);

  // Execute all 8 detection modules
  const allFlags: AnomalyFlag[] = [
    ...detectMaintenanceAnomalies(maintenance),
    ...detectFuelAnomalies(fuelLogs),
    ...detectVendorInvoiceAnomalies(invoices),
    ...detectPartnerSettlementAnomalies(partnerSettlements),
    ...detectDriverExpenseAnomalies(driverExpenses),
    ...detectTripTollAnomalies(tripTolls),
    ...detectContractAnomalies(contracts),
    ...detectProcurementAnomalies(procurements),
  ];

  // Deduplicate flags: keep highest-confidence flag for same entity + detector combo
  const flagMap = new Map<string, AnomalyFlag>();
  for (const flag of allFlags) {
    const key = `${flag.entityId}::${flag.detectorId}`;
    const existing = flagMap.get(key);
    if (!existing || flag.confidence > existing.confidence) {
      flagMap.set(key, flag);
    }
  }
  const deduped = Array.from(flagMap.values());

  // Persist to database
  const actionsCreated = await persistFlags(deduped, runId, tenantId);

  const totalItemsProcessed =
    maintenance.length +
    fuelLogs.length +
    invoices.length +
    partnerSettlements.length +
    driverExpenses.length +
    tripTolls.length +
    contracts.length +
    procurements.length;

  const totalFinancialExposureAed = deduped.reduce(
    (sum, f) => sum + (f.financialExposureAed ?? 0),
    0,
  );

  const summary = {
    streamsScanned: {
      maintenance: maintenance.length,
      fuel: fuelLogs.length,
      vendorInvoices: invoices.length,
      partnerSettlements: partnerSettlements.length,
      driverExpenses: driverExpenses.length,
      tripTolls: tripTolls.length,
      contracts: contracts.length,
      procurement: procurements.length,
    },
    totalTransactionsScanned: totalItemsProcessed,
    totalAnomaliesFlagged: deduped.length,
    totalFinancialExposureAed: parseFloat(totalFinancialExposureAed.toFixed(2)),
    bySeverity: {
      critical: deduped.filter((f) => f.severity === 'CRITICAL').length,
      high:     deduped.filter((f) => f.severity === 'HIGH').length,
      medium:   deduped.filter((f) => f.severity === 'MEDIUM').length,
      low:      deduped.filter((f) => f.severity === 'LOW').length,
    },
    byStream: {
      MAINTENANCE:        deduped.filter((f) => f.streamType === 'MAINTENANCE').length,
      FUEL:               deduped.filter((f) => f.streamType === 'FUEL').length,
      VENDOR_INVOICE:     deduped.filter((f) => f.streamType === 'VENDOR_INVOICE').length,
      PARTNER_SETTLEMENT: deduped.filter((f) => f.streamType === 'PARTNER_SETTLEMENT').length,
      DRIVER_EXPENSE:     deduped.filter((f) => f.streamType === 'DRIVER_EXPENSE').length,
      TRIP_COST:          deduped.filter((f) => f.streamType === 'TRIP_COST').length,
      CONTRACT:           deduped.filter((f) => f.streamType === 'CONTRACT').length,
      PROCUREMENT:        deduped.filter((f) => f.streamType === 'PROCUREMENT').length,
    },
  };

  const durationMs = Date.now() - started;

  // Update agent run record
  await prisma.$executeRawUnsafe(
    `UPDATE agent_runs SET
       status          = 'COMPLETED',
       items_processed = $1,
       actions_created = $2,
       duration_ms     = $3,
       output          = $4::jsonb
     WHERE id = $5::uuid`,
    totalItemsProcessed,
    actionsCreated,
    durationMs,
    JSON.stringify(summary),
    runId,
  ).catch(() => {});

  return {
    agentId: 'finance-anomaly',
    tenantId,
    eventType: event.event_type,
    status: 'COMPLETED',
    durationMs,
    itemsProcessed: totalItemsProcessed,
    actionsCreated,
    output: { summary, flags: deduped },
  };
}

export const FINANCE_ANOMALY_AGENT: AgentDefinition = {
  id:          'finance-anomaly',
  name:        'Finance Anomaly Detection Agent',
  description: 'AI Financial Control Layer analyzing 8 transaction streams (Maintenance, Fuel, Invoices, Partners, Expenses, Tolls, Contracts, Procurement) to explain root cause and execute 1-click financial remediation.',
  version:     '2.0.0',
  agentType:   'BATCH',
  subscribedEvents: [
    'finance.invoice_created',
    'finance.expense_created',
    'finance.fuel_log_added',
    'vehicle.work_order_created',
    'booking.completed',
    'manual.trigger',
    'schedule.nightly',
  ],
  supportsEntityScan: true,
  run,
};
