/* Remote image retrieval plan. Pure orchestration; no ambient browser permissions. */
'use strict';
const DraftImageLocalizer = (() => {
  const MAX_BYTES = 20 * 1024 * 1024;
  const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
  const PRIVATE_V4 = /^(?:127|10|0|192\.168|169\.254)\.|^172\.(?:1[6-9]|2\d|3[01])\.|^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./;
  function safeUrl(value) {
    const u = new URL(value);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port)
      throw Error('不支持的图片链接协议或内嵌凭据。');
    const host=u.hostname.toLowerCase().replace(/\.$/,'');
    if (!host || host==='localhost' || host.endsWith('.localhost')
      || host.endsWith('.local') || host.endsWith('.internal')
      || host==='[::1]' || host==='[::]' || host.startsWith('[fc') || host.startsWith('[fd')
      || host.startsWith('[fe80') || PRIVATE_V4.test(host))
      throw Error('出于安全考虑，不自动读取本机、内网或保留地址。');
    u.hash='';
    return u.href;
  }
  function candidates(assets) {
    const groups=new Map(),invalid=[];
    for (const asset of assets) {
      if (!/^https?:\/\//i.test(asset.src || '')) continue;
      try {
        const url=safeUrl(asset.src);
        if(!groups.has(url))groups.set(url,{url,origin:new URL(url).origin,keys:[]});
        groups.get(url).keys.push(asset.key);
      } catch(error) {
        invalid.push({src:asset.src,keys:[asset.key],reason:error.message});
      }
    }
    return {groups:[...groups.values()],invalid};
  }
  async function run(assets,{isAllowed,resolve,onProgress=()=>{},concurrency=3,maxTotalBytes=MAX_TOTAL_BYTES}={}) {
    if(typeof isAllowed!=='function'||typeof resolve!=='function')throw Error('没有提供图片读取或权限校验。');
    const {groups,invalid}=candidates(assets);
    if(groups.length>256)throw Error('本篇需要下载的不同图片超过 256 张，请分篇处理。');
    const replacements=new Map(),failures=invalid.map(item=>({url:item.src,reason:item.reason,keys:item.keys,type:'invalid'}));
    let cursor=0,finished=invalid.length,success=0,downloadedBytes=0;
    const progress=()=>onProgress({total:groups.length+invalid.length,finished,success,failed:failures.length});
    progress();
    const worker=async()=>{
      while(cursor<groups.length) {
        const group=groups[cursor++];
        try {
          const allowed=await isAllowed(group.origin,group.url);
          if(!allowed) {
            failures.push({url:group.url,keys:group.keys,reason:'需要授权该图片域名后重试。',type:'permission'});
          } else {
            const data=await resolve(group.url);
            if(typeof data!=='string'||!/^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i.test(data))
              throw Error('返回内容不是可识别的图片。');
            const binarySize=Math.floor((data.length-data.indexOf(',')-1)*3/4);
            if(binarySize>MAX_BYTES)throw Error('图片超过单张 20MB 上限。');
            if(downloadedBytes+binarySize>maxTotalBytes)throw Error('图片总量超过本轮下载上限，请分篇处理或使用本地素材。');
            downloadedBytes+=binarySize;
            for(const key of group.keys)replacements.set(key,data);
            success++;
          }
        } catch(error) {
          failures.push({url:group.url,keys:group.keys,reason:String(error.message||error).slice(0,240),type:'network'});
        } finally {finished++;progress();}
      }
    };
    await Promise.all(Array.from({length:Math.min(Math.max(1,Math.floor(concurrency)),3,groups.length)},()=>worker()));
    return {replacements,failures,total:groups.length+invalid.length,success,positions:replacements.size,downloadedBytes};
  }
  return {MAX_BYTES,MAX_TOTAL_BYTES,safeUrl,candidates,run};
})();
if(typeof module!=='undefined')module.exports=DraftImageLocalizer;
