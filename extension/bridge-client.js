/* Experimental byte reader. No editor access, persistence, or version selection. */
'use strict';
const DraftHelperBridgeClient = (() => {
  const SCHEMA = 'DRAFT_HELPER_BRIDGE_PROBE_V1';
  const MAX_FILE = 32 * 1024 * 1024;
  const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(value => value.toString(16).padStart(2, '0')).join('');

  function connection(input) {
    if (input.schema !== SCHEMA || !/^http:\/\/127\.0\.0\.1:\d+$/.test(input.endpoint || '')
        || !/^[a-f0-9]{64}$/.test(input.token || '')) throw new Error('连接文件无效，请使用本机助手生成的 connection.json。');
    const port = Number(new URL(input.endpoint).port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('连接端口无效。');
    return {schema: SCHEMA, endpoint: input.endpoint, token: input.token};
  }

  async function request(config, route) {
    let response;
    try {
      response = await fetch(config.endpoint + route, {headers: {Authorization: 'Bearer ' + config.token},
        credentials: 'omit', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000)});
    } catch (_) { throw new Error('无法连接本机助手。请确认 WSL 和读取服务已启动，再点击重试。'); }
    if (response.status === 401) throw new Error('连接凭证失效，请重新选择连接文件。');
    if (response.status === 409) throw new Error('准备包已变化或不可用，请刷新准备包并检查本期生成结果。');
    if (response.status === 404 && route.startsWith('/v1/bundles?')) throw new Error('本机服务版本过旧，请更新并重新启动服务。');
    if (!response.ok) throw new Error('本机读取失败（HTTP ' + response.status + '），未完成验证。');
    return response;
  }

  async function readBundle(input) {
    const config = connection(input);
    const index = await (await request(config, '/v1/bundle')).json();
    if (index.schema !== SCHEMA || !Array.isArray(index.files) || index.files.length > 256)
      throw new Error('本机助手接口版本或文件清单无效。');
    const names = new Set();
    let total = 0;
    for (const item of index.files) {
      if (!/^(?:manifest\.json|raw-content\.txt|preparation-report\.json|source-wechat\.json|matrix-format\.json|preview-(?:article|yidian|toutiao|sohu)\.html|matrix-(?:yidian|toutiao|sohu)-(?:content\.txt|report\.json)|title-(?:yidian|toutiao|sohu)\.txt|分发处理日志-(?:一点资讯|今日头条|搜狐号)\.txt|assets\/[^/\\\x00-\x1f\x7f]+)$/.test(item.name || '')
          || ['assets/.', 'assets/..'].includes(item.name) || names.has(item.name)
          || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > MAX_FILE
          || !/^[a-f0-9]{64}$/.test(item.sha256 || '')) throw new Error('本机助手返回了不允许的文件清单。');
      names.add(item.name);
      total += item.bytes;
    }
    if (total > 128 * 1024 * 1024) throw new Error('准备包超过读取上限。');
    const assets = new Map();
    for (const item of index.files) {
      const response = await request(config, '/v1/files/' + encodeURIComponent(item.name));
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength !== item.bytes || await digest(bytes) !== item.sha256)
        throw new Error('文件完整性校验失败：' + item.name);
      assets.set(item.name, new File([bytes], item.name.split('/').pop()));
    }
    for (const name of ['manifest.json', 'raw-content.txt', 'preparation-report.json'])
      if (!assets.has(name)) throw new Error('准备包缺少必要文件：' + name);
    const manifestText = await assets.get('manifest.json').text();
    const html = await assets.get('raw-content.txt').text();
    const manifest = JSON.parse(manifestText);
    const report = JSON.parse(await assets.get('preparation-report.json').text());
    const fileHash = async name => digest(await assets.get(name).arrayBuffer());
    if (manifest.bundleContractVersion !== 1 || report.bundle_contract_version !== 1 || report.state !== 'PREPARED'
        || await fileHash('manifest.json') !== report.manifest_sha256
        || await fileHash('raw-content.txt') !== report.payload_sha256
        || index.fingerprint !== report.manifest_sha256 || index.issueDate !== manifest.issueDate
        || index.platform !== (manifest.targetPlatform || 'wechat')) throw new Error('正文、日期或清单 SHA 校验失败。');
    if (!Array.isArray(manifest.contentImages) || !manifest.contentImages.length) throw new Error('准备包没有图片清单。');
    for (const item of [...manifest.contentImages, ...(manifest.coverImage ? [manifest.coverImage] : [])]) {
      if (typeof item.bundleFile !== 'string' || /[\\/\x00-\x1f\x7f]/.test(item.bundleFile)
          || ['', '.', '..'].includes(item.bundleFile)) throw new Error('图片文件名无效。');
      const file = assets.get('assets/' + item.bundleFile);
      if (!file || file.size !== item.bytes || await digest(await file.arrayBuffer()) !== item.sha256)
        throw new Error('图片与原始清单不一致：' + item.bundleFile);
    }
    if (manifest.sourceProofSha256 && (!assets.has('source-wechat.json')
        || await fileHash('source-wechat.json') !== manifest.sourceProofSha256)) throw new Error('来源文件 SHA 校验失败。');
    return {html, manifestText, manifest, report, assets};
  }

  async function health(input) {
    const config = connection(input);
    const value = await (await request(config, '/v1/health')).json();
    if (value.schema !== SCHEMA || value.status !== 'ready') throw new Error('本机助手版本不兼容，请更新后重新连接。');
    return config;
  }

  async function list(input, platform, date) {
    const config = connection(input);
    const query = new URLSearchParams({platform, date});
    const value = await (await request(config, '/v1/bundles?' + query)).json();
    const ids = new Set();
    if (value.schema !== SCHEMA || !Array.isArray(value.options) || value.options.length > 64)
      throw new Error('本机助手返回的版本列表无效。');
    for (const item of value.options) {
      if (!item || typeof item.id !== 'string' || !item.id.startsWith('daily-article-' + date + '/')
          || item.id.split('/').some(part => !part || part === '.' || part === '..' || /[\\\x00-\x1f]/.test(part))
          || !/^[a-f0-9]{64}$/.test(item.fingerprint || '') || ids.has(item.id)
          || typeof item.label !== 'string' || typeof item.title !== 'string') throw new Error('本机助手返回的版本列表无效。');
      ids.add(item.id);
    }
    return value;
  }

  async function readAutoBundle(input, entry, platform, date) {
    const config = connection(input);
    const query = new URLSearchParams({date, platform, id: entry.id, fingerprint: entry.fingerprint});
    const index = await (await request(config, '/v1/auto/bundle?' + query)).json();
    if (index.schema !== SCHEMA || index.issueDate !== date || index.fingerprint !== entry.fingerprint
        || !Array.isArray(index.files) || index.files.length > 256
        || !Array.isArray(index.receipts) || index.receipts.length > 64)
      throw new Error('准备包版本、日期或文件清单无效，请刷新后重试。');
    const assets = new Map(), receipts = [], names = new Set();
    let total = 0;
    for (const item of [...index.files, ...index.receipts.map(item => ({...item, name: 'receipts/' + item.name}))]) {
      const name = item.name;
      if (!/^(?:manifest\.json|raw-content\.txt|preparation-report\.json|source-wechat\.json|matrix-format\.json|preview-(?:article|yidian|toutiao|sohu)\.html|matrix-(?:yidian|toutiao|sohu)-(?:content\.txt|report\.json)|title-(?:yidian|toutiao|sohu)\.txt|分发处理日志-(?:一点资讯|今日头条|搜狐号)\.txt|assets\/[^/\\\x00-\x1f\x7f]+|receipts\/step10-toutiao-reuse(?:-rev-[a-f0-9]{12})?\.json)$/.test(name || '')
          || ['assets/.', 'assets/..'].includes(name) || names.has(name)
          || !Number.isSafeInteger(item.bytes) || item.bytes < 0 || item.bytes > MAX_FILE
          || !/^[a-f0-9]{64}$/.test(item.sha256 || '')) throw new Error('本机助手返回的文件清单无效。');
      names.add(name);
      total += item.bytes;
      if (total > 128 * 1024 * 1024) throw new Error('准备包超过读取上限。');
      const bytes = await (await request(config, '/v1/auto/file?' + query + '&name=' + encodeURIComponent(name))).arrayBuffer();
      if (bytes.byteLength !== item.bytes || await digest(bytes) !== item.sha256) throw new Error('文件完整性校验失败：' + name);
      const file = new File([bytes], name.split('/').pop());
      if (name.startsWith('receipts/')) receipts.push({name: file.name, text: await file.text()});
      else assets.set(name, file);
    }
    for (const name of ['manifest.json', 'raw-content.txt', 'preparation-report.json'])
      if (!assets.has(name)) throw new Error('准备包缺少必要文件：' + name);
    const manifestText = await assets.get('manifest.json').text();
    return {html: await assets.get('raw-content.txt').text(), manifestText, manifest: JSON.parse(manifestText),
      report: JSON.parse(await assets.get('preparation-report.json').text()), assets, receipts};
    // Platform contracts and original report/image hashes remain owned by verifyBundle.
  }
  return {connection, health, list, readBundle, readAutoBundle};
})();
if (typeof module !== 'undefined') module.exports = DraftHelperBridgeClient;
