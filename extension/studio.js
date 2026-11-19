'use strict';

(() => {
  const C=DraftCore, q=id=>document.getElementById(id);
  let state={html:'',meta:{title:'',author:'',summary:'',slot:'head'},mode:'preserve',settings:{},typeStyles:{},warnings:[],cover:null};
  let original=null, undoStack=[], redoStack=[], selected=null, showingOriginal=false, frameSerial=0, busy=false;
  let lastFill=null, fillBundle=null, templateList=[], autosaveTimer=null, toastTimer=null, lastObserved=null;
  let pendingAsset=null, sourceImageTabId=null, authoring=null;
  let distributionMode=false, distributionTab=null, distributionBundle=null;
  const distributionTitles=new Map();
  const distributionSummaries=new Map();
  let layoutCache=null;
  const layoutUrls=[];
  const formatUrls=[];
  let processingKey='',processingBase=[],processingRuntime=[];
  function renderProcessingLog(){
    const list=q('matrix-log-entries');list.replaceChildren();
    for(const entry of [...processingBase,...processingRuntime]){const li=document.createElement('li');li.textContent=entry;list.append(li);}
    q('matrix-log-summary').textContent='分发处理日志（'+processingBase.length+' 条转换说明，'+processingRuntime.length+' 条运行记录）';
  }
  function showProcessingLog(bundle){
    const key=bundle?bundle.manifest.sourceWechatManifestSha256+':'+bundle.manifest.targetPlatform:'';
    if(key!==processingKey){
      let saved=[];
      try{saved=JSON.parse(localStorage.getItem('draft-helper-processing:'+key)||'[]');}catch{}
      processingRuntime=Array.isArray(saved)?saved.filter(line=>typeof line==='string'):[];
      processingKey=key;
    }
    const imported=(bundle?.runtimeLog||[]).filter(line=>typeof line==='string');
    // Repeated upload messages can belong to separate attempts: preserve the
    // whole imported timeline, deduplicating only an already loaded full block.
    if(imported.length&&!processingRuntime.some((_,start)=>imported.every((line,index)=>processingRuntime[start+index]===line)))
      processingRuntime.unshift(...imported);
    processingBase=(bundle?.report.processing_log||[]).map(entry=>entry.detail);
    renderProcessingLog();
  }
  function appendProcessingLog(message){
    const prior=processingRuntime.at(-1);
    if(prior?.endsWith(' '+message))return;
    processingRuntime.push(new Date().toLocaleTimeString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'})+' '+message);
    try{localStorage.setItem('draft-helper-processing:'+processingKey,JSON.stringify(processingRuntime));}
    catch{toast('运行日志暂时无法保存到本机，请导出平台准备包备份完整日志。');}
    renderProcessingLog();
  }
  let readyResolve; const ready=new Promise(resolve=>{readyResolve=resolve;});
  const toast=(message,tone)=>{q('toast').textContent=message;q('toast').dataset.tone=tone||'info';q('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>q('toast').hidden=true,5500);};
  const handle=fn=>async event=>{try{await ready;await fn(event);}catch(error){toast(error.message||String(error),'error');}};
  const setBusy=value=>{busy=value;document.body.classList.toggle('busy',value);for(const el of document.querySelectorAll('.top-actions button,.dialog-actions button,#distribution-panel button,#export-wechat-package'))el.disabled=value; if(!value) refreshControls();};

  function database() {
    return new Promise((resolve,reject)=>{
      const request=indexedDB.open('draft-helper-studio',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('documents');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
    });
  }
  async function persist() {
    const db=await database();
    try {await new Promise((resolve,reject)=>{
      const tx=db.transaction('documents','readwrite');tx.objectStore('documents').put({version:1,state,original},'current');
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('本地保存中断'));
    });q('save-state').textContent='已保存到本机';} finally {db.close();}
  }
  function saveSoon() {
    q('save-state').textContent='正在保存…';clearTimeout(autosaveTimer);
    autosaveTimer=setTimeout(()=>persist().catch(()=>{q('save-state').textContent='本地保存失败，请导出备份';}),300);
  }
  function checkpoint() {
    undoStack.push(C.clone(state));redoStack=[];
    let size=0;undoStack=undoStack.reverse().filter((item,i)=>{size+=item.html.length+(item.cover?.length||0);return i<40&&(size<24*1024*1024||i===0);}).reverse();
  }
  function mutate(fn) {
    if(busy)return;authoring?.stopEditing();checkpoint();fn(state);showingOriginal=false;lastFill=null;layoutCache=null;render();saveSoon();
  }
  function refreshControls() {
    q('undo').disabled=busy||!undoStack.length;q('redo').disabled=busy||!redoStack.length;
    q('restore').disabled=busy||!original;q('export-html').disabled=busy||!state.html;q('send').disabled=busy||!state.html;
    q('style-controls').disabled=busy||state.mode!=='adjust'||showingOriginal;
    q('mode-preserve').setAttribute('aria-pressed',String(state.mode==='preserve'));
    q('mode-adjust').setAttribute('aria-pressed',String(state.mode==='adjust'));
    document.body.dataset.mode=state.mode;document.body.dataset.viewing=showingOriginal?'original':'current';document.body.dataset.document=state.html?'loaded':'empty';
    q('preserve-notice').hidden=state.mode==='adjust';
    q('mode-hint').textContent=showingOriginal?'正在查看导入原稿 · 再次点击按钮返回当前稿':state.mode==='preserve'?'保留原稿样式。切换到“自由调整”后，可选择内容块。':'点击正文选择内容块 · 整篇设置与局部样式均可撤销';
    q('view-original').textContent=showingOriginal?'返回当前稿':'查看导入原稿';
    for(const key of ['fontSize','lineHeight','paragraphGap','padding'])q('global-'+key).value=state.settings[key]??'';
    q('global-theme').value=state.settings.theme||'#4f46e5';
    q('summary-count').textContent=[...state.meta.summary].length+' / 120 字';
    q('cover-preview').hidden=!state.cover;if(state.cover)q('cover-preview').src=state.cover;
    q('retry-cover').disabled=busy||!state.cover;
    q('verify-result').disabled=busy||!lastFill;
    q('export-wechat-package').disabled=busy||!state.html;
    q('matrix-export').disabled=busy||(!state.html&&!distributionBundle);
    q('matrix-fill').disabled=busy||(!state.html&&!distributionBundle);
    q('matrix-fill').textContent='检查并填入所选平台';
    q('matrix-target').disabled=busy;
    q('matrix-refresh-targets').disabled=busy;
    q('matrix-bundle-clear').disabled=busy||!distributionBundle;
    q('matrix-layout-check').disabled=busy||(distributionBundle?!distributionBundle.manifest.matrixFormat:!state.html);
    q('matrix-format-check').disabled=busy||(!state.html&&!distributionBundle);
    q('matrix-layout').disabled=busy||!!distributionBundle;
    for(const id of ['matrix-platform','matrix-title','matrix-summary','matrix-shrink'])q(id).disabled=busy||!!distributionBundle&&['matrix-title','matrix-summary'].includes(id);
    authoring?.refresh();
    if (!selected || !selectedNode()) {
      q('local-controls').hidden=true;q('selected-kind').textContent='未选择';
      q('selection-hint').textContent='点击预览中的段落、标题、图片或引用。';
    }
  }

  function refreshImages() {
    const check=C.preflight(state), list=q('image-list');list.replaceChildren();
    q('article-stats').textContent=state.html?`${check.characters} 字 · ${check.images.length} 张图片`:'尚未导入文章';
    q('check-summary').textContent=check.errors.length?check.errors.join(' '):state.html?'图片已就绪，可以继续检查并填入。':'导入后显示检查结果';
    for(const img of check.images) {
      const row=document.createElement('div');row.className='image-item';
      if(C.imageData.test(img.src)){const thumb=new Image();thumb.src=img.src;thumb.alt='正文图片 '+img.index;row.append(thumb);}
      else {const mark=document.createElement('div');mark.className='image-missing';mark.textContent='!';row.append(mark);}
      const label=document.createElement('span');label.textContent=`${img.index}. ${C.imageData.test(img.src)?(img.alt||'正文图片'):'待补齐'+(img.kind==='background'?'背景图':'图片')}`;label.title=img.alt||(!C.imageData.test(img.src)?img.src:'');row.append(label);
      const button=document.createElement('button');button.textContent=C.imageData.test(img.src)?'选择':'补图';button.onclick=()=>{
        if(state.mode!=='adjust')mutate(()=>state.mode='adjust');selected=img.id;selectBlock(img.id);pendingAsset=img;
        if(!C.imageData.test(img.src)||img.kind==='background')q('replace-image').click();
      };row.append(button);list.append(row);
    }
    q('download-images').hidden=!check.images.some(img=>/^https?:\/\//i.test(img.src));
    q('warnings').replaceChildren(...check.warnings.map(value=>{const li=document.createElement('li');li.textContent=value;return li;}));
    q('warning-count').textContent=`兼容提示（${check.warnings.length}）`;
  }

  function render() {
    authoring?.stopEditing();
    const preview=showingOriginal&&original?original:state;
    q('article-title').value=state.meta.title;q('article-author').value=state.meta.author;q('article-summary').value=state.meta.summary;
    q('article-slot').value=state.meta.slot==='sub'?'sub':'head';
    q('cover-hint').textContent=state.meta.slot==='sub'
      ?'次条封面为 1:1 方图；可选，正文图片也可设为封面。'
      :'头条封面建议 2.35:1 大图；可选，正文图片也可设为封面。';
    q('preview-title').textContent=preview.meta.title||'未命名文章';q('preview-author').textContent=preview.meta.author||'作者未填写';
    q('empty-state').hidden=!!state.html;q('article-frame').hidden=!state.html;
    refreshControls();refreshImages();renderFrame(preview);
  }
  function renderFrame(preview) {
    const frame=q('article-frame'), serial=++frameSerial;
    const doc=C.parse(C.render(preview));
    // Remote and local file URLs never load inside the preview. They must be resolved explicitly.
    for(const asset of C.collectAssets(doc)) if(asset.kind==='background'&&!C.imageData.test(asset.src))asset.node.style.backgroundImage='none';
    for(const img of doc.querySelectorAll('img')) if(!C.imageData.test(img.getAttribute('src')||'')) {
      img.removeAttribute('src');img.alt='图片尚未就绪，点击左侧补图';
      img.style.cssText+=';display:block;width:100%;min-height:90px;background:#f6eedf;color:#9a845f;border:1px dashed #d8c7a8;';
    }
    frame.onload=()=>{
      if(serial!==frameSerial)return;const inner=frame.contentDocument;
      const resize=()=>{if(serial===frameSerial)frame.style.height=Math.max(400,inner.documentElement.scrollHeight)+'px';};
      inner.addEventListener('click',event=>{
        if(authoring?.handleFrameClick(event))return;
        event.preventDefault();if(state.mode!=='adjust'||showingOriginal)return;
        let el=event.target.closest(C.blocks);
        if(!el)el=event.target.closest('section,div');
        if(el?.dataset.dhId)selectBlock(el.dataset.dhId,{multi:event.ctrlKey||event.metaKey,range:event.shiftKey});
      });
      for(const img of inner.images)img.addEventListener('load',resize);
      if(lastObserved)lastObserved.disconnect();lastObserved=new ResizeObserver(resize);lastObserved.observe(inner.body);
      authoring?.bindFrame(inner);resize();if(selected&&!showingOriginal)selectBlock(selected,{retain:true});
    };
    const defaults=preview.fidelity?'':'body{color:#333;font-family:system-ui,sans-serif;font-size:16px;line-height:1.8;overflow-wrap:anywhere}img{max-width:100%;height:auto}p{margin:0 0 16px}h1,h2,h3{line-height:1.5}blockquote{margin:16px 0;padding-left:14px;border-left:3px solid #d9dfd9}pre{white-space:pre-wrap}table{max-width:100%;border-collapse:collapse}';
    frame.srcdoc='<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:"><style>html{overflow:hidden}body{margin:0;padding:0}'+defaults+'[data-dh-selected]{outline:2px solid #75b79c;outline-offset:-2px;cursor:pointer}a{pointer-events:none}[data-dh-editing]{outline:2px solid #197567;outline-offset:5px;cursor:text;min-height:1.5em}[data-dh-editing] a{pointer-events:auto}</style></head><body>'+doc.body.innerHTML+'</body></html>';
  }

  function selectedNode(doc=C.parse(state.html)){return [...doc.querySelectorAll('[data-dh-id]')].find(el=>el.dataset.dhId===selected);}
  function selectBlock(id, options={}) {
    selected=id;authoring?.onSelection(id,options);pendingAsset=null;const node=selectedNode();q('local-controls').hidden=!node;
    if(!node){q('selected-kind').textContent='未选择';return;}
    const inner=q('article-frame').contentDocument;
    inner?.querySelectorAll('[data-dh-selected]').forEach(el=>el.removeAttribute('data-dh-selected'));
    const live=[...(inner?.querySelectorAll('[data-dh-id]')||[])].find(el=>el.dataset.dhId===id);live?.setAttribute('data-dh-selected','');
    const type=C.kind(node);q('selected-kind').textContent=({p:'段落',img:'图片',blockquote:'引用',h1:'一级标题',h2:'二级标题',h3:'三级标题',li:'列表项',section:'内容区',div:'内容区'})[type]||type;
    q('selection-hint').textContent=node.tagName==='IMG'?'调整图片宽度，替换图片或设为封面。':node.textContent.trim().slice(0,55)||'已选择内容块';
    q('block-type').disabled=!['p','h1','h2','h3','h4','h5','h6','blockquote'].includes(type);q('block-type').value=type;
    q('image-controls').hidden=type!=='img';
    for(const prop of ['font-size','line-height','margin-bottom','text-align','width'])q('local-'+prop).value='';
    q('local-color').value='#333333';q('local-background-color').value='#ffffff';
    if(type==='img'){
      q('image-alt').value=node.getAttribute('alt')||'';
      q('image-caption').value=node.closest('figure')?.querySelector('figcaption')?.textContent||'';
    }
  }

  async function loadHtml(html,meta={},warnings=[]) {
    setBusy(true);
    try {
      const normalized=await C.normalize(html);
      const next={html:normalized.html,meta:{title:meta.title||normalized.title||'',author:meta.author||normalized.author||'',summary:meta.summary||'',slot:meta.slot==='sub'?'sub':meta.slot==='head'?'head':(state.meta.slot==='sub'?'sub':'head')},mode:'preserve',settings:{},typeStyles:{},warnings:[...normalized.warnings,...warnings,...(meta.warnings||[])],cover:meta.cover||null,fidelity:!!normalized.fidelity,importReport:normalized.importReport};
      if(state.html&&!confirm('导入新稿件将替换当前工作台。当前稿件可先导出 HTML；是否继续？'))return false;
      authoring?.reset();state=next;original=C.clone(next);undoStack=[];redoStack=[];selected=null;showingOriginal=false;lastFill=null;sourceImageTabId=null;
      if(typeof setDistributionBundle==='function')setDistributionBundle(null);
      distributionTitles.clear();distributionSummaries.clear();distributionTitleForSelection();
      render();await persist();toast('已导入。原稿已保留，可以开始调整。');return true;
    }finally{setBusy(false);}
  }

  async function localize(html,files,sourceFile) {
    const doc=C.parse(html), records=files.map(file=>({file,path:(file.webkitRelativePath||file.name).replaceAll('\\','/')}));
    const sourcePath=(sourceFile?.webkitRelativePath||sourceFile?.name||'').replaceAll('\\','/');
    const dir=sourcePath.slice(0,sourcePath.lastIndexOf('/')+1);
    const normalizePath=value=>{const parts=[];for(const part of value.split('/')){if(part==='..')parts.pop();else if(part&&part!=='.')parts.push(part);}return parts.join('/');};
    const lookup=src=>{
      let relative;try{relative=decodeURIComponent(src).replaceAll('\\','/').replace(/^file:\/\//,'').replace(/^\//,'');}catch{return null;}
      const exact=records.filter(row=>row.path===normalizePath(dir+relative)||row.path===relative);
      const candidates=exact.length?exact:records.filter(row=>row.file.name===relative.split('/').pop());
      return candidates.length===1?candidates[0].file:null;
    };
    for(const link of doc.querySelectorAll('link[rel="stylesheet"]')) {
      const file=lookup(link.getAttribute('href')||'');
      if(file&&/\.css$/i.test(file.name)&&file.size<5*1024*1024){const style=doc.createElement('style');style.textContent=await file.text();link.replaceWith(style);}
    }
    const scope=doc.querySelector('#js_content')||doc.body;
    for(const img of scope.querySelectorAll('img')) {
      const src=DraftImport.preferredImageSource(img),lazy=img.getAttribute('data-src');
      if(C.imageData.test(src)||/^https?:\/\//i.test(src)){img.setAttribute('src',src);img.removeAttribute('data-src');continue;}
      const file=lookup(src);
      if(file)img.setAttribute('src',await C.fileToData(file));
      else if(lazy)img.setAttribute('src',lazy);
      img.removeAttribute('data-src');
    }
    for(const asset of C.collectAssets(scope).filter(item=>item.kind==='background')) {
      if(/^(data:|https?:)/i.test(asset.src))continue;
      const file=lookup(asset.src);if(file)C.setAssetSource(asset,await C.fileToData(file));
    }
    return doc.documentElement.outerHTML;
  }

  async function importFiles(files, options={}) {
    if(files.some(file=>file.name==='manifest.json')) {
      const old=await readBundle(files);
      const target=old.manifest.targetPlatform||'wechat';
      if(target!=='wechat') {
        const label=(typeof DraftDistribution!=='undefined'&&DraftDistribution.PLATFORMS?.[target]?.label)||null;
        if(!label)
          throw Error('无法识别的准备包目标平台：'+target+'。请确认 manifest.json 的 targetPlatform。');
        throw Error('这是'+label+'准备包。要填入该平台，请在右侧「多平台分发」→「选择已有准备包」中选用；左侧只载入微信包用于排版。');
      }
      await verifyBundle(old,'wechat');
      let html=old.html;
      // Longest placeholder first avoids prefix collisions (1 versus 10).
      for(const item of [...old.manifest.contentImages].sort((a,b)=>b.placeholder.length-a.placeholder.length))html=html.replaceAll(item.placeholder,await C.fileToData(old.assets.get('assets/'+item.bundleFile)));
      const cover=old.manifest.coverImage?await C.fileToData(old.assets.get('assets/'+old.manifest.coverImage.bundleFile)):null;
      await loadHtml(html,{...old.manifest,cover});
      toast('已载入'+(old.manifest.profileSpec?.label||old.manifest.profile?.id||'微信')+'准备包');
      return;
    }
    if(options.expectBundle)throw Error('所选文件夹不是准备包：缺少 manifest.json。普通稿件请用「文章文件夹」。');
    let documents=files.filter(file=>/\.(html?|md|markdown|txt)$/i.test(file.name));
    if(documents.length>1){const depth=file=>(file.webkitRelativePath||file.name).split('/').length;const minDepth=Math.min(...documents.map(depth));documents=documents.filter(file=>depth(file)===minDepth);}
    if(documents.length!==1)throw Error('请选择一篇文章及其图片；文件夹中应只有一个 HTML、Markdown 或 TXT 正文文件。');
    const file=documents[0];if(file.size>50*1024*1024)throw Error('正文文件超过 50MB，请拆分或压缩内嵌图片。');
    let html=await file.text();
    if(/\.(md|markdown)$/i.test(file.name))html=marked.parse(html);
    else if(/\.txt$/i.test(file.name))html=textHtml(html);
    // Preserve head styles while resolving local assets.
    const before=C.parse(html);
    html=await localize(html,files,file);
    await loadHtml(html,{title:before.title||before.querySelector('h1')?.textContent||file.name.replace(/\.[^.]+$/,'')});
  }
  const textHtml=text=>text.split(/\n\s*\n/).map(p=>'<p>'+C.escape(p).replace(/\n/g,'<br>')+'</p>').join('');

  function download(text,name,type='text/html') {
    const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  function updateTemplates() {
    const select=q('template-list'),previous=select.value;select.replaceChildren(new Option(templateList.length?'选择已保存的样式':'尚无自定义模板',''));
    templateList.forEach((item,i)=>select.add(new Option(item.name,String(i))));select.value=previous;
    localStorage.setItem('draft-helper-templates-v1',JSON.stringify(templateList));
  }
  function currentTemplate() {const value=q('template-list').value;if(value==='')throw Error('请先选择一个自定义样式。');return templateList[Number(value)];}

  async function refreshTargets() {
    const prior=q('target-tab').value||new URL(location.href).searchParams.get('target');
    const tabs=await chrome.tabs.query({url:'https://mp.weixin.qq.com/*'}),select=q('target-tab');
    const sourceSelect=q('source-tab'),sourcePrior=sourceSelect.value;sourceSelect.replaceChildren(new Option('选择来源文章／预览／草稿页',''));
    for(const tab of tabs)sourceSelect.add(new Option(tab.title||'微信公众号 · '+tab.id,String(tab.id)));
    sourceSelect.value=sourcePrior;
    select.replaceChildren(new Option('请选择已登录的空白图文编辑页',''));
    for(const tab of tabs)select.add(new Option(tab.title||'微信公众号 · '+tab.id,String(tab.id)));
    if(tabs.some(tab=>String(tab.id)===prior))select.value=prior;
    else if(tabs.length===1)select.value=String(tabs[0].id);
  }
  async function targetTab() {
    if (distributionMode) {
      if (!distributionTab) throw Error('未指定多平台填入的目标标签页。');
      const current=await chrome.tabs.get(distributionTab.id);
      const platform=q('matrix-platform').value;
      if (!current.url || identifyDraftPlatform(current.url)!==platform
          || Number(q('matrix-target').value)!==distributionTab.id)
        throw Error('目标平台页面已变化，请刷新选择后重新确认。');
      return current;
    }
    const id=Number(q('target-tab').value);if(!id)throw Error('请先选择微信编辑页。');
    const tab=await chrome.tabs.get(id);
    if(!tab.url?.startsWith('https://mp.weixin.qq.com/'))throw Error('所选标签页已离开微信，请重新选择。');return tab;
  }
  async function performFill(coverOnly=false) {
    if (coverOnly && lastFill && (await targetTab()).id !== lastFill.tabId) throw Error('重试封面时请选择刚才填入的微信标签页。');
    fillBundle=await C.bundle(state);setBusy(true);
    try {if(coverOnly)await runMatrixCoverOnly();else await run();}
    catch(error){q('result-status').textContent='未完成：'+error.message;toast(error.message,'error');}
    finally{fillBundle=null;setBusy(false);}
  }

  window.DraftStudio={
    targetTab,
    selectedBundle:async()=>({bundle:fillBundle||await C.bundle(state),automatic:null}),
    status(message){q(distributionMode?'matrix-status':'result-status').textContent=message;},
    recordFill(value){lastFill=value;refreshControls();},
    // Read-only state access is useful for local regression tests and diagnostics.
    snapshot:()=>C.clone(state), ready,
    updateDistributionBundle:bundle=>{fillBundle=bundle;setDistributionBundle(bundle);},
  };

  authoring=DraftAuthorUI.mount({current:()=>state,activeId:()=>selected,setActive:selectBlock,mutate,render,ready,toast,download,
    busy:()=>busy,viewingOriginal:()=>showingOriginal,
    inPlace(fn,first){if(first)checkpoint();fn(state);lastFill=null;layoutCache=null;saveSoon();q('article-stats').textContent=[...C.textOf(state.html)].length+' 字 · '+C.parse(state.html).querySelectorAll('img').length+' 张图片';},
    cancelEdit(html,checkpointed){state.html=html;if(checkpointed)undoStack.pop();redoStack=[];saveSoon();}
  });
  q('author-outline-open').onclick=()=>{q('left-import-panels').hidden=true;q('author-outline-panel').hidden=false;q('author-import-open').setAttribute('aria-pressed','false');q('author-outline-open').setAttribute('aria-pressed','true');authoring.refresh();};
  q('author-import-open').onclick=()=>{q('left-import-panels').hidden=false;q('author-outline-panel').hidden=true;q('author-import-open').setAttribute('aria-pressed','true');q('author-outline-open').setAttribute('aria-pressed','false');};

  q('source-file').onchange=handle(async e=>{await importFiles([...e.target.files]);e.target.value='';});
  q('source-folder').onchange=handle(async e=>{await importFiles([...e.target.files]);e.target.value='';});
  q('bundle-folder').onchange=handle(async e=>{const files=[...e.target.files];e.target.value='';if(files.length)await importFiles(files,{expectBundle:true});});
  q('drop-zone').ondragover=e=>{e.preventDefault();q('drop-zone').classList.add('dragging');};
  q('drop-zone').ondragleave=()=>q('drop-zone').classList.remove('dragging');
  q('drop-zone').ondrop=handle(async e=>{e.preventDefault();q('drop-zone').classList.remove('dragging');await importFiles([...e.dataTransfer.files]);});
  q('paste-open').onclick=()=>q('paste-dialog').showModal();
  let richPaste='';
  q('paste-content').onpaste=event=>{
    event.preventDefault();const html=event.clipboardData.getData('text/html'),text=event.clipboardData.getData('text/plain');
    richPaste=html||textHtml(text);
    // Never insert raw clipboard HTML into the privileged extension document.
    q('paste-content').textContent=text||C.parse(html).body.textContent;
  };
  q('paste-content').oninput=()=>richPaste='';
  q('paste-import').onclick=handle(async()=>{
    const mode=q('paste-format').value,text=q('paste-content').innerText;
    let html=mode==='rich'?(richPaste||textHtml(text)):mode==='html'?text:mode==='markdown'?marked.parse(text):textHtml(text);
    if(!text.trim()&&!richPaste)throw Error('请先粘贴稿件。');
    q('paste-dialog').close();await loadHtml(html);
  });
  for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>q(button.dataset.close).close();
  for(const field of ['title','author','summary'])q('article-'+field).onchange=()=>mutate(()=>state.meta[field]=q('article-'+field).value);
  q('article-slot').onchange=()=>mutate(()=>{state.meta.slot=q('article-slot').value==='sub'?'sub':'head';});
  q('cover-file').onchange=handle(async e=>{const file=e.target.files[0];if(file){const data=await C.fileToData(file);mutate(()=>state.cover=data);}e.target.value='';});
  q('cover-clear').onclick=()=>mutate(()=>state.cover=null);
  q('mode-adjust').onclick=()=>mutate(()=>state.mode='adjust');
  q('mode-preserve').onclick=()=>{
    if(state.mode==='preserve')return;
    if(!confirm('恢复导入时的正文样式和内容？标题、作者、摘要与封面保留。此操作可以撤销。'))return;
    mutate(()=>{state.html=original?.html||state.html;state.settings={};state.typeStyles={};state.mode='preserve';selected=null;});
  };
  q('restore').onclick=()=>{if(original&&confirm('恢复本篇导入时的正文、图片和文章信息？此操作可以撤销。'))mutate(()=>{state=C.clone(original);selected=null;});};
  q('view-original').onclick=()=>{if(!original)return;showingOriginal=!showingOriginal;render();};
  q('preview-width').onchange=()=>q('paper').style.width=q('preview-width').value+'px';
  q('undo').onclick=()=>{if(undoStack.length){redoStack.push(C.clone(state));state=undoStack.pop();showingOriginal=false;render();saveSoon();}};
  q('redo').onclick=()=>{if(redoStack.length){undoStack.push(C.clone(state));state=redoStack.pop();showingOriginal=false;render();saveSoon();}};
  document.addEventListener('keydown',event=>{
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'&&!event.target.closest('input,textarea,[contenteditable=true]')&&!busy){event.preventDefault();q(event.shiftKey?'redo':'undo').click();}
  });
  for(const key of ['fontSize','lineHeight','paragraphGap','padding'])q('global-'+key).onchange=()=>{
    const input=q('global-'+key);if(!input.checkValidity()){input.reportValidity();return;}
    mutate(()=>{if(input.value==='')delete state.settings[key];else state.settings[key]=Number(input.value);});
  };
  q('global-theme').onchange=()=>mutate(()=>state.settings.theme=q('global-theme').value);
  q('theme-clear').onclick=()=>mutate(()=>delete state.settings.theme);
  for(const prop of ['font-size','line-height','margin-bottom','text-align','color','background-color','width'])q('local-'+prop).onchange=()=>{
    const input=q('local-'+prop);if(!input.value)return;if(!input.checkValidity()){input.reportValidity();return;}
    let value=input.value;if(['font-size','margin-bottom'].includes(prop))value+='px';if(prop==='width')value+='%';
    const chosen=authoring.range();
    if(q('local-scope').value==='selected'||chosen&&chosen.start!==chosen.end&&q('local-scope').value!=='all')authoring.properties({[prop]:value});
    else mutate(()=>C.editBlock(state,selected,{[prop]:value},q('local-scope').value==='all'));
  };
  q('local-reset').onclick=()=>mutate(()=>C.resetBlock(state,selected));
  q('block-type').onchange=()=>mutate(()=>{
    const doc=C.parse(state.html),el=selectedNode(doc);if(!el)return;
    const replacement=doc.createElement(q('block-type').value);for(const attr of el.attributes)replacement.setAttribute(attr.name,attr.value);
    replacement.append(...el.childNodes);el.replaceWith(replacement);state.html=doc.body.innerHTML;
  });
  q('image-alt').onchange=()=>mutate(()=>{const doc=C.parse(state.html),el=selectedNode(doc);if(el)el.setAttribute('alt',q('image-alt').value);state.html=doc.body.innerHTML;});
  q('image-caption').onchange=()=>mutate(()=>{
    const doc=C.parse(state.html),el=selectedNode(doc);if(!el)return;
    let figure=el.closest('figure');if(!figure){figure=doc.createElement('figure');figure.style.margin='16px 0';el.replaceWith(figure);figure.append(el);}
    let caption=figure.querySelector('figcaption');if(!caption){caption=doc.createElement('figcaption');caption.dataset.dhId='caption-'+selected;caption.style.cssText='font-size:13px;color:#888;text-align:center;margin-top:8px';figure.append(caption);}
    caption.textContent=q('image-caption').value;state.html=doc.body.innerHTML;
  });
  q('replace-image').onchange=handle(async e=>{const file=e.target.files[0];if(!file)return;const key=pendingAsset?.key||selected+':image',data=await C.fileToData(file);mutate(()=>{const doc=C.parse(state.html);const asset=C.collectAssets(doc).find(item=>item.key===key);if(asset)C.setAssetSource(asset,data);state.html=doc.body.innerHTML;});e.target.value='';});
  q('image-cover').onclick=handle(async()=>{const src=selectedNode()?.getAttribute('src');if(!C.imageData.test(src||''))throw Error('请先补齐这张图片。');mutate(()=>state.cover=src);toast('已设为封面，正文图片保持不变。');});
  q('image-remove').onclick=()=>{if(confirm('从正文移除这张图片？可以撤销。'))mutate(()=>{const doc=C.parse(state.html);selectedNode(doc)?.remove();state.html=doc.body.innerHTML;selected=null;});};

  async function fetchRemoteFile(url){
    const response=await fetch(url,{credentials:'omit',redirect:'error',
      referrerPolicy:'no-referrer',cache:'default',signal:AbortSignal.timeout(20000)});
    if(!response.ok)throw Error('图片服务器返回 HTTP '+response.status);
    const limit=DraftImageLocalizer.MAX_BYTES;
    if(Number(response.headers.get('content-length')||0)>limit)throw Error('图片超过 20MB 限制。');
    const mime=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    const chunks=[];let length=0;
    if(response.body){
      const reader=response.body.getReader();
      try{
        while(true){
          const {done,value}=await reader.read();if(done)break;
          length+=value.length;if(length>limit)throw Error('图片超过 20MB 限制。');
          chunks.push(value);
        }
      }catch(error){await reader.cancel().catch(()=>{});throw error;}
    }else{
      const buffer=await response.arrayBuffer();
      length=buffer.byteLength;if(length>limit)throw Error('图片超过 20MB 限制。');
      chunks.push(new Uint8Array(buffer));
    }
    if(!length)throw Error('图片文件为空。');
    return C.fileToData(new File(chunks,'remote-image',{type:mime}));
  }
  async function resolveRemoteImage(url){
    try{return await fetchRemoteFile(url);}
    catch(error){
      // Only same-origin WeChat image bytes may use the user's live page session.
      if(!sourceImageTabId||new URL(url).origin!=='https://mp.weixin.qq.com')throw error;
      try{
        const data=await WechatCapture.readSameOriginImage(sourceImageTabId,url);
        return await C.fileToData(C.dataToFile(data,'wechat-image'));
      }catch(fallback){
        throw Error((error.message||String(error))+'；公众号同源重试失败：'+(fallback.message||String(fallback)));
      }
    }
  }
  async function localizeRemoteImages({explicit=false}={}){
    const assets=C.preflight(state).images.filter(item=>/^https?:\/\//i.test(item.src));
    if(!assets.length)return;
    const statusLine=q('image-download-status');
    const planned=DraftImageLocalizer.candidates(assets);
    const origins=[...new Set(planned.groups.map(item=>item.origin))];
    const granted=new Map();
    for(const origin of origins){
      const present=chrome.permissions?.contains
        ? await chrome.permissions.contains({origins:[origin+'/*']}).catch(()=>false) : false;
      granted.set(origin,!!present);
    }
    setBusy(true);
    let result;
    try{
      result=await DraftImageLocalizer.run(assets,{
        concurrency:3,
        isAllowed:async origin=>granted.get(origin)===true,
        resolve:resolveRemoteImage,
        onProgress:({total,finished,success,failed})=>{
          statusLine.textContent=(explicit?'批量下载':'自动获取')+'：'+finished+'/'+total
            +' 张不同图片（成功 '+success+'，失败／待授权 '+failed+'）。';
        }
      });
    }finally{setBusy(false);}
    if(result.replacements.size){
      // One undo entry for the complete batch; original import stays untouched.
      mutate(()=>{
        const doc=C.parse(state.html);
        for(const item of C.collectAssets(doc)){
          const data=result.replacements.get(item.key);
          if(data)C.setAssetSource(item,data);
        }
        state.html=doc.body.innerHTML;
      });
    }
    const pending=C.preflight(state).images.filter(item=>/^https?:\/\//i.test(item.src)).length;
    const permissionNeeded=result.failures.filter(item=>item.type==='permission').length;
    const failed=result.failures.filter(item=>item.type!=='permission').length;
    statusLine.textContent='本轮完成：成功获取 '+result.success+' 张不同图片，替换 '
      +result.positions+' 处正文／背景引用；仍有 '+pending+' 处待补齐。'
      +(permissionNeeded?' '+permissionNeeded+' 个图片域名来源需要点击「下载／重试」授权。':'')
      +(failed?' '+failed+' 项获取失败，可重试或手动补图。':'')
      +(pending?' 未补齐的图片会阻止生成准备包。':' 所有远程图片已本地化。');
  }
  q('download-images').onclick=()=>{
    // Chrome requires permissions.request during the actual click gesture, before
    // any asynchronous permissions.contains(), fetch, or document normalization.
    try {
      const pending=C.preflight(state).images.filter(item=>/^https?:\/\//i.test(item.src));
      const origins=[...new Set(DraftImageLocalizer.candidates(pending).groups.map(item=>item.origin+'/*'))];
      if(!origins.length){toast('没有可授权的远程图片地址；其他异常素材请手动补图。');return;}
      const builtIn=new Set(['https://mmbiz.qpic.cn/*','https://mmbiz.qlogo.cn/*','https://res.wx.qq.com/*','https://mp.weixin.qq.com/*']);
      const optional=origins.filter(origin=>!builtIn.has(origin));
      const granted=optional.length&&chrome.permissions?.request
        ? chrome.permissions.request({origins:optional}) : Promise.resolve(true);
      Promise.resolve(granted)
        .catch(error=>{q('image-download-status').textContent='附加域名授权失败：'+(error.message||String(error));return false;})
        .then(()=>localizeRemoteImages({explicit:true}))
        .catch(error=>{q('image-download-status').textContent='图片获取未完成：'+(error.message||String(error));toast(error.message||String(error));});
    }catch(error){toast(error.message||String(error));}
  };
  q('export-wechat-package').onclick=handle(async()=>{
    setBusy(true);
    try{
      const bundle=await C.bundle(state);
      await verifyBundle(bundle,'wechat');
      const zip=await DraftDistributionZip.pack(DraftDistributionZip.sourceFilesFor(bundle));
      const url=URL.createObjectURL(zip),link=document.createElement('a');
      link.href=url;link.download=DraftDistributionZip.nameFor(bundle);link.click();
      setTimeout(()=>URL.revokeObjectURL(url),10000);
      q('image-download-status').textContent='完整微信准备包 ZIP 已生成：包含正文、全部已本地化素材、封面、校验清单与预览。';
    }finally{setBusy(false);}
  });

  q('template-save').onclick=()=>{q('template-name').value='';q('name-dialog').showModal();};
  q('template-confirm').onclick=handle(async()=>{
    const name=q('template-name').value.trim();if(!name)throw Error('请填写样式名称。');
    const template=C.validateTemplate({version:1,name,settings:state.settings,typeStyles:state.typeStyles});
    const index=templateList.findIndex(item=>item.name===name);
    if(index>=0){if(!confirm('已存在同名样式，是否覆盖？'))return;templateList[index]=template;}else templateList.push(template);
    updateTemplates();q('template-list').value=String(index>=0?index:templateList.length-1);q('name-dialog').close();toast('样式已保存到本机。');
  });
  q('template-apply').onclick=handle(async()=>{const template=currentTemplate();mutate(()=>{state.settings=C.clone(template.settings);state.typeStyles=C.clone(template.typeStyles);state.mode='adjust';});toast('已应用，局部特例保持优先。');});
  q('template-delete').onclick=handle(async()=>{const template=currentTemplate();if(confirm('删除样式“'+template.name+'”？')){templateList.splice(Number(q('template-list').value),1);updateTemplates();}});
  q('template-export').onclick=handle(async()=>{const template=currentTemplate();download(JSON.stringify(template,null,2),template.name+'.draft-style.json','application/json');});
  q('template-file').onchange=handle(async e=>{const file=e.target.files[0];if(!file)return;if(file.size>100000)throw Error('样式文件过大。');const template=C.validateTemplate(JSON.parse(await file.text()));templateList.push(template);updateTemplates();q('template-list').value=String(templateList.length-1);e.target.value='';toast('样式已导入，点击“应用”使用。');});

  const distributionPatterns={
    yidian:['https://mp.yidianzixun.com/*'],
    toutiao:['https://mp.toutiao.com/*'],
    penguin:['https://om.qq.com/*','https://*.om.qq.com/*'],
    sohu:['https://mp.sohu.com/*','https://*.mp.sohu.com/*'],
    weibo:['https://card.weibo.com/article/*/editor*'],
  };
  function distributionTitleForSelection(){
    const platform=q('matrix-platform').value,config=DraftDistribution.PLATFORMS[platform];
    q('matrix-title').value=distributionTitles.get(platform)??state.meta.title??'';
    refreshControls();
    q('matrix-title-hint').textContent=config.label+'标题需为 '+config.min+'–'+config.max+' 字；不会自动裁剪或重写。';
    q('matrix-summary-field').hidden=platform!=='weibo';
    q('matrix-summary-label').firstChild.textContent='微博导语（可选）';
    q('matrix-summary-hint').textContent='与微信摘要分开确认；超过 44 字会提示，不自动截断。';
    q('matrix-summary').value=distributionSummaries.get(platform)??state.meta.summary??'';
    q('matrix-summary').disabled=!!distributionBundle;
    // 超限图片策略：显示当前平台的单张上限，避免使用者猜阈值
    const limit=DraftDistribution.PROFILES?.[platform]?.upload?.maxBytes;
    q('matrix-shrink-hint').textContent=limit
      ? '当前平台单张上限 '+(limit/1048576).toFixed(1)+'MB：静图超过即在浏览器内重编码压到上限内；GIF 动图拦下提示，不会静默转静图。'
      : '该平台未设单张大小上限；GIF 动图仍不会在浏览器内压缩。';
  }
  function shrinkMode(){
    const el=q('matrix-shrink');
    return el&&el.value==='warn'?'warn':'auto';
  }
  function applyShrinkPolicy(){
    // yidian.js 在填入前读取这个全局策略；压的是上传副本，不写回准备包
    globalThis.DraftShrinkPolicy={mode:shrinkMode()};
  }
  async function refreshDistributionTargets(){
    const platform=q('matrix-platform').value;
    const select=q('matrix-target'),prior=select.value;
    const tabs=await chrome.tabs.query({url:distributionPatterns[platform]});
    const visible=tabs.filter(tab=>{try{return identifyDraftPlatform(tab.url||'')===platform;}catch{return false;}});
    select.replaceChildren(new Option('选择已登录的空白文章编辑页',''));
    for(const tab of visible)select.add(new Option(tab.title||DraftDistribution.PLATFORMS[platform].label+' · '+tab.id,String(tab.id)));
    if(visible.some(tab=>String(tab.id)===prior))select.value=prior;
    else if(visible.length===1)select.value=String(visible[0].id);
  }
  async function selectedDistributionTab(){
    const id=Number(q('matrix-target').value);
    if(!id)throw Error('请先打开并选择目标平台的空白文章编辑页。');
    const tab=await chrome.tabs.get(id);
    if(identifyDraftPlatform(tab.url||'')!==q('matrix-platform').value)
      throw Error('目标网页平台与所选分发平台不一致。');
    return tab;
  }
  function bundleSupportsPlatform(bundle,platform){
    const m=bundle.manifest;
    return m.targetPlatform===platform || (m.targetPlatform==='yidian' && platform==='toutiao'
      && m.distribution?.schema!==DraftDistribution.CONTRACT && m.compatiblePlatforms?.includes('toutiao'));
  }
  function bundleTitleForPlatform(bundle,platform){
    return platform==='toutiao' && bundle.manifest.targetPlatform==='yidian'
      ? bundle.toutiaoShortTitle : bundle.manifest.title;
  }
  async function prepareDistribution(){
    const platform=q('matrix-platform').value;
    if(distributionBundle){
      if(!bundleSupportsPlatform(distributionBundle,platform))
        throw Error('已选择的准备包属于其他平台，请先「改用当前稿」或切回对应平台。');
      await verifyBundle(distributionBundle,platform);
      const view=await DraftMatrixFormat.view(distributionBundle,platform);
      showProcessingLog(view);
      return view;
    }
    const source=await C.bundle(state);
    const title=q('matrix-title').value;
    const summary=platform==='weibo'?q('matrix-summary').value:undefined;
    DraftDistribution.platformRules(platform,title);
    DraftDistribution.platformSummary(platform,summary??source.manifest.summary);
    const layout=await prepareLayout(source);
    const result=await DraftDistribution.prepare(source,platform,{title,summary,layout:layout.plan,layoutAssets:layout.assets});
    result.assets.set('source-wechat.json',new File([result.sourceProofText],'source-wechat.json',{type:'application/json'}));
    await DraftDistribution.verify(result,platform);
    showProcessingLog(result);
    return result;
  }
  function showLayout(layout){
    for(const url of layoutUrls)URL.revokeObjectURL(url);layoutUrls.length=0;
    const list=q('matrix-layout-preview');list.replaceChildren();
    q('matrix-layout-results').hidden=!layout.plan.blocks.length;
    q('matrix-layout-status').textContent=DraftLayout.notes(layout.plan).join(' ')
      ||'未发现需要整块转图的排版；普通正文和图片保持可编辑。';
    const labels={columns:'并排内容',table:'表格',svg:'矢量图',card:'卡片',overlay:'叠层',carousel:'滑动图组（已全部展开）', 'background-text':'背景图文'};
    for(const [index,block] of layout.plan.blocks.entries()){
      const item=document.createElement('div'),caption=document.createElement('p'),img=new Image();
      const url=URL.createObjectURL(layout.assets.get('assets/'+block.image.bundleFile));layoutUrls.push(url);
      img.src=url;img.alt='第 '+(index+1)+' 处排版预览';img.style.cssText='width:100%;height:auto;display:block';
      caption.className='hint';caption.textContent='第 '+(index+1)+' 处：'+block.reasons.map(r=>labels[r]||r).join('、')
        +(block.text?'（区块文字随图保留）':'');item.append(caption,img);list.append(item);
    }
  }
  async function prepareLayout(source){
    const mode=q('matrix-layout').value==='preserve'?'preserve':'auto';
    const platform=q('matrix-platform').value;
    const key=source.report.payload_sha256+':'+source.report.manifest_sha256+':'+mode+':'+platform;
    if(layoutCache?.key===key){showLayout(layoutCache.result);return layoutCache.result;}
    await verifyBundle(source,'wechat');
    try{
      const result=await DraftLayout.prepare(source,DraftLayoutClient.render,{mode,platform,
        onProgress:message=>{q('matrix-layout-status').textContent=message;}});
      layoutCache={key,result};showLayout(result);return result;
    }catch(error){q('matrix-layout-status').textContent='特殊排版处理未完成：'+(error.message||String(error));throw error;}
  }
  q('matrix-layout-check').onclick=handle(async()=>{
    setBusy(true);try{
      if(distributionBundle?.manifest.matrixFormat){
        const platform=q('matrix-platform').value;await verifyBundle(distributionBundle,platform);
        const metadata=JSON.parse(await distributionBundle.assets.get('matrix-format.json').text());
        showLayout({plan:metadata.platforms[platform].layout,assets:distributionBundle.assets});
      }else await prepareLayout(await C.bundle(state));
    }finally{setBusy(false);}
  });
  q('matrix-format-check').onclick=handle(async()=>{
    setBusy(true);
    try{
      const bundle=await prepareDistribution();
      q('matrix-format-title').textContent=DraftDistribution.PLATFORMS[bundle.manifest.targetPlatform].label+' · '+bundle.manifest.title;
      q('matrix-format-notes').textContent=(bundle.report.format_notes||bundle.report.warnings||[]).join(' ')
        +' 预览展示适配结果，保存后的实际效果需在平台重新打开核对。';
      const list=q('matrix-format-changes');list.replaceChildren();
      for(const change of bundle.report.format_changes||[]){
        const item=document.createElement('li'),button=document.createElement('button');
        button.className='text-button';button.textContent=change.detail.replace(/WECHATIMGPH_[\w-]+/g,token=>bundle.manifest.contentImages.find(item=>item.placeholder===token)?.bundleFile||token)+' · '+change.text;
        button.onclick=()=>DraftCompare.locate(change);
        item.append(button);list.append(item);
      }
      if(!list.children.length){const item=document.createElement('li');item.textContent='未发现需要逐处替换的文字样式。';list.append(item);}
      await DraftCompare.show(bundle);
    }finally{setBusy(false);}
  });
  q('matrix-layout').onchange=()=>{
    layoutCache=null;q('matrix-layout-results').hidden=true;
    q('matrix-layout-status').textContent=q('matrix-layout').value==='preserve'
      ?'保留原结构，目标平台可能拆散特殊排版。':'导出或填入前自动检查特殊排版。';
  };
  function setDistributionBundle(bundle){
    layoutCache=null;
    for(const url of layoutUrls)URL.revokeObjectURL(url);layoutUrls.length=0;
    q('matrix-layout-results').hidden=true;q('matrix-layout-preview').replaceChildren();
    q('matrix-layout-status').textContent=bundle
      ?'已载入平台包，直接使用包内排版。需要重新处理时，请导入原微信包再生成。'
      :'导出或填入前自动检查特殊排版。';
    distributionBundle=bundle?.matrixSourceBundle||bundle||null;
    showProcessingLog(distributionBundle);
    const has=!!distributionBundle;
    const current=q('matrix-platform').value;
    const platform=has&&!bundleSupportsPlatform(distributionBundle,current)
      ? distributionBundle.manifest.targetPlatform : current;
    q('matrix-title').disabled=has;
    q('matrix-layout').disabled=has;
    q('matrix-bundle-clear').disabled=!has;
    if(has){
      q('matrix-platform').value=platform;
      const title=bundleTitleForPlatform(distributionBundle,platform);
      distributionTitles.set(platform,title);
      distributionSummaries.set(platform,distributionBundle.manifest.summary||'');
      distributionTitleForSelection();
      q('matrix-bundle-status').textContent='已选择：'+DraftDistribution.PLATFORMS[platform].label
        +(distributionBundle.manifest.targetPlatform!==platform?'（共用一点资讯准备包）':'准备包')+' · 标题「'+title+'」· '
        +distributionBundle.manifest.contentImages.length+' 张图。填入与导出都直接使用该包。';
    } else {
      q('matrix-bundle-status').textContent='未选择准备包：将从当前微信稿生成。';
      distributionTitleForSelection();
    }
    refreshControls();
  }
  q('matrix-platform').onchange=handle(async()=>{
    const platform=q('matrix-platform').value;
    if(distributionBundle){
      if(!bundleSupportsPlatform(distributionBundle,platform))setDistributionBundle(null);
      else {try{await verifyBundle(distributionBundle,platform);setDistributionBundle(distributionBundle);showProcessingLog(await DraftMatrixFormat.view(distributionBundle,platform));}
        catch(error){setDistributionBundle(null);throw error;}}
    }
    distributionTitleForSelection();await refreshDistributionTargets();
  });
  q('matrix-bundle').onchange=handle(async e=>{
    const files=[...e.target.files];e.target.value='';
    if(!files.length)return;
    if(!files.some(file=>file.name==='manifest.json'))
      throw Error('所选文件夹不是准备包：缺少 manifest.json。');
    let loaded=await readBundle(files);
    const target=loaded.manifest.targetPlatform||'wechat';
    if(target==='wechat')
      throw Error('这是微信准备包；左侧「选择准备包」可载入排版，微信填入请用上方「微信公众号」。');
    if(!DraftDistribution.PLATFORMS[target])throw Error('无法识别的平台准备包：'+target);
    const selected=q('matrix-platform').value;
    const active=bundleSupportsPlatform(loaded,selected)?selected:target;
    await verifyBundle(loaded,active);
    loaded.sourceProofText=await loaded.assets.get('source-wechat.json').text();
    if(target==='sohu'&&loaded.manifest.distribution?.schema===DraftDistribution.CONTRACT
      &&(loaded.manifest.distribution.formatPolicy!==DraftSohuFormat.VERSION||loaded.report.processing_log_version!==1))
      loaded=await DraftDistribution.withSohuOmissions(loaded,[]);
    if(target==='toutiao'&&loaded.manifest.distribution?.schema===DraftDistribution.CONTRACT
      &&loaded.manifest.distribution.formatPolicy!==DraftToutiaoFormat.VERSION)
      loaded=await DraftDistribution.withToutiaoFormat(loaded);
    if(target==='yidian'&&loaded.manifest.distribution?.schema===DraftDistribution.CONTRACT
      &&loaded.manifest.distribution.formatPolicy!==DraftYidianFormat.VERSION)
      loaded=await DraftDistribution.withYidianFormat(loaded);
    const runtimeFile=files.find(file=>file.name==='填入运行日志.txt');
    if(runtimeFile)loaded.runtimeLog=(await runtimeFile.text()).split(/\r?\n/).filter(Boolean);
    setDistributionBundle(loaded);
    showProcessingLog(await DraftMatrixFormat.view(loaded,active));
    await refreshDistributionTargets();
    q('matrix-status').textContent='准备包已就绪；选择目标编辑页后点「检查并填入所选平台」，不会重新生成或改写正文。';
    toast('已选择'+DraftDistribution.PLATFORMS[active].label+'准备包');
  });
  q('matrix-bundle-clear').onclick=handle(async()=>{
    setDistributionBundle(null);
    q('matrix-status').textContent='已改用当前微信稿；填入时将重新生成目标平台准备包。';
    await refreshDistributionTargets();
  });
  q('matrix-title').oninput=()=>distributionTitles.set(q('matrix-platform').value,q('matrix-title').value);
  q('matrix-summary').oninput=()=>distributionSummaries.set(q('matrix-platform').value,q('matrix-summary').value);
  q('matrix-shrink').onchange=()=>{
    try{localStorage.setItem('draft-helper-shrink-v1',shrinkMode());}catch{}
    applyShrinkPolicy();
    const platform=q('matrix-platform').value;
    const limit=DraftDistribution.PROFILES?.[platform]?.upload?.maxBytes;
    const on=shrinkMode()==='auto';
    q('matrix-shrink-hint').textContent=(limit
      ? '当前平台单张上限 '+(limit/1048576).toFixed(1)+'MB。': '')
      +(on?'静图超限会自动重编码到上限内；GIF 动图拦下提示。'
          :'超限图片仅提示并停止填入，不做任何压缩。');
  };
  q('matrix-refresh-targets').onclick=handle(refreshDistributionTargets);
  q('matrix-export').onclick=handle(async()=>{
    setBusy(true);
    try{
      const bundle=await prepareDistribution(),platform=q('matrix-platform').value;
      bundle.runtimeLog=[...processingRuntime];
      const zip=await DraftDistributionZip.pack(DraftDistributionZip.filesFor(bundle));
      const url=URL.createObjectURL(zip),link=document.createElement('a');
      link.href=url;link.download=DraftDistributionZip.nameFor(bundle);link.click();
      setTimeout(()=>URL.revokeObjectURL(url),10000);
      q('matrix-status').textContent=bundle.manifest.targetPlatform!==platform
        ? '已导出一点资讯与今日头条共用的原准备包。请解压后选择目录；这不等于已填入或保存。'
        : '已生成 '+DraftDistribution.PLATFORMS[platform].label
          +'准备包。请解压后在扩展「多平台填入」选择整个目录；这不等于已填入或保存。';
    }finally{setBusy(false);}
  });
  q('matrix-fill').onclick=handle(async()=>{
    setBusy(true);
    try{
    const tab=await selectedDistributionTab();
    const bundle=await prepareDistribution(),platform=q('matrix-platform').value;
    const warnings=Array.isArray(bundle.report.warnings)?bundle.report.warnings.join('\n'):'';
    if(!confirm('目标：'+(tab.title||DraftDistribution.PLATFORMS[platform].label)
      +'\n文章：'+bundleTitleForPlatform(bundle,platform)+'\n正文图片：'+bundle.manifest.contentImages.length+' 张'
      +'\n\n'+warnings+'\n\n确认目标编辑器为空白并开始填入？'))return;
    distributionMode=true;distributionTab={id:tab.id};
    fillBundle=bundle;setBusy(true);
    applyShrinkPolicy();
    const oversize=(typeof DraftDistribution.oversizeFor==='function'&&DraftDistribution.PROFILES?.[platform]?.upload?.maxBytes)
      ? DraftDistribution.oversizeFor(DraftDistribution.PROFILES[platform],bundle.manifest) : [];
    q('matrix-status').textContent='正在填入「'+DraftDistribution.PLATFORMS[platform].label
      +'」编辑器：'+(bundle.manifest.contentImages||[]).length+' 张图片逐张上传'
      +(oversize.length&&shrinkMode()==='auto'?'（其中 '+oversize.length+' 张超限，先压缩再上传）':'')
      +'，完成后自动回读核对…';
    try{const outcome=await run();
      const active=outcome?.bundle||bundle;
      q('matrix-status').textContent='已填入「'+DraftDistribution.PLATFORMS[platform].label
        +'」编辑器（'+(active.manifest.contentImages||[]).length+' 张图）。'
        +(outcome?.coverNote?outcome.coverNote+' ':'')
        +'请核对正文、图片与封面对应位置后，在目标平台手动保存草稿。';
      appendProcessingLog(q('matrix-status').textContent);
    }
    catch(error){
      q('matrix-status').textContent='填入未完成：'+(error.message||String(error))
        +'。如果页面已经部分写入，请在页面核对，不要直接重试覆盖。';
      appendProcessingLog(q('matrix-status').textContent);
    }finally{fillBundle=null;distributionTab=null;distributionMode=false;}
    }finally{setBusy(false);}
  });

  q('export-html').onclick=()=>{
    const check=C.preflight(state);if(check.images.some(img=>!C.imageData.test(img.src))&&!confirm('仍有未补齐的图片，导出后也可能缺失。继续导出？'))return;
    download('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>'+C.escape(state.meta.title)+'</title><body>'+C.render(state,true)+'</body></html>',(state.meta.title||'未命名文章').replace(/[<>:"/\\|?*]/g,'_')+'.html');
  };
  q('refresh-targets').onclick=handle(refreshTargets);
  q('refresh-source-tabs').onclick=handle(refreshTargets);
  // 推文封面：页面里只留着地址（一般在 mmbiz.qpic.cn），字节由扩展自己下载后放进封面位。
  // 下载失败不影响导入正文，封面仍可手动选择或用正文图设为封面。
  async function attachCover(captured){
    const url=captured?.coverUrl;
    if(!url)return captured;
    // 分享图常常是 /640 这种缩略尺寸，同一路径的 /0 是原图，优先取原图。
    const candidates=[url];
    const sized=/^(https:\/\/mmbiz\.(?:qpic|qlogo)\.cn\/.+)\/\d{2,4}(\?.*)?$/i.exec(url);
    if(sized)candidates.unshift(sized[1]+'/0'+(sized[2]||''));
    for(const candidate of candidates) {
      try{
        const data=await resolveRemoteImage(candidate);
        if(/^data:image\/gif;/i.test(data)){
          toast('推文封面是 GIF；微信封面需要静态图片，已跳过自动封面。');
          return captured;
        }
        captured.cover=data;
        toast('已读取推文封面，可在「文章信息」中查看或更换。');
        return captured;
      }catch(error){
        if(candidate===candidates.at(-1))
          toast('推文封面没能下载：'+(error.message||String(error))+'。正文已读取，封面可手动选择。');
      }
    }
    return captured;
  }
  q('import-wechat-url').onclick=handle(async()=>{
    const value=q('wechat-source-url').value;WechatCapture.validateUrl(value);setBusy(true);
    try{const captured=await WechatCapture.readUrl(value);q('wechat-source-url').value='';
      await attachCover(captured);
      if(await loadHtml(captured.html,captured)){sourceImageTabId=captured.sourceTabId;await localizeRemoteImages();}await refreshTargets();}
    finally{setBusy(false);}
  });
  q('import-wechat-tab').onclick=handle(async()=>{
    const tabId=q('source-tab').value;if(!tabId)throw Error('请先选择来源页面。');setBusy(true);
    try{const captured=await WechatCapture.readTab(tabId);await attachCover(captured);
      if(await loadHtml(captured.html,captured)){sourceImageTabId=captured.sourceTabId;await localizeRemoteImages();}}finally{setBusy(false);}
  });
  q('send').onclick=handle(async()=>{
    const tab=await targetTab(),check=C.preflight(state),container=q('review-content');container.replaceChildren();
    const line=document.createElement('p');line.textContent=`目标：${tab.title||'微信公众号'}\n文章：${state.meta.title} · ${check.characters} 字 · ${check.images.length} 张图`;line.style.whiteSpace='pre-wrap';container.append(line);
    for(const [type,messages] of [['error',check.errors],['warning',check.warnings]])for(const message of messages){const p=document.createElement('p');p.className=type;p.textContent=message;container.append(p);}
    q('review-fill').disabled=!!check.errors.length;q('review-dialog').showModal();
  });
  q('review-fill').onclick=handle(async()=>{q('review-dialog').close();await performFill();});
  q('retry-cover').onclick=handle(()=>performFill(true));
  q('verify-result').onclick=handle(async()=>{
    if(!lastFill)throw Error('本次工作台还没有填入记录。');
    const tab=await targetTab();if(tab.id!==lastFill.tabId)throw Error('请选择刚才实际填入的微信标签页。');
    setBusy(true);let attached=false;
    try{await attachDebugger(tab.id);attached=true;const actual=await getEditorHtml(tab.id),check=C.compare(lastFill.html,actual);
      if(await readField(tab.id,'#title')!==lastFill.title)check.issues.push('标题已变化');
      if(await readField(tab.id,'#js_description')!==lastFill.summary)check.issues.push('摘要已变化');
      q('result-status').textContent=check.issues.length?'核对发现差异：'+check.issues.join('；'):'文字、图片顺序、标题与摘要核对通过。'+check.styleWarnings.join('')+'\n尚未保存，请在微信中检查视觉效果。';
    }finally{if(attached)await chrome.debugger.detach({tabId:tab.id}).catch(()=>{});setBusy(false);}
  });
  q('sample').onclick=handle(()=>loadHtml('<section style="padding:0 22px"><h2 style="font-size:21px;color:#345b49">把注意力，留给内容</h2><p>一篇文章的节奏，藏在段落之间的留白里。保留原样，让熟悉的表达继续；自由调整，让每一处细节都恰如其分。</p><blockquote>好的排版，让读者自然地读下去。</blockquote><p>你可以试着点击这段文字，单独修改字号或背景；也可以在右侧调整整篇文章的行距。</p><h3>从一个小改动开始</h3><p>把喜欢的排版保存为自己的样式，下次写作时再用。</p></section>',{title:'让一篇文章，读起来更舒服',author:'SyncPress 示例'}));

  async function init() {
    try {templateList=JSON.parse(localStorage.getItem('draft-helper-templates-v1')||'[]').map(C.validateTemplate);}catch{templateList=[];}
    updateTemplates();
    try{
      const db=await database();const saved=await new Promise((resolve,reject)=>{const req=db.transaction('documents').objectStore('documents').get('current');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();
      if(saved?.version===1&&saved.state?.html){state=saved.state;original=saved.original;q('save-state').textContent='已恢复本机稿件';}
    }catch{q('save-state').textContent='自动恢复不可用，请导出备份';}
    render();distributionTitleForSelection();setDistributionBundle(null);
    try{
      const savedMode=localStorage.getItem('draft-helper-shrink-v1');
      if(savedMode==='warn'||savedMode==='auto')q('matrix-shrink').value=savedMode;
    }catch{}
    applyShrinkPolicy();
    try{await refreshTargets();await refreshDistributionTargets();}
    catch{q('result-status').textContent='请从浏览器扩展中打开工作台，以连接编辑页。';}
    readyResolve();
    // 进度镜像到「使用者正在看的那个面板」：多平台分发期间写 #matrix-status，
    // 否则写到微信面板的 #result-status（原先恒定写 #result-status，导致一点号
    // 填入过程与成功提示都落在隐藏的微信面板里，看起来像什么都没发生）。
    new MutationObserver(()=>{
      const text=q('status').textContent;
      if(!text)return;
      (distributionMode?q('matrix-status'):q('result-status')).textContent=text;
      if(distributionMode)appendProcessingLog(text);
    }).observe(q('status'),{childList:true,subtree:true,characterData:true});
  }
  init();
})();
