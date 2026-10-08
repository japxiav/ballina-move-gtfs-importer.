const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=path.join(__dirname,'../src');
const edge=path.join(__dirname,'../supabase/functions/ballina-routing-preview/src');
const normalize=(content)=>content.replace(/(from ['"]\.[^'"]+)\.ts(['"])/g,'$1$2');
test('all duplicated Supabase Edge modules match the engine source except required Deno .ts extensions',()=>{
 const files=fs.readdirSync(source).filter(name=>name.endsWith('.ts')).sort();
 assert.deepEqual(fs.readdirSync(edge).filter(name=>name.endsWith('.ts')).sort(),files);
 for(const name of files){
  const expected=fs.readFileSync(path.join(source,name),'utf8');
  const actual=normalize(fs.readFileSync(path.join(edge,name),'utf8'));
  assert.equal(actual,expected,`edge module drift: ${name}`);
 }
});
