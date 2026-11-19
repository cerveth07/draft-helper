'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const start = source.indexOf('function readBundle(files) {');
const end = source.indexOf('// Automatic selection uses', start);
assert.ok(start >= 0 && end > start, 'manual reader functions must exist');
const {readBundle, readBundleIndividualFiles} = vm.runInNewContext(
  source.slice(start, end) + '\n({readBundle,readBundleIndividualFiles})');

const file = (name, text, relativePath = '') => ({
  name, webkitRelativePath: relativePath, size: text.length,
  text: async () => text,
  arrayBuffer: async () => new TextEncoder().encode(text).buffer
});
const roots = () => [
  file('manifest.json', JSON.stringify({bundleContractVersion:1, contentImages:[{bundleFile:'001.jpg'}]})),
  file('raw-content.txt','<p>每日简报</p>'),
  file('preparation-report.json', JSON.stringify({bundle_contract_version:1,state:'PREPARED'})),
  file('source-wechat.json', '{}')
];
test('manual root-file and assets selectors produce the same complete bundle as the old folder picker', async () => {
  const images = [file('001.jpg','original image bytes')];
  const manual = await readBundleIndividualFiles(roots(),images);
  assert.equal(manual.assets.size,5);
  assert.ok(manual.assets.get('assets/001.jpg') === images[0]);
  assert.ok(manual.assets.has('source-wechat.json'));
  const old = await readBundle([...roots(), ...images].map(f => ({
    ...f, webkitRelativePath: 'wechat-ready/' + (f.name === '001.jpg' ? 'assets/' : '') + f.name
  })));
  assert.deepEqual([...manual.assets.keys()], [...old.assets.keys()]);
  assert.equal(manual.html,old.html);
  assert.equal(manual.manifest.bundleContractVersion,1);
});
test('manual file selection rejects incomplete root files instead of silently choosing another package', async () => {
  assert.throws(() => readBundleIndividualFiles(roots().slice(1),[file('001.jpg','image')]), /manifest.json/);
  assert.throws(() => readBundleIndividualFiles([],[]), /JSON\/TXT/);
});
test('manual file selection refuses duplicate asset filenames and invalid paths', async () => {
  const image=file('001.jpg','image');
  assert.throws(() => readBundleIndividualFiles(roots(),[image,image]),/重复文件路径/);
  assert.throws(() => readBundleIndividualFiles(roots(),[file('../escape.jpg','image')]),/文件名不合法/);
});
test('manual picker ignores extra root reports, rejects binaries, and preserves original File objects', async () => {
  assert.throws(() => readBundleIndividualFiles([...roots(), file('unrelated.exe','bad')],[]),
    /只选择根目录中的 JSON\/TXT 文件/);
  const images=[file('cover.png','real-original')];
  const result=await readBundleIndividualFiles([...roots(),file('additional-audit.json','{}')],images);
  assert.ok(!result.assets.has('additional-audit.json'));
  assert.strictEqual(result.assets.get('assets/cover.png'),images[0]);
});
