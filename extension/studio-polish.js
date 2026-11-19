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

  /* ---------- 空状态快捷入口 ---------- */
  const showImport = () => { if (q('left-import-panels').hidden) q('author-import-open').click(); };
  q('empty-open-link')?.addEventListener('click', () => {
    showImport();
    const input = q('wechat-source-url');
    input.scrollIntoView({block: 'center', behavior: 'smooth'});
    input.focus();
  });
  q('empty-open-file')?.addEventListener('click', () => q('source-file').click());
  q('empty-paste')?.addEventListener('click', () => q('paste-open').click());

  q('notice-adjust')?.addEventListener('click', () => q('mode-adjust').click());

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
    for (const button of buttons) button.addEventListener('click', () => {
      const target = q(button.dataset.jump);
      if (!target) return;
      panel.scrollTo({top: Math.max(0, topOf(target) - nav.offsetHeight - 8), behavior: smooth() ? 'smooth' : 'auto'});
      mark(button.dataset.jump);
    });
    const sync = () => {
      const line = panel.scrollTop + nav.offsetHeight + 40;
      let current = targets[0]?.id;
      for (const target of targets) if (target && topOf(target) <= line) current = target.id;
      if (panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 4) current = targets.at(-1)?.id || current;
      mark(current);
    };
    panel.addEventListener('scroll', () => requestAnimationFrame(sync), {passive: true});
    sync();
  }
})();
