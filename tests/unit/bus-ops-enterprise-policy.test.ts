import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assessChecklist, PRETRIP_CHECKLIST } from '@/lib/bus-pretrip-checklist';
import { inspectionAllowsDeparture } from '@/lib/bus-ops/safety';
import { gatewayView } from '@/lib/bus-ops/gateway-view';
import { BUS_OPS_ROUTES, busOpsCapability } from '@/lib/authz/bus-ops-routes';
import { freshGatewayBatch } from '@/lib/bus-ops/gateway-freshness';
import { ALL_PERMISSIONS } from '@/lib/permissions';

const passing = () => PRETRIP_CHECKLIST.map(i => ({ key: i.key, ok: true }));
describe('complete safety evidence', () => {
  it('rejects empty, partial, duplicate, unknown and non-boolean results', () => {
    for (const items of [[], passing().slice(1), [...passing().slice(1), passing()[1]],
      [...passing().slice(1), {key:'unknown',ok:true}], passing().map((i,n) => n ? i : {...i,ok:'true'})]) {
      expect(() => assessChecklist(items as never)).toThrow();
    }
  });
  it('blocks safety failures but reports non-blocking failures', () => {
    const items = passing(); items.find(i => i.key === 'brakes')!.ok = false;
    expect(assessChecklist(items).overallPass).toBe(false);
    expect(assessChecklist(passing())).toMatchObject({overallPass:true, failCount:0});
  });
  it('rejects missing, stale, future and reassigned inspections', () => {
    const now = new Date('2026-10-03T10:00:00Z');
    const schedule = {vehicleId:'v',driverId:'d'};
    const check = {...schedule,performedAt:now,overallPass:true,checkItems:passing()};
    expect(inspectionAllowsDeparture(check,schedule,now)).toBe(true);
    for (const invalid of [null,{...check,vehicleId:'other'}, {...check,driverId:'other'},
      {...check,performedAt:new Date('2026-10-01')}, {...check,performedAt:new Date(now.getTime()+1)},
      {...check,checkItems:[]}, {...check,overallPass:false}]) {
      expect(inspectionAllowsDeparture(invalid,schedule,now)).toBe(false);
    }
  });
});
it('gateway views exclude stored and future credentials', () => {
  const result = gatewayView({id:'g',secret:'super-secret',nextSecret:'future-secret'} as never);
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(result.id).toBe('g');
});
function files(dir:string):string[] {
  return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => e.isDirectory() ? files(path.join(dir,e.name)) : e.name === 'route.ts' ? [path.join(dir,e.name)] : []);
}
describe('explicit permission coverage', () => {
  const root = path.resolve('src/app/api/bus-ops');
  for (const file of files(root)) {
    const template = path.relative(root,path.dirname(file)).split(path.sep).join('/');
    const methods = [...fs.readFileSync(file,'utf8').matchAll(/export\s+(?:async\s+function|const|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g)].map(m=>m[1]);
    for (const method of methods) it(`${method} ${template} maps to a catalogued capability`, () => {
      const capability = busOpsCapability('/api/bus-ops/'+template.replace(/\[[^\]]+\]/g,'example-id'),method);
      expect(capability).toBeTruthy();
      if (capability!.action !== 'external') expect(ALL_PERMISSIONS.some(p => p.module==='bus-ops' && p.action===capability!.action && p.resource===capability!.resource)).toBe(true);
    });
  }
  it('denies unknown routes and unsupported methods', () => {
    expect(busOpsCapability('/api/bus-ops/new-route','POST')).toBeNull();
    expect(busOpsCapability('/api/bus-ops/gateways/g/rotate-secret','GET')).toBeNull();
    expect(busOpsCapability('/api/bus-ops/schedules/s/depart','POST')).toEqual({action:'approve',resource:'trips'});
  });
  it('registry has no stale route templates', () => {
    const actual = files(root).map(file=>path.relative(root,path.dirname(file)).split(path.sep).join('/'));
    expect(Object.keys(BUS_OPS_ROUTES).filter(t=>!actual.includes(t))).toEqual([]);
  });
});

it('rejects stale, future, invalid and oversized signed gateway events', () => {
  const now = Date.now();
  expect(freshGatewayBatch({events:[{occurredAt:new Date(now).toISOString()}]},now)).toBe(true);
  for (const time of ['invalid',new Date(now-300001).toISOString(),new Date(now+300001).toISOString()]) expect(freshGatewayBatch({events:[{occurredAt:time}]},now)).toBe(false);
  expect(freshGatewayBatch({events:Array(501).fill({occurredAt:new Date(now).toISOString()})},now)).toBe(false);
});
