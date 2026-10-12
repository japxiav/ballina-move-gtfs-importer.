'use strict';
/* A11.3: explicitly approved first REAL GTFS + Stadia canary integration.
 * Runs ONLY when explicitly called with --live, performs two safe GETs and
 * at most ONE potentially billable POST. No retries or raw credential logging.
 */
const BASE='https://giwiqbnyozjbpmetrjhe.supabase.co/functions/v1/ballina-a11-realwalking-canary';
const FIXED_REQUEST=Object.freeze({
  scenarioId:'ballina-foxford-bus',
  confirmPaidCalls:'YES_UP_TO_12_WALKS',
});
const TIMEOUT_MS=90000;
function buildRequest({serviceDate,departAt},now){
  if(typeof serviceDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)||
     !Number.isFinite(Date.parse(serviceDate+'T00:00:00Z'))||
     new Date(serviceDate+'T00:00:00Z').toISOString().slice(0,10)!==serviceDate)
    throw new Error('invalid_service_date');
  if(typeof departAt!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(departAt))
    throw new Error('invalid_departure_time');
  const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Dublin',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const get=k=>parts.find(x=>x.type===k)?.value??'';
  const today=`${get('year')}-${get('month')}-${get('day')}`;
  const offset=(Date.parse(serviceDate+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000;
  if(offset<0||offset>14)throw new Error('service_date_outside_canary_window');
  if(offset===0&&departAt<=`${get('hour')}:${get('minute')}`)
    throw new Error('departure_time_already_passed');
  return Object.freeze({...FIXED_REQUEST,serviceDate,departAt});
}
function safeNumber(n){return typeof n==='number' && Number.isFinite(n) && n>=0;}
function verifySecrets(jwt,previewToken){
  if(typeof jwt!=='string'||jwt.split('.').length!==3||jwt.length<100 ||
     typeof previewToken!=='string'||previewToken.length<32||previewToken.length>256)
    throw new Error('required_secrets_missing_or_invalid');
}
function summarize(result,gtfsSummary,request){
  if(result?.serviceDate!==request.serviceDate)
    throw new Error('requested_service_date_mismatch');
  if(result?.status!=='scheduled_only'||result.realtime!==false)
    throw new Error('unexpected_routing_status');
  if(!Array.isArray(result.journeys)||result.journeys.length===0)
    throw new Error('no_scheduled_itinerary_returned');
  if(!result.canary||result.canary.private!==true||result.canary.notForPassengers!==true||
     result.canary.syntheticWalking!==false)
    throw new Error('invalid_private_canary_marker');
  if(result.feedVersion!==gtfsSummary.feedVersion)
    throw new Error('feed_version_changed_during_test');
  const cases=[];
  for(const journey of result.journeys){
    if(!journey||!Array.isArray(journey.legs))throw new Error('malformed_journey');
    const rides=journey.legs.filter(x=>x.type==='ride');
    const walks=journey.legs.filter(x=>x.type==='walk');
    for(const walk of walks){
      if(!['stadia-valhalla-pedestrian','identical-endpoints-no-walk'].includes(walk.provider))
        throw new Error('synthetic_or_unapproved_walking_provider');
      if(!safeNumber(walk.distanceMeters)||!safeNumber(walk.durationSeconds))
        throw new Error('invalid_walking_distance_or_duration');
      if(walk.provider==='stadia-valhalla-pedestrian' &&
        (!Array.isArray(walk.geometry)||walk.geometry.length<2))
        throw new Error('walking_geometry_missing');
    }
    if(rides.some(x=>x.mode==='bus') && walks.some(x=>x.provider==='stadia-valhalla-pedestrian')){
      cases.push({
        rides:rides.map(x=>({mode:x.mode,routeName:String(x.routeName??'').slice(0,60),
          tripId:String(x.tripId??'').slice(0,60),boardStopId:String(x.boardStopId??'').slice(0,30),
          alightStopId:String(x.alightStopId??'').slice(0,30),
          boardAtSeconds:x.boardAtSeconds,alightAtSeconds:x.alightAtSeconds})),
        walking:walks.map(x=>({purpose:x.purpose,provider:x.provider,
          distanceMeters:x.distanceMeters,durationSeconds:x.durationSeconds,
          shapePoints:Array.isArray(x.geometry)?x.geometry.length:0,
          snapMeters:x.endpointSnapMeters??null,
          requiresSnapConfirmation:Boolean(x.requiresSnapConfirmation),
          unverifiedConnectorMeters:x.unverifiedConnector?.meters??0})),
        totalWalkingMeters:journey.walkingMeters,
        requiresSnapConfirmation:Boolean(journey.requiresSnapConfirmation),
      });
    }
  }
  if(!cases.length)throw new Error('no_bus_plus_real_walking_journey');
  if(!(result.canary.verifiedProviderWalkLegs>0))throw new Error('provider_leg_counter_zero');
  return {status:'A11_FIRST_LIVE_INTEGRATION_SUCCESS',scenarioId:FIXED_REQUEST.scenarioId,
    serviceDate:request.serviceDate,departAt:request.departAt,
    feedVersionPrefix:gtfsSummary.feedVersion.slice(0,12),
    totalJourneys:result.journeys.length,validBusAndRealWalkingJourneys:cases.length,
    provider:'stadia-valhalla-pedestrian',realtime:false,notForPassengers:true,
    journeys:cases.slice(0,3),
    warnings:(result.coverageWarnings??[]).map(x=>x.code).filter(x=>typeof x==='string').slice(0,12)};
}
async function runOnce({anonJwt,previewToken,serviceDate,departAt,fetcher=fetch,now=new Date()}={}){
  const request=buildRequest({serviceDate,departAt},now);
  verifySecrets(anonJwt,previewToken);
  const headers={apikey:anonJwt,authorization:`Bearer ${anonJwt}`,
    'x-ballina-preview-token':previewToken,accept:'application/json'};
  let postCount=0;
  const req=async(path,method='GET',body)=>{
    if(method==='POST'&&++postCount>1)throw new Error('paid_post_limit_exceeded');
    const response=await fetcher(BASE+path,{
      method,headers:{...headers,...(body?{'content-type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),
      signal:AbortSignal.timeout(TIMEOUT_MS),redirect:'error'});
    if(!response.ok)throw new Error(`canary_${method.toLowerCase()}_http_${response.status}`);
    return response.json();
  };
  const health=await req('/health');
  if(health.service!=='ballina-a11-realwalking-canary'||health.private!==true||
     health.notForPassengers!==true||health.ready!==true||
     health.syntheticWalking!==false||health.stadiaConfigured!==true)
    throw new Error('canary_not_ready');
  const gtfs=await req('/v1/gtfs-summary');
  if(!gtfs||typeof gtfs.feedVersion!=='string'||gtfs.feedVersion.length<12 ||
     gtfs.paidWalkingCalls!==0||!gtfs.counts||
     !['stops','routes','trips','stopTimes'].every(x=>Number.isInteger(gtfs.counts[x])&&gtfs.counts[x]>0))
    throw new Error('invalid_active_gtfs_snapshot');
  // EXACTLY ONE potentially billable integration request, only AFTER safe checks.
  const result=await req('/v1/canary-journey','POST',request);
  return {requestCounts:{readOnlyGet:2,paidPostAttempts:postCount,providerQueriesMaximum:12},
    gtfsCounts:gtfs.counts,...summarize(result,gtfs,request)};
}
if(require.main===module){
  (async()=>{
    if(process.argv.length!==3||process.argv[2]!=='--live'){
      console.error('Explicit --live required. No requests made.');process.exitCode=2;return;
    }
    try{
      const result=await runOnce({anonJwt:process.env.BALLINA_SUPABASE_ANON_JWT,
        previewToken:process.env.BALLINA_ROUTING_PREVIEW_TOKEN,
        serviceDate:process.env.A11_SERVICE_DATE,departAt:process.env.A11_DEPART_AT});
      console.log(JSON.stringify(result,null,2));
    }catch(e){
      // Never echo upstream body, token, auth header or untrusted error messages.
      const msg=String(e?.message??'');
      const safe=/^(required_secrets_missing_or_invalid|invalid_service_date|invalid_departure_time|service_date_outside_canary_window|departure_time_already_passed|canary_not_ready|invalid_active_gtfs_snapshot|requested_service_date_mismatch|unexpected_routing_status|no_scheduled_itinerary_returned|invalid_private_canary_marker|feed_version_changed_during_test|malformed_journey|synthetic_or_unapproved_walking_provider|invalid_walking_distance_or_duration|walking_geometry_missing|no_bus_plus_real_walking_journey|provider_leg_counter_zero|paid_post_limit_exceeded|canary_(?:get|post)_http_\d{3})$/;
      console.error(safe.test(msg)?msg:'a11_integration_request_failed_no_retry');
      process.exitCode=1;
    }
  })();
}
module.exports={runOnce,summarize,buildRequest,FIXED_REQUEST,BASE};
