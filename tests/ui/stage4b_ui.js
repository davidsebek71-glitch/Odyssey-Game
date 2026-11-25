const ENV = require('../lib/env');
const { chromium } = require('playwright');
const fs = require('fs');
const SC = ENV.SHOTS + '/stage4_shots'; require('fs').mkdirSync(SC, { recursive: true });
const B = ENV.BASE;
const call = async (t, m, p, b) => (await fetch(B + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json();
const login = async (k, e) => (await call(null, 'POST', `/auth/${k}/login`, { email: e, password: 'pw-test-1' })).token;
const results = []; const check = (ok, m) => { results.push((ok ? '✓ ' : '✗ ') + m); };
const words = n => Array.from({ length: n }, (_, i) => ['the', 'beast', 'waits', 'in', 'the', 'dark', 'maze'][i % 7]).join(' ');

(async () => {
  const T = await login('teacher', 'teacher@test.local'), A = await login('student', 'stuA@test.local'), C = await login('student', 'stuC@test.local'), E = await login('student', 'stuE@test.local');
  const cId = (await call(C, 'GET', '/island/me')).student.student_id;
  await call(T, 'POST', '/teacher/island/reset-test', { confirm_period: 'Test' });
  // C needs an island map (the reset keeps maps, but a fresh database has none)
  await call(C, 'POST', '/student/upload-map', { map_image: 'data:image/png;base64,' + require('fs').readFileSync(ENV.REPO + '/public/images/classical/Psyche/palace_bg.png').toString('base64') });
  // The reset clears god powers, so give A an approved Athena power (Stage 4A's flow)
  await call(A, 'PUT', '/gods/athena/card', { claim: 'Athena helps heroes who use their minds instead of only their strength.', evidence_text: '"Athena gave him a polished shield" and he watched Medusa\'s reflection', source_note: 'p. 42' });
  await call(A, 'POST', '/gods/athena/card/submit');
  const card = (await call(T, 'GET', '/teacher/gods/cards?period=Test')).cards.find(c => c.god === 'athena' && c.student_name === 'Student A');
  await call(T, 'POST', `/teacher/gods/cards/${card.power_id}/review`, { action: 'approve' });
  const br = await chromium.launch();
  async function open(tok, url, who) {
    const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); p.setDefaultTimeout(15000);
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/409|400/.test(m.text())) p.errs.push(m.text()); });
    p.on('dialog', d => d.accept());
    await p.goto(B + '/index.html');
    await p.evaluate(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [tok, who]);
    await p.goto(B + url); return p;
  }
  const c = await open(C, '/island.html', { name: 'Student C', type: 'student' });
  // Each quest's pin goes in its own spot, so a tap never lands on an earlier pin
  // (which would open that pin instead of placing this one)
  let spot = 0;
  const startQuest = async title => {
    await c.goto(B + '/island.html'); await c.waitForSelector('.quest');
    await c.locator('.quest', { hasText: title }).getByRole('button').click(); await c.waitForSelector('#f-title');
    const bx = await c.locator('.map-wrap img').boundingBox(); await c.mouse.click(bx.x + bx.width * (0.2 + 0.3 * spot++), bx.y + bx.height * 0.5);
  };

  // ── C builds the Lair in the editor
  await startQuest('SAMPLE: The Lair');
  await c.fill('#f-title', 'The Drowned Cavern'); await c.fill('#f-body', words(25));
  check(/photo of your lair map/.test(await c.textContent('#why-not')), `lair before the photo: "${await c.textContent('#why-not')}"`);
  await c.setInputFiles('#f-photo', ENV.REPO + '/public/images/classical/Psyche/palace_bg.png');
  await c.waitForSelector('text=The four dangers'); await c.waitForSelector('input[aria-label="Danger 1 label"]');
  await c.waitForFunction(() => [...document.querySelectorAll('img[alt="Your lair map"]')].some(i => i.naturalWidth > 0));
  const lairImg = c.locator('img[alt="Your lair map"]'); const lb = await lairImg.boundingBox();
  const spots = [[0.2, 0.3], [0.7, 0.25], [0.4, 0.7], [0.8, 0.8]], labels = ['Whirlpool', 'Falling rocks', 'Eels', 'Darkness'];
  for (let i = 0; i < 4; i++) {
    await lairImg.scrollIntoViewIfNeeded(); const box = await lairImg.boundingBox();
    await c.mouse.click(box.x + box.width * spots[i][0], box.y + box.height * spots[i][1]);
    await c.fill(`input[aria-label="Danger ${i + 1} label"]`, labels[i]);
  }
  check((await c.locator('.dmark').count()) === 4, 'four numbered dangers placed by tapping the photo');
  await c.waitForFunction(() => document.getElementById('save-state').textContent === 'Saved', null, { timeout: 8000 });
  check(!(await c.isDisabled('#submit-btn')), 'lair complete → Submit enabled');
  await c.screenshot({ path: `${SC}/7-lair-editor.png`, fullPage: true });
  await c.click('#submit-btn'); await c.waitForSelector('.banner.warn');

  // ── C builds the Monster in the editor
  await startQuest('SAMPLE: The Monster');
  await c.fill('#f-title', 'The Cave Hydra'); await c.fill('#f-body', words(65));
  await c.waitForSelector('input[aria-label="Attribute 1"]');
  const desc = ['Its many eyes never sleep', 'It calls down lightning', 'It hides in a maze of tunnels', 'Its skin is harder than bronze'];
  for (let i = 0; i < 4; i++) await c.fill(`input[aria-label="Attribute ${i + 1}"]`, desc[i]);
  await c.selectOption('select[aria-label="God for attribute 1"]', 'athena');
  await c.selectOption('select[aria-label="God for attribute 2"]', 'zeus');
  for (const i of [3, 4]) {
    await c.selectOption(`select[aria-label="How attribute ${i} is countered"]`, 'question');
    const qb = c.locator('.qbox').nth(i - 1);
    await qb.locator('input[placeholder="The question a hero must answer"]').fill(i === 3 ? 'How did Theseus escape the maze?' : 'Who forged armor for the gods?');
    await qb.locator('input[placeholder^="Choice 1"]').fill(i === 3 ? 'He followed a thread' : 'Hephaestus');
    await qb.locator('input[placeholder^="Choice 2"]').fill(i === 3 ? 'He flew out' : 'Ares');
    await qb.locator('input[type=radio]').first().check();
  }
  check(/what the hero gains/.test(await c.textContent('#why-not')), `before the reward: "${await c.textContent('#why-not')}"`);
  await c.fill('#hero-gains', 'A scale from its hide that turns aside any blade.');
  await c.waitForFunction(() => document.getElementById('save-state').textContent === 'Saved', null, { timeout: 8000 });
  check(!(await c.isDisabled('#submit-btn')), 'monster complete → Submit enabled');
  await c.screenshot({ path: `${SC}/8-monster-editor.png`, fullPage: true });
  await c.click('#submit-btn'); await c.waitForSelector('.banner.warn');

  // Guardian quickly by API
  const gq = (await call(C, 'GET', '/island/me')).quests.find(q => q.pin_type === 'guardian');
  const gp = (await call(C, 'POST', '/island/pins', { quest_id: gq.quest_id, x_pct: 15, y_pct: 20 })).pin;
  await call(C, 'PATCH', `/island/pins/${gp.pin_id}`, { title: 'The Bronze Sentinel', body: words(45) });
  await call(C, 'PUT', `/island/pins/${gp.pin_id}/question`, { prompt: 'What did Ariadne give Theseus?', options: ['A sword', 'A ball of thread', 'A lyre'], correct_index: 1 });
  await call(C, 'POST', `/island/pins/${gp.pin_id}/submit`);

  // ── Teacher sees the monster's counters in the queue, approves all
  const t = await open(T, '/island_review.html', { name: 'Teacher', type: 'teacher' });
  await t.waitForSelector('text=Attributes and counters');
  check((await t.textContent('main')).includes('Countered by the god power: zeus') && (await t.textContent('main')).includes('Whirlpool'), 'teacher queue shows counters and lair dangers');
  await t.locator('.card', { hasText: 'Attributes and counters' }).screenshot({ path: `${SC}/9-teacher-monster-card.png` });
  for (const p of (await call(T, 'GET', '/teacher/island/queue?period=Test')).pins) await call(T, 'POST', `/teacher/island/pins/${p.pin_id}/review`, { action: 'approve' });
  await call(T, 'POST', '/teacher/voyage/settings', { class_period: 'Test', mode: 'voyage' });
  for (const a of [1, 3]) await call(T, 'POST', '/teacher/voyage/tokens', { alliance_id: a, delta: 2 });

  // ── A faces it
  const a = await open(A, `/island.html?student=${cId}`, { name: 'Student A', type: 'student' });
  await a.waitForSelector('text=Face the Guardian (1 voyage token)');
  check(/The Cave Hydra/.test(await a.textContent('#panel')), 'A sees "The Cave Hydra lives on this island, behind a guardian"');
  await a.click('text=Face the Guardian (1 voyage token)'); await a.waitForSelector('text=The Guardian\'s Test');
  await a.locator('.opt', { hasText: 'A sword' }).click(); await a.waitForSelector('text=one more try');
  await a.locator('.opt', { hasText: 'A ball of thread' }).click(); await a.waitForSelector('text=Get past the dangers');
  await a.waitForFunction(() => [...document.querySelectorAll('img[alt="The lair map"]')].some(i => i.naturalWidth > 0));
  check((await a.textContent('#panel')).includes('Whirlpool') && (await a.locator('#panel ol li').count()) === 4, 'past the Guardian: the lair map with its four dangers');
  await a.screenshot({ path: `${SC}/10-encounter-lair.png` });
  await a.click('text=Get past the dangers → face the monster'); await a.waitForSelector('text=Counter at least 3');
  await a.click('text=Use 🦉 Athena\'s Aegis of Wisdom'); await a.waitForSelector('text=✓ Countered');
  check(/doesn't hold it/.test(await a.textContent('#panel')), 'Zeus attribute: "your alliance doesn\'t hold it"');
  await a.click('text=Face it anyway'); await a.waitForSelector('text=✗ Not countered');
  await a.locator('.opt', { hasText: 'He followed a thread' }).click(); await a.waitForTimeout(500);
  await a.locator('.opt', { hasText: 'Hephaestus' }).click(); await a.waitForSelector('.banner.good');
  check(/Victory! You countered 3 of 4/.test(await a.textContent('.banner.good')) && /A scale from its hide/.test(await a.textContent('.banner.good')), `A: "${(await a.textContent('.banner.good')).trim()}"`);
  await a.screenshot({ path: `${SC}/11-encounter-victory.png`, fullPage: true });

  // ── E is turned back
  const e = await open(E, `/island.html?student=${cId}`, { name: 'Student E', type: 'student' });
  await e.click('text=Face the Guardian (1 voyage token)'); await e.waitForSelector('text=The Guardian\'s Test');
  await e.locator('.opt', { hasText: 'A sword' }).click(); await e.waitForSelector('text=one more try');
  await e.locator('.opt', { hasText: 'A lyre' }).click(); await e.waitForSelector('.banner.bad');
  check(/turns you back/.test(await e.textContent('.banner.bad')), 'E: "The Guardian turns you back…"');

  // ── Teacher sees the encounters
  await t.goto(B + '/monsters_admin.html'); await t.click('#tab-enc'); await t.waitForSelector('table');
  const et = await t.textContent('main');
  check(et.includes('defeated it · 3/4') && et.includes('turned back by the Guardian'), 'teacher\'s Encounters tab lists both');
  for (const [n, p] of [['C', c], ['teacher', t], ['A', a], ['E', e]]) check(!p.errs.length, `${n} page errors: ${p.errs.length ? [...new Set(p.errs)].join(' | ') : 'none'}`);
  console.log(results.join('\n'));
  await br.close();
})().catch(e => { console.log(results.join('\n')); console.error('FAIL', e.message.split('\n').slice(0, 2).join(' ')); process.exit(1); });
