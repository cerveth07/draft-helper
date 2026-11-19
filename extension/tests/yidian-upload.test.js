'use strict';
// 一点号按账号限制图片上传量：平台只回一句 "user limit"，这里锁定缓存键与
// 报错文案（必须带进度、可执行建议，且不能吞掉其它上传错误）。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'yidian.js'), 'utf8');
const start = source.indexOf('// 缓存键优先用内容哈希');
const end = source.indexOf('async function uploadImageToYidian');
assert.ok(start >= 0 && end > start, 'yidian upload helpers must exist');
const {yidianUploadKey, yidianUploadMessage} = vm.runInNewContext(
  source.slice(start, end) + '\n({yidianUploadKey, yidianUploadMessage});');

test('cache key uses the content hash so retries and repeat articles can reuse uploads', () => {
  const digest = 'a'.repeat(64);
  assert.equal(yidianUploadKey({sha256: digest}), 'yidian:' + digest);
  assert.equal(yidianUploadKey({sha256: digest.toUpperCase()}), 'yidian:' + digest);
  assert.equal(yidianUploadKey({sha256: 'not-a-hash'}), null);
  assert.equal(yidianUploadKey({}), null);
  assert.equal(yidianUploadKey(null), null);
});

test('platform quota errors become actionable Chinese with progress and retry promise', () => {
  const message = yidianUploadMessage('user limit', {done: 12, total: 39, file: '013.jpg'});
  assert.match(message, /user limit/);
  assert.match(message, /12\/39/);
  assert.match(message, /013\.jpg/);
  assert.match(message, /素材库/);
  assert.match(message, /自动跳过/);
  assert.match(message, /正文还没有写入/);
  assert.doesNotMatch(message, /^user limit$/);
});

test('rate-limit wording variants are treated the same way', () => {
  for (const detail of ['rate limit', 'too many requests', '上传过于频繁', '额度已用尽'])
    assert.match(yidianUploadMessage(new Error(detail), {done: 1, total: 3}), /额度或频率受限/);
});

test('other upload failures keep the platform detail instead of blaming quota', () => {
  const message = yidianUploadMessage('network timeout', {done: 4, total: 9, file: '005.png'});
  assert.match(message, /一点号图片上传失败/);
  assert.match(message, /005\.png/);
  assert.match(message, /network timeout/);
  assert.doesNotMatch(message, /额度/);
});
