'use strict';
// The existing isolated MV3 harness is needed to load the unpacked extension.
// chrome-use's test runner does not provide an unpacked-extension launch flag.
const {chromium}=require('playwright-core'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const extension=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'matrix-studio-'));
const [shared,sohu,out]=process.argv.slice(2);
(async()=>{const browser=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1500,height:1100},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
try{const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('chrome://extensions');
 const all=await page.evaluate(()=>new Promise(resolve=>chrome.developerPrivate.getExtensionsInfo({includeDisabled:true},resolve)));const info=all.find(e=>e.name.startsWith('SyncPress'));assert.ok(info);assert.deepEqual(info.manifestErrors,[]);
 await page.goto('chrome-extension://'+info.id+'/studio.html');await page.evaluate(()=>DraftStudio.ready);
 for(const [folder,targets]of [[shared,['yidian','toutiao']],[sohu,['sohu']]]){
  await page.setInputFiles('#matrix-bundle',folder);await page.waitForFunction(()=>document.querySelector('#matrix-bundle-status').textContent.startsWith('已选择：'));
  for(const target of targets){await page.selectOption('#matrix-platform',target);const index=JSON.parse(fs.readFileSync(path.join(folder,'matrix-format.json'))).platforms[target];
   await page.waitForFunction(title=>document.querySelector('#matrix-title').value===title,index.title);
   await page.waitForFunction(count=>document.querySelectorAll('#matrix-log-entries li').length===count,JSON.parse(fs.readFileSync(path.join(folder,index.files.report))).processing_log.length);
   if(!await page.locator('#matrix-layout-check').isVisible())await page.click('#matrix-advanced > summary');
   await page.click('#matrix-layout-check');await page.waitForFunction(()=>!document.querySelector('#matrix-export').disabled);
   await page.click('#matrix-format-check');await page.waitForSelector('#matrix-format-dialog[open]');assert.match(await page.locator('#matrix-format-title').textContent(),new RegExp(index.title.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
   const frame=page.frameLocator('#matrix-format-frame');await frame.locator('img').first().waitFor();
   await page.waitForFunction(()=>{const doc=document.querySelector('#matrix-format-frame').contentDocument;return doc&&[...doc.images].every(i=>i.complete&&i.naturalWidth>0)});
   assert.equal(await frame.locator('img').count(),index.contentImages.length);
   if(out){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'workbench-'+target+'.png')});}
   await page.keyboard.press('Escape');await page.click('#export-menu > summary');const downloadPromise=page.waitForEvent('download');await page.click('#matrix-export');const download=await downloadPromise;const zip=fs.readFileSync(await download.path());
   assert.ok(zip.includes(Buffer.from('matrix-'+target+'-content.txt')));assert.ok(zip.includes(Buffer.from('raw-content.txt')));assert.ok(zip.includes(Buffer.from('matrix-format.json')));
   console.log('PASS workbench import, '+target+' title/log/layout/preview, '+index.contentImages.length+' decoded images and complete sealed ZIP');
  }
 }
 assert.deepEqual(errors,[]);
}finally{await browser.close();fs.rmSync(profile,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
