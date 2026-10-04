import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import type { DomainEventEnvelope } from '@/events/event-envelope';
import { resolveModuleKey } from '@/lib/modules';

import { defaultRules, RIDER_EVENTS, RIDER_CHANNELS, type RiderRule } from './rider-notification-defaults';
export { defaultRules, RIDER_EVENTS, RIDER_CHANNELS, type RiderRule } from './rider-notification-defaults';
export function validateRiderRule(value: unknown): value is RiderRule {
 if (!value || typeof value !== 'object') return false;
 const v = value as RiderRule;
 return RIDER_EVENTS.includes(v.event_type as typeof RIDER_EVENTS[number]) && typeof v.enabled === 'boolean'
  && Array.isArray(v.channels) && v.channels.length > 0 && v.channels.length <= 3
  && new Set(v.channels).size === v.channels.length && v.channels.every(c => RIDER_CHANNELS.includes(c as typeof RIDER_CHANNELS[number]))
  && typeof v.subject === 'string' && v.subject.trim().length > 0 && v.subject.length <= 200
  && typeof v.body === 'string' && v.body.trim().length > 0 && v.body.length <= 2000;
}
export async function riderTenantEnabled(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
 const tenant = await tx.tenant.findUnique({ where: { id: tenantId }, include: { modules: true } });
 return tenant?.isActive === true && tenant.modules.some(m => m.isEnabled && resolveModuleKey(m.module) === 'bus-ops');
}
export async function loadRiderRules(tx: Prisma.TransactionClient, tenantId: string): Promise<RiderRule[]> {
 const saved = await tx.$queryRaw<RiderRule[]>`SELECT event_type,enabled,channels,subject,body FROM bus_rider_notification_rules WHERE tenant_id=${tenantId}`;
 return defaultRules.map(rule => saved.find(s => s.event_type === rule.event_type) ?? rule);
}
function render(template: string, data: Record<string,unknown>): string {
 return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
  const value = data[key]; return ['string','number','boolean'].includes(typeof value) ? String(value) : '';
 });
}
/** Atomically fan out only to live tenant-owned employee records. Replays use a durable unique key. */
export async function enqueueRiderNotifications(tx: Prisma.TransactionClient, event: DomainEventEnvelope<unknown>): Promise<number> {
 if (event.sourceModule !== 'bus-ops' || !RIDER_EVENTS.includes(event.eventType as typeof RIDER_EVENTS[number])) return 0;
 if (!event.data || typeof event.data !== 'object') throw new Error('Invalid rider event');
 const data = event.data as Record<string,unknown>;
 if (typeof data.scheduleId !== 'string' || data.scheduleId !== event.aggregateId) throw new Error('Invalid trip scope');
 if (!await riderTenantEnabled(tx, event.tenantId)) return 0;
 const rule = (await loadRiderRules(tx,event.tenantId)).find(r => r.event_type === event.eventType && r.enabled);
 if (!rule) return 0;
 const schedule = await tx.tripSchedule.findFirst({where:{id:data.scheduleId,tenantId:event.tenantId,deletedAt:null}});
 if (!schedule) return 0;
 const scope: Prisma.TripPassengerWhereInput = {tenantId:event.tenantId,tripId:schedule.id,deletedAt:null};
 if (event.eventType === 'boarding.missed') {
  if (typeof data.passengerId !== 'string') throw new Error('Missing passenger scope');
  scope.id = data.passengerId; scope.status = 'ABSENT';
 } else if (event.eventType === 'trip.arriving') {
  if (typeof data.stopId !== 'string') return 0;
  scope.boardingStopId = data.stopId; scope.status = 'CONFIRMED';
 } else if (event.eventType === 'trip.completed') { scope.status = {in:['BOARDED','ALIGHTED']};
 } else { scope.status = {in:['CONFIRMED','BOARDED']}; }
 const passengers = await tx.tripPassenger.findMany({where:scope});
 const staffIds = passengers.flatMap(p => p.staffMemberId ? [p.staffMemberId] : []);
 const staff = await tx.staffMember.findMany({where:{id:{in:staffIds},tenantId:event.tenantId,isActive:true,deletedAt:null}});
 const occurred = Date.parse(event.occurredAt);
 if (!Number.isFinite(occurred)) throw new Error('Invalid event timestamp');
 const ttl = event.eventType === 'trip.arriving' ? 15*60_000 : event.eventType === 'trip.delayed' ? 60*60_000 : 24*60*60_000;
 const expires = new Date(occurred + ttl);
 if (expires.getTime() <= Date.now()) return 0;
 let queued = 0;
 for (const passenger of passengers) {
  const employee = staff.find(s => s.id === passenger.staffMemberId);
  if (!employee) continue;
  const vars = {...data,tripNumber:schedule.tripNumber ?? schedule.id,passengerName:employee.name};
  for (const channel of rule.channels) {
   const recipient = channel === 'EMAIL' ? employee.email : employee.contactNumber;
   if (!recipient?.trim()) continue;
   queued += await tx.$executeRaw`INSERT INTO bus_rider_deliveries
    (id,tenant_id,event_id,event_type,schedule_id,passenger_id,staff_member_id,channel,recipient,subject,body,expires_at)
    VALUES(${randomUUID()},${event.tenantId},${event.eventId},${event.eventType},${schedule.id},${passenger.id},${employee.id},${channel},${recipient.trim()},${render(rule.subject,vars)},${render(rule.body,vars)},${expires})
    ON CONFLICT(tenant_id,event_id,passenger_id,channel) DO NOTHING`;
  }
 }
 return queued;
}
