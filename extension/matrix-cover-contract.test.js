'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const crypto=require('node:crypto');
const {checkedMatrixCover,roleCover,checkRoleCover}=require('./matrix-cover-contract');
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
test('B reviewed cover is bound to title plan and real WeChat source hashes',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'be-matrix-cover-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const plan={issueDate:'2026-10-20',wechatProgramId:'1',yidianProgramId:'2',
    candidates:[{programId:'1',programName:'A',seasonLabel:''},
      {programId:'2',programName:'B',seasonLabel:'第二季'},
      {programId:'3',programName:'C',seasonLabel:''}]};
  const pf=path.join(dir,'plan.json'),image=path.join(dir,'cover.jpg'),rf=path.join(dir,'receipt.json');
  fs.writeFileSync(pf,JSON.stringify(plan));fs.writeFileSync(image,Buffer.alloc(300,0xfe));
  const source='{"title":"A"}';
  const receipt={schema_version:'DRAFT_HELPER_MATRIX_COVER_DELIVERY_V1',status:'delivered',
    issue_date:plan.issueDate,programme_id:'2',programme_title:'B',season:'第二季',
    title_plan_sha256:sha(fs.readFileSync(pf)),source_wechat_manifest_sha256:sha(source),
    items:[{id:'2',filename:'cover.jpg',target:'cover.jpg',sha256:sha(fs.readFileSync(image))}]};
  fs.writeFileSync(rf,JSON.stringify(receipt));
  const found=checkedMatrixCover(rf,plan,'2',source,pf);
  assert.equal(found.image.programmeId,'2');
  assert.equal(found.data.length,300);
  assert.deepEqual(checkRoleCover(found.image,plan,'2','cover.jpg'),found.image);
  const a=roleCover({sha256:sha(source),bytes:300},'1','A','','cover-toutiao.jpg');
  assert.equal(checkRoleCover(a,plan,'1','cover-toutiao.jpg').programmeId,'1');
  assert.throws(()=>checkedMatrixCover(rf,plan,'3',source,pf),/does not match/);
  assert.throws(()=>checkedMatrixCover(rf,plan,'2','tampered',pf),/does not match/);
  fs.writeFileSync(image,Buffer.alloc(300,0xfd));
  assert.throws(()=>checkedMatrixCover(rf,plan,'2',source,pf),/differs/);
});
