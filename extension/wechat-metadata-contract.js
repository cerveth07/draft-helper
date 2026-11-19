'use strict';

// Pure prepare-time checks. Do not confuse a bundled cover with one set in WeChat.
function requireWechatEditorialMetadata(manifest) {
  const summary = typeof manifest.summary === 'string' ? manifest.summary.trim() : '';
  if (!summary || [...summary].length > 120) {
    throw new Error('摘要为空或超过120字；请填写摘要，或在工作台中留空后自动提取。');
  }
  // 独立工具版：封面改为「提醒」而非阻断。填稿后请在编辑器里手动设置封面。
  const cover = manifest.coverImage;
  const hasCover = cover && typeof cover === 'object'
    && /^cover\.(?:jpe?g|png|webp|gif|bmp)$/i.test(cover.bundleFile || '');
  if (!hasCover) console.warn('[草稿工具] 准备包未包含封面文件：仅提醒，不阻断填稿。');
  return { summary, cover: hasCover ? cover : null, cover_warning: !hasCover };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { requireWechatEditorialMetadata };
}
