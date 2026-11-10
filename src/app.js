// Двигун гри «ЦНАП Дорослого Життя».
// Весь прогрес — в одному об'єкті `state` (у v2 його легко зберігати в localStorage).
// Ключ API живе окремо, у `session`, і в state ніколи не потрапляє.
(function () {
  'use strict';

  var S = JSON.parse(document.getElementById('scenario').textContent);
  var U = S.ui;
  var TOTAL = S.meta.totalSeals;
  var MAX_PER = S.meta.maxSealsPerWindow;
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var state = createState();
  var session = { apiKey: '', abort: null };
  var steps = buildSteps();

  function createState() {
    return {
      version: 1,
      step: 0,
      ticket: null,
      name: '',
      startedAt: null,
      answers: {},   // id питання → текст відповіді
      asked: {},     // id питання → формулювання, яке побачила людина
      scales: {},    // ключ віконця → 1..10
      choices: {},   // ключ віконця → id варіанту
      stamps: {},    // ключ віконця → { id, title }
      seals: {},     // ключ віконця → 0..4
      extract: null  // { number, issuedAt, markdown, status, error }
    };
  }

  function buildSteps() {
    var list = [{ type: 'intro' }];
    S.application.questions.forEach(function (q, i) {
      list.push({ type: 'appQuestion', q: q, index: i });
    });
    S.windows.forEach(function (w) {
      list.push({ type: 'windowIntro', w: w });
      list.push({ type: 'scale', w: w });
      list.push({ type: 'situation', w: w });
      w.questions.forEach(function (q, i) { list.push({ type: 'question', w: w, q: q, index: i }); });
      list.push({ type: 'seals', w: w });
    });
    list.push({ type: 'finale' });
    list.push({ type: 'extract' });
    return list;
  }

  // ---------- Печатки ----------
  function sealsSpent(exceptKey) {
    var sum = 0;
    Object.keys(state.seals).forEach(function (k) { if (k !== exceptKey) sum += state.seals[k]; });
    return sum;
  }
  function sealsLeft() { return TOTAL - sealsSpent(); }
  function sealsMaxFor(w) { return Math.max(0, Math.min(MAX_PER, TOTAL - sealsSpent(w.key))); }

  // ---------- Утиліти ----------
  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, '');
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }
  function append(node, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(node, c); }); return; }
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  function fmt(str, vars) {
    return String(str).replace(/\{(\w+)\}/g, function (_, k) { return vars[k] !== undefined ? vars[k] : ''; });
  }
  function initials(name) {
    return name.split(/\s+/).map(function (p) { return p.charAt(0); }).join('').slice(0, 2).toUpperCase();
  }
  function vibrate(ms) { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ні */ } }

  // ---------- Табло ----------
  var boardMain = document.getElementById('boardMain');
  var boardProgress = document.getElementById('boardProgress');
  var boardSeals = document.getElementById('boardSeals');
  var lastBoardText = '';

  function updateBoard(step) {
    var vars = { ticket: state.ticket || '', n: step.w ? step.w.number : '' };
    var main, progress = '';
    if (!state.ticket) main = U.board.idle;
    else if (step.type === 'intro' || step.type === 'appQuestion') { main = fmt(U.board.registry, vars); progress = 'ЗАЯВА Ф-1'; }
    else if (step.w) { main = fmt(U.board.window, vars); progress = fmt(U.board.progress, vars); }
    else { main = fmt(U.board.finale, vars); progress = 'ВІКОНЦЕ 6/6'; }

    boardMain.textContent = main;
    boardProgress.textContent = progress;
    if (main !== lastBoardText && lastBoardText && !reduceMotion) {
      boardMain.classList.remove('is-switching');
      void boardMain.offsetWidth;
      boardMain.classList.add('is-switching');
    }
    lastBoardText = main;

    boardSeals.textContent = '';
    if (state.ticket) {
      var left = sealsLeft();
      var dots = h('span', { class: 'board__dots', 'aria-hidden': 'true' });
      for (var i = 0; i < TOTAL; i++) dots.appendChild(h('i', { class: i < left ? 'on' : '' }));
      append(boardSeals, [dots, h('span', { text: left + '/' + TOTAL, 'aria-label': 'Залишок печаток: ' + left + ' з ' + TOTAL })]);
    }
    // Смужка прогресу по віконцях
    var pct = Math.round((state.step / (steps.length - 1)) * 100);
    document.getElementById('board').style.setProperty('--progress', pct + '%');
  }

  // ---------- Загальні блоки екранів ----------
  function clerkBlock(clerk, lines, extraClass) {
    var who = clerk.name + (clerk.role ? ', ' + clerk.role : '');
    return h('div', { class: 'clerk ' + (extraClass || '') },
      h('div', { class: 'clerk__avatar', 'aria-hidden': 'true', text: initials(clerk.name) }),
      h('div', { class: 'clerk__body' },
        h('div', { class: 'clerk__name', text: who }),
        (lines || []).map(function (l) { return h('p', { text: l }); })
      ));
  }

  function sheet(formCode, title, children) {
    return h('section', { class: 'sheet' },
      h('div', { class: 'sheet__head' },
        h('span', { class: 'sheet__code', text: formCode }),
        h('span', { class: 'sheet__ticket', text: state.ticket ? 'Талон ' + state.ticket : '' })),
      title ? h('h1', { class: 'sheet__title', text: title, tabindex: '-1' }) : null,
      children);
  }

  function actions(opts) {
    var row = h('div', { class: 'actions' });
    if (opts.back !== false && state.step > 0) {
      row.appendChild(h('button', { class: 'btn btn--ghost', type: 'button', text: U.back, onclick: goBack }));
    }
    if (opts.next) {
      row.appendChild(h('button', {
        class: 'btn btn--primary', type: 'button', text: opts.nextText || U.next,
        onclick: opts.next, id: 'nextBtn'
      }));
    }
    return row;
  }

  function errorLine() { return h('p', { class: 'form-error', role: 'alert', id: 'formError' }); }
  function showError(msg) {
    var e = document.getElementById('formError');
    if (e) { e.textContent = msg; e.classList.remove('shake'); void e.offsetWidth; e.classList.add('shake'); }
  }

  function field(id, label, value, opts) {
    opts = opts || {};
    var input = opts.multiline
      ? h('textarea', { id: id, class: 'field__input field__input--area', rows: opts.rows || 6, placeholder: opts.placeholder || '' })
      : h('input', { id: id, class: 'field__input', type: 'text', autocomplete: 'off', placeholder: opts.placeholder || '' });
    input.value = value || '';
    if (opts.oninput) input.addEventListener('input', function () { opts.oninput(input.value); });
    if (opts.multiline) {
      var grow = function () { input.style.height = 'auto'; input.style.height = Math.max(input.scrollHeight, 150) + 'px'; };
      input.addEventListener('input', grow);
      setTimeout(grow, 0);
    }
    return h('label', { class: 'field', for: id },
      label ? h('span', { class: 'field__label', text: label }) : null,
      input,
      opts.hint ? h('span', { class: 'field__hint', text: opts.hint }) : null);
  }

  function stampNode(title, extraClass) {
    return h('div', { class: 'stamp ' + (extraClass || ''), role: 'img', 'aria-label': 'Штамп: ' + title },
      h('span', { class: 'stamp__title', text: title }),
      h('span', { class: 'stamp__date', text: new Date().toLocaleDateString('uk-UA') }));
  }

  function thud(node, sheetNode) {
    vibrate(35);
    if (reduceMotion) return;
    node.classList.add('is-thud');
    if (sheetNode) {
      sheetNode.classList.remove('is-shaken');
      void sheetNode.offsetWidth;
      sheetNode.classList.add('is-shaken');
    }
  }

  // ---------- Екрани ----------
  var screens = {};

  screens.intro = function () {
    var I = S.intro;
    if (!state.ticket) {
      return h('section', { class: 'sheet sheet--lobby' },
        h('div', { class: 'lobby__emblem', 'aria-hidden': 'true', text: 'ЦНАП' }),
        h('h1', { class: 'sheet__title', text: S.meta.title }),
        h('p', { class: 'lobby__hint', text: I.boardHint }),
        h('button', {
          class: 'btn btn--primary btn--big', type: 'button', text: U.takeTicket,
          onclick: function () {
            var n = 10 + Math.floor(Math.random() * 90);
            state.ticket = S.meta.ticketLetter + '-' + String(n).padStart(3, '0');
            state.startedAt = new Date().toISOString();
            render();
          }
        }));
    }
    var nameField = field('nameInput', I.nameLabel, state.name, {
      placeholder: I.namePlaceholder, hint: I.nameHint,
      oninput: function (v) { state.name = v.trim(); }
    });
    return sheet('Талон електронної черги', null, [
      h('div', { class: 'ticket', role: 'img', 'aria-label': I.ticketCaption + ': ' + state.ticket },
        h('span', { class: 'ticket__caption', text: I.ticketCaption }),
        h('span', { class: 'ticket__number', text: state.ticket }),
        h('span', { class: 'ticket__meta', text: new Date(state.startedAt).toLocaleString('uk-UA', { dateStyle: 'short', timeStyle: 'short' }) })),
      clerkBlock(I.clerk, I.clerkLines),
      h('ol', { class: 'rules' }, I.rules.map(function (r) { return h('li', { text: r }); })),
      nameField,
      errorLine(),
      actions({
        back: false, nextText: U.toRegistry,
        next: function () {
          if (!state.name) return showError(I.nameEmpty);
          goNext();
        }
      })
    ]);
  };

  screens.appQuestion = function (step) {
    var A = S.application, q = step.q;
    state.asked[q.id] = q.text;
    return sheet(A.formName, A.title, [
      step.index === 0 ? clerkBlock(S.intro.clerk, A.clerkLines) : null,
      questionBody(q, q.text, step.index + 1, A.questions.length)
    ]);
  };

  function questionBody(q, text, n, total, note) {
    return [
      h('div', { class: 'qcard' },
        h('div', { class: 'qcard__label', text: (q.label || 'Графа') + (total ? ' · ' + n + '/' + total : '') }),
        note || null,
        h('p', { class: 'qcard__text', text: text }),
        q.hint ? h('p', { class: 'qcard__hint', text: q.hint }) : null),
      field('answer', null, state.answers[q.id], {
        multiline: true, placeholder: q.placeholder,
        oninput: function (v) { state.answers[q.id] = v; }
      }),
      errorLine(),
      actions({
        nextText: U.submit,
        next: function () {
          var v = (state.answers[q.id] || '').trim();
          if (v.length < S.meta.minAnswerLength) return showError(U.emptyAnswer);
          state.answers[q.id] = v;
          goNext();
        }
      })
    ];
  }

  screens.windowIntro = function (step) {
    var w = step.w;
    return h('section', { class: 'sheet sheet--window' },
      h('div', { class: 'window__plate' },
        h('span', { class: 'window__no', text: 'Віконце №' + w.number }),
        h('span', { class: 'window__title', text: w.title }),
        h('span', { class: 'window__sub', text: w.subtitle })),
      w.number === 1 ? clerkBlock(S.intro.clerk, [S.application.doneLine], 'clerk--muted') : null,
      clerkBlock(w.clerk, w.clerk.lines),
      actions({ nextText: U.toWindow, next: goNext }));
  };

  screens.scale = function (step) {
    var w = step.w, sc = w.scale;
    var grid = h('div', { class: 'scale', role: 'radiogroup', 'aria-label': sc.question });
    for (var i = 1; i <= 10; i++) {
      (function (n) {
        grid.appendChild(h('button', {
          type: 'button', class: 'scale__btn' + (state.scales[w.key] === n ? ' is-on' : ''),
          role: 'radio', 'aria-checked': state.scales[w.key] === n ? 'true' : 'false', text: String(n),
          onclick: function () {
            state.scales[w.key] = n;
            Array.prototype.forEach.call(grid.children, function (b, idx) {
              b.classList.toggle('is-on', idx + 1 === n);
              b.setAttribute('aria-checked', idx + 1 === n ? 'true' : 'false');
            });
          }
        }));
      })(i);
    }
    return sheet('Форма В-' + w.number + '/1 · ' + w.title, '📊 Самооцінка', [
      h('p', { class: 'qcard__text', text: sc.question }),
      grid,
      h('div', { class: 'scale__legend' }, h('span', { text: '1 — ' + sc.low }), h('span', { text: '10 — ' + sc.high })),
      errorLine(),
      actions({ next: function () { if (!state.scales[w.key]) return showError(U.chooseScale); goNext(); } })
    ]);
  };

  screens.situation = function (step) {
    var w = step.w, sit = w.situation;
    var chosen = state.choices[w.key];
    var stampSlot = h('div', { class: 'stamp-slot', 'aria-live': 'polite' });
    var reactionSlot = h('div', { 'aria-live': 'polite' });
    var root;

    function optionById(id) { return sit.options.filter(function (o) { return o.id === id; })[0]; }
    function paintStamp(animate) {
      stampSlot.textContent = '';
      reactionSlot.textContent = '';
      var o = optionById(state.choices[w.key]);
      if (!o || !state.stamps[w.key]) return;
      var st = stampNode(o.stamp.title);
      stampSlot.appendChild(st);
      reactionSlot.appendChild(clerkBlock(w.clerk, [o.reaction], 'clerk--reply'));
      if (animate) thud(st, root);
    }

    var list = h('div', { class: 'options', role: 'radiogroup', 'aria-label': sit.text });
    sit.options.forEach(function (o, idx) {
      list.appendChild(h('button', {
        type: 'button', class: 'option' + (chosen === o.id ? ' is-on' : ''), role: 'radio',
        'aria-checked': chosen === o.id ? 'true' : 'false',
        onclick: function () {
          if (state.choices[w.key] !== o.id) {
            state.choices[w.key] = o.id;
            delete state.stamps[w.key]; // новий вибір — штамп ще не поставлено
          }
          Array.prototype.forEach.call(list.children, function (b) {
            var on = b === this;
            b.classList.toggle('is-on', on);
            b.setAttribute('aria-checked', on ? 'true' : 'false');
          }, this);
          paintStamp(false);
          updateNext();
        }
      }, h('span', { class: 'option__mark', text: String.fromCharCode(1040 + idx) }), h('span', { text: o.text })));
    });

    var nextBtn;
    function updateNext() {
      nextBtn = nextBtn || document.getElementById('nextBtn');
      if (nextBtn) nextBtn.textContent = state.stamps[w.key] ? U.next : U.stampIt;
    }

    root = sheet('Форма В-' + w.number + '/2 · ' + w.title, '🎭 Ситуація', [
      h('p', { class: 'qcard__text', text: sit.text }),
      list,
      stampSlot,
      reactionSlot,
      errorLine(),
      actions({
        nextText: state.stamps[w.key] ? U.next : U.stampIt,
        next: function () {
          var o = optionById(state.choices[w.key]);
          if (!o) return showError(U.chooseOption);
          if (!state.stamps[w.key]) {
            state.stamps[w.key] = { id: o.stamp.id, title: o.stamp.title };
            paintStamp(true);
            updateNext();
            setTimeout(function () { reactionSlot.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' }); }, reduceMotion ? 0 : 450);
            return;
          }
          goNext();
        }
      })
    ]);
    paintStamp(false);
    return root;
  };

  screens.question = function (step) {
    var w = step.w, q = step.q, note = null, text = q.text;
    if (q.byStamp) {
      var st = state.stamps[w.key];
      text = (st && q.byStamp[st.id]) || q.byStamp[Object.keys(q.byStamp)[0]];
      if (st) note = h('div', { class: 'qcard__stampnote' }, stampNode(st.title, 'stamp--mini'), h('span', { text: 'питання змінено штампом' }));
    }
    state.asked[q.id] = text;
    return sheet('Форма В-' + w.number + '/' + (3 + step.index) + ' · ' + w.title, '✍️ Вільна графа',
      questionBody(q, text, step.index + 1, w.questions.length, note));
  };

  screens.seals = function (step) {
    var w = step.w;
    var max = sealsMaxFor(w);
    var isLast = w.number === S.windows.length;
    if (state.seals[w.key] > max) delete state.seals[w.key];
    var comment = h('p', { class: 'seals__comment', 'aria-live': 'polite' });
    var leftNode = h('strong', { class: 'seals__left' });
    var picker = h('div', { class: 'seals', role: 'radiogroup', 'aria-label': w.seals.question });

    function refresh() {
      var cur = state.seals[w.key];
      var left = TOTAL - sealsSpent(w.key) - (cur || 0);
      leftNode.textContent = left + ' з ' + TOTAL;
      comment.textContent = cur === undefined ? '' : (S.sealComments[String(cur)] || '');
      Array.prototype.forEach.call(picker.children, function (b, n) {
        b.classList.toggle('is-on', cur === n);
        b.setAttribute('aria-checked', cur === n ? 'true' : 'false');
      });
      updateBoard(step);
    }
    for (var n = 0; n <= MAX_PER; n++) {
      (function (n) {
        var seals = h('span', { class: 'seals__icons', 'aria-hidden': 'true' });
        for (var i = 0; i < n; i++) seals.appendChild(h('i'));
        picker.appendChild(h('button', {
          type: 'button', class: 'seals__btn', role: 'radio', disabled: n > max,
          'aria-label': n + ' печаток',
          onclick: function () { state.seals[w.key] = n; refresh(); }
        }, h('span', { class: 'seals__num', text: String(n) }), seals));
      })(n);
    }

    var root = sheet('Форма В-' + w.number + '/П · ' + w.title, '🔖 Розподіл печаток', [
      h('p', { class: 'qcard__text', text: w.seals.question }),
      h('p', { class: 'seals__status' }, 'Залишок після цього віконця: ', leftNode),
      picker,
      max === 0 ? h('p', { class: 'note', text: U.sealsNoneLeft }) : (isLast ? h('p', { class: 'note', text: U.sealsLastWindow }) : null),
      comment,
      errorLine(),
      actions({
        nextText: U.sealsConfirm,
        next: function () {
          if (state.seals[w.key] === undefined) return showError('Оберіть кількість печаток — від 0 до ' + max + '.');
          var btn = picker.children[state.seals[w.key]];
          thud(btn, root);
          setTimeout(goNext, reduceMotion ? 0 : 520);
        }
      })
    ]);
    refresh();
    return root;
  };

  screens.finale = function () {
    var F = S.finale;
    var rows = S.windows.map(function (w) {
      return h('tr', null,
        h('th', { scope: 'row', text: w.number + '. ' + w.title }),
        h('td', { text: (state.scales[w.key] || '—') + '/10' }),
        h('td', { text: state.seals[w.key] !== undefined ? '🔖'.repeat(state.seals[w.key]) || '0' : '—' }),
        h('td', { class: 'summary__stamp', text: state.stamps[w.key] ? state.stamps[w.key].title : '—' }));
    });
    var left = sealsLeft();
    var keyInput = h('input', {
      id: 'apiKey', class: 'field__input', type: 'password', autocomplete: 'off', spellcheck: 'false',
      autocapitalize: 'off', placeholder: F.keyPlaceholder
    });
    keyInput.value = session.apiKey;
    keyInput.addEventListener('input', function () { session.apiKey = keyInput.value.trim(); });
    var copyArea = h('textarea', { class: 'field__input field__input--area copy-fallback', readonly: true, rows: 8, hidden: true });
    var copyStatus = h('p', { class: 'note', 'aria-live': 'polite' });

    return sheet('Форма Ф-ВИТ · Видача витягів', F.title, [
      clerkBlock(F.clerk, F.clerkLines),
      h('h2', { class: 'sub', text: F.summaryTitle }),
      h('div', { class: 'summary-wrap' },
        h('table', { class: 'summary' },
          h('thead', null, h('tr', null, h('th', { text: 'Сфера' }), h('th', { text: 'Шкала' }), h('th', { text: 'Печатки' }), h('th', { text: 'Штамп' }))),
          h('tbody', null, rows))),
      left > 0 ? h('p', { class: 'note', text: 'Невикористаних печаток: ' + left + '. Вони згоріли — це теж буде в справі.' }) : null,
      h('div', { class: 'finale-box' },
        h('label', { class: 'field', for: 'apiKey' },
          h('span', { class: 'field__label', text: F.keyLabel }), keyInput,
          h('span', { class: 'field__hint', text: F.keyHint })),
        errorLine(),
        h('button', {
          class: 'btn btn--primary btn--wide', type: 'button', text: F.sendButton,
          onclick: function () {
            if (!session.apiKey) return showError(F.keyEmpty);
            startExtract();
          }
        })),
      h('div', { class: 'finale-box finale-box--alt' },
        h('p', { class: 'field__hint', text: F.copyHint }),
        h('button', {
          class: 'btn btn--ghost btn--wide', type: 'button', text: F.copyButton,
          onclick: function () {
            var text = CnapPrompt.buildCopyText(state, S);
            copyText(text).then(function () {
              copyStatus.textContent = F.copied;
              copyArea.hidden = true;
            }, function () {
              copyStatus.textContent = F.copyFailed;
              copyArea.value = text;
              copyArea.hidden = false;
              copyArea.focus();
              copyArea.select();
            });
          }
        }),
        copyStatus,
        copyArea),
      actions({})
    ]);
  };

  // ---------- Витяг ----------
  function extractMeta() {
    var issued = new Date();
    var valid = new Date(issued.getTime() + S.extract.validDays * 864e5);
    var num = S.extract.numberPrefix + '-' + issued.getFullYear() + '/' +
      state.ticket.replace(/\D/g, '') + '-' + String(Math.floor(1000 + Math.random() * 9000));
    return { number: num, issuedAt: issued.toISOString(), validUntil: valid.toISOString() };
  }
  function longDate(iso) {
    return new Date(iso).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function startExtract() {
    var meta = extractMeta();
    state.extract = { number: meta.number, issuedAt: meta.issuedAt, validUntil: meta.validUntil, markdown: '', status: 'streaming', error: null };
    goNext();
    if (session.abort) session.abort.abort();
    session.abort = typeof AbortController !== 'undefined' ? new AbortController() : null;
    CnapApi.streamExtract({
      apiKey: session.apiKey,
      request: CnapPrompt.buildRequest(state, S),
      signal: session.abort && session.abort.signal,
      onText: function (chunk) {
        state.extract.markdown += chunk;
        paintExtractBody();
      }
    }).then(function () {
      state.extract.status = 'done';
      render();
    }, function (err) {
      if (err && err.name === 'AbortError') return;
      state.extract.status = 'error';
      state.extract.error = (err && err.message) || String(err);
      render();
    });
  }

  var extractBodyNode = null;
  function paintExtractBody() {
    if (!extractBodyNode || !state.extract) return;
    var md = state.extract.markdown;
    if (!md && state.extract.status === 'streaming') {
      extractBodyNode.innerHTML = '';
      extractBodyNode.appendChild(h('p', { class: 'doc__waiting', text: S.finale.waiting }));
      return;
    }
    extractBodyNode.innerHTML = CnapMd.render(md) + (state.extract.status === 'streaming' ? '<span class="doc__cursor" aria-hidden="true"></span>' : '');
  }

  function extractMarkdownFile() {
    var E = S.extract, x = state.extract;
    return '# ' + E.title + ' № ' + x.number + '\n\n' +
      '**' + E.applicantLabel + ':** ' + state.name + '  \n' +
      '**' + E.dateLabel + ':** ' + longDate(x.issuedAt) + '  \n' +
      '**' + E.validLabel + ':** ' + longDate(x.validUntil) + '  \n' +
      '**Талон:** ' + state.ticket + '\n\n---\n\n' +
      x.markdown.trim() + '\n\n---\n\n' +
      '_' + E.signature + '_ · М. П.\n\n' + '_' + E.footer + '_\n';
  }

  function sealSvg() {
    var E = S.extract;
    var year = new Date(state.extract.issuedAt).getFullYear();
    return '<svg class="seal" viewBox="0 0 200 200" role="img" aria-label="Кругла печатка: ' + E.sealOuter + '">' +
      '<defs><filter id="ink"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" result="n"/>' +
      '<feColorMatrix in="n" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.25" result="m"/>' +
      '<feComposite in="SourceGraphic" in2="m" operator="in"/></filter>' +
      '<path id="sealArc" d="M100,100 m-74,0 a74,74 0 1,1 148,0 a74,74 0 1,1 -148,0"/></defs>' +
      '<g filter="url(#ink)" fill="none" stroke="currentColor">' +
      '<circle cx="100" cy="100" r="94" stroke-width="5"/><circle cx="100" cy="100" r="86" stroke-width="1.6"/>' +
      '<circle cx="100" cy="100" r="58" stroke-width="2.4"/>' +
      '<text fill="currentColor" stroke="none" font-size="13.2" font-weight="600" letter-spacing="1.3"><textPath href="#sealArc">' + escapeXml(E.sealOuter) + '</textPath></text>' +
      '<text x="100" y="86" fill="currentColor" stroke="none" font-size="15" text-anchor="middle">★ ★ ★</text>' +
      '<text x="100" y="108" fill="currentColor" stroke="none" font-size="14.5" font-weight="700" text-anchor="middle" letter-spacing="1">' + escapeXml(E.sealInner) + '</text>' +
      '<text x="100" y="127" fill="currentColor" stroke="none" font-size="13" text-anchor="middle">' + year + '</text>' +
      '</g></svg>';
  }
  function escapeXml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  screens.extract = function () {
    var E = S.extract, x = state.extract;
    if (!x) { state.step = steps.length - 2; return screens.finale(); }
    extractBodyNode = h('div', { class: 'doc__body md' });
    var status = h('p', { class: 'note', 'aria-live': 'polite' });
    var signed = x.status === 'done';

    var doc = h('article', { class: 'doc' + (signed ? ' is-signed' : '') },
      h('div', { class: 'doc__issuer', text: E.issuer }),
      h('h1', { class: 'doc__title' }, E.title, h('br'), h('span', { class: 'doc__number', text: '№ ' + x.number })),
      h('dl', { class: 'doc__meta' },
        h('dt', { text: E.applicantLabel }), h('dd', { text: state.name }),
        h('dt', { text: E.dateLabel }), h('dd', { text: longDate(x.issuedAt) }),
        h('dt', { text: E.validLabel }), h('dd', { text: longDate(x.validUntil) })),
      extractBodyNode,
      h('div', { class: 'doc__sign' },
        h('div', { class: 'doc__seal', html: signed ? sealSvg() : '' }),
        h('div', { class: 'doc__signature' },
          h('span', { class: 'doc__scribble', 'aria-hidden': 'true', html: signed ? '<svg viewBox="0 0 160 50"><path d="M5 38 C 20 5, 30 48, 45 22 S 70 8, 78 30 S 100 44, 112 18 S 135 30, 155 12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>' : '' }),
          h('span', { class: 'doc__line' }),
          h('span', { class: 'doc__role', text: E.signature }))),
      h('p', { class: 'doc__footer', text: E.footer }));

    var tools = null;
    if (x.status === 'done') {
      tools = h('div', { class: 'doc-tools' },
        h('button', {
          class: 'btn btn--primary', type: 'button', text: E.copyButton,
          onclick: function () { copyText(extractMarkdownFile()).then(function () { status.textContent = E.copied; }, function () { status.textContent = S.finale.copyFailed; }); }
        }),
        h('button', {
          class: 'btn btn--ghost', type: 'button', text: E.downloadButton,
          onclick: function () { download('vytiah-' + state.ticket + '.md', extractMarkdownFile()); }
        }),
        status,
        h('button', {
          class: 'btn btn--link', type: 'button', text: E.restartButton,
          onclick: function () {
            if (!confirm('Почати нову справу? Поточні відповіді буде стерто.')) return;
            state = createState();
            lastBoardText = '';
            render();
          }
        }));
    } else if (x.status === 'error') {
      tools = h('div', { class: 'doc-tools' },
        h('p', { class: 'form-error', role: 'alert', text: S.finale.errorPrefix + ' ' + x.error }),
        h('button', { class: 'btn btn--primary', type: 'button', text: 'Повернутися до видачі', onclick: function () { state.step = steps.length - 2; render(); } }));
    }

    var wrap = h('div', { class: 'doc-wrap' }, doc, tools);
    paintExtractBody();
    if (signed && !x.sealed) {
      x.sealed = true;
      var sealNode = doc.querySelector('.doc__seal');
      setTimeout(function () { thud(sealNode, doc); }, 60);
    }
    return wrap;
  };

  // ---------- Буфер обміну і файли ----------
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = h('textarea', { style: 'position:fixed;top:0;left:0;opacity:0', readonly: true });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy failed'));
    });
  }
  function download(filename, text) {
    var blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  // ---------- Навігація ----------
  var app = document.getElementById('app');

  function render() {
    var step = steps[state.step];
    updateBoard(step);
    app.textContent = '';
    extractBodyNode = null;
    var node = screens[step.type](step);
    node.classList.add('screen-in');
    app.appendChild(node);
    window.scrollTo(0, 0);
    var title = app.querySelector('.sheet__title, .window__no, .doc__title');
    if (title && title.focus) { if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1'); title.focus({ preventScroll: true }); }
  }
  function goNext() { if (state.step < steps.length - 1) { state.step++; render(); } }
  function goBack() {
    if (state.step <= 0) return;
    state.step--;
    if (steps[state.step].type === 'extract') state.step--;
    render();
  }

  window.addEventListener('beforeunload', function (e) {
    var started = state.ticket && Object.keys(state.answers).length > 0;
    var finished = state.extract && state.extract.status === 'done';
    if (started && !finished) { e.preventDefault(); e.returnValue = ''; }
  });

  render();

  // Доступ для налагодження і майбутнього v2 (localStorage, Telegram).
  window.CNAP = {
    get state() { return state; },
    scenario: S,
    steps: steps,
    sealsLeft: sealsLeft,
    sealsMaxFor: sealsMaxFor,
    render: render
  };
})();
