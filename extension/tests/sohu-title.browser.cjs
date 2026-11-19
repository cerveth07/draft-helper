'use strict';
const {chromium}=require(process.env.DRAFT_HELPER_PLAYWRIGHT_MODULE||'playwright-core');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const popup=fs.readFileSync(path.join(root,'popup.js'),'utf8');
const selector='input[placeholder="请输入标题（5-72字）"]';
const title='AI时代，传播需要“被感知到” ——2026传播趋势报告摘要';
(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage(),cdp=await page.context().newCDPSession(page);
    const scope=vm.createContext({Date,URL,setTimeout,window:{addEventListener(){}},
      chrome:{debugger:{attach:async()=>{},detach:async()=>{},sendCommand:(_target,method,params)=>cdp.send(method,params)}},
      attachDebugger:async()=>{},readFileAsDataUrl:async()=> 'data:image/png;base64,AQID',
    });
    vm.runInContext('const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));\n'
      +popup.slice(popup.indexOf('async function evaluate('),popup.indexOf('async function attachDebugger('))
      +popup.slice(popup.indexOf('function findEditorField('),popup.indexOf('async function editorApi(')),scope);
    vm.runInContext(fs.readFileSync(path.join(root,'other-platforms.js'),'utf8'),scope);
    const fixture=async({ignoreInput=false,body='',titleChanged=false}={})=>{
      await page.setContent('<div id="component"><input placeholder="请输入标题（5-72字）"><div class="ql-editor" contenteditable="true">'+body+'</div></div>');
      await page.evaluate(({ignoreInput,titleChanged})=>{
        const field=document.querySelector('input'),body=document.querySelector('.ql-editor');
        const state={title:'',editorDisabled:false,savedTitle:''};
        document.querySelector('#component').__vue__={$data:state};window.events=[];window.titleState=state;
        field.addEventListener('focus',()=>{state.editorDisabled=true;body.contentEditable='false';});
        field.addEventListener('input',event=>{window.events.push({kind:'title-input',trusted:event.isTrusted});if(event.isTrusted&&!ignoreInput)state.title=field.value.trim();});
        field.addEventListener('blur',()=>{state.editorDisabled=false;body.contentEditable='true';state.savedTitle=state.title;window.events.push({kind:'title-blur'});});
        body.addEventListener('paste',event=>{
          window.events.push({kind:'body-paste',title:state.title,disabled:state.editorDisabled});
          if(event.clipboardData.files.length)return; // Model an upload failure after title initialization.
          event.preventDefault();body.innerHTML=event.clipboardData.getData('text/html');
          if(titleChanged){state.title='用户后来改写的标题';field.value=state.title;}
        });
      },{ignoreInput,titleChanged});
    };
    const bundle=(withImage=false)=>({html:'<p>回归正文。</p>'+(withImage?'<img src="IMAGE_ONE">':''),manifest:{targetPlatform:'sohu',title,
      contentImages:withImage?[{placeholder:'IMAGE_ONE',bundleFile:'image.png'}]:[]},assets:new Map(withImage?[['assets/image.png',{name:'image.png',type:'image/png'}]]:[])});

    await fixture();await page.locator(selector).focus();
    await assert.rejects(scope.fillPortalDraft(1,bundle(true),'sohu',()=>{}),/没有接收图片文件粘贴/);
    assert.equal(await page.locator(selector).inputValue(),title,'title survives an interrupted upload');
    const failure=await page.evaluate(()=>({state:window.titleState,events:window.events}));
    assert.equal(failure.state.savedTitle,title);assert.equal(failure.state.editorDisabled,false);
    const paste=failure.events.find(e=>e.kind==='body-paste');assert.equal(paste.title,title);assert.equal(paste.disabled,false);
    assert.ok(failure.events.some(e=>e.kind==='title-input'&&e.trusted));

    await fixture();await scope.fillPortalDraft(1,bundle(),'sohu',()=>{});
    assert.equal(await page.locator(selector).inputValue(),title);
    assert.equal(await page.evaluate(()=>window.titleState.title),title);
    assert.equal(await page.locator('.ql-editor').textContent(),'回归正文。');

    await fixture({ignoreInput:true});
    await assert.rejects(scope.fillPortalDraft(1,bundle(true),'sohu',()=>{}),/标题未同步到页面/);
    assert.equal(await page.evaluate(()=>window.events.some(e=>e.kind==='body-paste')),false,'bad title model stops before uploading');
    assert.equal(await page.evaluate(()=>window.titleState.editorDisabled),false,'failed title entry still releases body lock');

    await fixture({body:'<p>用户自己的草稿</p>'});
    await assert.rejects(scope.fillPortalDraft(1,bundle(),'sohu',()=>{}),/正文已有内容/);
    assert.equal(await page.locator(selector).inputValue(),'');
    assert.equal(await page.locator('.ql-editor').textContent(),'用户自己的草稿');

    await fixture({titleChanged:true});
    await assert.rejects(scope.fillPortalDraft(1,bundle(),'sohu',()=>{}),/不会覆盖新标题/);
    assert.equal(await page.locator(selector).inputValue(),'用户后来改写的标题');
    console.log('PASS Sohu: native title input and blur before upload; interrupted upload retains title; model mismatch stops before body; existing and concurrently edited drafts are protected.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
