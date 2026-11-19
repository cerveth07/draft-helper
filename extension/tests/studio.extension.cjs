'use strict';
const {chromium}=require(process.env.DRAFT_HELPER_PLAYWRIGHT_MODULE||'playwright-core');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=process.env.DRAFT_HELPER_TEST_OUTPUT||path.resolve(root,'../test-results');
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'draft-helper-extension-')),{channel:'chromium',headless:true,viewport:{width:1500,height:1050},args:['--disable-extensions-except='+root,'--load-extension='+root]});
  try{
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
    await page.goto('chrome://extensions');
    const extensions=await page.evaluate(()=>new Promise(resolve=>chrome.developerPrivate.getExtensionsInfo({includeDisabled:true,includeTerminated:true},resolve)));
    const target=extensions.find(x=>x.name.startsWith('SyncPress'));assert.ok(target,'extension is loaded');assert.deepEqual(target.manifestErrors,[]);
    await page.goto('chrome-extension://'+target.id+'/studio.html');await page.evaluate(()=>DraftStudio.ready);
    await page.click('#sample');await page.waitForFunction(()=>DraftStudio.snapshot().html.includes('把注意力'));
    await page.click('#mode-adjust');await page.fill('#global-fontSize','19');await page.locator('#global-fontSize').blur();
    assert.equal(await page.frameLocator('#article-frame').locator('p').first().evaluate(el=>getComputedStyle(el).fontSize),'19px');
    await page.setInputFiles('#source-file',{name:'external-style.html',mimeType:'text/html',buffer:Buffer.from('<html><head><style>p{font-size:20px;color:#125544}</style></head><body><p>隔离环境中正确保留原稿样式。</p></body></html>')});
    await page.waitForFunction(()=>DraftStudio.snapshot().html.includes('隔离环境'));
    assert.equal(await page.frameLocator('#article-frame').locator('p').evaluate(el=>getComputedStyle(el).fontSize),'20px');
    // Import confirmation belongs to this isolated test profile only.
    assert.deepEqual(errors,[]);
    console.log('PASS unpacked MV3 extension loads; sandboxed preview and editing work in real extension origin: '+target.id);
    await page.screenshot({path:path.join(out,'studio-extension.png'),fullPage:true});
  }finally{await context.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
