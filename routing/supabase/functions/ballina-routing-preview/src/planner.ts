import {planJourneys} from './engine.ts';
import {buildPedestrianPaths,type WalkingRouter,type BuildPathsOptions} from './pedestrian.ts';
import type {Journey,LatLon,PlanRequest,Stop,Timetable,PedestrianPaths} from './types.ts';
import {activeService,offsetServiceDate,dstTransitionDay,validDate} from './time.ts';
import {proximityMeters,routableStopCoordinate} from './boarding.ts';

export interface DoorToDoorRequest extends PlanRequest { origin:LatLon;destination:LatLon; }
export interface DoorToDoorOptions extends BuildPathsOptions {
  /** Legacy switch; new callers should pass modes explicitly. Defaults to bus only. */
  includeRail?:boolean;
  /** Explicit scheduled modes, independent of realtime availability. */
  modes?:Array<'bus'|'rail'>;
  /** Maximum direct walking distance; defaults to 1.4 km, or 0 to disable. */
  maxDirectWalkMeters?:number;
}
export interface PlannedJourneys {journeys:Journey[];walkingRequestsBudget:number;feedVersion:string;coverage?:PedestrianPaths['coverage'];}

/** A conservative, GTFS-only preflight. If false, there is no boardable trip
 * within the planner's first-boarding window. Do not pay a street provider for
 * speculative transit access/egress in that case. Direct walking stays separate.
 * Treat all nearby service dates exactly as the engine does; do not reject an
 * overnight 25:00 trip merely because its service date was yesterday. */
function hasBoardableServiceInWindow(data:Timetable, req:DoorToDoorRequest):boolean {
  if(!validDate(req.serviceDate))throw new Error('invalid_service_date');
  const serviceDates=[-1,0,1].map(delta=>({delta,date:offsetServiceDate(req.serviceDate,delta)}))
    .filter(x=>x.delta===0||!dstTransitionDay(x.date));
  const windowEnd=req.departAfterSeconds+18*3600;
  const activeCache=new Map<string,boolean>();
  const tripById=new Map(data.trips.map(t=>[t.id,t]));
  for(const row of data.stopTimes){
    if(row.departureSeconds==null||(row.pickupType!=null&&row.pickupType!==0))continue;
    const trip=tripById.get(row.tripId);
    if(!trip)continue;
    for(const {delta,date} of serviceDates){
      const dep=row.departureSeconds+delta*86400;
      if(dep<req.departAfterSeconds||dep>windowEnd)continue;
      const key=trip.serviceId+'|'+date;
      let ok=activeCache.get(key);
      if(ok===undefined){ok=activeService(trip.serviceId,date,data.calendars,data.exceptions);activeCache.set(key,ok);}
      if(ok)return true;
    }
  }
  return false;
}

/** Cheap, timetable-only candidate discovery, before paid pedestrian queries.
 * Directional bus topology helps prioritize a 5th useful stop over four closer
 * stops on irrelevant services. All actual transfers still require walking
 * routes from the provider, and departure times are validated by the engine. */
function candidateStopPreferences(data:Timetable,req:DoorToDoorRequest,maxRadius=1500,transferReach=2500):{
  origin:string[];destination:string[];directOrigin:string[];directDestination:string[]
}{
  const originNear=data.stops.filter(s=>proximityMeters(req.origin,s)<=maxRadius);
  const destNear=data.stops.filter(s=>proximityMeters(req.destination,s)<=maxRadius);
  const originIds=new Set(originNear.map(s=>s.id));
  const destinationIds=new Set(destNear.map(s=>s.id));
  if(!originIds.size||!destinationIds.size)return {origin:[],destination:[],directOrigin:[],directDestination:[]};
  const stopMap=new Map(data.stops.map(s=>[s.id,s]));
  const routeTripIds=new Set(data.trips.map(t=>t.id));
  const timesByTrip=new Map<string,Timetable['stopTimes']>();
  for(const row of data.stopTimes){
    if(!routeTripIds.has(row.tripId))continue;
    const list=timesByTrip.get(row.tripId)??[];list.push(row);timesByTrip.set(row.tripId,list);
  }
  const weekdays=new Map<string,boolean>();
  const serviceDays=[-1,0,1].map(delta=>({delta,date:offsetServiceDate(req.serviceDate,delta)}))
    .filter(x=>x.delta===0||!dstTransitionDay(x.date));
  const latest=req.departAfterSeconds+18*3600;
  const graph=new Map<string,Set<string>>();
  const directOrigin=new Set<string>(),directDestination=new Set<string>();
  const timeFeasibleOrigin=new Set<string>();
  const walkingCap=Math.max(0,req.maxWalkingMeters??2500);
  const minBoarding=Math.max(0,req.minBoardingSeconds??60);
  // Optimistic walking speed (3 m/s) is deliberately FASTER than most people.
  // Reject only departures physically impossible even under this generous bound.
  const earliestFromOrigin=new Map(originNear.map(stop=>[stop.id,
    req.departAfterSeconds+Math.ceil(proximityMeters(req.origin,stop)/3)+minBoarding]));
  for(const trip of data.trips){
    const rows=(timesByTrip.get(trip.id)??[]).sort((a,b)=>a.sequence-b.sequence);
    if(rows.length<2)continue;
    const activeDays=serviceDays.filter(({delta,date})=>{
      const key=trip.serviceId+'|'+date;
      let ok=weekdays.get(key);
      if(ok===undefined){ok=activeService(trip.serviceId,date,data.calendars,data.exceptions);weekdays.set(key,ok);}
      return ok&&rows.some(r=>r.departureSeconds!=null&&r.departureSeconds+delta*86400>=req.departAfterSeconds&&r.departureSeconds+delta*86400<=latest);
    });
    if(!activeDays.length)continue;
    for(let i=0;i<rows.length-1;i++){
      const from=rows[i]!;
      if(from.departureSeconds==null||!(from.pickupType==null||from.pickupType===0)||
        !activeDays.some(({delta})=>from.departureSeconds!+delta*86400>=req.departAfterSeconds&&from.departureSeconds!+delta*86400<=latest))continue;
      if(originIds.has(from.stopId)&&proximityMeters(req.origin,stopMap.get(from.stopId)!)<=walkingCap&&
        activeDays.some(({delta})=>from.departureSeconds!+delta*86400>=(earliestFromOrigin.get(from.stopId)??Infinity)))
        timeFeasibleOrigin.add(from.stopId);
      const next=graph.get(from.stopId)??new Set<string>();
      for(let j=i+1;j<rows.length;j++){
        const to=rows[j]!;
        if(to.arrivalSeconds!=null&&(to.dropOffType==null||to.dropOffType===0)){
          next.add(to.stopId);
          if(destinationIds.has(to.stopId)&&timeFeasibleOrigin.has(from.stopId)){
            directOrigin.add(from.stopId);directDestination.add(to.stopId);
          }
        }
      }
      graph.set(from.stopId,next);
    }
  }
  const reverse=new Map<string,Set<string>>();
  for(const [a,ends] of graph)for(const b of ends){const set=reverse.get(b)??new Set<string>();set.add(a);reverse.set(b,set);}
  const allTransitStops=[...new Set([...graph.keys(),...reverse.keys()])];
  const walkingNeighbourhood=new Map<string,string[]>();
  function transferNeighbours(id:string):string[]{
    let result=walkingNeighbourhood.get(id);
    if(result)return result;
    const base=stopMap.get(id);
    result=base?allTransitStops.filter(other=>other!==id&&stopMap.has(other)&&proximityMeters(base,stopMap.get(other)!)<=transferReach):[];
    walkingNeighbourhood.set(id,result);return result;
  }
  const step=(seed:Set<string>,edges:Map<string,Set<string>>,rounds:number):Set<string>=>{
    let frontier=new Set(seed),seen=new Set(seed);
    for(let round=0;round<rounds;round++){
      if(round>0){for(const id of [...frontier])for(const neighbour of transferNeighbours(id))frontier.add(neighbour);}
      const next=new Set<string>();
      for(const id of frontier)for(const connected of edges.get(id)??[])next.add(connected);
      for(const id of next)seen.add(id);
      frontier=next;
    }
    return seen;
  };
  const rounds=Math.max(1,Math.min(3,(req.maxTransfers??1)+1));
  // To reach a destination follow the reverse graph; to come from an origin
  // follow the forward graph. Both are purely priority hints.
  const toDestination=step(destinationIds,reverse,rounds);
  const fromOrigin=step(originIds,graph,rounds);
  return {origin:originNear.filter(s=>toDestination.has(s.id)&&timeFeasibleOrigin.has(s.id)).map(s=>s.id),
    destination:destNear.filter(s=>fromOrigin.has(s.id)).map(s=>s.id),
    directOrigin:[...directOrigin],directDestination:[...directDestination]};
}

/**
 * A controlled, server-side integration seam. No provider key or database secret
 * is ever serialized into the response. Missing pedestrian routes mean no itinerary.
 */
export async function planDoorToDoor(
  timetable:Timetable,router:WalkingRouter,req:DoorToDoorRequest,opts:DoorToDoorOptions={}
):Promise<PlannedJourneys>{
  // Preserve bus-only legacy behavior unless rail was explicitly requested.
  // Never infer rail access from the GTFS feed merely containing trains.
  const modes=new Set(opts.modes??(opts.includeRail?['bus','rail']:['bus']));
  if(!modes.size||[...modes].some(m=>m!=='bus'&&m!=='rail'))throw new Error('invalid_modes');
  const allowedRoutes=new Set(timetable.routes.filter(r=>modes.has(r.mode)).map(r=>r.id));
  const eligibleTrips=timetable.trips.filter(t=>allowedRoutes.has(t.routeId));
  const eligibleTripIds=new Set(eligibleTrips.map(t=>t.id));
  const times=timetable.stopTimes.filter(st=>eligibleTripIds.has(st.tripId));
  const usedStopIds=new Set(times.map(st=>st.stopId));
  const routes=timetable.routes.filter(r=>allowedRoutes.has(r.id));
  const stops=timetable.stops.filter(s=>usedStopIds.has(s.id));
  const data:Timetable={...timetable,stops,routes,trips:eligibleTrips,stopTimes:times};

  // Distinct VEHICLES (GTFS trip IDs), not necessarily distinct routes: e.g.
  // transferring between two 420 services must be possible when schedule and
  // provider-verified street connections allow it. Reboarding the SAME trip
  // remains forbidden in engine.ts.
  const routeForTrip=new Map(eligibleTrips.map(t=>[t.id,t.routeId]));
  const boardingTrips=new Map<string,Set<string>>(),alightingTrips=new Map<string,Set<string>>();
  for(const st of times){
    if(st.departureSeconds!=null && (st.pickupType==null||st.pickupType===0)){
      const s=boardingTrips.get(st.stopId)??new Set();s.add(st.tripId);boardingTrips.set(st.stopId,s);
    }
    if(st.arrivalSeconds!=null && (st.dropOffType==null||st.dropOffType===0)){
      const s=alightingTrips.get(st.stopId)??new Set();s.add(st.tripId);alightingTrips.set(st.stopId,s);
    }
  }
  const stopMap=new Map(stops.map(s=>[s.id,s]));
  const transferPairs:{fromStopId:string;toStopId:string;priority:'cross_route'|'same_route'}[]=[];
  const ids=[...stopMap.keys()];
  // The API may enforce a tighter per-request cap; never use an unrelated
  // hard-coded transfer radius to discard a possible connection.
  const walkCap=Math.max(0,Math.min(req.maxWalkingMeters??2500,opts.maxPedestrianDistanceMeters??Infinity));
  const transitAvailable=hasBoardableServiceInWindow(data,req);
  if(transitAvailable&&(req.maxTransfers??1)>0){
    for(const a of ids){
      const from=alightingTrips.get(a);if(!from)continue;
      for(const b of ids){
        if(a===b)continue;
        const to=boardingTrips.get(b);if(!to)continue;
        // Geodesic length is a cheap necessary lower bound, not a fixed
        // service radius or evidence that a pedestrian path exists.
        const distance=proximityMeters(routableStopCoordinate(stopMap.get(a)!),routableStopCoordinate(stopMap.get(b)!));
        if(distance<0.01||distance>walkCap)continue;
        if(![...from].some(fr=>[...to].some(tr=>fr!==tr)))continue;
        // Keep legacy cross-route connections ahead of newly supported
        // same-line transfers when the paid walking budget is very small.
        const cross=[...from].some(fr=>[...to].some(tr=>fr!==tr&&routeForTrip.get(fr)!==routeForTrip.get(tr)));
        transferPairs.push({fromStopId:a,toStopId:b,priority:cross?'cross_route':'same_route'});
      }
    }
  }
  // Bound provider billing per user search. Expand only after measuring real Mayo results.
  const budget=Math.max(0,Math.min(opts.maxRequestCount??24,200));
  // A user's walking budget is an upper bound on any access/egress segment.
  // A smaller, hard-coded discovery radius must never silently shrink it.
  const candidateRadius=opts.candidateRadiusMeters??walkCap;
  const priority=transitAvailable?candidateStopPreferences(data,req,candidateRadius,walkCap):
    {origin:[],destination:[],directOrigin:[],directDestination:[]};
  const paths=await buildPedestrianPaths(router,transitAvailable?stops:[],req.origin,req.destination,{
    ...opts,maxRequestCount:budget,candidateRadiusMeters:candidateRadius,
    maxPedestrianDistanceMeters:Math.min(opts.maxPedestrianDistanceMeters??walkCap,walkCap),transferPairs,
    preferredOriginStopIds:priority.origin,preferredDestinationStopIds:priority.destination,
    directOriginStopIds:priority.directOrigin,directDestinationStopIds:priority.directDestination,
    maxDirectWalkMeters:Math.min(opts.maxDirectWalkMeters??1400,req.maxWalkingMeters??2500),
    maxOriginStops:opts.maxOriginStops??5,
    maxDestinationStops:opts.maxDestinationStops??5,
    maxTransferPairs:(req.maxTransfers??1)>0?(opts.maxTransferPairs??12):0,
  });
  const journeys=planJourneys(data,paths,req);
  return {journeys,walkingRequestsBudget:budget,feedVersion:data.feedVersion,coverage:paths.coverage};
}
