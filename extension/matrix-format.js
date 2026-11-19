/* A platform projection of an already verified matrix matrix fragment.
 * The editorial base, title/cover review and source proof remain authoritative. */
'use strict';
const DraftMatrixFormat=(()=>{
  const SCHEMA='DRAFT_HELPER_MATRIX_FORMAT_V1',INDEX='matrix-format.json';
  const D=()=>typeof DraftDistribution!=='undefined'?DraftDistribution:require('./distribution-core.js');
  const Z=()=>typeof DraftDistributionZip!=='undefined'?DraftDistributionZip:require('./distribution-zip.js');
  const L=()=>typeof DraftLayout!=='undefined'?DraftLayout:require('./layout-core.js');
  const formatter=target=>target==='yidian'?(typeof DraftYidianFormat!=='undefined'?DraftYidianFormat:require('./yidian-format.js'))
    :target==='toutiao'?(typeof DraftToutiaoFormat!=='undefined'?DraftToutiaoFormat:require('./toutiao-format.js'))
    :(typeof DraftSohuFormat!=='undefined'?DraftSohuFormat:require('./sohu-format.js'));
  const shortTitle=title=>(typeof deriveToutiaoTitle==='function'?deriveToutiaoTitle:require('./yidian-contract.js').deriveToutiaoTitle)(title);
  const text=value=>JSON.stringify(value,null,2)+'\n';
  const digest=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
  function targetsFor(manifest){return manifest.targetPlatform==='yidian'?['yidian','toutiao']:manifest.targetPlatform==='sohu'?['sohu']:[];}
  function compile(base,bytes,layouts=new Map()){
    const {html,manifest,report,proof}=base,targets=targetsFor(manifest);
    if(!targets.length||manifest.bodyPolicy!=='same_as_toutiao_through_index_definition')throw Error('仅能适配已核验的矩阵第九步一点／头条或搜狐包。');
    const sourceManifest=proof.manifest||(proof.manifestText&&JSON.parse(proof.manifestText));
    if(!sourceManifest||typeof proof.html!=='string')throw Error('矩阵排版缺少原微信来源证明。');
    const files=new Map(),platforms={},aggregate=[];
    for(const target of targets){
      const layout=layouts.get(target);
      if(!layout)throw Error('矩阵排版缺少经过来源校验的特殊排版检查记录。');
      const skip=new Set(layout.images.filter(item=>{const data=bytes.get(item.bundleFile);if(!data)throw Error('矩阵来源图片缺失：'+item.bundleFile);return D().isSpacerImage(data);}).map(item=>item.placeholder));
      const label=D().PLATFORMS[target].label,result=D().rewrite(layout.html,layout.images,{skip,dropInlineIcons:target!=='sohu',nativeEmoji:target!=='sohu'}),format=formatter(target).prepare(result.html);
      result.html=format.html;
      let title=manifest.title,titleStatus='source_bound';
      if(target==='toutiao'){try{title=shortTitle(sourceManifest.title);if([...title].length<2||[...title].length>30)throw Error('length');}catch{title=null;titleStatus='pending_step9_2_short_title';}}
      const log=[{kind:'editorial-base',detail:'沿用第九步已核验内容基准 raw-content.txt：保留到完整「融合传播指数」说明段，正文与指标、节目顺序不重写；封面继续作为独立素材，不插入正文。'}];
      const kept=new Set(manifest.contentImages.map(item=>item.bundleFile));
      for(const image of sourceManifest.contentImages||[])if(!kept.has(image.bundleFile))log.push({kind:'editorial-cutoff',detail:'按既有第九步正文截止规则，说明段之后的来源图片 '+image.bundleFile+' 未进入矩阵稿；原微信来源证明保持完整。'});
      if(proof.matrixE3Header)log.push({kind:'e3-header',detail:'微信专用 E3 小程序／懒加载头图改为普通正文图片 '+proof.matrixE3Header.bundleFile+'；使用原始图片字节与既有 E3 来源核验，不保留小程序跳转。'});
      log.push(...D().processingLog({sourceHtml:html,sourceManifestText:JSON.stringify(sourceManifest),layout:layout.plan},result,format,[],target));
      const names={body:'matrix-'+target+'-content.txt',report:'matrix-'+target+'-report.json',log:'分发处理日志-'+label+'.txt',preview:'preview-'+target+'.html',title:'title-'+target+'.txt'};
      const formatReport={schema:SCHEMA,target_platform:target,format_policy:format.version,format_counts:format.counts,format_changes:format.changes,format_notes:format.notes,local_image_count:result.contentImages.length,remote_image_count:0,layout_policy:'special-blocks-v1',layout_blocks:layout.plan.blocks,processing_log_version:1,processing_log:log,delivery_state:'PREPARED_NOT_UPLOADED_OR_SAVED'};
      const targetManifest={...manifest,targetPlatform:target,title:title||sourceManifest.title,contentImages:result.contentImages,distribution:{formatPolicy:format.version}};
      platforms[target]={platform:target,title,titleStatus,formatPolicy:format.version,layout:layout.plan,contentImages:result.contentImages,files:names};
      files.set(names.body,format.html);files.set(names.report,text(formatReport));
      files.set(names.log,'平台：'+label+'\n内容来源：第九步已核验矩阵内容基准\n\n'+log.map((entry,i)=>(i+1)+'. '+entry.detail).join('\n')+'\n');
      files.set(names.preview,Z().preview({html:format.html,manifest:targetManifest,report:formatReport}));
      files.set(names.title,(title||'待第9.2步确认合规短标题；不得直接填入来源长标题')+'\n');
      aggregate.push(...log.map(entry=>({...entry,detail:'['+label+'] '+entry.detail})));
    }
    files.set('preview-article.html',files.get(platforms[manifest.targetPlatform].files.preview));
    const metadata={schema:SCHEMA,basePayloadSha256:report.payload_sha256,sourceProofSha256:manifest.sourceProofSha256,issueDate:manifest.issueDate,platforms};
    const indexText=text(metadata);files.set(INDEX,indexText);
    return {metadata,files,aggregate};
  }
  function seal(compiled,hash){
    const hashes={};for(const[name,value]of compiled.files)hashes[name]=hash(value);
    const images=new Map();for(const entry of Object.values(compiled.metadata.platforms))for(const block of entry.layout.blocks)images.set(block.image.bundleFile,block.image);
    return {schema:SCHEMA,indexFile:INDEX,sha256:hashes[INDEX],files:hashes,layoutImages:[...images.values()]};
  }
  async function materialize(bundle){
    const proofFile=bundle.assets.get('source-wechat.json');if(!proofFile)throw Error('矩阵排版来源证明缺失。');
    const bytes=new Map();for(const item of bundle.manifest.contentImages){const file=bundle.assets.get('assets/'+item.bundleFile);if(!file)throw Error('矩阵来源图片缺失：'+item.bundleFile);bytes.set(item.bundleFile,new Uint8Array(await file.arrayBuffer()));}
    const metadata=JSON.parse(await bundle.assets.get(INDEX).text()),layouts=new Map();
    for(const image of bundle.manifest.matrixFormat.layoutImages||[]){const file=bundle.assets.get('assets/'+image.bundleFile);if(!file)throw Error('矩阵整合图缺失：'+image.bundleFile);bytes.set(image.bundleFile,new Uint8Array(await file.arrayBuffer()));}
    for(const target of targetsFor(bundle.manifest)){
      const plan=metadata.platforms?.[target]?.layout;
      const applied=await L().apply(bundle.html,bundle.manifest.contentImages,bundle.assets,plan);
      layouts.set(target,{plan,...applied});
    }
    return compile({...bundle,proof:JSON.parse(await proofFile.text())},bytes,layouts);
  }
  async function verify(bundle){
    const ref=bundle.manifest.matrixFormat;if(!ref)return null;
    if(ref.schema!==SCHEMA||ref.indexFile!==INDEX)throw Error('矩阵矩阵排版策略版本不受支持。');
    const compiled=await materialize(bundle),hashes=new Map();
    await Promise.all([...compiled.files.values()].map(async value=>hashes.set(value,await digest(value))));
    const expected=seal(compiled,value=>hashes.get(value));
    if(JSON.stringify(expected)!==JSON.stringify(ref))throw Error('矩阵排版清单与来源转换结果不一致。');
    for(const[name,value]of compiled.files){const file=bundle.assets.get(name);if(!file||await file.text()!==value)throw Error('矩阵平台副本、预览或转换日志缺失／被修改：'+name);}
    if(bundle.report.matrix_format_policy!==SCHEMA||JSON.stringify(bundle.report.processing_log)!==JSON.stringify(compiled.aggregate))throw Error('矩阵总处理日志与实际转换不一致。');
    return compiled;
  }
  async function view(bundle,target){
    const original=bundle.matrixSourceBundle||bundle;
    if(!original.manifest.matrixFormat)return original;
    const metadata=JSON.parse(await original.assets.get(INDEX).text()),entry=metadata.platforms[target];
    if(!entry||!entry.title)throw Error('该矩阵包没有当前平台的合规适配稿／短标题，请完成对应第九步生成。');
    const html=await original.assets.get(entry.files.body).text(),formatReport=JSON.parse(await original.assets.get(entry.files.report).text());
    const proof=JSON.parse(await original.assets.get('source-wechat.json').text()),plan=proof.titlePlan;
    const selected=target==='toutiao'?plan.candidates.find(item=>item.programId===plan.wechatProgramId):null;
    const manifest={...original.manifest,targetPlatform:target,compatiblePlatforms:[target],title:entry.title,contentImages:entry.contentImages,
      coverImage:original.manifest.platformCovers?.[target]??null,
      ...(selected?{selectedProgramId:selected.programId,selectedProgramName:selected.programName}:{}),
      distribution:{formatPolicy:entry.formatPolicy}};
    const runtime=original.assets.get('填入运行日志-'+target+'.txt');
    return {...original,html,manifest,report:{...original.report,...formatReport,payload_sha256:original.manifest.matrixFormat.files[entry.files.body]},
      matrixSourceBundle:original,matrixFormatTarget:target,
      ...(runtime?{runtimeLog:[...(original.runtimeLog||[]),...(await runtime.text()).split(/\r?\n/).filter(Boolean)]}:{})};
  }
  async function verifyView(bundle,target){
    if(!bundle.matrixSourceBundle||bundle.matrixFormatTarget!==target)throw Error('矩阵适配视图平台不一致。');
    const expected=await view(bundle.matrixSourceBundle,target);
    if(bundle.html!==expected.html||bundle.manifestText!==expected.manifestText||bundle.assets!==expected.assets||JSON.stringify(bundle.manifest)!==JSON.stringify(expected.manifest)||JSON.stringify(bundle.report)!==JSON.stringify(expected.report))throw Error('矩阵适配视图偏离已核验平台副本。');
    return true;
  }
  return {SCHEMA,INDEX,compile,seal,verify,view,verifyView,targetsFor};
})();
if(typeof module!=='undefined')module.exports=DraftMatrixFormat;
