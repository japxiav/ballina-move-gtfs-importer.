'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

// Exercise the real private addBest() without modifying the public engine API.
// This reproduces a bounded-frontier drop before the full Pareto selection.
const filename = path.resolve(__dirname, '../dist/engine.js');
const isolated = new Module(filename, module);
isolated.filename = filename;
isolated.paths = Module._nodeModulePaths(path.dirname(filename));
isolated._compile(fs.readFileSync(filename, 'utf8') +
  '\nexports.__testAddBest = addBest;\n', filename);
const addBest = isolated.exports.__testAddBest;

function label(id,{at=800,walk=100,leave=5000,snap=false}={}) {
  const ride={type:'ride',tripId:id,serviceDate:'2026-10-12'};
  const legs = snap ? [{type:'walk',requiresSnapConfirmation:true},ride] : [ride];
  return {stopId:'X',at,walkingMeters:walk,rides:1,latestLeaveAtSeconds:leave,legs,boardings:[]};
}

test('A12: full-cap shortcut must not drop a Pareto-best candidate of another snap-risk class',()=>{
  const safe=Array.from({length:23},(_,i)=>label('safe-'+i,{at:800+i}));
  const previousRisky=label('old-risky',{at:850,walk:500,leave:1000,snap:true});
  const incoming=label('new-risky',{at:900,walk:110,leave:4000,snap:true});
  const frontiers=new Map([['X',[...safe,previousRisky]]]);
  addBest(frontiers,incoming);
  // Previously, two numerically better, unrelated safe histories caused an
  // early return. The capped selector should compare the snap-risk class first.
  assert.ok(frontiers.get('X').includes(incoming),
    'a Pareto-best risky label must reach the bounded frontier selection');
  assert.ok(frontiers.get('X').length<=24);
});
