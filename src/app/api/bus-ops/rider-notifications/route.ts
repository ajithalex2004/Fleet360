import { NextRequest, NextResponse } from 'next/server';
import { busOpsAccessFor } from '@/lib/bus-ops/access';
import { requireAuthorizedTenant, stripTenantOwnershipFields } from '@/lib/tenant-context';
import { prisma } from '@/lib/prisma';
import { withTenantRls } from '@/lib/rls';
import { loadRiderRules, validateRiderRule } from '@/lib/bus-ops/rider-notifications';
import { writeRequiredAudit } from '@/lib/audit';
export const dynamic='force-dynamic';
export async function GET(req:NextRequest) {
 const {access,refusal}=await busOpsAccessFor(req); if(refusal) return refusal;
 const authz=requireAuthorizedTenant(req); if(!authz.ok)return NextResponse.json({error:authz.error},{status:authz.status});
 try {
  const data=await withTenantRls(prisma,access.tenantId,async tx=>({
   rules:await loadRiderRules(tx,access.tenantId),
   deliveries:await tx.$queryRaw`SELECT id,event_type,channel,status,attempts,last_error,created_at,updated_at
    FROM bus_rider_deliveries WHERE tenant_id=${access.tenantId} ORDER BY created_at DESC LIMIT 50`,
  }));
  return NextResponse.json(data,{headers:{'Cache-Control':'no-store'}});
 } catch { return NextResponse.json({error:'Failed to load rider notifications'},{status:500}); }
}
export async function PUT(req:NextRequest) {
 const {access,refusal}=await busOpsAccessFor(req); if(refusal) return refusal;
 const authz=requireAuthorizedTenant(req); if(!authz.ok)return NextResponse.json({error:authz.error},{status:authz.status});
 const raw=await req.json().catch(()=>null);
 const rule=raw && typeof raw==='object' ? stripTenantOwnershipFields(raw) : null;
 if(!validateRiderRule(rule)) return NextResponse.json({error:'Invalid notification rule'},{status:400});
 try {
  await withTenantRls(prisma,access.tenantId,async tx=>{
   await tx.$executeRaw`INSERT INTO bus_rider_notification_rules(tenant_id,event_type,enabled,channels,subject,body)
    VALUES(${access.tenantId},${rule.event_type},${rule.enabled},${rule.channels}::text[],${rule.subject},${rule.body})
    ON CONFLICT(tenant_id,event_type) DO UPDATE SET enabled=EXCLUDED.enabled,channels=EXCLUDED.channels,
    subject=EXCLUDED.subject,body=EXCLUDED.body,updated_at=now()`;
   await writeRequiredAudit({tenantId:access.tenantId,userId:access.userId,entityType:'BusRiderNotificationRule',entityId:rule.event_type,action:'UPDATE',details:`Enabled: ${rule.enabled}; channels: ${rule.channels.join(',')}`},tx);
  });
  return NextResponse.json({ok:true});
 } catch { return NextResponse.json({error:'Failed to save rider notification rule'},{status:500}); }
}

/** Explicit operator retry for known failures only. Sent and uncertain outcomes cannot be replayed here. */
export async function POST(req:NextRequest) {
 const {access,refusal}=await busOpsAccessFor(req); if(refusal) return refusal;
 const authz=requireAuthorizedTenant(req); if(!authz.ok)return NextResponse.json({error:authz.error},{status:authz.status});
 const raw=await req.json().catch(()=>null);
 const body=raw && typeof raw==='object' ? stripTenantOwnershipFields(raw) : null;
 if(typeof body?.deliveryId !== 'string' || body.deliveryId.length>100) return NextResponse.json({error:'Invalid delivery ID'},{status:400});
 try {
  const changed=await withTenantRls(prisma,access.tenantId,async tx=>{
   const count=await tx.$executeRaw`UPDATE bus_rider_deliveries SET status='RETRY',attempts=0,
    next_attempt_at=now(),claim_token=NULL,claimed_at=NULL,last_error='operator_retry',updated_at=now()
    WHERE id=${body.deliveryId} AND tenant_id=${access.tenantId} AND status IN ('BLOCKED','FAILED') AND expires_at>now()`;
   if(count) await writeRequiredAudit({tenantId:access.tenantId,userId:access.userId,entityType:'BusRiderDelivery',entityId:body.deliveryId,action:'RETRY',details:'Operator retried a known failed or blocked notification'},tx);
   return count;
  });
  return changed ? NextResponse.json({ok:true}) : NextResponse.json({error:'Delivery is expired or cannot be retried safely'},{status:409});
 } catch {return NextResponse.json({error:'Failed to retry delivery'},{status:500});}
}
