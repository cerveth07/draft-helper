'use strict';

const WechatCapture = (() => {
  function validateUrl(value) {
    let url;try{url=new URL(value.trim());}catch{throw Error('请输入完整的微信公众号文章、预览或草稿编辑链接。');}
    if(url.protocol!=='https:'||url.hostname!=='mp.weixin.qq.com'||url.port||url.username||url.password)throw Error('这里只接受 https://mp.weixin.qq.com/ 的链接。');
    return url.href;
  }
  // Runs in the user's selected page, reads only. Never returns cookies, tokens, or the full URL.
  async function readInPage(properties) {
    function read(selectors) {
      for(const selector of selectors){
        const field=document.querySelector(selector);
        const text=(field?.value??field?.textContent??'').trim();
        if(text)return text;
      }
      return '';
    }
    function readArticleSummary() {
      for(const selector of ['meta[property="og:description"]','meta[name="description"]','meta[itemprop="description"]']){
        const summary=document.querySelector(selector)?.content.trim();
        if(summary)return summary;
      }
      return typeof window.msg_desc==='string'?window.msg_desc.trim():'';
    }
    // 推文封面：文章页把分享图放在 msg_cdn_url / og:image 里；草稿编辑器则只在封面预览里能看到。
    // 这里只取地址，图片字节由扩展自己下载，不经过页面会话。
    const readCover=()=>{
      const asUrl=value=>{
        if(typeof value!=='string')return '';
        const text=value.trim();
        const inside=/url\(\s*["']?([^"')]+)["']?\s*\)/i.exec(text);
        const raw=(inside?inside[1]:text).replace(/&amp;/g,'&').trim();
        if(!raw||/^data:/i.test(raw))return '';
        try{
          const url=new URL(raw,location.href);
          if(url.protocol!=='https:')return '';
          return url.href;
        }catch{return '';}
      };
      const found=[];
      for(const meta of document.querySelectorAll('meta[property="og:image"],meta[property="og:image:url"],meta[name="og:image"],meta[itemprop="image"]'))
        found.push(asUrl(meta.getAttribute('content')||''));
      for(const key of ['msg_cdn_url','cover_url','coverUrl','share_cdn_url']) found.push(asUrl(window[key]));
      if(window.cgiData&&typeof window.cgiData==='object')
        for(const key of ['cdn_url','cover_url','cover_img','cover']) found.push(asUrl(window.cgiData[key]));
      for(const selector of ['#js_cover img','#js_cover','.js_cover img','.cover-preview img','img.rich_media_thumb']){
        const el=document.querySelector(selector);
        if(!el)continue;
        found.push(asUrl(el.getAttribute('src')||el.getAttribute('data-src')||el.getAttribute('data-cover')||el.style.backgroundImage||''));
      }
      // 兜底：少数页面不把 msg_cdn_url 挂到 window 上，直接从行内脚本里抠出来。
      if(!found.some(Boolean)) {
        for(const script of document.scripts) {
          const match=/var\s+msg_cdn_url\s*=\s*["']([^"']+)["']/.exec(script.textContent||'');
          if(match){found.push(asUrl(match[1]));break;}
        }
      }
      const isImage=url=>/mmbiz\.(?:qpic|qlogo)\.cn/i.test(url)||/wx_fmt=/i.test(url)
        ||/\.(?:png|jpe?g|gif|webp|bmp)(?:\?|$)/i.test(url);
      return found.filter(url=>url&&isImage(url))[0]||'';
    };
    const api=window.__MP_Editor_JSAPI__;
    if(api&&typeof api.invoke==='function') {
      const content=await new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('草稿编辑器未及时返回正文，请等待页面加载完成后重试。')),10000);
        api.invoke({apiName:'mp_editor_get_content',sucCb:data=>{clearTimeout(timer);resolve(data?.content);},errCb:()=>{clearTimeout(timer);reject(Error('草稿正文读取失败，请确认已登录并打开具体图文编辑页。'));}});
      });
      if(typeof content!=='string'||!content.trim())throw Error('此草稿没有正文。');
      const summary=read(['#js_description','textarea[placeholder*="摘要"]','textarea[placeholder*="简介"]',
        '[contenteditable="true"][data-placeholder*="摘要"]','[contenteditable="true"][data-placeholder*="简介"]']);
      return {html:content,title:read(['.title-editor__input .ProseMirror','#title']),author:read(['#author']),summary,coverUrl:readCover(),sourceKind:'wechat-draft'};
    }
    const source=document.querySelector('#js_content');
    if(!source || (!source.textContent.trim()&&!source.querySelector('img')))throw Error('页面中尚无可读文章。链接可能已过期、需要登录／验证，或尚未打开具体文章；请在浏览器中处理后重新读取。');
    const copy=source.cloneNode(true);
    let emptyImages=0;
    const originals=[source,...source.querySelectorAll('*')],clones=[copy,...copy.querySelectorAll('*')];
    for(let i=0;i<originals.length;i++) {
      const original=originals[i],cloned=clones[i],computed=getComputedStyle(original);
      for(const prop of properties) {
        const value=computed.getPropertyValue(prop);
        if(value&&(!cloned.style.getPropertyValue(prop)||/var\(/.test(cloned.style.getPropertyValue(prop))))cloned.style.setProperty(prop,value);
      }
      if(cloned.tagName==='IMG') {
        if(original.classList.contains('wx_img_placeholder')&&!original.style.backgroundImage)cloned.style.backgroundImage='none';
        cloned.classList.remove('js_img_placeholder','wx_img_placeholder');
        let src=original.getAttribute('src')||'',lazy=original.getAttribute('data-src')||'';
        if(lazy&&(!src||/^data:image\/svg\+xml/i.test(src)))src=lazy;
        if(!src&&!original.getAttribute('alt')&&!original.style.backgroundImage){cloned.remove();emptyImages++;continue;}
        if(src&&!/^data:/i.test(src))try{src=new URL(src,location.href).href;}catch{}
        cloned.setAttribute('src',src);cloned.removeAttribute('data-src');
      }
    }
    copy.style.setProperty('visibility','visible');copy.style.setProperty('opacity','1');
    copy.style.removeProperty('width');copy.style.setProperty('max-width','100%');
    return {html:copy.outerHTML,title:read(['#activity-name','h1']),author:read(['#js_name']),summary:readArticleSummary(),coverUrl:readCover(),sourceKind:'wechat-article',
      warnings:emptyImages?['来源页有 '+emptyImages+' 处未提供图片地址、说明或背景的空白占位，已略过。']:[]};
  }
  // Narrow fallback for resources on the SAME authenticated WeChat origin only.
  // Cookies/tokens never leave the page; only user-requested image bytes are returned.
  async function readSameOriginImageInPage(rawUrl) {
    if(location.origin!=='https://mp.weixin.qq.com')throw Error('来源页面已离开微信公众号，不能读取图片。');
    const url=new URL(rawUrl,location.href);
    if(url.origin!==location.origin || url.username || url.password || url.port)
      throw Error('不允许通过公众号登录态读取第三方图片。');
    const response=await fetch(url.href,{credentials:'same-origin',mode:'same-origin',
      redirect:'error',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('公众号图片获取失败：HTTP '+response.status);
    const maxBytes=8*1024*1024;
    const length=Number(response.headers.get('content-length')||0);
    if(length>maxBytes)throw Error('同源图片超过 8MB，请通过文件方式导入。');
    const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();
    if(!/^image\/(?:png|jpeg|gif|webp|bmp)$/.test(type))throw Error('同源返回的不是支持的图片类型。');
    const pieces=[];let total=0;
    const push=bytes=>{
      total+=bytes.length;
      if(total>maxBytes)throw Error('同源图片超过 8MB，请通过文件方式导入。');
      for(let i=0;i<bytes.length;i+=8192)pieces.push(String.fromCharCode(...bytes.subarray(i,i+8192)));
    };
    if(response.body){
      const reader=response.body.getReader();
      try{
        while(true){
          const {done,value}=await reader.read();if(done)break;
          push(value);
        }
      }catch(error){await reader.cancel().catch(()=>{});throw error;}
    }else push(new Uint8Array(await response.arrayBuffer()));
    if(!total)throw Error('同源图片为空。');
    return 'data:'+type+';base64,'+btoa(pieces.join(''));
  }
  async function readSameOriginImage(tabId,url) {
    const parsed=new URL(url);
    if(parsed.protocol!=='https:'||parsed.hostname!=='mp.weixin.qq.com'||parsed.port
        ||parsed.username||parsed.password)throw Error('仅允许读取微信公众号同源图片。');
    const tab=await chrome.tabs.get(Number(tabId));
    validateUrl(tab.url||'');
    const results=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',
      func:readSameOriginImageInPage,args:[parsed.href]});
    if(typeof results?.[0]?.result!=='string')throw Error('公众号同源图片没有返回有效内容。');
    return results[0].result;
  }
  async function readTab(tabId) {
    const tab=await chrome.tabs.get(Number(tabId));validateUrl(tab.url||'');
    const results=await chrome.scripting.executeScript({target:{tabId:tab.id},world:'MAIN',func:readInPage,args:[DraftImport.properties]});
    const result=results[0]?.result;if(!result?.html)throw Error('没有读到正文，请确认链接指向具体文章、预览或草稿页。');return {...result,sourceTabId:tab.id};
  }
  async function readUrl(value) {
    const url=validateUrl(value), comparable=value=>value.split('#')[0];
    const tabs=await chrome.tabs.query({url:'https://mp.weixin.qq.com/*'});
    let tab=tabs.find(tab=>comparable(tab.url||'')===comparable(url));
    if(!tab)tab=await chrome.tabs.create({url,active:true});
    for(let i=0;i<30;i++) {
      tab=await chrome.tabs.get(tab.id);
      if(tab.status==='complete'||!tab.status)break;
      await new Promise(resolve=>setTimeout(resolve,500));
    }
    return readTab(tab.id);
  }
  return {validateUrl,readUrl,readInPage,readSameOriginImage};
})();
