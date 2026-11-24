const ENV = require('../lib/env');
const { chromium } = require('playwright');
const SC = ENV.SHOTS + '/island_shots';
require('fs').mkdirSync(SC, { recursive: true });
const B = ENV.BASE;
const call = async (t, m, p, b) => (await fetch(B + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json();
const login = async (k, e) => (await call(null, 'POST', `/auth/${k}/login`, { email: e, password: 'pw-test-1' })).token;
const results = []; const check = (ok, m) => { results.push((ok ? '✓ ' : '✗ ') + m); };

(async () => {
  const T = await login('teacher', 'teacher@test.local'), A = await login('student', 'stuA@test.local'), Bt = await login('student', 'stuB@test.local');
  await call(T, 'POST', '/teacher/island/reset-test', { confirm_period: 'Test' });
  const br = await chromium.launch();
  async function open(tok, url, viewport = { width: 1280, height: 900 }) {
    const ctx = await br.newContext({ viewport }); const p = await ctx.newPage(); p.setDefaultTimeout(15000);
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); });
    p.on('dialog', d => d.accept());
    const who = await (await fetch(B + '/api/island/me', { headers: { Authorization: 'Bearer ' + tok } })).json();
    const user = who.student ? { id: who.student.student_id, name: who.student.name, type: 'student' } : { name: 'Teacher', type: 'teacher' };
    await p.goto(B + '/index.html'); await p.evaluate(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [tok, user]);
    await p.goto(B + url); return p;
  }

  // ── Student A: dashboard button → island page
  const a = await open(A, '/student.html');
  await a.waitForSelector('#island-btn'); await a.click('#island-btn');
  await a.waitForURL('**/island.html'); await a.waitForSelector('.quest');
  check(true, 'dashboard "Island Quests" button opens the island page');
  const chips = await a.$$eval('.quest .chip', cs => cs.map(c => c.textContent));
  check(chips[0] === 'Ready to start' && chips.filter(c => c === 'Locked').length === 2, `quest list: ${chips.join(' | ')}`);
  await a.screenshot({ path: `${SC}/1-quest-list.png` });

  await a.getByRole('button', { name: 'Start' }).first().click();
  await a.waitForSelector('#f-title');
  const hint = await a.textContent('#map-hint');
  check(/Tap your map/.test(hint), `map hint: "${hint}"`);
  check(await a.isDisabled('#submit-btn'), `Submit disabled, says: "${await a.textContent('#why-not')}"`);
  const box = await a.locator('.map-wrap img').boundingBox();
  await a.mouse.click(box.x + box.width * 0.3, box.y + box.height * 0.55);
  await a.waitForSelector('.pin.current');
  const pinStyle = await a.getAttribute('.pin.current', 'style');
  check(/left:\s*(29|30)\./.test(pinStyle), `pin placed by tapping the map (${pinStyle})`);
  // keyboard nudge
  await a.focus('.pin.current'); await a.keyboard.press('ArrowRight'); await a.keyboard.press('ArrowRight');
  const pinStyle2 = await a.getAttribute('.pin.current', 'style');
  check(pinStyle2 !== pinStyle, `arrow keys move the pin (${pinStyle2})`);
  await a.fill('#f-title', 'The Shrine of the Last Hope');
  await a.fill('#f-body', 'Hope stayed in the jar. '.repeat(16).trim() + '\nThe shrine stands on the cliff where Pandora first opened it.\nEpimetheus guards the door.');
  const counts = await a.textContent('#counts');
  check(/\/ 80 words ✓/.test(counts), `live count: "${counts}"`);
  await a.setInputFiles('#f-photo', ENV.REPO + '/public/images/classical/myths/Pandora.png');
  await a.waitForSelector('#photo-box img');
  check(true, 'photo chosen, shrunk in the browser, uploaded and shown');
  check(!(await a.isDisabled('#submit-btn')) && (await a.textContent('#why-not')) === '', `right after the photo upload (no reload) Submit is enabled; message: "${await a.textContent('#why-not')}"`);
  check(!!(await a.$('.pin.current')), 'pin is still on the map after the photo upload');
  await a.waitForFunction(() => document.getElementById('save-state').textContent === 'Saved', null, { timeout: 8000 });
  check(true, 'autosave shows "Saved"');
  await a.screenshot({ path: `${SC}/2-editor.png`, fullPage: true });
  // reload proves autosave
  await a.reload(); await a.waitForSelector('.quest');
  await a.getByRole('button', { name: 'Continue' }).first().click(); await a.waitForSelector('#f-title');
  check(await a.inputValue('#f-title') === 'The Shrine of the Last Hope' && (await a.inputValue('#f-body')).includes('Epimetheus'), 'after a reload the draft text is all still there');
  check(!(await a.isDisabled('#submit-btn')), 'Submit enabled once everything is there');
  await a.click('#submit-btn');
  await a.waitForSelector('.banner.warn');
  check(/Waiting for teacher approval/.test(await a.textContent('.banner.warn')), 'after submitting: "Waiting for teacher approval" banner');
  await a.screenshot({ path: `${SC}/3-submitted.png` });

  // ── Teacher: approval page
  const t = await open(T, '/island_review.html');
  await t.waitForSelector('.card .btn.approve');
  await t.waitForSelector('.mini-map img'); await t.waitForSelector('.photo img');
  check(true, 'teacher queue shows the submission with its map position and photo');
  const nulls = await t.evaluate(() => { let n = 0; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); while (w.nextNode()) if (w.currentNode.textContent.trim() === 'null') n++; return n; });
  check(nulls === 0, `no stray "null" text on the teacher page (${nulls})`);
  await t.screenshot({ path: `${SC}/4-teacher-queue.png`, fullPage: true });
  await t.fill('.card textarea', 'Lovely detail about Epimetheus!');
  await t.click('.card .btn.approve');
  await t.waitForSelector('text=Published');
  check(/\+25 points/.test(await t.textContent('main')), `teacher sees: "${(await t.textContent('main')).trim().slice(0, 80)}"`);
  await t.click('#tab-students'); await t.waitForSelector('table');
  await t.screenshot({ path: `${SC}/5-teacher-islands.png` });

  // ── Student A sees it published, fog cleared around it
  await a.reload(); await a.waitForSelector('.pin.published');
  const pubChip = await a.$$eval('.quest .chip', cs => cs.map(c => c.textContent));
  check(pubChip.includes('Published'), 'A\'s quest list now says Published');
  await a.screenshot({ path: `${SC}/6-published-fog.png` });

  // ── Student B (alliance-mate) opens A's island and the pin
  const b = await open(Bt, '/island.html?student=1');
  await b.waitForSelector('.pin.published');
  check((await b.textContent('#page-title')) === "Student A's Island", `B's page title: ${await b.textContent('#page-title')}`);
  await b.click('.pin.published');
  await b.waitForSelector('.viewer-body'); await b.waitForSelector('.photo-box img');
  check((await b.textContent('.viewer-body')).includes('Epimetheus guards the door.'), 'B reads the published text and sees the photo');
  check(!(await b.$('#f-title')) && !(await b.$('.banner.good')), 'B gets a read-only view (no editor, no teacher note)');
  const heads = await b.$$eval('#panel h2, #panel h3', hs => hs.map(h => h.textContent));
  check(heads.length === 2 && heads[0].includes('SAMPLE: A Shrine') && heads[1] === 'The Shrine of the Last Hope', `headings: ${heads.join(' / ')}`);
  await b.screenshot({ path: `${SC}/7-alliance-mate-view.png` });

  // ── Phone width
  const m = await open(A, '/island.html', { width: 390, height: 844 });
  await m.waitForSelector('.quest');
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, 'phone width (390px): no sideways scrolling');
  await m.screenshot({ path: `${SC}/8-phone.png`, fullPage: true });

  for (const [n, p] of [['A', a], ['teacher', t], ['B', b], ['phone', m]]) check(!p.errs.length, `${n} page errors: ${p.errs.length ? p.errs.join(' | ') : 'none'}`);
  console.log(results.join('\n'));
  await br.close();
})().catch(e => { console.log(results.join('\n')); console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
