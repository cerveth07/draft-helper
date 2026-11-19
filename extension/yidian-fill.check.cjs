'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require(process.env.DRAFT_HELPER_PLAYWRIGHT_MODULE || 'playwright-core');

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.DRAFT_HELPER_CHROMIUM_PATH ? { executablePath: process.env.DRAFT_HELPER_CHROMIUM_PATH } : {}) });
  try {
    const page = await browser.newPage();
    let uploads = [];
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://mp.yidianzixun.com' && url.pathname === '/fixture')
        return route.fulfill({ contentType: 'text/html', body: '<html></html>' });
      return route.abort();
    });
    await page.goto('https://mp.yidianzixun.com/fixture');
    const cdp = await page.context().newCDPSession(page);
    const messages = [];
    const context = vm.createContext({
      document: { querySelector: () => ({ addEventListener() {}, dataset: {}, files: [], value: '', selectedOptions: [] }), getElementById: () => null },
      window: { addEventListener() {} },
      DraftStudio: { targetTab: async () => null },
      chrome: {
        tabs: { query: async () => [] },
        debugger: { attach: async () => {}, detach: async () => {},
          sendCommand: (_target, method, params) => cdp.send(method, params) },
        scripting: { executeScript: async ({ func, args }) => [{ result: await page.evaluate(
          ({ fn, args }) => eval('(' + fn + ')')(...(args || [])), { fn: func.toString(), args }) }] },
      }, setTimeout,
    });
    for (const name of ['bundle-locator.js', 'yidian.js', 'popup.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, name), 'utf8'), context);
    assert.equal(vm.runInContext('YIDIAN_UPLOAD_BUILD', context), 'headline-contract-0.4.43');
    context.readFileAsDataUrl = async (file) => 'data:' + file.type + ';base64,AQID';
    const setup = async () => {
      await page.setContent('<main><input class="post-title" placeholder="标题(5-64个字)"><div class="editor-content medium-editor-element" contenteditable="true"></div><input class="upload-input" type="file" accept="*/*" hidden></main>');
      await page.evaluate(() => {
        window.videoUploads = 0;
        window.legacyExecCommandCalls = 0;
        window.uploadResponse = null;
        window.uploadSameUrl = false;
        window.corruptEditorContent = false;
        window.resetBodyAfterChange = false;
        window.editorCalls = { replaceContent: 0, setContent: 0, serialize: 0, removeBlankRow: 0, triggerChange: 0, updateEditorContent: 0, checkContentChanged: 0 };
        window.parentModelHtml = '<p>旧模型</p>';
        window.parentVm = {};
        Object.defineProperty(window.parentVm, 'editContent', { configurable: true,
          get() { return window.parentModelHtml; }, set(value) { window.parentModelHtml = value; } });
        window.parentVm.$data = {};
        Object.defineProperty(window.parentVm.$data, 'editContent', { configurable: true,
          get() { return window.parentModelHtml; }, set(value) { window.parentModelHtml = value; } });
        window.parentVm.$options = { name: 'articleEditor' };
        window.uploads = [];
        document.querySelector('.upload-input').addEventListener('change', () => { window.videoUploads++; });
        document.execCommand = () => {
          window.legacyExecCommandCalls++;
          document.querySelector('.editor-content').innerHTML = '<p><img src="https://images.example.invalid/cover.png"></p>';
          return true;
        };
        const body = document.querySelector('.editor-content');
        document.querySelector('main').__vue__ = {
          $options: { _componentTag: 'editor-content' },
          $vnode: { context: window.parentVm, data: { model: { value: window.parentModelHtml,
            callback: function($$v) {
              window.parentVm.editContent = $$v;
              if (window.resetBodyAfterChange) setTimeout(() => { window.parentVm.editContent = '<p>xxx</p>'; }, 1000);
            } } } },
          $listeners: {},
          $nextTick(callback) { callback(); },
          editor: { checkContentChanged() {
            window.editorCalls.checkContentChanged++;
            if (window.resetBodyAfterChange) setTimeout(() => {
              body.innerHTML = '<p>xxx</p>';
              window.parentVm.editContent = '<p>xxx</p>';
            }, 50);
          },
            setContent(content) {
            window.editorCalls.setContent++;
            body.innerHTML = window.corruptEditorContent ? '<p>部分内容</p>' : content;
            this.checkContentChanged();
          } },
          replaceContent(content) {
            window.editorCalls.replaceContent++;
            this.editor.setContent(content);
            this.serialize(); this.removeBlankRow(); this.triggerChange();
          },
          serialize() {
            window.editorCalls.serialize++;
            // Reproduce the live Vue $plugin-serialize listener restoring stale data.
            document.querySelector('.editor-content').innerHTML = '<p>旧</p>';
          },
          removeBlankRow() { window.editorCalls.removeBlankRow++; },
          updateEditorContent() { window.editorCalls.updateEditorContent++; },
          triggerChange() { window.editorCalls.triggerChange++;
            if (window.resetBodyAfterChange) setTimeout(() => { body.innerHTML = '<p>xxx</p>'; }, 50); },
          $http: { post: async (url, form, config) => {
          const file = form.get('upfile');
          window.uploads.push({ url, timeout: config.timeout, name: file.name, type: file.type,
            bytes: [...new Uint8Array(await file.arrayBuffer())] });
          if (window.uploadResponse?.error) throw new Error(window.uploadResponse.error);
          return { data: window.uploadResponse?.data || { url: 'https://images.example.invalid/'
            + (window.uploadSameUrl ? 'same-image.png' : file.name) } };
        } } };
        document.querySelector('.post-title').addEventListener('input', (event) => { window.boundTitle = event.target.value; });
      });
    };
    const bundle = {
      html: '<p>每日亮点内容推介</p><p><img src="COVER"></p><p>节目二正文：原有内容保持完整。</p><img src="GIF"><p>固定尾部</p>',
      manifest: { targetPlatform: 'yidian', title: '矩阵指数 |节目二的新看点', contentImages: [
        { placeholder: 'GIF', bundleFile: '001.gif' }, { placeholder: 'COVER', bundleFile: 'cover.png' },
      ] },
      assets: new Map([['assets/001.gif', { name: '001.gif', type: 'image/gif' }],
        ['assets/cover.png', { name: 'cover.png', type: 'image/png' }]]),
    };
    const fill = () => context.fillYidianDraft(1, bundle, (value) => messages.push(value));
    await setup();
    assert.equal(await page.evaluate(() => typeof document.querySelector('.editor-content').parentElement.__vue__.$http.post), 'function');
    await fill();
    assert.equal(await page.evaluate(() => window.legacyExecCommandCalls), 0);
    assert.deepEqual(await page.evaluate(() => window.editorCalls),
      { replaceContent: 0, setContent: 1, serialize: 0, removeBlankRow: 1, triggerChange: 0, updateEditorContent: 0, checkContentChanged: 0 });
    assert.equal(await page.locator('.post-title').inputValue(), bundle.manifest.title);
    assert.equal(await page.evaluate(() => window.parentModelHtml), await page.locator('.editor-content').innerHTML());
    assert.equal(await page.evaluate(() => window.boundTitle), bundle.manifest.title);
    assert.deepEqual(await page.locator('.editor-content img').evaluateAll((images) => images.map((img) => img.src)),
      ['https://images.example.invalid/cover.png', 'https://images.example.invalid/001.gif']);
    uploads = await page.evaluate(() => window.uploads);
    assert.deepEqual(uploads.map((item) => item.bytes), [[1, 2, 3], [1, 2, 3]]);
    assert.equal(uploads[0].type, 'image/gif');
    assert.equal(uploads[0].url, '/upload?action=uploadimage&picType=wemedia_cnt');
    assert.equal(uploads[0].timeout, 30000);
    assert.ok(messages.at(-1).includes('回读核对'));

    await setup();
    await page.evaluate(() => document.body.insertAdjacentHTML('afterbegin', '<input class="post-title" hidden value="隐藏标题"><div class="editor-content medium-editor-element" contenteditable="true" style="display:none">隐藏正文</div>'));
    await fill();
    assert.equal(await page.locator('input.post-title:not([hidden])').inputValue(), bundle.manifest.title);
    assert.equal(await page.locator('input.post-title[hidden]').inputValue(), '隐藏标题');
    assert.equal(await page.locator('.editor-content[style]').textContent(), '隐藏正文');

    await setup();
    await page.evaluate(() => { window.uploadSameUrl = true; });
    await fill();
    assert.equal(await page.locator('.editor-content img').count(), 2);

    await setup();
    await page.locator('.editor-content').fill('已有稿件');
    await assert.rejects(fill(), /正文已有内容/);
    assert.deepEqual(await page.evaluate(() => window.uploads), []);

    await setup();
    await page.locator('.post-title').fill('已有其他标题');
    await assert.rejects(fill(), /其他标题/);
    assert.deepEqual(await page.evaluate(() => window.uploads), []);

    await setup();
    await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<input class="upload-input" type="file">'));
    await fill();
    assert.equal(await page.evaluate(() => window.videoUploads), 0);

    await setup();
    await page.evaluate(() => { window.corruptEditorContent = true; });
    await assert.rejects(fill(), (error) => /正文回读/.test(error.message)
      && /实际 4 字，预期 27 字/.test(error.message) && /after setContent/.test(error.message));

    await setup();
    await page.evaluate(() => { delete document.querySelector('main').__vue__.$vnode.data.model; });
    await assert.rejects(fill(), /未找到一点号正文的 Vue 双向绑定回调/);

    await setup();
    await page.evaluate(() => { window.resetBodyAfterChange = true; });
    await fill();
    assert.equal(await page.locator('.editor-content').textContent(), '每日亮点内容推介节目二正文：原有内容保持完整。固定尾部');
    assert.equal(await page.evaluate(() => window.parentModelHtml), await page.locator('.editor-content').innerHTML());
    assert.ok(await page.evaluate(() => document.querySelector('.editor-content').__draftHelperYidianGuard?.blocked.length > 0));

    await assert.rejects(context.fillYidianDraft(1, { ...bundle, manifest: { ...bundle.manifest, targetPlatform: 'wechat' } }), /专用准备包/);
    await setup();
    await page.evaluate(() => { window.uploadResponse = { error: 'Request failed with status code 415' }; });
    await assert.rejects(fill(), /status code 415/);
    assert.equal(await page.locator('.editor-content').innerHTML(), '');
    assert.equal(await page.locator('.post-title').inputValue(), '');
    await setup();
    await page.evaluate(() => { window.uploadResponse = { data: { error: 'upload failed' } }; });
    await assert.rejects(fill(), /未返回有效图片地址/);
    assert.equal(await page.locator('.editor-content').innerHTML(), '');
    await setup();
    await page.evaluate(() => { document.querySelector('main').__vue__ = {}; });
    await assert.rejects(context.uploadImageToYidian(1, bundle.assets.get('assets/001.gif')), /未找到一点号编辑器图片上传服务/);
    await assert.rejects(context.uploadImageToYidian(1, { name: '001.mp4', type: 'video/mp4' }), /无法识别图片格式/);

    // Generate a small WebP fixture so this regression does not depend on a dated article package.
    const webp = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 12; canvas.height = 7;
      canvas.getContext('2d').fillRect(0, 0, 12, 7);
      return canvas.toDataURL('image/webp');
    });
    assert.ok(webp.startsWith('data:image/webp;'));
    context.readFileAsDataUrl = async () => webp;
    await setup();
    const originalSize = [12, 7];
    assert.equal(await context.uploadImageToYidian(1, { name: 'cover.webp', type: 'image/webp' }),
      'https://images.example.invalid/cover.png');
    uploads = await page.evaluate(() => window.uploads);
    assert.equal(uploads[0].type, 'image/png');
    assert.deepEqual(uploads[0].bytes.slice(0, 8), [137, 80, 78, 71, 13, 10, 26, 10]);
    const png = Buffer.from(uploads[0].bytes);
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], originalSize);

    console.log('PASS: editor Axios/XSRF path, video uploader untouched, original GIF bytes, full-size WebP conversion, HTML/title binding, image order, existing draft protection, Axios/response errors, missing editor service, platform mismatch');
  } finally {
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
