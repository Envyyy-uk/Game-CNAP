// Стрімінговий запит до Anthropic Messages API прямо з браузера.
// Ключ передається параметром і ніде не зберігається.
var CnapApi = (function () {
  'use strict';

  var URL = 'https://api.anthropic.com/v1/messages';

  function humanError(status, message) {
    var m = message || '';
    if (status === 401) return 'ключ API не прийнято (401). Перевірте, чи скопійовано його повністю.';
    if (status === 403) return 'доступ заборонено (403): ' + m;
    if (status === 404) return 'модель не знайдено (404): ' + m;
    if (status === 429) return 'забагато запитів або вичерпано ліміт (429). Спробуйте за хвилину.';
    if (status === 529 || status >= 500) return 'сервери Anthropic перевантажені (' + status + '). Спробуйте ще раз трохи згодом.';
    return 'помилка ' + status + (m ? ': ' + m : '');
  }

  async function attempt(opts, withFallback, progress) {
    var req = opts.request;
    var body = Object.assign({}, req.body, { stream: true });
    var headers = {
      'content-type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    if (withFallback && req.fallbacks) {
      body.fallbacks = req.fallbacks;
      headers['anthropic-beta'] = req.fallbackBeta;
    }

    var res;
    try {
      res = await fetch(URL, { method: 'POST', headers: headers, body: JSON.stringify(body), signal: opts.signal });
    } catch (e) {
      if (e && e.name === 'AbortError') throw e;
      throw new Error('немає з\'єднання з api.anthropic.com. Перевірте інтернет або скористайтеся «Скопіювати справу».');
    }
    if (!res.ok) {
      var raw = '';
      try { var j = await res.json(); raw = (j.error && j.error.message) || ''; } catch (e) { /* не JSON */ }
      var err = new Error(humanError(res.status, raw));
      err.status = res.status;
      err.raw = raw;
      throw err;
    }

    var reader = res.body.getReader();
    var decoder = new TextDecoder();
    var buffer = '';
    var stopReason = null;

    function handle(block) {
      var data = '';
      block.split(/\r?\n/).forEach(function (line) {
        if (line.indexOf('data:') === 0) data += line.slice(5).trim();
      });
      if (!data) return;
      var ev;
      try { ev = JSON.parse(data); } catch (e) { return; }
      if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
        progress.text += ev.delta.text;
        opts.onText(ev.delta.text);
      } else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) {
        stopReason = ev.delta.stop_reason;
      } else if (ev.type === 'error') {
        throw new Error('розгляд перервано: ' + ((ev.error && ev.error.message) || 'невідома помилка'));
      }
    }

    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      var parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop();
      parts.forEach(handle);
    }
    if (buffer.trim()) handle(buffer);

    if (stopReason === 'refusal' && !progress.text.trim()) {
      throw new Error('модель відмовилася розглядати справу. Скористайтеся «Скопіювати справу» і вставте її в чат з Claude.');
    }
    if (stopReason === 'max_tokens') {
      opts.onText('\n\n_(Витяг обрізано через ліміт довжини.)_');
    }
    return stopReason;
  }

  // opts: { apiKey, request: CnapPrompt.buildRequest(...), onText(chunk), signal }
  async function streamExtract(opts) {
    var progress = { text: '' };
    try {
      return await attempt(opts, true, progress);
    } catch (e) {
      // Якщо ключ/акаунт не підтримує запасні моделі — повторюємо без них.
      if (e.status === 400 && /fallback|beta/i.test(e.raw || '') && !progress.text) {
        return attempt(opts, false, progress);
      }
      throw e;
    }
  }

  return { streamExtract: streamExtract };
})();
