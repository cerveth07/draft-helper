'use strict';

const TOUTIAO_TITLE = 'textarea[placeholder^="请输入文章标题"]';

function toutiaoEditorState() {
  const visible = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const bodies = [...document.querySelectorAll('.ProseMirror[contenteditable="true"]')].filter(visible);
  const titles = [...document.querySelectorAll('textarea[placeholder^="请输入文章标题"]')].filter(visible);
  if (bodies.length !== 1 || titles.length !== 1) throw new Error('未找到唯一的头条正文和标题编辑器，请打开文章发布页。');
  return { html: bodies[0].innerHTML, title: titles[0].value };
}

function toutiaoBodyEmptyState() {
  const bodies = [...document.querySelectorAll('.ProseMirror[contenteditable="true"]')]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (bodies.length !== 1) throw new Error('头条正文编辑器不唯一。');
  const body = bodies[0], clone = body.cloneNode(true);
  for (const el of clone.querySelectorAll('button,[role="button"],[role="toolbar"],.ProseMirror-widget,.ql-clipboard')) el.remove();
  let ignoredPlaceholders = 0;
  // Ignore only marked editor decorations. A user's paragraph saying 请输入正文 is real content.
  for (const el of clone.querySelectorAll('.ProseMirror-widget,.ProseMirror-placeholder,[data-editor-placeholder]')) {
    if (el.getAttribute('contenteditable') !== 'false' || el.querySelector('img,video,audio,iframe,svg,canvas')) continue;
    const text = el.textContent.replace(/\s|[\u200b-\u200f\u2060\ufeff]/g, '');
    if (text === '请输入正文' || !text) { el.remove(); ignoredPlaceholders++; }
  }
  const normalize = (text) => text.replace(/\s|[\u200b-\u200f\u2060\ufeff]/g, '');
  const text = normalize(clone.textContent);
  const media = [...body.querySelectorAll('img,video,audio,iframe,svg,canvas')].filter((el) => {
    if (el.closest('button,[role="button"],[role="toolbar"],.ProseMirror-widget')) return false;
    const style = getComputedStyle(el), rect = el.getBoundingClientRect();
    if (!el.getClientRects().length || style.visibility === 'hidden' || style.display === 'none') return false;
    return el.tagName !== 'IMG' || rect.width >= 32 || rect.height >= 32;
  });
  return { empty: !text && !media.length, textLength: text.length, mediaCount: media.length,
    ignoredPlaceholders, invisibleCharacterCount: (body.textContent.match(/[\u200b-\u200f\u2060\ufeff]/g) || []).length,
    imageNodes: [...body.querySelectorAll('img')].slice(0, 24).map((img) => {
      const rect = img.getBoundingClientRect();
      return { class: img.className, parentClass: img.parentElement?.className,
        parentTag: img.parentElement?.tagName.toLowerCase(), scheme: img.src.split(':')[0],
        width: rect.width, height: rect.height, visible: !!img.getClientRects().length
          && getComputedStyle(img).visibility !== 'hidden', toolbar: !!img.closest('button,[role="button"],[role="toolbar"]') };
    }),
    children: [...bodies[0].children].slice(0, 12).map((el) => ({ tag: el.tagName.toLowerCase(),
      class: el.className, contenteditable: el.getAttribute('contenteditable'),
      placeholder: el.getAttribute('data-placeholder') })) };
}

function toutiaoContentImages(root) {
  const selected = [];
  for (const img of root.querySelectorAll('img')) {
    if (img.closest('button,[role="button"],[role="toolbar"]')) continue;
    const rect = img.getBoundingClientRect(), style = getComputedStyle(img);
    if (!img.getClientRects().length || style.visibility === 'hidden' || style.display === 'none') continue;
    // Small editor icons are not article pictures. Wide, short footer strips remain valid.
    if (rect.width < 32 && rect.height < 32) continue;
    const duplicate = selected.some((other) => {
      const box = other.getBoundingClientRect();
      return other.src === img.src && Math.abs(box.x - rect.x) < 1 && Math.abs(box.y - rect.y) < 1
        && Math.abs(box.width - rect.width) < 1 && Math.abs(box.height - rect.height) < 1;
    });
    if (!duplicate) selected.push(img);
  }
  return selected;
}

// 只读文件头判尺寸：1×1 的追踪像素/占位图各平台都会丢弃，等它上传只会等到超时。
async function toutiaoImagePixelSize(file) {
  if (!file?.slice) return null;
  let head;
  try { head = new Uint8Array(await file.slice(0, 64).arrayBuffer()); } catch (_) { return null; }
  const le16 = (at) => head[at] | (head[at + 1] << 8);
  if (head.length >= 10 && head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46)
    return { width: le16(6), height: le16(8) };
  if (head.length >= 24 && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47)
    return { width: ((head[16] << 24) | (head[17] << 16) | (head[18] << 8) | head[19]) >>> 0,
      height: ((head[20] << 24) | (head[21] << 16) | (head[22] << 8) | head[23]) >>> 0 };
  if (head.length >= 30 && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46
      && head[8] === 0x57) {
    const kind = String.fromCharCode(head[12], head[13], head[14], head[15]);
    if (kind === 'VP8X')
      return { width: 1 + (head[24] | (head[25] << 8) | (head[26] << 16)),
        height: 1 + (head[27] | (head[28] << 8) | (head[29] << 16)) };
    if (kind === 'VP8 ') return { width: le16(26) & 0x3fff, height: le16(28) & 0x3fff };
    if (kind === 'VP8L') {
      const value = (head[21] | (head[22] << 8) | (head[23] << 16) | (head[24] << 24)) >>> 0;
      return { width: (value & 0x3fff) + 1, height: ((value >>> 14) & 0x3fff) + 1 };
    }
  }
  return null;
}

async function uploadImageToToutiao(tabId, file, meta = {}) {
  const dataUrl = await readFileAsDataUrl(file);
  const mime = file.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }[file.name.split('.').pop().toLowerCase()]);
  if (!mime || !mime.startsWith('image/')) throw new Error('无法识别图片格式：' + file.name);
  const upload = async (encoded, filename, type, imagesOf, label, details) => {
      const findBody = () => {
        const bodies = [...document.querySelectorAll('.ProseMirror[contenteditable="true"]')]
          .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
        if (bodies.length !== 1) throw new Error('头条正文编辑器不唯一，已停止上传。');
        return bodies[0];
      };
      const urlOf = (img) => img.currentSrc || img.src;
      let bytes = Uint8Array.from(atob(encoded.slice(encoded.indexOf(',') + 1)), (ch) => ch.charCodeAt(0));
      let converted=false;
      if(type==='image/webp'||type==='image/bmp'){
        if(type==='image/webp'&&String.fromCharCode(...bytes.slice(12,16))==='VP8X'&&(bytes[20]&2))throw Error('头条上传遇到动画WebP，无法无损转为静图；请保留动效另行处理。');
        const image=new Image();image.src=encoded;await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;canvas.getContext('2d').drawImage(image,0,0);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('头条静态图片转换失败。');
        bytes=new Uint8Array(await blob.arrayBuffer());filename=filename.replace(/\.[^.]+$/,'')+'.png';type='image/png';converted=true;
      }
      const uploadedSha=details?[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join(''):null;
      const paste = () => {
        const body = findBody();
        const transfer = new DataTransfer();
        transfer.items.add(new File([bytes], filename, { type }));
        body.focus();
        const range = document.createRange();
        range.selectNodeContents(body); range.collapse(false);
        const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
        // Let the site's own paste handler upload the original file. No guessed HTTP endpoint.
        body.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer }));
      };
      const before = imagesOf(findBody()).map(urlOf);
      paste();
      const startedAt = Date.now(), deadline = startedAt + 30000;
      let retried = false;
      while (Date.now() < deadline) {
        const images = imagesOf(findBody());
        if (images.length > before.length + 1) throw new Error('头条粘贴后新增多张图片，无法确定对应关系。');
        if (images.length === before.length + 1) {
          if (before.some((src, i) => urlOf(images[i]) !== src)) throw new Error('头条上传过程中已有图片被改动，已停止。');
          const url = urlOf(images[before.length]);
          if (/^https?:\/\//.test(url)) {
            const nodes=[];findBody().pmViewDesc?.node?.descendants(n=>{if(n.type.name==='image')nodes.push(n.attrs.data)});
            const data=nodes[before.length],original=/^https?:\/\//.test(data?.backUpUrl||'')?data.backUpUrl:url;
            return {url:original,usedOriginal:original!==url,converted,uploadedSha,uploadedName:filename,uploadedBytes:bytes.length,uploadedType:type,width:data?.backNaturalWidth||data?.naturalWidth||images[before.length].naturalWidth,height:data?.backNaturalHeight||data?.naturalHeight||images[before.length].naturalHeight};
          }
        } else if (!retried && Date.now() - startedAt > 12000) {
          // 12 秒仍没有任何新图：多半是光标被编辑器重置，重贴一次再等。
          retried = true;
          paste();
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const images = imagesOf(findBody());
      const schemes = images.map((img) => urlOf(img).split(':')[0]);
      throw new Error('头条上传等待 30 秒仍未取得远程图片地址：' + label + '。正文此刻有内容图片 '
        + images.length + ' 张（粘贴前 ' + before.length + ' 张），地址类型 ' + (schemes.join(',') || '无')
        + '。常见原因：图片过小被平台丢弃、平台限流、编辑页已掉线；请保留页面检查。');
  };
  const label = (meta.index ? '第 ' + meta.index + '/' + meta.total + ' 张 ' : '') + file.name
    + '（' + file.size + ' 字节）';
  const expression = '(' + upload.toString() + ')('
    + [dataUrl, file.name, mime].map(JSON.stringify).join(',') + ',(' + toutiaoContentImages.toString() + '),'
    + JSON.stringify(label) + ','+Boolean(meta.details)+')';
  const result = await evaluate(tabId, expression);
  if (!result||typeof result.url !== 'string' || !/^https?:\/\//.test(result.url)) throw new Error('未取得头条图片上传结果。');
  return meta.details?result:result.url;
}

function focusToutiaoBody() {
  const bodies = [...document.querySelectorAll('.ProseMirror[contenteditable="true"]')]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (bodies.length !== 1) throw new Error('头条正文编辑器不唯一。');
  bodies[0].focus();
}

function pasteToutiaoBody(content,requireNative=false) {
  const bodies = [...document.querySelectorAll('.ProseMirror[contenteditable="true"]')]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (bodies.length !== 1) throw new Error('头条正文编辑器不唯一。');
  const body = bodies[0];
  const host=body.closest('.syl-editor');
  const key=host&&Object.keys(host).find(key=>/^__react(?:InternalInstance|Fiber)/.test(key));
  let fiber=key?host[key]:null,editor;
  for(let count=0;fiber&&count<16;count++,fiber=fiber.return){
    const candidate=fiber.stateNode?.editor;
    if(candidate?.view?.dom===body&&typeof candidate.setHTML==='function'){editor=candidate;break;}
  }
  if(editor){
    // Use the same native document transaction as the editor's own setHTML
    // action. Clipboard import starts a second image download/AI optimization.
    editor.setHTML(content,{allowUndo:true,silent:false,mergeEmpty:false,keepWhiteSpace:true});
    return {path:'native-document'};
  }
  if(requireNative)throw Error('无法取得头条原生编辑器，已停止，避免剪贴板重贴改变图片。');
  const expected = document.createElement('div'); expected.innerHTML = content;
  const transfer = new DataTransfer();
  transfer.setData('text/html', content);
  transfer.setData('text/plain', expected.textContent);
  body.focus();
  const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
  body.dispatchEvent(event);
  if (!event.defaultPrevented) throw new Error('头条编辑器未接收 HTML 粘贴，已停止；请保留页面供检查。');
}

function toutiaoNativeImages(content,copies) {
  const root=document.createElement('div');root.innerHTML=content;
  const images=[...root.querySelectorAll('img')];if(images.length!==copies.length)throw Error('头条原生图片元信息数量不一致。');
  images.forEach((image,index)=>{
    const copy=copies[index],box=document.createElement('div');box.className='pgc-img';
    image.setAttribute('image_type',copy.uploadedType||'image/png');image.setAttribute('mime_type',copy.uploadedType||'image/png');
    image.setAttribute('img_width',String(copy.width||0));image.setAttribute('img_height',String(copy.height||0));
    const source=new URL(image.src);
    if(source.protocol==='https:'&&/(?:^|\.)toutiao(?:img)?\.com$|(?:^|\.)byteimg\.com$/.test(source.hostname))image.setAttribute('web_uri',source.pathname.slice(1).split('~')[0]);
    const anchor=image.closest('a[href]'),target=anchor||image,parent=target.parentElement;
    const href=anchor?.getAttribute('href');
    if(parent.tagName==='P'&&parent.children.length===1&&!parent.textContent.trim())parent.replaceWith(box);
    else target.replaceWith(box);
    box.append(image);
    if(href){const link=document.createElement('a');link.href=href;box.append(link);}
  });return root.innerHTML;
}

function verifyToutiaoBody(content, imagesOf) {
  const bodies = [...document.querySelectorAll('.ProseMirror[contenteditable="true"]')]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (bodies.length !== 1) throw new Error('头条正文编辑器不唯一。');
  const body = bodies[0], expected = document.createElement('div');
  expected.innerHTML = content;
  const visibleCopy = body.cloneNode(true);
  for (const el of visibleCopy.querySelectorAll('templ,button,[role="button"],[role="toolbar"],.ProseMirror-widget')) el.remove();
  for (const el of visibleCopy.querySelectorAll('[contenteditable="false"]')) {
    if (/^(?:编辑|搜图|删除|替换|\s)+$/.test(el.textContent)) el.remove();
  }
  const text = (el) => el.textContent.replace(/\s|[\u200b-\u200f\u2060\ufeff]/g, '');
  const actualImages = imagesOf(body).map((img) => img.currentSrc || img.src);
  const expectedImages = [...expected.querySelectorAll('img')];
  if (text(visibleCopy) !== text(expected)) throw new Error('头条正文回读与准备包文字不一致，请检查编辑器处理结果。');
  if (actualImages.length !== expectedImages.length
      || actualImages.some((url) => !/^https?:\/\//i.test(url)))
    throw new Error('头条正文图片未完整插入或仍是本地地址：准备包 ' + expectedImages.length
      + ' 张，可见正文 ' + actualImages.length + ' 张。');
  if (body.innerHTML.includes('WECHATIMGPH_')) throw new Error('头条正文仍有未替换图片位置。');
  return true;
}

function verifyToutiaoFormat(content) {
  const body=document.querySelector('.ProseMirror[contenteditable="true"]');
  if(!body)throw Error('头条正文编辑器不存在。');
  const expected=document.createElement('div');expected.innerHTML=content;
  const meaningful=text=>text.replace(/[\s\u200b-\u200f\u2060\ufeff]/g,'');
  const chars=(root,actual)=>{
    const result=[],walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let node;
    while((node=walker.nextNode())){
      const parent=node.parentElement;
      if(actual&&(parent.closest('templ,button,[role="button"],[role="toolbar"],.ProseMirror-widget')
        ||parent.closest('[contenteditable="false"]')&&!parent.closest('a.pgc-link[href],a.pgc-link[data-href]')))continue;
      const block=parent.closest('p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th');
      const heading=!!parent.closest('h1,h2,h3,h4,h5,h6');
      const style=actual?getComputedStyle(parent):null;
      const bold=heading|| (actual?Number(style.fontWeight)>=600||style.fontWeight==='bold':!!parent.closest('strong,b'));
      const strike=actual?[parent,...function*(n){while((n=n.parentElement)&&n!==root)yield n}(parent)].some(el=>getComputedStyle(el).textDecorationLine.includes('line-through')):!!parent.closest('s,del,strike');
      const align=heading?'left':actual?(block?getComputedStyle(block).textAlign:'left'):(block?.style.textAlign||'left');
      const size=actual?parseFloat(style.fontSize):heading?18:17;
      for(const char of meaningful(node.nodeValue))result.push({char,bold,strike,heading,size,align:align==='start'?'left':align});
    }return result;
  };
  const wanted=chars(expected,false),actual=chars(body,true);
  if(wanted.map(c=>c.char).join('')!==actual.map(c=>c.char).join(''))throw Error('头条格式核对时正文文字不一致。');
  const diff=wanted.findIndex((c,i)=>c.bold!==actual[i].bold||c.strike!==actual[i].strike||c.heading!==actual[i].heading||c.align!==actual[i].align||c.size!==actual[i].size);
  if(diff>=0)throw Error('头条第 '+(diff+1)+' 字「'+wanted[diff].char+'」的强调、标题或段落对齐不一致：预期 '+JSON.stringify(wanted[diff])+'，实际 '+JSON.stringify(actual[diff])+'。');
  const blocks=root=>[...root.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li')].filter(el=>meaningful(el.textContent)&&!el.querySelector('p,h1,h2,h3,h4,h5,h6,li'));
  const a=blocks(expected),b=blocks(body).filter(el=>!el.closest('[contenteditable="false"]'));
  if(a.length!==b.length)throw Error('头条正文段落结构与准备包不一致。');
  a.forEach((el,i)=>{const prefix=el.textContent.match(/^\u3000+/)?.[0]||'';if(prefix&&!b[i].textContent.startsWith(prefix))throw Error('头条第 '+(i+1)+' 段首行缩进未保留。');});
  const links=(root,actual=false)=>[...root.querySelectorAll('a[href],a[data-href]')].filter(a=>!actual||a.getClientRects().length&&!a.closest('templ')).map(a=>({text:meaningful(a.textContent),url:a.getAttribute('href')||a.getAttribute('data-href')})).filter(a=>a.text);
  if(JSON.stringify(links(expected))!==JSON.stringify(links(body,true)))throw Error('头条正文链接与准备包不一致。');
  if(expected.querySelectorAll('table').length!==body.querySelectorAll('table').length)throw Error('头条正文表格数量不一致。');
  return {characters:wanted.length,paragraphs:a.length,stylesMatch:true};
}

function toutiaoImageReadback(content,imagesOf) {
  const body=document.querySelector('.ProseMirror[contenteditable="true"]'),expected=document.createElement('div');expected.innerHTML=content;
  const norm=t=>t.replace(/[\s\u200b-\u200f\u2060\ufeff]/g,'');
  const targets=[],walk=document.createTreeWalker(expected,NodeFilter.SHOW_ELEMENT|NodeFilter.SHOW_TEXT);let text='',node;
  while((node=walk.nextNode())){if(node.nodeType===3)text+=norm(node.nodeValue);else if(node.tagName==='IMG')targets.push({url:node.src,offset:[...text].length,link:node.closest('a[href]')?.href||node.closest('.pgc-img')?.querySelector('a[href]')?.href||''});}
  const actualImages=imagesOf(body),positions=[];let actualText='';
  const model=body.pmViewDesc?.node;
  if(!model?.descendants)throw Error('无法读取头条原生文档中的图片位置，已停止核对。');
  model.descendants(n=>{if(n.type.name==='image'){positions.push({offset:[...actualText].length,link:n.attrs.data.link||''});return false;}if(n.isText)actualText+=norm(n.text);else if(n.type.name==='link')actualText+=norm(n.attrs.content||'');});
  if(positions.length!==targets.length||actualImages.length!==targets.length||positions.some((p,i)=>p.offset!==targets[i].offset||p.link!==targets[i].link))throw Error('头条正文图片数量、顺序、文字位置或图片链接与准备包不一致。');
  return targets.map((item,index)=>({position:index+1,offset:item.offset,expected:item.url,actual:actualImages[index].currentSrc||actualImages[index].src}));
}

async function verifyToutiaoImageContent(tabId,content) {
  const pairs=await evaluate(tabId,'('+toutiaoImageReadback.toString()+')('+JSON.stringify(content)+',('+toutiaoContentImages.toString()+'))');
  const frame=await chrome.debugger.sendCommand({tabId},'Page.getFrameTree');
  const cache=new Map();
  async function hash(url){
    const key=new URL(url).origin+new URL(url).pathname;
    if(!cache.has(key))cache.set(key,(async()=>{
      const {resource}=await chrome.debugger.sendCommand({tabId},'Network.loadNetworkResource',{frameId:frame.frameTree.frame.id,url,options:{disableCache:false,includeCredentials:false}});
      if(!resource.success||!resource.stream)throw Error('头条图片资源无法核验（HTTP '+(resource.httpStatusCode||'未知')+'），请保留草稿。');
      const chunks=[];let length=0;
      try{while(true){const r=await chrome.debugger.sendCommand({tabId},'IO.read',{handle:resource.stream,size:1024*1024});const bytes=r.base64Encoded?Uint8Array.from(atob(r.data),c=>c.charCodeAt(0)):new TextEncoder().encode(r.data);length+=bytes.length;if(length>30*1024*1024)throw Error('头条图片核验超过30MB读取上限。');chunks.push(bytes);if(r.eof)break;}}
      finally{await chrome.debugger.sendCommand({tabId},'IO.close',{handle:resource.stream});}
      const bytes=new Uint8Array(length);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
      return {bytes:length,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('')};
    })());return cache.get(key);
  }
  const proof=[];
  for(const pair of pairs){const [a,b]=await Promise.all([hash(pair.expected),hash(pair.actual)]);if(a.sha256!==b.sha256)throw Error('头条第 '+pair.position+' 张图片重新粘贴后内容发生变化，已停止；请检查草稿。');proof.push({position:pair.position,offset:pair.offset,...b});}
  return proof;
}

async function fillToutiaoDraft(tabId, bundle, onProgress = status) {
  const { html, manifest, assets } = bundle;
  if (manifest.targetPlatform !== 'toutiao' && !manifest.compatiblePlatforms?.includes('toutiao'))
    throw new Error('请选择支持今日头条的准备包。');
  const approvedTitle = bundle.toutiaoShortTitle ||
    (manifest.targetPlatform === 'toutiao' ? manifest.title : null);
  const fillTitle = typeof approvedTitle === 'string' && approvedTitle.trim().length > 0;
  if (!fillTitle || [...approvedTitle].length < 2 || [...approvedTitle].length > 30)
    throw new Error('头条短标题缺失或超过 30 字，请先从已核实的微信公众号标题生成短标题。');
  for (const item of manifest.contentImages) {
    if (!assets.get('assets/' + item.bundleFile) || html.split(item.placeholder).length !== 2)
      throw new Error('头条准备包图片或唯一图片位置缺失。');
  }
  await attachDebugger(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
    const current = await evaluate(tabId, '(' + toutiaoEditorState.toString() + ')()');
    const bodyState = await evaluate(tabId, '(' + toutiaoBodyEmptyState.toString() + ')()');
    if (!bodyState.empty) throw new Error('头条正文检测到有效文字 ' + bodyState.textLength
      + ' 字、媒体 ' + bodyState.mediaCount + ' 个。若页面显示 0 字，请点击“检查当前编辑页”导出报告以定位误报。');
    if (fillTitle && current.title.trim() && current.title.trim() !== approvedTitle) throw new Error('头条已有其他标题，请新开空白编辑页。');
    let content = typeof DraftToutiaoFormat!=='undefined'?DraftToutiaoFormat.prepare(html).html:html;
    if(typeof DraftToutiaoFormat!=='undefined')onProgress('已应用头条兼容排版：彩色字、斜体和下划线转为加粗；保留原生标题、删除线、列表、引用及对齐。具体范围见工作台分发处理日志。');
    if(fillTitle){await fillField(tabId,TOUTIAO_TITLE,approvedTitle);if(await readField(tabId,TOUTIAO_TITLE)!==approvedTitle)throw Error('头条标题未能写入，已停止上传。');}
    const total = manifest.contentImages.length;
    const uploadCopies=[],uploadedItems=[];
    try {
      for (const [index, item] of manifest.contentImages.entries()) {
        const file = assets.get('assets/' + item.bundleFile);
        // 旧准备包里可能还留着 1×1 空图：平台会静默丢弃它，直接跳过并连带删掉标签。
        const pixel = await toutiaoImagePixelSize(file);
        if (pixel && (pixel.width <= 1 || pixel.height <= 1)) {
          onProgress('跳过 1×1 空图（' + item.bundleFile + '），平台会丢弃它…');
          const token = item.placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          content = content.replace(new RegExp('<img\\b[^>]*' + token + '[^>]*>', 'gi'), '');
          continue;
        }
        onProgress('通过头条编辑器文件粘贴上传：' + item.bundleFile + '（' + (index + 1) + '/' + total + '）');
        const result = await uploadImageToToutiao(tabId, file, { index: index + 1, total,details:typeof DraftToutiaoFormat!=='undefined' });
        const url=typeof result==='string'?result:result.url;
        uploadCopies.push(typeof result==='string'?{uploadedSha:item.sha256}:result);
        uploadedItems.push(item);
        if(result.converted)onProgress('图片格式适配：'+item.bundleFile+'（'+file.size+'字节）的静态上传副本转为 '+result.uploadedName+'（PNG，'+result.uploadedBytes+'字节）；原始文件保存在准备包内。');
        if(result.usedOriginal)onProgress('保留原图：'+item.bundleFile+' 使用平台保留的原始上传地址（'+result.width+'×'+result.height+'），避免采用默认优化后的放大图片。');
        content = content.replace(item.placeholder, url.replaceAll('&', '&amp;').replaceAll('"', '&quot;'));
      }
    } catch (uploadError) {
      // 上传中途失败时，临时粘贴进去的图片会留在正文里；不提示的话下次填会被“正文非空”拦住。
      throw new Error(String(uploadError?.message || uploadError)
        + '（正文里可能还留着这次临时上传的图片：重试前请先全选删除，或新开一个空白编辑页。）');
    }
    onProgress('清除上传时的临时图片，再写入完整正文…');
    await evaluate(tabId, '(' + focusToutiaoBody.toString() + ')()');
    await chrome.debugger.sendCommand({tabId},'Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
    await chrome.debugger.sendCommand({tabId},'Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
    await chrome.debugger.sendCommand({tabId},'Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
    await chrome.debugger.sendCommand({tabId},'Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
    await pause(500);
    const afterClear = await evaluate(tabId, '(' + toutiaoBodyEmptyState.toString() + ')()');
    if (!afterClear.empty)
      throw new Error('头条临时上传内容未能从正文清除（文字 ' + afterClear.textLength + '，媒体 ' + afterClear.mediaCount + '），已停止填写，避免生成重复图片。');
    onProgress(typeof DraftToutiaoFormat!=='undefined'?'使用头条原生排版写入正文和标题，避免剪贴板重复处理图片…':fillTitle?'填写头条正文和标题…':'填写头条正文，标题请手动填写…');
    if(typeof DraftToutiaoFormat!=='undefined')content=await evaluate(tabId,'('+toutiaoNativeImages.toString()+')('+JSON.stringify(content)+','+JSON.stringify(uploadCopies)+')');
    await evaluate(tabId, '(' + pasteToutiaoBody.toString() + ')(' + JSON.stringify(content) + ','+(typeof DraftToutiaoFormat!=='undefined')+')');
    if (fillTitle) await fillField(tabId, TOUTIAO_TITLE, approvedTitle);
    await pause(1000);
    await evaluate(tabId, '(' + verifyToutiaoBody.toString() + ')(' + JSON.stringify(content) + ',(' + toutiaoContentImages.toString() + '))');
    if(typeof DraftToutiaoFormat!=='undefined')await evaluate(tabId,'('+verifyToutiaoFormat.toString()+')('+JSON.stringify(content)+')');
    if(typeof DraftToutiaoFormat!=='undefined'){
      onProgress('正在核对头条原生文档中的图片位置和重新粘贴后的图片内容…');
      const proof=await verifyToutiaoImageContent(tabId,content);
      for(const [index,item]of proof.entries()){
        const source=uploadedItems[index];
        if(uploadCopies[index]?.uploadedSha&&uploadCopies[index].uploadedSha!==item.sha256){
          onProgress('检测到平台图片字节变化：'+source.bundleFile+'，源文件 '+source.bytes+' 字节，平台文件 '+item.bytes+' 字节；原素材随包保留，已停止供人工核对。');
          throw Error('头条平台处理后的第 '+(index+1)+' 张图片与源文件不一致，请检查草稿。');
        }
        onProgress('图片内容核验 '+(index+1)+'/'+proof.length+'：'+source.bundleFile+'，位置及上传后文件内容与'+(uploadCopies[index]?.converted?'已记录的 PNG 上传副本':'来源文件')+'一致。');
      }
    }
    if (fillTitle && await readField(tabId, TOUTIAO_TITLE) !== approvedTitle) throw new Error('头条标题回读不一致。');
    onProgress(fillTitle ? '头条标题、正文文字和图片已填入并回读核对。请检查排版、封面，并确认页面显示「草稿已保存」；尚未发布。' : '头条正文文字和图片已填入并回读核对。标题未自动填入，请手动填写标题、设置封面，并确认页面显示「草稿已保存」。');
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}
