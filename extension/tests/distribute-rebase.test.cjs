'use strict';
// 平台包（一点号/头条/企鹅/搜狐）里带着 source-wechat.json：分发脚本应能还原原始
// 微信稿再转出其它平台，而不是要求回头找最初的微信准备包。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {createHash} = require('node:crypto');

const repoRoot = path.join(__dirname, '..', '..');
const cli = path.join(repoRoot, 'distribute.mjs');
// 用真实尺寸的 PNG 做素材：1×1 的图会被转换层当作追踪像素剔除，不适合当正文配图。
const zlib = require('node:zlib');
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();
function chunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const checksum = Buffer.alloc(4);
  let value = 0xffffffff;
  for (const byte of body) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  checksum.writeUInt32BE((value ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, body, checksum]);
}
function makePng(width, height) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2;
  const raw = Buffer.alloc(height * (1 + width * 3), 0xdd);
  for (let y = 0; y < height; y += 1) raw[y * (1 + width * 3)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const png = makePng(120, 80);

function writeWechatBundle(dir) {
  const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
  const placeholder = 'WECHATIMGPH_1_END';
  const html = '<section><p>正文一段。</p><img src="' + placeholder + '"></section>';
  const manifest = {
    bundleContractVersion: 1, targetPlatform: 'wechat',
    title: '跨平台再分发测试标题', author: '测试作者', summary: '测试摘要',
    contentImages: [{placeholder, bundleFile: '001.png', bytes: png.length, sha256: sha(png)}],
    coverImage: null,
  };
  const manifestText = JSON.stringify(manifest, null, 2) + '\n';
  const report = {
    bundle_contract_version: 1, state: 'PREPARED', remote_image_count: 0,
    payload_sha256: sha(Buffer.from(html, 'utf8')),
    manifest_sha256: sha(Buffer.from(manifestText, 'utf8')),
  };
  fs.mkdirSync(path.join(dir, 'assets'), {recursive: true});
  fs.writeFileSync(path.join(dir, 'manifest.json'), manifestText);
  fs.writeFileSync(path.join(dir, 'raw-content.txt'), html);
  fs.writeFileSync(path.join(dir, 'preparation-report.json'), JSON.stringify(report, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'assets', '001.png'), png);
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8'});
}

test('a platform package is rebased to its WeChat source before re-distribution', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-rebase-'));
  try {
    const wechat = path.join(root, 'wechat');
    writeWechatBundle(wechat);
    const yidian = path.join(root, 'yidian');
    const first = run(['--source-dir', wechat, '--out-dir', yidian, '--platforms', 'yidian']);
    assert.equal(first.status, 0, first.stderr || first.stdout);

    const sohu = path.join(root, 'sohu');
    const second = run(['--source-dir', path.join(yidian, 'yidian'), '--out-dir', sohu, '--platforms', 'sohu']);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.match(second.stderr, /还原微信原稿/);

    const bundle = path.join(sohu, 'sohu');
    const manifest = JSON.parse(fs.readFileSync(path.join(bundle, 'manifest.json'), 'utf8'));
    assert.equal(manifest.targetPlatform, 'sohu');
    assert.equal(manifest.profile.id, 'sohu');
    assert.equal(manifest.title, '跨平台再分发测试标题');
    assert.equal(manifest.contentImages.length, 1);
    assert.match(fs.readFileSync(path.join(bundle, 'raw-content.txt'), 'utf8'), /WECHATIMGPH_1_END/);
    assert.deepEqual(fs.readFileSync(path.join(bundle, 'source-wechat.json')),
      fs.readFileSync(path.join(yidian, 'yidian', 'source-wechat.json')));
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});

test('a tampered source-wechat.json stops the conversion instead of producing a bundle', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-rebase-bad-'));
  try {
    const wechat = path.join(root, 'wechat');
    writeWechatBundle(wechat);
    const yidian = path.join(root, 'yidian');
    assert.equal(run(['--source-dir', wechat, '--out-dir', yidian, '--platforms', 'yidian']).status, 0);

    const pkg = path.join(yidian, 'yidian');
    const proof = JSON.parse(fs.readFileSync(path.join(pkg, 'source-wechat.json'), 'utf8'));
    proof.sourceHtml = proof.sourceHtml.replace('正文一段', '被改过的正文');
    fs.writeFileSync(path.join(pkg, 'source-wechat.json'), JSON.stringify(proof, null, 2));

    const sohu = path.join(root, 'sohu');
    const result = run(['--source-dir', pkg, '--out-dir', sohu, '--platforms', 'sohu']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /来源校验不通过/);
    assert.equal(fs.existsSync(sohu), false);
  } finally {
    fs.rmSync(root, {recursive: true, force: true});
  }
});
