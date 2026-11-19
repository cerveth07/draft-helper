(()=>{
'use strict';
const inNode=typeof module!=='undefined'&&!!module.exports;
const fs=inNode?require('node:fs'):null;
const path=inNode?require('node:path'):null;
const crypto=inNode?require('node:crypto'):null;
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const fail=m=>{throw Error(m);};
function checkedMatrixCover(receiptPath,plan,programmeId,wechatManifestText,titlePlanPath){
  if(!receiptPath)fail('Programme B/C requires its reviewed matrix cover receipt');
  const receiptFile=path.resolve(receiptPath),stat=fs.lstatSync(receiptFile);
  if(!stat.isFile()||stat.isSymbolicLink())fail('matrix cover receipt is not a regular file');
  const bytes=fs.readFileSync(receiptFile),r=JSON.parse(bytes.toString('utf8'));
  const item=r.items?.[0], c=plan.candidates?.find(x=>x.programId===programmeId);
  if(r.schema_version!=='DRAFT_HELPER_MATRIX_COVER_DELIVERY_V1'||r.status!=='delivered'
     ||!c||c.programId===plan.wechatProgramId||r.issue_date!==plan.issueDate
     ||r.programme_id!==programmeId||r.programme_title!==c.programName
     ||r.season!==(c.seasonLabel||'')||r.title_plan_sha256!==sha(fs.readFileSync(titlePlanPath))
     ||r.source_wechat_manifest_sha256!==sha(wechatManifestText)
     ||r.items?.length!==1||!item||item.id!==programmeId||item.filename!=='cover.jpg'
     ||!/^[a-f0-9]{64}$/.test(item.sha256||''))
    fail('Matrix cover receipt/title programme/source does not match');
  const image=path.resolve(path.dirname(receiptFile),item.target);
  if(fs.lstatSync(image).isSymbolicLink()||!fs.statSync(image).isFile())
    fail('Matrix cover is not a regular image');
  const data=fs.readFileSync(image);
  if(sha(data)!==item.sha256||data.length<128)fail('Matrix cover image differs from reviewed receipt');
  return {data,proof:{programmeId,programmeName:c.programName,season:c.seasonLabel||'',
    receiptSha256:sha(bytes),coverSha256:item.sha256},
    image:{bundleFile:'cover.jpg',sourceName:'矩阵节目封面',sha256:item.sha256,bytes:data.length,
      programmeId,programmeName:c.programName,season:c.seasonLabel||''}};
}
function roleCover(cover,programmeId,programmeName,season,bundleFile){
  return {...cover,bundleFile,programmeId,programmeName,season:season||''};
}
function manualCoverChoice(plan,programmeId,instruction){
  const c=plan.candidates?.find(x=>x.programId===programmeId);
  if(!c||programmeId===plan.wechatProgramId||typeof instruction!=='string'
      ||!instruction.trim()||instruction.length>500)fail('Explicit user instruction is required for manual cover mode');
  return {image:null,proof:{mode:'user_adds_cover',status:'pending_user_addition',
    programmeId,programmeName:c.programName,season:c.seasonLabel||'',userInstruction:instruction.trim()}};
}
function isManualCover(manifest,proof,plan,programmeId){
  if(manifest.coverMode!=='manual')return false;
  const c=plan.candidates?.find(x=>x.programId===programmeId),e=proof.matrixCover;
  if(!c||programmeId===plan.wechatProgramId||manifest.coverImage!==null
      ||manifest.platformCovers?.[manifest.targetPlatform]!==null
      ||manifest.selectedProgramId!==programmeId||manifest.selectedProgramName!==c.programName
      ||e?.mode!=='user_adds_cover'||e?.status!=='pending_user_addition'
      ||e?.programmeId!==programmeId||e?.programmeName!==c.programName||e?.season!==(c.seasonLabel||'')
      ||typeof e.userInstruction!=='string'||!e.userInstruction.trim()||e.userInstruction.length>500
      ||e.coverSha256!==undefined||e.receiptSha256!==undefined
      ||JSON.stringify(e)!==JSON.stringify(manifest.matrixCoverEvidence))
    fail('Manual cover must retain explicit user instruction, programme identity and pending status');
  return true;
}
function sharedCoverChoice(plan,programmeId,sourceManifest,instruction,data){
  const c=plan.candidates?.find(x=>x.programId===programmeId);
  const a=plan.candidates?.find(x=>x.programId===plan.wechatProgramId);
  const source=sourceManifest.coverImage;
  if(!c||!a||c.programId===a.programId||typeof instruction!=='string'||!instruction.trim()
      ||instruction.length>500||!source||sha(data)!==source.sha256||data.length!==source.bytes)
    fail('Shared cover requires the explicit user instruction and verified WeChat cover bytes');
  const image=roleCover({...source,sourceName:'用户指定公众号封面'},a.programId,a.programName,a.seasonLabel,'cover.jpg');
  return {data,image,proof:{mode:'user_selected_shared_cover',programmeId,programmeName:c.programName,
    coverProgrammeId:a.programId,coverProgrammeName:a.programName,coverSha256:source.sha256,
    userInstruction:instruction.trim()}};
}
function isSharedCover(manifest,proof,plan,programmeId){
  if(manifest.coverMode!=='user_selected_shared_cover')return false;
  const c=plan.candidates?.find(x=>x.programId===programmeId),a=plan.candidates?.find(x=>x.programId===plan.wechatProgramId);
  const source=proof.manifest||(proof.manifestText&&JSON.parse(proof.manifestText));
  const e=proof.matrixCover,cover=manifest.coverImage;
  if(!c||!a||c.programId===a.programId||manifest.selectedProgramId!==programmeId
      ||manifest.selectedProgramName!==c.programName||e?.mode!=='user_selected_shared_cover'
      ||e.programmeId!==c.programId||e.programmeName!==c.programName
      ||e.coverProgrammeId!==a.programId||e.coverProgrammeName!==a.programName
      ||typeof e.userInstruction!=='string'||!e.userInstruction.trim()||e.userInstruction.length>500
      ||e.coverSha256!==source?.coverImage?.sha256||cover?.sha256!==e.coverSha256
      ||JSON.stringify(e)!==JSON.stringify(manifest.matrixCoverEvidence)
      ||JSON.stringify(cover)!==JSON.stringify(manifest.platformCovers?.[manifest.targetPlatform]))
    fail('Shared cover does not match the user instruction and WeChat source');
  checkRoleCover(cover,plan,a.programId,'cover.jpg');
  return true;
}
function checkRoleCover(cover,plan,programmeId,expectedFile){
  const candidate=plan.candidates?.find(x=>x.programId===programmeId);
  if(!candidate||!cover||cover.programmeId!==programmeId
    ||cover.programmeName!==candidate.programName
    ||cover.season!==(candidate.seasonLabel||'')
    ||cover.bundleFile!==expectedFile||!/^[a-f0-9]{64}$/.test(cover.sha256||'')
    ||!Number.isInteger(cover.bytes)||cover.bytes<128)
    fail('Package cover programme does not match platform title plan');
  return cover;
}
if(typeof module!=='undefined'&&module.exports)module.exports={checkedMatrixCover,roleCover,checkRoleCover,manualCoverChoice,isManualCover,sharedCoverChoice,isSharedCover};
else if(typeof globalThis!=='undefined')globalThis.DraftHelperMatrixCover={checkRoleCover,isManualCover,isSharedCover};
})();
