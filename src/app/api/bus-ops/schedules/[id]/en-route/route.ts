export const dynamic='force-dynamic';
import { NextRequest,NextResponse } from 'next/server';
import { z } from 'zod';
import { requireBusOpsRequest } from '@/lib/bus-ops/access';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { hasUnrecoveredDisruption } from '@/lib/bus-ops/disruptions';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { getEventBus } from '@/events/event-bus';
import { TRIP_EN_ROUTE } from '@/events/contracts/trip.events';
import { writeRequiredAudit } from '@/lib/audit';
export async function POST(req:NextRequest,props:{params:Promise<{id:string}>}){
 const refusal=await requireBusOpsRequest(req);if(refusal)return refusal;
 const auth=requireAuthorizedTenant(req);if(!auth.ok)return NextResponse.json({error:auth.error},{status:auth.status});
 const parsed=z.object({}).strict().safeParse(await req.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:'Invalid en-route command'},{status:400});
 const {id}=await props.params;
 try{return await withTenantRls(prisma,auth.tenantId,async tx=>{
  await tx.$queryRawUnsafe('SELECT id FROM trip_schedules WHERE id::text=$1 AND tenant_id::text=$2 FOR UPDATE',id,auth.tenantId);
  const trip=await tx.tripSchedule.findFirst({where:{id,tenantId:auth.tenantId,deletedAt:null}});
  if(!trip)return NextResponse.json({error:'Trip not found'},{status:404});
  if(await hasUnrecoveredDisruption(tx,auth.tenantId,id))return NextResponse.json({error:'Assign an inspected substitute before resuming the disrupted trip'},{status:409});
  if(['EN_ROUTE','IN_TRANSIT'].includes(trip.status ?? ''))return NextResponse.json(trip);
  if(!['STARTED','DEPARTED'].includes(trip.status ?? ''))return NextResponse.json({error:'Only a started trip can move en route'},{status:409});
  const now=new Date();const updated=await tx.tripSchedule.update({where:{id},data:{status:'EN_ROUTE'}});
  await getEventBus().publish({eventType:TRIP_EN_ROUTE,aggregateType:'TripSchedule',aggregateId:id,sourceModule:'bus-ops',tenantId:auth.tenantId,actor:auth.userId,
   payload:{scheduleId:id,tripNumber:trip.tripNumber,vehicleId:trip.vehicleId,driverId:trip.driverId,enRouteAt:now.toISOString()}},tx);
  await writeRequiredAudit({tenantId:auth.tenantId,userId:auth.userId ?? undefined,entityType:'TripSchedule',entityId:id,action:'UPDATE',details:'Trip moved from started to en route'},tx);
  return NextResponse.json(updated);
 });}catch(error){console.error('[bus-ops en-route]',error instanceof Error?error.name:'unknown');return NextResponse.json({error:'Failed to mark trip en route'},{status:500});}
}
