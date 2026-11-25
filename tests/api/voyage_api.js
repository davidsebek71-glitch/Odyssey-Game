// Stage 2 API test. Period "Test". Authors A,B (alliance 1). Visitors C,D (alliance 2).
const ENV = require('../lib/env');
const fs = require('fs');
const B = ENV.API;
const call = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j }; };
const login = async (k, e) => (await call(null, 'POST', `/auth/${k}/login`, { email: e, password: 'pw-test-1' })).token;
const problems = []; const note = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) problems.push(msg); };
const words = n => Array.from({ length: n }, (_, i) => 'word' + i).join(' ');
const pts = async (t) => (await call(t, 'GET', '/olympus/state')).alliance.total_points;

(async () => {
  const T = await login('teacher', 'teacher@test.local');
  const [A, Bt, C, D] = await Promise.all(['A', 'B', 'C', 'D'].map(l => login('student', `stu${l}@test.local`)));
  console.log('== Setup');
  await call(T, 'POST', '/teacher/island/reset-test', { confirm_period: 'Test' });
  await call(T, 'POST', '/teacher/voyage/settings', { class_period: 'Test', mode: 'build', tokens_per_publish: 2, visit_cap: 2, visitor_points: 5, author_points: 3, min_response_words: 15 });
  for (const n of ['Student A', 'Student B']) await call(T, 'POST', '/teacher/force-pass-quiz', { student_name: n, class_period: 'Test', portal_id: 1, score: 9, total_questions: 10 });
  const mapPng = 'data:image/png;base64,' + fs.readFileSync(ENV.REPO + '/public/images/classical/Psyche/palace_bg.png').toString('base64');
  await call(Bt, 'POST', '/student/upload-map', { map_image: mapPng });

  console.log('\n== Questions are required and approved with the piece');
  const quest = (await call(A, 'GET', '/island/me')).quests.find(q => q.title.includes('Pandora'));
  async function makePiece(tok, title) {
    const p = (await call(tok, 'POST', '/island/pins', { quest_id: quest.quest_id, x_pct: 40, y_pct: 50 })).pin;
    await call(tok, 'PATCH', `/island/pins/${p.pin_id}`, { title, body: words(85) });
    return p.pin_id;
  }
  const pa = await makePiece(A, 'Shrine of A');
  let s = await call(A, 'POST', `/island/pins/${pa}/submit`);
  note(s.status === 400 && /question/.test(s.error), `submit without a question → "${s.error}"`);
  let q = await call(A, 'PUT', `/island/pins/${pa}/question`, { prompt: 'What stayed in the jar?', options: ['Hope', ''], correct_index: 0 });
  note(q.problem === 'Give your question at least two answer choices.', `question with one choice → "${q.problem}"`);
  q = await call(A, 'PUT', `/island/pins/${pa}/question`, { prompt: 'What stayed in the jar?', options: ['Greed', 'Hope', 'Fire', 'Gold'], correct_index: 1 });
  note(!q.problem, 'full question saved');
  s = await call(A, 'POST', `/island/pins/${pa}/submit`);
  note(s.pin && s.pin.status === 'submitted', 'piece with question submits');
  const qq = await call(T, 'GET', '/teacher/island/queue?period=Test');
  note(qq.pins[0].question && qq.pins[0].question.correct_index === 1, 'teacher sees the question and its answer in the queue');
  const ap = await call(T, 'POST', `/teacher/island/pins/${pa}/review`, { action: 'approve' });
  note(ap.tokens_awarded === 2, `approving grants ${ap.tokens_awarded} voyage tokens to alliance 1`);
  const pb = await makePiece(Bt, 'Shrine of B');
  await call(Bt, 'PUT', `/island/pins/${pb}/question`, { prompt: 'Who opened the jar?', options: ['Pandora', 'Zeus'], correct_index: 0 });
  await call(Bt, 'POST', `/island/pins/${pb}/submit`);
  await call(T, 'POST', `/teacher/island/pins/${pb}/review`, { action: 'approve' });
  const again = await call(T, 'POST', `/teacher/island/pins/${pa}/review`, { action: 'approve' });
  let ov = await call(T, 'GET', '/teacher/voyage/overview?period=Test');
  note(ov.alliances.find(a => a.alliance_id === 1).tokens === 4 && again.already, 'alliance 1 has 4 tokens (2 pieces); re-approving grants nothing');

  console.log('\n== Build mode blocks voyages');
  let w = await call(C, 'GET', '/voyage/world');
  const aMember = w.alliances.find(a => a.alliance_id === 1).members.find(m => m.name === 'Student A');
  note(w.mode === 'build' && aMember.published === 1 && aMember.to_visit === 1, `world map: mode build; Student A shows 1 piece to visit`);
  await call(T, 'POST', '/teacher/voyage/tokens', { alliance_id: 2, delta: 3 });
  let v = await call(C, 'POST', '/voyage/visits', { pin_id: pa });
  note(v.status === 409 && /closed/.test(v.error), `visit in build mode refused: "${v.error}"`);
  note((await call(C, 'GET', '/island/view/1')).status === 403, 'C cannot look at A\'s island in build mode');
  ov = await call(T, 'GET', '/teacher/voyage/overview?period=Test');
  note(ov.alliances.find(a => a.alliance_id === 2).tokens === 3, 'no token was spent');

  console.log('\n== Voyage mode');
  const sw = await call(T, 'POST', '/teacher/voyage/settings', { class_period: 'Test', mode: 'voyage' });
  note(sw.settings.mode === 'voyage', `teacher opens a voyage (window ${sw.settings.window_id})`);
  let view = await call(C, 'GET', '/island/view/1');
  const teaser = view.pins.find(p => p.pin_id === pa);
  note(view.access === 'visitor' && teaser.locked && teaser.body === undefined, 'C sees A\'s island and the piece\'s title, but not its content');
  note((await call(C, 'GET', `/island/pins/${pa}`)).status === 404, 'C cannot open the piece before visiting');
  note((await call(Bt, 'POST', '/voyage/visits', { pin_id: pa })).status === 400, 'B cannot spend a token on their own alliance\'s piece');
  v = await call(C, 'POST', '/voyage/visits', { pin_id: pa });
  const vid = v.visit && v.visit.visit_id;
  note(vid && v.tokens_left === 2 && v.visit.question.correct_index === undefined, `C starts a visit (token spent: ${v.tokens_left} left; answer hidden)`);
  note(v.visit.pin.body && v.visit.pin.body.startsWith('word0'), 'the piece\'s content is now readable in the visit');
  note((await call(C, 'GET', `/island/pins/${pa}`)).status === 200, 'C can now open the piece directly too');
  const second = await call(C, 'POST', '/voyage/visits', { pin_id: pb });
  note(second.status === 409 && /Finish your visit/.test(second.error), `second visit while one is open: "${second.error}"`);
  let c = await call(C, 'POST', `/voyage/visits/${vid}/complete`, { response_text: words(20) });
  note(c.status === 400 && /Answer the question first/.test(c.error), 'cannot finish before answering the question');
  let an = await call(C, 'POST', `/voyage/visits/${vid}/answer`, { answer_index: 0 });
  note(an.correct === false && !an.revealed, 'first wrong answer: try again');
  an = await call(C, 'POST', `/voyage/visits/${vid}/answer`, { answer_index: 2 });
  note(an.revealed && an.visit.question.correct_index === 1, 'second wrong answer: correct answer shown, visit continues');
  c = await call(C, 'POST', `/voyage/visits/${vid}/complete`, { response_text: '' });
  note(c.status === 400 && /at least 15 words/.test(c.error), `cannot finish without a response: "${c.error}"`);
  c = await call(C, 'POST', `/voyage/visits/${vid}/complete`, { response_text: words(8) });
  note(c.status === 400 && /you have 8/.test(c.error), 'too-short response refused');
  const before1 = await pts(A), before2 = await pts(C);
  c = await call(C, 'POST', `/voyage/visits/${vid}/complete`, { response_text: 'I loved how the shrine keeps hope safe. ' + words(15) });
  const after1 = await pts(A), after2 = await pts(C);
  note(c.visit && c.visit.status === 'completed', 'visit completes with a response');
  note(after2 === before2 + 5 && after1 === before1 + 3, `points: visitor's alliance +5 (${before2}→${after2}), author's alliance +3 (${before1}→${after1})`);
  note((await call(C, 'POST', '/voyage/visits', { pin_id: pa })).status === 409, 'cannot visit the same piece twice');

  console.log('\n== Responses are moderated');
  note((await call(A, 'GET', '/voyage/responses/mine')).responses.length === 0, 'author does not see the response before approval');
  const rq = await call(T, 'GET', '/teacher/voyage/responses?period=Test');
  note(rq.responses.length === 1 && rq.responses[0].visitor_name === 'Student C' && rq.responses[0].answer_revealed === 1, 'teacher sees it (with "answer was revealed")');
  await call(T, 'POST', `/teacher/voyage/responses/${vid}`, { action: 'approve' });
  const mine = await call(A, 'GET', '/voyage/responses/mine');
  note(mine.responses.length === 1 && mine.responses[0].visitor_name === 'Student C', 'after approval the author reads it');

  console.log('\n== Per-voyage limit, new voyage, cancelling');
  await call(T, 'POST', '/teacher/voyage/settings', { class_period: 'Test', visit_cap: 1 });
  let d1 = await call(D, 'POST', '/voyage/visits', { pin_id: pa });
  await call(D, 'POST', `/voyage/visits/${d1.visit.visit_id}/answer`, { answer_index: 1 });
  const dd = await call(D, 'POST', `/voyage/visits/${d1.visit.visit_id}/complete`, { response_text: words(16) });
  note(dd.visit && dd.visit.status === 'completed' && dd.visit.answer_correct, 'D answers right first time and completes');
  const capped = await call(D, 'POST', '/voyage/visits', { pin_id: pb });
  note(capped.status === 409 && /limit/.test(capped.error), `limit of 1 per voyage: "${capped.error}"`);
  await call(T, 'POST', '/teacher/voyage/settings', { class_period: 'Test', mode: 'build' });
  await call(T, 'POST', '/teacher/voyage/settings', { class_period: 'Test', mode: 'voyage' });
  const tokBefore = (await call(D, 'GET', '/voyage/world')).tokens;
  let d2 = await call(D, 'POST', '/voyage/visits', { pin_id: pb });
  note(d2.visit, 'a new voyage resets the limit');
  const cc = await call(D, 'POST', `/voyage/visits/${d2.visit.visit_id}/cancel`);
  note(cc.cancelled && cc.tokens === tokBefore, `leaving a visit gives the token back (${cc.tokens})`);
  d2 = await call(D, 'POST', '/voyage/visits', { pin_id: pb });
  const tc = await call(T, 'POST', `/teacher/voyage/visits/${d2.visit.visit_id}/cancel`);
  w = await call(D, 'GET', '/voyage/world');
  note(tc.cancelled && !w.open_visit && w.tokens === tokBefore, 'teacher can end a stuck visit (token returned)');

  console.log('\n== Hiding a response takes the points back');
  const p1 = await pts(A), p2 = await pts(D);
  const hid = await call(T, 'POST', `/teacher/voyage/responses/${d1.visit.visit_id}`, { action: 'hide' });
  const q1 = await pts(A), q2 = await pts(D);
  note(hid.points_removed === 8 && q1 === p1 - 3 && q2 === p2 - 5, `hidden: author ${p1}→${q1}, visitor ${p2}→${q2}`);
  const hid2 = await call(T, 'POST', `/teacher/voyage/responses/${d1.visit.visit_id}`, { action: 'hide' });
  note((await pts(A)) === q1, 'hiding twice does not take points twice');

  console.log('\n== Teacher overview');
  ov = await call(T, 'GET', '/teacher/voyage/overview?period=Test');
  const rowC = ov.students.find(r => r.name === 'Student C'), rowA = ov.students.find(r => r.name === 'Student A');
  note(rowC.visits_made === 1 && rowC.responses_left === 1 && rowA.published === 1 && rowA.times_visited === 2,
    `C: ${rowC.visits_made} visit, ${rowC.responses_left} response approved · A: ${rowA.published} published, visited ${rowA.times_visited}×`);
  note((await call(C, 'POST', '/teacher/voyage/settings', { class_period: 'Test', mode: 'build' })).status === 403, 'students cannot change voyage settings');

  console.log(`\nPROBLEMS (${problems.length})` + (problems.length ? ':\n - ' + problems.join('\n - ') : ''));
})().catch(e => { console.error('CRASH', e); process.exit(1); });
