/**
 * Vehicle 360 & Customer 360 Context Aggregation Engine (Pillar 3 - P1)
 *
 * Aggregates:
 *   1. Vehicle Health & Telematics: Status, Fuel Level, Odometer, Mulkiya Expiry, Live Location
 *   2. Driver & Contract Context: Active Driver Name/Phone, Customer/Lessee Name, Booking Reference
 *   3. 90-Day Incident History: Last 3 service tickets for this vehicle
 *   4. Chronic Defect & Lemon Risk Detection
 */

import { prisma } from '@/lib/prisma';

export interface ChronicRiskEvaluation {
  isChronicRisk: boolean;
  ticketCount90Days: number;
  recurringCategories: string[];
  riskSeverity: 'NONE' | 'MODERATE' | 'CRITICAL_LEMON';
  riskMessage?: string;
}

export interface TicketContext360Data {
  ticket: {
    id: string;
    readableId: string | null;
    ticketType: string;
    title: string;
    description: string;
    priority: string;
    status: string;
    createdAt: string;
    requestorId: string;
    requestorName: string | null;
  };
  vehicle: {
    id: string;
    licensePlate: string | null;
    make: string | null;
    model: string | null;
    year: number | null;
    status: string | null;
    fuelLevel: number | null;
    odometerReading: number | null;
    vehicleUsage: string | null;
    vin: string | null;
    mulkiyaExpiry: string | null;
    locationAddress: string | null;
  } | null;
  driver: {
    id: string | null;
    name: string | null;
    phone: string | null;
    email: string | null;
    licenseExpiry: string | null;
  } | null;
  contract: {
    bookingRef: string | null;
    serviceType: string | null;
    status: string | null;
    startDate: string | null;
    endDate: string | null;
    customerName: string | null;
    customerEmail: string | null;
  } | null;
  recentTickets: Array<{
    id: string;
    readableId: string | null;
    ticketType: string;
    title: string;
    status: string;
    priority: string;
    createdAt: string;
    category?: string;
  }>;
  chronicRisk: ChronicRiskEvaluation;
}

/**
 * Evaluates chronic lemon / defect risk based on 90-day ticket history
 */
export function detectChronicDefectRisk(
  recentTickets: Array<{
    ticketType: string;
    createdAt: string | Date;
    category?: string;
  }>
): ChronicRiskEvaluation {
  const count = recentTickets.length;
  if (count === 0) {
    return {
      isChronicRisk: false,
      ticketCount90Days: 0,
      recurringCategories: [],
      riskSeverity: 'NONE',
    };
  }

  // Count occurrences of each category / type
  const categoryCounts: Record<string, number> = {};
  for (const t of recentTickets) {
    const key = (t.category || t.ticketType).toUpperCase();
    categoryCounts[key] = (categoryCounts[key] || 0) + 1;
  }

  const recurringCategories = Object.entries(categoryCounts)
    .filter(([, cnt]) => cnt >= 2)
    .map(([cat]) => cat);

  let riskSeverity: ChronicRiskEvaluation['riskSeverity'] = 'NONE';
  let riskMessage: string | undefined;

  if (count >= 3 || recurringCategories.length > 0) {
    if (
      count >= 4 ||
      recurringCategories.some((c) =>
        ['ENGINE_OVERHEAT', 'BRAKES_SUSPENSION', 'TOWING', 'INCIDENT'].includes(c)
      )
    ) {
      riskSeverity = 'CRITICAL_LEMON';
      riskMessage = `🚨 Critical Chronic Defect: ${count} incidents in 90 days (Recurring: ${recurringCategories.join(', ') || 'High frequency breakdown'}). Recommend immediate fleet garage audit.`;
    } else {
      riskSeverity = 'MODERATE';
      riskMessage = `⚠️ Elevated Maintenance Frequency: ${count} tickets logged in the past 90 days.`;
    }
  }

  return {
    isChronicRisk: riskSeverity !== 'NONE',
    ticketCount90Days: count,
    recurringCategories,
    riskSeverity,
    riskMessage,
  };
}

/**
 * Aggregates full 360-degree context for a given service ticket
 */
export async function fetchTicketContext360(
  ticketId: string,
  tenantId: string
): Promise<TicketContext360Data | null> {
  // 1. Fetch Ticket
  const [ticketRow] = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      readable_id: string | null;
      ticket_type: string;
      title: string;
      description: string;
      priority: string;
      status: string;
      created_at: string;
      requestor_id: string;
      requestor_name: string | null;
      vehicle_id: string | null;
      related_driver_id: string | null;
      custom_fields: Record<string, unknown>;
    }>
  >(
    `SELECT id, readable_id, ticket_type, title, description, priority, status,
            created_at, requestor_id, requestor_name, vehicle_id, related_driver_id,
            custom_fields
     FROM service_tickets
     WHERE id = $1::uuid AND tenant_id = $2 AND deleted_at IS NULL`,
    ticketId,
    tenantId
  );

  if (!ticketRow) {
    return null;
  }

  // 2. Fetch Vehicle Telematics (if linked)
  let vehicleData: TicketContext360Data['vehicle'] = null;
  if (ticketRow.vehicle_id) {
    const v = await prisma.vehicle.findFirst({
      where: {
        id: ticketRow.vehicle_id,
        tenantId,
        deletedAt: null,
      },
      select: {
        id: true,
        licensePlate: true,
        make: true,
        model: true,
        year: true,
        status: true,
        fuelLevel: true,
        odometerReading: true,
        vehicleUsage: true,
        vin: true,
      },
    });

    if (v) {
      vehicleData = {
        id: v.id,
        licensePlate: v.licensePlate,
        make: v.make,
        model: v.model,
        year: v.year ? Number(v.year) : null,
        // Only real registry values — missing data stays null so the drawer
        // shows "—" rather than plausible-looking placeholders.
        status: v.status ?? null,
        fuelLevel: v.fuelLevel ?? null,
        odometerReading: v.odometerReading != null ? Number(v.odometerReading) : null,
        vehicleUsage: v.vehicleUsage ?? null,
        vin: v.vin ?? null,
        mulkiyaExpiry: null, // not held on the vehicle record
        locationAddress: null, // no live GPS feed wired into this view
      };
    }
  }

  // 3. Driver / requester context — what the ticket itself knows. Contact
  // details are only shown when the ticket carries them (e.g. WhatsApp intake).
  let driverData: TicketContext360Data['driver'] = null;
  const driverSearchId = ticketRow.related_driver_id || ticketRow.requestor_id;
  if (driverSearchId) {
    const phone = ticketRow.custom_fields?.fromNumber;
    driverData = {
      id: driverSearchId,
      name: ticketRow.requestor_name ?? null,
      phone: typeof phone === 'string' && phone.trim() ? phone : null,
      email: null,
      licenseExpiry: null,
    };
  }

  // 4. Fetch Active Lease / Rental Contract
  let contractData: TicketContext360Data['contract'] = null;
  if (ticketRow.vehicle_id) {
    const booking = await prisma.booking.findFirst({
      where: {
        vehicleId: ticketRow.vehicle_id,
        status: { in: ['ACTIVE', 'CONFIRMED', 'APPROVED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        bookingRef: true,
        serviceType: true,
        status: true,
        startDate: true,
        endDate: true,
        requestorName: true,
        requestorEmail: true,
      },
    });

    if (booking) {
      contractData = {
        bookingRef: booking.bookingRef ?? null,
        serviceType: booking.serviceType ?? null,
        status: booking.status ?? null,
        startDate: booking.startDate ? booking.startDate.toISOString() : null,
        endDate: booking.endDate ? booking.endDate.toISOString() : null,
        customerName: booking.requestorName ?? null,
        customerEmail: booking.requestorEmail ?? null,
      };
    }
    // No active booking → no contract. (Previously a sample lease was
    // returned here, which read as a real customer.)
  }

  // 5. Fetch 90-Day Ticket History for this Vehicle
  let recentTickets: TicketContext360Data['recentTickets'] = [];
  if (ticketRow.vehicle_id) {
    const historyRows = await prisma.$queryRawUnsafe<
      Array<{
        id: string;
        readable_id: string | null;
        ticket_type: string;
        title: string;
        status: string;
        priority: string;
        created_at: string;
        custom_fields: Record<string, unknown>;
      }>
    >(
      `SELECT id, readable_id, ticket_type, title, status, priority, created_at, custom_fields
       FROM service_tickets
       WHERE tenant_id = $1
         AND vehicle_id = $2
         AND id != $3::uuid
         AND created_at >= NOW() - INTERVAL '90 days'
         AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT 3`,
      tenantId,
      ticketRow.vehicle_id,
      ticketId
    );

    recentTickets = historyRows.map((r) => ({
      id: r.id,
      readableId: r.readable_id,
      ticketType: r.ticket_type,
      title: r.title,
      status: r.status,
      priority: r.priority,
      createdAt: r.created_at,
      category: (r.custom_fields?.category as string) || r.ticket_type,
    }));
  }

  // 6. Detect Chronic Defect / Lemon Risk
  const chronicRisk = detectChronicDefectRisk(recentTickets);

  return {
    ticket: {
      id: ticketRow.id,
      readableId: ticketRow.readable_id,
      ticketType: ticketRow.ticket_type,
      title: ticketRow.title,
      description: ticketRow.description,
      priority: ticketRow.priority,
      status: ticketRow.status,
      createdAt: ticketRow.created_at,
      requestorId: ticketRow.requestor_id,
      requestorName: ticketRow.requestor_name,
    },
    vehicle: vehicleData,
    driver: driverData,
    contract: contractData,
    recentTickets,
    chronicRisk,
  };
}
