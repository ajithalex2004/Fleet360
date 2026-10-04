import { beforeEach,describe,expect,it,vi } from 'vitest';
import type { Prisma } from '@prisma/client';
const mocks=vi.hoisted(()=>({publish:vi.fn(),audit:vi.fn(),validate:vi.fn(),locks:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:{}}));
vi.mock('@/events/event-bus',()=>({getEventBus:()=>({publish:mocks.publish})}));
vi.mock('@/lib/audit',()=>({writeRequiredAudit:mocks.audit}));
vi.mock('@/lib/bus-ops/validate-assignment',()=>({validateResourceAssignment:mocks.validate}));
vi.mock('@/lib/bus-ops/assignment-txn',()=>({withAssignmentLocks:mocks.locks}));
import { commandDisruption,reportDisruption,hasUnrecoveredDisruption } from '@/lib/bus-ops/disruptions';
import { reportDisruptionSchema,disruptionCommandSchema,type DisruptionCommand } from '@/lib/bus-ops/disruption-input';
import { PRETRIP_CHECKLIST } from '@/lib/bus-pretrip-checklist';
const trip={id:'trip',tenantId:'tenant-a',status:'STARTED',vehicleId:'old-bus',driverId:'old-driver',routeId:'route',tripNumber:'T1',departureTime:new Date(Date.now()-3600000),arrivalTime:new Date(Date.now()+3600000)};
const disruption={id:'disruption',tenantId:'tenant-a',scheduleId:'trip',status:'REPORTED',version:1,incidentId:'incident',originalVehicleId:'old-bus',originalDriverId:'old-driver'};
const report={requestKey:'9b72b316-6e84-47c0-a2b9-d81d7cbf229f',reason:'Bus engine breakdown',severity:'HIGH' as const};
const recover=():DisruptionCommand=>({action:'recover',expectedVersion:1,vehicleId:'new-bus',driverId:'new-driver',revisedEta:new Date(Date.now()+7200000).toISOString(),notes:'Substitute inspected and passengers transferred',items:PRETRIP_CHECKLIST.map(i=>({key:i.key,ok:true}))});
function fixture(){return {
 $queryRawUnsafe:vi.fn().mockResolvedValue([]),$queryRaw:vi.fn().mockResolvedValue([]),
 tripSchedule:{findFirst:vi.fn().mockResolvedValue(trip),update:vi.fn().mockResolvedValue(trip)},
 busTripDisruption:{findFirst:vi.fn().mockResolvedValue(disruption),create:vi.fn().mockImplementation(async({data})=>({...data,id:'disruption'})),update:vi.fn().mockImplementation(async({data})=>({...disruption,...data}))},
 tripIncident:{create:vi.fn().mockResolvedValue({id:'incident'}),updateMany:vi.fn().mockResolvedValue({count:1})},
 tripPassenger:{count:vi.fn().mockResolvedValue(12)},
 vehicle:{findFirst:vi.fn().mockResolvedValue({id:'new-bus',licensePlate:'TEST-BUS',seatingCapacity:20})},
 driver:{findFirst:vi.fn().mockResolvedValue({id:'new-driver',name:'Test driver'})},
 busPreTripCheck:{create:vi.fn().mockResolvedValue({id:'inspection'})},
};}
const tx=(f:ReturnType<typeof fixture>)=>f as unknown as Prisma.TransactionClient;
beforeEach(()=>{vi.clearAllMocks();mocks.publish.mockResolvedValue({eventId:'event'});mocks.audit.mockResolvedValue(undefined);mocks.validate.mockResolvedValue({verdict:'PASS',checks:[]});mocks.locks.mockImplementation(async(_key,fn,t)=>fn(t));});
describe('guided disruption response',()=>{
 it('reports tenant-owned breakdown, immutable resources, audit and one durable rider event',async()=>{
  const f=fixture();f.busTripDisruption.findFirst.mockResolvedValue(null);
  const result=await reportDisruption(tx(f),'tenant-a','dispatcher','trip',report);
  expect(result.reportEventId).toBe('event');expect(f.tripIncident.create).toHaveBeenCalledWith({data:expect.objectContaining({tenantId:'tenant-a',scheduleId:'trip',incidentType:'BREAKDOWN',vehicleId:'old-bus'})});
  expect(f.busTripDisruption.create.mock.calls[0][0].data).toMatchObject({originalVehicleId:'old-bus',originalDriverId:'old-driver',reportedBy:'dispatcher'});
  expect(mocks.publish).toHaveBeenCalledWith(expect.objectContaining({tenantId:'tenant-a',payload:expect.objectContaining({stage:'REPORTED'})}),tx(f));
  expect(mocks.audit).toHaveBeenCalled();expect(f.tripSchedule.update).not.toHaveBeenCalled();
 });
 it('replays an identical report without duplicating incident or event',async()=>{
  const f=fixture();f.busTripDisruption.findFirst.mockResolvedValue(null);const first=await reportDisruption(tx(f),'tenant-a','dispatcher','trip',report);
  first.requestHash=f.busTripDisruption.create.mock.calls[0][0].data.requestHash;f.busTripDisruption.findFirst.mockResolvedValue(first);f.tripIncident.create.mockClear();mocks.publish.mockClear();
  expect(await reportDisruption(tx(f),'tenant-a','dispatcher','trip',report)).toEqual(first);expect(f.tripIncident.create).not.toHaveBeenCalled();expect(mocks.publish).not.toHaveBeenCalled();
  await expect(reportDisruption(tx(f),'tenant-a','dispatcher','trip',{...report,reason:'Changed breakdown details'})).rejects.toThrow('different details');
 });
 it('denies foreign trips and serializes on the tenant-owned trip row',async()=>{
  const f=fixture();f.tripSchedule.findFirst.mockResolvedValue(null);
  await expect(reportDisruption(tx(f),'tenant-a','dispatcher','foreign',report)).rejects.toMatchObject({status:404});
  expect(f.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'),'foreign','tenant-a');expect(f.tripIncident.create).not.toHaveBeenCalled();
 });
 it('denies a second open disruption',async()=>{
  const f=fixture();f.busTripDisruption.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(disruption);
  await expect(reportDisruption(tx(f),'tenant-a','dispatcher','trip',report)).rejects.toThrow('already has');
 });
 it('recovers a running trip with inspection, capacity, locked validation and consolidated rider update',async()=>{
  const f=fixture();const input=recover();await commandDisruption(tx(f),'tenant-a','dispatcher','trip','disruption',input);
  expect(mocks.locks).toHaveBeenCalledWith({tenantId:'tenant-a',vehicleId:'new-bus',driverId:'new-driver'},expect.any(Function),tx(f));
  expect(mocks.validate).toHaveBeenCalledWith(expect.objectContaining({tenantId:'tenant-a',scheduleId:'trip',confirmedCount:12,arrivalTime:new Date((input as {revisedEta:string}).revisedEta)}),tx(f));
  expect(mocks.validate.mock.calls[0][0].departureTime.getTime()).toBeGreaterThan(trip.departureTime.getTime());
  expect(f.tripSchedule.update).toHaveBeenCalledWith({where:{id:'trip'},data:expect.objectContaining({vehicleId:'new-bus',driverId:'new-driver',capacity:20})});
  expect(f.busPreTripCheck.create.mock.calls[0][0].data).toMatchObject({vehicleId:'new-bus',driverId:'new-driver',performedBy:'dispatcher'});
  expect(mocks.publish).toHaveBeenCalledTimes(1);expect(mocks.publish.mock.calls[0][0].payload).toMatchObject({stage:'RECOVERED',vehicleId:'new-bus',driverId:'new-driver'});
  expect(f.tripPassenger.count).toHaveBeenCalledWith({where:{tenantId:'tenant-a',tripId:'trip',deletedAt:null,status:{in:['CONFIRMED','BOARDED']}}});
 });
 it.each(['COMPLETED','CANCELLED','MERGED'])('refuses recovery on %s trips',async status=>{
  const f=fixture();f.tripSchedule.findFirst.mockResolvedValue({...trip,status});await expect(commandDisruption(tx(f),'tenant-a','dispatcher','trip','disruption',recover())).rejects.toMatchObject({status:409});expect(f.tripSchedule.update).not.toHaveBeenCalled();
 });
 it('rejects stale versions before assignment',async()=>{const f=fixture();await expect(commandDisruption(tx(f),'tenant-a','dispatcher','trip','disruption',{...recover(),expectedVersion:2})).rejects.toThrow('refresh');expect(mocks.validate).not.toHaveBeenCalled();});
 it('rejects external resource changes and unchanged substitute',async()=>{
  const f=fixture();f.tripSchedule.findFirst.mockResolvedValue({...trip,vehicleId:'external'});await expect(commandDisruption(tx(f),'tenant-a','dispatcher','trip','disruption',recover())).rejects.toThrow('outside');
  f.tripSchedule.findFirst.mockResolvedValue(trip);await expect(commandDisruption(tx(f),'tenant-a','dispatcher','trip','disruption',{...recover(),vehicleId:'old-bus',driverId:'old-driver'} as DisruptionCommand)).rejects.toThrow('Select a substitute');
 });
 it.each([null,10])('blocks unknown or insufficient capacity %s',async capacity=>{const f=fixture();f.vehicle.findFirst.mockResolvedValue({id:'new-bus',seatingCapacity:capacity} as never);await expect(commandDisruption(tx(f),'tenant-a','dispatcher','trip','disruption',recover())).rejects.toThrow('capacity');expect(f.tripSchedule.update).not.toHaveBeenCalled();});
 it('rejects foreign substitute resources',async()=>{const f=fixture();f.driver.findFirst.mockResolvedValue(null);await expect(commandDisruption(tx(f),'tenant-a','dispatcher','trip','disruption',recover())).rejects.toThrow('this tenant');expect(f.tripSchedule.update).not.toHaveBeenCalled();});
 it('blocks conflicting assignment without writing an inspection or changing trip',async()=>{const f=fixture();mocks.validate.mockResolvedValue({verdict:'BLOCK',checks:[{title:'Already assigned'}]});await expect(commandDisruption(tx(f),'tenant-a','dispatcher','trip','disruption',recover())).rejects.toMatchObject({status:409});expect(f.tripSchedule.update).not.toHaveBeenCalled();expect(f.busPreTripCheck.create).not.toHaveBeenCalled();});
 it('blocks failed or duplicate safety checks',async()=>{const f=fixture();const input=recover() as Extract<DisruptionCommand,{action:'recover'}>;input.items[1].ok=false;await expect(commandDisruption(tx(f),'tenant-a','dispatcher','trip','disruption',input)).rejects.toMatchObject({status:412});input.items[1]=input.items[0];await expect(commandDisruption(tx(f),'tenant-a','dispatcher','trip','disruption',input)).rejects.toThrow('duplicate');expect(f.tripSchedule.update).not.toHaveBeenCalled();});
 it.each([new Date(0),new Date(Date.now()+25*3600000)])('blocks invalid recovery arrival %s',async date=>{const f=fixture();await expect(commandDisruption(tx(f),'tenant-a','dispatcher','trip','disruption',{...recover(),revisedEta:date.toISOString()} as DisruptionCommand)).rejects.toMatchObject({status:400});});
 it('propagates required audit/outbox faults to abort caller transaction',async()=>{const f=fixture();mocks.publish.mockRejectedValue(new Error('outbox unavailable'));await expect(commandDisruption(tx(f),'tenant-a','dispatcher','trip','disruption',recover())).rejects.toThrow('outbox unavailable');expect(f.busTripDisruption.update).not.toHaveBeenCalled();mocks.publish.mockResolvedValue({eventId:'event'});mocks.audit.mockRejectedValue(new Error('audit unavailable'));await expect(commandDisruption(tx(f),'tenant-a','dispatcher','trip','disruption',recover())).rejects.toThrow('audit unavailable');});
 it('requires recovery before resolution, but permits closing a cancelled trip',async()=>{const f=fixture();const input={action:'resolve',expectedVersion:1,notes:'Cancelled after breakdown; riders assisted'} as const;await expect(commandDisruption(tx(f),'tenant-a','dispatcher','trip','disruption',input)).rejects.toThrow('Assign and inspect');f.tripSchedule.findFirst.mockResolvedValue({...trip,status:'CANCELLED'});const result=await commandDisruption(tx(f),'tenant-a','dispatcher','trip','disruption',input);expect(result.status).toBe('RESOLVED');});
 it('resolves recovery with immutable actor and completion evidence',async()=>{const f=fixture();f.busTripDisruption.findFirst.mockResolvedValue({...disruption,status:'RECOVERED',version:2});const result=await commandDisruption(tx(f),'tenant-a','dispatcher','trip','disruption',{action:'resolve',expectedVersion:2,notes:'Passengers transferred; service resumed safely'});expect(result).toMatchObject({status:'RESOLVED',resolvedBy:'dispatcher',resolutionEventId:'event'});expect(f.tripIncident.updateMany.mock.calls[0][0].where).toMatchObject({tenantId:'tenant-a',scheduleId:'trip'});});
 it('pauses automation only for unrecovered reports in the same tenant/trip',async()=>{const f=fixture();expect(await hasUnrecoveredDisruption(tx(f),'tenant-a','trip')).toBe(false);f.$queryRaw.mockResolvedValue([{id:'disruption'}]);expect(await hasUnrecoveredDisruption(tx(f),'tenant-a','trip')).toBe(true);expect(f.$queryRaw.mock.calls[0]).toContain('tenant-a');});
});
it('strict inputs deny forged status, actor, tenant, version omission and partial checklists',()=>{
 expect(reportDisruptionSchema.safeParse({...report,tenantId:'other'}).success).toBe(false);
 expect(disruptionCommandSchema.safeParse({...recover(),status:'RESOLVED',reportedBy:'admin'}).success).toBe(false);
 expect(disruptionCommandSchema.safeParse({...recover(),expectedVersion:undefined}).success).toBe(false);
 expect(disruptionCommandSchema.safeParse({...recover(),items:[]}).success).toBe(false);
});
