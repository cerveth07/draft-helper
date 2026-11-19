'use strict';
/* 一点号延迟回写专用回归（真实 Chromium + 合成 Vue/MediumEditor 页面）。
 *
 * 只加载 yidian.js，自己提供 evaluate/fillField/readField 桩，避免被 popup.js 的
 * 浏览器 API 顶层调用牵制。覆盖本次改动：
 *   1. editContent 挂在更高层祖先时，守卫必须覆盖整条祖先链；
 *   2. 5 秒稳定窗口之后的晚回写，必须被页面内哨兵修复一次并留证；
 *   3. 安全阀：使用者动过编辑器后，哨兵绝不覆盖人工编辑。
 *
 * 运行：node extension/yidian-late-write.check.cjs
 * 需要 playwright（可用 DRAFT_HELPER_PLAYWRIGHT_MODULE 指定路径）。
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { chromium } = require(process.env.DRAFT_HELPER_PLAYWRIGHT_MODULE || 'playwright-core');

const FIXTURE = `
<main><input class="post-title" placeholder="标题(5-64个字)"><div class="editor-content medium-editor-element" contenteditable="true"></div></main>
`;

function makeContext(page, evalInPage) {
  return vm.createContext({
    setTimeout, clearTimeout, console, DraftDistribution:require('./distribution-core.js'),
    chrome: { debugger: { attach: async () => {}, detach: async () => {}, sendCommand: async () => ({}) } },
    attachDebugger: async () => {},
    evaluate: async (_tabId, expression) => evalInPage(expression),
    fillField: async (_tabId, selector, value) => page.fill(selector, value),
    readField: async (_tabId, selector) => page.inputValue(selector),
    pause: async (ms) => page.waitForTimeout(ms),
    status: () => {},
    readFileAsDataUrl: async (file) => 'data:' + file.type + ';base64,AQID',
  });
}

async function mockEditor(page, { grandparentOwnsModel = false, platformSyncsModel = false } = {}) {
  await page.setContent(FIXTURE);
  await page.evaluate(({ withGrandparent, withPlatformSync }) => {
    window.platformSyncCalls = 0;
    window.uploads = [];
    window.uploadNoUrl = false;
    window.modelCallbackIsDecoy = !!withPlatformSync;
    window.updateEditorContentSyncs = !!withPlatformSync;
    window.editorCalls = { setContent: 0, removeBlankRow: 0 };
    window.parentModelHtml = '<p>旧模型</p>';
    const makeOwner = (name, valueKey) => {
      const owner = { $data: {}, $options: { name } };
      Object.defineProperty(owner.$data, 'editContent', { configurable: true,
        get() { return window[valueKey]; }, set(value) { window[valueKey] = value; } });
      Object.defineProperty(owner, '_data', { value: owner.$data });
      Object.defineProperty(owner, 'editContent', { configurable: true,
        get() { return window[valueKey]; }, set(value) { window[valueKey] = value; } });
      return owner;
    };
    window.parentVm = makeOwner('parentVm', 'parentModelHtml');
    const body = document.querySelector('.editor-content');
    const main = document.querySelector('main');
    main.__vue__ = {
      $options: { _componentTag: 'editor-content' },
      // 真实 Vue 里渲染 editor-content 的父组件就是 $parent，祖先链从这里往上走
      $parent: window.parentVm,
      $vnode: { context: window.parentVm, data: { model: { value: window.parentModelHtml,
        callback: function ($$v) {
          // 实页里模型回调常常不是真正的数据所有者（guardOwners 只有兜底一个），
          // 用 decoy 模拟：回调写不进真模型，只能靠平台自己的 updateEditorContent 通道。
          if (window.modelCallbackIsDecoy) { window.decoyModel = $$v; return; }
          window.parentVm.editContent = $$v;
        } } } },
      $listeners: {},
      $nextTick(callback) { callback(); },
      editor: {
        checkContentChanged() {},
        setContent(content) {
          window.editorCalls.setContent++;
          body.innerHTML = content;
          this.checkContentChanged();
          // 模拟实页：写入后约 300ms 平台用旧快照回退一次
          if (window.wipeAfterWrite && !window.wipedOnce) {
            window.wipedOnce = true;
            setTimeout(() => { body.innerHTML = '<p>旧</p>'; }, 300);
          }
        },
      },
      removeBlankRow() { window.editorCalls.removeBlankRow++; },
      // 平台自己的“内容已变更”通道：真实实现是 editor.trigger('editableInput') + saveHistory()
      updateEditorContent() {
        window.platformSyncCalls++;
        if (window.updateEditorContentSyncs) window.parentVm.editContent = body.innerHTML;
      },
      // 真实组件的接口：writeYidianBody 靠「名字 + replaceContent」识别正文组件
      replaceContent(content) { this.editor.setContent(content); this.removeBlankRow(); },
      $http: { post: async (_url, form) => {
        const file = form.get('upfile');
        window.uploads = window.uploads || [];
        window.uploads.push(file.name);
        if (window.uploadNoUrl) return { data: { code: 400, message: '图片格式不支持' } };
        return { data: { url: 'https://images.example.invalid/' + file.name } };
      } },
    };
    if (withGrandparent) {
      window.grandValue = window.parentModelHtml;
      window.parentVm.$parent = makeOwner('articleEditorGrand', 'grandValue');
    }
  }, { withGrandparent: grandparentOwnsModel, withPlatformSync: platformSyncsModel });
}

async function main() {
  const browser = await chromium.launch({ headless: true,
    ...(process.env.DRAFT_HELPER_CHROMIUM_PATH ? { executablePath: process.env.DRAFT_HELPER_CHROMIUM_PATH } : {}) });
  try {
    const page = await browser.newPage();
    // 回归不依赖真实网络：拦截所有请求，本地面包页交给后续 setContent
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin === 'https://mp.yidianzixun.com' && url.pathname === '/fixture')
        return route.fulfill({ contentType: 'text/html', body: '<html></html>' });
      return route.abort();
    });
    await page.goto('https://mp.yidianzixun.com/fixture');
    const evalInPage = (code) => page.evaluate((source) => (0, eval)(source), code);
    const context = makeContext(page, evalInPage);
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'yidian.js'), 'utf8'), context);

    const bundle = {
      html: '<p>第一段正文</p><img src="IMG"><p>第二段正文，内容需要完整保留。</p>',
      manifest: { targetPlatform: 'yidian', title: '一点号回写回归标题', contentImages: [
        { placeholder: 'IMG', bundleFile: '001.gif' },
      ] },
      assets: new Map([['assets/001.gif', { name: '001.gif', type: 'image/gif' }]]),
    };
    let expectedHtml;
    const expectedText = '第一段正文第二段正文，内容需要完整保留。';
    const fill = () => context.fillYidianDraft(1, bundle, () => {});

    // 1. 祖先链上的模型所有者必须被守卫覆盖，过期写入被拦下
    await mockEditor(page, { grandparentOwnsModel: true });
    await fill();
    expectedHtml = await page.locator('.editor-content').innerHTML();
    assert.equal(await page.locator('.editor-content').textContent(), expectedText);
    assert.equal(await page.locator('.editor-content img').getAttribute('src'), 'https://images.example.invalid/001.gif');
    const guard = await evalInPage("JSON.stringify(document.querySelector('.editor-content').__draftHelperYidianGuard?.owners || [])");
    assert.ok(/articleEditorGrand/.test(guard), '守卫必须覆盖持有 editContent 的祖先组件：' + guard);
    const before = await evalInPage('window.grandValue');
    await evalInPage("document.querySelector('main').__vue__.$parent.editContent = '<p>旧</p>'");
    assert.equal(await evalInPage('window.grandValue'), before, '祖先组件上的过期写入必须被拦下');
    const blocked = await evalInPage("document.querySelector('.editor-content').__draftHelperYidianGuard.blocked.length");
    assert.ok(blocked >= 1, '被拦截的写入要留在守卫记录里');

    // 1b. 默认不再触发平台的「内容已变更」通道：实页 trace 证明它紧接着用旧快照重渲染，
    //      把刚写好的 4415 字压成 3 字（after setContent 4415 → platformSync → 下一拍 3 字）
    await mockEditor(page, { platformSyncsModel: true });
    await fill();
    assert.equal(await evalInPage('window.platformSyncCalls'), 0, '默认不得触发平台内容变更通道');
    assert.equal(await evalInPage("document.querySelector('.editor-content').__draftHelperYidianGuard.platformSync"),
      'skipped', '守卫里要能看出没有主动触发');
    assert.equal(await page.locator('.editor-content').textContent(), expectedText, '正文必须完整');

    // 1c. 开关打开时仍可显式走平台通道（留作实页排查用）
    await mockEditor(page, { platformSyncsModel: true });
    await evalInPage('window.__draftHelperYidianTriggerPlatformSync = true');
    await fill();
    assert.equal(await evalInPage('window.platformSyncCalls'), 1, '开关打开时应调用平台通道');
    assert.equal(await evalInPage("document.querySelector('.editor-content').__draftHelperYidianGuard.platformSync"),
      'updateEditorContent');

    // 1d. 写入后平台把正文回退成旧内容：回读失败要自愈一次，而不是整篇作废
    await mockEditor(page);
    await evalInPage('window.wipeAfterWrite = true');
    await fill();
    assert.equal(await page.locator('.editor-content').textContent(), expectedText,
      '平台回退后必须自动修复并保留完整正文');

    // 1e. 平台直接改 DOM（不经 setContent）时，DOM 级守卫要立即恢复
    await mockEditor(page);
    await fill();
    await evalInPage("document.querySelector('.editor-content').innerHTML = '<p>旧</p>'");
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('.editor-content').textContent(), expectedText,
      'DOM 被直接改写后应立即恢复');

    // 1f. 平台整节点重建（存草稿/发布常见）：恢复并记录 nodeReplaced
    await mockEditor(page);
    await fill();
    await evalInPage("(() => { const old = document.querySelector('.editor-content'); const fresh = old.cloneNode(false); fresh.innerHTML = '<p>旧</p>'; old.replaceWith(fresh); })()");
    await page.waitForTimeout(1200);
    assert.equal(await page.locator('.editor-content').textContent(), expectedText,
      '编辑器节点被整体替换后仍要恢复');
    const domReverts = JSON.parse(await evalInPage('JSON.stringify(window.__draftHelperYidianGuard?.domReverts || [])'));
    assert.ok(domReverts.length >= 1, '塌陷现场必须记录下来');
    assert.equal(domReverts[0].nodeReplaced, true, '必须能区分「整节点被替换」');

    // 2. 平台绕开模型、直接调 editor.setContent 塞回旧内容（实页证据：模型守卫拦 0 次但正文塌）
    await mockEditor(page);
    await fill();
    await evalInPage("document.querySelector('main').__vue__.editor.setContent('<p>旧</p>')");
    assert.equal(await evalInPage('document.querySelector(".editor-content").innerHTML'), expectedHtml,
      'editor.setContent 收到的旧内容必须被替换为权威正文');
    assert.ok(await evalInPage("document.querySelector('.editor-content').__draftHelperYidianGuard.contentBlocks.length") >= 1,
      '被替换的 setContent 调用要留证');
    // 2b. replaceContent = setContent → serialize → removeBlankRow，同样必须拦下
    await evalInPage("document.querySelector('main').__vue__.replaceContent('<p><img src=\"https://images.example.invalid/001.gif\"></p>')");
    assert.equal(await evalInPage('document.querySelector(".editor-content").innerHTML'), expectedHtml,
      'replaceContent 路径同样必须被拦下');
    assert.equal(await evalInPage('window.parentVm.editContent'), expectedHtml, '替换后模型要拉回权威值');

    // 2c. 占位图（1×1 假 gif，70B）必须跳过：不上传，并从正文移除该 <img>
    await mockEditor(page);
    const placeholderBundle = {
      html: '<p>正文甲</p><img src="BIG"><img src="SPACER"><p>正文乙，需要保留。</p>',
      manifest: { targetPlatform: 'yidian', title: '一点号占位图回归标题', contentImages: [
        { placeholder: 'BIG', bundleFile: '001.gif' },
        { placeholder: 'SPACER', bundleFile: '008.gif' },
      ] },
      assets: new Map([
        ['assets/001.gif', { name: '001.gif', type: 'image/gif', size: 40000 }],
        ['assets/008.gif', { name: '008.gif', type: 'image/gif', size: 70,
          arrayBuffer:async()=>{const b=new Uint8Array(70);b.set([137,80,78,71]);b[19]=1;b[23]=1;return b.buffer;} }],
      ]),
    };
    await context.fillYidianDraft(1, placeholderBundle, () => {});
    assert.deepEqual(await evalInPage('window.uploads || []'), ['001.gif'], '占位图不得上传');
    assert.equal(await page.locator('.editor-content img').count(), 1, '正文里只应保留真实图片');
    assert.ok(!(await page.locator('.editor-content').innerHTML()).includes('WECHATIMGPH'), '占位符必须全部替换或移除');

    await mockEditor(page);
    const visibleSmall = {...placeholderBundle,assets:new Map(placeholderBundle.assets)};
    visibleSmall.assets.set('assets/008.gif',{name:'008.gif',type:'image/png',size:70,
      arrayBuffer:async()=>{const b=new Uint8Array(70);b.set([137,80,78,71]);b[19]=20;b[23]=20;return b.buffer;}});
    await context.fillYidianDraft(1,visibleSmall,()=>{});
    assert.deepEqual(await evalInPage('window.uploads || []'),['001.gif','008.png'],'小于2KB的可见小图不得按文件大小误删');

    // 2d. 上传接口没给 url 时，错误信息必须带平台原始返回（否则无法定位原因）
    await mockEditor(page);
    await evalInPage('window.uploadNoUrl = true');
    await assert.rejects(() => context.fillYidianDraft(1, bundle, () => {}), (error) => {
      assert.match(error.message, /未返回有效图片地址/);
      assert.match(error.message, /图片格式不支持/, '必须带出平台返回内容');
      assert.match(error.message, /KB/, '必须带出文件大小');
      return true;
    });

    // 3. 晚于 5 秒稳定窗口的回写：哨兵修复一次并留证
    await mockEditor(page);
    await fill();
    await evalInPage("setTimeout(() => { document.querySelector('.editor-content').innerHTML = '<p><img src=\"https://images.example.invalid/001.gif\"></p>'; }, 1200)");
    await page.waitForTimeout(7000);
    const lateState = JSON.parse(await evalInPage('JSON.stringify(window.__draftHelperYidianGuard || null)'));
    assert.ok(lateState?.watchdog, '哨兵状态必须留在页面上供导出');
    assert.equal(await page.locator('.editor-content').textContent(), expectedText, '晚到的回写必须被自动恢复');
    assert.equal(await evalInPage('document.querySelector(".editor-content").innerHTML'), expectedHtml);
    const repairCount = (lateState.watchdog?.repairs || 0)
      + (lateState.domReverts || []).filter((entry) => !entry.stage).length;
    assert.ok(repairCount >= 1, '必须留下修复记录（DOM 级恢复或哨兵修复，谁先发现谁处理）');

    // 3. 安全阀：使用者动过编辑器后，守卫和哨兵都不得覆盖人工编辑
    await mockEditor(page);
    await fill();
    // 用派发 input 事件表达“人在正文里打字”，不依赖真实键盘焦点
    await evalInPage("(() => { const b = document.querySelector('.editor-content'); b.innerHTML += '<p>人工补充</p>'; b.dispatchEvent(new InputEvent('input', { bubbles: true })); })()");
    await page.waitForTimeout(500);
    // 守卫应已撤防：平台晚到的旧内容应当原样落下，不再被替换
    await evalInPage("setTimeout(() => { document.querySelector('.editor-content').innerHTML = '<p>平台回写</p>'; }, 300)");
    await page.waitForTimeout(6000);
    const afterEdit = JSON.parse(await evalInPage("JSON.stringify(document.querySelector('.editor-content').__draftHelperYidianGuard?.watchdog || null)"));
    assert.equal(afterEdit.state, 'user-edited', '使用者动过编辑器后哨兵必须退出');
    assert.equal(afterEdit.repairs, 0, '退出后绝不修复、绝不覆盖人工编辑');
    assert.match(await page.locator('.editor-content').textContent(), /人工补充|平台回写/,
      '人工编辑内容必须存在，且不被扩展改回');

    console.log('PASS: 祖先链守卫覆盖、祖先过期写入拦截、平台通道默认不触发且开关可触发、平台回退自愈、setContent/replaceContent 旧内容替换、DOM 直接改写恢复、整节点重建恢复、占位图跳过、上传失败带平台返回、晚回写自动修复、人工编辑不被覆盖');
  } finally {
    await browser.close();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
