/* Offline ZIP (stored entries). No third-party dependency or network access. */
'use strict';
const DraftDistributionZip = (() => {
  const table=Uint32Array.from({length:256},(_,n)=>{
    let c=n;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;
  });
  const utf8=value=>new TextEncoder().encode(value);
  const u16=(view,at,value)=>view.setUint16(at,value,true);
  const u32=(view,at,value)=>view.setUint32(at,value,true);
  const header=(size,signature)=>{const bytes=new Uint8Array(size);u32(new DataView(bytes.buffer),0,signature);return bytes;};
  const checksum=bytes=>{let c=0xffffffff;for(const value of bytes)c=table[(c^value)&255]^(c>>>8);return(c^0xffffffff)>>>0;};
  const bytesOf=async value=>{
    if(typeof value==='string')return utf8(value);
    if(value instanceof Uint8Array)return value;
    if(value?.arrayBuffer)return new Uint8Array(await value.arrayBuffer());
    throw new Error('ZIP 输入不是文本或二进制文件。');
  };

  async function pack(files) {
    const data=[],index=[];let offset=0,total=0;
    for(const [name,value] of files) {
      if(typeof name!=='string'||!name||name.length>240||name.startsWith('/')
          ||name.split('/').some(x=>!x||x==='.'||x==='..')||/[\\\x00-\x1f\x7f]/.test(name))
        throw new Error('ZIP 文件路径不合法：'+name);
      const filename=utf8(name),bytes=await bytesOf(value);
      total+=bytes.length;if(total>128*1024*1024)throw new Error('分发包超过 128MB，无法直接下载 ZIP。');
      if(bytes.length>0xffffffff||offset>0xffffffff||index.length>=65535)
        throw new Error('ZIP 文件超出标准大小上限。');
      const crc=checksum(bytes);
      const local=header(30,0x04034b50),lv=new DataView(local.buffer);
      u16(lv,4,20);u16(lv,6,0x800);u16(lv,8,0);u16(lv,10,0);u16(lv,12,33);
      u32(lv,14,crc);u32(lv,18,bytes.length);u32(lv,22,bytes.length);
      u16(lv,26,filename.length);u16(lv,28,0);
      data.push(local,filename,bytes);
      index.push({filename,crc,size:bytes.length,offset});
      offset+=local.length+filename.length+bytes.length;
    }
    const directoryStart=offset,centers=[];
    for(const entry of index){
      const central=header(46,0x02014b50),v=new DataView(central.buffer);
      u16(v,4,20);u16(v,6,20);u16(v,8,0x800);u16(v,10,0);u16(v,12,0);u16(v,14,33);
      u32(v,16,entry.crc);u32(v,20,entry.size);u32(v,24,entry.size);u16(v,28,entry.filename.length);
      u16(v,30,0);u16(v,32,0);u16(v,34,0);u16(v,36,0);u32(v,38,0);u32(v,42,entry.offset);
      centers.push(central,entry.filename);offset+=central.length+entry.filename.length;
    }
    const end=header(22,0x06054b50),e=new DataView(end.buffer);
    u16(e,8,index.length);u16(e,10,index.length);u32(e,12,offset-directoryStart);
    u32(e,16,directoryStart);u16(e,20,0);
    return new Blob([...data,...centers,end],{type:'application/zip'});
  }

  function preview(bundle) {
    const escape=text=>String(text).replace(/[&<>"']/g,ch=>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
    let html=bundle.html;
    for(const item of bundle.manifest.contentImages){
      if(!/^[^\/\\\x00-\x1f]+$/.test(item.bundleFile))throw Error('预览图片路径不合法。');
      const copy=bundle.manifest.uploadCopies?.find(copy=>copy.sourceFile===item.bundleFile);
      html=html.replaceAll(item.placeholder,'assets/'+(copy?.bundleFile||item.bundleFile));
    }
    if(/WECHATIMGPH_/.test(html))throw Error('预览包含未处理的图片占位符。');
    return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
      +'<meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src &#39;self&#39; data:; style-src &#39;unsafe-inline&#39;">'
      +'<title>'+escape(bundle.manifest.title)+'</title>'
      +'<style>body{font-family:system-ui;max-width:720px;margin:20px auto;padding:16px;overflow-wrap:anywhere}img{max-width:100%;height:auto}'
      +(bundle.manifest.targetPlatform==='sohu'&&bundle.manifest.distribution?.formatPolicy
        ? 'body{font-size:16px;line-height:1.8;color:#333}h2{font-size:24px}p,blockquote{margin:0 0 1em;white-space:pre-wrap}.ql-align-center{text-align:center}.ql-align-right{text-align:right}.ql-align-justify{text-align:justify}' : '')
      +(bundle.manifest.targetPlatform==='toutiao'&&bundle.manifest.distribution?.formatPolicy
        ? 'body{font-size:17px;line-height:1.75;color:#222}h1{font-size:18px;line-height:30px;margin:20px 0 12px}h1.article-title{font-size:24px}p,li,td,th{font-size:17px}p,blockquote{margin:20px 0;white-space:pre-wrap}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px}' : '')
      +(bundle.manifest.targetPlatform==='yidian'&&bundle.manifest.distribution?.formatPolicy
        ? 'body{font-size:16px;line-height:1.5;color:#000}p{margin:17px 0 25px;line-height:30px;white-space:pre-wrap}li{white-space:pre-wrap}h1.article-title{font-size:24px}img{display:block;margin:0 auto}' : '')
      +'</style>'
      +'</head><body><h1 class="article-title">'+escape(bundle.manifest.title)+'</h1>'+html+'</body></html>\n';
  }
  function processingText(bundle){
    return '文章：'+bundle.manifest.title+'\n目标平台：'+bundle.manifest.targetPlatform+'\n\n'
      +(bundle.report.processing_log||[]).map((entry,index)=>(index+1)+'. '+entry.detail).join('\n')+'\n';
  }
  function filesFor(bundle) {
    const distribution=typeof DraftDistribution!=='undefined'?DraftDistribution:require('./distribution-core.js');
    // Imported matrix packages carry their own source proof, preview and
    // instructions. Copy the selected files unchanged instead of replacing
    // them with the generic distribution description.
    if (bundle.manifest.distribution?.schema !== 'DRAFT_HELPER_DISTRIBUTION_V1') {
      for (const name of ['manifest.json','raw-content.txt','preparation-report.json','source-wechat.json'])
        if (!bundle.assets.has(name)) throw Error('原准备包缺少文件，无法完整导出：'+name);
      const files=new Map(bundle.assets);
      if(bundle.runtimeLog?.length)files.set(bundle.matrixSourceBundle?'填入运行日志-'+bundle.matrixFormatTarget+'.txt':'填入运行日志.txt',bundle.runtimeLog.join('\n')+'\n');
      return files;
    }
    const files=new Map([
      ['manifest.json',bundle.manifestText],
      ['raw-content.txt',bundle.html],
      ['preparation-report.json',JSON.stringify(bundle.report,null,2)+'\n'],
      ['source-wechat.json',bundle.sourceProofText],
      ['title.txt',bundle.manifest.title+'\n'],
      ['preview-article.html',preview(bundle)],
      ['分发处理日志.txt',processingText(bundle)],
      ['使用说明.txt','SyncPress 通用分发准备包（配置档 '
        +(bundle.manifest.profile?.id||bundle.manifest.targetPlatform)+'）\n目标平台：'
        +(distribution.PLATFORMS[bundle.manifest.targetPlatform]?.label||bundle.manifest.targetPlatform)
        +(bundle.manifest.profileSpec?'\n标题：'+bundle.manifest.profileSpec.title.min+'–'
          +bundle.manifest.profileSpec.title.max+' 字，不自动截断':'')
        +'\n保留原微信正文及图片位置；摘要、作者、封面按该平台规则处理，标为「待实页验收」的项需人工核对。\n'
        +(bundle.report.layout_blocks?.length?'特殊排版：'+bundle.report.layout_blocks.length+' 处已整块转图；区块文字随图保留，链接在图片后单独保留。原始内容与转换范围见 source-wechat.json，具体记录见 preparation-report.json。\n':'')
        +'解压后在 SyncPress 扩展的「多平台填入」选择整个准备包目录。'
        +'\n仅在目标平台已登录的空白文章编辑页填入；核对文章与封面后手动保存。尚未执行发布或草稿保存。\n']
    ]);
    if(bundle.runtimeLog?.length)files.set('填入运行日志.txt',bundle.runtimeLog.join('\n')+'\n');
    for(const [path,file] of bundle.assets)if(path.startsWith('assets/'))files.set(path,file);
    return files;
  }
  function sourceFilesFor(bundle){
    const files=new Map([
      ['manifest.json',bundle.manifestText],
      ['raw-content.txt',bundle.html],
      ['preparation-report.json',JSON.stringify(bundle.report,null,2)+'\n'],
      ['preview-article.html',preview(bundle)],
      ['使用说明.txt','SyncPress 微信完整准备包（配置档 '+(bundle.manifest.profile?.id||'wechat')+'）。'
        +'包含本地正文和素材，可重新导入工作台，或使用 distribute.mjs 转换至其他平台。'
        +(bundle.manifest.profile?.id==='wechat-sub'?'次条封面为 1:1 方图，未包含封面时请在编辑器内单独设置。':'')
        +'\n'],
    ]);
    for(const [name,file] of bundle.assets)if(name.startsWith('assets/'))files.set(name,file);
    return files;
  }
  function nameFor(bundle) {
    // 下载文件名按目标配置档区分：draft-helper-<配置档>-<日期>-<标题>.zip
    const manifest=bundle?.manifest||{};
    const profile=manifest.profile?.id||manifest.targetPlatform||'wechat';
    const pad=value=>String(value).padStart(2,'0');
    const now=new Date();
    const today=now.getFullYear()+'-'+pad(now.getMonth()+1)+'-'+pad(now.getDate());
    const date=/^\d{4}-\d{2}-\d{2}$/.test(manifest.issueDate||'')?manifest.issueDate:today;
    const title=[...String(manifest.title||'')
      .replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/\s+/g,' ').trim()
      .replace(/[. ]+$/,'')].slice(0,24).join('').trim();
    return 'draft-helper-'+profile+'-'+date+(title?'-'+title:'')+'.zip';
  }
  return {pack,nameFor,filesFor,sourceFilesFor,preview,processingText};
})();
if(typeof module!=='undefined')module.exports=DraftDistributionZip;
