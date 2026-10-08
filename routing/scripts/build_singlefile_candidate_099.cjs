'use strict';
// Offline audit artefact builder. Never deploys or accesses external services.
const fs=require('node:fs'); const path=require('node:path');
const root=path.join(__dirname,'..');
const template=fs.readFileSync(path.join(root,'artifacts/ballina-routing-preview-singlefile-v0.9.3-candidate.ts'),'utf8');
const pattern=/\n  '(\.\/[^']+)': function\(module, exports, require\) \{\n/g;
const sections=[...template.matchAll(pattern)];
if(sections.length!==15)throw Error('Expected exactly 15 modules in template');
const out=[template.slice(0,sections[0].index)];
for(let i=0;i<sections.length;i++){
  const moduleId=sections[i][1];const name=moduleId.slice(2);
  const compiled=path.join(root,'dist',name+'.js');
  if(!fs.existsSync(compiled))throw Error('Missing compiled module '+compiled);
  out.push(sections[i][0],fs.readFileSync(compiled,'utf8').trimEnd(),'\n\n  },');
}
const trailer=template.lastIndexOf('\n  },', template.length);
if(trailer<sections.at(-1).index||!template.slice(trailer).includes('Deno.serve('))throw Error('Template trailer not found');
const oldTail=template.slice(trailer+'\n  },'.length);
const entryStart=oldTail.indexOf('// Private integration preview.');
if(entryStart<0)throw Error('Legacy entry marker not found; review template manually');
const entry=fs.readFileSync(path.join(root,'supabase/functions/ballina-routing-preview/index.ts'),'utf8')
 .replace(/^import[^\n]*\n/gm,'').trimStart();
out.push(oldTail.slice(0,entryStart),entry);
const output=path.join(root,'artifacts/ballina-routing-preview-singlefile-v0.9.9-candidate.ts');
fs.writeFileSync(output,out.join(''));
console.log(`Built ${path.basename(output)} with ${sections.length} compiled modules`);
