'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');
test('CLI generates and verifies a text-only package with the no-cover flag',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'draft-cli-text-'));
  const input=path.join(dir,'article.html'),output=path.join(dir,'bundle');fs.writeFileSync(input,'<p>这是一篇纯文字稿件。</p>');
  const prepared=spawnSync(process.execPath,[path.join(root,'prepare.mjs'),'--html',input,'--title','测试标题','--no-cover','--out-dir',output],{encoding:'utf8'});
  assert.equal(prepared.status,0,prepared.stderr);const manifest=JSON.parse(fs.readFileSync(path.join(output,'manifest.json')));
  assert.deepEqual(manifest.contentImages,[]);assert.equal(manifest.coverImage,null);
  const checked=spawnSync(process.execPath,[path.join(root,'verify.mjs'),output],{encoding:'utf8'});assert.equal(checked.status,0,checked.stdout);
});
test('missing images are preserved and produce an incomplete, non-successful package',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'draft-cli-missing-'));
  const input=path.join(dir,'article.html'),output=path.join(dir,'bundle');fs.writeFileSync(input,'<p>缺图稿件。</p><img src="not-found.png">');
  const result=spawnSync(process.execPath,[path.join(root,'prepare.mjs'),'--html',input,'--title','缺图测试','--out-dir',output],{encoding:'utf8'});
  assert.equal(result.status,1);const report=JSON.parse(fs.readFileSync(path.join(output,'preparation-report.json')));
  assert.equal(report.state,'INCOMPLETE');assert.equal(report.unresolved_images.length,1);assert.match(fs.readFileSync(path.join(output,'raw-content.txt'),'utf8'),/not-found.png/);
  assert.match(result.stdout,/INCOMPLETE/);assert.doesNotMatch(result.stdout,/已从正文移除/);
});
