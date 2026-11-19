'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../popup.js'), 'utf8');
const start = source.indexOf('function readBundle(files)');
const end = source.indexOf('const E3_HEADER_SHA256');

function setup(platform = 'wechat') {
  const date = '2026-10-15', calls = [];
  const entry = {id: 'daily-article-' + date + '/section/ready', title: '原版标题', label: 'ready', fingerprint: 'a'.repeat(64)};
  const state = {platform, options: [entry], signature: 'first', selected: entry};
  const nodes = new Map();
  function node(id) {
    if (nodes.has(id)) return nodes.get(id);
    const value = {files: [], textContent: '', hidden: false, disabled: false, dataset: {}, options: [], listeners: {}, _value: '',
      addEventListener(name, callback) {this.listeners[name] = callback;},
      replaceChildren() {this.options = []; this._value = '';},
      append(option) {this.options.push(option);},
      get selectedOptions() {return this.options.filter(option => option.value === this._value);},
      get value() {return this._value;},
      set value(value) {this._value = value; if (!value && this.files.length) this.files = [];}
    };
    nodes.set(id, value);
    return value;
  }
  const bundle = {manifest: {issueDate: date, title: '原版标题'}, assets: new Map()};
  const api = {
    localDate: () => date,
    getConnection: async () => ({}),
    choices: async () => ({options: state.options, selected: state.selected, signature: state.signature}),
    bundleFiles: async (_config, selected) => {calls.push('read:' + selected.id); return bundle;},
    selectVersion: async () => {calls.push('save');},
    verifyToutiaoReceipt: async () => {calls.push('receipt');}
  };
  const methods = vm.runInNewContext(source.slice(start, end) + '\n({refreshAutoChoice,selectedDraftBundle,verifySelectedDraft});', {
    $: selector => node(selector.slice(1)), DraftHelperBundleLocator: api,
    currentEditorTab: async () => ({url: state.platform}), identifyDraftPlatform: value => value,
    platformName: value => value,
    Option: function(text, value) {this.textContent = text; this.value = value;},
    verifyBundle: async () => {calls.push('full-verifier');}, sha256Text: async () => 'hash'
  });
  return {methods, node, state, entry, calls, bundle};
}

test('automatic filling selection always reaches existing full verifier before saving its choice', async () => {
  const app = setup('toutiao');
  await app.methods.refreshAutoChoice();
  const selection = await app.methods.selectedDraftBundle('toutiao');
  await app.methods.verifySelectedDraft(selection, 'toutiao');
  assert.deepEqual(app.calls.slice(1), ['full-verifier', 'receipt', 'save']);
  assert.match(app.node('auto-status').textContent, /原版标题/);
});

test('multiple versions cannot select themselves and an explicit displayed choice is respected', async () => {
  const app = setup();
  const revision = {...app.entry, id: app.entry.id + '-rev-123', label: 'rev', fingerprint: 'b'.repeat(64)};
  app.state.options = [app.entry, revision]; app.state.selected = null;
  await app.methods.refreshAutoChoice();
  await assert.rejects(() => app.methods.selectedDraftBundle('wechat'), /未确定唯一/);
  assert.equal(app.calls.length, 0);
  app.node('auto-version').value = revision.id;
  const result = await app.methods.selectedDraftBundle('wechat');
  assert.equal(result.automatic.entry.id, revision.id);
});

test('changed revision signature or platform stops before reading a previously displayed bundle', async () => {
  const app = setup();
  await app.methods.refreshAutoChoice();
  app.state.signature = 'updated';
  await assert.rejects(() => app.methods.selectedDraftBundle('wechat'), /已变化/);
  assert.equal(app.calls.length, 0);
  app.state.platform = 'sohu';
  await assert.rejects(() => app.methods.selectedDraftBundle('sohu'), /已变化/);
  assert.equal(app.calls.length, 0);
});

test('clearing a remembered multi-version choice does not fall back to that saved version', async () => {
  const app = setup();
  app.state.options.push({...app.entry, id: app.entry.id + '-rev-123', label: 'rev'});
  await app.methods.refreshAutoChoice();
  assert.equal(app.node('auto-version').value, app.entry.id);
  app.node('auto-version').value = '';
  await assert.rejects(() => app.methods.selectedDraftBundle('wechat'), /未确定唯一/);
  assert.equal(app.calls.length, 0);
});

test('changing issue date clears all manual file selectors and explicit clear restores auto mode', async () => {
  const app = setup();
  for (const id of ['bundle', 'bundle-meta', 'bundle-assets']) app.node(id).files = [{}];
  app.node('issue-date').listeners.change();
  for (const id of ['bundle', 'bundle-meta', 'bundle-assets']) assert.equal(app.node(id).files.length, 0);
  app.node('bundle').files = [{}];
  app.node('clear-manual').listeners.click();
  assert.equal(app.node('bundle').files.length, 0);
});
