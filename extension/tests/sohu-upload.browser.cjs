'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require(process.env.DRAFT_HELPER_PLAYWRIGHT_MODULE||'playwright-core');
const scope=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../other-platforms.js'),'utf8'),scope);
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent('<button class="ql-image">图片</button><div class="ql-editor" contenteditable="true"><p><br></p></div>');
  await page.evaluate(()=>{
   window.received=[];
   document.querySelector('.ql-image').onclick=()=>{
    const dialog=document.createElement('div');dialog.className='win-mask';
    dialog.innerHTML='<div class="local-upload"><div class="upload-area"><input type="file"></div><div class="bottom-buttons"><p class="disable-button">确定</p><p class="negative-button">取消</p></div></div>';
    document.body.append(dialog);
    dialog.querySelector('.negative-button').onclick=()=>dialog.remove();
    dialog.querySelector('input').onchange=async event=>{
     const file=event.target.files[0];window.received.push({name:file.name,type:file.type});
     if(window.rejectQr){dialog.querySelector('.upload-area').append(document.createTextNode('图片不能包含二维码'));return;}
     const reader=new FileReader();const data=await new Promise(resolve=>{reader.onload=()=>resolve(reader.result);reader.readAsDataURL(file);});
     const holder=document.createElement('div');holder.className='img-wrapper';
     const image=new Image();image.className='upload-item';image.src=data;holder.append(image);dialog.querySelector('.upload-area').append(holder);
     await image.decode();
     setTimeout(()=>{
      const button=dialog.querySelector('.disable-button');button.className='positive-button';
      button.onclick=()=>{
       const box=document.createElement('div');box.className='ql-image-container';box.contentEditable='false';
       box.innerHTML='<img src="'+data+'"><span class="img-desc" data-desc="" contenteditable="true">点击添加图片描述（最多60个字）</span><span class="img-edit">编辑</span>';
       document.querySelector('.ql-editor').append(box);dialog.remove();
      };
     },150);
    };
   };
  });
  const call=(name,...args)=>page.evaluate('('+scope[name].toString()+')('+args.map(arg=>typeof arg==='function'?'('+arg.toString()+')':JSON.stringify(arg)).join(',')+')');
  const encoded=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=64;canvas.height=32;canvas.getContext('2d').fillRect(0,0,64,32);return canvas.toDataURL('image/webp');});
  const started=await call('portalStartSohuImageUpload',encoded,'source.webp','image/webp','.ql-editor',scope.portalImages,scope.portalUploadBodyText);
  assert.equal(started.accepted,true);assert.equal(started.converted,true);assert.equal(started.uploadedName,'source.png');
  assert.deepEqual(await page.evaluate(()=>window.received),[{name:'source.png',type:'image/png'}]);
  assert.equal((await call('portalSohuImageUploadState')).ready,false,'thumbnail readiness alone must not confirm an upload');
  await page.waitForSelector('.bottom-buttons .positive-button');
  assert.equal((await call('portalSohuImageUploadState',true)).ready,true);
  const state=await call('portalBodyEmpty','搜狐号','.ql-editor');
  assert.equal(state.textLength,0,'image controls and empty caption placeholders are excluded');assert.equal(state.mediaCount,1);
  await page.evaluate(()=>{document.querySelector('.ql-editor').innerHTML='<p><br></p>';window.rejectQr=true;});
  await call('portalStartSohuImageUpload',encoded,'source.webp','image/webp','.ql-editor',scope.portalImages,scope.portalUploadBodyText);
  await assert.rejects(call('portalSohuImageUploadState'),/搜狐拒绝包含二维码/);
  await call('portalCancelSohuImageUpload');assert.equal(await page.locator('.win-mask').count(),0);
  console.log('PASS Sohu native upload: WebP copy -> PNG, delayed confirm, image-widget text exclusion, explicit QR rejection and safe dialog cancellation.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
