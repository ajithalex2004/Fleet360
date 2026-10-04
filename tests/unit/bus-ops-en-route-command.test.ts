import { beforeEach,describe,expect,it,vi } from 'vitest';
import { NextRequest,NextResponse } from 'next/server';
const m=vi.hoisted(()=>({guard:vi.fn(),auth:vi.fn(),rls:vi.fn(),held:vi.fn(),publish:vi.fn(),audit:vi.fn()}));
vi.mock('@/lib/bus-ops/access',()=>({requireBusOpsRequest:m.guard}));
vi.mock('@/lib/tenant-context',()=>({requireAuthorizedTenant:m.auth}));
vi.mock('@/lib/prisma',()=>({prisma:{}}));
vi.mock('@/lib/rls',()=>({withTenantRls:m.rls}));
vi.mock('@/lib/bus-ops/disruptions',()=>({hasUnrecoveredDisruption:m.held}));
vi.mock('@/events/event-bus',()=>({getEventBus:()=>({publish:m.publish})}));
vi.mock('@/lib/audit',()=>({writeRequiredAudit:m.audit}));
import { POST } from '@/app/api/bus-ops/schedules/[id]/en-route/route';
function fixture(status='STARTED'){return {$queryRawUnsafe:vi.fn(),tripSchedule:{findFirst:vi.fn().mockResolvedValue({id:'trip',tenantId:'tenant-a',status,tripNumber:'T1',vehicleId:'bus',driverId:'driver'}),update:vi.fn().mockResolvedValue({id:'trip',status:'EN_ROUTE'})}};}
const req=(body:unknown={})=>new NextRequest('http://localhost/api/bus-ops/schedules/trip/en-route',{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json'}});
const params={params:Promise.resolve({id:'trip'})};
beforeEach(()=>{vi.clearAllMocks();m.guard.mockResolvedValue(null);m.auth.mockReturnValue({ok:true,tenantId:'tenant-a',userId:'dispatcher'});m.held.mockResolvedValue(false);m.publish.mockResolvedValue({eventId:'event'});m.audit.mockResolvedValue(undefined);});
describe('dispatcher en-route command',()=>{
 it('denies authorization before opening a business transaction',async()=>{m.guard.mockResolvedValue(NextResponse.json({error:'Forbidden'},{status:403}));expect((await POST(req(),params)).status).toBe(403);expect(m.rls).not.toHaveBeenCalled();});
 it('rejects direct status and tenant fields',async()=>{expect((await POST(req({status:'EN_ROUTE',tenantId:'other'}),params)).status).toBe(400);expect(m.rls).not.toHaveBeenCalled();});
 it('locks a tenant-owned trip and atomically awaits event and audit',async()=>{const f=fixture();m.rls.mockImplementation((_p,_t,fn)=>fn(f));expect((await POST(req(),params)).status).toBe(200);expect(f.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('tenant_id::text=$2 FOR UPDATE'),'trip','tenant-a');expect(f.tripSchedule.findFirst).toHaveBeenCalledWith({where:{id:'trip',tenantId:'tenant-a',deletedAt:null}});expect(m.publish).toHaveBeenCalledWith(expect.objectContaining({eventType:'trip.en_route',tenantId:'tenant-a',actor:'dispatcher'}),f);expect(m.audit).toHaveBeenCalled();});
 it('hides foreign trips',async()=>{const f=fixture();f.tripSchedule.findFirst.mockResolvedValue(null);m.rls.mockImplementation((_p,_t,fn)=>fn(f));expect((await POST(req(),params)).status).toBe(404);expect(f.tripSchedule.update).not.toHaveBeenCalled();});
 it.each(['SCHEDULED','CANCELLED','COMPLETED','MERGED'])('refuses %s to en route',async status=>{const f=fixture(status);m.rls.mockImplementation((_p,_t,fn)=>fn(f));expect((await POST(req(),params)).status).toBe(409);expect(f.tripSchedule.update).not.toHaveBeenCalled();});
 it('refuses resuming a disrupted trip without an inspected substitute',async()=>{const f=fixture();m.rls.mockImplementation((_p,_t,fn)=>fn(f));m.held.mockResolvedValue(true);expect((await POST(req(),params)).status).toBe(409);expect(f.tripSchedule.update).not.toHaveBeenCalled();});
 it('deduplicates en-route retries without emitting a second event',async()=>{const f=fixture('EN_ROUTE');m.rls.mockImplementation((_p,_t,fn)=>fn(f));expect((await POST(req(),params)).status).toBe(200);expect(f.tripSchedule.update).not.toHaveBeenCalled();expect(m.publish).not.toHaveBeenCalled();});
 it.each(['audit','publish'] as const)('propagates %s failures out of the transaction',async key=>{const f=fixture();m.rls.mockImplementation((_p,_t,fn)=>fn(f));m[key].mockRejectedValue(new Error('Required write unavailable'));expect((await POST(req(),params)).status).toBe(500);});
});
