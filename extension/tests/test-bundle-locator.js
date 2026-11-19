'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const path = require('node:path');

const code = fs.readFileSync(path.resolve(__dirname, '../bundle-locator.js'), 'utf8');
const settings = new Map();
const idb = {
  open() {
    const req = {};
    setImmediate(() => {
      req.result = {
        createObjectStore() {},
        close() {},
        transaction(_table, mode) {
          const tx = {
            objectStore() {
              return {
                get(key) {
                  const q = {};
                  setImmediate(() => {q.result = settings.get(key); q.onsuccess?.();});
                  return q;
                },
                put(value, key) {
                  settings.set(key, value);
                  setImmediate(() => tx.oncomplete?.());
                },
              };
            },
          };
          return tx;
        },
      };
      req.onsuccess?.();
    });
    return req;
  },
};
let listed = [], transferred = null;
const api = {
  connection: input => input,
  health: async input => input,
  list: async () => ({options: listed}),
  readAutoBundle: async () => transferred
};
function instance() {
  return vm.runInNewContext(code + '\nDraftHelperBundleLocator;', {
    DraftHelperBridgeClient: api, indexedDB: idb, Intl, Date, Map
  });
}
const locator = instance(), issue = '2026-10-14';
const one = {id: 'daily-article-' + issue + '/09-矩阵内容/01-一点资讯', label: '原版', title: '标题', fingerprint: 'a'.repeat(64)};
const two = {...one, id: one.id + '-rev-abcdef123456', label: '修订版', fingerprint: 'b'.repeat(64)};

test('connection is persisted and reused without any directory handle or picker API', async () => {
  assert.equal(locator.authorizeWorkspace, undefined);
  assert.equal(locator.getWorkspace, undefined);
  await assert.rejects(locator.getConnection(), /尚未连接/);
  const config = {schema: 'probe', endpoint: 'http://127.0.0.1:19388', token: 'test'};
  await locator.connect(config);
  assert.deepEqual(await instance().getConnection(), config);
});

test('candidates come only from the bridge and invalid dates fail before network use', async () => {
  listed = [one];
  assert.equal((await locator.candidates('yidian', issue, {})).candidates[0].id, one.id);
  await assert.rejects(locator.candidates('yidian', '2026-02-30', {}), /无效/);
  await assert.rejects(locator.candidates('unknown', issue, {}), /无效/);
});

test('several revisions require explicit choice and invalidate it when contents change in place', async () => {
  listed = [one, two];
  const first = await locator.choices('yidian', issue, {});
  assert.equal(first.selected, null);
  await locator.selectVersion('yidian', issue, two.id, first.signature);
  assert.equal((await locator.choices('yidian', issue, {})).selected.id, two.id);
  listed = [one, {...two, fingerprint: 'c'.repeat(64)}];
  assert.equal((await locator.choices('yidian', issue, {})).selected, null);
  listed = [one, two, {...two, id: two.id + '-another'}];
  assert.equal((await locator.choices('yidian', issue, {})).selected, null);
});

test('one discovered bundle can be selected and transferred as original File objects', async () => {
  listed = [one];
  assert.equal((await locator.choices('yidian', issue, {})).selected.id, one.id);
  const image = new File(['original bytes'], '001.jpg');
  transferred = {html: 'body', assets: new Map([['assets/001.jpg', image]])};
  assert.equal((await locator.bundleFiles({}, one, 'yidian', issue)).assets.get('assets/001.jpg'), image);
});

test('Toutiao requires one exact matching original receipt from the bridge', async () => {
  const hash = text => crypto.createHash('sha256').update(text).digest('hex');
  const bundle = {manifestText: '{"title":"一点标题"}', html: 'body', toutiaoShortTitle: '短标题',
    manifest: {title: '一点标题', sourceWechatManifestSha256: 'a'.repeat(64)},
    assets: new Map([['source-wechat.json', new File(['proof'], 'source-wechat.json')]])};
  const receipt = {schema_version: 'DRAFT_HELPER_TOUTIAO_SHARED_REUSE_V1', issue_date: issue, path_base: 'record',
    shared_bundle: '../01-一点资讯', title: '短标题', source_yidian_title: '一点标题',
    source_wechat_manifest_sha256: 'a'.repeat(64), shared_manifest_sha256: hash(bundle.manifestText),
    shared_raw_sha256: hash('body'), shared_proof_sha256: hash('proof')};
  const selected = one.id.split('/');
  const verify = () => locator.verifyToutiaoReceipt({}, issue, bundle, async text => hash(text), selected);
  bundle.receipts = [];
  await assert.rejects(verify(), /未找到唯一匹配/);
  bundle.receipts = [{name: 'step10-toutiao-reuse.json', text: JSON.stringify(receipt)}];
  await verify();
  bundle.receipts.push({name: 'step10-toutiao-reuse-rev-abcdef123456.json', text: JSON.stringify(receipt)});
  await assert.rejects(verify(), /未找到唯一匹配/);
  receipt.shared_manifest_sha256 = '0'.repeat(64);
  bundle.receipts = [{name: 'step10-toutiao-reuse.json', text: JSON.stringify(receipt)}];
  await assert.rejects(verify(), /未找到唯一匹配/);
});

test('date semantics remain Asia/Shanghai issue dates', () => {
  assert.equal(locator.validDate(issue), true);
  assert.equal(locator.validDate('2026-02-30'), false);
  assert.equal(locator.validDate('../workspace'), false);
});

test('legacy Toutiao receipts retain exact hash and version checks for day and record bases', async () => {
  const hash = text => crypto.createHash('sha256').update(text).digest('hex');
  const date = '2026-10-12';
  const id = 'step10-yidian/' + date + '-ready-to-fill-rev-abcdef123456';
  const bundle = {manifestText: '{}', html: 'body', toutiaoShortTitle: '短标题',
    manifest: {title: '一点标题', sourceWechatManifestSha256: 'a'.repeat(64)},
    assets: new Map([['source-wechat.json', new File(['proof'], 'source-wechat.json')]])};
  const receipt = {schema_version: 'DRAFT_HELPER_TOUTIAO_SHARED_REUSE_V1', issue_date: date,
    shared_bundle: id, title: '短标题', source_yidian_title: '一点标题',
    source_wechat_manifest_sha256: 'a'.repeat(64), shared_manifest_sha256: hash('{}'),
    shared_raw_sha256: hash('body'), shared_proof_sha256: hash('proof')};
  const verify = () => {
    bundle.receipts = [{name: 'step10-toutiao-reuse-rev-abcdef123456.json', text: JSON.stringify(receipt)}];
    return locator.verifyToutiaoReceipt({}, date, bundle, hash, ['daily-article-' + date, ...id.split('/')]);
  };
  await verify();
  for (const base of ['day', 'record']) {receipt.path_base = base; await verify();}
  receipt.shared_bundle = id.replace('-rev-abcdef123456', '');
  await assert.rejects(verify(), /唯一匹配/);
  receipt.shared_bundle = '../' + id;
  await assert.rejects(verify(), /唯一匹配/);
  receipt.shared_bundle = id;
  receipt.shared_raw_sha256 = '0'.repeat(64);
  await assert.rejects(verify(), /唯一匹配/);
});
