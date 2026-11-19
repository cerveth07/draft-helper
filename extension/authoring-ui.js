/* Workbench authoring controls; all mutations go through its undo/autosave host. */
'use strict';
const DraftAuthorUI=(()=>{
  function mount(host){
    const A=DraftAuthoring,C=DraftCore,K=DraftComponents,q=id=>document.getElementById(id);
    let selection=[],range=null,anchor=null,clipboard=null,editing=null,dragging=null,custom=[],opened=null,componentImages=[];
    const safe=fn=>async event=>{try{await host.ready;await fn(event);}catch(error){host.toast(error.message||String(error));}};
    const editable=()=>!host.busy()&&host.current().mode==='adjust'&&!host.viewingOriginal();
    function requireEdit(){if(!editable())throw Error('请先切换到「自由调整」，再编辑当前稿。');}
    const currentIds=()=>selection.length?selection:host.activeId()?[host.activeId()]:[];
    function displaySelection(){
      const document=q('article-frame').contentDocument;if(!document)return;
      document.querySelectorAll('[data-dh-selected]').forEach(el=>el.removeAttribute('data-dh-selected'));
      for(const id of currentIds())A.find(document,id)?.setAttribute('data-dh-selected','');
    }
    function onSelection(id,options={}){
      if(!id){selection=[];range=null;refresh();return;}
      if(options.retain&&selection.includes(id)){displaySelection();return;}
      if(options.range&&anchor){
        const rows=A.outline(host.current().html),a=rows.findIndex(item=>item.id===anchor),b=rows.findIndex(item=>item.id===id);
        selection=a>=0&&b>=0?rows.slice(Math.min(a,b),Math.max(a,b)+1).map(item=>item.id):[id];
      }else if(options.multi)selection=selection.includes(id)?selection.filter(value=>value!==id):[...selection,id];
      else selection=[id];
      if(!options.range)anchor=id;range=null;
      if(selection.length>1)q('local-scope').value='selected';else if(q('local-scope').value==='selected')q('local-scope').value='one';
      refresh();displaySelection();
    }
    function select(ids){selection=[...ids];range=null;if(ids.length)host.setActive(ids[0],{retain:true});else host.setActive(null);refresh();displaySelection();}
    function applyResult(result){host.mutate(state=>{state.html=result.html;state.mode='adjust';});select(result.ids||[]);}
    function operate(action,target){requireEdit();stopEditing();const result=A.structural(host.current().html,currentIds(),action,target);applyResult(result);}
    function paintValues(){
      const selected=q('article-frame').contentDocument;let el=A.find(selected,range?.id||host.activeId());if(!el)throw Error('请先选择一个已排版的段落或图片。');
      if(range&&range.start!==range.end){const [node]=A.point(el,range.start+1);el=node.nodeType===3?node.parentElement:node;}
      const computed=selected.defaultView.getComputedStyle(el),values={};
      const groups={typography:['font-size','line-height','letter-spacing'],color:['color','background-color'],emphasis:['font-weight','font-style','text-decoration'],spacing:['margin-top','margin-bottom','text-indent'],alignment:['text-align']};
      for(const checkbox of document.querySelectorAll('[data-brush-field]:checked'))for(const prop of groups[checkbox.dataset.brushField])values[prop]=computed.getPropertyValue(prop);
      if(!Object.keys(values).length)throw Error('请至少勾选一类需要复制的格式。');return values;
    }
    function properties(values){
      requireEdit();const chosen=range&&range.start!==range.end?{...range}:null;stopEditing();
      const safeValues=C.validateStyle(values);
      host.mutate(state=>{
        if(chosen)state.html=A.mark(state.html,chosen,safeValues);
        else {if(!currentIds().length)throw Error('请先选择需要设置格式的内容。');for(const id of currentIds())C.editBlock(state,id,safeValues);}
      });
      range=chosen;displaySelection();
    }
    function capture(document){
      const selected=document.getSelection();if(!selected?.rangeCount)return;
      const found=A.selectionFromRange(document.body,selected.getRangeAt(0));if(!found)return;
      range=found;
      if(!selected.isCollapsed){selection=[found.id];host.setActive(found.id,{retain:true});range=found;}
      q('author-range').textContent=selected.isCollapsed?'光标已定位，可拆分此段。':'已选中 '+[...selected.toString()].length+' 字，格式设置只应用于所选文字。';
    }
    function beginEditing(id){
      requireEdit();if(editing?.id===id)return;stopEditing();
      const source=A.find(C.parse(host.current().html),id),document=q('article-frame').contentDocument,live=A.find(document,id);
      if(!source?.matches(A.textBlocks)||!live)throw Error('请双击一个文字段落进行编辑。');
      if(source.querySelector('p,h1,h2,h3,ul,ol,table,svg,section,div'))throw Error('此块包含嵌套布局，请选择其中的文字段落。');
      selection=[id];host.setActive(id,{retain:true});live.innerHTML=source.innerHTML;live.contentEditable='true';live.dataset.dhEditing='true';live.setAttribute('role','textbox');
      editing={id,node:live,before:host.current().html,checkpointed:false};
      live.addEventListener('input',()=>{
        if(editing?.node!==live)return;
        const html=A.edited(host.current().html,id,live);host.inPlace(state=>{state.html=html;},!editing.checkpointed);editing.checkpointed=true;
        refreshOutline();q('author-range').textContent='正在编辑，已自动保存到本机。Ctrl+Enter 完成；Esc 取消本次编辑。';
      });
      live.addEventListener('paste',event=>{
        event.preventDefault();const text=event.clipboardData.getData('text/plain'),selected=document.getSelection();if(!selected?.rangeCount)return;
        const r=selected.getRangeAt(0);if(!live.contains(r.commonAncestorContainer))return;r.deleteContents();
        const fragment=document.createDocumentFragment();text.split(/\r?\n/).forEach((line,i)=>{if(i)fragment.append(document.createElement('br'));fragment.append(document.createTextNode(line));});
        const tail=fragment.lastChild;r.insertNode(fragment);r.setStartAfter(tail);r.collapse(true);selected.removeAllRanges();selected.addRange(r);live.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'}));
      });
      live.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();cancelEditing();}
        else if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();stopEditing();host.render();}
        else if(event.key==='Enter'){
          event.preventDefault();const selected=document.getSelection();if(!selected?.rangeCount)return;const r=selected.getRangeAt(0);r.deleteContents();const br=document.createElement('br');r.insertNode(br);r.setStartAfter(br);r.collapse(true);selected.removeAllRanges();selected.addRange(r);live.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertLineBreak'}));
        }
      });
      live.focus();const s=document.getSelection(),r=document.createRange();r.selectNodeContents(live);r.collapse(false);s.removeAllRanges();s.addRange(r);
      q('author-finish-edit').hidden=false;q('author-range').textContent='正在编辑此段；Enter 换行，Ctrl+Enter 完成，Esc 取消。粘贴为纯文字。';
    }
    function stopEditing(){if(!editing)return;editing.node.removeAttribute('contenteditable');editing.node.removeAttribute('data-dh-editing');editing.node.removeAttribute('role');editing=null;q('author-finish-edit').hidden=true;}
    function cancelEditing(){if(!editing)return;const {before,checkpointed}=editing;stopEditing();host.cancelEdit(before,checkpointed);host.render();host.toast('已取消本次文字编辑。');}
    function bindFrame(document){
      document.addEventListener('mouseup',()=>{if(editable())capture(document);});
      document.addEventListener('keyup',()=>{if(editable())capture(document);});
      document.addEventListener('dblclick',event=>{if(!editable())return;const el=event.target.closest(A.textBlocks);if(el?.dataset.dhId){event.preventDefault();try{beginEditing(el.dataset.dhId);}catch(error){host.toast(error.message);}}});
      document.addEventListener('keydown',event=>{
        if(!editing&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();q(event.shiftKey?'redo':'undo').click();}
        if(!editing&&editable()&&range&&range.start!==range.end&&(event.ctrlKey||event.metaKey)&&['b','i','u'].includes(event.key.toLowerCase())){event.preventDefault();try{properties(({b:{'font-weight':'700'},i:{'font-style':'italic'},u:{'text-decoration':'underline'}})[event.key.toLowerCase()]);}catch(error){host.toast(error.message);}}
      });
    }
    function handleFrameClick(event){
      if(editing?.node.contains(event.target))return true;
      if(editing){stopEditing();host.render();return true;}
      const selected=event.target.ownerDocument.getSelection();if(selected&&!selected.isCollapsed){capture(event.target.ownerDocument);return true;}return false;
    }
    function refreshOutline(){
      const list=q('author-outline'),rows=A.outline(host.current().html),search=q('author-outline-search').value.trim().toLowerCase();list.replaceChildren();
      const document=C.parse(host.current().html);selection=selection.filter(id=>A.find(document,id));
      for(const row of rows.filter(row=>!search||(row.label+' '+row.text).toLowerCase().includes(search))){
        const line=window.document.createElement('div');line.className='outline-row';line.dataset.blockId=row.id;line.draggable=editable();line.style.setProperty('--depth',Math.min(row.depth,4));
        const input=window.document.createElement('input');input.type='checkbox';input.checked=selection.includes(row.id);input.disabled=!editable();input.setAttribute('aria-label','选择'+row.label+'：'+row.text);
        input.onchange=()=>host.setActive(row.id,{multi:true});
        const button=window.document.createElement('button');button.className='outline-label';button.textContent=row.text;button.title=row.label+' · '+row.text;button.disabled=!editable();
        button.onclick=event=>{host.setActive(row.id,{multi:event.ctrlKey||event.metaKey,range:event.shiftKey});const live=A.find(q('article-frame').contentDocument,row.id);live?.scrollIntoView({block:'center'});};
        const badge=window.document.createElement('span');badge.className='outline-kind';badge.textContent=row.group?'组合':({p:'段落',blockquote:'引用',figure:'图文',img:'图片',svg:'矢量',ul:'列表',ol:'编号',table:'表格',hr:'分隔',pre:'代码',figcaption:'图注'})[row.tag]||row.tag.toUpperCase();badge.title=row.label;line.append(input,badge,button);
        line.classList.toggle('is-selected',selection.includes(row.id));
        line.ondragstart=event=>{dragging=selection.includes(row.id)?currentIds():[row.id];event.dataTransfer.setData('text/plain',row.id);event.dataTransfer.effectAllowed='move';};
        line.ondragover=event=>{if(dragging){event.preventDefault();line.classList.add('drag-over');}};line.ondragleave=()=>line.classList.remove('drag-over');
        line.ondrop=safe(event=>{event.preventDefault();line.classList.remove('drag-over');if(!dragging)return;selection=dragging;dragging=null;operate('move',row.id);});line.ondragend=()=>{dragging=null;};list.append(line);
      }
      if(!list.children.length){const empty=window.document.createElement('p');empty.className='hint';empty.textContent=host.current().html?'没有匹配的内容。':'导入文章后显示章节、段落和图片。';list.append(empty);}
      q('author-selection-count').textContent=selection.length?'已选 '+selection.length+' 项':'未选择内容';
      const active = A.find(document, host.activeId());
      window.document.querySelector('[data-author-action="edit"]').hidden = !editable() || !active?.matches(A.textBlocks);
    }
    function refresh(){
      refreshOutline();const enabled=editable(),has=currentIds().length>0;
      for(const el of document.querySelectorAll('[data-author-action]'))el.disabled=!enabled||(!has&&!['library','select-all'].includes(el.dataset.authorAction));
      for(const el of document.querySelectorAll('[data-inline-format],#author-inline-color'))el.disabled=!enabled||!has;
      q('author-brush-copy').disabled=!enabled||!has;
      q('author-brush-apply').disabled=!enabled||!clipboard||(!has&&!range);q('author-components-open').disabled=host.busy();
      q('author-selection-hint').textContent=enabled?'Ctrl 多选 · Shift 连选 · 拖动排序 · 双击正文改字':'切换到自由调整后，可编排当前稿。';
    }
    for(const button of document.querySelectorAll('[data-author-action]'))button.onclick=safe(async()=>{
      const action=button.dataset.authorAction;
      if(action==='library'){await showLibrary();return;}requireEdit();
      if(action==='edit'){beginEditing(host.activeId());return;}
      if(action==='section'){select(A.section(host.current().html,host.activeId()));return;}
      if(action==='select-all'){select(A.outline(host.current().html).map(row=>row.id));return;}
      if(action==='split'){const chosen=range&&{...range};stopEditing();if(!chosen)throw Error('请先在文字中放置光标，或选中需要拆分的文字起点。');applyResult(A.split(host.current().html,chosen.id,chosen.start));return;}
      if(action==='merge'){stopEditing();applyResult(A.merge(host.current().html,currentIds()));return;}
      if(action==='delete'&&!confirm('从当前稿移除选中的内容？可通过撤销恢复。'))return;
      if(action==='save-component'){await saveComponent();return;}
      operate(action);
    });
    q('author-finish-edit').onclick=()=>{stopEditing();host.render();};q('author-outline-search').oninput=refreshOutline;
    q('author-brush-copy').onclick=safe(()=>{requireEdit();clipboard=paintValues();q('author-brush-state').textContent='已提取格式。选择目标文字或多段内容，再点击应用。';refresh();});
    q('author-brush-apply').onclick=safe(()=>{if(!clipboard)throw Error('请先提取格式。');properties(clipboard);host.toast('格式已应用，文字与链接保持原内容。');});
    for(const button of document.querySelectorAll('[data-inline-format]')){
      button.onmousedown=event=>event.preventDefault();
      button.onclick=safe(()=>properties(({bold:{'font-weight':'700'},italic:{'font-style':'italic'},underline:{'text-decoration':'underline'},clear:{'font-weight':'400','font-style':'normal','text-decoration':'none'}})[button.dataset.inlineFormat]));
    }
    q('author-inline-color').oninput=safe(()=>properties({'color':q('author-inline-color').value}));
    async function componentStore(value){
      const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('draft-helper-studio',1);request.onupgradeneeded=()=>request.result.createObjectStore('documents');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      try{return await new Promise((resolve,reject)=>{const tx=db.transaction('documents',value?'readwrite':'readonly'),store=tx.objectStore('documents');let result;
        const request=value?store.put(value,'components-v1'):store.get('components-v1');request.onsuccess=()=>{result=request.result;};request.onerror=()=>reject(request.error);tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||Error('组件保存中断'));});}finally{db.close();}
    }
    async function loadComponents(){const saved=await componentStore();if(!saved)return;custom=Array.isArray(saved)?saved.map(K.validate):[];}
    function renderLibrary(){
      q('component-export').hidden = !custom.length;
      const search=q('component-search').value.trim().toLowerCase(),category=q('component-category').value,list=q('component-list');list.replaceChildren();
      const items=[...K.presets,...custom].filter(item=>(!category||item.category===category)&&(!search||(item.name+' '+item.description).toLowerCase().includes(search)));
      for(const item of items){const card=document.createElement('article');card.className='component-card';const name=document.createElement('strong'),note=document.createElement('p'),button=document.createElement('button');
        name.textContent=item.name;note.textContent=item.description;note.className='hint';button.textContent=item.fields?.length||item.images?'填写并插入':'预览并插入';button.onclick=safe(()=>openComponent(item));card.append(name,note,button);
        if(item.html){const remove=document.createElement('button');remove.className='text-button';remove.textContent='删除收藏';remove.onclick=safe(async()=>{if(!confirm('删除组件收藏“'+item.name+'”？文章中的内容会保留。'))return;custom=custom.filter(x=>x.id!==item.id);await componentStore(custom);renderLibrary();});const actions = document.createElement('details');
          const label = document.createElement('summary');
          label.textContent = '管理收藏';
          actions.append(label, remove);
          card.append(actions);}list.append(card);
      }
      if(!items.length){const note=document.createElement('p');note.className='hint';note.textContent='暂无匹配组件。可以从当前稿选择图文组合后收藏。';list.append(note);}
    }
    async function showLibrary(){await loadComponents();stopEditing();renderLibrary();q('component-library-dialog').showModal();}
    q('author-components-open').onclick=safe(showLibrary);q('component-search').oninput=renderLibrary;q('component-category').onchange=renderLibrary;
    function values(){return Object.fromEntries([...q('component-fields').querySelectorAll('[data-component-field]')].map(el=>[el.dataset.componentField,el.value]));}
    function componentHtml(){return opened.html||K.build(opened.id,values(),componentImages);}
    async function updateComponentPreview(){
      try{const html=componentHtml();q('component-preview').srcdoc='<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\';img-src data:;style-src \'unsafe-inline\'"><style>body{font:16px/1.8 system-ui;max-width:390px;margin:20px auto;padding:16px;color:#333}img{max-width:100%;height:auto}</style>'+html;q('component-error').textContent='';}
      catch(error){q('component-error').textContent=error.message;q('component-preview').srcdoc='<p>选择所需图片后显示组件预览。</p>';}
    }
    function openComponent(item){
      opened=item;componentImages=[];q('component-image-files').value='';q('component-editor-title').textContent=item.name;q('component-fields').replaceChildren();q('component-images-field').hidden=!item.images;
      q('component-image-hint').textContent=item.images?'请选择 '+item.images+' 张本地图片，按选择顺序排列。原始图片不裁剪、不压缩。':'';
      for(const field of item.fields||[]){const label=document.createElement('label'),input=document.createElement(field.multiline?'textarea':'input');label.textContent=field.label;input.dataset.componentField=field.key;input.value=field.value;if(field.multiline)input.rows=3;input.oninput=()=>updateComponentPreview();label.append(input);q('component-fields').append(label);}
      q('component-library-dialog').close();q('component-editor-dialog').showModal();updateComponentPreview();
    }
    q('component-image-files').onchange=safe(async event=>{const files=[...event.target.files];componentImages=[];if(files.length!==(opened.images||0)){await updateComponentPreview();throw Error('请恰好选择 '+opened.images+' 张图片。');}componentImages=await Promise.all(files.map(C.fileToData));await updateComponentPreview();});
    q('component-insert').onclick=safe(async()=>{
      const html=componentHtml();
      if(host.current().mode!=='adjust')host.mutate(state=>{state.mode='adjust';});requireEdit();
      applyResult(A.insert(host.current().html,html,host.activeId()));q('component-editor-dialog').close();host.toast('已插入'+opened.name+'，可双击文字继续编辑。');
    });
    async function saveComponent(){
      stopEditing();const html=A.fragment(C.render(host.current()),currentIds());
      const d=C.parse(html);for(const el of d.querySelectorAll('*'))for(const attr of [...el.attributes])if(attr.name.startsWith('data-dh-'))el.removeAttribute(attr.name);
      const name=prompt('为选中的图文组件命名：','我的图文组件');if(!name?.trim())return;
      const record=K.validate({version:1,id:'custom-'+Date.now().toString(36),name:name.trim(),html:'<section data-dh-group="'+C.escape(name.trim())+'">'+d.body.innerHTML+'</section>'});
      await loadComponents();custom.push(record);await componentStore(custom);host.toast('已收藏到常用组件库，可跨文章复用。');
    }
    q('component-export').onclick=safe(async()=>{await loadComponents();if(!custom.length)throw Error('暂无自定义组件可导出。');host.download(JSON.stringify({schema:'DRAFT_HELPER_COMPONENTS_V1',components:custom},null,2),'我的图文组件.draft-components.json','application/json');});
    q('component-import').onchange=safe(async event=>{
      const file=event.target.files[0];event.target.value='';if(!file)return;if(file.size>24*1024*1024)throw Error('组件文件超过 24MB。');
      const data=JSON.parse(await file.text());if(data.schema!=='DRAFT_HELPER_COMPONENTS_V1'||!Array.isArray(data.components)||data.components.length>100)throw Error('不是支持的组件库文件。');
      const incoming=data.components.map(K.validate);await loadComponents();const known=new Set(custom.map(item=>item.id));for(const item of incoming)if(!known.has(item.id)){custom.push(item);known.add(item.id);}await componentStore(custom);renderLibrary();host.toast('组件库已导入。');
    });
    return {refresh,onSelection,select,properties,bindFrame,handleFrameClick,stopEditing,reset(){stopEditing();selection=[];range=null;anchor=null;},selectedIds:currentIds,range:()=>range,showLibrary};
  }
  return {mount};
})();
