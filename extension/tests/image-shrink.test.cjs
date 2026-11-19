'use strict';
// 超限图片压缩的纯决策逻辑（不涉及 canvas，可在 Node 里跑）
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../image-shrink.js');

const MB = 1024 * 1024;
const LIMIT = 6 * MB;

test('未超限时不动', () => {
  assert.equal(S.plan(LIMIT, 'image/jpeg', LIMIT).action, 'none');
  assert.equal(S.plan(2 * MB, 'image/gif', LIMIT).action, 'none');
});

test('静图超限走压缩', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp', 'image/bmp'])
    assert.equal(S.plan(LIMIT + 1, type, LIMIT).action, 'shrink', type);
});

test('GIF 超限拦下且给出原因（不静默转静图）', () => {
  const decision = S.plan(6.25 * MB, 'image/gif', LIMIT);
  assert.equal(decision.action, 'block');
  assert.match(decision.reason, /GIF/);
  assert.match(decision.reason, /动效/);
});

test('未知格式与非法参数拦下', () => {
  assert.equal(S.plan(7 * MB, 'image/tiff', LIMIT).action, 'block');
  assert.equal(S.plan(7 * MB, '', LIMIT).action, 'block');
  assert.equal(S.plan(NaN, 'image/jpeg', LIMIT).action, 'block');
  assert.equal(S.plan(7 * MB, 'image/jpeg', NaN).action, 'block');
});

test('平台上限参与判断：同尺寸图在不同平台结论不同', () => {
  const bytes = 3 * MB;
  assert.equal(S.plan(bytes, 'image/jpeg', 6 * MB).action, 'none');
  assert.equal(S.plan(bytes, 'image/jpeg', 2 * MB).action, 'shrink');
});

test('fitOrExplain：未超限/超限 GIF 的行为', async () => {
  const under = {name: '001.jpg', size: 1 * MB, type: 'image/jpeg'};
  assert.deepEqual(await S.fitOrExplain(under, LIMIT), {changed: false});

  const gif = {name: '001.gif', size: 6.25 * MB, type: 'image/gif'};
  await assert.rejects(() => S.fitOrExplain(gif, LIMIT), (error) => {
    assert.match(error.message, /001\.gif/);
    assert.match(error.message, /6\.3MB/);
    assert.match(error.message, /GIF/);
    assert.match(error.message, /请改用/);
    return true;
  });
});

test('压缩阶梯是单调收紧的（防回归：越压越小）', () => {
  const steps = S.STEPS;
  assert.ok(steps.length >= 6);
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1], cur = steps[i];
    const prevPower = prev.scale * (prev.asJpeg ? prev.quality : 1);
    const curPower = cur.scale * (cur.asJpeg ? cur.quality : 1);
    assert.ok(curPower <= prevPower + 1e-9, `第 ${i} 步没有比上一步更紧：${JSON.stringify(cur)}`);
  }
});
