'use strict';

// A static import pipeline. The measurement frame never runs scripts or loads network resources.
const DraftImport = (() => {
  const properties = [
    'font-family','font-size','font-weight','font-style','font-variant','color','background-color',
    'background-image','background-size','background-repeat','background-position','background-clip',
    'line-height','letter-spacing','text-align','text-indent','text-decoration','text-transform',
    'white-space','word-break','overflow-wrap','vertical-align','box-sizing',
    'margin-top','margin-bottom','margin-left','margin-right','padding-top','padding-bottom','padding-left','padding-right',
    'border-top','border-bottom','border-left','border-right','border-radius','box-shadow',
    'display','float','clear','overflow','overflow-x','overflow-y','max-width','min-width','min-height','max-height',
    'position','top','left','right','bottom','z-index','transform','transform-origin','opacity','visibility',
    'flex-direction','flex-wrap','flex-grow','flex-shrink','flex-basis','justify-content','align-items','align-self',
    'align-content','gap','row-gap','column-gap','grid-template-columns','grid-template-rows','grid-column','grid-row',
    'list-style-type','list-style-position','border-collapse','border-spacing','table-layout','object-fit','object-position',
  ];
  const active = 'script,iframe,object,embed,form,input,button,textarea,select,video,audio,canvas,foreignObject,animate,animateMotion,animateTransform,set,mp-miniprogram,mp-common-videosnap';
  function preferredImageSource(img) {
    const src=img.getAttribute('src')||'', lazy=img.getAttribute('data-src')||'';
    // WeChat uses tiny SVG placeholders until the real lazy image is loaded.
    if (lazy && (!src || /^data:image\/svg\+xml/i.test(src) || /(?:^|\/)spacer\.(?:gif|png)/i.test(src))) return lazy;
    return src || lazy;
  }
  function safeUrl(value, image=false) {
    const clean=value.trim();
    if (/^(?:javascript|vbscript|file):/i.test(clean)) return false;
    if (/^data:/i.test(clean)) return image ? /^data:image\/(?:png|jpeg|gif|webp|bmp|svg\+xml)[;,]/i.test(clean) : false;
    return /^(?:https?:|blob:|#|\/|\.|[^:]+$)/i.test(clean);
  }
  function cleanCss(style) {
    for (const prop of [...style]) {
      const value=style.getPropertyValue(prop);
      if (/expression\(|javascript:|vbscript:|-moz-binding|behavior\s*:/i.test(value) || ['behavior','-moz-binding'].includes(prop)) style.removeProperty(prop);
      else if (/url\(/i.test(value)) {
        const safe=[...value.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].every(match=>safeUrl(match[1],true));
        if(!safe) style.removeProperty(prop);
      }
    }
  }
  function sanitize(doc, target, warnings) {
    if(target.querySelector(active)) warnings.push('原稿中的脚本或交互组件已移除；视频、小程序等需在微信中补充。');
    doc.querySelectorAll(active+',base,meta[http-equiv],link:not([rel="stylesheet"])').forEach(el=>el.remove());
    for(const el of doc.querySelectorAll('*')) {
      for(const attr of [...el.attributes]) {
        if(/^on/i.test(attr.name) || ['srcdoc','contenteditable','action','formaction','autofocus','srcset','ping'].includes(attr.name)||attr.name.startsWith('data-dh-'))el.removeAttribute(attr.name);
        if(['href','xlink:href'].includes(attr.name)&&el.tagName.toLowerCase()!=='link'&&!safeUrl(attr.value,el.closest('svg')!==null))el.removeAttribute(attr.name);
      }
      if(el.tagName==='IMG') {
        let src=preferredImageSource(el);if(src.startsWith('//'))src='https:'+src;
        el.setAttribute('src',src);el.removeAttribute('data-src');el.removeAttribute('loading');
        el.classList.remove('js_img_placeholder','wx_img_placeholder');
      }
      if(el.hasAttribute('style'))cleanCss(el.style);
    }
    for(const svg of doc.querySelectorAll('svg')) {
      for(const node of svg.querySelectorAll('image,use,a')) {
        for(const attr of ['href','xlink:href'])if(node.hasAttribute(attr)&&!node.getAttribute(attr).startsWith('#')&&!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(node.getAttribute(attr)))node.removeAttribute(attr);
      }
    }
    for(const style of doc.querySelectorAll('style')) {
      style.textContent=style.textContent.replace(/@import\s+(?:url\([^)]*\)|["'][^"']*["'])[^;]*;/gi,'')
        .replace(/expression\([^)]*\)/gi,'none');
    }
  }

  async function normalize(raw, options={}) {
    const doc=DraftCore.parse(raw), warnings=[];
    const article=doc.querySelector('#js_content');
    const title=(article?doc.querySelector('#activity-name')?.textContent:doc.title||doc.querySelector('h1')?.textContent)||'';
    const author=article?doc.querySelector('#js_name')?.textContent.trim()||'':'';
    const target=article||doc.body;
    if(article) {
      // Keep the ancestor spine while measuring, so inherited WeChat styles stay effective.
      let child=article;
      while(child.parentElement&&child.parentElement!==doc.documentElement) {
        const parent=child.parentElement;
        for(const sibling of [...parent.childNodes])if(sibling!==child&&sibling.nodeName!=='STYLE')sibling.remove();
        child=parent;if(parent===doc.body)break;
      }
      warnings.push('已识别微信文章：只提取正文，作者、阅读区、评论和网页按钮不进入正文。');
    }
    const missingStyles=doc.querySelectorAll('link[rel="stylesheet"]').length;
    if(missingStyles) warnings.push('部分外部样式表未提供；选择原 HTML 的配套文件夹可补齐。');
    doc.querySelectorAll('link').forEach(el=>el.remove());
    sanitize(doc,target,warnings);
    if(!target.isConnected)throw Error('没有找到可导入的正文。');
    // Measure images without triggering remote/local reads. Restore the original references afterwards.
    const imageSources=new Map();let imageIndex=0;
    for(const img of target.querySelectorAll('img')) {
      const key=String(++imageIndex);img.setAttribute('data-measure-image',key);
      const src=img.getAttribute('src')||'';imageSources.set(key,src);
      if(!DraftCore.imageData.test(src))img.removeAttribute('src');
    }
    const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-same-origin');
    const width=Math.min(1000,Math.max(280,Number(options.width)||390));
    frame.style.cssText=`position:fixed;left:-10000px;width:${width}px;height:800px;visibility:hidden;border:0`;
    document.body.append(frame);
    try {
      await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('原稿排版分析超时，请缩小文件后重试。')),15000);
        frame.onload=()=>{clearTimeout(timer);resolve();};
        frame.srcdoc='<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:; font-src \'none\'">'+doc.documentElement.outerHTML;
      });
      const rendered=frame.contentDocument;
      const source=article?rendered.querySelector('#js_content'):rendered.body;
      // Source page context is retained for cascading, but the article canvas has the chosen width.
      source.style.setProperty('width',width+'px');source.style.setProperty('max-width','none');
      if(article){source.style.setProperty('visibility','visible');source.style.setProperty('opacity','1');}
      await Promise.all([...source.querySelectorAll('img[src^="data:"]')].map(img=>img.decode().catch(()=>{})));
      const elements=[source,...source.querySelectorAll('*')].filter(el=>el.tagName!=='STYLE');
      const snapshots=elements.map(el=>{
        const computed=frame.contentWindow.getComputedStyle(el);
        return {el,values:properties.map(prop=>[prop,computed.getPropertyValue(prop)]),pseudo:['::before','::after'].some(p=>{const c=frame.contentWindow.getComputedStyle(el,p).content;return c&&c!=='none'&&c!=='normal'&&c!=='""';})};
      });
      // Read first, write later: inlining a parent's font size must not change child em measurements.
      for(const {el,values,pseudo} of snapshots) {
        if(pseudo&&!warnings.includes('原稿包含伪元素装饰，请检查此类装饰是否完整。'))warnings.push('原稿包含伪元素装饰，请检查此类装饰是否完整。');
        for(const [prop,value] of values) {
          if (!value || /expression\(|javascript:/i.test(value))continue;
          // Keep original relative declarations and priorities; fill only stylesheet/inherited properties.
          if(!el.style.getPropertyValue(prop)||/var\(/.test(el.style.getPropertyValue(prop)))el.style.setProperty(prop,value);
        }
        cleanCss(el.style);
      }
      let output;
      if(article) {output=source.cloneNode(true);output.removeAttribute('id');output.removeAttribute('class');}
      else {output=rendered.createElement('section');output.setAttribute('style',source.getAttribute('style')||'');output.append(...[...source.childNodes].map(node=>node.cloneNode(true)));}
      output.style.removeProperty('width');output.style.maxWidth='100%';
      if(!article){output.style.margin='0px';}
      output.querySelectorAll('style,link,meta').forEach(el=>el.remove());
      for(const img of output.querySelectorAll('img[data-measure-image]')) {
        img.setAttribute('src',imageSources.get(img.getAttribute('data-measure-image'))||'');img.removeAttribute('data-measure-image');
      }
      const checked=new Map();
      for(const img of output.querySelectorAll('img')) {
        const src=img.getAttribute('src')||'';
        if(src.startsWith('data:')){
          if(!checked.has(src)){try{await DraftCore.fileToData(DraftCore.dataToFile(src,'embedded'));checked.set(src,true);}catch{checked.set(src,false);}}
          if(!checked.get(src)){img.removeAttribute('src');img.alt='原内嵌图片无法解码，请补图';warnings.push('有内嵌图片损坏或格式不支持，请补齐。');}
        }
      }
      let seq=0;for(const el of [output,...output.querySelectorAll('*')])el.setAttribute('data-dh-id',String(++seq));
      const text=output.textContent.replace(/\s+/g,'');
      return {html:output.outerHTML,warnings:[...new Set(warnings)],title:title.trim(),author,fidelity:true,
        importReport:{source:article?'wechat-article':'html',textCharacters:[...text].length,images:output.querySelectorAll('img').length,svg:output.querySelectorAll('svg').length,referenceWidth:width}};
    }finally{frame.remove();}
  }
  return {normalize,preferredImageSource,properties};
})();
