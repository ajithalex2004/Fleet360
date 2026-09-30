/**
 * Emails to a shipment's customer contact (cargo_owner_email) at the
 * milestones they care about, in the tenant's wording (Admin > Email
 * templates > Logistics) and language.
 *
 *   APPROVED          logistics.shipment_confirmed
 *   DISPATCHED        logistics.shipment_dispatched
 *   ENROUTE_DELIVERY  logistics.out_for_delivery
 *   DELIVERED         logistics.shipment_delivered
 *   CANCELLED         logistics.shipment_cancelled
 *   proof of delivery logistics.proof_of_delivery
 *
 * Replies go to the tenant's contact email. Runs detached from the caller's
 * transaction, as the tenant, and never throws: a failed email never fails
 * a shipment update.
 */
import 'server-only';
import { prisma } from '@/lib/prisma';
import { runAsTenant, runOutsideRlsScope } from '@/lib/rls-scope';
import { appUrl, sendTemplatedEmail, tenantEmailContext } from '@/lib/email-templates';
import { tenantContact } from '@/lib/tenant-contact';
import type { EmailLocale } from '@/lib/email-templates/catalogue';

export const MILESTONE_TEMPLATE: Record<string, string> = {
  APPROVED: 'logistics.shipment_confirmed',
  DISPATCHED: 'logistics.shipment_dispatched',
  ENROUTE_DELIVERY: 'logistics.out_for_delivery',
  DELIVERED: 'logistics.shipment_delivered',
  CANCELLED: 'logistics.shipment_cancelled',
};
export const POD_TEMPLATE = 'logistics.proof_of_delivery';

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

interface ShipmentForEmail {
  shipment_no: string | null;
  cargo_owner_name: string | null;
  cargo_owner_email: string | null;
  origin_name: string | null;
  destination_name: string | null;
  assigned_driver_id: string | null;
  assigned_vehicle_id: string | null;
  eta_at: string | null;
}

/** "30 Sep 2026, 14:42 GST" (UAE time), or the Arabic equivalent. */
export function formatGst(value: Date | string, locale: EmailLocale): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const text = d.toLocaleString(locale === 'ar' ? 'ar-AE' : 'en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Dubai',
  });
  return `${text} GST`;
}

async function loadShipment(shipmentOrderId: string): Promise<ShipmentForEmail | null> {
  const rows = await prisma.$queryRawUnsafe<Array<Omit<ShipmentForEmail, 'eta_at'>>>(
    `SELECT shipment_no, cargo_owner_name, cargo_owner_email, origin_name, destination_name,
            assigned_driver_id, assigned_vehicle_id
       FROM logistics_shipment_orders
      WHERE id = $1 AND deleted_at IS NULL
      LIMIT 1`,
    shipmentOrderId,
  );
  if (!rows[0]) return null;
  // The latest ETA, when telematics has one (the table may be absent).
  const eta = await prisma.$queryRawUnsafe<Array<{ eta_at: string | null }>>(
    `SELECT eta_at::text FROM logistics_telematics_events
      WHERE shipment_order_id = $1 AND eta_at IS NOT NULL
      ORDER BY event_time DESC LIMIT 1`,
    shipmentOrderId,
  ).catch(() => []);
  return { ...rows[0], eta_at: eta[0]?.eta_at ?? null };
}

async function driverAndVehicle(s: ShipmentForEmail) {
  const [driver, vehicle] = await Promise.all([
    s.assigned_driver_id
      ? prisma.driver.findUnique({ where: { id: s.assigned_driver_id }, select: { name: true, firstName: true, lastName: true } }).catch(() => null)
      : null,
    s.assigned_vehicle_id
      ? prisma.vehicle.findUnique({ where: { id: s.assigned_vehicle_id }, select: { licensePlate: true } }).catch(() => null)
      : null,
  ]);
  return {
    driverName: driver?.name || [driver?.firstName, driver?.lastName].filter(Boolean).join(' ') || '',
    vehiclePlate: vehicle?.licensePlate ?? '',
  };
}

/** Runs `fn` for the tenant, off the caller's transaction; logs instead of throwing. */
function detached(tenantId: string, what: string, fn: () => Promise<void>): Promise<void> {
  return runOutsideRlsScope(() => runAsTenant(tenantId, fn)).catch((e) => {
    console.warn(`[logistics] ${what} email failed:`, e instanceof Error ? e.message : e);
  });
}

async function sendToCustomer(tenantId: string, key: string, s: ShipmentForEmail, values: (l: EmailLocale) => Record<string, string>) {
  const to = s.cargo_owner_email?.trim().toLowerCase();
  if (!to || !EMAIL_RE.test(to)) return;
  const [context, contact] = await Promise.all([tenantEmailContext(tenantId), tenantContact(tenantId)]);
  await sendTemplatedEmail({
    tenantId,
    key,
    context,
    to,
    ...(contact ? { replyTo: contact.email } : {}),
    values: (l) => ({
      customerName: s.cargo_owner_name ?? '',
      shipmentNo: s.shipment_no ?? '',
      origin: s.origin_name ?? '',
      destination: s.destination_name ?? '',
      portalUrl: appUrl('/shipper-portal/shipments'),
      ...values(l),
    }),
  });
}

/**
 * Emails the customer when a shipment reaches `status` (a milestone listed
 * above; other statuses send nothing). `reason` is used for cancellations.
 */
export function notifyShipmentStatus(args: {
  tenantId: string; shipmentOrderId: string; status: string; reason?: string | null;
}): Promise<void> {
  const key = MILESTONE_TEMPLATE[args.status];
  if (!key) return Promise.resolve();
  return detached(args.tenantId, key, async () => {
    const s = await loadShipment(args.shipmentOrderId);
    if (!s) return;
    const extra = args.status === 'DISPATCHED' ? await driverAndVehicle(s) : {};
    await sendToCustomer(args.tenantId, key, s, (l) => ({
      ...extra,
      etaTime: s.eta_at ? formatGst(s.eta_at, l) : '',
      reason: args.reason?.trim() ?? '',
    }));
  });
}

/** Emails the customer the proof of delivery just recorded. */
export function notifyProofOfDelivery(args: {
  tenantId: string; shipmentOrderId: string;
  recipientName: string; deliveredAt: Date | string; note?: string | null; attachmentCount: number;
}): Promise<void> {
  return detached(args.tenantId, POD_TEMPLATE, async () => {
    const s = await loadShipment(args.shipmentOrderId);
    if (!s) return;
    await sendToCustomer(args.tenantId, POD_TEMPLATE, s, (l) => ({
      recipientName: args.recipientName,
      deliveredAt: formatGst(args.deliveredAt, l),
      deliveryNote: args.note?.trim() ?? '',
      attachmentCount: String(args.attachmentCount),
    }));
  });
}
