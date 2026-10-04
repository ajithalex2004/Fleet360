import { NextRequest,NextResponse } from 'next/server';
import { ownsBusOpsEmployee,requireBusOpsRequest } from '@/lib/bus-ops/access';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { buildPassengerJourney,type JourneyStop } from '@/lib/bus-ops/passenger-journey';
import { queueStopEventOnce } from '@/lib/bus-ops/trip-notification-events';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(req:NextRequest,{params}:{params:Promise<{id:string}>}) {
 const refusal=await requireBusOpsRequest(req);if(refusal)return refusal;
 const auth=requireAuthorizedTenant(req);if(!auth.ok)return NextResponse.json({error:auth.error},{status:auth.status,headers});
 const {id}=await params;
 try{return await withTenantRls(prisma,auth.tenantId,async tx=>{
  const passenger=await tx.tripPassenger.findFirst({where:{id,tenantId:auth.tenantId,deletedAt:null,trip:{tenantId:auth.tenantId,deletedAt:null}},include:{trip:true}});
  if(!passenger)return NextResponse.json({error:'Journey not found'},{status:404,headers});
  // Resolve the authoritative staff owner; denormalized passenger employee fields are not authority.
  const staff=passenger.staffMemberId?await tx.staffMember.findFirst({where:{id:passenger.staffMemberId,tenantId:auth.tenantId,deletedAt:null},select:{employeeId:true}}):null;
  if(!staff||!await ownsBusOpsEmployee(req,staff.employeeId))return NextResponse.json({error:'Journey not found'},{status:404,headers});
  // All attendance/trip commands take this lock. Reload after acquiring it so a
  // substitution or boarding committed while waiting cannot leave a mixed snapshot.
  await tx.$queryRawUnsafe('SELECT id FROM trip_schedules WHERE id::text=$1 AND tenant_id::text=$2 FOR UPDATE',passenger.tripId,auth.tenantId);
  const current=await tx.tripPassenger.findFirst({where:{id,tenantId:auth.tenantId,staffMemberId:passenger.staffMemberId,deletedAt:null,trip:{tenantId:auth.tenantId,deletedAt:null}},include:{trip:true}});
  if(!current)return NextResponse.json({error:'Journey not found'},{status:404,headers});
  const trip=current.trip;
  const [stops,visits,pings,counts,disruptions]=await Promise.all([
   tx.routeStop.findMany({where:{tenantId:auth.tenantId,routeId:trip.routeId,variantVersionId:trip.routeVariantVersionId ?? null},select:{id:true,stopName:true,gpsLat:true,gpsLng:true,estimatedArrivalMins:true}}),
   tx.$queryRawUnsafe<Array<{stop_id:string}>>('SELECT stop_id FROM trip_stop_visits WHERE schedule_id=$1 AND tenant_id=$2 AND entered_at IS NOT NULL',trip.id,auth.tenantId),
   tx.$queryRawUnsafe<Array<{latitude:number;longitude:number;occurred_at:Date}>>('SELECT latitude,longitude,occurred_at FROM fleet.bus_gps_pings WHERE schedule_id=$1 AND vehicle_id=$2 AND tenant_id=$3 ORDER BY occurred_at DESC LIMIT 10',trip.id,trip.vehicleId,auth.tenantId),
   tx.tripPassenger.groupBy({by:['status'],where:{tenantId:auth.tenantId,tripId:trip.id,deletedAt:null},_count:{_all:true}}),
   tx.$queryRawUnsafe<Array<{status:string;revised_eta:Date|null;recovered_at:Date|null}>>("SELECT status,revised_eta,recovered_at FROM bus_trip_disruptions WHERE schedule_id=$1 AND tenant_id::text=$2 ORDER BY reported_at DESC LIMIT 1",trip.id,auth.tenantId),
  ]);
  const count=(statuses:string[])=>counts.filter(c=>statuses.includes(c.status ?? '')).reduce((sum,c)=>sum+c._count._all,0);
  const disruption=disruptions[0];
  const result=buildPassengerJourney({now:new Date(),passengerStatus:current.status ?? 'CONFIRMED',boardingStopId:current.boardingStopId,boardingStopName:current.boardingStopName,alightingStopId:current.alightingStopId,alightingStopName:current.alightingStopName,tripStatus:trip.status,departureTime:trip.departureTime,capacity:trip.capacity,onboard:count(['BOARDED']),reserved:count(['CONFIRMED','BOARDED']),stops:stops as JourneyStop[],visitedStopIds:visits.map(v=>v.stop_id),pings:pings.map(p=>({latitude:p.latitude,longitude:p.longitude,occurredAt:p.occurred_at.toISOString()})),disruption:disruption?{status:disruption.status,revisedEta:disruption.revised_eta?.toISOString() ?? null,recoveredAt:disruption.recovered_at?.toISOString() ?? null}:null});
  // Preserve Item 1's deduplicated stop notifications as riders move to this
  // scoped endpoint. Timetable/stale/disrupted values never create live notices.
  if(['live','near-stop'].includes(result.state)&&result.etaAt&&result.target){
   const minutes=(Date.parse(result.etaAt)-Date.parse(result.asOf))/60000;
   const payload={scheduleId:trip.id,tripNumber:trip.tripNumber,routeId:trip.routeId,vehicleId:trip.vehicleId,driverId:trip.driverId,stopId:result.target.id,stopName:result.target.name};
   if(result.phase==='pickup'&&minutes>=0&&minutes<=5)await queueStopEventOnce(tx,auth.tenantId,trip.id,result.target.id,{kind:'arriving',payload:{...payload,etaAt:result.etaAt,minutesToArrival:Math.ceil(minutes),distanceM:null}});
   if(result.plannedAt&&Date.parse(result.etaAt)-Date.parse(result.plannedAt)>5*60000)await queueStopEventOnce(tx,auth.tenantId,trip.id,result.target.id,{kind:'delayed',payload:{...payload,scheduledAt:result.plannedAt,predictedAt:result.etaAt,delayMinutes:Math.ceil((Date.parse(result.etaAt)-Date.parse(result.plannedAt))/60000),reason:'unknown'}});
  }
  return NextResponse.json(result,{headers});
 });}catch(error){console.error('[passenger journey]',error instanceof Error?error.name:'unknown');return NextResponse.json({error:'Journey status temporarily unavailable'},{status:503,headers});}
}
