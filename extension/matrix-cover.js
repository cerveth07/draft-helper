'use strict';

/**
 * Step 9: safely attempt the original, SHA-verified WeChat cover as the
 * platform's separate cover. Never insert it into article HTML.
 *
 * Sohu exposes its file input in the cover dialog's local-upload tab.
 * Other portals retain the explicit, uniquely identified input fallback.
 * An unchanged or unverifiable preview is NEVER reported as success.
 */
function toutiaoCoverSetInPage(encoded, filename, mime) {
  // 人工顺序（用户实测）：展示封面 → 单图 → 点「+」框 或「替换」→ 上传图片 → 本地上传 → 选中 → 确定
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (el) => !!(el && el.offsetParent !== null);
  const text = (el) => (el && el.innerText ? el.innerText.replace(/\s+/g, ' ').trim() : '');
  const drawer = () => document.querySelector('.byte-drawer-content')
    || document.querySelector('.upload-image-panel');
  const localInput = () => [...document.querySelectorAll('input[type="file"]')]
    .find((input) => !input.disabled
      && input.closest('.btn-upload-handle, .upload-btn, .btn-upload-scand'));
  const makeFile = (dataUrl) => {
    const match = dataUrl.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) return null;
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new File([bytes], filename, {type: mime || match[1] || 'image/jpeg'});
  };
  const fireMouse = (el, x, y) => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.dispatchEvent(new MouseEvent(type, {
        bubbles: true, cancelable: true, clientX: x, clientY: y, view: window,
      }));
    }
  };

  return (async () => {
    const cell = [...document.querySelectorAll('.pgc-edit-cell')]
      .find((node) => /展示封面/.test(text(node.querySelector('.edit-label'))));
    if (!cell) return {status: 'manual_required', reason: '未找到「展示封面」编辑行'};
    const cover = cell.querySelector('.article-cover') || cell;
    const previews = () => [...cover.querySelectorAll('img')]
      .map((img) => img.currentSrc || img.src).filter((url) => typeof url === 'string' && url.length);

    // 1) 单图模式
    const single = [...cover.querySelectorAll('label')].find((label) => /单图/.test(text(label)));
    if (single && !/checked/.test(((single.querySelector('.byte-radio-inner') || {}).className) || '')) {
      single.click();
      await sleep(500);
    }

    // 2) 点「+」空槽（或已有图时的「替换」）
    if (!drawer()) {
      const replace = [...cover.querySelectorAll('button,span,div,a')]
        .find((node) => visible(node) && /^(替换|编辑)$/.test(text(node)));
      if (replace) {
        fireMouse(replace, replace.getBoundingClientRect().left + 4,
          replace.getBoundingClientRect().top + 4);
        for (let i = 0; i < 12 && !drawer(); i++) await sleep(250);
      }
    }
    if (!drawer()) {
      // 用户实测的确定性入口：已有图 → a.article-cover-img-replace；空槽 → .article-cover-add
      const replace = cover.querySelector('a.article-cover-img-replace, .article-cover-img-replace');
      const add = cover.querySelector('.article-cover-add') || cell.querySelector('.article-cover-add');
      const opener = replace || add;
      if (opener) {
        const rect = opener.getBoundingClientRect();
        const x = rect.left + Math.min(rect.width / 2, 20);
        const y = rect.top + Math.min(rect.height / 2, 20);
        opener.click();
        await sleep(400);
        if (!drawer()) fireMouse(opener, x, y);
        if (!drawer()) {
          const icon = opener.querySelector('svg, path');
          if (icon) fireMouse(icon, x, y);
        }
        for (let i = 0; i < 24 && !drawer(); i++) await sleep(250);
      }
    }
    if (!drawer()) {
      const boxes = [...cover.querySelectorAll('div,span,section')]
        .filter((node) => visible(node) && !node.querySelector('label')
          && !node.querySelector('img')
          && node.getBoundingClientRect().width >= 100
          && node.getBoundingClientRect().height >= 80)
        .sort((a, b) => a.getBoundingClientRect().width - b.getBoundingClientRect().width);
      for (const box of boxes) {
        if (drawer()) break;
        const rect = box.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const deep = document.elementFromPoint(x, y) || box;
        fireMouse(deep, x, y);
        await sleep(500);
        if (!drawer() && deep.parentElement) {
          fireMouse(deep.parentElement, x, y);
          await sleep(500);
        }
        if (!drawer()) {
          fireMouse(box, x, y);
          await sleep(500);
        }
      }
    }
    if (!drawer()) {
      return {status: 'manual_required',
              reason: '未能点开封面素材面板（已尝试「替换」与「+」区域）'};
    }

    // 3) 面板默认停在「正文图片」标签，先切到「上传图片」再取该页的 file input
    const uploadTab = [...document.querySelectorAll('.byte-tabs-header-title')]
      .find((node) => /上传图片/.test(text(node)));
    if (uploadTab) {
      uploadTab.click();
      await sleep(600);
    }
    const anyImageInput = () => {
      const drawerNode = drawer();
      const scope = drawerNode || document;
      const inputs = [...scope.querySelectorAll('input[type="file"]')]
        .filter((node) => !node.disabled && /image/i.test(node.accept || 'image/'));
      // 优先「本地上传」按钮里的 input，其次该面板内最后一个 image input（上传页的）
      return inputs.find((node) => node.closest('.btn-upload-handle, .upload-btn, .btn-upload-scand'))
        || inputs[inputs.length - 1];
    };
    let input = localInput() || anyImageInput();
    for (let i = 0; i < 40 && !input; i++) {
      await sleep(250);
      input = localInput() || anyImageInput();
    }
    if (!input) {
      return {status: 'manual_required',
              reason: '素材面板已打开，但未找到「本地上传」的图片输入框'};
    }
    const before = previews();
    const file = makeFile(encoded);
    if (!file) return {status: 'manual_required', reason: '封面数据解码失败'};
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));

    // 4) 上传结果出现后选中缩略图，再点真实「确定」（data-e2e 稳定选择器）
    let picked = false;
    let confirmed = false;
    for (let i = 0; i < 80 && !confirmed; i++) {
      await sleep(400);
      const wraps = [...document.querySelectorAll('.img-wrap')].filter(visible);
      const confirmBtn = document.querySelector('button[data-e2e="imageUploadConfirm-btn"]');
      if (!wraps.length && !confirmBtn) break;          // 弹窗已关闭
      if (wraps.length && !picked) {
        wraps[0].click();
        picked = true;
        await sleep(500);
        continue;
      }
      if (confirmBtn && !confirmBtn.disabled) {
        confirmBtn.click();
        confirmed = true;
        await sleep(1200);
      }
    }
    if (!confirmed) {
      // 兜底：按文字找确定按钮（仍排除标签栏）
      const fallback = [...document.querySelectorAll('button, span')]
        .find((node) => visible(node) && /^确定$/.test(text(node))
          && !node.closest('.byte-tabs-header'));
      if (fallback) {
        fallback.click();
        confirmed = true;
        await sleep(1000);
      }
    }

    // 5) 校验封面预览
    for (let i = 0; i < 40; i++) {
      const after = previews();
      const addGone = !cover.querySelector('.article-cover-add');
      if (addGone || (after.length
          && (after.length !== before.length || after.some((url) => !before.includes(url))))) {
        return {status: 'preview_changed_needs_review',
                reason: '头条封面区块预览已变化，请核对裁剪与最终状态',
                pickedUploadedImage: picked,
                coverPlaceholderGone: !cover.querySelector('.article-cover-add'),
                previewBefore: before.length, previewAfter: after.length};
      }
      if (!drawer() && i > 4) break;
      await sleep(400);
    }
    return {status: 'manual_required',
            reason: picked
              ? '已选中上传的封面，但封面区块预览未变化，请手动确认'
              : '已输入封面文件，但面板未出现上传结果'};
  })();
}

async function toutiaoClickAt(tabId, x, y) {
  const box = {x: Math.round(x), y: Math.round(y)};
  await chrome.debugger.sendCommand({tabId}, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved', ...box, button: 'none', buttons: 0,
  });
  await chrome.debugger.sendCommand({tabId}, 'Input.dispatchMouseEvent', {
    type: 'mousePressed', ...box, button: 'left', buttons: 1, clickCount: 1,
  });
  await chrome.debugger.sendCommand({tabId}, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased', ...box, button: 'left', buttons: 0, clickCount: 1,
  });
}

async function toutiaoRectOf(tabId, expression) {
  return evaluate(tabId, `(async () => {
    const el = (${expression});
    if (!el) return null;
    el.scrollIntoView({block: 'center', inline: 'center'});
    // 等两帧，确保滚动后的布局已生效，否则坐标会落在视口外
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2,
      y: r.top + r.height / 2,
      w: r.width,
      h: r.height,
      inViewport: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth,
    };
  })()`);
}

async function setToutiaoCover(tabId, encoded, filename, mime, size) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const cellExpr = `(() => {
    const cell = [...document.querySelectorAll('.pgc-edit-cell')]
      .find((n) => /展示封面/.test((n.querySelector('.edit-label') || {}).textContent || ''));
    return cell ? cell : null;
  })()`;
  const coverExpr = `(() => { const cell = ${cellExpr}; return cell ? cell.querySelector('.article-cover') : null; })()`;
  const drawerExpr = `(document.querySelector('.byte-drawer-content') || document.querySelector('.upload-image-panel'))`;
  const clickExpr = async (expression) => {
    const rect = await toutiaoRectOf(tabId, expression);
    if (!rect) return false;
    await toutiaoClickAt(tabId, rect.x, rect.y);
    return true;
  };
  const singleChecked = () => evaluate(tabId, `(() => {
    const cover = ${coverExpr}; if (!cover) return null;
    const label = [...cover.querySelectorAll('label')].find((l) => /单图/.test(l.innerText || ''));
    if (!label) return null;
    return /checked/.test(((label.querySelector('.byte-radio-inner') || {}).className) || '');
  })()`);
  const coverImages = () => evaluate(tabId, `(() => {
    const cover = ${coverExpr};
    return cover ? [...cover.querySelectorAll('img')].map((i) => i.currentSrc || i.src).filter(Boolean) : [];
  })()`);

  if (!(await evaluate(tabId, `!!(${cellExpr})`))) {
    return {status: 'manual_required', reason: '未找到「展示封面」编辑行，页面结构可能已变'};
  }

  // 1) 切到单图：真实点击 label → .byte-radio-inner → input[type=radio] 事件兜底，每步回读
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await singleChecked()) break;
    const labelExpr = `(() => { const cover = ${coverExpr}; if (!cover) return null;
      return [...cover.querySelectorAll('label')].find((l) => /单图/.test(l.innerText || '')); })()`;
    if (!(await clickExpr(labelExpr))) break;
    await sleep(600);
    if (await singleChecked()) break;
    const innerExpr = `(() => { const cover = ${coverExpr}; if (!cover) return null;
      const label = [...cover.querySelectorAll('label')].find((l) => /单图/.test(l.innerText || ''));
      return label && label.querySelector('.byte-radio-inner'); })()`;
    if (!(await clickExpr(innerExpr))) break;
    await sleep(600);
    if (await singleChecked()) break;
    await evaluate(tabId, `(() => { const cover = ${coverExpr}; if (!cover) return false;
      const label = [...cover.querySelectorAll('label')].find((l) => /单图/.test(l.innerText || ''));
      const input = label && label.querySelector('input[type="radio"]');
      if (!input) return false;
      input.checked = true;
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new Event('change', {bubbles: true}));
      input.click();
      return true; })()`);
    await sleep(700);
  }
  if ((await singleChecked()) !== true) {
    return {status: 'manual_required', reason: '无法切换到「单图」模式（label / inner / radio 三种真实点击均未生效）'};
  }

  // 2) 打开素材面板：替换（cell 范围）优先，其次空槽
  const drawerOpen = () => evaluate(tabId, `!!(${drawerExpr})`);
  if (!(await drawerOpen())) {
    for (const selector of ['a.article-cover-img-replace', '.article-cover-img-replace',
      'a[data-key].article-cover-img-replace']) {
      if (await drawerOpen()) break;
      await clickExpr(`(() => { const cell = ${cellExpr}; if (!cell) return null;
        return cell.querySelector(${JSON.stringify(selector)}); })()`);
      for (let i = 0; i < 12 && !(await drawerOpen()); i++) await sleep(250);
    }
  }
  if (!(await drawerOpen())) {
    await clickExpr(`(() => { const cell = ${cellExpr}; if (!cell) return null;
      return cell.querySelector('.article-cover-add'); })()`);
    for (let i = 0; i < 24 && !(await drawerOpen()); i++) await sleep(250);
  }
  if (!(await drawerOpen())) {
    return {status: 'manual_required', reason: '未能打开封面素材面板（替换与「+」真实点击均未触发）'};
  }
  const beforeImages = await coverImages();

  // 3) 切「上传图片」标签（严格校验在 drawer 内），再轮询取该页的图片 input
  let tabSwitched = false;
  for (let attempt = 0; attempt < 3 && !tabSwitched; attempt++) {
    await clickExpr(`([...document.querySelectorAll('.byte-tabs-header-title')]
      .find((n) => /上传图片/.test(n.innerText || '')) || null)`);
    await sleep(700);
    tabSwitched = await evaluate(tabId, `(() => {
      const handles = '.upload-handler-drag, .btn-upload-handle, .upload-btn, .btn-upload-scand';
      const drawer = ${drawerExpr};
      if (!drawer) return false;
      const panes = [...drawer.querySelectorAll('.byte-tabs-content-item-active')];
      return panes.some((pane) => pane.querySelector(handles));
    })()`);
  }
  if (!tabSwitched) {
    return {status: 'manual_required',
            reason: '未能切换到「上传图片」标签（drawer 内活动内容区没有上传句柄），已停止注入以免误传到正文图片'};
  }

  let injected = null;
  for (let attempt = 0; attempt < 20 && !(injected && injected.ok); attempt++) {
    injected = await evaluate(tabId, `(() => {
      const handles = '.btn-upload-handle, .upload-btn, .btn-upload-scand';
      const drawer = ${drawerExpr};
      if (!drawer) return {ok: false, reason: '素材面板已消失'};
      const active = [...drawer.querySelectorAll('.byte-tabs-content-item-active')];
      const pick = (nodes) => nodes.filter((n) => !n.disabled && /image/i.test(n.accept || 'image/'));
      const paneInputs = pick(active.flatMap((pane) => [...pane.querySelectorAll('input[type="file"]')]));
      const drawerInputs = pick([...drawer.querySelectorAll('input[type="file"]')]);
      const pool = paneInputs.length ? paneInputs : drawerInputs;
      const input = pool.find((n) => n.closest('.upload-handler-drag'))
        || pool.find((n) => n.closest(handles))
        || null;
      if (!input) return {ok: false, reason: '上传页暂无可用的图片 input',
                          paneInputs: paneInputs.length, drawerInputs: drawerInputs.length};
      const match = ${JSON.stringify(encoded)}.match(/^data:([^;]+);base64,(.*)$/);
      if (!match) return {ok: false, reason: '封面数据解码失败'};
      const binary = atob(match[2]);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], ${JSON.stringify(filename)}, {type: ${JSON.stringify(mime)} || match[1]});
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      input.dispatchEvent(new Event('input', {bubbles: true}));
      input.dispatchEvent(new Event('change', {bubbles: true}));
      return {ok: true, paneInputs: paneInputs.length, drawerInputs: drawerInputs.length,
              usedUploadHandle: !!input.closest(handles), usedDragZone: !!input.closest('.upload-handler-drag')};
    })()`);
    if (injected && injected.ok) break;
    await sleep(250);
  }
  if (!injected || !injected.ok) {
    const extra = injected
      ? `（活动页 input ${injected.paneInputs ?? '?'}，drawer 内 ${injected.drawerInputs ?? '?'}）`
      : '';
    return {status: 'manual_required',
            reason: '注入封面失败：' + ((injected && injected.reason) || 'unknown') + extra};
  }

  // 4) 选中缩略图（drawer 范围内）→ 点「确定」（可用时）
  let picked = false;
  let confirmed = false;
  for (let i = 0; i < 60 && !confirmed; i++) {
    await sleep(400);
    const state = await evaluate(tabId, `(() => {
      const drawer = ${drawerExpr};
      const wraps = drawer
        ? [...drawer.querySelectorAll('.img-wrap')].filter((n) => n.offsetParent).length
        : 0;
      const btn = document.querySelector('button[data-e2e="imageUploadConfirm-btn"]');
      return {
        wraps,
        confirm: !!btn,
        confirmEnabled: !!btn && !btn.disabled && !/disabled/.test(btn.className || ''),
        drawer: !!drawer,
      };
    })()`);
    if (!state || (!state.drawer && !state.confirm)) break;
    if (state.wraps && !picked) {
      await clickExpr(`(() => { const drawer = ${drawerExpr}; if (!drawer) return null;
        return [...drawer.querySelectorAll('.img-wrap')].filter((n) => n.offsetParent)[0] || null; })()`);
      picked = true;
      await sleep(500);
      continue;
    }
    if (state.confirm && state.confirmEnabled) {
      await clickExpr(`document.querySelector('button[data-e2e="imageUploadConfirm-btn"]')`);
      confirmed = true;
      await sleep(1200);
    }
  }

  // 5) 终态校验：单图仍选中，且封面图集合真的变了（或空槽消失）
  const afterImages = await coverImages();
  const final = await evaluate(tabId, `(() => {
    const cover = ${coverExpr};
    return {
      modeSingle: (() => { if (!cover) return null;
        const label = [...cover.querySelectorAll('label')].find((l) => /单图/.test(l.innerText || ''));
        return !!label && /checked/.test(((label.querySelector('.byte-radio-inner') || {}).className) || ''); })(),
      addGone: cover ? !cover.querySelector('.article-cover-add') : null,
      drawer: !!(${drawerExpr}),
    };
  })()`);
  const changed = Array.isArray(afterImages)
    && (afterImages.length > (beforeImages || []).length
      || afterImages.some((url) => !(beforeImages || []).includes(url)));
  if (final && final.modeSingle === true && (changed || final.addGone === true)) {
    return {status: 'preview_changed_needs_review',
            reason: '头条封面已按单图模式完成装填（真实点击），请核对裁剪与最终状态',
            coverMode: '单图',
            imagesBefore: (beforeImages || []).length,
            imagesAfter: (afterImages || []).length,
            placeholderGone: final.addGone,
            dialogClosed: !final.drawer,
            pickedUploadedImage: picked,
            pressedConfirm: confirmed};
  }
  return {status: 'manual_required',
          reason: '封面流程未完成（模式: ' + (final ? (final.modeSingle ? '单图' : '非单图') : '未知')
            + '，封面图 ' + (beforeImages || []).length + '→' + (afterImages || []).length
            + '，弹窗 ' + (final && final.drawer ? '仍打开' : '已关闭')
            + '，选图 ' + picked + '，确定 ' + confirmed + '）'};
}

async function setPenguinCover(tabId, encoded, filename, mime, size) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const SCOPE = '#articlePublish-coverinfo';
  const clickExpr = async (expression) => {
    const rect = await toutiaoRectOf(tabId, expression);
    if (!rect) return false;
    await toutiaoClickAt(tabId, rect.x, rect.y);
    return true;
  };
  const state = () => evaluate(tabId, `(() => {
    const scope = document.querySelector('${SCOPE}');
    const single = scope ? scope.querySelector('input.omui-radio__input[value="1"]') : null;
    const inputs = [...document.querySelectorAll('input[type="file"]')]
      .filter((n) => !n.disabled && /image/i.test(n.accept || 'image/'));
    return {
      scopeFound: !!scope,
      singleChecked: !!(single && single.checked),
      imageInputs: inputs.length,
      coverImgs: scope ? scope.querySelectorAll('img').length : 0,
      addBtn: !!(scope && scope.querySelector('button[class*="addCoverBtn"]')),
      confirmVisible: [...document.querySelectorAll('button,span,div')]
        .some((n) => n.offsetParent && /^(确定|确认|完成|使用图片|使用)$/.test((n.innerText || '').trim())),
    };
  })()`);

  if (!(await state())?.scopeFound) {
    return {status: 'manual_required', reason: '未找到封面区 #articlePublish-coverinfo'};
  }

  // 1) 确保单图（企鹅号 value=1 是单图）
  if (!(await state()).singleChecked) {
    for (let attempt = 0; attempt < 3 && !(await state()).singleChecked; attempt++) {
      await clickExpr(`(() => { const scope = document.querySelector('${SCOPE}');
        const input = scope && scope.querySelector('input.omui-radio__input[value="1"]');
        if (!input) return null;
        return input.closest('label') || input; })()`);
      await sleep(400);
    }
    if (!(await state()).singleChecked) {
      return {status: 'manual_required', reason: '未能切换到「单图」（value=1 的 radio 未选中）'};
    }
  }

  // 2) 打开上传层；层默认停在「我的素材」，需切到「本地上传」才会挂载文件 input
  //    已有封面时入口会变成「更换/编辑」，因此两种入口都要支持
  if ((await state()).imageInputs === 0) {
    const entryExpr = `(() => {
      const scope = document.querySelector('${SCOPE}') || document;
      const add = scope.querySelector('button[class*="addCoverBtn"], .omui-button--add');
      if (add) return add;
      return [...scope.querySelectorAll('button, span, a, div, i')].find((node) => node.offsetParent
        && /^(更换|替换|编辑|上传|上传图片|本地上传|修改封面|选择封面)$/.test((node.innerText || '').trim()))
        || null;
    })()`;
    const entry = await evaluate(tabId, `(() => { const node = ${entryExpr};
      if (!node) return null;
      return {tag: node.tagName, text: (node.innerText || '').trim().slice(0, 12),
              cls: (typeof node.className === 'string' ? node.className : '').slice(0, 60)}; })()`);
    if (!entry) {
      return {status: 'manual_required', reason: '封面区内既没有「添加封面」也没有「更换/编辑」入口'};
    }
    const opened = await clickExpr(entryExpr);
    if (!opened) {
      return {status: 'manual_required',
              reason: '找到封面入口但点击失败（' + entry.tag + ' / ' + entry.text + '）'};
    }
    let tabClicked = false;
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      const probe = await evaluate(tabId, `(() => {
        const inputs = [...document.querySelectorAll('input[type="file"]')]
          .filter((n) => !n.disabled && /image/i.test(n.accept || 'image/'));
        const tab = document.querySelector('li.omui-tab__label, .omui-tab__label');
        const tabs = [...document.querySelectorAll('li.omui-tab__label, .omui-tab__label')]
          .map((n) => (n.innerText || '').trim());
        return {inputs: inputs.length,
                uploadTab: tabs.find((t) => /本地上传|上传/.test(t)) || null,
                trigger: !!document.querySelector('.omui-upload-image-trigger'),
                tabs};
      })()`);
      if (probe && probe.inputs > 0) break;
      if (probe && probe.uploadTab && !tabClicked) {
        await clickExpr(`([...document.querySelectorAll('li.omui-tab__label, .omui-tab__label')]
          .find((n) => /本地上传|上传/.test((n.innerText || '').trim())) || null)`);
        tabClicked = true;
      }
    }
  }
  const afterOpen = await evaluate(tabId, `(() => {
    const inputs = [...document.querySelectorAll('input[type="file"]')]
      .filter((n) => !n.disabled && /image/i.test(n.accept || 'image/'));
    const tabs = [...document.querySelectorAll('li.omui-tab__label, .omui-tab__label')]
      .map((n) => (n.innerText || '').trim());
    return {inputs: inputs.length, tabs,
            trigger: !!document.querySelector('.omui-upload-image-trigger')};
  })()`);
  if (!afterOpen || afterOpen.inputs === 0) {
    return {status: 'manual_required',
            reason: '点击「添加封面」后仍未出现图片上传输入框'
              + '（层内 input ' + (afterOpen ? afterOpen.inputs : '?')
              + '，标签 ' + JSON.stringify((afterOpen && afterOpen.tabs) || [])
              + '，trigger ' + (afterOpen && afterOpen.trigger) + '）'};
  }

  // 3) 注入封面文件
  const injected = await evaluate(tabId, `(() => {
    const inputs = [...document.querySelectorAll('input[type="file"]')]
      .filter((n) => !n.disabled && /image/i.test(n.accept || 'image/'));
    const input = inputs[0];
    if (!input) return {ok: false, reason: '图片 input 消失'};
    const match = ${JSON.stringify(encoded)}.match(/^data:([^;]+);base64,(.*)$/);
    if (!match) return {ok: false, reason: '封面数据解码失败'};
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const file = new File([bytes], ${JSON.stringify(filename)}, {type: ${JSON.stringify(mime)} || match[1]});
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('input', {bubbles: true}));
    input.dispatchEvent(new Event('change', {bubbles: true}));
    return {ok: true};
  })()`);
  if (!injected || !injected.ok) {
    return {status: 'manual_required',
            reason: '企鹅号封面注入失败：' + ((injected && injected.reason) || 'unknown')};
  }

  // 4) 等层内出现缩略图 → 选中 → 点确定/确认
  let picked = false;
  let confirmed = false;
  for (let i = 0; i < 60; i++) {
    await sleep(400);
    const snapshot = await state();
    const thumbs = await evaluate(tabId, `(() => {
      const inputs = [...document.querySelectorAll('input[type="file"]')];
      const scope = inputs.length ? inputs[0].closest('div[class]') : null;
      const root = scope ? (scope.parentElement || scope) : document.body;
      return [...root.querySelectorAll('img')].filter((n) => n.offsetParent && n.width > 40).length;
    })()`);
    if (!picked && thumbs > 0) {
      await clickExpr(`(() => {
        const inputs = [...document.querySelectorAll('input[type="file"]')];
        const scope = inputs.length ? inputs[0].closest('div[class]') : null;
        const root = scope ? (scope.parentElement || scope) : document.body;
        return [...root.querySelectorAll('img')].filter((n) => n.offsetParent && n.width > 40)[0] || null;
      })()`);
      picked = true;
      await sleep(500);
      continue;
    }
    if (snapshot.confirmVisible) {
      await clickExpr(`([...document.querySelectorAll('button,span,div')]
        .find((n) => n.offsetParent && /^(确定|确认|完成|使用图片|使用)$/.test((n.innerText || '').trim())) || null)`);
      confirmed = true;
      await sleep(1000);
      break;
    }
    if (snapshot.coverImgs > 0 && !picked) break;
  }

  const final = await state();
  if (final && final.coverImgs > 0) {
    return {status: 'preview_changed_needs_review',
            reason: '企鹅号封面已填入封面区，请核对裁剪与最终状态',
            coverMode: final.singleChecked ? '单图' : '非单图',
            coverImages: final.coverImgs,
            pickedThumbnail: picked,
            pressedConfirm: confirmed};
  }
  return {status: 'manual_required',
          reason: '已注入封面文件，但封面区仍未出现图片（选图 ' + picked + '，确认 ' + confirmed + '）'};
}

function matrixCoverSetInPage(encoded, filename, mime, expectedBytes) {
  const marker = /cover|thumbnail|thumb|poster|封面|头图|缩略图/i;
  const disallow = /avatar|头像|视频|video|正文|content|logo/i;
  const shortAttributes = (el) => [
    el.id, typeof el.className === 'string' ? el.className : '',
    el.getAttribute('name'), el.getAttribute('aria-label'),
    el.getAttribute('data-testid'), el.getAttribute('title'),
  ].filter(Boolean).join(' ');
  const scopesFor = (el) => {
    const scopes = [];
    let node = el;
    for (let depth = 0; node && depth <= 4; depth++, node = node.parentElement) {
      const label = shortAttributes(node);
      if (marker.test(label) && !disallow.test(label)) scopes.push(node);
    }
    if (el.id) {
      for (const label of document.querySelectorAll('label[for]')) {
        if (label.htmlFor === el.id && marker.test(label.textContent + ' ' + shortAttributes(label))
            && !disallow.test(label.textContent + ' ' + shortAttributes(label)))
          scopes.push(label.parentElement || label);
      }
    }
    return scopes;
  };
  const imageInput = (el) => el.tagName === 'INPUT' && el.type === 'file'
    && !el.disabled && (!el.accept || /image\/|\.jpe?g|\.png|\.gif|\.webp|\.bmp/i.test(el.accept));
  const inputs = [...document.querySelectorAll('input[type="file"]')]
    .filter(imageInput).map((input) => ({input, scopes: scopesFor(input)}))
    .filter((entry) => entry.scopes.length);
  if (inputs.length !== 1) return Promise.resolve({
    status: 'manual_required',
    reason: inputs.length ? '检测到多个疑似封面上传控件，无法安全确定目标'
      : '未找到明确归属于封面区域的图片上传控件',
    detectedCoverInputs: inputs.length,
  });
  const {input, scopes} = inputs[0];
  // Prefer a named cover element rather than scanning body-wide article images.
  const scope = scopes.find((s) => s !== input) || input.parentElement;
  // The preview must live in a *named* cover area. An input named "cover"
  // inside a broad form is insufficient: unrelated body images could change.
  if (!scope || scope === document.body || scope === document.documentElement
      || !marker.test(shortAttributes(scope)) || disallow.test(shortAttributes(scope)))
    return Promise.resolve({status:'manual_required',reason:'封面预览区域不明确，拒绝将正文图片变化误判为封面成功'});

  const previews = () => {
    const urls = [...scope.querySelectorAll('img')].map((img) => img.currentSrc || img.src)
      .filter((url) => typeof url === 'string' && url.length);
    for (const el of [scope, ...scope.querySelectorAll('[style]')]) {
      const value = getComputedStyle(el).backgroundImage;
      if (value && value !== 'none' && value.includes('url(')) urls.push(value);
    }
    return urls;
  };
  const before = JSON.stringify(previews());
  const base64 = encoded.slice(encoded.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (bytes.length !== expectedBytes) throw new Error('封面文件大小与已核验准备包不一致，拒绝填入');
  const file = new File([bytes], filename, {type:mime});
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  if (input.files.length !== 1 || input.files[0].name !== filename
      || input.files[0].size !== expectedBytes)
    throw new Error('目标平台封面输入控件未接收指定文件');
  input.dispatchEvent(new Event('input', {bubbles:true}));
  input.dispatchEvent(new Event('change', {bubbles:true}));
  const deadline = Date.now() + 8000;
  return (async () => {
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      const after = previews();
      if (after.length && JSON.stringify(after) !== before)
        return {status:'preview_changed_needs_review',
          reason:'目标封面控件接收了指定文件，封面区域图片预览已变化；仍须人工检查裁剪和最终平台状态',
          coverFile:filename};
    }
    return {status:'manual_required',
      reason:'封面上传控件已接收文件，但未验证到封面区域的预览更新；可能需要平台原生裁剪或手动确认',
      detectedCoverInputs:1};
  })();
}

function matrixCoverInspectInPage() {
  // Read-only diagnostics: no filenames, URLs, article bodies or private inputs.
  const marker = /cover|thumbnail|thumb|poster|封面|头图|缩略图/i;
  const attr = (el) => ({
    tag:el.tagName.toLowerCase(), id:el.id || null,
    className:typeof el.className === 'string' ? el.className.slice(0,100) : '',
    name:el.getAttribute('name'), accept:el.getAttribute('accept'),
    type:el.getAttribute('type'), ariaLabel:el.getAttribute('aria-label'),
  });
  const coverFileInputs = [...document.querySelectorAll('input[type="file"]')].map((el) => {
    let p = el, contexts = [];
    for (let depth=0; p && depth<=4; depth++,p=p.parentElement) {
      const s = [p.id,typeof p.className==='string'?p.className:'',p.getAttribute('aria-label')].join(' ');
      if(marker.test(s)) contexts.push({depth, ...attr(p)});
    }
    return {input:attr(el),contexts};
  }).slice(0,35);
  const coverControls = [...document.querySelectorAll('button,[role="button"],label,div,span,p,h3')]
    .filter((el) => {
      const text = (el.textContent || '').trim();
      return text.length <= 60 && (marker.test(text + ' ' + el.id + ' ' + el.className)
        || text === '上传图片') && !el.closest('[contenteditable="true"]')
        && ![...el.children].some(child => child.textContent.trim() === text);
    })
    .slice(0,35).map((el)=>{
      const ancestors = [];
      for (let p=el.parentElement, n=0; p && n<4; p=p.parentElement,n++) ancestors.push(attr(p));
      return {...attr(el),text:(el.textContent||'').trim().slice(0,60),ancestors};
    });
  const coverDialogs=[...document.querySelectorAll('.select-dialog .el-dialog')].map(dialog=>({
    ...attr(dialog),visible:!!dialog.getClientRects().length,
    controls:[...dialog.querySelectorAll('button,a,[role="tab"],li,span,div,p,h3')]
      .filter(el=>['正文图片','本地上传','素材库','确定','取消','上传图片'].includes(el.textContent.trim())
        && ![...el.children].some(child=>child.textContent.trim()===el.textContent.trim()))
      .slice(0,30).map(el=>({...attr(el),text:el.textContent.trim(),
        visible:!!el.getClientRects().length,parent:el.parentElement ? attr(el.parentElement) : null})),
  }));
  return {coverFileInputs,coverControls,coverDialogs};
}

// Kept as a remote object for this attempt: a rerender must not redirect the
// preview check to an unrelated article image or a different upload tile.
function sohuCoverTargetInPage() {
  if (location.hostname !== 'mp.sohu.com') throw new Error('当前页面不是搜狐号');
  const visible = el => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden';
  // The live Sohu title contains a .cover-text tooltip. Its textContent also
  // contains that hidden explanation; match only the title's own text nodes.
  // .cover-title is reused for "话题", so its class alone is insufficient.
  const labels = [...document.querySelectorAll('.option-item > .cover-title')].filter(el =>
      visible(el) && !el.closest('[contenteditable="true"]')
      && [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE)
        .map(node => node.textContent).join('').trim() === '封面');
  const targets = [];
  for (const label of labels) {
    for (const scope of label.parentElement.querySelectorAll(':scope > .cover-button')) {
      const triggers = [...scope.querySelectorAll(':scope > .upload-file.mp-upload .upload-tip')]
        .filter(el=>visible(el) && el.textContent.trim()==='上传图片');
      if (triggers.length===1) targets.push({scope,trigger:triggers[0]});
    }
  }
  if (targets.length !== 1) throw new Error('无法唯一定位搜狐号“封面 → 上传图片”区域，请重新导出检查报告');
  const target = targets[0];
  // The select dialog may be nested inside the cover component. Its uploaded
  // thumbnails are not proof that the article's actual cover has been set.
  const outsideDialog = el=>!el.closest('.select-dialog,.el-dialog,[role="dialog"]');
  target.previews = () => [...target.scope.querySelectorAll('img')]
    .filter(img => outsideDialog(img) && img.complete && img.naturalWidth > 0).map(img => img.currentSrc || img.src)
    .concat([target.scope,...target.scope.querySelectorAll('*')]
      .filter(outsideDialog)
      .map(el => getComputedStyle(el).backgroundImage).filter(value => value && value !== 'none'));
  target.before = JSON.stringify(target.previews());
  return target;
}

async function sohuCoverDialogInputInPage() {
  const visible=el=>el.getClientRects().length && getComputedStyle(el).visibility!=='hidden';
  const sleep=()=>new Promise(resolve=>setTimeout(resolve,100));
  const dialogs=()=>[...document.querySelectorAll('.select-dialog .el-dialog')]
    .filter(el=>visible(el) && /封面图片尺寸/.test(el.querySelector('.cover-tip')?.textContent || ''));
  let found=dialogs();
  if (!found.length) {
    this.trigger.click();
    const deadline=Date.now()+5000;
    while (!(found=dialogs()).length && Date.now()<deadline) await sleep();
  }
  if (found.length!==1) throw new Error('未找到唯一的搜狐号封面选图弹窗');
  const dialog=found[0];
  const areas=()=>[...dialog.querySelectorAll('.upload-area')].filter(visible);
  if (!areas().length) {
    // Confirmed live node: <h3 ...>本地上传</h3>.
    const tabs=[...dialog.querySelectorAll('h3,[role="tab"]')]
      .filter(el=>visible(el) && el.textContent.trim()==='本地上传');
    if (tabs.length!==1) throw new Error('无法唯一定位封面弹窗的“本地上传”选项卡');
    tabs[0].click();
  }
  const deadline=Date.now()+5000;
  while (Date.now()<deadline) {
    const local=areas();
    if (local.length===1) {
      const inputs=[...local[0].querySelectorAll('input#new-file[type="file"]')].filter(el=>!el.disabled);
      if (inputs.length===1) {
        this.uploadArea=local[0];
        this.uploadBefore=[...local[0].querySelectorAll('img')].map(img=>img.currentSrc || img.src);
        return inputs[0];
      }
    }
    await sleep();
  }
  throw new Error('已打开本地上传，但未找到唯一的 new-file 封面控件');
}

async function sohuCoverProofInPage() {
  const visible=el=>el.getClientRects().length && getComputedStyle(el).visibility!=='hidden';
  const deadline=Date.now()+15000;
  let confirmed=false;
  while (Date.now()<deadline) {
    await new Promise(resolve=>setTimeout(resolve,250));
    if (!this.scope.isConnected) break;
    const after=this.previews();
    if (after.length && JSON.stringify(after)!==this.before) return true;
    // Only confirm a selected, newly uploaded image in the local-upload board.
    // Never click the pagination's "确定", another modal, or a publish button.
    if (confirmed || !this.uploadArea?.isConnected || !visible(this.uploadArea)) continue;
    const currentDialog=this.uploadArea.closest('.el-dialog');
    if ([...document.querySelectorAll('.el-dialog,[role="dialog"]')]
      .some(el=>el!==currentDialog && visible(el))) continue;
    const images=[...this.uploadArea.querySelectorAll('img')].filter(img=>visible(img)
      && img.complete && img.naturalWidth>0 && !this.uploadBefore.includes(img.currentSrc || img.src));
    const board=this.uploadArea.closest('.board');
    if (images.length!==1 || !board
        || ![...board.querySelectorAll('.success-number')].some(el=>visible(el)
          && /已选择\s*1\s*张/.test(el.textContent))) continue;
    // The actual confirmation is a styled <p>, in the dialog footer, which
    // need not be inside the local-upload .board.
    const buttons=[...currentDialog.querySelectorAll('p.button.positive-button,button,a,[role="button"]')].filter(el=>visible(el)
      && el.textContent.trim()==='确定' && !el.disabled
      && !el.closest('.pagination-wrapper,.el-pagination,[aria-disabled="true"],.is-disabled'));
    if (buttons.length===1) { confirmed=true; buttons[0].click(); }
  }
  return false;
}

function coverFileToInputInPage(encoded, filename, mime, size) {
  if (this.tagName !== 'INPUT' || this.type !== 'file' || this.disabled)
    throw new Error('搜狐号选择器未提供有效文件上传控件');
  const accepted = this.accept.toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
  if (accepted.length && !accepted.some(s => s === 'image/*' || s === mime
      || s === '.' + filename.split('.').pop().toLowerCase()))
    throw new Error('搜狐号上传控件不接受当前封面格式');
  const bytes = Uint8Array.from(atob(encoded.slice(encoded.indexOf(',')+1)),c=>c.charCodeAt(0));
  if (bytes.length !== size) throw new Error('封面传输字节数不一致');
  const transfer = new DataTransfer();
  transfer.items.add(new File([bytes],filename,{type:mime}));
  this.files = transfer.files;
  if (this.files.length !== 1 || this.files[0].size !== size || this.files[0].name !== filename)
    throw new Error('搜狐号文件控件未接收封面');
  this.dispatchEvent(new Event('input',{bubbles:true}));
  this.dispatchEvent(new Event('change',{bubbles:true}));
  return true;
}

async function sohuCoverUploadFile(file) {
  if (!/\.(webp|bmp)$/i.test(file.name)) return file;
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  try { canvas.getContext('2d').drawImage(bitmap,0,0); }
  finally { bitmap.close(); }
  const png = await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if (!png) throw new Error('封面转 PNG 失败');
  return new File([png],file.name.replace(/\.[^.]+$/,'.png'),{type:'image/png'});
}

async function setSohuCover(tabId, encoded, filename, mime, size) {
  const group = 'draft-helper-sohu-cover';
  const send = async (method, params={}) => {
    const response = await chrome.debugger.sendCommand({tabId},method,params);
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description
      || response.exceptionDetails.text || '搜狐号封面脚本执行失败');
    return response;
  };
  try {
    const target = await send('Runtime.evaluate',{
      expression:'(' + sohuCoverTargetInPage.toString() + ')()',objectGroup:group,
    });
    const objectId = target.result.objectId;
    const input = await send('Runtime.callFunctionOn',{objectId,userGesture:true,awaitPromise:true,
      functionDeclaration:sohuCoverDialogInputInPage.toString(),objectGroup:group});
    await send('Runtime.callFunctionOn',{objectId:input.result.objectId,
      functionDeclaration:coverFileToInputInPage.toString(),
      arguments:[encoded,filename,mime,size].map(value=>({value})),returnByValue:true});
    const proof = await send('Runtime.callFunctionOn',{objectId,awaitPromise:true,returnByValue:true,
      functionDeclaration:sohuCoverProofInPage.toString()});
    return proof.result.value ? {status:'preview_changed_needs_review',coverFile:filename}
      : {status:'manual_required',reason:'封面已送入搜狐号文件控件，但未核实主页面封面预览更新；请完成弹出的裁剪确认后检查封面'};
  } finally {
    await send('Runtime.releaseObjectGroup',{objectGroup:group}).catch(()=>{});
  }
}

async function attemptMatrixCover(tabId, bundle, platform, onProgress = status) {
  const key = ({
    '一点资讯':'yidian','yidian':'yidian',
    '今日头条':'toutiao','toutiao':'toutiao',
    '企鹅号':'penguin','penguin':'penguin',
    '搜狐号':'sohu','sohu':'sohu'
  })[platform];
  const cover = key ? bundle.manifest.platformCovers?.[key] : bundle.manifest.coverImage;
  if (!cover) throw new Error('当前平台没有按标题主推节目核验的封面，请重新生成准备包。');
  let file = bundle.assets.get('assets/' + cover.bundleFile);
  if (!file) throw new Error('已核验矩阵封面文件在准备包中缺失：' + cover.bundleFile);
  const sohu = platform === '搜狐号' || platform === 'sohu';
  if (sohu) file = await sohuCoverUploadFile(file);
  const mime = file.type || ({
    jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',
    webp:'image/webp',bmp:'image/bmp',
  }[file.name.split('.').pop().toLowerCase()]);
  if (!mime?.startsWith('image/')) throw new Error('不支持的封面图片类型：' + file.name);
  const encoded = await readFileAsDataUrl(file);
  onProgress('正文和标题已填入；尝试设置 ' + platform + ' 文章独立封面…');
  await attachDebugger(tabId);
  let result;
  try {
    await chrome.debugger.sendCommand({tabId}, 'Runtime.enable');
    const toutiao = platform === '今日头条' || platform === 'toutiao';
    const penguin = platform === '企鹅号' || platform === 'penguin';
    if (penguin) {
      result = await setPenguinCover(tabId, encoded, file.name, mime, file.size);
      if (result?.status === 'preview_changed_needs_review') {
        onProgress('企鹅号封面已自动填入，请核对裁剪并手动保存草稿（未自动保存）。');
      } else {
        onProgress('企鹅号封面未能自动填入：' + (result?.reason || '未取得结果')
          + '。请手动设置封面后保存草稿。');
      }
      return result;
    }
    const setter = sohu ? null : (toutiao ? toutiaoCoverSetInPage : matrixCoverSetInPage);
    if (toutiao) {
      result = await setToutiaoCover(tabId, encoded, file.name, mime, file.size);
      if (result?.status === 'preview_changed_needs_review') {
        onProgress('今日头条封面已按单图模式自动填入（真实点击），请核对裁剪并手动保存草稿（未自动保存）。');
      } else {
        onProgress('今日头条封面未能自动填入：' + (result?.reason || '未取得结果')
          + '。请手动设置封面后保存草稿。');
      }
      return result;
    }
    result = sohu ? await setSohuCover(tabId,encoded,file.name,mime,file.size)
      : await evaluate(tabId, '(' + setter.toString() + ')('
        + [encoded, file.name, mime, file.size].slice(0, setter.length >= 4 ? 4 : 3)
          .map(JSON.stringify).join(',') + ')');
  } catch(error) {
    result = {status:'manual_required',reason:'封面设置未能回读：' + String(error.message || error).slice(0,180)};
  } finally {
    await chrome.debugger.detach({tabId}).catch(()=>{});
  }
  if (result?.status === 'preview_changed_needs_review') {
    onProgress(platform + '标题、正文及配图已填入；封面文件已送入指定封面控件且预览发生变化。请检查裁剪、封面最终状态并手动保存草稿（未自动保存）。');
  } else {
    onProgress(platform + '标题、正文及配图已填入。当前平台主推节目封面已随包校验，但本页尚未自动验证封面设置：'
      + (result?.reason || '未取得封面回读') + '。请手动设置封面后保存草稿；可点击“检查当前编辑页”导出封面控件信息。');
  }
  return result;
}

if (typeof module !== 'undefined') module.exports = {matrixCoverSetInPage,toutiaoCoverSetInPage,setToutiaoCover,setPenguinCover,matrixCoverInspectInPage,
  attemptMatrixCover,sohuCoverTargetInPage,coverFileToInputInPage,sohuCoverUploadFile,setSohuCover};
