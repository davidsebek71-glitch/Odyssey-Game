const ENV = require('../lib/env');
const { chromium } = require('playwright');
const SC = ENV.SHOTS + '/voyage_shots';
require('fs').mkdirSync(SC, { recursive: true });
const B = ENV.BASE;
const call = async (t, m, p, b) => (await fetch(B + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json();
const login = async (k, e) => (await call(null, 'POST', `/auth/${k}/login`, { email: e, password: 'pw-test-1' })).token;
const results = []; const check = (ok, m) => { results.push((ok ? '✓ ' : '✗ ') + m); };
const words = n => Array.from({ length: n }, (_, i) => ['the', 'shrine', 'keeps', 'hope', 'safe', 'for', 'everyone'][i % 7]).join(' ');

(async () => {
  const T = await login('teacher', 'teacher@test.local'), A = await login('student', 'stuA@test.local'), C = await login('student', 'stuC@test.local');
  await call(T, 'POST', '/teacher/island/reset-test', { confirm_period: 'Test' });
  await call(T, 'POST', '/teacher/voyage/settings', { class_period: 'Test', mode: 'build', tokens_per_publish: 2, visit_cap: 2, visitor_points: 5, author_points: 3, min_response_words: 15 });
  await call(T, 'POST', '/teacher/force-pass-quiz', { student_name: 'Student A', class_period: 'Test', portal_id: 1, score: 9, total_questions: 10 });
  const br = await chromium.launch();
  async function open(tok, url, who) {
    const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); p.setDefaultTimeout(15000);
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); });
    p.on('dialog', d => d.accept());
    await p.goto(B + '/index.html');
    await p.evaluate(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [tok, who]);
    await p.goto(B + url); return p;
  }

  // ── A writes a piece with a question
  const a = await open(A, '/island.html', { name: 'Student A', type: 'student' });
  await a.waitForSelector('.quest'); await a.getByRole('button', { name: 'Start' }).first().click(); await a.waitForSelector('#f-title');
  const bx = await a.locator('.map-wrap img').boundingBox(); await a.mouse.click(bx.x + bx.width * 0.45, bx.y + bx.height * 0.5);
  await a.fill('#f-title', 'The Shrine of the Last Hope');
  await a.fill('#f-body', 'Hope stayed in the jar when everything else escaped. '.repeat(10).trim());
  check(/question/i.test(await a.textContent('#why-not')), `before the question: "${await a.textContent('#why-not')}"`);
  await a.fill('#q-prompt', 'What stayed in the jar?');
  const choiceInputs = a.locator('.q-row input[type=text]');
  await choiceInputs.nth(0).fill('Greed'); await choiceInputs.nth(1).fill('Hope'); await choiceInputs.nth(2).fill('Fire');
  check(/Mark which answer/.test(await a.textContent('#why-not')), `no correct answer marked: "${await a.textContent('#why-not')}"`);
  await a.locator('.q-row input[type=radio]').nth(1).check();
  await a.waitForFunction(() => document.getElementById('save-state').textContent === 'Saved', null, { timeout: 8000 });
  check(!(await a.isDisabled('#submit-btn')), 'question complete → Submit enabled, and saved');
  await a.screenshot({ path: `${SC}/1-question-editor.png`, fullPage: true });
  await a.click('#submit-btn'); await a.waitForSelector('.banner.warn');

  // ── Teacher approves (sees the question), opens a voyage, gives tokens
  const t = await open(T, '/island_review.html', { name: 'Teacher', type: 'teacher' });
  await t.waitForSelector('.card .q');
  check((await t.textContent('.card .q')).includes('Hope ✓'), 'teacher sees the question with the right answer marked');
  await t.click('.card .btn.approve'); await t.waitForSelector('text=Published');
  await t.selectOption('#period', 'Test'); await t.click('#tab-voyages'); await t.waitForSelector('.phase');
  const argoTokens = await t.locator('table').first().locator('tr', { hasText: 'Test Argonauts' }).locator('td.n').textContent();
  check(argoTokens === '2', `Voyages tab: Test Argonauts has ${argoTokens} tokens from the approved piece`);

  // ── C in build time
  const c = await open(C, '/world.html', { name: 'Student C', type: 'student' });
  await c.waitForSelector('.island');
  check(/Build time/.test(await c.textContent('#status')), 'C\'s world map says "Build time"');
  await c.locator('.island', { hasText: 'Test Argonauts' }).click(); await c.waitForSelector('.member');
  check(/Closed until the voyage/.test(await c.textContent('#detail')), 'islands of other alliances are closed during build time');
  await c.screenshot({ path: `${SC}/2-world-build.png` });

  // ── Teacher opens the voyage and adds 2 tokens to C's alliance
  await t.getByRole('button', { name: '⛵ Voyage' }).click(); await t.waitForSelector('text=⛵ Voyage open');
  for (let i = 0; i < 2; i++) { await t.getByRole('button', { name: 'Add a token for Test Spartans' }).click(); await t.waitForTimeout(600); }
  const spTokens = await t.locator('table').first().locator('tr', { hasText: 'Test Spartans' }).locator('td.n').textContent();
  check(spTokens === '2', `teacher opened a voyage and gave Test Spartans tokens (${spTokens})`);
  await t.screenshot({ path: `${SC}/3-teacher-voyages.png`, fullPage: true });

  // ── C sails to A's island and visits
  await c.reload(); await c.waitForSelector('.island');
  check(/A voyage is open/.test(await c.textContent('#status')) && /2 voyage tokens/.test(await c.textContent('#status')), 'C sees the voyage is open with 2 tokens');
  await c.locator('.island', { hasText: 'Test Argonauts' }).click();
  await c.locator('.member', { hasText: 'Student A' }).getByText('Sail to this island →').click();
  await c.waitForURL('**/island.html?student=1'); await c.waitForSelector('#panel .quest');
  check(!(await c.textContent('#panel')).includes('Hope stayed'), 'before visiting, C cannot read the piece');
  await c.getByRole('button', { name: '⛵ Visit (1 voyage token)' }).click();
  await c.waitForSelector('#start-visit'); await c.screenshot({ path: `${SC}/4-visit-teaser.png` });
  await c.click('#start-visit'); await c.waitForSelector('.opt');
  check((await c.textContent('.viewer-body')).includes('Hope stayed in the jar'), 'after spending a token, C reads the piece');
  await c.locator('.opt', { hasText: /^Greed$/ }).click(); await c.waitForSelector('text=Not quite');
  check(true, 'wrong answer: "Not quite. Read the piece again and try once more."');
  await c.locator('.opt', { hasText: /^Hope$/ }).click(); await c.waitForSelector('text=✓ Right!');
  await c.waitForSelector('#resp');
  check(await c.isDisabled('#finish-visit'), 'Finish is disabled until the response is long enough');
  await c.fill('#resp', words(10));
  check((await c.textContent('#resp-count')).includes('10 / 15') && await c.isDisabled('#finish-visit'), `count: ${await c.textContent('#resp-count')}`);
  await c.fill('#resp', 'I liked how hope is the one thing left. ' + words(12));
  check(!(await c.isDisabled('#finish-visit')), 'with enough words Finish is enabled');
  await c.screenshot({ path: `${SC}/5-visit-respond.png`, fullPage: true });
  await c.click('#finish-visit'); await c.waitForSelector('text=Visit complete!');
  check(/\+5 points/.test(await c.textContent('#panel')), 'C: "Visit complete! +5 points for your alliance."');
  await c.goto(B + '/world.html'); await c.waitForSelector('.island');
  check(/1 voyage token/.test(await c.textContent('#status')) && /1 of 2 visits/.test(await c.textContent('#status')), `world map after: ${(await c.textContent('#status')).replace(/\s+/g, ' ').slice(0, 120)}`);

  // ── Teacher approves the response; A reads it
  await t.click('#tab-responses'); await t.waitForSelector('.card .btn.approve');
  check((await t.textContent('main')).includes('I liked how hope is the one thing left.'), 'teacher sees C\'s response');
  await t.screenshot({ path: `${SC}/6-teacher-responses.png` });
  await t.click('.card .btn.approve'); await t.waitForSelector('text=Approved');
  await a.reload(); await a.waitForSelector('.quest'); await a.getByRole('button', { name: 'View' }).first().click();
  await a.waitForSelector('.response');
  check((await a.textContent('.response')).includes('I liked how hope is the one thing left.') && (await a.textContent('.response')).includes('Student C'), 'A reads C\'s approved response under the piece');
  await a.screenshot({ path: `${SC}/7-author-sees-response.png`, fullPage: true });

  for (const [n, p] of [['A', a], ['teacher', t], ['C', c]]) check(!p.errs.length, `${n} page errors: ${p.errs.length ? [...new Set(p.errs)].join(' | ') : 'none'}`);
  console.log(results.join('\n'));
  await br.close();
})().catch(e => { console.log(results.join('\n')); console.error('FAIL', e.message.split('\n')[0]); process.exit(1); });
