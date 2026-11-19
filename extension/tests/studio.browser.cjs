'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require(process.env.DRAFT_HELPER_PLAYWRIGHT_MODULE||'playwright-core');
const root=path.resolve(__dirname,'..');
const out=process.env.DRAFT_HELPER_TEST_OUTPUT||path.resolve(__dirname,'../../test-results');fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
  res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8'})[path.extname(file)]||'application/octet-stream');
  res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({headless:true});
  try{
    const context=await browser.newContext({viewport:{width:1500,height:1050}}),page=await context.newPage(),editor=await context.newPage();
    const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
    await editor.setContent('<input id="title"><input id="author"><textarea id="js_description"></textarea><div id="body"></div>');
    await editor.evaluate(()=>{window.__MP_Editor_JSAPI__={invoke({apiName,apiParam,sucCb}){if(apiName==='mp_editor_set_content')document.querySelector('#body').innerHTML=apiParam.content;sucCb({content:document.querySelector('#body').innerHTML});}};});
    await page.exposeFunction('mockDebug',async(method,params)=>{
      if(method==='Runtime.evaluate')return {result:{value:await editor.evaluate(expression=>(0,eval)(expression),params.expression)}};
      if(method==='Input.insertText'){await editor.keyboard.insertText(params.text);return {};}
      return {};
    });
    await page.addInitScript(()=>{
      globalThis.chrome={runtime:{getManifest:()=>({version:'0.6.0'}),getURL:p=>p},tabs:{query:async()=>[{id:7,url:'https://mp.weixin.qq.com/cgi-bin/appmsg',title:'测试公众号编辑页'}],get:async()=>({id:7,url:'https://mp.weixin.qq.com/cgi-bin/appmsg',title:'测试公众号编辑页'})},debugger:{attach:async()=>{},detach:async()=>{},sendCommand:async(_target,method,params)=>window.mockDebug(method,params)},permissions:{request:async()=>true}};
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/studio.html`);
    await page.evaluate(()=>DraftStudio.ready);
    await page.click('#sample');await page.waitForFunction(()=>DraftStudio.snapshot().html.includes('把注意力'));
    await page.click('#mode-adjust');
    await page.fill('#global-fontSize','18');await page.locator('#global-fontSize').blur();
    await page.fill('#global-lineHeight','2');await page.locator('#global-lineHeight').blur();
    await page.fill('#global-paragraphGap','24');await page.locator('#global-paragraphGap').blur();
    await page.fill('#global-padding','20');await page.locator('#global-padding').blur();
    let frame=page.frameLocator('#article-frame');
    await frame.locator('p').first().click();
    await page.fill('#local-font-size','22');await page.locator('#local-font-size').blur();
    await page.waitForFunction(()=>DraftStudio.snapshot().html.includes('22px'));
    assert.equal(await frame.locator('p').first().evaluate(el=>getComputedStyle(el).fontSize),'22px');
    assert.equal(await frame.locator('p').nth(1).evaluate(el=>getComputedStyle(el).fontSize),'18px');
    await page.click('#undo');assert.equal(await frame.locator('p').first().evaluate(el=>getComputedStyle(el).fontSize),'18px');
    await page.click('#redo');assert.equal(await frame.locator('p').first().evaluate(el=>getComputedStyle(el).fontSize),'22px');
    await frame.locator('h2').click();await page.selectOption('#local-scope','all');await page.fill('#local-font-size','27');await page.locator('#local-font-size').blur();
    await page.locator('.side-details>summary').click();await page.click('#template-save');await page.fill('#template-name','我的测试样式');await page.click('#template-confirm');
    const templates=await page.evaluate(()=>JSON.parse(localStorage.getItem('draft-helper-templates-v1')));
    assert.equal(templates[0].settings.fontSize,18);assert.equal(templates[0].typeStyles.h2['font-size'],'27px');assert.ok(!JSON.stringify(templates).includes('把注意力'));
    await page.screenshot({path:path.join(out,'studio-desktop.png'),fullPage:true});
    await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');await page.reload();await page.evaluate(()=>DraftStudio.ready);
    assert.equal(await page.evaluate(()=>DraftStudio.snapshot().settings.fontSize),18);
    await page.click('#view-original');assert.equal(await frame.locator('h2').evaluate(el=>getComputedStyle(el).fontSize),'21px');await page.click('#view-original');
    // The actual adapter verifies and fills a text-only article into an isolated editor fixture.
    await page.click('#send');await page.click('#review-fill');await page.waitForFunction(()=>document.querySelector('#result-status').textContent.includes('正文文字与图片顺序已核对'));
    assert.match(await editor.locator('#body').innerText(),/把注意力/);
    await page.click('#verify-result');await page.waitForFunction(()=>document.querySelector('#result-status').textContent.includes('核对通过'));
    await editor.evaluate(()=>document.querySelector('#body p').remove());
    await page.click('#verify-result');await page.waitForFunction(()=>document.querySelector('#result-status').textContent.includes('正文文字与准备稿不一致'));
    console.log('PASS global/local styles, undo/redo, templates, persistent restore, actual adapter text-only fill, readback mismatch');

    // Import hostile and complex HTML: no executable content survives; CSS is inlined.
    const html='<html><head><title>带样式的稿件</title><style>.bodycopy{font-size:19px;color:rgb(34,80,60)}</style></head><body><script>window.OWNED=1</script><h2>标题</h2><p class="bodycopy" onclick="alert(1)">原有排版需要保留。</p><iframe src="https://example.com"></iframe><img src="missing.png"></body></html>';
    await page.setInputFiles('#source-file',{name:'article.html',mimeType:'text/html',buffer:Buffer.from(html)});
    await page.waitForFunction(()=>DraftStudio.snapshot().meta.title==='带样式的稿件');
    assert.equal(await frame.locator('p').evaluate(el=>getComputedStyle(el).fontSize),'19px');
    let snapshot=await page.evaluate(()=>DraftStudio.snapshot());assert.ok(!snapshot.html.includes('<script'));assert.ok(!snapshot.html.includes('onclick'));assert.ok(!snapshot.html.includes('<iframe'));
    assert.ok((await page.evaluate(()=>DraftCore.preflight(DraftStudio.snapshot()).errors)).some(x=>x.includes('图片')));
    await page.click('#mode-adjust');await frame.locator('img').click();
    const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5XcAAAAASUVORK5CYII=','base64');
    await page.setInputFiles('#replace-image',{name:'replacement.png',mimeType:'image/png',buffer:png});
    await page.waitForFunction(()=>DraftStudio.snapshot().html.includes('data:image/png'));
    await page.fill('#image-caption','图一：补齐图片');await page.locator('#image-caption').blur();
    await page.click('#image-cover');
    assert.ok(await page.evaluate(()=>DraftStudio.snapshot().cover));
    const bundle=await page.evaluate(async()=>{const result=await DraftCore.bundle(DraftStudio.snapshot());await verifyBundle(result,'wechat');return {manifest:result.manifest,html:result.html};});
    assert.equal(bundle.manifest.contentImages.length,1);assert.ok(bundle.manifest.coverImage);assert.ok(!bundle.html.includes('data-dh-'));
    await editor.evaluate(()=>{document.querySelector('#body').innerHTML='';document.querySelector('#title').value='';});
    await page.evaluate(()=>{uploadImageToWechat=async()=> 'https://mmbiz.qpic.cn/test/image/0';setCoverFromFile=async()=>{throw Error('测试封面裁剪未完成');};});
    await page.click('#send');await page.click('#review-fill');await page.waitForFunction(()=>document.querySelector('#result-status').textContent.includes('正文文字与图片顺序已核对'));
    assert.match(await page.locator('#result-status').innerText(),/封面未完成/);
    assert.equal(await editor.locator('#body img').count(),1);
    await page.click('#restore');await page.waitForFunction(()=>!DraftStudio.snapshot().html.includes('data:image/png'));
    await page.click('#undo');await page.waitForFunction(()=>DraftStudio.snapshot().html.includes('data:image/png'));
    console.log('PASS sanitize, CSS preservation, missing-image block, replace/caption/cover, verified bundle, cover failure keeps body success, restore undo');
    const compare=await page.evaluate(()=>DraftCore.compare('<p>甲乙</p><img src="https://a/1"><img src="https://a/2">','<p>甲乙</p><img src="https://a/2"><img src="https://a/1">'));
    assert.equal(compare.ok,false);assert.match(compare.issues.join(),/图片/);
    // Different input formats and raw style attributes must survive the import path.
    await page.setInputFiles('#source-file',{name:'notes.md',mimeType:'text/markdown',buffer:Buffer.from('# Markdown 标题\n\n一段 **加粗** 内容。\n\n> 引用内容\n\n- 第一项\n- 第二项')});
    await page.waitForFunction(()=>DraftStudio.snapshot().meta.title==='Markdown 标题');
    assert.equal(await frame.locator('strong').innerText(),'加粗');assert.equal(await frame.locator('li').count(),2);
    await page.setInputFiles('#source-file',{name:'body-style.html',mimeType:'text/html',buffer:Buffer.from('<html><body style="padding:0 28px;color:#125544"><h2><span style="color:#ee0000">嵌套标题</span></h2><p><span style="font-size:14px">测试正文</span></p></body></html>')});
    await page.waitForFunction(()=>DraftStudio.snapshot().meta.title==='body-style');
    assert.ok((await page.evaluate(()=>DraftStudio.snapshot().html)).includes('28px'));
    await page.click('#mode-adjust');await page.fill('#global-padding','12');await page.locator('#global-padding').blur();
    await page.locator('#global-theme').evaluate(el=>{el.value='#225588';el.dispatchEvent(new Event('change',{bubbles:true}));});
    assert.equal(await frame.locator('h2 span').evaluate(el=>getComputedStyle(el).color),'rgb(34, 85, 136)');
    await frame.locator('p').click();await page.selectOption('#local-scope','all');await page.fill('#local-font-size','23');await page.locator('#local-font-size').blur();
    assert.equal(await frame.locator('p span').evaluate(el=>getComputedStyle(el).fontSize),'23px');
    assert.equal(await frame.locator('[data-dh-root] > section').evaluate(el=>getComputedStyle(el).paddingLeft),'0px');
    console.log('PASS Markdown structure, body inline style, nested text styling, page padding replacement');
    const broken=await page.evaluate(async()=>{
      const normalized=await DraftCore.normalize('<p>损坏图片</p><img src="data:image/png;base64,YmFk"><img src="//example.com/test.png">');
      const testState={...DraftStudio.snapshot(),html:normalized.html,warnings:normalized.warnings};
      return {check:DraftCore.preflight(testState),html:normalized.html};
    });
    assert.match(broken.check.errors.join(),/2 张图片尚未就绪/);assert.ok(broken.html.includes('https://example.com/test.png'));
    console.log('PASS corrupt embedded image detection and protocol-relative image handling');
    // One-click WeChat import localizes multiple <img> and CSS backgrounds from
    // one CDN resource, then produces a verifiable matrix package.
    let imageRequests=0;
    const remote='https://mmbiz.qpic.cn/draft-helper-test/640';
    await page.route(remote,async route=>{
      imageRequests++;
      await route.fulfill({status:200,contentType:'image/png',
         headers:{'access-control-allow-origin':'*'},body:require('./layout-fixtures.cjs').png(40,90,120)});
    });
    await page.evaluate(()=>{
      chrome.permissions.contains=async({origins})=>origins.some(s=>s.includes('mmbiz.qpic.cn'));
      WechatCapture.readTab=async()=>({
        title:'多平台图片自动获取测试稿',author:'图片作者',sourceTabId:7,
        html:'<div id="js_content"><section style="background-image:url(&quot;https://mmbiz.qpic.cn/draft-helper-test/640&quot;)">'
          +'<p>背景与正文应同时保留</p></section><p>图片甲</p>'
          +'<img src="https://mmbiz.qpic.cn/draft-helper-test/640">'
          +'<p>图片乙</p><img src="https://mmbiz.qpic.cn/draft-helper-test/640"></div>'
      });
    });
    await page.selectOption('#source-tab','7');
    await page.click('#import-wechat-tab');
    await page.waitForFunction(()=>document.querySelector('#image-download-status').textContent.includes('本轮完成'));
    const localized=await page.evaluate(async()=>{
      const state=DraftStudio.snapshot(),check=DraftCore.preflight(state);
      const source=await DraftCore.bundle(state);
      const distribution=await DraftDistribution.prepare(source,'yidian');
      distribution.assets.set('source-wechat.json',new File([distribution.sourceProofText],'source-wechat.json'));
      await DraftDistribution.verify(distribution,'yidian');
      return {remote:check.images.filter(item=>/^https?:/.test(item.src)).length,
        originals:check.images.length,sourceAssets:source.manifest.contentImages.length,
        targetImages:distribution.manifest.contentImages.length,
        backgrounds:distribution.report.background_image_fallback_count,
        errors:check.errors};
    });
    assert.equal(imageRequests,1,'identical CDN image fetched only once');
    assert.equal(localized.remote,0);
    assert.equal(localized.originals,3);
    assert.equal(localized.sourceAssets,1,'binary asset reused');
    assert.equal(localized.targetImages,3,'background and repeated images remain positioned');
    assert.equal(localized.backgrounds,1);
    assert.deepEqual(localized.errors,[]);
    console.log('PASS automatic remote media retrieval, deduplication, CSS background fallback, verified target bundle');

    assert.deepEqual(errors,[]);
    await page.screenshot({path:path.join(out,'studio-images.png'),fullPage:true});
    console.log('PASS no browser errors; screenshots saved to '+out);
  }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
