// Stage 4B API test: C (alliance 2) builds guardian + lair + monster; A (alliance 1, holds Athena + Hermes) and E (alliance 3) face it.
const ENV = require('../lib/env');
const fs = require('fs');
const B = ENV.API;
const call = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const ct = r.headers.get('content-type') || ''; let j = {}; if (ct.includes('json')) { try { j = await r.json(); } catch {} } else j = { _bytes: (await r.arrayBuffer()).byteLength }; return { status: r.status, ...j }; };
const login = async (k, e) => (await call(null, 'POST', `/auth/${k}/login`, { email: e, password: 'pw-test-1' })).token;
const problems = []; const note = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) problems.push(msg); };
const words = n => Array.from({ length: n }, (_, i) => 'word' + i).join(' ');
const pts = async t => (await call(t, 'GET', '/olympus/state')).alliance.total_points;

(async () => {
  const T = await login('teacher', 'teacher@test.local');
  const tok = {}; for (const l of 'ACEGH') tok[l] = await login('student', `stu${l}@test.local`);
  const cId = (await call(tok.C, 'GET', '/island/me')).student.student_id;
  await call(T, 'POST', '/teacher/island/reset-test', { confirm_period: 'Test' });
  // wake nothing at harbors for this test
  const ov = await call(T, 'GET', '/teacher/monsters/overview?period=Test');
  for (const a of ov.alliances) for (const m of a.monsters.filter(x => x.status === 'awake')) await call(T, 'POST', `/teacher/monsters/${m.island_monster_id}/sleep`);
  // The reset clears god powers, so give A an approved Athena power (Stage 4A's flow)
  await call(tok.A, 'PUT', '/gods/athena/card', { claim: 'Athena helps heroes who use their minds instead of only their strength.', evidence_text: '"Athena gave him a polished shield" and he watched Medusa\'s reflection', source_note: 'p. 42' });
  await call(tok.A, 'POST', '/gods/athena/card/submit');
  const card = (await call(T, 'GET', '/teacher/gods/cards?period=Test')).cards.find(c => c.god === 'athena' && c.student_name === 'Student A');
  await call(T, 'POST', `/teacher/gods/cards/${card.power_id}/review`, { action: 'approve' });
  const mapPng = 'data:image/png;base64,' + fs.readFileSync(ENV.REPO + '/public/images/classical/Psyche/palace_bg.png').toString('base64');
  await call(tok.C, 'POST', '/student/upload-map', { map_image: mapPng });

  console.log('== C makes a Guardian, a Lair and a Monster');
  const quests = (await call(tok.C, 'GET', '/island/me')).quests;
  const qid = t => quests.find(q => q.pin_type === t).quest_id;
  const mk = async (type, x) => { const p = (await call(tok.C, 'POST', '/island/pins', { quest_id: qid(type), x_pct: x, y_pct: 40 })).pin;
    await call(tok.C, 'PATCH', `/island/pins/${p.pin_id}`, { title: `C's ${type}`, body: words(70) }); return p.pin_id; };
  const g = await mk('guardian', 20), l = await mk('lair', 50), m = await mk('monster', 80);
  let s = await call(tok.C, 'POST', `/island/pins/${g}/submit`);
  note(s.status === 400 && /Guardian's Test/.test(s.error), `guardian needs its test: "${s.error}"`);
  await call(tok.C, 'PUT', `/island/pins/${g}/question`, { prompt: 'What did Ariadne give Theseus?', options: ['A sword', 'A ball of thread', 'A lyre'], correct_index: 1 });
  s = await call(tok.C, 'POST', `/island/pins/${l}/submit`);
  note(s.status === 400 && /photo of your lair map/.test(s.error), `lair needs a photo: "${s.error}"`);
  await call(tok.C, 'POST', `/island/pins/${l}/photo`, { image_data: mapPng });
  let ex = await call(tok.C, 'PUT', `/island/pins/${l}/extra`, { dangers: [{ label: 'Spikes', x_pct: 10, y_pct: 10 }, { label: 'Pit', x_pct: 30, y_pct: 60 }] });
  note(/2 of 4 done/.test(ex.problem), `two dangers placed: "${ex.problem}"`);
  ex = await call(tok.C, 'PUT', `/island/pins/${l}/extra`, { dangers: [{ label: 'Spikes', x_pct: 10, y_pct: 10 }, { label: 'Pit', x_pct: 30, y_pct: 60 }, { label: 'Smoke', x_pct: 70, y_pct: 20 }, { label: 'Bones', x_pct: 80, y_pct: 80 }] });
  note(!ex.problem, 'four dangers placed and labeled');
  s = await call(tok.C, 'POST', `/island/pins/${m}/submit`);
  note(s.status === 400 && /four of your monster/.test(s.error), `monster needs four attributes: "${s.error}"`);
  const attrs = [
    { description: 'Its gaze turns heroes to stone', counter_type: 'god', counter_value: 'athena' },
    { description: 'It calls down storms', counter_type: 'god', counter_value: 'zeus' },
    { description: 'It hides in the maze', counter_type: 'question', counter_value: { prompt: 'How did Theseus find his way out?', options: ['Following a thread', 'Flying'], correct_index: 0 } },
    { description: 'Its hide can\'t be cut', counter_type: 'question', counter_value: { prompt: 'Who forged the gods\' weapons?', options: ['Ares', 'Hephaestus'] } }];
  let at = await call(tok.C, 'PUT', `/island/pins/${m}/attributes`, { attributes: attrs });
  note(/Attribute 4: Mark which answer is correct/.test(at.problem), `attribute counter checked: "${at.problem}"`);
  attrs[3].counter_value.correct_index = 1;
  at = await call(tok.C, 'PUT', `/island/pins/${m}/attributes`, { attributes: attrs });
  note(/what the hero gains/.test(at.problem), `then: "${at.problem}"`);
  ex = await call(tok.C, 'PUT', `/island/pins/${m}/extra`, { hero_gains: 'The monster\'s golden horn, which lets the hero hear lies.' });
  note(!ex.problem, 'monster complete');
  for (const p of [g, l, m]) { const r = await call(tok.C, 'POST', `/island/pins/${p}/submit`); if (r.status !== 200) note(false, `submit ${p}: ${r.error}`); }
  const queue = await call(T, 'GET', '/teacher/island/queue?period=Test');
  const qm = queue.pins.find(p => p.pin_id === m), ql = queue.pins.find(p => p.pin_id === l);
  note(qm.attributes.length === 4 && qm.extra.hero_gains && ql.extra.dangers.length === 4, 'teacher sees the attributes, counters, hero\'s reward and lair dangers in the queue');
  for (const p of [g, l, m]) await call(T, 'POST', `/teacher/island/pins/${p}/review`, { action: 'approve' });

  console.log('\n== A faces it (alliance 1 holds Athena)');
  await call(T, 'POST', '/teacher/voyage/settings', { class_period: 'Test', mode: 'voyage', author_points: 3 });
  for (const a of [1, 3, 4]) await call(T, 'POST', '/teacher/voyage/tokens', { alliance_id: a, delta: 2 });
  note((await call(tok.A, 'POST', '/voyage/visits', { pin_id: g })).status === 409, 'the guardian can\'t be used as a plain visit (it would leak the test)');
  let av = await call(tok.A, 'GET', `/encounters/island/${cId}`);
  note(av.available && av.has_guardian && av.has_lair && !av.start_problem, `"${av.monster_title}" is ready to face`);
  const tokBefore = (await call(tok.A, 'GET', '/voyage/world')).tokens;
  let e = await call(tok.A, 'POST', '/encounters', { owner_student_id: cId });
  const eid = e.encounter.encounter_id;
  note(e.encounter.stage === 'guardian' && e.encounter.guardian.test.options.length === 3 && e.encounter.guardian.test.correct_index === undefined && e.tokens_left === tokBefore - 1,
    'encounter starts at the Guardian (one token spent, answer hidden)');
  note((await call(tok.A, 'GET', `/encounters/${eid}/lair-photo`)).status === 404, 'the lair map stays hidden until the Guardian is passed');
  let r = await call(tok.A, 'POST', `/encounters/${eid}/guardian`, { answer_index: 0 });
  note(r.passed === false && !r.turned_back, 'first wrong answer: one more try');
  r = await call(tok.A, 'POST', `/encounters/${eid}/guardian`, { answer_index: 1 });
  note(r.passed && r.encounter.stage === 'lair' && r.encounter.lair.dangers.map(d => d.label).join(',') === 'Spikes,Pit,Smoke,Bones', 'passed the Guardian → the Lair with its four dangers');
  note((await call(tok.A, 'GET', `/encounters/${eid}/lair-photo`))._bytes > 1000, 'the lair map loads');
  r = await call(tok.A, 'POST', `/encounters/${eid}/lair`);
  const ma = r.encounter.monster.attributes;
  note(r.encounter.stage === 'monster' && ma[0].alliance_has_power === true && ma[1].alliance_has_power === false && ma[2].question.options.length === 2 && ma[2].correct_index === undefined,
    'the Monster: Athena\'s power available, Zeus\'s not; questions without answers');
  const p0 = await pts(tok.A), c0 = await pts(tok.C);
  await call(tok.A, 'POST', `/encounters/${eid}/counter`, { attribute: 0 });
  await call(tok.A, 'POST', `/encounters/${eid}/counter`, { attribute: 1 });
  await call(tok.A, 'POST', `/encounters/${eid}/counter`, { attribute: 2, answer_index: 0 });
  r = await call(tok.A, 'POST', `/encounters/${eid}/counter`, { attribute: 3, answer_index: 1 });
  note(r.encounter.outcome === 'defeated' && r.encounter.monster.countered === 3 && /golden horn/.test(r.encounter.hero_gains), `3 of 4 countered → defeated; the hero gains: "${r.encounter.hero_gains}"`);
  note((await pts(tok.A)) === p0 + 15 && (await pts(tok.C)) === c0 + 3, `+15 to A's alliance, +3 to C's (author)`);
  const again = await call(tok.A, 'POST', `/encounters/${eid}/counter`, { attribute: 3, answer_index: 1 });
  note((await pts(tok.A)) === p0 + 15, 'no double reward');
  note((await call(tok.A, 'POST', '/encounters', { owner_student_id: cId })).status === 409, 'one encounter per monster');

  console.log('\n== E is turned back by the Guardian');
  e = await call(tok.E, 'POST', '/encounters', { owner_student_id: cId });
  await call(tok.E, 'POST', `/encounters/${e.encounter.encounter_id}/guardian`, { answer_index: 0 });
  r = await call(tok.E, 'POST', `/encounters/${e.encounter.encounter_id}/guardian`, { answer_index: 2 });
  note(r.turned_back && r.encounter.outcome === 'turned_back' && !r.encounter.lair, 'two misses → turned back, the lair stays hidden');
  note((await call(tok.E, 'POST', `/encounters/${e.encounter.encounter_id}/lair`)).encounter.stage === 'done', 'can\'t skip ahead after being turned back');

  console.log('\n== Rules and teacher tools');
  note((await call(tok.C, 'POST', '/encounters', { owner_student_id: cId })).status === 409, 'C can\'t face their own monster');
  e = await call(tok.G, 'POST', '/encounters', { owner_student_id: cId });
  const enc = await call(T, 'GET', '/teacher/encounters?period=Test');
  note(enc.encounters.length === 3 && enc.encounters.some(x => x.outcome === 'defeated' && x.countered === 3), `teacher sees ${enc.encounters.length} encounters`);
  const gTok = (await call(tok.G, 'GET', '/voyage/world')).tokens;
  await call(T, 'POST', `/teacher/encounters/${e.encounter.encounter_id}/cancel`);
  note((await call(tok.G, 'GET', '/voyage/world')).tokens === gTok + 1, 'teacher ends G\'s encounter → token back');
  await call(T, 'POST', '/teacher/voyage/settings', { class_period: 'Test', mode: 'build' });
  r = await call(tok.H, 'POST', '/encounters', { owner_student_id: cId });
  note(r.status === 409 && /during voyages/.test(r.error), `build time: "${r.error}"`);

  console.log(`\nPROBLEMS (${problems.length})` + (problems.length ? ':\n - ' + problems.join('\n - ') : ''));
})().catch(e => { console.error('CRASH', e); process.exit(1); });
