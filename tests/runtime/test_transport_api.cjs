const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
globalThis.crypto = webcrypto;
let serveHandler;
const env={SUPABASE_URL:'https://fake.supabase.co',SUPABASE_SECRET_KEY:'dummy_secret',SUPABASE_PUBLISHABLE_KEY:'dummy_public'};
globalThis.Deno={env:{get:(k)=>env[k]},serve:(h)=>{serveHandler=h}};
require('/tmp/ballina-ts-compiled/ballina_transport_api.js');
const now=new Date().toISOString();
const active='v-active';
const standardRun=(channel)=>({channel,status:'ok',started_at:now,completed_at:now,http_status:200,feed_timestamp:now,error_code:null,metadata:{active_feed_version:active,exact_trip_matches:2,unmapped_trips:0,stop_predictions:4,private_debug:'must_not_leak'}});
let runs=[standardRun('vehicle'),standardRun('trip_update')];
let allFetch=[];
let globalAllowed=true;
globalThis.fetch=async(url,init)=>{
 allFetch.push({url,init});
 const path=String(url);
 if(path.includes('rpc/consume_transport_api_rate_limit'))return Response.json([{allowed:globalAllowed,retry_after_seconds:globalAllowed?0:17,remaining:100}]);
 if(path.includes('/collection_runs?'))return Response.json(runs);
 if(path.includes('/gtfs_feed_versions?'))return Response.json([{version:active,label:'nta-realtime',imported_at:now,feed_start_date:'2026-10-07',feed_end_date:'2027-10-07',metadata:{schema_completeness:'complete_nta_feed'}}]);
 if(path.includes('/collector_state?'))return Response.json([{min_interval_seconds:61,collector_version:'v8',last_claimed_at:now}]);
 if(path.includes('/gtfs_import_runs?'))return Response.json([{status:'activated',version:active,metadata:{dry_run:false,internal_secret:'must_not_leak'}}]);
 if(path.includes('/rpc/get_stop_departures_v2'))return Response.json([{route_name:'420',stop_id:'8490B5550501'}]);
 if(path.includes('/rpc/get_live_vehicles'))return Response.json([]);
 return Response.json({error:'unexpected_fetch',url:path},{status:500});
};
async function req(action){return serveHandler(new Request('https://fake.supabase.co/functions/v1/transport-api?action='+action,{headers:{apikey:'dummy_public'}}));}
(async()=>{
 let result=await req('health'); assert.equal(result.status,200); let data=await result.json();
 assert.equal(data.status,'ok');assert.equal(data.collector.latest_runs.length,2);
 assert.deepEqual(data.collector.latest_runs.map(r=>r.channel),['vehicle','trip_update']);
 assert.equal(data.collector.latest_runs[0].metadata.private_debug,undefined);
 console.log('PASS: healthy two-channel response and sanitized metadata');
 allFetch=[]; result=await req('not-a-real-action');assert.equal(result.status,404);assert.equal(allFetch.length,0);
 console.log('PASS: unknown actions rejected before any database writes');
 runs=[standardRun('vehicle'),{...standardRun('trip_update'),status:'http_error',http_status:429}];
 result=await req('health');assert.equal(result.status,503);data=await result.json();assert.equal(data.status,'degraded');
 console.log('PASS: independently detect failed TripUpdates channel');
 runs=[standardRun('vehicle'),{...standardRun('trip_update'),feed_timestamp:new Date(Date.now()-700000).toISOString()}];
 result=await req('health');assert.equal(result.status,503);
 console.log('PASS: detect HTTP 200 with stale NTA feed timestamp');

 runs=[standardRun('vehicle'),standardRun('trip_update')];
 result=await req('departures');assert.equal(result.status,200);data=await result.json();
 assert.equal(data.departures.length,1); assert.deepEqual(data.stops,['8490B5550501','8490B559701','8490IR0076']);
 console.log('PASS: departures still work and Humbert Place is included');
 globalAllowed=false;result=await req('vehicles');assert.equal(result.status,429);
 console.log('PASS: global rate-limit fail-closed');
})().catch(e=>{console.error(e);process.exit(1)});
