'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const S=require('../sohu-format.js');

test('nested containers flatten to complete native paragraphs and adaptation is idempotent',()=>{
  const html='<section><p>第一段</p><div><p>第二段</p><p>第三段</p></div></section>';
  const result=S.prepare(html);
  assert.equal(result.html,'<p>第一段</p><p>第二段</p><p>第三段</p>');
  assert.equal(S.prepare(result.html).html,result.html);
});

test('colored emphasis becomes bold without making the dominant body color bold',()=>{
  const result=S.prepare('<section style="color:#333"><p>正文正文正文正文<span style="color:#00b0f0">重点</span>结尾</p></section>');
  assert.equal(result.html,'<p>正文正文正文正文<strong>重点</strong>结尾</p>');
  assert.equal(result.counts.colorReplacements,1);
  assert.match(result.changes[0].detail,/加粗/);
  assert.equal(S.prepare(result.html).html,result.html);
});

test('paragraph indentation is added once and aligned headings use native styles',()=>{
  const result=S.prepare('<p style="font-size:15px;text-indent:2em">正文<span style="text-indent:2em">片段</span></p><h2 style="font-size:24px;text-align:center">标题</h2>');
  assert.equal(result.html,'<p>　　正文片段</p><h2><strong>标题</strong></h2>');
  assert.equal(result.counts.indents,1);
  assert.equal(S.prepare(result.html).html,result.html);
});

test('lists, links, quotes, images and explicit breaks retain their structure and sequence',()=>{
  const result=S.prepare('<ul><li>甲</li><li><p>乙</p></li></ul><blockquote>引用<br>续行</blockquote><p>图前<a href="https://example.com"><img src="WECHATIMGPH_1_END" alt="图"></a>图后</p>');
  assert.match(result.html,/<ul><li>甲<\/li><li>乙<\/li><\/ul>/);
  assert.match(result.html,/<blockquote>引用<br>续行<\/blockquote>/);
  assert.match(result.html,/<p>图前<\/p><p><a href="https:\/\/example.com"><img/);
  assert.match(result.html,/<\/a><\/p><p>图后<\/p>$/);
  assert.equal(result.counts.images,1);
});

test('large text inside inline spans retains heading structure while older packages remain verifiable',()=>{
  const html='<p><span style="font-size:24px">独立标题</span></p><p>正文</p>';
  assert.equal(S.prepare(html).html,'<h2>独立标题</h2><p>正文</p>');
  assert.equal(S.prepare(html,{legacyHeadings:true}).html,'<p>独立标题</p><p>正文</p>');
});
