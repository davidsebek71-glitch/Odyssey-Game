const ENV = require('../lib/env');
const fs = require('fs');
const B_ = ENV.API, LOG = ENV.MOCK_LOG;
const call = async (t, m, p, b) => { const r = await fetch(B_ + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j }; };
const login = async (k, e) => (await call(null, 'POST', `/auth/${k}/login`, { email: e, password: 'pw-test-1' })).token;
const problems = []; const note = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) problems.push(msg); };
const mock = () => JSON.parse(fs.readFileSync(LOG));
const STORY = 'Jason sailed to Colchis. Only the one who carries the fleece may leave. He took it and sailed home on the Argo.';
(async () => {
  const T = await login('teacher', 'teacher@test.local'), A = await login('student', 'stuA@test.local');
  await call(T, 'POST', '/teacher/island/reset-test', { confirm_period: 'Test' });
  await call(T, 'POST', '/teacher/ai-helper', { period: 'Test', enabled: false, drafts_per_story: 3 });
  const me = await call(A, 'GET', '/island/me');
  const q = me.quests.find(x => x.pin_type === 'guardian');
  const pin = (await call(A, 'POST', '/island/pins', { quest_id: q.quest_id, x_pct: 30, y_pct: 30 })).pin;
  await call(A, 'PATCH', `/island/pins/${pin.pin_id}`, { title: 'The Fleece', body: STORY });
  const P = `/games/pin/${pin.pin_id}`;
  const DESC = 'The hero must find the golden fleece and show it to the king to escape.';

  console.log('== Off by default');
  note((await call(A, 'GET', P)).ai.available === false, 'the helper is off until the teacher turns it on');
  note((await call(A, 'POST', P + '/ai-draft', { description: DESC })).status === 403, 'asking while it is off is refused');
  let st = await call(T, 'GET', '/teacher/ai-helper?period=Test');
  note(st.key_present && st.sdk_ok && st.enabled === false && st.drafts_per_story === 3, 'teacher sees: key present, SDK loaded, off, 3 per story');
  note((await call(A, 'GET', '/teacher/ai-helper?period=Test')).status === 403, 'students can\'t read the helper settings');
  await call(T, 'POST', '/teacher/ai-helper', { period: 'Test', enabled: true });
  let g = await call(A, 'GET', P);
  note(g.ai.available && g.ai.left === 3, `on: A has ${g.ai.left} drafts for this story`);

  console.log('\n== What may be sent');
  note((await call(A, 'POST', P + '/ai-draft', { description: 'a key game' })).status === 400, 'a too-short description is refused');
  note((await call(A, 'POST', P + '/ai-draft', { description: 'Make a game like the one at stuA@test.local please thanks' })).status === 400, 'an email address is refused');
  const names = (await call(T, 'GET', '/teacher/island/students?period=Test')).students.map(s => s.name);
  const nm = names.map(n => n.split(/\s+/).find(p => p.length >= 3 && !/student|test/i.test(p))).find(Boolean);
  if (nm) note(/names of people/.test((await call(A, 'POST', P + '/ai-draft', { description: `The hero must beat ${nm} in a race to escape the maze` })).error), `a classmate's name ("${nm}") is refused`);
  else console.log('  (no classmate name of 3+ letters in Test period to try)');
  note(mock().length === 0, 'none of those reached the AI');

  console.log('\n== Drafts');
  let r = await call(A, 'POST', P + '/ai-draft', { description: DESC });
  note(r.status === 200 && r.check.ok && r.left === 2 && r.draft.things.length === 3, `a good draft comes back winnable; ${r.left} left`);
  note(r.draft.things.find(t => t.id === 'fleece').question === undefined && r.draft.things.find(t => t.id === 'king').question.correct_index === 0 && r.draft.rules[0].if.not === true && r.draft.rules[3].then.do === 'survive',
    'the no-null format is turned into Stage 7 rules (no empty question, "not carrying" kept)');
  const sent = mock()[0];
  note(sent.url.startsWith('/v1/messages') && sent.body.model === 'claude-opus-5-5', `request: ${sent.url} model ${sent.body.model}`);
  note(sent.body.output_config.format.type === 'json_schema' && sent.body.fallbacks === 'default' && /server-side-fallback-2026-07-01/.test(sent.headers.beta), 'structured output + refusal fallback are set');
  const wire = JSON.stringify(sent.body);
  note(sent.body.messages.length === 1 && sent.body.messages[0].content === 'The student\'s game: ' + DESC, 'only the sentence is sent');
  note(!/Student A|stuA|Jason sailed|The Fleece|Test/.test(wire.replace(sent.body.system, '')) && !/Student A|stuA/.test(sent.body.system), 'no name, login, story text, title or period in the request');
  note((await call(A, 'GET', P)).game === null, 'a draft is not saved by itself');

  r = await call(A, 'POST', P + '/ai-draft', { description: 'A broken game where the hero needs the fleece to escape.' });
  const two = mock().slice(1);
  note(two.length === 2 && two[1].body.messages.length === 3 && /No one can survive|survive/i.test(two[1].body.messages[2].content) && r.check.ok,
    'an unwinnable draft goes back once with the checker\'s problems and returns fixed');
  r = await call(A, 'POST', P + '/ai-draft', { description: 'A stubborn game where the hero needs the fleece to escape.' });
  note(r.status === 200 && !r.check.ok && r.check.problems.length && r.left === 0, `still unwinnable after one fix: shown with problems ("${(r.check.problems || [])[0]}")`);
  note((await call(A, 'POST', P + '/ai-draft', { description: DESC })).status === 429, 'the per-story cap (3) stops a 4th draft');

  await call(T, 'POST', '/teacher/ai-helper', { period: 'Test', drafts_per_story: 5 });
  note((await call(A, 'GET', P)).ai.left === 2, 'teacher raises the cap to 5 → 2 left');
  const before = mock().length;
  r = await call(A, 'POST', P + '/ai-draft', { description: 'Please refuse this hero game about the fleece.' });
  note(r.status === 502 && /different way/.test(r.error), `a refusal: "${r.error}"`);
  r = await call(A, 'POST', P + '/ai-draft', { description: 'fail500 hero game about the golden fleece.' });
  note(r.status === 502 && mock().length - before === 1 + 2, `an API error: "${r.error}" (SDK retried once)`);
  note((await call(A, 'GET', P)).ai.left === 2, 'failed tries don\'t use up drafts');

  console.log('\n== Using a draft');
  r = await call(A, 'POST', P + '/ai-draft', { description: DESC });
  let s = await call(A, 'PUT', P, { level: 'builder', template: null, things: r.draft.things, rules: r.draft.rules, start: r.draft.start, clue_text: '' });
  note(s.game.level === 'builder' && s.game.check.problems.length === 1 && /clue/.test(s.game.check.problems[0]), 'used as a Builder game; only the clue is missing');
  s = await call(A, 'PUT', P, { level: 'builder', things: s.game.things, rules: s.game.rules, start: s.game.start, clue_text: 'Only the one who carries the fleece may leave.' });
  note(s.game.check.ok, 'with the clue picked it passes the check');
  await call(A, 'POST', P + '/submit');
  note((await call(A, 'POST', P + '/ai-draft', { description: DESC })).status === 409, 'no helper drafts while the game is with the teacher');
  st = await call(T, 'GET', '/teacher/ai-helper?period=Test');
  const outcomes = st.log.map(x => x.outcome).reverse().join(',');
  note(outcomes === 'ok,ok,problems,error,error,ok' && st.log[0].description === DESC && st.log[0].student_name === 'Student A', `teacher log: ${outcomes}`);
  await call(T, 'POST', '/teacher/ai-helper', { period: 'Test', enabled: false });
  await call(A, 'POST', P + '/edit-again');
  note((await call(A, 'GET', P)).ai.available === false, 'turned off again → students no longer see it');
  console.log(`\nPROBLEMS (${problems.length})` + (problems.length ? ':\n - ' + problems.join('\n - ') : ''));
})().catch(e => { console.error('CRASH', e); process.exit(1); });
