'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');

// The complete deployable artifact, NOT just createRoutingApi() in isolation.
// Private auth and rewritten URL must agree on every supported endpoint.
const PRIVATE_TOKEN='offline-test-token-at-least-thirty-two-characters';
const FEED='offline-fixture-rail';
function launch({source='artifact',realtimeEnabled=false}={}){
  const file=source==='artifact'
    ?path.resolve(__dirname,'../artifacts/ballina-routing-preview-singlefile-v0.10.0-candidate.ts')
    :path.resolve(__dirname,'../supabase/functions/ballina-routing-preview/index.ts');
  // Source entrypoint is TypeScript with imports and needs Deno; exercise the real
  // bundled entrypoint here, keeping every mock external call below auditable.
  const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{
    compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const env={SUPABASE_URL:'https://offline.supabase.co',STADIA_API_KEY:'fake-not-charged',
    SUPABASE_SECRET_KEYS:JSON.stringify({default:'fake-private-key'}),
    SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:'fake-publishable-key'}),
    BALLINA_ROUTING_PREVIEW_TOKEN:PRIVATE_TOKEN,
    BALLINA_RAIL_REALTIME_ENABLED:realtimeEnabled?'true':'false'};
  const calls=[];
  const data={
    gtfs_stops:[
      {version:FEED,stop_id:'B',stop_name:'Ballina',stop_lat:54.108,stop_lon:-9.156,stop_code:null,stop_desc:null},
      {version:FEED,stop_id:'M',stop_name:'Manulla Junction',stop_lat:53.904,stop_lon:-9.10,stop_code:null,stop_desc:null}],
    gtfs_routes:[{version:FEED,route_id:'RAIL',route_short_name:'rail',route_long_name:'Dublin - Westport',route_type:2},
      {version:FEED,route_id:'BUS',route_short_name:'420',route_long_name:'Ballina to Castlebar',route_type:3}],
    gtfs_trips:[{version:FEED,trip_id:'T',route_id:'RAIL',service_id:'DAILY',trip_headsign:'Manulla Junction'},
      {version:FEED,trip_id:'BT',route_id:'BUS',service_id:'DAILY',trip_headsign:'Castlebar'}],
    gtfs_stop_times:[
      {version:FEED,trip_id:'T',stop_id:'B',stop_sequence:1,arrival_seconds:18300,departure_seconds:18300,pickup_type:0,drop_off_type:0},
      {version:FEED,trip_id:'T',stop_id:'M',stop_sequence:2,arrival_seconds:19920,departure_seconds:19920,pickup_type:0,drop_off_type:0},
      {version:FEED,trip_id:'BT',stop_id:'B',stop_sequence:1,arrival_seconds:19000,departure_seconds:19000,pickup_type:0,drop_off_type:0},
      {version:FEED,trip_id:'BT',stop_id:'M',stop_sequence:2,arrival_seconds:22000,departure_seconds:22000,pickup_type:0,drop_off_type:0}],
    gtfs_calendars:[{version:FEED,service_id:'DAILY',start_date:'2026-10-01',end_date:'2026-10-31',sunday:true,monday:true,tuesday:true,wednesday:true,thursday:true,friday:true,saturday:true}],
    gtfs_calendar_dates:[]};
  const fetcher=async(url,options={})=>{
    const u=new URL(String(url));calls.push({url:u.pathname,method:options.method||'GET'});
    if(u.hostname==='api-eu.stadiamaps.com')throw Error('unapproved_paid_provider_fetch');
    if(u.hostname==='api.irishrail.ie'){
      if(!realtimeEnabled)throw Error('rail_live_disabled');
      assert.equal(u.searchParams.get('StationDesc'),'Ballina');
      const xml='<ArrayOfObjStationData><objStationData><Traincode>A123</Traincode>'+
        '<Stationfullname>Ballina</Stationfullname><Origin>Ballina</Origin>'+
        '<Destination>Manulla Junction</Destination><Schdepart>05:05</Schdepart>'+
        '<Expdepart>05:05</Expdepart><Status>En Route</Status></objStationData></ArrayOfObjStationData>';
      return new Response(xml,{status:200,headers:{'Content-Type':'text/xml'}});
    }
    if(u.hostname!=='offline.supabase.co')throw Error('unexpected_network_host');
    if(u.pathname==='/rest/v1/rpc/consume_transport_api_rate_limit')return Response.json([{allowed:true}]);
    if(u.pathname==='/rest/v1/gtfs_feed_versions')return Response.json([{version:FEED}]);
    const name=u.pathname.slice('/rest/v1/'.length);
    if(Object.hasOwn(data,name)){
      const rows=data[name];const page=Number(u.searchParams.get('offset')||'0');
      const limit=Number(u.searchParams.get('limit')||'1000');
      const selected=rows.slice(page,page+limit);
      return new Response(JSON.stringify(selected),{status:200,headers:{'Content-Type':'application/json','Content-Range':rows.length?`${page}-${page+selected.length-1}/${rows.length}`:'*/0'}});
    }
    throw Error('unmatched_fake_fetch:'+u.toString());
  };
  let handler;
  new Function('Deno','fetch','Request','Response','URL','crypto','TextEncoder','Uint8Array','AbortSignal','console','exports','require',js)(
    {env:{get:key=>env[key]},serve:fn=>{handler=fn}},fetcher,Request,Response,URL,crypto,TextEncoder,Uint8Array,AbortSignal,
    {info:()=>{},log:()=>{},error:()=>{}},{},name=>{if(name==='jsr:@supabase/functions-js/edge-runtime.d.ts')return {};throw Error('unexpected_module:'+name)});
  return {handler,calls};
}
const request=(suffix,{token=PRIVATE_TOKEN,method='GET'}={})=>new Request('https://offline.supabase.co/functions/v1/ballina-routing-preview'+suffix,
  {method,headers:{'x-ballina-preview-token':token}});

test('real bundled entrypoint returns GTFS rail stations after valid private authentication',async()=>{
  const {handler,calls}=launch();
  const r=await handler(request('/v1/rail/stations'));
  const j=await r.json();
  assert.equal(r.status,200,JSON.stringify(j));
  assert.deepEqual(j.stations.map(s=>s.name),['Ballina','Manulla Junction']);
  assert.equal(calls.filter(c=>c.url.includes('/rpc/')).length,2);
  assert.equal(calls.some(c=>c.url.includes('stadiamaps')),false);
});

test('real bundled entrypoint routes station-board to rail handler, not nearby-stops',async()=>{
  const {handler,calls}=launch();
  const r=await handler(request('/v1/rail/station-board?station=Ballina'));
  const j=await r.json();
  assert.equal(r.status,503,JSON.stringify(j));
  assert.equal(j.error,'rail_board_not_configured');
  assert.equal(calls.filter(c=>c.url.includes('/rpc/')).length,2);
});

test('rail entrypoint invalid private token fails before ALL external calls',async()=>{
  const {handler,calls}=launch();
  for(const route of ['/v1/rail/stations','/v1/rail/station-board?station=Ballina']){
    const r=await handler(request(route,{token:'wrong-private-token'}));
    assert.equal(r.status,401);
  }
  assert.equal(calls.length,0);
});

test('previously supported nearby-stops endpoint remains available with auth',async()=>{
  const {handler,calls}=launch();
  const r=await handler(request('/v1/nearby-stops?lat=54.108&lon=-9.156&limit=2'));
  const body=await r.json();
  assert.equal(r.status,200,JSON.stringify(body));
  assert.equal(body.stops[0].stopName,'Ballina');
  assert.equal(calls.filter(c=>c.url.includes('/rpc/')).length,2);
});

test('rail paths keep method and query validation after outer private gate',async()=>{
  const {handler,calls}=launch();
  const invalidQuery=await handler(request('/v1/rail/stations?arbitrary=1'));
  assert.equal(invalidQuery.status,400);
  assert.equal((await invalidQuery.json()).error,'invalid_rail_stations_query');
  const wrongMethod=await handler(request('/v1/rail/stations',{method:'POST'}));
  assert.equal(wrongMethod.status,405);
  const invalidStation=await handler(request('/v1/rail/station-board?station=???'));
  assert.equal(invalidStation.status,400);
  assert.equal((await invalidStation.json()).error,'invalid_rail_station');
  assert.equal(calls.filter(c=>c.url.includes('/rpc/')).length,4);
});

test('valid private request serves mocked official station XML through the complete entrypoint',async()=>{
  const {handler,calls}=launch({realtimeEnabled:true});
  const result=await handler(request('/v1/rail/station-board?station=Ballina'));
  const body=await result.json();
  assert.equal(result.status,200,JSON.stringify(body));
  assert.equal(body.station,'Ballina');
  assert.equal(body.realtimeVerified,false,'do not mislabel train feed as verified realtime');
  assert.equal(body.matchedToGtfsTrips,false);
  assert.equal(body.services[0].trainCode,'A123');
  assert.equal(calls.filter(x=>x.url.includes('/realtime.asmx/')).length,1);
  assert.equal(calls.some(x=>x.url.includes('stadiamaps')),false);
});

test('boarding note for same GTFS station names the actual next transport mode',()=>{
  const {planJourneys,journeyConnections}=require('../dist');
  const B={id:'B',name:'Ballina',lat:54.108,lon:-9.156};
  const M={id:'M',name:'Manulla Junction',lat:53.904,lon:-9.10};
  const D={id:'D',name:'Dublin Heuston',lat:53.346,lon:-6.293};
  const fixture={feedVersion:'note-regression',timezone:'Europe/Dublin',stops:[B,M,D],
    routes:[{id:'R',name:'rail',mode:'rail'}],
    trips:[{id:'A',routeId:'R',serviceId:'S'}, {id:'C',routeId:'R',serviceId:'S'}],
    stopTimes:[{tripId:'A',stopId:'B',sequence:1,arrivalSeconds:18300,departureSeconds:18300},
      {tripId:'A',stopId:'M',sequence:2,arrivalSeconds:19920,departureSeconds:19920},
      {tripId:'C',stopId:'M',sequence:1,arrivalSeconds:20040,departureSeconds:20100},
      {tripId:'C',stopId:'D',sequence:2,arrivalSeconds:30840,departureSeconds:30840}],
    calendars:[{serviceId:'S',startDate:'2026-10-08',endDate:'2026-10-08',weekdays:[false,false,false,false,true,false,false]}],
    exceptions:[]};
  const paths={origin:B,destination:D,access:[{stopId:'B',distanceMeters:0,durationSeconds:0,geometry:[B,B],provider:'same-stop'}],
    egress:[{stopId:'D',distanceMeters:0,durationSeconds:0,geometry:[D,D],provider:'same-stop'}],transfers:[]};
  const journeys=planJourneys(fixture,paths,{serviceDate:'2026-10-08',departAfterSeconds:18000,maxTransfers:1,minTransferSeconds:180});
  const change=journeys.find(j=>j.transfers===1);
  assert.ok(change,'rail transfer at Manulla should be scheduled');
  const instruction=journeyConnections(change,fixture.stops)[0];
  assert.match(instruction.note,/next train/i);
  assert.doesNotMatch(instruction.note,/next bus/i);
});
