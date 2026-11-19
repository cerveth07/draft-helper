/* Generic post-WeChat distribution. No matrix editorial assumptions. */
'use strict';
const DraftDistribution = (() => {
  const layoutCore=()=>typeof DraftLayout!=='undefined'?DraftLayout
    :typeof require==='function'?require('./layout-core.js'):null;
  const sohuCore=()=>typeof DraftSohuFormat!=='undefined'?DraftSohuFormat
    :typeof require==='function'?require('./sohu-format.js'):null;
  const toutiaoCore=()=>typeof DraftToutiaoFormat!=='undefined'?DraftToutiaoFormat
    :typeof require==='function'?require('./toutiao-format.js'):null;
  const yidianCore=()=>typeof DraftYidianFormat!=='undefined'?DraftYidianFormat
    :typeof require==='function'?require('./yidian-format.js'):null;
  const CONTRACT = 'DRAFT_HELPER_DISTRIBUTION_V1';
  // 目标配置档：所有按“推送位 × 平台”变化的默认值集中在这里。
  // verified=false 的规则只作为默认建议，未在真实平台编辑页验收，因此不阻断填写。
  const PROFILES = Object.freeze({
    'wechat-head': Object.freeze({
      id:'wechat-head', platform:'wechat', slot:'head', label:'微信公众号·头条',
      title:Object.freeze({min:1,max:64}),
      summary:Object.freeze({mode:'auto',max:120,note:'留空时自动取正文前 100 字'}),
      author:Object.freeze({mode:'optional'}),
      cover:Object.freeze({mode:'single',required:true,ratio:'2.35:1',recommended:'900×383',
        auto:'first-body-image',note:'头条大图封面；默认取正文第一张非 GIF 图'}),
      notes:Object.freeze(['头条封面为大图（2.35:1）；正文、标题、摘要按公众号编辑器核对后手动保存。']),
      verified:Object.freeze({title:true,summary:true,cover:true})
    }),
    'wechat-sub': Object.freeze({
      id:'wechat-sub', platform:'wechat', slot:'sub', label:'微信公众号·次条',
      title:Object.freeze({min:1,max:64}),
      summary:Object.freeze({mode:'auto',max:120,note:'留空时自动取正文前 100 字'}),
      author:Object.freeze({mode:'optional'}),
      cover:Object.freeze({mode:'single',required:false,ratio:'1:1',recommended:'500×500',
        auto:'none',note:'次条封面为方形小图；不自动取正文首图，需要时用 --cover 指定'}),
      notes:Object.freeze(['次条封面为 1:1 方图，与头条大图不同；未自动选择封面时请在编辑器内单独设置。']),
      verified:Object.freeze({title:true,summary:true,cover:false})
    }),
    yidian: Object.freeze({
      id:'yidian', platform:'yidian', label:'一点资讯',
      title:Object.freeze({min:5,max:64}),
      summary:Object.freeze({mode:'carry',max:null,note:'随包保留来源摘要；平台摘要字段待实页验收'}),
      author:Object.freeze({mode:'carry',note:'随包保留作者'}),
      cover:Object.freeze({mode:'single',required:false,ratio:null,recommended:null,auto:'none',
        note:'封面入口与比例以一点资讯编辑器为准，待实页验收'}),
      upload:Object.freeze({maxBytes:6*1024*1024,maxImages:80,
        note:'一点号图片接口单张上限 6MB；单篇正文最多 80 张图（用户守则）'}),
      notes:Object.freeze(['一点号标题 5–64 字；颜色、字号档位和强调使用可保存格式，平台不支持的排版逐处记入处理日志。']),
      verified:Object.freeze({title:true,summary:false,cover:false})
    }),
    toutiao: Object.freeze({
      id:'toutiao', platform:'toutiao', label:'今日头条',
      title:Object.freeze({min:2,max:30}),
      summary:Object.freeze({mode:'not-used',max:null,note:'头条图文无摘要字段；摘要仅随包保留供人工参考'}),
      author:Object.freeze({mode:'not-used',note:'头条作者为账号本身，不单独填写'}),
      cover:Object.freeze({mode:'multi',required:false,options:Object.freeze(['单图','三图','无图']),
        ratio:null,recommended:null,auto:'none',note:'头条在发布时选择单图／三图／无图；准备包只保留素材'}),
      notes:Object.freeze(['头条标题 2–30 字，不自动截断；封面模式（单图／三图／无图）在平台侧选择。']),
      verified:Object.freeze({title:true,summary:false,cover:false})
    }),
    penguin: Object.freeze({
      id:'penguin', platform:'penguin', label:'企鹅号',
      title:Object.freeze({min:5,max:64}),
      summary:Object.freeze({mode:'carry',max:null,note:'随包保留来源摘要；平台摘要字段待实页验收'}),
      author:Object.freeze({mode:'carry',note:'随包保留作者'}),
      cover:Object.freeze({mode:'single',required:false,ratio:null,recommended:null,auto:'none',
        note:'封面入口与比例以企鹅号编辑器为准，待实页验收'}),
      notes:Object.freeze(['企鹅号标题 5–64 字；正文按微信原稿保留，实页检查图片与样式。']),
      verified:Object.freeze({title:true,summary:false,cover:false})
    }),
    weibo: Object.freeze({
      id:'weibo', platform:'weibo', label:'微博头条文章',
      title:Object.freeze({min:1,max:32}),
      summary:Object.freeze({mode:'optional',max:44,note:'微博导语可选，最多 44 字；请单独确认，不自动截断'}),
      author:Object.freeze({mode:'not-used',note:'署名入口因账号而异，作者信息仅随包保留'}),
      cover:Object.freeze({mode:'single',required:false,ratio:null,recommended:null,auto:'none',
        note:'携带原封面供人工选择、裁剪；未设置封面时微博预览可能沿用上一篇文章，请核对是否与本稿相符'}),
      notes:Object.freeze(['标题按 32 字、导语按 44 字预检，当前账号限制以编辑页为准。',
        '正文文字与图片顺序保留；微信复杂样式可能被微博过滤。',
        '使用已登录的微博头条文章编辑器，填入后核对并手动保存。']),
      verified:Object.freeze({title:false,summary:false,cover:false})
    }),
    sohu: Object.freeze({
      id:'sohu', platform:'sohu', label:'搜狐号',
      title:Object.freeze({min:5,max:72}),
      summary:Object.freeze({mode:'carry',max:null,note:'随包保留来源摘要；平台摘要字段待实页验收'}),
      author:Object.freeze({mode:'carry',note:'随包保留作者'}),
      cover:Object.freeze({mode:'single',required:false,ratio:null,recommended:null,auto:'none',
        note:'封面入口与比例以搜狐号编辑器为准，待实页验收'}),
      notes:Object.freeze(['搜狐号标题 5–72 字；生成包时适配可保存格式，彩色强调转为加粗。请预览转换说明，并在保存后重新打开核对。']),
      verified:Object.freeze({title:true,summary:false,cover:false})
    })
  });
  const PLATFORMS = Object.freeze(Object.fromEntries(
    Object.values(PROFILES).filter(profile=>profile.platform!=='wechat')
      .map(profile=>[profile.platform,Object.freeze({
        label:profile.label,min:profile.title.min,max:profile.title.max})])));
  function profileFor(target, slot) {
    const id = target === 'wechat' ? (slot === 'sub' ? 'wechat-sub' : 'wechat-head') : target;
    const profile = PROFILES[id];
    if (!profile) throw new Error('尚不支持的平台：' + target);
    return profile;
  }
  const profileSpecOf = profile => ({
    id: profile.id, version: 1, label: profile.label,
    title: {min: profile.title.min, max: profile.title.max},
    summary: {mode: profile.summary.mode, max: profile.summary.max ?? null},
    author: {mode: profile.author.mode},
    cover: {mode: profile.cover.mode, required: profile.cover.required,
      ratio: profile.cover.ratio ?? null, auto: profile.cover.auto},
    upload: profile.upload ? {maxBytes: profile.upload.maxBytes, maxImages: profile.upload.maxImages ?? null} : null,
    verified: {...profile.verified}
  });
  function profileChecks(profile, meta) {
    const checks=[];
    checks.push({rule:'title', state:'pass',
      detail: profile.title.min+'–'+profile.title.max+' 字（当前 '+[...(meta.title||'')].length+' 字）'});
    if (profile.summary.mode === 'not-used')
      checks.push({rule:'summary', state:'not-used', detail:profile.summary.note});
    else checks.push({rule:'summary', state:(meta.summary||'').trim() ? 'pass' : (profile.summary.mode==='optional'?'ok':'warn'),
      detail:(meta.summary||'').trim() ? '摘要随包携带' : (profile.summary.mode==='optional'?'导语可选，未填写':'未填写摘要')});
    if (profile.author.mode === 'not-used')
      checks.push({rule:'author', state:'not-used', detail:profile.author.note});
    else checks.push({rule:'author', state:'pass', detail:(meta.author||'').trim() ? '作者随包携带' : '作者可选，未填写'});
    if (profile.cover.required && !meta.coverImage)
      checks.push({rule:'cover', state:'warn', detail:profile.cover.note});
    else checks.push({rule:'cover', state: meta.coverImage ? 'pass' : 'ok',
      detail: meta.coverImage ? '封面随包携带；比例请在目标平台确认' : '该目标封面可选，未携带封面'});
    if (profile.upload?.maxBytes) {
      const oversize = oversizeFor(profile, {contentImages: meta.images || [], coverImage: meta.coverImage,uploadCopies:meta.uploadCopies});
      checks.push({rule:'upload', state: oversize.length ? 'warn' : 'pass',
        detail: oversize.length
          ? '超过平台单张上限 ' + megabytes(profile.upload.maxBytes) + '：'
            + oversize.map(item=>item.bundleFile+'（'+megabytes(item.bytes)+'）').join('、')
          : '图片均在平台单张上限 ' + megabytes(profile.upload.maxBytes) + ' 内'});
    }
    if (profile.upload?.maxImages) {
      const count = (meta.images || []).length;
      checks.push({rule:'upload-count', state: count > profile.upload.maxImages ? 'warn' : 'pass',
        detail: count > profile.upload.maxImages
          ? '正文 ' + count + ' 张图，超过平台单篇上限 ' + profile.upload.maxImages + ' 张，请拆分后再填'
          : '正文 ' + count + ' 张图，在平台单篇上限 ' + profile.upload.maxImages + ' 张内'});
    }
    return checks;
  }
  const megabytes = bytes => (bytes/1048576).toFixed(1)+'MB';
  // 平台上传统计的是原始文件字节数；填入前用它拦住超限图片，避免上传到一半才被平台拒绝。
  function oversizeFor(profile, manifest) {
    const limit = profile?.upload?.maxBytes;
    if (!limit) return [];
    const items = [...(manifest?.contentImages || []), ...(manifest?.coverImage ? [manifest.coverImage] : [])]
      .map(item=>manifest?.uploadCopies?.find(copy=>copy.sourceFile===item.bundleFile)||item);
    return items.filter(item => Number.isSafeInteger(item?.bytes) && item.bytes > limit)
      .map(item => ({bundleFile: item.bundleFile, bytes: item.bytes}));
  }
  const hex = value => /^[a-f0-9]{64}$/i.test(value || '');
  const fileName = value => typeof value === 'string' && value.length <= 200
    && value !== '.' && value !== '..' && !/[\/\\\x00-\x1f\x7f]/.test(value);
  const digest = async bytes => {
    if (!globalThis.crypto?.subtle) throw new Error('需要浏览器安全上下文或 Node.js Web Crypto。');
    return [...new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))]
      .map(value=>value.toString(16).padStart(2,'0')).join('');
  };
  const hashText = text => digest(new TextEncoder().encode(text));
  const hashFile = async file => digest(await file.arrayBuffer());
  const imgTags = /<img\b[^>]*>/gi;
  const srcAttr = /(\ssrc\s*=\s*)(["'])(.*?)\2/i;
  // 微信正文里常有 1×1 的追踪像素/占位小图。目标平台的图片上传会把它当无效图静默丢弃，
  // 于是头条那条“贴上去等新图出现”的流程一直等不到结果，最后 30 秒超时。
  // 这种图没有任何可见内容，转换阶段直接整段剔除，正文和清单一起收敛。
  function imageDimensions(bytes) {
    const b = bytes, be32 = (at) => ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
    const le16 = (at) => b[at] | (b[at + 1] << 8), le24 = (at) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
    if (b.length >= 10 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return {width: le16(6), height: le16(8)};
    if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
      return {width: be32(16), height: be32(20)};
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
      let at = 2;
      while (at + 9 < b.length) {
        if (b[at] !== 0xff) { at += 1; continue; }
        const marker = b[at + 1];
        if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
          return {width: (b[at + 7] << 8) | b[at + 8], height: (b[at + 5] << 8) | b[at + 6]};
        at += 2 + ((b[at + 2] << 8) | b[at + 3]);
      }
      return null;
    }
    if (b.length >= 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57) {
      const kind = String.fromCharCode(b[12], b[13], b[14], b[15]);
      if (kind === 'VP8X') return {width: 1 + le24(24), height: 1 + le24(27)};
      if (kind === 'VP8 ') return {width: le16(26) & 0x3fff, height: le16(28) & 0x3fff};
      if (kind === 'VP8L') {
        const v = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0;
        return {width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1};
      }
    }
    return null;
  }
  function isSpacerImage(bytes) {
    if (!bytes || bytes.length > 1024 * 1024) return false;
    const size = imageDimensions(bytes);
    return !!size && (size.width <= 1 || size.height <= 1);
  }
  // 平台包里被剔掉的图仍在 assets 里（ZIP 与目录都带着），verify 才能重算出同样的结果。
  async function spacerPlaceholders(images, assets) {
    const skip = new Set();
    for (const item of images || []) {
      const file = assets?.get?.('assets/' + item.bundleFile);
      if (!file?.arrayBuffer) continue;
      try {
        if (isSpacerImage(new Uint8Array(await file.arrayBuffer()))) skip.add(item.placeholder);
      } catch (_) { /* 读不出的素材交给后面的哈希校验报错 */ }
    }
    return skip;
  }
  const badMarkup = /<\s*(?:script|iframe|object|embed|form)\b|javascript\s*:|\son[a-z]+\s*=/i;
  const remoteImage = /<(?:img|source)\b[^>]*\s(?:src|srcset|data-src)\s*=\s*["']\s*(?:https?:|\/\/)|url\(\s*["']?(?:https?:|\/\/)/i;

  function platformRules(platform, title) {
    const config = PLATFORMS[platform];
    if (!config) throw new Error('尚不支持的平台：' + platform);
    const value = String(title || '').trim();
    const size = [...value].length;
    if (size < config.min || size > config.max)
      throw new Error(config.label + '标题必须为 ' + config.min + '–' + config.max
        + ' 字（当前 ' + size + ' 字）。请人工填写符合平台要求的标题，不自动裁切。');
    return value;
  }

  function platformSummary(platform, summary) {
    const profile=profileFor(platform),value=platform==='weibo'?String(summary ?? '').trim():String(summary ?? '');
    if (platform==='weibo' && [...value].length>profile.summary.max)
      throw new Error('微博导语最多 44 字（当前 '+[...value].length+' 字）。请单独修改或留空，不自动截断。');
    return value;
  }

  // Convert local CSS background image slots into ordinary inline images at the
  // original container. Content remains in order; layout differences are reported.
  // The narrow HTML tag tokenizer rejects unsupported contexts instead of losing assets.
  function materializeBackgrounds(html, imageMap, validationOnly = false) {
    let count=0;
    const tags=/<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
    const voidTags=new Set(['img','source','br','hr','input','meta','link','area','base','embed','param','track','wbr']);
    const decodeStyle=value=>value.replace(/&quot;|&#34;|&#x22;/gi,'"')
      .replace(/&apos;|&#39;|&#x27;/gi,"'").replace(/&amp;/gi,'&');
    const urlPattern=/url\(\s*(?:"|')?\s*([^"'()]+?)\s*(?:"|')?\s*\)/gi;
    const result=html.replace(tags,(full,tag,attrs)=>{
      const style=attrs.match(/(\sstyle\s*=\s*)(["'])([\s\S]*?)\2/i);
      if(!style)return full;
      const raw=decodeStyle(style[3]),positions=[];
      const declarations=raw.split(';').map(declaration=>{
        const links=[...declaration.matchAll(urlPattern)];
        if(!links.length)return declaration;
        const background=/^\s*background(?:-image)?\s*:/i.test(declaration);
        if(!background&&links.some(match=>imageMap.has(match[1].trim())))
          throw Error('图片用于非背景样式，无法安全转换：'+tag);
        if(!background)return declaration;
        return declaration.replace(urlPattern,(matched,link)=>{
          const token=link.trim();
          if(!imageMap.has(token))
            throw Error('CSS 背景包含无法核验的资源，请先完成图片本地化。');
          positions.push(token);
          return 'none';
        });
      });
      if(!positions.length)return full;
      if(validationOnly){
        // Validation collects local background slots without rendering a fallback.
        // Source-markup mode retains SVG and void-element CSS.
        const quote=style[2],encoded=declarations.join(';').replace(/&/g,'&amp;')
          .replace(quote==='"'?/"/g:/'/g,quote==='"'?'&quot;':'&#39;');
        count+=positions.length;
        return full.replace(style[0],style[1]+quote+encoded+quote)
          +positions.map(token=>'<img src="'+token+'" data-draft-background-check="true">').join('');
      }
      if(voidTags.has(tag.toLowerCase())||/\/\s*>$/.test(full)
          ||!['section','div','article','main','p','header','footer','blockquote','figure','li','td','th','span','h1','h2','h3','h4','h5','h6'].includes(tag.toLowerCase()))
        throw Error('CSS 背景位于无法安全插入正文图的元素：'+tag);
      const quote=style[2], encoded=declarations.join(';').replace(/&/g,'&amp;')
        .replace(quote==='"'?/"/g:/'/g,quote==='"'?'&quot;':'&#39;');
      const updated=attrs.replace(style[0],style[1]+quote+encoded+quote);
      count+=positions.length;
      return '<'+tag+updated+'>'+positions.map(token=>'<img src="'+token
        +'" data-draft-background-fallback="true">').join('');
    });
    return {html:result,count};
  }

  // 微信导出的 HTML 会把来源平台的远程地址留在一些用不到的地方：<p src="https://mmbiz...">、
  // <img data-croporisrc="...">、<section data-src="...">、<section data-lazy-bgimg="...">。
  // 这些属性不参与渲染（src 只对少数标签有效，data-* 是微信自己的懒加载标记），
  // 却会把来源 CDN 地址带进目标包，可能触发防盗链或审核。统一去掉，链接 href 不受影响。
  const SRC_TAGS = new Set(['img', 'source', 'video', 'audio', 'iframe', 'script', 'embed', 'input', 'track']);
  function stripForeignUrls(html) {
    return html.replace(/<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi, (full, tag, attrs) => {
      const name = tag.toLowerCase();
      let changed = false;
      const next = attrs.replace(/\s([\w:-]+)\s*=\s*("[^"]*"|'[^']*')/g, (match, attr, value) => {
        const key = attr.toLowerCase();
        const bare = value.slice(1, -1).trim();
        if (!/^(?:https?:)?\/\//i.test(bare)) return match;
        if (key === 'href' || key === 'action' || key === 'content' || key === 'poster') return match;
        if (key === 'src' && SRC_TAGS.has(name)) return match;
        if (key !== 'src' && !key.startsWith('data-')) return match;
        changed = true;
        return '';
      });
      return changed ? '<' + tag + next + '>' : full;
    });
  }

  function rewrite(html, sourceImages, options = {}) {
    if (options.preserveMarkup) {
      // Run the existing structural/resource checks, keeping the exact original
      // markup and asset references for CKEditor instead of materializing CSS
      // backgrounds, renumbering images or dropping spacing/decorative assets.
      rewrite(html, sourceImages, {validatePreservedBackgrounds:true});
      return {html,contentImages:sourceImages.map(item=>({...item})),backgroundFallbackCount:0,
        droppedSpacerImages:[],droppedInlineIcons:[],replacedInlineEmoji:[]};
    }
    if (typeof html !== 'string' || !Array.isArray(sourceImages)) throw new Error('来源正文或图片清单无效。');
    if (badMarkup.test(html) || remoteImage.test(html))
      throw new Error('来源正文包含活动标记或远程图片，不能安全转换。');
    const skip = options.skip instanceof Set ? options.skip : new Set();
    const imageMap = new Map();
    for (const item of sourceImages) {
      if (!item || typeof item.placeholder !== 'string' || !/^WECHATIMGPH_[\w-]+$/.test(item.placeholder)
          || imageMap.has(item.placeholder) || !fileName(item.bundleFile)
          || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || !hex(item.sha256))
        throw new Error('来源图片清单无效或存在重复占位符。');
      imageMap.set(item.placeholder, item);
    }
    const backgrounds=materializeBackgrounds(html,imageMap,options.validatePreservedBackgrounds===true);
    backgrounds.html=stripForeignUrls(backgrounds.html);
    if (skip.size) {
      // 整段只放这一张空图的 <p>：连容器一起删，免得正文多出空行。
      for (const placeholder of skip) {
        const token = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        backgrounds.html = backgrounds.html.replace(
          new RegExp('<p\\b[^>]*>\\s*<img\\b[^>]*' + token + '[^>]*>\\s*</p>', 'gi'), '');
      }
    }
    const images = [], used = new Set(skip), inlineIcons = [], inlineEmoji=[];
    // Exact original bytes verified against the official WeChat Expression_77
    // (sun) and Expression_76 (moon), avoiding guesses from generic alt="图片".
    const nativeEmoji={
      '5e00b99be0fe2c54c53c988f4eff0a4c413c20ff53b9c661b903e9e4c81ef774':'☀️',
      'cf916926bd520c73b147e8bf720ba43f4a2d6a328b469dbd53b1e0a3b4d0ba42':'🌙'
    };
    // 微信正文里的小装饰（星标、圆点）常写成 width:13px 的内联图。头条编辑器把每一张图
    // 都当块级图片处理（自带“编辑/搜图”和图片描述框），13px 的装饰会被撑成整栏大图，
    // 所以头条包直接略过这类小图，文字与段落不受影响。
    const inlineIconWidth = (tag) => {
      const style = tag.match(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      if (!style) return 0;
      const widths = [...(style[1] ?? style[2] ?? '').matchAll(/(?:^|;)\s*width\s*:\s*([\d.]+)px/gi)];
      return widths.length ? Number(widths.at(-1)[1]) : 0;
    };
    const dropInlineIcons = options.dropInlineIcons === true;
    const converted = backgrounds.html.replace(imgTags, tag => {
      const source = tag.match(srcAttr);
      if (!source) throw new Error('存在缺少 src 的正文图片，请先在工作台补齐。');
      const item = imageMap.get(source[3]);
      if (!item) throw new Error('正文图片不在本地准备包清单内：' + source[3].slice(0, 60));
      if (skip.has(item.placeholder)) { used.add(item.placeholder); return ''; }
      const emojiStyle=tag.match(/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
      const emojiCss=emojiStyle?.[1]??emojiStyle?.[2]??'';
      const emojiWidth=emojiCss.match(/(?:^|;)\s*width\s*:\s*([\d.]+)(px|em|rem)/i);
      const emojiPixels=emojiWidth?Number(emojiWidth[1])*(emojiWidth[2]==='px'?1:Number(emojiCss.match(/(?:^|;)\s*font-size\s*:\s*([\d.]+)px/i)?.[1]||16)):0;
      if(options.nativeEmoji&&nativeEmoji[item.sha256]&&emojiPixels>0&&emojiPixels<=32){
        used.add(item.placeholder);inlineEmoji.push({placeholder:item.placeholder,bundleFile:item.bundleFile,text:nativeEmoji[item.sha256],position:inlineEmoji.length+1});
        return nativeEmoji[item.sha256];
      }
      if (dropInlineIcons) {
        const width = inlineIconWidth(tag);
        if (width > 0 && width <= 32) {
          used.add(item.placeholder);
          inlineIcons.push({placeholder:item.placeholder,bundleFile:item.bundleFile,width});
          return '';
        }
      }
      used.add(item.placeholder);
      const placeholder = 'WECHATIMGPH_' + (images.length + 1) + '_END';
      images.push({placeholder,bundleFile:item.bundleFile,bytes:item.bytes,sha256:item.sha256});
      return tag.replace(srcAttr, (_, prefix, quote) => prefix + quote + placeholder + quote);
    });
    for(const item of sourceImages) {
      if(!used.has(item.placeholder))
        throw new Error('来源图片清单包含未在正文引用的素材：'+item.bundleFile);
    }
    for (const placeholder of imageMap.keys()) {
      if (skip.has(placeholder)) continue;
      if (backgrounds.html.replace(imgTags, tag=>tag.replace(srcAttr,'')).includes(placeholder)) throw new Error('图片占位符出现在正文图片 src 以外，可能属于背景图或非兼容组件：' + placeholder);
    }
    if (!converted.replace(/<[^>]*>/g,'').trim() && !images.length) throw new Error('正文为空。');
    let cleaned = converted;
    if (inlineIcons.length) {
      // 删掉装饰图后，包着它的 inline-block 会剩下一串空壳（13px 宽，外加上下 padding），
      // 段落开头会凭空多出一点缩进；逐层清掉这些空壳，直到没有可删的为止。
      const emptyInline = /<section\b([^>]*)>\s*<\/section>/gi;
      for (let pass = 0; pass < 4; pass += 1) {
        const next = cleaned.replace(emptyInline, (full, attrs) => (/display\s*:\s*inline-block/i.test(attrs) ? '' : full));
        if (next === cleaned) break;
        cleaned = next;
      }
    }
    return {html: cleaned, contentImages: images, backgroundFallbackCount:backgrounds.count,
      droppedSpacerImages:sourceImages.filter(item=>skip.has(item.placeholder)),
      droppedInlineIcons: inlineIcons,replacedInlineEmoji:inlineEmoji};
  }

  async function verifySource(source, platform) {
    if (!source || typeof source.html !== 'string' || typeof source.manifestText !== 'string'
        || !(source.assets instanceof Map) || !source.manifest || !source.report)
      throw new Error('来源准备包结构不完整。');
    const {html,manifest,manifestText,report,assets} = source;
    if (manifest.bundleContractVersion !== 1 || (manifest.targetPlatform || 'wechat') !== 'wechat'
        || report.bundle_contract_version !== 1 || report.state !== 'PREPARED'
        || report.remote_image_count !== 0)
      throw new Error('需要已完成、无远程图片的微信公众号 v1 准备包。');
    if (!hex(report.payload_sha256) || await hashText(html) !== report.payload_sha256
        || !hex(report.manifest_sha256) || await hashText(manifestText) !== report.manifest_sha256)
      throw new Error('来源正文或 manifest SHA-256 校验不通过。');
    if (!Array.isArray(manifest.contentImages)) throw new Error('来源缺少 contentImages 清单。');
    const items = [...manifest.contentImages, ...(manifest.coverImage ? [manifest.coverImage] : [])];
    for (const item of items) {
      if (!fileName(item?.bundleFile) || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 || !hex(item.sha256))
        throw new Error('来源素材清单无效。');
      const file = assets.get('assets/' + item.bundleFile);
      if (!file || file.size !== item.bytes || await hashFile(file) !== item.sha256)
        throw new Error('来源素材缺失或已改动：' + item.bundleFile);
    }
    return rewrite(html, manifest.contentImages,
      {skip: await spacerPlaceholders(manifest.contentImages, assets),
        dropInlineIcons: platform === 'toutiao'});
  }

  const warningsFor = (html, images, backgroundCount=0, inlineIconCount=0,platform) => {
    const warnings=[];
    if(backgroundCount)warnings.push('有 '+backgroundCount+' 处 CSS 背景图已转成正文图片；原先叠层、裁剪和留白需在目标平台检查。');
    if(inlineIconCount)warnings.push('已略过 '+inlineIconCount+' 张 32px 以下的装饰小图（星标、圆点）：'+(platform==='yidian'?'一点号会把行内图片移到段首，装饰位置无法保留':'头条把每张图都当块级图片，内联装饰放不进去')+'，文字不受影响。');
    if (/<(?:svg|table|video|audio)\b/i.test(html)) warnings.push('存在复杂组件：各平台可能清理 SVG、表格或媒体标签，需实页核对。');
    if (/style\s*=|<style\b/i.test(html)) warnings.push('微信 HTML 样式在其他平台可能被过滤；准备包不承诺像素级保真。');
    if (images.some(item=>/\.gif$/i.test(item.bundleFile))) warnings.push('正文包含 GIF：平台可能将动图转静态。');
    warnings.push('已填入不等于保存。请在目标平台确认图片、排版、封面并手动保存草稿。');
    return warnings;
  };

  // The Weibo length check counts serialized markup too. Captured WeChat
  // computed styles can be megabytes long; only carry editable typography.
  // Complex geometry has already been preserved as layout images at this point.
  function compactWeiboHtml(html) {
    const inherited=new Set(['color','font-size','font-weight','font-style','text-decoration',
      'text-align','text-indent','line-height','letter-spacing','white-space']);
    const defaults={'color':'#333','font-size':'16px','font-weight':'400','font-style':'normal',
      'text-decoration':'none','text-align':'left','text-indent':'0px','line-height':'normal',
      'letter-spacing':'normal','white-space':'normal'};
    const stack=[];let svgDepth=0;
    const canonical=(key,value)=>{
      value=value.replace(/\s*!important\s*$/i,'').trim();
      if(key==='font-weight')return value==='normal'?'400':value==='bold'?'700':value;
      if(key==='color')return value.replace(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/gi,
        (_,r,g,b)=>'#'+[r,g,b].map(n=>Number(n).toString(16).padStart(2,'0')).join(''))
        .replace(/^#([0-9a-f])\1([0-9a-f])\2([0-9a-f])\3$/i,'#$1$2$3');
      return value;
    };
    const encode=value=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;');
    const decode=value=>value.replace(/&quot;|&#34;|&#x22;/gi,'"').replace(/&apos;|&#39;|&#x27;/gi,"'").replace(/&amp;/gi,'&');
    const voids=new Set(['img','br','hr','source','wbr','meta','link','input']);
    return String(html).replace(/<!--[\s\S]*?-->|<\/?[a-z][\w:-]*\b(?:"[^"]*"|'[^']*'|[^'">])*>/gi,full=>{
      if(full.startsWith('<!--'))return '';
      const name=/^<\/?([\w:-]+)/.exec(full)[1].toLowerCase();
      if(name==='svg'||svgDepth){
        if(name==='svg')svgDepth+=full.startsWith('</')?-1:full.endsWith('/>')?0:1;
        return full;
      }
      if(full.startsWith('</')){
        const index=stack.map(entry=>entry.name).lastIndexOf(name);
        if(index>=0)stack.length=index;
        return full;
      }
      const parent=stack.length?stack[stack.length-1].styles:defaults;
      const styles={...parent};
      if(name==='strong'||name==='b')styles['font-weight']='700';
      if(name==='em'||name==='i')styles['font-style']='italic';
      if(name==='u')styles['text-decoration']='underline';
      const kept=[],declarations=new Map();
      const attrs=full.slice(/^<[\w:-]+/.exec(full)[0].length).replace(/\/?\s*>$/,'');
      for(const attr of attrs.matchAll(/\s+([\w:-]+)\s*=\s*("[^"]*"|'[^']*')/g)){
        const key=attr[1].toLowerCase(),value=attr[2].slice(1,-1);
        if(key==='style')for(const declaration of decode(value).split(';')){
          const colon=declaration.indexOf(':');if(colon<0)continue;
          const prop=declaration.slice(0,colon).trim().toLowerCase();
          if(inherited.has(prop)||name==='img'&&['width','height','max-width','max-height','vertical-align'].includes(prop)
              ||['p','blockquote','h1','h2','h3','h4','h5','h6'].includes(name)&&['margin-top','margin-bottom'].includes(prop)){
            const value=canonical(prop,declaration.slice(colon+1));
            if(value&&!/url\(|expression\(|[<>]/i.test(value))declarations.set(prop,value);
          }
        }
        else if(name==='img'&&['src','alt','width','height'].includes(key)
          ||name==='a'&&['href','title'].includes(key)
          ||['td','th'].includes(name)&&['colspan','rowspan'].includes(key)
          ||name==='ol'&&key==='start'||name==='li'&&key==='value')kept.push(attr[0]);
      }
      const css=[];
      for(const [key,value]of declarations){
        if(inherited.has(key)){
          if(value!==styles[key])css.push(key+':'+value);
          styles[key]=value;
        }else if(!/^(?:0(?:px|em|%)?|none|normal)$/i.test(value))css.push(key+':'+value);
      }
      if(css.length)kept.push(' style="'+encode(css.join(';'))+'"');
      if(!voids.has(name)&&!full.endsWith('/>'))stack.push({name,styles});
      return '<'+name+kept.join('')+'>';
    });
  }

  function omitSohuImages(result, records=[], layout) {
    if(!Array.isArray(records))throw Error('搜狐图片省略记录无效。');
    const omitted=[],files=new Set();
    for(const record of records){
      if(!fileName(record?.bundleFile)||record.reason!=='platform-rejected-qrcode'||files.has(record.bundleFile))throw Error('搜狐图片省略理由或文件无效。');
      const matches=result.contentImages.filter(item=>item.bundleFile===record.bundleFile);
      if(!matches.length)throw Error('省略的搜狐图片不在来源正文中。');
      files.add(record.bundleFile);
      const restoredText=layout?.blocks.find(block=>block.image.bundleFile===record.bundleFile)?.text||'';
      for(const item of matches)omitted.push({...record,position:result.contentImages.indexOf(item)+1,placeholder:item.placeholder,
        ...(restoredText?{restoredText}:{} )});
    }
    const replacements=new Map(omitted.map(item=>[item.placeholder,(item.restoredText||'').replace(/[&<>]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch])).replace(/\n/g,'<br>')]));
    result.html=result.html.replace(imgTags,tag=>replacements.get(tag.match(srcAttr)?.[3])??tag);
    result.contentImages=result.contentImages.filter(item=>!replacements.has(item.placeholder));
    return omitted;
  }
  // Read only GIF structure, not pixels: upload copies must preserve every frame delay and loop.
  function gifTimeline(bytes) {
    if(String.fromCharCode(...bytes.slice(0,6))!=='GIF89a'&&String.fromCharCode(...bytes.slice(0,6))!=='GIF87a')throw Error('上传副本与原图都必须为 GIF。');
    let at=13+(bytes[10]&128?3*(1<<((bytes[10]&7)+1)):0),delay=0,loop=null;
    const durations=[];
    const subblocks=()=>{const data=[];while(at<bytes.length){const length=bytes[at++];if(!length)return data;if(at+length>bytes.length)break;data.push(...bytes.slice(at,at+length));at+=length;}throw Error('GIF 数据块不完整。');};
    while(at<bytes.length){const marker=bytes[at++];if(marker===59)break;
      if(marker===33){const label=bytes[at++];if(label===249){if(bytes[at]!==4||at+6>bytes.length)throw Error('GIF 帧控制无效。');delay=(bytes[at+2]|bytes[at+3]<<8)*10;at+=6;}
        else if(label===255){const length=bytes[at++],app=String.fromCharCode(...bytes.slice(at,at+length));at+=length;const data=subblocks();if(/^NETSCAPE|^ANIMEXTS/.test(app)&&data[0]===1)loop=data[1]|data[2]<<8;}
        else subblocks();
      }else if(marker===44){if(at+9>bytes.length)throw Error('GIF 帧描述不完整。');const packed=bytes[at+8];at+=9;if(packed&128)at+=3*(1<<((packed&7)+1));at++;subblocks();durations.push(delay);delay=0;}
      else throw Error('GIF 数据块类型无效。');
    }
    if(!durations.length)throw Error('GIF 不含完整帧。');
    return {width:bytes[6]|bytes[7]<<8,height:bytes[8]|bytes[9]<<8,frames:durations.length,durationMs:durations.reduce((a,b)=>a+b,0),loop,durations};
  }
  async function uploadCopiesFor(records=[], images, assets, platform) {
    if(!Array.isArray(records)||records.length>80||records.length&&platform!=='yidian')throw Error('上传副本仅用于一点号 GIF 兼容处理。');
    const copies=[],seen=new Set();
    for(const record of records){
      const source=images.find(item=>item.bundleFile===record.sourceFile),file=assets.get('assets/'+record.bundleFile);
      if(!source||!fileName(record.bundleFile)||record.bundleFile===record.sourceFile||seen.has(record.sourceFile)||!file?.arrayBuffer)throw Error('上传副本缺少唯一的原图或文件。');
      seen.add(record.sourceFile);
      const originalFile=assets.get('assets/'+record.sourceFile);
      if(!originalFile||await hashFile(originalFile)!==source.sha256)throw Error('上传副本的原图已改动。');
      const original=gifTimeline(new Uint8Array(await originalFile.arrayBuffer())),target=gifTimeline(new Uint8Array(await file.arrayBuffer()));
      if(file.size>PROFILES[platform].upload.maxBytes||file.size>=originalFile.size||target.width>original.width||target.height>original.height
          ||Math.abs(target.height-target.width*original.height/original.width)>1
          ||JSON.stringify(original.durations)!==JSON.stringify(target.durations)||original.loop!==target.loop)throw Error('GIF 上传副本必须在平台上限内，保持所有帧、时序、循环和原图比例。');
      copies.push({sourceFile:record.sourceFile,sourceSha256:source.sha256,bundleFile:record.bundleFile,bytes:file.size,sha256:await hashFile(file),
        method:'gif-resize-preserve-motion',sourceWidth:original.width,sourceHeight:original.height,width:target.width,height:target.height,frames:target.frames,durationMs:target.durationMs,loop:target.loop});
    }
    return copies;
  }
  function processingLog(proof, result, format, omitted=[], platform) {
    const entries=[];
    for(const warning of proof.importWarnings||[])entries.push({kind:'import',detail:warning});
    const sourceManifest=JSON.parse(proof.sourceManifestText);
    for(const copy of proof.uploadCopies||[])entries.push({kind:'upload-copy',detail:'一点号'+'上传副本：'+copy.sourceFile+'（'+copy.sourceWidth+'×'+copy.sourceHeight+'）缩为 '+copy.bundleFile+'（'+copy.width+'×'+copy.height+'，'+copy.bytes+'B），用于满足单图 '+PROFILES[platform].upload.maxBytes/1024/1024+'MB 上限；完整保留 '+copy.frames+' 帧、'+copy.durationMs+'ms 时序及循环设置，不减帧、不转静图。像素尺寸改变，原始文件和来源证明仍随包保留。'});
    if(proof.targetTitle)entries.push({kind:'title',detail:'平台标题独立设置为「'+proof.targetTitle+'」；微信原标题为「'+sourceManifest.title+'」。原标题仍保存在来源证明中。'});
    const reasons={columns:'并排内容',table:'表格',svg:'矢量图',card:'卡片',overlay:'叠层',carousel:'滑动图组','background-text':'背景图文'};
    for(const [index,block]of (proof.layout?.blocks||[]).entries()){
      const original=proof.sourceHtml.slice(block.start,block.end);
      const tokens=new Set(original.match(/WECHATIMGPH_[\w-]+/g)||[]);
      const files=sourceManifest.contentImages.filter(item=>tokens.has(item.placeholder)).map(item=>item.bundleFile);
      entries.push({kind:'layout',detail:'第 '+(index+1)+' 处特殊排版（'+block.reasons.map(reason=>reasons[reason]||reason).join('、')+'）：来源图片 '+(files.join('、')||'无')
        +'，整合为 '+block.image.bundleFile+'（'+block.width+'×'+block.height+'）。'
        +(block.text?'区块内 '+[...block.text].length+' 字随图显示；原文片段「'+block.text.slice(0,70)+'」。':'')
        +(block.links.length?' '+block.links.length+' 个链接在图片后单独保留。':'')});
    }
    for(const item of result.droppedSpacerImages||[])entries.push({kind:'omit-spacer',detail:'省略无可见内容的 1×1 占位图片 '+item.bundleFile+'。'});
    for(const item of result.droppedInlineIcons||[])entries.push({kind:'omit-icon',detail:'省略平台会放大的装饰小图 '+item.bundleFile+'，原显示宽度 '+item.width+'px。'});
    for(const item of result.replacedInlineEmoji||[])entries.push({kind:'emoji',detail:'第 '+item.position+' 处微信内联表情图片 '+item.bundleFile+' 按已核实的原始图案替换为文字表情「'+item.text+'」，'+(platform==='yidian'?'避免一点号将其移到段首':'避免头条将其放大为块级图片')+'；原素材随包保留。'});
    if(result.backgroundFallbackCount)entries.push({kind:'background',detail:result.backgroundFallbackCount+' 处 CSS 背景图片已展开为正文图片，按原位置放在关联内容旁。'});
    for(const item of omitted)entries.push({kind:'omit-qrcode',detail:'省略搜狐适配稿第 '+item.position+' 张图片 '+item.bundleFile+'。搜狐明确拒绝「图片不能包含二维码」；原始素材保存在准备包内。'
      +(item.restoredText?'该整合图中的 '+[...item.restoredText].length+' 字已恢复为可编辑正文，片段「'+item.restoredText.slice(0,80)+'」。':'')});
    for(const note of format?.notes||[])entries.push({kind:'format-summary',detail:note});
    for(const [index,change]of (format?.changes||[]).entries()){
      if(change.kind==='image')entries.push({kind:'image',detail:change.detail.replace(/WECHATIMGPH_[\w-]+/g,token=>result.contentImages.find(item=>item.placeholder===token)?.bundleFile||token)});
      else entries.push({kind:'format',detail:'第 '+(index+1)+' 处样式替换：'+change.detail+'；原文片段「'+change.text+'」。',text:change.text});
    }
    if(format){
      for(const [index,match]of [...format.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].entries()){
        const text=match[1].replace(/<[^>]*>/g,'');const count=text.match(/^\u3000+/)?.[0].length||0;
        if(count)entries.push({kind:'indent',detail:(platform==='toutiao'?'今日头条':platform==='yidian'?'一点号':'搜狐')+'适配稿第 '+(index+1)+' 个文字段落使用 '+count+' 个全角空格保留首行缩进；片段「'+text.trim().slice(0,55)+'」。'});
      }
    }
    if(platform==='weibo')entries.push({kind:'markup',detail:'为微博精简多余 HTML 容器和属性；正文文字、已适配的样式及图片顺序按来源校验。'});
    return entries;
  }
  async function prepare(source, platform, options = {}) {
    const title = platformRules(platform, options.title ?? source?.manifest?.title);
    const summary = platformSummary(platform, options.summary ?? source?.manifest?.summary);
    const profile = profileFor(platform);
    const verified = await verifySource(source, platform);
    const mediaAssets=options.layoutAssets||source.assets;
    const layout=options.layout;
    if(layout&&!layoutCore())throw Error('缺少特殊排版校验模块，请重新加载扩展。');
    const normalized=layout?await layoutCore().apply(source.html,source.manifest.contentImages,mediaAssets,layout):null;
    const base=normalized||{html:source.html,images:source.manifest.contentImages};
    const nativeImages=['toutiao','yidian'].includes(platform);
    const result=normalized||nativeImages?rewrite(base.html,base.images,{
      skip:await spacerPlaceholders(base.images,mediaAssets),dropInlineIcons:nativeImages,nativeEmoji:nativeImages}):verified;
    if(platform==='weibo')result.html=compactWeiboHtml(result.html);
    let platformFormat;
    let omitted=[];
    if(platform==='sohu'){
      if(!sohuCore())throw Error('缺少搜狐排版模块，请重新加载扩展。');
      omitted=omitSohuImages(result,options.sohuOmitImages,layout);
      platformFormat=sohuCore().prepare(result.html);
      result.html=platformFormat.html;
    }
    if(platform==='toutiao'){
      if(!toutiaoCore())throw Error('缺少今日头条排版模块，请重新加载扩展。');
      platformFormat=toutiaoCore().prepare(result.html);
      result.html=platformFormat.html;
    }
    if(platform==='yidian'){
      if(!yidianCore())throw Error('缺少一点号排版模块，请重新加载扩展。');
      platformFormat=yidianCore().prepare(result.html);result.html=platformFormat.html;
    }
    const uploadCopies=await uploadCopiesFor(options.uploadCopies,source.manifest.contentImages,mediaAssets,platform);
    const issueDate=options.issueDate || source.manifest.issueDate;
    if (issueDate != null && !/^\d{4}-\d{2}-\d{2}$/.test(issueDate))
      throw new Error('稿件日期必须为 YYYY-MM-DD。');
    const sourceManifestSha256=await hashText(source.manifestText);
    const proof = {
      schema:CONTRACT, sourceHtml:source.html, sourceManifestText:source.manifestText,
      sourceManifestSha256, sourcePayloadSha256:await hashText(source.html),
      ...(layout?{layout}:{}),
      ...(uploadCopies.length?{uploadCopies}:{}),
      ...(omitted.length?{sohuOmitImages:options.sohuOmitImages}:{}),
      ...(source.report.import_warnings?.length?{importWarnings:source.report.import_warnings}:{}),
      ...(platform==='toutiao'&&title!==source.manifest.title?{targetTitle:title}:{}),
    };
    const sourceProofText=JSON.stringify(proof,null,2)+'\n';
    const profileChecksResult=profileChecks(profile,{title,
      summary,author:source.manifest.author,
      coverImage:source.manifest.coverImage,images:result.contentImages,uploadCopies});
    const manifest={
      bundleContractVersion:1, targetPlatform:platform,
      profile:{id:profile.id,version:1}, profileSpec:profileSpecOf(profile),
      title,
      author:source.manifest.author || '', summary,
      ...(issueDate ? {issueDate} : {}),
      contentImages:result.contentImages, coverImage:source.manifest.coverImage || null,
      ...(uploadCopies.length?{uploadCopies}:{}),
      platformCovers:source.manifest.coverImage ? {[platform]:source.manifest.coverImage} : {},
      sourceWechatTitle:source.manifest.title,
      sourceWechatManifestSha256:sourceManifestSha256,
      sourceProofSha256:await hashText(sourceProofText),
      distribution:{schema:CONTRACT,bodyPolicy:'preserve-all',
        backgroundPolicy:'inline-image-fallback',backgroundFallbackCount:result.backgroundFallbackCount,
        ...(platform==='weibo'?{markupPolicy:'weibo-compact-v1'}:{}),
        ...(platformFormat?{formatPolicy:platformFormat.version}:{}),
        ...(omitted.length?{omittedImageCount:omitted.length}:{}),
        sourcePayloadSha256:proof.sourcePayloadSha256,
        ...(layout?{layoutPolicy:'special-blocks-v1',layoutBlocks:layout.blocks.length}:{})}
    };
    const manifestText=JSON.stringify(manifest,null,2)+'\n';
    const report={
      state:'PREPARED',bundle_contract_version:1,target_platform:platform,
      profile_id:profile.id, profile_checks:profileChecksResult,
      issue_date:issueDate||null,payload_sha256:await hashText(result.html),
      manifest_sha256:await hashText(manifestText),source_wechat_manifest_sha256:sourceManifestSha256,
      remote_image_count:0,local_image_count:result.contentImages.length,
      body_policy:'preserve-all',background_image_fallback_count:result.backgroundFallbackCount,
      dropped_inline_icon_count:result.droppedInlineIcons.length,
      dropped_inline_icons:result.droppedInlineIcons,
      dropped_spacer_images:result.droppedSpacerImages,
      ...(omitted.length?{omitted_images:omitted}:{}),
      processing_log_version:1,processing_log:processingLog(proof,result,platformFormat,omitted,platform),
      ...(platform==='weibo'?{markup_policy:'weibo-compact-v1',html_characters:result.html.length}:{}),
      ...(platformFormat?{format_policy:platformFormat.version,format_counts:platformFormat.counts,
        format_changes:platformFormat.changes,format_notes:platformFormat.notes}:{}),
      ...(layout?{layout_policy:'special-blocks-v1',layout_mode:layout.mode,layout_blocks:layout.blocks}:{}),
      warnings:[...warningsFor(result.html,result.contentImages,result.backgroundFallbackCount,
          result.droppedInlineIcons.length,platform),
        ...profileChecksResult.filter(check=>check.state==='warn').map(check=>check.detail),
        ...(layout?layoutCore().notes(layout):[]),...(platformFormat?platformFormat.notes:[]),
        ...omitted.map(item=>'搜狐拒绝二维码图片，已在适配版省略 '+item.bundleFile+'（原第 '+item.position+' 张）。')],
      delivery_state:'NOT_UPLOADED_OR_SAVED'
    };
    const assets=new Map([...mediaAssets].filter(([name])=>name.startsWith('assets/')));
    return {...result,manifest,manifestText,report,assets,sourceProofText};
  }

  async function withSohuOmissions(bundle, records) {
    await verify(bundle,'sohu');
    const proof=JSON.parse(await bundle.assets.get('source-wechat.json').text());
    const source={html:proof.sourceHtml,manifestText:proof.sourceManifestText,manifest:JSON.parse(proof.sourceManifestText),assets:bundle.assets,
      report:{state:'PREPARED',bundle_contract_version:1,remote_image_count:0,payload_sha256:proof.sourcePayloadSha256,manifest_sha256:proof.sourceManifestSha256,import_warnings:proof.importWarnings||[]}};
    const next=await prepare(source,'sohu',{title:bundle.manifest.title,summary:bundle.manifest.summary,issueDate:bundle.manifest.issueDate,
      layout:proof.layout,layoutAssets:bundle.assets,sohuOmitImages:[...(proof.sohuOmitImages||[]),...records]});
    const bytes=new TextEncoder().encode(next.sourceProofText);
    next.assets.set('source-wechat.json',{size:bytes.length,text:async()=>next.sourceProofText,arrayBuffer:async()=>bytes.buffer});
    return next;
  }

  async function withToutiaoFormat(bundle) {
    await verify(bundle,'toutiao');
    const proof=JSON.parse(await bundle.assets.get('source-wechat.json').text());
    const source={html:proof.sourceHtml,manifestText:proof.sourceManifestText,manifest:JSON.parse(proof.sourceManifestText),assets:bundle.assets,
      report:{state:'PREPARED',bundle_contract_version:1,remote_image_count:0,payload_sha256:proof.sourcePayloadSha256,manifest_sha256:proof.sourceManifestSha256,import_warnings:proof.importWarnings||[]}};
    const next=await prepare(source,'toutiao',{title:bundle.manifest.title,summary:bundle.manifest.summary,issueDate:bundle.manifest.issueDate,layout:proof.layout,layoutAssets:bundle.assets});
    const bytes=new TextEncoder().encode(next.sourceProofText);
    next.assets.set('source-wechat.json',{size:bytes.length,text:async()=>next.sourceProofText,arrayBuffer:async()=>bytes.buffer});
    return next;
  }

  async function withYidianFormat(bundle) {
    await verify(bundle,'yidian');
    const proof=JSON.parse(await bundle.assets.get('source-wechat.json').text());
    const source={html:proof.sourceHtml,manifestText:proof.sourceManifestText,manifest:JSON.parse(proof.sourceManifestText),assets:bundle.assets,
      report:{state:'PREPARED',bundle_contract_version:1,remote_image_count:0,payload_sha256:proof.sourcePayloadSha256,manifest_sha256:proof.sourceManifestSha256,import_warnings:proof.importWarnings||[]}};
    const next=await prepare(source,'yidian',{title:bundle.manifest.title,summary:bundle.manifest.summary,issueDate:bundle.manifest.issueDate,layout:proof.layout,layoutAssets:bundle.assets,uploadCopies:proof.uploadCopies});
    next.assets.set('source-wechat.json',new Blob([next.sourceProofText]));return next;
  }

  async function verify(bundle, target) {
    if (!bundle || !bundle.manifest || !bundle.report || !(bundle.assets instanceof Map))
      throw new Error('分发准备包结构无效。');
    const {html,manifest,manifestText,report,assets}=bundle;
    if (manifest.distribution?.schema !== CONTRACT || manifest.targetPlatform !== target
        || report.target_platform !== target || report.body_policy !== 'preserve-all'
        || manifest.distribution.bodyPolicy !== 'preserve-all' || manifest.distribution.backgroundPolicy !== 'inline-image-fallback')
      throw new Error('分发平台或版本不匹配。');
    if (manifest.profile) {
      // 新版准备包必须声明与目标一致的目标配置；旧包没有 profile 字段，仍按原规则校验。
      const profile = profileFor(target);
      if (manifest.profile.id !== profile.id || manifest.profile.version !== 1
          || manifest.profileSpec?.id !== profile.id || report.profile_id !== profile.id)
        throw new Error('准备包的目标配置与平台不一致。');
    }
    platformRules(target,manifest.title);
    platformSummary(target,manifest.summary);
    if (await hashText(html) !== report.payload_sha256
        || await hashText(manifestText) !== report.manifest_sha256)
      throw new Error('分发包正文或清单已被修改。');
    const sourceFile=assets.get('source-wechat.json');
    if (!sourceFile || await hashFile(sourceFile) !== manifest.sourceProofSha256)
      throw new Error('分发包来源证明缺失或已改动。');
    const proof=JSON.parse(await sourceFile.text());
    if (proof.schema !== CONTRACT || typeof proof.sourceHtml !== 'string'
        || typeof proof.sourceManifestText !== 'string'
        || await hashText(proof.sourceHtml) !== proof.sourcePayloadSha256
        || await hashText(proof.sourceManifestText) !== proof.sourceManifestSha256
        || proof.sourceManifestSha256 !== manifest.sourceWechatManifestSha256
        || proof.sourcePayloadSha256 !== manifest.distribution.sourcePayloadSha256)
      throw new Error('分发包来源证明不一致。');
    const sourceManifest=JSON.parse(proof.sourceManifestText);
    const uploadCopies=await uploadCopiesFor(proof.uploadCopies,sourceManifest.contentImages,assets,target);
    if(JSON.stringify(uploadCopies)!==JSON.stringify(proof.uploadCopies||[])||JSON.stringify(uploadCopies)!==JSON.stringify(manifest.uploadCopies||[]))throw Error('上传副本与来源证明或清单不一致。');
    if(proof.targetTitle&&proof.targetTitle!==manifest.title)throw Error('平台标题与独立设置记录不一致。');
    if(proof.layout||['toutiao','yidian'].includes(target)&&!!manifest.distribution.formatPolicy){
      for(const item of [...(sourceManifest.contentImages||[]),...(sourceManifest.coverImage?[sourceManifest.coverImage]:[])]){
        const file=assets.get('assets/'+item.bundleFile);
        if(!file||file.size!==item.bytes||await hashFile(file)!==item.sha256)throw Error('特殊排版的原始素材缺失或被修改：'+item.bundleFile);
      }
    }
    if ((sourceManifest.targetPlatform || 'wechat') !== 'wechat'
        || sourceManifest.bundleContractVersion !== 1
        || manifest.sourceWechatTitle !== sourceManifest.title
        || manifest.issueDate !== sourceManifest.issueDate && sourceManifest.issueDate)
      throw new Error('分发包微信来源元信息不一致。');
    if(Boolean(proof.layout)!==Boolean(manifest.distribution.layoutPolicy))throw Error('特殊排版来源与清单不一致。');
    if(proof.layout&&(manifest.distribution.layoutPolicy!=='special-blocks-v1'
      ||report.layout_policy!=='special-blocks-v1'||report.layout_mode!==proof.layout.mode
      ||manifest.distribution.layoutBlocks!==proof.layout.blocks?.length
      ||JSON.stringify(report.layout_blocks)!==JSON.stringify(proof.layout.blocks)))throw Error('特殊排版报告与来源不一致。');
    if(proof.layout&&!layoutCore())throw Error('缺少特殊排版校验模块。');
    const normalized=proof.layout?await layoutCore().apply(proof.sourceHtml,sourceManifest.contentImages,assets,proof.layout)
      :{html:proof.sourceHtml,images:sourceManifest.contentImages};
    const expected=rewrite(normalized.html,normalized.images,
      {skip: await spacerPlaceholders(normalized.images,assets),
        dropInlineIcons:target==='toutiao'||target==='yidian'&&!!manifest.distribution.formatPolicy,nativeEmoji:['toutiao','yidian'].includes(target)&&!!manifest.distribution.formatPolicy});
    const omitted=proof.sohuOmitImages?omitSohuImages(expected,proof.sohuOmitImages,proof.layout):[];
    if(omitted.length&&(target!=='sohu'||manifest.distribution.omittedImageCount!==omitted.length
      ||JSON.stringify(report.omitted_images)!==JSON.stringify(omitted)))throw Error('搜狐省略图片的记录与来源不一致。');
    if(!omitted.length&&(manifest.distribution.omittedImageCount||report.omitted_images))throw Error('搜狐省略图片缺少来源记录。');
    if(manifest.distribution.markupPolicy){
      if(target!=='weibo'||manifest.distribution.markupPolicy!=='weibo-compact-v1'
          ||report.markup_policy!=='weibo-compact-v1')throw Error('分发正文精简策略无效。');
      expected.html=compactWeiboHtml(expected.html);
      if(report.html_characters!==html.length)throw Error('分发正文长度与报告不一致。');
    }else if(report.markup_policy)throw Error('分发正文精简策略与清单不一致。');
    let formattedForLog;
    if(manifest.distribution.formatPolicy){
      const policy=manifest.distribution.formatPolicy;
      const core=target==='sohu'?sohuCore():target==='toutiao'?toutiaoCore():target==='yidian'?yidianCore():null;
      const policies=target==='sohu'?['sohu-readable-v1',core?.VERSION]:[core?.VERSION];
      if(!core||!policies.includes(policy)||report.format_policy!==policy)throw Error('排版策略与平台不一致。');
      const formatted=core.prepare(expected.html,{legacyHeadings:policy==='sohu-readable-v1'});
      if(JSON.stringify(report.format_counts)!==JSON.stringify(formatted.counts)
          ||JSON.stringify(report.format_changes)!==JSON.stringify(formatted.changes)
          ||JSON.stringify(report.format_notes)!==JSON.stringify(formatted.notes))throw Error('排版说明与原稿转换结果不一致。');
      expected.html=formatted.html;
      formattedForLog=formatted;
    }else if(report.format_policy)throw Error('搜狐排版策略与清单不一致。');
    const checkedLog=report.processing_log;
    if(report.processing_log_version!==undefined&&(report.processing_log_version!==1
      ||JSON.stringify(checkedLog)!==JSON.stringify(processingLog(proof,expected,formattedForLog,omitted,target))))throw Error('分发处理日志与实际转换不一致。');
    if (html !== expected.html || manifest.distribution.backgroundFallbackCount !== expected.backgroundFallbackCount
        || report.background_image_fallback_count !== expected.backgroundFallbackCount
        || JSON.stringify(manifest.contentImages) !== JSON.stringify(expected.contentImages)
        || JSON.stringify(manifest.coverImage) !== JSON.stringify(sourceManifest.coverImage || null)
        || JSON.stringify(manifest.platformCovers?.[target] || null) !== JSON.stringify(manifest.coverImage || null))
      throw new Error('分发正文、图片顺序或封面偏离来源。');
    for (const item of [...manifest.contentImages,...(manifest.coverImage?[manifest.coverImage]:[])]) {
      if (!fileName(item.bundleFile) || !hex(item.sha256) || !Number.isSafeInteger(item.bytes))
        throw new Error('分发素材元信息无效。');
      const file=assets.get('assets/'+item.bundleFile);
      if (!file || file.size !== item.bytes || await hashFile(file) !== item.sha256)
        throw new Error('分发素材缺失或被修改：'+item.bundleFile);
    }
    return true;
  }

  return {CONTRACT,PLATFORMS,PROFILES,profileFor,profileSpecOf,profileChecks,oversizeFor,platformRules,platformSummary,rewrite,verifySource,prepare,verify,withSohuOmissions,withToutiaoFormat,withYidianFormat,processingLog,isSpacerImage,imageDimensions,gifTimeline,compactWeiboHtml};
})();
if (typeof module !== 'undefined') module.exports=DraftDistribution;
