const test=require('node:test');const assert=require('node:assert/strict');
const {createSupabaseRateLimiter}=require('../dist');
const base={supabaseUrl:'https://example.supabase.co',privateKey:'server-side-test-only-secret'};
test('Supabase limiter hashes bucket and posts atomic RPC with private server-side credentials',async()=>{
 let call;const consume=createSupabaseRateLimiter({...base,fetcher:async(url,init)=>{
  call={url,init,body:JSON.parse(init.body)};return Response.json([{allowed:true}]);
 }});
 assert.equal(await consume('routing|client|192.0.2.1',10,60),true);
 assert.equal(call.url,'https://example.supabase.co/rest/v1/rpc/consume_transport_api_rate_limit');
 assert.equal(call.init.method,'POST');assert.equal(call.init.headers.apikey,base.privateKey);
 assert.match(call.body.p_key,/^[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(call.body).includes('192.0.2.1'),false);
 assert.equal(call.body.p_limit,10);assert.equal(call.body.p_window_seconds,60);
});
test('does not silently allow routing when rate limiter returns HTTP error or malformed data',async()=>{
 let h=createSupabaseRateLimiter({...base,fetcher:async()=>Response.json({oops:1},{status:500})});
 await assert.rejects(h('routing|global',200,60),/rate_limiter_unavailable/);
 h=createSupabaseRateLimiter({...base,fetcher:async()=>Response.json([])});
 await assert.rejects(h('routing|global',200,60),/invalid_rate_limiter_response/);
});
test('blocks arbitrary Supabase endpoints and invalid rate limit parameters',async()=>{
 assert.throws(()=>createSupabaseRateLimiter({...base,supabaseUrl:'https://fake.invalid.attacker.com'}),/invalid_rate_limiter_configuration/);
 const h=createSupabaseRateLimiter({...base,fetcher:async()=>{throw Error('should not happen')}});
 await assert.rejects(h('test',9999,60),/invalid_rate_limit_args/);
});

test('preview rate limiter supports fixed one-hour provider cost ceiling',async()=>{
 let window=0;
 const h=createSupabaseRateLimiter({...base,fetcher:async(_url,req)=>{
   window=JSON.parse(req.body).p_window_seconds;return Response.json([{allowed:true}]);
 }});
 assert.equal(await h('routing|paid-global|hourly',12,3600),true);
 assert.equal(window,3600);
 await assert.rejects(h('routing|paid-global|hourly',12,86400),/invalid_rate_limit_args/);
});
