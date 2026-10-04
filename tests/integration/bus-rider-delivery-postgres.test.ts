/** Runs only on a dedicated localhost database. Real PostgreSQL locks and forced RLS; no transports. */
import { readFileSync } from 'fs';
import { PrismaClient, type Prisma } from '@prisma/client';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/email',()=>({sendEmail:vi.fn()}));
vi.mock('@/lib/sms',()=>({sendSms:vi.fn()}));
vi.mock('@/lib/whatsapp',()=>({sendWhatsApp:vi.fn()}));
import { claimRiderDeliveries } from '@/lib/jobs/bus-rider-notifications';
const connection=process.env.TEST_RIDER_DATABASE_URL;
const suite=connection ? describe : describe.skip;
let db:PrismaClient;
async function scoped<T>(tenant:string,fn:(tx:Prisma.TransactionClient)=>Promise<T>):Promise<T>{
 return db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET LOCAL ROLE fleet360_rider_test_role');
  await tx.$queryRaw`SELECT set_config('app.tenant_id',${tenant},true)`;
  return fn(tx);
 });
}
async function applyStopMigration(){
 const sql=readFileSync('prisma/migrations/20261004080000_bus_ops_stop_delay_marker/migration.sql','utf8');
 const block=sql.indexOf('DO $$');
 for(const statement of sql.slice(0,block).split(';').map(s=>s.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
 await db.$executeRawUnsafe(sql.slice(block));
}
async function insert(id:string,tenant:string,status='PENDING'){
 await db.$executeRaw`INSERT INTO bus_rider_deliveries(id,tenant_id,event_id,event_type,schedule_id,passenger_id,staff_member_id,channel,recipient,subject,body,status,expires_at)
 VALUES(${id},${tenant},'event1','trip.arriving','trip1','passenger1','staff1','EMAIL','synthetic@example.test','Update','Body',${status},now()+interval '1 hour')`;
}
suite('rider delivery PostgreSQL isolation and claims',()=>{
 beforeAll(async()=>{
  const url=new URL(connection!);
  if(!['localhost','127.0.0.1'].includes(url.hostname) || url.pathname!=='/fleet360_rider_test') throw new Error('Requires dedicated localhost fleet360_rider_test database');
  db=new PrismaClient({datasources:{db:{url:connection}}});
  // Abort if these tables already exist: never overwrite an existing dataset.
  const exists=await db.$queryRaw<Array<{name:string|null}>>`SELECT to_regclass('public.bus_rider_deliveries')::text AS name`;
  if(exists[0].name) throw new Error('Use a fresh isolated database for this test');
  const migration=readFileSync('prisma/migrations/20261004090000_bus_rider_notifications/migration.sql','utf8');
  for(const sql of migration.split(';').map(s=>s.trim()).filter(Boolean)) await db.$executeRawUnsafe(sql);
  await applyStopMigration();
  await db.$executeRawUnsafe('CREATE ROLE fleet360_rider_test_role NOLOGIN');
  await db.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO fleet360_rider_test_role');
  await db.$executeRawUnsafe('GRANT SELECT,INSERT,UPDATE,DELETE ON bus_rider_deliveries,bus_rider_notification_rules,trip_stop_visits TO fleet360_rider_test_role');
 });
 beforeEach(async()=>{await db.$executeRawUnsafe('TRUNCATE bus_rider_deliveries,bus_rider_notification_rules,trip_stop_visits');});
 afterAll(async()=>{if(db) await db.$disconnect();});
 it('forces RLS for reads and rejects cross-tenant writes',async()=>{
  await insert('a','tenant-a');await insert('b','tenant-b');
  const rows=await scoped('tenant-a',tx=>tx.$queryRaw<Array<{id:string}>>`SELECT id FROM bus_rider_deliveries`);
  expect(rows.map(r=>r.id)).toEqual(['a']);
  await expect(scoped('tenant-a',tx=>tx.$executeRaw`INSERT INTO bus_rider_notification_rules(tenant_id,event_type,subject,body)
   VALUES('tenant-b','trip.arriving','Update','Body')`)).rejects.toThrow();
 });
 it('deduplicates by tenant, event, passenger and channel',async()=>{
  await insert('a','tenant-a');
  const count=await scoped('tenant-a',tx=>tx.$executeRaw`INSERT INTO bus_rider_deliveries(id,tenant_id,event_id,event_type,schedule_id,passenger_id,staff_member_id,channel,recipient,subject,body,expires_at)
   SELECT 'duplicate',tenant_id,event_id,event_type,schedule_id,passenger_id,staff_member_id,channel,recipient,subject,body,expires_at FROM bus_rider_deliveries WHERE id='a'
   ON CONFLICT(tenant_id,event_id,passenger_id,channel) DO NOTHING`);
  expect(count).toBe(0);
 });
 it('gives concurrent workers one exclusive claim',async()=>{
  await insert('a','tenant-a');
  const results=await Promise.all([scoped('tenant-a',tx=>claimRiderDeliveries(tx,'tenant-a')),scoped('tenant-a',tx=>claimRiderDeliveries(tx,'tenant-a'))]);
  expect(results.flat()).toHaveLength(1);expect(results.flat()[0].attempts).toBe(1);
 });
 it('does not claim another tenant and does not replay sent or uncertain rows',async()=>{
  await insert('a','tenant-a','SENT');await insert('b','tenant-b');
  await db.$executeRaw`UPDATE bus_rider_deliveries SET status='UNCERTAIN' WHERE id='a'`;
  expect(await scoped('tenant-a',tx=>claimRiderDeliveries(tx,'tenant-a'))).toEqual([]);
 });
 it('parks an expired sender lease instead of sending again',async()=>{
  await insert('a','tenant-a','SENDING');await db.$executeRaw`UPDATE bus_rider_deliveries SET claimed_at=now()-interval '11 minutes' WHERE id='a'`;
  expect(await scoped('tenant-a',tx=>claimRiderDeliveries(tx,'tenant-a'))).toEqual([]);
  const rows=await scoped('tenant-a',tx=>tx.$queryRaw<Array<{status:string}>>`SELECT status FROM bus_rider_deliveries WHERE id='a'`);
  expect(rows[0].status).toBe('UNCERTAIN');
 });
 it('refuses outcome updates with a stale sender token',async()=>{
  await insert('a','tenant-a');const [claim]=await scoped('tenant-a',tx=>claimRiderDeliveries(tx,'tenant-a'));
  const changed=await scoped('tenant-a',tx=>tx.$executeRaw`UPDATE bus_rider_deliveries SET status='SENT'
   WHERE id='a' AND tenant_id='tenant-a' AND status='SENDING' AND claim_token='stale-token'`);
  expect(changed).toBe(0);expect(claim.claim_token).toBeTruthy();
 });
 it('provisions legacy stop visits on a fresh database and preserves markers on replay',async()=>{
  await scoped('tenant-a',tx=>tx.$executeRaw`INSERT INTO trip_stop_visits(id,tenant_id,schedule_id,stop_id,approach_notified_at,delay_notified_at)
   VALUES('visit-a','tenant-a','trip-a','stop-a',now(),now())`);
  await scoped('tenant-b',tx=>tx.$executeRaw`INSERT INTO trip_stop_visits(id,tenant_id,schedule_id,stop_id)
   VALUES('visit-b','tenant-b','trip-b','stop-b')`);
  const [before]=await scoped('tenant-a',tx=>tx.$queryRaw<Array<{approach_notified_at:Date;delay_notified_at:Date}>>`SELECT approach_notified_at,delay_notified_at FROM trip_stop_visits`);
  await applyStopMigration();
  const rows=await scoped('tenant-a',tx=>tx.$queryRaw<Array<{id:string;approach_notified_at:Date;delay_notified_at:Date}>>`SELECT id,approach_notified_at,delay_notified_at FROM trip_stop_visits`);
  expect(rows).toHaveLength(1);expect(rows[0].id).toBe('visit-a');
  expect(rows[0].approach_notified_at).toEqual(before.approach_notified_at);expect(rows[0].delay_notified_at).toEqual(before.delay_notified_at);
  await expect(scoped('tenant-a',tx=>tx.$executeRaw`INSERT INTO trip_stop_visits(id,tenant_id,schedule_id,stop_id)
   VALUES('forged','tenant-b','trip-forged','stop-forged')`)).rejects.toThrow();
 });

});
