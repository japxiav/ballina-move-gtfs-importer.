'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {runOnce,summarize,FIXED_REQUEST,BASE}=require('../scripts/a11_first_live_itinerary.cjs');
const jwt='eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6ImFubGluYSJ9.'+'a'.repeat(150);
const preview='a11-test-preview-token-with-64-characters-length-123456789012345678';
const NOW=new Date('2026-10-11T12:00:00Z');
const FEED='768b4b82327a1b83eb7f9365e4dd4495417df14163e5980889f0df2b223088d3';
const health={service:'ballina-a11-realwalking-canary',private:true,notForPassengers:true,ready:true,syntheticWalking:false,stadiaConfigured:true};
const gtfs={service:'ballina-a11-realwalking-canary',feedVersion:FEED,paidWalkingCalls:0,counts:{stops:227,routes:9,trips:1518,stopTimes:30115}};
const walk={type:'walk',purpose:'access',distanceMeters:155,durationSeconds:126,provider:'stadia-valhalla-pedestrian',
  endpointSnapMeters:{from:4,to:9},requiresSnapConfirmation:false,geometry:[{lat:54.11,lon:-9.16},{lat:54.111,lon:-9.1599}]};
const ride={type:'ride',mode:'bus',routeName:'22',tripId:'5940_48615',boardStopId:'8490B5550501',
  alightStopId:'8490B141661',boardAtSeconds:34200,alightAtSeconds:35040};
const result={status:'scheduled_only',realtime:false,feedVersion:FEED,
  journeys:[{legs:[walk,ride,{...walk,purpose:'egress',distanceMeters:100}],walkingMeters:255}],
  canary:{private:true,notForPassengers:true,syntheticWalking:false,verifiedProviderWalkLegs:2},coverageWarnings:[]};
function fake({h=health,g=gtfs,j=result,failOn=null}={}){
 const calls=[];
 const fetcher=async(url,init)=>{
  assert.ok(url.startsWith(BASE));assert.equal(init.redirect,'error');
  assert.equal(init.headers.apikey,jwt);assert.equal(init.headers.authorization,`Bearer ${jwt}`);
  assert.equal(init.headers['x-ballina-preview-token'],preview);
  calls.push({url,method:init.method,body:init.body?JSON.parse(init.body):null});
  if(failOn&&url.endsWith(failOn))return Response.json({error:'mock'}, {status:503});
  if(url.endsWith('/health'))return Response.json(h);
  if(url.endsWith('/v1/gtfs-summary'))return Response.json(g);
  assert.ok(url.endsWith('/v1/canary-journey'));assert.equal(init.method,'POST');
  return Response.json(j);
 };
 return {fetcher,calls};
}
const auth={anonJwt:jwt,previewToken:preview,now:NOW};

test('A11 live itinerary: full happy path reuses canary, exactly 2 GET plus 1 POST',async()=>{
 const x=fake();const out=await runOnce({...auth,fetcher:x.fetcher});
 assert.equal(out.status,'A11_FIRST_LIVE_INTEGRATION_SUCCESS');
 assert.deepEqual(x.calls.map(c=>c.method),['GET','GET','POST']);
 assert.deepEqual(x.calls[2].body,FIXED_REQUEST);
 assert.equal(out.requestCounts.paidPostAttempts,1);
 assert.equal(out.requestCounts.providerQueriesMaximum,12);
 assert.equal(out.validBusAndRealWalkingJourneys,1);
 assert.equal(out.journeys[0].walking.length,2);
 assert.equal(out.journeys[0].rides[0].boardAtSeconds,34200);
 assert.equal(out.realtime,false);assert.equal(out.notForPassengers,true);
});
test('A11 live itinerary: missing secrets forbid ALL HTTP',async()=>{
 const x=fake();await assert.rejects(()=>runOnce({anonJwt:'',previewToken:preview,now:NOW,fetcher:x.fetcher}),/required_secrets/);
 assert.equal(x.calls.length,0);
});
test('A11 live itinerary: wrong Europe/Dublin day forbids ALL HTTP',async()=>{
 const x=fake();await assert.rejects(()=>runOnce({...auth,now:new Date('2026-10-12T12:00:00Z'),fetcher:x.fetcher}),/expired/);
 assert.equal(x.calls.length,0);
});
test('A11 live itinerary: not ready stops before GTFS and billable POST',async()=>{
 const x=fake({h:{...health,ready:false}});
 await assert.rejects(()=>runOnce({...auth,fetcher:x.fetcher}),/canary_not_ready/);
 assert.deepEqual(x.calls.map(c=>c.method),['GET']);
});
test('A11 live itinerary: missing Stadia env stops before paid call',async()=>{
 const x=fake({h:{...health,stadiaConfigured:false}});
 await assert.rejects(()=>runOnce({...auth,fetcher:x.fetcher}),/canary_not_ready/);
 assert.equal(x.calls.length,1);
});
test('A11 live itinerary: broken GTFS stops before paid call',async()=>{
 const x=fake({g:{...gtfs,counts:{...gtfs.counts,stopTimes:0}}});
 await assert.rejects(()=>runOnce({...auth,fetcher:x.fetcher}),/invalid_active_gtfs_snapshot/);
 assert.deepEqual(x.calls.map(c=>c.method),['GET','GET']);
});
test('A11 live itinerary: GET failure stops before paid call',async()=>{
 const x=fake({failOn:'/v1/gtfs-summary'});
 await assert.rejects(()=>runOnce({...auth,fetcher:x.fetcher}),/canary_get_http_503/);
 assert.equal(x.calls.filter(c=>c.method==='POST').length,0);
});
test('A11 live itinerary: synthetic walking never reported as a success',async()=>{
 const x=fake({j:{...result,journeys:[{legs:[{...walk,provider:'synthetic_private_staging_only'},ride],walkingMeters:155}]}});
 await assert.rejects(()=>runOnce({...auth,fetcher:x.fetcher}),/synthetic_or_unapproved/);
 assert.equal(x.calls.filter(c=>c.method==='POST').length,1);
});
test('A11 live itinerary: no bus or no walking cannot be called an integration success',()=>{
 assert.throws(()=>summarize({...result,journeys:[{legs:[walk],walkingMeters:155}]},gtfs),/no_bus_plus_real_walking/);
 assert.throws(()=>summarize({...result,journeys:[]},gtfs),/no_scheduled/);
});
test('A11 live itinerary: malformed provider geometry cannot pass',()=>{
 const missing={...walk,geometry:[]};
 assert.throws(()=>summarize({...result,journeys:[{legs:[missing,ride],walkingMeters:155}]},gtfs),/walking_geometry_missing/);
});
test('A11 live itinerary: old/wrong feed rejected even if journey appears valid',()=>{
 assert.throws(()=>summarize({...result,feedVersion:'wrong-version'},gtfs),/feed_version_changed/);
});
test('A11 live itinerary: the workflow can only execute manually, from main with paid-cost approval',()=>{
 const workflow=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/a11-first-live-itinerary.yml'),'utf8');
 assert.match(workflow,/^on:\s*\n\s{2}workflow_dispatch:/m);
 assert.doesNotMatch(workflow,/^\s{2}(push|pull_request|schedule|workflow_run|repository_dispatch):/m);
 assert.match(workflow,/default: NO_DO_NOT_RUN/);
 assert.match(workflow,/YES_ONE_ITINERARY_MAX_12_WALKS/);
 assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
 assert.match(workflow,/persist-credentials: false/);
 assert.match(workflow,/^permissions:\s*\n\s{2}contents: read/m);
 assert.match(workflow,/secrets\.BALLINA_SUPABASE_ANON_JWT/);
 assert.match(workflow,/secrets\.BALLINA_ROUTING_PREVIEW_TOKEN/);
 assert.doesNotMatch(workflow,/supabase.*deploy|--force|npm publish|STADIA_API_KEY:/i);
});
