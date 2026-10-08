const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'../supabase/functions/ballina-routing-preview');
const source=readFileSync(path.join(root,'index.ts'),'utf8');
test('private routing preview never exposes the paid planner to publishable clients',()=>{
 assert.match(source,/if\(!await tokenMatches\(req\.headers\.get\('x-ballina-preview-token'\)\)\)/);
 assert.match(source,/public_planning_enabled:false/);
 assert.match(source,/router:new StadiaWalkingRouter\(stadiaKey,/);
 assert.match(source,/Deno\.env\.get\('STADIA_API_KEY'\)/);
 assert.match(source,/BALLINA_ROUTING_PREVIEW_TOKEN/);
 assert.match(source,/isNearby=path\.endsWith\('\/v1\/nearby-stops'\)/);
 assert.doesNotMatch(source,/x-forwarded-for/i);
 assert.doesNotMatch(source,/req\.headers\.get\('apikey'\)!==secret/);
});
test('Deno graph has all the local TypeScript modules it references',()=>{
 for (const file of ['httpApi.ts','gtfsSnapshot.ts','pedestrian.ts','supabaseLimiter.ts']) assert.match(source,new RegExp("from './src/"+file.replaceAll('.','\\.')+"'"));
 for(const file of require('node:fs').readdirSync(path.join(root,'src')).filter(x=>x.endsWith('.ts'))){
  const data=readFileSync(path.join(root,'src',file),'utf8');
  assert.doesNotMatch(data,/from ['"]\.[^'"]+(?<!\.ts)['"]/,'all relative imports in '+file+' must have .ts extension');
 }
});
