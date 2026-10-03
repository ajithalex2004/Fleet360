import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('next/server',async()=>await import('next/server.js'));
const mocks=vi.hoisted(()=>({parent:vi.fn(),child:vi.fn(),guard:vi.fn()}));
vi.mock('@/lib/bus-ops/access',()=>({requireBusOpsRequest:mocks.guard}));
vi.mock('@/lib/prisma',()=>({prisma:{}}));
vi.mock('@/lib/tenant-context',()=>({requireAuthorizedTenant:()=>({ok:true,tenantId:'tenant-a',userId:'user-a'}),stripTenantOwnershipFields:(body:unknown)=>body}));
vi.mock('@/lib/rls',()=>({withTenantRls:async (_:unknown,_tenant:unknown,fn:Function)=>fn({vehicle:{findFirst:mocks.parent},staffMember:{findFirst:mocks.parent},vehicleBeacon:{findUnique:mocks.child,upsert:mocks.child,deleteMany:mocks.child},bleGateway:{findUnique:mocks.child,upsert:mocks.child,deleteMany:mocks.child},staffRfidTag:{findUnique:mocks.child,upsert:mocks.child,deleteMany:mocks.child}})}));
import { NextRequest } from 'next/server';
import * as beacon from '@/app/api/bus-ops/vehicles/[id]/beacon/route';
import * as gateway from '@/app/api/bus-ops/vehicles/[id]/gateway/route';
import * as rfid from '@/app/api/bus-ops/staff/[id]/rfid-tag/route';
beforeEach(()=>{vi.resetAllMocks();mocks.guard.mockResolvedValue(null);mocks.parent.mockResolvedValue(null);});
for (const [name,handlers] of Object.entries({beacon,gateway,rfid})) {
  for (const method of ['GET','PUT','DELETE'] as const) it(`${method} ${name} refuses foreign parents before reading or writing child devices`,async()=>{
    const req=new NextRequest('https://fleet.test/api/bus-ops/vehicles/foreign/'+name,{method,...(method==='PUT'?{body:'{}'}:{})});
    const response=await handlers[method](req,{params:Promise.resolve({id:'foreign'})});
    expect(response.status).toBe(404);
    expect(mocks.parent).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({id:'foreign',tenantId:'tenant-a'})}));
    expect(mocks.child).not.toHaveBeenCalled();
  });
}
