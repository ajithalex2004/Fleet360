/**
 * Drop-in: after each successful domain maintenance publish, call:
 *
 *   pushMaintenanceUi(tenantId, { eventType, requestId, vehicleId });
 *
 * Or use publishMaintenanceDomainAndUi() below from new call sites.
 */

import { notifyMaintenanceChanged } from '@/lib/realtime/publish';

export function pushMaintenanceUi(tenantId: string, payload: Record<string, unknown>) {
  try {
    notifyMaintenanceChanged(tenantId, payload);
  } catch (e) {
    console.warn('[maintenance-ui-push]', e);
  }
}
