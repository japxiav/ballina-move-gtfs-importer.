import type {Timetable,LatLon,Journey} from './types';
import {validDate,dstTransitionDay,offsetServiceDate} from './time';
import {planDoorToDoor} from './planner';
import {nonDominatedJourneys} from './engine';
import type {WalkingRouter} from './pedestrian';
import {journeyBoardingDetails} from './boardingEvidence';
import {journeyConnections} from './connections';
import {nearbyStops} from './nearbyStops';

/** Transport-neutral fetch handler; designed for a trusted server runtime, not a browser bundle. */
export interface RoutingApiDependencies {
  loadTimetable: () => Promise<Timetable>;
  router: WalkingRouter;
  /** Caller identity comes from the trusted host connection, NEVER from x-forwarded-for. */
  clientIdentity: (request:Request) => string;
  /** REQUIRED distributed rate limiter for production. Must fail closed on backend errors. */
  consumeRateLimit: (bucket:string, limit:number, windowSeconds:number) => Promise<boolean>;
  allowedOrigins?:string[];
  now?:()=>Date;
  /** Sanitized operational events only; never pass raw errors or personal coordinates. */
  reportError?:(event:{stage:'rate_limit'|'snapshot'|'routing'|'nearby';code:string;requestId:string})=>void;
}

type Preference='fastest'|'less_walking'|'fewest_transfers';
type Input={serviceDate:string;departAt:string;origin:LatLon;destination:LatLon;maxTransfers:number;maxWalkingMeters:number;limit:number;prioritize:Preference};
const BODY_LIMIT=4096;
const IRELAND={minLat:51.3,maxLat:55.8,minLon:-11.1,maxLon:-5.2};
const hardenHeaders:Record<string,string>={
  'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
  'Vary':'Origin',
};
function json(value:unknown,status=200,extra:Record<string,string>={}):Response{
  return new Response(JSON.stringify(value),{status,headers:{...hardenHeaders,'Content-Type':'application/json; charset=utf-8',...extra}});
}
function isObject(value:unknown):value is Record<string,unknown> {
  return value!==null && typeof value==='object' && !Array.isArray(value);
}
function inIreland(value:unknown):value is LatLon {
  if(!isObject(value)||Object.keys(value).some(k=>k!=='lat'&&k!=='lon'))return false;
  const {lat,lon}=value;
  return typeof lat==='number'&&Number.isFinite(lat)&&lat>=IRELAND.minLat&&lat<=IRELAND.maxLat&&
    typeof lon==='number'&&Number.isFinite(lon)&&lon>=IRELAND.minLon&&lon<=IRELAND.maxLon;
}
function calendarDays(a:string,b:string):number {
  return Math.floor((Date.parse(a+'T00:00:00Z')-Date.parse(b+'T00:00:00Z'))/86400000);
}
function parseInput(raw:unknown,now:Date):Input|null{
  if(!isObject(raw))return null;
  const keys=['serviceDate','departAt','origin','destination','maxTransfers','maxWalkingMeters','limit','prioritize'];
  if(Object.keys(raw).some(k=>!keys.includes(k)))return null;
  const serviceDate=raw.serviceDate;
  const departAt=raw.departAt;
  if(typeof serviceDate!=='string'||!validDate(serviceDate))return null;
  // Protect against arbitrary historic browsing and long-range provider consumption.
  const dateParts=new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Dublin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);
  const getDate=(name:string)=>dateParts.find(part=>part.type===name)?.value??'';
  const localToday=`${getDate('year')}-${getDate('month')}-${getDate('day')}`;
  const delta=calendarDays(serviceDate,localToday);
  if(!Number.isFinite(delta)||delta<0||delta>14)return null;
  if(typeof departAt!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(departAt))return null;
  if(!inIreland(raw.origin)||!inIreland(raw.destination))return null;
  const maxTransfers=raw.maxTransfers??1,maxWalkingMeters=raw.maxWalkingMeters??2000,limit=raw.limit??3;
  const prioritize=raw.prioritize??'fastest';
  if(prioritize!=='fastest'&&prioritize!=='less_walking'&&prioritize!=='fewest_transfers')return null;
  if(typeof maxTransfers!=='number'||typeof maxWalkingMeters!=='number'||typeof limit!=='number'||
    !Number.isInteger(maxTransfers)||maxTransfers<0||maxTransfers>2||
    !Number.isInteger(maxWalkingMeters)||maxWalkingMeters<100||maxWalkingMeters>2500||
    !Number.isInteger(limit)||limit<1||limit>3)return null;
  return {serviceDate,departAt,origin:raw.origin,destination:raw.destination,maxTransfers,maxWalkingMeters,limit,prioritize};
}
async function readLimitedJson(req:Request):Promise<unknown>{
  if(!req.body)throw new Error('missing_body');
  const header=req.headers.get('content-length');
  if(header&&(!/^\d+$/.test(header)||Number(header)>BODY_LIMIT))throw new Error('payload_too_large');
  const reader=req.body.getReader();let count=0;const chunks:Uint8Array[]=[];
  try {
    for(;;){const result=await reader.read();if(result.done)break;
      count+=result.value.byteLength;
      if(count>BODY_LIMIT)throw new Error('payload_too_large');
      chunks.push(result.value);
    }
  } catch(error) {
    await reader.cancel().catch(()=>undefined);
    throw error;
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(count);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown;
}

/** Bounded stop discovery is a geographic lookup, not proof of walking access. */
function parseNearby(url:URL):{origin:LatLon;radiusMeters:number;limit:number}|null{
  const keys:string[]=[];url.searchParams.forEach((_value,key)=>{keys.push(key)});
  if(keys.some(k=>!['lat','lon','radiusMeters','limit'].includes(k)))return null;
  if(new Set(keys).size!==keys.length)return null;
  const latString=url.searchParams.get('lat'),lonString=url.searchParams.get('lon');
  if(!latString||!lonString||!/^-?\d{1,2}(?:\.\d{1,7})?$/.test(latString)||!/^-?\d{1,3}(?:\.\d{1,7})?$/.test(lonString))return null;
  const origin={lat:Number(latString),lon:Number(lonString)};
  if(!inIreland(origin))return null;
  const radiusText=url.searchParams.get('radiusMeters')??'1200',limitText=url.searchParams.get('limit')??'8';
  if(!/^\d{1,4}$/.test(radiusText)||!/^\d{1,2}$/.test(limitText))return null;
  const radiusMeters=Number(radiusText),limit=Number(limitText);
  if(radiusMeters<100||radiusMeters>2500||limit<1||limit>15)return null;
  return {origin,radiusMeters,limit};
}

export function rankItineraries(journeys:Journey[],preference:Preference,limit:number):Journey[]{
  const copy=nonDominatedJourneys(journeys);
  copy.sort((a,b)=>{
    if(preference==='less_walking')return a.walkingMeters-b.walkingMeters||a.arrivalAtSeconds-b.arrivalAtSeconds||a.transfers-b.transfers;
    if(preference==='fewest_transfers')return a.transfers-b.transfers||a.arrivalAtSeconds-b.arrivalAtSeconds||a.walkingMeters-b.walkingMeters;
    return a.arrivalAtSeconds-b.arrivalAtSeconds||a.transfers-b.transfers||a.walkingMeters-b.walkingMeters;
  });
  return copy.slice(0,limit);
}

export function createRoutingApi(deps:RoutingApiDependencies):(req:Request)=>Promise<Response>{
  if(!deps.loadTimetable||!deps.router||!deps.clientIdentity||!deps.consumeRateLimit)throw new Error('missing_routing_api_dependencies');
  const permitted=new Set(deps.allowedOrigins??[]);
  function report(stage:'rate_limit'|'snapshot'|'routing'|'nearby',e:unknown,requestId:string):void {
    // Only stable error codes from our own code; upstream error messages can contain secrets.
    const message=e instanceof Error?e.message:'';
    const code=(e instanceof Error&&(e.name==='TimeoutError'||e.name==='AbortError'))?'request_timeout':/^(snapshot_http_(?:400|401|403|404|408|409|413|429|500|502|503|504)|active_feed_(?:unavailable_or_ambiguous|switched_during_snapshot)|mixed_gtfs_version_[a-z_]+|snapshot_(?:page_overflow|limit_exceeded)_[a-z_]+|incomplete_snapshot|snapshot_broken_references|walking_api_failed_(?:400|401|403|404|408|429|500|502|503|504)|invalid_polyline|invalid_snapshot_response|invalid_snapshot_count|snapshot_count_mismatch|rate_limiter_unavailable|invalid_rate_limiter_response|request_timeout|provider_timeout)$/.test(message)
      ?message:'unexpected_error';
    try{deps.reportError?.({stage,code,requestId});}catch{/* telemetry cannot change response */}
  }
  return async(req:Request):Promise<Response>=>{
    const requestId=crypto.randomUUID();
    const origin=req.headers.get('origin');
    const cors:Record<string,string> = origin&&permitted.has(origin) ? {
      'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600',
    }:{};
    if(origin&&!permitted.has(origin))return json({error:'origin_not_allowed'},403);
    if(req.method==='OPTIONS')return new Response(null,{status:204,headers:{...hardenHeaders,...cors}});
    const pathname=new URL(req.url).pathname;
    if(pathname==='/health'&&req.method==='GET')return json({status:'available',service:'ballina-routing-api',realtime:false},200,cors);
    const isNearby=pathname==='/v1/nearby-stops';
    if(pathname!=='/v1/journeys'&&!isNearby)return json({error:'not_found'},404,cors);
    if(isNearby ? req.method!=='GET' : req.method!=='POST')return json({error:'method_not_allowed'},405,cors);
    if(!isNearby){
      const mediaType=req.headers.get('content-type')?.split(';',1)[0]?.trim().toLowerCase();
      if(mediaType!=='application/json')return json({error:'unsupported_media_type'},415,cors);
    }
    try {
      // Two independent limits. All unauthenticated clients share a global ceiling.
      if(!await deps.consumeRateLimit('routing|global',200,60))return json({error:'rate_limited'},429,{...cors,'Retry-After':'60'});
      const identity=deps.clientIdentity(req)||'unidentified';
      // Protect limiter storage from unlimited arbitrary caller-controlled bucket strings.
      const safeIdentity=identity.slice(0,120);
      if(!await deps.consumeRateLimit(`routing|client|${safeIdentity}`,10,60))return json({error:'rate_limited'},429,{...cors,'Retry-After':'60'});
    }catch(e){report('rate_limit',e,requestId);return json({error:'temporarily_unavailable',requestId},503,cors);}
    if(isNearby){
      const input=parseNearby(new URL(req.url));
      if(!input)return json({error:'invalid_nearby_request'},400,cors);
      try{
        const timetable=await deps.loadTimetable();
        return json({feedVersion:timetable.feedVersion,stops:nearbyStops(timetable,input.origin,input.radiusMeters,input.limit),
          distanceType:'straight_line_approximation_not_walking_route',
          boardingNote:'Stop pole, correct sidewalk or bay remain unverified without independent evidence.',
          realtime:false,attribution:'National Transport Authority (NTA) / GTFS timetable data'},200,cors);
      }catch(e){report('nearby',e,requestId);return json({error:'temporarily_unavailable',requestId},503,cors);}
    }
    let raw:unknown;
    try{raw=await readLimitedJson(req)}
    catch(e){return json({error:e instanceof Error&&e.message==='payload_too_large'?'payload_too_large':'invalid_json'},400,cors);}
    const input=parseInput(raw,(deps.now??(()=>new Date()))());
    if(!input)return json({error:'invalid_route_request'},400,cors);
    if(dstTransitionDay(input.serviceDate))return json({error:'dst_transition_not_supported_yet'},422,cors);
    // The walking provider is metered. Restrict paid itinerary queries across all
    // function instances, independent of the short-minute abuse limiter above.
    try{
      if(!await deps.consumeRateLimit('routing|paid-global|hourly',12,3600))
        return json({error:'pilot_hourly_budget_exhausted'},429,{...cors,'Retry-After':'3600'});
    }catch(e){report('rate_limit',e,requestId);return json({error:'temporarily_unavailable',requestId},503,cors);}
    let stage:'snapshot'|'routing'='snapshot';
    try{
      const timetable=await deps.loadTimetable();
      stage='routing';
      const result=await planDoorToDoor(timetable,deps.router,{
        serviceDate:input.serviceDate,departAfterSeconds:Number(input.departAt.slice(0,2))*3600+Number(input.departAt.slice(3,5))*60,
        origin:input.origin,destination:input.destination,maxTransfers:input.maxTransfers,
        maxWalkingMeters:input.maxWalkingMeters,limit:input.limit,rankBy:input.prioritize,
        minTransferSeconds:180,minBoardingSeconds:90,
      },{
        maxRequestCount:12,maxOriginStops:4,maxDestinationStops:4,maxTransferPairs:4,
        requestDeadlineMs:20000,maxConcurrentWalkingRequests:2,signal:req.signal,
        maxPedestrianDistanceMeters:input.maxWalkingMeters,
        includeRail:false,
      });
      const journeys=rankItineraries(result.journeys,input.prioritize,input.limit).map((journey:Journey)=>({
        ...journey,
        boardingDetails:journeyBoardingDetails(journey,timetable.stops),
        connections:journeyConnections(journey,timetable.stops),
      }));
      const adjacentDstDates=[-1,1].map(offset=>offsetServiceDate(input.serviceDate,offset)).filter(dstTransitionDay);
      const walkingSnapWarning=journeys.some(j=>j.legs.some(l=>l.type==='walk'&&l.endpointSnapMeters &&
        (l.endpointSnapMeters.from>5||l.endpointSnapMeters.to>5)));
      return json({serviceDate:input.serviceDate,feedVersion:result.feedVersion,prioritize:input.prioritize,journeys,
        walkingCoverage:result.coverage,
        coverageWarnings:[...(result.coverage?.candidateLimitReached?[{code:'candidate_limit_reached',note:'Search used a bounded set of stops or transfer candidates; further transport alternatives may exist.'}]:[]),
          ...(result.coverage && (result.coverage.skippedBudget>0||result.coverage.directSkippedBudget)?
          [{code:'walking_budget_truncated',note:'Provider-call budget was exhausted. More route alternatives or walk-only routes may exist.'}]:[]),
          ...(adjacentDstDates.length?[{code:'adjacent_dst_service_day_excluded',dates:adjacentDstDates}]:[]),
          ...(walkingSnapWarning?[{code:'street_snap_gap_unrouted',note:'Unrouted endpoint gaps are included using an UNVERIFIED straight-line walking-time estimate; do not draw those segments as walkable geometry.'}]:[]),
          ...(journeys.some(j=>j.requiresSnapConfirmation)?[{code:'snap_confirmation_required',note:'One or more itineraries have a street snap exceeding 25 m. Display the adjusted road point and require the passenger to check accessibility before using the route.'}]:[])],
        realtime:false,status:'scheduled_only',
        coverageNote:'Regional GTFS subset: no result does not prove no public transport exists.',
        boardingNote:'Official GTFS stop coordinates do not independently verify the side of the street or bay.',
        attribution:'National Transport Authority (NTA) / GTFS timetable data',
      },200,cors);
    }catch(e){
      report(stage,e,requestId);
      return json({error:'temporarily_unavailable',requestId},503,cors);
    }
  };
}

/** Development/testing only. Production MUST use a shared, atomic rate limiter. */
export function createMemoryRateLimiter(now:()=>number=()=>Date.now()) {
  const buckets=new Map<string,{count:number;endsAt:number}>();
  return async(key:string,limit:number,seconds:number):Promise<boolean>=>{
    const tick=now();
    if(buckets.size>2000){for(const [k,v] of buckets){if(v.endsAt<=tick)buckets.delete(k);}}
    const previous=buckets.get(key);
    const entry=!previous||previous.endsAt<=tick?{count:0,endsAt:tick+seconds*1000}:previous;
    entry.count++;
    buckets.set(key,entry);
    return entry.count<=limit;
  };
}

/** One expensive paginated GTFS load per TTL, with concurrent-call deduplication. */
export function createSnapshotCache(loader:()=>Promise<Timetable>,ttlMs=300000,clock:()=>number=()=>Date.now()):()=>Promise<Timetable>{
  if(!Number.isInteger(ttlMs)||ttlMs<1000||ttlMs>900000)throw new Error('invalid_cache_ttl');
  let current:Timetable|undefined;let expires=0;let pending:Promise<Timetable>|undefined;
  return async()=>{
    if(current&&clock()<expires)return current;
    if(!pending){
      pending=loader().then(result=>{
        if(!result.feedVersion||!result.stops.length||!result.trips.length)throw new Error('invalid_snapshot');
        current=result;expires=clock()+ttlMs;return result;
      }).finally(()=>{pending=undefined});
    }
    return pending;
  };
}
