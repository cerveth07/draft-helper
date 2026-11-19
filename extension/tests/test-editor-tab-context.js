'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname,'..','popup.js'),'utf8');
const from=src.indexOf('// Capture the active editor when the popup opens');
const to=src.indexOf('function readBundle(files) {',from);
const id=src.indexOf('function identifyDraftPlatform(address) {');
const idEnd=src.indexOf('function platformName(platform) {',id);
assert.ok(from>=0&&to>from&&id>=0&&idEnd>id);
const helper=src.slice(from,to)+'\n'+src.slice(id,idEnd)+'\n({currentEditorTab,identifyDraftPlatform});';

function simulate({initial={id:51,url:'https://mp.weixin.qq.com/cgi-bin/appmsg'},
                  active={id:51,url:'https://mp.weixin.qq.com/cgi-bin/appmsg'},
                  latest=null, injected=null}={}){
  let q=0,read=0,injectedCount=0;
  const chrome={
    tabs:{
      query:async()=>[q++===0?initial:active],
      get:async id=>{read++;assert.equal(id,active.id);if(!latest)throw Error('not permitted');return latest;}
    },
    scripting:{executeScript:async({target})=>{
      injectedCount++;assert.equal(target.tabId,active.id);
      if(injected===null)throw Error('host permission denied');
      return [{result:injected}];
    }}
  };
  const result=vm.runInNewContext(helper,{chrome,URL});
  return {...result,counts:()=>({queries:q,gets:read,injected:injectedCount})};
}
test('normal editor tab URL still matches its original supported platform',async()=>{
  const app=simulate();
  const tab=await app.currentEditorTab();
  assert.equal(app.identifyDraftPlatform(tab.url),'wechat');
  assert.equal(app.counts().gets,0);
});
test('missing Tab.url after Windows file selection reuses only the same original tab',async()=>{
  const app=simulate({active:{id:51}});
  const tab=await app.currentEditorTab();
  assert.equal(app.identifyDraftPlatform(tab.url),'wechat');
  assert.equal(app.counts().gets,0);
});
test('changed active tab cannot inherit another tab URL',async()=>{
  const app=simulate({active:{id:77},latest:{id:77,url:'https://mp.sohu.com/mpfe/v4/contentManagement/news/addarticle'}});
  const tab=await app.currentEditorTab();
  assert.equal(tab.id,77);
  assert.equal(app.identifyDraftPlatform(tab.url),'sohu');
  assert.equal(app.counts().gets,1);
});
test('when active tab URL is absent, read-only activeTab fallback resolves it',async()=>{
  const app=simulate({initial:{id:51},active:{id:51},injected:'https://mp.toutiao.com/profile_v4/graphic/publish'});
  const tab=await app.currentEditorTab();
  assert.equal(app.identifyDraftPlatform(tab.url),'toutiao');
  assert.equal(app.counts().injected,1);
});
test('unavailable URL reports editor recovery guidance instead of native Invalid URL',async()=>{
  const app=simulate({initial:{id:51},active:{id:51}});
  await assert.rejects(()=>app.currentEditorTab(),/Chrome 无法读取当前标签页地址/);
  assert.throws(()=>app.identifyDraftPlatform(''),/无法识别当前编辑页网址/);
});
test('non-HTTPS and unsupported editor tabs are rejected rather than selecting an unrelated tab',async()=>{
  const app=simulate({active:{id:51,url:'chrome://extensions'}});
  const tab=await app.currentEditorTab();
  assert.throws(()=>app.identifyDraftPlatform(tab.url),/请打开 HTTPS 编辑页/);
  assert.throws(()=>app.identifyDraftPlatform('https://example.com'),/当前标签页不是已支持的平台/);
});
test('actual filling path resolves editor context before opening any selected bundle',()=>{
  assert.match(src,/async function run\(\) \{\s*let stage = '识别当前编辑页';/);
  assert.match(src,/const tab = await currentEditorTab\(\);\s*const platform = identifyDraftPlatform\(tab\.url \|\| ''\);\s*stage = '读取准备目录';/);
});
