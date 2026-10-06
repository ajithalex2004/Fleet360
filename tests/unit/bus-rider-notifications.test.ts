import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Prisma } from '@prisma/client';
import type { DomainEventEnvelope } from '@/events/event-envelope';
const mocks=vi.hoisted(()=>({email:vi.fn(),sms:vi.fn(),whatsapp:vi.fn(),platform:vi.fn(),tenant:vi.fn()}));
vi.mock('@/lib/email',()=>({sendEmail:mocks.email}));
vi.mock('@/lib/sms',()=>({sendSms:mocks.sms}));
vi.mock('@/lib/whatsapp',()=>({sendWhatsApp:mocks.whatsapp}));
vi.mock('@/lib/prisma',()=>({prisma:{}}));
vi.mock('@/lib/rls',()=>({withPlatformAdmin:mocks.platform,withTenantRls:mocks.tenant}));
import { enqueueRiderNotifications, validateRiderRule, defaultRules } from '@/lib/bus-ops/rider-notifications';
import { canSendRiderDelivery, claimRiderDeliveries, deliveryOutcome, finishRiderDelivery, runBusRiderNotifications, type RiderDelivery } from '@/lib/jobs/bus-rider-notifications';
const tenant='tenant-a';
const event:DomainEventEnvelope<unknown>={eventId:'e1',eventType:'trip.arriving',eventVersion:'1',occurredAt:new Date().toISOString(),tenantId:tenant,aggregateType:'TripSchedule',aggregateId:'trip-a',sourceModule:'bus-ops',correlationId:null,causationId:null,actor:null,data:{scheduleId:'trip-a',stopId:'stop-a',stopName:'Gate',minutesToArrival:3}};
const rule={...defaultRules.find(r=>r.event_type==='trip.arriving')!,enabled:true,channels:['EMAIL','SMS']};
function fixture(){return {
 busTripDisruption:{findFirst:vi.fn().mockResolvedValue({id:'disruption',status:'RECOVERED'})},
 tenant:{findUnique:vi.fn().mockResolvedValue({isActive:true,modules:[{isEnabled:true,module:'bus-ops'}]})},
 tripSchedule:{findFirst:vi.fn().mockResolvedValue({id:'trip-a',tripNumber:'T1',status:'EN_ROUTE'})},
 tripPassenger:{findMany:vi.fn().mockResolvedValue([{id:'rider-a',staffMemberId:'staff-a'}]),findFirst:vi.fn().mockResolvedValue({status:'CONFIRMED'})},
 staffMember:{findMany:vi.fn().mockResolvedValue([{id:'staff-a',name:'A',email:'a@example.test',contactNumber:'+971500000001'}]),findFirst:vi.fn().mockResolvedValue({email:'a@example.test'})},
 $queryRaw:vi.fn().mockResolvedValue([rule]),$executeRaw:vi.fn().mockResolvedValue(1),
};}
const asTx=(tx:ReturnType<typeof fixture>)=>tx as unknown as Prisma.TransactionClient;
const row:RiderDelivery={id:'d1',tenant_id:tenant,event_type:'trip.arriving',schedule_id:'trip-a',passenger_id:'rider-a',staff_member_id:'staff-a',channel:'EMAIL',recipient:'a@example.test',subject:'Update',body:'Approaching',attempts:1,claim_token:'claim1',expires_at:new Date(Date.now()+60_000)};
beforeEach(()=>{vi.clearAllMocks();});
describe('tenant rider fanout',()=>{
 it('resolves stop-specific passengers and employees using the event tenant',async()=>{
  const tx=fixture();expect(await enqueueRiderNotifications(asTx(tx),event)).toBe(2);
  expect(tx.tripPassenger.findMany).toHaveBeenCalledWith({where:{tenantId:tenant,tripId:'trip-a',deletedAt:null,boardingStopId:'stop-a',status:'CONFIRMED'}});
  expect(tx.staffMember.findMany).toHaveBeenCalledWith({where:{id:{in:['staff-a']},tenantId:tenant,isActive:true,deletedAt:null}});
  const insert=tx.$executeRaw.mock.calls[0];expect(insert[0].join('')).toContain('ON CONFLICT(tenant_id,event_id,passenger_id,channel) DO NOTHING');
  expect(insert).toContain('a@example.test');expect(insert).toContain('Your bus for trip T1 is approaching Gate in approximately 3 minutes.');
 });
 it('scopes missed boarding to one passenger',async()=>{
  const tx=fixture();tx.$queryRaw.mockResolvedValue([{...rule,event_type:'boarding.missed'}]);
  await enqueueRiderNotifications(asTx(tx),{...event,eventType:'boarding.missed',data:{scheduleId:'trip-a',passengerId:'rider-b'}});
  expect(tx.tripPassenger.findMany).toHaveBeenCalledWith({where:expect.objectContaining({tenantId:tenant,id:'rider-b',status:'ABSENT'})});
 });
 it('does not create another delivery on replay',async()=>{
  const tx=fixture();tx.$executeRaw.mockResolvedValue(0);
  expect(await enqueueRiderNotifications(asTx(tx),event)).toBe(0);
 });
 it('ignores other module events and rejects forged trip scope',async()=>{
  const tx=fixture();expect(await enqueueRiderNotifications(asTx(tx),{...event,sourceModule:'leasing'})).toBe(0);
  await expect(enqueueRiderNotifications(asTx(tx),{...event,data:{scheduleId:'other'}})).rejects.toThrow('Invalid trip scope');
  expect(tx.$executeRaw).not.toHaveBeenCalled();
 });
 it.each(['inactive tenant','disabled rule','missing employee','deleted trip','expired event'])('suppresses %s',async scenario=>{
  const tx=fixture();let ev=event;
  if(scenario==='inactive tenant')tx.tenant.findUnique.mockResolvedValue({isActive:false,modules:[]});
  if(scenario==='disabled rule')tx.$queryRaw.mockResolvedValue([]);
  if(scenario==='missing employee')tx.staffMember.findMany.mockResolvedValue([]);
  if(scenario==='deleted trip')tx.tripSchedule.findFirst.mockResolvedValue(null);
  if(scenario==='expired event')ev={...event,occurredAt:'2020-01-01T00:00:00Z'};
  expect(await enqueueRiderNotifications(asTx(tx),ev)).toBe(0);expect(tx.$executeRaw).not.toHaveBeenCalled();
 });
 it('starts opt-in and rejects unsupported channels and empty content',()=>{
  expect(defaultRules.every(r=>!r.enabled)).toBe(true);expect(validateRiderRule(rule)).toBe(true);
  expect(validateRiderRule({...rule,channels:['PUSH']})).toBe(false);expect(validateRiderRule({...rule,body:' '})).toBe(false);
 });
});
describe('sender claims and outcomes',()=>{
 it('claims only pending or due retry rows under row locks and parks stale senders',async()=>{
  const tx=fixture();await claimRiderDeliveries(asTx(tx),tenant);
  expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain('FOR UPDATE SKIP LOCKED');
  expect(tx.$queryRaw.mock.calls[0][0].join('')).toContain("status IN ('PENDING','RETRY')");
  expect(tx.$executeRaw.mock.calls[0][0].join('')).toContain("status='UNCERTAIN'");
 });
 it('revalidates tenant, passenger and unchanged recipient before sending',async()=>{
  const tx=fixture();expect(await canSendRiderDelivery(asTx(tx),row)).toBe(true);
  tx.staffMember.findFirst.mockResolvedValue({email:'changed@example.test'});
  expect(await canSendRiderDelivery(asTx(tx),row)).toBe(false);
  expect(tx.tripPassenger.findFirst).toHaveBeenCalledWith({where:expect.objectContaining({tenantId:tenant,tripId:'trip-a',id:'rider-a',staffMemberId:'staff-a'})});
 });
 it('does not send an approach after boarding or an expired message',async()=>{
  const tx=fixture();tx.tripPassenger.findFirst.mockResolvedValue({status:'BOARDED'});
  expect(await canSendRiderDelivery(asTx(tx),row)).toBe(false);
  expect(await canSendRiderDelivery(asTx(tx),{...row,expires_at:new Date(0)})).toBe(false);
 });
 it('uses the sender claim token when recording outcomes',async()=>{
  const tx=fixture();mocks.tenant.mockImplementation((_p,_t,fn)=>fn(asTx(tx)));
  await finishRiderDelivery(row,deliveryOutcome({sent:true,sid:'sid1'},1));
  const call=tx.$executeRaw.mock.calls[0];expect(call).toContain('claim1');expect(call[0].join('')).toContain("status='SENDING' AND claim_token=");
 });
 it('retries proven rate-limit failures with bounded backoff',()=>{
  expect(deliveryOutcome({sent:false,reason:'twilio_error',status:429},1)).toMatchObject({status:'RETRY',delaySeconds:60});
  expect(deliveryOutcome({sent:false,reason:'twilio_error',status:429},5).status).toBe('FAILED');
 });
 it.each(['network_error','transport_timeout','transport_exception'])('parks %s without retry',reason=>{
  expect(deliveryOutcome({sent:false,reason},1).status).toBe('UNCERTAIN');
 });
 it.each(['not_configured','quarantined_in_staging','no_phone'])('records %s as blocked, never sent',reason=>{
  expect(deliveryOutcome({sent:false,reason},1).status).toBe('BLOCKED');
 });
 it('preserves provider acceptance evidence',()=>{expect(deliveryOutcome({sent:true,sid:'provider1'},1)).toMatchObject({status:'SENT',providerId:'provider1'});});
 it('dry run does not claim rows or call any transport',async()=>{
  await runBusRiderNotifications({searchParams:new URLSearchParams('dryRun=true')} as never);
  expect(mocks.platform).not.toHaveBeenCalled();expect(mocks.email).not.toHaveBeenCalled();expect(mocks.sms).not.toHaveBeenCalled();expect(mocks.whatsapp).not.toHaveBeenCalled();
 });
 it.each([true,false])('runs the delivery sweep with a mocked provider accepted=%s',async accepted=>{
  const tx=fixture();let claims=0;
  tx.$queryRaw.mockImplementation(async (sql:TemplateStringsArray)=>sql.join('').includes('WITH due') ? (claims++===0?[row]:[]) : [rule]);
  mocks.platform.mockImplementation((_p,fn)=>fn({$queryRaw:vi.fn().mockResolvedValue([{id:tenant}])}));
  mocks.tenant.mockImplementation((_p,_t,fn)=>fn(asTx(tx)));
  mocks.email.mockResolvedValue(accepted?{sent:true,id:'provider1'}:{sent:false,reason:'quarantined_in_staging'});
  const result=await runBusRiderNotifications({tenantId:tenant,searchParams:new URLSearchParams()} as never);
  expect(mocks.email).toHaveBeenCalledTimes(1);expect(mocks.email).toHaveBeenCalledWith({to:'a@example.test',subject:'Update',text:'Approaching'});
  expect(result.data).toEqual(accepted?{SENT:1}:{BLOCKED:1});
  expect(tx.$executeRaw.mock.calls.some(call=>call.includes(accepted?'SENT':'BLOCKED'))).toBe(true);
 });
 it('does not call a provider when a queued employee becomes unavailable',async()=>{
  const tx=fixture();let claims=0;tx.staffMember.findFirst.mockResolvedValue(null);
  tx.$queryRaw.mockImplementation(async(sql:TemplateStringsArray)=>sql.join('').includes('WITH due')?(claims++===0?[row]:[]):[rule]);
  mocks.platform.mockImplementation((_p,fn)=>fn({$queryRaw:vi.fn().mockResolvedValue([{id:tenant}])}));
  mocks.tenant.mockImplementation((_p,_t,fn)=>fn(asTx(tx)));
  const result=await runBusRiderNotifications({tenantId:tenant,searchParams:new URLSearchParams()} as never);
  expect(result.data).toEqual({SUPPRESSED:1});expect(mocks.email).not.toHaveBeenCalled();
 });

});

describe('disruption notification freshness',()=>{
 it('suppresses pre-breakdown approach messages while substitute recovery is pending',async()=>{
  const f=fixture();f.busTripDisruption.findFirst.mockResolvedValue({id:'disruption',status:'REPORTED'});
  expect(await canSendRiderDelivery(asTx(f),row)).toBe(false);
 });
 it('queues one consolidated rider update for the current disruption phase',async()=>{
  const f=fixture();f.$queryRaw.mockResolvedValue([{...defaultRules.find(r=>r.event_type==='trip.disruption_updated')!,enabled:true,channels:['EMAIL','SMS']}]);
  expect(await enqueueRiderNotifications(asTx(f),{...event,eventType:'trip.disruption_updated',data:{scheduleId:'trip-a',disruptionId:'disruption',stage:'RECOVERED',updateText:'Replacement bus TEST-BUS; destination arrival 12:30 UTC.'}})).toBe(2);
  expect(f.$executeRaw.mock.calls[0]).toContain('Trip T1: Replacement bus TEST-BUS; destination arrival 12:30 UTC.');
 });
 it('suppresses a delayed report after recovery before fanout',async()=>{
  const f=fixture();f.$queryRaw.mockResolvedValue([{...defaultRules.find(r=>r.event_type==='trip.disruption_updated')!,enabled:true,channels:['EMAIL','SMS']}]);
  expect(await enqueueRiderNotifications(asTx(f),{...event,eventType:'trip.disruption_updated',data:{scheduleId:'trip-a',disruptionId:'disruption',stage:'REPORTED'}})).toBe(0);
  expect(f.$executeRaw).not.toHaveBeenCalled();
 });
 it('rechecks the event phase before transport and suppresses superseded events',async()=>{
  const f=fixture();f.$queryRaw.mockResolvedValue([{...defaultRules.find(r=>r.event_type==='trip.disruption_updated')!,enabled:true,channels:['EMAIL','SMS']}]);
  expect(await canSendRiderDelivery(asTx(f),{...row,event_type:'trip.disruption_updated',event_id:'recovery-event'})).toBe(true);
  expect(f.busTripDisruption.findFirst.mock.calls[0][0].where).toMatchObject({tenantId:tenant,scheduleId:'trip-a',OR:expect.arrayContaining([{status:'RECOVERED',recoveryEventId:'recovery-event'}])});
  f.busTripDisruption.findFirst.mockResolvedValue(null);expect(await canSendRiderDelivery(asTx(f),{...row,event_type:'trip.disruption_updated',event_id:'report-event'})).toBe(false);
 });
});

describe('review fixes',()=>{
 it('accepts a missed boarding published about the rider, as the location route publishes it',async()=>{
  const tx=fixture();tx.$queryRaw.mockResolvedValue([{...rule,event_type:'boarding.missed'}]);
  const missed={...event,eventType:'boarding.missed',aggregateType:'TripPassenger',aggregateId:'rider-b',data:{scheduleId:'trip-a',passengerId:'rider-b'}};
  await enqueueRiderNotifications(asTx(tx),missed);
  expect(tx.tripPassenger.findMany).toHaveBeenCalledWith({where:expect.objectContaining({tenantId:tenant,tripId:'trip-a',id:'rider-b',status:'ABSENT'})});
  // A rider aggregate must name the same rider the event is about.
  await expect(enqueueRiderNotifications(asTx(tx),{...missed,data:{scheduleId:'trip-a',passengerId:'rider-c'}})).rejects.toThrow('Invalid trip scope');
  await expect(enqueueRiderNotifications(asTx(tx),{...missed,eventType:'trip.delayed'})).rejects.toThrow('Invalid trip scope');
 });
 it('still sends the closing disruption update on a cancelled trip, and nothing else',async()=>{
  const f=fixture();f.$queryRaw.mockResolvedValue([{...defaultRules.find(r=>r.event_type==='trip.disruption_updated')!,enabled:true,channels:['EMAIL','SMS']}]);
  f.tripSchedule.findFirst.mockResolvedValue({id:'trip-a',tripNumber:'T1',status:'CANCELLED'});
  f.busTripDisruption.findFirst.mockResolvedValue({id:'disruption',status:'RESOLVED'});
  expect(await canSendRiderDelivery(asTx(f),{...row,event_type:'trip.disruption_updated',event_id:'resolution-event'})).toBe(true);
  f.busTripDisruption.findFirst.mockResolvedValue({id:'disruption',status:'REPORTED'});
  expect(await canSendRiderDelivery(asTx(f),{...row,event_type:'trip.disruption_updated',event_id:'report-event'})).toBe(false);
  f.$queryRaw.mockResolvedValue([rule]);
  expect(await canSendRiderDelivery(asTx(f),row)).toBe(false);
 });
});
