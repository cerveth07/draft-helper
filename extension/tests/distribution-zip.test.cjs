'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Zip=require('../distribution-zip.js');
const png=new Uint8Array([137,80,78,71,13,10,26,10]);
const file={arrayBuffer:async()=>png.buffer};
function entriesOf(bytes) {
  const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decoder=new TextDecoder();
  let offset=0;const entries=new Map();
  while(offset+30<bytes.length && dv.getUint32(offset,true)===0x04034b50) {
    const size=dv.getUint32(offset+18,true),nameLength=dv.getUint16(offset+26,true);
    const filename=decoder.decode(bytes.subarray(offset+30,offset+30+nameLength));
    const dataStart=offset+30+nameLength;
    entries.set(filename,bytes.subarray(dataStart,dataStart+size));
    offset=dataStart+size;
  }
  const tail=bytes.length-22;
  assert.equal(dv.getUint32(tail,true),0x06054b50,'valid ZIP end record');
  assert.equal(dv.getUint16(tail+10,true),entries.size,'all entries indexed');
  return entries;
}
test('single ZIP holds verified WeChat metadata, deduplicated assets and portable preview',async()=>{
  const bundle={
    manifest:{title:'测试文章',targetPlatform:'wechat',
      contentImages:[{bundleFile:'001.png',placeholder:'WECHATIMGPH_1_END'}]},
    manifestText:'{"bundleContractVersion":1}',html:'<p>你好</p><img src="WECHATIMGPH_1_END"><img src="WECHATIMGPH_1_END">',
    report:{state:'PREPARED',payload_sha256:'abc'},assets:new Map([['assets/001.png',file]])
  };
  const zip=await Zip.pack(Zip.sourceFilesFor(bundle));
  assert.equal(zip.type,'application/zip');
  const entries=entriesOf(new Uint8Array(await zip.arrayBuffer()));
  for(const name of ['manifest.json','raw-content.txt','preparation-report.json','preview-article.html','assets/001.png','使用说明.txt'])
    assert.ok(entries.has(name),name);
  const preview=new TextDecoder().decode(entries.get('preview-article.html'));
  assert.match(preview,/assets\/001\.png/);
  assert.doesNotMatch(preview,/WECHATIMGPH_/);
  assert.equal(entries.get('assets/001.png').length,png.length);
});
test('invalid ZIP entries are rejected before writing',async()=>{
  await assert.rejects(Zip.pack(new Map([['../secret.txt','x']])),/路径/);
  await assert.rejects(Zip.pack(new Map([['bad\\evil','x']])),/路径/);
});
test('legacy matrix packages are exported without replacing their original files',async()=>{
  const originals=new Map([
    ['manifest.json','{"targetPlatform":"sohu"}'],['raw-content.txt','<p>原稿</p>'],
    ['preparation-report.json','{"state":"PREPARED"}'],['source-wechat.json','{"titlePlan":{}}'],
    ['使用说明.txt','保留原来的矩阵说明'],['assets/cover.jpg',file],
  ]);
  const bundle={manifest:{targetPlatform:'sohu'},assets:originals};
  const entries=entriesOf(new Uint8Array(await (await Zip.pack(Zip.filesFor(bundle))).arrayBuffer()));
  assert.equal(new TextDecoder().decode(entries.get('使用说明.txt')),'保留原来的矩阵说明');
  assert.equal(new TextDecoder().decode(entries.get('source-wechat.json')),'{"titlePlan":{}}');
  assert.deepEqual([...entries.keys()],[...originals.keys()]);
  assert.deepEqual([...entries.get('assets/cover.jpg')],[...png]);
});
test('download names follow the target profile, date and title',()=>{
  assert.equal(Zip.nameFor({manifest:{profile:{id:'wechat-head'},issueDate:'2026-10-27',title:'测试文章标题'}}),
    'draft-helper-wechat-head-2026-10-27-测试文章标题.zip');
  assert.equal(Zip.nameFor({manifest:{profile:{id:'wechat-sub'},issueDate:'2026-10-27',title:'测试文章标题'}}),
    'draft-helper-wechat-sub-2026-10-27-测试文章标题.zip');
  assert.equal(Zip.nameFor({manifest:{profile:{id:'toutiao'},issueDate:'2026-10-27',title:'短标题测试'}}),
    'draft-helper-toutiao-2026-10-27-短标题测试.zip');
  assert.match(Zip.nameFor({manifest:{targetPlatform:'penguin',title:'旧包'}}),/^draft-helper-penguin-\d{4}-\d{2}-\d{2}-旧包\.zip$/);
  assert.equal(Zip.nameFor({manifest:{profile:{id:'sohu'},issueDate:'2026-10-27',title:'  标题/含:非法*字符?  '}}),
    'draft-helper-sohu-2026-10-27-标题_含_非法_字符_.zip');
  const long=Zip.nameFor({manifest:{profile:{id:'yidian'},issueDate:'2026-10-27',
    title:'一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十多余'}});
  assert.equal(long,'draft-helper-yidian-2026-10-27-一二三四五六七八九十一二三四五六七八九十一二三四.zip');
  assert.equal(Zip.nameFor({manifest:{profile:{id:'wechat-head'},issueDate:'2026-10-27'}}),
    'draft-helper-wechat-head-2026-10-27.zip');
});
