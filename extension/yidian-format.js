/* Deterministic Yidian formatting. Presentation attributes survive its CSS sanitizer. */
'use strict';
const DraftYidianFormat=(()=>{
  const VERSION='yidian-readable-v1';
  const layout=()=>typeof DraftLayout!=='undefined'?DraftLayout:require('./layout-core.js');
  const sizes=[10,13,16,18,24,32,48];
  const decode=value=>String(value).replace(/&(?:quot|apos|amp|lt|gt|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi,token=>{const named={'&quot;':'"','&apos;':"'",'&amp;':'&','&lt;':'<','&gt;':'>','&nbsp;':'\u00a0'};if(named[token.toLowerCase()])return named[token.toLowerCase()];const n=token.slice(2,-1),code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):token;});
  const esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const norm=value=>decode(value.replace(/<[^>]*>/g,'')).replace(/[\s\u200b-\u200f\u2060\ufeff]/g,'');
  const attrs=raw=>Object.fromEntries([...raw.matchAll(/\s([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)].map(m=>[m[1].toLowerCase(),decode(m[2]??m[3]??m[4]??'')]));
  const px=(value,inherited)=>{const m=/^(-?[\d.]+)(px|em|rem|%)?$/.exec(value||'');if(!m)return inherited;return Number(m[1])*(m[2]==='em'?inherited:m[2]==='rem'?16:m[2]==='%'?inherited/100:1);};
  const color=value=>{value=(value||'').replace(/\s+/g,'').toLowerCase();const named={black:'#000000',white:'#ffffff',red:'#ff0000',blue:'#0000ff',green:'#008000',gray:'#808080',grey:'#808080',yellow:'#ffff00',transparent:'#ffffff'};value=named[value]||value;let m=/^#([a-f0-9]{3,4}|[a-f0-9]{6}|[a-f0-9]{8})$/.exec(value);if(m){let h=m[1];if(h.length<5)h=[...h].map(c=>c+c).join('');return [parseInt(h.slice(0,2),16),parseInt(h.slice(2,4),16),parseInt(h.slice(4,6),16),h.length===8?parseInt(h.slice(6,8),16)/255:1];}m=/^rgba?\((\d+(?:\.\d+)?),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)(?:,([\d.]+))?\)$/.exec(value);return m?[...m.slice(1,4).map(Number),m[4]===undefined?1:Number(m[4])]:null;};
  const hex=values=>'#'+values.slice(0,3).map(v=>Math.round(Math.max(0,Math.min(255,v))).toString(16).padStart(2,'0')).join('');
  const blend=(fg,bg)=>fg.slice(0,3).map((v,i)=>v*fg[3]+bg[i]*(1-fg[3]));
  function prepare(html){
    if(typeof html!=='string')throw Error('一点号排版来源必须为 HTML。');
    const tree=layout().parse(html),initial={font:16,color:'#000000',background:[255,255,255],face:'system-ui, sans-serif',bold:false,italic:false,underline:false,strike:false,align:'left',indent:0};
    const states=new Map([[tree.root,initial]]),changes=[],counts={paragraphs:0,images:0,indents:0,fontMappings:0,contrastFallbacks:0,imageLinks:0};
    const note=(kind,text,detail,extra={})=>changes.push({kind,text:norm(text).slice(0,55),detail,...extra});
    for(const node of tree.nodes){const parent=states.get(node.parent),a=attrs(html.slice(node.start,node.openEnd)),style=Object.fromEntries((a.style||'').split(';').map(rule=>{const at=rule.indexOf(':');return at<0?[]:[rule.slice(0,at).trim().toLowerCase(),rule.slice(at+1).trim().replace(/\s*!important$/i,'')];}).filter(x=>x.length));
      const bg=color(style['background-color']||style.background),weight=style['font-weight'];
      const sourceColor=style.color||a.color||parent.color;
      const face=style['font-family']||a.face||parent.face;
      states.set(node,{...parent,attrs:a,style,font:style['font-size']?px(style['font-size'],parent.font):node.tag==='font'&&/^\d$/.test(a.size||'')?(sizes[Number(a.size)-1]||parent.font):parent.font,
        color:/^(inherit|initial|currentcolor)$/i.test(sourceColor)?parent.color:sourceColor,background:bg?blend(bg,parent.background):parent.background,face:/[<>\x00-\x1f]/.test(face)?parent.face:face,
        bold:weight?/bold|[6-9]00/.test(weight):/^(b|strong|h[1-6]|th)$/.test(node.tag)||parent.bold,
        italic:style['font-style']?/italic|oblique/.test(style['font-style']):/^(i|em)$/.test(node.tag)||parent.italic,
        underline:/underline/.test(style['text-decoration']||style['text-decoration-line']||'')||node.tag==='u'||parent.underline,
        strike:/line-through/.test(style['text-decoration']||style['text-decoration-line']||'')||/^(s|del|strike)$/.test(node.tag)||parent.strike,
        align:style['text-align']||a.align||parent.align,indent:style['text-indent']===undefined?parent.indent:px(style['text-indent'],px(style['font-size'],parent.font))});
    }
    function textPart(raw,state){raw=raw.replace(/<!--[\s\S]*?-->/g,'');if(!raw||/^\s*[\r\n\t]+\s*$/.test(raw))return[];
      const closest=sizes.reduce((best,size)=>Math.abs(size-state.font)<Math.abs(best-state.font)?size:best),index=sizes.indexOf(closest)+1;
      let rgb=color(state.color),targetColor=rgb?hex(blend(rgb,state.background)):state.color;
      if(rgb&&rgb.slice(0,3).every(n=>n>250)){targetColor=state.background.some(n=>n<220)?hex(state.background):'#353535';if(norm(raw)){counts.contrastFallbacks++;note('contrast',raw,'来源白字 '+state.color+' 的底块无法保存，改用 '+targetColor+' 保证白底可见；原底色 '+hex(state.background)+'。');}}
      if(!/^#[a-f\d]{6}$/i.test(targetColor)&&!/^[-a-z]+$/i.test(targetColor)){targetColor='#353535';if(norm(raw))note('color',raw,'平台无法解析来源文字颜色 '+state.color+'，改用深色 '+targetColor+'。');}
      if(norm(raw)&&closest!==state.font){counts.fontMappings++;note('font',raw,'来源字号 '+state.font+'px 映射到一点号可保存的 '+closest+'px（字号档位 '+index+'），保留原文字颜色和强调。');}
      let value=raw;for(const [flag,tag]of [[state.strike,'s'],[state.underline,'u'],[state.italic,'i'],[state.bold,'b']])if(flag)value='<'+tag+'>'+value+'</'+tag+'>';
      return[{html:'<font color="'+esc(targetColor)+'" size="'+index+'" face="'+esc(state.face)+'">'+value+'</font>',block:false}];
    }
    function wrap(parts,state,tag='p'){const out=[];let inline='';function flush(){if(!inline)return;if(!norm(inline)&&!/<br\b/.test(inline)){inline='';return;}
      const align=state.align==='start'?'left':state.align==='end'?'right':['left','right','center','justify'].includes(state.align)?state.align:'left';
      const units=state.indent/state.font;let prefix='';if(units>0&&units<=16&&['left','justify'].includes(align)){prefix='\u3000'.repeat(Math.floor(units));const half=Math.round(units%1*2);prefix+=half===2?'\u3000':half===1?'\u2002':'';}
      if(prefix&&!decode(inline.replace(/<[^>]*>/g,'')).startsWith(prefix)){inline=/<font\b/.test(inline)?inline.replace(/<font\b[^>]*>/,tag=>tag+prefix):prefix+inline;counts.indents++;note('indent',inline,'来源首行缩进 '+state.indent+'px 改用 '+[...prefix].length+' 个全角／半角宽空格；跟随兼容字号显示。');}
      else if(state.indent&&(!prefix||['center','right'].includes(align)))note('indent',inline,'来源首行缩进 '+state.indent+'px 无法稳定保存，使用平台 '+align+' 对齐，无额外缩进。');
      out.push({html:'<'+tag+' align="'+align+'" style="text-align:'+align+'">'+inline+'</'+tag+'>',block:true});counts.paragraphs++;inline='';}
      for(const p of parts){if(p.block){flush();out.push(p);}else inline+=p.html;}flush();return out;}
    function imageLink(part,href,state){counts.imageLinks++;note('link',part.html,'一点号会清除图片上的超链接，保留图片，并在图片后增加「图片原链接」文字入口；原地址：'+href);
      return [part,...wrap([{html:'<a href="'+esc(href)+'">'+textPart('图片原链接',state).map(p=>p.html).join('')+'</a>',block:false}],{...state,indent:0}).map(p=>({...p,html:p.html.replace(/^<p /,'<p data-draft-image-link="true" ')}))];}
    function visit(node){const state=states.get(node);
      if(node.tag==='img'){const src=state.attrs.src;if(!/^WECHATIMGPH_[\w-]+$/.test(src||''))throw Error('一点号正文图片必须来自本地准备包。');counts.images++;
        const width=state.style.width||state.attrs.width||'未单独指定',height=state.style.height||state.attrs.height||'未单独指定';note('image','','第 '+counts.images+' 张图片 '+src+'：来源显示宽度 '+width+'、高度 '+height+'；改用一点号原生独立图片，按原图比例显示，超过正文宽度时等比缩小。',{imagePosition:counts.images});
        return[{html:'<p><img src="'+esc(src)+'" alt="'+esc(state.attrs.alt||'')+'" style="max-width:100%;height:auto"></p>',block:true}];}
      if(node.tag==='br')return[{html:'<br>',block:false}];if(node.tag==='hr')return[{html:'<hr>',block:true}];
      if(/^(script|style|iframe|object|embed|link|meta|source|wbr)$/.test(node.tag))return[];
      if(node.tag==='table')throw Error('一点号无法保存表格结构，请启用「自动检查特殊排版」将表格整合为图片，原表格仍随来源保留。');
      const parts=[];let cursor=node.openEnd??0;for(const child of node.children){parts.push(...textPart(html.slice(cursor,child.start),state),...visit(child));cursor=child.end;}
      const end=node.tag==='root'?html.length:html.lastIndexOf('</',node.end-1);parts.push(...textPart(html.slice(cursor,Math.max(cursor,end)),state));
      if(state.attrs?.style&&norm(parts.map(p=>p.html).join(''))){const rules=Object.entries(state.style).filter(([key])=>/^(?:background(?:-[\w-]+)?|border(?:-[\w-]+)?|box-shadow|line-height|letter-spacing|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?|width|height)$/.test(key));if(rules.length)note('layout',parts.map(p=>p.html).join(''),'来源容器装饰和间距改用一点号段落版式；原样式：'+rules.map(([k,v])=>k+':'+v).join('；')+'。');}
      if(node.tag==='a'){const href=state.attrs.href||'';if(/^(https?:|mailto:)/i.test(href)){const linked=[];for(const part of parts){if(!part.block)linked.push({...part,html:'<a href="'+esc(href)+'">'+part.html+'</a>'});else if(/^<p><img\b/.test(part.html))linked.push(...imageLink(part,href,state));else linked.push(part);}note('link',parts.map(p=>p.html).join(''),'保留网页／邮箱链接的文字和原地址：'+href);return linked;}if(href)note('link',parts.map(p=>p.html).join(''),'平台不支持该协议，保留可见文字；原地址：'+href);}
      if(node.tag==='li'){const content=parts.map(p=>p.html.replace(/^<p[^>]*>([\s\S]*)<\/p>$/,'$1')).join('');return wrap([{html:content,block:false}],state,'li');}
      if(/^(ul|ol)$/.test(node.tag)){const start=node.tag==='ol'&&/^\d+$/.test(state.attrs.start||'')?' start="'+Number(state.attrs.start)+'"':'';return[{html:'<'+node.tag+start+'>'+parts.map(p=>p.html).join('')+'</'+node.tag+'>',block:true}];}
      if(/^(p|div|section|article|header|footer|h[1-6]|blockquote|figcaption|pre|figure|main)$/.test(node.tag)){if(node.tag==='blockquote')note('quote',parts.map(p=>p.html).join(''),'引用块改为普通段落，保留文字颜色、字号和强调，移除平台会覆盖颜色和字号的引用样式。');if(/^h[1-6]$/.test(node.tag))note('heading',parts.map(p=>p.html).join(''),'标题转为兼容段落，以字号、加粗和对齐保留层次。');return wrap(parts,state);}
      return parts;
    }
    const output=wrap(visit(tree.root),initial).map(p=>p.html).join('');
    const literal=output.replace(/<p data-draft-image-link="true"[^>]*>[\s\S]*?<\/p>/g,'');
    if(norm(literal)!==norm(html))throw Error('一点号排版转换改变正文文字，已停止。');
    return {version:VERSION,html:output,counts,changes,notes:[
      '文字颜色、兼容字号、加粗、斜体、下划线、删除线、段落对齐、列表和普通网页／邮箱链接使用一点号可保存标记。',
      '字号使用平台档位 10、13、16、18、24、32、48px；来源字号与档位不一致时逐处记录。',
      '行距和段距使用一点号原生段落版式；底块、边框、阴影及复杂布局的替换逐处记录，白字失去底色时单独调整颜色。',
      '图片使用独立块并保持顺序；图片超链接转成紧随图片的文字入口。已核实的微信小表情改为文字表情，装饰小图和 1×1 空图的省略另列；二维码未因搜狐的限制而省略。',
    ]};
  }
  return {VERSION,prepare};
})();
if(typeof module!=='undefined')module.exports=DraftYidianFormat;
