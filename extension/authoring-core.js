/* Structural editing of the local working copy. Source packages are never modified. */
'use strict';
const DraftAuthoring=(()=>{
  const textBlocks='p,h1,h2,h3,h4,h5,h6,li,pre,figcaption';
  const types={p:'段落',h1:'一级标题',h2:'二级标题',h3:'三级标题',h4:'四级标题',h5:'五级标题',h6:'六级标题',blockquote:'引用',figure:'图文',img:'图片',svg:'矢量图',hr:'分隔线',ul:'列表',ol:'编号列表',table:'表格',pre:'代码',figcaption:'图注'};
  let serial=0;
  const doc=html=>new DOMParser().parseFromString(html,'text/html');
  const find=(d,id)=>[...d.querySelectorAll('[data-dh-id]')].find(el=>el.dataset.dhId===String(id));
  const fresh=()=> 'a'+Date.now().toString(36)+'-'+(++serial).toString(36);
  function ids(root,renew=false){
    const used=new Set(),htmlIds=new Set(),renamed=new Map();for(const el of [root,...root.querySelectorAll('*')]){
      if(el===root&&el.tagName==='BODY')continue;
      if(renew||!el.dataset.dhId||used.has(el.dataset.dhId))el.dataset.dhId=fresh();used.add(el.dataset.dhId);
      if(el.id){if(renew||htmlIds.has(el.id)){const previous=el.id;el.id='copy-'+fresh();if(renew)renamed.set(previous,el.id);}htmlIds.add(el.id);}
    }
    if(renew)for(const link of root.querySelectorAll('a[href^="#"]')){const old=link.getAttribute('href').slice(1);if(renamed.has(old))link.setAttribute('href','#'+renamed.get(old));}
    return root;
  }
  function outline(html){
    const d=doc(html),rows=[];let heading=0;
    function walk(parent,depth){for(const el of parent.children){
      const tag=el.tagName.toLowerCase(),group=el.getAttribute('data-dh-group');
      if(group||types[tag]){
        if(/^h[1-6]$/.test(tag))heading=Number(tag[1]);
        rows.push({id:el.dataset.dhId,tag,label:group||types[tag],text:(el.textContent.trim()||el.getAttribute('alt')||types[tag]).replace(/\s+/g,' ').slice(0,95),depth:group?depth:Math.max(depth,/^h/.test(tag)?heading-1:heading),group:!!group});
        if(group)walk(el,depth+1);
      }else if(!['svg','style','script'].includes(tag))walk(el,depth);
    }}walk(d.body,0);return rows.filter(row=>row.id);
  }
  function unit(el){
    const protectedParent=el.closest('figure,blockquote,ul,ol,table,[data-dh-group]');
    if(protectedParent&&protectedParent!==el)el=protectedParent;
    while(el.parentElement&&el.parentElement!==el.ownerDocument.body
      &&el.parentElement.parentElement!==el.ownerDocument.body
      &&/^(SECTION|DIV|ARTICLE|MAIN)$/.test(el.parentElement.tagName)
      &&el.parentElement.children.length===1
      &&![...el.parentElement.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))el=el.parentElement;
    return el;
  }
  function selected(d,selectedIds,structural=false){
    const nodes=[...new Set(selectedIds.map(id=>find(d,id)).filter(Boolean).map(el=>structural?unit(el):el))];
    const roots=nodes.filter(el=>!nodes.some(parent=>parent!==el&&parent.contains(el)));
    return roots.sort((a,b)=>a.compareDocumentPosition(b)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1);
  }
  function siblings(nodes){
    if(!nodes.length)throw Error('请先选择内容。');
    if(nodes.some(el=>el.parentElement!==nodes[0].parentElement))throw Error('这些内容位于不同层级。请先选择整节或同一层级的内容。');
  }
  function section(html,id){
    const d=doc(html),heading=find(d,id);if(!heading||!/^H[1-6]$/.test(heading.tagName))throw Error('请先选择一个分节标题。');
    const first=unit(heading),level=Number(heading.tagName[1]),result=[];
    for(let el=first;el;el=el.nextElementSibling){
      const next=el.matches('h1,h2,h3,h4,h5,h6')?el:el.querySelector('h1,h2,h3,h4,h5,h6');
      if(el!==first&&next&&Number(next.tagName[1])<=level)break;
      if(el.dataset.dhId)result.push(el.dataset.dhId);
    }return result;
  }
  function structural(html,selection,action,target){
    const d=doc(html),nodes=selected(d,selection,true);siblings(nodes);const set=new Set(nodes);
    const heading=nodes[0].matches('h1,h2,h3,h4,h5,h6')?nodes[0]:nodes[0].querySelector('h1,h2,h3,h4,h5,h6');
    if(heading&&['up','down'].includes(action)){
      const sectionNodes=selected(d,section(html,heading.dataset.dhId),true);
      if(sectionNodes.length===nodes.length&&sectionNodes.every(el=>set.has(el))){
        if(action==='down'){
          const next=nodes.at(-1).nextElementSibling,nextHeading=next&&(next.matches('h1,h2,h3,h4,h5,h6')?next:next.querySelector('h1,h2,h3,h4,h5,h6'));
          if(nextHeading){const following=selected(d,section(html,nextHeading.dataset.dhId),true);if(following.length&&following[0].parentElement===nodes[0].parentElement)following.at(-1).after(...nodes);}
        }else{
          let previous=nodes[0].previousElementSibling;
          while(previous){const h=previous.matches('h1,h2,h3,h4,h5,h6')?previous:previous.querySelector('h1,h2,h3,h4,h5,h6');if(h&&Number(h.tagName[1])<=Number(heading.tagName[1])){previous.before(...nodes);break;}previous=previous.previousElementSibling;}
        }
        return {html:d.body.innerHTML,ids:nodes.map(el=>el.dataset.dhId)};
      }
    }
    if(action==='up')for(const el of nodes){const before=el.previousElementSibling;if(before&&!set.has(before))before.before(el);}
    else if(action==='down')for(const el of [...nodes].reverse()){const after=el.nextElementSibling;if(after&&!set.has(after))after.after(el);}
    else if(action==='move'){
      const to=unit(find(d,target)||d.body);if(nodes.includes(to)||nodes.some(el=>el.contains(to)))return {html,ids:selection};
      if(to.parentElement!==nodes[0].parentElement)throw Error('拖动目标和内容需要位于同一层级。');
      for(const el of nodes)to.before(el);
    }else if(action==='duplicate'){
      const copies=nodes.map(el=>ids(el.cloneNode(true),true)),after=nodes.at(-1);after.after(...copies);
      return {html:d.body.innerHTML,ids:copies.map(el=>el.dataset.dhId)};
    }else if(action==='delete')nodes.forEach(el=>el.remove());
    else if(action==='group'){
      const between=[...nodes[0].parentElement.children].slice([...nodes[0].parentElement.children].indexOf(nodes[0]),[...nodes[0].parentElement.children].indexOf(nodes.at(-1))+1);
      if(between.some(el=>!set.has(el)))throw Error('请连续选择需要组合的内容，避免改变其他段落的位置。');
      const group=d.createElement('section');group.dataset.dhId=fresh();group.dataset.dhGroup='内容组合';group.style.cssText='margin:0;padding:0';nodes[0].before(group);group.append(...nodes);
      return {html:d.body.innerHTML,ids:[group.dataset.dhId]};
    }else if(action==='ungroup'){
      if(nodes.length!==1||!nodes[0].hasAttribute('data-dh-group'))throw Error('请选择一个由工作台创建的内容组合。');
      const children=[...nodes[0].children];nodes[0].replaceWith(...nodes[0].childNodes);return {html:d.body.innerHTML,ids:children.map(el=>el.dataset.dhId)};
    }else throw Error('无法识别的编排操作。');
    return {html:d.body.innerHTML,ids:nodes.filter(el=>el.isConnected).map(el=>el.dataset.dhId)};
  }
  function point(el,offset){
    const walker=el.ownerDocument.createTreeWalker(el,NodeFilter.SHOW_TEXT);let node,last;
    while((node=walker.nextNode())){last=node;if(offset<=node.textContent.length)return[node,offset];offset-=node.textContent.length;}
    if(last)return[last,last.textContent.length];return[el,0];
  }
  function rangeOf(el,start,end){
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>el.textContent.length)throw Error('文字选择已变化，请重新选择。');
    const r=el.ownerDocument.createRange();r.setStart(...point(el,start));r.setEnd(...point(el,end));return r;
  }
  function selectionFromRange(root,range){
    const a=range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement;
    const b=range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement;
    const el=a.closest(textBlocks);if(!el||!root.contains(el)||!el.contains(b))return null;
    const before=range.cloneRange();before.selectNodeContents(el);before.setEnd(range.startContainer,range.startOffset);
    const end=range.cloneRange();end.selectNodeContents(el);end.setEnd(range.endContainer,range.endOffset);
    return {id:el.dataset.dhId,start:before.toString().length,end:end.toString().length};
  }
  function mark(html,selection,properties){
    const d=doc(html),el=find(d,selection.id);if(!el)throw Error('原文字段落已不存在。');
    const r=rangeOf(el,selection.start,selection.end);if(r.collapsed)throw Error('请先选中需要设置格式的文字。');
    const span=d.createElement('span');span.append(r.extractContents());
    for(const n of [span,...span.querySelectorAll('*')])if(!n.matches('img,svg,svg *')){
      const locks=new Set((n.dataset.dhLocal||'').split(',').filter(Boolean));
      for(const[prop,value]of Object.entries(properties)){n.style.setProperty(prop,value);locks.add(prop);}n.dataset.dhLocal=[...locks].join(',');
    }
    r.insertNode(span);ids(d.body);return d.body.innerHTML;
  }
  function split(html,id,offset){
    const d=doc(html),el=find(d,id);if(!el?.matches(textBlocks))throw Error('请在普通文字段落中放置光标。');
    if(offset<=0||offset>=el.textContent.length)throw Error('请将光标放在段落中间需要拆分的位置。');
    const a=rangeOf(el,0,offset).cloneContents(),b=rangeOf(el,offset,el.textContent.length).cloneContents();
    const next=el.cloneNode(false);el.replaceChildren(a);next.append(b);ids(next,true);el.after(next);ids(d.body);
    return {html:d.body.innerHTML,ids:[el.dataset.dhId,next.dataset.dhId]};
  }
  function merge(html,selection){
    const d=doc(html),nodes=selected(d,selection);if(nodes.length===1&&nodes[0].nextElementSibling)nodes.push(nodes[0].nextElementSibling);
    siblings(nodes);if(nodes.length<2||nodes.some((el,i)=>!el.matches(textBlocks)||el.tagName!==nodes[0].tagName||i&&nodes[i-1].nextElementSibling!==el))throw Error('请选择相邻、类型相同的文字段落。');
    const first=nodes[0];for(const el of nodes.slice(1)){if(/[a-z0-9]$/i.test(first.textContent)&&/^[a-z0-9]/i.test(el.textContent))first.append(d.createTextNode(' '));first.append(...el.childNodes);el.remove();}
    return {html:d.body.innerHTML,ids:[first.dataset.dhId]};
  }
  function edited(html,id,live){
    const d=doc(html),el=find(d,id);if(!el?.matches(textBlocks))throw Error('此内容不支持直接文字编辑。');
    const clone=live.cloneNode(true);
    clone.querySelectorAll('script,style,iframe,object,embed,form,input,button,textarea,select,video,audio,canvas').forEach(n=>n.remove());
    for(const n of [clone,...clone.querySelectorAll('*')])for(const attr of [...n.attributes])
      if(/^on/i.test(attr.name)||['contenteditable','autofocus','data-dh-selected','data-dh-editing','role','tabindex'].includes(attr.name))n.removeAttribute(attr.name);
    for(const a of clone.querySelectorAll('a[href]'))if(!/^(https?:|mailto:|tel:|#)/i.test(a.getAttribute('href')))a.removeAttribute('href');
    for(const image of clone.querySelectorAll('img')){
      const original=find(d,image.dataset.dhId);if(original?.tagName==='IMG')image.replaceWith(original.cloneNode(true));else image.remove();
    }
    el.replaceChildren(...clone.childNodes);ids(d.body);return d.body.innerHTML;
  }
  function fragment(html,selection){
    const d=doc(html),nodes=selected(d,selection,true);siblings(nodes);return nodes.map(el=>el.outerHTML).join('');
  }
  function insert(html,fragmentHtml,afterId){
    const d=doc(html),incoming=doc(fragmentHtml);ids(incoming.body,true);const elements=[...incoming.body.childNodes];
    const anchor=find(d,afterId);if(anchor)unit(anchor).after(...elements);
    else {let root=d.body;while(root.children.length===1&&root.firstElementChild.matches('section,article,main,div')&&!root.firstElementChild.hasAttribute('data-dh-group'))root=root.firstElementChild;root.append(...elements);}
    return {html:d.body.innerHTML,ids:elements.filter(n=>n.nodeType===1).map(n=>n.dataset.dhId)};
  }
  return {textBlocks,types,find,ids,outline,unit,selected,section,structural,point,selectionFromRange,mark,split,merge,edited,fragment,insert};
})();
