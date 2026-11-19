'use strict';
// Optional integration test against an existing matrix 09-矩阵内容 folder.
// Runs in an isolated browser with mocked target pages; never edits daily files.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require(process.env.DRAFT_HELPER_PLAYWRIGHT_MODULE||'playwright-core');
const root=path.resolve(__dirname,'..'),base=process.env.DRAFT_HELPER_MATRIX_BASE;
if(!base){console.log('SKIP: set DRAFT_HELPER_MATRIX_BASE to an existing 09-矩阵内容 directory');process.exit(0);}
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(file)]||'application/octet-stream');
  res.end(fs.readFileSync(file));
});
function archiveEntries(bytes){
  const entries=new Map(),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),decode=new TextDecoder();
  for(let offset=0;offset+30<bytes.length&&view.getUint32(offset,true)===0x04034b50;){
    const size=view.getUint32(offset+18,true),nameSize=view.getUint16(offset+26,true),extra=view.getUint16(offset+28,true);
    const name=decode.decode(bytes.subarray(offset+30,offset+30+nameSize)),start=offset+30+nameSize+extra;
    entries.set(name,bytes.subarray(start,start+size));offset=start+size;
  }
  return entries;
}
function allFiles(dir,prefix=''){
  const files=new Map();for(const item of fs.readdirSync(dir,{withFileTypes:true})){
    const name=prefix+item.name,full=path.join(dir,item.name);
    if(item.isDirectory())for(const [key,value] of allFiles(full,name+'/'))files.set(key,value);
    else if(item.isFile())files.set(name,fs.readFileSync(full));
  }return files;
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true,...(process.env.DRAFT_HELPER_CHROMIUM_PATH?{executablePath:process.env.DRAFT_HELPER_CHROMIUM_PATH}:{})});
  try{
    const page=await browser.newPage(),errors=[],dialogs=[];
    page.on('pageerror',error=>errors.push(error.message));page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept();});
    await page.addInitScript(()=>{
      const tabs=[{id:11,url:'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle',title:'搜狐测试页'},
        {id:12,url:'https://mp.toutiao.com/profile_v4/graphic/publish',title:'头条测试页'},
        {id:13,url:'https://mp.yidianzixun.com/',title:'一点测试页'}];
      globalThis.chrome={runtime:{getManifest:()=>({version:'test'}),getURL:p=>p},tabs:{
        query:async options=>{if(options.active)return[tabs[0]];const patterns=Array.isArray(options.url)?options.url:[options.url];
          return tabs.filter(tab=>patterns.some(pattern=>pattern&&tab.url.startsWith(pattern.split('*')[0])));},
        get:async id=>tabs.find(tab=>tab.id===id)},debugger:{attach:async()=>{},detach:async()=>{},sendCommand:async()=>({})},
        permissions:{request:async()=>true}};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/studio.html`);await page.evaluate(()=>DraftStudio.ready);
    await page.evaluate(()=>{window.fills=[];
      window.fillPortalDraft=async(_id,bundle,platform)=>fills.push({platform,title:bundle.manifest.title});
      window.fillToutiaoDraft=async(_id,bundle)=>fills.push({platform:'toutiao',title:bundle.toutiaoShortTitle});
      window.attemptMatrixCover=async()=>{};
    });
    assert.equal(await page.locator('#matrix-fill').isDisabled(),true);
    await page.selectOption('#matrix-platform','sohu');
    const sohu=path.join(base,'04-搜狐号');await page.locator('#matrix-bundle').setInputFiles(sohu);
    await page.waitForFunction(()=>document.querySelector('#matrix-bundle-status').textContent.includes('已选择：搜狐号准备包'));
    assert.equal(await page.locator('#matrix-fill').isEnabled(),true,'an existing package must work without an open WeChat draft');
    await page.locator('#matrix-fill').click();await page.waitForFunction(()=>document.querySelector('#matrix-status').textContent.includes('已填入'));
    const pending=page.waitForEvent('download');await page.locator('#matrix-export').click();const download=await pending;
    const zipped=archiveEntries(fs.readFileSync(await download.path())),original=allFiles(sohu);
    assert.deepEqual([...zipped.keys()].sort(),[...original.keys()].sort());
    for(const [name,bytes] of original)assert.deepEqual(Buffer.from(zipped.get(name)),bytes,name);
    await page.selectOption('#matrix-platform','toutiao');
    const yidian=path.join(base,'01-一点资讯');await page.locator('#matrix-bundle').setInputFiles(yidian);
    await page.waitForFunction(()=>document.querySelector('#matrix-bundle-status').textContent.includes('共用一点资讯准备包'));
    const proof=JSON.parse(fs.readFileSync(path.join(yidian,'source-wechat.json'),'utf8'));
    const expected=require('../yidian-contract.js').deriveToutiaoTitle(proof.manifest.title);
    assert.equal(await page.inputValue('#matrix-title'),expected);
    await page.locator('#matrix-fill').click();await page.waitForFunction(()=>document.querySelector('#matrix-status').textContent.includes('已填入'));
    await page.selectOption('#matrix-platform','yidian');
    const title=JSON.parse(fs.readFileSync(path.join(yidian,'manifest.json'),'utf8')).title;
    await page.waitForFunction(title=>document.querySelector('#matrix-title').value===title,title);
    await page.selectOption('#matrix-platform','toutiao');await page.waitForFunction(title=>document.querySelector('#matrix-title').value===title,expected);
    const fills=await page.evaluate(()=>fills);assert.deepEqual(fills.map(item=>item.platform),['sohu','toutiao']);
    assert.equal(fills[1].title,expected);assert.ok(dialogs.at(-1).includes(expected));assert.deepEqual(errors,[]);
    console.log('PASS: real legacy packages load without a current article; original ZIP retained; shared Toutiao title and dispatch verified in isolated browser');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
