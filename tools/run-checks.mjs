import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const mode=process.argv[2];
function walk(folder){return fs.readdirSync(path.join(root,folder),{withFileTypes:true})
  .flatMap(item=>item.isDirectory()?walk(folder+'/'+item.name):[folder+'/'+item.name]);}
const source=walk('extension');
const unit=source.filter(name=>/\.test\.(?:js|cjs)$/.test(name)
  ||/^extension\/tests\/test-[\w-]+\.js$/.test(name));
unit.push('extension/attach-debugger.check.cjs','extension/tests/matrix-format.check.cjs');
const external=new Set(['authoring-packages.browser.cjs','matrix-workbench.browser.cjs',
  'fidelity-sample.browser.cjs','matrix-studio.browser.cjs']);
const browser=source.filter(name=>name.startsWith('extension/tests/')
  && (/\.browser\.cjs$/.test(name)||name.endsWith('/studio.extension.cjs'))
  && !external.has(path.basename(name)));
browser.push(...['matrix-cover.check.cjs','toutiao-fill.check.cjs','yidian-format.check.cjs',
  'yidian-fill.check.cjs','yidian-late-write.check.cjs'].map(name=>'extension/'+name));
const output=process.env.DRAFT_HELPER_TEST_OUTPUT||fs.mkdtempSync(path.join(os.tmpdir(),'draft-helper-checks-'));
async function run(args,env={}){
  const child=spawn(process.execPath,args,{cwd:root,stdio:'inherit',env:{...process.env,...env}});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve(signal?1:code));});
  if(code!==0)throw Error('Check failed: '+args.join(' '));
}
try{
  if(mode==='unit')await run(['--test',...unit.sort()]);
  else if(mode==='browser'){
    console.log('Isolated browser flow: load extension -> import synthetic content -> edit and compare -> export and validate.');
    console.log('Browser plugin not available to the CLI; using the project Playwright harness.');
    console.log('Evidence directory: '+output);
    for(const test of browser.sort()){
      console.log('\nRunning '+test);
      await run([test],{
        DRAFT_HELPER_TEST_OUTPUT:path.join(output,path.basename(test).replace(/\W/g,'-'))});
    }
    console.log('PASS '+browser.length+' browser checks; no external fixtures selected.');
  }else throw Error('Usage: node tools/run-checks.mjs unit|browser');
}catch(error){console.error(error.message);process.exitCode=1;}
