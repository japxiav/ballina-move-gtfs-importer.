const {test}=require('node:test'),assert=require('node:assert/strict');
const {inspectWalkingConnection:walk,distanceMeters}=require('/tmp/ballina-pilot-compiled/walking.js');
const from={lat:53.85184,lon:-9.30599},to={lat:53.85194,lon:-9.30559};
function graph(){return{source:{kind:'offline_fixture',licence:'fixture',retrievedAt:'2026-10-13T00:00:00Z'},nodes:[{id:'A',...from,tags:{}},{id:'X',lat:53.8519,lon:-9.3058,tags:{highway:'crossing'}},{id:'B',...to,tags:{entrance:'yes'}}],ways:[{id:'path',nodes:['A','X','B'],tags:{highway:'footway'}}]};}
test('different Hospital15108/15109 points retain geometry without claiming physical safety or safe ETA',()=>{
 const r=walk(graph(),from,to);assert.equal(r.status,'unverified_geometry');
 assert(r.geodesicMeters>28&&r.geodesicMeters<30);assert(r.totalMeters>=r.geodesicMeters);
 assert.equal(r.mappedCrossingNodes,1);assert.equal(r.physicalCrossingCount,null);
 for(const k of ['walkingSafe','publicEligible','physicalEntranceVerified','accessibilityVerified'])assert.equal(r[k],false);
 assert.equal(r.nearbyMappedEntrances[0].hospitalAssociationVerified,false);assert.equal(r.waitingAndCrossingDelaySeconds,null);
});
test('no path or connector never substitutes a geodesic line as walkable geometry',()=>{
 const g=graph();g.ways[0].tags.access='private';assert.equal(walk(g,from,to).status,'no_verified_connector');
 const split=graph();split.nodes.push({id:'C',lat:53.85193,lon:-9.30558,tags:{}},{id:'D',lat:53.85185,lon:-9.30598,tags:{}});split.ways=[{id:'a',nodes:['A','D'],tags:{highway:'footway'}},{id:'b',nodes:['B','C'],tags:{highway:'footway'}}];
 assert.equal(walk(split,from,to).status,'no_open_data_path');
 assert.equal(walk(graph(),{lat:54.11101,lon:-9.1599},to).status,'outside_last_mile_scope');
});
test('closed gates, conditional access, stairs and unmapped crossings retain explicit uncertainty',()=>{
 const g=graph();g.nodes[1].tags={barrier:'gate'};assert.equal(walk(g,from,to).status,'no_verified_connector');
 const h=graph();h.ways[0].tags['foot:conditional']='yes @ hospital';assert.equal(walk(h,from,to).status,'no_verified_connector');
 const stairs=graph();stairs.ways[0].tags.highway='steps';stairs.nodes[1].tags={};const r=walk(stairs,from,to);
 assert.equal(r.mappedSteps,true);assert.equal(r.mappedCrossingNodes,0);assert.equal(r.physicalCrossingCount,null);assert.equal(r.accessibilityVerified,false);
 const node=graph();node.nodes[1].tags['access:conditional']='no @ night';assert.equal(walk(node,from,to).status,'no_verified_connector');
 for(const key of ['oneway:foot','oneway','foot:forward','foot:backward']){const direction=graph();direction.ways[0].tags[key]='yes';assert.equal(walk(direction,to,from).status,'no_verified_connector');}
});
test('source enums and oversized references are rejected before walking the references',()=>{
 const g=graph();g.source.kind=['offline_fixture'];assert.throws(()=>walk(g,from,to));
 const h=graph(),refs=Array(15001).fill('A');let reads=0;
 Object.defineProperty(refs,0,{get(){reads++;throw Error('unnecessary_access');}});h.ways[0].nodes=refs;
 assert.throws(()=>walk(h,from,to),/walking_graph_capacity/);assert.equal(reads,0);
});
test('malformed topology and private metadata cannot create verified or leaked routes',()=>{
 for(const mutate of [g=>g.nodes.push(g.nodes[0]),g=>g.ways[0].nodes.push('missing'),g=>g.nodes[0].lat=NaN,g=>g.nodes=Array(5001).fill(g.nodes[0])]){const g=graph();mutate(g);assert.throws(()=>walk(g,from,to));}
 const g=graph();g.physicalAccessVerified=true;g.source.private='never-forward';
 const r=walk(g,{...from,private:'never-forward'},to);assert.equal(r.walkingSafe,false);assert(!JSON.stringify(r).includes('never-forward'));
});
