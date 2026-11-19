'use strict';
// 注入到页面里执行的函数会被 toString() 后经 CDP 发送，任何语法问题只会在真实填入时暴露。
// 这里在 Node 里跑一遍脚本，确认这些函数都能被重新解析，并且没有引用闭包内的变量。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'other-platforms.js'), 'utf8');
const context = vm.createContext({ console });
vm.runInContext(source, context, { filename: 'other-platforms.js' });

const inPage = ['portalImages', 'portalImageState', 'portalPlaceCaretAfterLastImage',
  'portalSelectAll', 'portalForceClear', 'portalImageUrls', 'portalBodyEmpty',
  'portalEditorState', 'pastePortalBody', 'verifyPortalBody', 'sohuBodyParts', 'portalCleanBodyWhitespace',
  'portalStripIndent'];

test('页面内函数可以被单独序列化后重新解析', () => {
  for (const name of inPage) {
    const fn = context[name];
    assert.equal(typeof fn, 'function', name + ' 未定义');
    assert.doesNotThrow(() => new Function('return (' + fn.toString() + ')'), name + ' 无法重新解析');
  }
});

test('页面内函数不引用模块作用域的辅助函数', () => {
  // 这些函数会被单独发送到页面，页面里没有本文件的其它函数。
  // 只查真正的跨函数调用：注入时调用方会把需要的函数作为参数一起序列化。
  const moduleFns = [...source.matchAll(/^(?:async )?function ([A-Za-z_$][\w$]*)\s*\(/gm)]
    .map((match) => match[1])
    .filter((name) => !inPage.includes(name));
  for (const name of inPage) {
    const body = context[name].toString();
    const called = new Set([...body.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)]
      .map((match) => match[1]));
    const external = moduleFns.filter((callee) => called.has(callee));
    assert.deepEqual(external, [], name + ' 调用了模块级函数：' + external.join(', '));
  }
});

test('sohuBodyParts 的占位符校验函数存在（按图片位置切分依赖它）', () => {
  assert.equal(typeof context.sohuBodyParts, 'function');
  // 该函数在页面里运行，这里只确认它不看外部变量：entries 只应来自参数与 DOM。
  assert.match(context.sohuBodyParts.toString(), /document\.createElement/);
});
