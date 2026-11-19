/* 图片超限压缩（纯浏览器，无第三方依赖）。
 *
 * 只处理「静图」：JPEG / PNG / WebP / BMP 走 canvas 重编码（缩边 + 降质量阶梯）。
 * GIF 动图不压 —— 浏览器 canvas 只有单帧，压了就把动效丢了，属于静默改内容；
 * 这种情形返回 block，由调用方给出明确提示（本地帧压缩或改用静图）。
 */
'use strict';
const DraftImageShrink = (() => {
  const MB = 1024 * 1024;
  const STATIC = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/bmp']);

  /** 纯决策，不碰 DOM，便于单元测试：返回 none / shrink / block。 */
  function plan(bytes, type, maxBytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return {action: 'block', reason: '图片字节数未知'};
    if (!Number.isFinite(maxBytes) || maxBytes <= 0) return {action: 'block', reason: '平台上限未知'};
    if (bytes <= maxBytes) return {action: 'none'};
    const mime = String(type || '').toLowerCase();
    if (mime === 'image/gif')
      return {action: 'block', reason: 'GIF 动图压缩会丢动效，浏览器内不做'};
    if (!STATIC.has(mime))
      return {action: 'block', reason: '该格式不支持浏览器内压缩：' + (mime || '未知')};
    return {action: 'shrink'};
  }

  /** 重编码阶梯：先试原格式，再逐步缩边 + 降质量；返回 ≤maxBytes 的 Blob，失败返回 null。 */
  const STEPS = [
    {scale: 1, quality: 0.92, asJpeg: false},
    {scale: 1, quality: 0.82, asJpeg: false},
    {scale: 1, quality: 0.85, asJpeg: true},
    {scale: 0.9, quality: 0.8, asJpeg: true},
    {scale: 0.8, quality: 0.78, asJpeg: true},
    {scale: 0.7, quality: 0.75, asJpeg: true},
    {scale: 0.6, quality: 0.7, asJpeg: true},
    {scale: 0.5, quality: 0.68, asJpeg: true},
    {scale: 0.4, quality: 0.65, asJpeg: true}
  ];

  function encode(bitmap, step) {
    const w = Math.max(1, Math.round(bitmap.width * step.scale));
    const h = Math.max(1, Math.round(bitmap.height * step.scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    const keepPng = !step.asJpeg && step.quality >= 0.9;
    const type = keepPng ? 'image/png' : 'image/jpeg';
    return new Promise(resolve => canvas.toBlob(resolve, type, step.quality));
  }

  async function shrink(file, maxBytes, onStep) {
    if (typeof createImageBitmap !== 'function') throw new Error('当前浏览器不支持 createImageBitmap');
    const bitmap = await createImageBitmap(file);
    try {
      for (const step of STEPS) {
        const blob = await encode(bitmap, step);
        if (!blob) continue;
        if (typeof onStep === 'function') onStep({step, size: blob.size});
        if (blob.size <= maxBytes) return blob;
      }
      return null;
    } finally {
      if (typeof bitmap.close === 'function') bitmap.close();
    }
  }

  /** 给发布流程用：按 plan 决定是否替换 asset；返回 {changed, note} 或抛错。 */
  async function fitOrExplain(file, maxBytes) {
    const decision = plan(file.size, file.type || (file.name || '').split('.').pop(), maxBytes);
    if (decision.action === 'none') return {changed: false};
    if (decision.action === 'block')
      throw new Error(file.name + '（' + (file.size / MB).toFixed(1) + 'MB）' + decision.reason
        + '；请改用 ≤' + (maxBytes / MB).toFixed(0) + 'MB 的图片或本地压缩后替换。');
    const blob = await shrink(file, maxBytes);
    if (!blob) throw new Error(file.name + '（' + (file.size / MB).toFixed(1) + 'MB）压缩后仍超过上限，请改用更小的图片。');
    const out = new File([blob], file.name.replace(/\.[^.]+$/, '') + (blob.type === 'image/jpeg' ? '.jpg' : '.png'),
      {type: blob.type, lastModified: Date.now()});
    return {changed: true, file: out,
      note: file.name + ' ' + (file.size / MB).toFixed(1) + 'MB → ' + (out.size / MB).toFixed(1) + 'MB（浏览器内重编码）'};
  }

  return {MB, plan, shrink, fitOrExplain, STEPS};
})();
if (typeof module !== 'undefined') module.exports = DraftImageShrink;
