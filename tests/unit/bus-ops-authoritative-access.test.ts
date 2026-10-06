import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/server',async()=>await import('next/server.js'));
const mocks = vi.hoisted(()=>({tenant:vi.fn(),user:vi.fn(),revocations:vi.fn(),permissions:vi.fn(),session:vi.fn(),auth:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:{}}));
vi.mock('@/lib/rls',()=>({withPlatformAdmin:async (_:unknown,fn: (tx: unknown) => Promise<unknown>)=>fn({tenant:{findUnique:mocks.tenant},user:{findUnique:mocks.user},$queryRawUnsafe:mocks.revocations})}));
vi.mock('@/lib/authz/session-permissions',()=>({resolveSessionPermissions:mocks.permissions}));
vi.mock('@/lib/tenant-context',()=>({requireAuthorizedTenant:mocks.auth}));
vi.mock('@/lib/tenant-session',()=>({getVerifiedRequestSession:mocks.session}));
import { NextRequest } from 'next/server';
import { busOpsAccessFor, ownsBusOpsEmployee } from '@/lib/bus-ops/access';
const request=(path='schedules',method='GET')=>new NextRequest('https://fleet.test/api/bus-ops/'+path,{method});
beforeEach(()=>{
  vi.resetAllMocks();
  mocks.auth.mockReturnValue({ok:true,tenantId:'t',userId:'u'});
  mocks.session.mockResolvedValue({tenantId:'t',userId:'u',role:'CUSTOM',issuedAt:Date.now()});
  mocks.tenant.mockResolvedValue({isActive:true,plan:'ENTERPRISE',modules:[{module:'bus-ops',isEnabled:true}]});
  mocks.user.mockResolvedValue({isActive:true,employeeId:'e'});
  mocks.revocations.mockResolvedValue([{revoked:false}]);
  mocks.permissions.mockResolvedValue(['bus-ops:view:trips']);
});
describe('current database policy',()=>{
  it('accepts explicit custom-role grants and binds the employee',async()=>{
    const req=request();expect((await busOpsAccessFor(req)).refusal).toBeNull();
    expect(await ownsBusOpsEmployee(req,'e')).toBe(true);
    expect(await ownsBusOpsEmployee(req,'other')).toBe(false);
    expect(mocks.permissions).toHaveBeenCalledTimes(1);
  });
  it('does not allow a view grant to depart',async()=>{
    expect((await busOpsAccessFor(request('schedules/s/depart','POST'))).refusal?.status).toBe(403);
  });
  it('blocks suspended tenant, disabled module, inactive user and revoked session',async()=>{
    mocks.tenant.mockResolvedValueOnce({isActive:false,modules:[]});
    expect((await busOpsAccessFor(request())).refusal?.status).toBe(403);
    mocks.tenant.mockResolvedValueOnce({isActive:true,modules:[]});
    expect((await busOpsAccessFor(request())).refusal?.status).toBe(403);
    mocks.user.mockResolvedValueOnce({isActive:false});
    expect((await busOpsAccessFor(request())).refusal?.status).toBe(403);
    mocks.revocations.mockResolvedValueOnce([{revoked:true}]);
    expect((await busOpsAccessFor(request())).refusal?.status).toBe(403);
  });
  it('fails closed when authoritative reads are unavailable',async()=>{
    mocks.permissions.mockRejectedValueOnce(new Error('unavailable'));
    expect((await busOpsAccessFor(request())).refusal?.status).toBe(503);
  });
  it('rejects trial writes and session/header tenant mismatch',async()=>{
    mocks.permissions.mockResolvedValue(['bus-ops:approve:trips']);
    mocks.tenant.mockResolvedValueOnce({isActive:true,plan:'TRIAL',modules:[{module:'bus-ops',isEnabled:true}]});
    expect((await busOpsAccessFor(request('schedules/s/depart','POST'))).refusal?.status).toBe(403);
    mocks.session.mockResolvedValueOnce({tenantId:'other',userId:'u'});
    expect((await busOpsAccessFor(request())).refusal?.status).toBe(401);
  });
  it('allows credential rotation on the permission alone (no passkey step-up)',async()=>{
    mocks.permissions.mockResolvedValue(['bus-ops:admin:device-credentials']);
    expect((await busOpsAccessFor(request('gateways/g/rotate-secret','POST'))).refusal).toBeNull();
    mocks.permissions.mockResolvedValue(['bus-ops:view:trips']);
    expect((await busOpsAccessFor(request('gateways/g/rotate-secret','POST'))).refusal?.status).toBe(403);
  });
});
