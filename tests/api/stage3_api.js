// Stage 3 API test (period "Test"). A = no accommodations, C = short set + chunked + large text.
const ENV = require('../lib/env');
const fs = require('fs');
const B = ENV.API;
const call = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j }; };
const login = async (k, e) => (await call(null, 'POST', `/auth/${k}/login`, { email: e, password: 'pw-test-1' })).token;
const problems = []; const note = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) problems.push(msg); };
const sample = JSON.parse(fs.readFileSync(ENV.REPO + '/data/oracle_trial_format.json', 'utf8'));
const pts = async t => (await call(t, 'GET', '/olympus/state')).alliance.total_points;

(async () => {
  const T = await login('teacher', 'teacher@test.local');
  const [A, Bt, C] = await Promise.all(['A', 'B', 'C'].map(l => login('student', `stu${l}@test.local`)));
  const ids = {}; for (const [n, t] of [['A', A], ['C', C], ['B', Bt]]) ids[n] = (await call(t, 'GET', '/island/me')).student.student_id;

  console.log('== Authoring and import');
  let r = await call(T, 'POST', '/teacher/oracle/trials', Object.assign({}, sample, { title: '' }));
  note(r.status === 400 && /title/.test(r.error), `no title → "${r.error}"`);
  r = await call(T, 'POST', '/teacher/oracle/trials', Object.assign({}, sample, { questions: [Object.assign({}, sample.questions[0], { question_type: 'vibes' })] }));
  note(r.status === 400 && /question type/.test(r.error), `bad question type → "${r.error.slice(0, 60)}…"`);
  r = await call(T, 'POST', '/teacher/oracle/trials', Object.assign({}, sample, { questions: [Object.assign({}, sample.questions[1], { section_index: 9 })] }));
  note(r.status === 400 && /section/.test(r.error), `section outside the passage → "${r.error}"`);
  const t1 = await call(T, 'POST', '/teacher/oracle/trials', Object.assign({}, sample, { title: 'Week 1 test trial', week: 1 }));
  const t2 = await call(T, 'POST', '/teacher/oracle/trials', Object.assign({}, sample, { title: 'Week 2 test trial', week: 2 }));
  note(t1.trial_id && t1.questions === 8 && t1.word_count > 200, `imported two trials (${t1.questions} questions, ${t1.word_count} words)`);
  const full = await call(T, 'GET', `/teacher/oracle/trials/${t1.trial_id}`);
  const qs = full.questions; const correct = Object.fromEntries(qs.map(q => [q.question_id, q.correct_index]));

  console.log('\n== Accommodations are private');
  await call(T, 'PUT', `/teacher/accommodations/${ids.C}`, { settings: { short_set: true, chunked: true, large_text: true, read_aloud: true } });
  await call(T, 'PUT', `/teacher/accommodations/${ids.A}`, { settings: {} });
  const acc = await call(T, 'GET', '/teacher/accommodations?period=Test');
  note(acc.students.find(s => s.student_id === ids.C).settings.chunked === true, 'teacher sets and sees C\'s accommodations');
  note((await call(A, 'GET', '/teacher/accommodations?period=Test')).status === 403, 'students cannot see anyone\'s accommodations');

  console.log('\n== Taking a trial');
  note((await call(A, 'GET', `/oracle/trials/${t1.trial_id}`)).status === 404, 'not assigned yet → not available');
  await call(T, 'POST', `/teacher/oracle/trials/${t1.trial_id}/assign`, { class_period: 'Test', status: 'open' });
  await call(T, 'POST', `/teacher/oracle/trials/${t2.trial_id}/assign`, { class_period: 'Test', status: 'open' });
  const list = await call(A, 'GET', '/oracle/trials');
  note(list.trials.some(t => t.trial_id === t1.trial_id && t.period_status === 'open'), 'A sees the open trial');
  const va = await call(A, 'GET', `/oracle/trials/${t1.trial_id}`);
  note(va.questions.length === 8 && va.questions.every(q => q.correct_index === undefined) && va.trial.sections.length === 4, 'A gets the passage (4 sections) and 8 questions, no answers');
  note(Object.values(va.accommodations).every(v => !v), 'A has no accommodations');
  const vc = await call(C, 'GET', `/oracle/trials/${t1.trial_id}`);
  note(vc.questions.length === 5 && vc.accommodations.short_set && vc.accommodations.chunked && vc.accommodations.large_text,
    `C gets the shortened set (${vc.questions.length} questions) with chunked + large text applied`);
  note(vc.questions.filter(q => q.section_index !== null).every(q => q.section_index >= 0 && q.section_index < 4), 'C\'s questions carry their section numbers for the chunked view');
  await call(A, 'PUT', `/oracle/trials/${t1.trial_id}/answers`, { answers: { [qs[0].question_id]: correct[qs[0].question_id] } });
  const resumed = await call(A, 'GET', `/oracle/trials/${t1.trial_id}`);
  note(resumed.answers[qs[0].question_id] === correct[qs[0].question_id], 'answers autosave and come back on reopening');
  let sub = await call(A, 'POST', `/oracle/trials/${t1.trial_id}/submit`);
  note(sub.status === 400 && sub.unanswered === 7, `turning in with blanks asks first: "${sub.error}"`);
  await call(A, 'PUT', `/oracle/trials/${t1.trial_id}/answers`, { answers: correct });
  const before = await pts(A);
  sub = await call(A, 'POST', `/oracle/trials/${t1.trial_id}/submit`);
  note(sub.result.score === 8 && sub.result.percentage === 100 && sub.result.by_type.inference.total === 3, `A scores ${sub.result.score}/${sub.result.total}; by type: ${Object.entries(sub.result.by_type).map(([k, v]) => `${k} ${v.correct}/${v.total}`).join(', ')}`);
  note(sub.points_this_time === 5 && (await pts(A)) === before + 5, 'first trial: 5 base points, no growth bonus yet');
  note(!sub.result.review_open && sub.questions.every(q => q.correct_index === undefined), 'while the trial is open, the review (right answers) stays hidden');
  note((await call(A, 'PUT', `/oracle/trials/${t1.trial_id}/answers`, { answers: {} })).status === 409, 'answers can\'t change after turning in');

  console.log('\n== Growth reward');
  // C: 2 of 5 on week 1, then everything right on week 2
  const cIds = vc.questions.map(q => q.question_id);
  await call(C, 'PUT', `/oracle/trials/${t1.trial_id}/answers`, { answers: Object.fromEntries(cIds.map((id, i) => [id, i < 2 ? correct[id] : (correct[id] + 1) % 4])) });
  const c1 = await call(C, 'POST', `/oracle/trials/${t1.trial_id}/submit`);
  note(c1.result.percentage === 40 && c1.points_this_time === 5, `C week 1: ${c1.result.percentage}%, ${c1.points_this_time} points`);
  const full2 = await call(T, 'GET', `/teacher/oracle/trials/${t2.trial_id}`);
  const correct2 = Object.fromEntries(full2.questions.map(q => [q.question_id, q.correct_index]));
  await call(C, 'GET', `/oracle/trials/${t2.trial_id}`);
  await call(C, 'PUT', `/oracle/trials/${t2.trial_id}/answers`, { answers: correct2 });
  const c2 = await call(C, 'POST', `/oracle/trials/${t2.trial_id}/submit`);
  note(c2.result.percentage === 100 && c2.points_this_time === 20, `C week 2: ${c2.result.percentage}% → ${c2.points_this_time} points (5 + growth bonus, capped at 15)`);
  await call(A, 'GET', `/oracle/trials/${t2.trial_id}`);
  await call(A, 'PUT', `/oracle/trials/${t2.trial_id}/answers`, { answers: Object.fromEntries(Object.entries(correct2).map(([k, v], i) => [k, i % 2 ? v : (v + 1) % 4])) });
  const a2 = await call(A, 'POST', `/oracle/trials/${t2.trial_id}/submit`);
  note(a2.result.percentage === 50 && a2.points_this_time === 5, `A week 2 dropped to ${a2.result.percentage}% → still ${a2.points_this_time} points for finishing (no penalty)`);

  console.log('\n== Closing, review, fixes');
  await call(T, 'POST', `/teacher/oracle/trials/${t1.trial_id}/assign`, { class_period: 'Test', status: 'closed' });
  const rv = await call(A, 'GET', `/oracle/trials/${t1.trial_id}`);
  note(rv.result.review_open && rv.questions.every(q => q.correct_index !== undefined && q.correct === true), 'after closing, A can review every question with the right answers');
  note((await call(Bt, 'GET', `/oracle/trials/${t1.trial_id}`)).status === 409, 'a student who never started can\'t start a closed trial');
  note((await call(T, 'PUT', `/teacher/oracle/trials/${t1.trial_id}`, sample)).status === 409, 'a trial students have taken can\'t be edited');
  note((await call(T, 'DELETE', `/teacher/oracle/trials/${t1.trial_id}`)).status === 409, '…or deleted');
  const dash0 = await call(T, 'GET', '/teacher/reading/dashboard?period=Test');
  const aAttempt = dash0.students.find(s => s.student_id === ids.A).scores[t2.trial_id].attempt_id;
  await call(T, 'POST', `/teacher/oracle/attempts/${aAttempt}/reopen`);
  await call(A, 'PUT', `/oracle/trials/${t2.trial_id}/answers`, { answers: correct2 });
  const ptsBefore = await pts(A);
  const a2b = await call(A, 'POST', `/oracle/trials/${t2.trial_id}/submit`);
  note(a2b.result.percentage === 100 && a2b.points_this_time === 0 && (await pts(A)) === ptsBefore, 'teacher reopens A\'s attempt; A fixes it (100%) — no extra points the second time');

  console.log('\n== Dashboard');
  const dash = await call(T, 'GET', '/teacher/reading/dashboard?period=Test');
  const w1 = dash.trials.find(t => t.trial_id === t1.trial_id), dc = dash.students.find(s => s.student_id === ids.C);
  note(w1.submitted === 2 && w1.average === 70 && w1.by_type.inference.total === 4, `week 1: ${w1.submitted} turned in, average ${w1.average}%, inference ${w1.by_type.inference.correct}/${w1.by_type.inference.total}`);
  note(dc.change === 60 && dc.scores[t1.trial_id].adjusted, `C: 40% → 100% (change +${dc.change}), marked as taken with accommodations`);
  note((await call(A, 'GET', '/teacher/reading/dashboard?period=Test')).status === 403, 'students cannot open the dashboard');

  console.log('\n== Labyrinth Logic');
  const cats = [{ name: 'Hero', items: ['Theseus', 'Perseus', 'Jason'] }, { name: 'Monster', items: ['Minotaur', 'Medusa', 'Dragon'] }];
  let ck = await call(T, 'POST', '/teacher/logic/check', { categories: cats, clues: [{ type: 'is', a: { c: 0, i: 0 }, b: { c: 1, i: 0 } }] });
  note(!ck.ok && ck.count === 2, `one clue: "${ck.problem}"`);
  const saved = await call(T, 'POST', '/teacher/logic/puzzles', { title: 'Heroes and Monsters', categories: cats, clues: [{ type: 'is', a: { c: 0, i: 0 }, b: { c: 1, i: 0 } }] });
  const pid = saved.puzzle_id;
  let pub = await call(T, 'POST', `/teacher/logic/puzzles/${pid}/publish`);
  note(pub.status === 400 && /Can't publish/.test(pub.error), `publishing with 2 answers is blocked: "${pub.error}"`);
  note((await call(T, 'POST', `/teacher/logic/puzzles/${pid}/assign`, { class_period: 'Test', status: 'open' })).status === 409, 'an unpublished puzzle can\'t be assigned');
  const clues = [{ type: 'is', a: { c: 0, i: 0 }, b: { c: 1, i: 0 } }, { type: 'is_not', a: { c: 0, i: 1 }, b: { c: 1, i: 2 } }];
  await call(T, 'PUT', `/teacher/logic/puzzles/${pid}`, { title: 'Heroes and Monsters', intro: 'Each hero faced one monster.', categories: cats, clues });
  pub = await call(T, 'POST', `/teacher/logic/puzzles/${pid}/publish`);
  note(pub.status === 'published', 'with a second clue there is exactly one answer → published');
  await call(T, 'POST', `/teacher/logic/puzzles/${pid}/assign`, { class_period: 'Test', status: 'open' });
  const sp = await call(A, 'GET', `/logic/puzzles/${pid}`);
  note(sp.puzzle && sp.puzzle.clues[0] === 'Theseus goes with Minotaur.' && sp.puzzle.solution === undefined, `A gets the puzzle and clue sentences, not the answer`);
  await call(A, 'PUT', `/logic/puzzles/${pid}/grid`, { grid: { '0-1': { '0,0': 2 } } });
  note(JSON.stringify((await call(A, 'GET', `/logic/puzzles/${pid}`)).grid) === '{"0-1":{"0,0":2}}', 'the grid autosaves');
  let chk = await call(A, 'POST', `/logic/puzzles/${pid}/check`, { answer: [[0, 0], [1, 1]] });
  note(chk.status === 400, `incomplete answer → "${chk.error}"`);
  chk = await call(A, 'POST', `/logic/puzzles/${pid}/check`, { answer: [[0, 0], [1, 2], [2, 1]] });
  note(chk.correct === false && chk.right === 1, `wrong answer → "${chk.message}"`);
  const lp = await pts(A);
  const solvedBefore = (await call(T, 'GET', '/teacher/reading/dashboard?period=Test')).students.find(s => s.student_id === ids.A).logic_solved;
  chk = await call(A, 'POST', `/logic/puzzles/${pid}/check`, { answer: [[0, 0], [1, 1], [2, 2]] });
  note(chk.correct && chk.points_awarded === 10 && (await pts(A)) === lp + 10, `right answer → "${chk.message}" +${chk.points_awarded} points`);
  chk = await call(A, 'POST', `/logic/puzzles/${pid}/check`, { answer: [[0, 0], [1, 1], [2, 2]] });
  note(chk.points_awarded === 0, 'solving again earns nothing more');
  note((await call(T, 'PUT', `/teacher/logic/puzzles/${pid}`, { title: 'x', categories: cats, clues })).status === 409, 'a puzzle students worked on can\'t be edited');
  const dash2 = await call(T, 'GET', '/teacher/reading/dashboard?period=Test');
  const solvedAfter = dash2.students.find(s => s.student_id === ids.A).logic_solved;
  note(solvedAfter === solvedBefore + 1, `dashboard counts A's new solve (${solvedBefore} → ${solvedAfter}; earlier runs' puzzles stay)`);

  console.log(`\nPROBLEMS (${problems.length})` + (problems.length ? ':\n - ' + problems.join('\n - ') : ''));
})().catch(e => { console.error('CRASH', e); process.exit(1); });
