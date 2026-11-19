#!/usr/bin/env node
/**
 * Convert one verified SyncPress package into platform-specific,
 * locally verifiable folders. Offline only; does not log in, save or publish.
 *
 * 源包可以是微信包，也可以是任一平台包（一点号/今日头条/企鹅号/搜狐号）：
 * 平台包内自带 source-wechat.json，会先还原成微信原稿再转换。
 *
 * node distribute.mjs --source-dir out/wechat --out-dir out/matrix \
 *   --platforms yidian,toutiao,penguin,sohu --titles titles.json
 * node distribute.mjs --source-dir out/yidian --out-dir out/sohu --platforms sohu
 */
import fs from 'node:fs';
import path from 'node:path';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const D=require('./extension/distribution-core.js');
const L=require('./extension/layout-core.js');
const Z=require('./extension/distribution-zip.js');
import {renderLayout} from './tools/layout-render-node.mjs';
if(!globalThis.crypto?.subtle)globalThis.crypto=webcrypto;

function argsOf(argv){
  const options={};
  for(let i=0;i<argv.length;i++){
    if(!/^--(?:source-dir|out-dir|platforms|titles|summaries|issue-date|layout|layout-width)$/.test(argv[i])||!argv[i+1]
        ||argv[i+1].startsWith('--'))throw Error('不支持的参数或缺少取值：'+argv[i]);
    options[argv[i].slice(2)]=argv[++i];
  }
  if(!options['source-dir']||!options['out-dir'])throw Error('需要 --source-dir 和 --out-dir');
  return options;
}
function safeRead(file,max=50*1024*1024){
  const stat=fs.lstatSync(file);
  if(!stat.isFile()||stat.size>max)throw Error('需要普通文件且不得超过读取上限：'+file);
  return fs.readFileSync(file);
}
const asFile=(buffer)=>({
  size:buffer.length,text:async()=>buffer.toString('utf8'),
  arrayBuffer:async()=>buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength)
});
const sha256Hex = async (buffer) =>
  Buffer.from(await crypto.subtle.digest('SHA-256', buffer)).toString('hex');

async function readSource(folder){
  const root=path.resolve(folder);
  const text=name=>safeRead(path.join(root,name)).toString('utf8');
  let manifestText=text('manifest.json'),manifest=JSON.parse(manifestText);
  let report=JSON.parse(text('preparation-report.json'));
  let html=text('raw-content.txt');
  // 平台包（一点号/头条/企鹅/搜狐）里带有 source-wechat.json：按它还原微信原稿，
  // 就能从任意平台包再转出其它平台的包，不必回头找最初的微信准备包。
  const sourcePlatform=manifest.targetPlatform||'wechat';
  if(sourcePlatform!=='wechat'){
    let proof;
    try{proof=JSON.parse(text('source-wechat.json'));}
    catch(_){throw Error('来源包不是微信包，且缺少可读取的 source-wechat.json，无法转换。');}
    if(proof.schema!==D.CONTRACT||typeof proof.sourceHtml!=='string'
        ||typeof proof.sourceManifestText!=='string')
      throw Error('source-wechat.json 结构不完整，无法还原微信原稿。');
    if(await sha256Hex(Buffer.from(proof.sourceHtml,'utf8'))!==proof.sourcePayloadSha256
        ||await sha256Hex(Buffer.from(proof.sourceManifestText,'utf8'))!==proof.sourceManifestSha256)
      throw Error('source-wechat.json 的来源校验不通过，拒绝基于被改动的包转换。');
    html=proof.sourceHtml;
    manifestText=proof.sourceManifestText;
    manifest=JSON.parse(manifestText);
    report={bundle_contract_version:1,state:'PREPARED',remote_image_count:0,
      payload_sha256:proof.sourcePayloadSha256,manifest_sha256:proof.sourceManifestSha256};
    console.error('来源包是 '+sourcePlatform+' 包，已按 source-wechat.json 还原微信原稿。');
  }
  const assets=new Map(),items=[...(manifest.contentImages||[]),...(manifest.coverImage?[manifest.coverImage]:[])];
  for(const item of items){
    if(typeof item.bundleFile!=='string'||!item.bundleFile||item.bundleFile==='.'
        ||item.bundleFile==='..'||/[\/\\\x00-\x1f\x7f]/.test(item.bundleFile))
      throw Error('来源素材路径不安全。');
    const key='assets/'+item.bundleFile;
    if(!assets.has(key))assets.set(key,asFile(safeRead(path.join(root,'assets',item.bundleFile),32*1024*1024)));
  }
  return {html,manifest,manifestText,report,assets};
}
function escape(text){return String(text).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function usageText(profile){
  const summaryLine={auto:'留空时自动取正文前 100 字，不超过 120 字；随包携带',
    carry:'随包携带来源摘要；平台摘要字段待实页验收',
    'not-used':'平台无摘要字段，摘要仅随包保留供人工参考',
    optional:'导语可选，最多 '+profile.summary.max+' 字；留空不填写，不自动截断'}[profile.summary.mode]||'随包携带';
  const authorLine={optional:'可选，随包携带',carry:'随包携带',
    'not-used':'平台作者为账号本身，不单独填写'}[profile.author.mode]||'随包携带';
  const cover=profile.cover;
  const coverLine=(cover.required?'必需':'可选')
    +(cover.ratio?'，建议 '+cover.ratio+(cover.recommended?'（'+cover.recommended+'）':''):'')
    +'。'+cover.note;
  return 'SyncPress '+profile.label+'准备包（配置档 '+profile.id+'）\n'
    +'- 标题：'+profile.title.min+'–'+profile.title.max+' 字，已按本平台单独核对，不自动截断\n'
    +'- 摘要：'+summaryLine+'\n'
    +'- 作者：'+authorLine+'\n'
    +'- 封面：'+coverLine+'\n'
    +'- 正文：保留微信原稿结构与图片顺序；'+profile.notes.join(' ')+'\n'
    +'请在已登录的空白文章编辑页，通过扩展选择完整目录，核对后手动保存。\n'
    +'本地准备包不代表已经填入、保存或发布；源 HTML 未做平台语义改写。\n';
}
function preview(bundle){
  return Z.preview(bundle);
}
async function main(){
  const args=argsOf(process.argv.slice(2));
  const platforms=(args.platforms||'yidian,toutiao,penguin,sohu').split(',').map(s=>s.trim());
  if(platforms.some(p=>!D.PLATFORMS[p])||new Set(platforms).size!==platforms.length)
    throw Error('平台列表应为 '+Object.keys(D.PLATFORMS).join(',')+' 的不重复子集。');
  const titles=args.titles?JSON.parse(safeRead(path.resolve(args.titles),1024*1024).toString('utf8')):{};
  if(!titles||typeof titles!=='object'||Array.isArray(titles)
      ||Object.keys(titles).some(key=>!D.PLATFORMS[key]||typeof titles[key]!=='string'))
    throw Error('标题文件格式为 {"toutiao":"标题"}，只允许已支持的平台。');
  const summaries=args.summaries?JSON.parse(safeRead(path.resolve(args.summaries),1024*1024).toString('utf8')):{};
  if(!summaries||typeof summaries!=='object'||Array.isArray(summaries)
      ||Object.keys(summaries).some(key=>key!=='weibo'||typeof summaries[key]!=='string'))
    throw Error('导语文件格式为 {"weibo":"导语或空字符串"}。');
  const source=await readSource(args['source-dir']);
  const out=path.resolve(args['out-dir']);
  if(fs.existsSync(out))throw Error('目标目录已存在，不覆盖现有准备包：'+out);
  const builds=[];
  // Preflight before opening a renderer, and render once for all destination platforms.
  for(const platform of platforms){
    D.platformRules(platform,titles[platform]??source.manifest.title);
    D.platformSummary(platform,summaries[platform]??source.manifest.summary);
  }
  await D.verifySource(source,platforms[0]);
  const layouts=new Map();
  // Validate all targets and source assets before creating output.
  for(const platform of platforms){
    const layoutKey=['sohu','toutiao','yidian'].includes(platform)?platform:'default';
    if(!layouts.has(layoutKey))layouts.set(layoutKey,await L.prepare(source,renderLayout,{mode:args.layout||'auto',platform,
      width:args['layout-width']?Number(args['layout-width']):677,onProgress:message=>console.error(message)}));
    const preparedLayout=layouts.get(layoutKey);
    const bundle=await D.prepare(source,platform,{title:titles[platform],summary:summaries[platform],issueDate:args['issue-date'],
      layout:preparedLayout.plan,layoutAssets:preparedLayout.assets});
    const textFile=asFile(Buffer.from(bundle.sourceProofText));
    bundle.assets.set('source-wechat.json',textFile);
    await D.verify({...bundle,assets:bundle.assets},platform);
    builds.push({platform,bundle});
  }
  fs.mkdirSync(path.dirname(out),{recursive:true});
  const staging=fs.mkdtempSync(path.join(path.dirname(out),'.draft-distribution-'));
  try{
    for(const {platform,bundle} of builds){
      const dir=path.join(staging,platform);
      fs.mkdirSync(dir);
      fs.mkdirSync(path.join(dir,'assets'));
      for(const [name,value] of [
        ['manifest.json',bundle.manifestText],['raw-content.txt',bundle.html],
        ['preparation-report.json',JSON.stringify(bundle.report,null,2)+'\n'],
        ['source-wechat.json',bundle.sourceProofText],
        ['title.txt',bundle.manifest.title+'\n'],['preview-article.html',preview(bundle)],
        ['分发处理日志.txt',Z.processingText(bundle)],
        ['使用说明.txt',usageText(D.profileFor(platform))+L.notes(JSON.parse(bundle.sourceProofText).layout).join('\n')+'\n']
      ])fs.writeFileSync(path.join(dir,name),value,'utf8');
      for(const [name,file] of bundle.assets){
        if(!name.startsWith('assets/'))continue;
        const data=Buffer.from(await file.arrayBuffer());
        fs.writeFileSync(path.join(dir,name),data);
      }
    }
    if(fs.existsSync(out))throw Error('写入时目标目录已出现，已停止覆盖。');
    fs.renameSync(staging,out);
  } finally {fs.rmSync(staging,{recursive:true,force:true});}
  console.log(JSON.stringify({state:'PREPARED',saved_to_platform:false,directory:out,
    platforms:builds.map(({platform,bundle})=>({platform,profile:bundle.manifest.profile.id,title:bundle.manifest.title,
      images:bundle.manifest.contentImages.length,layoutBlocks:bundle.report.layout_blocks?.length||0,warnings:bundle.report.warnings}))},null,2));
}
main().catch(err=>{console.error('分发准备失败：'+err.message);process.exitCode=1;});
