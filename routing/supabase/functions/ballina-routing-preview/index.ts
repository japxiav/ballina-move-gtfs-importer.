import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createRoutingApi,createSnapshotCache} from './src/httpApi.ts';
import {loadActiveGtfsSnapshot} from './src/gtfsSnapshot.ts';
import {StadiaWalkingRouter} from './src/pedestrian.ts';
import {createSupabaseRateLimiter} from './src/supabaseLimiter.ts';
import {createIrishRailStationClient} from './src/irishRail.ts';

// Private preview: dedicated credential, independent from the project database secret.
// This remains server-to-server only. Never embed the preview token in a browser.
function readNamedKey(jsonEnv:string, envNames:string[]):string {
  const raw=Deno.env.get(jsonEnv);
  if(raw){try{const named=JSON.parse(raw);if(named&&typeof named.default==='string')return named.default;}catch{ /* fallback */ }}
  for(const name of envNames){const key=Deno.env.get(name);if(key)return key;}
  return '';
}
const supabaseUrl=Deno.env.get('SUPABASE_URL')??'';
const secret=readNamedKey('SUPABASE_SECRET_KEYS',['SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','SB_SERVICE_ROLE_KEY']);
const publishable=readNamedKey('SUPABASE_PUBLISHABLE_KEYS',['SUPABASE_PUBLISHABLE_KEY','SUPABASE_ANON_KEY']);
const stadiaKey=Deno.env.get('STADIA_API_KEY')??'';
const previewToken=Deno.env.get('BALLINA_ROUTING_PREVIEW_TOKEN')??'';
const railRealtimeEnabled=Deno.env.get('BALLINA_RAIL_REALTIME_ENABLED')==='true';
const tokenReady=previewToken.length>=32 && previewToken!==secret && previewToken!==publishable;
/** Fixed-length digest comparison; missing or unconfigured token fails closed. */
async function tokenMatches(presented:string|null):Promise<boolean>{
  if(!tokenReady||!presented||presented.length>256)return false;
  const digest=async(s:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const a=await digest(previewToken),b=await digest(presented);
  let difference=0;for(let i=0;i<a.length;i++)difference|=a[i]!^b[i]!;
  return difference===0;
}
// Rail station data is read-only and must not depend on a paid walking API key.
// Route planning still fails closed unless a walking provider is configured.
const dataReady=Boolean(supabaseUrl&&secret&&publishable&&tokenReady);
const ready=Boolean(dataReady&&stadiaKey);
const limiter=dataReady?createSupabaseRateLimiter({supabaseUrl,privateKey:secret}):null;
const routeHandler=dataReady?createRoutingApi({
  loadTimetable:createSnapshotCache(()=>loadActiveGtfsSnapshot({supabaseUrl,privateKey:secret}),300_000),
  router:stadiaKey?new StadiaWalkingRouter(stadiaKey,fetch,'https://api-eu.stadiamaps.com',
    sample=>console.info(JSON.stringify({service:'ballina-routing-preview',kind:'endpoint_drift',...sample}))):
    {walk:async()=>null}, // Rail-only read endpoints never invoke a paid router.
  clientIdentity:(_req)=>'private-preview',
  consumeRateLimit:limiter!,
  getRailStationBoard:railRealtimeEnabled?createIrishRailStationClient({timeoutMs:5000,cacheMs:45000}):undefined,
  allowedOrigins:[],
  reportError:event=>console.error(JSON.stringify({service:'ballina-routing-preview',kind:'routing_failure',...event})),
}):null;
function answer(value:unknown,status=200):Response {
  return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
Deno.serve(async(req:Request)=>{
  const path=new URL(req.url).pathname;
  const isHealth=path.endsWith('/health');
  const isJourney=path.endsWith('/v1/journeys');
  const isNearby=path.endsWith('/v1/nearby-stops');
  const isRailBoard=path.endsWith('/v1/rail/station-board');
  const isRailStations=path.endsWith('/v1/rail/stations');
  if(isHealth&&req.method==='GET'){
    if(!publishable||req.headers.get('apikey')!==publishable)return answer({error:'unauthorized'},401);
    return answer({service:'ballina-routing-preview',status:ready?'ready_for_private_testing':dataReady?'rail_station_only':'missing_configuration',stadia_configured:Boolean(stadiaKey),public_planning_enabled:false});
  }
  if(!isJourney&&!isNearby&&!isRailBoard&&!isRailStations)return answer({error:'not_found'},404);
  if(isJourney?req.method!=='POST':req.method!=='GET')return answer({error:'method_not_allowed'},405);
  if(!tokenReady)return answer({error:'preview_not_configured'},503);
  if(!await tokenMatches(req.headers.get('x-ballina-preview-token')))return answer({error:'unauthorized'},401);
  if(!routeHandler)return answer({error:'preview_unavailable'},503);
  // No paid walking provider? Keep journeys sealed, even at identical endpoints.
  if(isJourney&&!ready)return answer({error:'walking_provider_unavailable'},503);
  // Normalize the public Edge prefix, but retain the already-authorized endpoint.
  // In particular, rail station handlers must never be silently rewritten to
  // nearby-stops after the private token was verified.
  const parsed=new URL(req.url);
  parsed.pathname=isJourney?'/v1/journeys':isNearby?'/v1/nearby-stops':
    isRailBoard?'/v1/rail/station-board':'/v1/rail/stations';
  if(isJourney)parsed.search='';
  // Cloning the incoming request retains its streaming-body protocol semantics.
  return routeHandler(new Request(parsed,req));
});
