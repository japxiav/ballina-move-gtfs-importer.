const test=require('node:test'),assert=require('node:assert/strict');
const {StadiaWalkingRouter,loadActiveGtfsSnapshot,readBoundedServerJson}=require('../dist');
const A={lat:54.11,lon:-9.15},B={lat:54.111,lon:-9.151};
test('walking and private snapshot requests forbid redirects before sending protected headers',async()=>{
 let calls=0;
 const http=async(url,init)=>{calls++;assert.equal(init.redirect,'error');return new Response('',{status:302,headers:{Location:'https://untrusted.invalid/'}});};
 await assert.rejects(new StadiaWalkingRouter('offline-private-key',http).walk(A,B),/walking_api_failed_302/);
 await assert.rejects(loadActiveGtfsSnapshot({supabaseUrl:'https://fake.supabase.co',privateKey:'offline-private-key',fetcher:http}),/snapshot_http_302/);
 assert.equal(calls,2);
});
test('oversized walking and snapshot bodies fail before JSON allocation',async()=>{
 const response=()=>new Response(' '.repeat(1048577));
 await assert.rejects(new StadiaWalkingRouter('offline',async()=>response()).walk(A,B),/server_response_too_large/);
 await assert.rejects(loadActiveGtfsSnapshot({supabaseUrl:'https://fake.supabase.co',privateKey:'offline',fetcher:async()=>response()}),/server_response_too_large/);
});
test('declared oversized body is cancelled without a body read',async()=>{
 let cancelled=false;
 const body=new ReadableStream({cancel(){cancelled=true;}});
 await assert.rejects(readBoundedServerJson(new Response(body,{headers:{'Content-Length':'1048577'}}),new AbortController().signal,Date.now()+1000),/server_response_too_large/);
 assert.equal(cancelled,true);
});
test('abort interrupts a stalled mock body and releases the reader',async()=>{
 const abort=new AbortController();let cancelled=false,stream;
 const response=new Response(new ReadableStream({start(c){stream=c;},cancel(){cancelled=true;}}));
 const later=setTimeout(()=>{try{stream.close();}catch{}},100);
 const timer=setTimeout(()=>abort.abort(),10);
 try{await assert.rejects(readBoundedServerJson(response,abort.signal,Date.now()+1000),/server_response_aborted/);assert.equal(cancelled,true);}
 finally{clearTimeout(timer);clearTimeout(later);}
});
test('already expired absolute deadline rejects before reading',async()=>{
 const response=new Response('[1]');
 await assert.rejects(readBoundedServerJson(response,new AbortController().signal,Date.now()-1),/server_response_aborted/);
});
test('late EOF cannot succeed before a starved deadline timer dispatches',async()=>{
 const deadline=Date.now()+10;
 const response=new Response(new ReadableStream({pull(c){while(Date.now()<=deadline){}c.close();}},{highWaterMark:0}));
 await assert.rejects(readBoundedServerJson(response,new AbortController().signal,deadline),/server_response_aborted/);
 assert.equal(response.body.locked,false);
});
test('abort releases the body even when the underlying cancellation promise never resolves',async()=>{
 const abort=new AbortController();let cancelled=0;
 const response=new Response(new ReadableStream({cancel(){cancelled++;return new Promise(()=>{});}}));
 const timer=setTimeout(()=>abort.abort(),10);
 try{await assert.rejects(readBoundedServerJson(response,abort.signal,Date.now()+1000),/server_response_aborted/);assert.equal(cancelled,1);assert.equal(response.body.locked,false);}
 finally{clearTimeout(timer);}
});
test('bounded decoder validates UTF8/JSON without exposing private body text',async()=>{
 await assert.rejects(readBoundedServerJson(new Response(new Uint8Array([0xff])),new AbortController().signal,Date.now()+1000),/invalid_server_json/);
 await assert.rejects(readBoundedServerJson(new Response('private provider error not JSON'),new AbortController().signal,Date.now()+1000),/invalid_server_json/);
 assert.deepEqual(await readBoundedServerJson(Response.json({ok:true}),new AbortController().signal,Date.now()+1000),{ok:true});
});
test('tiny fragments stay within the same fixed byte budget and one interrupt hook',async()=>{
 const bytes=new TextEncoder().encode('['+' '.repeat(65536)+']');let index=0;
 const body=new ReadableStream({pull(c){if(index===bytes.length)c.close();else c.enqueue(bytes.subarray(index,++index));}});
 assert.deepEqual(await readBoundedServerJson(new Response(body),new AbortController().signal,Date.now()+5000),[]);
});
test('private snapshot credentials never leave the configured supported Supabase origin shape',async()=>{
 let calls=0;const fetcher=async()=>{calls++;return Response.json([]);};
 for(const supabaseUrl of ['https://private.invalid','https://user@fake.supabase.co','https://fake.supabase.co/private','https://fake.supabase.co?redirect=elsewhere'])
  await assert.rejects(loadActiveGtfsSnapshot({supabaseUrl,privateKey:'offline',fetcher}),/invalid_server_configuration/);
 assert.equal(calls,0);
});
