'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createRoutingApi}=require('../dist/httpApi.js');

const encoder=new TextEncoder();
const makeApi=(overrides={})=>createRoutingApi({
  loadTimetable:async()=>{throw Error('should_not_load_timetable')},
  router:{walk:async()=>null},
  consumeRateLimit:async()=>true,
  clientIdentity:()=> 'a03-contract',
  ...overrides,
});
const req=(body,signal)=>new Request('https://example.invalid/v1/journeys',{
  method:'POST',headers:{'Content-Type':'application/json'},body,duplex:'half',signal,
});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function deadline(promise,ms=600){
  let id;
  try{return await Promise.race([promise,new Promise((_,reject)=>{id=setTimeout(()=>reject(Error('A03: request remained pending')),ms)})]);}
  finally{clearTimeout(id)}
}

test('A03: pending read ends on request abort without closing original stream',async()=>{
  const ctrl=new AbortController();let cancelCalls=0;
  const stream=new ReadableStream({start(controller){controller.enqueue(encoder.encode('{'))},cancel(){cancelCalls++}});
  const responsePromise=makeApi()(req(stream,ctrl.signal));
  await sleep(25);ctrl.abort();
  const response=await deadline(responsePromise);
  assert.equal(response.status,499);assert.equal((await response.json()).error,'request_aborted');
  assert.equal(cancelCalls,0);
});

test('A03: abort occurring before handler gets reader does not wait for first byte',async()=>{
  const ctrl=new AbortController();ctrl.abort();let cancelCalls=0;
  const stream=new ReadableStream({pull(){return new Promise(()=>{})},cancel(){cancelCalls++}});
  const response=await deadline(makeApi()(req(stream,ctrl.signal)));
  assert.equal(response.status,499);assert.equal(cancelCalls,0);
});

test('A03: abort releases reader without closing host-owned request stream',async()=>{
  const ctrl=new AbortController();let close;
  const stream=new ReadableStream({start(c){c.enqueue(encoder.encode('{'));close=()=>c.close()}});
  const responsePromise=makeApi()(req(stream,ctrl.signal));await sleep(20);ctrl.abort();
  const response=await deadline(responsePromise);
  assert.equal(response.status,499);
  // Request owner remains responsible for the underlying body source.
  assert.doesNotThrow(()=>close());
});

test('A03: payload limit does not hang if cancel() never settles',async()=>{
  let cancelCalls=0;
  const stream=new ReadableStream({start(c){c.enqueue(encoder.encode('x'.repeat(4097)))},cancel(){cancelCalls++;return new Promise(()=>{})}});
  const response=await deadline(makeApi()(req(stream)));
  assert.equal(response.status,400);assert.equal(cancelCalls,1);
});

test('A03: rejected cancel() is handled for oversized request',async()=>{
  let cancelCalls=0;
  const stream=new ReadableStream({start(c){c.enqueue(encoder.encode('x'.repeat(4097)))},cancel(){cancelCalls++;return Promise.reject(Error('rejected_cancellation'))}});
  const response=await deadline(makeApi()(req(stream)));
  assert.equal(response.status,400);assert.equal(cancelCalls,1);
  await sleep(10);
});

test('A03: valid finite JSON body keeps existing parsing semantics',async()=>{
  const response=await makeApi()(req(new ReadableStream({start(c){c.enqueue(encoder.encode('{"unexpected":true}'));c.close()}})));
  assert.equal(response.status,400);assert.equal((await response.json()).error,'invalid_route_request');
});

test('A03: exceeding 4096 bytes cancels even when stream never closes',async()=>{
  let cancelCalls=0;
  const stream=new ReadableStream({start(c){c.enqueue(encoder.encode('x'.repeat(4097)))},cancel(){cancelCalls++}});
  const response=await deadline(makeApi()(req(stream)));
  assert.equal(response.status,400);assert.equal((await response.json()).error,'payload_too_large');
  assert.equal(cancelCalls,1);
});

test('A03: abort after completing body does not retroactively change response',async()=>{
  const ctrl=new AbortController();
  const response=await makeApi()(req(new ReadableStream({start(c){c.enqueue(encoder.encode('{"unexpected":true}'));c.close()}}),ctrl.signal));
  ctrl.abort();assert.equal(response.status,400);assert.equal((await response.json()).error,'invalid_route_request');
});
