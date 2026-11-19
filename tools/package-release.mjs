import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {publicFiles,extensionFiles} from './public-files.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const Z=require('../extension/distribution-zip.js');
const args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--out-dir'))throw Error('Usage: node tools/package-release.mjs [--out-dir directory]');
const output=path.resolve(args[1]||path.join(root,'dist'));
const check=spawnSync(process.execPath,[path.join(root,'tools/check-source.mjs')],{stdio:'inherit'});
if(check.status!==0)throw Error('Public-source check failed; release not written');
const info=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const release=info.displayVersion||'v'+info.version;
const source=new Map(publicFiles(root).map(name=>['draft-helper/'+name,fs.readFileSync(path.join(root,name))]));
const extension=new Map(extensionFiles(root).map(name=>[name.slice('extension/'.length),fs.readFileSync(path.join(root,name))]));
for(const name of ['LICENSE','PRIVACY.md'])extension.set(name,fs.readFileSync(path.join(root,name)));
extension.set('THIRD_PARTY_NOTICES.md',fs.readFileSync(path.join(root,'THIRD_PARTY_NOTICES.md'),'utf8')
  .replaceAll('extension/vendor/','vendor/'));
extension.set('SECURITY.md',fs.readFileSync(path.join(root,'SECURITY.md')));
extension.set('README.md','# SyncPress '+release+'\n\n解压本包，在 Chrome / Edge 扩展管理页开启开发者模式，加载含 manifest.json 的整个目录。点击扩展图标打开排版工作台。\n\n本包不需要安装 Node.js 或依赖。完整源码、开发文档和测试请使用对应的源码包。\n\n许可见 LICENSE；权限和本机数据说明见 PRIVACY.md；第三方声明见 THIRD_PARTY_NOTICES.md。\n');
fs.mkdirSync(output,{recursive:true});
const results=[];
for(const [kind,files]of [['source',source],['extension',extension]]){
  const name='syncpress-'+release+'-'+kind+'.zip';
  const bytes=Buffer.from(await (await Z.pack(files)).arrayBuffer());
  fs.writeFileSync(path.join(output,name),bytes);
  results.push({file:name,files:files.size,bytes:bytes.length});
}
console.log(JSON.stringify({version:info.version,output,artifacts:results},null,2));
