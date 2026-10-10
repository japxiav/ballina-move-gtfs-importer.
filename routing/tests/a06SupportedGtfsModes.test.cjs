'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {fromSupabaseTables,planJourneys,nearbyStops}=require('../dist/index.js');
const version='a06-mode-fixture';
const date='2026-10-08';
const stop=(id,lat)=>({version,stop_id:id,stop_name:id,stop_lat:lat,stop_lon:-9.16});
const row=(id,type)=>({version,route_id:id,route_short_name:id,route_type:type});
const trip=id=>({version,trip_id:`T-${id}`,route_id:id,service_id:'daily'});
const times=(id,a,b)=>[
  {version,trip_id:`T-${id}`,stop_id:'A',stop_sequence:1,arrival_seconds:a,departure_seconds:a},
  {version,trip_id:`T-${id}`,stop_id:'B',stop_sequence:2,arrival_seconds:b,departure_seconds:b},
];
const base=()=>({feedVersion:version,
  stops:[stop('A',54.11),stop('B',54.12)],
  routes:[row('BUS',3),row('RAIL',2),row('FERRY',4),row('TRAM',0),row('TROLLEY',11),row('UNKNOWN',999),row('MISSING_TYPE',null)],
  trips:['BUS','RAIL','FERRY','TRAM','TROLLEY','UNKNOWN','MISSING_TYPE'].map(trip),
  stopTimes:['BUS','RAIL','FERRY','TRAM','TROLLEY','UNKNOWN','MISSING_TYPE'].flatMap((id,i)=>times(id,30000+i*4000,31500+i*4000)),
  calendars:[{version,service_id:'daily',start_date:date,end_date:date,thursday:true}],calendarDates:[],
});
const paths=t=>({origin:{lat:t.stops[0].lat,lon:t.stops[0].lon},destination:{lat:t.stops[1].lat,lon:t.stops[1].lon},
  access:[{stopId:'A',durationSeconds:0,distanceMeters:0,geometry:[],provider:'test'}],
  egress:[{stopId:'B',durationSeconds:0,distanceMeters:0,geometry:[],provider:'test'}],transfers:[]});

test('A06: unsupported GTFS route types are excluded without dropping supported buses or rails',()=>{
  const t=fromSupabaseTables(base());
  assert.deepEqual(t.routes.map(r=>[r.id,r.mode]),[['BUS','bus'],['RAIL','rail']]);
  assert.deepEqual(t.trips.map(x=>x.id),['T-BUS','T-RAIL']);
  assert.deepEqual(t.stopTimes.map(x=>x.tripId),['T-BUS','T-BUS','T-RAIL','T-RAIL']);
  assert.equal(t.stops.length,2);
  assert.equal(t.calendars.length,1);
});

test('A06: unsupported ferry route cannot contribute phantom bus journeys or nearby bus stops',()=>{
  const src=base();src.routes=[row('FERRY',4)];src.trips=[trip('FERRY')];src.stopTimes=times('FERRY',28800,30100);
  const t=fromSupabaseTables(src);
  assert.deepEqual(t.routes,[]);assert.deepEqual(t.trips,[]);assert.deepEqual(t.stopTimes,[]);
  assert.deepEqual(nearbyStops(t,{lat:54.11,lon:-9.16},1500),[]);
  assert.deepEqual(planJourneys(t,paths(t),{serviceDate:date,departAfterSeconds:28000,maxTransfers:0}),[]);
});

test('A06: legal numeric strings for 2/3 retain their exact supported modes',()=>{
  const src=base();src.routes=[row('BUS','3'),row('RAIL','2')];src.trips=[trip('BUS'),trip('RAIL')];src.stopTimes=[...times('BUS',28000,30000),...times('RAIL',32000,34000)];
  const t=fromSupabaseTables(src);
  assert.deepEqual(t.routes.map(x=>x.mode),['bus','rail']);
  assert.deepEqual(t.trips.map(x=>x.routeId),['BUS','RAIL']);
});

test('A06: unknown route reference is not silently suppressed by unsupported-mode filtering',()=>{
  const src=base();src.trips.push({version,trip_id:'DANGLING',route_id:'NOT_DECLARED',service_id:'daily'});
  src.stopTimes.push(...times('NOT_DECLARED',42000,43500).map(x=>({...x,trip_id:'DANGLING'})));
  const t=fromSupabaseTables(src);
  assert.ok(t.trips.some(x=>x.id==='DANGLING'), 'an invalid route reference must remain visible to snapshot integrity checks');
});

test('A06: complete snapshot loader excludes declared unsupported routes without masking unknown route IDs',async()=>{
  const {loadActiveGtfsSnapshot}=require('../dist/index.js');
  const sample=base();
  const rows={gtfs_stops:sample.stops,gtfs_routes:sample.routes,gtfs_trips:sample.trips,
    gtfs_stop_times:sample.stopTimes,gtfs_calendars:sample.calendars,gtfs_calendar_dates:sample.calendarDates};
  const fetcher=async input=>{
    const url=new URL(input),name=url.pathname.split('/').at(-1);
    if(name==='gtfs_feed_versions')return Response.json([{version}]);
    const start=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||100);
    return Response.json((rows[name]||[]).slice(start,start+limit));
  };
  const run=()=>loadActiveGtfsSnapshot({supabaseUrl:'https://local.invalid',privateKey:'test-key',pageSize:100,fetcher});
  const t=await run();
  assert.deepEqual(t.routes.map(x=>x.mode),['bus','rail']);
  assert.equal(t.trips.length,2);
  assert.equal(t.stopTimes.length,4);
  rows.gtfs_trips.push({version,trip_id:'BAD',route_id:'MISSING_ROUTE',service_id:'daily'});
  await assert.rejects(run(),/snapshot_broken_references/);
});

test('A06: conflicting declared route types for the same ID fail closed',()=>{
 const src=base();src.routes.push(row('BUS',4));
 assert.throws(()=>fromSupabaseTables(src),/conflicting_gtfs_route_type/);
});
