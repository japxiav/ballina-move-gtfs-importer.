const test=require('node:test');
const assert=require('node:assert/strict');
const {loadActiveGtfsSnapshot}=require('../dist/index.js');
const version='test-gtfs-snapshot';
const makeRows=()=>({
 gtfs_stops:[{version,stop_id:'A',stop_name:'A',stop_lat:54,stop_lon:-9},{version,stop_id:'B',stop_name:'B',stop_lat:53,stop_lon:-9}],
 gtfs_routes:[{version,route_id:'R',route_short_name:'420',route_type:3}],
 gtfs_trips:[{version,trip_id:'T',route_id:'R',service_id:'WK',trip_headsign:'Hospital'}],
 gtfs_stop_times:[{version,trip_id:'T',stop_id:'A',stop_sequence:1,arrival_seconds:28800,departure_seconds:28800,pickup_type:0,drop_off_type:1},{version,trip_id:'T',stop_id:'B',stop_sequence:2,arrival_seconds:32000,departure_seconds:32000,pickup_type:1,drop_off_type:0}],
 gtfs_calendars:[{version,service_id:'WK',start_date:'2026-10-08',end_date:'2026-10-08',thursday:true}],
 gtfs_calendar_dates:[],
});
function harness({rows=makeRows(),switchFeed=false,failTable='',addUnknownStop=false,pageSize=2}={}){
 let versionCalls=0;const visited=[];
 const fetcher=async input=>{
   const url=new URL(input);const name=url.pathname.split('/').at(-1);visited.push(url);
   if(name==='gtfs_feed_versions'){
     versionCalls++;return Response.json([{version:switchFeed&&versionCalls>1?'new-feed':version}]);
   }
   if(name===failTable)return Response.json({error:'private'},{status:503});
   const r=(rows[name]||[]).slice(Number(url.searchParams.get('offset')||0),Number(url.searchParams.get('offset')||0)+Number(url.searchParams.get('limit')||pageSize));
   return Response.json(r);
 };
 const run=()=>loadActiveGtfsSnapshot({supabaseUrl:'https://fake.supabase.co',privateKey:'secret',pageSize,fetcher});
 return {run,visited};
}
test('loads all pages, never just first PostgREST page',async()=>{
 const rows=makeRows();rows.gtfs_stops=Array.from({length:1001},(_,i)=>({version,stop_id:i===0?'A':i===1000?'B':'S'+i,stop_name:'Stop '+i,stop_lat:54,stop_lon:-9}));
 const x=harness({rows,pageSize:500});const snapshot=await x.run();
 assert.equal(snapshot.stops.length,1001);
 assert.equal(x.visited.filter(v=>v.pathname.endsWith('gtfs_stops')).length,3);
 assert.equal(x.visited.filter(v=>v.pathname.endsWith('gtfs_feed_versions')).length,2);
 assert.equal(x.visited.find(v=>v.pathname.endsWith('gtfs_stop_times')).searchParams.get('order'),'trip_id.asc,stop_sequence.asc');
 assert.equal(x.visited.find(v=>v.pathname.endsWith('gtfs_stops')).searchParams.get('order'),'stop_id.asc');
});
test('fails closed if version flips during reading',async()=>{
 await assert.rejects(harness({switchFeed:true}).run(),/active_feed_switched/);
});
test('fails closed on any failed page without leaking response details',async()=>{
 await assert.rejects(harness({failTable:'gtfs_stop_times'}).run(),/snapshot_http_503/);
});
test('rejects truncated graph missing a GTFS stop',async()=>{
 const rows=makeRows();rows.gtfs_stops=rows.gtfs_stops.slice(0,1);
 await assert.rejects(harness({rows}).run(),/snapshot_broken_references/);
});
test('rejects a mixed-version page',async()=>{
 const rows=makeRows();rows.gtfs_trips[0].version='wrong';
 await assert.rejects(harness({rows}).run(),/mixed_gtfs_version/);
});
test('rejects untrusted options and HTTP endpoint',async()=>{
 await assert.rejects(loadActiveGtfsSnapshot({supabaseUrl:'http://fake.supabase.co',privateKey:'secret',fetcher:async()=>Response.json([])}),/invalid_server_configuration/);
 await assert.rejects(loadActiveGtfsSnapshot({supabaseUrl:'https://fake.supabase.co',privateKey:'secret',pageSize:2000,fetcher:async()=>Response.json([])}),/invalid_snapshot_options/);
});

test('exact maxRows is valid, one additional row must be rejected',async()=>{
 const rows=makeRows();rows.gtfs_stops=[...rows.gtfs_stops];
 assert.equal((await harness({rows,pageSize:2}).run()).stops.length,2);
 await assert.rejects(loadActiveGtfsSnapshot({
  supabaseUrl:'https://fake.supabase.co',privateKey:'secret',pageSize:2,maxRowsPerTable:2,
  fetcher:async input=>{const url=new URL(input),name=url.pathname.split('/').at(-1);
   if(name==='gtfs_feed_versions')return Response.json([{version}]);
   const source=name==='gtfs_stops'?[...rows.gtfs_stops,{version,stop_id:'C',stop_name:'C',stop_lat:54,stop_lon:-9}]:rows[name]||[];
   const offset=Number(url.searchParams.get('offset')||0),limit=Number(url.searchParams.get('limit')||2);
   return Response.json(source.slice(offset,offset+limit));
  },
 }),/snapshot_limit_exceeded_gtfs_stops/);
});
