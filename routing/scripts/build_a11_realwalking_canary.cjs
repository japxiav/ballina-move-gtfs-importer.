'use strict';
/* A11 isolated deployment artifact. Reuse the exact A11-verified 16-module bundle;
 * never recompile stale local sources or alter the official preview candidate. */
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const sourcePath=path.join(root,'artifacts/ballina-routing-preview-singlefile-v0.10.0-candidate.ts');
const suffixPath=path.join(root,'staging/a11_realwalking_canary_suffix.ts');
const outputPath=path.join(root,'artifacts/ballina-a11-realwalking-private-canary.ts');
function makeCandidate(source,suffix){
  const pivot="const {createRoutingApi,createSnapshotCache}=__ballinaRequire('./httpApi');";
  const index=source.indexOf(pivot);
  if(index<0||source.indexOf(pivot,index+1)>=0||!source.startsWith('import "jsr:@supabase/functions-js/edge-runtime.d.ts";'))
    throw new Error('unsupported_official_artifact');
  const prefix=source.slice(0,index);
  if(!prefix.includes("function __ballinaRequire(moduleId)")||!prefix.includes("'./pedestrian': function")||
     !prefix.includes("'./gtfsSnapshot': function")||!prefix.includes("'./supabaseLimiter': function"))
    throw new Error('incomplete_official_artifact');
  if(!suffix.includes('YES_UP_TO_12_WALKS')||!suffix.includes("'a11|canary|paid-hourly'"))
    throw new Error('unexpected_canary_suffix');
  return prefix+'\n'+suffix.trimEnd()+'\n';
}
if(require.main===module){
  const result=makeCandidate(fs.readFileSync(sourcePath,'utf8'),fs.readFileSync(suffixPath,'utf8'));
  if(process.argv.includes('--verify')){
    if(!fs.existsSync(outputPath)||fs.readFileSync(outputPath,'utf8')!==result){
      console.error('A11 generated canary drift');process.exitCode=1;
    }else console.log('A11 isolated canary parity OK');
  }else if(process.argv.includes('--build')){
    fs.mkdirSync(path.dirname(outputPath),{recursive:true});fs.writeFileSync(outputPath,result);
    console.log('Generated A11 private canary SHA256:',crypto.createHash('sha256').update(result).digest('hex'));
  }else{
    console.error('Use --build or --verify');process.exitCode=2;
  }
}
module.exports={makeCandidate};
