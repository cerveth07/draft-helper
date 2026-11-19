/* Auto selection reads through the authenticated loopback bridge.
 * IndexedDB stores only connection and explicit version choices, never directory handles.
 * popup.js remains the owner of all platform content validation.
 */
'use strict';
const DraftHelperBundleLocator = (() => {
  const DB = 'draft-helper-bundle-locator-v1';
  const STORE = 'settings';

  const localDate = () => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const item = (key) => parts.find((part) => part.type === key).value;
    return item('year') + '-' + item('month') + '-' + item('day');
  };

  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + 'T00:00:00Z')) &&
    new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

  function database() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }
  async function setting(key) {
    const db = await database();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
    } finally { db.close(); }
  }
  async function putSetting(key, value) {
    const db = await database();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }

  async function connect(input) {
    const config = await DraftHelperBridgeClient.health(input);
    await putSetting('bridge-connection', config);
    return config;
  }

  async function getConnection() {
    const config = await setting('bridge-connection');
    if (!config) throw new Error('尚未连接本机助手，请先点击“连接本机助手”。');
    return DraftHelperBridgeClient.connection(config);
  }

  async function candidates(platform, date, config) {
    if (!['wechat', 'yidian', 'toutiao', 'penguin', 'sohu'].includes(platform) || !validDate(date))
      throw new Error('稿件日期或当前平台无效。');
    const result = await DraftHelperBridgeClient.list(config, platform, date);
    return {candidates: result.options};
  }

  async function choices(platform, date, root) {
    const result = await candidates(platform, date, root);
    const options = [...result.candidates].sort((a, b) => a.id.localeCompare(b.id));
    const signature = options.map((item) => item.id + ':' + item.fingerprint).join('|');
    const samePlan = await setting('choice:' + date + ':' + platform);
    const explicit = samePlan && samePlan.signature === signature
      ? options.find((item) => item.id === samePlan.id) : null;
    // A registered original is not an approval of a later revision.
    // With several versions, require a stable, explicit user choice.
    const selected = explicit || (options.length === 1 ? options[0] : null);
    return {options, selected, signature};
  }

  async function selectVersion(platform, date, entryId, signature) {
    await putSetting('choice:' + date + ':' + platform, {id: entryId, signature});
  }

  async function bundleFiles(config, entry, platform, date) {
    return DraftHelperBridgeClient.readAutoBundle(config, entry, platform, date);
  }

  async function verifyToutiaoReceipt(root, date, bundle, sha256Text, selectedPath) {
    const legacy = selectedPath[1] === 'step10-yidian';
    const base = legacy ? [] : ['09-矩阵内容', '02-今日头条'];
    if (selectedPath[0] !== 'daily-article-' + date)
      throw new Error('头条来源回执与稿件日期不匹配。');
    const manifestHash = await sha256Text(bundle.manifestText);
    const bodyHash = await sha256Text(bundle.html);
    const proofFile = bundle.assets.get('source-wechat.json');
    const proofHash = proofFile ? await sha256Text(await proofFile.text()) : null;
    const normal = selectedPath.slice(1);
    let matched = 0;
    for (const item of bundle.receipts || []) {
      if (!/^step10-toutiao-reuse(?:-rev-[a-f0-9]{12})?\.json$/.test(item.name)) continue;
      const receipt = JSON.parse(item.text);
      if (receipt.schema_version !== 'DRAFT_HELPER_TOUTIAO_SHARED_REUSE_V1' ||
          receipt.issue_date !== date || !(receipt.path_base === 'record'
            || (legacy && (receipt.path_base === 'day' || receipt.path_base === undefined))) ||
          receipt.title !== bundle.toutiaoShortTitle ||
          receipt.source_yidian_title !== bundle.manifest.title ||
          receipt.shared_manifest_sha256 !== manifestHash ||
          receipt.shared_raw_sha256 !== bodyHash ||
          receipt.shared_proof_sha256 !== proofHash ||
          receipt.source_wechat_manifest_sha256 !== bundle.manifest.sourceWechatManifestSha256) continue;
      if (typeof receipt.shared_bundle !== 'string' || receipt.shared_bundle.startsWith('/')
          || /[\\\x00-\x1f]/.test(receipt.shared_bundle)) continue;
      const path = [...base];
      let escaped = false;
      for (const part of receipt.shared_bundle.split('/')) {
        if (part === '..') { if (!path.length) escaped = true; else path.pop(); }
        else if (part && part !== '.') path.push(part);
      }
      if (!escaped && path.join('/') === normal.join('/')) matched += 1;
    }
    if (matched !== 1) throw new Error('未找到唯一匹配的头条来源回执，请核实当前修订版或手动选包。');
  }

  return {localDate, validDate, connect, getConnection,
          candidates, choices, selectVersion, bundleFiles, verifyToutiaoReceipt};
})();
