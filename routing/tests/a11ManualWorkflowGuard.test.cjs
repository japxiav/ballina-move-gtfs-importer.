'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const workflow=fs.readFileSync(path.resolve(__dirname,'../../.github/workflows/a11-live-walking-smoke.yml'),'utf8');

test('A11 live provider workflow can only be triggered manually',()=>{
  assert.match(workflow,/^on:\s*\n\s{2}workflow_dispatch:/m);
  assert.doesNotMatch(workflow,/^\s{2}(push|pull_request|schedule|workflow_run|repository_dispatch):/m);
});
test('A11 live provider workflow requires explicit paid-call confirmation and main branch',()=>{
  assert.match(workflow,/default: NO_DO_NOT_RUN/);
  assert.match(workflow,/YES_UP_TO_2_REQUESTS/);
  assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/ref: main/);
  assert.match(workflow,/persist-credentials: false/);
  assert.match(workflow,/^permissions:\s*\n\s{2}contents: read/m);
});
test('A11 credentials come from GitHub secrets, never workflow inputs or committed literals',()=>{
  assert.match(workflow,/secrets\.STADIA_API_KEY/);
  const secretBindings=workflow.split(/\r?\n/).filter(line=>/^\s+STADIA_API_KEY:/.test(line));
  assert.equal(secretBindings.length,2);
  for(const line of secretBindings)assert.match(line,/^\s+STADIA_API_KEY: \$\{\{ secrets\.STADIA_API_KEY \}\}\s*$/);
  assert.match(workflow,/\[ -z "\$STADIA_API_KEY" \]/);
});
test('A11 workflow invokes the already-tested opt-in fixed-sample runner',()=>{
  assert.match(workflow,/node scripts\/a11_live_walking_smoke\.cjs --live/);
  assert.match(workflow,/two-request fixed Ballina smoke/);
  assert.doesNotMatch(workflow,/npm publish|supabase.*deploy|--force/);
});
