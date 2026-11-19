/* Shared offline layout contract. Rendering is supplied by Chrome, never by an AI image service. */
'use strict';
const DraftLayout = (() => {
  const VERSION=1, ATTRIBUTE='data-draft-layout-node';
  const VOID=new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sha=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  const hashText=text=>sha(new TextEncoder().encode(text));
  const file=bytes=>({size:bytes.length,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});

  // Keep original source offsets: output verification must not depend on DOM serialization.
  function parse(html) {
    const root={id:0,tag:'root',start:0,end:html.length,children:[],parent:null},nodes=[],stack=[root];
    const tokens=/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][\w:-]*\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi;
    let m;
    while((m=tokens.exec(html))){
      const raw=m[0];if(/^<!/.test(raw))continue;
      const tag=raw.match(/^<\/?([\w:-]+)/)[1].toLowerCase();
      if(/^<\//.test(raw)){
        const top=stack.at(-1);
        if(top.tag!==tag)throw Error('特殊排版分析遇到未闭合或错位标签：'+tag+'。请先修正原稿 HTML。');
        top.end=tokens.lastIndex;stack.pop();continue;
      }
      if(new RegExp('\\s'+ATTRIBUTE+'\\s*=','i').test(raw))throw Error('原稿包含工具保留的排版标记。');
      const n={id:nodes.length+1,tag,start:m.index,openEnd:tokens.lastIndex,end:tokens.lastIndex,parent:stack.at(-1),children:[]};
      n.parent.children.push(n);nodes.push(n);
      if(['script','style','textarea','title'].includes(tag)){
        const close=new RegExp('</'+tag+'\\s*>','gi');close.lastIndex=tokens.lastIndex;
        const end=close.exec(html);if(!end)throw Error('原稿标签未闭合：'+tag);
        n.end=close.lastIndex;tokens.lastIndex=n.end;
      }else if(!VOID.has(tag)&&!/\/\s*>$/.test(raw))stack.push(n);
    }
    if(stack.length!==1)throw Error('原稿存在未闭合标签，无法可靠标记特殊排版。');
    return {root,nodes};
  }
  function instrument(html){
    const tree=parse(html);let out=html;
    for(const n of [...tree.nodes].reverse()){
      const at=n.openEnd-(/\/\s*>$/.test(html.slice(n.start,n.openEnd))?2:1);
      out=out.slice(0,at)+' '+ATTRIBUTE+'="'+n.id+'"'+out.slice(at);
    }
    return {html:out,tree};
  }
  function maybeSpecial(html){
    // Cheap gate for ordinary CLI packages; detailed decisions use measured DOM geometry.
    return /(?:display\s*:\s*(?:(?:inline-)?(?:flex|grid)|inline-block)|float\s*:\s*(?:left|right)|position\s*:\s*absolute|margin(?:-[\w]+)?\s*:[^;"']*-\d|transform\s*:\s*(?!none)[a-z]+\(|background(?:-color|-image)?\s*:|border-radius\s*:\s*[1-9]|<svg\b|<table\b)/i.test(html);
  }
  function animated(bytes){
    const b=bytes;
    // GIFs are conservatively kept animated; WebP/APNG have explicit animation flags.
    return (b[0]===71&&b[1]===73&&b[2]===70)
      || (b[0]===82&&b[8]===87&&String.fromCharCode(...b.slice(12,16))==='VP8X'&&!!(b[20]&2))
      || (b[0]===137&&new TextDecoder('latin1').decode(b).includes('acTL'));
  }
  async function renderInput(source,width=677){
    const resources={},animations=[];
    for(const item of source.manifest.contentImages){
      if(resources[item.placeholder])continue;
      const bytes=new Uint8Array(await source.assets.get('assets/'+item.bundleFile).arrayBuffer());
      let binary='';for(let at=0;at<bytes.length;at+=32768)binary+=String.fromCharCode(...bytes.subarray(at,at+32768));
      const type=/\.jpe?g$/i.test(item.bundleFile)?'jpeg':item.bundleFile.split('.').at(-1).toLowerCase();
      resources[item.placeholder]='data:image/'+type+';base64,'+btoa(binary);
      if(animated(bytes))animations.push(item.placeholder);
    }
    return {html:source.html,resources,animations,width};
  }
  function replacement(entry){
    const alt=entry.text||'特殊排版图组';
    const links=entry.links.map(link=>'<p data-draft-layout-link="true"><a href="'+escape(link.href)+'">'+escape(link.text||link.href)+'</a></p>').join('');
    return '<p style="margin:10px 0;padding:0;text-indent:0;text-align:center"><img src="'+entry.image.placeholder
      +'" alt="'+escape(alt)+'" style="display:block;width:100%;max-width:100%;height:auto;margin:0;padding:0"></p>'+links;
  }
  async function apply(html,images,assets,plan){
    if(!plan||plan.version!==VERSION||!['auto','preserve'].includes(plan.mode)||!Array.isArray(plan.blocks)
      ||plan.renderer!=='chrome-screenshot-v1'||!Number.isInteger(plan.width)||plan.width<320||plan.width>1000)throw Error('特殊排版记录无效。');
    if(plan.mode==='preserve'&&plan.blocks.length)throw Error('保留原结构模式不能包含转图记录。');
    const tree=plan.blocks.length?parse(html):null;
    let previousEnd=0,result='',cursor=0;
    const names=new Set(images.map(im=>im.bundleFile)),tokens=new Set(images.map(im=>im.placeholder));
    for(const block of plan.blocks){
      if(!Number.isSafeInteger(block.start)||!Number.isSafeInteger(block.end)||block.start<previousEnd||block.end<=block.start||block.end>html.length
        ||!Array.isArray(block.reasons)||!block.reasons.length||typeof block.text!=='string'||!Array.isArray(block.links)
        ||!block.image||typeof block.sourceSha256!=='string')throw Error('特殊排版区块边界或内容记录无效。');
      const first=tree.nodes.find(n=>n.start===block.start),last=tree.nodes.find(n=>n.end===block.end&&n.parent===first?.parent);
      if(!first||!last||await hashText(html.slice(block.start,block.end))!==block.sourceSha256)throw Error('特殊排版区块与微信原稿不一致。');
      const im=block.image;
      if(!/^layout-\d+-[a-f0-9]{12}\.png$/.test(im.bundleFile)||!/^WECHATIMGPH_LAYOUT_\d+_END$/.test(im.placeholder)
        ||names.has(im.bundleFile)||tokens.has(im.placeholder)||!Number.isSafeInteger(im.bytes)||im.bytes<=0||im.bytes>20*1024*1024
        ||!/^[a-f0-9]{64}$/.test(im.sha256))throw Error('特殊排版合成图清单无效。');
      if(block.links.some(link=>typeof link.text!=='string'||!/^https?:\/\//i.test(link.href||'')))throw Error('特殊排版链接记录无效。');
      const image=assets.get('assets/'+im.bundleFile);
      if(!image||image.size!==im.bytes||await sha(await image.arrayBuffer())!==im.sha256)throw Error('特殊排版合成图缺失或被修改。');
      const bytes=new Uint8Array(await image.arrayBuffer()),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
      if(!Number.isInteger(block.width)||!Number.isInteger(block.height)||block.width<16||block.width>plan.width+128||block.height<8||block.height>4096
        ||bytes.length<24||bytes[0]!==137||bytes[1]!==80||bytes[2]!==78||bytes[3]!==71
        ||view.getUint32(16)!==block.width*2||view.getUint32(20)!==block.height*2)
        throw Error('特殊排版图片的尺寸与二倍清晰度记录不一致。');
      names.add(im.bundleFile);tokens.add(im.placeholder);
      result+=html.slice(cursor,block.start)+replacement(block);cursor=block.end;previousEnd=block.end;
    }
    result+=html.slice(cursor);
    return {html:result,images:[...images.filter(im=>result.includes(im.placeholder)),...plan.blocks.map(b=>b.image)]};
  }
  async function prepare(source,render,{mode='auto',width=677,platform,onProgress=()=>{}}={}){
    if(!['auto','preserve'].includes(mode))throw Error('特殊排版模式应为 auto 或 preserve。');
    if(!Number.isInteger(width)||width<320||width>1000)throw Error('排版渲染宽度应为 320–1000px。');
    const plan={version:VERSION,mode,width,renderer:'chrome-screenshot-v1',blocks:[]};
    if(mode==='preserve'||!maybeSpecial(source.html))return {plan,assets:new Map(source.assets)};
    if(typeof render!=='function')throw Error('检测到可能的特殊排版，需要本机 Chrome 渲染器；不能直接生成可能拆图的发布包。');
    onProgress('正在检测特殊排版…');
    const rendered=await render({...await renderInput(source,width),platform},onProgress);
    const assets=new Map(source.assets);
    for(const [index,block] of rendered.entries()){
      const bytes=new Uint8Array(block.bytes);
      if(bytes.length>20*1024*1024)throw Error('特殊排版图超过 20MB，请缩小对应区块。');
      const digest=await sha(bytes),name='layout-'+(index+1)+'-'+digest.slice(0,12)+'.png';
      const image={placeholder:'WECHATIMGPH_LAYOUT_'+(index+1)+'_END',bundleFile:name,bytes:bytes.length,sha256:digest};
      plan.blocks.push({start:block.start,end:block.end,reasons:block.reasons,text:block.text,links:block.links,
        sourceSha256:await hashText(source.html.slice(block.start,block.end)),image,width:block.width,height:block.height});
      assets.set('assets/'+name,typeof File==='function'?new File([bytes],name,{type:'image/png'}):file(bytes));
    }
    await apply(source.html,source.manifest.contentImages,assets,plan);
    return {plan,assets};
  }
  function notes(plan){
    if(!plan)return [];
    if(plan.mode==='preserve')return ['已选择保留特殊排版原结构，目标平台可能拆散并排、叠层或背景卡片。'];
    if(!plan.blocks.length)return [];
    const text=plan.blocks.filter(block=>block.text.trim()).length;
    return ['已将 '+plan.blocks.length+' 处特殊排版整块转为图片，保留布局；原始区块保存在 source-wechat.json。'
      +(text?' 其中 '+text+' 处含文字，该部分随图显示，无法在平台内逐字编辑。':'')
      +(plan.blocks.some(b=>b.links.length)?' 区块内链接已在图片后单独保留。':'')
      +(plan.blocks.some(b=>b.reasons.includes('carousel'))?' 横向滑动图组已按原顺序完整展开，未只截取首屏。':'')];
  }
  return {VERSION,ATTRIBUTE,parse,instrument,maybeSpecial,animated,renderInput,prepare,apply,notes};
})();
if(typeof module!=='undefined')module.exports=DraftLayout;
