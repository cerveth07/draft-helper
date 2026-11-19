'use strict';
/**
 * attachDebugger 外来扩展 iframe 自愈回归（纯 Node，无需浏览器）。
 *
 * 实页症状：一点号编辑页报
 *   Chrome 因页面中其他扩展的内容拒绝连接调试器
 * 根因：页内嵌了 MOJi 词典等其它扩展的 chrome-extension:// iframe，Chrome 硬性禁止对该标签挂调试器。
 * 期望：首次 attach 失败 → 移除外来 iframe → 重试；仍失败时报出具体扩展 ID 与「停用」指引。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'popup.js'), 'utf8');
const start = source.indexOf('async function removeForeignExtensionFrames(');
const end = source.indexOf('// Capture the active editor');
assert.ok(start > 0 && end > start, '无法从 popup.js 定位 attachDebugger 相关源码');
const snippet = source.slice(start, end);

const FOREIGN = 'Cannot access a chrome-extension:// URL of different extension';

function buildContext({ failures = 0, frames = [] } = {}) {
  const calls = [];
  const removed = [];
  const fakeFrames = frames.map((src) => ({
    className: 'MOJiWebExtensionpanelObject',
    getAttribute: () => src,
    remove: () => removed.push(src),
  }));
  const chrome = {
    debugger: {
      attach: async () => {
        calls.push('attach');
        if (failures > 0) { failures -= 1; throw new Error(FOREIGN); }
      },
      detach: async () => { calls.push('detach'); },
      onDetach: { addListener: () => {} },
    },
    scripting: {
      executeScript: async ({ func }) => {
        calls.push('remove-frames');
        return [{ result: func() }];
      },
    },
  };
  const context = vm.createContext({ chrome, console, setTimeout,
    window: { addEventListener: () => {} },
    document: {
      querySelectorAll: (selector) => (selector === 'iframe' ? fakeFrames : []),
    } });
  vm.runInContext(snippet, context);
  return { context, calls, removed, failuresLeft: () => failures };
}

test('attach 正常时不碰页面里的任何 iframe', async () => {
  const { context, calls, removed } = buildContext();
  await context.attachDebugger(1);
  assert.deepEqual(calls, ['attach']);
  assert.equal(removed.length, 0);
});

test('外来扩展 iframe 导致 attach 失败时：移除后重试成功', async () => {
  const foreignSrc = 'chrome-extension://edoiodnmpjehmemkkfmnefmkboeaahlf/panel.html';
  const { context, calls, removed } = buildContext({ failures: 1, frames: [foreignSrc] });
  await context.attachDebugger(1);
  assert.deepEqual(calls, ['attach', 'remove-frames', 'attach']);
  assert.deepEqual(removed, [foreignSrc]);
});

test('页面自身 iframe（非 chrome-extension://）不被移除', async () => {
  const { context, removed } = buildContext({ failures: 1, frames: ['about:blank', 'https://mp.yidianzixun.com/upload'] });
  await context.attachDebugger(1);
  assert.equal(removed.length, 0);
});

test('重试仍失败时：报出扩展 ID 与停用指引，不静默通过', async () => {
  const foreignSrc = 'chrome-extension://edoiodnmpjehmemkkfmnefmkboeaahlf/panel.html';
  const { context } = buildContext({ failures: 2, frames: [foreignSrc] });
  await assert.rejects(() => context.attachDebugger(1), (error) => {
    assert.match(error.message, /Chrome 硬限制/);
    assert.match(error.message, /edoiodnmpjehmemkkfmnefmkboeaahlf/);
    assert.match(error.message, /chrome:\/\/extensions/);
    assert.match(error.message, /刷新页面即可恢复/);
    return true;
  });
});

test('其它 attach 失败翻译成可读提示，但仍保留原始原因', async () => {
  const chrome = {
    debugger: {
      attach: async () => { throw new Error('Cannot attach to this tab'); },
      detach: async () => {},
      onDetach: { addListener: () => {} },
    },
    scripting: { executeScript: async () => [{ result: [] }] },
  };
  const context = vm.createContext({ chrome, console, setTimeout,
    window: { addEventListener: () => {} },
    document: { querySelectorAll: () => [] } });
  vm.runInContext(snippet, context);
  await assert.rejects(() => context.attachDebugger(1), /无法连接这个页面/);
});
