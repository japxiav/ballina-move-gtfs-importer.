import type {Timetable,LatLon} from './types';
import {boardingInstruction,proximityMeters} from './boarding';

/** Uses only stops served by known GTFS trips; never calls this walking distance. */
export function nearbyStops(timetable:Timetable,origin:LatLon,radiusMeters=1200,limit=8){
  if(!Number.isFinite(origin.lat)||!Number.isFinite(origin.lon)||
     !Number.isInteger(radiusMeters)||radiusMeters<100||radiusMeters>2500||
     !Number.isInteger(limit)||limit<1||limit>15)throw new Error('invalid_nearby_params');
  const trips=new Map(timetable.trips.map(t=>[t.id,t]));
  const routes=new Map(timetable.routes.map(r=>[r.id,r]));
  const used=new Map<string,Set<string>>();
  for(const st of timetable.stopTimes){
    const trip=trips.get(st.tripId);
    // Arrival-only and special-arrangement stops must NOT advertise a bus as boardable.
    if(!trip||!routes.has(trip.routeId)||st.departureSeconds===null||
       !(st.pickupType==null||st.pickupType===0))continue;
    const set=used.get(st.stopId)??new Set<string>();
    set.add(trip.routeId);used.set(st.stopId,set);
  }
  return timetable.stops.flatMap(stop=>{
    const routeIds=used.get(stop.id);
    if(!routeIds||!Number.isFinite(stop.lat)||!Number.isFinite(stop.lon))return [];
    const meters=proximityMeters(origin,stop);
    if(meters>radiusMeters)return [];
    const routeNames=[...routeIds].map(id=>routes.get(id)!)
      .filter(route=>route.mode==='bus').map(route=>route.name).sort((a,b)=>a.localeCompare(b));
    if(!routeNames.length)return [];
    return [{...boardingInstruction(stop),distanceStraightLineMeters:Math.round(meters),routeNames}];
  }).sort((a,b)=>a.distanceStraightLineMeters-b.distanceStraightLineMeters||a.stopId.localeCompare(b.stopId)).slice(0,limit);
}
