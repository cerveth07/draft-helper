'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core'),T=require('../toutiao-format.js');
const scope=vm.createContext({});vm.runInContext(fs.readFileSync(path.join(__dirname,'../toutiao.js'),'utf8'),scope);
(async()=>{const browser=await chromium.launch({headless:true});try{
 const page=await browser.newPage();
 await page.setContent('<style>.ProseMirror{font:17px/1.75 sans-serif}.ProseMirror p{font-size:17px}h1{font-size:18px;font-weight:700}</style><div class="ProseMirror" contenteditable="true"></div>');
 const html=T.prepare('<h2>标题</h2><p style="text-indent:2em;text-align:center">正文<strong>强调</strong><s>删除线</s><a href="https://example.org">来源</a></p><table><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table>').html;
 await page.evaluate(html=>document.querySelector('.ProseMirror').innerHTML=html,html);
 await page.evaluate(()=>{for(const a of document.querySelectorAll('.ProseMirror a')){a.className='pgc-link';const wrapper=document.createElement('span');wrapper.contentEditable='false';wrapper.innerHTML='<templ style="display:none">'+a.outerHTML+'</templ><mask>'+a.outerHTML+'</mask>';a.replaceWith(wrapper);}});
 const call=()=>page.evaluate('('+scope.verifyToutiaoFormat.toString()+')('+JSON.stringify(html)+')');
 assert.equal((await call()).stylesMatch,true);
 const native=await page.evaluate('('+scope.toutiaoNativeImages.toString()+')('+JSON.stringify('<p><img src="https://example.org/original.png"></p>')+','+JSON.stringify([{uploadedType:'image/png',width:193,height:179}])+')');
 assert.match(native,/<div class="pgc-img"><img/);assert.match(native,/img_width="193"/);assert.doesNotMatch(native,/needCheck|paste=/);
 await page.evaluate(()=>{
  const body=document.querySelector('.ProseMirror'),host=document.createElement('div');host.className='syl-editor';body.before(host);host.append(body);
  host.__reactFiberTest={stateNode:{editor:{view:{dom:body},setHTML:(html,options)=>{if(!options.allowUndo||options.silent!==false)throw Error('native transaction must notify autosave and support undo');body.innerHTML=html;window.nativeWritten=true;}}}};
 });
 await page.evaluate('('+scope.pasteToutiaoBody.toString()+')('+JSON.stringify(html)+',true)');assert.equal(await page.evaluate(()=>window.nativeWritten),true);
 await page.evaluate(()=>document.querySelector('strong').outerHTML='标题');
 // Native headings carry their own bold weight; deleting a redundant strong is harmless.
 assert.equal((await call()).stylesMatch,true);
 await page.evaluate(()=>document.querySelector('p strong').outerHTML='强调');
 await assert.rejects(call(),/强调、标题或段落对齐不一致/);
 await page.evaluate(html=>document.querySelector('.ProseMirror').innerHTML=html,html);
 await page.evaluate(()=>{const a=document.createElement('a');a.href='https://wrong.example';a.textContent='额外文字';document.querySelector('.ProseMirror').append(a);});
 await assert.rejects(call(),/正文文字不一致/);
 console.log('PASS Toutiao native format readback: headings, emphasis, strike, alignment, links, table and changed-format protection');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
