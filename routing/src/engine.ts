import type {AccessWalk,BoardingInstruction,Journey,Leg,PedestrianPaths,PlanRequest,RideLeg,Route,Stop,StopTime,Timetable,TransferWalk,Trip,WalkLeg,WalkPath} from './types';
import {activeService,dstTransitionDay,validDate,offsetServiceDate} from './time';
import {boardingInstruction,proximityMeters,routableStopCoordinate,MAX_WALK_ENDPOINT_DRIFT_METERS,MAX_USER_ENDPOINT_DRIFT_METERS} from './boarding';

interface State {stopId:string;at:number;legs:Leg[];boardings:BoardingInstruction[];rides:number;walkingMeters:number;}
const MAX_SCHEDULE_SECONDS=72*3600;
function assertPath(path:WalkPath,from:{lat:number;lon:number},to:{lat:number;lon:number},purpose:WalkLeg['purpose']):boolean {
  if(!Number.isFinite(path.durationSeconds)||path.durationSeconds<0||path.durationSeconds>7200)return false;
  if(!Number.isFinite(path.distanceMeters)||path.distanceMeters<0||path.distanceMeters>5000)return false;
  if(!Array.isArray(path.geometry)||path.geometry.length<2||!path.provider)return false;
  if(!path.geometry.every(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180))return false;
  const first=path.geometry[0]!,last=path.geometry[path.geometry.length-1]!;
  // A valid path must end at the GTFS stop, not just somewhere nearby in the road.
  // This checks endpoints only; sidewalk/platform certainty requires independent verification.
  const fromLimit=purpose==='access'||purpose==='direct'?MAX_USER_ENDPOINT_DRIFT_METERS:MAX_WALK_ENDPOINT_DRIFT_METERS;
  const toLimit=purpose==='egress'||purpose==='direct'?MAX_USER_ENDPOINT_DRIFT_METERS:MAX_WALK_ENDPOINT_DRIFT_METERS;
  return proximityMeters(first,from)<=fromLimit&&proximityMeters(last,to)<=toLimit;
}
function pathLeg(path:WalkPath,from:{lat:number;lon:number},to:{lat:number;lon:number},purpose:WalkLeg['purpose']):WalkLeg {
  return {type:'walk',from,to,durationSeconds:path.durationSeconds,distanceMeters:path.distanceMeters,
    geometry:path.geometry,provider:path.provider,purpose,...(path.endpointSnapMeters?{endpointSnapMeters:path.endpointSnapMeters}:{}),
    ...(path.unverifiedConnector?{unverifiedConnector:path.unverifiedConnector}:{}),
    ...(path.snappedUserEndpoints?{snappedUserEndpoints:path.snappedUserEndpoints}:{}),
    ...(path.requiresSnapConfirmation?{requiresSnapConfirmation:true}:{})};
}
/** Preserve arrival/walk/boarding trade-offs and future-trip eligibility.
 * The 24-label cap bounds work but is not a proof of globally optimal routing. */
const MAX_STATES_PER_STOP=24;
const stateMetadata=new WeakMap<State,{last:string|null;used:Set<string>;snap:boolean}>();
function metadata(state:State):{last:string|null;used:Set<string>;snap:boolean}{
  const cached=stateMetadata.get(state);if(cached)return cached;
  const used=new Set<string>();let last:string|null=null;
  for(const leg of state.legs)if(leg.type==='ride'){
    last=`${leg.serviceDate}:${leg.tripId}`;used.add(last);
  }
  const item={last,used,snap:snapConfirmationRequired(state.legs)};
  stateMetadata.set(state,item);return item;
}
function previousVehicle(state:State):string|null {
  return metadata(state).last;
}
/** State A must not prohibit any trip that state B could still board.
 * The planner forbids reusing trip IDs, so history is part of state identity. */
function usedVehicles(state:State):Set<string> {
  return metadata(state).used;
}
function snapConfirmationRequired(legs:Leg[]):boolean {
  return legs.some(leg=>leg.type==='walk'&&leg.requiresSnapConfirmation===true);
}
function stateDominates(a:State,b:State):boolean {
  if(previousVehicle(a)!==previousVehicle(b)||
    a.at>b.at||a.walkingMeters>b.walkingMeters||a.rides>b.rides)return false;
  // A label with uncertain household-to-street access cannot discard one
  // which does not require explicit confirmation from the passenger.
  if(metadata(a).snap&&!metadata(b).snap)return false;
  const otherUsed=usedVehicles(b);
  for(const tripId of usedVehicles(a)){if(!otherUsed.has(tripId))return false;}
  return true;
}
function addBest(states:Map<string,State[]>,state:State):void {
  const entries=states.get(state.stopId)??[];
  const compare=(a:State,b:State)=>a.at-b.at||a.walkingMeters-b.walkingMeters||a.rides-b.rides;
  // The bounded algorithm is approximate, but never lose a NEW minimum of
  // walking distance at the stop (critical for walking-constrained transfers).
  // This cheap gate prevents an O(24 log 24) selection on every later,
  // no-less-walk state in highly overlapping timetable feeds.
  if(entries.length>=MAX_STATES_PER_STOP&&compare(state,entries[entries.length-1]!)>=0&&
      entries.some(x=>metadata(x).snap===snapConfirmationRequired(state.legs))){
    let comparable=0;const distinct=new Set<string>();
    for(const old of entries){
      if(old.at<=state.at&&old.walkingMeters<=state.walkingMeters&&old.rides<=state.rides&&
          (!metadata(old).snap||snapConfirmationRequired(state.legs))){
        const history=previousVehicle(old);
        if(history)distinct.add(history);
        if(distinct.size>=2){comparable=2;break;}
      }
    }
    // Preserve states that can be the *second* low-walk alternative when a
    // single earlier history may block reboarding an essential vehicle.
    if(comparable>=2)return;
  }
  if(entries.some(x=>stateDominates(x,state)))return;
  const viable=entries.filter(x=>!stateDominates(state,x));
  viable.push(state);
  const byTime=compare;
  const byWalk=(a:State,b:State)=>a.walkingMeters-b.walkingMeters||a.at-b.at||a.rides-b.rides;
  if(viable.length<=MAX_STATES_PER_STOP){viable.sort(byTime);states.set(state.stopId,viable);return;}
  // Selecting only the earliest 24 suppresses late but low-walking feeders,
  // including the sole state that can afford a subsequent walking transfer.
  // Reserve earliest AND lowest-walking labels per snap-risk class. Then
  // distribute the remaining places equally between time and walking ranks.
  const selected=new Set<State>();
  for(const snap of [false,true]){
    const same=viable.filter(x=>metadata(x).snap===snap);
    if(same.length){
      selected.add(same.reduce((best,x)=>byTime(x,best)<0?x:best));
      selected.add(same.reduce((best,x)=>byWalk(x,best)<0?x:best));
    }
  }
  const orderedTime=[...viable].sort(byTime);
  const orderedWalk=[...viable].sort(byWalk);
  let ti=0,wi=0;
  while(selected.size<MAX_STATES_PER_STOP){
    const prior=selected.size;
    while(ti<orderedTime.length&&selected.has(orderedTime[ti]!))ti++;
    if(ti<orderedTime.length&&selected.size<MAX_STATES_PER_STOP)selected.add(orderedTime[ti++]!);
    while(wi<orderedWalk.length&&selected.has(orderedWalk[wi]!))wi++;
    if(wi<orderedWalk.length&&selected.size<MAX_STATES_PER_STOP)selected.add(orderedWalk[wi++]!);
    if(selected.size===prior)break;
  }
  states.set(state.stopId,[...selected].sort(byTime));
}
function sortStopTimes(rows:StopTime[]):StopTime[]{return [...rows].sort((a,b)=>a.sequence-b.sequence)}
function scheduleIsValid(rows:StopTime[]):boolean {
  let previous=-1;
  for(const r of rows){
    const a=r.arrivalSeconds,d=r.departureSeconds;
    if(a!=null&&(!Number.isInteger(a)||a<0||a>MAX_SCHEDULE_SECONDS||a<previous))return false;
    if(d!=null&&(!Number.isInteger(d)||d<0||d>MAX_SCHEDULE_SECONDS||(a!=null&&d<a)||d<previous))return false;
    if(a!=null)previous=a;
    if(d!=null)previous=d;
  }
  return true;
}
/** Pareto for completed journeys (not an exhaustive-route guarantee).
 * Later departure from origin is a benefit: otherwise every hourly bus after
 * the first disappears. departureAtSeconds is only the requested search time.
 * Legacy fixtures without the new field retain previous comparison behavior. */
export function nonDominatedJourneys(journeys:Journey[]):Journey[] {
  const leaveAt=(j:Journey):number=>
    Number.isFinite(j.latestLeaveAtSeconds) ? j.latestLeaveAtSeconds! :
    Number.isFinite(j.departureAtSeconds) ? j.departureAtSeconds : 0;
  return journeys.filter((candidate,index)=>!journeys.some((other,i)=>i!==index&&
    !(Boolean(other.requiresSnapConfirmation||snapConfirmationRequired(other.legs??[])) &&
      !Boolean(candidate.requiresSnapConfirmation||snapConfirmationRequired(candidate.legs??[])))&&
    other.arrivalAtSeconds<=candidate.arrivalAtSeconds&&
    other.walkingMeters<=candidate.walkingMeters&&
    other.transfers<=candidate.transfers&&
    leaveAt(other)>=leaveAt(candidate)&&
    (other.arrivalAtSeconds<candidate.arrivalAtSeconds||
      other.walkingMeters<candidate.walkingMeters||
      other.transfers<candidate.transfers||
      leaveAt(other)>leaveAt(candidate))));
}
export function planJourneys(data:Timetable,paths:PedestrianPaths,request:PlanRequest):Journey[]{
  if(data.timezone!=='Europe/Dublin')throw new Error('unsupported_timezone');
  if(!validDate(request.serviceDate))throw new Error('invalid_service_date');
  if(dstTransitionDay(request.serviceDate))throw new Error('dst_transition_requires_timezone_aware_scheduling');
  if(!Number.isInteger(request.departAfterSeconds)||request.departAfterSeconds<0||request.departAfterSeconds>=86400)throw new Error('invalid_departure_time');
  const maxTransfers=Math.max(0,Math.min(2,Math.floor(request.maxTransfers??1)));
  const limit=Math.max(1,Math.min(5,Math.floor(request.limit??3)));
  const minBoarding=Math.max(0,Math.floor(request.minBoardingSeconds??60));
  const minTransfer=Math.max(0,Math.floor(request.minTransferSeconds??120));
  const walkingCap=Math.max(0,Math.floor(request.maxWalkingMeters??2500));
  if(![minBoarding,minTransfer,walkingCap].every(Number.isFinite))throw new Error('invalid_parameters');
  const stopMap=new Map(data.stops.map(s=>[s.id,s]));
  const routeMap=new Map(data.routes.map(r=>[r.id,r]));
  const rowsByTrip=new Map<string,StopTime[]>();
  for(const row of data.stopTimes){const a=rowsByTrip.get(row.tripId)??[];a.push(row);rowsByTrip.set(row.tripId,a)}
  const validTrips:{trip:Trip;route:Route;rows:StopTime[];serviceDate:string;serviceDayDelta:number}[]=[];
  const maxBoardTime=request.departAfterSeconds+18*3600; // bounded departure horizon
  const serviceDays=[-1,0,1].map(offset=>({offset,date:offsetServiceDate(request.serviceDate,offset)}));
  const serviceMemo=new Map<string,boolean>();
  for(const trip of data.trips){
    const route=routeMap.get(trip.routeId);
    if(!route)continue;
    const sourceRows=sortStopTimes(rowsByTrip.get(trip.id)??[]);
    if(sourceRows.length<2||!scheduleIsValid(sourceRows))continue;
    for(const {offset,date} of serviceDays){
      // A DST change needs transition-specific UTC conversion. Do not invent 24h days.
      if(offset!==0&&dstTransitionDay(date))continue;
      const key=trip.serviceId+'|'+date;
      let active=serviceMemo.get(key);
      if(active===undefined){active=activeService(trip.serviceId,date,data.calendars,data.exceptions);serviceMemo.set(key,active);}
      if(!active)continue;
      // Express every service-day event relative to the requested local date.
      // Previous day's 25:15 becomes 01:15; next day's 00:20 becomes 24:20.
      const delta=offset*86400;
      const rows=sourceRows.map(r=>({...r,
        arrivalSeconds:r.arrivalSeconds===null?null:r.arrivalSeconds+delta,
        departureSeconds:r.departureSeconds===null?null:r.departureSeconds+delta}));
      if(!rows.some(r=>r.departureSeconds!==null&&r.departureSeconds>=request.departAfterSeconds&&r.departureSeconds<=maxBoardTime))continue;
      validTrips.push({trip,route,rows,serviceDate:date,serviceDayDelta:delta});
    }
  }
  // Index trips by stops where boarding is permitted. Each transfer round
  // examines only trips that can actually be reached from the frontier.
  const tripsByBoardingStop=new Map<string,number[]>();
  for(let index=0;index<validTrips.length;index++){
    const seen=new Set<string>();
    for(const row of validTrips[index]!.rows){
      if(row.departureSeconds==null||!(row.pickupType==null||row.pickupType===0)||seen.has(row.stopId))continue;
      seen.add(row.stopId);
      const list=tripsByBoardingStop.get(row.stopId)??[];
      list.push(index);tripsByBoardingStop.set(row.stopId,list);
    }
  }
  // A02: fastest is not always feasible when a walking budget is applied.
  // Keep the time/distance/snap-safety Pareto frontier for every alighting stop.
  // In particular, a 690s/900m walk must not suppress a 720s/120m walk.
  const egressPaths=new Map<string,AccessWalk[]>();
  for(const p of paths.egress){
    const stop=stopMap.get(p.stopId);
    if(!stop||!assertPath(p,routableStopCoordinate(stop),paths.destination,'egress'))continue;
    const group=egressPaths.get(p.stopId)??[];
    group.push(p);egressPaths.set(p.stopId,group);
  }
  for(const [stopId,group] of egressPaths){
    // Stable tie ordering makes the selected geometry independent of GTFS/path order.
    group.sort((a,b)=>a.durationSeconds-b.durationSeconds||a.distanceMeters-b.distanceMeters||
      Number(!!a.requiresSnapConfirmation)-Number(!!b.requiresSnapConfirmation)||
      a.provider.localeCompare(b.provider)||JSON.stringify(a.geometry).localeCompare(JSON.stringify(b.geometry)));
    const pareto:AccessWalk[]=[];
    for(const option of group){
      if(pareto.some(prior=>prior.durationSeconds<=option.durationSeconds&&
          prior.distanceMeters<=option.distanceMeters&&
          (!prior.requiresSnapConfirmation||!!option.requiresSnapConfirmation)))continue;
      pareto.push(option);
    }
    egressPaths.set(stopId,pareto);
  }
  const transferMap=new Map<string,TransferWalk[]>();
  for(const p of paths.transfers){
    const from=stopMap.get(p.fromStopId),to=stopMap.get(p.toStopId);
    if(!from||!to||from.id===to.id||!assertPath(p,routableStopCoordinate(from),routableStopCoordinate(to),'transfer'))continue;
    const old=transferMap.get(from.id)??[];old.push(p);transferMap.set(from.id,old);
  }
  const initial=new Map<string,State[]>();
  for(const p of paths.access){
    const stop=stopMap.get(p.stopId);
    if(!stop||!assertPath(p,paths.origin,routableStopCoordinate(stop),'access')||p.distanceMeters>walkingCap)continue;
    addBest(initial,{stopId:stop.id,at:request.departAfterSeconds+p.durationSeconds,rides:0,
      walkingMeters:p.distanceMeters,legs:[pathLeg(p,paths.origin,routableStopCoordinate(stop),'access')],boardings:[]});
  }
  const candidates:Journey[]=[];
  // Walk-only is a real alternative, never a fabricated road line. Requires
  // separately returned provider geometry, and no GTFS service to exist.
  if(paths.direct && assertPath(paths.direct,paths.origin,paths.destination,'direct') &&
    paths.direct.distanceMeters<=walkingCap){
    candidates.push({serviceDate:request.serviceDate,feedVersion:data.feedVersion,
      departureAtSeconds:request.departAfterSeconds,
      latestLeaveAtSeconds:request.departAfterSeconds,
      arrivalAtSeconds:request.departAfterSeconds+paths.direct.durationSeconds,
      transfers:0,walkingMeters:paths.direct.distanceMeters,
      legs:[pathLeg(paths.direct,paths.origin,paths.destination,'direct')],
      boardings:[],predictionType:'walking_estimate'});
  }
  let frontier=initial;
  for(let round=0;round<=maxTransfers;round++){
    if(frontier.size===0)break;
    const next=new Map<string,State[]>();
    const reachableTrips=new Set<number>();
    for(const stopId of frontier.keys())for(const index of tripsByBoardingStop.get(stopId)??[])reachableTrips.add(index);
    for(const tripIndex of [...reachableTrips].sort((a,b)=>a-b)){
      const {trip,route,rows,serviceDate,serviceDayDelta}=validTrips[tripIndex]!;
      const boardingCandidates:{state:State;index:number}[]=[];
      for(let i=0;i<rows.length;i++){
        const stopTime=rows[i]!;
        if((stopTime.pickupType==null||stopTime.pickupType===0)&&stopTime.departureSeconds!=null){
          for(const option of frontier.get(stopTime.stopId)??[]){
            if(option.legs.some(leg=>leg.type==='ride'&&leg.tripId===trip.id&&leg.serviceDate===serviceDate))continue;
            const requireBuffer=option.rides>0?minTransfer:minBoarding;
            if(option.at+requireBuffer>stopTime.departureSeconds)continue;
            // The 18-hour search horizon applies to FIRST boarding, not to a
            // connection after an already-valid first ride.
            if(option.rides===0&&stopTime.departureSeconds>maxBoardTime)continue;
            // Keep multiple boarding labels: a shorter access walk may enable
            // a later transfer even if another label is faster at this stop.
            boardingCandidates.push({state:option,index:i});
          }
          if(boardingCandidates.length>36){
            boardingCandidates.sort((a,b)=>a.state.walkingMeters-b.state.walkingMeters||
              a.state.at-b.state.at||a.index-b.index);
            boardingCandidates.splice(36);
          }
        }
        if(stopTime.dropOffType===1||!(stopTime.dropOffType==null||stopTime.dropOffType===0)||stopTime.arrivalSeconds==null)continue;
        const alightStop=stopMap.get(stopTime.stopId);
        if(!alightStop)continue;
        for(const chosen of boardingCandidates){
          if(chosen.index>=i)continue;
          const b=rows[chosen.index]!;
          const boardingStop=stopMap.get(b.stopId);
          if(!boardingStop)continue;
          const ride:RideLeg={type:'ride',tripId:trip.id,routeId:trip.routeId,routeName:route.name,
            mode:route.mode,headsign:trip.headsign??null,boardStopId:b.stopId,alightStopId:stopTime.stopId,
            boardAtSeconds:b.departureSeconds!,alightAtSeconds:stopTime.arrivalSeconds,
            boardAtServiceSeconds:b.departureSeconds!-serviceDayDelta,
            alightAtServiceSeconds:stopTime.arrivalSeconds-serviceDayDelta,
            boardDayOffset:Math.floor((b.departureSeconds!-serviceDayDelta)/86400),
            alightDayOffset:Math.floor((stopTime.arrivalSeconds-serviceDayDelta)/86400),serviceDate};
          const base=chosen.state;
          const result:State={stopId:stopTime.stopId,at:stopTime.arrivalSeconds,rides:base.rides+1,
            legs:[...base.legs,ride],boardings:[...base.boardings,boardingInstruction(boardingStop)],
            walkingMeters:base.walkingMeters};
          addBest(next,result);
        }
      }
    }
    // Transfer walking only after arriving on a vehicle. Never assume opposite sidewalks connect.
    const expanded=new Map<string,State[]>();
    for(const group of next.values())for(const entry of group)addBest(expanded,entry);
    for(const group of next.values())for(const origin of group){
      for(const p of transferMap.get(origin.stopId)??[]){
        if(origin.walkingMeters+p.distanceMeters>walkingCap)continue;
        const from=stopMap.get(p.fromStopId)!,to=stopMap.get(p.toStopId)!;
        addBest(expanded,{...origin,stopId:to.id,at:origin.at+p.durationSeconds,
          walkingMeters:origin.walkingMeters+p.distanceMeters,
          legs:[...origin.legs,pathLeg(p,routableStopCoordinate(from),routableStopCoordinate(to),'transfer')]});
      }
    }
    for(const group of next.values())for(const result of group){
      const stop=stopMap.get(result.stopId)!;
      for(const egress of egressPaths.get(result.stopId)??[]){
      if(result.walkingMeters+egress.distanceMeters>walkingCap)continue;
      const firstRide=result.legs.find((leg):leg is RideLeg=>leg.type==='ride');
      const access=result.legs.find((leg):leg is WalkLeg=>leg.type==='walk'&&leg.purpose==='access');
      // Include required boarding slack: later advertised departures must
      // remain physically reachable, not just convenient-looking timestamps.
      const latestLeaveAtSeconds=firstRide
        ? firstRide.boardAtSeconds-(access?.durationSeconds??0)-minBoarding
        : request.departAfterSeconds;
      candidates.push({serviceDate:request.serviceDate,feedVersion:data.feedVersion,
        departureAtSeconds:request.departAfterSeconds,latestLeaveAtSeconds,
        arrivalAtSeconds:result.at+egress.durationSeconds,
        transfers:result.rides-1,walkingMeters:result.walkingMeters+egress.distanceMeters,
        boardings:result.boardings,legs:[...result.legs,pathLeg(egress,routableStopCoordinate(stop),paths.destination,'egress')],
        predictionType:'scheduled'});
      }
    }
    frontier=expanded;
  }
  // Preserve alternatives with different transit patterns, then rank by actual scheduled arrival.
  // A02: grouping by transit pattern must preserve different feasible walking
  // trade-offs. Keeping only the earliest arrival erases the shorter exit again.
  const journeys=new Map<string,Journey[]>();
  for(const c of candidates){
    const signature=(c.legs.some(l=>l.type==='ride')?c.legs.filter(l=>l.type==='ride').map(l=>`${l.serviceDate}:${l.tripId}:${l.boardStopId}:${l.alightStopId}`).join('|'):'walk_only')+
      (snapConfirmationRequired(c.legs)?':snap-confirmation':':no-snap-confirmation');
    const previous=journeys.get(signature)??[];
    if(previous.some(j=>j.arrivalAtSeconds===c.arrivalAtSeconds&&j.walkingMeters===c.walkingMeters&&
        j.transfers===c.transfers&&j.latestLeaveAtSeconds===c.latestLeaveAtSeconds))continue;
    journeys.set(signature,nonDominatedJourneys([...previous,c]));
  }
  const rankBy=request.rankBy??'fastest';
  return nonDominatedJourneys([...journeys.values()].flat()).sort((a,b)=>{
    if(rankBy==='less_walking')return a.walkingMeters-b.walkingMeters||a.arrivalAtSeconds-b.arrivalAtSeconds||a.transfers-b.transfers;
    if(rankBy==='fewest_transfers')return a.transfers-b.transfers||a.arrivalAtSeconds-b.arrivalAtSeconds||a.walkingMeters-b.walkingMeters;
    return a.arrivalAtSeconds-b.arrivalAtSeconds||a.transfers-b.transfers||a.walkingMeters-b.walkingMeters;
  }).slice(0,limit).map(j=>{
    const walks=j.legs.filter((l):l is WalkLeg=>l.type==='walk');
    return {...j,
      unverifiedConnectorMeters:walks.reduce((s,l)=>s+(l.unverifiedConnector?.meters??0),0),
      unverifiedConnectorSeconds:walks.reduce((s,l)=>s+(l.unverifiedConnector?.estimatedSeconds??0),0),
      requiresSnapConfirmation:walks.some(l=>l.requiresSnapConfirmation===true)};
  });
}
