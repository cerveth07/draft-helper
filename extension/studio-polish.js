'use strict';

// Workbench conveniences layered on top of studio.js. Everything here only reads
// or forwards to existing controls (ids, inputs and buttons); it never touches
// the article state directly, so sealed packages and undo history are unchanged.
(() => {
  const q = id => document.getElementById(id);
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  };

  /* ---------- 本机保存状态：颜色指示 + 关闭页面前提醒 ---------- */
  const saveState = q('save-state');
  const classifySave = () => {
    const text = saveState.textContent || '';
    saveState.dataset.state = /正在保存/.test(text) ? 'saving' : /失败|不可用/.test(text) ? 'error' : /已保存|已恢复/.test(text) ? 'saved' : 'idle';
  };
  new MutationObserver(classifySave).observe(saveState, {childList: true, characterData: true, subtree: true});
  classifySave();
  window.addEventListener('beforeunload', event => {
    // The workbench autosaves after 300 ms; closing during that window or during a
    // fill/export would lose the latest edit or leave a half-finished target page.
    if (saveState.dataset.state === 'saving' || document.body.classList.contains('busy')) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  /* ---------- 快捷键：Ctrl+S 不再弹出浏览器“另存为” ---------- */
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveState.classList.remove('flash');
      void saveState.offsetWidth;
      saveState.classList.add('flash');
      setTimeout(() => saveState.classList.remove('flash'), 900);
    }
  });

  /* ---------- 提示条：点击关闭，错误类信息使用警示色 ---------- */
  const toast = q('toast');
  toast.title = '点击关闭';
  toast.addEventListener('click', () => { toast.hidden = true; });

  /* ---------- 字数计数 ---------- */
  const summaryCount = q('summary-count');
  const markSummary = () => {
    const used = Number((summaryCount.textContent.match(/^(\d+)/) || [])[1] || 0);
    summaryCount.classList.toggle('over', used > 120);
  };
  new MutationObserver(markSummary).observe(summaryCount, {childList: true, characterData: true, subtree: true});
  q('article-summary').addEventListener('input', () => {
    summaryCount.textContent = [...q('article-summary').value].length + ' / 120 字';
  });
  const title = q('article-title'), titleCount = q('title-count');
  const markTitle = () => {
    if (!titleCount) return;
    const used = [...title.value].length;
    titleCount.textContent = used ? used + ' / 64' : '';
    titleCount.classList.toggle('over', used > 64);
    titleCount.title = used > 64 ? '微信标题上限 64 字，填入前请缩短' : '';
  };
  title.addEventListener('input', markTitle);
  // studio.js writes the value on render; poll cheaply on focus changes as well.
  new MutationObserver(markTitle).observe(q('preview-title'), {childList: true, characterData: true, subtree: true});
  markTitle();

  /* ---------- 预览宽度：记住上次选择 ---------- */
  const width = q('preview-width');
  const savedWidth = store.get('draft-helper-preview-width');
  if (savedWidth && [...width.options].some(option => option.value === savedWidth) && savedWidth !== width.value) {
    width.value = savedWidth;
    width.dispatchEvent(new Event('change'));
  }
  width.addEventListener('change', () => store.set('draft-helper-preview-width', width.value));

  /* ---------- 桌面侧栏宽度 ---------- */
  const workspace = document.querySelector('.workspace');
  const handles = {left: q('left-panel-resize'), right: q('right-panel-resize')};
  const sides = Object.keys(handles);
  const minimum = {left: 220, right: 228};
  const preferenceKey = side => 'draft-helper-panel-' + side + '-width';
  const preferred = Object.fromEntries(sides.map(side => {
    const saved = Number(store.get(preferenceKey(side)));
    return [side, Number.isFinite(saved) ? saved : 0];
  }));
  const widths = {};
  let available = 0;
  let drag = null;
  const maximum = side => available - widths[side === 'left' ? 'right' : 'left'];

  function showPanelWidths() {
    for (const side of sides) {
      const handle = handles[side];
      workspace.style.setProperty('--' + side + '-panel-width', widths[side] + 'px');
      handle.setAttribute('aria-valuemin', minimum[side]);
      handle.setAttribute('aria-valuemax', maximum(side));
      handle.setAttribute('aria-valuenow', widths[side]);
      handle.setAttribute('aria-valuetext', widths[side] + ' 像素');
    }
  }

  function fitPanels() {
    if (!handles.left.offsetWidth) return;
    const style = getComputedStyle(workspace);
    const widthOf = name => parseFloat(style.getPropertyValue(name));
    const minimumTotal = minimum.left + minimum.right;
    available = Math.max(minimumTotal, workspace.clientWidth - widthOf('--canvas-min-width') - 2 * widthOf('--panel-divider-width'));
    const left = Math.max(minimum.left, preferred.left || widthOf('--left-panel-default'));
    const right = Math.max(minimum.right, preferred.right || widthOf('--right-panel-default'));
    const wantedExtra = left + right - minimumTotal;
    const scale = wantedExtra > available - minimumTotal ? (available - minimumTotal) / wantedExtra : 1;
    widths.left = Math.round(minimum.left + (left - minimum.left) * scale);
    widths.right = Math.min(available - widths.left, Math.round(minimum.right + (right - minimum.right) * scale));
    showPanelWidths();
  }

  function resizePanel(side, next) {
    widths[side] = Math.max(minimum[side], Math.min(maximum(side), Math.round(next)));
    showPanelWidths();
  }

  function rememberPanelWidths() {
    for (const side of sides) {
      preferred[side] = widths[side];
      store.set(preferenceKey(side), widths[side]);
    }
  }

  for (const side of sides) {
    const handle = handles[side], direction = side === 'left' ? 1 : -1;
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || drag) return;
      handle.setPointerCapture(event.pointerId);
      handle.focus({preventScroll: true});
      drag = {side, pointerId: event.pointerId, x: event.clientX, width: widths[side]};
      workspace.dataset.resizing = side;
      event.preventDefault();
    });
    handle.addEventListener('pointermove', event => {
      if (drag?.side === side && drag.pointerId === event.pointerId) {
        resizePanel(side, drag.width + (event.clientX - drag.x) * direction);
      }
    });
    handle.addEventListener('lostpointercapture', event => {
      if (drag?.side !== side || drag.pointerId !== event.pointerId) return;
      if (drag.width !== widths[side]) rememberPanelWidths();
      delete workspace.dataset.resizing;
      drag = null;
    });
    handle.addEventListener('keydown', event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const steps = {ArrowLeft: -1, ArrowRight: 1};
      const step = steps[event.key];
      if (!step && event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      resizePanel(side, step ? widths[side] + 12 * step * direction : event.key === 'Home' ? minimum[side] : maximum(side));
      rememberPanelWidths();
    });
  }
  window.addEventListener('resize', fitPanels);
  fitPanels();

  for (const menu of document.querySelectorAll('.action-menu')) {
    const toggle = menu.querySelector('summary');
    const close = () => {
      menu.open = false;
      if (menu.contains(document.activeElement)) toggle.focus();
    };
    menu.addEventListener('click', event => {
      if (event.target.closest('button')) close();
    });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape' && menu.open) {
        event.preventDefault();
        close();
      }
    });
    document.addEventListener('pointerdown', event => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
  }

  /* ---------- 拖到窗口任意位置导入 ---------- */
  // While a file is dragged over the window, a full-size overlay takes the drop
  // (including over the preview iframe) and forwards it to the drop zone's own
  // handler, so file-type checks and the replace confirmation stay in one place.
  const overlay = q('window-drop');
  const hasFiles = event => [...(event.dataTransfer?.types || [])].includes('Files');
  if (overlay) {
    window.addEventListener('dragenter', event => {
      if (hasFiles(event) && !document.querySelector('dialog[open]') && !document.body.classList.contains('busy')) overlay.hidden = false;
    });
    overlay.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
    overlay.addEventListener('dragleave', event => { if (!event.relatedTarget || !overlay.contains(event.relatedTarget)) overlay.hidden = true; });
    overlay.addEventListener('drop', event => {
      event.preventDefault();
      overlay.hidden = true;
      const files = [...(event.dataTransfer?.files || [])];
      if (!files.length) return;
      const transfer = new DataTransfer();
      for (const file of files) transfer.items.add(file);
      q('drop-zone').dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer: transfer}));
    });
    window.addEventListener('dragend', () => { overlay.hidden = true; });
  }

  /* ---------- 右栏分区导航 ---------- */
  const nav = document.querySelector('.panel-nav'), panel = document.querySelector('.right-panel');
  if (nav && panel) {
    const buttons = [...nav.querySelectorAll('[data-jump]')];
    const targets = buttons.map(button => q(button.dataset.jump));
    const mark = id => { for (const button of buttons) button.setAttribute('aria-current', String(button.dataset.jump === id)); };
    // Position inside the scrolling panel, independent of offsetParent.
    const topOf = target => target.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
    const smooth = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollable = () => panel.scrollHeight > panel.clientHeight + 4;
    const stacked = matchMedia('(max-width: 880px)');
    for (const button of buttons) button.addEventListener('click', () => {
      const target = q(button.dataset.jump);
      if (!target) return;
      const behavior = smooth() ? 'smooth' : 'auto';
      if (stacked.matches) target.scrollIntoView({block: 'start', behavior});
      else panel.scrollTo({top: Math.max(0, topOf(target) - nav.offsetHeight), behavior});
      mark(target.id);
    });
    const sync = () => {
      if (!scrollable()) return;
      const line = panel.scrollTop + nav.offsetHeight + 26;
      let current = targets[0]?.id;
      for (const target of targets) if (target && topOf(target) <= line) current = target.id;
      if (panel.scrollTop > 4 && panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 4) current = targets.at(-1)?.id || current;
      mark(current);
    };
    panel.addEventListener('scroll', () => requestAnimationFrame(sync), {passive: true});
    mark(targets[0]?.id);
    sync();
  }
})();
