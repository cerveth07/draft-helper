'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.DRAFT_HELPER_PLAYWRIGHT_MODULE || 'playwright-core');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    const cdp = await page.context().newCDPSession(page);
    const context = vm.createContext({ setTimeout,attachDebugger:async()=>{},
      evaluate:async(_tab,expression)=>{const r=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;},
      pause:ms=>new Promise(resolve=>setTimeout(resolve,ms)),
      fillField:async(_tab,selector,value)=>page.locator(selector).fill(value),
      readField:async(_tab,selector)=>page.locator(selector).inputValue(),
      chrome: { debugger: { attach: async () => {}, detach: async () => {},
        sendCommand: (_target, method, params) => cdp.send(method, params) } } });
    vm.runInContext(fs.readFileSync(path.join(__dirname,'toutiao.js'),'utf8'),context);
    context.readFileAsDataUrl = async file => 'data:' + file.type + ';base64,AQID';
    const setup = async (scheme = 'https', replace = false, sameUrl = false, decorated = false) => {
      await page.setContent('<textarea placeholder="请输入文章标题（2～30个字）"></textarea><div class="ProseMirror" contenteditable="true" style="min-height:40px"><p><br></p></div>');
      await page.evaluate(({ scheme, replace, sameUrl, decorated }) => {
        window.uploaded = [];
        document.addEventListener('paste', async event => {
          if (!event.target.matches('.ProseMirror')) return;
          event.preventDefault();
          const file = event.clipboardData.files[0];
          if (file) {
            window.uploaded.push({ type: file.type, bytes: [...new Uint8Array(await file.arrayBuffer())] });
            let body = event.target;
            if (replace) { const copy = body.cloneNode(true); body.replaceWith(copy); body = copy; }
            const img = document.createElement('img');
            img.src = scheme + '://images.example.invalid/' + (sameUrl ? 'same-image.png' : file.name);
            img.style.cssText = 'width:320px;height:120px';
            body.append(img);
            if (decorated) {
              const toolbar = document.createElement('button'); toolbar.innerHTML = '<img src="https://images.example.invalid/icon.png" width="16" height="16">编辑'; body.append(toolbar);
              const hidden = img.cloneNode(); hidden.style.display = 'none'; body.append(hidden);
            }
          } else {
            if (decorated) event.target.innerHTML = event.clipboardData.getData('text/html');
            else event.target.insertAdjacentHTML('beforeend', event.clipboardData.getData('text/html'));
            for (const [index, image] of [...event.target.querySelectorAll('img')].entries()) {
              image.style.cssText = 'width:320px;height:120px';
              if (decorated) image.src = 'https://cdn.example.invalid/rewritten/' + index;
            }
            if (decorated) {
              const toolbar = document.createElement('button'); toolbar.innerHTML = '<img src="https://images.example.invalid/icon.png" width="16" height="16">搜图'; event.target.append(toolbar);
            }
          }
        });
      }, { scheme, replace, sameUrl, decorated });
    };
    const bundle = { html: '<p>每日亮点内容推介</p><p>节目正文</p><img src="ONE"><img src="TWO">',
      manifest: { targetPlatform: 'toutiao', title: '矩阵指数 |《节目二》新看点', contentImages: [
        { placeholder: 'ONE', bundleFile: '001.jpg' }, { placeholder: 'TWO', bundleFile: '002.gif' }] },
      assets: new Map([['assets/001.jpg', { name: '001.jpg', type: 'image/jpeg' }],
        ['assets/002.gif', { name: '002.gif', type: 'image/gif' }]]) };
    for (const options of [['https', false, false], ['http', true, false], ['https', true, true], ['https', true, true, true]]) {
      await setup(...options);
      await context.fillToutiaoDraft(1, bundle, () => {});
      assert.equal(await page.locator('textarea').inputValue(), bundle.manifest.title);
      assert.equal(await page.locator('.ProseMirror img:not(button img):not([style*="display: none"])').count(), 2);
      assert.deepEqual(await page.evaluate(() => window.uploaded.map(x => x.bytes)), [[1, 2, 3], [1, 2, 3]]);
      assert.equal((await page.evaluate(() => window.uploaded))[1].type, 'image/gif');
    }
    await setup();
    await page.evaluate(()=>{document.querySelector('.ProseMirror').pmViewDesc={node:{descendants:fn=>{if(window.uploaded.length)fn({type:{name:'image'},attrs:{data:{backUpUrl:'https://images.example.invalid/original.jpg',backNaturalWidth:193,backNaturalHeight:179,naturalWidth:386,naturalHeight:358}}});}}};});
    assert.equal(await context.uploadImageToToutiao(1,bundle.assets.get('assets/001.jpg')),'https://images.example.invalid/original.jpg','use the platform original rather than its auto-enhanced preview');
    // The shared Yidian package may carry a long title, but the verified
    // shortened WeChat title must be filled into the Toutiao editor.
    await setup();
    const shared = { ...bundle, toutiaoShortTitle: '矩阵指数 |《节目一》位列黄金档第一',
      manifest: { ...bundle.manifest, targetPlatform: 'yidian',
                  compatiblePlatforms: ['yidian', 'toutiao'],
                  platformOptions: { toutiao: { fillTitle: false } },
                  title: '长'.repeat(40) } };
    await context.fillToutiaoDraft(1, shared, () => {});
    assert.equal(await page.locator('textarea').inputValue(), shared.toutiaoShortTitle);
    await setup();
    await page.locator('textarea').fill('已有不同标题');
    await assert.rejects(context.fillToutiaoDraft(1, shared, () => {}), /已有其他标题/);
    assert.equal(await page.locator('textarea').inputValue(), '已有不同标题');
    await setup();
    await page.locator('.ProseMirror').fill('已有稿件');
    await assert.rejects(context.fillToutiaoDraft(1, bundle, () => {}), /检测到有效文字/);
    await setup();
    await page.evaluate(() => { window.DataTransfer = class { constructor() { throw new Error('模拟上传异常'); } }; });
    await assert.rejects(context.uploadImageToToutiao(1, bundle.assets.get('assets/001.jpg')), /模拟上传异常/);
    console.log('PASS: awaited upload result, HTTP/HTTPS, editor replacement, duplicate CDN URLs, unchanged bytes/GIF, body/title readback, existing draft protection, exception propagation, toolbar, hidden preview images, and platform CDN URL rewriting');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
