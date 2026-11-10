// Маленький безпечний рендер markdown → HTML для витягу.
// Підтримує: заголовки, абзаци, жирний/курсив/код, списки (з одним рівнем вкладення),
// цитати, горизонтальні лінії. Увесь вхід екранується — HTML з відповіді моделі не виконується.
var CnapMd = (function () {
  'use strict';

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function inline(s) {
    var codes = [];
    s = esc(s).replace(/`([^`]+)`/g, function (_, c) { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
    s = s.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+?)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*(?!\s)([^*]+?)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[\s(«])_(?!\s)([^_]+?)_(?=[\s.,;:!?)»]|$)/g, '$1<em>$2</em>');
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return '<code>' + codes[+i] + '</code>'; });
  }

  function render(src) {
    var lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
    var html = [];
    var para = [];
    var list = null; // { type, items: [{ text, sub: [] }], subType }
    var quote = [];

    function flushPara() {
      if (para.length) { html.push('<p>' + inline(para.join(' ')) + '</p>'); para = []; }
    }
    function flushList() {
      if (!list) return;
      var out = '<' + list.type + '>';
      list.items.forEach(function (it) {
        out += '<li>' + inline(it.text);
        if (it.sub.length) {
          out += '<' + (it.subType || 'ul') + '>' + it.sub.map(function (t) { return '<li>' + inline(t) + '</li>'; }).join('') + '</' + (it.subType || 'ul') + '>';
        }
        out += '</li>';
      });
      html.push(out + '</' + list.type + '>');
      list = null;
    }
    function flushQuote() {
      if (quote.length) { html.push('<blockquote>' + render(quote.join('\n')) + '</blockquote>'); quote = []; }
    }
    function flushAll() { flushPara(); flushList(); flushQuote(); }

    lines.forEach(function (raw) {
      var line = raw.replace(/\s+$/, '');
      var m;
      if (/^\s*>/.test(line)) { flushPara(); flushList(); quote.push(line.replace(/^\s*>\s?/, '')); return; }
      flushQuote();
      if (!line.trim()) { flushPara(); flushList(); return; }
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        flushAll();
        var lvl = Math.min(m[1].length + 1, 4); // # → h2: головний заголовок уже є у документі
        html.push('<h' + lvl + '>' + inline(m[2].replace(/\s*#+\s*$/, '')) + '</h' + lvl + '>');
        return;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushAll(); html.push('<hr>'); return; }
      if ((m = line.match(/^(\s*)([-*+•]|\d+[.)])\s+(.*)$/))) {
        flushPara();
        var indent = m[1].replace(/\t/g, '  ').length;
        var type = /\d/.test(m[2]) ? 'ol' : 'ul';
        if (indent >= 2 && list && list.items.length) {
          var last = list.items[list.items.length - 1];
          last.sub.push(m[3]);
          last.subType = last.subType || type;
          return;
        }
        if (list && list.type !== type) flushList();
        if (!list) list = { type: type, items: [] };
        list.items.push({ text: m[3], sub: [] });
        return;
      }
      if (list && /^\s{2,}\S/.test(line)) { // продовження пункту списку
        list.items[list.items.length - 1].text += ' ' + line.trim();
        return;
      }
      flushList();
      para.push(line.trim());
    });
    flushAll();
    return html.join('\n');
  }

  return { render: render, inline: inline };
})();
