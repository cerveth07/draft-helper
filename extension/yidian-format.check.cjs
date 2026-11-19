'use strict';
// Regression for observed save/reopen behavior: CSS colors/font sizes/indent are stripped,
// FONT presentation attributes, text-align and text spaces survive. No live account requests.
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
    await page.route('**/*', route => route.abort());
    await page.setContent('<style>.editor-content{font:17px Arial;color:#253545}.editor-content blockquote *{font-size:15px;color:#222}</style>'
      + '<input class="post-title" value="保持标题"><div class="editor-content medium-editor-element" contenteditable="true"></div>');
    const context = vm.createContext({});
    vm.runInContext(fs.readFileSync(path.join(__dirname, 'yidian.js'), 'utf8'), context);
    const invoke = (html, action) => page.evaluate(({ fn, html, action }) =>
      eval('(' + fn + ')')(html, action), { fn: context.yidianFormat.toString(), html, action });
    const source = '<section style="color:#00b0f0;font-size:15px;text-indent:2em">'
      + '<p style="text-align:justify"><span style="text-indent:2em">彩色正文</span><span style="color:#f00;text-indent:2em">红色重点</span></p>'
      + '<p style="text-indent:0;text-align:center;font-size:24px;font-weight:700">居中标题</p></section>'
      + '<blockquote><p style="color:#0780ff;font-size:16px">嵌套引用</p></blockquote>'
      + '<blockquote style="color:#0780ff;font-size:16px">直接引用</blockquote>'
      + '<p style="text-indent:0">\u3000\u3000已有缩进</p>'
      + '<p><a href="https://example.com/article"><b>链接加粗</b></a></p>'
      + '<p style="color:#fff;background:#2570c0">底块白字</p>';
    const before = await page.locator('.editor-content').innerHTML();
    const plan = await invoke(source);
    assert.equal(await page.locator('.editor-content').innerHTML(), before, 'preparation must not write into the draft');
    assert.equal(await page.locator('iframe').count(), 0, 'measurement frame must be removed');
    assert.equal(plan.indentCount, 1);
    assert.deepEqual(plan.fontMappings, [{ from: 15, to: 16 }]);
    assert.equal(plan.contrastFallbacks, 1);
    assert.ok(plan.warnings.some(x => x.includes('2 处引用块')));
    await page.locator('.editor-content').evaluate((el, html) => { el.innerHTML = html; }, plan.html);
    // Simulate the server's observed CSS whitelist before reopening in a fresh DOM subtree.
    await page.locator('.editor-content').evaluate(el => {
      const saved = el.cloneNode(true);
      saved.querySelectorAll('[style]').forEach(node => {
        const align = node.style.textAlign; node.removeAttribute('style');
        if (align) node.style.textAlign = align;
      });
      el.innerHTML = saved.innerHTML;
    });
    assert.equal((await invoke(plan.html, 'verify')).stylesMatch, true);
    const measured = await page.locator('.editor-content p').first().evaluate(el => {
      const text = el.querySelector('font').firstChild;
      const range = document.createRange(); range.setStart(text, 2); range.setEnd(text, 3);
      return { text: el.textContent, offset: range.getBoundingClientRect().left - el.getBoundingClientRect().left,
        color: getComputedStyle(el.querySelector('font')).color,
        red: getComputedStyle(el.querySelectorAll('font')[1]).color };
    });
    assert.equal(measured.text, '\u3000\u3000彩色正文红色重点');
    assert.equal((measured.text.match(/\u3000/g) || []).length, 2, 'inline spans must not add mid-sentence indents');
    assert.ok(Math.abs(measured.offset - 32) < 1, 'first glyph should start two 16px characters into the line');
    assert.equal(measured.color, 'rgb(0, 176, 240)');
    assert.equal(measured.red, 'rgb(255, 0, 0)');
    assert.equal(await page.locator('.editor-content blockquote').count(), 0);
    assert.equal(await page.locator('.editor-content a').getAttribute('href'), 'https://example.com/article');
    assert.equal(await page.locator('.post-title').inputValue(), '保持标题');
    const second = await invoke(plan.html);
    assert.equal(second.indentCount, 0, 're-import must not double existing indent spaces');
    await assert.rejects(invoke('<svg><rect width="20" height="20"/></svg>'), /SVG/);
    assert.equal(await page.locator('iframe').count(), 0, 'failure must also remove the frame');
    // Same-text style loss must fail verification rather than be reported as successful import.
    await page.locator('.editor-content font').first().evaluate(el => el.removeAttribute('color'));
    await assert.rejects(invoke(plan.html, 'verify'), /颜色、字号或强调格式不一致/);
    console.log('PASS yidian format: saved colors, font fallback, two-character indent, nested spans/quotes, links, cleanup and style-loss detection');
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
