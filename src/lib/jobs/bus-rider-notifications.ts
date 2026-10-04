import { randomUUID } from 'crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { withPlatformAdmin, withTenantRls } from '@/lib/rls';
import { riderTenantEnabled, loadRiderRules } from '@/lib/bus-ops/rider-notifications';
import { sendEmail } from '@/lib/email';
import { sendSms } from '@/lib/sms';
import { sendWhatsApp } from '@/lib/whatsapp';
import type { JobContext, JobResult } from '@/lib/jobs/registry';
export interface RiderDelivery {
 id:string; tenant_id:string; event_type:string; schedule_id:string; passenger_id:string;
 staff_member_id:string; channel:string; recipient:string; subject:string; body:string;
 attempts:number; claim_token:string; expires_at:Date;
}
interface SendResult { sent:boolean; reason?:string; status?:number; errorClass?:string; sid?:string; id?:string }
/** Accepted means provider acceptance. Ambiguous transport outcomes are never automatically resent. */
export function deliveryOutcome(result: SendResult, attempts:number): {status:string; delaySeconds:number; error:string|null; providerId:string|null} {
 if (result.sent) return {status:'SENT',delaySeconds:0,error:null,providerId:result.sid ?? result.id ?? null};
 if (['not_configured','no_phone','quarantined_in_staging'].includes(result.reason ?? '')) return {status:'BLOCKED',delaySeconds:0,error:result.reason!,providerId:null};
 const definite = result.errorClass === 'DEFINITE_FAILURE' || (result.reason === 'twilio_error' && !!result.status && result.status >= 400 && result.status < 500);
 if (!definite) return {status:'UNCERTAIN',delaySeconds:0,error:result.reason ?? 'uncertain_transport',providerId:null};
 const retryable = !result.status || result.status === 429 || result.status >= 500;
 return {status: retryable && attempts < 5 ? 'RETRY' : 'FAILED',delaySeconds:Math.min(3600,60*2**(attempts-1)),error:result.reason ?? 'provider_rejected',providerId:null};
}
export async function claimRiderDeliveries(tx:Prisma.TransactionClient,tenantId:string):Promise<RiderDelivery[]> {
 // A crashed sender may have reached the provider. Lease expiry must never cause a duplicate send.
 await tx.$executeRaw`UPDATE bus_rider_deliveries SET status='UNCERTAIN',last_error='sender_lease_expired',updated_at=now()
  WHERE tenant_id=${tenantId} AND status='SENDING' AND claimed_at < now()-interval '10 minutes'`;
 return tx.$queryRaw<RiderDelivery[]>`WITH due AS (
  SELECT id FROM bus_rider_deliveries WHERE tenant_id=${tenantId} AND status IN ('PENDING','RETRY')
   AND next_attempt_at<=now() ORDER BY next_attempt_at,created_at LIMIT 1 FOR UPDATE SKIP LOCKED
 ) UPDATE bus_rider_deliveries d SET status='SENDING',attempts=d.attempts+1,claim_token=${randomUUID()},claimed_at=now(),updated_at=now()
 FROM due WHERE d.id=due.id AND d.tenant_id=${tenantId} RETURNING d.*`;
}
export async function canSendRiderDelivery(tx:Prisma.TransactionClient,row:RiderDelivery):Promise<boolean> {
 if (row.expires_at.getTime() <= Date.now() || !await riderTenantEnabled(tx,row.tenant_id)) return false;
 const rule=(await loadRiderRules(tx,row.tenant_id)).find(r=>r.event_type===row.event_type);
 if (!rule?.enabled || !rule.channels.includes(row.channel)) return false;
 const schedule=await tx.tripSchedule.findFirst({where:{id:row.schedule_id,tenantId:row.tenant_id,deletedAt:null}});
 if (!schedule || (schedule.status==='CANCELLED' && row.event_type!=='trip.cancelled')) return false;
 const passenger=await tx.tripPassenger.findFirst({where:{id:row.passenger_id,tripId:row.schedule_id,tenantId:row.tenant_id,staffMemberId:row.staff_member_id,deletedAt:null}});
 if (!passenger) return false;
 if (row.event_type==='trip.arriving' && passenger.status!=='CONFIRMED') return false;
 if (row.event_type==='boarding.missed' && passenger.status!=='ABSENT') return false;
 if (['CANCELLED','NO_SHOW'].includes(passenger.status ?? '') && row.event_type!=='trip.cancelled') return false;
 const staff=await tx.staffMember.findFirst({where:{id:row.staff_member_id,tenantId:row.tenant_id,isActive:true,deletedAt:null}});
 const current=row.channel==='EMAIL' ? staff?.email : staff?.contactNumber;
 return !!current && current.trim()===row.recipient;
}
export async function finishRiderDelivery(row:RiderDelivery,outcome:ReturnType<typeof deliveryOutcome>):Promise<void> {
 await withTenantRls(prisma,row.tenant_id,tx=>tx.$executeRaw`UPDATE bus_rider_deliveries
  SET status=${outcome.status},provider_id=${outcome.providerId},last_error=${outcome.error},
  next_attempt_at=now()+(${outcome.delaySeconds} * interval '1 second'),updated_at=now()
  WHERE id=${row.id} AND tenant_id=${row.tenant_id} AND status='SENDING' AND claim_token=${row.claim_token}`);
}
export async function runBusRiderNotifications(ctx:JobContext):Promise<JobResult> {
 if (ctx.searchParams.get('dryRun')==='true') return {status:'skipped',summary:'Dry run: no claims or sends'};
 const tenants=await withPlatformAdmin(prisma,tx=>tx.$queryRaw<Array<{id:string}>>`SELECT DISTINCT tenant_id AS id FROM bus_rider_deliveries
  WHERE status IN ('PENDING','RETRY','SENDING') AND (${ctx.tenantId ?? null}::text IS NULL OR tenant_id=${ctx.tenantId ?? null}) LIMIT 100`);
 const started=Date.now(); let processed=0;
 const counts:Record<string,number>={};
 for (const tenant of tenants) {
  for (let batch=0;batch<20 && processed<100 && Date.now()-started<90_000;batch++) {
  const rows=await withTenantRls(prisma,tenant.id,tx=>claimRiderDeliveries(tx,tenant.id));
  if (!rows.length) break;
  for (const row of rows) {
   processed++;
   let outcome:ReturnType<typeof deliveryOutcome>;
   const eligible=await withTenantRls(prisma,tenant.id,tx=>canSendRiderDelivery(tx,row));
   if (!eligible) outcome={status:'SUPPRESSED',delaySeconds:0,error:'recipient_rule_or_trip_unavailable',providerId:null};
   else {
    try {
     let timer:ReturnType<typeof setTimeout> | undefined;
     const send=row.channel==='EMAIL' ? sendEmail({to:row.recipient,subject:row.subject,text:row.body})
      : row.channel==='SMS' ? sendSms({to:row.recipient,body:row.body}) : sendWhatsApp({to:row.recipient,body:row.body});
     try {
      const result=await Promise.race([send,new Promise<SendResult>(resolve=>{timer=setTimeout(()=>resolve({sent:false,reason:'transport_timeout'}),20_000);})]);
      outcome=deliveryOutcome(result,row.attempts);
     } finally { if(timer) clearTimeout(timer); }
    } catch { outcome=deliveryOutcome({sent:false,reason:'transport_exception'},row.attempts); }
   }
   await finishRiderDelivery(row,outcome);
   counts[outcome.status]=(counts[outcome.status] ?? 0)+1;
  }
 }
 }
 return {status:'ok',summary:'Rider notification delivery sweep complete',data:counts};
}
