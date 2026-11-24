// Stage 7 API test. A authors (alliance 1); B is A's teammate; C is in another alliance.
const ENV = require('../lib/env');
const B_ = ENV.API;
const call = async (t, m, p, b) => { const r = await fetch(B_ + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j }; };
const login = async (k, e) => (await call(null, 'POST', `/auth/${k}/login`, { email: e, password: 'pw-test-1' })).token;
const problems = []; const note = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) problems.push(msg); };
const STORY = 'Theseus came to the gate of the maze at night. Only the bronze key opens the gate. He searched the ruins until he found it, and walked out free.';

(async () => {
  const T = await login('teacher', 'teacher@test.local');
  const [A, Bt, C] = await Promise.all(['A', 'B', 'C'].map(l => login('student', `stu${l}@test.local`)));
  await call(T, 'POST', '/teacher/island/reset-test', { confirm_period: 'Test' });
  const q = (await call(A, 'GET', '/island/me')).quests.find(x => x.pin_type === 'guardian');
  const pin = (await call(A, 'POST', '/island/pins', { quest_id: q.quest_id, x_pct: 30, y_pct: 30 })).pin;
  await call(A, 'PATCH', `/island/pins/${pin.pin_id}`, { title: 'The Night Gate', body: STORY });
  const feat = (await call(A, 'POST', '/island/pins', { feature_type: 'river', x_pct: 10, y_pct: 10 })).pin;

  console.log('== Building');
  const tp = await call(A, 'GET', '/games/templates');
  note(tp.templates.length === 3 && tp.limits.inventor.maxRules === 8, `3 templates; Inventor limit ${tp.limits.inventor.maxRules} rules`);
  note((await call(A, 'PUT', `/games/pin/${feat.pin_id}`, { from_template: 'locked_gate' })).status === 400, 'a named place can\'t have a game');
  let g = await call(A, 'PUT', `/games/pin/${pin.pin_id}`, { level: 'starter', from_template: 'locked_gate' });
  note(g.game.things.length === 10 && /survival clue/.test(g.game.check.problems[0]), `Starter from "The Locked Gate": "${g.game.check.problems[0]}"`);
  const body = d => ({ level: d.level, template: d.template, things: d.things, rules: d.rules, start: d.start, clue_text: d.clue_text });
  g.game.clue_text = 'The key is under the bed.';
  g = await call(A, 'PUT', `/games/pin/${pin.pin_id}`, body(g.game));
  note(/sentence from your story/.test(g.game.check.problems[0]), `a clue that isn't in the story: "${g.game.check.problems[0]}"`);
  g.game.clue_text = 'Only the bronze key opens the gate.';
  g.game.things.find(t => t.id === 'key').name = 'Bronze key of Minos';
  g.game.rules[1].then.text = 'Locked! Read the story again.';
  g = await call(A, 'PUT', `/games/pin/${pin.pin_id}`, body(g.game));
  note(g.game.check.ok && g.game.check.winning_moves > 0, `renamed + reworded, clue from the story → check passes (win in ${g.game.check.winning_moves} moves)`);
  const extra = JSON.parse(JSON.stringify(g.game)); extra.things.push({ id: 'snake', name: 'Snake', emoji: '🐍', type: 'obstacle', x: 4, y: 4 });
  let r = await call(A, 'PUT', `/games/pin/${pin.pin_id}`, body(extra));
  note(/Starter level/.test(r.game.check.problems[0]), `Starter can't add things: "${r.game.check.problems[0].slice(0, 70)}…"`);
  extra.level = 'builder';
  r = await call(A, 'PUT', `/games/pin/${pin.pin_id}`, body(extra));
  note(r.game.check.ok, 'switching to Builder allows the extra thing');
  const noWin = JSON.parse(JSON.stringify(r.game)); noWin.rules = noWin.rules.filter(x => x.then.do !== 'open_path');
  r = await call(A, 'PUT', `/games/pin/${pin.pin_id}`, body(noWin));
  note(/No one can survive/.test(r.game.check.problems[0]), `removing the "open the gate" rule: "${r.game.check.problems[0]}"`);
  note((await call(A, 'POST', `/games/pin/${pin.pin_id}/submit`)).status === 400, 'a game nobody can win can\'t be submitted');
  r = await call(A, 'PUT', `/games/pin/${pin.pin_id}`, { level: 'inventor', blank: true, clue_text: 'Only the bronze key opens the gate.' });
  note(r.game.things.length === 0 && r.game.check.problems.includes('Add a rule that lets the reader survive.'), 'Inventor starts blank and asks for a "survive" rule');
  const many = { level: 'inventor', clue_text: 'Only the bronze key opens the gate.', start: { x: 0, y: 0 },
    things: [{ id: 'exit', name: 'Exit', emoji: '🚩', type: 'place', x: 3, y: 0 }, { id: 'x1', name: '<b>Sneaky</b>', emoji: 'NOT-AN-EMOJI', type: 'item', x: 5, y: 5 }],
    rules: Array.from({ length: 9 }, () => ({ when: { event: 'enters', thing: 'exit' }, then: { do: 'survive' } })) };
  r = await call(A, 'PUT', `/games/pin/${pin.pin_id}`, many);
  note(r.game.check.problems.includes('Use at most 8 rules at this level.'), 'Inventor is capped at 8 rules');
  note(r.game.things[1].emoji === '⭐' && r.game.things[1].name === '<b>Sneaky</b>', 'an unknown picture becomes ⭐; names are kept as plain text (pages show them as text)');
  // back to the good Builder game and submit
  r = await call(A, 'PUT', `/games/pin/${pin.pin_id}`, body(extra));
  note((await call(A, 'POST', `/games/pin/${pin.pin_id}/submit`)).status === 'submitted', 'the good game is submitted');
  note((await call(A, 'PUT', `/games/pin/${pin.pin_id}`, body(extra))).status === 409, 'it can\'t be changed while with the teacher');

  console.log('\n== Teacher, teammate play-test, publishing');
  let bv = await call(Bt, 'GET', `/games/pin/${pin.pin_id}`);
  note(!bv.game && !bv.can_play, 'teammate B can\'t see it before the teacher approves it');
  const tq = await call(T, 'GET', '/teacher/games?period=Test');
  note(tq.games.length === 1 && tq.games[0].check.ok && tq.games[0].student_name === 'Student A', 'teacher queue shows it with a passing check');
  note((await call(T, 'POST', `/teacher/games/${pin.pin_id}/review`, { action: 'return' })).status === 400, 'returning needs a note');
  await call(T, 'POST', `/teacher/games/${pin.pin_id}/review`, { action: 'approve' });
  bv = await call(Bt, 'GET', `/games/pin/${pin.pin_id}`);
  note(bv.can_play && bv.can_playtest && bv.game.teacher_note === undefined, 'after approval B can play-test it');
  note((await call(C, 'GET', `/games/pin/${pin.pin_id}`)).can_play === false, 'C (another alliance) can\'t play it yet');
  note((await call(Bt, 'POST', `/games/pin/${pin.pin_id}/playtest`, { result: 'my free text' })).status === 400, 'play-test feedback must be one of the fixed answers');
  await call(Bt, 'POST', `/games/pin/${pin.pin_id}/playtest`, { result: 'cant_survive' });
  let av = await call(A, 'GET', `/games/pin/${pin.pin_id}`);
  note(av.game.status === 'returned' && /couldn't find a way to survive/.test(av.game.teacher_note), `A sees: "${av.game.teacher_note}"`);
  await call(A, 'POST', `/games/pin/${pin.pin_id}/submit`);
  await call(T, 'POST', `/teacher/games/${pin.pin_id}/review`, { action: 'approve' });
  note((await call(A, 'POST', `/games/pin/${pin.pin_id}/playtest`, { result: 'works' })).status === 403, 'the author can\'t play-test their own game');
  await call(Bt, 'POST', `/games/pin/${pin.pin_id}/playtest`, { result: 'works' });
  av = await call(A, 'GET', `/games/pin/${pin.pin_id}`);
  note(av.game.status === 'published' && av.game.playtested, 'B says it works → published');
  note((await call(C, 'GET', `/games/pin/${pin.pin_id}`)).can_play === false, 'C still can\'t: the story itself isn\'t published/visited');
  note((await call(T, 'GET', `/games/pin/${pin.pin_id}`)).can_play, 'the teacher can always play it');
  note((await call(A, 'PUT', `/games/pin/${pin.pin_id}`, body(extra))).status === 409, 'a published game can\'t be changed directly');
  await call(A, 'POST', `/games/pin/${pin.pin_id}/edit-again`);
  note((await call(Bt, 'GET', `/games/pin/${pin.pin_id}`)).can_play === false, '"Edit again" takes it out of play until approved again');

  console.log(`\nPROBLEMS (${problems.length})` + (problems.length ? ':\n - ' + problems.join('\n - ') : ''));
})().catch(e => { console.error('CRASH', e); process.exit(1); });
