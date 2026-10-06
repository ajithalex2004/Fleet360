export const dynamic = 'force-dynamic';
import { NextRequest,NextResponse } from 'next/server';
import { requireBusOpsRequest } from '@/lib/bus-ops/access';
import { requireAuthorizedTenant } from '@/lib/tenant-context';
import { withTenantRls } from '@/lib/rls';
import { prisma } from '@/lib/prisma';
import { disruptionCommandSchema } from '@/lib/bus-ops/disruption-input';
import { commandDisruption,DisruptionError } from '@/lib/bus-ops/disruptions';
import { ChecklistValidationError } from '@/lib/bus-pretrip-checklist';
export async function POST(req:NextRequest,props:{params:Promise<{id:string;disruptionId:string}>}){
 const refusal=await requireBusOpsRequest(req);if(refusal)return refusal;
 const auth=requireAuthorizedTenant(req);if(!auth.ok)return NextResponse.json({error:auth.error},{status:auth.status});
 if(!auth.userId)return NextResponse.json({error:'Verified dispatcher required'},{status:403});
 const parsed=disruptionCommandSchema.safeParse(await req.json().catch(()=>null));
 if(!parsed.success)return NextResponse.json({error:'Invalid disruption command',issues:parsed.error.issues},{status:400});
 const {id,disruptionId}=await props.params;
 try{const result=await withTenantRls(prisma,auth.tenantId,tx=>commandDisruption(tx,auth.tenantId,auth.userId!,id,disruptionId,parsed.data));return NextResponse.json(result);
 }catch(error){if(error instanceof DisruptionError)return NextResponse.json({error:error.message,validation:error.validation},{status:error.status});
  if(error instanceof ChecklistValidationError)return NextResponse.json({error:error.message},{status:400});
  console.error('[bus-ops disruption command]',error instanceof Error?error.name:'unknown');return NextResponse.json({error:'Failed to update disruption'},{status:500});}
}
