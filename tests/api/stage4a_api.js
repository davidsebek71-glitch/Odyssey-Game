// Stage 4A API test. Alliance 1 = A,B (owns Armory + Dock). Alliance 2 = C,D. Alliance 3 = E,F,I. Alliance 4 = G,H.
const ENV = require('../lib/env');
const fs = require('fs');
const B = ENV.API;
const RNG = ENV.RNG_FILE;
const call = async (t, m, p, b) => { const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined }); let j = {}; try { j = await r.json(); } catch {} return { status: r.status, ...j }; };
const login = async (k, e) => (await call(null, 'POST', `/auth/${k}/login`, { email: e, password: 'pw-test-1' })).token;
const problems = []; const note = (ok, msg) => { console.log((ok ? '  ✓ ' : '  ✗ ') + msg); if (!ok) problems.push(msg); };
const MON = Object.fromEntries(JSON.parse(fs.readFileSync(ENV.REPO + '/data/monsters.json', 'utf8')).monsters.map(m => [m.key, m]));
const pts = async t => (await call(t, 'GET', '/olympus/state')).alliance.total_points;
const words = n => Array.from({ length: n }, (_, i) => 'word' + i).join(' ');

(async () => {
  const T = await login('teacher', 'teacher@test.local');
  const tok = {}; for (const l of 'ABCDEGH') tok[l] = await login('student', `stu${l}@test.local`);
  const id = async l => (await call(tok[l], 'GET', '/island/me')).student.student_id;
  await call(T, 'POST', '/teacher/island/reset-test', { confirm_period: 'Test' });
  for (const a of [1, 2, 3, 4]) await call(T, 'POST', '/teacher/set-points', { alliance_id: a, new_total: 1000, reason: 'stage 4 test' });

  console.log('== Evidence cards → god powers');
  let r = await call(tok.A, 'PUT', '/gods/athena/card', { claim: 'Athena helps clever heroes', evidence_text: '"gave him a polished shield"' });
  r = await call(tok.A, 'POST', '/gods/athena/card/submit');
  note(r.status === 400 && /at least 8 words/.test(r.error), `short claim refused: "${r.error}"`);
  await call(tok.A, 'PUT', '/gods/athena/card', { claim: 'Athena helps heroes who use their minds instead of only their strength.', evidence_text: '"Athena gave him a polished shield" and he watched Medusa\'s reflection', source_note: 'p. 42' });
  r = await call(tok.A, 'POST', '/gods/athena/card/submit');
  note(r.status === 'submitted', 'A submits an Athena evidence card');
  note((await call(tok.A, 'PUT', '/gods/athena/card', { claim: 'x' })).status === 409, 'a submitted card is locked');
  let q = await call(T, 'GET', '/teacher/gods/cards?period=Test');
  const cardA = q.cards.find(c => c.god === 'athena');
  note(cardA && cardA.student_name === 'Student A' && cardA.source_note === 'p. 42', 'teacher queue shows the card');
  await call(T, 'POST', `/teacher/gods/cards/${cardA.power_id}/review`, { action: 'approve' });
  await call(tok.B, 'PUT', '/gods/hermes/card', { claim: 'Hermes uses tricks and speed to help heroes in danger.', evidence_text: '"Hermes lent him winged sandals"' });
  await call(tok.B, 'POST', '/gods/hermes/card/submit');
  const cardB = (await call(T, 'GET', '/teacher/gods/cards?period=Test')).cards.find(c => c.god === 'hermes');
  note((await call(T, 'POST', `/teacher/gods/cards/${cardB.power_id}/review`, { action: 'return' })).status === 400, 'returning needs a note');
  await call(T, 'POST', `/teacher/gods/cards/${cardB.power_id}/review`, { action: 'return', note: 'Explain how the quote proves it.' });
  let g = await call(tok.B, 'GET', '/gods');
  note(g.gods.find(x => x.key === 'hermes').card.status === 'returned' && g.gods.find(x => x.key === 'hermes').card.teacher_note, 'B sees "returned" with the note');
  await call(tok.B, 'PUT', '/gods/hermes/card', { claim: 'Hermes uses tricks and speed to help heroes in danger.', evidence_text: '"Hermes lent him winged sandals" so Perseus could fly away safely' });
  await call(tok.B, 'POST', '/gods/hermes/card/submit');
  await call(T, 'POST', `/teacher/gods/cards/${cardB.power_id}/review`, { action: 'approve' });
  g = await call(tok.A, 'GET', '/gods');
  note(g.alliance_powers.map(p => p.god).sort().join(',') === 'athena,hermes', `A's alliance can use: ${g.alliance_powers.map(p => `${p.emoji} ${p.power} (${p.holders[0].name})`).join(', ')}`);
  note((await call(tok.C, 'GET', '/gods')).alliance_powers.length === 0, 'another alliance does not share those powers');

  console.log('\n== Awakening and what monsters block');
  let ov = await call(T, 'GET', '/teacher/monsters/overview?period=Test');
  const a1 = ov.alliances.find(a => a.alliance_id === 1);
  note(ov.monsters.length === 5 && a1.buildings.includes('Armory'), `overview: ${ov.monsters.length} monsters; alliance 1 battle power ${a1.battle_power}${a1.underdog ? ' (underdog)' : ''}`);
  const power0 = a1.battle_power;
  r = await call(T, 'POST', '/teacher/monsters/awaken', { alliance_id: 1, monster_key: 'medusa', blocks: 'harbor' });
  note(r.monster && /guarding your harbor/.test(r.message), `"${r.message}"`);
  note((await call(T, 'POST', '/teacher/monsters/awaken', { alliance_id: 1, monster_key: 'typhon', blocks: 'harbor' })).status === 409, 'only one monster can hold a harbor');
  const w = await call(tok.A, 'GET', '/voyage/world');
  note(w.harbor_blocked_by === 'Medusa', 'world map tells alliance 1 its harbor is blocked');
  // a published piece by C (alliance 2) to try to visit
  await call(T, 'POST', '/teacher/force-pass-quiz', { student_name: 'Student C', class_period: 'Test', portal_id: 1, score: 9, total_questions: 10 });
  const mapPng = 'data:image/png;base64,' + fs.readFileSync(ENV.REPO + '/public/images/classical/Psyche/palace_bg.png').toString('base64');
  await call(tok.C, 'POST', '/student/upload-map', { map_image: mapPng });
  const quest = (await call(tok.C, 'GET', '/island/me')).quests.find(x => x.unlocked);
  const pin = (await call(tok.C, 'POST', '/island/pins', { quest_id: quest.quest_id, x_pct: 50, y_pct: 50 })).pin;
  await call(tok.C, 'PATCH', `/island/pins/${pin.pin_id}`, { title: 'C\'s shrine', body: words(85) });
  await call(tok.C, 'PUT', `/island/pins/${pin.pin_id}/question`, { prompt: 'What stayed in the jar?', options: ['Hope', 'Fire'], correct_index: 0 });
  await call(tok.C, 'POST', `/island/pins/${pin.pin_id}/submit`);
  await call(T, 'POST', `/teacher/island/pins/${pin.pin_id}/review`, { action: 'approve' });
  await call(T, 'POST', '/teacher/voyage/settings', { class_period: 'Test', mode: 'voyage', visit_cap: 5 });
  for (const a of [1, 3]) await call(T, 'POST', '/teacher/voyage/tokens', { alliance_id: a, delta: 3 });
  r = await call(tok.A, 'POST', '/voyage/visits', { pin_id: pin.pin_id });
  note(r.status === 409 && /Medusa is guarding your harbor/.test(r.error), `harbor block stops A's voyage: "${r.error}"`);

  r = await call(T, 'POST', '/teacher/monsters/awaken', { alliance_id: 1, monster_key: 'hydra', blocks: 'building', block_target: 'Armory' });
  ov = await call(T, 'GET', '/teacher/monsters/overview?period=Test');
  const power1 = ov.alliances.find(a => a.alliance_id === 1).battle_power;
  note(power0 - power1 >= 150, `the Hydra seizes the Armory: battle power ${power0} → ${power1}`);
  const award0 = await call(T, 'POST', '/teacher/award-points', { alliance_id: 1, student_id: await id('A'), amount: 100, category: 'quiz', reason: `bonus check before ${Date.now()}` });
  await call(T, 'POST', '/teacher/monsters/awaken', { alliance_id: 1, monster_key: 'cerberus', blocks: 'building', block_target: 'Dock' });
  const award1 = await call(T, 'POST', '/teacher/award-points', { alliance_id: 1, student_id: await id('A'), amount: 100, category: 'quiz', reason: `bonus check after ${Date.now()}` });
  note(award0.bonusBreakdown.building_bonus > 0 && award1.bonusBreakdown.building_bonus === 0,
    `Cerberus seizes the Dock: building bonus on points ${award0.bonusBreakdown.building_bonus}% → ${award1.bonusBreakdown.building_bonus}%`);
  await call(T, 'POST', '/teacher/set-points', { alliance_id: 1, new_total: 1000, reason: 'reset after bonus check' });

  r = await call(T, 'POST', '/teacher/monsters/awaken', { alliance_id: 2, monster_key: 'minotaur', blocks: 'region', owner_student_id: await id('C'), x_pct: 52, y_pct: 48 });
  note(/lurking on Student C's island/.test(r.message), `"${r.message}"`);
  const viewE = await call(tok.E, 'GET', `/island/view/${await id('C')}`);
  note(viewE.monsters.length === 1 && viewE.pins.find(p => p.pin_id === pin.pin_id).blocked, 'E sees the Minotaur on C\'s island and the piece marked blocked');
  r = await call(tok.E, 'POST', '/voyage/visits', { pin_id: pin.pin_id });
  note(r.status === 409 && /monster lurks/.test(r.error), `E can't visit it: "${r.error}"`);
  const mine = await call(tok.C, 'GET', '/island/me');
  note(mine.monsters.length === 1, 'C sees the monster on their own island too');

  console.log('\n== Battle: win');
  let mon = await call(tok.A, 'GET', '/monsters/mine');
  note(mon.monsters.length === 3 && mon.monsters.every(m => !m.can_battle_reason), `alliance 1 faces ${mon.monsters.map(m => m.name).join(', ')}`);
  const medusa = mon.monsters.find(m => m.monster_key === 'medusa');
  note((await call(tok.C, 'POST', `/monsters/${medusa.island_monster_id}/battles`)).status === 404, 'another alliance cannot fight it');
  let bt = (await call(tok.A, 'POST', `/monsters/${medusa.island_monster_id}/battles`)).battle;
  note(bt.status === 'choose_power' && bt.questions.length === 3 && bt.questions.every(x => x.correct_index === undefined) && bt.monster.passage.length > 100,
    'battle starts: passage + 3 questions (answers hidden)');
  note(bt.powers.find(p => p.god === 'hermes').matchup === 'effective', 'Hermes is shown as effective against Medusa');
  note((await call(tok.B, 'POST', `/monsters/${medusa.island_monster_id}/battles`)).rejoined, 'B joins the same battle instead of starting another');
  note((await call(tok.A, 'POST', `/monsters/battles/${bt.battle_id}/power`, { god: 'zeus' })).status === 400, 'a power the alliance doesn\'t hold is refused');
  bt = (await call(tok.B, 'POST', `/monsters/battles/${bt.battle_id}/power`, { god: 'hermes' })).battle;
  note(bt.status === 'questions' && bt.matchup === 'effective', 'B chooses Hermes (effective)');
  for (const qq of bt.questions) {
    const correct = MON.medusa.questions.find(x => x.prompt === qq.prompt).correct_index;
    bt = (await call(tok.A, 'POST', `/monsters/battles/${bt.battle_id}/answer`, { question: qq.index, answer_index: correct })).battle;
  }
  note(bt.status === 'roll' && bt.questions_correct === 3, 'three right answers');
  const again = (await call(tok.A, 'POST', `/monsters/battles/${bt.battle_id}/answer`, { question: 0, answer_index: 3 })).battle;
  note(again.questions_correct === 3, 'an answer can\'t be changed');
  const before = await pts(tok.A);
  fs.writeFileSync(RNG, JSON.stringify([0.9, 0.1]));
  bt = (await call(tok.A, 'POST', `/monsters/battles/${bt.battle_id}/roll`)).battle;
  const expMonster = Math.floor(1000 * 0.75 * (1 - 0.35));
  note(bt.outcome === 'won' && bt.monster_max === expMonster && bt.alliance_max === Math.floor(power1 * 1.3),
    `roll: alliance ${bt.alliance_roll}/${bt.alliance_max} (power ${power1} × 1.3) vs Medusa ${bt.monster_roll}/${bt.monster_max} (1000 × 0.75 × 0.65) → ${bt.outcome}`);
  note((await pts(tok.A)) === before + 40, `+40 points (${before} → ${await pts(tok.A)})`);
  const rollAgain = (await call(tok.A, 'POST', `/monsters/battles/${bt.battle_id}/roll`)).battle;
  note((await pts(tok.A)) === before + 40 && rollAgain.outcome === 'won', 'rolling twice changes nothing');
  note(!(await call(tok.A, 'GET', '/voyage/world')).harbor_blocked_by, 'Medusa defeated → the harbor is open again');

  console.log('\n== Battle: loss, rematch rule');
  const hydra = (await call(tok.A, 'GET', '/monsters/mine')).monsters.find(m => m.monster_key === 'hydra');
  bt = (await call(tok.A, 'POST', `/monsters/${hydra.island_monster_id}/battles`)).battle;
  bt = (await call(tok.A, 'POST', `/monsters/battles/${bt.battle_id}/power`, { god: 'athena' })).battle;
  for (const qq of bt.questions) bt = (await call(tok.A, 'POST', `/monsters/battles/${bt.battle_id}/answer`, { question: qq.index, answer_index: (MON.hydra.questions.find(x => x.prompt === qq.prompt).correct_index + 1) % 4 })).battle;
  note(bt.questions_correct === 0 && bt.questions.every(x => x.correct === false && x.correct_index !== undefined), 'wrong answers are shown with the right ones after answering');
  const b2 = await pts(tok.A);
  fs.writeFileSync(RNG, JSON.stringify([0.0, 0.99]));
  bt = (await call(tok.A, 'POST', `/monsters/battles/${bt.battle_id}/roll`)).battle;
  note(bt.outcome === 'lost' && (await pts(tok.A)) === b2 - 20, `lost: −20 points (${b2} → ${await pts(tok.A)}); the Hydra stays`);
  r = await call(tok.A, 'POST', `/monsters/${hydra.island_monster_id}/battles`);
  note(r.status === 409 && /next class/.test(r.error), `no second try today: "${r.error}"`);
  await call(T, 'POST', `/teacher/monsters/${hydra.island_monster_id}/rematch`);
  bt = (await call(tok.A, 'POST', `/monsters/${hydra.island_monster_id}/battles`)).battle;
  note(bt && bt.status === 'choose_power', 'teacher allows a rematch → a new battle starts');
  bt = (await call(tok.A, 'POST', `/monsters/battles/${bt.battle_id}/power`, { god: 'athena' })).battle;
  for (const qq of bt.questions) bt = (await call(tok.A, 'POST', `/monsters/battles/${bt.battle_id}/answer`, { question: qq.index, answer_index: MON.hydra.questions.find(x => x.prompt === qq.prompt).correct_index })).battle;
  fs.writeFileSync(RNG, JSON.stringify([0.95, 0.05]));
  bt = (await call(tok.A, 'POST', `/monsters/battles/${bt.battle_id}/roll`)).battle;
  ov = await call(T, 'GET', '/teacher/monsters/overview?period=Test');
  const al1 = ov.alliances.find(a => a.alliance_id === 1);
  const expected = Math.floor((al1.total_points + 150) * (al1.underdog ? 1.25 : 1));
  note(bt.outcome === 'won' && al1.battle_power === expected, `Hydra defeated → the Armory counts again (power ${al1.battle_power} = (${al1.total_points} + 150)${al1.underdog ? ' × 1.25' : ''})`);

  console.log('\n== Teacher fixes and the random "Fate" roll');
  const g4 = await call(T, 'POST', '/teacher/monsters/awaken', { alliance_id: 4, random: true });
  note(g4.monster && g4.monster.status === 'awake', `random awakening for alliance 4: "${g4.message}"`);
  r = await call(tok.G, 'POST', `/monsters/${g4.monster.island_monster_id}/battles`);
  note(r.status === 409 && /god power/.test(r.error), `no god powers yet: "${r.error}"`);
  const mino = (await call(T, 'GET', '/teacher/monsters/overview?period=Test')).alliances.find(a => a.alliance_id === 2).monsters.find(m => m.monster_key === 'minotaur');
  await call(T, 'POST', `/teacher/monsters/${mino.island_monster_id}/sleep`);
  r = await call(tok.E, 'POST', '/voyage/visits', { pin_id: pin.pin_id });
  note(r.visit, 'teacher puts the Minotaur back to sleep → E can visit C\'s piece');
  if (r.visit) await call(tok.E, 'POST', `/voyage/visits/${r.visit.visit_id}/cancel`);
  note((await call(tok.A, 'POST', '/teacher/monsters/awaken', { alliance_id: 1, random: true })).status === 403, 'students cannot awaken monsters');

  console.log(`\nPROBLEMS (${problems.length})` + (problems.length ? ':\n - ' + problems.join('\n - ') : ''));
})().catch(e => { console.error('CRASH', e); process.exit(1); });
