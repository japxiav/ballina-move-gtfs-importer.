const assert=require('node:assert/strict');const {webcrypto}=require('node:crypto');globalThis.crypto=webcrypto;
let handler;
const env={SUPABASE_URL:'https://fake.supabase.co',SUPABASE_SECRET_KEY:'dummy_secret',SUPABASE_PUBLISHABLE_KEY:'dummy_public'};
globalThis.Deno={env:{get:k=>env[k]},serve:h=>handler=h};
require('/tmp/ballina-ts-compiled/ballina_import_api.js');
let calls=[];
globalThis.fetch=async(u,init)=>{
 calls.push({u,body:JSON.parse(init.body)});
 if(String(u).endsWith('consume_transport_api_rate_limit'))return Response.json([{allowed:true}]);
 if(String(u).endsWith('get_gtfs_import_config'))return Response.json({targets:[],routes:[],active_version:'v1'});
 return Response.json({error:'forbidden'},{status:403});
};
const post=body=>handler(new Request('https://fake.supabase.co/functions/v1/gtfs-import-api',{method:'POST',headers:{apikey:'dummy_public'},body:JSON.stringify(body)}));
(async()=>{
 const r=await post({action:'config',import_token:'presented',params:{p_token:'overwritten'}});
 assert.equal(r.status,200);const actual=calls.find(c=>String(c.u).endsWith('get_gtfs_import_config'));
 assert.equal(actual.body.p_token,'presented');
 console.log('PASS: body params cannot override verified token');
 calls=[];let invalid=await post({action:'evil',import_token:'anything',params:{}});
 assert.equal(invalid.status,404);assert.equal(calls.length,0);
 console.log('PASS: rejects unknown actions before database calls');
 calls=[];let empty=await post({action:'config',import_token:'',params:{}});
 assert.equal(empty.status,401);assert.equal(calls.length,0);
 console.log('PASS: missing token rejected before database calls');
 let failed=await post({action:'begin',import_token:'wrong',params:{}});
 const error=await failed.json();assert.equal(failed.status,400);assert.equal(error.detail,undefined);
 console.log('PASS: Postgres error body sanitized');
})().catch(e=>{console.error(e);process.exit(1)});
