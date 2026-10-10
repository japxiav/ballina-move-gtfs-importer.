'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const ts=require('typescript');
const {parseIrishRailStationXml}=require('../dist');
const at='2026-10-08T22:45:00Z';
const train=(name='Cork &amp;Belfast')=>`<objStationData><Traincode>A503</Traincode><Stationfullname>Ballina</Stationfullname><Destination>${name}</Destination></objStationData>`;
const wrap=x=>`<?xml version="1.0" encoding="utf-8"?><ArrayOfObjStationData xmlns="http://api.irishrail.ie/realtime/">${x}</ArrayOfObjStationData>`;
test('audit-2: valid XML ampersand adjacent to letters must decode without 503',()=>{
 assert.equal(parseIrishRailStationXml(wrap(train()),'Ballina',at).services[0].destination,'Cork &Belfast');
});
test('audit-2: truncated root must fail closed rather than announce zero trains',()=>{
 assert.throws(()=>parseIrishRailStationXml('<ArrayOfObjStationData>','Ballina',at),/invalid_rail_xml_response/);
});
test('audit-2: XML comment must not inject ghost trains into station board',()=>{
 const xml=wrap('<!--'+train('Fake Service')+'-->');
 assert.equal(parseIrishRailStationXml(xml,'Ballina',at).services.length,0);
});
const source=fs.readFileSync(path.resolve(__dirname,'../artifacts/ballina-routing-preview-singlefile-v0.10.0-candidate.ts'),'utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function launch(stadia){
 const env={SUPABASE_URL:'https://offline.supabase.co',SUPABASE_SECRET_KEYS:'{"default":"offline-service-key"}',SUPABASE_PUBLISHABLE_KEYS:'{"default":"offline-public-key"}',BALLINA_ROUTING_PREVIEW_TOKEN:'distinct-token-at-least-thirty-two-characters',STADIA_API_KEY:stadia};
 const db={gtfs_stops:[{version:'v',stop_id:'B',stop_name:'Ballina',stop_lat:54.108,stop_lon:-9.156}],gtfs_routes:[{version:'v',route_id:'R',route_short_name:'rail',route_long_name:'rail',route_type:2}],gtfs_trips:[{version:'v',trip_id:'T',route_id:'R',service_id:'S'}],gtfs_stop_times:[{version:'v',trip_id:'T',stop_id:'B',stop_sequence:1,arrival_seconds:18000,departure_seconds:18000}],gtfs_calendars:[],gtfs_calendar_dates:[]};
 let handler; const calls=[];
 const fake=async(url)=>{const u=new URL(url);calls.push(u.pathname);if(u.hostname==='api-eu.stadiamaps.com')throw Error('PAID_REQUEST_NOT_ALLOWED');if(u.pathname==='/rest/v1/rpc/consume_transport_api_rate_limit')return Response.json([{allowed:true}]);if(u.pathname==='/rest/v1/gtfs_feed_versions')return Response.json([{version:'v'}]);const t=u.pathname.slice('/rest/v1/'.length);if(!Object.hasOwn(db,t))throw Error('Unexpected network fetch '+url);const rows=db[t];return new Response(JSON.stringify(rows),{status:200,headers:{'Content-Range': rows.length?'0-'+(rows.length-1)+'/'+rows.length:'*/0'}})};
 new Function('Deno','fetch','Request','Response','URL','crypto','TextEncoder','Uint8Array','AbortSignal','console','exports','require',js)({env:{get:k=>env[k]},serve:f=>{handler=f}},fake,Request,Response,URL,crypto,TextEncoder,Uint8Array,AbortSignal,{info:()=>{},error:()=>{},log:()=>{}},{},n=>{if(n==='jsr:@supabase/functions-js/edge-runtime.d.ts')return {};throw Error(n)});
 return {handler,calls};
}
test('audit-2: GTFS rail stations independent of paid Stadia key, authenticated',async()=>{
 const yes=launch('offline-placeholder');const no=launch('');
 const url='https://offline.supabase.co/functions/v1/ballina-routing-preview/v1/rail/stations';const headers={'x-ballina-preview-token':'distinct-token-at-least-thirty-two-characters'};
 const ctrl=await yes.handler(new Request(url,{headers}));assert.equal(ctrl.status,200,await ctrl.text());
 const r=await no.handler(new Request(url,{headers}));assert.equal(r.status,200,await r.text());assert.ok(no.calls.every(x=>!x.includes('stadiamaps')));
 const request=new Request('https://offline.supabase.co/functions/v1/ballina-routing-preview/v1/journeys',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:'{}'});
 const denied=await no.handler(request);assert.equal(denied.status,503);assert.equal((await denied.json()).error,'walking_provider_unavailable');
 assert.ok(no.calls.every(x=>!x.includes('stadiamaps')),'rail directory access must never trigger paid calls');
});

test('audit-2: empty self-closing official station board remains a legal zero-result response',()=>{
 assert.equal(parseIrishRailStationXml('<ArrayOfObjStationData xmlns="http://api.irishrail.ie/realtime/" />','Ballina',at).services.length,0);
});
test('audit-2: concurrent requests for same Irish Rail station share one in-flight fetch',async()=>{
 const {createIrishRailStationClient}=require('../dist');
 let calls=0;
 const get=createIrishRailStationClient({fetcher:async()=>{
   calls++;
   await new Promise(resolve=>setTimeout(resolve,30));
   return new Response(wrap(train('Manulla Junction')),{status:200});
 }});
 const results=await Promise.all(Array.from({length:12},()=>get('Ballina')));
 assert.equal(results.length,12);
 assert.equal(calls,1,'one upstream call should serve concurrent station-board requests');
});
test('audit-2: failed coalesced upstream request is not permanently cached',async()=>{
 const {createIrishRailStationClient}=require('../dist');
 let calls=0;const get=createIrishRailStationClient({fetcher:async()=>{
   calls++;
   await new Promise(resolve=>setTimeout(resolve,5));
   if(calls===1) return new Response('error',{status:503});
   return new Response(wrap(train('Manulla Junction')),{status:200});
 }});
 const errors=await Promise.allSettled(Array.from({length:5},()=>get('Ballina')));
 assert.equal(errors.every(x=>x.status==='rejected'),true);
 assert.equal(calls,1);
 assert.equal((await get('Ballina')).services[0].trainCode,'A503');
 assert.equal(calls,2);
});
