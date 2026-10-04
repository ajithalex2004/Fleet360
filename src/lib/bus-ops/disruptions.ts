import { createHash, randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { assessChecklist } from '@/lib/bus-pretrip-checklist';
import { getEventBus } from '@/events/event-bus';
import { TRIP_DISRUPTION_UPDATED } from '@/events/contracts/trip.events';
import { writeRequiredAudit } from '@/lib/audit';
import { withAssignmentLocks } from './assignment-txn';
import { validateResourceAssignment } from './validate-assignment';
import type { ReportDisruptionInput, DisruptionCommand } from './disruption-input';
const OPERABLE = ['SCHEDULED','STARTED','EN_ROUTE','DEPARTED','IN_TRANSIT'];
export class DisruptionError extends Error {
 constructor(public status:number,message:string,public validation?:unknown){super(message);}
}
export async function hasUnrecoveredDisruption(tx:Prisma.TransactionClient,tenantId:string,scheduleId:string){
 const rows=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM bus_trip_disruptions WHERE tenant_id::text=${tenantId} AND schedule_id=${scheduleId} AND status='REPORTED' LIMIT 1`;
 return rows.length>0;
}
async function lockedSchedule(tx:Prisma.TransactionClient,tenantId:string,scheduleId:string){
 await tx.$queryRawUnsafe('SELECT id FROM trip_schedules WHERE id::text=$1 AND tenant_id=$2 FOR UPDATE',scheduleId,tenantId);
 const trip=await tx.tripSchedule.findFirst({where:{id:scheduleId,tenantId,deletedAt:null}});
 if(!trip) throw new DisruptionError(404,'Trip not found');
 return trip;
}
async function audit(tx:Prisma.TransactionClient,tenantId:string,actor:string,id:string,details:string){
 await writeRequiredAudit({tenantId,userId:actor,entityType:'BusTripDisruption',entityId:id,action:'UPDATE',details},tx);
}
/** All callers own a tenant-RLS transaction; no transports or nested transactions. */
export async function reportDisruption(tx:Prisma.TransactionClient,tenantId:string,actor:string,scheduleId:string,input:ReportDisruptionInput){
 const trip=await lockedSchedule(tx,tenantId,scheduleId);
 const requestHash=createHash('sha256').update(JSON.stringify({scheduleId,...input})).digest('hex');
 const prior=await tx.busTripDisruption.findFirst({where:{tenantId,requestKey:input.requestKey}});
 if(prior){if(prior.requestHash!==requestHash) throw new DisruptionError(409,'Request key was already used for different details');return prior;}
 if(!OPERABLE.includes(trip.status ?? '')) throw new DisruptionError(409,'Only scheduled or running trips can report a disruption');
 if(await tx.busTripDisruption.findFirst({where:{tenantId,scheduleId,status:{not:'RESOLVED'}}})) throw new DisruptionError(409,'This trip already has an open disruption');
 const now=new Date();
 const incident=await tx.tripIncident.create({data:{tenantId,scheduleId,routeId:trip.routeId,vehicleId:trip.vehicleId,driverId:trip.driverId,
  incidentNo:`DIS-${randomUUID()}`,incidentDate:now,incidentType:'BREAKDOWN',severity:input.severity,location:input.location,description:input.reason,moduleSource:'BUS_OPS',status:'OPEN'}});
 const disruption=await tx.busTripDisruption.create({data:{tenantId,scheduleId,requestKey:input.requestKey,requestHash,incidentId:incident.id,
  reason:input.reason,location:input.location,severity:input.severity,originalVehicleId:trip.vehicleId,originalDriverId:trip.driverId,
  originalArrivalTime:trip.arrivalTime,reportedBy:actor,reportedAt:now}});
 const event=await getEventBus().publish({eventType:TRIP_DISRUPTION_UPDATED,aggregateType:'TripSchedule',aggregateId:scheduleId,tenantId,actor,sourceModule:'bus-ops',
  payload:{scheduleId,tripNumber:trip.tripNumber,disruptionId:disruption.id,stage:'REPORTED',updateText:'Service is disrupted. Operations is arranging a replacement; a revised arrival time will follow.'}},tx);
 await audit(tx,tenantId,actor,disruption.id,JSON.stringify({action:'report',incidentId:incident.id,reason:input.reason,vehicleId:trip.vehicleId,driverId:trip.driverId}));
 return tx.busTripDisruption.update({where:{id:disruption.id},data:{reportEventId:event.eventId}});
}
export async function commandDisruption(tx:Prisma.TransactionClient,tenantId:string,actor:string,scheduleId:string,id:string,input:DisruptionCommand){
 const trip=await lockedSchedule(tx,tenantId,scheduleId);
 const current=await tx.busTripDisruption.findFirst({where:{id,tenantId,scheduleId}});
 if(!current) throw new DisruptionError(404,'Disruption not found');
 if(current.version!==input.expectedVersion) throw new DisruptionError(409,'Disruption changed; refresh before continuing');
 const now=new Date();
 if(input.action==='resolve'){
  if(current.status==='RESOLVED') throw new DisruptionError(409,'Disruption is already resolved');
  if(current.status!=='RECOVERED' && trip.status!=='CANCELLED') throw new DisruptionError(409,'Assign and inspect a substitute before closing the disruption');
  const incident=await tx.tripIncident.updateMany({where:{id:current.incidentId,tenantId,scheduleId},data:{status:'RESOLVED',resolvedAt:now,resolvedBy:actor,actionTaken:input.notes}});
  if(incident.count!==1)throw new DisruptionError(409,'Linked incident is unavailable; reconcile before closing');
  const event=await getEventBus().publish({eventType:TRIP_DISRUPTION_UPDATED,aggregateType:'TripSchedule',aggregateId:scheduleId,tenantId,actor,sourceModule:'bus-ops',
   payload:{scheduleId,tripNumber:trip.tripNumber,disruptionId:id,stage:'RESOLVED',updateText:trip.status==='CANCELLED'?'The disrupted trip has been cancelled. Contact transport operations for assistance.':`Operations has confirmed the disruption response is complete. Replacement bus ${current.replacementVehicleId}, driver ${current.replacementDriverId}; destination arrival ${current.revisedEta?.toISOString() ?? 'see trip details'}.`}},tx);
  await audit(tx,tenantId,actor,id,JSON.stringify({action:'resolve',notes:input.notes,tripStatus:trip.status}));
  return tx.busTripDisruption.update({where:{id},data:{status:'RESOLVED',version:{increment:1},resolutionNotes:input.notes,resolvedBy:actor,resolvedAt:now,resolutionEventId:event.eventId}});
 }
 if(current.status!=='REPORTED' || !OPERABLE.includes(trip.status ?? '')) throw new DisruptionError(409,'Recovery requires an open disruption on a scheduled or running trip');
 if(trip.vehicleId!==current.originalVehicleId || trip.driverId!==current.originalDriverId) throw new DisruptionError(409,'Trip resources changed outside this workflow; refresh and reconcile before recovery');
 if(input.vehicleId===trip.vehicleId && input.driverId===trip.driverId) throw new DisruptionError(409,'Select a substitute bus or driver');
 const eta=new Date(input.revisedEta);
 if(eta<=now || eta.getTime()>now.getTime()+24*60*60_000 || eta<=trip.departureTime) throw new DisruptionError(400,'Revised arrival must be after departure and within the next 24 hours');
 const assessment=assessChecklist(input.items);
 if(!assessment.overallPass) throw new DisruptionError(412,'Substitute inspection failed; recovery is blocked');
 return withAssignmentLocks({tenantId,vehicleId:input.vehicleId,driverId:input.driverId},async tx=>{
  const riders=await tx.tripPassenger.count({where:{tenantId,tripId:scheduleId,deletedAt:null,status:{in:['CONFIRMED','BOARDED']}}});
  const vehicle=await tx.vehicle.findFirst({where:{id:input.vehicleId,tenantId,deletedAt:null}});
  const driver=await tx.driver.findFirst({where:{id:input.driverId,tenantId,deletedAt:null}});
  if(!vehicle || !driver) throw new DisruptionError(409,'Substitute resources are not available in this tenant');
  // Unknown capacity cannot prove passenger safety. The general validator treats over-capacity as advisory; recovery must block it.
  if(vehicle.seatingCapacity==null || vehicle.seatingCapacity<riders) throw new DisruptionError(409,'Substitute bus must have a known capacity sufficient for affected riders');
  const validation=await validateResourceAssignment({tenantId,scheduleId,vehicleId:input.vehicleId,driverId:input.driverId,
   departureTime:new Date(Math.max(trip.departureTime.getTime(),now.getTime())),arrivalTime:eta,routeId:trip.routeId,confirmedCount:riders},tx);
  if(validation.verdict==='BLOCK') throw new DisruptionError(409,'Substitute assignment blocked',validation);
  const check=await tx.busPreTripCheck.create({data:{tenantId,scheduleId,vehicleId:input.vehicleId,driverId:input.driverId,performedBy:actor,
   performedAt:now,checkItems:input.items,overallPass:true,failCount:assessment.failCount,notes:input.notes}});
  await tx.tripSchedule.update({where:{id:scheduleId},data:{vehicleId:input.vehicleId,driverId:input.driverId,capacity:vehicle.seatingCapacity,arrivalTime:eta}});
  const incident=await tx.tripIncident.updateMany({where:{id:current.incidentId,tenantId,scheduleId},data:{status:'INVESTIGATING',actionTaken:input.notes}});
  if(incident.count!==1)throw new DisruptionError(409,'Linked incident is unavailable; reconcile before recovery');
  const vehicleLabel=vehicle.licensePlate ?? vehicle.plateNumber ?? vehicle.id;
  const driverLabel=driver.name ?? ([driver.firstName,driver.lastName].filter(Boolean).join(' ') || driver.id);
  const event=await getEventBus().publish({eventType:TRIP_DISRUPTION_UPDATED,aggregateType:'TripSchedule',aggregateId:scheduleId,tenantId,actor,sourceModule:'bus-ops',
   payload:{scheduleId,tripNumber:trip.tripNumber,disruptionId:id,stage:'RECOVERED',vehicleId:input.vehicleId,driverId:input.driverId,revisedEta:eta.toISOString(),
    updateText:`Replacement bus ${vehicleLabel}, driver ${driverLabel}. Revised destination arrival: ${eta.toISOString()}. Please check your trip details.`}},tx);
  await audit(tx,tenantId,actor,id,JSON.stringify({action:'recover',previousVehicleId:trip.vehicleId,previousDriverId:trip.driverId,vehicleId:input.vehicleId,driverId:input.driverId,
   revisedEta:eta.toISOString(),inspectionId:check.id,validation,notes:input.notes}));
  return tx.busTripDisruption.update({where:{id},data:{status:'RECOVERED',version:{increment:1},replacementVehicleId:input.vehicleId,replacementDriverId:input.driverId,
   revisedEta:eta,inspectionId:check.id,recoveryNotes:input.notes,recoveredBy:actor,recoveredAt:now,recoveryEventId:event.eventId}});
 },tx);
}
