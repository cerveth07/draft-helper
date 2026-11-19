'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createHash}=require('node:crypto'),{spawnSync}=require('node:child_process');
const D=require('../distribution-core.js');
const root=path.resolve(__dirname,'../..');
const hash=value=>createHash('sha256').update(value).digest('hex');
const file=bytes=>({size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length),text:async()=>bytes.toString()});
function source(summary='微信摘要') {
  const bytes=Buffer.alloc(24);bytes.set([137,80,78,71]);bytes.writeUInt32BE(20,16);bytes.writeUInt32BE(20,20);
  const item={placeholder:'WECHATIMGPH_1_END',bundleFile:'001.png',bytes:bytes.length,sha256:hash(bytes)};
  const html='<p>开头文字</p><img src="WECHATIMGPH_1_END"><p>结尾文字</p>';
  const manifest={bundleContractVersion:1,targetPlatform:'wechat',title:'测试微博头条文章',summary,
    author:'测试作者',contentImages:[item],coverImage:null};
  const manifestText=JSON.stringify(manifest);
  return {html,manifest,manifestText,report:{state:'PREPARED',bundle_contract_version:1,remote_image_count:0,
    payload_sha256:hash(html),manifest_sha256:hash(manifestText)},assets:new Map([['assets/001.png',file(bytes)]])};
}
async function bundle(options={},summary) {
  const original=source(summary),result=await D.prepare(original,'weibo',options);
  result.assets.set('source-wechat.json',file(Buffer.from(result.sourceProofText)));
  return {original,result};
}
test('Weibo package retains source, image order and independent lead text',async()=>{
  const {original,result}=await bundle({title:'独立微博标题',summary:'独立微博导语'});
  assert.equal(result.manifest.targetPlatform,'weibo');
  assert.equal(result.manifest.summary,'独立微博导语');
  assert.equal(original.manifest.summary,'微信摘要');
  assert.equal(result.html,original.html);
  assert.deepEqual(result.manifest.contentImages,original.manifest.contentImages);
  assert.equal(result.manifest.profileSpec.title.max,32);
  assert.equal(result.report.delivery_state,'NOT_UPLOADED_OR_SAVED');
  assert.equal(await D.verify(result,'weibo'),true);
});
test('Weibo limits use Unicode characters and never silently truncate',async()=>{
  assert.equal(D.platformRules('weibo','😀'.repeat(32)),'😀'.repeat(32));
  assert.throws(()=>D.platformRules('weibo','字'.repeat(33)),/32/);
  await assert.rejects(bundle({},'摘'.repeat(45)),/导语最多 44 字/);
  const {result}=await bundle({summary:''},'摘'.repeat(100));
  assert.equal(result.manifest.summary,'');
  assert.equal(await D.verify(result,'weibo'),true);
  result.manifest.summary='字'.repeat(45);
  await assert.rejects(D.verify(result,'weibo'),/导语最多 44 字/);
});
test('Weibo compacts captured CSS after layout rendering and verifies the exact result',async()=>{
  const original=source('');
  original.html='<section class="wechat" data-id="source" style="font-family:Arial;display:block;color:rgb(51, 51, 51);font-size:17px">'
    +'<p style="font-family:Arial;display:block;color:rgb(51, 51, 51);font-size:17px">保留<strong>粗体</strong>'
    +'<span style="font-weight:400;color:rgb(0, 112, 192);background-color:rgba(0,0,0,0);position:static">蓝字</span>'
    +'<a href="https://example.com/?a=1&amp;b=2" data-source="wechat">链接</a></p>'
    +'<img src="WECHATIMGPH_1_END" data-ratio="1" style="display:inline-block;width:100%;height:auto;font-family:Arial">'
    +'<p>末尾 &lt;文本&gt;</p></section>';
  original.report.payload_sha256=hash(original.html);
  const result=await D.prepare(original,'weibo',{summary:''});
  result.assets.set('source-wechat.json',file(Buffer.from(result.sourceProofText)));
  assert.ok(result.html.length<original.html.length*.6);
  assert.doesNotMatch(result.html,/font-family|position|background-color|data-id|data-ratio|class=/);
  assert.match(result.html,/color:#0070c0/);
  assert.match(result.html,/<strong>粗体<\/strong>/);
  assert.match(result.html,/href="https:\/\/example.com\/\?a=1&amp;b=2"/);
  assert.match(result.html,/末尾 &lt;文本&gt;/);
  assert.equal(D.compactWeiboHtml(result.html),result.html);
  assert.deepEqual(result.manifest.contentImages,original.manifest.contentImages);
  assert.equal(JSON.parse(result.sourceProofText).sourceHtml,original.html);
  assert.equal(await D.verify(result,'weibo'),true);
  result.manifest.distribution.markupPolicy='unknown';
  result.manifestText=JSON.stringify(result.manifest);result.report.manifest_sha256=hash(result.manifestText);
  await assert.rejects(D.verify(result,'weibo'),/精简策略/);
});
test('Weibo keeps empty SVG placeholders recognizable while Sohu uses its native-format policy',async()=>{
  const svg='<svg style="width:0px;height:0px" width="0" height="0"></svg>';
  assert.equal(D.compactWeiboHtml(svg),svg);
  const original=source('');original.html='<p style="font-family:Arial;color:red">文字</p><img src="WECHATIMGPH_1_END">';
  original.report.payload_sha256=hash(original.html);
  const sohu=await D.prepare(original,'sohu');
  assert.equal(sohu.manifest.distribution.markupPolicy,undefined);
  assert.equal(sohu.manifest.distribution.formatPolicy,require('../sohu-format.js').VERSION);
  assert.match(sohu.html,/<p>文字<\/p>/);
  assert.doesNotMatch(sohu.html,/font-family:Arial/);
  assert.equal(JSON.parse(sohu.sourceProofText).sourceHtml,original.html);
  assert.equal(original.html,'<p style="font-family:Arial;color:red">文字</p><img src="WECHATIMGPH_1_END">');
});
test('Weibo command line writes a portable package with an explicit lead override',async()=>{
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'draft-weibo-cli-'));
  const original=source('微信来源摘要'.repeat(15)),input=path.join(tmp,'source');fs.mkdirSync(path.join(input,'assets'),{recursive:true});
  fs.writeFileSync(path.join(input,'manifest.json'),original.manifestText);
  fs.writeFileSync(path.join(input,'raw-content.txt'),original.html);
  fs.writeFileSync(path.join(input,'preparation-report.json'),JSON.stringify(original.report));
  fs.writeFileSync(path.join(input,'assets/001.png'),Buffer.from(await original.assets.get('assets/001.png').arrayBuffer()));
  const summaries=path.join(tmp,'summaries.json');fs.writeFileSync(summaries,JSON.stringify({weibo:'CLI 独立导语'}));
  const output=path.join(tmp,'output');
  const done=spawnSync(process.execPath,[path.join(root,'distribute.mjs'),'--source-dir',input,'--out-dir',output,
    '--platforms','weibo','--summaries',summaries],{encoding:'utf8'});
  assert.equal(done.status,0,done.stderr);
  const manifest=JSON.parse(fs.readFileSync(path.join(output,'weibo/manifest.json')));
  assert.equal(manifest.summary,'CLI 独立导语');
  for(const name of ['source-wechat.json','preparation-report.json','preview-article.html','assets/001.png'])
    assert.ok(fs.existsSync(path.join(output,'weibo',name)),name);
  const rebase=spawnSync(process.execPath,[path.join(root,'distribute.mjs'),'--source-dir',path.join(output,'weibo'),
    '--out-dir',path.join(tmp,'sohu'),'--platforms','sohu'],{encoding:'utf8'});
  assert.equal(rebase.status,0,rebase.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp,'sohu/sohu/manifest.json'))).summary,original.manifest.summary);
});
test('Weibo refuses nonempty editors and releases the debugger before any paste',async()=>{
  const events=[],context=vm.createContext({DraftDistribution:D,status:()=>{},
    attachDebugger:async()=>events.push('attach'),chrome:{debugger:{sendCommand:async()=>{},detach:async()=>events.push('detach')}},
    evaluate:async()=>({text:'已有内容',mediaCount:0}),pause:async()=>{}});
  vm.runInContext(fs.readFileSync(path.join(root,'extension/weibo.js'),'utf8'),context);
  const {result}=await bundle();
  await assert.rejects(context.fillWeiboDraft(7,result),/正文已有内容/);
  assert.deepEqual(events,['attach','detach']);
});
test('Weibo editor URLs are limited to article editor routes',()=>{
  const text=fs.readFileSync(path.join(root,'extension/popup.js'),'utf8');
  const start=text.indexOf('function identifyDraftPlatform(address) {'),end=text.indexOf('function platformName(platform) {',start);
  const identify=vm.runInNewContext(text.slice(start,end)+'\nidentifyDraftPlatform',{URL});
  for(const url of ['https://card.weibo.com/article/v5/editor#/draft/1','https://card.weibo.com/article/v3/editor'])
    assert.equal(identify(url),'weibo');
  for(const url of ['https://card.weibo.com/article/v5/reader','https://weibo.com/','https://card.weibo.com.evil.test/article/v5/editor'])
    assert.throws(()=>identify(url),/不是已支持的平台/);
});
