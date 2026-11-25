const ENV = require('../lib/env');
const { chromium } = require('playwright');
const fs = require('fs');
const SC = ENV.SHOTS + '/stage4_shots';
const RNG = ENV.RNG_FILE;
fs.mkdirSync(SC, { recursive: true });
const B = ENV.BASE;
const call = async (t, m, p, b) => (await fetch(B + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json();
const login = async (k, e) => (await call(null, 'POST', `/auth/${k}/login`, { email: e, password: 'pw-test-1' })).token;
const results = []; const check = (ok, m) => { results.push((ok ? '✓ ' : '✗ ') + m); };
const MON = Object.fromEntries(JSON.parse(fs.readFileSync(ENV.REPO + '/data/monsters.json', 'utf8')).monsters.map(m => [m.key, m]));

(async () => {
  const T = await login('teacher', 'teacher@test.local'), C = await login('student', 'stuC@test.local'), D = await login('student', 'stuD@test.local');
  // Clean slate: the reset clears god powers and monsters; C needs an island map
  await call(T, 'POST', '/teacher/island/reset-test', { confirm_period: 'Test' });
  await call(C, 'POST', '/student/upload-map', { map_image: 'data:image/png;base64,' + fs.readFileSync(ENV.REPO + '/public/images/classical/Psyche/palace_bg.png').toString('base64') });
  const br = await chromium.launch();
  async function open(tok, url, who) {
    const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); p.setDefaultTimeout(15000);
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error' && !/409|400/.test(m.text())) p.errs.push(m.text()); });
    p.on('dialog', d => d.accept());
    await p.goto(B + '/index.html');
    await p.evaluate(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [tok, who]);
    await p.goto(B + url); return p;
  }

  // ── D writes an evidence card for Apollo
  const d = await open(D, '/student.html', { name: 'Student D', type: 'student' });
  await d.click('#gods-btn'); await d.waitForURL('**/monsters.html'); await d.waitForSelector('.god');
  check(/No monsters are threatening/.test(await d.textContent('main')), 'D\'s alliance starts with no threats');
  await d.locator('.god', { hasText: 'Apollo' }).click(); await d.waitForSelector('textarea');
  await d.locator('textarea').nth(0).fill('Apollo uses his music to calm what fighting cannot defeat.');
  check(/quotation/.test(await d.textContent('main')) && await d.isDisabled('text=Submit to my teacher'), 'Submit waits for a quotation');
  await d.locator('textarea').nth(1).fill('"The music was so sweet and sad that all three heads lowered"');
  await d.fill('input[type=text]', 'Cerberus passage');
  await d.waitForFunction(() => document.getElementById('save-state').textContent === 'Saved', null, { timeout: 5000 });
  await d.screenshot({ path: `${SC}/1-evidence-card.png` });
  await d.click('text=Submit to my teacher'); await d.waitForSelector('.god');
  check((await d.locator('.god', { hasText: 'Apollo' }).textContent()).includes('Waiting for approval'), 'Apollo card shows "Waiting for approval"');

  // ── Teacher approves and awakens Cerberus at alliance 2's harbor
  const t = await open(T, '/teacher.html', { name: 'Teacher', type: 'teacher' });
  await t.click('text=Gods & Monsters'); await t.waitForURL('**/monsters_admin.html');
  await t.waitForSelector('text=Approve — grant the power');
  check((await t.textContent('main')).includes('all three heads lowered'), 'teacher sees D\'s claim and evidence');
  await t.click('text=Approve — grant the power'); await t.waitForSelector('text=Power granted');
  await t.click('#tab-monsters'); await t.waitForSelector('.card h2');
  const spartans = t.locator('.card', { hasText: 'Test Spartans' }).first();
  await spartans.locator('select').nth(0).selectOption('cerberus');
  await spartans.locator('select').nth(1).selectOption('harbor');
  await spartans.getByRole('button', { name: 'Awaken', exact: true }).click();
  await t.waitForSelector('text=awakens and is guarding your harbor');
  check(true, 'teacher awakens Cerberus at Test Spartans\' harbor');
  await t.waitForTimeout(1500); await t.screenshot({ path: `${SC}/2-teacher-monsters.png` });

  // ── World map warns; D faces the monster while C watches
  const c = await open(C, '/world.html', { name: 'Student C', type: 'student' });
  await c.waitForSelector('#status');
  check(/Cerberus is guarding your harbor/.test(await c.textContent('#status')), 'C\'s world map: "Cerberus is guarding your harbor — no voyages…"');
  await d.reload(); await d.waitForSelector('.threat');
  check(/guarding your harbor/.test(await d.textContent('.threat')), 'D sees the threat');
  await d.screenshot({ path: `${SC}/3-threats.png` });
  await d.click('text=⚔️ Face it'); await d.waitForURL('**battle=*'); await d.waitForSelector('.power');
  const bid = new URL(d.url()).searchParams.get('battle');
  await c.goto(`${B}/monsters.html?battle=${bid}`); await c.waitForSelector('.power');
  check((await d.locator('.power', { hasText: 'Golden Arrow' }).textContent()).includes('Effective'), 'Apollo\'s Golden Arrow is marked Effective against Cerberus');
  await d.locator('.power', { hasText: 'Golden Arrow' }).click(); await d.waitForSelector('.passage');
  check((await d.textContent('.passage')).includes('Cerberus'), 'the passage on Cerberus\'s myth is shown');
  for (let i = 0; i < 3; i++) {
    const prompt = (await d.locator('main div[style*="font-weight:600"]').nth(i).textContent()).replace(/^\d+\.\s*/, '');
    const q = MON.cerberus.questions.find(x => x.prompt === prompt);
    const block = d.locator('main div[style*="font-weight:600"]').nth(i).locator('xpath=..');
    await block.locator('.opt').nth(i === 2 ? (q.correct_index + 1) % 4 : q.correct_index).click();
    await d.waitForTimeout(400);
  }
  check((await d.textContent('main')).includes('2 of 3 right'), 'two right, one wrong — the right answer is shown for the miss');
  await c.waitForSelector('text=Roll the dice', { timeout: 8000 });
  check(true, 'C\'s screen followed along to the Roll step without a click');
  await d.screenshot({ path: `${SC}/4-battle-questions.png`, fullPage: true });
  fs.writeFileSync(RNG, JSON.stringify([0.9, 0.05]));
  await d.click('text=🎲 Roll the dice'); await d.waitForSelector('.dice');
  check(/Victory! Cerberus is defeated/.test(await d.textContent('main')), `D: "${(await d.textContent('.banner.good')).trim()}"`);
  await d.screenshot({ path: `${SC}/5-victory.png` });
  await c.waitForSelector('.dice', { timeout: 8000 });
  check(true, 'C\'s screen shows the result too');
  await c.goto(B + '/world.html'); await c.waitForSelector('#status');
  check(!/guarding your harbor/.test(await c.textContent('#status')), 'the harbor warning is gone');

  // ── A region monster drawn on C's island
  const cId = (await call(C, 'GET', '/island/me')).student.student_id;
  await call(T, 'POST', '/teacher/monsters/awaken', { alliance_id: 2, monster_key: 'minotaur', blocks: 'region', owner_student_id: cId, x_pct: 50, y_pct: 50 });
  await c.goto(B + '/island.html'); await c.waitForSelector('.map-wrap canvas');
  await c.waitForTimeout(800);
  check(/The Minotaur lurks on this island/.test(await c.textContent('#map-hint')), `C's island: "${await c.textContent('#map-hint')}"`);
  await c.screenshot({ path: `${SC}/6-region-monster.png` });

  for (const [n, p] of [['D', d], ['teacher', t], ['C', c]]) check(!p.errs.length, `${n} page errors: ${p.errs.length ? [...new Set(p.errs)].join(' | ') : 'none'}`);
  console.log(results.join('\n'));
  await br.close();
})().catch(e => { console.log(results.join('\n')); console.error('FAIL', e.message.split('\n').slice(0, 2).join(' ')); process.exit(1); });
