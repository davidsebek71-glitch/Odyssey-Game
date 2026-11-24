const ENV = require('../lib/env');
const { chromium } = require('playwright');
const fs = require('fs');
const SC = ENV.SHOTS + '/stage3_shots';
fs.mkdirSync(SC, { recursive: true });
const B = ENV.BASE;
const call = async (t, m, p, b) => (await fetch(B + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json();
const login = async (k, e) => (await call(null, 'POST', `/auth/${k}/login`, { email: e, password: 'pw-test-1' })).token;
const results = []; const check = (ok, m) => { results.push((ok ? '✓ ' : '✗ ') + m); };
const stamp = Date.now().toString().slice(-5);
const TRIAL = `UI trial ${stamp}`, PUZZLE = `UI puzzle ${stamp}`;

(async () => {
  const T = await login('teacher', 'teacher@test.local'), A = await login('student', 'stuA@test.local'), C = await login('student', 'stuC@test.local');
  const cId = (await call(C, 'GET', '/island/me')).student.student_id;
  await call(T, 'PUT', `/teacher/accommodations/${cId}`, { settings: {} });
  const br = await chromium.launch();
  async function open(tok, url, who) {
    const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); p.setDefaultTimeout(15000);
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); });
    p.on('dialog', d => d.accept());
    await p.goto(B + '/index.html');
    await p.evaluate(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [tok, who]);
    await p.goto(B + url); return p;
  }

  // ── Teacher: import a trial and open it
  const t = await open(T, '/teacher.html', { name: 'Teacher', type: 'teacher' });
  await t.click('text=Oracle & Labyrinth'); await t.waitForURL('**/reading_admin.html');
  await t.waitForSelector('text=Import (paste JSON)'); await t.click('text=Import (paste JSON)');
  const sample = JSON.parse(fs.readFileSync(ENV.REPO + '/data/oracle_trial_format.json', 'utf8')); sample.title = TRIAL;
  await t.fill('textarea', JSON.stringify(sample)); await t.click('text=Open in editor');
  await t.waitForSelector('.qbox');
  check((await t.locator('.qbox').count()) === 8, `import opens the editor with ${await t.locator('.qbox').count()} questions`);
  check(/4 sections/.test(await t.textContent('main')), 'editor shows the passage as 4 sections');
  await t.screenshot({ path: `${SC}/1-trial-editor.png`, fullPage: false });
  await t.click('text=Save trial'); await t.waitForSelector(`text=${TRIAL}`);
  await t.locator('tr', { hasText: TRIAL }).getByRole('button', { name: 'Open for Test' }).click();
  await t.waitForSelector(`tr:has-text("${TRIAL}") .chip.open`);
  check(true, 'trial saved and opened for the Test period');

  // ── Teacher: build a puzzle with the live check
  await t.click('#tab-puzzles'); await t.click('text=+ New puzzle'); await t.waitForSelector('.cats');
  await t.locator('.form-row input[type=text]').first().fill(PUZZLE);
  const catInputs = t.locator('.cats input[type=text]');
  const vals = ['Hero', 'Theseus', 'Perseus', 'Jason', 'Monster', 'Minotaur', 'Medusa', 'Dragon'];
  for (let i = 0; i < vals.length; i++) await catInputs.nth(i).fill(vals[i]);
  await t.click('text=+ Add clue');
  let selects = t.locator('.clue-row select');
  await selects.nth(0).selectOption('0,0'); await selects.nth(2).selectOption('1,0');
  await t.waitForFunction(() => /2 answers fit/.test(document.querySelector('.verdict').textContent));
  check(true, 'live check after 1 clue: "2 answers fit these clues…"');
  await t.click('text=+ Add clue');
  selects = t.locator('.clue-row select');
  await selects.nth(3).selectOption('0,1'); await selects.nth(4).selectOption('is_not'); await selects.nth(5).selectOption('1,2');
  await t.waitForFunction(() => /Exactly one answer/.test(document.querySelector('.verdict').textContent));
  check(true, 'after a 2nd clue: "✓ Exactly one answer fits these clues — ready to publish."');
  await t.screenshot({ path: `${SC}/2-puzzle-builder.png`, fullPage: true });
  await t.click('text=Save and publish'); await t.waitForSelector(`tr:has-text("${PUZZLE}") .chip.published`);
  await t.locator('tr', { hasText: PUZZLE }).getByRole('button', { name: 'Open for Test' }).click();
  await t.waitForSelector(`tr:has-text("${PUZZLE}") .chip.open`);
  check(true, 'puzzle published and opened for Test');

  // ── Teacher: accommodations for C
  await t.click('#tab-acc'); await t.waitForSelector('table');
  for (const label of ['Shortened question set', 'Chunked passage', 'Enlarged text', 'Read-aloud']) {
    await t.getByLabel(`${label} for Student C`).check(); await t.waitForTimeout(400);
  }
  check((await call(T, 'GET', '/teacher/accommodations?period=Test')).students.find(s => s.student_id === cId).settings.chunked, 'accommodations saved by ticking boxes');

  // ── Student A: hub → trial (standard layout)
  const a = await open(A, '/student.html', { name: 'Student A', type: 'student' });
  await a.click('#oracle-btn'); await a.waitForURL('**/oracle.html');
  await a.locator('.row', { hasText: TRIAL }).getByText('Begin').click();
  await a.waitForSelector('.passage');
  check(!(await a.evaluate(() => document.body.classList.contains('large'))) && (await a.locator('.q').count()) === 8 && !(await a.$('.speak')), 'A: standard layout, 8 questions, no read-aloud buttons');
  check(/No timer/.test(await a.textContent('main')), 'A sees "No timer — take as long as you need."');
  const answers = sample.questions.map(q => q.correct_index);
  for (let i = 0; i < 8; i++) await a.locator('.q').nth(i).locator('.opt').nth(answers[i]).click();
  check((await a.textContent('#bar-status')).includes('8 of 8 answered'), 'progress shows 8 of 8 answered');
  await a.screenshot({ path: `${SC}/3-trial-standard.png` });
  await a.click('text=Turn it in'); await a.waitForSelector('.result-big');
  check((await a.textContent('.result-big')).includes('8 / 8'), `A's result: ${await a.textContent('.result-big')}`);
  check(/after your teacher closes/.test(await a.textContent('main')), 'review waits until the trial is closed');

  // ── Student C: accommodations applied
  const c = await open(C, `/oracle.html`, { name: 'Student C', type: 'student' });
  await c.locator('.row', { hasText: TRIAL }).getByText('Begin').click();
  await c.waitForSelector('.chunk');
  const chunks = await c.locator('.chunk').count();
  check(await c.evaluate(() => document.body.classList.contains('large')), 'C: enlarged text applied');
  check(chunks >= 4 && (await c.locator('.q').count()) === 5, `C: chunked passage (${chunks} chunks) with the shortened set (${await c.locator('.q').count()} questions)`);
  check((await c.locator('.speak').count()) > 0, `C: read-aloud buttons shown (${await c.locator('.speak').count()})`);
  await c.screenshot({ path: `${SC}/4-trial-chunked-large.png` });
  await c.locator('.q').nth(0).locator('.opt').nth(0).click(); await c.waitForTimeout(1500);
  await c.reload(); await c.waitForSelector('.chunk');
  check((await c.locator('.opt.chosen').count()) === 1, 'C\'s answer was saved and is still there after a reload');
  await c.click('text=Turn it in'); await c.waitForSelector('.result-big');
  check(true, `C turned in with blanks after confirming: ${await c.textContent('.result-big')}`);

  // ── Student A: logic puzzle
  await a.goto(B + '/oracle.html'); await a.locator('.row', { hasText: PUZZLE }).getByText('Enter').click();
  await a.waitForSelector('.cell');
  check((await a.locator('.cell').count()) === 9 && (await a.textContent('main')).includes('Theseus goes with Minotaur.'), 'A sees a 3×3 grid and the clue sentences');
  const cell = (r, col) => a.locator(`.cell[data-key="0-1-${r}-${col}"]`);
  await cell(0, 0).click(); await cell(0, 0).click();          // ● Theseus-Minotaur
  check((await cell(0, 1).textContent()) === '✗' && (await cell(1, 0).textContent()) === '✗', 'placing ● crosses out the rest of its row and column');
  await a.click('text=Check my answer');
  await a.waitForFunction(() => /exactly one ●/.test(document.getElementById('msg').textContent));
  check(true, 'checking an unfinished grid explains what is missing');
  await cell(1, 1).focus(); await a.keyboard.press('Enter'); await a.keyboard.press('Enter');  // keyboard: ● Perseus-Medusa
  await a.keyboard.press('ArrowDown'); await a.keyboard.press('ArrowRight'); await a.keyboard.press('Enter'); await a.keyboard.press('Enter');  // ● Jason-Dragon
  check((await cell(2, 2).textContent()) === '●', 'keyboard: arrows move, Enter marks');
  await a.screenshot({ path: `${SC}/5-labyrinth.png` });
  await a.click('text=Check my answer'); await a.waitForSelector('.banner');
  check(/Solved/.test(await a.textContent('#msg')) && /\+10 points/.test(await a.textContent('#msg')), `A: "${await a.textContent('#msg')}"`);

  // ── Teacher: dashboard, then close the trial → review opens
  await t.click('#tab-dash'); await t.waitForSelector('text=trials by week');
  const dashText = await t.textContent('main');
  check(dashText.includes(TRIAL) && dashText.includes('ⓐ'), 'dashboard lists the trial and marks C\'s accommodated attempt');
  await t.screenshot({ path: `${SC}/6-dashboard.png`, fullPage: true });
  await t.click('#tab-trials'); await t.locator('tr', { hasText: TRIAL }).getByRole('button', { name: 'Close' }).click();
  await t.waitForSelector(`tr:has-text("${TRIAL}") .chip.closed`);
  await a.goto(B + '/oracle.html'); await a.locator('.row', { hasText: TRIAL }).getByText('See results').click();
  await a.waitForSelector('.opt.right');
  check((await a.locator('.opt.right').count()) === 8 && /right answers are marked/.test(await a.textContent('main')), 'after closing, A reviews all 8 answers');

  for (const [n, p] of [['teacher', t], ['A', a], ['C', c]]) check(!p.errs.length, `${n} page errors: ${p.errs.length ? [...new Set(p.errs)].join(' | ') : 'none'}`);
  console.log(results.join('\n'));
  await br.close();
})().catch(e => { console.log(results.join('\n')); console.error('FAIL', e.message.split('\n').slice(0, 2).join(' ')); process.exit(1); });
