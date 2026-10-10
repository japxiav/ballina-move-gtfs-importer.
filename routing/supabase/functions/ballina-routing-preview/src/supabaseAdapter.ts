import type {Calendar,CalendarException,Route,Stop,StopTime,Timetable,Trip} from './types.ts';
/** Row adapters intentionally separate from database access and private credentials. */
export interface GtfsTables {
 feedVersion:string;
 stops:Record<string,unknown>[];
 routes:Record<string,unknown>[];
 trips:Record<string,unknown>[];
 stopTimes:Record<string,unknown>[];
 calendars:Record<string,unknown>[];
 calendarDates:Record<string,unknown>[];
}
function str(v:unknown):string{return v==null?'':String(v);}
function num(v:unknown):number|null{return v===null||v===undefined||v===''?null:Number.isFinite(Number(v))?Number(v):null;}
function normalDate(v:unknown):string{return str(v).slice(0,10)};
/** Only explicitly supported GTFS Schedule route_type values may enter the planner.
 * 2=rail; 3=bus. Other standard modes (including 4=ferry), extended route types,
 * missing and invalid types are intentionally excluded, never relabeled as buses.
 */
function supportedMode(routeType:unknown):Route['mode']|null {
 switch(num(routeType)) {
  case 2: return 'rail';
  case 3: return 'bus';
  default: return null;
 }
}

/** Call only with rows loaded for ONE active feed version by a trusted server-side repository. */
export function fromSupabaseTables(t:GtfsTables):Timetable {
 if(!t.feedVersion)throw new Error('missing_gtfs_version');
 for(const [table,rows] of Object.entries({stops:t.stops,routes:t.routes,trips:t.trips,stopTimes:t.stopTimes,calendars:t.calendars,calendarDates:t.calendarDates})){
  if(!Array.isArray(rows)||rows.some(row=>row.version!==t.feedVersion))throw new Error(`mixed_gtfs_version_${table}`);
 }
 const stops:Stop[]=t.stops.filter(s=>num(s.stop_lat)!==null&&num(s.stop_lon)!==null).map(s=>({id:str(s.stop_id),name:str(s.stop_name),lat:num(s.stop_lat)!,lon:num(s.stop_lon)!,code:str(s.stop_code)||null,description:str(s.stop_desc)||null,boarding:{confidence:'official_unverified'}}));
 // Exclude only declared unsupported modalities and their dependent trips/times.
 // Truly missing route references stay visible to the snapshot integrity check.
 const typedRoutes=t.routes.map(row=>({row,id:str(row.route_id),mode:supportedMode(row.route_type)}));
 const routeModes=new Map<string,Route['mode']|null>();
 for(const route of typedRoutes){
  if(routeModes.has(route.id)&&routeModes.get(route.id)!==route.mode)throw new Error('conflicting_gtfs_route_type');
  routeModes.set(route.id,route.mode);
 }
 const routes:Route[]=typedRoutes.filter((r):r is typeof r & {mode:Route['mode']}=>r.mode!==null)
  .map(({row,id,mode})=>({id,name:str(row.route_short_name)||str(row.route_long_name)||id,mode}));
 const removedTripIds=new Set(t.trips.filter(x=>routeModes.has(str(x.route_id))&&routeModes.get(str(x.route_id))===null).map(x=>str(x.trip_id)));
 const trips:Trip[]=t.trips.filter(x=>!removedTripIds.has(str(x.trip_id)))
  .map(x=>({id:str(x.trip_id),routeId:str(x.route_id),serviceId:str(x.service_id),headsign:str(x.trip_headsign)||null}));
 const stopTimes:StopTime[]=t.stopTimes.filter(s=>!removedTripIds.has(str(s.trip_id)))
  .map(s=>({tripId:str(s.trip_id),stopId:str(s.stop_id),sequence:num(s.stop_sequence)??-1,arrivalSeconds:num(s.arrival_seconds),departureSeconds:num(s.departure_seconds),pickupType:num(s.pickup_type),dropOffType:num(s.drop_off_type)}));
 const calendars:Calendar[]=t.calendars.map(c=>({serviceId:str(c.service_id),startDate:normalDate(c.start_date),endDate:normalDate(c.end_date),weekdays:[c.sunday===true,c.monday===true,c.tuesday===true,c.wednesday===true,c.thursday===true,c.friday===true,c.saturday===true]}));
 const exceptions:CalendarException[]=t.calendarDates.map(c=>({serviceId:str(c.service_id),date:normalDate(c.service_date),type:num(c.exception_type)===1?1:2}));
 return {feedVersion:t.feedVersion,timezone:'Europe/Dublin',stops,routes,trips,stopTimes,calendars,exceptions};
}
