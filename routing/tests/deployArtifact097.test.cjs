'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');

test('exact v0.9.7 single-file artifact fails closed and makes ZERO outbound fetches without dedicated token',async()=>{
 const raw=fs.readFileSync(path.join(__dirname,'../artifacts/ballina-routing-preview-singlefile-v0.9.7-candidate.ts'),'utf8');
 const js=ts.transpileModule(raw,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const environment={SUPABASE_URL:'https://example.supabase.co',STADIA_API_KEY:'provider-fake',SUPABASE_SECRET_KEYS:JSON.stringify({default:'server-only'}),SUPABASE_PUBLISHABLE_KEYS:JSON.stringify({default:'publishable-key'})};
 let handler;let calls=0;
 const Deno={env:{get:(key)=>environment[key]},serve:(fn)=>{handler=fn;}};
 const fetchMock=async()=>{calls++;throw Error('should never fetch')};
 const execute=new Function('Deno','fetch','Request','Response','URL','crypto','TextEncoder','Uint8Array','console','exports','require',js);
 execute(Deno,fetchMock,Request,Response,URL,crypto,TextEncoder,Uint8Array,{log:()=>{},info:()=>{},error:()=>{}},{},(name)=>{if(name==='jsr:@supabase/functions-js/edge-runtime.d.ts')return {};throw Error('unexpected import '+name)});
 assert.equal(typeof handler,'function');
 const unauthorized=await handler(new Request('https://fake.supabase.co/functions/v1/ballina-routing-preview/v1/journeys',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}));
 assert.equal(unauthorized.status,503); // not configured, fail closed
 const status=await handler(new Request('https://fake.supabase.co/functions/v1/ballina-routing-preview/health',{headers:{apikey:'publishable-key'}}));
 assert.equal(status.status,200);assert.equal((await status.json()).public_planning_enabled,false);
 assert.equal(calls,0);
});
