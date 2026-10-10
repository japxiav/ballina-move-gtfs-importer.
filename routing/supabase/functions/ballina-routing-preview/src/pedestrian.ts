import type {LatLon,PedestrianPaths,Stop,WalkPath,AccessWalk,TransferWalk} from './types.ts';
import {proximityMeters,routableStopCoordinate,MAX_WALK_ENDPOINT_DRIFT_METERS,MAX_USER_ENDPOINT_DRIFT_METERS,USER_SNAP_CONFIRMATION_METERS} from './boarding.ts';

export type EndpointRole='stop'|'user';
export interface WalkingEndpointRoles {fromRole:EndpointRole;toRole:EndpointRole;}
export interface DriftSample {endpoint:'from'|'to';role:EndpointRole;bucket:'0-5'|'5-12'|'12-25'|'25-50'|'50-80'|'>80';accepted:boolean;}
/** No raw coordinates or exact household offsets are logged. */
function driftBucket(m:number):DriftSample['bucket'] {return m<=5?'0-5':m<=12?'5-12':m<=25?'12-25':m<=50?'25-50':m<=80?'50-80':'>80';}
export interface WalkingRouter {walk(from:LatLon,to:LatLon,roles?:WalkingEndpointRoles,signal?:AbortSignal):Promise<WalkPath|null>; }
/** Valhalla returns polyline6, NOT Google polyline5. */
export function decodePolyline6(polyline:string):LatLon[] {
  const out:LatLon[]=[];let index=0,lat=0,lon=0;
  function read():number {
    let shift=0,result=0;
    for(let steps=0;steps<10;steps++){
      if(index>=polyline.length)throw new Error('invalid_polyline');
      const code=polyline.charCodeAt(index++)-63;
      if(code<0||code>63)throw new Error('invalid_polyline');
      result|=(code&31)<<shift;shift+=5;
      if(code<32)return (result&1)?~(result>>1):(result>>1);
    }
    throw new Error('invalid_polyline');
  }
  while(index<polyline.length){lat+=read();lon+=read();out.push({lat:lat/1e6,lon:lon/1e6});}
  return out;
}
interface ValhallaResponse {trip?: {summary?: {time?:number;length?:number};legs?:{shape?:string}[]};}
/** Server-side adapter. Key stays on the backend. No API call occurs unless walk() is invoked. */
export class StadiaWalkingRouter implements WalkingRouter {
  constructor(private readonly apiKey:string,
    private readonly http:typeof fetch=fetch,
    private readonly baseUrl='https://api-eu.stadiamaps.com',
    private readonly observeDrift?:(sample:DriftSample)=>void) {
    if(!apiKey)throw new Error('missing_stadia_api_key');
    if(!/^https:\/\/api(-eu)?\.stadiamaps\.com$/.test(baseUrl))throw new Error('unapproved_stadia_endpoint');
  }
  async walk(from:LatLon,to:LatLon,roles:WalkingEndpointRoles={fromRole:'stop',toRole:'stop'},signal?:AbortSignal):Promise<WalkPath|null> {
    if(!validCoordinate(from)||!validCoordinate(to))throw new Error('invalid_coordinates');
    const url=`${this.baseUrl}/route/v1`;
    const response=await this.http(url,{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':`Stadia-Auth ${this.apiKey}`},
      body:JSON.stringify({locations:[from,to],costing:'pedestrian',units:'kilometers',shape_format:'polyline6'}),
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(12000)]):AbortSignal.timeout(12000),
    });
    if(response.status===400||response.status===404)return null; // no routable path or invalid request, reject.
    if(!response.ok)throw new Error(`walking_api_failed_${response.status}`);
    const result=await response.json() as ValhallaResponse;
    const time=result.trip?.summary?.time;
    const distanceKm=result.trip?.summary?.length;
    const shape=result.trip?.legs?.[0]?.shape;
    if(typeof time!=='number'||typeof distanceKm!=='number'||typeof shape!=='string')return null;
    const geometry=decodePolyline6(shape);
    if(geometry.length<2||!Number.isFinite(time)||time<0||!Number.isFinite(distanceKm)||distanceKm<0)return null;
    const fromMeters=proximityMeters(geometry[0]!,from);
    const toMeters=proximityMeters(geometry[geometry.length-1]!,to);
    const accepted=fromMeters<=(roles.fromRole==='user'?MAX_USER_ENDPOINT_DRIFT_METERS:MAX_WALK_ENDPOINT_DRIFT_METERS)&&
      toMeters<=(roles.toRole==='user'?MAX_USER_ENDPOINT_DRIFT_METERS:MAX_WALK_ENDPOINT_DRIFT_METERS);
    try {
      this.observeDrift?.({endpoint:'from',role:roles.fromRole,bucket:driftBucket(fromMeters),accepted});
      this.observeDrift?.({endpoint:'to',role:roles.toRole,bucket:driftBucket(toMeters),accepted});
    }catch{/* Observability must never affect routing. */}
    if(!accepted)return null;
    // Valhalla's geometry starts at the snapped street point, not necessarily at the
    // user's real door or the GTFS stop. The missing connectors are NOT known walkable.
    // Count a straight-line estimate in both the walk budget and ETA, without drawing
    // a made-up segment or representing it as provider-confirmed route geometry.
    const connectorMeters=Math.ceil(fromMeters+toMeters);
    const connectorSeconds=Math.ceil(connectorMeters/1.2);
    const requireConfirmation=(roles.fromRole==='user'&&fromMeters>USER_SNAP_CONFIRMATION_METERS)||
      (roles.toRole==='user'&&toMeters>USER_SNAP_CONFIRMATION_METERS);
    const snappedUserEndpoints={
      ...(roles.fromRole==='user'&&fromMeters>USER_SNAP_CONFIRMATION_METERS?{from:geometry[0]!}:{}),
      ...(roles.toRole==='user'&&toMeters>USER_SNAP_CONFIRMATION_METERS?{to:geometry[geometry.length-1]!}:{})};
    return {durationSeconds:Math.ceil(time)+connectorSeconds,
      distanceMeters:Math.ceil(distanceKm*1000)+connectorMeters,geometry,
      provider:'stadia-valhalla-pedestrian',endpointSnapMeters:{from:Math.round(fromMeters),to:Math.round(toMeters)},
      unverifiedConnector:{meters:connectorMeters,estimatedSeconds:connectorSeconds,estimateOnly:true as const},
      ...(requireConfirmation?{requiresSnapConfirmation:true,snappedUserEndpoints}:{})};
  }
}
function validCoordinate(c:LatLon):boolean{return Number.isFinite(c.lat)&&Number.isFinite(c.lon)&&Math.abs(c.lat)<=90&&Math.abs(c.lon)<=180;}
export interface BuildPathsOptions {
  maxOriginStops?:number;maxDestinationStops?:number;candidateRadiusMeters?:number;
  /** GTFS topology hints only: never considered proof of a walkable path. */
  preferredOriginStopIds?:string[];preferredDestinationStopIds?:string[];
  /** Nonstop, time-feasible GTFS services outrank speculative transfers. */
  directOriginStopIds?:string[];directDestinationStopIds?:string[];
  /** GTFS-only hints for transfer prioritization. Never eliminate other pairs. */
  preferredTransferFromStopIds?:string[];preferredTransferToStopIds?:string[];
  maxTransferPairs?:number;maxRequestCount?:number;maxPedestrianDistanceMeters?:number;
  /** Absolute deadline for the whole pedestrian search, including all paid calls. */
  requestDeadlineMs?:number;
  /** A small worker pool prevents serial timeout accumulation and billing bursts. */
  maxConcurrentWalkingRequests?:number;
  signal?:AbortSignal;
  /** Optional known transit connection pairs. Unknown pairs are never guessed from a direct-line drawing. */
  transferPairs?:Array<{fromStopId:string;toStopId:string;priority?:'cross_route'|'same_route'}>;
  /** Direct walk is optional because it spends one provider call when nonzero. */
  maxDirectWalkMeters?:number;
}
/** Candidate discovery MAY use straight-line proximity, but every accepted leg requires a real walking-route response. */
export async function buildPedestrianPaths(router:WalkingRouter,stops:Stop[],origin:LatLon,destination:LatLon,opts:BuildPathsOptions={}):Promise<PedestrianPaths> {
  if(!validCoordinate(origin)||!validCoordinate(destination))throw new Error('invalid_coordinates');
  const originCap=Math.max(0,Math.min(opts.maxOriginStops??8,20));
  const destCap=Math.max(0,Math.min(opts.maxDestinationStops??8,20));
  const radius=Math.max(0,opts.candidateRadiusMeters??1500);
  const maxTransfers=Math.max(0,Math.min(opts.maxTransferPairs??32,100));
  const budget=Math.max(0,Math.min(opts.maxRequestCount??50,200));
  const walkCap=Math.max(0,opts.maxPedestrianDistanceMeters??2500);
  const deadline=Math.max(100,Math.min(opts.requestDeadlineMs??20000,60000));
  const concurrency=Math.max(1,Math.min(opts.maxConcurrentWalkingRequests??2,3));
  const timeoutSignal=AbortSignal.timeout(deadline);
  const signal=opts.signal?AbortSignal.any([opts.signal,timeoutSignal]):timeoutSignal;
  let used=0;
  let skippedBudget=0;
  let directSkippedBudget=false;
  const requestWalk=async(a:LatLon,b:LatLon,roles:WalkingEndpointRoles):Promise<WalkPath|null>=>{
    if(signal.aborted)throw new Error('request_timeout');
    // Different GTFS stop IDs are not proof of the same physical boarding bay,
    // even if their provider coordinates happen to coincide exactly. Such a
    // transfer cannot be independently routed or verified by a zero-length path.
    if(roles.fromRole==='stop'&&roles.toRole==='stop'&&proximityMeters(a,b)<0.01)return null;
    // Boarding directly at a known stop must not depend on providers accepting
    // zero-length requests (many routers reject identical endpoints).
    if(proximityMeters(a,b)<0.01){
      return {durationSeconds:0,distanceMeters:0,geometry:[a,b],provider:'identical-endpoints-no-walk'};
    }
    if(used>=budget){skippedBudget++;return null;}
    used++;
    // Promise.race also enforces the deadline for test/third-party routers
    // that ignore AbortSignal. Stadia itself receives the cancellation signal.
    let onAbort:(()=>void)|undefined;
    const aborted=new Promise<never>((_,reject)=>{
      onAbort=()=>reject(new Error('request_timeout'));
      signal.addEventListener('abort',onAbort,{once:true});
      if(signal.aborted)onAbort();
    });
    let r:WalkPath|null;
    try{r=await Promise.race([router.walk(a,b,roles,signal),aborted]);}
    finally{if(onAbort)signal.removeEventListener('abort',onAbort);}
    return r&&r.distanceMeters<=walkCap?r:null;
  };
  async function runBatch<T>(items:T[],fn:(item:T)=>Promise<void>):Promise<void>{
    let cursor=0;let failed=false;
    await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
      while(cursor<items.length&&!failed){
        const item=items[cursor++]!;
        try{await fn(item);}catch(e){failed=true;throw e;}
      }
    }));
  }
  const unique=[...new Map(stops.map(s=>[s.id,s])).values()].filter(s=>validCoordinate(s));
  const near=(p:LatLon,max:number,preferred:string[]|undefined,direct:string[]|undefined)=>{
    const priority=new Set(preferred??[]);
    const directPriority=new Set(direct??[]);
    return unique.map(s=>({s,d:proximityMeters(p,s)}))
      .filter(x=>x.d<=radius&&x.d<=walkCap)
      .sort((a,b)=>Number(b.d<=5&&priority.has(b.s.id))-Number(a.d<=5&&priority.has(a.s.id))||
        Number(directPriority.has(b.s.id))-Number(directPriority.has(a.s.id))||
        Number(priority.has(b.s.id))-Number(priority.has(a.s.id))||a.d-b.d||a.s.id.localeCompare(b.s.id))
      .slice(0,max).map(x=>x.s);
  };
  const originCandidateCount=unique.filter(s=>proximityMeters(origin,s)<=Math.min(radius,walkCap)).length;
  const destinationCandidateCount=unique.filter(s=>proximityMeters(destination,s)<=Math.min(radius,walkCap)).length;
  const origins=near(origin,originCap,opts.preferredOriginStopIds,opts.directOriginStopIds),
    destinations=near(destination,destCap,opts.preferredDestinationStopIds,opts.directDestinationStopIds);
  const access:AccessWalk[]=[],egress:AccessWalk[]=[],transfers:TransferWalk[]=[];
  let direct:WalkPath|undefined;
  const directCap=Math.max(0,Math.min(opts.maxDirectWalkMeters??0,walkCap));
  // Schedule optional walking-only search AFTER transit access, egress and
  // transfer candidates. One direct route must not steal the last paid request.
  await runBatch(origins,async s=>{const route=await requestWalk(origin,routableStopCoordinate(s),{fromRole:'user',toRole:'stop'});if(route)access.push({...route,stopId:s.id});});
  await runBatch(destinations,async s=>{const route=await requestWalk(routableStopCoordinate(s),destination,{fromRole:'stop',toRole:'user'});if(route)egress.push({...route,stopId:s.id});});
  // Reestablish stable candidate order regardless of provider response timing.
  const originOrder=new Map(origins.map((s,i)=>[s.id,i]));
  const destOrder=new Map(destinations.map((s,i)=>[s.id,i]));
  access.sort((a,b)=>(originOrder.get(a.stopId)??999)-(originOrder.get(b.stopId)??999));
  egress.sort((a,b)=>(destOrder.get(a.stopId)??999)-(destOrder.get(b.stopId)??999));
  // Discover short transfers deterministically, independent of the GTFS stop import order.
  // Spread candidates across geographic cells instead of exhausting the budget in one town.
  const known=new Map(unique.map(s=>[s.id,s]));
  const pairs:{a:Stop;b:Stop;distance:number;priority:'cross_route'|'same_route'}[]=[];
  const seen=new Set<string>();
  const addPair=(a:Stop,b:Stop,priority:'cross_route'|'same_route'='cross_route')=>{
    if(a.id===b.id)return;
    if(proximityMeters(routableStopCoordinate(a),routableStopCoordinate(b))<0.01)return;
    const k=JSON.stringify([a.id,b.id]);
    if(seen.has(k))return;
    seen.add(k);
    const distance=proximityMeters(routableStopCoordinate(a),routableStopCoordinate(b));
    // Straight-line distance is a LOWER bound on pedestrian distance, never a
    // 650m service radius. Let the verified router decide walkability within the
    // remaining request-wide walking allowance.
    if(distance<=walkCap)pairs.push({a,b,distance,priority});
  };
  if(opts.transferPairs){
    for(const pair of opts.transferPairs){
      const a=known.get(pair.fromStopId),b=known.get(pair.toStopId);
      if(a&&b)addPair(a,b,pair.priority??'cross_route');
    }
  }else{
    for(const a of unique)for(const b of unique)addPair(a,b);
  }
  const groups=new Map<string,typeof pairs>();
  for(const pair of pairs){
    const key=[Math.floor(pair.a.lat*50),Math.floor(pair.a.lon*50)].join(':');
    const group=groups.get(key)??[];group.push(pair);groups.set(key,group);
  }
  const cells=[...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  for(const [,group] of cells)group.sort((a,b)=>a.distance-b.distance||a.a.id.localeCompare(b.a.id)||a.b.id.localeCompare(b.b.id));
  const fromRelevant=new Set(opts.preferredTransferFromStopIds??[]);
  const toRelevant=new Set(opts.preferredTransferToStopIds??[]);
  const isRelevant=(pair:(typeof pairs)[number])=>fromRelevant.has(pair.a.id)&&toRelevant.has(pair.b.id);
  let attempted=0;
  const transferJobs:typeof pairs=[];
  // Spend scarce walking queries on transit-topology-plausible transfers first.
  // The hints are directional and advisory: candidate discovery is bounded and
  // may miss a valid connection, so every other pair remains a fallback.
  // Within each tier, retain deterministic geographic round-robin to avoid
  // spending the entire allowance in just one urban cluster.
  for(const relevant of [true,false]){
    for(const tier of ['cross_route','same_route'] as const){
      const priorityCells=cells.map(([key,group])=>[key,group.filter(p=>p.priority===tier&&isRelevant(p)===relevant)] as const);
      for(let depth=0;attempted<maxTransfers&&attempted<budget;depth++){
        let found=false;
        for(const [,group] of priorityCells){
          if(attempted>=maxTransfers||attempted>=budget)break;
          const pair=group[depth];if(!pair)continue;
          found=true;attempted++;transferJobs.push(pair);
        }
        if(!found)break;
      }
    }
  }
  await runBatch(transferJobs,async pair=>{
    // Directional road/crossing access. Never assume reverse direction is safe.
    const route=await requestWalk(routableStopCoordinate(pair.a),routableStopCoordinate(pair.b),{fromRole:'stop',toRole:'stop'});
    if(route)transfers.push({...route,fromStopId:pair.a.id,toStopId:pair.b.id});
  });
  const transferOrder=new Map(transferJobs.map((pair,i)=>[pair.a.id+'|'+pair.b.id,i]));
  transfers.sort((a,b)=>(transferOrder.get(a.fromStopId+'|'+a.toStopId)??999)-(transferOrder.get(b.fromStopId+'|'+b.toStopId)??999));
  if(directCap>0&&proximityMeters(origin,destination)<=directCap){
    if(used>=budget)directSkippedBudget=true;
    else {const proposed=await requestWalk(origin,destination,{fromRole:'user',toRole:'user'});
      if(proposed&&proposed.distanceMeters<=directCap)direct=proposed;}
  }
  // A09: Record the reason for candidate truncation without revealing stop
  // identifiers or user coordinates and without performing any provider calls.
  // "possibleGtfsPairs" includes worldwide GTFS pairs: it is NOT a count of
  // guaranteed, time-feasible passenger connections for this journey.
  const omittedOrigins=Math.max(0,originCandidateCount-origins.length);
  const omittedDestinations=Math.max(0,destinationCandidateCount-destinations.length);
  const omittedTransfers=Math.max(0,pairs.length-transferJobs.length);
  const limitedBy:Array<'origin_stop_cap'|'destination_stop_cap'|'transfer_pair_cap'|'transfer_preselection_budget'>=[];
  if(omittedOrigins>0)limitedBy.push('origin_stop_cap');
  if(omittedDestinations>0)limitedBy.push('destination_stop_cap');
  if(pairs.length>maxTransfers)limitedBy.push('transfer_pair_cap');
  if(pairs.length>budget&&budget<maxTransfers)limitedBy.push('transfer_preselection_budget');
  const candidateAudit={
    origins:{nearbyGeodesic:originCandidateCount,selectionLimit:originCap,selected:origins.length,omittedByStopCap:omittedOrigins},
    destinations:{nearbyGeodesic:destinationCandidateCount,selectionLimit:destCap,selected:destinations.length,omittedByStopCap:omittedDestinations},
    transfers:{possibleGtfsPairs:pairs.length,pairSelectionLimit:maxTransfers,selected:transferJobs.length,omittedBySelectionLimit:omittedTransfers,
      topologyHinted:pairs.filter(isRelevant).length,selectedTopologyHinted:transferJobs.filter(isRelevant).length},
    requestLimit:budget,limitedBy,
  };
  return {origin,destination,access,egress,transfers,direct,
    coverage:{planned:origins.length+destinations.length+transferJobs.length+
      Number(directCap>0&&proximityMeters(origin,destination)<=directCap),
      executed:used,skippedBudget,directSkippedBudget,
      // Candidate limits can truncate discovery even without a paid call
      // shortage. Never claim this is a complete transport network search.
      candidateLimitReached:limitedBy.length>0,candidateAudit}};
}
