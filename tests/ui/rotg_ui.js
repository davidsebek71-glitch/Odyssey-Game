// Two real browser windows (Student A, Student B) play Revenge of the Gods
// through the actual page buttons for 2 full rounds.
const ENV = require('../lib/env');
const { chromium } = require('playwright');
const SC = ENV.SHOTS + '/shots2';
const B = ENV.BASE;
const WORDS = { 1: 'box', 2: 'chariot', 3: 'pegasus', 4: 'labyrinth', 5: '6849' };
const STOP_AT_ROUND = 3;   // stop once both reach round 3 path choice
require('fs').mkdirSync(SC, { recursive: true });

async function api(tok, method, path, body) {
  const r = await fetch(B + '/api' + path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
const login = async (k, e) => (await (await fetch(`${B}/api/auth/${k}/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: e, password: 'pw-test-1' }) })).json()).token;

(async () => {
  const T = await login('teacher', 'teacher@test.local');
  const tok = { A: await login('student', 'stuA@test.local'), B: await login('student', 'stuB@test.local') };
  if (process.argv[2] !== 'noreset') {
    await api(T, 'POST', '/olympus/teacher/reset-race', { period: 'Test', confirm_period: 'Test' });
    await api(T, 'POST', '/teacher/set-points', { alliance_id: 1, new_total: 1000, reason: 'ui test' });
    await api(T, 'POST', '/olympus/teacher/start-race', { period: 'Test' });
  }

  const br = await chromium.launch();
  const players = {};
  for (const who of ['A', 'B']) {
    const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage(); page.setDefaultTimeout(5000);
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
    page.on('dialog', d => { errs.push('ALERT: ' + d.message()); d.dismiss(); });
    await page.goto(B + '/index.html');
    await page.evaluate(t => localStorage.setItem('token', t), tok[who]);
    await page.goto(B + '/revenge_of_the_gods.html');
    players[who] = { page, errs, log: [], done: false, last: '', shots: new Set() };
  }

  const vis = async (p, sel) => { try { return await p.locator(sel).first().isVisible(); } catch { return false; } };
  const checks = [];
  const check = (ok, msg) => { checks.push((ok ? '✓ ' : '✗ ') + msg); };

  async function step(who) {
    const P = players[who], p = P.page;
    const st = await api(tok[who], 'GET', '/olympus/state');
    const round = st.state.current_round, phase = st.state.current_phase;
    if (round >= STOP_AT_ROUND && phase === 'path_choice') { P.done = true; return; }
    const act = async (name, fn) => { if (P.last !== name + round) P.log.push(`r${round} ${phase}: ${name}`); P.last = name + round; await fn(); };
    const shot = async name => { if (!P.shots.has(name)) { P.shots.add(name); await p.screenshot({ path: `${SC}/${who}-${name}.png` }); } };

    if (await vis(p, '#title-enter-btn') && await p.locator('#title-enter-btn').isEnabled()) return act('title', () => p.click('#title-enter-btn'));
    if (await vis(p, '#medea-accept-btn') && await p.locator('#medea-accept-btn').isEnabled()) return act('medea accept', () => p.click('#medea-accept-btn'));
    if (await vis(p, 'button[onclick="enterRaceFromAgora()"]')) return act('enter race from agora', () => p.click('button[onclick="enterRaceFromAgora()"]'));
    if (phase === 'path_choice' && await vis(p, '.path-card') && await vis(p, '#commit-path-btn')) {
      if (await p.locator('#commit-path-btn').isEnabled()) return act('commit path', () => p.click('#commit-path-btn'));
      await shot(`r${round}-paths`);
      // pick the first unlocked, non-safe-looking card (index 0 is always a combat path)
      return act('select path 0', () => p.locator('.path-card').first().click());
    }
    if (await vis(p, '#fight-btn') && await p.locator('#fight-btn').isEnabled()) { await shot(`r${round}-combat-story`); return act('fight', () => p.click('#fight-btn')); }
    if (await vis(p, '#btn-accept-fate') && await p.locator('#btn-accept-fate').isEnabled()) return act('skip spell', () => p.click('#btn-accept-fate'));
    if (await vis(p, '#trivia-answer-grid button:not([disabled])')) {
      await shot(`r${round}-trivia`);
      const q = await p.textContent('#trivia-question-text');
      check(!!q && q.trim().length > 5, `[${who}] round ${round} trivia question shown on screen: "${(q || '').trim().slice(0, 45)}"`);
      return act('answer trivia', () => p.locator('#trivia-answer-grid button:not([disabled])').first().click());
    }
    if (await vis(p, '#btn-continue-combat') && await p.locator('#btn-continue-combat').isEnabled()) return act('continue combat', () => p.click('#btn-continue-combat'));
    if (await vis(p, '#secret-word-input')) {
      const input = p.locator('#secret-word-input');
      const msg = (await p.textContent('#unlock-msg')) || '';
      if (await input.isEnabled()) {
        await shot(`r${round}-puzzle`);
        check(true, `[${who}] round ${round} secret word input is ENABLED on the puzzle screen`);
        await input.fill(WORDS[round]);
        return act('submit secret word', () => p.click('#round-unlock-wrap .btn-commit'));
      }
      // disabled: fine only if this student already submitted for this round
      if (!st.state.my_unlock_submitted && !/gates open|Waiting|accepted/i.test(msg)) {
        await shot(`r${round}-puzzle-LOCKED`);
        check(false, `[${who}] round ${round} secret word input is DISABLED but this student has not submitted (Bug 3)`);
      }
      return;
    }
  }

  const t0 = Date.now();
  while (!(players.A.done && players.B.done) && Date.now() - t0 < 8 * 60 * 1000) {
    for (const w of ['A', 'B']) if (!players[w].done) { try { await step(w); } catch (e) { players[w].errs.push('driver: ' + e.message.split('\n')[0]); } }
    await new Promise(r => setTimeout(r, 700));
  }
  const fin = await api(tok.A, 'GET', '/olympus/state');
  for (const w of ['A', 'B']) {
    console.log(`\n== Student ${w} actions:\n  ` + players[w].log.join('\n  '));
    console.log(`  page errors: ${players[w].errs.length ? '\n   - ' + [...new Set(players[w].errs)].join('\n   - ') : 'none'}`);
  }
  console.log('\n== Checks\n' + [...new Set(checks)].join('\n'));
  console.log(`\nfinished: round ${fin.state.current_round} phase ${fin.state.current_phase}, points ${fin.alliance.total_points}, ${Math.round((Date.now() - t0) / 1000)}s`);
  const ok = players.A.done && players.B.done;
  console.log(ok ? `✓ both students reached round ${STOP_AT_ROUND} through the page` : `✗ TIMED OUT before both students reached round ${STOP_AT_ROUND}`);
  for (const w of ['A', 'B']) if (players[w].errs.length) console.log(`✗ Student ${w} had page errors`);
  if (!ok) process.exitCode = 1;
  await br.close();
})().catch(e => { console.error('CRASH', e); process.exit(1); });
