import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {publicFiles} from './public-files.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=publicFiles(root);
const packageInfo=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const manifest=JSON.parse(fs.readFileSync(path.join(root,'extension/manifest.json'),'utf8'));
const fail=message=>{throw Error(message);};
if(packageInfo.version!==manifest.version)fail('Package and extension versions differ');
if(packageInfo.displayVersion&&packageInfo.displayVersion!=='v'+manifest.version_name)fail('Public version and extension version_name differ');
if(JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8')).version!==packageInfo.version)fail('Lockfile version differs');
if(packageInfo.license!=='MIT')fail('Expected the selected MIT license');
if(manifest.key||manifest.oauth2||manifest.update_url)fail('Review extension identity or remote-update configuration before release');
if(!fs.readFileSync(path.join(root,'LICENSE'),'utf8').startsWith('MIT License\n'))fail('Missing MIT license text');
const secrets=[
  {name:'private key',pattern:new RegExp('-{5}BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-{5}')},
  {name:'API credential',pattern:new RegExp('s'+'k-[a-zA-Z0-9_-]{24,}')},
  {name:'GitHub credential',pattern:new RegExp('g'+'h[pousr]_[a-zA-Z0-9]{24,}')},
  {name:'GitHub fine-grained credential',pattern:new RegExp('github'+'_pat_[a-zA-Z0-9_]{40,}')},
  {name:'personal Windows path',pattern:/\b[A-Z]:[\\/](?:Users|DSH WORKAREA|Codex)[\\/]/i},
];
let scripts=0;
for(const name of files){
  if(name.endsWith('.png'))continue;
  const bytes=fs.readFileSync(path.join(root,name));
  if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf)fail('UTF-8 BOM in '+name);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  for(const {name:kind,pattern} of secrets)if(pattern.test(text))fail(kind+' candidate in '+name+'; review locally without printing the value');
  if(/\.(js|cjs|mjs)$/.test(name)){
    const result=spawnSync(process.execPath,['--check',path.join(root,name)],{encoding:'utf8'});
    if(result.status!==0)fail('Syntax check failed for '+name+'\n'+result.stderr);
    scripts++;
  }
  if(/\.html$/.test(name)){
    for(const match of text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/g)){
      const reference=match[1];
      if(/^(?:[a-z]+:|#|\/\/)/i.test(reference))continue;
      if(!fs.existsSync(path.resolve(root,path.dirname(name),decodeURIComponent(reference.split(/[?#]/)[0]))))fail('Missing HTML asset '+reference+' in '+name);
    }
  }
  if(/\.md$/.test(name)){
    for(const match of text.matchAll(/\]\(([^)]+)\)/g)){
      const reference=match[1].replace(/^<|>$/g,'').split('#')[0];
      if(!reference||/^[a-z]+:/i.test(reference)||reference.startsWith('//'))continue;
      if(!fs.existsSync(path.resolve(root,path.dirname(name),decodeURIComponent(reference))))fail('Missing documentation link '+reference+' in '+name);
    }
  }
}
if(!fs.existsSync(path.join(root,'extension',manifest.action.default_popup)))fail('Missing extension popup');
console.log('PASS public inputs: '+files.length+' files; '+scripts+' JavaScript syntax checks; version '+manifest.version+'; local links and credential-pattern scan');
