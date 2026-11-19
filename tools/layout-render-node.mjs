/* Optional CLI Chrome renderer. Browser extension export needs no Node dependency. */
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
export async function renderLayout(input,onProgress=()=>{}){
  let chromium;
  const candidates=[process.env.DRAFT_HELPER_PLAYWRIGHT_MODULE,process.env.DRAFT_HELPER_PLAYWRIGHT_MODULE,'playwright-core','playwright'].filter(Boolean);
  for(const name of candidates){try{({chromium}=require(name));break;}catch{}}
  if(!chromium)throw Error('特殊排版需要本机 Chrome 渲染器。请安装 playwright-core，或通过 DRAFT_HELPER_PLAYWRIGHT_MODULE 指定现有模块；也可用扩展工作台导出。');
  const downloadedBrowser=chromium.executablePath();
  const executablePath=process.env.DRAFT_HELPER_BROWSER_PATH
    ||(fs.existsSync(downloadedBrowser)?downloadedBrowser:undefined);
  const browser=await chromium.launch({headless:true,...(executablePath?{executablePath}:{channel:'chrome'})});
  try{
    const page=await browser.newPage({viewport:{width:input.width+256,height:1000},deviceScaleFactor:1});
    await page.route(/^https?:/,route=>route.abort());
    await page.goto(pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../extension/layout-render.html')).href);
    const blocks=await page.evaluate(input=>DraftLayoutPage.load(input),input);
    if(blocks.some(b=>b.blocked))throw Error(blocks.filter(b=>b.blocked).map(b=>'特殊排版（源位置 '+b.start+'–'+b.end+'）'+b.blocked).join('\n'));
    const session=await page.context().newCDPSession(page);
    for(const [index,block] of blocks.entries()){
      onProgress('正在保留特殊排版 '+(index+1)+'/'+blocks.length+'…');
      const image=await session.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:block.clip});
      block.bytes=new Uint8Array(Buffer.from(image.data,'base64'));delete block.clip;
    }
    return blocks;
  }finally{await browser.close();}
}
