/* Deterministic Toutiao draft formatting, shared by package generation and verification. */
'use strict';
const DraftToutiaoFormat = (() => {
  const VERSION = 'toutiao-readable-v1';
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
  function prepare(html) {
    if (typeof html !== 'string') throw Error('今日头条排版来源必须为 HTML。');
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
      if (state.underline || state.italic) note('replace', raw, '斜体／下划线强调改为平台支持的加粗');
      if (state.bold || accent || state.underline || state.italic) value = '<strong>' + value + '</strong>';
      if (norm(raw) && state.font !== 17) note('font',raw,'来源 '+state.font+'px 字号改用平台正文默认 17px，标题另用原生 18px 标题格式');
      if (accent) {counts.colorReplacements++; note('replace', raw, '彩色强调改为加粗，使用平台默认文字色');}
      if (state.bold || state.italic || state.underline || state.strike) counts.emphasis++;
      return [{html:value, block:false,font:state.font}];
    }
    function wrap(parts, state, requested = 'p') {
      const output = []; let inline = '',fonts=[];
      const flush = () => {
        if (!inline) return;
        if (!norm(inline) && !/<br\b/.test(inline)) {inline = ''; return;}
        const large=fonts.length&&fonts.every(font=>font>=22);
        const heading = /^h[1-6]$/.test(requested) || (large && norm(inline).length <= 100);
        const tag = heading ? 'h1' : requested;
        const align = heading ? 'left' : (['center','right'].includes(state.align) ? state.align : 'justify');
        if(!heading&&state.align!=='justify'&&align==='justify')note('align',inline,'来源左对齐改用头条可保存的默认两端对齐');
        const units = Math.round(state.indent / state.font);
        const prefix = !heading && !['center','right','end'].includes(state.align) && units > 0 && units <= 16
          ? '\u3000'.repeat(units) : '';
        // Existing paragraph prefixes survive a second adaptation without being added again.
        if (prefix && !decode(inline.replace(/<[^>]*>/g, '')).startsWith(prefix)) {inline = prefix + inline; counts.indents++;}
        const attrs = heading ? '' : ' style="text-align:' + align + '"';
        output.push({html:'<' + tag + attrs + '>' + inline + '</' + tag + '>', block:true});
        counts.paragraphs++; if (heading) counts.headings++; if (align !== 'left') counts.alignments++;
        if (heading) note('replace', inline, '标题改用头条原生 18px 标题样式及左对齐');
        inline = '';fonts=[];
      };
      for (const part of parts) {if (part.block) {flush(); output.push(part);} else {inline += part.html;if(norm(part.html))fonts.push(part.font??state.font);}}
      flush(); return output;
    }
    function visit(node) {
      const state = states.get(node);
      if (node.tag === 'img') {
        const src = state.attrs.src;
        if (!/^WECHATIMGPH_[\w-]+$/.test(src || '')) throw Error('今日头条正文图片必须来自本地准备包。');
        counts.images++;
        const css=state.attrs.style||'';
        const dimension=key=>[...css.matchAll(new RegExp('(?:^|;)\\s*'+key+'\\s*:\\s*([^;]+)','gi'))].at(-1)?.[1].replace(/\s*!important$/i,'').trim()||'未单独指定';
        changes.push({kind:'image',imagePosition:counts.images,text:'',detail:'第 '+counts.images+' 张图片 '+src+'：来源显示宽度 '+dimension('width')+'、高度 '+dimension('height')+'；使用头条原生独立图片，按原图尺寸和比例显示，超过正文宽度时等比缩小。'});
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
      if (state.attrs?.style && norm(parts.map(p=>p.html).join(''))) {
        const styles=state.attrs.style.split(';').filter(rule=>/^\s*(?:background(?:-[\w-]+)?|border(?:-[\w-]+)?|box-shadow|font-family|line-height|margin(?:-[\w-]+)?|padding(?:-[\w-]+)?)\s*:/i.test(rule));
        const labels={'font-family':'字体','line-height':'行距','background-color':'背景色','background-image':'背景图','margin':'外边距','margin-top':'上边距','margin-bottom':'下边距','padding':'内边距','box-shadow':'阴影'};
        const details=styles.map(rule=>{const at=rule.indexOf(':'),key=rule.slice(0,at).trim(),value=rule.slice(at+1).trim();return (labels[key]||key)+'：'+(key==='font-family'?value.split(',').slice(0,2).join('、')+'等':value)}).join('；');
        if(styles.length)note('layout',parts.map(p=>p.html).join(''),'使用平台段落版式，替换来源装饰／间距：'+details);
      }
      if (node.tag === 'table') return [{html:'<table>'+parts.map(p=>p.html).join('')+'</table>',block:true}];
      if (/^(thead|tbody|tfoot|tr|td|th)$/.test(node.tag)) {
        const attrs=/^(td|th)$/.test(node.tag)?['colspan','rowspan'].filter(k=>/^\d+$/.test(state.attrs[k]||'')&&Number(state.attrs[k])>1).map(k=>' '+k+'="'+Number(state.attrs[k])+'"').join(''):'';
        const content=/^(td|th)$/.test(node.tag)?wrap(parts,state):parts;
        return [{html:'<'+node.tag+attrs+'>'+content.map(p=>p.html).join('')+'</'+node.tag+'>',block:true}];
      }
      if (node.tag === 'a') {
        const href = state.attrs.href || '';
        if(/^https?:/i.test(href)){
          for(const part of parts){
            if(!part.block){
              const bold=/<strong>/.test(part.html),strike=/<s>/.test(part.html);
              let linked='<a href="'+escape(href)+'">'+part.html.replace(/<\/?(?:strong|s)>/g,'')+'</a>';
              if(strike)linked='<s>'+linked+'</s>';if(bold)linked='<strong>'+linked+'</strong>';part.html=linked;
            }else if(/^<p><img\b/.test(part.html))part.html=part.html.replace('<p>','<p><a href="'+escape(href)+'">').replace('</p>','</a></p>');
          }
          note('link',parts.map(p=>p.html).join(''),'使用头条原生链接结构保留原文字／图片及地址：'+href);
        }else if(href)note('link',parts.map(p=>p.html).join(''),'平台不支持该协议的链接格式，保留原文字／图片；原链接地址：'+href);
      }
      if (node.tag === 'li') {
        const content=parts.map(part => part.html.replace(/^<(?:p|h1)[^>]*>([\s\S]*)<\/(?:p|h1)>$/, '$1')).join('');
        return wrap([{html:content,block:false}],state,'li');
      }
      if (/^(ul|ol)$/.test(node.tag)) return [{html:'<' + node.tag + '>' + parts.map(p => p.html).join('') + '</' + node.tag + '>', block:true}];
      if (blocks.has(node.tag)) return wrap(parts, state, /^(li|blockquote|h[1-6])$/.test(node.tag) ? node.tag : 'p');
      return parts;
    }
    const result = wrap(visit(tree.root), initial).map(part => part.html).join('');
    if (norm(result) !== norm(html)) throw Error('今日头条排版转换改变正文文字，已停止。');
    const fontSizes = [...new Set([...states.values()].map(state => state.font))].sort((a,b) => a-b);
    const notes = [
      '已保留正文顺序、' + counts.images + ' 张图片及可用的文字强调、段落对齐和列表结构。',
      '正文使用头条默认 17px，标题使用原生 18px 样式。来源字号 ' + fontSizes.join('、') + 'px。',
      '来源主文字色 '+baseColor+' 改用平台默认文字色；彩色强调的替换范围逐处列出。',
      ...(counts.colorReplacements ? ['已将 ' + counts.colorReplacements + ' 处彩色强调转为加粗，文字使用平台默认颜色。'] : []),
      ...(counts.indents ? ['已将 ' + counts.indents + ' 段首行缩进转为段首全角空格。'] : []),
      '行距、段距、字体和普通容器装饰使用平台版式；复杂图文布局按单独检查结果处理。斜体／下划线转为加粗，删除线、列表、引用、对齐和普通表格保留。普通网页链接使用原生结构保留文字与地址，特殊协议链接的降级逐条记录。',
    ];
    return {version:VERSION, html:result, counts, changes, notes};
  }
  return {VERSION, prepare};
})();
if (typeof module !== 'undefined') module.exports = DraftToutiaoFormat;
