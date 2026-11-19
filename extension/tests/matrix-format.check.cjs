'use strict';
// Integration against real local step-9 packages. No account, upload or publish.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),crypto=require('node:crypto').webcrypto;
const scope=vm.createContext({console,crypto,TextEncoder,File,Map,URL,Set,Uint8Array,atob});
for(const name of ['yidian-contract.js','matrix-cover-contract.js','yidian-format.js','toutiao-format.js','sohu-format.js','layout-core.js','distribution-core.js','distribution-zip.js','matrix-format.js'])vm.runInContext(fs.readFileSync(path.join(root,name),'utf8'),scope,{filename:name});
let source=fs.readFileSync(path.join(root,'popup.js'),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
vm.runInContext(section('function hex(','async function evaluate(')+section('function readBundle(','// Automatic selection')+section('const E3_HEADER_SHA256','function findEditorField'),scope);
async function read(folder){const entries=[];function walk(dir,relative=''){for(const name of fs.readdirSync(dir)){const file=path.join(dir,name),key=relative+name;if(fs.statSync(file).isDirectory())walk(file,key+'/');else entries.push({path:key,file:new File([fs.readFileSync(file)],name)});}}walk(folder);scope.entries=entries;return vm.runInContext('readBundleEntries(entries)',scope);}
(async()=>{for(const folder of process.argv.slice(2)){
 const bundle=await read(folder);scope.bundle=bundle;const targets=bundle.manifest.targetPlatform==='yidian'?['yidian','toutiao']:['sohu'];
 for(const target of targets){scope.target=target;await vm.runInContext('verifyBundle(bundle,target)',scope);const view=await vm.runInContext('DraftMatrixFormat.view(bundle,target)',scope);scope.view=view;await vm.runInContext('verifyBundle(view,target)',scope);
  assert.equal(view.manifest.targetPlatform,target);assert.equal(view.report.processing_log.length>0,true);
  const files=vm.runInContext('DraftDistributionZip.filesFor(view)',scope);assert.equal(await files.get('manifest.json').text(),bundle.manifestText);assert.equal(await files.get('raw-content.txt').text(),bundle.html);
  view.runtimeLog=['测试本地日志'];const exported=vm.runInContext('DraftDistributionZip.filesFor(view)',scope);assert.equal(exported.get('填入运行日志-'+target+'.txt'),'测试本地日志\n');
  scope.meta=[...bundle.assets].filter(([key])=>!key.includes('/')).map(([,file])=>file);scope.images=[...bundle.assets].filter(([key])=>key.startsWith('assets/')).map(([,file])=>file);
  const manual=await vm.runInContext('readBundleIndividualFiles(meta,images)',scope);scope.manual=manual;await vm.runInContext('verifyBundle(manual,target)',scope);
  console.log(JSON.stringify({platform:target,title:view.manifest.title,images:view.manifest.contentImages.length,processingLog:view.report.processing_log.length,policy:view.manifest.distribution.formatPolicy,checks:['source-first verifier','formatted-view verifier','complete ZIP','platform runtime log','individual-file picker']}));
 }
}})().catch(error=>{console.error(error);process.exitCode=1});
