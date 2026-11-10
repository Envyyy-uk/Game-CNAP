#!/usr/bin/env node
// Збирає src/* в один самодостатній файл dist/game.html.
// Без залежностей: тільки node.
'use strict';
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src');
const DIST = path.join(__dirname, 'dist');
const OUT = path.join(DIST, 'game.html');
const JS_ORDER = ['md.js', 'prompt.js', 'api.js', 'app.js'];

const read = (f) => fs.readFileSync(path.join(SRC, f), 'utf8');

function fail(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

// ---- Перевірка сценарію ----
function validateScenario(s) {
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };
  need(s.meta && Number.isInteger(s.meta.totalSeals), 'meta.totalSeals має бути цілим числом');
  need(s.meta && Number.isInteger(s.meta.maxSealsPerWindow), 'meta.maxSealsPerWindow має бути цілим числом');
  need(s.intro && Array.isArray(s.intro.clerkLines), 'intro.clerkLines — масив реплік');
  need(s.application && Array.isArray(s.application.questions) && s.application.questions.length >= 1,
    'application.questions — хоча б одне питання');
  need(Array.isArray(s.windows) && s.windows.length === 6, 'має бути рівно 6 віконець');

  const ids = new Set();
  const uniq = (id, where) => {
    need(typeof id === 'string' && id.length, `${where}: потрібен id`);
    need(!ids.has(id), `${where}: id "${id}" повторюється`);
    ids.add(id);
  };
  (s.application?.questions || []).forEach((q, i) => {
    uniq(q.id, `application.questions[${i}]`);
    need(q.text, `application.questions[${i}]: немає тексту`);
  });
  (s.windows || []).forEach((w, wi) => {
    const where = `windows[${wi}] (№${w.number})`;
    need(w.number === wi + 1, `${where}: номер має бути ${wi + 1}`);
    need(w.title && w.clerk && w.clerk.name, `${where}: потрібні title і clerk.name`);
    need(w.scale && w.scale.question, `${where}: потрібна шкала`);
    const opts = w.situation?.options || [];
    need(opts.length === 3, `${where}: у ситуації має бути 3 варіанти`);
    const stampIds = opts.map((o) => o.stamp?.id);
    opts.forEach((o, oi) => {
      uniq(o.id, `${where}.situation.options[${oi}]`);
      need(o.stamp && o.stamp.id && o.stamp.title, `${where}: варіант ${oi + 1} без штампу`);
    });
    const qs = w.questions || [];
    need(qs.length >= 1 && qs.length <= 2, `${where}: має бути 1–2 вільні питання`);
    const adaptive = qs.filter((q) => q.byStamp);
    need(adaptive.length >= 1, `${where}: хоча б одне питання має залежати від штампу (byStamp)`);
    qs.forEach((q, qi) => {
      uniq(q.id, `${where}.questions[${qi}]`);
      if (q.byStamp) {
        stampIds.forEach((sid) => need(q.byStamp[sid], `${where}.questions[${qi}]: немає формулювання для штампу ${sid}`));
      } else {
        need(q.text, `${where}.questions[${qi}]: немає тексту`);
      }
    });
  });
  if (errors.length) fail('Сценарій має помилки:\n  - ' + errors.join('\n  - '));
}

// ---- Оцінка часу проходження ----
function estimateMinutes(s) {
  const t = s.meta.timing;
  let min = t.intro[0], max = t.intro[1];
  const add = (r, n = 1) => { min += r[0] * n; max += r[1] * n; };
  add(t.freeQuestion, s.application.questions.length);
  s.windows.forEach((w) => {
    add(t.windowOverhead);
    add(t.scale);
    add(t.situation);
    add(t.freeQuestion, w.questions.length);
    add(t.seals);
  });
  add(t.finale);
  return [Math.round(min), Math.round(max)];
}

// ---- Збірка ----
let scenario;
try {
  scenario = JSON.parse(read('scenario.json'));
} catch (e) {
  fail('scenario.json не читається як JSON: ' + e.message);
}
validateScenario(scenario);

// Вставляємо так, щоб текст не міг закрити тег <script>.
const scenarioJson = JSON.stringify(scenario).replace(/</g, '\\u003c');
const js = JS_ORDER.map((f) => `/* ==== ${f} ==== */\n` + read(f)).join('\n;\n')
  .replace(/<\/script/gi, '<\\/script');
const css = read('styles.css');

let html = read('template.html');
for (const [mark, value] of [['/*@CSS*/', css], ['/*@SCENARIO*/', scenarioJson], ['/*@JS*/', js]]) {
  if (!html.includes(mark)) fail(`у template.html немає мітки ${mark}`);
  html = html.replace(mark, () => value);
}

fs.mkdirSync(DIST, { recursive: true });
fs.writeFileSync(OUT, html);

const free = scenario.application.questions.length +
  scenario.windows.reduce((n, w) => n + w.questions.length, 0);
const [mn, mx] = estimateMinutes(scenario);
console.log(`✓ ${path.relative(process.cwd(), OUT)} — ${(Buffer.byteLength(html) / 1024).toFixed(1)} КБ`);
console.log(`  віконець: ${scenario.windows.length}, вільних питань: ${free}, печаток: ${scenario.meta.totalSeals}`);
console.log(`  орієнтовний час проходження: ${mn}–${mx} хв`);
