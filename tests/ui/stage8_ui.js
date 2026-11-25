const ENV = require('../lib/env');
const { chromium } = require('playwright');
const fs = require('fs');
const SC = ENV.SHOTS + '/stage8_shots'; fs.mkdirSync(SC, { recursive: true });
const B = ENV.BASE;
const call = async (t, m, p, b) => { const r = await fetch(B + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j }; };
const login = async (k, e) => (await call(null, 'POST', `/auth/${k}/login`, { email: e, password: 'pw-test-1' })).token;
const results = []; const check = (ok, m) => { results.push(ok); console.log((ok ? '✓ ' : '✗ ') + m); };
(async () => {
  const T = await login('teacher', 'teacher@test.local'), A = await login('student', 'stuA@test.local');
  await call(T, 'POST', '/teacher/island/reset-test', { confirm_period: 'Test' });
  await call(T, 'POST', '/teacher/ai-helper', { period: 'Test', enabled: false, drafts_per_story: 3 });
  const q = (await call(A, 'GET', '/island/me')).quests.find(x => x.pin_type === 'guardian');
  const pin = (await call(A, 'POST', '/island/pins', { quest_id: q.quest_id, x_pct: 30, y_pct: 30 })).pin;
  await call(A, 'PATCH', `/island/pins/${pin.pin_id}`, { title: 'The Fleece', body: 'Jason sailed to Colchis. Only the one who carries the fleece may leave. He took it and sailed home.' });
  const br = await chromium.launch();
  async function open(tok, url) {
    const p = await (await br.newContext({ viewport: { width: 1280, height: 900 } })).newPage(); p.setDefaultTimeout(15000);
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message));
    await p.goto(B + '/index.html'); await p.evaluate(t => localStorage.setItem('token', t), tok); await p.goto(B + url); return p;
  }
  // teacher turns it on
  const t = await open(T, '/island_review.html');
  await t.selectOption('#period', 'Test'); await t.click('#tab-games');
  await t.waitForSelector('text=AI helper for mini games');
  check(await t.locator('text=Period Test: OFF').count() === 1 && await t.locator('text=Set up: the server has an API key.').count() === 1, 'teacher sees the helper OFF and set up');
  await t.click('#ai-toggle'); await t.waitForSelector('text=Period Test: ON');
  check(true, 'teacher turns it on for Test period');
  // student
  const a = await open(A, `/game_builder.html?pin=${pin.pin_id}`);
  await a.waitForSelector('text=Help me build this');
  check(await a.locator('text=3 of 3 helper drafts left').count() === 1, 'start screen offers the helper with 3 drafts');
  await a.fill('#ai-desc', 'The hero must find the golden fleece and show it to the king to escape.');
  await a.click('#ai-go'); await a.waitForSelector('text=Use this draft');
  check(await a.locator('.room-preview .tile').count() === 96 && await a.locator('text=Someone can survive this draft').count() === 1, 'the draft is previewed with its rules and a passing check');
  await a.screenshot({ path: SC + '/1_draft.png', fullPage: true });
  await a.click('text=Use this draft'); await a.waitForSelector('#room .tile');
  check(await a.locator('text=Builder level').count() === 1 && await a.locator('.check.no', { hasText: 'clue' }).count() === 1, 'using it opens the Builder editor; only the clue is left');
  check(await a.locator('text=2 of 3 helper drafts left').count() === 1, 'the helper stays available in the editor (2 left)');
  await a.click('.clue:has-text("Only the one who carries the fleece may leave.")'); await a.waitForSelector('.check.ok');
  check(true, 'picking the clue makes it pass');
  await a.screenshot({ path: SC + '/2_editor.png', fullPage: true });
  // error path in the editor
  await a.fill('#ai-desc', 'short'); await a.click('#ai-go'); await a.waitForSelector('#ai-msg:has-text("at least 5 words")');
  check(true, 'a too-short sentence shows a plain message');
  // teacher log
  await t.reload(); await t.selectOption('#period', 'Test'); await t.click('#tab-games'); await t.waitForSelector('text=What students sent');
  await t.click('text=What students sent');
  check(await t.locator('td', { hasText: 'golden fleece and show it to the king' }).count() === 1, 'teacher can read the sentence that was sent');
  await t.screenshot({ path: SC + '/3_teacher.png', fullPage: true });
  await t.click('#ai-toggle'); await t.waitForSelector('text=Period Test: OFF');
  await a.reload(); await a.waitForSelector('#room .tile');
  check(await a.locator('text=Help me build this').count() === 0, 'turned off → the helper card disappears');
  check(!a.errs.length && !t.errs.length, 'no page errors ' + a.errs.concat(t.errs).join(' | '));
  await br.close();
  console.log(results.filter(x => !x).length + ' failed');
})().catch(e => { console.error('CRASH', e); process.exit(1); });
