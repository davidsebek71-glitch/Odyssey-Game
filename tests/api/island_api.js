// Stage 1 API test. Students: A,B (alliance 1, Test), C (alliance 2, Test), X (period 1st, no alliance)
const ENV = require('../lib/env');
const fs = require('fs');
const B = ENV.API;
const call = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const ct = r.headers.get('content-type') || ''; let j = {}; if (ct.includes('json')) { try { j = await r.json(); } catch {} } else { j = { _bytes: (await r.arrayBuffer()).byteLength, _type: ct }; } return { status: r.status, ...j }; };
const login = async (k, e) => (await call(null, 'POST', `/auth/${k}/login`, { email: e, password: 'pw-test-1' })).token;
const problems = []; const note = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) problems.push(msg); };
const words = n => Array.from({ length: n }, (_, i) => 'word' + i).join(' ');

(async () => {
  const T = await login('teacher', 'teacher@test.local');
  const A = await login('student', 'stuA@test.local'), Bt = await login('student', 'stuB@test.local'), C = await login('student', 'stuC@test.local');
  let X = await login('student', 'stuX@test.local');
  if (!X) { await call(null, 'POST', '/auth/student/register', { name: 'Student X', email: 'stuX@test.local', password: 'pw-test-1', class_period: '1st' }); X = await login('student', 'stuX@test.local'); }

  console.log('== Setup');
  const rs = await call(T, 'POST', '/teacher/island/reset-test', { confirm_period: 'Test' });
  note(rs.reset, `Test-period island reset (${rs.pins_removed} pins removed)`);
  const mapPng = fs.readFileSync(ENV.REPO + '/public/images/classical/Psyche/palace_bg.png').toString('base64');
  const up = await call(A, 'POST', '/student/upload-map', { map_image: 'data:image/png;base64,' + mapPng });
  note(up.status === 200, `student A uploads a map (${up.status})`);

  console.log('\n== Unlocking');
  // Quiz passes are never reset, so locking is checked on two brand-new Test-period students
  const fresh = async tag => { const email = `stu${tag}${Date.now()}@test.local`, name = `Fresh ${tag} ${Date.now()}`;
    await call(null, 'POST', '/auth/student/register', { name, email, password: 'pw-test-1', class_period: 'Test' }); return { name, tok: await login('student', email) }; };
  const U = await fresh('U'), V = await fresh('V');
  let me = await call(A, 'GET', '/island/me');
  note(me.map_image && me.quests.length === 6, `A sees the 6 sample quests; map present`);
  let ume = await call(U.tok, 'GET', '/island/me');
  const shrine = ume.quests.find(q => q.title.includes('Pandora'));
  const lockedNow = ume.quests.filter(q => !q.unlocked).length;
  note(lockedNow === 3 && !shrine.unlocked, `a new student has the 3 myth quests locked (the 3 encounter quests need no quiz)`);
  const early = await call(U.tok, 'POST', '/island/pins', { quest_id: shrine.quest_id });
  note(early.status === 403, `starting a locked quest is refused: "${early.error}"`);
  const fp = await call(T, 'POST', '/teacher/force-pass-quiz', { student_name: U.name, class_period: 'Test', portal_id: 1, score: 9, total_questions: 10 });
  note(fp.status === 200, `teacher marks the new student as passing the Pandora quiz (${fp.status} ${fp.error || ''})`);
  ume = await call(U.tok, 'GET', '/island/me');
  note(ume.quests.find(q => q.quest_id === shrine.quest_id).unlocked, 'Pandora quest is now unlocked for them');
  const vme = await call(V.tok, 'GET', '/island/me');
  note(!vme.quests.find(q => q.quest_id === shrine.quest_id).unlocked, 'still locked for another new student (unlock is per student)');
  await call(T, 'POST', '/teacher/force-pass-quiz', { student_name: 'Student A', class_period: 'Test', portal_id: 1, score: 9, total_questions: 10 });
  me = await call(A, 'GET', '/island/me');
  const xme = await call(X, 'GET', '/island/me');
  note(xme.quests.length === 0, `student in period 1st sees no sample (test_only) quests (${xme.quests.length})`);

  console.log('\n== Drafting and submit checks');
  const c1 = await call(A, 'POST', '/island/pins', { quest_id: shrine.quest_id });
  const pid = c1.pin.pin_id;
  const c2 = await call(A, 'POST', '/island/pins', { quest_id: shrine.quest_id });
  note(c2.existing && c2.pin.pin_id === pid, 'starting the same quest twice reopens the same draft');
  let s = await call(A, 'POST', `/island/pins/${pid}/submit`);
  note(s.status === 400 && /map/.test(s.error), `submit without a position → "${s.error}"`);
  await call(A, 'PATCH', `/island/pins/${pid}`, { x_pct: 42.5, y_pct: 61 });
  s = await call(A, 'POST', `/island/pins/${pid}/submit`);
  note(s.status === 400 && /title/.test(s.error), `submit without a title → "${s.error}"`);
  await call(A, 'PATCH', `/island/pins/${pid}`, { title: 'The Jar Shrine', body: words(50) });
  s = await call(A, 'POST', `/island/pins/${pid}/submit`);
  note(s.status === 400 && /80 words \(you have 50\)/.test(s.error), `submit with 50 of 80 words → "${s.error}"`);
  const badVid = await call(A, 'PATCH', `/island/pins/${pid}`, { video_url: 'javascript:alert(1)' });
  note(badVid.status === 400, `non-http video link refused`);
  const xss = await call(A, 'PATCH', `/island/pins/${pid}`, { title: '<img src=x onerror=alert(1)>' });
  note(xss.pin.title === '<img src=x onerror=alert(1)>', 'title stored as plain text (pages render it as text, never HTML)');
  await call(A, 'PATCH', `/island/pins/${pid}`, { title: 'The Jar Shrine', body: words(85), video_url: 'https://example.com/video' });
  const noQ = await call(A, 'POST', `/island/pins/${pid}/submit`);
  note(noQ.status === 400 && /question/.test(noQ.error), `submit without a question → "${noQ.error}"`);
  const unmarked = await call(A, 'PUT', `/island/pins/${pid}/question`, { prompt: 'What stayed in the jar?', options: ['Hope', 'Fire'] });
  note(unmarked.problem === 'Mark which answer is correct.', `question with no correct answer marked → "${unmarked.problem}"`);
  await call(A, 'PUT', `/island/pins/${pid}/question`, { prompt: 'What stayed in the jar?', options: ['Hope', 'Fire'], correct_index: 0 });

  console.log('\n== Photo');
  const notImg = await call(A, 'POST', `/island/pins/${pid}/photo`, { image_data: 'data:image/png;base64,' + Buffer.from('hello not an image').toString('base64') });
  note(notImg.status === 400, `fake image refused: "${notImg.error}"`);
  const jpg = fs.readFileSync(ENV.REPO + '/public/images/classical/Icarus/Quill.png');
  const ph = await call(A, 'POST', `/island/pins/${pid}/photo`, { image_data: 'data:image/png;base64,' + jpg.toString('base64') });
  note(ph.pin && ph.pin.has_photo, 'real photo uploads');
  const getPh = await call(A, 'GET', `/island/pins/${pid}/photo`);
  note(getPh.status === 200 && getPh._bytes === jpg.length, `owner can load the photo (${getPh._bytes} bytes, ${getPh._type})`);

  console.log('\n== Moderation before approval');
  s = await call(A, 'POST', `/island/pins/${pid}/submit`);
  note(s.pin && s.pin.status === 'submitted', 'A submits → waiting for approval');
  const lockedEdit = await call(A, 'PATCH', `/island/pins/${pid}`, { title: 'changed' });
  note(lockedEdit.status === 409, `editing while waiting is refused: "${lockedEdit.error}"`);
  note((await call(Bt, 'GET', `/island/pins/${pid}`)).status === 404, 'alliance-mate B cannot open the unapproved pin');
  note((await call(Bt, 'GET', `/island/pins/${pid}/photo`)).status === 404, 'B cannot load its photo either');
  note((await call(Bt, 'GET', `/island/view/1`)).pins.length === 0, 'B sees no pins on A\'s island yet');
  const del = await call(A, 'DELETE', `/island/pins/${pid}`);
  note(del.status === 409, 'a submitted pin cannot be deleted');

  console.log('\n== Teacher review: return, resubmit, approve');
  let q = await call(T, 'GET', '/teacher/island/queue?period=Test');
  note(q.pins.length === 1 && q.pins[0].student_name === 'Student A' && q.pins[0].word_count === 85, `queue shows A's pin (85 words)`);
  const noNote = await call(T, 'POST', `/teacher/island/pins/${pid}/review`, { action: 'return' });
  note(noNote.status === 400, `return without a note refused: "${noNote.error}"`);
  const ret = await call(T, 'POST', `/teacher/island/pins/${pid}/review`, { action: 'return', note: 'Add who guards the shrine.' });
  note(ret.pin.status === 'returned', 'teacher returns it with a note');
  me = await call(A, 'GET', '/island/me');
  const mine = me.pins.find(p => p.pin_id === pid);
  note(mine.status === 'returned' && mine.teacher_note === 'Add who guards the shrine.', 'A sees "returned" and the note');
  note((await call(Bt, 'GET', `/island/pins/${pid}`)).status === 404, 'returned pin still hidden from B');
  await call(A, 'PATCH', `/island/pins/${pid}`, { body: words(85) + '\nThe shrine is guarded by Epimetheus.' });
  s = await call(A, 'POST', `/island/pins/${pid}/submit`);
  note(s.pin.status === 'submitted', 'A edits and resubmits');
  const before = (await call(A, 'GET', '/olympus/state')).alliance.total_points;
  const ap = await call(T, 'POST', `/teacher/island/pins/${pid}/review`, { action: 'approve', note: 'Great detail!' });
  const after1 = (await call(A, 'GET', '/olympus/state')).alliance.total_points;
  note(ap.pin.status === 'published' && ap.points_awarded === 25 && after1 === before + 25, `approved → published, +25 points (${before} → ${after1})`);
  const ap2 = await call(T, 'POST', `/teacher/island/pins/${pid}/review`, { action: 'approve' });
  const after2 = (await call(A, 'GET', '/olympus/state')).alliance.total_points;
  note(ap2.already && after2 === after1, 'approving again does not award points twice');
  const retPub = await call(T, 'POST', `/teacher/island/pins/${pid}/review`, { action: 'return', note: 'x' });
  note(retPub.status === 409, 'a published pin cannot be returned (nothing published is taken away)');

  console.log('\n== Who can see the published pin');
  const bp = await call(Bt, 'GET', `/island/pins/${pid}`);
  note(bp.pin && bp.pin.title === 'The Jar Shrine' && bp.pin.teacher_note === undefined, 'alliance-mate B opens the published pin (teacher note stays private)');
  note((await call(Bt, 'GET', `/island/pins/${pid}/photo`)).status === 200, 'B can load the photo');
  note((await call(Bt, 'GET', `/island/view/1`)).pins.length === 1, 'B sees 1 pin on A\'s island');
  note((await call(C, 'GET', `/island/view/1`)).status === 403, 'student C in another alliance cannot visit yet (Stage 2 voyages)');
  note((await call(C, 'GET', `/island/pins/${pid}`)).status === 404, 'C cannot open the pin');
  note((await call(T, 'GET', `/island/view/1`)).pins.length === 1, 'teacher can open any island');
  note((await call(Bt, 'PATCH', `/island/pins/${pid}`, { title: 'hijack' })).status === 404, 'B cannot edit A\'s pin');
  note((await call(A, 'PATCH', `/island/pins/${pid}`, { title: 'changed' })).status === 409, 'published pin is locked for editing');

  console.log('\n== Named map feature');
  const f = await call(A, 'POST', '/island/pins', { feature_type: 'river', x_pct: 10, y_pct: 20 });
  note(f.pin && f.pin.pin_type === 'river', 'A starts naming a river');
  await call(A, 'PATCH', `/island/pins/${f.pin.pin_id}`, { title: 'River Styx' });
  s = await call(A, 'POST', `/island/pins/${f.pin.pin_id}/submit`);
  note(s.status === 400, `needs a reason from the text: "${s.error}"`);
  await call(A, 'PATCH', `/island/pins/${f.pin.pin_id}`, { body: 'Charon ferries the dead across it.' });
  s = await call(A, 'POST', `/island/pins/${f.pin.pin_id}/submit`);
  note(s.pin && s.pin.status === 'submitted', 'river submitted');
  const ap3 = await call(T, 'POST', `/teacher/island/pins/${f.pin.pin_id}/review`, { action: 'approve' });
  note(ap3.points_awarded === 0, 'named places publish without points');
  const bad = await call(A, 'POST', '/island/pins', { feature_type: 'volcano' });
  note(bad.status === 400, 'unknown place type refused');

  console.log('\n== Drafts and lists');
  const d = await call(A, 'POST', '/island/pins', { feature_type: 'city' });
  note((await call(A, 'DELETE', `/island/pins/${d.pin.pin_id}`)).deleted, 'an unsubmitted draft can be deleted');
  const st = await call(T, 'GET', '/teacher/island/students?period=Test');
  const rowA = st.students.find(r => r.name === 'Student A');
  note(rowA && rowA.published === 2 && rowA.has_map === 1, `teacher's island list: A has map, 2 published`);
  note((await call(A, 'GET', '/teacher/island/queue')).status === 403, 'students cannot open the teacher queue');

  console.log(`\nPROBLEMS (${problems.length})` + (problems.length ? ':\n - ' + problems.join('\n - ') : ''));
})().catch(e => { console.error('CRASH', e); process.exit(1); });
