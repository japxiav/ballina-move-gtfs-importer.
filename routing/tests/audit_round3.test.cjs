'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseIrishRailStationXml,createIrishRailStationClient}=require('../dist');
const ts='2026-10-08T22:45:00Z';
const good='<objStationData><Traincode>A503</Traincode><Stationfullname>Ballina</Stationfullname><Destination>Manulla Junction</Destination></objStationData>';
const wrap=body=>'<ArrayOfObjStationData xmlns="http://api.irishrail.ie/realtime/">'+body+'</ArrayOfObjStationData>';
test('audit-3: XML parser must reject unclosed unknown tag despite valid root and train',()=>{
 assert.throws(()=>parseIrishRailStationXml(wrap(good+'<broken>'),'Ballina',ts),/invalid_rail_xml_response/);
});
test('audit-3: XML parser must not interpret nested object as direct train record',()=>{
 assert.throws(()=>parseIrishRailStationXml(wrap('<metadata>'+good+'</metadata>'),'Ballina',ts),/invalid_rail_xml_response/);
});
test('audit-3: XML parser must reject mismatched field names despite a usable Traincode',()=>{
 const malformed=good.replace('</Destination>','</Origin>');
 assert.throws(()=>parseIrishRailStationXml(wrap(malformed),'Ballina',ts),/invalid_rail_xml_response/);
});
test('audit-3: full station client timeout covers a fetcher that ignores AbortSignal', async()=>{
 const board=createIrishRailStationClient({timeoutMs:120,fetcher:(_url,opts)=>new Promise(()=>{ /* upstream never settles even after abort */ })});
 const outcome=await Promise.race([board('Ballina').then(()=> 'resolved',()=> 'rejected'),new Promise(resolve=>setTimeout(()=>resolve('unbounded'),500))]);
 assert.equal(outcome,'rejected');
});

test('audit-3: official-style namespaced XML with empty optional values is accepted',()=>{
 const xml='<?xml version="1.0" encoding="utf-8"?><ArrayOfObjStationData xmlns="http://api.irishrail.ie/realtime/">'+
 '<objStationData><Servertime>2026-10-08T23:10:00</Servertime><Traincode>A503</Traincode><Stationfullname>Ballina</Stationfullname><Scharrival>23:20</Scharrival><Exparrival /><Duein>10</Duein></objStationData></ArrayOfObjStationData>';
 const board=parseIrishRailStationXml(xml,'Ballina',ts);
 assert.equal(board.services.length,1);
 assert.equal(board.services[0].expectedArrival,null);
 assert.equal(board.services[0].scheduledArrival,'23:20');
 assert.equal(board.services[0].dueInMinutes,10);
});
test('audit-3: unknown wrapper text may not turn into valid zero train count',()=>{
 assert.throws(()=>parseIrishRailStationXml(wrap('This is not a station board'),'Ballina',ts),/invalid_rail_xml_response/);
});
test('audit-3: late upstream response after timeout cannot poison future cache',async()=>{
 let calls=0;
 const client=createIrishRailStationClient({timeoutMs:110,cacheMs:5000,fetcher:async()=>{
   calls++;
   if(calls===1){await new Promise(resolve=>setTimeout(resolve,175));return new Response(wrap(good));}
   return new Response(wrap(good.replace('A503','B900')));
 }});
 await assert.rejects(client('Ballina'),/irish_rail_timeout/);
 await new Promise(resolve=>setTimeout(resolve,110));
 const fresh=await client('Ballina');
 assert.equal(fresh.services[0].trainCode,'B900');
 assert.equal(calls,2);
});
