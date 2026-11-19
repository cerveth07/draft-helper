'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core'),{png}=require('./layout-fixtures.cjs');
(async()=>{
 const server=http.createServer((req,res)=>{res.setHeader('content-type',req.url==='/a' || req.url==='/b'?'image/png':'text/html');res.end(req.url==='/a'?png(220,20,30):req.url==='/b'?png(20,40,220):'<div class="ProseMirror" contenteditable="true"></div>');});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage(),base='http://127.0.0.1:'+server.address().port;await page.goto(base);
  const cdp=await page.context().newCDPSession(page);
  const scope=vm.createContext({URL,TextEncoder,atob,crypto:require('node:crypto').webcrypto,evaluate:(_tab,expression)=>page.evaluate(expression),chrome:{debugger:{sendCommand:(_target,method,args)=>cdp.send(method,args)}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../toutiao.js'),'utf8'),scope);
  const html='<p>开头</p><img style="width:320px" src="'+base+'/a"><p>结尾</p>';
  await page.evaluate(html=>{const e=document.querySelector('.ProseMirror');e.innerHTML=html;e.pmViewDesc={node:{descendants:fn=>{fn({isText:true,text:'开头',type:{name:'text'}});fn({type:{name:'image'},attrs:{data:{link:''}}});fn({isText:true,text:'结尾',type:{name:'text'}});}}};},html);
  await page.locator('img').evaluate(i=>i.decode());
  const proof=await scope.verifyToutiaoImageContent(1,html);assert.equal(proof.length,1);assert.equal(proof[0].offset,2);
  await page.locator('img').evaluate((i,src)=>{i.src=src;return i.decode()},base+'/b');
  await assert.rejects(scope.verifyToutiaoImageContent(1,html),/图片重新粘贴后内容发生变化/);
  console.log('PASS native CDP image resource reads, source/final byte identity and changed-image protection');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
