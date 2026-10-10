'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {inspectArtifact}=require('../scripts/verify_singlefile_parity_010.cjs');
const root=path.resolve(__dirname,'..');

test('A09.1: local package scripts cannot point to missing entrypoints',()=>{
 const pkg=require('../package.json');
 for(const [name,script] of Object.entries(pkg.scripts)){
  for(const match of script.matchAll(/(?:node\s+)((?:examples|api|scripts)\/[^\s;|&]+\.(?:cjs|js))/g)){
   assert.ok(fs.existsSync(path.join(root,match[1])),`script ${name} points to missing ${match[1]}`);
  }
 }
});

test('A09.1: token parity catches a deliberately tampered committed module before rebuild',()=>{
 const source=fs.readFileSync(path.join(root,'artifacts/ballina-routing-preview-singlefile-v0.10.0-candidate.ts'),'utf8');
 const needle='const budget = Math.max(0, Math.min(opts.maxRequestCount ?? 50, 200))';
 assert.ok(source.includes(needle),'expected request budget gate in candidate');
 const broken=source.replace(needle,'const budget = 0');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ballina-artifact-negative-'));
 const tmp=path.join(dir,'candidate.ts');
 try{
  fs.writeFileSync(tmp,broken);
  const result=inspectArtifact(tmp);
  assert.ok(result.mismatches.includes('pedestrian'),`expected pedestrian mismatch: ${result.mismatches}`);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('A09.1: checked-in CI validates artifact before it regenerates it',()=>{
 const file=fs.readFileSync(path.join(root,'../.github/workflows/routing-validation.yml'),'utf8');
 const before=file.indexOf('name: Verify committed candidate before regeneration');
 const rebuild=file.indexOf('name: Regenerate private candidate artifact');
 const after=file.indexOf('name: Reject generated candidate drift');
 assert.ok(before>=0&&rebuild>before&&after>rebuild,'integrity steps out of order');
 assert.match(file,/git diff --exit-code -- routing\/artifacts\/ballina-routing-preview-singlefile-v0\.10\.0-candidate\.ts/);
});
