'use strict';

// Content and styles stay separate. Nothing from an imported document executes.
const DraftCore = (() => {
  const blocks = 'p,h1,h2,h3,h4,h5,h6,blockquote,img,li,pre,figcaption';
  const cssProperties = ['font-family','font-size','font-weight','font-style','color','background-color',
    'line-height','letter-spacing','text-align','text-indent','text-decoration','white-space','word-break',
    'overflow-wrap','margin-top','margin-bottom','margin-left','margin-right','padding-top','padding-bottom',
    'padding-left','padding-right','border-top','border-bottom','border-left','border-right','border-radius',
    'width','max-width','height','display','vertical-align','list-style-type','border-collapse'];
  const localProperties = ['font-size','line-height','margin-top','margin-bottom','text-align','text-indent','color','background-color','width','border-left','padding-left','font-weight','font-style','text-decoration','letter-spacing'];
  const clone = value => structuredClone(value);
  const parse = html => new DOMParser().parseFromString(html, 'text/html');
  const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const textOf = html => parse(html).body.textContent.replace(/\s+/g, '').trim();
  const hash = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2,'0')).join('');
  const hashText = text => hash(new TextEncoder().encode(text));
  const imageData = /^data:image\/(png|jpeg|gif|webp|bmp);base64,/i;
  const imageFile = /\.(png|jpe?g|gif|webp|bmp)$/i;
  const cssUrls = value => [...value.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)].map(match=>({raw:match[0],src:(match[1]??match[2]??match[3]??'').trim()}));
  function collectAssets(doc) {
    const items=[];
    for(const el of doc.querySelectorAll('img,[style]')) {
      if(el.tagName==='IMG')items.push({node:el,id:el.dataset.dhId,kind:'image',src:el.getAttribute('src')||'',alt:el.getAttribute('alt')||'',key:el.dataset.dhId+':image'});
      for(const [i,url] of cssUrls(el.style.backgroundImage).entries())items.push({node:el,id:el.dataset.dhId,kind:'background',backgroundIndex:i,src:url.src,alt:'背景图片',key:el.dataset.dhId+':background:'+i});
    }
    return items.map((item,i)=>({...item,index:i+1}));
  }
  function setAssetSource(item,src) {
    if(item.kind==='image')item.node.setAttribute('src',src);
    else {let index=0;item.node.style.backgroundImage=item.node.style.backgroundImage.replace(/url\(\s*(?:"[^"]*"|'[^']*'|[^)]*)\s*\)/gi,match=>index++===item.backgroundIndex?'url("'+src.replaceAll('"','%22')+'")':match);}
  }
  const kind = node => /^H[1-6]$/.test(node.tagName) ? node.tagName.toLowerCase() : node.tagName.toLowerCase();

  function validateStyle(style) {
    const result = {};
    if (!style || typeof style !== 'object') return result;
    for (const prop of localProperties) {
      const value = style[prop];
      if (typeof value !== 'string' || value.length > 80 || /url|expression|[{}<>;]/i.test(value)) continue;
      if (CSS.supports(prop, value)) result[prop] = value;
    }
    return result;
  }

  function validateSettings(input = {}) {
    const result = {};
    for (const [key,min,max] of [['fontSize',12,32],['lineHeight',1,3],['paragraphGap',0,60],['padding',0,60]]) {
      if (input[key] !== '' && input[key] != null && Number.isFinite(Number(input[key])))
        result[key] = Math.max(min, Math.min(max, Number(input[key])));
    }
    if (/^#[\da-f]{6}$/i.test(input.theme || '')) result.theme = input.theme;
    return result;
  }

  function validateTemplate(input) {
    if (input?.version !== 1 || typeof input.name !== 'string') throw new Error('不是支持的样式模板文件。');
    const typeStyles = {};
    for (const [type, style] of Object.entries(input.typeStyles || {}))
      if (/^(p|h[1-6]|blockquote|img|li|pre|figcaption)$/.test(type)) typeStyles[type] = validateStyle(style);
    return { version:1, name:input.name.slice(0,60), settings:validateSettings(input.settings), typeStyles };
  }

  async function normalize(raw, options = {}) {
    return DraftImport.normalize(raw, options);
  }

  function render(state, clean = false) {
    const doc = parse(state.html), root = doc.createElement('section');
    root.setAttribute('data-dh-root',''); root.append(...doc.body.childNodes); doc.body.append(root);
    if (!state.fidelity) root.style.cssText='font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif;font-size:16px;line-height:1.8;color:#333;overflow-wrap:anywhere;';
    // The same fallback styles are used in preview and exported/final content.
    for (const el of (state.fidelity ? [] : root.querySelectorAll('p,img,pre'))) {
      if (el.tagName==='P') {
        if (!el.style.marginTop) el.style.marginTop='0px';
        if (!el.style.marginBottom) el.style.marginBottom='16px';
      }
      if (el.tagName==='IMG') {
        if (!el.style.maxWidth) el.style.maxWidth='100%';
        if (!el.style.height && !el.hasAttribute('height')) el.style.height='auto';
      }
      if (el.tagName==='PRE' && !el.style.whiteSpace) el.style.whiteSpace='pre-wrap';
    }
    if (state.mode === 'adjust') {
      const settings = validateSettings(state.settings);
      const apply = (el,values) => {
        const locks = (el.getAttribute('data-dh-local') || '').split(',');
        for (const [prop,value] of Object.entries(values)) if (!locks.includes(prop)) el.style.setProperty(prop,value);
      };
      if (settings.padding != null) {
        root.style.paddingLeft=settings.padding+'px';root.style.paddingRight=settings.padding+'px';
        // Replace page-level padding, rather than stacking it on an imported wrapper.
        let parent=root;
        while (parent.children.length===1 && parent.firstElementChild.matches('section,div,article,main')) {
          parent=parent.firstElementChild;parent.style.paddingLeft='0px';parent.style.paddingRight='0px';
          parent.style.marginLeft='0px';parent.style.marginRight='0px';
        }
      }
      root.style.boxSizing='border-box';
      for (const el of root.querySelectorAll('*')) {
        const values = {};
        if (!el.matches('img,hr,br,table,thead,tbody,tr')) {
          if (settings.lineHeight != null) values['line-height'] = String(settings.lineHeight);
          if (settings.fontSize != null && !el.closest('h1,h2,h3,h4,h5,h6')) values['font-size'] = settings.fontSize+'px';
        }
        if (el.matches('p,blockquote,li,pre,h1,h2,h3,h4,h5,h6') && settings.paragraphGap != null) values['margin-bottom'] = settings.paragraphGap+'px';
        if (settings.theme && el.closest('h1,h2,h3,h4,h5,h6,a,blockquote')) values.color=settings.theme;
        if (settings.theme && el.matches('blockquote')) {values['border-left']='3px solid '+settings.theme;values['padding-left']='14px';}
        apply(el, values);
        const typeStyle = validateStyle(state.typeStyles?.[kind(el)]);
        apply(el, typeStyle);
        const parentBlock = el.parentElement?.closest(blocks);
        if (parentBlock && !el.matches(blocks)) {
          const inherited = validateStyle(state.typeStyles?.[kind(parentBlock)]);
          apply(el, Object.fromEntries(Object.entries(inherited).filter(([prop])=>['font-size','line-height','color','text-align'].includes(prop))));
        }
        if (el.tagName==='IMG' && el.style.textAlign) {
          el.style.display='block';
          el.style.marginLeft=['center','right'].includes(el.style.textAlign)?'auto':'0px';
          el.style.marginRight=['center','left'].includes(el.style.textAlign)?'auto':'0px';
        }
      }
    }
    if (clean) {
      for (const el of doc.body.querySelectorAll('*')) {
        for (const attr of [...el.attributes]) if (attr.name.startsWith('data-dh-')) el.removeAttribute(attr.name);
      }
    }
    return doc.body.innerHTML;
  }

  function editBlock(state, id, properties, all = false) {
    const doc = parse(state.html), el = [...doc.querySelectorAll('[data-dh-id]')].find(el=>el.dataset.dhId===id);
    if (!el) throw new Error('请先选择一个内容块。');
    state.mode='adjust';
    const safe = validateStyle(properties);
    if (all) {state.typeStyles[kind(el)]={...state.typeStyles[kind(el)],...safe}; return;}
    const locked = new Set((el.dataset.dhLocal || '').split(',').filter(Boolean));
    let baseline; try {baseline=JSON.parse(el.dataset.dhBaseline || '{}');} catch {baseline={};}
    for (const [prop,value] of Object.entries(safe)) {
      if (!Object.hasOwn(baseline,prop)) baseline[prop]=el.style.getPropertyValue(prop);
      el.style.setProperty(prop,value); locked.add(prop);
      // Inline spans must follow the block's chosen typography, but preserve emphasis.
      if (['font-size','line-height','color','text-align','font-weight','font-style','text-decoration','letter-spacing'].includes(prop)) {
        for (const child of el.querySelectorAll('*')) {
          let prior; try {prior=JSON.parse(child.dataset.dhBaseline || '{}');} catch {prior={};}
          if (!Object.hasOwn(prior,prop)) prior[prop]=child.style.getPropertyValue(prop);
          child.dataset.dhBaseline=JSON.stringify(prior); child.style.setProperty(prop,value);
          child.dataset.dhLocal=[...new Set((child.dataset.dhLocal || '').split(',').filter(Boolean).concat(prop))].join(',');
        }
      }
    }
    el.dataset.dhBaseline=JSON.stringify(baseline); el.dataset.dhLocal=[...locked].join(','); state.html=doc.body.innerHTML;
  }

  function resetBlock(state,id) {
    const doc=parse(state.html), el=[...doc.querySelectorAll('[data-dh-id]')].find(el=>el.dataset.dhId===id);
    if (!el) return;
    for (const node of [el,...el.querySelectorAll('[data-dh-baseline]')]) {
      const baseline=JSON.parse(node.dataset.dhBaseline || '{}');
      for (const [prop,value] of Object.entries(baseline)) value ? node.style.setProperty(prop,value) : node.style.removeProperty(prop);
      delete node.dataset.dhLocal; delete node.dataset.dhBaseline;
    }
    state.html=doc.body.innerHTML;
  }

  function preflight(state) {
    const doc=parse(render(state)), errors=[], warnings=[...(state.warnings || [])];
    if (!state.meta.title.trim()) errors.push('请填写文章标题。');
    if (!doc.body.textContent.trim() && !doc.querySelector('img')) errors.push('正文为空。');
    if ([...state.meta.summary.trim()].length > 120) errors.push('摘要超过 120 字，请缩短。');
    const images=collectAssets(doc).map(({node,...item})=>item);
    const missing=images.filter(img=>!imageData.test(img.src));
    if (missing.length) errors.push(`${missing.length} 张图片尚未就绪；请下载、补图或明确移除后再填入。`);
    if (!state.cover) warnings.push('未设置封面；可以先填正文，在微信中补充。');
    else if (/^data:image\/gif;/i.test(state.cover)) errors.push('封面需要静态图片；请选择 PNG、JPEG 或其他静态图片。');
    if (doc.querySelector('a[href]')) warnings.push('正文链接能否跳转取决于微信支持范围，请在微信中检查。');
    if (doc.querySelector('[style*="flex"],[style*="grid"]')) warnings.push('复杂布局需在微信中人工核对。');
    return {errors,warnings:[...new Set(warnings)],images,characters:[...doc.body.textContent.replace(/\s+/g,'')].length};
  }

  function dataToFile(data,name) {
    if (!imageData.test(data)) throw new Error('只支持 PNG、JPEG、GIF、WebP、BMP 图片。');
    const [header,payload]=data.split(','), bytes=Uint8Array.from(atob(payload),c=>c.charCodeAt(0));
    return new File([bytes],name,{type:header.slice(5,header.indexOf(';'))});
  }
  async function fileToData(file) {
    if (file.size > 20*1024*1024) throw new Error('单张图片超过 20MB，请先压缩。');
    const header=new Uint8Array(await file.slice(0,16).arrayBuffer());
    const ascii=String.fromCharCode(...header);
    const type=header[0]===137&&ascii.slice(1,4)==='PNG'?'image/png':header[0]===255&&header[1]===216?'image/jpeg':ascii.startsWith('GIF8')?'image/gif':ascii.startsWith('RIFF')&&ascii.slice(8,12)==='WEBP'?'image/webp':ascii.startsWith('BM')?'image/bmp':file.type;
    if(type!==file.type)file=new File([file],file.name,{type});
    const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('图片读取失败'));reader.readAsDataURL(file);});
    if (!imageData.test(data)) throw new Error('不支持的图片格式，请使用 PNG、JPEG、GIF、WebP 或 BMP。');
    await new Promise((resolve,reject)=>{const image=new Image();image.onload=resolve;image.onerror=()=>reject(Error('图片无法解码，请更换文件。'));image.src=data;});
    return data;
  }

  async function bundle(state) {
    const check=preflight(state); if(check.errors.length) throw Error(check.errors.join('\n'));
    const doc=parse(render(state)), assets=new Map(), contentImages=[], seen=new Map();
    for (const asset of collectAssets(doc)) {
      const src=asset.src;
      let item=seen.get(src);
      if(!item) {
        const ext=src.match(imageData)[1].toLowerCase().replace('jpeg','jpg');
        const name=String(contentImages.length+1).padStart(3,'0')+'.'+ext;
        const file=dataToFile(src,name);
        item={placeholder:'WECHATIMGPH_'+(contentImages.length+1)+'_END',bundleFile:name,bytes:file.size,sha256:await hash(await file.arrayBuffer())};
        assets.set('assets/'+name,file);contentImages.push(item);seen.set(src,item);
      }
      setAssetSource(asset,item.placeholder);
    }
    for (const el of doc.querySelectorAll('*'))for(const attr of [...el.attributes])if(attr.name.startsWith('data-dh-'))el.removeAttribute(attr.name);
    let coverImage=null;
    if(state.cover) {
      const ext=state.cover.match(imageData)?.[1]?.replace('jpeg','jpg');
      if (ext === 'gif') throw new Error('封面请使用静态图片；正文 GIF 可以保留。');
      const file=dataToFile(state.cover,'cover.'+ext);
      coverImage={bundleFile:file.name,bytes:file.size,sha256:await hash(await file.arrayBuffer()),sourceName:'用户选择的封面'};assets.set('assets/'+file.name,file);
    }
    const summary=state.meta.summary.trim() || [...doc.body.textContent.replace(/\s+/g,' ').trim()].slice(0,100).join('') || state.meta.title.trim().slice(0,100);
    // 目标配置档：默认头条；推送位选“次条”时改用方形小图规格。规则表在 distribution-core.js。
    const profile=typeof DraftDistribution!=='undefined'
      ? DraftDistribution.profileFor('wechat',state.meta.slot==='sub'?'sub':'head') : null;
    const manifest={bundleContractVersion:1,targetPlatform:'wechat',
      ...(profile?{profile:{id:profile.id,version:1},profileSpec:DraftDistribution.profileSpecOf(profile)}:{}),
      title:state.meta.title.trim(),author:state.meta.author.trim(),summary,contentImages,coverImage};
    const manifestText=JSON.stringify(manifest), html=doc.body.innerHTML;
    const report={bundle_contract_version:1,state:'PREPARED',
      import_warnings:[...(state.warnings||[])],
      ...(profile?{profile_id:profile.id}:{}),
      remote_image_count:0,payload_sha256:await hashText(html),manifest_sha256:await hashText(manifestText)};
    return {html,manifest,manifestText,report,assets};
  }

  function compare(expected,actual) {
    const a=parse(expected),b=parse(actual), issues=[];
    const norm=doc=>doc.body.textContent.replace(/[\s\u200b\ufeff]/g,'');
    if(norm(a)!==norm(b)) issues.push('正文文字与准备稿不一致');
    const key=src=>{try {const u=new URL(src);return u.origin+u.pathname;}catch{return src;}};
    const images=doc=>[...doc.querySelectorAll('img')].map(el=>key(el.getAttribute('src')||''));
    const ai=images(a),bi=images(b);
    if(JSON.stringify(ai)!==JSON.stringify(bi)) issues.push('正文图片数量、顺序或地址不一致');
    const backgrounds=doc=>collectAssets(doc).filter(item=>item.kind==='background').map(item=>key(item.src));
    if(JSON.stringify(backgrounds(a))!==JSON.stringify(backgrounds(b)))issues.push('背景图片与准备稿不一致');
    const ab=[...a.querySelectorAll(blocks)].filter(el=>el.tagName!=='IMG'),bb=[...b.querySelectorAll(blocks)].filter(el=>el.tagName!=='IMG');
    const styleWarnings=[];
    for(const [i,el] of ab.entries()) {
      const match=bb[i];if(!match || norm({body:el})!==norm({body:match})) continue;
      if(['font-size','line-height','text-align','margin-bottom','color'].some(prop=>el.style.getPropertyValue(prop)&&el.style.getPropertyValue(prop)!==match.style.getPropertyValue(prop))) {styleWarnings.push('微信改写了部分内联样式，请检查排版。');break;}
    }
    return {ok:!issues.length,issues,styleWarnings,expectedImages:ai.length,actualImages:bi.length};
  }

  return {blocks,clone,parse,escape,textOf,normalize,render,editBlock,resetBlock,preflight,bundle,compare,fileToData,dataToFile,imageData,imageFile,validateTemplate,validateSettings,validateStyle,kind,collectAssets,setAssetSource,cssUrls};
})();
