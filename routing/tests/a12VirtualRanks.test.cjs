const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const filename=path.resolve(__dirname,'../dist/engine.js');
const probe=new Module(filename,module);probe.filename=filename;probe.paths=Module._nodeModulePaths(path.dirname(filename));
probe._compile(fs.readFileSync(filename,'utf8')+'\nexports.testAddBest=addBest;',filename);
const add=probe.exports.testAddBest;
function label(id,at=10000+id,leave=8000+id){return {stopId:'X',at,walkingMeters:100,rides:1,latestLeaveAtSeconds:leave,legs:[{type:'ride',tripId:String(id),serviceDate:'2026-10-13'}],boardings:[],fixtureId:id};}
const ids=states=>states.get('X').map(s=>s.fixtureId);
test('repeated caps preserve early-arrival and late-leave choices, immutable old groups and independent queries',()=>{
 const first=new Map(),second=new Map();
 for(let i=0;i<100;i++){add(first,label(i));add(second,label(i));}
 const expected=[...Array.from({length:16},(_,i)=>i),...Array.from({length:8},(_,i)=>92+i)];
 assert.deepEqual(ids(first),expected);assert.deepEqual(ids(second),expected);
 const old=first.get('X');
 // Earlier insertion forces the normal selector to copy its cached ranks.
 add(first,label('early',9000,7000));
 assert.deepEqual(ids(first),['early',...Array.from({length:15},(_,i)=>i),...Array.from({length:8},(_,i)=>92+i)]);
 assert.deepEqual(old.map(s=>s.fixtureId),expected);
 add(second,label(100));
 assert.deepEqual(ids(second),[...Array.from({length:16},(_,i)=>i),...Array.from({length:8},(_,i)=>93+i)]);
 assert.equal(first.get('X').length,24);assert.equal(second.get('X').length,24);
});
