/** Database constraints, RLS and dispatcher serialization on a fresh, isolated database. */
import { readFileSync } from 'fs';
import { PrismaClient,type Prisma } from '@prisma/client';
import { afterAll,beforeAll,beforeEach,describe,expect,it } from 'vitest';
const connection=process.env.TEST_DISRUPTION_DATABASE_URL;
const suite=connection?describe:describe.skip;
let db:PrismaClient;
async function scoped<T>(tenant:string,fn:(tx:Prisma.TransactionClient)=>Promise<T>){return db.$transaction(async tx=>{
 await tx.$executeRawUnsafe('SET LOCAL ROLE fleet360_disruption_test_role');
 await tx.$queryRaw`SELECT set_config('app.tenant_id',${tenant},true)`;return fn(tx);
});}
async function report(tx:Prisma.TransactionClient,id:string,tenant='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',trip='trip-a',key=id){
 return tx.$executeRaw`INSERT INTO bus_trip_disruptions(id,tenant_id,schedule_id,request_key,request_hash,incident_id,reason,severity,reported_by)
 VALUES(${id},${tenant}::uuid,${trip},${key},'hash','11111111-1111-4111-8111-111111111111'::uuid,'Synthetic breakdown','HIGH','test-dispatcher')`;
}
suite('disruption PostgreSQL constraints and transactions',()=>{
 beforeAll(async()=>{
  const url=new URL(connection!);if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/fleet360_disruption_test')throw new Error('Requires fresh localhost fleet360_disruption_test database');
  db=new PrismaClient({datasources:{db:{url:connection}}});
  const exists=await db.$queryRaw<Array<{name:string|null}>>`SELECT to_regclass('public.trip_schedules')::text AS name`;
  if(exists[0].name)throw new Error('Refusing existing dataset');
  await db.$executeRawUnsafe('CREATE TABLE trip_schedules(id text PRIMARY KEY,tenant_id uuid NOT NULL)');
  await db.$executeRawUnsafe("INSERT INTO trip_schedules VALUES('trip-a','aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'),('trip-a2','aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'),('trip-b','bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb')");
  const sql=readFileSync('prisma/migrations/20261004100000_bus_trip_disruptions/migration.sql','utf8');
  for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await db.$executeRawUnsafe(statement);
  await db.$executeRawUnsafe('CREATE ROLE fleet360_disruption_test_role NOLOGIN');
  await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO fleet360_disruption_test_role');
  await db.$executeRawUnsafe('GRANT SELECT,INSERT,UPDATE ON trip_schedules,bus_trip_disruptions TO fleet360_disruption_test_role');
 });
 beforeEach(async()=>{await db.$executeRawUnsafe('TRUNCATE bus_trip_disruptions');});
 afterAll(async()=>{if(db)await db.$disconnect();});
 it('forces tenant read and write isolation under a non-bypass role',async()=>{
  await scoped('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',tx=>report(tx,'a'));await scoped('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb',tx=>report(tx,'b','bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb','trip-b'));
  const rows=await scoped('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',tx=>tx.$queryRaw<Array<{id:string}>>`SELECT id FROM bus_trip_disruptions`);expect(rows.map(r=>r.id)).toEqual(['a']);
  await expect(scoped('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',tx=>report(tx,'forged','bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb','trip-b'))).rejects.toThrow();
 });
 it('rejects attaching a same-tenant disruption to a foreign trip',async()=>{
  await expect(scoped('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',tx=>report(tx,'foreign-parent','aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa','trip-b'))).rejects.toThrow();
 });
 it('allows only one open response per trip even without the application lock',async()=>{
  const result=await Promise.allSettled([scoped('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',tx=>report(tx,'a')),scoped('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',tx=>report(tx,'b'))]);
  expect(result.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(result.filter(r=>r.status==='rejected')).toHaveLength(1);
 });
 it('serializes competing reports on the trip row so the second sees the first',async()=>{
  const respond=(id:string)=>scoped('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',async tx=>{
   await tx.$queryRaw`SELECT id FROM trip_schedules WHERE id='trip-a' AND tenant_id='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' FOR UPDATE`;
   const existing=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM bus_trip_disruptions WHERE tenant_id::text='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa' AND schedule_id='trip-a' AND status<>'RESOLVED'`;
   if(existing.length)return false;await report(tx,id);return true;
  });
  expect((await Promise.all([respond('a'),respond('b')])).sort()).toEqual([false,true]);
 });
 it('enforces report idempotency keys across trips within a tenant',async()=>{
  await scoped('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',tx=>report(tx,'a','aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa','trip-a','same-key'));
  await expect(scoped('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',tx=>report(tx,'a2','aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa','trip-a2','same-key'))).rejects.toThrow();
 });
 it('rolls back a failed transaction without leaving an open disruption',async()=>{
  await expect(scoped('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',async tx=>{await report(tx,'rollback');throw new Error('Required audit unavailable');})).rejects.toThrow('Required audit');
  const rows=await scoped('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',tx=>tx.$queryRaw<Array<{id:string}>>`SELECT id FROM bus_trip_disruptions`);expect(rows).toHaveLength(0);
 });
 it('requires recovery/closure evidence and permits a new report after documented closure',async()=>{
  await scoped('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',tx=>report(tx,'a'));
  await expect(scoped('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',tx=>tx.$executeRaw`UPDATE bus_trip_disruptions SET status='RECOVERED' WHERE id='a'`)).rejects.toThrow();
  await expect(scoped('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',tx=>tx.$executeRaw`UPDATE bus_trip_disruptions SET status='RESOLVED' WHERE id='a'`)).rejects.toThrow();
  await scoped('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',tx=>tx.$executeRaw`UPDATE bus_trip_disruptions SET status='RESOLVED',resolved_at=now(),resolution_notes='Synthetic service restored' WHERE id='a'`);
  await expect(scoped('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa',tx=>report(tx,'new-report'))).resolves.toBe(1);
 });
});
