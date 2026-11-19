/* Own render page only. Article markup lives in a scriptless, networkless sandbox. */
'use strict';
globalThis.DraftLayoutPage=(()=>{
  let frame;
  const visible=el=>{const r=el.getBoundingClientRect(),s=el.ownerDocument.defaultView.getComputedStyle(el);return r.width>1&&r.height>1&&s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0';};
  function clipFor(elements){
    const boxes=[];
    for(const el of elements)for(const n of [el,...el.querySelectorAll('*')]){
      if(!visible(n))continue;
      const style=n.ownerDocument.defaultView.getComputedStyle(n);
      const painted=['IMG','svg','SVG'].includes(n.tagName)||style.backgroundImage!=='none'
        ||! /^(?:rgba\([^)]*,\s*0\)|transparent)$/.test(style.backgroundColor)
        ||[style.borderTopWidth,style.borderRightWidth,style.borderBottomWidth,style.borderLeftWidth].some(v=>parseFloat(v)>0)
        ||style.boxShadow!=='none';
      const hasText=[...n.childNodes].some(c=>c.nodeType===3&&c.textContent.trim());
      // A flex container can be much wider than its content. Its unpainted box
      // must not turn into a large white gutter in the exported picture.
      if(!painted&&!hasText&&!(n===el&&el.textContent.trim()))continue;
      // Hidden overflow clips its contents. Do not export unseen slides or crop remnants.
      let r=n.getBoundingClientRect(),left=r.left,right=r.right,top=r.top,bottom=r.bottom;
      for(let a=n.parentElement;a&&a!==el.parentElement;a=a.parentElement){
        const s=a.ownerDocument.defaultView.getComputedStyle(a),b=a.getBoundingClientRect();
        if(/hidden|clip|auto|scroll/.test(s.overflowX)){left=Math.max(left,b.left);right=Math.min(right,b.right);}
        if(/hidden|clip|auto|scroll/.test(s.overflowY)){top=Math.max(top,b.top);bottom=Math.min(bottom,b.bottom);}
      }
      if(right>left&&bottom>top)boxes.push({left,right,top,bottom});
    }
    if(!boxes.length)throw Error('特殊排版区块没有可见内容。');
    const x=Math.floor(Math.min(...boxes.map(b=>b.left))),y=Math.floor(Math.min(...boxes.map(b=>b.top)));
    return {x,y,width:Math.ceil(Math.max(...boxes.map(b=>b.right)))-x,height:Math.ceil(Math.max(...boxes.map(b=>b.bottom)))-y};
  }
  async function load(input){
    if(frame)frame.remove();
    const annotated=DraftLayout.instrument(input.html),nodes=new Map(annotated.tree.nodes.map(n=>[n.id,n]));
    const doc=new DOMParser().parseFromString(annotated.html,'text/html');
    if(doc.querySelector('script,iframe,object,embed,form,video,audio,canvas,foreignObject,animate,animateTransform,animateMotion'))
      throw Error('原稿含交互、音视频或动画组件，无法安全整块转图，请先替换为静态图文。');
    doc.querySelectorAll('link,meta,base').forEach(n=>n.remove());
    for(const el of doc.querySelectorAll('*')){
      for(const attr of [...el.attributes])if(/^on/i.test(attr.name)||['srcset','srcdoc','autofocus','contenteditable'].includes(attr.name))el.removeAttribute(attr.name);
      if(el.tagName==='IMG'){
        const token=el.getAttribute('src');
        if(!input.resources[token])throw Error('渲染图片未本地化：'+token);
        el.setAttribute('data-layout-token',token);el.src=input.resources[token];el.removeAttribute('loading');el.removeAttribute('data-src');
      }
      if(el.hasAttribute('style')){
        const value=el.getAttribute('style').replace(/url\(\s*["']?(WECHATIMGPH_[\w-]+)["']?\s*\)/gi,(_,token)=>{
          if(!input.resources[token])throw Error('背景图片未本地化：'+token);
          return 'url("'+input.resources[token]+'")';
        });
        el.setAttribute('style',value);
      }
    }
    if([...doc.querySelectorAll('style')].some(el=>/@import|url\(/i.test(el.textContent)))throw Error('特殊排版使用外部样式资源，请先在工作台完成样式内联。');
    frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-same-origin');
    frame.style.cssText='width:'+(input.width+256)+'px;height:1000px';document.body.append(frame);
    const loaded=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('特殊排版渲染超时。')),15000);frame.onload=()=>{clearTimeout(timer);resolve();};});
    frame.srcdoc='<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\';img-src data:;style-src \'unsafe-inline\';font-src \'none\';">'
      +'<style>html{margin:0;background:#fff}body{box-sizing:content-box;margin:0;padding:64px 128px;width:'+input.width+'px;font-family:system-ui;font-size:15px;line-height:1.75;overflow:visible}img{max-width:100%;height:auto}</style>'
      +[...doc.querySelectorAll('style')].map(n=>n.outerHTML).join('')+'</head><body>'+doc.body.innerHTML+'</body></html>';
    await loaded;
    const body=frame.contentDocument.body,view=frame.contentWindow;
    await Promise.all([...body.querySelectorAll('img')].map(async im=>{await im.decode();if(!im.naturalWidth)throw Error('特殊排版图片未加载。');}));
    await frame.contentDocument.fonts.ready;
    const bgUrls=[...body.querySelectorAll('[style]')].flatMap(el=>[...el.style.backgroundImage.matchAll(/url\(["']?(data:[^"')]+)["']?\)/g)].map(m=>m[1]));
    await Promise.all([...new Set(bgUrls)].map(src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=resolve;im.onerror=()=>reject(Error('背景图解码失败。'));im.src=src;})));
    // A scrolling strip cannot be faithfully represented by a screenshot of its
    // first viewport. Expand all static slides, in source order, before capture.
    const scrollers=[...body.querySelectorAll('['+DraftLayout.ATTRIBUTE+']')].filter(el=>{
      const s=view.getComputedStyle(el);
      return /auto|scroll/.test(s.overflowX)&&el.scrollWidth>el.clientWidth+16
        &&el.querySelectorAll('img').length>1&&!el.textContent.trim();
    });
    for(const el of scrollers.filter(el=>!scrollers.some(parent=>parent!==el&&parent.contains(el)))){
      const images=[...el.querySelectorAll('img')].map(im=>{
        const clone=im.cloneNode(false);clone.removeAttribute(DraftLayout.ATTRIBUTE);
        clone.style.cssText='display:block;width:100%;max-width:100%;height:auto;margin:0 0 12px;padding:0;';
        const originalLink=im.closest('a[href]');
        if(originalLink&&el.contains(originalLink)){
          const link=body.ownerDocument.createElement('a');link.href=originalLink.getAttribute('href');link.append(clone);return link;
        }
        return clone;
      });
      el.replaceChildren(...images);el.setAttribute('data-layout-carousel','true');
      el.style.cssText='display:block;width:100%;max-width:100%;overflow:visible;margin:0;padding:0;';
    }
    frame.style.height=Math.ceil(body.scrollHeight+128)+'px';
    await new Promise(resolve=>view.requestAnimationFrame(()=>view.requestAnimationFrame(resolve)));
    const elements=[...body.querySelectorAll('['+DraftLayout.ATTRIBUTE+']')],candidates=[];
    const meaningfulImages=el=>[...(el.tagName==='IMG'?[el]:[]),...el.querySelectorAll('img')].filter(im=>visible(im)&&im.getBoundingClientRect().width>32&&im.naturalWidth>1&&im.naturalHeight>1);
    const content=el=>el.textContent.trim()||meaningfulImages(el).length
      ||el.querySelector('svg path,svg rect,svg circle,svg polygon,svg text,svg image')
      ||el.tagName.toLowerCase()==='svg'&&el.querySelector('path,rect,circle,polygon,text,image');
    for(const el of elements){
      if(!visible(el)||!content(el)&&el.tagName.toLowerCase()!=='svg')continue;
      const s=view.getComputedStyle(el),reasons=[];
      if(el.hasAttribute('data-layout-carousel'))reasons.push('carousel');
      const children=[...el.children].filter(c=>visible(c)&&content(c));
      const boxes=children.map(c=>c.getBoundingClientRect());
      const horizontal=boxes.some((a,i)=>boxes.some((b,j)=>j>i&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+8&&Math.abs(a.left-b.left)>16));
      const semantic=['sohu','toutiao','yidian'].includes(input.platform);
      if(horizontal&&(!semantic||meaningfulImages(el).length>0)&&(/flex|grid/.test(s.display)||children.some(c=>/left|right/.test(view.getComputedStyle(c).float))||children.some(c=>view.getComputedStyle(c).display==='inline-block')))reasons.push('columns');
      if(el.tagName==='TABLE'&&el.querySelectorAll('td,th').length>1&&(input.platform!=='toutiao'||el.querySelector('img,svg,table table')))reasons.push('table');
      if(el.tagName.toLowerCase()==='svg'&&el.querySelector('path,rect,circle,ellipse,polygon,polyline,text,image,line,use'))reasons.push('svg');
      if(!semantic&&s.backgroundImage!=='none'&&el.textContent.trim())reasons.push('background-text');
      const colored=!/^(?:rgba\([^)]*,\s*0\)|transparent)$/.test(s.backgroundColor);
      const framed=parseFloat(s.borderRadius)>0||s.boxShadow!=='none';
      const channels=s.backgroundColor.match(/[\d.]+/g)?.map(Number)||[];
      const coloredPanel=colored&&channels.slice(0,3).some(n=>n<245)&&[s.paddingLeft,s.paddingRight,s.paddingTop,s.paddingBottom].some(v=>parseFloat(v)>=6);
      if(!semantic&&(framed&&(meaningfulImages(el).length||colored&&el.textContent.trim())||coloredPanel&&el.textContent.trim()))reasons.push('card');
      // Negative-margin frames and absolute overlays require a common container.
      const compact=el.textContent.trim().length<=500&&meaningfulImages(el).length<=6;
      if(compact&&children.some(c=>{
        const cs=view.getComputedStyle(c);
        return cs.position==='absolute'||[cs.marginLeft,cs.marginRight,cs.marginTop,cs.marginBottom].some(v=>parseFloat(v)<-1)
          ||cs.transform!=='none'&&cs.transform!=='matrix(1, 0, 0, 1, 0, 0)';
      })&&meaningfulImages(el).length)reasons.push('overlay');
      if(compact&&meaningfulImages(el).some(im=>im.getBoundingClientRect().width>64)
        &&[s.marginLeft,s.marginRight,s.marginTop,s.marginBottom].some(v=>parseFloat(v)<-1))reasons.push('overlay');
      if(reasons.length)candidates.push({el,reasons,node:nodes.get(Number(el.getAttribute(DraftLayout.ATTRIBUTE)))});
    }
    // Capture each special group once, including nested decorations; never a whole article by accident.
    let selected=candidates.filter(c=>!candidates.some(a=>a!==c&&a.el.contains(c.el)));
    selected.sort((a,b)=>a.node.start-b.node.start);
    const groups=[];
    for(const c of selected){
      const prior=groups.at(-1),last=prior?.items.at(-1);
      if(last&&last.node.parent===c.node.parent&&/^\s*$/.test(input.html.slice(last.node.end,c.node.start))
        &&meaningfulImages(last.el).length&&meaningfulImages(c.el).length){prior.items.push(c);}
      else groups.push({items:[c]});
    }
    return groups.map(({items},index)=>{
      const first=items[0],last=items.at(-1),original=input.html.slice(first.node.start,last.node.end);
      const reasons=[...new Set(items.flatMap(i=>i.reasons))];
      let blocked='';
      if(input.animations.some(token=>original.includes(token)))blocked='包含 GIF／动画图片，不能静默转成静图。请先替换静图，或选择「保留原结构」。';
      if(items.some(({el})=>[el,...el.querySelectorAll('*')].some(n=>view.getComputedStyle(n).animationName!=='none')))
        blocked='包含 CSS 动画，请先替换为静态内容，或选择「保留原结构」。';
      const els=items.map(i=>i.el),clip=clipFor(els),frameBox=frame.getBoundingClientRect();
      if(clip.width<64){clip.x=128;clip.width=input.width;}
      if(clip.width>input.width+128||clip.height>4096||clip.width<16||clip.height<8)blocked='过大或尺寸异常（'+clip.width+'×'+clip.height+'px），请缩小区块后重试。';
      const links=[];
      for(const el of els)for(const a of [...(el.tagName==='A'&&el.hasAttribute('href')?[el]:[]),...el.querySelectorAll('a[href]')]){
        const href=a.getAttribute('href');if(/^https?:\/\//i.test(href)&&!links.some(l=>l.href===href&&l.text===a.textContent))links.push({href,text:a.textContent.trim()});
      }
      return {start:first.node.start,end:last.node.end,reasons,text:els.map(el=>el.textContent.trim()).filter(Boolean).join('\n'),links,
        width:clip.width,height:clip.height,blocked,clip:{...clip,x:clip.x+frameBox.x,y:clip.y+frameBox.y,scale:2}};
    });
  }
  return {load};
})();
