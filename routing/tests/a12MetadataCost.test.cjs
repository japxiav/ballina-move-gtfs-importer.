'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=process.env.BALLINA_ENGINE_TEST_ROOT||path.resolve(__dirname,'..');
function probe(){
  let allocations=0;
  class CountingSet extends Set {constructor(...args){super(...args);allocations++;}}
  const filename=process.env.BALLINA_ENGINE_TEST_SOURCE||path.join(root,'dist/engine.js');
  const m={exports:{}};
  const localRequire=id=>require(path.resolve(root,'dist',id));
  new Function('module','exports','require','Set',fs.readFileSync(filename,'utf8')+'\nexports.__probe={stateDominates,addBest};')(m,m.exports,localRequire,CountingSet);
  return {...m.exports.__probe,allocations:()=>allocations};
}
function state(id,extra={}){return {stopId:'X',at:36000,walkingMeters:100,rides:1,latestLeaveAtSeconds:32000,legs:[{type:'ride',tripId:id,serviceDate:'2026-10-12'}],boardings:[],...extra};}
for(const [name,metrics] of Object.entries({arrival:{at:36001},walk:{walkingMeters:101},rides:{rides:2},leave:{latestLeaveAtSeconds:31999}})){
 test(`A12 cost: impossible ${name} dominance reads no vehicle history`,()=>{
  const engine=probe(),a=state('a',metrics),b=state('b');let reads=0;
  for(const label of [a,b]){const legs=label.legs;Object.defineProperty(label,'legs',{get(){reads++;return legs;}});}
  assert.equal(engine.stateDominates(a,b),false);assert.equal(reads,0);assert.equal(engine.allocations(),0);
 });
}
test('A12 cost: distinct last vehicles allocate no used-history sets',()=>{
 const engine=probe();for(let i=0;i<100;i++)assert.equal(engine.stateDominates(state('a'+i),state('b'+i)),false);
 assert.equal(engine.allocations(),0);
});
test('A12 history: lazy used sets still prevent losing a different prior vehicle',()=>{
 const engine=probe(),ride=id=>({type:'ride',tripId:id,serviceDate:'2026-10-12'});
 const a=state('common',{rides:2,legs:[ride('prior-a'),ride('common')]}),b=state('common',{rides:2,legs:[ride('prior-b'),ride('common')]});
 assert.equal(engine.stateDominates(a,b),false);assert.equal(engine.stateDominates(b,a),false);
 const direct=state('common');assert.equal(engine.stateDominates(direct,a),true);
 assert.equal(engine.stateDominates(a,direct),false);
 const calls=engine.allocations();for(let i=0;i<100;i++)assert.equal(engine.stateDominates(direct,a),true);
 assert.equal(engine.allocations(),calls,'used sets must be reused for unchanged states');
});
test('A12 history: same trip on another service date and snap risk remain distinct',()=>{
 const engine=probe(),safe=state('same'),otherDay=state('same',{legs:[{type:'ride',tripId:'same',serviceDate:'2026-10-11'}]});
 assert.equal(engine.stateDominates(safe,otherDay),false);
 const risky=state('same',{legs:[{type:'walk',requiresSnapConfirmation:true},...safe.legs]});
 assert.equal(engine.stateDominates(risky,safe),false);assert.equal(engine.stateDominates(safe,risky),true);
});
