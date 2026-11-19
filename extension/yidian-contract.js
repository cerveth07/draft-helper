'use strict';
// Shared by the local generator and the browser: all layout exceptions live here.
function yidianContract(source, title) {
  const fail = (message) => { throw new Error(message); };
  const { html, manifest, titlePlan } = source;
  if (!manifest || manifest.bundleContractVersion !== 1 || (manifest.targetPlatform || 'wechat') !== 'wechat') fail('Proof must refer to a WeChat source');
  if (typeof html !== 'string' || /<script\b|<iframe\b|javascript:|\son[a-z]+\s*=/i.test(html)) fail('Invalid or active source body');
  if (!manifest || !titlePlan || titlePlan.issueDate !== manifest.issueDate
      || !/^\d{4}-\d{2}-\d{2}$/.test(manifest.issueDate || '')) fail('Missing or mismatched title plan issue date');
  const candidates = titlePlan.candidates;
  if (!Array.isArray(candidates) || candidates.length !== 3) fail('Exactly three programme title candidates are required');
  const ids = new Set(), names = new Set();
  for (const item of candidates) {
    if (!item || typeof item.programId !== 'string' || !item.programId.trim()
        || typeof item.programName !== 'string' || !item.programName.trim()
        || typeof item.title !== 'string' || item.title !== item.title.trim()
        || !item.title || /[\r\n]/.test(item.title)
        || item.title.match(/《([^》]+)》/)?.[1] !== item.programName
        || !html.replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/[\s《》]+/g, '').replace(/・/g, '·')
          .includes(item.programName.replace(/[\s《》]+/g, '').replace(/・/g, '·'))
        || ids.has(item.programId) || names.has(item.programName)) fail('Invalid or duplicate programme title candidate');
    if (item.seasonLabel) {
      if (typeof item.seasonLabel !== 'string' || !item.title.includes(item.seasonLabel)) fail('Title candidate season missing');
      const seasons = item.title.match(/第[零〇一二三四五六七八九十百0-9]+季/g) || [];
      if (seasons.some((season) => season !== item.seasonLabel)) fail('Title candidate season mismatch');
    }
    ids.add(item.programId); names.add(item.programName);
    if (typeof item.headlineHook !== 'string' || !item.headlineHook.trim()) fail('Title candidate needs a source-backed body hook');
    const rankings = headlineRankings(item);
    if (!rankings.length || rankings.some((rank) => !validHeadlineRank(rank))) fail('Title candidate needs verified H5 fusion-index rank(s)');
    if (!rankings.some((rank) => sameHeadlineRank(rank, item.headlineRanking))) fail('Primary title rank is not among selected headline ranks');
    draftHelperHeadlineContract(item.title, item.programName, html, item,
      item.programId === titlePlan.wechatProgramId && item.headlineHookSource === 'approved_wechat_title');
  }
  const wechat = candidates.find((item) => item.programId === titlePlan.wechatProgramId);
  const yidian = candidates.find((item) => item.programId === titlePlan.yidianProgramId);
  if (!wechat || !yidian || wechat.programId === yidian.programId
      || wechat.programName === yidian.programName || wechat.title !== manifest.title
      || yidian.title !== title) fail('Title selection must match the approved candidates and use a different programme');
  if ([...yidian.title].length < 5 || [...yidian.title].length > 64) fail('Yidian title must contain 5–64 characters');
  if (!manifest.coverImage || !Array.isArray(manifest.contentImages)) fail('Daily cover or source images missing');
  draftHelperHeadlineContract(yidian.title, yidian.programName, html, yidian);
  const fragment = toutiaoArticleFragment(source);
  return { html: fragment.html, contentImages: fragment.contentImages };
}
// Exact shared truncation rule for generation and pre-upload verification.
function toutiaoArticleFragment(source) {
  const definition = '融合传播指数涵盖对频道、节目、品牌全网曝光、全民热议、大众口碑、长视频传播及短视频平台热度、全平台融媒体账号传播热度等多个维度的综合计算评估，用以客观反映频道、节目、企业品牌在互联网多渠道融合传播的效果及受众评价，客观反映媒体平台、节目IP、企业品牌在互联网络的融合传播影响力。';
  const paragraphs = [...source.html.matchAll(/<p\b[^>]*>[\s\S]*?<\/p\s*>/gi)].filter((match) =>
    match[0].replace(/<[^>]+>/g, '').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, '') === definition);
  if (paragraphs.length !== 1) throw new Error('微信来源必须包含唯一且完整的融合传播指数说明段。');
  const end = paragraphs[0].index + paragraphs[0][0].length;
  const prefix = source.html.slice(0, end), open = [];
  const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const tag of prefix.matchAll(/<\/?([a-zA-Z][\w:-]*)\b(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
    const name = tag[1].toLowerCase();
    if (voids.has(name) || /\/\s*>$/.test(tag[0])) continue;
    if (tag[0].startsWith('</')) {
      if (open.at(-1) !== name) throw new Error('指数说明段之前的 HTML 嵌套异常，不能安全截断。');
      open.pop();
    } else open.push(name);
  }
  let html = prefix + open.reverse().map((name) => '</' + name + '>').join('');
  const images = source.manifest.contentImages.filter((image) => html.includes(image.placeholder));
  // Only the hash-verified canonical E3 header may be converted to a local
  // upload placeholder. Non-WeChat editors do not understand its data-src
  // lazy image or mini-program link. Keep the full WeChat source unchanged.
  const e3Marker = '<section style="text-align: center;" data-nest-level="3"><a class="weapp_image_link js_weapp_entry"';
  const fixed = source.matrixE3Header;
  if (source.html.startsWith(e3Marker)) {
    if (!fixed || typeof fixed.canonicalHtml !== 'string'
        || !source.html.startsWith(fixed.canonicalHtml)
        || fixed.canonicalHtml.indexOf(e3Marker) !== 0
        || source.html.indexOf(fixed.canonicalHtml, 1) >= 0)
      throw new Error('E3 fixed header requires verified local matrix image');
    const tags = [...fixed.canonicalHtml.matchAll(/<img\b[^>]*>/gi)];
    const lazy = tags.length === 1 && tags[0][0].match(/\sdata-src\s*=\s*(["'])(.*?)\1/i);
    const url = lazy?.[2].replaceAll('&amp;', '&');
    if (!url || url !== fixed.sourceUrl || !/^https:\/\/mmbiz\.qpic\.cn\//i.test(url)
        || fixed.placeholder !== 'WECHATIMGPH_E3HEADER'
        || fixed.bundleFile !== '000.jpg'
        || !/^[a-f0-9]{64}$/.test(fixed.sha256)
        || !Number.isSafeInteger(fixed.bytes) || fixed.bytes < 4 || fixed.bytes > 8 * 1024 * 1024
        || images.some((item) => item.placeholder === fixed.placeholder || item.bundleFile === fixed.bundleFile))
      throw new Error('Invalid canonical E3 matrix header image proof');
    html = '<section style="text-align:center;">'
      + '<img src="' + fixed.placeholder + '" alt="矩阵大数据排行榜"'
      + ' style="width:100%;max-width:100%;height:auto;"></section>'
      + html.slice(fixed.canonicalHtml.length);
    images.unshift({ placeholder: fixed.placeholder, bundleFile: fixed.bundleFile,
      sha256: fixed.sha256, bytes: fixed.bytes, sourceName: 'E3固定头图' });
  } else if (fixed) {
    throw new Error('E3 matrix image proof supplied for noncanonical source');
  }
  if (/<img\b[^>]*\sdata-src\s*=/i.test(html))
    throw new Error('Matrix output still contains unsupported lazy images');
  return { html, contentImages: images };
}
function headlineOrdinal(value) {
  const digits = '零一二三四五六七八九';
  if (!Number.isInteger(value) || value < 1 || value > 99) throw new Error('Fusion-index rank must be from 1 to 99');
  if (value <= 10) return value === 10 ? '第十' : '第' + digits[value];
  if (value < 20) return '第十' + digits[value - 10];
  if (value % 10 === 0) return '第' + digits[value / 10] + '十';
  return '第' + digits[Math.floor(value / 10)] + '十' + digits[value % 10];
}

function normalizedHeadlineMetric(metric) {
  return !metric || metric === '融合传播指数' ? '节目指数' : metric;
}
function sameHeadlineRank(a, b) {
  return !!a && !!b && a.scope === b.scope && a.rank === b.rank
    && a.rankSource === b.rankSource && a.date === b.date
    && normalizedHeadlineMetric(a.metric) === normalizedHeadlineMetric(b.metric);
}
function headlineRankings(candidate) {
  return Array.isArray(candidate.headlineRankings) && candidate.headlineRankings.length
    ? candidate.headlineRankings : (candidate.headlineRanking ? [candidate.headlineRanking] : []);
}
function validHeadlineRank(rank) {
  return !!rank && rank.rankSource === 'draft_helper_h5' && Number.isInteger(rank.rank)
    && rank.rank >= 1 && rank.rank <= 99
    && typeof rank.scope === 'string'
    && rank.titleScope === (rank.scope === '电视黄金档' ? '电视黄金档' : rank.scope.replace(/榜$/, ''))
    && /^\d{4}-\d{2}-\d{2}$/.test(rank.date || '')
    && rank.rankText === headlineOrdinal(rank.rank)
    && (!rank.metric || ['节目指数', '融合传播指数', '媒体曝光度', '网民评议度', '视频热度'].includes(rank.metric));
}
function headlineTitleMatches(title, candidate) {
  const ranks = headlineRankings(candidate);
  if (!ranks.length || ranks.some((r) => !validHeadlineRank(r))) return false;
  const prefix = '矩阵指数 |《' + candidate.programName + '》'
    + (candidate.seasonLabel || '') + candidate.headlineHook + '，';
  if (!title.startsWith(prefix) || !title.endsWith('！')) return false;
  const statement = title.slice(prefix.length, -1);
  // A bare 位列 implies the fusion index; every other metric must be explicit.
  // This mirrors step10_headlines.py and prevents swapping a true review
  // ranking for an unrelated fusion-index claim.
  const match = statement.match(/^(融合传播指数|媒体曝光度|网民评议度|视频热度)?位列(.+)$/);
  if (!match) return false;
  const titleMetric = normalizedHeadlineMetric(match[1]);
  if (ranks.some((rank) => normalizedHeadlineMetric(rank.metric) !== titleMetric))
    return false;
  const expression = match[2];
  const names = ranks.map((rank) => {
    if (rank.scope === '电视黄金档') return ['电视黄金档', '黄金档'];
    const labels = [rank.titleScope];
    const publicLabel = rank.titleScope.match(/^(电视|全网|网播)(综艺|剧集|纪录片|AIGC影视作品)$/);
    if (publicLabel) labels.push(publicLabel[1] + '热播' + publicLabel[2]);
    return labels;
  });
  const allNames = (i, partial, out) => {
    if (i === names.length) { out.push(partial); return; }
    for (const n of names[i]) allNames(i + 1, [...partial, n], out);
  };
  const combinations = [];
  allNames(0, [], combinations);
  const matches = combinations.some((scopes) => {
    const rankExpressions = scopes.map((scope, i) => scope + ranks[i].rankText);
    const grouped = ranks.every((r) => r.rank === ranks[0].rank)
      ? scopes.join('、') + ranks[0].rankText : null;
    return expression === rankExpressions.join('、')
      || expression === grouped
      || expression === rankExpressions.join('及');
  });
  return matches;
}
// A Toutiao title is an abridgement of the *WeChat* headline. It must not
// originate from Yidian's (potentially different) featured programme.
function deriveToutiaoTitle(wechatTitle) {
  if (typeof wechatTitle !== 'string' || !wechatTitle.trim()) throw new Error('WeChat title missing');
  const prefixMatch = wechatTitle.match(/^(矩阵指数\s*\|\s*)/);
  if (!prefixMatch) throw new Error('WeChat title must begin with 矩阵指数');
  const prefix = prefixMatch[1];
  const stripped = wechatTitle.slice(prefix.length).replace(/[！!。]$/, '');
  if ([...prefix + stripped].length <= 30) return prefix + stripped;
  const m = stripped.match(/^(《[^》]+》(?:第[一二三四五六七八九十\d]+季)?)([^，]*)(?:，(.*))?$/);
  if (!m) throw new Error('WeChat title cannot be safely shortened to 30 characters');
  const name = m[1], hook = m[2], statement = m[3] || '';
  const ranks = statement.replace(/^融合传播指数(?=位列)/, '');
  // Prefer keeping the verified ranking, while removing the descriptive hook
  // if necessary. No programme, rank or scope is invented here.
  const candidates = [
    name + hook + (ranks ? '，' + ranks : ''),
    name + (ranks || ''),
    name + hook,
    name + (hook.split(/[、；:：]/)[0] || ''),
    name,
  ];
  const chosen = candidates.find((value) => [...prefix + value].length >= 2 && [...prefix + value].length <= 30);
  if (!chosen) throw new Error('WeChat programme name alone exceeds Toutiao title limit');
  return prefix + chosen;
}

function draftHelperHeadlineContract(title, programName, html, candidate = {}, approvedWechatTitle = false) {
  const fail = (message) => { throw new Error(message); };
  const program = '《' + programName + '》';
  const hook = candidate.headlineHook;
  const rank = candidate.headlineRanking;
  if (typeof hook !== 'string' || !hook.trim() || !rank
      || !validHeadlineRank(rank)
      || !headlineTitleMatches(title, candidate)) {
    fail('标题节目、事实或已验证的融合传播指数榜单名次不匹配。');
  }
  const normalize = (value) => value.replace(/[\s，,、：:；;。！？“”‘’"'（）()《》]/g, '').replace(/・/g, '·');
  const paragraphs = [...html.matchAll(/<p\b[^>]*>[\s\S]*?<\/p\s*>/gi)].map((match) =>
    normalize(match[0].replace(/<[^>]*>/g, '').replace(/&nbsp;|&#160;/g, ' ')));
  const paragraph = paragraphs.find((text) => text.includes(normalize(program)));
  if ([...normalize(hook)].filter((char) => /[\u3400-\u9fff]/.test(char)).length < 6
      || (!approvedWechatTitle && (!paragraph || !paragraph.includes(normalize(hook)))))
    fail('矩阵标题描述必须是对应节目正文中的具体内容，且不少于 6 个汉字。');
  return true;
}
// Toutiao inherits the Yidian title and WeChat content through the index definition.
function toutiaoContract(source, manifest, html) {
  const fail = (message) => { throw new Error(message); };
  if (manifest.fillTitle !== undefined && typeof manifest.fillTitle !== 'boolean') fail('头条标题填入设置必须为布尔值。');
  if (manifest.fillTitle !== false && (typeof manifest.title !== 'string' || [...manifest.title].length < 2 || [...manifest.title].length > 30))
    fail('头条标题限 2～30 字，请同步调整一点资讯和头条标题，不能截断或单独改写。');
  const wechat = source.manifest;
  const yidian = source.yidianManifest;
  if (!wechat || !yidian || manifest.targetPlatform !== 'toutiao'
      || yidian.targetPlatform !== 'yidian' || manifest.issueDate !== wechat.issueDate
      || manifest.issueDate !== yidian.issueDate) fail('头条包与微信、一点资讯来源日期或平台不一致。');
  const expectedYidian = yidianContract(source, yidian.title);
  const expectedToutiao = toutiaoArticleFragment(source);
  const plan=source.titlePlan;
  const a=plan.candidates?.find(x=>x.programId===plan.wechatProgramId);
  const b=plan.candidates?.find(x=>x.programId===plan.yidianProgramId);
  const covers=yidian.platformCovers;
  if (!a||!b||covers?.yidian?.programmeId!==b.programId
      || covers?.toutiao?.programmeId!==a.programId
      || covers?.toutiao?.sha256!==wechat.coverImage?.sha256
      || JSON.stringify(yidian.coverImage)!==JSON.stringify(covers.yidian)
      || covers?.toutiao?.bundleFile!==('cover-toutiao.'+wechat.coverImage?.bundleFile?.split('.').pop())
      || yidian.bodyPolicy !== 'same_as_toutiao_through_index_definition'
      || yidian.sourceWechatTitle !== wechat.title
      || JSON.stringify(yidian.contentImages) !== JSON.stringify(expectedYidian.contentImages))
    fail('头条标题引用的一点资讯来源清单不符合约定。');
  if (manifest.title !== deriveToutiaoTitle(wechat.title)
      || manifest.sourceYidianTitle !== yidian.title
      || manifest.sourceWechatTitle !== wechat.title || html !== expectedToutiao.html
      || JSON.stringify(manifest.contentImages) !== JSON.stringify(expectedToutiao.contentImages)
      || JSON.stringify(manifest.coverImage) !== JSON.stringify(covers.toutiao)
      || manifest.sourceWechatManifestSha256 !== source.sourceWechatManifestSha256
      || manifest.sourceWechatManifestSha256 !== yidian.sourceWechatManifestSha256
      || manifest.sourceYidianManifestSha256 !== source.sourceYidianManifestSha256)
    fail('头条标题、正文或素材偏离一点资讯标题和微信正文来源，已停止填稿。');
  return true;
}
if (typeof module !== 'undefined') module.exports = { yidianContract, toutiaoContract, toutiaoArticleFragment, draftHelperHeadlineContract, deriveToutiaoTitle, headlineTitleMatches, headlineRankings, validHeadlineRank };
