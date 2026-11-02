/**
 * src/lib/fleet/lifecycle-events.ts
 *
 * Automatic and manual vehicle lifecycle event recorder.
 * Tracks lifecycle stage transitions, status changes, driver assignments,
 * device pairing, and odometer updates against each fleet vehicle.
 */

export interface CreateLifecycleEventParams {
  vehicleId: string;
  eventType:
    | 'ACTIVATION'
    | 'STATUS_CHANGE'
    | 'STAGE_TRANSITION'
    | 'DRIVER_ALLOCATION'
    | 'DEVICE_PAIRING'
    | 'DEVICE_UNPAIRED'
    | 'ODOMETER_UPDATE'
    | 'DOCUMENT_UPDATE'
    | 'MAINTENANCE'
    | 'INSPECTION'
    | 'DECOMMISSIONED'
    | string;
  description: string;
  eventDate?: Date | string;
  fromStage?: string | null;
  toStage?: string | null;
  referenceNo?: string | null;
  performedBy?: string | null;
  cost?: number | null;
  metadata?: Record<string, unknown> | null;
  notes?: string | null;
}

export async function recordLifecycleEvent(
  tx: { $executeRawUnsafe: (query: string, ...values: unknown[]) => Promise<unknown> },
  params: CreateLifecycleEventParams
): Promise<void> {
  try {
    const id = crypto.randomUUID();
    const eventDate = params.eventDate
      ? new Date(params.eventDate).toISOString()
      : new Date().toISOString();
    const now = new Date().toISOString();

    await tx.$executeRawUnsafe(
      `INSERT INTO fleet_lifecycle_events (
        id, vehicle_id, event_type, event_date, description,
        reference_no, performed_by, from_stage, to_stage,
        cost, metadata, notes, created_at, updated_at
      ) VALUES (
        $1::uuid, $2, $3, $4::timestamptz, $5,
        $6, $7, $8, $9,
        $10::numeric, $11::jsonb, $12, $13::timestamptz, $14::timestamptz
      )`,
      id,
      params.vehicleId ? String(params.vehicleId) : null,
      params.eventType,
      eventDate,
      params.description,
      params.referenceNo ?? null,
      params.performedBy ?? 'System Automated',
      params.fromStage ?? null,
      params.toStage ?? null,
      params.cost != null ? String(params.cost) : null,
      params.metadata ? JSON.stringify(params.metadata) : null,
      params.notes ?? null,
      now,
      now,
    );
  } catch (err) {
    // Non-blocking lifecycle audit logger
    console.warn('[lifecycle-events] Failed to record lifecycle event:', err);
  }
}
