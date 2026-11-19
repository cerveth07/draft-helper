'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const {chromium}=require(process.env.DRAFT_HELPER_PLAYWRIGHT_MODULE||'playwright-core');
(async()=>{const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.setContent('<meta property="og:description" content="来源页的分享摘要 &amp; 示例。"><meta name="description" content="另一段摘要"><style>#js_content p{font-size:18px;color:#234567}</style><h1 id="activity-name">读取预览稿</h1><span id="js_name">测试作者</span><div id="js_content"><p>原有正文</p><img class="wx_img_placeholder" src="data:image/svg+xml,placeholder" data-src="https://mmbiz.qpic.cn/example/640"></div><footer>页面外壳</footer>');
  await page.evaluate(()=>{window.msg_cdn_url='https://mmbiz.qpic.cn/mmbiz_jpg/example/640?wx_fmt=jpeg';});
  await page.addScriptTag({path:path.resolve(__dirname,'../import-fidelity.js')});await page.addScriptTag({path:path.resolve(__dirname,'../wechat-capture.js')});
  await page.evaluate(()=>{
    globalThis.chrome={tabs:{query:async()=>[{id:9,url:'https://mp.weixin.qq.com/s?tempkey=private-test-token'}],get:async()=>({id:9,url:'https://mp.weixin.qq.com/s?tempkey=private-test-token',status:'complete'}),create:async()=>{throw Error('Must reuse matching tab');}},scripting:{executeScript:async({func,args})=>[{result:await func(...args)}]}};
  });
  const publicArticle=await page.evaluate(()=>WechatCapture.readUrl('https://mp.weixin.qq.com/s?tempkey=private-test-token#rd'));
  assert.equal(publicArticle.summary,'来源页的分享摘要 & 示例。');
  assert.equal(publicArticle.title,'读取预览稿');assert.equal(publicArticle.author,'测试作者');assert.ok(publicArticle.html.includes('18px'));assert.ok(publicArticle.html.includes('https://mmbiz.qpic.cn/example/640'));
  assert.ok(!publicArticle.html.includes('页面外壳'));assert.ok(!JSON.stringify(publicArticle).includes('private-test-token'));assert.ok(!publicArticle.html.includes('wx_img_placeholder'));
  assert.equal(publicArticle.coverUrl,'https://mmbiz.qpic.cn/mmbiz_jpg/example/640?wx_fmt=jpeg','推文封面来自 msg_cdn_url');
  const rejected=await page.evaluate(()=>['http://mp.weixin.qq.com/s','https://mp.weixin.qq.com.attacker.test/s','https://user:secret@mp.weixin.qq.com/s','javascript:alert(1)'].map(url=>{try{WechatCapture.validateUrl(url);return false;}catch{return true;}}));assert.ok(rejected.every(Boolean));
  await page.evaluate(()=>{delete window.msg_cdn_url;document.body.insertAdjacentHTML('beforeend','<input id="title" value="草稿标题"><input id="author" value="草稿作者"><textarea id="js_description">草稿摘要</textarea><div id="js_cover"><img src="https://mmbiz.qpic.cn/mmbiz_jpg/cover/640?wx_fmt=jpeg"></div>');window.__MP_Editor_JSAPI__={invoke({apiName,sucCb}){if(apiName!=='mp_editor_get_content')throw Error('capture must only read');sucCb({content:'<p style="line-height:2">后台草稿正文</p>'});}};});
  const draftUrl='https://mp.weixin.qq.com/cgi-bin/appmsg?t=media/appmsg_edit&token=draft-fixture-token';
  await page.evaluate(url=>{
    chrome.tabs.query=async()=>[{id:9,url}];
    chrome.tabs.get=async()=>({id:9,url,status:'complete'});
  },draftUrl);
  const draft=await page.evaluate(url=>WechatCapture.readUrl(url),draftUrl);
  assert.equal(draft.sourceTabId,9);assert.ok(!JSON.stringify(draft).includes('draft-fixture-token'));
  assert.equal(draft.sourceKind,'wechat-draft');assert.equal(draft.title,'草稿标题');assert.equal(draft.summary,'草稿摘要');assert.ok(draft.html.includes('后台草稿正文'));
  assert.equal(draft.coverUrl,'https://mmbiz.qpic.cn/mmbiz_jpg/cover/640?wx_fmt=jpeg','草稿封面来自封面预览');
  await page.evaluate(()=>{delete window.__MP_Editor_JSAPI__;document.querySelector('#js_content').remove();});
  await assert.rejects(()=>page.evaluate(url=>WechatCapture.readUrl(url),draftUrl),/过期|验证/);
  console.log('PASS preview/public page capture, draft read-only API, metadata, cover URL (msg_cdn_url / cover preview), lazy-image handling, URL validation, no temporary token retention, expired/unavailable page error');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
