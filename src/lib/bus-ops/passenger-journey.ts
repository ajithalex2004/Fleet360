import { predictEta, type TrackingPoint } from '@/lib/logistics/eta-predictor';

export const GPS_FRESH_MS = 120_000;
export interface JourneyStop { id:string; stopName:string; gpsLat:number|null; gpsLng:number|null; estimatedArrivalMins:number|null }
export interface JourneyInput {
 now:Date; passengerStatus:string; boardingStopId:string|null; boardingStopName:string|null;
 alightingStopId:string|null; alightingStopName:string|null;
 tripStatus:string|null; departureTime:Date; capacity:number|null; onboard:number; reserved:number;
 stops:JourneyStop[]; visitedStopIds:string[]; pings:TrackingPoint[];
 disruption:{status:string; revisedEta:string|null; recoveredAt:string|null}|null;
}
export function buildPassengerJourney(input:JourneyInput) {
 const {now,passengerStatus,tripStatus}=input;
 const phase=passengerStatus==='BOARDED'?'dropoff':'pickup';
 const id=phase==='pickup'?input.boardingStopId:input.alightingStopId;
 const name=phase==='pickup'?input.boardingStopName:input.alightingStopName;
 const matches=input.stops.filter(s=>id?s.id===id:s.stopName===name);
 const target=matches.length===1?matches[0]:null;
 const plannedAt=target?.estimatedArrivalMins!=null?new Date(input.departureTime.getTime()+target.estimatedArrivalMins*60_000).toISOString():null;
 const capacity=input.capacity!=null && input.capacity>0?input.capacity:null;
 const base={asOf:now.toISOString(),passengerStatus,tripStatus,phase,
  target:target?{id:target.id,name:target.stopName}:null,plannedAt,
  revisedDestinationArrivalAt:input.disruption?.revisedEta ?? null,
  occupancy:{onboard:input.onboard,reserved:input.reserved,capacity,seatsNotOccupied:capacity==null?null:Math.max(0,capacity-input.onboard),overCapacity:capacity!=null&&input.onboard>capacity,source:'attendance' as const},
 };
 const output=(state:string,reason:string,etaAt:string|null=null,lastGpsAt:string|null=null,confidence:string='low',method:string='none')=>({...base,state,reason,etaAt,lastGpsAt,confidence,method});
 if(['COMPLETED','CANCELLED','MERGED'].includes(tripStatus ?? ''))return output('terminal',`Trip ${(tripStatus ?? '').toLowerCase()}`);
 if(['ALIGHTED','CANCELLED','ABSENT','NO_SHOW','WAITLISTED'].includes(passengerStatus))return output('not-travelling',`Passenger ${passengerStatus.toLowerCase().replaceAll('_',' ')}`);
 if(input.disruption?.status==='REPORTED')return output('disrupted','Awaiting an inspected substitute bus and driver');
 if(!target)return output('unavailable',`Your ${phase==='pickup'?'pickup':'drop-off'} stop is not uniquely linked to this trip`);
 if(!['STARTED','EN_ROUTE','DEPARTED','IN_TRANSIT'].includes(tripStatus ?? ''))return output('scheduled','Scheduled time; the trip has not started',plannedAt,null,'low','planned');
 if(input.visitedStopIds.includes(target.id))return output('stop-reached',`Bus reached your ${phase==='pickup'?'pickup':'drop-off'} stop`);
 const cutoff=Math.max(input.departureTime.getTime(),input.disruption?.recoveredAt?Date.parse(input.disruption.recoveredAt):0);
 const valid=input.pings.filter(p=>Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180&&Number.isFinite(Date.parse(p.occurredAt))&&Date.parse(p.occurredAt)<=now.getTime()&&Date.parse(p.occurredAt)>=cutoff).sort((a,b)=>Date.parse(b.occurredAt)-Date.parse(a.occurredAt));
 const lastGpsAt=valid[0]?.occurredAt ?? null;
 if(!lastGpsAt)return output('gps-missing','Live location is unavailable; scheduled time is shown separately');
 if(now.getTime()-Date.parse(lastGpsAt)>GPS_FRESH_MS)return output('gps-stale','Location is out of date; live ETA is paused',null,lastGpsAt);
 if(target.gpsLat==null||target.gpsLng==null||Math.abs(target.gpsLat)>90||Math.abs(target.gpsLng)>180)return output('unavailable','Stop coordinates are unavailable',null,lastGpsAt);
 const prediction=predictEta({now:now.toISOString(),trackingPoints:valid.filter(p=>now.getTime()-Date.parse(p.occurredAt)<=5*60_000),destination:{latitude:target.gpsLat,longitude:target.gpsLng},plannedArrivalAt:plannedAt});
 return output(prediction.method==='arrived'?'near-stop':'live',prediction.method==='arrived'?'Bus is near your stop':prediction.reason,prediction.etaAt,lastGpsAt,prediction.confidence,prediction.method);
}
export type PassengerJourney=ReturnType<typeof buildPassengerJourney>;
