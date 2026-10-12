/* A11 Phase 3: read-only GTFS + real-Stadia private canary. NEVER passenger navigation.
 * Auth gate: Supabase verify_jwt=true AND independent x-ballina-preview-token.
 * Request gate: fixed scenarios only AND explicit per-request paid call consent.
 * Resource gate: atomic Supabase shared rate-limit RPC, 2 canary itineraries/hour;
 * engine independently caps walking API requests at 12 per itinerary.
 * No synthetic walking, no public CORS, no collector writes, no deployment side effects.
 */
const {createRoutingApi,createSnapshotCache}=__ballinaRequire('./httpApi');
const {loadActiveGtfsSnapshot}=__ballinaRequire('./gtfsSnapshot');
const {StadiaWalkingRouter}=__ballinaRequire('./pedestrian');
const {createSupabaseRateLimiter}=__ballinaRequire('./supabaseLimiter');

function a11NamedKey(jsonName, alternatives){
  const raw=Deno.env.get(jsonName);
  if(raw){try{const value=JSON.parse(raw);if(value&&typeof value.default==='string')return value.default;}catch{ /* fail to aliases */ }}
  for(const key of alternatives){const value=Deno.env.get(key);if(value)return value;}
  return '';
}
const a11SupabaseUrl=Deno.env.get('SUPABASE_URL')??'';
const a11ServiceKey=a11NamedKey('SUPABASE_SECRET_KEYS',['SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','SB_SERVICE_ROLE_KEY']);
const a11PublicKey=a11NamedKey('SUPABASE_PUBLISHABLE_KEYS',['SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY']);
const a11StadiaKey=Deno.env.get('STADIA_API_KEY')??'';
const a11PreviewToken=Deno.env.get('BALLINA_ROUTING_PREVIEW_TOKEN')??'';
const a11TokenReady=a11PreviewToken.length>=32&&a11PreviewToken!==a11ServiceKey&&a11PreviewToken!==a11PublicKey;
const a11Ready=Boolean(/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(a11SupabaseUrl)&&a11ServiceKey&&a11StadiaKey&&a11TokenReady);
const a11Scenarios=Object.freeze({
  'ballina-foxford-bus':Object.freeze({origin:{lat:54.1118,lon:-9.1613},destination:{lat:53.9815,lon:-9.1114},modes:['bus'],maxWalkingMeters:1800}),
  'ballina-foxford-rail':Object.freeze({origin:{lat:54.1093,lon:-9.1620},destination:{lat:53.983,lon:-9.1353},modes:['rail'],maxWalkingMeters:1800}),
  'ballina-castlebar-bus':Object.freeze({origin:{lat:54.1118,lon:-9.1613},destination:{lat:53.8546,lon:-9.3032},modes:['bus'],maxWalkingMeters:1800}),
});
function a11Answer(body,status=200){return Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
// Bound real bytes, time and cancellation before touching the shared quota or provider.
const a11BodyLimit=512,a11BodyTimeout=10000;
async function a11ReadBody(req){
  const declared=req.headers.get('content-length');
  if(declared!==null){
    if(!/^\d+$/.test(declared))throw Error('invalid_content_length');
    if(!Number.isSafeInteger(Number(declared))||Number(declared)>a11BodyLimit)throw Error('payload_too_large');
  }
  if(req.signal.aborted)throw Error('request_aborted');
  if(!req.body)return '';
  const reader=req.body.getReader(),buffer=new Uint8Array(a11BodyLimit);
  const expires=Date.now()+a11BodyTimeout;
  let size=0,stopped=null,rejectCurrent=null;
  const stop=code=>{
    if(!stopped)stopped=Error(code);
    if(rejectCurrent)rejectCurrent(stopped);
  };
  const abort=()=>stop('request_aborted');
  req.signal.addEventListener('abort',abort,{once:true});
  const timer=setTimeout(()=>stop('body_timeout'),a11BodyTimeout);
  try{
    while(true){
      if(req.signal.aborted)abort();
      if(Date.now()>=expires)stop('body_timeout');
      if(stopped)throw stopped;
      const part=await new Promise((resolve,reject)=>{
        rejectCurrent=reject;
        reader.read().then(resolve,reject);
      }).finally(()=>{rejectCurrent=null;});
      // An EOF microtask can arrive before the expired timer gets dispatched.
      if(Date.now()>=expires)stop('body_timeout');
      if(req.signal.aborted)abort();
      if(stopped)throw stopped;
      if(part.done)break;
      if(size+part.value.byteLength>a11BodyLimit)throw Error('payload_too_large');
      buffer.set(part.value,size);size+=part.value.byteLength;
    }
    return new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,size));
  }catch(error){
    // The HTTP host owns cancellation after request abort; do not cancel it twice.
    if(!req.signal.aborted){
      try{Promise.resolve(reader.cancel()).catch(()=>{});}catch{ /* already closed */ }
    }
    throw error;
  }finally{
    clearTimeout(timer);req.signal.removeEventListener('abort',abort);
    try{reader.releaseLock();}catch{ /* host already released */ }
  }
}
async function a11TokenMatches(candidate){
  if(!a11TokenReady||!candidate||candidate.length>256)return false;
  const hash=async text=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));
  const actual=await hash(a11PreviewToken),given=await hash(candidate);
  let delta=0;for(let i=0;i<actual.length;i++)delta|=actual[i]^given[i];
  return delta===0;
}
function a11ParseRequest(raw){
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='confirmPaidCalls,departAt,scenarioId,serviceDate')return null;
  if(raw.confirmPaidCalls!=='YES_UP_TO_12_WALKS'||typeof raw.scenarioId!=='string'||!Object.hasOwn(a11Scenarios,raw.scenarioId))return null;
  if(typeof raw.serviceDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(raw.serviceDate))return null;
  const day=new Date(raw.serviceDate+'T00:00:00Z');
  if(!Number.isFinite(day.getTime())||day.toISOString().slice(0,10)!==raw.serviceDate)return null;
  // Match the engine's Europe/Dublin local-day range: today through +14 days.
  // GTFS 25:xx/previous service days are handled inside the routing engine.
  const localParts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Dublin',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const localPart=type=>localParts.find(part=>part.type===type)?.value??'';
  const localToday=Date.parse(`${localPart('year')}-${localPart('month')}-${localPart('day')}T00:00:00Z`);
  const offset=Math.round((day.getTime()-localToday)/86400000);
  if(offset<0||offset>14)return null;
  if(typeof raw.departAt!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.departAt))return null;
  return {scenarioId:raw.scenarioId,serviceDate:raw.serviceDate,departAt:raw.departAt};
}
const a11Limiter=a11Ready?createSupabaseRateLimiter({supabaseUrl:a11SupabaseUrl,privateKey:a11ServiceKey}):null;
const a11Snapshot=a11Ready?createSnapshotCache(()=>loadActiveGtfsSnapshot({supabaseUrl:a11SupabaseUrl,privateKey:a11ServiceKey}),300000):null;
const a11Api=a11Ready?createRoutingApi({
  loadTimetable:a11Snapshot,
  router:new StadiaWalkingRouter(a11StadiaKey,fetch,'https://api-eu.stadiamaps.com'),
  clientIdentity:()=> 'private-a11-canary',
  consumeRateLimit:a11Limiter,
  allowedOrigins:[],
  reportError:e=>console.error(JSON.stringify({service:'ballina-a11-realwalking-canary',stage:e.stage,code:e.code})),
}):null;

Deno.serve(async(req)=>{
  // Supabase MUST deploy this function with verify_jwt=true; application token is an additional gate.
  if(req.headers.get('origin'))return a11Answer({error:'origin_not_allowed'},403);
  if(!a11TokenReady)return a11Answer({error:'canary_not_configured'},503);
  if(!await a11TokenMatches(req.headers.get('x-ballina-preview-token')))return a11Answer({error:'unauthorized'},401);
  const url=new URL(req.url);
  if([...url.searchParams.keys()].length)return a11Answer({error:'invalid_query'},400);
  const path=url.pathname;
  if(path.endsWith('/health')&&req.method==='GET'){
    return a11Answer({service:'ballina-a11-realwalking-canary',private:true,notForPassengers:true,
      syntheticWalking:false,ready:a11Ready,stadiaConfigured:Boolean(a11StadiaKey),
      rateLimit:'2 integration journeys per hour, maximum 12 provider requests each'});
  }
  if(path.endsWith('/v1/gtfs-summary')&&req.method==='GET'){
    if(!a11Ready)return a11Answer({error:'canary_not_configured'},503);
    try{
      const data=await a11Snapshot();
      return a11Answer({service:'ballina-a11-realwalking-canary',feedVersion:data.feedVersion,
        counts:{stops:data.stops.length,routes:data.routes.length,trips:data.trips.length,stopTimes:data.stopTimes.length},
        notForPassengers:true,paidWalkingCalls:0});
    }catch{return a11Answer({error:'snapshot_unavailable'},503);}
  }
  if(!path.endsWith('/v1/canary-journey'))return a11Answer({error:'not_found'},404);
  if(req.method!=='POST')return a11Answer({error:'method_not_allowed'},405);
  if(!a11Ready)return a11Answer({error:'canary_not_configured'},503);
  if(req.headers.get('content-type')?.split(';',1)[0]?.trim().toLowerCase()!=='application/json')return a11Answer({error:'unsupported_media_type'},415);
  let raw;
  try{
    const text=await a11ReadBody(req);
    raw=JSON.parse(text);
  }catch(error){
    const code=error?.message;
    if(code==='payload_too_large')return a11Answer({error:code},413);
    if(code==='body_timeout')return a11Answer({error:code},408);
    if(code==='request_aborted')return a11Answer({error:code},499);
    return a11Answer({error:'invalid_json'},400);
  }
  const input=a11ParseRequest(raw);
  if(!input)return a11Answer({error:'invalid_canary_request'},400);
  // Strict shared DB limiter: no in-memory-only quota that resets across isolates.
  try{
    if(!await a11Limiter('a11|canary|paid-hourly',2,3600))
      return a11Answer({error:'a11_canary_hourly_limit'},429);
  }catch{return a11Answer({error:'rate_limiter_unavailable'},503);}
  const scenario=a11Scenarios[input.scenarioId];
  const payload={serviceDate:input.serviceDate,departAt:input.departAt,
    origin:scenario.origin,destination:scenario.destination,
    modes:scenario.modes,maxTransfers:1,maxWalkingMeters:scenario.maxWalkingMeters,limit:3,prioritize:'fastest'};
  try{
    const forwarded=new Request('https://ballina-a11.private/v1/journeys',{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:req.signal});
    const response=await a11Api(forwarded);
    if(!response.ok)return a11Answer(await response.json(),response.status);
    const result=await response.json();
    // Fail closed if a future engine accidentally reintroduces simulated walking.
    const walks=(result.journeys??[]).flatMap(j=>(j.legs??[]).filter(leg=>leg.type==='walk'));
    if(walks.some(leg=>!['stadia-valhalla-pedestrian','identical-endpoints-no-walk'].includes(leg.provider)))
      return a11Answer({error:'unverified_walking_provider'},503);
    return a11Answer({...result,canary:{private:true,notForPassengers:true,
      scenarioId:input.scenarioId,syntheticWalking:false,
      returnedWalkLegs:walks.length,verifiedProviderWalkLegs:walks.filter(l=>l.provider==='stadia-valhalla-pedestrian').length,
      emptyResultDoesNotProveNoService:true}});
  }catch{
    return a11Answer({error:'canary_temporarily_unavailable'},503);
  }
});
