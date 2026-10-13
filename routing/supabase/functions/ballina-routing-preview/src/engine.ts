import type {AccessWalk,BoardingInstruction,Journey,Leg,PedestrianPaths,PlanRequest,RideLeg,Route,Stop,StopTime,Timetable,TransferWalk,Trip,WalkLeg,WalkPath} from './types.ts';
import {activeService,dstTransitionDay,validDate,offsetServiceDate} from './time.ts';
import {boardingInstruction,proximityMeters,routableStopCoordinate,MAX_WALK_ENDPOINT_DRIFT_METERS,MAX_USER_ENDPOINT_DRIFT_METERS} from './boarding.ts';

interface State {stopId:string;at:number;legs?:Leg[];boardings?:BoardingInstruction[];rides:number;walkingMeters:number;latestLeaveAtSeconds:number;parent?:State;addedLeg?:Leg;boardingStop?:Stop;cachedMetadata?:StateMetadata;}
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
interface StateMetadata {last:string|null;used?:Set<string>;snap:boolean;}
const stateMetadata=new WeakMap<State,StateMetadata>();
/** Build arrays only for retained labels actually used in a returned candidate. */
function stateLegs(state:State):Leg[]{
  if(state.legs)return state.legs;
  return state.legs=state.parent&&state.addedLeg?[...stateLegs(state.parent),state.addedLeg]:[];
}
function stateBoardings(state:State):BoardingInstruction[]{
  if(state.boardings)return state.boardings;
  const parent=state.parent?stateBoardings(state.parent):[];
  return state.boardings=state.boardingStop?[...parent,boardingInstruction(state.boardingStop)]:parent;
}
function hasVehicle(state:State,tripId:string,serviceDate:string):boolean {
  let current=state;
  while(current.parent){
    const leg=current.addedLeg;
    if(leg?.type==='ride'&&leg.tripId===tripId&&leg.serviceDate===serviceDate)return true;
    current=current.parent;
  }
  return stateLegs(current).some(leg=>leg.type==='ride'&&leg.tripId===tripId&&leg.serviceDate===serviceDate);
}
function metadata(state:State):StateMetadata{
  if(state.cachedMetadata)return state.cachedMetadata;
  const cached=stateMetadata.get(state);if(cached)return cached;
  let last:string|null=null,snap=false;
  for(const leg of stateLegs(state)){
    if(leg.type==='ride')last=`${leg.serviceDate}:${leg.tripId}`;
    if(leg.type==='walk'&&leg.requiresSnapConfirmation===true)snap=true;
  }
  const item={last,snap};
  stateMetadata.set(state,item);return item;
}
function previousVehicle(state:State):string|null {
  return metadata(state).last;
}
/** State A must not prohibit any trip that state B could still board.
 * The planner forbids reusing trip IDs, so history is part of state identity. */
function usedVehicles(state:State):Set<string> {
  const item=metadata(state);
  // Most labels have different last vehicles or already fail scalar Pareto
  // checks. Allocate history only when subset comparison is actually needed.
  if(!item.used){
    item.used=new Set<string>();
    for(const leg of stateLegs(state))if(leg.type==='ride')item.used.add(`${leg.serviceDate}:${leg.tripId}`);
  }
  return item.used;
}
/** Adjacent boardings yielding the same future label are redundant. Their
 * current arrival differs, but the next ride replaces it with its one fixed
 * alighting time. Keep the first boarding exactly as dominance would do. */
function sameContinuation(a:State,b:State):boolean {
  if(a.rides===0||a.rides!==b.rides||a.walkingMeters!==b.walkingMeters||a.latestLeaveAtSeconds!==b.latestLeaveAtSeconds)return false;
  const am=metadata(a),bm=metadata(b);
  if(am.last!==bm.last||am.snap!==bm.snap)return false;
  if(a.rides===1)return true;
  const au=usedVehicles(a),bu=usedVehicles(b);
  if(au.size!==bu.size)return false;
  for(const key of au)if(!bu.has(key))return false;
  return true;
}
function snapConfirmationRequired(legs:Leg[]):boolean {
  return legs.some(leg=>leg.type==='walk'&&leg.requiresSnapConfirmation===true);
}
function stateDominates(a:State,b:State):boolean {
  if(a.at>b.at||a.walkingMeters>b.walkingMeters||a.rides>b.rides||a.latestLeaveAtSeconds<b.latestLeaveAtSeconds)return false;
  if(previousVehicle(a)!==previousVehicle(b))return false;
  // A label with uncertain household-to-street access cannot discard one
  // which does not require explicit confirmation from the passenger.
  if(metadata(a).snap&&!metadata(b).snap)return false;
  const otherUsed=usedVehicles(b);
  for(const tripId of usedVehicles(a)){if(!otherUsed.has(tripId))return false;}
  return true;
}
const byTime=(a:State,b:State)=>a.at-b.at||a.walkingMeters-b.walkingMeters||a.rides-b.rides||b.latestLeaveAtSeconds-a.latestLeaveAtSeconds||0;
const byWalk=(a:State,b:State)=>a.walkingMeters-b.walkingMeters||a.at-b.at||a.rides-b.rides||b.latestLeaveAtSeconds-a.latestLeaveAtSeconds||0;
const byLeave=(a:State,b:State)=>b.latestLeaveAtSeconds-a.latestLeaveAtSeconds||byTime(a,b);
type FrontierRank=readonly number[]|Uint8Array;
interface FrontierOrder {walk:FrontierRank;leave:FrontierRank;uniformWalk:boolean;snap:boolean|null;}
// A strict time order with equal walking has exactly this immutable walk rank.
// Share it across retained frontiers instead of allocating the same 24 indices.
const uniformTimeRanks=Object.freeze(Array.from({length:MAX_STATES_PER_STOP},(_,i)=>i));
interface FrontierIndex {entries:State[];latestLeave:number;order?:FrontierOrder;}
const frontierIndexes=new WeakMap<Map<string,State[]>,Map<string,FrontierIndex>>();
function retainFrontier(states:Map<string,State[]>,indexes:Map<string,FrontierIndex>,stopId:string,entries:State[],latestLeave:number,order?:FrontierOrder):void {
  states.set(stopId,entries);
  const existing=indexes.get(stopId);
  if(existing){existing.entries=entries;existing.latestLeave=latestLeave;existing.order=order;}
  else indexes.set(stopId,{entries,latestLeave,order});
}
function selectRanks(length:number,walk:number[],leave:number[],extremes:number[]):{mask:number;selected:number[]}{
  let mask=0;
  const selected:number[]=[];
  const take=(index:number)=>{const bit=1<<index;if(!(mask&bit)){mask|=bit;selected.push(index);}};
  for(const index of extremes)if(index!==-1)take(index);
  let ti=0,wi=0,li=0;
  while(selected.length<MAX_STATES_PER_STOP){
    const previous=selected.length;
    while(ti<length&&(mask&(1<<ti)))ti++;
    if(ti<length&&selected.length<MAX_STATES_PER_STOP)take(ti++);
    while(wi<walk.length&&(mask&(1<<walk[wi]!)))wi++;
    if(wi<walk.length&&selected.length<MAX_STATES_PER_STOP)take(walk[wi++]!);
    while(li<leave.length&&(mask&(1<<leave[li]!)))li++;
    if(li<leave.length&&selected.length<MAX_STATES_PER_STOP)take(leave[li++]!);
    if(selected.length===previous)break;
  }
  return {mask,selected};
}
/** The existing strict 24→25 selector with virtual insertion ranks. Rejected
 * labels allocate no rank/selection arrays; the selected mask is identical. */
function virtualRank(rank:FrontierRank,slot:number,ordinal:number):number {
  return ordinal===slot?MAX_STATES_PER_STOP:rank[ordinal<slot?ordinal:ordinal-1]!;
}
function insertionSlot(entries:State[],rank:FrontierRank,state:State,compare:(a:State,b:State)=>number):number {
  let lo=0,hi=rank.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(compare(entries[rank[mid]!]!,state)<=0)lo=mid+1;else hi=mid;}
  return lo;
}
function selectVirtualMask(walk:FrontierRank,walkSlot:number,leave:FrontierRank,leaveSlot:number):number {
  const length=MAX_STATES_PER_STOP+1;
  let mask=1,count=1;
  let index=virtualRank(walk,walkSlot,0),bit=1<<index;
  if(!(mask&bit)){mask|=bit;count++;}
  index=virtualRank(leave,leaveSlot,0);bit=1<<index;
  if(!(mask&bit)){mask|=bit;count++;}
  let ti=0,wi=0,li=0;
  while(count<MAX_STATES_PER_STOP){
    const previous=count;
    while(ti<length&&(mask&(1<<ti)))ti++;
    if(ti<length&&count<MAX_STATES_PER_STOP){mask|=1<<ti++;count++;}
    while(wi<length&&(mask&(1<<virtualRank(walk,walkSlot,wi))))wi++;
    if(wi<length&&count<MAX_STATES_PER_STOP){mask|=1<<virtualRank(walk,walkSlot,wi++);count++;}
    while(li<length&&(mask&(1<<virtualRank(leave,leaveSlot,li))))li++;
    if(li<length&&count<MAX_STATES_PER_STOP){mask|=1<<virtualRank(leave,leaveSlot,li++);count++;}
    if(count===previous)break;
  }
  return mask;
}
function retainedVirtualRank(rank:FrontierRank,slot:number,excluded:number):Uint8Array {
  // Indices 0..23 need one byte; the cap remains exactly 24 labels.
  const result=new Uint8Array(MAX_STATES_PER_STOP);let at=0;
  for(let i=0;i<=MAX_STATES_PER_STOP;i++){
    const index=virtualRank(rank,slot,i);
    if(index!==excluded)result[at++]=index<excluded?index:index-1;
  }
  return result;
}
/** Entries are already time ordered. Upper-bound insertion preserves stable ties. */
function insertOrdered(entries:State[],state:State,compare:(a:State,b:State)=>number):number {
  let lo=0,hi=entries.length;
  while(lo<hi){const mid=(lo+hi)>>>1;if(compare(entries[mid]!,state)<=0)lo=mid+1;else hi=mid;}
  entries.splice(lo,0,state);
  return lo;
}
function addBest(states:Map<string,State[]>,state:State):void {
  const entries=states.get(state.stopId)??[];
  let indexes=frontierIndexes.get(states);
  if(!indexes){indexes=new Map();frontierIndexes.set(states,indexes);}
  const previous=indexes.get(state.stopId);
  const cached=previous?.entries===entries?previous:undefined;
  let latestLeave=cached?.latestLeave;
  if(latestLeave===undefined){latestLeave=-Infinity;for(const entry of entries)latestLeave=Math.max(latestLeave,entry.latestLeaveAtSeconds);}
  const order=cached?.order;
  // This is the same full 25-label selector, performed against cached ranks.
  // Strictly later in time order cannot dominate an existing label. Uniform
  // snap risk lets the existing extrema be read directly from those ranks.
  if(entries.length===MAX_STATES_PER_STOP&&order&&order.snap!==null&&metadata(state).snap===order.snap&&byTime(state,entries[entries.length-1]!)>0){
    const appended=entries.length;
    const uniformWalk=order.uniformWalk&&state.walkingMeters===entries[0]!.walkingMeters;
    const walkSlot=uniformWalk?appended:insertionSlot(entries,order.walk,state,byWalk);
    const leaveSlot=insertionSlot(entries,order.leave,state,byLeave);
    const mask=selectVirtualMask(order.walk,walkSlot,order.leave,leaveSlot);
    // With strict numeric order an excluded insertion leaves the array exact.
    if(!(mask&(1<<appended)))return;
    if(!(state.latestLeaveAtSeconds>latestLeave)&&entries.some(x=>stateDominates(x,state)))return;
    // Exactly one of 25 labels is excluded by the unchanged 24-label cap.
    const excluded=31-Math.clz32((~mask)&0x1ffffff),result:State[]=[];
    for(let i=0;i<=appended;i++)if(i!==excluded)result.push(i===appended?state:entries[i]!);
    const resultUniformWalk=uniformWalk||result.every(entry=>entry.walkingMeters===result[0]!.walkingMeters);
    retainFrontier(states,indexes,state.stopId,result,Math.max(latestLeave,state.latestLeaveAtSeconds),{walk:resultUniformWalk?uniformTimeRanks:retainedVirtualRank(order.walk,walkSlot,excluded),leave:retainedVirtualRank(order.leave,leaveSlot,excluded),uniformWalk:resultUniformWalk,snap:order.snap});
    return;
  }
  // Exact scalar impossibility bounds; selection still considers every label.
  // A newer leave time cannot be dominated by older leave times. A later
  // arrival than every retained label cannot dominate any of those labels.
  if(!(state.latestLeaveAtSeconds>latestLeave)&&entries.some(x=>stateDominates(x,state)))return;
  const viable=entries.length&&state.at>entries[entries.length-1]!.at?[...entries]:entries.filter(x=>!stateDominates(state,x));
  const nextLatestLeave=Math.max(latestLeave,state.latestLeaveAtSeconds);
  const inserted=insertOrdered(viable,state,byTime);
  if(viable.length<=MAX_STATES_PER_STOP){retainFrontier(states,indexes,state.stopId,viable,nextLatestLeave);return;}
  // Normal frontiers contain at most 24 retained labels plus this insertion.
  // Integer membership preserves the exact selection order without hashing
  // State objects or retaining temporary Set entries for every rejected label.
  if(viable.length<=32){
    const previousOrder=cached?.order;
    const noRemoval=entries.length+1===viable.length;
    let timeTies=false;
    // Only the inserted label can introduce a tie into a cached strict order.
    if(previousOrder&&noRemoval){
      timeTies=inserted>0&&byTime(viable[inserted-1]!,state)===0||inserted+1<viable.length&&byTime(state,viable[inserted+1]!)===0;
    }else for(let i=1;i<viable.length;i++)if(byTime(viable[i-1]!,viable[i]!)===0){timeTies=true;break;}
    const reuse=previousOrder&&noRemoval&&!timeTies;
    const time=viable.map((_,i)=>i);
    const updateOrder=(order:FrontierRank,compare:(a:State,b:State)=>number)=>{
      const result=Array.from(order,i=>i>=inserted?i+1:i);
      let lo=0,hi=result.length;
      while(lo<hi){const mid=(lo+hi)>>>1;if(compare(viable[result[mid]!]!,state)<=0)lo=mid+1;else hi=mid;}
      result.splice(lo,0,inserted);return result;
    };
    const uniformWalk=reuse&&previousOrder.uniformWalk&&state.walkingMeters===entries[0]!.walkingMeters||viable.every(entry=>entry.walkingMeters===viable[0]!.walkingMeters);
    const walk=uniformWalk?time:reuse?updateOrder(previousOrder.walk,byWalk):[...time].sort((a,b)=>byWalk(viable[a]!,viable[b]!));
    const leave=reuse?updateOrder(previousOrder.leave,byLeave):[...time].sort((a,b)=>byLeave(viable[a]!,viable[b]!));
    const extremes:number[]=[-1,-1,-1,-1,-1,-1];
    const singleSnap=reuse&&previousOrder.snap!==null&&metadata(state).snap===previousOrder.snap?previousOrder.snap:null;
    if(singleSnap!==null){
      const offset=singleSnap?3:0;extremes[offset]=0;extremes[offset+1]=walk[0]!;extremes[offset+2]=leave[0]!;
    }else for(let i=0;i<viable.length;i++){
      const entry=viable[i]!,offset=metadata(entry).snap?3:0;
      if(extremes[offset]===-1)extremes[offset]=i;
      if(extremes[offset+1]===-1||byWalk(entry,viable[extremes[offset+1]!]!)<0)extremes[offset+1]=i;
      if(extremes[offset+2]===-1||byLeave(entry,viable[extremes[offset+2]!]!)<0)extremes[offset+2]=i;
    }
    const {mask,selected}=selectRanks(viable.length,walk,leave,extremes);
    const result:State[]=[];
    let resultOrder:FrontierOrder|undefined;
    if(timeTies){
      selected.sort((a,b)=>byTime(viable[a]!,viable[b]!));
      for(const index of selected)result.push(viable[index]!);
    }else{
      const remap:number[]=new Array(viable.length);
      for(let i=0;i<viable.length;i++)if(mask&(1<<i)){remap[i]=result.length;result.push(viable[i]!);}
      const keepOrder=(order:number[])=>order.filter(i=>Boolean(mask&(1<<i))).map(i=>remap[i]!);
      let snap:boolean|null=metadata(result[0]!).snap;
      if(singleSnap===null)for(const entry of result)if(metadata(entry).snap!==snap){snap=null;break;}
      resultOrder={walk:keepOrder(walk),leave:keepOrder(leave),uniformWalk:uniformWalk||result.every(entry=>entry.walkingMeters===result[0]!.walkingMeters),snap};
    }
    retainFrontier(states,indexes,state.stopId,result,nextLatestLeave,resultOrder);
    return;
  }
  // Selecting only the earliest 24 suppresses late but low-walking feeders,
  // including the sole state that can afford a subsequent walking transfer.
  // Reserve earliest, lowest-walking AND latest-leave labels per snap-risk class.
  // Distribute remaining places across these three bounded ranks.
  const selected=new Set<State>();
  const extremes:(State|undefined)[]=new Array(6);
  for(const entry of viable){
    const offset=metadata(entry).snap?3:0;
    if(!extremes[offset]||byTime(entry,extremes[offset]!)<0)extremes[offset]=entry;
    if(!extremes[offset+1]||byWalk(entry,extremes[offset+1]!)<0)extremes[offset+1]=entry;
    if(!extremes[offset+2]||byLeave(entry,extremes[offset+2]!)<0)extremes[offset+2]=entry;
  }
  for(const entry of extremes)if(entry)selected.add(entry);
  const orderedTime=viable;
  // Uniform-walk frontiers (common in overlapping feeds) already have the
  // walking order after time sorting. Strictly increasing leave times can
  // likewise be reversed without another O(labels log labels) sort.
  const uniformWalk=viable.every(x=>x.walkingMeters===viable[0]!.walkingMeters);
  const orderedWalk=uniformWalk?orderedTime:[...viable].sort(byWalk);
  const increasingLeave=orderedTime.every((x,i)=>i===0||orderedTime[i-1]!.latestLeaveAtSeconds<x.latestLeaveAtSeconds);
  const orderedLeave=increasingLeave?[...orderedTime].reverse():[...viable].sort(byLeave);
  let ti=0,wi=0,li=0;
  while(selected.size<MAX_STATES_PER_STOP){
    const prior=selected.size;
    while(ti<orderedTime.length&&selected.has(orderedTime[ti]!))ti++;
    if(ti<orderedTime.length&&selected.size<MAX_STATES_PER_STOP)selected.add(orderedTime[ti++]!);
    while(wi<orderedWalk.length&&selected.has(orderedWalk[wi]!))wi++;
    if(wi<orderedWalk.length&&selected.size<MAX_STATES_PER_STOP)selected.add(orderedWalk[wi++]!);
    while(li<orderedLeave.length&&selected.has(orderedLeave[li]!))li++;
    if(li<orderedLeave.length&&selected.size<MAX_STATES_PER_STOP)selected.add(orderedLeave[li++]!);
    if(selected.size===prior)break;
  }
  const result=[...selected].sort(byTime);
  retainFrontier(states,indexes,state.stopId,result,nextLatestLeave);
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
/**
 * Guard against spectacular geographic backtracking on a multi-vehicle trip.
 * This is a LOWER BOUND on distance, computed only from GTFS boarding/alighting
 * stops: it is not street geometry, and does not assert that a route is optimal.
 * Both a large absolute excess (75 km) AND a large relative excess (4x) are
 * required. An ordinary rural connection via a neighbouring town survives.
 * If a required GTFS stop is missing, fail open rather than invent geometry.
 */
export function hasExtremeGeographicDetour(
  journey:Journey, origin:{lat:number;lon:number}, destination:{lat:number;lon:number},
  stops:Map<string,Stop>,
):boolean {
  const rides=journey.legs.filter((leg):leg is RideLeg=>leg.type==='ride');
  if(rides.length<2)return false;
  const points=[origin];
  for(const ride of rides){
    const a=stops.get(ride.boardStopId),b=stops.get(ride.alightStopId);
    if(!a||!b)return false;
    points.push(a,b);
  }
  points.push(destination);
  const direct=proximityMeters(origin,destination);
  if(!Number.isFinite(direct))return false;
  let lowerBound=0;
  for(let i=1;i<points.length;i++){
    const d=proximityMeters(points[i-1]!,points[i]!);
    if(!Number.isFinite(d))return false;
    lowerBound+=d;
  }
  return lowerBound>direct+75_000 && lowerBound>4*Math.max(direct,1_000);
}

/**
 * A tiny walking saving must not justify a much later arrival + more transfers
 * on the exact same first vehicle. Only apply this preference under 'fastest':
 * a passenger explicitly choosing 'less_walking' keeps the genuine Pareto tradeoff.
 * This does not compare different first departures or different snap-risk classes.
 */
export function removeLowValueFastestAlternatives(journeys:Journey[]):Journey[]{
  const firstRide=(j:Journey)=>j.legs.find((leg):leg is RideLeg=>leg.type==='ride');
  const leave=(j:Journey)=>j.latestLeaveAtSeconds??j.departureAtSeconds;
  const snap=(j:Journey)=>Boolean(j.requiresSnapConfirmation||snapConfirmationRequired(j.legs));
  return journeys.filter(candidate=>!journeys.some(other=>{
    if(other===candidate||snap(other)!==snap(candidate))return false;
    const a=firstRide(other),b=firstRide(candidate);
    if(!a||!b||a.serviceDate!==b.serviceDate||a.tripId!==b.tripId||a.boardStopId!==b.boardStopId)return false;
    if(Math.abs(leave(other)-leave(candidate))>1)return false;
    return other.arrivalAtSeconds+600<=candidate.arrivalAtSeconds &&
      other.transfers<=candidate.transfers &&
      other.walkingMeters<=candidate.walkingMeters+20;
  }));
}

/** Validate before discovering candidates or invoking a metered provider. */
export function validatePlanRequest(data:Pick<Timetable,'timezone'>,request:PlanRequest):void {
  if(data.timezone!=='Europe/Dublin')throw new Error('unsupported_timezone');
  if(!validDate(request.serviceDate))throw new Error('invalid_service_date');
  if(dstTransitionDay(request.serviceDate))throw new Error('dst_transition_requires_timezone_aware_scheduling');
  if(!Number.isInteger(request.departAfterSeconds)||request.departAfterSeconds<0||request.departAfterSeconds>=86400)throw new Error('invalid_departure_time');
  for(const key of ['maxTransfers','limit','minBoardingSeconds','minTransferSeconds','maxWalkingMeters'] as const){
    const value=request[key];
    if(value!==undefined&&(typeof value!=='number'||!Number.isFinite(value)))throw new Error('invalid_parameters');
  }
  if(request.rankBy!==undefined&&!['fastest','less_walking','fewest_transfers'].includes(request.rankBy))throw new Error('invalid_parameters');
}

export function planJourneys(data:Timetable,paths:PedestrianPaths,request:PlanRequest):Journey[]{
  validatePlanRequest(data,request);
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
      walkingMeters:p.distanceMeters,latestLeaveAtSeconds:request.departAfterSeconds,legs:[pathLeg(p,paths.origin,routableStopCoordinate(stop),'access')],boardings:[]});
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
      const vehicleKey=`${serviceDate}:${trip.id}`;
      const boardingCandidates:{state:State;index:number}[]=[];
      for(let i=0;i<rows.length;i++){
        const stopTime=rows[i]!;
        if((stopTime.pickupType==null||stopTime.pickupType===0)&&stopTime.departureSeconds!=null){
          for(const option of frontier.get(stopTime.stopId)??[]){
            if(hasVehicle(option,trip.id,serviceDate))continue;
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
              (b.state.rides===0?rows[b.index]!.departureSeconds!-(b.state.at-request.departAfterSeconds)-minBoarding:b.state.latestLeaveAtSeconds)-
              (a.state.rides===0?rows[a.index]!.departureSeconds!-(a.state.at-request.departAfterSeconds)-minBoarding:a.state.latestLeaveAtSeconds)||
              a.state.at-b.state.at||a.index-b.index);
            boardingCandidates.splice(36);
          }
        }
        if(stopTime.dropOffType===1||!(stopTime.dropOffType==null||stopTime.dropOffType===0)||stopTime.arrivalSeconds==null)continue;
        const alightStop=stopMap.get(stopTime.stopId);
        if(!alightStop)continue;
        // The final transfer round cannot board another vehicle. Only stops
        // with a validated egress can produce a completed journey now.
        if(round===maxTransfers&&!egressPaths.has(stopTime.stopId))continue;
        let previousContinuation:State|undefined;
        for(const chosen of boardingCandidates){
          if(chosen.index>=i)continue;
          const b=rows[chosen.index]!;
          const boardingStop=stopMap.get(b.stopId);
          if(!boardingStop)continue;
          const base=chosen.state;
          if(previousContinuation&&sameContinuation(previousContinuation,base))continue;
          const ride:RideLeg={type:'ride',tripId:trip.id,routeId:trip.routeId,routeName:route.name,
            mode:route.mode,headsign:trip.headsign??null,boardStopId:b.stopId,alightStopId:stopTime.stopId,
            boardAtSeconds:b.departureSeconds!,alightAtSeconds:stopTime.arrivalSeconds,
            boardAtServiceSeconds:b.departureSeconds!-serviceDayDelta,
            alightAtServiceSeconds:stopTime.arrivalSeconds-serviceDayDelta,
            boardDayOffset:Math.floor((b.departureSeconds!-serviceDayDelta)/86400),
            alightDayOffset:Math.floor((stopTime.arrivalSeconds-serviceDayDelta)/86400),serviceDate};
          const result:State={stopId:stopTime.stopId,at:stopTime.arrivalSeconds,rides:base.rides+1,
            parent:base,addedLeg:ride,boardingStop,legs:undefined,boardings:undefined,
            cachedMetadata:{last:vehicleKey,snap:metadata(base).snap,used:undefined},
            walkingMeters:base.walkingMeters,latestLeaveAtSeconds:base.rides===0
              ? b.departureSeconds!-(base.at-request.departAfterSeconds)-minBoarding
              : base.latestLeaveAtSeconds};
          addBest(next,result);
          previousContinuation=base;
        }
      }
    }
    // No later round uses transfer frontiers when the ride budget is spent.
    const expanded=new Map<string,State[]>();
    if(round<maxTransfers){
      // Transfer walking only after arriving on a vehicle.
      for(const [stopId,group] of next)expanded.set(stopId,group);
      for(const group of next.values())for(const origin of group){
        for(const p of transferMap.get(origin.stopId)??[]){
          if(origin.walkingMeters+p.distanceMeters>walkingCap)continue;
          const from=stopMap.get(p.fromStopId)!,to=stopMap.get(p.toStopId)!;
          const originMetadata=metadata(origin);
          addBest(expanded,{stopId:to.id,at:origin.at+p.durationSeconds,rides:origin.rides,
            walkingMeters:origin.walkingMeters+p.distanceMeters,
            latestLeaveAtSeconds:origin.latestLeaveAtSeconds,parent:origin,
            addedLeg:pathLeg(p,routableStopCoordinate(from),routableStopCoordinate(to),'transfer'),
            boardingStop:undefined,legs:undefined,boardings:undefined,
            cachedMetadata:{last:originMetadata.last,used:originMetadata.used,snap:originMetadata.snap||Boolean(p.requiresSnapConfirmation)}});
        }
      }
    }
    for(const group of next.values())for(const result of group){
      const stop=stopMap.get(result.stopId)!;
      for(const egress of egressPaths.get(result.stopId)??[]){
      if(result.walkingMeters+egress.distanceMeters>walkingCap)continue;
      const legs=stateLegs(result);
      const firstRide=legs.find((leg):leg is RideLeg=>leg.type==='ride');
      const access=legs.find((leg):leg is WalkLeg=>leg.type==='walk'&&leg.purpose==='access');
      // Include required boarding slack: later advertised departures must
      // remain physically reachable, not just convenient-looking timestamps.
      const latestLeaveAtSeconds=firstRide
        ? firstRide.boardAtSeconds-(access?.durationSeconds??0)-minBoarding
        : request.departAfterSeconds;
      candidates.push({serviceDate:request.serviceDate,feedVersion:data.feedVersion,
        departureAtSeconds:request.departAfterSeconds,latestLeaveAtSeconds,
        arrivalAtSeconds:result.at+egress.durationSeconds,
        transfers:result.rides-1,walkingMeters:result.walkingMeters+egress.distanceMeters,
        boardings:stateBoardings(result),legs:[...legs,pathLeg(egress,routableStopCoordinate(stop),paths.destination,'egress')],
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
  // Reject clearly non-local loops BEFORE Pareto: an impossible detour must
  // not dominate and erase a valid local route during the ranking phase.
  const credible=nonDominatedJourneys([...journeys.values()].flat().filter(j=>
    !hasExtremeGeographicDetour(j,paths.origin,paths.destination,stopMap)));
  const ranked=rankBy==='fastest'?removeLowValueFastestAlternatives(credible):credible;
  return ranked.sort((a,b)=>{
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
