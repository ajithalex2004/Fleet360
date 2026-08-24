import { publishRealtime, RT_CHANNELS } from '@/lib/realtime/hub';

export function notifySchedulesChanged(tenantId: string, payload?: Record<string, unknown>) {
  publishRealtime({
    tenantId,
    channel: RT_CHANNELS.schedules,
    type: 'bus-ops.schedules.changed',
    payload,
  });
}

export function notifyIncidentsChanged(tenantId: string, payload?: Record<string, unknown>) {
  publishRealtime({
    tenantId,
    channel: RT_CHANNELS.incidents,
    type: 'bus-ops.incidents.changed',
    payload,
  });
}

export function notifyScheduleTemplatesChanged(tenantId: string, payload?: Record<string, unknown>) {
  publishRealtime({
    tenantId,
    channel: RT_CHANNELS.scheduleTemplates,
    type: 'bus-ops.schedule-templates.changed',
    payload,
  });
}

export function notifyDriversChanged(tenantId: string, payload?: Record<string, unknown>) {
  publishRealtime({
    tenantId,
    channel: RT_CHANNELS.drivers,
    type: 'bus-ops.drivers.changed',
    payload,
  });
}

/** Maintenance lists + Action Centre */
export function notifyMaintenanceChanged(tenantId: string, payload?: Record<string, unknown>) {
  publishRealtime({
    tenantId,
    channel: RT_CHANNELS.maintenance ?? 'maintenance:requests',
    type: 'maintenance.changed',
    payload,
  });
  publishRealtime({
    tenantId,
    channel: RT_CHANNELS.maintenanceActionCentre ?? 'maintenance:action-centre',
    type: 'maintenance.action-centre.changed',
    payload,
  });
}
