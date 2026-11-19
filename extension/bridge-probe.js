'use strict';
const input = document.querySelector('#connection');
const button = document.querySelector('#read');
const result = document.querySelector('#result');
const preview = document.querySelector('#preview');
let config = null, previewUrl = null;
function clearPreview() {
  preview.hidden = true;
  preview.removeAttribute('src');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
}
input.addEventListener('change', async () => {
  if (!input.files.length) return;
  config = null;
  button.disabled = true;
  clearPreview();
  try {
    if (input.files[0].size > 16384) throw new Error('连接文件过大，请选择 connection.json。');
    config = DraftHelperBridgeClient.connection(JSON.parse(await input.files[0].text()));
    result.textContent = '连接文件已就绪，点击读取以验证。';
    button.disabled = false;
  } catch (_) { result.textContent = '连接文件无效，请重新选择本机助手生成的 connection.json。'; }
  input.value = '';
});
button.addEventListener('click', async () => {
  button.disabled = true;
  input.disabled = true;
  clearPreview();
  result.textContent = '正在读取正文与图片，并逐项核对 SHA-256…';
  try {
    const bundle = await DraftHelperBridgeClient.readBundle(config);
    result.textContent = '读取与文件完整性验证通过\n稿件日期：' + bundle.manifest.issueDate
      + '\n包内平台：' + (bundle.manifest.targetPlatform || 'wechat')
      + '\n标题：' + bundle.manifest.title + '\n已核对文件：' + bundle.assets.size
      + '\n正文、清单、图片与封面字节及 SHA 均一致。\n此结果不表示已完成填稿或重启恢复验收。';
    previewUrl = URL.createObjectURL(bundle.assets.get('assets/' + bundle.manifest.contentImages[0].bundleFile));
    preview.src = previewUrl;
    preview.hidden = false;
  } catch (error) { result.textContent = '未完成验证：' + error.message; }
  finally { button.disabled = !config; input.disabled = false; }
});
window.addEventListener('pagehide', clearPreview);
