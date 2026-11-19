'use strict';
// Read-only real package regression in an isolated MV3 profile, without accounts.
const {chromium}=require('playwright-core'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const extension=path.resolve(__dirname,'..'),profile=fs.mkdtempSync(path.join(os.tmpdir(),'authoring-packages-'));
const out=process.env.DRAFT_HELPER_TEST_OUTPUT||os.tmpdir();
(async()=>{const context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,viewport:{width:1550,height:1080},args:['--disable-extensions-except='+extension,'--load-extension='+extension]});
try{const page=await context.newPage(),errors=[];page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));await page.goto('chrome://extensions');const all=await page.evaluate(()=>new Promise(resolve=>chrome.developerPrivate.getExtensionsInfo({includeDisabled:true},resolve))),target=all.find(e=>e.name.startsWith('SyncPress'));assert.ok(target);assert.deepEqual(target.manifestErrors,[]);await page.goto('chrome-extension://'+target.id+'/studio.html');await page.evaluate(()=>DraftStudio.ready);
 for(const folder of process.argv.slice(2)){
  const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'))),before=fs.readFileSync(path.join(folder,'manifest.json')),raw=fs.readFileSync(path.join(folder,'raw-content.txt'));
  await page.setInputFiles('#matrix-bundle',folder);await page.waitForFunction(title=>document.querySelector('#matrix-title').value===title,manifest.title);
  const platforms=manifest.targetPlatform==='yidian'&&manifest.matrixFormat?['yidian','toutiao']:[manifest.targetPlatform];
  for(const platform of platforms){
   await page.selectOption('#matrix-platform',platform);await page.click('#matrix-format-check');await page.waitForSelector('#matrix-format-dialog[open]');
   await page.waitForFunction(()=>['matrix-source-frame','matrix-format-frame'].every(id=>{const d=document.getElementById(id).contentDocument;return d&&d.body.textContent.trim()&&[...d.images].every(image=>image.complete&&image.naturalWidth>0)}));
   assert.equal(await page.evaluate(()=>document.getElementById('matrix-source-frame').contentDocument.querySelector('script,iframe,form')),null);
   const count=await page.frameLocator('#matrix-format-frame').locator('img').count();assert.ok(count>0);
   if(manifest.matrixFormat)assert.equal(count,JSON.parse(fs.readFileSync(path.join(folder,'matrix-format.json'))).platforms[platform].contentImages.length);
   const sourceCount=await page.frameLocator('#matrix-source-frame').locator('img').count();assert.ok(sourceCount>0);if(!manifest.matrixFormat)assert.equal(count,manifest.contentImages.length);
   if(manifest.matrixFormat){fs.mkdirSync(out,{recursive:true});await page.screenshot({path:path.join(out,'real-package-'+platform+'.png')});}
   await page.locator('[data-close=matrix-format-dialog]').click();console.log('PASS real package '+path.basename(folder)+' -> '+platform+': '+sourceCount+' source / '+count+' target decoded images and sealed source preserved');
  }
  assert.deepEqual(fs.readFileSync(path.join(folder,'manifest.json')),before);assert.deepEqual(fs.readFileSync(path.join(folder,'raw-content.txt')),raw);
 }
 assert.deepEqual(errors,[]);
}catch(error){const pages=context.pages(),page=pages.at(-1);if(page){console.error(await page.evaluate(()=>['matrix-source-frame','matrix-format-frame'].map(id=>{const d=document.getElementById(id)?.contentDocument;return {id,images:d?[...d.images].map(i=>({src:i.getAttribute('src')?.slice(0,90),complete:i.complete,width:i.naturalWidth})):null};})).catch(()=>null));await page.screenshot({path:path.join(out,'real-package-failure.png')}).catch(()=>{});}throw error;}
finally{await context.close();const target=path.resolve(profile);if(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('authoring-packages-'))fs.rmSync(target,{recursive:true,force:true});}})().catch(error=>{console.error(error);process.exitCode=1});
