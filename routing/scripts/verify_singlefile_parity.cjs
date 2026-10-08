// Compare parser tokens, rather than whitespace/comments, between artifacts.
// The v0.9.7 artifact is a review-only offline generated candidate.
const fs=require('node:fs'); const path=require('node:path');const assert=require('node:assert/strict');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const bundled=fs.readFileSync(path.join(root,'artifacts/ballina-routing-preview-singlefile-v0.9.8-candidate.ts'),'utf8');
const pat=/\n  '(\.\/[^']+)': function\(module, exports, require\) \{\n/g;const matches=[...bundled.matchAll(pat)];
function tokens(code){ const scanner=ts.createScanner(ts.ScriptTarget.Latest,false,ts.LanguageVariant.Standard,code.trimEnd());const out=[];let k;while((k=scanner.scan())!==ts.SyntaxKind.EndOfFileToken){if(k>ts.SyntaxKind.LastTriviaToken)out.push(scanner.getTokenText());}return out; }
const mismatches=[];
for(let i=0;i<matches.length;i++){
 const name=matches[i][1].slice(2);
 const start=matches[i].index+matches[i][0].length;
 const next=i+1<matches.length?matches[i+1].index:bundled.length;
 const end=bundled.lastIndexOf('\n  },',next);
 const raw=bundled.slice(start,end);
 const compiled=fs.readFileSync(path.join(root,'dist',name+'.js'),'utf8');
 try{assert.deepEqual(tokens(raw),tokens(compiled));}catch{mismatches.push(name);}
}
console.log('Compiled source vs v0.9.8 single-file candidate:',matches.length-mismatches.length+'/'+matches.length,'module tokens match; mismatches:',mismatches);
if(mismatches.length)process.exitCode=1;
