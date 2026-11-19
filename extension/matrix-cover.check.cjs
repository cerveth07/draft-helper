'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const {chromium} = require(process.env.DRAFT_HELPER_PLAYWRIGHT_MODULE || 'playwright-core');
const {matrixCoverSetInPage, matrixCoverInspectInPage} = require('./matrix-cover.js');

(async () => {
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    const original = 'data:image/png;base64,AQID';
    async function apply(html, opts = {}) {
      await page.setContent(html);
      if (opts.updatePreview) {
        await page.evaluate(() => {
          document.querySelector('#cover-picker').addEventListener('change', (event) => {
            const img = document.createElement('img');
            img.src = URL.createObjectURL(event.target.files[0]);
            document.querySelector('.article-cover').append(img);
          });
        });
      }
      return page.evaluate(async ({source, args}) =>
        (0,eval)('(' + source + ')')(...args), {
          source: matrixCoverSetInPage.toString(),
          args:[original,'cover.png','image/png',3],
        });
    }
    const markup = '<div class="article-cover"><label for="cover-picker">设置封面</label>'
      + '<input id="cover-picker" type="file" accept="image/*" hidden></div>';
    let result = await apply(markup, {updatePreview:true});
    assert.equal(result.status, 'preview_changed_needs_review');
    assert.equal(result.coverFile, 'cover.png');
    assert.equal(await page.locator('#cover-picker').evaluate(e => e.files[0].name), 'cover.png');
    assert.equal(await page.locator('#cover-picker').evaluate(e => e.files[0].size), 3);

    result = await apply(markup);
    assert.equal(result.status, 'manual_required');
    assert.match(result.reason, /未验证到封面区域/);

    result = await apply('<div id="generic-form"><input id="cover-picker" type="file" accept="image/*"></div>');
    assert.equal(result.status, 'manual_required');
    assert.match(result.reason, /封面预览区域不明确/);

    result = await apply('<div><input id="body-image" type="file" accept="image/*"></div>');
    assert.equal(result.status, 'manual_required');
    assert.equal(result.detectedCoverInputs, 0);
    assert.equal(await page.locator('#body-image').evaluate(e => e.files.length), 0);

    result = await apply(markup + markup.replaceAll('cover-picker','cover-picker-2'));
    assert.equal(result.status, 'manual_required');
    assert.equal(result.detectedCoverInputs, 2);

    await page.setContent(markup + '<input type="file" id="video-file" accept="video/*">');
    const inspection = await page.evaluate(matrixCoverInspectInPage);
    assert.ok(inspection.coverFileInputs.some(v => v.contexts.length));
    assert.ok(inspection.coverControls.some(v => v.text.includes('设置封面')));
    assert.ok(!JSON.stringify(inspection).includes('data:image'));

    await page.setContent(markup);
    await assert.rejects(page.evaluate(async ({source,args}) =>
      (0,eval)('(' + source + ')')(...args), {
        source:matrixCoverSetInPage.toString(),
        args:[original,'cover.png','image/png',4],
      }), /大小与已核验准备包不一致/);
    assert.equal(await page.locator('#cover-picker').evaluate(e => e.files.length),0);

    console.log('PASS: native cover selector, exact original file handoff, preview proof,'
      +' absent/ambiguous controls, no guessed body-input selection, wrong-byte rejection and read-only diagnosis');
  } finally { await browser.close(); }
})().catch(e => {console.error(e);process.exitCode=1;});
