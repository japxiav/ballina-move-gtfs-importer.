'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {StadiaWalkingRouter,decodePolyline6}=require('../dist/index.js');
const {runChecks,scenarios}=require('../scripts/a11_live_walking_smoke.cjs');
const A={lat:54.1118,lon:-9.1613},B={lat:54.11101,lon:-9.1599};
function encode(points){
 let lat=0,lon=0,out='';
 function put(v){let x=v<0?~(v<<1):(v<<1);while(x>=32){out+=String.fromCharCode((32|(x&31))+63);x>>=5;}out+=String.fromCharCode(x+63);}
 for(const point of points){const a=Math.round(point.lat*1e6),b=Math.round(point.lon*1e6);put(a-lat);put(b-lon);lat=a;lon=b;}
 return out;
}
function walker({time=500,length=0.6,points=[A,B]}={}){
 return new StadiaWalkingRouter('fixture-secret',async()=>Response.json({trip:{summary:{time,length},legs:[{shape:encode(points)}]}}));
}
test('A11: inconsistent route length cannot undercount kilometres of displayed geometry',async()=>{
 const distant={lat:54.13,lon:-9.1599};
 const bad=walker({length:0.015,points:[A,distant,B]});
 assert.equal(await bad.walk(A,B),null);
});
test('A11: a legitimate indirect pedestrian shape and summary are retained',async()=>{
 const midpoint={lat:54.1112,lon:-9.1608};
 const route=await walker({time:520,length:0.6,points:[A,midpoint,B]}).walk(A,B);
 assert.ok(route);
 assert.equal(route.geometry.length,3);
 assert.equal(route.distanceMeters,600);
 assert.equal(route.provider,'stadia-valhalla-pedestrian');
});
test('A11: impossible coordinate in provider polyline is rejected',async()=>{
 assert.throws(()=>decodePolyline6(encode([{lat:101,lon:-9.1599},B])),/invalid_polyline/);
 const malformed=new StadiaWalkingRouter('key',async()=>Response.json({trip:{summary:{time:1,length:0.5},legs:[{shape:encode([{lat:99,lon:-9},B])}]}}));
 await assert.rejects(()=>malformed.walk(A,B),/invalid_polyline/);
});
test('A11: geometry with more than 10000 points is rejected before use',()=>{
 const many=Array.from({length:10001},()=>A);
 assert.throws(()=>decodePolyline6(encode(many)),/invalid_polyline/);
});
test('A11: authorization, throttling and upstream faults are never rewritten as a missing walking path',async()=>{
 for(const status of [401,403,429,500]){
  const router=new StadiaWalkingRouter('key',async()=>new Response('{}',{status}));
  await assert.rejects(()=>router.walk(A,B),new RegExp('walking_api_failed_'+status));
 }
});
test('A11: no suitable route returns null without creating a straight-line footpath',async()=>{
 const router=new StadiaWalkingRouter('key',async()=>new Response('{}',{status:400}));
 assert.equal(await router.walk(A,B),null);
});
test('A11: live probe only allows two fixed, public Ballina samples',async()=>{
 let calls=0;
 const result=await runChecks({walk:async(from,to,roles)=>{
  assert.deepEqual(from,scenarios[calls].from);
  assert.deepEqual(to,scenarios[calls].to);
  assert.deepEqual(roles,scenarios[calls].roles);
  calls++;
  return {provider:'stadia-valhalla-pedestrian',distanceMeters:600,durationSeconds:500,geometry:[from,to]};
 }});
 assert.equal(calls,2);
 assert.equal(result.length,2);
 assert.ok(result.every(x=>x.provider==='stadia-valhalla-pedestrian'));
 assert.ok(result.every(x=>!JSON.stringify(x).includes('fixture-secret')));
});
test('A11: probe fails closed and does not retry a failed provider request',async()=>{
 let calls=0;
 await assert.rejects(()=>runChecks({walk:async()=>{calls++;return null;}}),/provider_route_missing/);
 assert.equal(calls,1);
});
test('A11: even syntactically valid synthetic walking results cannot masquerade as real probe success',async()=>{
 await assert.rejects(()=>runChecks({walk:async(from,to)=>({provider:'synthetic_private_staging_only',geometry:[from,to],distanceMeters:400,durationSeconds:300})}),/invalid_provider_route/);
});
