/* Two read-only, networkless projections of one verified article. */
'use strict';
const DraftCompare=(()=>{
  const normalize=s=>String(s||'').replace(/[\s\u200b-\u200f\u2060\ufeff]/g,'');
  const urls=[];let cleanup=()=>{},latest=null;
  async function sourceFor(bundle){
    const base=bundle.matrixSourceBundle||bundle,file=base.assets.get('source-wechat.json');
    const proof=JSON.parse(base.sourceProofText||await file.text());
    let manifest=proof.sourceManifestText?JSON.parse(proof.sourceManifestText):proof.manifest||JSON.parse(proof.manifestText),html=proof.sourceHtml??proof.html;
    const header=proof.matrixE3Header;
    if(header?.canonicalHtml&&html.includes(header.canonicalHtml)&&base.assets.has('assets/'+header.bundleFile)){
      const d=new DOMParser().parseFromString(header.canonicalHtml,'text/html'),image=d.querySelector('img');
      if(image){image.setAttribute('src',header.placeholder);image.removeAttribute('data-src');html=html.replace(header.canonicalHtml,d.body.innerHTML);manifest={...manifest,contentImages:[header,...manifest.contentImages]};}
    }
    return {html,manifest,assets:base.assets};
  }
  async function preview(bundle,side){
    const source=side==='source';let html=bundle.html,missing=0;
    const files=new Map(),images=bundle.manifest.contentImages||[];
    for(const image of [...images].sort((a,b)=>b.placeholder.length-a.placeholder.length)){
      const copy=!source&&bundle.manifest.uploadCopies?.find(copy=>copy.sourceFile===image.bundleFile);
      const file=bundle.assets.get('assets/'+(copy?.bundleFile||image.bundleFile));
      if(file){const url=URL.createObjectURL(file);urls.push(url);files.set(url,image.bundleFile);html=html.replaceAll(image.placeholder,url);}
      else html=html.replaceAll(image.placeholder,'missing-local:'+image.bundleFile);
    }
    let base=source?'<!doctype html><html><head><meta charset="utf-8"></head><body><h1 class="article-title"></h1>'+html+'</body></html>':DraftDistributionZip.preview({...bundle,html,manifest:{...bundle.manifest,contentImages:[]}});
    const d=new DOMParser().parseFromString(base,'text/html');
    if(source)d.querySelector('.article-title').textContent=bundle.manifest.title||'来源稿';
    d.querySelectorAll('script,iframe,object,embed,form,input,button,textarea,select,video,audio,canvas,link,base,meta[http-equiv]').forEach(el=>el.remove());
    for(const el of d.querySelectorAll('*')){
      for(const attr of [...el.attributes])if(/^on/i.test(attr.name)||['contenteditable','srcdoc','srcset','autofocus'].includes(attr.name))el.removeAttribute(attr.name);
      for(const item of DraftCore.cssUrls(el.style.backgroundImage))if(!/^(data:image\/|blob:)/.test(item.src))el.style.backgroundImage='none';
    }
    for(const image of [...d.images]){
      const src=image.getAttribute('src')||'',file=files.get(src);if(file)image.dataset.compareFile=file;
      if(!/^(data:image\/(png|jpeg|gif|webp|bmp);base64,|blob:)/i.test(src)){
        const label=d.createElement('p');label.className='compare-missing';label.dataset.compareFile=src.replace(/^missing-local:/,'');
        label.textContent='来源图片未随此平台包保留'+(src.startsWith('missing-local:')?'：'+src.slice(14):'');image.replaceWith(label);missing++;
      }
    }
    const meta=d.createElement('meta');meta.httpEquiv='Content-Security-Policy';meta.content="default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'; font-src 'none'";d.head.prepend(meta);
    const style=d.createElement('style');style.textContent='html{scroll-behavior:auto}body{font-family:system-ui,"Microsoft YaHei",sans-serif;max-width:430px;padding:18px;margin:0 auto;overflow-wrap:anywhere;color:#333;font-size:16px;line-height:1.8}img{max-width:100%;height:auto}.article-title{font-size:23px;line-height:1.5}.compare-missing{border:1px dashed #b6c4bd;padding:16px;color:#657d70;font-size:13px;background:#f7f9f6}[data-compare-highlight]{outline:2px solid #258574!important;outline-offset:3px}';d.head.append(style);
    return {html:'<!doctype html>'+d.documentElement.outerHTML,missing};
  }
  function entries(document){
    return [...document.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,pre,td,th,img')].filter(el=>el.tagName==='IMG'||normalize(el.textContent)).map((el,index)=>{
      el.dataset.compareIndex=String(index);
      return {el,index,text:normalize(el.textContent||el.getAttribute('alt')),file:el.dataset.compareFile||null,image:el.tagName==='IMG'};
    });
  }
  function pairs(left,right,bundle){
    const mapping=new Map(),reverse=new Map(),used=new Set();let cursor=0;
    for(const a of left){
      let choices=right.filter(b=>!used.has(b.index)&&((a.file&&b.file===a.file)||(!a.image&&!b.image&&a.text===b.text)));
      if(!choices.length&&a.text.length>8)choices=right.filter(b=>!used.has(b.index)&&b.text.length>8&&(b.text.includes(a.text)||a.text.includes(b.text)));
      const b=choices.find(b=>b.index>=cursor)||choices[0];if(!b)continue;
      mapping.set(a.index,b.index);reverse.set(b.index,a.index);used.add(b.index);cursor=b.index;
    }
    const blocks=bundle.report.layout_blocks||[];
    for(const block of blocks){const b=right.find(entry=>entry.file===block.image.bundleFile);if(!b)continue;
      const text=normalize(block.text);for(const a of left)if(a.text.length>=3&&text.includes(a.text)){mapping.set(a.index,b.index);if(!reverse.has(b.index))reverse.set(b.index,a.index);}
    }
    return {mapping,reverse};
  }
  function highlight(entry){if(!entry)return;entry.el.ownerDocument.querySelectorAll('[data-compare-highlight]').forEach(el=>el.removeAttribute('data-compare-highlight'));entry.el.setAttribute('data-compare-highlight','');}
  function scrollEntry(entry){const d=entry.el.ownerDocument,scroller=d.scrollingElement;scroller.scrollTop+=entry.el.getBoundingClientRect().top-Math.max(0,(d.documentElement.clientHeight-entry.el.getBoundingClientRect().height)/2);}
  async function show(bundle){
    cleanup();for(const url of urls)URL.revokeObjectURL(url);urls.length=0;
    const source=await sourceFor(bundle),[a,b]=await Promise.all([preview(source,'source'),preview(bundle,'target')]);
    const left=document.getElementById('matrix-source-frame'),right=document.getElementById('matrix-format-frame');
    const loaded=frame=>new Promise(resolve=>frame.addEventListener('load',resolve,{once:true}));
    const lp=loaded(left),rp=loaded(right);left.srcdoc=a.html;right.srcdoc=b.html;
    document.getElementById('matrix-source-title').textContent=source.manifest.title||'来源稿';
    document.getElementById('matrix-target-title').textContent=DraftDistribution.PLATFORMS[bundle.manifest.targetPlatform].label;
    document.getElementById('matrix-source-note').textContent=a.missing?'来源证明中的 '+a.missing+' 张图片未随平台包保留，已在原位置注明。':'来源正文与素材，仅供对照。';
    document.getElementById('matrix-format-dialog').showModal();await Promise.all([lp,rp]);
    const ldoc=left.contentDocument,rdoc=right.contentDocument,L=entries(ldoc),R=entries(rdoc),{mapping,reverse}=pairs(L,R,bundle);
    let locked=false,queued=false;
    const sync=(from,to,items,other,map,opposite)=>{
      if(locked||queued||!document.getElementById('matrix-sync-scroll').checked)return;queued=true;
      requestAnimationFrame(()=>{queued=false;if(locked)return;const position=from.scrollingElement.scrollTop;
        const candidates=items.filter(item=>map.has(item.index)&&item.el.getClientRects().length),item=[...candidates].reverse().find(item=>item.el.getBoundingClientRect().top<=0)||candidates[0];
        if(!item)return;const matched=other[map.get(item.index)];locked=true;
        if(matched){
          const fromPeers=items.filter(entry=>map.get(entry.index)===matched.index),toPeers=other.filter(entry=>opposite.get(entry.index)===item.index),next=candidates.find(entry=>entry.index>item.index&&map.get(entry.index)!==matched.index);
          let fromStart=item.el.getBoundingClientRect().top+position,toStart=matched.el.getBoundingClientRect().top+to.scrollingElement.scrollTop;
          let fromEnd=next?next.el.getBoundingClientRect().top+position:from.scrollingElement.scrollHeight,toEnd=next&&other[map.get(next.index)]?other[map.get(next.index)].el.getBoundingClientRect().top+to.scrollingElement.scrollTop:to.scrollingElement.scrollHeight;
          if(fromPeers.length>1){fromStart=Math.min(...fromPeers.map(entry=>entry.el.getBoundingClientRect().top+position));fromEnd=Math.max(...fromPeers.map(entry=>entry.el.getBoundingClientRect().bottom+position));toEnd=toStart+matched.el.getBoundingClientRect().height;}
          if(toPeers.length>1){toStart=Math.min(...toPeers.map(entry=>entry.el.getBoundingClientRect().top+to.scrollingElement.scrollTop));toEnd=Math.max(...toPeers.map(entry=>entry.el.getBoundingClientRect().bottom+to.scrollingElement.scrollTop));fromEnd=fromStart+item.el.getBoundingClientRect().height;}
          const fraction=Math.max(0,Math.min(1,(position-fromStart)/Math.max(1,fromEnd-fromStart)));
          to.scrollingElement.scrollTop=position<fromStart?toStart*position/Math.max(1,fromStart):toStart+fraction*Math.max(0,toEnd-toStart);
        }
        else to.scrollingElement.scrollTop=position/Math.max(1,from.scrollingElement.scrollHeight-from.documentElement.clientHeight)*Math.max(0,to.scrollingElement.scrollHeight-to.documentElement.clientHeight);
        requestAnimationFrame(()=>requestAnimationFrame(()=>{locked=false;}));
      });
    };
    const ls=()=>sync(ldoc,rdoc,L,R,mapping,reverse),rs=()=>sync(rdoc,ldoc,R,L,reverse,mapping);
    ldoc.addEventListener('scroll',ls,{passive:true});rdoc.addEventListener('scroll',rs,{passive:true});
    const pick=(event,items,other,map)=>{
      event.preventDefault();const el=event.target.closest('[data-compare-index]');if(!el)return;
      const entry=items[Number(el.dataset.compareIndex)],matched=other[map.get(entry.index)];highlight(entry);highlight(matched);if(matched)scrollEntry(matched);
    };
    const lc=e=>pick(e,L,R,mapping),rc=e=>pick(e,R,L,reverse);ldoc.addEventListener('click',lc);rdoc.addEventListener('click',rc);
    cleanup=()=>{ldoc.removeEventListener('scroll',ls);rdoc.removeEventListener('scroll',rs);ldoc.removeEventListener('click',lc);rdoc.removeEventListener('click',rc);latest=null;};
    latest={L,R,mapping,reverse,bundle};return latest;
  }
  function locate(change){
    if(!latest)return;const {L,R,reverse}=latest,text=normalize(change.text);
    const target=change.kind==='image'?R.filter(entry=>entry.image)[change.imagePosition-1]:R.find(entry=>text&&entry.text.includes(text));
    let source=target?L[reverse.get(target.index)]:null;
    source||=L.find(entry=>text&&entry.text.includes(text));
    if(target){highlight(target);scrollEntry(target);}if(source){highlight(source);scrollEntry(source);}
    document.getElementById('matrix-compare-location').textContent=source&&target?'已定位来源与平台对应内容。':target?'已定位平台内容；来源可能已拆分或整合。':'此项为整体规则，请结合两侧正文核对。';
  }
  document.getElementById('matrix-format-dialog')?.addEventListener('close',()=>{cleanup();for(const url of urls)URL.revokeObjectURL(url);urls.length=0;});
  return {show,locate,sourceFor};
})();
