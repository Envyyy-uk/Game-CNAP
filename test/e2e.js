#!/usr/bin/env node
// Наскрізний тест: проходить гру від талона до витягу в headless Chromium (390×844)
// з підставним Anthropic API. Потрібен Playwright: npm i -D playwright (або глобально).
// Запуск: node build.js && node test/e2e.js
'use strict';
const path = require('path');
const assert = require('assert');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) {
  console.log('Playwright не встановлено — тест пропущено (npm i -D playwright).');
  process.exit(0);
}

const FILE = 'file://' + path.resolve(__dirname, '..', 'dist', 'game.html');
const MD = '## 1. Бачення\nТи прокидаєшся **без будильника**.\n\n## 2. Розриви\n- **Розрив.** Текст <script>window.__x=1</script>\n\n## 6. Перший крок на завтра\nЗроби це.';

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

  let request;
  await page.route('https://api.anthropic.com/**', async (route) => {
    request = { headers: route.request().headers(), body: JSON.parse(route.request().postData()) };
    let sse = 'event: message_start\ndata: {"type":"message_start","message":{}}\n\n';
    for (const c of MD.match(/[\s\S]{1,20}/g)) {
      sse += 'event: content_block_delta\ndata: ' + JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: c } }) + '\n\n';
    }
    sse += 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\n';
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse });
  });

  const click = (name) => page.getByRole('button', { name, exact: true }).click();
  const answer = async (t) => { await page.fill('#answer', t); await click('Подати'); };

  await page.goto(FILE);
  await click('Отримати талон');
  assert.match(await page.textContent('.ticket__number'), /^А-\d{3}$/);
  await click('Пройти до реєстратури');
  assert.ok((await page.textContent('#formError')).length > 0, 'без імені не пускає');
  await page.fill('#nameInput', 'Тест');
  await click('Пройти до реєстратури');

  await click('Подати');
  assert.ok((await page.textContent('#formError')).length > 0, 'порожня відповідь не приймається');
  await answer('Прокидаюсь о сьомій');
  await answer('Не хочу втоми');

  const plan = [4, 4, 3, 2, 1, 2]; // після 4+4+3 лишається 1 — далі має обмежуватися
  for (let i = 0; i < 6; i++) {
    await click('Підійти до віконця');
    assert.ok((await page.textContent('#boardMain')).includes('ВІКОНЦЕ №' + (i + 1)), 'табло показує віконце');
    await page.locator('.scale__btn').nth(i + 2).click();
    await click('Далі');

    // Штамп впливає на питання: ставимо А, дивимось питання, повертаємось і ставимо Б
    await page.locator('.option').nth(0).click();
    await click('Поставити штамп');
    await page.waitForSelector('.stamp-slot .stamp');
    await click('Далі');
    const qA = await page.textContent('.qcard__text');
    await click('Назад');
    await page.locator('.option').nth(1).click();
    assert.strictEqual(await page.locator('.stamp-slot .stamp').count(), 0, 'новий вибір знімає штамп');
    await click('Поставити штамп');
    await click('Далі');
    const qB = await page.textContent('.qcard__text');
    assert.notStrictEqual(qA, qB, 'віконце ' + (i + 1) + ': штамп змінює формулювання питання');
    assert.strictEqual(await page.locator('.qcard__stampnote').count(), 1);

    await answer('Відповідь один');
    await answer('Відповідь два');

    const enabled = await page.locator('.seals__btn:not([disabled])').count();
    const left = await page.evaluate(() => CNAP.sealsLeft());
    assert.strictEqual(enabled - 1, Math.min(4, left), 'доступно не більше, ніж лишилось');
    const pick = Math.min(plan[i], enabled - 1);
    await page.locator('.seals__btn').nth(pick).click();
    await click('Засвідчити');
    await page.waitForTimeout(650);
  }

  const st = await page.evaluate(() => CNAP.state);
  const spent = Object.values(st.seals).reduce((a, b) => a + b, 0);
  assert.deepStrictEqual(st.seals, { money: 4, work: 4, energy: 3, people: 1, place: 0, meaning: 0 });
  assert.ok(spent <= 12);
  assert.strictEqual(Object.keys(st.stamps).length, 6);

  // Без ключа: копіювання справи
  await click('Скопіювати справу');
  await page.waitForTimeout(200);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(clip.includes('=== ІНСТРУКЦІЯ ===') && clip.includes('Віконце №6 — Сенс') && clip.includes('Відповідь два'));

  // З ключем: стрімінг витягу
  await page.fill('#apiKey', 'sk-ant-test-key');
  await click('Передати справу на розгляд');
  await page.waitForSelector('.doc .seal', { timeout: 5000 });
  assert.strictEqual(request.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.strictEqual(request.headers['x-api-key'], 'sk-ant-test-key');
  assert.strictEqual(request.body.model, 'claude-sonnet-5-5');
  assert.strictEqual(request.body.stream, true);
  assert.ok((await page.textContent('.doc__body')).includes('без будильника'));
  assert.strictEqual(await page.evaluate(() => window.__x), undefined, 'HTML з відповіді не виконується');
  assert.ok(!JSON.stringify(await page.evaluate(() => CNAP.state)).includes('sk-ant'), 'ключ не в state');
  const [dl] = await Promise.all([page.waitForEvent('download'), click('Завантажити (.md)')]);
  assert.match(dl.suggestedFilename(), /^vytiah-\d{3}\.md$/);

  assert.deepStrictEqual(errors, []);
  await browser.close();
  console.log('✓ e2e: талон → заява → 6 віконець → витяг. Печатки:', JSON.stringify(st.seals));
})().catch((e) => { console.error('✗', e.message); process.exit(1); });
