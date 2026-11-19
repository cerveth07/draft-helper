'use strict';
const {chromium}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const scope=vm.createContext({});vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../other-platforms.js'),'utf8'),scope);
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent('<style>.ql-align-justify{text-align:justify}.ql-align-center{text-align:center}</style><div class="ql-editor" contenteditable="true" style="text-align:left"></div>');
  const prepared=await page.evaluate(({fn})=>(0,eval)('('+fn+')')('<section style="text-align:justify"><p style="text-align:left">左对齐小标题</p><p>两端对齐正文</p></section>'),{fn:scope.portalPrepareSohu.toString()});
  assert.deepEqual(prepared.alignments,[{text:'左对齐小标题',align:'left'},{text:'两端对齐正文',align:'justify'}]);
  assert.match(prepared.html,/text-align: left/);
  assert.match(prepared.html,/ql-align-justify/);
  const fixture=async()=>page.evaluate(()=>{
   const body=document.querySelector('.ql-editor');window.calls=[];
   const state=[{text:'重复段落',align:'justify'},{text:'重复段落',align:'center'},{text:'正文',align:'justify'}];
   const render=()=>{body.innerHTML=state.map(p=>'<p'+(p.align?' class="ql-align-'+p.align+'"':'')+'>'+p.text+'</p>').join('');};
   class Quill {static find(p){return p;}getIndex(p){return [...body.children].indexOf(p)*10;}formatLine(index,length,key,value,source){window.calls.push({index,length,key,value,source});state[index/10].align=value||'';render();}}
   body.__quill=new Quill();window.renderModel=render;render();
  });
  const restore=plan=>page.evaluate(({fn,plan})=>(0,eval)('('+fn+')')(plan,'.ql-editor'),{fn:scope.portalRestoreSohuAlign.toString(),plan});
  await fixture();
  const plan={alignments:[{text:'重复段落',align:'left'},{text:'重复段落',align:'center'},{text:'正文',align:'justify'}]};
  assert.deepEqual(await restore(plan),{changed:1});
  assert.deepEqual(await page.evaluate(()=>window.calls),[{index:0,length:1,key:'align',value:false,source:'user'}]);
  await page.evaluate(()=>window.renderModel());
  assert.deepEqual(await page.locator('.ql-editor p').evaluateAll(ps=>ps.map(p=>getComputedStyle(p).textAlign)),['left','center','justify']);
  assert.deepEqual(await restore(plan),{changed:0});
  await fixture();
  await assert.rejects(restore({alignments:[{text:'重复段落',align:'left'},{text:'段落已被改写',align:'center'}]}),/未找到搜狐第 2 段/);
  assert.equal(await page.evaluate(()=>window.calls.length),0,'all paragraphs must match before any native edits');
  console.log('PASS Sohu alignment: explicit source format; native model restoration; duplicate paragraph order; survives rerender; changed draft protected.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
