'use strict';

/**
 * 平台图片上传受账号额度限制。同一张图重复上传既浪费额度，也会让重试永远卡在
 * 同一张（每次都从第一张重来）。这里按内容哈希记住已上传的 CDN 地址：
 * 同浏览器内弹窗与工作台共用，7 天后自动失效。
 *
 * 任何失败都静默降级为“没有缓存”，不会影响填入本身。
 */
const DraftUploadCache = (() => {
  const DB_NAME = 'draft-helper-uploads', STORE = 'images', VERSION = 1;
  const TTL = 7 * 24 * 60 * 60 * 1000;
  let opening = null;

  function open() {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB 不可用')); return; }
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('上传缓存打开失败'));
      request.onblocked = () => reject(new Error('上传缓存被占用'));
    }).catch((error) => { opening = null; throw error; });
    return opening;
  }

  async function get(key) {
    if (!key) return null;
    try {
      const db = await open();
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const request = tx.objectStore(STORE).get(key);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      if (!record || typeof record.url !== 'string' || !/^https?:\/\//.test(record.url)) return null;
      if (!Number.isFinite(record.at) || Date.now() - record.at > TTL) return null;
      return record.url;
    } catch (_) {
      return null;
    }
  }

  async function put(key, url) {
    if (!key || typeof url !== 'string' || !/^https?:\/\//.test(url)) return false;
    try {
      const db = await open();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({url, at: Date.now()}, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
      return true;
    } catch (_) {
      return false;
    }
  }

  return {get, put, TTL};
})();
