'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../image-localizer.js');
const img='data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==';
const qpic='https://mmbiz.qpic.cn/a/640?wx_fmt=png';
const item=(key,src)=>({key,src});
test('deduplicates identical article images and background references by canonical URL',async()=>{
  const assets=[item('a:image',qpic),item('b:image',qpic+'#fragment'),item('c:background:0',qpic)];
  let calls=0;const progress=[];
  const result=await L.run(assets,{isAllowed:async()=>true,resolve:async()=>{calls++;return img;},
    onProgress:value=>progress.push(value)});
  assert.equal(calls,1);
  assert.equal(result.total,1);assert.equal(result.success,1);
  assert.equal(result.positions,3);
  assert.deepEqual([...result.replacements.keys()],['a:image','b:image','c:background:0']);
  assert.equal(result.failures.length,0);
  assert.equal(progress.at(-1).finished,1);
});
test('unapproved origins are never fetched; a later manual retry only uses unresolved URLs',async()=>{
  const pending=[item('x',qpic),item('y','https://other.example/pic.png')];
  const received=[];
  const first=await L.run(pending,{isAllowed:async origin=>origin==='https://mmbiz.qpic.cn',
    resolve:async url=>{received.push(url);return img;}});
  assert.equal(received.length,1);assert.equal(first.positions,1);
  assert.equal(first.failures.length,1);assert.equal(first.failures[0].type,'permission');
  const second=await L.run(pending.filter(x=>!first.replacements.has(x.key)),{
    isAllowed:async()=>true,resolve:async url=>{received.push(url);return img;}});
  assert.equal(second.positions,1);
  assert.equal(received.length,2);
});
test('unsafe URLs are rejected before network requests',async()=>{
  for(const url of [
    'file:///etc/passwd','https://admin:secret@site.example/photo.jpg',
    'http://localhost/internal','http://127.0.0.1/image',
    'https://mmbiz.qpic.cn:8443/image.png',
    'http://192.168.1.1','http://10.0.0.1','http://172.31.0.3',
    'http://[::1]/image','http://metadata.local/pic',
  ])assert.throws(()=>L.safeUrl(url));
  assert.equal(L.safeUrl(qpic+'#section'),qpic);
  let calls=0;
  const result=await L.run([item('a','http://127.0.0.1/private'),item('b',qpic)],
    {isAllowed:async()=>true,resolve:async()=>{calls++;return img;}});
  assert.equal(calls,1);assert.equal(result.failures[0].type,'invalid');
});
test('partial failure does not lose successful work; non-image data fails',async()=>{
  const a='https://mmbiz.qpic.cn/a.png',b='https://mmbiz.qpic.cn/b.png';
  const result=await L.run([item('a',a),item('b',b)],{
    isAllowed:async()=>true,resolve:async url=>{
      if(url===b)return 'text/html; hi';
      return img;
    }
  });
  assert.equal(result.positions,1);
  assert.equal(result.failures.length,1);
  assert.equal(result.failures[0].type,'network');
});
test('limits the total in-memory payload while keeping completed downloads',async()=>{
  const data='data:image/png;base64,'+'A'.repeat(120);
  const result=await L.run([item('x','https://mmbiz.qpic.cn/one'),item('y','https://mmbiz.qpic.cn/two')],{
    concurrency:1,maxTotalBytes:100,isAllowed:async()=>true,resolve:async()=>data});
  assert.equal(result.success,1);
  assert.equal(result.positions,1);
  assert.equal(result.failures.length,1);
  assert.match(result.failures[0].reason,/总量超过/);
  assert.ok(result.downloadedBytes<=100);
});
test('parallel requests never exceed the bounded worker count',async()=>{
  let active=0,maxActive=0,calls=0;
  const assets=Array.from({length:13},(_,n)=>item(String(n),'https://mmbiz.qpic.cn/'+n));
  const result=await L.run(assets,{concurrency:100,isAllowed:async()=>true,resolve:async()=>{
    calls++;active++;maxActive=Math.max(active,maxActive);
    await new Promise(resolve=>setTimeout(resolve,2));
    active--;return img;
  }});
  assert.equal(result.success,13);
  assert.equal(calls,13);assert.ok(maxActive<=3);
});
