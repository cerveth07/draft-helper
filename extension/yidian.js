'use strict';

const YIDIAN_UPLOAD_BUILD = 'headline-contract-0.4.43';

/* 一点号保存时只保留 text-align 等少量 CSS，却保留 FONT 的呈现属性。
 * 在隔离、禁用脚本和网络的文档中读取原稿样式，再换成可持久化的标记。
 * 只改本次填入的副本，准备包及来源证明不变。 */
function yidianFormat(html, action = 'prepare') {
  const bodies = [...document.querySelectorAll('.editor-content.medium-editor-element[contenteditable="true"]')]
    .filter(el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const body = bodies.length === 1 ? bodies[0] : null;
  if (!body) throw new Error('未找到唯一的一点号正文编辑器。');
  if (action === 'canonicalize') {
    let node = body;
    while (node) {
      const component = node.__vue__;
      const name = component?.$options?.name || component?.$options?._componentTag;
      if (name === 'editor-content' && typeof component.processHtml === 'function')
        return component.processHtml(html);
      node = node.parentElement;
    }
    return html;
  }
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-20000px;top:0;width:713px;height:1000px;visibility:hidden;border:0';
  document.body.appendChild(frame);
  try {
    const doc = frame.contentDocument, win = frame.contentWindow;
    doc.open();
    doc.write('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><body style="margin:0;font:16px system-ui,sans-serif;color:#000;background:#fff"></body>');
    doc.close();
    const root = doc.createElement('div');
    root.innerHTML = html;
    root.querySelectorAll('script,style,link,meta,iframe,object,embed').forEach(el => el.remove());
    doc.body.appendChild(root);
    const norm = text => text.replace(/[\s\u200b-\u200f\u2060\ufeff]/g, '');
    const textNodes = element => {
      const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      const nodes = []; let node;
      while ((node = walker.nextNode())) {
        if (norm(node.textContent) && !node.parentElement.closest(
          '[contenteditable="false"],component-cursor,.image-caption-wrap,.operation-wrapper')) nodes.push(node);
      }
      return nodes;
    };
    const blockSelector = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,figcaption,div,section,article';
    const blocks = element => [...element.querySelectorAll(blockSelector)]
      .filter(el => norm(el.textContent) && !el.closest('[contenteditable="false"]')
        && ![...el.querySelectorAll(blockSelector)].some(child => norm(child.textContent)));
    const alignOf = (el, view) => {
      const style = view.getComputedStyle(el);
      return style.textAlign === 'start' ? (style.direction === 'rtl' ? 'right' : 'left')
        : style.textAlign === 'end' ? (style.direction === 'rtl' ? 'left' : 'right')
          : style.textAlign.replace('-webkit-', '');
    };
    if (action === 'verify') {
      const runs = (element, view) => textNodes(element).flatMap(node => {
        const el = node.parentElement, style = view.getComputedStyle(el);
        return Array.from(norm(node.textContent)).map(char => ({ char, color: style.color,
          size: style.fontSize, bold: parseInt(style.fontWeight) >= 600, italic: style.fontStyle === 'italic',
          underline: !!el.closest('u') || style.textDecorationLine.includes('underline'),
          strike: !!el.closest('s,del,strike') || style.textDecorationLine.includes('line-through') }));
      });
      const expected = runs(root, win), actual = runs(body, window);
      if (expected.map(r => r.char).join('') !== actual.map(r => r.char).join(''))
        throw new Error('一点号排版回读的文字不一致。');
      for (let i = 0; i < expected.length; i++) {
        if (['color', 'size', 'bold', 'italic', 'underline', 'strike'].some(key => expected[i][key] !== actual[i][key]))
          throw new Error('一点号第 ' + (i + 1) + ' 字的颜色、字号或强调格式不一致（预期 '
            + JSON.stringify(expected[i]) + '，实际 ' + JSON.stringify(actual[i]) + '），请勿直接保存。');
      }
      const a = blocks(root), b = blocks(body);
      if (a.length !== b.length) throw new Error('一点号段落结构回读不一致。');
      const prefix = el => (el.textContent.replace(/[\u200b-\u200f\u2060\ufeff]/g, '').match(/^[\s\u3000]*/)?.[0] || '').replace(/[^\u3000\u2002\u2009]/g, '');
      for (let i = 0; i < a.length; i++) {
        if (alignOf(a[i], win) !== alignOf(b[i], window) || prefix(a[i]) !== prefix(b[i]))
          throw new Error('一点号第 ' + (i + 1) + ' 段的对齐或首行缩进回读不一致，请勿直接保存。');
      }
      const links = el => [...el.querySelectorAll('a[href]')].map(a => ({href:a.getAttribute('href'), text:norm(a.textContent)}));
      if (JSON.stringify(links(root)) !== JSON.stringify(links(body))) throw new Error('一点号链接文字或原地址回读不一致。');
      const positions = root => {let offset=0;const images=[];const visit=node=>{if(node.nodeType===3){offset+=norm(node.textContent).length;return;}if(node.nodeType!==1)return;if(node.matches('.operation-wrapper,.image-caption-wrap,component-cursor'))return;if(node.tagName==='IMG'){images.push({src:node.getAttribute('src'),offset});return;}for(const child of node.childNodes)visit(child);};visit(root);return images;};
      if(JSON.stringify(positions(root))!==JSON.stringify(positions(body)))throw new Error('一点号图片相对于正文的位置回读不一致。');
      return { characters: expected.length, paragraphs: a.length, links:links(root).length, images:positions(root).length, stylesMatch: true };
    }
    for (const svg of root.querySelectorAll('svg')) {
      if (svg.children.length || norm(svg.textContent))
        throw new Error('一点号无法保留正文中的 SVG 绘图，请先在工作台替换为图片。');
      svg.remove();
    }
    const originalText = norm(root.textContent);
    const rgba = value => {
      const values = value.match(/[\d.]+/g)?.map(Number);
      return values && values.length >= 3 ? [...values.slice(0, 3), values[3] ?? 1] : [0, 0, 0, 1];
    };
    const hex = rgb => '#' + rgb.slice(0, 3).map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
    const background = element => {
      let color = [255, 255, 255], alpha = 1;
      for (let el = element; el; el = el.parentElement) {
        const c = rgba(win.getComputedStyle(el).backgroundColor);
        color = color.map((v, i) => v - alpha * c[3] * (255 - c[i]));
        alpha *= 1 - c[3];
        if (alpha === 0) break;
      }
      return color;
    };
    const scale = Array.from({ length: 7 }, (_, i) => {
      const font = doc.createElement('font'); font.size = String(i + 1); font.textContent = '字';
      doc.body.appendChild(font);
      const px = parseFloat(win.getComputedStyle(font).fontSize); font.remove();
      return { size: i + 1, px };
    });
    const mappings = new Map(); let contrastFallbacks = 0;
    // Capture every style before adding FONT/B/I nodes; inherited styles otherwise change mid-walk.
    const styles = textNodes(root).map(node => {
      const el = node.parentElement, s = win.getComputedStyle(el), wanted = parseFloat(s.fontSize);
      const nearest = scale.reduce((best, item) => Math.abs(item.px - wanted) < Math.abs(best.px - wanted) ? item : best);
      if (Math.abs(nearest.px - wanted) > 0.1) mappings.set(wanted, nearest.px);
      const fg = rgba(s.color), bg = background(el);
      let color = fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]));
      // Colored CSS panels do not survive saving. Keep their white labels legible in the panel's color.
      if (color.every(v => v > 250)) {
        color = bg.some(v => v < 220) ? bg : [53, 53, 53];
        contrastFallbacks++;
      }
      return { node, color: hex(color), size: nearest.size, face: s.fontFamily,
        bold: parseInt(s.fontWeight) >= 600, italic: s.fontStyle === 'italic',
        underline: s.textDecorationLine.includes('underline'), strike: s.textDecorationLine.includes('line-through') };
    });
    const paragraphStyles = blocks(root).map(el => {
      const s = win.getComputedStyle(el);
      const first = textNodes(el)[0];
      return { el, align: alignOf(el, win), indent: parseFloat(s.textIndent) || 0,
        font: parseFloat(win.getComputedStyle(first?.parentElement || el).fontSize) || 16 };
    });
    for (const item of styles) {
      const font = doc.createElement('font');
      font.setAttribute('color', item.color); font.setAttribute('size', item.size);
      font.setAttribute('face', item.face);
      item.node.replaceWith(font);
      let leaf = font;
      for (const [flag, tag] of [[item.bold, 'b'], [item.italic, 'i'], [item.underline, 'u'], [item.strike, 's']]) {
        if (flag) { const el = doc.createElement(tag); leaf.appendChild(el); leaf = el; }
      }
      leaf.appendChild(item.node);
    }
    let indentCount = 0, unsupportedIndentCount = 0;
    const quoteFallbacks = root.querySelectorAll('blockquote').length;
    for (const item of paragraphStyles) {
      let el = item.el;
      if (['DIV', 'SECTION', 'ARTICLE', 'FIGCAPTION', 'BLOCKQUOTE'].includes(el.tagName)) {
        const p = doc.createElement('p'); while (el.firstChild) p.appendChild(el.firstChild);
        el.replaceWith(p); el = p;
      }
      el.setAttribute('align', item.align === 'justify' ? 'justify' : item.align);
      const units = item.indent / item.font;
      if (units > 0 && units <= 16 && ['left', 'justify'].includes(item.align)) {
        let prefix = '\u3000'.repeat(Math.floor(units));
        const half = Math.round((units % 1) * 2);
        prefix += half === 2 ? '\u3000' : half === 1 ? '\u2002' : '';
        const node = textNodes(el)[0];
        if (node && prefix) { node.textContent = prefix + node.textContent; indentCount++; }
      } else if (item.indent && ['left', 'justify'].includes(item.align)) unsupportedIndentCount++;
    }
    for (const quote of root.querySelectorAll('blockquote')) {
      const container = doc.createElement('div');
      while (quote.firstChild) container.appendChild(quote.firstChild);
      quote.replaceWith(container);
    }
    for (const el of root.querySelectorAll('*')) {
      const allowed = new Set(['align', 'title', 'dir', 'lang']);
      if (el.tagName === 'FONT') ['color', 'size', 'face'].forEach(k => allowed.add(k));
      if (el.tagName === 'A') ['href', 'target', 'rel'].forEach(k => allowed.add(k));
      if (el.tagName === 'IMG') ['src', 'alt', 'width', 'height', 'image_caption'].forEach(k => allowed.add(k));
      if (['OL', 'UL', 'LI'].includes(el.tagName)) ['start', 'value', 'type'].forEach(k => allowed.add(k));
      for (const attr of [...el.attributes]) if (!allowed.has(attr.name)) el.removeAttribute(attr.name);
      const align = el.getAttribute('align');
      if (align && /^(left|right|center|justify)$/.test(align)) el.style.textAlign = align;
      if (el.tagName === 'A' && !/^(https?:|mailto:|#)/i.test(el.getAttribute('href') || '')) el.removeAttribute('href');
    }
    if (norm(root.textContent) !== originalText) throw new Error('一点号格式转换改变了正文文字，已停止填入。');
    const fontMappings = [...mappings].sort((a, b) => a[0] - b[0]).map(([from, to]) => ({ from, to }));
    const warnings = [];
    if (fontMappings.length) warnings.push('平台字号档位：' + fontMappings.map(m => m.from + 'px→' + m.to + 'px').join('、'));
    if (contrastFallbacks) warnings.push('平台不保留彩色底块，' + contrastFallbacks + ' 处白字改为原底色或深色，避免白底上不可见');
    if (unsupportedIndentCount) warnings.push(unsupportedIndentCount + ' 处负值或过大的首行缩进需手动检查');
    if (quoteFallbacks) warnings.push(quoteFallbacks + ' 处引用块转为普通段落，以保留文字颜色和字号');
    return { html: root.innerHTML, indentCount, fontMappings, contrastFallbacks, warnings,
      note: '文字颜色和首行缩进已转为可保存格式；行距、段距及复杂底纹采用平台排版' };
  } finally { frame.remove(); }
}

function yidianEditorState() {
  const visible = (el) => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const bodies = [...document.querySelectorAll('.editor-content.medium-editor-element[contenteditable="true"]')].filter(visible);
  const titles = [...document.querySelectorAll('input.post-title')].filter(visible);
  if (bodies.length !== 1 || titles.length !== 1) throw new Error('未找到唯一的一点号正文和标题编辑器，请打开已登录的文章编辑页。');
  return { html: bodies[0].innerHTML, title: titles[0].value };
}

async function readYidianState(tabId) {
  return evaluate(tabId, '(' + yidianEditorState.toString() + ')()');
}

/* 按文件头判断真实图片格式：准备包里的文件名/扩展名并不可靠（实际见过
 * 叫 008.gif 的 1×1 PNG、叫 .png 的 WEBP），按扩展名声明 MIME 会被平台拒绝。 */
function sniffImageMime(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const starts = (sig) => sig.every((value, index) => u[index] === value);
  if (starts([0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (starts([0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (starts([0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (starts([0x42, 0x4d])) return 'image/bmp';
  if (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46
      && u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50) return 'image/webp';
  return null;
}

const YIDIAN_EXT = { 'image/png': 'png', 'image/gif': 'gif', 'image/jpeg': 'jpg',
  'image/bmp': 'bmp', 'image/webp': 'webp' };

// 一点号用户守则：单篇正文图片数量上限 80 张。
const YIDIAN_MAX_IMAGES = 80;

// 缓存键优先用内容哈希：同一张图跨文章、跨重试都成立；没有哈希就不缓存。
function yidianUploadKey(item) {
  const digest = typeof item?.sha256 === 'string' ? item.sha256.trim().toLowerCase() : '';
  return /^[a-f0-9]{64}$/.test(digest) ? 'yidian:' + digest : null;
}

// 平台限流/超额时通常只回一句 "user limit"，这里补上进度和可执行建议。
function yidianUploadMessage(error, info = {}) {
  const detail = String(error?.message || error || '未知错误').trim();
  const where = info.file ? '（卡在 ' + info.file + '）' : '';
  if (/user\s*limit|rate\s*limit|too\s*many|频繁|额度|超出/i.test(detail))
    return '一点号返回「' + detail + '」' + where + '：账号图片上传额度或频率受限，本次已传 '
      + (info.done ?? 0) + '/' + (info.total ?? 0) + ' 张。正文还没有写入，页面仍是空的；'
      + '已传图片留在素材库，重试会自动跳过。请等额度恢复后再填，或把这篇拆成两篇。';
  return '一点号图片上传失败' + where + '：' + detail;
}

async function uploadImageToYidian(tabId, file, options = {}) {
  const cacheKey = options.cacheKey || null;
  if (cacheKey && typeof DraftUploadCache !== 'undefined') {
    const cached = await DraftUploadCache.get(cacheKey);
    if (cached && !options.details) return cached;
  }
  const dataUrl = await readFileAsDataUrl(file);
  // 先按扩展名给一个候选 MIME，真实格式由页面侧按 magic 决定（见 sniffImageMime）
  const declared = file.type || ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }[file.name.split('.').pop().toLowerCase()]);
  if (!declared || !declared.startsWith('image/')) throw new Error('无法识别图片格式：' + file.name);
  const upload = async (encoded, filename, mime) => {
      const bodies = [...document.querySelectorAll('.editor-content.medium-editor-element[contenteditable="true"]')]
        .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      const body = bodies.length === 1 ? bodies[0] : null;
      if (!body) throw new Error('一点号正文编辑器不唯一，已停止上传。');
      const bytes = Uint8Array.from(atob(encoded.slice(encoded.indexOf(',') + 1)), (ch) => ch.charCodeAt(0));
      // 用文件头纠正格式与扩展名：名字叫 .gif 的 PNG 必须按 PNG 上传
      const realMime = (typeof sniffImageMime === 'function' ? sniffImageMime(bytes) : null) || mime;
      const baseName = filename.replace(/\.[^.]+$/, '');
      const realName = baseName + '.' + ({ 'image/png': 'png', 'image/gif': 'gif', 'image/jpeg': 'jpg',
        'image/bmp': 'bmp', 'image/webp': 'webp' }[realMime] || 'png');
      let image = new File([bytes], realName, { type: realMime });
      // The native local-image dialog rejects WebP. Keep the package original; upload a full-size PNG.
      if (realMime === 'image/webp') {
        if (String.fromCharCode(...bytes.slice(12,16)) === 'VP8X' && (bytes[20] & 2))
          throw new Error('一点号不支持动画 WebP，不能静默转换成静图，请先选择保留动画的替代素材。');
        const bitmap = await createImageBitmap(image);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height;
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        bitmap.close();
        const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        if (!png) throw new Error('一点号 WebP 图片转换失败。');
        image = new File([png], baseName + '.png', { type: 'image/png' });
      }
      // Reuse the editor's Axios client so its XSRF header and response interceptors apply.
      let imageUploader = body;
      while (imageUploader && typeof imageUploader.__vue__?.$http?.post !== 'function')
        imageUploader = imageUploader.parentElement;
      const http = imageUploader?.__vue__?.$http;
      if (!http) throw new Error('未找到一点号编辑器图片上传服务，请刷新编辑页后重试。');
      const pickUrl = (response) => {
        const data = response?.data ?? response;
        return data?.url || data?.data?.url || data?.result?.url || data?.src || null;
      };
      let response = null;
      let url = null;
      // A rejected upload is surfaced once with the native error, rather than replayed blindly.
      {
        const form = new FormData();
        form.append('upfile', image);
        response = await http.post('/upload?action=uploadimage&picType=wemedia_cnt', form,
          { timeout: 30000 });
        url = pickUrl(response);
      }
      if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
        const detail = JSON.stringify(response?.data ?? response ?? null).slice(0, 400);
        throw new Error('一点号图片接口未返回有效图片地址：' + filename
          + '（' + (image.size / 1024).toFixed(1) + 'KB，' + image.type
          + '，未返回 url）平台返回：' + detail);
      }
      return {url, sourceType:realMime, uploadType:image.type, sourceBytes:bytes.length, uploadBytes:image.size,
        converted:realMime !== image.type};
  };
  // Use CDP's awaited evaluation so page exceptions reach the popup instead of an undefined result.
  const expression = '(async()=>{const sniffImageMime=' + sniffImageMime.toString() + ';return await (' + upload.toString() + ')('
    + [dataUrl, file.name, declared].map(JSON.stringify).join(',') + ')})()';
  const result = await evaluate(tabId, expression);
  const url = result?.url;
  if (typeof url !== 'string' || !/^https?:\/\//.test(url)) throw new Error('未取得一点号图片地址。');
  if (cacheKey && typeof DraftUploadCache !== 'undefined') await DraftUploadCache.put(cacheKey, url);
  return options.details ? result : url;
}

async function writeYidianBody(content) {
  const bodies = [...document.querySelectorAll('.editor-content.medium-editor-element[contenteditable="true"]')]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const body = bodies.length === 1 ? bodies[0] : null;
  if (!body) throw new Error('一点号正文编辑器已消失。');
  body.focus();
  let node = body, component = null;
  while (node && !component) {
    const vm = node.__vue__;
    const componentName = vm?.$options?.name || vm?.$options?._componentTag;
    if (componentName === 'editor-content' && typeof vm.replaceContent === 'function') component = vm;
    node = node.parentElement;
  }
  if (!component) throw new Error('未找到一点号 editor-content 正文接口，请刷新编辑页后重试。');
  const modelCallback = component.$vnode?.data?.model?.callback;
  const inputListener = component.$listeners?.input;
  const syncModel = typeof modelCallback === 'function' ? modelCallback
    : typeof inputListener === 'function' ? inputListener : null;
  if (!syncModel) {
    const listenerNames = Object.keys(component.$listeners || {});
    throw new Error('未找到一点号正文的 Vue 双向绑定回调，无法安全同步页面状态。可用事件：'
      + listenerNames.join(', '));
  }
  const modelField = String(syncModel).match(/([\w$]+)\s*=\s*\$\$v/)?.[1];
  // 回调源码里可能有多处 `= $$v` 赋值（兜底对象、真实字段、被压缩后的中间变量…）。
  // 只取第一处会守错对象——实页里这一处往往正是写不进真模型的兜底赋值。
  const modelFields = [...new Set(
    [...String(syncModel).matchAll(/([A-Za-z_$][\w$]*)\s*=\s*\$\$v\b/g)].map((match) => match[1])
  )].filter(Boolean);
  if (!modelFields.length && modelField) modelFields.push(modelField);
  const modelOwner = component.$vnode?.context || component.$parent;
  const trace = [];
  const snapshot = (stage) => {
    const measure = (el) => el ? {
      isBody: el === body,
      textLength: el.textContent.replace(/\s+/g, '').length,
      htmlLength: el.innerHTML.length,
      imageCount: el.querySelectorAll('img').length,
    } : null;
    const state = { stage, body: measure(body) };
    if (stage === 'after setContent') {
      state.editorElements = [...(component.editor?.elements || [])].map(measure);
      state.originalElements = Array.isArray(component.editor?.origElements)
        ? component.editor.origElements.map(measure) : measure(component.editor?.origElements);
    }
    trace.push(state);
  };
  const restores = [];
  const instrument = (target, name, stage) => {
    const original = target?.[name];
    if (typeof original !== 'function') return;
    const hadOwn = Object.prototype.hasOwnProperty.call(target, name);
    const descriptor = Object.getOwnPropertyDescriptor(target, name);
    Object.defineProperty(target, name, { configurable: true, writable: true,
      value: function(...args) {
        const result = original.apply(this, args);
        snapshot(stage);
        return result;
      } });
    restores.push(() => { if (hadOwn) Object.defineProperty(target, name, descriptor); else delete target[name]; });
  };
  snapshot('before');
  trace.push({ stage: 'Vue model binding', callbackKind: typeof modelCallback === 'function' ? 'vnode-model' : 'input-listener',
    listenerNames: Object.keys(component.$listeners || {}),
    callbackSource: String(syncModel).slice(0, 300) });
  instrument(component.editor, 'setContent', 'after setContent');
  for (const name of ['removeBlankRow']) instrument(component, name, 'after ' + name);
  try {
    // Keep Vue's actual parent model authoritative, then prevent setContent's
    // checkContentChanged -> editableInput event from writing stale content back.
    syncModel.call(component, content);
    if (typeof component.$nextTick === 'function') await new Promise((resolve) => component.$nextTick(resolve));
    snapshot('after sync Vue model');
    const checkDescriptor = Object.getOwnPropertyDescriptor(component.editor, 'checkContentChanged');
    const checkMethod = component.editor.checkContentChanged;
    if (typeof checkMethod === 'function') {
      Object.defineProperty(component.editor, 'checkContentChanged', {
        configurable: true, writable: true, value: function() {},
      });
      restores.push(() => {
        if (checkDescriptor) Object.defineProperty(component.editor, 'checkContentChanged', checkDescriptor);
        else delete component.editor.checkContentChanged;
      });
    }
    component.editor.setContent(content);
    component.removeBlankRow();
    syncModel.call(component, body.innerHTML);
    snapshot('after sync cleaned Vue model');
  }
  finally { restores.reverse().forEach((restore) => restore()); }
  // 守卫必须放在插桩还原之后安装：instrument() 的还原会用「原始描述符」重写
  // editor.setContent，先装守卫就会被它悄悄覆盖（实页表现：守卫标记为已安装但根本不生效）。
  {
      const blocked = [];
      const contentBlocks = [];
      const guardRestores = [];
      const strip = (html) => String(html).replace(/<[^>]*>/g, '').replace(/\s+/g, '');
      const imageCountOf = (html) => (String(html).match(/<img\b/gi) || []).length;
      const matchesCurrentEditor = (value) => {
        if (typeof value !== 'string') return false;
        const candidate = document.createElement('div');
        candidate.innerHTML = value;
        return candidate.innerHTML === body.innerHTML;
      };
      const guardProperty = (target, key, label) => {
        const descriptor = target && Object.getOwnPropertyDescriptor(target, key);
        if (!descriptor?.get || !descriptor?.set || !descriptor.configurable) return false;
        Object.defineProperty(target, key, { ...descriptor,
          get() { return descriptor.get.call(this); },
          set(value) {
            if (!matchesCurrentEditor(value)) {
              blocked.push({ target: label, length: typeof value === 'string' ? value.length : null,
                textLength: typeof value === 'string' ? value.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length : null,
                stack: new Error('Blocked stale Yidian editor model write').stack });
              return;
            }
            descriptor.set.call(this, value);
          },
        });
        guardRestores.push(() => Object.defineProperty(target, key, descriptor));
        return true;
      };
      // A. 模型守卫：平台的延迟回写可能落在任意一层祖先，只守 $vnode.context 会漏守，
      //    所以把祖先链上真正持有该字段的组件全部守上（实页报告里这条链常常是空的，
      //    说明平台还有一条不经模型的重渲染路径，见 B）。
      const owners = [];
      if (modelFields.length) {
        const seenOwners = new Set();
        let cursor = component;
        for (let depth = 0; cursor && depth < 10; depth++, cursor = cursor.$parent) {
          let owns = false;
          try {
            owns = !!(cursor.$data
              && modelFields.some((field) => Object.prototype.hasOwnProperty.call(cursor.$data, field)));
          } catch { owns = false; }
          if (owns && !seenOwners.has(cursor)) {
            seenOwners.add(cursor);
            owners.push({ vm: cursor, depth,
              tag: cursor.$options?.name || cursor.$options?._componentTag || 'anonymous' });
          }
        }
        if (modelOwner && !seenOwners.has(modelOwner)) {
          seenOwners.add(modelOwner);
          owners.push({ vm: modelOwner, depth: -1,
            tag: modelOwner.$options?.name || modelOwner.$options?._componentTag || 'anonymous' });
        }
        for (const owner of owners) {
          for (const field of modelFields) {
            guardProperty(owner.vm, field, 'vm(depth ' + owner.depth + ',' + owner.tag + ').' + field);
            guardProperty(owner.vm._data, field, '_data(depth ' + owner.depth + ').' + field);
          }
        }
      }
      // B. 内容守卫：平台的重渲染最终都走 MediumEditor.setContent
      //    （replaceContent = setContent→serialize→removeBlankRow→triggerChange；
      //      resetContent 会从 contentStack 里把旧快照 setContent 回来）。
      //    实页证据：模型守卫拦截 0 次而正文仍被塌成旧内容，说明写的就是这条路径。
      const authoritativeText = strip(content).length;
      const authoritativeImages = imageCountOf(content);
      let contentGuardArmed = true;
      let contentGuardInstalled = false;
      const editor = component.editor;
      if (editor && typeof editor.setContent === 'function') {
        const originalSetContent = editor.setContent;
        const looksStale = (html) => typeof html === 'string'
          && (strip(html).length < authoritativeText * 0.75 || imageCountOf(html) < authoritativeImages);
        const guardedSetContent = function (value, index) {
          let next = value;
          if (contentGuardArmed && looksStale(value)) {
            contentBlocks.push({ target: 'editor.setContent', length: value.length,
              textLength: strip(value).length, imageCount: imageCountOf(value),
              stack: new Error('Blocked stale Yidian editor setContent').stack });
            next = content;
          }
          const result = originalSetContent.call(this, next, index);
          if (contentGuardArmed && next !== value) {
            // 平台把旧 HTML 塞回来后，模型也要拉回权威值，否则下一轮自动保存又会保存旧的
            try { if (typeof syncModel === 'function') syncModel.call(component, body.innerHTML); } catch {}
          }
          return result;
        };
        editor.setContent = guardedSetContent;
        guardRestores.push(() => { editor.setContent = originalSetContent; });
        contentGuardInstalled = true;
      }
      const release = () => {
        if (!body.__draftHelperYidianGuard) return;
        guardRestores.reverse().forEach((restore) => restore());
        delete body.__draftHelperYidianGuard;
        if (globalThis.__draftHelperYidianGuard) delete globalThis.__draftHelperYidianGuard;
      };
      // 使用者一动手就撤掉内容守卫，避免和人工编辑抢内容。
      // 注意必须限定事件来源在正文编辑器内部：标题框的 input 也会冒泡到 body，
      // 若按冒泡就撤防，填充标题这一步会顺手把正文守卫关掉。
      const disarm = (event) => {
        const source = event?.target;
        if (source && (source === body || body.contains(source))) contentGuardArmed = false;
      };
      for (const type of ['input', 'beforeinput', 'keydown', 'paste', 'drop'])
        body.addEventListener(type, disarm, { capture: true });
      body.__draftHelperYidianGuard = { blocked, contentBlocks, release, modelField, modelFields,
        owners: owners.map((owner) => ({ depth: owner.depth, tag: owner.tag })),
        contentGuardInstalled, armed: () => contentGuardArmed, watchdog: null, domReverts: [] };
      // 节点被平台整体替换后，挂在旧节点上的守卫就取不到了；同时挂一份到 window 供诊断导出。
      globalThis.__draftHelperYidianGuard = body.__draftHelperYidianGuard;

      // C. DOM 级兜底：平台的「存草稿 / 发布」会绕过 setContent 直接用它自己的状态重渲染，
      //    甚至整节点重建，前两层的守卫都碰不到。这里用 MutationObserver 立即发现
      //    「正文明显变少」，按同样的顺序恢复，并把现场（HTML 片段、是否换节点）记进诊断。
      const domReverts = body.__draftHelperYidianGuard.domReverts;
      const currentEditor = () => {
        const list = [...document.querySelectorAll('.editor-content.medium-editor-element[contenteditable="true"]')]
          .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
        return list.length === 1 ? list[0] : null;
      };
      let restoring = false;
      let checkQueued = false;
      body.__draftHelperGuardMarked = true;
      const restoreCollapsed = () => {
        const node = currentEditor();
        if (!node) return false;
        restoring = true;
        try {
          node.innerHTML = content;
          node.__draftHelperGuardMarked = true;
          if (component?.editor && typeof component.editor.setContent === 'function') component.editor.setContent(content);
          if (typeof component?.removeBlankRow === 'function') component.removeBlankRow();
          const sync = component?.$vnode?.data?.model?.callback || component?.$listeners?.input;
          if (typeof sync === 'function') sync.call(component, (currentEditor() || node).innerHTML);
        } catch (error) {
          domReverts.push({ at: Date.now(), stage: 'restore-failed', error: String(error?.message || error) });
        }
        restoring = false;
        return true;
      };
      const onDomChanged = () => {
        if (restoring || !contentGuardArmed) return;
        const node = currentEditor();
        if (!node) return;
        const html = node.innerHTML;
        if (strip(html).length >= authoritativeText * 0.75) return;
        domReverts.push({ at: Date.now(), textLength: strip(html).length, images: imageCountOf(html),
          nodeReplaced: !node.__draftHelperGuardMarked, html: html.slice(0, 300),
          stack: new Error('Yidian editor DOM collapsed').stack });
        restoreCollapsed();
      };
      const scheduleCheck = () => {
        if (checkQueued) return;
        checkQueued = true;
        setTimeout(() => { checkQueued = false; onDomChanged(); }, 80);
      };
      const observer = new MutationObserver(scheduleCheck);
      observer.observe(body, { childList: true, subtree: true, characterData: true });
      if (body.parentElement) observer.observe(body.parentElement, { childList: true });
      guardRestores.push(() => observer.disconnect());
      trace.push({ stage: 'guard stale model writes + editor.setContent', modelField,
        guardedProperties: guardRestores.length, contentGuardInstalled,
        guardedOwners: body.__draftHelperYidianGuard.owners });
      // 曾经在这里调用平台自己的「内容已变更」通道（component.updateEditorContent）。
      // 实页 trace 证明它紧接着就用平台旧快照重渲染，把刚写好的正文压成 3 字：
      //   after setContent 4415 字 → platformSync → stability 0ms 仍 4415 → 下一拍变 3 字。
      // 模型已由 syncModel 更新，因此默认不主动触发；保留开关供以后实页排查。
      let platformSync = 'skipped';
      if (globalThis.__draftHelperYidianTriggerPlatformSync === true
          && typeof component.updateEditorContent === 'function') {
        try {
          component.updateEditorContent();
          platformSync = 'updateEditorContent';
        } catch (error) {
          platformSync = 'failed: ' + String(error?.message || error);
        }
      }
      body.__draftHelperYidianGuard.platformSync = platformSync;
      trace.push({ stage: 'platform content-changed channel', platformSync });
  }
  return trace;
}

async function verifyYidianBody(content, trace = []) {
  const bodies = [...document.querySelectorAll('.editor-content.medium-editor-element[contenteditable="true"]')]
    .filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
  const body = bodies.length === 1 ? bodies[0] : null;
  if (!body) throw new Error('一点号正文编辑器已消失。');
  const expected = document.createElement('div');
  expected.innerHTML = content;
  const articleText = el => {const copy=el.cloneNode(true);copy.querySelectorAll('.operation-wrapper,.image-caption-wrap,component-cursor').forEach(node=>node.remove());return copy.textContent.replace(/[\s\u200b-\u200f\u2060\ufeff]/g, '');};
  const text = articleText;
  const images = (el) => [...el.querySelectorAll('img')].map((img) => img.src);
  const guard = body.__draftHelperYidianGuard;
  const stabilityTrace = [];
  let editorVm = null, editorNode = body;
  while (editorNode && !editorVm) {
    const vm = editorNode.__vue__;
    if ((vm?.$options?.name || vm?.$options?._componentTag) === 'editor-content') editorVm = vm;
    editorNode = editorNode.parentElement;
  }
  for (let index = 0; index <= 20; index++) {
    const currentText = text(body);
    const currentImages = images(body);
    const modelValue = editorVm?.$props?.value;
    stabilityTrace.push({ stage: 'stability ' + (index * 250) + 'ms',
      body: { textLength: currentText.length, htmlLength: body.innerHTML.length,
        imageCount: body.querySelectorAll('img').length },
      propValue: typeof modelValue === 'string' ? { length: modelValue.length,
        textLength: modelValue.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length,
        imageCount: (modelValue.match(/<img\b/gi) || []).length } : null,
      modelEditContent: typeof editorVm?.$parent?.$data?.editContent === 'string'
        ? { length: editorVm.$parent.$data.editContent.length,
          textLength: editorVm.$parent.$data.editContent.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length,
          imageCount: (editorVm.$parent.$data.editContent.match(/<img\b/gi) || []).length } : null,
      blockedModelWrites: guard?.blocked?.length || 0 });
    if (currentText !== text(expected) || JSON.stringify(currentImages) !== JSON.stringify(images(expected))) break;
    if (index < 20) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (text(body) !== text(expected)) {
    const afterDelay = { stage: 'after stability window', body: { textLength: text(body).length,
      htmlLength: body.innerHTML.length, imageCount: body.querySelectorAll('img').length } };
    const metric = (value) => typeof value === 'string' ? {
      type: 'string', length: value.length,
      textLength: value.replace(/<[^>]*>/g, '').replace(/\s+/g, '').length,
      imageCount: (value.match(/<img\b/gi) || []).length,
    } : { type: value === null ? 'null' : typeof value };
    const stateSummary = (object, label) => {
      if (!object || typeof object !== 'object') return [];
      return Object.keys(object).slice(0, 40).flatMap((key) => {
        const value = object[key];
        if (typeof value === 'string') return [{ key: label + '.' + key, ...metric(value) }];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return Object.keys(value).slice(0, 20).filter((childKey) => typeof value[childKey] === 'string')
            .map((childKey) => ({ key: label + '.' + key + '.' + childKey, ...metric(value[childKey]) }));
        }
        return [];
      });
    };
    const vueComponents = [];
    let node = body, depth = 0;
    const seen = new Set();
    while (node && depth < 12) {
      let vm = node.__vue__;
      while (vm && !seen.has(vm) && vueComponents.length < 8) {
        seen.add(vm);
        const model = vm.$vnode?.data?.model;
        vueComponents.push({
          depth, name: vm.$options?.name || vm.$options?._componentTag || 'anonymous',
          listenerNames: Object.keys(vm.$listeners || {}),
          modelValue: model ? metric(model.value) : null,
          modelCallback: typeof model?.callback === 'function' ? String(model.callback).slice(0, 240) : null,
          props: stateSummary(vm.$props, 'props'),
          data: stateSummary(vm.$data, 'data'),
        });
        vm = vm.$parent;
      }
      node = node.parentElement; depth++;
    }
    const blockedModelWrites = guard?.blocked || [];
    throw new Error(`一点号正文回读与准备稿文字不一致（实际 ${text(body).length} 字，预期 ${text(expected).length} 字）。阶段记录：${JSON.stringify([...trace, ...stabilityTrace, afterDelay])}。Vue状态摘要：${JSON.stringify(vueComponents)}。拦截到的旧模型写入：${JSON.stringify(blockedModelWrites)}`);
  }
  if (JSON.stringify(images(body)) !== JSON.stringify(images(expected))) {
    throw new Error('一点号正文回读的图片数量或顺序不一致。');
  }
  if (body.innerHTML.includes('WECHATIMGPH_')) {
    throw new Error('正文仍有未替换图片位置。');
  }
  // Keep the model guard for the page lifetime. It follows live editor HTML,
  // so normal edits update the Vue model while delayed stale writes are rejected.
  return true;
}

async function watchYidianBody(content, options) {
  const opts = Object.assign({ durationMs: 180000, intervalMs: 3000 }, options || {});
  const visible = (el) => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const bodies = [...document.querySelectorAll('.editor-content.medium-editor-element[contenteditable="true"]')].filter(visible);
  const body = bodies.length === 1 ? bodies[0] : null;
  if (!body) return { state: 'no-editor' };
  const expected = document.createElement('div');
  expected.innerHTML = content;
  const articleText = el => {const copy=el.cloneNode(true);copy.querySelectorAll('.operation-wrapper,.image-caption-wrap,component-cursor').forEach(node=>node.remove());return copy.textContent.replace(/[\s\u200b-\u200f\u2060\ufeff]/g, '');};
  const expectedText = articleText(expected);
  const expectedImages = [...expected.querySelectorAll('img')].map((img) => img.getAttribute('src'));
  const guard = body.__draftHelperYidianGuard
    || (body.__draftHelperYidianGuard = { blocked: [], contentBlocks: [], release() {}, watchdog: null });
  const state = { state: 'watching', startedAt: Date.now(), durationMs: opts.durationMs,
    intervalMs: opts.intervalMs, checks: 0, repairs: 0, reverts: [] };
  guard.watchdog = state;
  // 同一页面里多次填入时，旧哨兵必须先停：否则它会继续盯着（甚至重新抓到）新正文并覆盖。
  const previousStop = globalThis.__draftHelperYidianWatchdogStop;
  if (typeof previousStop === 'function') {
    try { previousStop('superseded'); } catch {}
  }
  // 正文节点被整体替换后不再重新抓取：那意味着页面已重渲染，继续盯着只会和平台抢内容。
  const target = body;
  const resolve = () => (target && target.isConnected ? target : null);
  const componentOf = () => {
    let node = resolve();
    while (node) {
      const vm = node.__vue__;
      if (vm && (vm.$options?.name || vm.$options?._componentTag) === 'editor-content') return vm;
      node = node.parentElement;
    }
    return null;
  };
  const snapshot = () => {
    const node = resolve();
    return {
      text: node ? articleText(node) : '',
      images: node ? [...node.querySelectorAll('img')].map((img) => img.getAttribute('src')) : [],
    };
  };
  const matches = () => {
    const current = snapshot();
    return current.text === expectedText
      && JSON.stringify(current.images) === JSON.stringify(expectedImages);
  };
  // 只在“内容明显变少”时判为平台回写；用户自己加字、改格式造成的普通差异不碰。
  const looksReverted = () => {
    const current = snapshot();
    return current.text.length < expectedText.length * 0.75
      || current.images.length < expectedImages.length;
  };
  // 使用者一旦动过编辑器，哨兵立刻退出，绝不覆盖人工编辑。
  // 同样要限定来源在正文内部：标题框、页面其它输入框的 input 会冒泡到 body。
  let userEdited = false;
  const onUserInput = (event) => {
    const node = resolve();
    const source = event?.target;
    if (!source || !node) { userEdited = true; return; }
    if (source === node || node.contains(source)) userEdited = true;
  };
  const watchedEvents = ['input', 'keydown', 'paste', 'drop', 'beforeinput'];
  const stopWatching = (nextState) => {
    state.state = nextState;
    for (const type of watchedEvents) body.removeEventListener(type, onUserInput, true);
    if (globalThis.__draftHelperYidianWatchdogStop === handleStop) delete globalThis.__draftHelperYidianWatchdogStop;
  };
  const handleStop = (reason) => stopWatching(reason || 'stopped');
  globalThis.__draftHelperYidianWatchdogStop = handleStop;
  for (const type of watchedEvents) body.addEventListener(type, onUserInput, true);
  const repair = () => {
    const component = componentOf();
    const node = resolve();
    try {
      if (node) node.innerHTML = content;
      if (component?.editor && typeof component.editor.setContent === 'function') component.editor.setContent(content);
      if (typeof component?.removeBlankRow === 'function') component.removeBlankRow();
      const sync = component?.$vnode?.data?.model?.callback || component?.$listeners?.input;
      if (typeof sync === 'function') sync.call(component, (node || body).innerHTML);
      return matches() || !looksReverted();
    } catch (error) { state.repairError = String(error?.message || error); return false; }
  };
  const step = () => {
    if (userEdited) return stopWatching('user-edited');
    if (!resolve()) return stopWatching('detached');
    if (Date.now() - state.startedAt > opts.durationMs) return stopWatching('expired');
    state.checks++;
    if (!matches()) {
      if (!looksReverted()) return stopWatching('differs');
      const current = snapshot();
      const revert = { check: state.checks, atMs: Date.now() - state.startedAt,
        textLength: current.text.length, imageCount: current.images.length,
        blockedWrites: guard.blocked?.length || 0,
        contentBlocks: guard.contentBlocks?.length || 0 };
      if (state.repairs === 0) { revert.repaired = repair(); if (revert.repaired) state.repairs = 1; }
      state.reverts.push(revert);
      if (!revert.repaired && state.reverts.length >= 2) return stopWatching('reverted');
    }
    setTimeout(step, opts.intervalMs);
  };
  setTimeout(step, opts.intervalMs);
  return { state: 'watching', durationMs: opts.durationMs, intervalMs: opts.intervalMs };
}

/* 平台在写入后一两秒内用旧快照重渲染时，按与正式写入相同的顺序修一次。
 * 与哨兵的区别：这是同步执行、用于「回读失败」的现场自救，成功即可继续填标题/收尾。 */
async function repairYidianBody(content) {
  const visible = (el) => !!el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  const bodies = [...document.querySelectorAll('.editor-content.medium-editor-element[contenteditable="true"]')].filter(visible);
  const body = bodies.length === 1 ? bodies[0] : null;
  if (!body) return false;
  const strip = (html) => String(html).replace(/<[^>]*>/g, '').replace(/\s+/g, '');
  const articleText = el => {const copy=el.cloneNode(true);copy.querySelectorAll('.operation-wrapper,.image-caption-wrap,component-cursor').forEach(node=>node.remove());return copy.textContent.replace(/[\s\u200b-\u200f\u2060\ufeff]/g, '');};
  const temp=document.createElement('div');temp.innerHTML=content;
  const expectedText = articleText(temp);
  const expected = document.createElement('div');
  expected.innerHTML = content;
  const same = () => {
    const images = [...body.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    const wanted = [...expected.querySelectorAll('img')].map((img) => img.getAttribute('src'));
    return articleText(body) === expectedText
      && JSON.stringify(images) === JSON.stringify(wanted);
  };
  if (same()) return true;
  let component = null;
  let node = body;
  while (node) {
    const vm = node.__vue__;
    const name = vm?.$options?.name || vm?.$options?._componentTag;
    if (name === 'editor-content' && typeof vm.replaceContent === 'function') { component = vm; break; }
    node = node.parentElement;
  }
  try {
    body.innerHTML = content;
    if (component?.editor && typeof component.editor.setContent === 'function') component.editor.setContent(content);
    if (typeof component?.removeBlankRow === 'function') component.removeBlankRow();
    const sync = component?.$vnode?.data?.model?.callback || component?.$listeners?.input;
    if (typeof sync === 'function') sync.call(component, body.innerHTML);
  } catch (error) {
    return false;
  }
  return same();
}

async function verifyYidianImageContent(tabId, files, onProgress) {
  const images = await evaluate(tabId,'[...document.querySelector(".editor-content.medium-editor-element[contenteditable=true]").querySelectorAll("img")].map(i=>({url:i.src,width:i.naturalWidth,height:i.naturalHeight,loaded:i.complete}))');
  if(images.length!==files.length)throw Error('一点号图片内容核验数量不一致。');
  const frame=await chrome.debugger.sendCommand({tabId},'Page.getFrameTree'),results=[];
  const digest=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  for(const [index,item]of files.entries()){
    const source=new Uint8Array(await item.file.arrayBuffer()),sourceType=sniffImageMime(source),size=DraftDistribution.imageDimensions(source),image=images[index];
    if(!image.loaded||!image.width||!image.height)throw Error('一点号图片尚未加载完成：'+item.name);
    const {resource}=await chrome.debugger.sendCommand({tabId},'Network.loadNetworkResource',{frameId:frame.frameTree.frame.id,url:image.url,options:{disableCache:false,includeCredentials:false}});
    if(!resource?.success||!resource.stream)throw Error('一点号图片无法回读：'+item.name);
    const chunks=[];let length=0;
    try{while(true){const r=await chrome.debugger.sendCommand({tabId},'IO.read',{handle:resource.stream,size:1024*1024}),bytes=r.base64Encoded?Uint8Array.from(atob(r.data),c=>c.charCodeAt(0)):new TextEncoder().encode(r.data);length+=bytes.length;if(length>30*1024*1024)throw Error('一点号图片回读超过30MB。');chunks.push(bytes);if(r.eof)break;}}
    finally{await chrome.debugger.sendCommand({tabId},'IO.close',{handle:resource.stream});}
    const data=new Uint8Array(length);let at=0;for(const b of chunks){data.set(b,at);at+=b.length;}
    const targetType=sniffImageMime(data),targetSize=DraftDistribution.imageDimensions(data),sameBytes=await digest(source)===await digest(data);
    if(!targetSize||size&&(size.width!==targetSize.width||size.height!==targetSize.height))throw Error('一点号图片尺寸发生未记录的变化：'+item.name);
    if(sourceType==='image/gif'){
      if(targetType!=='image/gif'||JSON.stringify(DraftDistribution.gifTimeline(source))!==JSON.stringify(DraftDistribution.gifTimeline(data)))throw Error('一点号 GIF 帧数、尺寸、时序或循环发生变化：'+item.name);
    }
    const converted=sourceType==='image/webp'&&targetType==='image/png';
    const reencoded=sourceType==='image/jpeg'&&targetType==='image/jpeg'&&!sameBytes;
    if(!sameBytes&&!converted&&!reencoded)throw Error('一点号图片内容发生未记录的变化：'+item.name);
    const detail='图片内容回读：'+item.name+'，'+targetSize.width+'×'+targetSize.height+'，'+source.length+'B → '+data.length+'B；'
      +(sameBytes?'与上传文件逐字节一致。':converted?'WebP 使用全尺寸 PNG 上传副本，原素材随包保留。':'一点号重新编码了 JPEG，文件及像素细节可能改变；尺寸和位置保持，原文件随包保留，请目视核对。');
    onProgress(detail);results.push({file:item.name,width:targetSize.width,height:targetSize.height,sourceBytes:source.length,targetBytes:data.length,sameBytes,converted,reencoded});
  }
  return results;
}

async function fillYidianDraft(tabId, bundle, onProgress = status) {
  const { html, manifest, assets } = bundle;
  const uploadAssets = new Map(assets); // Never overwrite a proof-bound source file with an upload copy.
  for(const copy of manifest.uploadCopies||[]){
    const file=assets.get('assets/'+copy.bundleFile);
    if(!file||file.size!==copy.bytes)throw Error('一点号上传副本缺失或大小不一致。');
    uploadAssets.set('assets/'+copy.sourceFile,file);
    onProgress('采用已校验的 GIF 上传副本 '+copy.bundleFile+'：'+copy.sourceWidth+'×'+copy.sourceHeight+' → '+copy.width+'×'+copy.height
      +'；'+copy.frames+' 帧和 '+copy.durationMs+'ms 时序不变，原 GIF 随包保留。');
  }
  if (manifest.targetPlatform !== 'yidian') throw new Error('请选择一点资讯专用准备包。');
  if ([...manifest.title].length < 5 || [...manifest.title].length > 64) throw new Error('一点号标题需为 5–64 个字，请调整已审定的标题候选。');
  // 一点号图片接口单张上限 6MB。静图超限就地压缩（不写回准备包，只压上传副本）；
  // GIF 动图无法在浏览器内减帧，直接拦下并说清原因，绝不静默改成静图。
  const profile = typeof DraftDistribution !== 'undefined' ? DraftDistribution.profileFor('yidian') : null;
  const limit = profile?.upload?.maxBytes;
  const oversize = profile && typeof DraftDistribution.oversizeFor === 'function'
    ? DraftDistribution.oversizeFor(profile, manifest) : [];
  if (oversize.length) {
    const mb = (bytes) => (bytes / 1048576).toFixed(1) + 'MB';
    const policy = globalThis.DraftShrinkPolicy || {mode: 'auto'};
    const blocked = [];
    const notes = [];
    for (const item of oversize) {
      const key = 'assets/' + item.bundleFile;
      const file = uploadAssets.get(key);
      const decision = limit && typeof DraftImageShrink !== 'undefined'
        && typeof file?.size === 'number'
        ? DraftImageShrink.plan(file.size, file.type || file.name, limit)
        : {action: 'block', reason: '未加载压缩模块'};
      if (policy.mode !== 'auto' || decision.action !== 'shrink') {
        blocked.push(item.bundleFile + '（' + mb(item.bytes) + '）'
          + (decision.reason ? '：' + decision.reason : ''));
        continue;
      }
      onProgress('压缩超限图片：' + item.bundleFile);
      const fitted = await DraftImageShrink.fitOrExplain(file, limit);
      if (fitted.changed) { uploadAssets.set(key, fitted.file); notes.push(item.bundleFile + '：' + fitted.note + '；原文件仍随准备包保留'); }
    }
    if (blocked.length) {
      throw new Error('一点号单张图片上限 ' + mb(limit) + '，以下图片超出且未压缩：'
        + blocked.join('、')
        + '。本次尚未上传任何图片、也未写入正文；请在工作台替换或压缩这些图片后重试，不要直接重复填入。');
    }
    if (notes.length) onProgress('已压缩到上限内：' + notes.join('；'));
  }
  await attachDebugger(tabId);
  try {
    await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
    const current = await readYidianState(tabId);
    if (current.html.replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, '').trim() || /<(?:img|video|iframe|audio)\b/i.test(current.html)) {
      throw new Error('一点号正文已有内容，请新开空白编辑页后填入。');
    }
    if (current.title.trim() && current.title.trim() !== manifest.title) throw new Error('一点号已有其他标题，请新开空白编辑页。');
    onProgress('转换一点号可保存的文字颜色、字号和首行缩进…');
    const adapted = manifest.distribution?.formatPolicy === 'yidian-readable-v1';
    const format = adapted ? {html,warnings:[],note:'准备包已按一点号兼容格式转换，逐处变化见分发处理日志'}
      : await evaluate(tabId, '(' + yidianFormat.toString() + ')(' + JSON.stringify(html) + ')');
    let content = format.html;
    if (format.warnings.length) onProgress(format.warnings.join('；'));
    // 微信稿里常夹带 1×1 的占位/间隔图（实测有 70 字节的假 gif，真实是 PNG）。
    // 平台对它不会返回有效地址，也不该出现在正文里：直接丢掉这个 <img>，不上传。
    const dropPlaceholderTag = (text, placeholder) => {
      const escaped = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return text.replace(new RegExp('<img\\b[^>]*' + escaped + '[^>]*>', 'gi'), '');
    };
    const skipped = [];
    const total = manifest.contentImages.length;
    // 一点号用户守则：单篇正文图片上限 80 张。超了平台也不收，提前说明。
    if (total > YIDIAN_MAX_IMAGES)
      throw new Error('一点号单篇正文最多 ' + YIDIAN_MAX_IMAGES + ' 张图片，这篇有 ' + total
        + ' 张。请先拆成两篇再填入，避免传到一半被平台拒绝。');
    if (total > 1)
      onProgress('共 ' + total + ' 张图片，将逐张上传；请保持弹窗打开，中途关闭会中断本次填入。');
    let uploaded = 0, reused = 0;
    for (const [index, item] of manifest.contentImages.entries()) {
      const file = uploadAssets.get('assets/' + item.bundleFile);
      if (!file || !content.includes(item.placeholder)) throw new Error('准备包图片或图片位置缺失。');
      const bytes = typeof file.size === 'number' ? file.size : null;
      const data = file.arrayBuffer && bytes <= 1024 * 1024 ? new Uint8Array(await file.arrayBuffer()) : null;
      const spacer = data && typeof DraftDistribution !== 'undefined' && DraftDistribution.isSpacerImage(data);
      if (spacer) {
        content = dropPlaceholderTag(content, item.placeholder);
        skipped.push(item.bundleFile + '（' + bytes + 'B 占位图）');
        onProgress('跳过占位图：' + item.bundleFile + '（' + bytes + 'B）');
        continue;
      }
      const copy=manifest.uploadCopies?.find(copy=>copy.sourceFile===item.bundleFile);
      const key = yidianUploadKey(copy||item);
      const cached = key && typeof DraftUploadCache !== 'undefined'
        ? await DraftUploadCache.get(key) : null;
      if (cached) {
        reused += 1;
        content = content.replaceAll(item.placeholder, cached.replaceAll('&', '&amp;').replaceAll('"', '&quot;'));
        onProgress('复用已上传图片 ' + (index + 1) + '/' + total + '：' + item.bundleFile);
        continue;
      }
      onProgress('通过一点号图片接口上传：' + item.bundleFile
        + '（' + (uploaded + reused + 1) + '/' + total + '）');
      let url;
      try {
        const result = await uploadImageToYidian(tabId, file, {cacheKey: key,details:true});
        url = result.url;
        if(result.converted)onProgress('上传副本转换：' + item.bundleFile + ' 从 ' + result.sourceType + '（' + result.sourceBytes
          + 'B）转换为全尺寸 ' + result.uploadType + '（' + result.uploadBytes + 'B）；原素材随包保留。');
        else onProgress('原格式上传：' + item.bundleFile + '，' + result.uploadType + '，' + result.uploadBytes + 'B。');
      } catch (error) {
        throw new Error(yidianUploadMessage(error, {done: uploaded + reused, total, file: item.bundleFile}));
      }
      uploaded += 1;
      content = content.replaceAll(item.placeholder, url.replaceAll('&', '&amp;').replaceAll('"', '&quot;'));
      // 逐张上传之间留一点间隔，降低触发账号级频率限制的概率。
      if (index + 1 < total) await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (reused) onProgress('本次复用已上传图片 ' + reused + ' 张，未重复占用额度。');
    if (skipped.length) onProgress('已跳过占位图：' + skipped.join('、'));
    // Only call the native cleaner after placeholders are replaced by platform image URLs.
    const expectedFormat = content;
    content = await evaluate(tabId, '(' + yidianFormat.toString() + ')(' + JSON.stringify(content) + ',"canonicalize")');
    onProgress('填写一点号正文和标题…');
    const writeTrace = await evaluate(tabId, '(' + writeYidianBody.toString() + ')(' + JSON.stringify(content) + ')');
    await fillField(tabId, 'input.post-title', manifest.title);
    await pause(500);
    try {
      await evaluate(tabId, '(' + verifyYidianBody.toString() + ')(' + JSON.stringify(content) + ',' + JSON.stringify(writeTrace) + ')');
    } catch (error) {
      // 平台可能在写入后一两秒内用旧快照重渲染。先按同样的写入顺序修一次再判定失败，
      // 不要因为一次拍到的旧状态就丢掉整篇稿子。
      onProgress('回读发现正文被平台改回旧内容，尝试修复一次…');
      const repaired = await evaluate(tabId, '(' + repairYidianBody.toString() + ')(' + JSON.stringify(content) + ')');
      if (repaired !== true) throw error;
      await pause(800);
      await evaluate(tabId, '(' + verifyYidianBody.toString() + ')(' + JSON.stringify(content) + ',' + JSON.stringify(writeTrace) + ')');
      onProgress('已修复被平台改回的正文一次，继续核对标题与图片…');
    }
    if (await readField(tabId, 'input.post-title') !== manifest.title) throw new Error('一点号标题回读不一致。');
    const formatCheck = await evaluate(tabId, '(' + yidianFormat.toString() + ')(' + JSON.stringify(expectedFormat) + ',"verify")');
    const imageCheck = adapted ? await verifyYidianImageContent(tabId,manifest.contentImages.map(item=>({name:item.bundleFile,file:uploadAssets.get('assets/'+item.bundleFile)})),onProgress) : null;
    // 平台的草稿自动保存会在一分钟级别之后把编辑器按旧模型回写（历史上表现为“只剩第一张图”）。
    // 5 秒稳定窗口看不出来，所以在页面里留一个哨兵持续核对，首次回退时自动修复一次并留下证据。
    const watchdog = await evaluate(tabId, '(' + watchYidianBody.toString() + ')('
      + JSON.stringify(content) + ',' + JSON.stringify({ durationMs: 180000, intervalMs: 3000 }) + ')');
    const watchNote = watchdog?.state === 'watching'
      ? '；已在页面内开启 ' + Math.round(watchdog.durationMs / 1000) + ' 秒回读哨兵（每 '
        + Math.round(watchdog.intervalMs / 1000) + ' 秒核对一次，平台若延迟回写会自动修复一次并记录）'
      : '';
    onProgress('一点号标题、正文、图片、文字颜色和首行缩进已填入并回读核对' + watchNote
      + '。' + format.note + '。' + (format.warnings.length ? format.warnings.join('；') + '。' : '')
      + '请检查封面、内容声明及 GIF，再按平台操作保存草稿；保存后重新打开核对。');
    return { format: { indentCount: format.indentCount, fontMappings: format.fontMappings,
      contrastFallbacks: format.contrastFallbacks, warnings: format.warnings }, verification: formatCheck,images:imageCheck };
  } finally {
    await chrome.debugger.detach({ tabId }).catch(() => {});
  }
}
