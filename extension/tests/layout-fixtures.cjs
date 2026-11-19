'use strict';
const {createHash}=require('node:crypto'),zlib=require('node:zlib');
const hash=b=>createHash('sha256').update(b).digest('hex');
const asFile=b=>({size:b.length,text:async()=>b.toString('utf8'),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)});
function png(r,g,b){
  const crc=bytes=>{let c=0xffffffff;for(const x of bytes){c^=x;for(let i=0;i<8;i++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;}return (c^0xffffffff)>>>0;};
  const chunk=(name,data)=>{const body=Buffer.concat([Buffer.from(name),data]),out=Buffer.alloc(12+data.length);out.writeUInt32BE(data.length);body.copy(out,4);out.writeUInt32BE(crc(body),8+data.length);return out;};
  const header=Buffer.alloc(13);header.writeUInt32BE(120,0);header.writeUInt32BE(80,4);header[8]=8;header[9]=2;
  const pixels=Buffer.alloc(80*361);for(let y=0;y<80;y++)for(let x=0;x<120;x++){const at=y*361+1+x*3;pixels[at]=r;pixels[at+1]=g;pixels[at+2]=b;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(pixels)),chunk('IEND',Buffer.alloc(0))]);
}
function source(html='<p>开头可编辑文字。</p><div style="display:flex;gap:16px"><img style="width:200px;height:120px" src="WECHATIMGPH_1_END"><img style="width:200px;height:120px" src="WECHATIMGPH_2_END"></div><p>结尾可编辑文字。</p>'){
  const assets=new Map([['assets/red.png',asFile(png(220,20,30))],['assets/blue.png',asFile(png(20,40,220))]]);
  const images=[...assets].map(([name,f],i)=>({placeholder:'WECHATIMGPH_'+(i+1)+'_END',bundleFile:name.slice(7),bytes:f.size,sha256:hash(i?png(20,40,220):png(220,20,30))})).filter(i=>html.includes(i.placeholder));
  const manifest={bundleContractVersion:1,targetPlatform:'wechat',title:'特殊排版回归测试',summary:'独立摘要',author:'测试作者',contentImages:images,coverImage:null};
  const manifestText=JSON.stringify(manifest);
  return {html,manifest,manifestText,assets,report:{bundle_contract_version:1,state:'PREPARED',remote_image_count:0,payload_sha256:hash(html),manifest_sha256:hash(manifestText)}};
}
module.exports={hash,asFile,png,source};
