/* Reusable, editable components. Only user-selected local media is embedded. */
'use strict';
const DraftComponents=(()=>{
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const para=text=>String(text??'').split(/\n+/).filter(Boolean).map(line=>'<p style="margin:0 0 12px;line-height:1.8">'+escape(line)+'</p>').join('');
  const field=(key,label,value='',multiline=false)=>({key,label,value,multiline});
  const photo=(src,caption)=>'<figure style="margin:16px 0"><img src="'+escape(src)+'" alt="'+escape(caption)+'" style="display:block;width:100%;height:auto"><figcaption style="font-size:13px;color:#666;text-align:center;margin-top:8px">'+escape(caption)+'</figcaption></figure>';
  const presets=[
    {id:'section-title',name:'分节标题',category:'标题',description:'带序号的分节标题，正文仍可编辑。',fields:[field('number','序号','01'),field('title','标题','填写分节标题')],build:v=>'<h2 style="font-size:21px;color:#087fb5;margin:26px 0 16px">'+escape(v.number)+' · '+escape(v.title)+'</h2>'},
    {id:'guest-intro',name:'嘉宾简介',category:'论坛',description:'姓名、称谓、职务与分享主题。',fields:[field('name','姓名与称谓','填写姓名及称谓'),field('role','职务','填写单位与职务'),field('topic','分享介绍','填写论坛名称和分享主题',true)],build:v=>'<section style="border-left:3px solid #087fb5;padding:4px 0 4px 16px;margin:20px 0"><p style="font-size:20px;color:#087fb5;font-weight:700;margin:0 0 8px">'+escape(v.name)+'</p><p style="color:#666;font-size:14px;margin:0 0 12px">'+escape(v.role)+'</p>'+para(v.topic)+'</section>'},
    {id:'quotation',name:'重点引语',category:'论坛',description:'可编辑的引语与署名。',fields:[field('quote','引语','填写需要突出展示的原文引语',true),field('author','署名','填写发言人姓名及称谓')],build:v=>'<blockquote style="border-left:3px solid #087fb5;padding:12px 16px;margin:20px 0;background:#f2f7fa">'+para(v.quote)+'<p style="text-align:right;font-size:13px;color:#666;margin:8px 0 0">——'+escape(v.author)+'</p></blockquote>'},
    {id:'data-finding',name:'数据结论',category:'报告',description:'数据、指标含义、统计范围与来源成组展示。',fields:[field('value','数据','填写数据'),field('label','指标说明','填写指标名称及统计口径'),field('finding','解读','填写已经核实的结论',true),field('source','来源与日期','填写来源及数据日期')],build:v=>'<section style="padding:18px;border:1px solid #d9e7ed;margin:20px 0"><p style="font-size:28px;font-weight:700;color:#087fb5;margin:0 0 8px">'+escape(v.value)+'</p><p style="font-weight:700;margin:0 0 10px">'+escape(v.label)+'</p>'+para(v.finding)+'<p style="font-size:12px;color:#666;margin:12px 0 0">'+escape(v.source)+'</p></section>'},
    {id:'index-note',name:'指标说明',category:'报告',description:'用于放置完整指标定义或统计说明。',fields:[field('title','说明标题','统计说明'),field('body','完整说明','填写经过确认的指标定义与统计范围',true)],build:v=>'<section style="margin:22px 0;padding:14px 0;border-top:1px solid #dce5e2"><h3 style="font-size:16px;color:#555;margin:0 0 10px">'+escape(v.title)+'</h3><div style="font-size:13px;color:#666">'+para(v.body)+'</div></section>'},
    {id:'single-photo',name:'现场照片与图注',category:'图片',description:'插入原始图片和可编辑图注。',images:1,fields:[field('caption','图片说明','填写现场照片说明')],build:(v,images)=>photo(images[0],v.caption)},
    {id:'double-photo',name:'双图组合',category:'图片',description:'两张原图并排；分发时按平台兼容策略处理。',images:2,fields:[field('caption1','左图说明','填写左图说明'),field('caption2','右图说明','填写右图说明')],build:(v,images)=>'<section style="display:flex;gap:12px;align-items:flex-start;margin:20px 0"><div style="width:48%;flex:1">'+photo(images[0],v.caption1)+'</div><div style="width:48%;flex:1">'+photo(images[1],v.caption2)+'</div></section>'},
    {id:'divider',name:'章节分隔线',category:'通用',description:'简单分隔，不添加装饰小图。',fields:[],build:()=>'<hr style="border:0;border-top:1px solid #dce5e2;margin:26px 0">'},
    {id:'signature',name:'机构落款',category:'通用',description:'机构名称和补充说明，可继续编辑。',fields:[field('name','机构名称','填写机构名称'),field('note','补充说明','填写需要保留的来源或联系说明',true)],build:v=>'<section style="border-top:2px solid #087fb5;padding:16px 0;margin:28px 0 0"><p style="font-size:18px;color:#087fb5;font-weight:700;margin:0 0 10px">'+escape(v.name)+'</p>'+para(v.note)+'</section>'},
    {id:'reading-link',name:'推荐阅读',category:'通用',description:'保留完整网页地址和可编辑链接文字。',fields:[field('label','文章标题','填写推荐文章标题'),field('url','文章链接','https://')],build:v=>{if(!/^https?:\/\/[^\s]+$/i.test(v.url))throw Error('请输入完整的 http 或 https 文章链接。');return '<section style="margin:24px 0"><h3 style="font-size:16px;color:#087fb5">推荐阅读</h3><p><a href="'+escape(v.url)+'">'+escape(v.label)+'</a></p></section>';}}
  ];
  function build(id,values,images=[]){const item=presets.find(item=>item.id===id);if(!item)throw Error('组件不存在。');
    if(images.length<(item.images||0))throw Error('请为此组件选择 '+item.images+' 张本地图片。');
    return '<section data-dh-group="'+escape(item.name)+'" style="margin:0;padding:0">'+item.build(values,images)+'</section>';
  }
  function validate(record){
    if(record?.version!==1||typeof record.id!=='string'||!/^custom-[\w-]+$/.test(record.id)||typeof record.name!=='string'||!record.name.trim()||record.name.length>60||typeof record.html!=='string'||record.html.length>12*1024*1024)throw Error('组件记录无效或超过大小限制。');
    const d=new DOMParser().parseFromString(record.html,'text/html');
    if(d.querySelector('script,iframe,object,embed,form,input,button,textarea,select,video,audio,canvas,style,link,meta,base,foreignObject,animate,animateMotion,animateTransform,set,mp-miniprogram'))throw Error('组件中含有不支持的活动内容。');
    for(const el of d.querySelectorAll('*'))for(const attr of [...el.attributes]){
      if(/^on/i.test(attr.name)||['srcdoc','contenteditable','srcset','action','formaction'].includes(attr.name))throw Error('组件中含有不支持的交互属性。');
      if(attr.name==='style'&&/expression\(|javascript:|vbscript:|-moz-binding|behavior\s*:/i.test(attr.value))throw Error('组件样式无效。');
      if(attr.name==='style'&&DraftCore.cssUrls(attr.value).some(item=>!DraftCore.imageData.test(item.src)))throw Error('组件包含未本地化的样式图片。');
      if(attr.name==='href'&&!/^(https?:|mailto:|tel:|#)/i.test(attr.value))throw Error('组件链接协议不受支持。');
    }
    for(const el of d.querySelectorAll('svg image,svg use'))for(const attr of ['href','xlink:href'])if(el.hasAttribute(attr)&&!/^#/.test(el.getAttribute(attr))&&!DraftCore.imageData.test(el.getAttribute(attr)))throw Error('组件中的矢量素材含有外部资源。');
    for(const item of DraftCore.collectAssets(d))if(!DraftCore.imageData.test(item.src))throw Error('请先补齐组件图片；组件只保存已本地化的图片。');
    return {version:1,id:record.id,name:record.name.trim(),category:'我的收藏',html:d.body.innerHTML,description:'从工作台收藏的图文组件'};
  }
  return {presets,build,validate};
})();
