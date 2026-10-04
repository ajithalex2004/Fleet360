export const dynamic = 'force-dynamic';
import { NextRequest,NextResponse } from 'next/server';
import { requireBusOpsRequest } from '@/lib/bus-ops/access';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { reportDisruptionSchema } from '@/lib/bus-ops/disruption-input';
import { reportDisruption,DisruptionError } from '@/lib/bus-ops/disruptions';
import { loadRiderRules } from '@/lib/bus-ops/rider-notifications';
import { TRIP_DISRUPTION_UPDATED } from '@/events/contracts/trip.events';
export async function GET(req:NextRequest,props:{params:Promise<{id:string}>}){
 const refusal=await requireBusOpsRequest(req);if(refusal)return refusal;
 const auth=requireAuthorizedTenant(req);if(!auth.ok)return NextResponse.json({error:auth.error},{status:auth.status});
 const {id}=await props.params;
 try{return await withTenantRls(prisma,auth.tenantId,async tx=>{
  const trip=await tx.tripSchedule.findFirst({where:{id,tenantId:auth.tenantId,deletedAt:null}});
  if(!trip)return NextResponse.json({error:'Trip not found'},{status:404});
  const disruptions=await tx.busTripDisruption.findMany({where:{tenantId:auth.tenantId,scheduleId:id},orderBy:{reportedAt:'desc'},take:50});
  const deliveries=await tx.$queryRaw<Array<{event_id:string;status:string;count:number}>>`SELECT event_id,status,count(*)::int AS count FROM bus_rider_deliveries
   WHERE tenant_id=${auth.tenantId} AND schedule_id=${id} AND event_type=${TRIP_DISRUPTION_UPDATED} GROUP BY event_id,status`;
  const vehicles=await tx.vehicle.findMany({where:{tenantId:auth.tenantId,deletedAt:null,isActive:true},select:{id:true,licensePlate:true,plateNumber:true,seatingCapacity:true,status:true},orderBy:{licensePlate:"asc"},take:200});
  const drivers=await tx.driver.findMany({where:{tenantId:auth.tenantId,deletedAt:null,status:"ACTIVE"},select:{id:true,name:true,firstName:true,lastName:true},orderBy:{name:"asc"},take:200});
  const rule=(await loadRiderRules(tx,auth.tenantId)).find(r=>r.event_type===TRIP_DISRUPTION_UPDATED);
  return NextResponse.json({disruptions,deliveries,vehicles,drivers,notificationsEnabled:rule?.enabled===true},{headers:{'Cache-Control':'private, no-store'}});
 });}catch{return NextResponse.json({error:'Failed to load disruption history'},{status:500});}
}
export async function POST(req:NextRequest,props:{params:Promise<{id:string}>}){
 const refusal=await requireBusOpsRequest(req);if(refusal)return refusal;
 const auth=requireAuthorizedTenant(req);if(!auth.ok)return NextResponse.json({error:auth.error},{status:auth.status});
 if(!auth.userId)return NextResponse.json({error:'Verified dispatcher required'},{status:403});
 const parsed=reportDisruptionSchema.safeParse(await req.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:'Invalid disruption report',issues:parsed.error.issues},{status:400});
 const {id}=await props.params;
 try{const result=await withTenantRls(prisma,auth.tenantId,tx=>reportDisruption(tx,auth.tenantId,auth.userId!,id,parsed.data));
  return NextResponse.json(result,{status:201});
 }catch(error){if(error && typeof error==='object' && 'code' in error && error.code==='P2002')return NextResponse.json({error:'A conflicting report already exists; refresh the disruption history'},{status:409});
  if(error instanceof DisruptionError)return NextResponse.json({error:error.message},{status:error.status});
  console.error('[bus-ops disruption report]',error instanceof Error?error.name:'unknown');return NextResponse.json({error:'Failed to report disruption'},{status:500});}
}
