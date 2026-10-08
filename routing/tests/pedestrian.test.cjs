const assert=require('node:assert/strict');
const test=require('node:test');
const {decodePolyline6,StadiaWalkingRouter,buildPedestrianPaths,journeyOverlay,fromSupabaseTables,planJourneys}=require('../dist');
const HOME={lat:54.110123,lon:-9.150123},STOP={lat:54.111123,lon:-9.151123};
function encode(pts){let la=0,lo=0,s='';const write=n=>{let v=n<0?~(n<<1):(n<<1);while(v>=32){s+=String.fromCharCode((32|(v&31))+63);v>>=5;}s+=String.fromCharCode(v+63);}; for(const p of pts){const a=Math.round(p.lat*1e6),b=Math.round(p.lon*1e6);write(a-la);write(b-lo);la=a;lo=b;}return s;}
test('Valhalla polyline6 yields correct coordinates, not 100x rounding errors',()=>{
 const enc=encode([HOME,STOP]);assert.deepEqual(decodePolyline6(enc),[HOME,STOP]);
 assert.throws(()=>decodePolyline6('???'),/invalid_polyline/);
});
test('Stadia walking API adapter calls pedestrian and keeps API key only in server request',async()=>{
 let sent;const fake=async(url,init)=>{sent={url,headers:init.headers,body:JSON.parse(init.body)};return Response.json({trip:{summary:{time:456,length:0.62},legs:[{shape:encode([HOME,STOP])}]}});};
 const walker=new StadiaWalkingRouter('test-secret',fake);
 const path=await walker.walk(HOME,STOP);
 assert.equal(path.durationSeconds,456);assert.equal(path.distanceMeters,620);
 assert.deepEqual(path.geometry,[HOME,STOP]);assert.equal(sent.body.costing,'pedestrian');
 assert.equal(sent.url,'https://api-eu.stadiamaps.com/route/v1');
 assert.equal(sent.headers.Authorization,'Stadia-Auth test-secret');
 assert.ok(!sent.url.includes('test-secret'));
 assert.equal(sent.body.shape_format,'polyline6');
});
test('Stadia adapter never invents route on unreachable/invalid response',async()=>{
 const missing=new StadiaWalkingRouter('key',async()=>new Response('{}',{status:404}));
 assert.equal(await missing.walk(HOME,STOP),null);
 const snappedWrong=new StadiaWalkingRouter('key',async()=>Response.json({trip:{summary:{time:100,length:0.4},legs:[{shape:encode([{lat:53,lon:-9},STOP])}]}}));
 assert.equal(await snappedWrong.walk(HOME,STOP),null);
});
test('walk construction calls provider within budget, never uses geodesic length as path',async()=>{
 let n=0;
 const router={walk:async(a,b)=>{n++;return {durationSeconds:400,distanceMeters:600,geometry:[a,b],provider:'mock-walk-streets'}}};
 const stops=[{id:'S1',name:'Stop One',...STOP}];
 const result=await buildPedestrianPaths(router,stops,HOME,STOP,{maxRequestCount:1});
 assert.equal(n,1);assert.equal(result.access.length,1);assert.equal(result.egress.length,1);
 assert.equal(result.egress[0].durationSeconds,0); // identical endpoint needs no paid request
});
test('MapLibre overlay only plots proven pedestrian geometry and station markers, not fictional bus street polyline',()=>{
 const j={legs:[{type:'walk',from:HOME,to:STOP,geometry:[HOME,STOP],durationSeconds:60,distanceMeters:100,provider:'test',purpose:'access'},
  {type:'ride',tripId:'T',routeId:'R',routeName:'420',boardStopId:'S',alightStopId:'F',boardAtSeconds:32400,alightAtSeconds:35000,serviceDate:'2026-10-08',mode:'bus'}]};
 const geo=journeyOverlay(j,[{id:'S',code:'001',name:'Board',...STOP},{id:'F',name:'Alight',lat:54.22,lon:-9.18}]);
 assert.equal(geo.features.length,3);
 assert.equal(geo.features.filter(f=>f.geometry.type==='LineString').length,1);
 assert.deepEqual(geo.features[1].geometry.coordinates,[STOP.lon,STOP.lat]);
});
test('Supabase row adapter uses actual database column names and rejects cross-version rows',()=>{
 const v='fixture-feed';const withV=x=>({version:v,...x});
 const tables={feedVersion:v,
 stops:[withV({stop_id:'s1',stop_name:'Test Stop',stop_lat:54.11,stop_lon:-9.15,stop_code:'1001'})],
 routes:[withV({route_id:'r1',route_short_name:'420',route_type:3})],
 trips:[withV({trip_id:'t1',route_id:'r1',service_id:'sv',trip_headsign:'Example'})],
 stopTimes:[withV({trip_id:'t1',stop_id:'s1',stop_sequence:1,arrival_seconds:33000,departure_seconds:33100,pickup_type:1})],
 calendars:[withV({service_id:'sv',monday:true,tuesday:true,wednesday:true,thursday:true,friday:true,saturday:false,sunday:false,start_date:'2026-10-01',end_date:'2026-11-01'})],calendarDates:[]};
 const ds=fromSupabaseTables(tables);
 assert.equal(ds.stops[0].code,'1001');assert.equal(ds.stopTimes[0].pickupType,1);
 assert.equal(ds.calendars[0].weekdays[0],false);assert.equal(ds.calendars[0].weekdays[4],true);
 tables.trips[0].version='another-feed';assert.throws(()=>fromSupabaseTables(tables),/mixed_gtfs_version/);
});
