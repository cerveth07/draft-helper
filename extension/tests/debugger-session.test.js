'use strict';
// 一点号等平台在同一标签页内切换文章，标签页 id 不变；若上一次填入的调试会话
// 没有释放，下一篇就会报 “Another debugger is already attached”。这里锁定
// attachDebugger 的自我恢复与可读报错行为。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const start = source.indexOf('// Chrome 每个标签页只允许一个调试器客户端');
const end = source.indexOf('// Capture the active editor');
assert.ok(start >= 0 && end > start, 'debugger session helpers must exist');

function setup(script = {}) {
  const calls = [];
  const queue = {attach: [...(script.attach || [])], detach: [...(script.detach || [])]};
  const chrome = {
    debugger: {
      attach: async ({tabId}, version) => {
        calls.push('attach:' + tabId + '@' + version);
        const step = queue.attach.shift();
        if (step) throw new Error(step);
      },
      detach: async ({tabId}) => {
        calls.push('detach:' + tabId);
        const step = queue.detach.shift();
        if (step) throw new Error(step);
      },
      onDetach: {addListener: () => {}},
    },
  };
  const context = {
    chrome,
    window: {addEventListener: () => {}},
    removeForeignExtensionFrames: async () => [],
  };
  const methods = vm.runInNewContext(
    source.slice(start, end) + '\n({attachDebugger, attachErrorMessage, releaseDebuggerSessions});', context);
  return {methods, calls};
}

test('a leftover session from this extension is released and the attach retried', async () => {
  const app = setup({
    attach: ['Another debugger is already attached to the tab with id: 7'],
    detach: [],
  });
  await app.methods.attachDebugger(7);
  assert.deepEqual(app.calls, ['attach:7@1.3', 'detach:7', 'attach:7@1.3']);
});

test('an external debugger such as DevTools produces an actionable message', async () => {
  const app = setup({
    attach: ['Another debugger is already attached to the tab with id: 7'],
    detach: ['Debugger is not attached to the tab with id: 7'],
  });
  await assert.rejects(() => app.methods.attachDebugger(7), /DevTools/);
  assert.deepEqual(app.calls, ['attach:7@1.3', 'detach:7']);
});

test('a released session that immediately gets taken again still reports readable Chinese', async () => {
  const app = setup({
    attach: ['Another debugger is already attached to the tab with id: 7',
      'Another debugger is already attached to the tab with id: 7'],
    detach: [],
  });
  await assert.rejects(() => app.methods.attachDebugger(7), /调试器/);
});

test('closed or navigated-away tabs are explained instead of leaking the raw Chrome error', async () => {
  const app = setup({attach: ['No tab with given id 7.']});
  await assert.rejects(() => app.methods.attachDebugger(7), /标签页已关闭或已跳转/);
});

test('page unload detaches only the sessions this page opened', async () => {
  const app = setup();
  await app.methods.attachDebugger(3);
  app.methods.releaseDebuggerSessions();
  assert.deepEqual(app.calls, ['attach:3@1.3', 'detach:3']);
  assert.equal(app.methods.attachErrorMessage('Something else entirely'), '无法连接页面调试器：Something else entirely');
});
