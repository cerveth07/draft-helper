'use strict';

// Runs in the editor's MAIN world. Keep all DOM helpers inside this function:
// the extension serializes it for CDP, rather than depending on page globals.
function weiboPage(action, args = {}) {
  const visible = el => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const one = (selector, label, required = true) => {
    const nodes = [...document.querySelectorAll(selector)].filter(visible);
    if (nodes.length > 1 || (required && nodes.length !== 1))
      throw Error('微博' + label + '不唯一或尚未加载，请进入已登录的空白头条文章编辑页。');
    return nodes[0] || null;
  };
  const body = () => one('.ProseMirror[contenteditable="true"],.tiptap[contenteditable="true"]', '正文编辑器');
  const title = () => one('textarea[placeholder="请输入标题"],input[placeholder="请输入标题"]', '标题框');
  const summary = () => one('textarea[placeholder^="导语"],input[placeholder^="导语"]', '导语框', false);
  const norm = text => String(text || '').replace(/[\s\u200b-\u200f\u2060\ufeff]/g, '');
  const clean = root => {
    const copy = root.cloneNode(true);
    for (const el of copy.querySelectorAll('button,[role="toolbar"],.ProseMirror-widget,.ProseMirror-separator,.ProseMirror-trailingBreak,.Tiptap-invisible-character,.image-view__toolbar,.image-view__upload-overlay')) el.remove();
    return copy;
  };
  const urlInfo = value => {
    try {
      const url = new URL(value);
      if (url.protocol !== 'https:' || !/(^|\.)sinaimg\.(cn|com)$/.test(url.hostname)) return null;
      const pid = url.pathname.split('/').pop().replace(/\.[^.]+$/, '');
      return /^[\w-]+$/.test(pid) ? {url: url.href, pid} : null;
    } catch { return null; }
  };
  // ProseMirror inserts src-less separator images beside inline content. They
  // are editor decorations, not uploaded article pictures or failed uploads.
  const images = root => [...root.querySelectorAll('img')].filter(img =>
    !img.matches('.ProseMirror-separator') &&
    !img.closest('button,[role="toolbar"],.ProseMirror-widget,.image-view__toolbar'));
  const state = () => {
    const root = body(), t = title(), s = summary(), copy = clean(root);
    return {title:t.value, summary:s?.value || '', hasSummary:!!s,
      titleEditable:!t.disabled && !t.readOnly, summaryEditable:!!s && !s.disabled && !s.readOnly,
      titleMax:t.maxLength > 0 ? t.maxLength : null, summaryMax:s?.maxLength > 0 ? s.maxLength : null,
      text:norm(copy.textContent), images:images(root).map(img => ({
        src:img.currentSrc || img.src, ...urlInfo(img.currentSrc || img.src),
        ready:img.complete && img.naturalWidth > 0})),
      mediaCount:copy.querySelectorAll('img,video,audio,iframe,svg,canvas,object,embed').length};
  };
  const makeFile = () => {
    const bytes = Uint8Array.from(atob(args.dataUrl.slice(args.dataUrl.indexOf(',') + 1)), c => c.charCodeAt(0));
    return new File([bytes],args.name,{type:args.mime});
  };
  if (action === 'state') return state();
  if (action === 'plan') {
    const root = document.createElement('div'); root.innerHTML = args.html;
    // WeChat captures can include an empty zero-size SVG layout placeholder.
    // It draws nothing; actual vector content remains unsupported below.
    for (const svg of root.querySelectorAll('svg')) {
      const zero = value => /^(?:0|0px)$/.test(String(value || '').trim());
      if (!svg.childElementCount && !svg.textContent.trim()
          && (zero(svg.style.width) || zero(svg.style.height)
              || zero(svg.getAttribute('width')) || zero(svg.getAttribute('height')))) svg.remove();
    }
    if (root.querySelector('svg,video,audio,iframe,object,embed,canvas'))
      throw Error('微博填入暂不支持 SVG、音视频或嵌入组件，请在工作台替换为普通文字和图片。');
    const expectedText = norm(root.textContent), order = [];
    for (const img of root.querySelectorAll('img')) {
      const token = img.getAttribute('src');
      if (!/^WECHATIMGPH_[\w-]+$/.test(token || '')) throw Error('微博正文图片占位符无效。');
      order.push(token); img.replaceWith(document.createTextNode(token));
    }
    if (new Set(order).size !== order.length || order.some(token => root.textContent.split(token).length !== 2))
      throw Error('微博图片占位符与正文文字冲突，已停止。');
    return {html:root.innerHTML, text:norm(root.textContent), expectedText, order};
  }
  if (action === 'paste') {
    const root = body(), transfer = new DataTransfer();
    transfer.setData('text/html',args.html);
    const text = document.createElement('div'); text.innerHTML = args.html;
    transfer.setData('text/plain',text.textContent);
    root.focus();
    const event = new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer});
    root.dispatchEvent(event);
    if (!event.defaultPrevented) throw Error('微博编辑器没有接收富文本粘贴，已停止，请保留页面检查。');
    return true;
  }
  if (action === 'select') {
    const root = body(), walker = document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    const matches = []; let node;
    while ((node = walker.nextNode())) {
      let from = 0, at;
      while ((at = node.textContent.indexOf(args.token,from)) >= 0) {
        matches.push({node,at}); from = at + args.token.length;
      }
    }
    if (matches.length !== 1) throw Error('微博图片位置不唯一或已丢失：' + args.token);
    const found = matches[0], range = document.createRange();
    range.setStart(found.node,found.at); range.setEnd(found.node,found.at+args.token.length);
    root.focus();
    const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
    return selection.toString() === args.token;
  }
  if (action === 'file') {
    const root = body(), transfer = new DataTransfer(); transfer.items.add(makeFile());
    const event = new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:transfer});
    root.dispatchEvent(event);
    if (!event.defaultPrevented) throw Error('微博编辑器没有接收图片粘贴，已停止，未继续填入后续图片。');
    return true;
  }
  if (action === 'verify') {
    const actual = state(), root = clean(body());
    // Compare the text/image token stream, not just counts: a picture moved to
    // the end of the article must fail even when all text and pictures exist.
    const imgs = images(root);
    if (imgs.length !== args.uploads.length) throw Error('微博正文图片数量与准备包不一致。');
    imgs.forEach((img,i) => {
      const info = urlInfo(img.currentSrc || img.src);
      if (!info || info.pid !== args.uploads[i].pid) throw Error('微博正文图片顺序或图片地址不一致。');
      img.replaceWith(document.createTextNode(args.order[i]));
    });
    if (norm(root.textContent) !== args.text) throw Error('微博正文文字或图片位置与准备包不一致。');
    if (actual.text !== args.expectedText || /WECHATIMGPH_/.test(body().textContent))
      throw Error('微博正文仍有未替换图片位置，或正文文字已变化。');
    if (actual.title.trim() !== args.title || actual.summary.trim() !== args.summary)
      throw Error('微博标题或导语回读不一致。');
    if (actual.images.some(img => !img.ready)) throw Error('微博正文图片尚未加载完成。');
    return {ok:true,imageCount:actual.images.length};
  }
  if (action === 'cover-open') {
    const existing = [...document.querySelectorAll('.cover-preview img')].filter(visible);
    if (existing.length) return {status:'manual_required',reason:'编辑页已有封面，保留现有封面，请人工核对'};
    const control = one('.cover-empty','封面入口',false);
    if (!control) return {status:'manual_required',reason:'未找到明确的微博封面入口'};
    control.click(); return {status:'opened'};
  }
  if (action === 'cover-file') {
    const dialog = one('.n-dialog,[role="dialog"]','封面弹窗',false);
    if (!dialog) return {status:'waiting'};
    const inputs = [...dialog.querySelectorAll('input[type="file"]')]
      .filter(input => !input.disabled && (!input.accept || /image|\.jpe?g|\.png/.test(input.accept)));
    if (inputs.length !== 1) return {status:'manual_required',reason:'封面弹窗没有唯一的图片上传控件'};
    const transfer = new DataTransfer(); transfer.items.add(makeFile());
    inputs[0].files = transfer.files;
    inputs[0].dispatchEvent(new Event('change',{bubbles:true}));
    return {status:'file_sent'};
  }
  if (action === 'cover-state') {
    const preview = [...document.querySelectorAll('.cover-preview img')].filter(visible)
      .find(img => urlInfo(img.currentSrc || img.src) && img.complete && img.naturalWidth > 0);
    if (preview) return {status:'preview_changed_needs_review'};
    return {status:'manual_required',reason:'封面文件已送入控件；请完成裁剪并确认封面'};
  }
  throw Error('未知微博编辑器操作。');
}

async function fillWeiboDraft(tabId,bundle,onProgress = status) {
  const {html,manifest,assets} = bundle;
  if (manifest.targetPlatform !== 'weibo' || manifest.distribution?.schema !== DraftDistribution.CONTRACT)
    throw Error('请选择微博头条文章专用准备包。');
  DraftDistribution.platformRules('weibo',manifest.title);
  const summary = DraftDistribution.platformSummary('weibo',manifest.summary);
  const call = (action,args={}) => evaluate(tabId,'(' + weiboPage.toString() + ')('
    + JSON.stringify(action) + ',' + JSON.stringify(args) + ')');
  await attachDebugger(tabId);
  try {
    await chrome.debugger.sendCommand({tabId},'Runtime.enable');
    const current = await call('state');
    if (current.titleEditable===false || summary && current.summaryEditable===false)
      throw Error('微博标题或导语仍不可编辑，请先点击微博的「写文章」进入空白编辑页。');
    if (current.text || current.mediaCount) throw Error('微博正文已有内容，请新开空白头条文章编辑页后填入。');
    if (current.title.trim() && current.title.trim() !== manifest.title)
      throw Error('微博已有其他标题，请新开空白文章编辑页。');
    if (current.summary.trim() && current.summary.trim() !== summary)
      throw Error('微博已有其他导语，请新开空白文章编辑页。');
    if (summary && !current.hasSummary) throw Error('当前微博编辑器没有可见导语框，请将微博导语留空后再生成准备包。');
    if (current.titleMax && manifest.title.length > current.titleMax || current.summaryMax && summary.length > current.summaryMax)
      throw Error('标题或导语超过当前微博编辑器限制，请缩短后重新生成准备包。');
    const plan = await call('plan',{html:DraftDistribution.compactWeiboHtml(html)});
    if (JSON.stringify(plan.order) !== JSON.stringify(manifest.contentImages.map(item=>item.placeholder)))
      throw Error('微博正文图片顺序与素材清单不一致。');
    const files = [];
    // Read all local files before touching the editor, so a missing/unsupported
    // image cannot leave a partly filled article.
    for (const item of manifest.contentImages) {
      const file = assets.get('assets/'+item.bundleFile);
      if (!file) throw Error('准备包缺少图片：'+item.bundleFile);
      const mime = sniffImageMime(new Uint8Array(await file.arrayBuffer()));
      if (!mime) throw Error('无法识别图片真实格式：'+item.bundleFile);
      files.push({dataUrl:await readFileAsDataUrl(file),name:item.bundleFile,mime});
    }
    onProgress('填入微博正文，并检查图片占位位置…');
    await call('paste',{html:plan.html});
    await pause(250);
    const pasted = await call('state');
    if (pasted.text !== plan.text || pasted.images.length)
      throw Error('微博首次粘贴的正文或图片占位位置不完整，已停止，请保留页面检查。');
    const uploads = [];
    for (const [index,item] of manifest.contentImages.entries()) {
      onProgress('微博正在上传第 '+(index+1)+'/'+files.length+' 张图片：'+item.bundleFile);
      if (!await call('select',{token:item.placeholder})) throw Error('未选中微博图片位置。');
      await chrome.debugger.sendCommand({tabId},'Input.dispatchKeyEvent',
        {type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
      await chrome.debugger.sendCommand({tabId},'Input.dispatchKeyEvent',
        {type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
      const removed = await call('state');
      let expected = plan.text;
      for (let n=0;n<=index;n++) expected=expected.replace(manifest.contentImages[n].placeholder,'');
      if (removed.text !== expected || removed.images.length !== index)
        throw Error('删除微博图片占位符时正文发生变化，已停止。');
      await call('file',files[index]);
      const deadline=Date.now()+30000; let result;
      while (Date.now()<deadline) {
        result=await call('state');
        const image=result.images[index];
        // During upload the real editor briefly exposes progress text and
        // preview nodes. Do not mutate the next position until the complete
        // text/image state matches; a persistent mismatch still fails below.
        if (result.text===expected && result.images.length===index+1
            && uploads.every((uploaded,i)=>result.images[i]?.pid===uploaded.pid)
            && image?.pid && image.ready) {uploads.push(image);break;}
        await pause(250);
      }
      if (uploads.length !== index+1) {
        if (result?.text !== expected || result?.images.length > index+1
            || uploads.some((image,i)=>result?.images[i]?.pid !== image.pid))
          throw Error('微博图片上传结束后正文或已有图片未稳定匹配，已停止。');
        throw Error('微博第 '+(index+1)+' 张图片上传超时：'+item.bundleFile+'。请检查登录态或平台上传提示；页面保留当前进度。');
      }
    }
    await fillField(tabId,'textarea[placeholder="请输入标题"],input[placeholder="请输入标题"]',manifest.title);
    if (summary) await fillField(tabId,'textarea[placeholder^="导语"],input[placeholder^="导语"]',summary);
    const verification={...plan,uploads,title:manifest.title,summary};
    await call('verify',verification);
    // Let reactive editors settle, then re-read: DOM-only changes may disappear
    // when the editor's own document state re-renders.
    await pause(500); await call('verify',verification);
    let coverNote='准备包未携带封面；微博预览可能沿用上一篇文章封面，请手动选择本稿封面。';
    if (manifest.coverImage) {
      try {
        const file=assets.get('assets/'+manifest.coverImage.bundleFile);
        const mime=file && sniffImageMime(new Uint8Array(await file.arrayBuffer()));
        if (!mime || mime==='image/gif') throw Error('微博封面请使用静态图片');
        const opened=await call('cover-open');
        if (opened.status!=='opened') coverNote=opened.reason;
        else {
          let sent;
          for(let i=0;i<10;i++) {sent=await call('cover-file',{dataUrl:await readFileAsDataUrl(file),name:file.name,mime});if(sent.status!=='waiting')break;await pause(200);}
          if (sent?.status==='file_sent') {
            await pause(500); const checked=await call('cover-state');
            coverNote=checked.status==='preview_changed_needs_review'?'封面预览已更新，请核对裁剪。':checked.reason;
          } else coverNote=sent?.reason || '封面弹窗尚未就绪，请手动设置封面。';
        }
      } catch(error) {coverNote='封面未完成：'+String(error.message||error);}
    }
    await call('verify',verification);
    onProgress('微博标题、导语、正文文字与 '+uploads.length+' 张图片的位置已回读核对。'+coverNote+' 请核对排版并手动保存草稿。');
    return {ok:true,imageCount:uploads.length,coverNote};
  } catch(error) {
    throw Error(String(error.message||error)+' 若页面已有部分内容，请先核对，勿直接重试覆盖。');
  } finally {await chrome.debugger.detach({tabId}).catch(()=>{});}
}

if (typeof module !== 'undefined') module.exports={weiboPage,fillWeiboDraft};
