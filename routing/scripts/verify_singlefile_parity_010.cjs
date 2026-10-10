// Compare TypeScript/JavaScript parser tokens of the compiled source against
// the committed v0.10.0 artifact. No network, deployment, or source mutation.
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const defaultArtifact=path.join(root,'artifacts/ballina-routing-preview-singlefile-v0.10.0-candidate.ts');
const pattern=/\n  '(\.\/[^']+)': function\(module, exports, require\) \{\n/g;
function tokens(code){
 const scanner=ts.createScanner(ts.ScriptTarget.Latest,false,ts.LanguageVariant.Standard,code.trimEnd());
 const out=[];let k;
 while((k=scanner.scan())!==ts.SyntaxKind.EndOfFileToken){
  if(k>ts.SyntaxKind.LastTriviaToken)out.push(scanner.getTokenText());
 }
 return out;
}
function inspectArtifact(filePath=defaultArtifact){
 const bundled=fs.readFileSync(filePath,'utf8');
 const matches=[...bundled.matchAll(pattern)];
 if(matches.length!==16)throw Error('Expected 16 compiled modules');
 const mismatches=[];
 for(let i=0;i<matches.length;i++){
  const name=matches[i][1].slice(2);
  const start=matches[i].index+matches[i][0].length;
  const next=i+1<matches.length?matches[i+1].index:bundled.length;
  const end=bundled.lastIndexOf('\n  },',next);
  if(end<start)throw Error('Missing module end for '+name);
  const compiled=fs.readFileSync(path.join(root,'dist',name+'.js'),'utf8');
  try{assert.deepEqual(tokens(bundled.slice(start,end)),tokens(compiled));}
  catch{mismatches.push(name);}
 }
 return {total:matches.length,mismatches};
}
if(require.main===module){
 const {total,mismatches}=inspectArtifact();
 console.log('Compiled source vs v0.10.0 single-file candidate:',total-mismatches.length+'/'+total,'module tokens match; mismatches:',mismatches);
 if(mismatches.length)process.exitCode=1;
}
module.exports={inspectArtifact};
