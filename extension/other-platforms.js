'use strict';

function portalSelectors(platform) {
  if (platform === 'penguin') return {
    title: '.omui-inputautogrowing__inner[contenteditable="true"]',
    body: '.ProseMirror.ExEditor-basic[contenteditable="true"]', min: 5, max: 64, label: '企鹅号',
  };
  if (platform === 'sohu') return {
    title: 'input[placeholder="请输入标题（5-72字）"]',
    body: '.ql-editor[contenteditable="true"]', min: 5, max: 72, label: '搜狐号',
  };
  throw new Error('未知的文章平台。');
}

function portalEditorState(platform, titleSelector, bodySelector) {
  const visible = (el) => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const titles = [...document.querySelectorAll(titleSelector)].filter(visible);
  const bodies = [...document.querySelectorAll(bodySelector)].filter(visible);
  if (titles.length !== 1 || bodies.length !== 1) throw new Error(platform + '标题或正文编辑器不唯一。');
  return { title: titles[0].isContentEditable ? titles[0].textContent.trim() : titles[0].value.trim(),
    html: bodies[0].innerHTML, text: bodies[0].innerText || bodies[0].textContent || '' };
}

// Sohu's title is a Vue-controlled input. Focus disables the body editor until
// blur; read both the visible input and the component model when available.
function portalTitleState(titleSelector, commit = false) {
  const fields=[...document.querySelectorAll(titleSelector)].filter(el=>
    el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
  if(fields.length!==1)throw Error('标题编辑器不唯一，无法核对标题。');
  const field=fields[0];
  if(commit&&field.ownerDocument.activeElement===field)field.blur();
  let modelTitle=null,editorDisabled=null;
  for(let el=field;el;el=el.parentElement){
    const data=el.__vue__?.$data;
    if(data&&Object.prototype.hasOwnProperty.call(data,'title')&&typeof data.title==='string'){
      modelTitle=data.title.trim();
      if(typeof data.editorDisabled==='boolean')editorDisabled=data.editorDisabled;
      break;
    }
  }
  return {title:(field.isContentEditable?field.textContent:field.value||'').trim(),modelTitle,editorDisabled};
}

function portalBodyEmpty(platform, bodySelector) {
  const bodies = [...document.querySelectorAll(bodySelector)]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (bodies.length !== 1) throw new Error(platform + '正文编辑器不唯一。');
  const body = bodies[0], clone = body.cloneNode(true);
  clone.querySelectorAll('.ql-image-container .img-edit,.ql-image-container .img-del,.ql-image-container .img-desc[data-desc=""]').forEach(el=>el.remove());
  for (const el of clone.querySelectorAll('button,[role="button"],[role="toolbar"],[data-placeholder],.ql-clipboard,.ProseMirror-widget,.ProseMirror-placeholder')) {
    if (el.getAttribute('contenteditable') !== 'false' || el.querySelector('img,video,audio,iframe,svg,canvas')) continue;
    if (!el.textContent.trim() || el.textContent.trim() === '请输入正文') el.remove();
  }
  const text = clone.textContent.replace(/[\s\u200b-\u200f\u2060\ufeff]/g, '');
  const media = [...body.querySelectorAll('img,video,audio,iframe,svg,canvas')].filter((el) => {
    if (el.closest('button,[role="button"],[role="toolbar"],.ql-clipboard,.ProseMirror-widget')) return false;
    const style = getComputedStyle(el), rect = el.getBoundingClientRect();
    if (!el.getClientRects().length || style.visibility === 'hidden' || style.display === 'none') return false;
    if (el.tagName === 'IMG' && el.complete && el.naturalWidth === 0 && el.naturalHeight === 0) return false;
    return el.tagName !== 'IMG' || rect.width >= 32 || rect.height >= 32;
  });
  return { empty: !text && !media.length, textLength: text.length, mediaCount: media.length,
    text };
}


// 返回正文真实图片数与最后一张的地址（portalImages 已排除 0x0 垃圾节点）。
function portalImageState(bodySelector, imagesFn) {
  const bodies = [...document.querySelectorAll(bodySelector)]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (bodies.length !== 1) return null;
  const images = imagesFn(bodies[0]);
  return {count: images.length, last: images.length ? images.at(-1).src : ''};
}

// 把光标放到正文最后一张图片之后（随后按 Backspace 即删除该图）。
function portalPlaceCaretAfterLastImage(bodySelector, imagesFn) {
  const bodies = [...document.querySelectorAll(bodySelector)]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (bodies.length !== 1) return false;
  const images = imagesFn(bodies[0]);
  const last = images.at(-1);
  if (!last) return false;
  const range = document.createRange();
  range.setStartAfter(last);
  range.collapse(true);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

function portalImages(body) {
  return [...body.querySelectorAll('img')].filter((img) =>
    !img.closest('button,[role="button"],[role="toolbar"],.ql-clipboard,.ProseMirror-widget') && img.getClientRects().length
    && getComputedStyle(img).visibility !== 'hidden'
    // 排除编辑器垃圾占位：自然尺寸为 0（企鹅号会出现 src=页面地址 的 0x0 img）
    && !(img.complete && img.naturalWidth === 0 && img.naturalHeight === 0));
}

// 读取编辑器里正文图片的实际地址（按出现顺序）。平台换链后以这次读到的为准。
function portalImageUrls(bodySelector, imagesFn) {
  const bodies = [...document.querySelectorAll(bodySelector)]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (bodies.length !== 1) throw new Error('正文编辑器不唯一。');
  return imagesFn(bodies[0]).map((img) => img.src);
}

// 选中正文全部内容，随后由 CDP 发一次真实 Backspace 删除。
// 用真实按键而不是改 innerHTML，编辑器自己的模型才会同步清空。
function portalSelectAll(bodiesSelector) {
  const bodies = [...document.querySelectorAll(bodiesSelector)]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (bodies.length !== 1) throw new Error('正文编辑器不唯一。');
  const body = bodies[0];
  body.focus();
  const range = document.createRange();
  range.selectNodeContents(body);
  const selection = getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

// 兜底清空：按键没删干净时直接清 DOM，并补一个 input 事件让编辑器模型跟随。
function portalForceClear(bodySelector) {
  const bodies = [...document.querySelectorAll(bodySelector)]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (bodies.length !== 1) throw new Error('正文编辑器不唯一。');
  const body = bodies[0];
  body.innerHTML = '';
  body.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
  return true;
}

function portalUploadBodyText(body) {
  const clone=body.cloneNode(true);
  clone.querySelectorAll('.ql-image-container .img-edit,.ql-image-container .img-del,.ql-image-container .img-desc[data-desc=""]').forEach(el=>el.remove());
  return (clone.textContent||'').replace(/[\s\u200b-\u200f\u2060\ufeff]/g,'');
}

async function portalStartSohuImageUpload(encoded, filename, type, bodySelector, imagesFn, textFn) {
  const originalType=type;
  const body=document.querySelector(bodySelector);
  if(!body)throw Error('未找到搜狐正文编辑器。');
  if([...document.querySelectorAll('.win-mask .local-upload')].some(el=>el.getClientRects().length))
    throw Error('搜狐图片上传窗口已经打开，请先处理当前窗口。');
  const before=imagesFn(body).map(img=>img.src);
  const text=textFn(body);
  let bytes=Uint8Array.from(atob(encoded.slice(encoded.indexOf(',')+1)),ch=>ch.charCodeAt(0));
  if(type==='image/webp'||type==='image/bmp'){
    if(type==='image/webp'&&String.fromCharCode(...bytes.slice(12,16))==='VP8X'&&(bytes[20]&2))
      throw Error('搜狐不支持动态 WebP，无法直接上传且不能静默转成静图。');
    const bitmap=await createImageBitmap(new Blob([bytes],{type}));
    try{
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      canvas.getContext('2d').drawImage(bitmap,0,0);
      const png=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!png)throw Error('搜狐兼容图片转换失败。');
      bytes=new Uint8Array(await png.arrayBuffer());type='image/png';filename=filename.replace(/\.[^.]+$/,'')+'.png';
    }finally{bitmap.close();}
  }
  if(bytes.length>10*1024*1024)throw Error('搜狐上传副本超过 10MB，请先压缩静图或替换过大的动图。');
  let n=body,q;while(n&&!q){q=n.__vue__?.quill||n.__quill;n=n.parentElement;}
  body.focus();
  if(q)q.setSelection(Math.max(0,q.getLength()-1),0,'silent');
  const buttons=[...document.querySelectorAll('button.ql-image')].filter(el=>el.getClientRects().length);
  if(buttons.length!==1)throw Error('搜狐图片工具按钮不唯一。');
  buttons[0].click();
  let input;
  for(let attempt=0;attempt<100;attempt++){
    input=[...document.querySelectorAll('.win-mask .local-upload input[type=file]')].find(el=>el.closest('.win-mask').getClientRects().length);
    if(input)break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  if(!input)throw Error('搜狐本地图片上传窗口未能打开。');
  const transfer=new DataTransfer();transfer.items.add(new File([bytes],filename,{type}));
  input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));
  return {before,text,accepted:true,converted:originalType!==type,uploadedName:filename,uploadedBytes:bytes.length};
}

function portalSohuImageUploadState(confirm=false) {
  const content=[...document.querySelectorAll('.win-mask .local-upload')].find(el=>el.getClientRects().length);
  if(!content)return {open:false,ready:false};
  const dialog=content.closest('.win-mask'),text=dialog.textContent;
  if(/图片不能包含二维码/.test(text))throw Error('搜狐拒绝包含二维码的图片，请在适配版中处理该图片后继续；原稿图片保持完整。');
  if(/上传失败|格式不支持|超出.{0,8}大小/.test(text))throw Error('搜狐图片上传失败：'+text.slice(-200));
  const images=[...content.querySelectorAll('.img-wrapper img.upload-item')];
  const buttons=[...dialog.querySelectorAll('.bottom-buttons .positive-button')].filter(el=>el.getClientRects().length&&el.textContent.trim()==='确定');
  if(buttons.length>1)throw Error('搜狐图片插入确认按钮不唯一。');
  const ready=buttons.length===1&&images.length===1&&images.every(img=>img.complete&&img.naturalWidth>0&&parseFloat(getComputedStyle(img).opacity)>0.9);
  if(confirm&&ready){
    buttons[0].click();
  }
  return {open:true,ready};
}

function portalCancelSohuImageUpload() {
  const content=[...document.querySelectorAll('.win-mask .local-upload')].find(el=>el.getClientRects().length);
  if(!content)return;
  const buttons=[...content.querySelectorAll('.negative-button')].filter(el=>el.getClientRects().length&&el.textContent.trim()==='取消');
  if(buttons.length!==1)throw Error('无法关闭搜狐被拒绝图片的上传窗口。');
  buttons[0].click();
}

async function uploadPortalImage(tabId, file, platform, onProgress=()=>{}) {
  const selectors = portalSelectors(platform), dataUrl = await readFileAsDataUrl(file);
  const mime = file.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }[file.name.split('.').pop().toLowerCase()]);
  if (!mime?.startsWith('image/')) throw new Error('无法识别图片格式：' + file.name);
  const pasteFile = (encoded, filename, type, bodySelector, imagesFn, textFn) => {
    const bodies = [...document.querySelectorAll(bodySelector)]
      .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    if (bodies.length !== 1) throw new Error('正文编辑器不唯一，无法上传图片。');
    const body = bodies[0], before = imagesFn(body).map((img) => img.src);
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob(encoded.slice(encoded.indexOf(',') + 1)), (ch) => ch.charCodeAt(0));
    transfer.items.add(new File([bytes], filename, { type }));
    body.focus();
    const range = document.createRange(); range.selectNodeContents(body); range.collapse(false);
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
    body.dispatchEvent(event);
    return { before, accepted: event.defaultPrevented,
      text: textFn(body) };
  };
  const imagesFn = portalImages.toString();
  const textFn=portalUploadBodyText.toString();
  const readState = (bodySelector, imagesFn, textFn) => {
    const bodies = [...document.querySelectorAll(bodySelector)]
      .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    if (bodies.length !== 1) throw new Error('正文编辑器不唯一。');
    const body = bodies[0], images = imagesFn(body), last = images.at(-1);
    return {urls: images.map(img => img.src), pageHost: location.host,
      text: textFn(body),
      ready: !!last?.complete && last.naturalWidth > 0 && last.naturalHeight > 0};
  };
  const nativeSohu=platform==='sohu'&&await evaluate(tabId,'Boolean(document.querySelector("button.ql-image"))');
  const startUpload=nativeSohu?portalStartSohuImageUpload:pasteFile;
  const uploadState = await evaluate(tabId, '(' + startUpload.toString() + ')('
    + [JSON.stringify(dataUrl), JSON.stringify(file.name), JSON.stringify(mime), JSON.stringify(selectors.body)]
      .join(',') + ',(' + imagesFn + '),(' + textFn + '))');
  if (!uploadState?.accepted) throw new Error(platform + '编辑器没有接收图片文件粘贴，已停止，未继续填入正文。');
  if(uploadState.converted)onProgress('图片格式适配：'+file.name+' 已转为 PNG 上传副本 '+uploadState.uploadedName
    +'（'+uploadState.uploadedBytes+' 字节）；原始文件保存在准备包内。');
  const before = uploadState.before;
  const textBefore = uploadState.text || '';
  const deadline = Date.now() + 30000;
  let candidate = '', candidateSince = 0;
  let confirmed=false;
  while (Date.now() < deadline) {
    if(nativeSohu&&!confirmed){
      const dialog=await evaluate(tabId,'('+portalSohuImageUploadState.toString()+')(true)');
      confirmed=dialog.ready;
    }
    const {urls, ready, pageHost, text} = await evaluate(tabId, '(' + readState.toString() + ')('
      + JSON.stringify(selectors.body) + ',(' + imagesFn + '),(' + textFn + '))');
    // 守卫改成「文字不能被改动」：图片地址由平台自己换链（blob: → CDN、加签名），
    // 按地址逐个比对会把正常换链误判成"既有图片被改"，上一版就是这样中断的。
    if (!text.startsWith(textBefore)) {
      let first = 0;
      while (first < text.length && first < textBefore.length && text[first] === textBefore[first]) first += 1;
      throw new Error(platform + '图片粘贴改动了正文文字，已停止（首个差异在第 ' + (first + 1)
        + ' 字：粘贴前 ' + JSON.stringify(textBefore.slice(Math.max(0, first - 8), first + 16))
        + '，现在 ' + JSON.stringify(text.slice(Math.max(0, first - 8), first + 16)) + '）。');
    }
    if (urls.length < before.length)
      throw new Error(platform + '正文里的图片变少了（粘贴前 ' + before.length + ' 张，现在 '
        + urls.length + ' 张），已停止。请核对页面后重新填入。');
    // 新增部分不限张数，也不限定协议：编辑器可能用 blob:/临时地址，或把一次贴图渲染成多个 <img>
    const fresh = urls.slice(before.length).filter(Boolean);
    const hostOf = (value) => { try { return new URL(value).host; } catch { return ''; } };
    const httpsFresh = fresh.filter((src) => /^https:\/\//.test(src));
    // 编辑器先给与页面同源的临时地址，随后换成 CDN 正式地址：优先取非同源的那个
    const cdn = pageHost ? httpsFresh.filter((src) => hostOf(src) !== pageHost) : [];
    const latest = cdn.at(-1) || httpsFresh.at(-1) || fresh.at(-1) || '';
    if (latest) {
      if (platform !== 'sohu' && platform !== 'penguin') return latest;
      // 稳定 800ms 才返回，覆盖"临时地址 → CDN 地址"的替换过程
      if (candidate !== latest) {
        candidate = latest; candidateSince = Date.now();
      } else if (Date.now() - candidateSince >= 800) return candidate;
    } else { candidate = ''; }
    await pause(250);
  }
  throw new Error(platform + '编辑器未在 30 秒内返回已上传图片地址；页面保持未保存状态。');
}

function pastePortalBody(content, bodySelector, append = false) {
  const bodies = [...document.querySelectorAll(bodySelector)]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (bodies.length !== 1) throw new Error('正文编辑器不唯一。');
  const body = bodies[0], expected = document.createElement('div'); expected.innerHTML = content;
  const transfer = new DataTransfer(); transfer.setData('text/html', content); transfer.setData('text/plain', expected.textContent);
  body.focus();
  const range = document.createRange(); range.selectNodeContents(body);
  if (append) range.collapse(false);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
  body.dispatchEvent(event);
  if (!event.defaultPrevented) throw new Error('编辑器没有接收 HTML 粘贴。');
}

function verifyPortalBody(content, bodySelector, imagesFn, checkImagePositions = false,
  ignoreImageUrls = false) {
  const bodies = [...document.querySelectorAll(bodySelector)]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (bodies.length !== 1) throw new Error('正文编辑器不唯一。');
  const expected = document.createElement('div'); expected.innerHTML = content;
  const actual = bodies[0].cloneNode(true);
  for (const el of actual.querySelectorAll('.ql-clipboard,.ProseMirror-widget,[contenteditable="false"]')) el.remove();
  const normalize = (value) => value.replace(/[\s\u200b-\u200f\u2060\ufeff]/g, '');
  const actualImages = imagesFn(bodies[0]).map((img) => img.src);
  const expectedImages = [...expected.querySelectorAll('img')].map((img) => img.src);
  const describeSource = src => {
    try {
      const url = new URL(src);
      return {path:url.origin+url.pathname,queryKeys:[...new Set(url.searchParams.keys())]};
    } catch { return {path:'invalid',queryKeys:[]}; }
  };
  bodies[0].__draftHelperPortalImageReadback = {
    expected:expectedImages.map(describeSource),actual:actualImages.map(describeSource),
  };
  const actualText = normalize(actual.textContent), expectedText = normalize(expected.textContent);
  if (actualText !== expectedText) {
    // 现场信息：长度 + 首个差异位置 + 双方上下文，便于一次定位（企鹅号会重排空行/图注）
    let first = 0;
    while (first < actualText.length && first < expectedText.length
      && actualText[first] === expectedText[first]) first += 1;
    const slice = (text) => JSON.stringify(text.slice(Math.max(0, first - 12), first + 24));
    throw new Error('正文回读文字与准备包不一致（预期 ' + expectedText.length + ' 字，实际 '
      + actualText.length + ' 字，首个差异在第 ' + (first + 1) + ' 字：预期 ' + slice(expectedText)
      + '，实际 ' + slice(actualText) + '）。');
  }
  // 平台可能给图片地址加签名/参数：比较"同一资源"（origin+pathname），数量与位置仍严格
  const sameResource = (left, right) => {
    try {
      const a = new URL(left), b = new URL(right);
      return a.origin === b.origin && a.pathname === b.pathname;
    } catch { return left === right; }
  };
  const imagesMatch = ignoreImageUrls
    ? actualImages.length === expectedImages.length
    : actualImages.length === expectedImages.length
      && actualImages.every((src, i) => sameResource(src, expectedImages[i]));
  if (!imagesMatch) {
    const different = actualImages.findIndex((src, i) => !sameResource(src, expectedImages[i]));
    const first = different < 0 ? Math.min(actualImages.length, expectedImages.length) : different;
    let detail = '';
    if (actualImages[first] && expectedImages[first]) {
      const wanted=new URL(expectedImages[first]), got=new URL(actualImages[first]);
      const wantedParts=wanted.pathname.split('/'), gotParts=got.pathname.split('/');
      const sameId=wantedParts.at(-1)===gotParts.at(-1);
      detail = ' 地址结构：预期 '+wanted.origin+wantedParts.slice(0,-1).join('/')+'/[图片ID]，实际 '
        +got.origin+gotParts.slice(0,-1).join('/')+'/[图片ID]；资源ID'+(sameId?'相同':'不同')+'。';
    }
    throw new Error('正文图片回读不一致：预期 ' + expectedImages.length + ' 张，实际 '
      + actualImages.length + ' 张；首次差异在第 ' + (first + 1) + ' 张'
      + '（当前正文 ' + normalize(bodies[0].textContent).length + ' 字）。'
      + detail+'请导出“检查当前编辑页”报告。');
  }
  if (checkImagePositions) {
    // Compare each image's position in the text as well as its URL. Counting
    // images alone would accept a paste handler that moves them all to the end.
    const positions = (root, images) => {
      const wanted = new Set(images), offsets = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
      let node, offset = 0;
      while ((node = walker.nextNode())) {
        if (node.nodeType === Node.TEXT_NODE
            && !node.parentElement.closest('.ql-clipboard,.ProseMirror-widget,[contenteditable="false"]'))
          offset += normalize(node.textContent).length;
        if (wanted.has(node)) offsets.push(offset);
      }
      return offsets;
    };
    const wanted = positions(expected, [...expected.querySelectorAll('img')]);
    const got = positions(bodies[0], imagesFn(bodies[0]));
    if (JSON.stringify(wanted) !== JSON.stringify(got)) throw new Error('正文图片所在段落与准备包不一致。');
    if (imagesFn(bodies[0]).some(img => !img.complete || !img.naturalWidth || !img.naturalHeight))
      throw new Error('正文图片尚未加载完成，未继续设置封面。');
  }
  return true;
}

// 微信公众号导出的正文给几乎每个元素都写了 text-indent（首行缩进，常见 30px）。
// 搜狐号用的 Quill 不支持 text-indent，而是把缩进量换算成制表符字符塞进文字流；
// .ql-editor 又是 white-space: pre-wrap，制表符不折叠，于是句子中间凭空多出一段空白。
// 粘贴前统一去掉这个属性：缩进由目标编辑器自己决定，文字不再被插入不可见字符。
function portalStripIndent(content) {
  const root = document.createElement('div');
  root.innerHTML = content;
  let removed = 0;
  for (const element of root.querySelectorAll('[style*="text-indent"]')) {
    element.style.removeProperty('text-indent');
    const style = element.getAttribute('style');
    if (style === null || !style.trim()) element.removeAttribute('style');
    removed += 1;
  }
  return { html: root.innerHTML, removed };
}

// Preserve computed source colors before Quill flattens containers. A matching live
// editor is not evidence of color persistence; saving/reopening needs separate verification.
function portalPrepareSohu(content) {
  const editor=document.querySelector('.ql-editor[contenteditable="true"]');
  const inheritedColor=editor?getComputedStyle(editor).color:'rgb(51, 51, 51)';
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.cssText = 'position:fixed;left:-20000px;width:713px;height:1000px;visibility:hidden';
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument, win = frame.contentWindow;
    doc.open(); doc.write('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\';style-src \'unsafe-inline\'"><body style="font:16px system-ui;color:#333"></body>'); doc.close();
    doc.body.style.color=inheritedColor;
    const root = doc.createElement('div'); root.innerHTML = content;
    root.querySelectorAll('script,style,iframe,object,embed,link').forEach(el => el.remove());
    doc.body.appendChild(root);
    const norm = t => t.replace(/[\s\u200b-\u200f\u2060\ufeff]/g, '');
    const original = norm(root.textContent), walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = []; let node;
    while ((node = walker.nextNode())) if (norm(node.textContent)) nodes.push(node);
    const mappings = new Map();
    const runs = nodes.map(node => {
      const s = win.getComputedStyle(node.parentElement), px = parseFloat(s.fontSize);
      return {node,color:s.color,originalColor:s.color,originalSize:px,size:16,bold:parseInt(s.fontWeight)>=600,italic:s.fontStyle==='italic'};
    });
    const selector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,section,div';
    const blocks = [...root.querySelectorAll(selector)].filter(e=>norm(e.textContent)&&![...e.querySelectorAll(selector)].some(c=>norm(c.textContent)));
    const paragraphs = blocks.map(el=>{const s=win.getComputedStyle(el);return{el,text:norm(el.textContent),prefix:(el.textContent.match(/^\u3000*/)?.[0]||'').length,indent:parseFloat(s.textIndent)||0,font:parseFloat(s.fontSize)||16,align:s.textAlign};});
    const colorSpans=new WeakSet();
    for(const run of runs){const span=doc.createElement('span');span.style.color=run.color;colorSpans.add(span);run.node.replaceWith(span);let leaf=span;for(const [flag,tag] of [[run.bold,'strong'],[run.italic,'em']])if(flag){const mark=doc.createElement(tag);leaf.appendChild(mark);leaf=mark;}leaf.appendChild(run.node);}
    let indentCount=0;
    for(const p of paragraphs){
      let el=p.el;
      const members=runs.filter(r=>el.contains(r.node));
      const heading=members.length&&members.every(r=>r.originalSize>=22);
      p.nativeAlign=heading?'left':(['center','right','justify'].includes(p.align)?p.align:'left');
      if(['SECTION','DIV','P','H1','H2','H3','H4','H5','H6'].includes(el.tagName)){const replacement=doc.createElement(heading?'h2':'p');while(el.firstChild)replacement.appendChild(el.firstChild);el.replaceWith(replacement);el=replacement;}
      if(heading)for(const r of members){r.size=24;r.bold=true;const strong=doc.createElement('strong');r.node.replaceWith(strong);strong.appendChild(r.node);}
      el.style.textAlign=p.nativeAlign;
      el.classList.remove('ql-align-center','ql-align-right','ql-align-justify');
      if(p.nativeAlign!=='left')el.classList.add('ql-align-'+p.nativeAlign);
      const units=p.indent/p.font;
      if(units>0&&units<=16&&!['center','right','end'].includes(p.align)){const first=runs.find(r=>el.contains(r.node));if(first){first.node.textContent='\u3000'.repeat(Math.round(units))+first.node.textContent;indentCount++;}}
    }
    // Remove inherited inline indentation everywhere, including text spans, after making paragraph prefixes.
    for(const el of root.querySelectorAll('*')){
      el.style.removeProperty('text-indent');
      el.style.removeProperty('font-size');
      if(!colorSpans.has(el))el.style.removeProperty('color');
      el.style.removeProperty('background-color');
      el.style.removeProperty('background-image');
      el.removeAttribute('color');
      el.classList.remove('ql-size-small','ql-size-large','ql-size-huge');
      el.classList.remove('ql-indent-1','ql-indent-2','ql-indent-3');
    }
    mappings.clear();for(const r of runs)if(r.originalSize!==r.size)mappings.set(r.originalSize,r.size);
    if(norm(root.textContent)!==original)throw new Error('搜狐排版转换改变正文文字，已停止。');
    return {html:root.innerHTML,indentCount,fontMappings:[...mappings].map(([from,to])=>({from,to})),
      runs:runs.map(({node,...r})=>({...r,text:norm(node.textContent)})),
      alignments:paragraphs.map(p=>({text:p.text,align:p.nativeAlign})),
      indents:paragraphs.map(p=>({text:p.text,count:p.prefix+(p.indent>0&&p.indent/p.font<=16&&!['center','right','end'].includes(p.align)?Math.round(p.indent/p.font):0)})).filter(p=>p.count>0)};
  } finally { frame.remove(); }
}

function portalRestoreSohuIndent(plan, bodySelector) {
  const body=document.querySelector(bodySelector);let n=body,q;
  while(n&&!q){q=n.__vue__?.quill||n.__quill;n=n.parentElement;}
  if(!plan.indents.length)return true;
  if(!q||typeof q.insertText!=='function')throw new Error('未找到搜狐 Quill 缩进写入接口。');
  const norm=t=>t.replace(/[\s\u200b-\u200f\u2060\ufeff]/g,''),used=new Set();
  for(const item of plan.indents){const p=[...body.querySelectorAll('p,li,h1,h2,h3,blockquote')].find(p=>!used.has(p)&&norm(p.textContent)===item.text);if(!p)throw new Error('未找到搜狐缩进段落。');used.add(p);const current=(p.textContent.match(/^\u3000*/)?.[0]||'').length;if(current===item.count)continue;if(current>item.count)throw new Error('搜狐段首已有更多空格，已停止修改。');const index=q.getIndex(q.constructor.find(p));q.insertText(index,'\u3000'.repeat(item.count-current),q.getFormat(index,1),'user');}
  return true;
}

function portalVerifySohuFormat(plan, bodySelector, options = {}) {
  const body=document.querySelector(bodySelector),walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT),actual=[];
  const norm=t=>t.replace(/[\s\u200b-\u200f\u2060\ufeff]/g,'');let node;
  while((node=walker.nextNode())){if(node.parentElement.closest('.ql-clipboard,[contenteditable=false]'))continue;const s=getComputedStyle(node.parentElement);for(const char of norm(node.textContent))actual.push({char,color:s.color,size:parseFloat(s.fontSize),bold:parseInt(s.fontWeight)>=600,italic:s.fontStyle==='italic'});}
  const expected=plan.runs.flatMap(r=>Array.from(r.text).map(char=>({...r,char})));
  if(expected.map(r=>r.char).join('')!==actual.map(r=>r.char).join(''))throw new Error('搜狐格式回读文字不一致。');
  const keys=options.checkColor?['color','size','bold','italic']:['size','bold','italic'];
  for(let i=0;i<expected.length;i++)if(keys.some(k=>expected[i][k]!==actual[i][k]))throw new Error('搜狐第 '+(i+1)+' 字的'+(options.checkColor?'颜色、':'')+'字号或强调格式不一致（预期 '+JSON.stringify(expected[i])+'，实际 '+JSON.stringify(actual[i])+'），请检查草稿。');
  const used=new Set();for(const item of plan.indents){const p=[...body.querySelectorAll('p,li,h1,h2,h3,blockquote')].find(p=>!used.has(p)&&norm(p.textContent)===item.text);if(p)used.add(p);if(!p||(p.textContent.match(/^\u3000*/)?.[0]||'').length!==item.count)throw new Error('搜狐首行缩进回读不一致。');}
  const aligned=new Set();for(const [index,item] of (plan.alignments||[]).entries()){const p=[...body.querySelectorAll('p,li,h1,h2,h3,blockquote')].find(p=>!aligned.has(p)&&norm(p.textContent)===item.text);if(p)aligned.add(p);const s=p?getComputedStyle(p):null,value=s?.textAlign,align=value==='start'?(s.direction==='rtl'?'right':'left'):value==='end'?(s.direction==='rtl'?'left':'right'):value;if(!p||align!==item.align)throw new Error('搜狐第 '+(index+1)+' 段对齐回读不一致（预期 '+item.align+'，实际 '+(align||'未找到段落')+'）：'+item.text.slice(0,40));}
  return {characters:actual.length,stylesMatch:true};
}

// Quill may inherit an ancestor's alignment while flattening imported blocks.
// Restore the line format through its document model so it survives a rerender.
function portalRestoreSohuAlign(plan, bodySelector) {
  const bodies=[...document.querySelectorAll(bodySelector)].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden');
  if(bodies.length!==1)throw Error('搜狐正文编辑器不唯一，无法恢复对齐。');
  const body=bodies[0],norm=t=>t.replace(/[\s\u200b-\u200f\u2060\ufeff]/g,''),used=new Set(),changes=[];
  for(const [index,item]of (plan.alignments||[]).entries()){
    if(!['left','center','right','justify'].includes(item.align))throw Error('搜狐来源段落对齐方式无效。');
    const p=[...body.querySelectorAll('p,li,h1,h2,h3,blockquote')].find(p=>!used.has(p)&&norm(p.textContent)===item.text);
    if(!p)throw Error('未找到搜狐第 '+(index+1)+' 段，未修改对齐。');
    used.add(p);const s=getComputedStyle(p),value=s.textAlign;
    const actual=value==='start'?(s.direction==='rtl'?'right':'left'):value==='end'?(s.direction==='rtl'?'left':'right'):value;
    if(actual!==item.align)changes.push({p,align:item.align});
  }
  if(!changes.length)return {changed:0};
  let n=body,q;while(n&&!q){q=n.__vue__?.quill||n.__quill;n=n.parentElement;}
  if(!q||typeof q.formatLine!=='function'||typeof q.getIndex!=='function'||typeof q.constructor.find!=='function')throw Error('未找到搜狐 Quill 段落对齐接口。');
  const edits=changes.map(({p,align})=>{const blot=q.constructor.find(p);if(!blot)throw Error('未找到搜狐段落模型，未修改对齐。');const index=q.getIndex(blot);if(!Number.isInteger(index)||index<0)throw Error('搜狐段落模型位置无效，未修改对齐。');return {index,align};});
  q.history?.cutoff?.();
  for(const {index,align}of edits)q.formatLine(index,1,'align',align==='left'?false:align,'user');
  q.history?.cutoff?.();
  return {changed:edits.length};
}

function portalRestoreSohuEmphasis(plan, bodySelector) {
  const body=document.querySelector(bodySelector);let node=body,q;
  while(node&&!q){q=node.__vue__?.quill||node.__quill;node=node.parentElement;}
  if(!q?.getContents||!q?.formatText)return {changed:0};
  const chars=[],walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);let textNode;
  while((textNode=walker.nextNode())){
    if(textNode.parentElement.closest('.ql-clipboard,.ProseMirror-widget,[contenteditable="false"]'))continue;
    const blot=q.constructor.find(textNode,true);
    if(!blot)throw Error('未找到搜狐文字对应的原生模型。');
    let index=q.getIndex(blot);
    for(const char of textNode.textContent){if(!/[\s\u200b-\u200f\u2060\ufeff]/.test(char))chars.push({char,index});index+=char.length;}
  }
  if(chars.map(item=>item.char).join('')!==plan.runs.map(run=>run.text).join(''))throw Error('搜狐强调修复前正文与准备稿不一致，已停止。');
  let cursor=0,changed=0;
  for(const run of plan.runs){
    const length=Array.from(run.text).length;if(!length)continue;
    const start=chars[cursor].index,last=chars[cursor+length-1],end=last.index+last.char.length;
    const actual=q.getFormat(start,end-start);
    if(Boolean(actual.bold)!==run.bold||Boolean(actual.italic)!==run.italic){q.formatText(start,end-start,{bold:run.bold,italic:run.italic},'user');changed++;}
    cursor+=length;
  }
  return {changed};
}

// 目标编辑器有时会把 inline 元素边界换算成制表符或成串空白（准备包里没有这些字符）。
// 直接改文本节点即可：Quill / ProseMirror 都用 MutationObserver 监听 DOM，
// 改完它们的内部文档会跟着更新，保存时不会变回去。
function portalCleanBodyWhitespace(bodySelector) {
  const bodies = [...document.querySelectorAll(bodySelector)]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  if (bodies.length !== 1) throw new Error('正文编辑器不唯一。');
  const flat = (value) => String(value || '').replace(/[\s\u200b-\u200f\u2060\ufeff]/g, '');
  const beforeLength = flat(bodies[0].textContent).length;
  const walker = document.createTreeWalker(bodies[0], NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  let removed = 0, touched = 0;
  for (const text of nodes) {
    const before = text.data;
    // 制表符一律删掉：准备包里从来没有，只可能是编辑器按缩进换算出来的。
    // 成串的空格/不换行空格合并成一个，保留作者用来做字距的单个分隔。
    const after = before.replace(/\t/g, '')
      .replace(/\u00a0{2,}/g, '\u00a0').replace(/ {2,}/g, ' ');
    if (after === before) continue;
    removed += before.length - after.length;
    touched += 1;
    text.data = after;
  }
  const afterLength = flat(bodies[0].textContent).length;
  if (afterLength !== beforeLength)
    throw new Error('空白清理改变了正文字数（' + beforeLength + ' → ' + afterLength + '），已停止。');
  return { removed, touched };
}

// 按占位符位置切分正文，供"逐段粘贴"的旧路径使用。
// 不需要把图片地址再过一次 HTML 粘贴，所以只用 DOM range 切分、保留嵌套格式。
function sohuBodyParts(content, items) {
  const root = document.createElement('div'); root.innerHTML = content;
  const images = [...root.querySelectorAll('img')];
  if (images.length !== items.length || images.some((img, i) => img.getAttribute('src') !== items[i].placeholder))
    throw new Error('搜狐号准备包图片数量或顺序与清单不一致。');
  const parts = [];
  for (let i = 0; i <= images.length; i++) {
    const range = document.createRange(); range.selectNodeContents(root);
    if (i) range.setStartAfter(images[i - 1]);
    if (i < images.length) range.setEndBefore(images[i]);
    const fragment = document.createElement('div'); fragment.append(range.cloneContents());
    parts.push({html: fragment.innerHTML});
  }
  return parts;
}

async function fillPortalDraft(tabId, bundle, platform, onProgress = status,
  options = {}) {
  const skipImages = !!options.skipImages;
  let { html, manifest, assets } = bundle;
  const config = portalSelectors(platform);
  if (manifest.targetPlatform !== platform) throw new Error('请选择' + config.label + '专用准备包。');
  if ([...manifest.title].length < config.min || [...manifest.title].length > config.max)
    throw new Error(config.label + '标题长度须为 ' + config.min + '–' + config.max + ' 字。');
  const evalCall = (fn, ...args) => evaluate(tabId, '(' + fn.toString() + ')(' + args.map((arg) =>
    typeof arg === 'function' ? '(' + arg.toString() + ')' : JSON.stringify(arg)).join(',') + ')');
  await attachDebugger(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
    if(platform==='sohu'){
      await evalCall(portalTitleState,config.title,true);
      await pause(100);
    }
    const current = await evalCall(portalEditorState, config.label, config.title, config.body);
    const empty = await evalCall(portalBodyEmpty, config.label, config.body);
    // 上一次填入如果停在图片或正文阶段，页面上会留下本工具自己写的半成品。
    // 只要"页面现有文字"是待填正文的开头（或只有图片没有文字），就认为是我们留下的，
    // 清空后重填，不必让用户新开标签页；与准备包对不上的内容一律不动。
    // 页面上的旧内容可能夹着制表符/不间断空格（0.7.5 及更早的缩进问题留下的），
    // 所以两边都先去掉全部空白再比，否则同一次填入会被误判成"别人的内容"。
    const flatText = (value) => String(value || '').replace(/[\s\u200b-\u200f\u2060\ufeff]/g, '');
    const bodyText = flatText(empty.text);
    const expectedText = flatText(String(html).replace(/<[^>]*>/g, '')
      .replace(/&nbsp;|&#160;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&amp;/gi, '&'));
    const leftoverFromUs = !empty.empty && (platform === 'sohu' || platform === 'penguin')
      && (!empty.textLength || (bodyText.length >= 12 && expectedText.startsWith(bodyText)));
    if (!empty.empty && !leftoverFromUs)
      throw new Error(config.label + '正文已有内容，且与当前准备包不一致；请新开空白文章页，或先清空正文再填入。');
    if (current.title && current.title !== manifest.title) throw new Error(config.label + '标题已有其他内容，请新开空白文章页。');
    const ensureSohuTitle=async()=>{
      const before=await evalCall(portalTitleState,config.title);
      if((before.title&&before.title!==manifest.title)||(before.modelTitle&&before.modelTitle!==manifest.title))
        throw Error(config.label+'标题已变为其他内容，已停止；不会覆盖新标题。');
      try{
        if(before.title!==manifest.title||(before.modelTitle!==null&&before.modelTitle!==manifest.title)){
          onProgress('正在填写并核对'+config.label+'标题…');
          await fillField(tabId,config.title,manifest.title);
        }
      }finally{
        await evalCall(portalTitleState,config.title,true);
      }
      await pause(100);
      const after=await evalCall(portalTitleState,config.title);
      if(after.title!==manifest.title||(after.modelTitle!==null&&after.modelTitle!==manifest.title))
        throw Error(config.label+'标题未同步到页面，已停止填入正文；请检查标题框。');
      if(after.editorDisabled===true)throw Error(config.label+'标题提交后正文编辑器仍被禁用，已停止。');
    };
    if(platform==='sohu')await ensureSohuTitle();
    let content = html, sohuFormat = null;
    if (skipImages) {
      // 测试模式：只填文字，跳过全部正文图片（用于隔离图片上传问题）
      content = html.replace(/<img\b[^>]*>/gi, '').replace(/<figure\b[^>]*>\s*<\/figure>/gi, '');
      if (/WECHATIMGPH_/.test(content)) throw new Error('准备包正文在去图后仍残留占位符，已停止。');
      onProgress(config.label + '（测试模式）只填写正文文字，跳过 ' + manifest.contentImages.length + ' 张正文图片…');
      await evalCall(pastePortalBody, content, config.body);
      await pause(700);
      await evalCall(verifyPortalBody, content, config.body, portalImages);
    } else if (platform === 'sohu' || platform === 'penguin') {
      // 搜狐号（Quill）与企鹅号（ProseMirror）都没有开放的上传接口，图片只能借编辑器自己上传。
      // 做法分两步：先把图片逐张传进正文末尾的临时区拿到正式地址，再清空临时区、
      // 把整篇正文一次性粘贴进去。整篇一次粘贴和"从微信复制一次粘贴"等价，
      // 不再按图片位置切成十几段分别粘贴（那会让每段各自被编辑器重排、段落边界丢失）。
      if (platform === 'sohu') {
        if(typeof DraftSohuFormat!=='undefined'){
          const adapted=DraftSohuFormat.prepare(content);
          content=adapted.html;
          for(const message of adapted.notes)onProgress(message);
        }
        sohuFormat = await evalCall(portalPrepareSohu, content);
        content = sohuFormat.html;
        onProgress('已应用搜狐兼容排版：正文 16px、原生标题 24px；彩色强调转为加粗。保存后重新打开核对缩进、强调及段落对齐。');
      }
      const parts = await evalCall(sohuBodyParts, content, manifest.contentImages);
      for (const item of manifest.contentImages) {
        if (html.split(item.placeholder).length !== 2 || !assets.get('assets/' + item.bundleFile))
          throw new Error('准备包图片位置或文件无效：' + item.placeholder);
      }
      let written = '';
      // 编辑器可能把一次文件粘贴插入多份：回读到多余节点时删掉末尾那张，直到计数正确
      const ensureImageCount = async (expected) => {
        let shortSince = 0;
        for (let attempt = 0; attempt < 20; attempt++) {
          const state = await evalCall(portalImageState, config.body, portalImages);
          if (!state) throw new Error(config.label + '正文编辑器不唯一。');
          if (state.count === expected) return state.last;
          if (state.count < expected) {
            // 图片仍在加载时 naturalWidth 还是 0，会被排除；给约 3 秒重试窗口
            if (!shortSince) shortSince = Date.now();
            if (Date.now() - shortSince < 3000) {
              await pause(300);
              continue;
            }
            throw new Error(config.label + '正文图片数不足：预期 ' + expected + ' 张，实际 '
              + state.count + ' 张（已等待约 3 秒）。');
          }
          onProgress(config.label + '正文出现重复图片，自动删除多余节点（' + state.count
            + ' → ' + expected + '）…');
          if (!(await evalCall(portalPlaceCaretAfterLastImage, config.body, portalImages))) {
            throw new Error(config.label + '无法定位末张图片，自动去重中止。');
          }
          for (const type of ['keyDown', 'keyUp']) {
            await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
              type, key: 'Backspace', code: 'Backspace',
              windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
            });
          }
          await pause(500);
        }
        throw new Error(config.label + '正文图片数始终与准备包不一致（自动去重未收敛）。');
      };
      const waitForReadback = async (expected, final = false, ignoreImageUrls = false) => {
        const deadline = Date.now() + (final ? 20000 : 10000);
        while (true) {
          try {
            await evalCall(verifyPortalBody, expected, config.body, portalImages, final, ignoreImageUrls);
            return;
          } catch (error) {
            if (Date.now() >= deadline) throw error;
            await pause(250);
          }
        }
      };
      // 清空正文：先整段选中再发真实 Backspace，编辑器自己的模型才会同步；
      // 个别情况下按键删不干净，再用 DOM 兜底并补 input 事件。
      const resetBody = async () => {
        await evalCall(portalSelectAll, config.body);
        for (const type of ['keyDown', 'keyUp']) {
          await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
            type, key: 'Backspace', code: 'Backspace',
            windowsVirtualKeyCode: 8, nativeVirtualKeyCode: 8,
          });
        }
        await pause(500);
        let state = await evalCall(portalBodyEmpty, config.label, config.body);
        if (!state.empty) {
          onProgress(config.label + '正文临时区未清空，改用兜底清空…');
          await evalCall(portalForceClear, config.body);
          await pause(400);
          state = await evalCall(portalBodyEmpty, config.label, config.body);
        }
        if (!state.empty)
          throw new Error(config.label + '无法清空正文临时区，已停止（没有写入正文，页面保持可手动编辑）。');
      };
      // 旧路径：按图片位置逐段粘贴。整篇写入校验不过时才回退到这里。
      const fillInParts = async () => {
        for (let i = 0; i < parts.length; i++) {
          if (parts[i].html) {
            onProgress('按原文顺序填写' + config.label + '正文片段 ' + (i + 1) + '…');
            await evalCall(pastePortalBody, parts[i].html, config.body, true);
            written += parts[i].html;
            await waitForReadback(written);
          }
          if (i < manifest.contentImages.length) {
            const item = manifest.contentImages[i];
            onProgress('在正文位置上传' + config.label + '图片：' + item.bundleFile);
            await uploadPortalImage(tabId, assets.get('assets/' + item.bundleFile), platform,onProgress);
            const expectedImages = (written.match(/<img\b/g) || []).length + 1;
            const url = await ensureImageCount(expectedImages);
            const safeUrl = url.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
            content = content.replace(item.placeholder, safeUrl);
            // This is only the expected readback; this HTML is never pasted.
            written += '<img src="' + safeUrl + '">';
            await waitForReadback(written);
          }
        }
        await waitForReadback(content, true);
      };
      let stage = 'upload';
      try {
        if (leftoverFromUs) {
          onProgress(config.label + '检测到上一次未完成的填入（与当前准备包一致），先清空再重填…');
          await resetBody();
        }
        for (let i = 0; i < manifest.contentImages.length; i++) {
          const item = manifest.contentImages[i];
          onProgress('上传' + config.label + '图片 ' + (i + 1) + '/' + manifest.contentImages.length
            + '：' + item.bundleFile);
          try{
            await uploadPortalImage(tabId, assets.get('assets/' + item.bundleFile), platform,onProgress);
          }catch(error){
            if(platform!=='sohu'||!String(error.message||error).includes('搜狐拒绝包含二维码')
              ||typeof DraftDistribution==='undefined'||bundle.manifest.distribution?.schema!==DraftDistribution.CONTRACT)throw error;
            await evalCall(portalCancelSohuImageUpload);
            bundle=await DraftDistribution.withSohuOmissions(bundle,[{bundleFile:item.bundleFile,reason:'platform-rejected-qrcode'}]);
            ({html,manifest,assets}=bundle);
            sohuFormat=await evalCall(portalPrepareSohu,html);content=sohuFormat.html;
            onProgress('省略二维码图片：'+item.bundleFile+'；搜狐明确拒绝「图片不能包含二维码」。原始素材随包保留，已更新转换说明和图片清单。');
            if(options.onBundleChanged)await options.onBundleChanged(bundle);
            i--;continue;
          }
          await ensureImageCount(i + 1);
          await pause(150);
        }
        stage = 'compose';
        const urls = await evalCall(portalImageUrls, config.body, portalImages);
        if (urls.length !== manifest.contentImages.length)
          throw new Error(config.label + '图片地址数量不符（预期 ' + manifest.contentImages.length
            + ' 张，实际 ' + urls.length + ' 张）。');
        if (urls.some((url) => !/^https?:\/\//.test(url)))
          throw new Error(config.label + '还有图片停在临时地址（blob:），未写入正文。');
        const expected = manifest.contentImages.reduce((acc, item, i) =>
          acc.replace(item.placeholder, urls[i].replaceAll('&', '&amp;').replaceAll('"', '&quot;')), content);
        onProgress(config.label + '正文：清空临时区，整篇一次写入（' + manifest.contentImages.length + ' 张图）…');
        await resetBody();
        await evalCall(pastePortalBody, expected, config.body);
        await pause(800);
        stage = 'verify';
        await waitForReadback(expected, true, true);
      } catch (error) {
        if (stage === 'upload') throw error;
        onProgress(config.label + '整篇写入未通过校验，回退为按位置分段粘贴：'
          + String(error?.message || error));
        try {
          await resetBody();
          written = '';
          await fillInParts();
        } catch (fallbackError) {
          // 两条路都没成：正文本来是我们清空后写的，恢复为空，避免留下半截文章，用户可直接重试。
          onProgress(config.label + '两种写入方式都未通过校验，正在清空正文以免留下半截内容…');
          try { await resetBody(); } catch (resetError) {
            onProgress(config.label + '清空未成功：' + String(resetError?.message || resetError));
          }
          throw fallbackError;
        }
      }
    } else {
      for (const item of manifest.contentImages) {
        if (content.split(item.placeholder).length !== 2) throw new Error('准备包图片位置无效：' + item.placeholder);
        onProgress(config.label + '通过编辑器粘贴上传图片：' + item.bundleFile);
        const url = await uploadPortalImage(tabId, assets.get('assets/' + item.bundleFile), platform,onProgress);
        content = content.replace(item.placeholder, url.replaceAll('&', '&amp;').replaceAll('"', '&quot;'));
      }
      await evalCall(pastePortalBody, content, config.body);
      await pause(700);
      await evalCall(verifyPortalBody, content, config.body, portalImages);
    }
    // 兜底：搜狐编辑器会在 inline 元素边界处留下制表符或成串空白（准备包里没有这些字符）。
    // 这里按文本节点清一遍，Quill 的内部文档会跟着同步；清理后不影响文字校验。
    if (platform === 'sohu') {
      try {
        const swept = await evalCall(portalCleanBodyWhitespace, config.body);
        if (swept && swept.removed) {
          onProgress(config.label + '清掉正文里 ' + swept.removed + ' 个多余空白字符（'
            + swept.touched + ' 处）…');
          await pause(300);
        }
      } catch (sweepError) {
        onProgress(config.label + '空白清理未生效：' + String(sweepError?.message || sweepError));
      }
    }
    if(platform==='sohu')await ensureSohuTitle();
    else await fillField(tabId, config.title, manifest.title);
    if (platform === 'sohu' && sohuFormat) {
      await evalCall(portalRestoreSohuIndent, sohuFormat, config.body);
      const emphasis=await evalCall(portalRestoreSohuEmphasis,sohuFormat,config.body);
      if(emphasis.changed)onProgress('已通过搜狐原生编辑器恢复 '+emphasis.changed+' 处文字强调（包括链接内强调）。');
      const restored=await evalCall(portalRestoreSohuAlign, sohuFormat, config.body);
      if(restored.changed){onProgress('已通过搜狐原生编辑器恢复 '+restored.changed+' 段对齐。');await pause(200);}
      await evalCall(portalVerifySohuFormat, sohuFormat, config.body);
    }
    if (await readField(tabId, config.title) !== manifest.title) throw new Error(config.label + '标题回读不一致。');
    onProgress(config.label + '标题、正文及图片已填入并回读，继续尝试设置封面…');
    return {bundle};
  } finally { await chrome.debugger.detach({ tabId }).catch(() => {}); }
}
