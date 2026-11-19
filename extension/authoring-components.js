/* Reusable, editable components. Only user-selected local media is embedded. */
'use strict';
const DraftComponents=(()=>{
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const para=text=>String(text??'').split(/\n+/).filter(Boolean).map(line=>'<p style="margin:0 0 12px;line-height:1.8">'+escape(line)+'</p>').join('');
  const field=(key,label,value='',multiline=false)=>({key,label,value,multiline});
  const photo=(src,caption='')=>'<figure style="margin:16px 0"><img src="'+escape(src)+'" alt="'+escape(caption)+'" style="display:block;width:100%;height:auto">'
    +(caption.trim()?'<figcaption style="font-size:13px;color:#666;text-align:center;margin-top:8px">'+escape(caption)+'</figcaption>':'')+'</figure>';
  const presets=[
    {
      id:'section-title',name:'小标题',category:'版式',description:'用于划分正文小节。',
      fields:[field('title','标题','小节标题')],
      build:v=>'<h2 style="font-size:21px;color:#087fb5;margin:26px 0 16px">'+escape(v.title)+'</h2>'
    },
    {
      id:'callout',name:'重点提示',category:'文字',description:'高亮一段提醒、说明或结论。',
      fields:[field('title','标题（可选）'),field('body','内容','填写要提醒读者的内容。',true)],
      build:v=>'<section style="border-left:3px solid #087fb5;padding:12px 16px;margin:20px 0;background:#f2f7fa">'
        +(v.title?.trim()?'<p style="font-weight:700;color:#087fb5;margin:0 0 8px">'+escape(v.title)+'</p>':'')+para(v.body)+'</section>'
    },
    {
      id:'quotation',name:'引用',category:'文字',description:'突出引文，可补充作者或出处。',
      fields:[field('quote','引文','填写引文。',true),field('author','作者或出处（可选）')],
      build:v=>'<blockquote style="border-left:3px solid #a6b5bc;padding:8px 16px;margin:20px 0;color:#555">'+para(v.quote)
        +(v.author?.trim()?'<p style="text-align:right;font-size:13px;margin:8px 0 0">——'+escape(v.author)+'</p>':'')+'</blockquote>'
    },
    {
      id:'key-points',name:'要点列表',category:'文字',description:'每行一项，适合步骤、清单或要点。',
      fields:[field('items','要点','第一条要点\n第二条要点',true)],
      build:v=>'<ul style="padding-left:1.5em;margin:16px 0">'
        +(v.items||'').split('\n').map(item=>item.trim()).filter(Boolean).map(item=>'<li style="margin:6px 0">'+escape(item)+'</li>').join('')+'</ul>'
    },
    {
      id:'single-photo',name:'图片与图注',category:'图片',description:'插入一张原图，可添加说明。',images:1,
      fields:[field('caption','图注（可选）')],
      build:(v,images)=>photo(images[0],v.caption)
    },
    {
      id:'double-photo',name:'双图组合',category:'图片',description:'并排放置两张图片。',images:2,
      fields:[field('caption1','左图图注（可选）'),field('caption2','右图图注（可选）')],
      build:(v,images)=>'<section style="display:flex;gap:12px;align-items:flex-start;margin:20px 0">'
        +'<div style="width:48%;flex:1">'+photo(images[0],v.caption1)+'</div><div style="width:48%;flex:1">'+photo(images[1],v.caption2)+'</div></section>'
    },
    {
      id:'divider',name:'分隔线',category:'版式',description:'分开相邻的小节。',fields:[],
      build:()=>'<hr style="border:0;border-top:1px solid #dce5e2;margin:26px 0">'
    },
    {
      id:'signature',name:'文末署名',category:'版式',description:'适用于个人、团队或机构署名。',
      fields:[field('name','署名','作者姓名'),field('note','补充说明（可选）','',true)],
      build:v=>'<section style="border-top:1px solid #dce5e2;padding:12px 0;margin:24px 0 0">'
        +'<p style="font-size:15px;font-weight:700;margin:0 0 8px">'+escape(v.name)+'</p>'+para(v.note)+'</section>'
    },
    {
      id:'reading-link',name:'链接',category:'文字',description:'添加参考资料、延伸阅读或相关页面。',
      fields:[field('label','链接文字','查看详情'),field('url','链接地址','https://')],
      build:v=>{
        const url=(v.url||'').trim();
        if(!/^https?:\/\/[^\s]+$/i.test(url))throw Error('请输入完整的 http 或 https 链接。');
        return '<p style="margin:16px 0"><a href="'+escape(url)+'">'+escape(v.label)+'</a></p>';
      }
    }
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
