const ENV = require('../lib/env');
const { chromium } = require('playwright');
const fs = require('fs');
const SC = ENV.SHOTS + '/stage7_shots';
fs.mkdirSync(SC, { recursive: true });
const B = ENV.BASE;
const call = async (t, m, p, b) => { const r = await fetch(B + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j }; };
const login = async (k, e) => (await call(null, 'POST', `/auth/${k}/login`, { email: e, password: 'pw-test-1' })).token;
const results = []; const check = (ok, m) => { results.push((ok ? '✓ ' : '✗ ') + m); console.log((ok ? '✓ ' : '✗ ') + m); };
const STORY = 'Theseus came to the gate of the maze at night. Only the bronze key opens the gate. He searched the ruins until he found it, and walked out free.';
const STORY2 = 'The Sphinx guarded the road to Thebes. She asked every traveler what Pandora found at the bottom of the jar. Only those who said hope could pass.';

(async () => {
  const T = await login('teacher', 'teacher@test.local'), A = await login('student', 'stuA@test.local'), Bt = await login('student', 'stuB@test.local');
  await call(T, 'POST', '/teacher/island/reset-test', { confirm_period: 'Test' });
  const me = await call(A, 'GET', '/island/me'); const aId = me.student.student_id;
  const quests = me.quests.filter(x => x.pin_type === 'shrine' || x.pin_type === 'guardian');
  async function story(q, title, body, x) {
    const pr = await call(A, 'POST', '/island/pins', { quest_id: q.quest_id, x_pct: x, y_pct: 40 }); if (!pr.pin) throw new Error(JSON.stringify(pr)); const pin = pr.pin;
    const qq = { prompt: 'Who is the hero?', options: ['Theseus', 'Paris', 'Ajax'], correct_index: 0 };
    let r = await call(A, 'PATCH', `/island/pins/${pin.pin_id}`, { title, body: body + ' ' + 'He was brave and wise and strong. '.repeat(10) });
    await call(A, 'PUT', `/island/pins/${pin.pin_id}/question`, qq);
    const s = await call(A, 'POST', `/island/pins/${pin.pin_id}/submit`);
    await call(T, 'POST', `/teacher/island/pins/${pin.pin_id}/review`, { action: 'approve' });
    return { id: pin.pin_id, submit: s };
  }
  const s1 = await story(quests[0], 'The Night Gate', STORY, 30), s2 = await story(quests[1], 'The Sphinx', STORY2, 60);
  const st = (await call(A, 'GET', `/island/pins/${s1.id}`));
  check(true, `setup: two stories (${quests[0].pin_type}, ${quests[1].pin_type}); submit says ${JSON.stringify(s1.submit).slice(0, 80)}`);

  const br = await chromium.launch();
  async function open(tok, url, who) {
    const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); p.setDefaultTimeout(15000);
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); });
    await p.goto(B + '/index.html');
    await p.evaluate(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [tok, who]);
    await p.goto(B + url); return p;
  }
  // ── A builds a Starter game from the island page
  const a = await open(A, `/island.html?pin=${s1.id}`, { name: 'Student A', type: 'student' });
  await a.waitForSelector('text=Make a mini game');
  await a.screenshot({ path: SC + '/1_island_slot.png' });
  await a.click('text=Make a mini game'); await a.waitForURL('**/game_builder.html?pin=*');
  await a.waitForSelector('text=The Locked Gate');
  await a.screenshot({ path: SC + '/2_choose.png' });
  await a.locator('.tpl', { hasText: 'The Locked Gate' }).locator('text=Starter').click();
  await a.waitForSelector('#room .tile');
  check(await a.locator('.check.no', { hasText: 'clue' }).count() === 1, 'Starter editor opens; check asks for the survival clue');
  check(await a.locator('text=+ Add a rule').count() === 0 && await a.locator('text=+ Add a thing').count() === 0, 'Starter level: no adding rules or things');
  await a.click('.clue:has-text("Only the bronze key opens the gate.")');
  const keyRow = a.locator('.thing').nth(0);
  await keyRow.locator('input[type=text]').fill('Bronze key of Minos');
  await a.locator('.rule').nth(1).locator('input[type=text]').fill('Locked! Read the story again.');
  // move the key with Move + tap a square
  await keyRow.locator('text=Move').click(); await a.locator('#room .tile').nth(1 * 12 + 3).click();
  await a.waitForSelector('#save-state:text("Saved")'); await a.waitForSelector('.check.ok');
  const okText = await a.locator('.check.ok').innerText();
  check(/survive/.test(okText), `after choosing the clue: "${okText}"`);
  await a.screenshot({ path: SC + '/3_builder.png', fullPage: true });
  const saved = await call(A, 'GET', `/games/pin/${s1.id}`);
  const key = saved.game.things.find(t => t.id === 'key');
  check(key.name === 'Bronze key of Minos' && key.x === 3 && key.y === 1 && saved.game.rules[1].then.text === 'Locked! Read the story again.', 'rename, new message and moved key are autosaved');

  // ── A tries it: win the game with the keyboard
  const g = await a.context().newPage(); g.errs = []; g.on('pageerror', e => g.errs.push(e.message));
  await g.goto(B + `/game.html?pin=${s1.id}`); await g.waitForSelector('#room .tile');
  const keys = [...Array(5).fill('ArrowUp'), 'ArrowRight', 'ArrowRight', ...Array(3).fill('ArrowDown'), ...Array(4).fill('ArrowRight')];
  for (const k of keys) await g.keyboard.press(k);
  await g.keyboard.press('ArrowRight');  // bump the gate while carrying the key
  check(await g.locator('text=Bronze key of Minos').count() > 0, 'picked up the key (shown under Carrying)');
  for (let i = 0; i < 4; i++) await g.keyboard.press('ArrowRight');
  await g.waitForSelector('text=You survived!');
  check(true, 'Try it: the author wins with the arrow keys');
  await g.screenshot({ path: SC + '/4_won.png' });
  // Lose path for the gate: bump it with no key → message
  await g.click('text=Play again');
  for (const k of [...Array(2).fill('ArrowUp'), ...Array(7).fill('ArrowRight')]) await g.keyboard.press(k);
  check(await g.locator('.msgs', { hasText: 'Locked! Read the story again.' }).count() === 1, 'no key → the author\'s locked message');
  await g.close();

  // ── submit
  await a.click('#submit'); await a.waitForSelector('text=Waiting for your teacher');
  check(await a.locator('#room .tile').first().isVisible() && await a.locator('input[type=text]').first().isDisabled(), 'submitted: banner shown and the editor is locked');
  await a.screenshot({ path: SC + '/5_submitted.png' });

  // ── second game via API (riddle), published by the teacher directly
  let r2 = await call(A, 'PUT', `/games/pin/${s2.id}`, { level: 'starter', from_template: 'riddle_keeper' });
  r2.game.clue_text = 'Only those who said hope could pass.';
  await call(A, 'PUT', `/games/pin/${s2.id}`, { level: 'starter', template: r2.game.template, things: r2.game.things, rules: r2.game.rules, start: r2.game.start, clue_text: r2.game.clue_text });
  check((await call(A, 'POST', `/games/pin/${s2.id}/submit`)).status === 'submitted', 'second game (The Riddle Keeper) submitted');

  // ── teacher tab
  const t = await open(T, '/island_review.html', { name: 'Teacher', type: 'teacher' });
  await t.click('#tab-games'); await t.waitForSelector('.card:has-text("The Night Gate")');
  const card = t.locator('.card', { hasText: 'The Night Gate' });
  const ct = await card.innerText();
  check(/Only the bronze key opens the gate/.test(ct) && /Winnable/.test(ct) && /carrying 🗝️ Bronze key of Minos/.test(ct), 'teacher sees clue, readable rules and a passing check');
  await t.screenshot({ path: SC + '/6_teacher.png', fullPage: true });
  await card.locator('text=Return with note').click(); await t.waitForTimeout(500);
  check(await card.locator('.msg', { hasText: 'note' }).count() === 1, 'returning without a note asks for one');
  await card.locator('button:has-text("Approve")').click(); await t.waitForSelector('text=a teammate play-tests it next');
  await t.locator('.card', { hasText: 'The Sphinx' }).locator('text=Publish now').click(); await t.waitForSelector('text=✓ Published');
  check(true, 'teacher approves the gate game and publishes the riddle game directly');

  // ── teammate B play-tests
  const b = await open(Bt, `/island.html?student=${aId}&pin=${s1.id}`, { name: 'Student B', type: 'student' });
  await b.waitForSelector('text=Play-test the mini game');
  await b.screenshot({ path: SC + '/7_b_island.png' });
  await b.click('text=Play-test the mini game'); await b.waitForSelector('text=Play-test for your teammate');
  await b.screenshot({ path: SC + '/8_b_playtest.png' });
  await b.click('text=It works'); await b.waitForSelector('text=now published');
  check((await call(A, 'GET', `/games/pin/${s1.id}`)).game.status === 'published', 'B says "It works" → the game is published');

  // ── B plays the riddle game and loses, then goes back to the story
  await b.goto(B + `/game.html?pin=${s2.id}`); await b.waitForSelector('#room .tile');
  for (let i = 0; i < 4; i++) await b.keyboard.press('ArrowRight');  // bump the Sphinx
  await b.waitForSelector('text=Sphinx asks:');
  await b.click('.opt:has-text("Gold")'); await b.waitForSelector('text=The story ends here');
  await b.screenshot({ path: SC + '/9_lost.png' });
  await b.click('text=Back to the story'); await b.waitForURL('**/island.html?student=*');
  await b.waitForSelector('text=Play the mini game');
  check(b.url().includes(`pin=${s2.id}`), 'losing → "Back to the story" returns to the same story, which offers the game again');
  await b.screenshot({ path: SC + '/10_back.png' });

  // ── A sees status on the island page
  await a.goto(B + `/island.html?pin=${s1.id}`); await a.waitForSelector('text=Published — readers can play it.');
  check(true, 'author\'s island page shows the game as published');

  // mobile width
  const m = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 }); const mp = await m.newPage();
  await mp.goto(B + '/index.html'); await mp.evaluate(t => localStorage.setItem('token', t), A); await mp.goto(B + `/game_builder.html?pin=${s1.id}`);
  await mp.waitForSelector('#room .tile'); const sw = await mp.evaluate(() => document.documentElement.scrollWidth);
  check(sw <= 390, `builder at phone width has no sideways scroll (${sw}px)`);
  await mp.screenshot({ path: SC + '/11_phone.png', fullPage: true });

  for (const [n, p] of [['A', a], ['T', t], ['B', b]]) check(!p.errs.filter(e => n !== 'T' || !/400/.test(e)).length, `${n}: no page errors ${p.errs.join(' | ')}`);
  await br.close();
  console.log('\n' + results.filter(x => x.startsWith('✗')).length + ' failed');
})().catch(e => { console.error('CRASH', e); process.exit(1); });
