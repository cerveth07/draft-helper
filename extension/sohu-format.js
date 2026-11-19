/* Deterministic Sohu draft formatting, shared by package generation and verification. */
'use strict';
const DraftSohuFormat = (() => {
  const VERSION = 'sohu-readable-v2';
  const layout = () => typeof DraftLayout !== 'undefined' ? DraftLayout : require('./layout-core.js');
  const blocks = new Set('p div section article header footer h1 h2 h3 h4 h5 h6 blockquote li figcaption pre tr td th'.split(' '));
  const decode = value => value.replace(/&(?:quot|apos|amp|lt|gt|nbsp);|&#(?:x[0-9a-f]+|\d+);/gi, token => {
    const named = {'&quot;':'"', '&apos;':"'", '&amp;':'&', '&lt;':'<', '&gt;':'>', '&nbsp;':'\u00a0'};
    if (named[token.toLowerCase()]) return named[token.toLowerCase()];
    const number = token.slice(2, -1);
    const code = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : token;
  });
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
  const norm = value => decode(value.replace(/<[^>]*>/g, '')).replace(/[\s\u200b-\u200f\u2060\ufeff]/g, '');
  function attributes(raw) {
    const result = {};
    for (const match of raw.matchAll(/\s([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))
      result[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? '');
    return result;
  }
  function pixels(value, inherited) {
    const match = /^([\d.]+)(px|em|rem|%)?$/.exec(value || '');
    if (!match) return inherited;
    const amount = Number(match[1]);
    return match[2] === 'em' ? amount * inherited : match[2] === 'rem' ? amount * 16 : match[2] === '%' ? amount * inherited / 100 : amount;
  }
  function stateFor(node, parent, html) {
    const attrs = attributes(html.slice(node.start, node.openEnd));
    const style = Object.fromEntries((attrs.style || '').split(';').map(rule => {
      const at = rule.indexOf(':');
      return at < 0 ? [] : [rule.slice(0, at).trim().toLowerCase(), rule.slice(at + 1).trim().replace(/\s*!important$/i, '')];
    }).filter(entry => entry.length));
    const weight = style['font-weight'];
    return {...parent, attrs,
      font: pixels(style['font-size'], parent.font),
      color: (style.color || attrs.color || parent.color).replace(/\s+/g, '').toLowerCase(),
      bold: weight ? /bold|[6-9]00/.test(weight) : /^(strong|b|h[1-6]|th)$/.test(node.tag) || parent.bold,
      italic: style['font-style'] ? /italic|oblique/.test(style['font-style']) : /^(em|i)$/.test(node.tag) || parent.italic,
      underline: /underline/.test(style['text-decoration'] || '') || node.tag === 'u' || parent.underline,
      strike: /line-through/.test(style['text-decoration'] || '') || /^(s|del|strike)$/.test(node.tag) || parent.strike,
      align: style['text-align'] || attrs.align || parent.align,
      indent: style['text-indent'] === undefined ? parent.indent : pixels(style['text-indent'], pixels(style['font-size'], parent.font)),
    };
  }
  function isAccent(color, base) {
    if (!color || color === base || /^(inherit|initial|currentcolor|transparent|black|white|grey|gray)$/.test(color)) return false;
    if (/^#([0-9a-f])\1\1(?:\1\1\1)?$/.test(color)) return false;
    const rgb = /^rgba?\((\d+),(\d+),(\d+)(?:,[\d.]+)?\)$/.exec(color);
    return !rgb || Math.max(...rgb.slice(1, 4).map(Number)) - Math.min(...rgb.slice(1, 4).map(Number)) > 12;
  }
  function prepare(html, {legacyHeadings=false}={}) {
    if (typeof html !== 'string') throw Error('搜狐排版来源必须为 HTML。');
    const tree = layout().parse(html);
    const initial = {font:16, color:'#333', bold:false, italic:false, underline:false, strike:false, align:'left', indent:0};
    const states = new Map([[tree.root, initial]]), colors = new Map();
    for (const node of tree.nodes) states.set(node, stateFor(node, states.get(node.parent), html));
    function gaps(node) {
      const result = []; let cursor = node.openEnd ?? 0;
      for (const child of node.children) {result.push([html.slice(cursor, child.start), states.get(node)]); cursor = child.end;}
      result.push([html.slice(cursor, node.tag === 'root' ? html.length : html.lastIndexOf('</', node.end - 1)), states.get(node)]);
      return result;
    }
    for (const node of [tree.root, ...tree.nodes]) {
      if (/^(img|br|hr|wbr)$/.test(node.tag)) continue;
      for (const [text, state] of gaps(node)) colors.set(state.color, (colors.get(state.color) || 0) + norm(text).length);
    }
    const baseColor = [...colors].sort((a, b) => b[1] - a[1])[0]?.[0] || '#333';
    const changes = [], counts = {paragraphs:0, headings:0, emphasis:0, images:0, indents:0, alignments:0, colorReplacements:0};
    const note = (kind, text, detail) => changes.push({kind, text:norm(text).slice(0, 55), detail});
    function textPart(raw, state) {
      if (!raw || /^\s*[\r\n\t]+\s*$/.test(raw)) return [];
      raw = raw.replace(/<!--[\s\S]*?-->/g, '');
      if (!raw) return [];
      const accent = isAccent(state.color, baseColor) && !!norm(raw);
      let value = raw;
      if (state.strike) value = '<s>' + value + '</s>';
      if (state.underline) value = '<u>' + value + '</u>';
      if (state.italic) value = '<em>' + value + '</em>';
      if (state.bold || accent) value = '<strong>' + value + '</strong>';
      if (accent) {counts.colorReplacements++; note('replace', raw, '彩色强调改为加粗，使用平台默认文字色');}
      if (state.bold || state.italic || state.underline || state.strike) counts.emphasis++;
      return [{html:value, block:false,font:state.font}];
    }
    function wrap(parts, state, requested = 'p') {
      const output = []; let inline = '',fonts=[];
      const flush = () => {
        if (!inline) return;
        if (!norm(inline) && !/<br\b/.test(inline)) {inline = ''; return;}
        const large=legacyHeadings?state.font>=22:fonts.length&&fonts.every(font=>font>=22);
        const heading = /^h[1-6]$/.test(requested) || (large && norm(inline).length <= 100);
        const tag = heading ? 'h2' : requested;
        const align = heading ? 'left' : (['center','right','justify'].includes(state.align) ? state.align : 'left');
        const units = Math.round(state.indent / state.font);
        const prefix = !heading && !['center','right','end'].includes(state.align) && units > 0 && units <= 16
          ? '\u3000'.repeat(units) : '';
        // Existing paragraph prefixes survive a second adaptation without being added again.
        if (prefix && !decode(inline.replace(/<[^>]*>/g, '')).startsWith(prefix)) {inline = prefix + inline; counts.indents++;}
        const attrs = align === 'left' ? '' : ' class="ql-align-' + align + '" style="text-align:' + align + '"';
        output.push({html:'<' + tag + attrs + '>' + inline + '</' + tag + '>', block:true});
        counts.paragraphs++; if (heading) counts.headings++; if (align !== 'left') counts.alignments++;
        if (heading && state.align !== 'left' && state.align !== 'start') note('replace', inline, '标题改用平台原生 24px 标题及左对齐');
        inline = '';fonts=[];
      };
      for (const part of parts) {if (part.block) {flush(); output.push(part);} else {inline += part.html;if(norm(part.html))fonts.push(part.font??state.font);}}
      flush(); return output;
    }
    function visit(node) {
      const state = states.get(node);
      if (node.tag === 'img') {
        const src = state.attrs.src;
        if (!/^WECHATIMGPH_[\w-]+$/.test(src || '')) throw Error('搜狐正文图片必须来自本地准备包。');
        counts.images++;
        return [{html:'<p><img src="' + escape(src) + '" alt="' + escape(state.attrs.alt || '') + '" style="max-width:100%;height:auto"></p>', block:true}];
      }
      if (node.tag === 'br') return [{html:'<br>', block:false}];
      if (node.tag === 'hr') return [{html:'<hr>', block:true}];
      if (/^(script|style|iframe|object|embed|link|meta|source|wbr)$/.test(node.tag)) return [];
      const parts = []; let cursor = node.openEnd ?? 0;
      for (const child of node.children) {
        parts.push(...textPart(html.slice(cursor, child.start), state), ...visit(child)); cursor = child.end;
      }
      const end = node.tag === 'root' ? html.length : html.lastIndexOf('</', node.end - 1);
      parts.push(...textPart(html.slice(cursor, Math.max(cursor, end)), state));
      if (node.tag === 'a') {
        const href = state.attrs.href || '';
        if (/^(https?:|mailto:)/i.test(href)) for (const part of parts) {
          if (!part.block) part.html = '<a href="' + escape(href) + '">' + part.html + '</a>';
          else if (/^<p><img\b/.test(part.html)) part.html = part.html.replace('<p>', '<p><a href="' + escape(href) + '">').replace('</p>', '</a></p>');
        }
      }
      if (node.tag === 'li') {
        const content=parts.map(part => part.html.replace(/^<(?:p|h2)[^>]*>([\s\S]*)<\/(?:p|h2)>$/, '$1')).join('');
        return wrap([{html:content,block:false}],state,'li');
      }
      if (/^(ul|ol)$/.test(node.tag)) return [{html:'<' + node.tag + '>' + parts.map(p => p.html).join('') + '</' + node.tag + '>', block:true}];
      if (blocks.has(node.tag)) return wrap(parts, state, /^(li|blockquote|h[1-6])$/.test(node.tag) ? node.tag : 'p');
      return parts;
    }
    const result = wrap(visit(tree.root), initial).map(part => part.html).join('');
    if (norm(result) !== norm(html)) throw Error('搜狐排版转换改变正文文字，已停止。');
    const fontSizes = [...new Set([...states.values()].map(state => state.font))].sort((a,b) => a-b);
    const notes = [
      '已保留正文顺序、' + counts.images + ' 张图片及可用的文字强调、段落对齐和列表结构。',
      '正文使用平台默认 16px；标题使用原生 24px 样式。来源字号 ' + fontSizes.join('、') + 'px。',
      ...(counts.colorReplacements ? ['已将 ' + counts.colorReplacements + ' 处彩色强调转为加粗，文字使用平台默认颜色。'] : []),
      ...(counts.indents ? ['已将 ' + counts.indents + ' 段首行缩进转为段首全角空格。'] : []),
      '行距、段距及普通容器边框使用平台版式；特殊图文布局按单独的排版检查结果处理。',
    ];
    return {version:legacyHeadings?'sohu-readable-v1':VERSION, html:result, counts, changes, notes};
  }
  return {VERSION, prepare};
})();
if (typeof module !== 'undefined') module.exports = DraftSohuFormat;
