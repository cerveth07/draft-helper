'use strict';

const $ = (selector) => document.querySelector(selector);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const status = (message) => { $('#status').textContent = message; };
const versionManifest = chrome.runtime?.getManifest?.();
const version = versionManifest?.version_name || versionManifest?.version || '开发版';
const versionBadge = $('#version-badge');
if (versionBadge) versionBadge.textContent = 'v' + version;

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function sha256Text(value) {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function sha256File(file) {
  return hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
}

async function evaluate(tabId, expression) {
  const result = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    const details = result.exceptionDetails.exception?.description
      || result.exceptionDetails.exception?.value
      || result.exceptionDetails.text
      || '编辑器脚本执行失败';
    throw new Error(String(details).slice(0, 1200));
  }
  return result.result?.value;
}

// Chrome 禁止对「页内嵌了其他扩展 chrome-extension:// iframe」的标签页挂调试器
// （错误：Cannot access a chrome-extension:// URL of different extension）。
// 词典/翻译类扩展的常驻面板 iframe 会让一点号编辑页直接连不上调试器。
// 处理方式与微信那条路一致：临时移除这些外来 iframe 后重试；刷新页面即可恢复面板。
async function removeForeignExtensionFrames(tabId) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const removed = [];
        for (const frame of document.querySelectorAll('iframe')) {
          const src = frame.getAttribute('src') || '';
          if (!/^chrome-extension:\/\//i.test(src)) continue;
          const id = (src.match(/^chrome-extension:\/\/([a-p]{32})/i) || [])[1] || '';
          removed.push({ id, className: String(frame.className || ''), src: src.slice(0, 160) });
          frame.remove();
        }
        return removed;
      },
    });
    return results?.[0]?.result || [];
  } catch {
    return [];
  }
}

// Chrome 每个标签页只允许一个调试器客户端。填入被中断（弹窗关闭、平台内换文章）
// 时可能留下本扩展自己的会话，下一篇就会报 "Another debugger is already attached"。
// 这里记录会话：附加前先清掉自己的残留，页面卸载时尽力释放。
const debuggerSessions = new Set();
if (chrome.debugger?.onDetach) {
  chrome.debugger.onDetach.addListener((source) => {
    if (source?.tabId != null) debuggerSessions.delete(source.tabId);
  });
}

function attachErrorMessage(message) {
  if (/No tab with (?:given )?id/i.test(message))
    return '标签页已关闭或已跳转，请重新打开文章编辑页后再填入。';
  if (/Cannot attach to this tab|Cannot access contents of the page/i.test(message))
    return '无法连接这个页面：请确认它仍是目标平台的文章编辑页，刷新后再试。';
  if (/Another debugger is already attached/i.test(message))
    return '该标签页已被另一个调试器占用（常见于打开了 DevTools，或上一次填入被中断后没有释放）。'
      + '请关闭该页的开发者工具后重试；若没有打开 DevTools，刷新编辑页即可。';
  return '无法连接页面调试器：' + message;
}

function releaseDebuggerSessions() {
  for (const tabId of [...debuggerSessions]) chrome.debugger.detach({ tabId }).catch(() => {});
  debuggerSessions.clear();
}
window.addEventListener('pagehide', releaseDebuggerSessions);

async function attachDebugger(tabId) {
  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    debuggerSessions.add(tabId);
    return;
  } catch (error) {
    const message = String(error.message || error);
    if (/Another debugger is already attached/i.test(message)) {
      // 先尝试释放本扩展遗留的旧会话；若占用者是 DevTools 或其他扩展，这步会失败。
      const released = await chrome.debugger.detach({ tabId }).then(() => true).catch(() => false);
      if (released) {
        try {
          await chrome.debugger.attach({ tabId }, '1.3');
          debuggerSessions.add(tabId);
          return;
        } catch (retryError) {
          throw new Error(attachErrorMessage(String(retryError.message || retryError)));
        }
      }
      throw new Error(attachErrorMessage(message));
    }
    if (!message.includes('Cannot access a chrome-extension:// URL of different extension'))
      throw new Error(attachErrorMessage(message));
    const removed = await removeForeignExtensionFrames(tabId);
    // 给 DOM 一点时间结算（面板类扩展常用 MutationObserver 立刻回插 iframe）
    await new Promise((resolve) => setTimeout(resolve, 200));
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      debuggerSessions.add(tabId);
      return;
    } catch (retryError) {
      const ids = [...new Set(removed.map((item) => item.id).filter(Boolean))];
      throw new Error('调试器连接被页面中其他扩展的 iframe 阻止（Chrome 硬限制，工具无法绕过）。'
        + (removed.length
          ? '已临时移除 ' + removed.length + ' 个外来扩展 iframe（' + (ids.length ? ids.join('、') : '未知 ID') + '）但仍失败。'
          : '未能移除外来 iframe。')
        + '请在 chrome://extensions 停用该扩展（常见为词典/翻译类常驻面板），刷新文章编辑页后重试。'
        + '被移除的面板刷新页面即可恢复；本工具不会改动其它扩展的其它内容。');
    }
  }
}

// Capture the active editor when the popup opens, before a Windows file picker
// may affect focus. Chrome exposes Tab.url only with suitable permissions.
const initialEditorTab = chrome.tabs.query({active:true,currentWindow:true})
  .then(([tab]) => tab?.id && typeof tab.url === 'string' && /^https:\/\//i.test(tab.url)
    ? {id:tab.id,url:tab.url} : null)
  .catch(() => null);

async function currentEditorTab() {
  if (globalThis.DraftStudio) return DraftStudio.targetTab();
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  if (!tab?.id) throw new Error('没有找到当前网页标签页。请先打开对应平台文章编辑页，再打开插件。');
  // Never silently switch to a stale or different tab.
  if (typeof tab.url === 'string' && tab.url.trim()) return tab;
  const initial = await initialEditorTab;
  if (initial?.id === tab.id) return {...tab,url:initial.url};
  try {
    const latest = await chrome.tabs.get(tab.id);
    if (typeof latest?.url === 'string' && latest.url.trim())
      return {...tab,url:latest.url};
  } catch (_) {}
  // Read only the address of this same tab; no broad tabs permission.
  try {
    const values = await chrome.scripting.executeScript({
      target:{tabId:tab.id},func:()=>location.href
    });
    const href = values?.[0]?.result;
    if (typeof href === 'string' && href.trim()) return {...tab,url:href};
  } catch (_) {}
  throw new Error('Chrome 无法读取当前标签页地址。请切换到已登录的平台文章编辑页，重新打开扩展后点击「仅填入」，无需重新生成准备包。');
}

function readBundle(files) {
  const entries = [...files].map((file) => ({ file,
    path: (file.webkitRelativePath || file.name).replaceAll('\\', '/') }));
  return readBundleEntries(entries);
}

// Emergency manual fallback: Chrome may reject WSL directory grants but still
// permit choosing individual files. Keep their File objects unchanged so all
// existing SHA/byte and source checks remain effective for all five platforms.
function readBundleIndividualFiles(metaFiles, assetFiles) {
  if (!metaFiles.length) throw new Error('请先选择准备包根目录中的 JSON/TXT 文件。');
  const entries = [];
  const metadataNames = new Set(['manifest.json', 'raw-content.txt',
    'preparation-report.json', 'source-wechat.json','matrix-format.json','preview-article.html',
    ...['yidian','toutiao','sohu'].flatMap(p=>['matrix-'+p+'-content.txt','matrix-'+p+'-report.json','preview-'+p+'.html','title-'+p+'.txt','填入运行日志-'+p+'.txt']),
    ...['一点资讯','今日头条','搜狐号'].map(p=>'分发处理日志-'+p+'.txt')]);
  for (const file of metaFiles) {
    if (!metadataNames.has(file.name)) {
      // The package root may include extra JSON/TXT reports. Ignore these just
      // as the original directory picker does; required files are checked below.
      if (!/\.(?:json|txt)$/i.test(file.name)) throw new Error('请在第一项只选择根目录中的 JSON/TXT 文件。');
      continue;
    }
    entries.push({ file, path: file.name });
  }
  for (const file of assetFiles) {
    if (file.name.includes('/') || file.name.includes('\\') || !file.name)
      throw new Error('准备包图片文件名不合法。');
    entries.push({ file, path: 'assets/' + file.name });
  }
  return readBundleEntries(entries);
}

function readBundleEntries(entries) {
  const manifests = entries.filter((entry) => entry.file.name === 'manifest.json');
  if (manifests.length !== 1) throw new Error('请选择只包含一个准备包的目录；当前找到 ' + manifests.length + ' 个 manifest.json。');
  const manifestEntry = manifests[0];
  const prefix = manifestEntry.path.slice(0, manifestEntry.path.lastIndexOf('/') + 1);
  const byPath = new Map();
  for (const entry of entries) {
    if (!entry.path.startsWith(prefix)) continue;
    const key = entry.path.slice(prefix.length);
    if (!key || key.split('/').some((part) => part === '..' || part === '.')) throw new Error('准备包文件路径不合法。');
    if (byPath.has(key)) throw new Error('准备包含重复文件路径：' + key);
    byPath.set(key, entry.file);
  }
  const raw = byPath.get('raw-content.txt');
  const manifestFile = byPath.get('manifest.json');
  const reportFile = byPath.get('preparation-report.json');
  if (!raw || !manifestFile || !reportFile) {
    throw new Error('manifest.json 所在目录缺少 raw-content.txt 或 preparation-report.json；请选择完整准备包。');
  }
  return Promise.all([raw.text(), manifestFile.text(), reportFile.text()])
    .then(([html, manifestText, reportText]) => ({
      html, manifestText, manifest: JSON.parse(manifestText),
      report: JSON.parse(reportText), assets: byPath,
    }));
}

// Automatic selection uses the local read-only bridge; manual input remains explicit.
const autoDate = $('#issue-date');
autoDate.value = DraftHelperBundleLocator.localDate();
let autoContext = null, autoRefresh = 0;

async function refreshAutoChoice() {
  const serial = ++autoRefresh;
  const date = autoDate.value;
  const label = $('#auto-status'), select = $('#auto-version');
  autoContext = null;
  autoReady = false;
  select.hidden = true;
  select.replaceChildren();
  label.textContent = '正在查找当前平台的准备包…';
  updateRunState();
  try {
    const tab = await currentEditorTab();
    const platform = identifyDraftPlatform(tab?.url || '');
    const root = await DraftHelperBundleLocator.getConnection();
    const choices = await DraftHelperBundleLocator.choices(platform, date, root);
    if (serial !== autoRefresh || date !== autoDate.value) return;
    autoContext = {date, platform, signature: choices.signature};
    if (!choices.options.length) {
      label.textContent = '该稿件日期和平台尚无准备包。请先生成，或使用手动选择。';
      updateRunState();
      return;
    }
    autoReady = true;
    if (choices.options.length > 1) {
      select.append(new Option('请选择本次采用的修订版本', ''));
      for (const entry of choices.options) select.append(new Option(entry.label + ' · ' + entry.title, entry.id));
      select.value = choices.selected?.id || '';
      select.hidden = false;
    }
    label.textContent = choices.selected
      ? '稿件日期：' + date + '\n平台：' + platformName(platform) + '\n标题：' + choices.selected.title
        + '\n版本：' + choices.selected.label + '（填入前完整核验）'
      : '找到 ' + choices.options.length + ' 个版本，请明确选择。';
  } catch (error) {
    autoReady = false;
    if (serial === autoRefresh) label.textContent = '自动选包未就绪：' + String(error.message || error);
  }
  updateRunState();
}

$('#bridge-connection').addEventListener('change', async () => {
  const input = $('#bridge-connection');
  const file = input.files[0];
  if (!file) return;
  setFillBusy(true);
  try {
    if (file.size > 16384) throw new Error('连接文件过大，请选择本机助手生成的 connection.json。');
    const value = JSON.parse(await file.text());
    await DraftHelperBundleLocator.connect(value);
    await refreshAutoChoice();
  } catch (error) {
    $('#auto-status').textContent = '连接未完成：' + String(error.message || error);
  } finally {input.value = ''; setFillBusy(false);}
});
$('#refresh-auto').addEventListener('click', refreshAutoChoice);
autoDate.addEventListener('change', () => {
  clearManualSelection();
  refreshAutoChoice();
});
$('#auto-version').addEventListener('change', () => {
  const selected = $('#auto-version').selectedOptions[0];
  $('#auto-status').textContent = selected?.value
    ? '已选择 ' + selected.textContent + '，填入时会核验来源与文件。'
    : '请选择要使用的修订版本。';
});

function manualDraftBundle() {
  const documents = $('#bundle-meta').files;
  const images = $('#bundle-assets').files;
  if (documents.length || images.length)
    return readBundleIndividualFiles(documents, images);
  const files = $('#bundle').files;
  if (files.length) return readBundle(files);
  return null;
}

let manualReady = false, manualPreview = 0, autoReady = false;

function updateRunState() {
  const run = $('#run');
  if (run) run.disabled = !(manualReady || autoReady);
}

function bundleLabel(manifest) {
  const id = manifest.profile?.id || manifest.targetPlatform || 'wechat';
  return manifest.profileSpec?.label
    || (typeof DraftDistribution !== 'undefined' && DraftDistribution.PROFILES?.[id]?.label)
    || platformName(manifest.targetPlatform || 'wechat');
}

// Read the picked folder once so the user can confirm which bundle will be used
// before filling. Verification still runs again at fill time.
async function refreshManualStatus() {
  const serial = ++manualPreview;
  const docs = $('#bundle-meta').files.length;
  const images = $('#bundle-assets').files.length;
  const folder = $('#bundle').files.length;
  const label = $('#manual-status');
  const clear = $('#clear-manual');
  const selected = !!(docs || images || folder);
  if (clear) clear.hidden = !selected;
  manualReady = false;
  updateRunState();
  if (!selected) {
    delete label.dataset.state;
    label.textContent = '尚未选择准备包。';
    return;
  }
  delete label.dataset.state;
  label.textContent = docs || images
    ? '正在读取：' + docs + ' 个根目录文件、' + images + ' 张图片…'
    : '正在读取准备包文件夹（' + folder + ' 个文件）…';
  try {
    const bundle = await manualDraftBundle();
    if (serial !== manualPreview) return;
    const manifest = bundle.manifest;
    const imageCount = manifest.contentImages?.length || 0;
    label.textContent = '「' + (manifest.title || '未命名') + '」\n'
      + bundleLabel(manifest)
      + (manifest.issueDate ? ' · ' + manifest.issueDate : '')
      + (imageCount ? ' · ' + imageCount + ' 张图' : '');
    const target = manifest.targetPlatform || 'wechat';
    if (pagePlatform && target !== pagePlatform
        && !manifest.compatiblePlatforms?.includes(pagePlatform)) {
      label.textContent += '\n当前页面是' + platformName(pagePlatform) + '，与这个包不一致。';
      label.dataset.state = 'warn';
    }
    manualReady = true;
  } catch (error) {
    if (serial !== manualPreview) return;
    label.dataset.state = 'error';
    label.textContent = '准备包不可用：' + String(error.message || error);
  }
  updateRunState();
}

let pagePlatform = null;

async function refreshPageStatus() {
  const label = $('#page-status');
  // The full workbench selects its target separately and has no popup label.
  if (!label) return;
  try {
    const tab = await currentEditorTab();
    const platform = identifyDraftPlatform(tab?.url || '');
    pagePlatform = platform;
    delete label.dataset.state;
    label.textContent = platformName(platform) + ' · 文章编辑页';
  } catch (_) {
    pagePlatform = null;
    label.dataset.state = 'muted';
    label.textContent = '当前标签页不是已支持的编辑页\n支持微信、一点资讯、今日头条、企鹅号、搜狐号、微博头条文章。';
  }
}

function clearManualSelection() {
  for (const id of ['bundle', 'bundle-meta', 'bundle-assets']) $('#' + id).value = '';
  refreshManualStatus();
}
$('#clear-manual').addEventListener('click', clearManualSelection);

// Selecting a new manual mode resets the other mode rather than accidentally
// combining documents or pictures from two different daily revisions.
$('#bundle').addEventListener('change', () => {
  if ($('#bundle').files.length) {
    $('#bundle-meta').value = '';
    $('#bundle-assets').value = '';
  }
  refreshManualStatus();
});
for (const id of ['bundle-meta', 'bundle-assets']) {
  $('#' + id).addEventListener('change', () => {
    if ($('#' + id).files.length) $('#bundle').value = '';
    refreshManualStatus();
  });
}

async function selectedDraftBundle(platform) {
  if (globalThis.DraftStudio) return DraftStudio.selectedBundle();
  const manual = manualDraftBundle();
  if (manual) {
    const bundle = await manual;
    return {bundle, automatic: null};
  }
  let root;
  try { root = await DraftHelperBundleLocator.getConnection(); }
  catch (_) {
    throw new Error('没有可用的准备包：请在上方「准备包」里选择文件夹；'
      + '自动选包需先在「高级 / 旧版」连接本机助手。');
  }
  const date = autoDate.value;
  const shown = autoContext, chosenId = $('#auto-version').value;
  const choices = await DraftHelperBundleLocator.choices(platform, date, root);
  if (!shown || shown !== autoContext || shown.date !== date || shown.platform !== platform || shown.signature !== choices.signature) {
    await refreshAutoChoice();
    throw new Error('日期、平台或准备包版本已变化，请查看刷新后的稿件再填入。');
  }
  const entryId = choices.options.length > 1 ? chosenId : choices.selected?.id;
  const entry = choices.options.find((item) => item.id === entryId);
  if (!entry) throw new Error('未确定唯一的有效准备包；请先选择版本或手动选择目录。');
  const bundle = await DraftHelperBundleLocator.bundleFiles(root, entry, platform, date);
  if (shown !== autoContext || autoDate.value !== date || $('#auto-version').value !== chosenId)
    throw new Error('读取期间选择已变化，已停止填入，请重新确认稿件。');
  if (bundle.manifest.issueDate !== date) throw new Error('自动选择的准备包与稿件日期不一致。');
  return {bundle, automatic: {
    root, date, platform, entry,
    save: () => DraftHelperBundleLocator.selectVersion(platform, date, entry.id, choices.signature)
  }};
}

async function verifySelectedDraft(selection, activePlatform) {
  const bundle = selection.bundle;
  await verifyBundle(bundle, activePlatform);
  if (selection.automatic?.platform === 'toutiao') {
    await DraftHelperBundleLocator.verifyToutiaoReceipt(
      selection.automatic.root, selection.automatic.date,
      bundle, sha256Text, selection.automatic.entry.id.split('/'));
  }
  if (selection.automatic) await selection.automatic.save();
}

const E3_HEADER_SHA256 = '3c5fdf6a27b351478d3fc52253ef4eb2c5834a44f502658004e92337c9d813c6';
const E3_TAIL_SHA256 = 'b54d89b06530cf698b78ad79ec2c5cc16b4d859e708802f8b5e40b30be7b1157';

async function verifyMatrixE3Proof(proof) {
  const item = proof.matrixE3Header;
  if (!item) return;
  if (typeof item.canonicalHtml !== 'string'
      || await sha256Text(item.canonicalHtml) !== E3_HEADER_SHA256)
    throw new Error('矩阵来源中的 E3 固定头图凭据与正式模板不一致。');
}

async function verifyCanonicalLazyImages(html, manifest, report) {
  const lazy = /<img\b[^>]*\sdata-src\s*=/i;
  if (!lazy.test(html)) return;
  const bridge = report.canonical_lazy_asset_bridge;
  if ((manifest.targetPlatform || 'wechat') !== 'wechat'
      || !bridge?.final_body_preserves_canonical_assets
      || bridge.fixed_header_sha256 !== E3_HEADER_SHA256
      || bridge.fixed_tail_sha256 !== E3_TAIL_SHA256
      || html.length < 1212 + 26896
      || await sha256Text(html.slice(0, 1212)) !== E3_HEADER_SHA256
      || await sha256Text(html.slice(-26896)) !== E3_TAIL_SHA256
      || lazy.test(html.slice(1212, -26896)))
    throw new Error('存在未经核验的远程懒加载图片，不允许导入。');
}

async function verifyBundle(bundle, activePlatform = bundle.manifest.targetPlatform || 'wechat') {
  if(bundle.matrixSourceBundle){
    await verifyBundle(bundle.matrixSourceBundle,activePlatform);
    return DraftMatrixFormat.verifyView(bundle,activePlatform);
  }
  const { html, manifestText, manifest, report, assets } = bundle;
  if (manifest.bundleContractVersion !== 1 || report.bundle_contract_version !== 1 || report.state !== 'PREPARED') {
    throw new Error('准备目录版本不受支持；请使用当前 CLI 重新生成。');
  }
  if (await sha256Text(html) !== report.payload_sha256) {
    throw new Error('raw-content.txt 与 preparation-report.json 的 SHA-256 不一致，已停止填稿。');
  }
  if (await sha256Text(manifestText) !== report.manifest_sha256) {
    throw new Error('manifest.json 与 preparation-report.json 的 SHA-256 不一致，已停止填稿。');
  }
  if (report.remote_image_count !== 0 || /<img\b[^>]*\ssrc\s*=\s*["'](?:https?:)?\/\//i.test(html)) {
    throw new Error('正式准备包仍含远程图片地址；请先下载为本地图片并重新 prepare。');
  }
  await verifyCanonicalLazyImages(html, manifest, report);
  if (!Array.isArray(manifest.contentImages)) {
    throw new Error('manifest.json 没有可核验的本地图片清单。');
  }
  const genericDistribution = manifest.distribution?.schema === 'DRAFT_HELPER_DISTRIBUTION_V1';
  if (genericDistribution) await DraftDistribution.verify(bundle, activePlatform);
  if (!genericDistribution && manifest.targetPlatform === 'yidian'
      && ['yidian', 'toutiao'].includes(activePlatform)) {
    const proofFile = assets.get('source-wechat.json');
    if (!proofFile) throw new Error('一点资讯准备包缺少微信来源与标题候选记录；请重新生成。');
    const proofText = await proofFile.text();
    if (await sha256Text(proofText) !== manifest.sourceProofSha256) throw new Error('微信来源记录校验失败。');
    const proof = JSON.parse(proofText);
    await verifyMatrixE3Proof(proof);
    const expected = yidianContract(proof, manifest.title);
    const plan=proof.titlePlan;
    const a=plan.candidates.find(x=>x.programId===plan.wechatProgramId);
    const b=plan.candidates.find(x=>x.programId===plan.yidianProgramId);
    const manual=manifest.coverMode==='manual'&&DraftHelperMatrixCover.isManualCover(manifest,proof,plan,b?.programId);
    const shared=DraftHelperMatrixCover.isSharedCover(manifest,proof,plan,b?.programId);
    const bCover=manual?null:DraftHelperMatrixCover.checkRoleCover(manifest.platformCovers?.yidian,plan,shared?a?.programId:b?.programId,'cover.jpg');
    const aCover=DraftHelperMatrixCover.checkRoleCover(manifest.platformCovers?.toutiao,plan,a?.programId,'cover-toutiao.'+proof.manifest.coverImage.bundleFile.split('.').pop());
    if (html !== expected.html || manifest.bodyPolicy !== 'same_as_toutiao_through_index_definition'
        || JSON.stringify(manifest.coverImage)!==JSON.stringify(bCover)
        || aCover.sha256!==proof.manifest.coverImage.sha256
        || manifest.selectedProgramId!==b.programId || manifest.selectedProgramName!==b.programName
        || proof.matrixCover?.programmeId!==b.programId
        || (!manual&&proof.matrixCover?.coverSha256!==bCover.sha256)
        || JSON.stringify(manifest.matrixCoverEvidence)!==JSON.stringify(proof.matrixCover)
        || manifest.issueDate !== proof.manifest.issueDate
        || manifest.sourceWechatTitle !== proof.manifest.title
        || JSON.stringify(manifest.contentImages) !== JSON.stringify(expected.contentImages)) {
      throw new Error('一点资讯正文截止位置、独立封面素材、标题或图片清单偏离微信来源，已停止填稿。');
    }
    if (activePlatform === 'toutiao') {
      // The shared body is Yidian's, but the short headline must be a
      // verified deletion of the original approved WeChat headline.
      bundle.toutiaoShortTitle = deriveToutiaoTitle(proof.manifest.title);
      const expected = toutiaoArticleFragment(proof);
      if (!manifest.compatiblePlatforms?.includes('toutiao')
          || html !== expected.html
          || JSON.stringify(manifest.contentImages) !== JSON.stringify(expected.contentImages)) {
        throw new Error('共用准备包未通过今日头条正文或图片校验。');
      }
    }
  }
  if (!genericDistribution && manifest.targetPlatform === 'toutiao') {
    const proofFile = assets.get('source-wechat.json');
    if (!proofFile) throw new Error('头条包缺少微信和一点资讯来源记录，请重新生成。');
    const proofText = await proofFile.text();
    if (await sha256Text(proofText) !== manifest.sourceProofSha256) throw new Error('头条来源记录校验失败。');
    const proof = JSON.parse(proofText);
    await verifyMatrixE3Proof(proof);
    toutiaoContract(proof, manifest, html);
  }
  if (!genericDistribution && (manifest.targetPlatform === 'penguin' || manifest.targetPlatform === 'sohu')) {
    const proofFile = assets.get('source-wechat.json');
    if (!proofFile) throw new Error('准备包缺少微信来源记录。');
    const proofText = await proofFile.text();
    if (await sha256Text(proofText) !== manifest.sourceProofSha256) throw new Error('微信来源记录校验失败。');
    const proof = JSON.parse(proofText), sourceManifest = JSON.parse(proof.manifestText);
    await verifyMatrixE3Proof(proof);
    const expected = toutiaoArticleFragment({ html: proof.html, manifest: sourceManifest,
      matrixE3Header: proof.matrixE3Header });
    const plan = proof.titlePlan;
    const yidianCandidate = plan?.candidates?.find((item) => item.programId === plan.yidianProgramId);
    if (!yidianCandidate) throw new Error('准备包缺少已审定的一点资讯标题候选。');
    yidianContract({ html: proof.html, manifest: sourceManifest, titlePlan: plan,
      matrixE3Header: proof.matrixE3Header }, yidianCandidate.title);
    const remaining = plan.candidates.filter((item) =>
      item.programId !== plan.wechatProgramId && item.programId !== plan.yidianProgramId);
    const selected = remaining.length === 1 ? remaining[0] : null;
    const manual=manifest.coverMode==='manual'&&selected&&DraftHelperMatrixCover.isManualCover(manifest,proof,plan,selected.programId);
    const shared=selected&&DraftHelperMatrixCover.isSharedCover(manifest,proof,plan,selected.programId);
    if (selected) draftHelperHeadlineContract(selected.title, selected.programName, proof.html, selected);
    if (await sha256Text(proof.manifestText) !== manifest.sourceWechatManifestSha256
        || html !== expected.html || manifest.bodyPolicy !== 'same_as_toutiao_through_index_definition'
        || plan.issueDate !== sourceManifest.issueDate || !selected
        || manifest.title !== selected.title || manifest.selectedProgramId !== selected.programId
        || manifest.selectedProgramName !== selected.programName
        || manifest.sourceYidianTitle !== yidianCandidate.title
        || manifest.sourceWechatTitle !== sourceManifest.title
        || manifest.issueDate !== sourceManifest.issueDate
        || JSON.stringify(manifest.contentImages) !== JSON.stringify(expected.contentImages)
        || JSON.stringify(manifest.coverImage) !== JSON.stringify(manifest.platformCovers?.[manifest.targetPlatform])
        || (!manual&&!DraftHelperMatrixCover.checkRoleCover(manifest.coverImage,plan,shared?plan.wechatProgramId:selected.programId,'cover.jpg'))
        || proof.matrixCover?.programmeId !== selected.programId
        || (!manual&&proof.matrixCover?.coverSha256 !== manifest.coverImage.sha256)
        || JSON.stringify(proof.matrixCover)!==JSON.stringify(manifest.matrixCoverEvidence))
      throw new Error('平台准备包正文截止位置、标题或图片清单偏离已审定微信来源。');
    const [min, max] = manifest.targetPlatform === 'penguin' ? [5, 64] : [5, 72];
    if ([...manifest.title].length < min || [...manifest.title].length > max)
      throw new Error('平台标题长度不符合要求。');
  }
  const verifyAsset = async (item, label) => {
    const file = assets.get(`assets/${item.bundleFile}`);
    if (!file) throw new Error(`准备目录中缺少${label} ${item.bundleFile}。`);
    if (!item.sha256 || !Number.isInteger(item.bytes)) {
      throw new Error(`${label} ${item.bundleFile} 缺少 SHA-256/字节数；请重新 prepare。`);
    }
    if (file.size !== item.bytes || await sha256File(file) !== item.sha256) {
      throw new Error(`${label} ${item.bundleFile} 与 manifest 校验值不一致，已停止填稿。`);
    }
    return file;
  };
  for (const item of manifest.contentImages) await verifyAsset(item, '图片');
  if (manifest.coverImage) await verifyAsset(manifest.coverImage, '封面');
  for (const item of Object.values(manifest.platformCovers||{}))
    if(item)await verifyAsset(item,'当前平台封面');
  if(manifest.matrixFormat)await DraftMatrixFormat.verify(bundle);
}

function findEditorField(selector) {
  const requiresVisible = selector === '#title' || selector === '#js_description'
    || selector === 'input.post-title'
    || selector.includes('placeholder') || selector.includes('omui-inputautogrowing');
  // The new title editor is ProseMirror; hidden #title only mirrors its value.
  const selectors = selector === '#title' ? [
    '.title-editor__input .ProseMirror[contenteditable="true"]',
    '.title-editor-overlay .ProseMirror[contenteditable="true"]',
    '.omui-inputautogrowing__inner[contenteditable="true"]',
    '[contenteditable="true"][data-placeholder="请在这里输入标题"]',
    '.ProseMirror[contenteditable="true"][data-placeholder*="标题"]',
    'input[placeholder*="请在这里输入标题"]',
    'textarea[placeholder*="请在这里输入标题"]',
    '#title',
  ] : selector === '#js_description' ? [
    '#js_description',
    'textarea[placeholder*="摘要"]',
    'textarea[placeholder*="简介"]',
    '[contenteditable="true"][data-placeholder*="摘要"]',
    '[contenteditable="true"][data-placeholder*="简介"]',
  ] : [selector];
  const documents = [document];
  for (const frame of document.querySelectorAll('iframe')) {
    try {
      if (frame.getClientRects().length && frame.contentDocument) documents.push(frame.contentDocument);
    } catch (_) {}
  }
  for (const query of selectors) {
    for (const doc of documents) {
      for (const el of doc.querySelectorAll(query)) {
        const style = doc.defaultView.getComputedStyle(el);
        const visible = el.getClientRects().length && style.visibility !== 'hidden'
          && style.display !== 'none' && !el.closest('[hidden],[aria-hidden="true"]');
        if (!requiresVisible || visible) return el;
      }
    }
  }
  return null;
}

async function readField(tabId, selector) {
  return evaluate(tabId, `(() => {
    const el = (${findEditorField.toString()})(${JSON.stringify(selector)});
    return el ? (el.isContentEditable ? el.textContent : el.value || '').trim() : null;
  })()`);
}

async function fillField(tabId, selector, value) {
  if (!value) return;
  const mode = await evaluate(tabId, `(() => {
    const el = (${findEditorField.toString()})(${JSON.stringify(selector)});
    if (!el) return null;
    if (el.isContentEditable || ${JSON.stringify(selector)} === '#title'
        || ${JSON.stringify(selector)} === 'input[placeholder="请输入标题（5-72字）"]'
        || ${JSON.stringify(selector)} === 'textarea[placeholder^="请输入文章标题"]') {
      el.focus();
      if (el.isContentEditable) {
        const range = el.ownerDocument.createRange();
        range.selectNodeContents(el);
        const selection = el.ownerDocument.defaultView.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        el.select();
      }
      return 'native';
    } else {
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      setter ? setter.call(el, ${JSON.stringify(value)}) : (el.value = ${JSON.stringify(value)});
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return 'value';
  })()`);
  if (!mode) throw new Error(`未找到可填写的字段 ${selector}（标题必须是可见控件）`);
  if (mode === 'native') {
    await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text: value });
    await pause(300);
  }
  if (await readField(tabId, selector) !== value.trim()) {
    throw new Error(`字段 ${selector} 写入后校验失败，请检查编辑页中的实际输入框`);
  }
}

async function editorApi(tabId, apiName, apiParam) {
  const param = apiParam === undefined ? '' : `apiParam: ${JSON.stringify(apiParam)},`;
  const result = await evaluate(tabId, `new Promise((resolve) => {
    const api = window.__MP_Editor_JSAPI__;
    if (!api || typeof api.invoke !== 'function') {
      resolve({ ok: false, error: '微信公众号编辑器 JS API 不可用' });
      return;
    }
    try {
      api.invoke({
        apiName: ${JSON.stringify(apiName)},
        ${param}
        sucCb: (data) => resolve({ ok: true, data }),
        errCb: (error) => {
          let detail;
          try { detail = JSON.stringify(error); } catch (_) {}
          resolve({ ok: false, error: String(error?.errMsg || error?.message || detail || error) });
        },
      });
    } catch (error) {
      resolve({ ok: false, error: String(error?.stack || error) });
    }
  })`);
  if (!result?.ok) throw new Error(result?.error || `${apiName} 调用失败`);
  return result.data;
}

async function getEditorHtml(tabId) {
  const result = await editorApi(tabId, 'mp_editor_get_content');
  if (typeof result?.content !== 'string') throw new Error('编辑器没有返回正文内容');
  return result.content;
}

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`读取图片失败：${file.name}`));
    reader.readAsDataURL(file);
  });
}

async function uploadImageToWechat(tabId, file) {
  const dataUrl = await readFileAsDataUrl(file);
  const mimeType = file.type || ({ gif: 'image/gif', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }[file.name.split('.').pop().toLowerCase()]);
  if (!mimeType?.startsWith('image/')) throw new Error(`无法识别图片格式：${file.name}`);
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    args: [dataUrl, file.name, mimeType],
    func: async (encodedFile, filename, mimeType) => {
      try {
        const wxData = window.wx?.data || {};
        const token = wxData.t || new URLSearchParams(location.search).get('token');
        if (!token) return { ok: false, error: '公众号页面未提供上传凭证，请刷新已登录的编辑器页后重试。' };

        const base64 = encodedFile.slice(encodedFile.indexOf(',') + 1);
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        const file = new File([bytes], filename, { type: mimeType, lastModified: Date.now() });
        const form = new FormData();
        form.append('id', 'WU_FILE_0');
        form.append('name', file.name);
        form.append('type', mimeType);
        form.append('lastModifiedDate', new Date(file.lastModified).toString());
        form.append('size', String(file.size));
        form.append('file', file);

        const params = new URLSearchParams({
          action: 'upload_material', f: 'json', scene: '8', writetype: 'doublewrite',
          groupid: '1', token, lang: 'zh_CN', seq: String(Date.now()), t: String(Math.random()),
        });
        if (wxData.ticket) params.set('ticket', wxData.ticket);
        if (wxData.ticket_id) params.set('ticket_id', wxData.ticket_id);
        if (wxData.svr_time) params.set('svr_time', String(wxData.svr_time));

        const response = await fetch(`/cgi-bin/filetransfer?${params}`, {
          method: 'POST', body: form, credentials: 'same-origin',
        });
        if (!response.ok) return { ok: false, error: `图片上传 HTTP ${response.status}` };
        const result = await response.json();
        if (result.base_resp?.ret !== 0 || typeof result.cdn_url !== 'string') {
          return { ok: false, error: `公众号图片上传失败（ret ${result.base_resp?.ret ?? 'unknown'}）` };
        }
        return { ok: true, cdnUrl: result.cdn_url };
      } catch (error) {
        return { ok: false, error: String(error?.message || error) };
      }
    },
  });
  const result = results[0]?.result;
  if (!result?.ok || !result.cdnUrl) throw new Error(result?.error || `图片上传失败：${file.name}`);
  if (mimeType === 'image/gif' && !/\.gif(?:[?#]|$)|wx_fmt=gif(?:&|$)/i.test(result.cdnUrl)) {
    throw new Error('微信没有返回 GIF 格式的图片地址；已停止填稿，以免动画丢失。');
  }
  return result.cdnUrl;
}

async function setCoverFromFile(tabId, file) {
  let uploadFile = file;
  // Native cover selection accepts PNG reliably; keep the bundled original intact.
  if (/\.(?:webp|bmp)$/i.test(file.name)) {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0);
    bitmap.close();
    const png = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!png) throw new Error('封面格式转换失败。');
    uploadFile = new File([png], file.name.replace(/\.[^.]+$/, '.png'), { type: 'image/png' });
  }
  const cdnUrl = await uploadImageToWechat(tabId, uploadFile);
  // DOM click() does not activate CSS :hover or produce a native pointer enter.
  // Use the debugger already attached by run() to reveal hover-only cover menus.
  const [hover] = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN',
    func: () => {
      const el = [...document.querySelectorAll('.js_cover_btn_area')]
        .find((node) => node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
      if (!el) return null;
      el.scrollIntoView({block:'center', inline:'nearest'});
      const rect = el.getBoundingClientRect();
      return {x:rect.x + rect.width / 2, y:rect.y + rect.height / 2};
    },
  });
  if (hover?.result) await chrome.debugger.sendCommand({tabId}, 'Input.dispatchMouseEvent', {
    type:'mouseMoved', ...hover.result,
  });
  const results = await chrome.scripting.executeScript({
    target: { tabId }, world: 'MAIN', args: [cdnUrl],
    func: async (uploadedUrl) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const visible = (el) => !!el?.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
      const findControl = (texts, scope = document) => [...scope.querySelectorAll('button,a,label,[role="button"],span,li')]
        .find((el) => visible(el) && !el.closest('[contenteditable="true"]')
          && !el.matches(':disabled') && !el.closest('[aria-disabled="true"],.weui-desktop-btn_disabled')
          && texts.includes(el.textContent.trim()));
      const dialogs = () => [...document.querySelectorAll('.weui-desktop-dialog,[role="dialog"],.dialog')]
        .filter(visible);
      const imageUrls = (el) => [el.src, el.dataset.src, el.dataset.original,
        getComputedStyle(el).backgroundImage.match(/url\(["']?([^"')]+)["']?\)/)?.[1]].filter(Boolean);
      // Snapshot image identities (strings), not mutable DOM elements; a src
      // changed in place must be observable and random added DOM nodes do not count.
      const coverPreviews = () => [...new Set(
        [...document.querySelectorAll('[class*="cover"],[id*="cover"],[class*="thumb"],[id*="thumb"]')]
          .filter((el) => visible(el) && !el.closest('.weui-desktop-dialog,[role="dialog"],.dialog,.rich_media_content,.ProseMirror,[contenteditable="true"]'))
          .flatMap((el) => [el, ...el.querySelectorAll('img,[style*="background"]')]
            .filter((child) => visible(child) && !child.closest('.weui-desktop-dialog,[role="dialog"],.dialog,[contenteditable="true"]'))
            .flatMap(imageUrls))
          .map(imageKey).filter(Boolean)
      )];
      const imageKey = (url) => {
        try {
          const parsed = new URL(url, location.href);
          return `${parsed.host}${parsed.pathname.replace(/\/\d+$/, '')}`;
        } catch (_) { return ''; }
      };
      const waitFor = async (read, message, timeout = 10000) => {
        const deadline = Date.now() + timeout;
        while (Date.now() < deadline) {
          const result = read();
          if (result) return result;
          await sleep(200);
        }
        throw new Error(message);
      };
      try {
        const before = new Set(coverPreviews());
        const targetKey = imageKey(uploadedUrl);
        if (!targetKey) throw new Error('刚上传的封面地址无效，无法识别素材身份。');
        const trigger = [...document.querySelectorAll('.js_cover_btn_area')].find(visible)
          || findControl(['拖拽或选择封面', '选择封面', '添加封面', '更换封面', '设置封面']);
        if (!trigger) throw new Error('找不到可见的“选择封面”按钮，请展开文章封面区域后重试。');
        const findLibrary = () => [...document.querySelectorAll('a.js_imagedialog')].find(visible)
          || findControl(['从图片库选择', '从素材库选择']);
        if (!findLibrary()) trigger.click();
        const library = await waitFor(findLibrary,
          '已悬停并尝试点击封面入口，但“从图片库选择”仍不可见；请检查封面区域是否有遮挡或菜单未展开。');
        library.click();
        const target = await waitFor(() => dialogs().flatMap((dialog) => [...dialog.querySelectorAll('.weui-desktop-img-picker__img-thumb')])
          .find((img) => visible(img) && imageUrls(img).some((url) => imageKey(url) === imageKey(uploadedUrl))),
        '图片库中没有找到刚上传的封面，未选取其他图片；请查看图片库中的最新上传图片。', 20000);
        const card = target.closest('.weui-desktop-img-picker__item');
        if (!card) throw new Error('已找到封面图片，但未识别到图片卡片，未继续确认。');
        const selected = () => card.classList.contains('selected')
          || !!card.querySelector('.image_dialog__checkbox.selected');
        if (!selected()) target.click();
        await waitFor(selected, '已点击指定封面，但图片卡片未显示选中状态，未继续确认。');
        const picker = target.closest('.weui-desktop-dialog,[role="dialog"],.dialog');
        if (!picker || picker.querySelectorAll('.weui-desktop-img-picker__item.selected').length > 1)
          throw new Error('图片库选中状态不唯一，未继续确认。');

        let confirmations = 0;
        let nextClickAt = Date.now() + 800;
        const preview = await waitFor(() => {
          const open = dialogs();
          if (!open.length) {
            const after = coverPreviews();
            const exact = after.find((value) => value === targetKey && !before.has(value));
            if (exact) return { previewKey: exact, matchKind: 'uploaded_image' };
            const changed = after.filter((value) => !before.has(value));
            // WeChat may recrop and re-upload, changing the final CDN identity.
            // Accept only a single changed cover image after native crop confirmation.
            if (confirmations > 0 && changed.length === 1)
              return { previewKey: changed[0], matchKind: 'crop_render_changed' };
          }
          if (Date.now() >= nextClickAt && confirmations < 3) {
            for (const dialog of open) {
              if (!dialog.querySelector('img,canvas,[style*="background"]')) continue;
              const button = findControl(['下一步', '确认', '确定', '完成'], dialog);
              if (!button) continue;
              button.click();
              confirmations++;
              nextClickAt = Date.now() + 1200;
              break;
            }
          }
          return null;
        }, '封面上传或裁剪尚未完成，未核对到更新后的封面预览；请检查微信封面弹窗。', 40000);
        return { ok: true, previewKey: preview.previewKey, matchKind: preview.matchKind };
      } catch (error) {
        return { ok: false, error: String(error?.message || error) };
      }
    },
  });
  const result = results[0]?.result;
  if (!result?.ok) throw new Error(result?.error || '封面设置失败');
  return result;
}

async function attemptGenericCover(tabId,bundle,label) {
  if (!bundle.manifest.coverImage) {
    status(label+'正文与标题已填入；没有准备包封面，请手动设置封面并保存草稿。');
    return;
  }
  try { await attemptMatrixCover(tabId,bundle,label); }
  catch(error) {
    status(label+'正文与标题已填入；封面未完成：'+(error.message||String(error))
      +'。请手动设置封面、核对全文并保存草稿。');
  }
}
async function run() {
  let stage = '识别当前编辑页';
  try {
  const tab = await currentEditorTab();
  const platform = identifyDraftPlatform(tab.url || '');
  stage = '读取准备目录';
  const selection = await selectedDraftBundle(platform);
  let bundle = selection.bundle;
  if ((bundle.manifest.targetPlatform || 'wechat') !== platform
      && !bundle.manifest.compatiblePlatforms?.includes(platform)) {
    throw new Error('准备包不支持当前平台，请选择对应的平台准备目录。');
  }
  stage = '校验准备包完整性';
  status(`${stage}…`);
  await verifySelectedDraft(selection, platform);
  if(bundle.manifest.matrixFormat)bundle=await DraftMatrixFormat.view(bundle,platform);
  const { html, manifest, assets } = bundle;
  if (typeof manifest.title !== 'string' || !manifest.title.trim()) throw new Error('准备目录中的 manifest.json 缺少标题。');
  manifest.title = manifest.title.trim();
  const coverFile = manifest.coverImage ? assets.get(`assets/${manifest.coverImage.bundleFile}`) : null;
  if (manifest.coverImage && !coverFile) throw new Error('准备目录缺少 manifest.json 指定的封面图片。');
  if (platform === 'wechat') requireWechatEditorialMetadata(manifest);
  if (platform === 'yidian') {
    stage = '填入一点号编辑器';
    await fillYidianDraft(tab.id, bundle);
    if (bundle.manifest.distribution?.schema === DraftDistribution.CONTRACT)
      await attemptGenericCover(tab.id,bundle,'一点资讯');
    else await attemptMatrixCover(tab.id, bundle, '一点资讯');
    return;
  }
  if (platform === 'toutiao') {
    stage = '填入今日头条编辑器';
    if (new URL(tab.url).pathname.replace(/\/$/, '') !== '/profile_v4/graphic/publish')
      throw new Error('请打开今日头条文章编辑页 /profile_v4/graphic/publish。');
    await fillToutiaoDraft(tab.id, bundle);
    if (bundle.manifest.distribution?.schema === DraftDistribution.CONTRACT)
      await attemptGenericCover(tab.id,bundle,'今日头条');
    else await attemptMatrixCover(tab.id, bundle, '今日头条');
    return;
  }
  if (platform === 'penguin' || platform === 'sohu') {
    stage = '填入' + platformName(platform) + '编辑器';
    const skipImages = !!document.getElementById('skip-images')?.checked;
    const outcome=await fillPortalDraft(tab.id, bundle, platform, undefined, {skipImages,
      onBundleChanged:next=>window.DraftStudio?.updateDistributionBundle?.(next)});
    const active=outcome?.bundle||bundle;
    if (active.manifest.distribution?.schema === DraftDistribution.CONTRACT)
      await attemptGenericCover(tab.id,active,platformName(platform));
    else await attemptMatrixCover(tab.id, active, platformName(platform));
    return outcome;
  }
  if (platform === 'weibo') {
    stage = '填入微博头条文章编辑器';
    return await fillWeiboDraft(tab.id, bundle);
  }
  stage = '连接公众号标签页调试器';
  status(`${stage}…`);
  await attachDebugger(tab.id);
  try {
    await chrome.debugger.sendCommand({ tabId: tab.id }, 'Runtime.enable');
    stage = '检查公众号编辑器接口';
    status(`${stage}…`);
    const currentHtml = await getEditorHtml(tab.id);
    if (currentHtml.replace(/<[^>]+>/g, '').trim() || /<img\b/i.test(currentHtml)) {
      throw new Error('正文区已有内容。为避免覆盖，请新开空白图文编辑页后再运行。');
    }
    const currentTitle = await readField(tab.id, '#title');
    if (currentTitle === null) throw new Error('找不到可见标题框，已停止。');
    if (currentTitle && currentTitle !== manifest.title) {
      throw new Error('标题框已有其他内容。为避免误改，请新开空白图文编辑页后再运行。');
    }
    let content = html;
    const uploadedUrls = [];
    for (const item of manifest.contentImages || []) {
      stage = `按原格式上传图片 ${item.placeholder}`;
      const file = assets.get(`assets/${item.bundleFile}`);
      if (!file) throw new Error(`准备目录中缺少图片 ${item.bundleFile}。`);
      status(`正在原格式上传图片：${item.bundleFile}`);
      if (!content.includes(item.placeholder)) throw new Error(`准备稿中缺少图片位置 ${item.placeholder}。`);
      const cdnUrl = await uploadImageToWechat(tab.id, file);
      content = content.replaceAll(item.placeholder, cdnUrl.replaceAll('&', '&amp;').replaceAll('"', '&quot;'));
      uploadedUrls.push(cdnUrl);
    }

    stage = '通过公众号编辑器接口写入正文';
    status(`${stage}…`);
    await editorApi(tab.id, 'mp_editor_set_content', { content });
    stage = '填写标题和摘要';
    status(`${stage}…`);
    await fillField(tab.id, '#title', manifest.title);
    await fillField(tab.id, '#author', manifest.author);
    await fillField(tab.id, '#js_description', manifest.summary);
    if (await readField(tab.id, '#js_description') !== manifest.summary.trim()) {
      throw new Error('摘要未写入可见的微信编辑器摘要框；请展开摘要区域并检查。');
    }
    let coverProof = null, coverWarning = '';
    if (coverFile) {
      stage = '上传并设置推文封面';
      status(`${stage}：${manifest.coverImage.sourceName || coverFile.name}…`);
      try { coverProof = await setCoverFromFile(tab.id, coverFile); }
      catch (error) { coverWarning = '封面未完成：' + error.message + '；可使用“只重试封面”继续。'; }
    }
    stage = '核对标题、图片与正文';
    if (await readField(tab.id, '#title') !== manifest.title) throw new Error('可见标题框与准备稿标题不一致，稿件未保存。');
    if (await readField(tab.id, '#js_description') !== manifest.summary.trim()) {
      throw new Error('填写封面后微信编辑器的摘要未保持原值，稿件未保存。');
    }
    // 独立工具版：包内没有封面时，封面仅作提醒，不阻断正文填入
    const insertedHtml = await getEditorHtml(tab.id);
    if (!insertedHtml.replace(/<[^>]+>/g, '').trim() && !/<img\b/i.test(insertedHtml)) throw new Error('正文 API 写入后内容为空，已停止。');
    if (insertedHtml.includes('WECHATIMGPH_')) throw new Error('正文仍有未替换的图片占位符，已停止。');
    for (const url of uploadedUrls) {
      if (!insertedHtml.includes(url.split('?')[0])) throw new Error('编辑器正文中未找到已上传图片，稿件未保存。');
    }
    const readback = typeof DraftCore !== 'undefined' ? DraftCore.compare(content, insertedHtml) : null;
    if (globalThis.DraftStudio) DraftStudio.recordFill({tabId:tab.id,html:content,title:manifest.title,summary:manifest.summary.trim()});
    if (readback && !readback.ok) throw new Error('正文已写入，但回读发现差异：' + readback.issues.join('；') + '。请保留页面检查，不要重复填入。');
    stage = '完成';
    status(`标题、${[...manifest.summary].length}字摘要和正文已填入；${uploadedUrls.length} 张正文图片完成上传`
      + (coverProof ? `，封面预览已变化（${coverProof.matchKind}）` : coverWarning ? '；' + coverWarning : '；未选择封面，可在微信中补充')
      + (readback ? '。正文文字与图片顺序已核对。' + readback.styleWarnings.join('') : '')
      + '。请检查排版、图片与摘要，再手动保存草稿。');
  } finally {
    await chrome.debugger.detach({ tabId: tab.id }).catch(() => {});
  }
  } catch (error) {
    throw new Error(`[${stage}] ${error.message || String(error)}`);
  }
}

async function runMatrixCoverOnly() {
  const tab = await currentEditorTab();
  if (!tab?.id) throw new Error('没有当前编辑页。');
  const platform = identifyDraftPlatform(tab.url || '');
  const selection = await selectedDraftBundle(platform);
  const bundle = selection.bundle;
  if (!['wechat','yidian','toutiao','penguin','sohu'].includes(platform))
    throw new Error('独立封面按钮仅用于支持的文章编辑页。');
  if (bundle.manifest.targetPlatform !== platform
      && !bundle.manifest.compatiblePlatforms?.includes(platform))
    throw new Error('准备包与当前平台不一致。');
  await verifySelectedDraft(selection, platform);
  if (platform === 'wechat') {
    requireWechatEditorialMetadata(bundle.manifest);
    const coverFile = bundle.manifest.coverImage
      && bundle.assets.get(`assets/${bundle.manifest.coverImage.bundleFile}`);
    if (!coverFile) throw new Error('本准备包未包含封面图片（工具版不做封面强制）：请直接在编辑器里手动设置封面。');
    await attachDebugger(tab.id);
    try {
      status('仅上传并设置微信封面…');
      const proof = await setCoverFromFile(tab.id, coverFile);
      status(`微信封面预览已变化（${proof.matchKind}），请检查裁剪；尚未保存草稿。`);
    } finally {
      await chrome.debugger.detach({tabId:tab.id}).catch(() => {});
    }
    return;
  }
  await attemptMatrixCover(tab.id, bundle, platformName(platform) || platform);
}

$('#cover-only').addEventListener('click', async () => {
  setFillBusy(true);
  try { await runMatrixCoverOnly(); }
  catch(error) { status('封面未完成：' + String(error.message || error)); }
  finally { setFillBusy(false); }
});

$('#run').addEventListener('click', async () => {
  setFillBusy(true);
  try { await run(); }
  catch (error) { status(`未完成：${error.message || String(error)}`); }
  finally { setFillBusy(false); }
});

function setFillBusy(busy) {
  for (const element of document.querySelectorAll('input, select, button')) element.disabled = busy;
  if (!busy) updateRunState();
}

function identifyDraftPlatform(address) {
  let url;
  try { url = new URL(address); }
  catch (_) {
    throw new Error('无法识别当前编辑页网址。请切换到微信、头条、一点号、企鹅号、搜狐号或微博文章编辑页，再重新打开扩展。');
  }
  if (url.protocol !== 'https:') throw new Error('请打开 HTTPS 编辑页。');
  if (url.hostname === 'mp.weixin.qq.com') return 'wechat';
  if (url.hostname === 'mp.yidianzixun.com'
      && /^#\/Writing\/articleEditor(?:[/?]|$)/.test(url.hash)) return 'yidian';
  // Inspection may use any Toutiao page; writes require the actual article editor below.
  if (url.hostname === 'mp.toutiao.com') return 'toutiao';
  if (url.hostname === 'om.qq.com' || url.hostname.endsWith('.om.qq.com')) return 'penguin';
  if (url.hostname === 'mp.sohu.com' || url.hostname.endsWith('.mp.sohu.com')) return 'sohu';
  if (url.hostname === 'card.weibo.com' && /^\/article\/v[35]\/editor\/?$/.test(url.pathname)) return 'weibo';
  throw new Error('当前标签页不是已支持的平台页面。');
}

function platformName(platform) {
  return ({wechat: '微信公众号', yidian: '一点资讯', toutiao: '今日头条', penguin: '企鹅号', sohu: '搜狐号', weibo: '微博头条文章'})[platform] || platform;
}

async function inspectDraftEditor() {
  const tab = await currentEditorTab();
  if (!tab?.id) throw new Error('没有可检查的当前标签页。');
  const platform = identifyDraftPlatform(tab.url || '');
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id }, world: 'MAIN',
    func: () => {
      const visible = (el) => !!el.getClientRects().length
        && el.ownerDocument.defaultView.getComputedStyle(el).visibility !== 'hidden';
      const describe = (el) => ({
        tag: el.tagName.toLowerCase(), id: el.id, class: el.className,
        role: el.getAttribute('role'), placeholder: el.getAttribute('placeholder')
          || el.getAttribute('data-placeholder'),
        type: el.getAttribute('type'), accept: el.getAttribute('accept'),
        contenteditable: el.getAttribute('contenteditable'),
        ariaLabel: el.getAttribute('aria-label'), maxLength: el.getAttribute('maxlength'),
        visible: visible(el),
      });
      const docs = [{ document, scope: 'main' }];
      const frames = [...document.querySelectorAll('iframe')].map((frame, index) => {
        let readable = false;
        try {
          if (frame.contentDocument && visible(frame)) {
            docs.push({ document: frame.contentDocument, scope: `iframe:${index}` });
            readable = true;
          }
        } catch (_) {}
        return { ...describe(frame), readable };
      });
      const fields = docs.flatMap(({ document: doc, scope }) =>
        [...doc.querySelectorAll('input:not([type="hidden"]):not([type="password"]),textarea,[contenteditable]:not([contenteditable="false"]),input[type="file"]')]
          .filter((el) => visible(el) || el.getAttribute('type') === 'file')
          .slice(0, 80).map((el) => ({ scope, ...describe(el) })));
      const editorRoots = docs.flatMap(({ document: doc, scope }) =>
        [...doc.querySelectorAll('.ProseMirror,.ql-editor,.public-DraftEditor-content,[data-slate-editor],.ck-editor__editable')]
          .filter(visible).slice(0, 20).map((el) => ({ scope, ...describe(el),
            imageCount: el.querySelectorAll('img').length,
            lastImageReadback: el.__draftHelperPortalImageReadback || null,
            images: [...el.querySelectorAll('img')].slice(0,100).map((img,index)=>{
              const source = value => {
                try {
                  const u=new URL(value,doc.baseURI);
                  return ['https:','http:'].includes(u.protocol) ? {
                    path:u.origin+u.pathname,queryKeys:[...new Set(u.searchParams.keys())],
                  } : {protocol:u.protocol};
                } catch { return {protocol:'invalid'}; }
              };
              return {index:index+1,src:source(img.src),currentSrc:source(img.currentSrc || img.src),
                visible:visible(img),complete:img.complete,
                naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight,
                excludedAsEditorControl:!!img.closest('button,[role="button"],[role="toolbar"],.ql-clipboard,.ProseMirror-widget')};
            }),
          })));
      const ueditors = Object.entries(window.UE?.instants || {}).map(([key, editor]) => ({
        key, containerId: editor.container?.id || null,
        canGetContent: typeof editor.getContent === 'function',
        canSetContent: typeof editor.setContent === 'function',
        ready: editor.isReady === true,
      }));
      const yidianEditorRuntime = docs.flatMap(({ document: doc, scope }) =>
        [...doc.querySelectorAll('.editor-content.medium-editor-element[contenteditable="true"]')]
          .filter(visible).map((body) => {
            const vue = [];
            let node = body;
            for (let depth = 0; node && depth < 8; depth++, node = node.parentElement) {
              const vm = node.__vue__;
              if (!vm) continue;
              const options = vm.$options || {};
              const editor = vm.editor;
              let proto = editor;
              const editorMethods = new Set();
              for (let level = 0; proto && level < 4; level++, proto = Object.getPrototypeOf(proto))
                for (const name of Object.getOwnPropertyNames(proto))
                  if (typeof Object.getOwnPropertyDescriptor(proto, name)?.value === 'function') editorMethods.add(name);
              const methodSources = ['updateEditorContent', 'processHtml', 'replaceContent', 'serialize',
                'removeBlankRow', 'triggerChange', 'getTextContent', 'getRootNode'].map((name) => {
                const method = options.methods?.[name] || vm[name];
                return typeof method === 'function' ? { name, source: method.toString().slice(0, 1800) } : null;
              }).filter(Boolean);
              const editorMethodSources = ['setContent', 'getContent', 'checkContentChanged', 'resetContent', 'pasteHTML']
                .map((name) => {
                  let owner = editor;
                  let method;
                  for (let level = 0; owner && level < 4 && !method; level++, owner = Object.getPrototypeOf(owner))
                    method = Object.getOwnPropertyDescriptor(owner, name)?.value;
                  return typeof method === 'function' ? { name, source: method.toString().slice(0, 2200) } : null;
                }).filter(Boolean);
              vue.push({ depth, component: options.name || options._componentTag || null,
                editorStateKeys: Object.keys(vm).filter((key) => /editor|content|article|body|html|text|rich|medium/i.test(key)).slice(0, 40),
                editorMethodNames: Object.keys(options.methods || {}).filter((key) => /editor|content|article|body|html|text|rich|medium/i.test(key)).slice(0, 40),
                editorInstance: editor && typeof editor === 'object' ? { type: editor.constructor?.name || 'object',
                  methodNames: [...editorMethods].filter((key) => /content|html|editor|paste|insert|set/i.test(key)).slice(0, 60),
                  methodSources: editorMethodSources } : null,
                methodSources });
            }
            const candidates = ['mediumEditor', '_mediumEditor', 'editor', '__mediumEditor'].map((key) => {
              const value = body[key];
              if (!value || (typeof value !== 'object' && typeof value !== 'function')) return null;
              let proto = value;
              const methods = new Set();
              for (let level = 0; proto && level < 3; level++, proto = Object.getPrototypeOf(proto))
                for (const name of Object.getOwnPropertyNames(proto))
                  if (typeof Object.getOwnPropertyDescriptor(proto, name)?.value === 'function') methods.add(name);
              return { key, type: value.constructor?.name || typeof value, methods: [...methods].filter((name) => /content|html|editor|paste|insert|set/i.test(name)).slice(0, 40) };
            }).filter(Boolean);
            const childTags = {};
            for (const child of body.querySelectorAll('*')) childTags[child.tagName.toLowerCase()] = (childTags[child.tagName.toLowerCase()] || 0) + 1;
            return { scope, ...describe(body), textLength: body.textContent.length,
              imageCount: body.querySelectorAll('img').length, childTags,
              yidianModelGuardActive: !!body.__draftHelperYidianGuard,
              blockedVueModelWrites: body.__draftHelperYidianGuard?.blocked?.slice(-20) || [],
              blockedEditorSetContent: body.__draftHelperYidianGuard?.contentBlocks?.slice(-20) || [],
              yidianGuardOwners: body.__draftHelperYidianGuard?.owners || [],
              yidianContentGuard: !!body.__draftHelperYidianGuard?.contentGuardInstalled,
              yidianPlatformSync: body.__draftHelperYidianGuard?.platformSync || null,
              yidianDomReverts: body.__draftHelperYidianGuard?.domReverts?.slice(-10) || [],
              yidianWatchdog: body.__draftHelperYidianGuard?.watchdog || null,
              dataAttributes: [...body.attributes].filter((attr) => attr.name.startsWith('data-')).map((attr) => attr.name).slice(0, 40),
              vue, candidates };
          }));
      return {
        fields, frames, ueditors, editorRoots, yidianEditorRuntime,
        apis: { wechat: typeof window.__MP_Editor_JSAPI__?.invoke === 'function',
          ueditor: !!window.UE, tinymce: !!window.tinymce, wangEditor: !!window.wangEditor,
          quill: !!window.Quill, draftjs: !!window.Draft, slate: !!window.Slate,
          mediumEditor: typeof window.MediumEditor,
          mediumEditorRegistry: Object.entries(window._mediumEditors || {}).map(([key, editor]) => ({
            key, type: editor?.constructor?.name || typeof editor,
            methodNames: editor ? [...new Set([...Object.getOwnPropertyNames(editor),
              ...Object.getOwnPropertyNames(Object.getPrototypeOf(editor) || {})])]
              .filter((name) => /content|html|editor|paste|insert|set/i.test(name)
                && typeof Object.getOwnPropertyDescriptor(editor, name)?.value === 'function'
                || /content|html|editor|paste|insert|set/i.test(name)
                  && typeof Object.getOwnPropertyDescriptor(Object.getPrototypeOf(editor) || {}, name)?.value === 'function')
              .slice(0, 60) : [],
            methodSources: editor ? ['setContent', 'getContent', 'checkContentChanged', 'resetContent', 'pasteHTML']
              .map((name) => {
                let owner = editor;
                let method;
                for (let level = 0; owner && level < 4 && !method; level++, owner = Object.getPrototypeOf(owner))
                  method = Object.getOwnPropertyDescriptor(owner, name)?.value;
                return typeof method === 'function' ? { name, source: method.toString().slice(0, 2200) } : null;
              }).filter(Boolean) : [],
          })).slice(0, 12),
          editorGlobalKeys: Object.getOwnPropertyNames(window).filter((key) => /editor/i.test(key)).slice(0, 40) },
      };
    },
  });
  if (!results[0]?.result) throw new Error('没有取得当前编辑页的信息。');
  if (platform === 'toutiao') {
    try {
      const probe = await chrome.scripting.executeScript({ target: { tabId: tab.id },
        world: 'MAIN', func: toutiaoBodyEmptyState });
      results[0].result.bodyEmptyCheck = probe[0]?.result || null;
    } catch (error) { results[0].result.bodyEmptyCheckError = error.message; }
  }
  let matrixCoverControls = null;
  if (platform !== 'wechat') {
    try {
      const checked = await chrome.scripting.executeScript({target:{tabId:tab.id}, world:'MAIN', func:matrixCoverInspectInPage});
      matrixCoverControls = checked[0]?.result || null;
    } catch(error) { matrixCoverControls = {error:String(error.message || error).slice(0,200)}; }
  }
  const report = { schema_version: 'DRAFT_HELPER_EDITOR_INSPECTION_V1', platform,
    extension: { version: chrome.runtime.getManifest().version,
      yidianUploadBuild: typeof YIDIAN_UPLOAD_BUILD === 'string' ? YIDIAN_UPLOAD_BUILD : null },
    inspected_at: new Date().toISOString(),
    page: { origin: new URL(tab.url).origin, pathname: new URL(tab.url).pathname },
    ...results[0].result, ...(matrixCoverControls ? {matrixCoverControls} : {}) };
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `draft-helper-${platform}-editor-inspection.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status('编辑器检查报告已导出，请将 JSON 文件发给助手用于适配填稿。');
}

$('#inspect').addEventListener('click', async () => {
  $('#inspect').disabled = true;
  try { await inspectDraftEditor(); }
  catch (error) { status(`检查未完成：${error.message || String(error)}`); }
  finally { $('#inspect').disabled = false; }
});

// Informational only; filling always re-evaluates the platform and selected source.
if (!globalThis.DraftStudio) refreshAutoChoice();
refreshPageStatus();
refreshManualStatus();

document.getElementById('open-studio')?.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({active:true,currentWindow:true});
  await chrome.tabs.create({url:chrome.runtime.getURL('studio.html') + (tab?.id ? '?target=' + tab.id : '')});
});
