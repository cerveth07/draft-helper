'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../layout-core.js'),D=require('../distribution-core.js');
const {hash,asFile,png,source}=require('./layout-fixtures.cjs');

test('source offsets handle quoted angle brackets, comments and raw style text',()=>{
  const html='<section title="a > b"><!-- <img> --><style>p:before{content:"<tag>"}</style><p>正文</p><img src="x"></section>';
  const tree=L.parse(html);
  assert.equal(tree.nodes.length,4);
  assert.equal(html.slice(tree.nodes[0].start,tree.nodes[0].end),html);
  assert.equal(tree.nodes[2].tag,'p');
  assert.ok(L.instrument(html).html.includes('data-draft-layout-node="4"'));
  assert.throws(()=>L.parse('<section><p>wrong</section>'),/错位|闭合/);
});
test('ordinary prose never invokes the renderer; preserve mode is explicit and reports risk',async()=>{
  const plain=source('<p>普通文字。</p><img src="WECHATIMGPH_1_END">');
  const result=await L.prepare(plain,()=>{throw Error('must not render');});
  assert.deepEqual(result.plan.blocks,[]);
  const legacy=await L.prepare(source(),null,{mode:'preserve'});
  assert.match(L.notes(legacy.plan)[0],/可能拆散/);
  await assert.rejects(L.prepare(source()),/需要本机 Chrome/);
});
test('raster plan preserves surrounding prose, source proof and clickable links, and verifies',async()=>{
  const original=source();
  const group=L.parse(original.html).nodes.find(n=>n.tag==='div');
  const prepared=await L.prepare(original,async()=>[{start:group.start,end:group.end,reasons:['columns'],text:'图内说明',links:[{href:'https://example.com/article?x=1&y=2',text:'查看来源'}],width:60,height:40,bytes:png(220,20,30)}]);
  const result=await D.prepare(original,'sohu',{layout:prepared.plan,layoutAssets:prepared.assets});
  result.assets.set('source-wechat.json',asFile(Buffer.from(result.sourceProofText)));
  assert.equal(await D.verify(result,'sohu'),true);
  assert.match(result.html,/开头可编辑文字/);assert.match(result.html,/结尾可编辑文字/);
  assert.match(result.html,/href="https:\/\/example.com\/article\?x=1&amp;y=2"/);
  assert.equal(result.manifest.contentImages.length,1);
  assert.equal(JSON.parse(result.sourceProofText).sourceHtml,original.html);
  assert.match(result.report.warnings.join('\n'),/无法在平台内逐字编辑/);
  const changed=structuredClone(prepared.plan);changed.blocks[0].start++;
  await assert.rejects(L.apply(original.html,original.manifest.contentImages,prepared.assets,changed),/不一致/);
  const overlap=structuredClone(prepared.plan);overlap.blocks.push(overlap.blocks[0]);
  await assert.rejects(L.apply(original.html,original.manifest.contentImages,prepared.assets,overlap),/边界/);
  const badAssets=new Map(prepared.assets);badAssets.set('assets/'+prepared.plan.blocks[0].image.bundleFile,asFile(png(20,40,220)));
  await assert.rejects(L.apply(original.html,original.manifest.contentImages,badAssets,prepared.plan),/缺失或被修改/);
  result.assets.delete('assets/red.png');
  await assert.rejects(D.verify(result,'sohu'),/原始素材缺失/);
});
test('invalid plan links, generated names and preserve substitutions are rejected',async()=>{
  const original=source(),group=L.parse(original.html).nodes.find(n=>n.tag==='div');
  const prepared=await L.prepare(original,async()=>[{start:group.start,end:group.end,reasons:['columns'],text:'',links:[],width:60,height:40,bytes:png(220,20,30)}]);
  const malicious=structuredClone(prepared.plan);malicious.blocks[0].links=[{text:'x',href:'javascript:alert(1)'}];
  await assert.rejects(L.apply(original.html,original.manifest.contentImages,prepared.assets,malicious),/链接记录/);
  const wrongMode={...prepared.plan,mode:'preserve'};
  await assert.rejects(L.apply(original.html,original.manifest.contentImages,prepared.assets,wrongMode),/保留原结构/);
});

test('QR-rejected composite restores its text and links with detailed, verified processing logs',async()=>{
  const original=source(),group=L.parse(original.html).nodes.find(n=>n.tag==='div');
  const prepared=await L.prepare(original,async()=>[{start:group.start,end:group.end,reasons:['columns'],text:'说明文字<保留>\n下一行',links:[{href:'https://example.com/source',text:'来源链接'}],width:60,height:40,bytes:png(220,20,30)}]);
  const initial=await D.prepare(original,'sohu',{layout:prepared.plan,layoutAssets:prepared.assets});
  initial.assets.set('source-wechat.json',asFile(Buffer.from(initial.sourceProofText)));
  const file=prepared.plan.blocks[0].image.bundleFile;
  const adapted=await D.withSohuOmissions(initial,[{bundleFile:file,reason:'platform-rejected-qrcode'}]);
  assert.equal(adapted.manifest.contentImages.length,0);
  assert.match(adapted.html,/说明文字&lt;保留&gt;<br>下一行/);
  assert.match(adapted.html,/href="https:\/\/example.com\/source"/);
  assert.ok(adapted.assets.has('assets/'+file));
  assert.ok(adapted.assets.has('assets/red.png'));
  assert.equal(JSON.parse(adapted.sourceProofText).sourceHtml,original.html);
  const log=adapted.report.processing_log.map(item=>item.detail).join('\n');
  assert.match(log,/red.png、blue.png/);assert.match(log,/恢复为可编辑正文/);assert.match(log,/1 个链接/);
  assert.equal(await D.verify(adapted,'sohu'),true);
  const altered={...adapted,report:structuredClone(adapted.report)};
  altered.report.processing_log[0].detail='伪造说明';
  await assert.rejects(D.verify(altered,'sohu'),/日志与实际转换不一致/);
});
test('GIF, animated WebP and APNG are marked; static PNG is eligible for rendering',()=>{
  assert.equal(L.animated(Buffer.from('GIF89a')),true);
  const webp=Buffer.alloc(30);webp[0]=82;webp[8]=87;webp.write('VP8X',12);webp[20]=2;
  assert.equal(L.animated(webp),true);
  assert.equal(L.animated(png(20,40,220)),false);
});
