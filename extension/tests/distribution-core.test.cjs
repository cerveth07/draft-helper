'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {createHash,webcrypto}=require('node:crypto');
const D=require('../distribution-core.js');
if(!globalThis.crypto?.subtle)globalThis.crypto=webcrypto;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const bufferFile=buf=>({size:buf.length,arrayBuffer:async()=>buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.length),
  text:async()=>buf.toString('utf8')});
const sampleBytes=Buffer.from([0x89,80,78,71,13,10,26,10,1,2,3,4]);
const title='这是一篇用于跨平台分发系统测试的长文章标题我们需要明确检测三十字长度以避免误截断';
function fixture(opts={}){
  const repeat=opts.repeat??false;
  const html=(opts.background?'<section style="background-image:url(&quot;WECHATIMGPH_1_END&quot;);color:#333"><p>背景素材容器</p></section>':'')
    +'<p>第一部分</p><img src="WECHATIMGPH_1_END"><p>第二部分</p>'
    +(repeat?'<img src="WECHATIMGPH_1_END">':'')+'<p>结尾</p>';
  const item={placeholder:'WECHATIMGPH_1_END',bundleFile:'001.png',
    bytes:sampleBytes.length,sha256:hash(sampleBytes)};
  const manifest={bundleContractVersion:1,targetPlatform:'wechat',title,
    author:'测试作者',summary:'测试摘要',issueDate:'2026-10-27',contentImages:[item],coverImage:opts.cover
      ?{bundleFile:'cover.png',bytes:sampleBytes.length,sha256:hash(sampleBytes)}:null};
  const manifestText=JSON.stringify(manifest,null,2)+'\n';
  const report={state:'PREPARED',bundle_contract_version:1,remote_image_count:0,
    payload_sha256:hash(html),manifest_sha256:hash(manifestText)};
  const assets=new Map([['assets/001.png',bufferFile(sampleBytes)]]);
  if(opts.cover)assets.set('assets/cover.png',bufferFile(sampleBytes));
  return {html,manifest,manifestText,report,assets};
}
async function targetBundle(source,platform='yidian',options={}){
  const bundle=await D.prepare(source,platform,options);
  bundle.assets.set('source-wechat.json',bufferFile(Buffer.from(bundle.sourceProofText)));
  return bundle;
}
test('generic conversion preserves text and order and expands duplicate image usages',async()=>{
  const source=fixture({repeat:true,cover:true});
  const pack=await targetBundle(source,'yidian');
  assert.equal(pack.manifest.contentImages.length,2);
  assert.equal(pack.manifest.contentImages[0].bundleFile,'001.png');
  assert.equal(pack.manifest.contentImages[1].bundleFile,'001.png');
  assert.equal(pack.manifest.contentImages[0].placeholder,'WECHATIMGPH_1_END');
  assert.equal(pack.manifest.contentImages[1].placeholder,'WECHATIMGPH_2_END');
  assert.equal(pack.manifest.title,title);
  assert.equal(pack.manifest.platformCovers.yidian.bundleFile,'cover.png');
  assert.equal(pack.report.delivery_state,'NOT_UPLOADED_OR_SAVED');
  assert.equal(await D.verify(pack,'yidian'),true);
  assert.equal(source.html.includes('WECHATIMGPH_2_END'),false,'source unchanged');
});
test('optional cover leaves no null platformCover entry for popup verifier',async()=>{
  const bundle=await targetBundle(fixture(),'penguin');
  assert.equal(bundle.manifest.coverImage,null);
  assert.deepEqual(bundle.manifest.platformCovers,{});
  assert.equal(await D.verify(bundle,'penguin'),true);
});
test('profiles differ per target and are recorded in the package',async()=>{
  assert.equal(D.profileFor('wechat').id,'wechat-head');
  assert.equal(D.profileFor('wechat','sub').id,'wechat-sub');
  assert.equal(D.profileFor('wechat').cover.ratio,'2.35:1');
  assert.equal(D.profileFor('wechat').cover.auto,'first-body-image');
  assert.equal(D.profileFor('wechat','sub').cover.auto,'none');
  const bundle=await targetBundle(fixture(),'toutiao',{title:'这是短标题'});
  assert.equal(bundle.manifest.profile.id,'toutiao');
  assert.equal(bundle.manifest.profileSpec.id,'toutiao');
  assert.equal(bundle.manifest.profileSpec.summary.mode,'not-used');
  assert.equal(bundle.manifest.profileSpec.author.mode,'not-used');
  assert.equal(bundle.report.profile_id,'toutiao');
  assert.ok(bundle.report.profile_checks.some(check=>check.rule==='summary'&&check.state==='not-used'));
  assert.equal(await D.verify(bundle,'toutiao'),true);
  const mismatched={...bundle,manifest:{...bundle.manifest,profile:{id:'sohu',version:1}}};
  await assert.rejects(D.verify(mismatched,'toutiao'),/目标配置与平台不一致/);
  const sohu=await targetBundle(fixture(),'sohu');
  assert.equal(sohu.manifest.profileSpec.summary.mode,'carry');
  assert.notEqual(sohu.manifest.profileSpec.title.max,bundle.manifest.profileSpec.title.max);
  const wechat=D.profileSpecOf(D.profileFor('wechat','sub'));
  assert.equal(wechat.title.max,64);
  assert.equal(wechat.cover.required,false);
});
test('CLI honors the sub-article profile and skips the automatic cover',()=>{
  const root=path.resolve(__dirname,'../..');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'draft-cli-profile-'));
  const png=Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,1,2,3,4]);
  fs.writeFileSync(path.join(dir,'photo.png'),png);
  const input=path.join(dir,'article.html');
  fs.writeFileSync(input,'<p>次条稿件。</p><img src="photo.png">');
  const subOut=path.join(dir,'sub'),headOut=path.join(dir,'head');
  const sub=spawnSync(process.execPath,[path.join(root,'prepare.mjs'),'--html',input,'--title','次条测试','--profile','wechat-sub','--out-dir',subOut],{encoding:'utf8'});
  assert.equal(sub.status,0,sub.stderr);
  const subManifest=JSON.parse(fs.readFileSync(path.join(subOut,'manifest.json')));
  assert.equal(subManifest.profile.id,'wechat-sub');
  assert.equal(subManifest.profileSpec.cover.auto,'none');
  assert.equal(subManifest.coverImage,null);
  assert.equal(JSON.parse(fs.readFileSync(path.join(subOut,'preparation-report.json'))).profile_id,'wechat-sub');
  const head=spawnSync(process.execPath,[path.join(root,'prepare.mjs'),'--html',input,'--title','头条测试','--out-dir',headOut],{encoding:'utf8'});
  assert.equal(head.status,0,head.stderr);
  const headManifest=JSON.parse(fs.readFileSync(path.join(headOut,'manifest.json')));
  assert.equal(headManifest.profile.id,'wechat-head');
  assert.equal(headManifest.coverImage.bundleFile,'cover.png');
  const checked=spawnSync(process.execPath,[path.join(root,'verify.mjs'),subOut],{encoding:'utf8'});
  assert.equal(checked.status,0,checked.stdout);
});
test('oversized images are flagged before upload for platforms with limits',()=>{
  const yidian=D.profileFor('yidian');
  assert.equal(yidian.upload.maxBytes,6*1024*1024);
  const manifest={contentImages:[{bundleFile:'001.jpg',bytes:1024},
    {bundleFile:'002.jpg',bytes:6*1024*1024+1}],coverImage:{bundleFile:'cover.jpg',bytes:7*1024*1024}};
  assert.deepEqual(D.oversizeFor(yidian,manifest),[
    {bundleFile:'002.jpg',bytes:6*1024*1024+1},{bundleFile:'cover.jpg',bytes:7*1024*1024}]);
  assert.deepEqual(D.oversizeFor(D.profileFor('sohu'),manifest),[]);
  const checks=D.profileChecks(yidian,{title:'一二三四五',summary:'摘要',author:'',
    coverImage:null,images:manifest.contentImages});
  const upload=checks.find(check=>check.rule==='upload');
  assert.equal(upload.state,'warn');
  assert.match(upload.detail,/6\.0MB/);
  assert.match(upload.detail,/002\.jpg/);
  const ok=D.profileChecks(yidian,{title:'一二三四五',summary:'摘要',author:'',
    coverImage:null,images:[{bundleFile:'001.jpg',bytes:1024}]}).find(check=>check.rule==='upload');
  assert.equal(ok.state,'pass');
});
test('per-article image count is checked against the platform rule',()=>{
  const yidian=D.profileFor('yidian');
  assert.equal(yidian.upload.maxImages,80);
  const images=count=>Array.from({length:count},(_,index)=>({bundleFile:String(index).padStart(3,'0')+'.jpg',bytes:1024}));
  const over=D.profileChecks(yidian,{title:'一二三四五',summary:'摘要',author:'',coverImage:null,images:images(81)})
    .find(check=>check.rule==='upload-count');
  assert.equal(over.state,'warn');
  assert.match(over.detail,/81 张图/);
  assert.match(over.detail,/80/);
  const within=D.profileChecks(yidian,{title:'一二三四五',summary:'摘要',author:'',coverImage:null,images:images(39)})
    .find(check=>check.rule==='upload-count');
  assert.equal(within.state,'pass');
  assert.match(within.detail,/39 张图/);
});
test('target title rules are independent; never silently crop',async()=>{
  const source=fixture();
  await assert.rejects(D.prepare(source,'toutiao'),/2–30/);
  await assert.rejects(D.prepare(source,'penguin',{title:'短'}),/5–64/);
  const result=await targetBundle(source,'toutiao',{title:'这是短标题'});
  assert.equal(result.manifest.title,'这是短标题');
  assert.equal(await D.verify(result,'toutiao'),true);
});
test('source and converted proof tampering must fail before upload',async()=>{
  const original=fixture();
  const changed={...original,html:original.html.replace('第一部分','假内容')};
  await assert.rejects(D.prepare(changed,'sohu'),/SHA-256/);
  const prepared=await targetBundle(original,'sohu');
  await assert.rejects(D.verify({...prepared,html:prepared.html+'伪造'},'sohu'),/正文或清单/);
  const swapped=new Map(prepared.assets);
  swapped.set('assets/001.png',bufferFile(Buffer.from('modified')));
  await assert.rejects(D.verify({...prepared,assets:swapped},'sohu'),/素材缺失或被修改/);
  const badProof=new Map(prepared.assets);
  badProof.set('source-wechat.json',bufferFile(Buffer.from('{}')));
  await assert.rejects(D.verify({...prepared,assets:badProof},'sohu'),/来源证明/);
  await assert.rejects(D.verify(prepared,'penguin'),/平台或版本/);
});
test('background image becomes an ordered inline image without changing source HTML',async()=>{
  const source=fixture({background:true});
  const original=source.html;
  const prepared=await targetBundle(source,'sohu');
  assert.equal(prepared.backgroundFallbackCount,1);
  assert.equal(prepared.manifest.contentImages.length,2);
  assert.equal(prepared.manifest.distribution.backgroundFallbackCount,1);
  assert.equal(prepared.report.background_image_fallback_count,1);
  assert.match(prepared.html,/<p><img src="WECHATIMGPH_1_END"/);
  assert.match(prepared.html,/<p>背景素材容器<\/p>/);
  assert.equal(prepared.manifest.distribution.formatPolicy,require('../sohu-format.js').VERSION);
  assert.match(prepared.report.warnings.join(' '),/背景图已转成正文图片/);
  assert.equal(await D.verify(prepared,'sohu'),true);
  assert.equal(source.html,original,'source package must not be modified');
});
test('rejects unsupported backgrounds, remote media and active markup',async()=>{
  const src=fixture();
  assert.throws(()=>D.rewrite(src.html+'<section style="mask-image:url(WECHATIMGPH_1_END)">X</section>',
    src.manifest.contentImages),/非背景样式/);
  assert.throws(()=>D.rewrite(src.html+'<section style="background-image:url(&quot;https://bad.example/pic&quot;)">X</section>',
    src.manifest.contentImages),/无法核验/);
  assert.throws(()=>D.rewrite('<img src="https://example.org/a.jpg">',src.manifest.contentImages),/远程图片/);
  assert.throws(()=>D.rewrite('<script>alert(1)</script><p>ok</p>',[]),/活动标记/);
  assert.throws(()=>D.rewrite('<img src="data:image/png;base64,abcd">',[]),/不在本地准备包/);
  const orphan={...src.manifest.contentImages[0],placeholder:'WECHATIMGPH_UNUSED'};
  assert.throws(()=>D.rewrite(src.html,[...src.manifest.contentImages,orphan]),/未在正文引用/);
});

test('Sohu QR omissions retain original assets and source while recording exact affected positions',async()=>{
  const source=fixture({repeat:true});
  const initial=await targetBundle(source,'sohu');
  const adapted=await D.withSohuOmissions(initial,[{bundleFile:'001.png',reason:'platform-rejected-qrcode'}]);
  assert.equal(adapted.manifest.contentImages.length,0);
  assert.equal(adapted.assets.get('assets/001.png'),source.assets.get('assets/001.png'));
  assert.deepEqual(adapted.report.omitted_images.map(item=>item.position),[1,2]);
  assert.equal(JSON.parse(adapted.sourceProofText).sourceHtml,source.html);
  assert.match(adapted.report.processing_log.map(entry=>entry.detail).join('\n'),/二维码/);
  assert.equal(await D.verify(adapted,'sohu'),true);
  adapted.report.omitted_images[0].reason='unknown';
  await assert.rejects(D.verify(adapted,'sohu'),/省略图片/);
});
test('CLI atomically prepares selected platform folders without touching source',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dh-distribution-test-'));
  try{
    const source=fixture({repeat:true,cover:true,background:true});
    const src=path.join(root,'wechat'),out=path.join(root,'matrix'),titles=path.join(root,'titles.json');
    fs.mkdirSync(path.join(src,'assets'),{recursive:true});
    fs.writeFileSync(path.join(src,'manifest.json'),source.manifestText);
    fs.writeFileSync(path.join(src,'raw-content.txt'),source.html);
    fs.writeFileSync(path.join(src,'preparation-report.json'),JSON.stringify(source.report));
    for(const name of ['001.png','cover.png'])fs.writeFileSync(path.join(src,'assets',name),sampleBytes);
    const run=(extra)=>spawnSync(process.execPath,[path.join(__dirname,'../../distribute.mjs'),
      '--source-dir',src,'--out-dir',out,'--platforms','yidian,toutiao','--layout','preserve',...extra],{encoding:'utf8'});
    let failure=run([]);
    assert.notEqual(failure.status,0);
    assert.equal(fs.existsSync(out),false,'invalid target title must not create output');
    fs.writeFileSync(titles,JSON.stringify({toutiao:'这是已确认短标题'}));
    const success=run(['--titles',titles]);
    assert.equal(success.status,0,success.stderr);
    for(const platform of ['yidian','toutiao']){
      const folder=path.join(out,platform),manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'));
      assert.equal(manifest.targetPlatform,platform);
      assert.equal(manifest.contentImages.length,3);
      assert.equal(manifest.distribution.backgroundFallbackCount,1);
      assert.ok(fs.existsSync(path.join(folder,'assets/cover.png')));
      assert.ok(fs.existsSync(path.join(folder,'source-wechat.json')));
      assert.ok(fs.existsSync(path.join(folder,'preview-article.html')));
    }
    assert.equal(fs.readFileSync(path.join(src,'raw-content.txt'),'utf8'),source.html);
    assert.notEqual(run(['--titles',titles]).status,0,'no overwrite');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('1x1 tracking pixels are dropped instead of stalling platform uploads',async()=>{
  const onePixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==','base64');
  assert.equal(D.imageDimensions(onePixel).width,1);
  assert.equal(D.isSpacerImage(onePixel),true);
  assert.equal(D.isSpacerImage(sampleBytes),false,'unknown headers are not treated as spacers');
  const html='<p>开头</p><img src="WECHATIMGPH_1_END"><p><img src="WECHATIMGPH_2_END"></p><p>结尾</p>';
  const item=(placeholder,bundleFile,buf)=>({placeholder,bundleFile,bytes:buf.length,sha256:hash(buf)});
  const contentImages=[item('WECHATIMGPH_1_END','001.png',sampleBytes),item('WECHATIMGPH_2_END','002.png',onePixel)];
  const manifest={bundleContractVersion:1,targetPlatform:'wechat',title,author:'测试作者',summary:'测试摘要',
    issueDate:'2026-10-27',contentImages,coverImage:null};
  const manifestText=JSON.stringify(manifest,null,2)+'\n';
  const source={html,manifest,manifestText,
    report:{state:'PREPARED',bundle_contract_version:1,remote_image_count:0,
      payload_sha256:hash(html),manifest_sha256:hash(manifestText)},
    assets:new Map([['assets/001.png',bufferFile(sampleBytes)],['assets/002.png',bufferFile(onePixel)]])};
  const pack=await targetBundle(source,'toutiao',{title:'这是短标题'});
  assert.equal(pack.manifest.contentImages.length,1);
  assert.equal(pack.manifest.contentImages[0].placeholder,'WECHATIMGPH_1_END');
  assert.equal(pack.html.includes('WECHATIMGPH_2_END'),false);
  assert.equal(/<img\b[^>]*002\.png/i.test(pack.html),false);
  assert.equal(/<img\b[^>]*$/.test(pack.html),false,'空图所在的空段落被整段删掉');
  assert.equal(await D.verify(pack,'toutiao'),true);
  // 来源包本身不改动：字节和清单都留在原样，其他平台还能各自转换。
  assert.ok(source.html.includes('WECHATIMGPH_2_END'));
});
test('tiny inline decorations are dropped for Toutiao but kept elsewhere',async()=>{
  // 13×13 的星标：尺寸正常（不是 1×1 空图），但显示宽度只有 13px。
  const icon=Buffer.alloc(24);
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(icon,0);
  icon.writeUInt32BE(13,16); icon.writeUInt32BE(13,20);
  assert.equal(D.imageDimensions(icon).width,13);
  assert.equal(D.isSpacerImage(icon),false);
  const html='<p><section style="display: inline-block; width: 13px;"><img src="WECHATIMGPH_1_END" style="vertical-align: middle; max-width: 100%; width: 13px !important; height: auto !important;"></section>'
    +'<section style="display: inline-block;"><span>正文一段。</span></section></p><img src="WECHATIMGPH_2_END">';
  const item=(placeholder,bundleFile)=>({placeholder,bundleFile,bytes:icon.length,sha256:hash(icon)});
  const contentImages=[item('WECHATIMGPH_1_END','001.png'),{placeholder:'WECHATIMGPH_2_END',bundleFile:'002.png',bytes:sampleBytes.length,sha256:hash(sampleBytes)}];
  const manifest={bundleContractVersion:1,targetPlatform:'wechat',title,author:'测试作者',summary:'测试摘要',
    issueDate:'2026-10-27',contentImages,coverImage:null};
  const manifestText=JSON.stringify(manifest,null,2)+'\n';
  const source={html,manifest,manifestText,
    report:{state:'PREPARED',bundle_contract_version:1,remote_image_count:0,
      payload_sha256:hash(html),manifest_sha256:hash(manifestText)},
    assets:new Map([['assets/001.png',bufferFile(icon)],['assets/002.png',bufferFile(sampleBytes)]])};
  const toutiao=await targetBundle(source,'toutiao',{title:'这是短标题'});
  assert.equal(toutiao.manifest.contentImages.length,1,'装饰图被略过');
  assert.equal(toutiao.manifest.contentImages[0].bundleFile,'002.png');
  assert.equal(/<img[^>]*width:\s*13px/i.test(toutiao.html),false,'13px 星标标签已删除');
  assert.equal(/display:\s*inline-block[^>]*>\s*<\/section>/.test(toutiao.html),false,'空壳被清掉');
  assert.equal(toutiao.report.dropped_inline_icon_count,1);
  assert.ok(toutiao.report.warnings.some(text=>/装饰小图/.test(text)));
  assert.equal(await D.verify(toutiao,'toutiao'),true);
  const sohu=await targetBundle(source,'sohu');
  assert.equal(sohu.manifest.contentImages.length,2,'其它平台保留装饰图');
  assert.equal(sohu.report.dropped_inline_icon_count,0);
  assert.equal(await D.verify(sohu,'sohu'),true);
});
