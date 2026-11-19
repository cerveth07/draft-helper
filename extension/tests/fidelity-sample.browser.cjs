'use strict';
// Local, user-provided fixtures stay outside the extension/release package.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.DRAFT_HELPER_PLAYWRIGHT_MODULE||'playwright-core');
const root=path.resolve(__dirname,'..'),out=path.resolve(root,'../test-results/fidelity');
const input=process.argv[2];if(!input)throw Error('Pass a saved WeChat article HTML path; its companion _files directory must be adjacent.');
const filename=path.basename(input),companion=filename.replace(/\.html?$/i,'')+'_files';
fs.mkdirSync(out,{recursive:true});const fixture=path.join(out,'input');fs.mkdirSync(fixture,{recursive:true});
fs.copyFileSync(input,path.join(fixture,filename));fs.cpSync(path.join(path.dirname(input),companion),path.join(fixture,companion),{recursive:true});
const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(file)]||'application/octet-stream');res.end(fs.readFileSync(file));});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({viewport:{width:1600,height:1080}}),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await page.addInitScript(()=>{globalThis.chrome={runtime:{getManifest:()=>({version:'0.6.1'})},tabs:{query:async()=>[],get:async()=>({})},permissions:{request:async()=>true}};});
    let resourceIndex=0;const cacheFile=path.join(out,'image-cache.json');const cache=fs.existsSync(cacheFile)?JSON.parse(fs.readFileSync(cacheFile)):{};
    await page.exposeFunction('downloadFixtureImage',async src=>{
      if(cache[src]&&fs.existsSync(path.join(out,cache[src].file)))return {type:cache[src].type,data:fs.readFileSync(path.join(out,cache[src].file)).toString('base64')};
      const parsed=new URL(src);assert.ok(['mmbiz.qpic.cn','mmbiz.qlogo.cn'].includes(parsed.hostname),'fixture only downloads known article image hosts');
      const response=await fetch(src,{headers:{'User-Agent':'Mozilla/5.0','Referer':'https://mp.weixin.qq.com/'},signal:AbortSignal.timeout(30000)});
      if(!response.ok)throw Error('Image download HTTP '+response.status);const bytes=Buffer.from(await response.arrayBuffer());
      const file='download-'+Date.now()+'-'+(++resourceIndex)+'.bin';fs.writeFileSync(path.join(out,file),bytes);
      cache[src]={file,type:response.headers.get('content-type')||'image/jpeg'};fs.writeFileSync(cacheFile,JSON.stringify(cache,null,2));return {type:cache[src].type,data:bytes.toString('base64')};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/studio.html`);await page.evaluate(()=>DraftStudio.ready);
    await page.evaluate(()=>{const originalFetch=fetch;globalThis.fetch=async(src,options)=>/^https:\/\/mmbiz\./.test(String(src))?window.downloadFixtureImage(String(src)).then(result=>new Response(Uint8Array.from(atob(result.data),c=>c.charCodeAt(0)),{headers:{'Content-Type':result.type}})):originalFetch(src,options);});
    await page.setInputFiles('#source-folder',fixture);await page.waitForFunction(()=>DraftStudio.snapshot().importReport?.source==='wechat-article',{},{timeout:30000});
    const before=await page.evaluate(()=>{const s=DraftStudio.snapshot(),check=DraftCore.preflight(s);return {title:s.meta.title,author:s.meta.author,report:s.importReport,missing:check.images.filter(i=>!DraftCore.imageData.test(i.src)).length,errors:check.errors};});
    const sourceCounts=await page.evaluate(raw=>{const doc=new DOMParser().parseFromString(raw,'text/html'),article=doc.querySelector('#js_content');return {images:article.querySelectorAll('img').length,svg:article.querySelectorAll('svg').length};},fs.readFileSync(input,'utf8'));
    console.log('Imported source:',JSON.stringify(before));assert.equal(before.report.images,sourceCounts.images);assert.equal(before.report.svg,sourceCounts.svg);
    if(before.missing){await page.click('#download-images');await page.waitForFunction(()=>!document.body.classList.contains('busy'),{},{timeout:180000});}
    const snapshot=await page.evaluate(()=>DraftStudio.snapshot());
    const preflight=await page.evaluate(()=>DraftCore.preflight(DraftStudio.snapshot()));assert.deepEqual(preflight.errors,[]);
    const assetData=await page.evaluate(()=>[...DraftCore.parse(DraftStudio.snapshot().html).querySelectorAll('img')].map(img=>img.getAttribute('src')));
    const cssFiles={};for(const file of fs.readdirSync(path.join(fixture,companion)))if(file.endsWith('.css'))cssFiles[file]=fs.readFileSync(path.join(fixture,companion,file),'utf8');
    const source=await browser.newPage({viewport:{width:390,height:1000}});await source.route('**/*',route=>route.abort());
    const baseline=await source.evaluate(({raw,cssFiles,assetData})=>{
      const doc=new DOMParser().parseFromString(raw,'text/html'),article=doc.querySelector('#js_content');
      for(const link of doc.querySelectorAll('link[rel=stylesheet]')){const key=decodeURIComponent(link.getAttribute('href').split('/').pop());if(cssFiles[key]){const style=doc.createElement('style');style.textContent=cssFiles[key];link.replaceWith(style);}else link.remove();}
      doc.querySelectorAll('script,iframe,object,embed,link,base,meta[http-equiv]').forEach(el=>el.remove());
      let child=article;while(child.parentElement&&child.parentElement!==doc.documentElement){const parent=child.parentElement;for(const sibling of [...parent.childNodes])if(sibling!==child&&sibling.nodeName!=='STYLE')sibling.remove();child=parent;if(parent===doc.body)break;}
      [...article.querySelectorAll('img')].forEach((img,i)=>{img.src=assetData[i];img.removeAttribute('data-src');img.removeAttribute('loading');img.classList.remove('js_img_placeholder','wx_img_placeholder');});
      for(const el of doc.querySelectorAll('*'))for(const attr of [...el.attributes])if(/^on/i.test(attr.name))el.removeAttribute(attr.name);
      article.style.setProperty('width','390px');article.style.setProperty('max-width','none');article.style.setProperty('visibility','visible');article.style.setProperty('opacity','1');
      return '<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:">'+doc.documentElement.outerHTML;
    },{raw:fs.readFileSync(input,'utf8'),cssFiles,assetData});
    await source.setContent(baseline);await source.evaluate(()=>Promise.all([...document.querySelectorAll('#js_content img')].map(img=>img.decode().catch(()=>{}))));
    // Make the preview's content box exactly the source canvas width.
    await page.locator('#paper').evaluate(el=>el.style.width='392px');
    const frame=page.frameLocator('#article-frame');await frame.locator('img').first().waitFor();
    const measure=el=>{const origin=el.getBoundingClientRect();return {width:origin.width,height:origin.height,text:el.textContent.replace(/\s+/g,''),nodes:[el,...el.querySelectorAll('*')].map(node=>{const r=node.getBoundingClientRect(),s=getComputedStyle(node);return {tag:node.tagName,x:r.x-origin.x,y:r.y-origin.y,width:r.width,height:r.height,font:s.fontSize,line:s.lineHeight,display:s.display,color:s.color,margin:s.margin,padding:s.padding};})};};
    const expected=await source.locator('#js_content').evaluate(measure);
    const actual=await frame.locator('[data-dh-root] > *').first().evaluate(measure);
    const differences=[];for(let i=0;i<Math.min(expected.nodes.length,actual.nodes.length);i++){const a=expected.nodes[i],b=actual.nodes[i];const hidden=!a.width&&!a.height&&!b.width&&!b.height;const keys=(hidden?['width','height']:['x','y','width','height']).filter(key=>Math.abs(a[key]-b[key])>.6);const style=['font','line','display','color','margin','padding'].filter(key=>a[key]!==b[key]);if(keys.length||style.length)differences.push({index:i,tag:a.tag,geometry:keys,style,expected:a,actual:b});}
    const report={title:before.title,sourceCharacters:expected.text.length,importedCharacters:actual.text.length,sourceNodes:expected.nodes.length,importedNodes:actual.nodes.length,sourceHeight:expected.height,importedHeight:actual.height,images:before.report.images,svg:before.report.svg,assets:preflight.images.length,geometryOrStyleDifferences:differences.length,firstDifferences:differences.slice(0,15),browserErrors:errors};
    fs.writeFileSync(path.join(out,'comparison.json'),JSON.stringify(report,null,2));
    assert.equal(actual.text,expected.text);assert.equal(actual.nodes.length,expected.nodes.length);
    console.log('Fidelity comparison:',JSON.stringify(report));
    await source.locator('#js_content').screenshot({path:path.join(out,'source-article.png'),animations:'disabled'});
    const exportHtml=await page.evaluate(()=>DraftCore.render(DraftStudio.snapshot(),true));const completeHtml='<!doctype html><meta charset="utf-8"><body style="margin:0;width:390px">'+exportHtml;fs.writeFileSync(path.join(out,'restored-article.html'),completeHtml);
    const exportPage=await browser.newPage({viewport:{width:390,height:1000}});await exportPage.route('**/*',route=>route.abort());await exportPage.setContent(completeHtml);await exportPage.evaluate(()=>Promise.all([...document.images].map(img=>img.decode().catch(()=>{}))));
    await exportPage.locator('body > section > *').first().screenshot({path:path.join(out,'imported-article.png'),animations:'disabled'});
    const animatedRegions=await exportPage.locator('body > section > *').first().evaluate(el=>{const base=el.getBoundingClientRect();return [...el.querySelectorAll('img[src^="data:image/gif"]')].map(img=>{const r=img.getBoundingClientRect();return {x:r.x-base.x,y:r.y-base.y,width:r.width,height:r.height};});});
    fs.writeFileSync(path.join(out,'animated-regions.json'),JSON.stringify(animatedRegions));
    await page.evaluate(async()=>{const bundle=await DraftCore.bundle(DraftStudio.snapshot());await verifyBundle(bundle,'wechat');});
    await page.setInputFiles('#source-file',path.join(out,'restored-article.html'));
    await page.waitForFunction(()=>DraftStudio.snapshot().importReport?.source==='html'&&!document.body.classList.contains('busy'),{},{timeout:30000});
    const roundtrip=await page.evaluate(()=>DraftCore.preflight(DraftStudio.snapshot()));assert.deepEqual(roundtrip.errors,[]);
    assert.equal(roundtrip.images.length,preflight.images.length);
    const restored=await page.frameLocator('#article-frame').locator('[data-dh-root] > *').first().evaluate(measure);
    assert.equal(restored.text,expected.text);assert.ok(Math.abs(restored.height-expected.height)<.6,'exported HTML reimport preserves article height');
    assert.deepEqual(errors,[]);assert.equal(differences.length,0);console.log('PASS actual saved article assets, text, SVG, bundle verification; visible geometry/style differences: 0');
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
