import { z } from 'zod';
import { PRETRIP_CHECKLIST } from '@/lib/bus-pretrip-checklist';
export const reportDisruptionSchema = z.object({
 requestKey:z.uuid(), reason:z.string().trim().min(5).max(2000),
 location:z.string().trim().max(300).optional(), severity:z.enum(['LOW','MEDIUM','HIGH','CRITICAL']).default('HIGH'),
}).strict();
export const disruptionCommandSchema = z.discriminatedUnion('action',[
 z.object({action:z.literal('recover'),expectedVersion:z.number().int().positive(),vehicleId:z.string().min(1).max(100),driverId:z.string().min(1).max(100),
  revisedEta:z.iso.datetime({offset:true}),notes:z.string().trim().min(5).max(2000),
  items:z.array(z.object({key:z.enum(PRETRIP_CHECKLIST.map(i=>i.key) as [string,...string[]]),ok:z.boolean(),note:z.string().max(500).optional()}).strict()).length(PRETRIP_CHECKLIST.length),
 }).strict(),
 z.object({action:z.literal('resolve'),expectedVersion:z.number().int().positive(),notes:z.string().trim().min(5).max(2000)}).strict(),
]);
export type ReportDisruptionInput=z.infer<typeof reportDisruptionSchema>;
export type DisruptionCommand=z.infer<typeof disruptionCommandSchema>;
