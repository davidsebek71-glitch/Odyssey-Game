// Multi-alliance path-collision test (period "Test").
// Alliances: 1 = A,B   2 = C,D   3 = E,F (+I added here, 3 members)   4 = G,H
const ENV = require('../lib/env');
const B = ENV.API;
const call = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j }; };
const login = async (k, e) => (await call(null, 'POST', `/auth/${k}/login`, { email: e, password: 'pw-test-1' })).token;
const problems = [];
const note = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) problems.push(msg); };

(async () => {
  const T = await login('teacher', 'teacher@test.local');
  // Add a third member (I) to alliance 3 if not already there
  let ti = await login('student', 'stuI@test.local');
  if (!ti) {
    await call(null, 'POST', '/auth/student/register', { name: 'Student I', email: 'stuI@test.local', password: 'pw-test-1', class_period: 'Test' });
    ti = await login('student', 'stuI@test.local');
    const tE = await login('student', 'stuE@test.local');
    const me = await call(ti, 'GET', '/olympus/state'); // not in alliance yet → error; we just need the id
    const allS = await call(T, 'GET', '/teacher/students');
    const iId = (Array.isArray(allS) ? allS : (allS.students || [])).find(s => s.email === 'stuI@test.local').student_id;
    await call(tE, 'POST', '/alliance/invite', { invited_student_id: iId });
    const inv = await call(ti, 'GET', '/student/invitations');
    await call(ti, 'POST', '/alliance/respond-invitation', { invitation_id: inv[0].invitation_id, accept: true });
  }
  const tok = {}; for (const l of 'ABCDEFGHI') tok[l] = await login('student', `stu${l}@test.local`);
  const teams = { 1: ['A', 'B'], 2: ['C', 'D'], 3: ['E', 'F', 'I'], 4: ['G', 'H'] };

  async function freshRound1() {
    await call(T, 'POST', '/olympus/teacher/reset-race', { period: 'Test', confirm_period: 'Test' });
    for (const aid of Object.keys(teams)) await call(T, 'POST', '/teacher/set-points', { alliance_id: +aid, new_total: 1000, reason: 'multi test' });
    await call(T, 'POST', '/olympus/teacher/start-race', { period: 'Test' });
    for (const ms of Object.values(teams)) {
      for (const m of ms) await call(tok[m], 'GET', '/olympus/state');
      for (const m of ms) { await call(tok[m], 'POST', '/olympus/title-ready'); await call(tok[m], 'POST', '/olympus/medea-vote', { choice: 'accept' }); }
      await call(tok[ms[0]], 'POST', '/olympus/medea-commit');
      for (const m of ms) await call(tok[m], 'POST', '/olympus/agora-ready');
      await call(tok[ms[0]], 'POST', '/olympus/agora-visited');
    }
  }
  const phase = async aid => (await call(tok[teams[aid][0]], 'GET', '/olympus/state')).state.current_phase;
  const locks = async () => (await call(tok.A, 'GET', '/olympus/paths/1')).paths.filter(p => p.locked).map(p => `${p.idx}:${p.locked_by.alliance_name}`).join(', ');
  const vote = (m, idx) => call(tok[m], 'POST', '/olympus/vote-path', { path_index: idx });

  // ── Scenario 1 ──
  console.log('== Scenario 1: every student in all 4 alliances votes path 0 at the same moment');
  await freshRound1();
  const order = Object.entries(teams).flatMap(([aid, ms]) => ms.map(m => ({ aid, m })));
  const res = await Promise.all(order.map(o => vote(o.m, 0).then(r => ({ ...o, r }))));
  const winners = [];
  for (const aid of Object.keys(teams)) if (await phase(aid) === 'combat') winners.push(aid);
  note(winners.length === 1, `exactly one alliance got path 0 (alliance ${winners.join(',')}); locks: ${await locks()}`);
  const falseLocked = res.filter(x => x.r.committed && !winners.includes(x.aid));
  note(falseLocked.length === 0, `no losing student was told "Path locked!" (${falseLocked.length} were)`);
  for (const aid of Object.keys(teams).filter(a => !winners.includes(a))) {
    const mine = res.filter(x => x.aid === aid);
    const told = mine.filter(x => x.r.path_taken);
    console.log(`    alliance ${aid}: ${mine.map(x => `${x.m}→${x.r.status}${x.r.path_taken ? ' "' + x.r.error + '"' : ''}`).join(' | ')}`);
    // Following the page: every student who got the "taken" message is back on the cards and picks again
    // (the first such student picks the first free path; teammates who also got the message agree).
    // Students who got a plain "waiting" response stay on the waiting screen and do nothing.
    const pickers = told.length ? told : [mine[mine.length - 1]];
    const free = (await call(tok[pickers[0].m], 'GET', '/olympus/paths/1')).paths.find(p => !p.locked && !p.safe);
    for (const pk of pickers) { if (await phase(aid) === 'combat') break; await vote(pk.m, free.idx); }
    const ph = await phase(aid);
    console.log(`      ${pickers.map(x => x.m).join(',')} re-picked path ${free.idx}; waiting-screen students: ${mine.filter(x => !pickers.includes(x)).map(x => x.m).join(',') || 'none'}`);
    note(ph === 'combat', `alliance ${aid}: after re-picking path ${free.idx} → phase ${ph}`);
  }

  // ── Scenario 2 ──
  console.log('\n== Scenario 2: out-of-date screen — student votes a path another alliance just took');
  await freshRound1();
  await vote('A', 3); await vote('B', 3);
  note(await phase(1) === 'combat', 'alliance 1 took path 3');
  const stale = await vote('C', 3);
  note(stale.status === 409 && stale.path_taken, `student C voting path 3 → ${stale.status} "${stale.error}"`);
  await vote('C', 1); const d = await vote('D', 1);
  note(d.committed && await phase(2) === 'combat', `alliance 2 then agrees on path 1 → committed=${!!d.committed}`);

  // ── Scenario 3 ──
  console.log('\n== Scenario 3: 3-member alliance with one vote left on a path that gets taken');
  await freshRound1();
  await vote('E', 0);                                   // E votes path 0, waits for teammates
  await vote('G', 0); await vote('H', 0);              // alliance 4 takes path 0
  note(await phase(4) === 'combat', 'alliance 4 took path 0 while E was waiting');
  const f = await vote('F', 2);
  note(!f.committed && await phase(3) === 'path_choice', `F votes path 2 → waits (E's vote for taken path 0 can't win, F alone isn't a majority)`);
  const i = await vote('I', 4);
  note(i.committed && await phase(3) === 'combat', `I votes path 4 → all 3 voted, tie-break picks an available path → committed=${!!i.committed}, locks: ${await locks()}`);
  const lk = (await call(tok.A, 'GET', '/olympus/paths/1')).paths.find(p => p.locked_by && p.locked_by.alliance_id === 3);
  note(lk && lk.idx === 2, `tie-break chose path ${lk && lk.idx} (lowest of the tied available paths 2 and 4)`);

  console.log(`\nPROBLEMS (${problems.length})` + (problems.length ? ':\n - ' + problems.join('\n - ') : ''));
})().catch(e => { console.error('CRASH', e); process.exit(1); });
