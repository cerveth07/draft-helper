/* Render in a temporary, inactive extension tab. Never attach to a user's editor. */
'use strict';
const DraftLayoutClient=(()=>{
  let running=false;
  async function render(input,onProgress=()=>{}){
    if(running)throw Error('另一个特殊排版任务正在处理，请等待完成。');
    running=true;let tab,attached=false;
    try{
      tab=await chrome.tabs.create({url:chrome.runtime.getURL('layout-render.html'),active:false});
      await chrome.debugger.attach({tabId:tab.id},'1.3');attached=true;
      const send=(method,params={})=>chrome.debugger.sendCommand({tabId:tab.id},method,params);
      let ready=false;
      for(let i=0;i<100&&!ready;i++){
        const result=await send('Runtime.evaluate',{expression:'Boolean(globalThis.DraftLayoutPage)',returnByValue:true});
        ready=result.result?.value===true;
        if(!ready)await new Promise(resolve=>setTimeout(resolve,100));
      }
      if(!ready)throw Error('特殊排版渲染页未能启动，请重新加载扩展。');
      await send('Emulation.setDeviceMetricsOverride',{width:input.width+256,height:1000,deviceScaleFactor:1,mobile:false});
      const result=await send('Runtime.evaluate',{expression:'DraftLayoutPage.load('+JSON.stringify(input)+')',awaitPromise:true,returnByValue:true});
      if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);
      const blocks=result.result?.value;
      if(!Array.isArray(blocks))throw Error('特殊排版分析没有返回有效区块。');
      if(blocks.some(b=>b.blocked))throw Error(blocks.filter(b=>b.blocked).map(b=>'特殊排版（源位置 '+b.start+'–'+b.end+'）'+b.blocked).join('\n'));
      for(const [index,block] of blocks.entries()){
        onProgress('正在保留特殊排版 '+(index+1)+'/'+blocks.length+'…');
        const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:block.clip});
        const binary=atob(image.data);block.bytes=Uint8Array.from(binary,c=>c.charCodeAt(0));
        delete block.clip;
      }
      return blocks;
    }finally{
      if(attached)await chrome.debugger.detach({tabId:tab.id}).catch(()=>{});
      if(tab)await chrome.tabs.remove(tab.id).catch(()=>{});
      running=false;
    }
  }
  return {render};
})();
