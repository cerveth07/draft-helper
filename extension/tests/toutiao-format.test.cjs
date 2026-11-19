'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const T=require('../toutiao-format.js');
test('native Toutiao format keeps editable prose and replaces unsupported emphasis',()=>{
 const r=T.prepare('<section style="background-color:#eee;padding:20px"><p>普通正文正文正文<span style="color:#f00">重点</span><em>斜体</em><u>下划线</u><s>过时</s></p></section>');
 assert.match(r.html,/<strong>重点<\/strong><strong>斜体<\/strong><strong>下划线<\/strong><s>过时<\/s>/);
 assert.doesNotMatch(r.html,/<(?:em|u|section)\b|color:/);
 assert.match(r.changes.map(c=>c.detail).join(' '),/背景|装饰/);
 assert.equal(T.prepare(r.html).html,r.html);
});
test('native headings, alignment, indentation, links and lists remain ordered',()=>{
 const r=T.prepare('<h2 style="text-align:center">小标题</h2><p style="text-indent:2em;text-align:justify">正文<strong><a href="https://example.org">链接</a></strong></p><ul><li>条目</li></ul>');
 assert.match(r.html,/^<h1><strong>小标题<\/strong><\/h1><p style="text-align:justify">　　正文/);
 assert.match(r.html,/<strong><a href="https:\/\/example.org">链接<\/a><\/strong>/);
 assert.match(r.changes.find(c=>c.kind==='link').detail,/https:\/\/example.org/);
 assert.match(r.html,/<ul><li style="text-align:justify">条目<\/li><\/ul>/);
 assert.equal(T.prepare(r.html).html,r.html);
});
test('unsupported link protocols retain the visible label and original URL in the log',()=>{
 const r=T.prepare('<p><a href="mailto:test@example.org">联系邮箱</a></p>');assert.doesNotMatch(r.html,/<a /);assert.match(r.html,/联系邮箱/);assert.match(r.changes.find(c=>c.kind==='link').detail,/mailto:test@example.org/);
});
test('image display fallback records source dimensions and a preview position',()=>{
 const r=T.prepare('<p><img src="WECHATIMGPH_1_END" style="width:122.5px;height:auto" alt="图片"></p>');
 const change=r.changes.find(c=>c.kind==='image');assert.equal(change.imagePosition,1);assert.match(change.detail,/122.5px/);assert.match(change.detail,/原图尺寸和比例/);
});
test('plain tables remain native tables including merged cells and editable text',()=>{
 const r=T.prepare('<table><tbody><tr><th colspan="2">合并表头</th></tr><tr><td><p>甲</p></td><td rowspan="2">乙</td></tr><tr><td>丙</td></tr></tbody></table>');
 assert.match(r.html,/<table><tbody><tr><th colspan="2"><p style="text-align:justify"><strong>合并表头<\/strong><\/p><\/th>/);
 assert.match(r.html,/<td rowspan="2"><p style="text-align:justify">乙<\/p><\/td>/);assert.doesNotMatch(r.html,/<img/);
 assert.equal(T.prepare(r.html).html,r.html);
});
