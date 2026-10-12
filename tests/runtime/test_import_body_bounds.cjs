'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const {webcrypto}=require('node:crypto');const ts=require('../../routing/node_modules/typescript');
function boot({shortTimeout=false,rateRows=[{allowed:true}],clockDate=Date}={}){
 let handler;const calls=[];
 const env={SUPABASE_URL:'https://offline.supabase.test',SUPABASE_PUBLISHABLE_KEY:'public-fixture',SUPABASE_SECRET_KEY:'private-fixture-not-real'};
 const source=fs.readFileSync(path.resolve(__dirname,'../../supabase/functions/gtfs-import-api/index.ts'),'utf8').replace(/^import[^\n]+\n/,'');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,{
  Deno:{env:{get:n=>env[n]},serve:h=>handler=h},Date:clockDate,Request,Response,TextEncoder,TextDecoder,AbortSignal,crypto:webcrypto,
  setTimeout:shortTimeout?(fn,ms)=>setTimeout(fn,Math.min(ms,10)):setTimeout,clearTimeout,
  console:{error:()=>{}},fetch:async(url,init)=>{calls.push({url,body:JSON.parse(init.body)});return Response.json(String(url).endsWith('consume_transport_api_rate_limit')?rateRows:{ok:true})},
 });
 const request=(body,extra={})=>new Request('https://offline.test/import',{method:'POST',headers:{apikey:'public-fixture',...extra.headers},body,...(typeof body==='string'?{}:{duplex:'half'}),...(extra.signal?{signal:extra.signal}:{})});
 return {handler,calls,request};
}
function deadline(promise){let id;return Promise.race([promise,new Promise((_,reject)=>{id=setTimeout(()=>reject(Error('handler remained pending')),250)})]).finally(()=>clearTimeout(id))}
test('A13: oversized stream is interrupted without EOF and without privileged requests',async()=>{
 const x=boot();let consumed=0,cancelled=0;
 let close;
 const stream=new ReadableStream({start(c){close=()=>c.close()},pull(c){if(consumed>=8000000)return new Promise(()=>{});consumed+=250000;c.enqueue(new Uint8Array(250000).fill(120))},cancel(){cancelled++;return new Promise(()=>{})}},{highWaterMark:0});
 try {
  const response=await deadline(x.handler(x.request(stream)));
  assert.equal(response.status,400);assert.ok(consumed<=1250000);assert.equal(cancelled,1);assert.equal(x.calls.length,0);
 } finally { try { close(); } catch {} }
});
test('A13: Content-Length rejects before reading the body',async()=>{
 const x=boot();let reads=0,close;const stream=new ReadableStream({start(c){close=()=>c.close()},pull(){reads++}},{highWaterMark:0});
 try {const response=await deadline(x.handler(x.request(stream,{headers:{'content-length':'1000001'}})));
 assert.equal(response.status,400);assert.equal(reads,0);assert.equal(x.calls.length,0);}finally{try{close()}catch{}}
});
test('A13: body cap counts UTF-8 bytes, not JS characters',async()=>{
 const x=boot();const text=JSON.stringify({action:'batch',import_token:'fixture-token',params:{value:'€'.repeat(350000)}});
 assert.ok(text.length<1000000);assert.ok(Buffer.byteLength(text)>1000000);
 const response=await x.handler(x.request(text));assert.equal(response.status,400);assert.equal(x.calls.length,0);
});
test('A13: aborted pending read releases the host stream and does no DB work',async()=>{
 const x=boot(),controller=new AbortController();let close,cancels=0;
 const stream=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));close=()=>c.close()},cancel(){cancels++}});
 const pending=x.handler(x.request(stream,{signal:controller.signal}));controller.abort();
 try{const response=await deadline(pending);assert.equal(response.status,499);assert.equal(x.calls.length,0);assert.equal(cancels,0);}finally{assert.doesNotThrow(close)}
});
test('A13: pending body times out without limiter or RPC',async()=>{
 const x=boot({shortTimeout:true});let close;const stream=new ReadableStream({start(c){close=()=>c.close()},pull(){return new Promise(()=>{})},cancel(){return new Promise(()=>{})}},{highWaterMark:0});
 try{const response=await deadline(x.handler(x.request(stream)));assert.equal(response.status,408);assert.equal(x.calls.length,0);}finally{try{close()}catch{}}
});
test('A13: exact-limit valid batch keeps token precedence and normal throughput',async()=>{
 const x=boot();const body={action:'batch',import_token:'fixture-token',params:{p_token:'cannot-overwrite',padding:''}};
 body.params.padding='x'.repeat(1000000-Buffer.byteLength(JSON.stringify(body)));
 const text=JSON.stringify(body);assert.equal(Buffer.byteLength(text),1000000);
 const response=await x.handler(x.request(text));assert.equal(response.status,200);assert.equal(x.calls.length,3);assert.equal(x.calls[2].body.p_token,'fixture-token');
});
test('A13: malformed UTF-8, absent token and unknown action stay nonprivileged',async()=>{
 for(const body of [new ReadableStream({start(c){c.enqueue(new Uint8Array([255]));c.close()}}),JSON.stringify({action:'batch'}),JSON.stringify({action:'unknown',import_token:'fixture-token'})]){
  const x=boot();const response=await x.handler(x.request(body));assert.ok([400,401,404].includes(response.status));assert.equal(x.calls.length,0);
 }
});

test('A13: inherited object keys are not whitelisted import actions',async()=>{
 for(const action of ['constructor','toString','__proto__']){
  const x=boot();const response=await x.handler(x.request(JSON.stringify({action,import_token:'fixture-token'})));
  assert.equal(response.status,404);assert.equal(x.calls.length,0);
 }
});
test('A13: malformed limiter responses fail closed before import RPC',async()=>{
 for(const rateRows of [[{allowed:'false'}],[{allowed:1}],[{}],[null]]){
  const x=boot({rateRows});const response=await x.handler(x.request(JSON.stringify({action:'config',import_token:'fixture-token'})));
  assert.equal(response.status,502);assert.equal(x.calls.length,1);
  assert.ok(x.calls[0].url.endsWith('consume_transport_api_rate_limit'));
 }
});

test('A13: tiny fragments keep heap bounded instead of retaining one promise/object per byte',()=>{
 const {spawnSync}=require('node:child_process');
 const result=spawnSync(process.execPath,['--expose-gc',path.join(__dirname,'helpers/import_body_fragmentation_probe.cjs')],{encoding:'utf8',timeout:15000});
 assert.equal(result.status,0,result.stderr);
 const data=JSON.parse(result.stdout);assert.equal(data.status,200);assert.equal(data.calls,3);
 assert.equal(data.bodyBytes,300068);assert.ok(data.peakExtraHeapBytes<64*1024*1024,JSON.stringify(data));
});

test('A13: EOF arriving after the absolute deadline cannot run the RPC before timer dispatch',async()=>{
 let now=0,stage=0;class Clock extends Date{static now(){return now}}
 const x=boot({clockDate:Clock});
 const stream=new ReadableStream({pull(c){if(stage++===0)c.enqueue(new TextEncoder().encode(JSON.stringify({action:'config',import_token:'fixture-token'})));else{now=10001;c.close()}}},{highWaterMark:0});
 const response=await x.handler(x.request(stream));assert.equal(response.status,408);assert.equal(x.calls.length,0);
});
