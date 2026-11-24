// ============================================================================
// GODS & MONSTERS — Stage 4A: god powers, monster awakening, blocks, battles
// ----------------------------------------------------------------------------
// God powers: a student writes an evidence card for a god (claim + quotation);
// when the teacher approves it the student holds that god's power, and their
// whole alliance can use it in battles. Gods: data/gods.json.
//
// Monsters (data/monsters.json) are awakened against an alliance by the teacher
// (chosen, or a random "Fate" roll). An awake monster blocks ONE thing:
//   harbor   — the alliance can't start voyage visits
//   building — that building's bonus doesn't count (point bonus + battle power)
//   region   — an area of one member's island stays fogged; pieces there can't
//              be visited
//
// Battle (turn-based, no clock; any alliance member can take each step):
//   1. choose one god power held by someone in the alliance
//   2. answer 3 questions on the monster's myth (one try each)
//   3. roll:  alliance max = battle power (points + tech, walls, armory, forge,
//                            underdog +25%, as in Fate battles) × (1 + 10% per right answer)
//             monster max  = points × difficulty_factor × (1 − matchup reduction)
//             matchup: effective −35% · neutral −15% · resisted 0%
//      win  → monster defeated, block lifted, win_points
//      loss → lose_points, monster stays; next try the next day (or when the
//             teacher allows a rematch)
// ============================================================================
const fs = require('fs');
const path = require('path');

const AGE_FACTOR = { Archaic: 0.25, Classical: 0.5, Heroic: 0.75 };
const MATCHUP_REDUCTION = { effective: 0.35, neutral: 0.15, resisted: 0 };
const ANSWER_BONUS = 0.10;
const QUESTIONS_PER_BATTLE = 3;
const REGION_RADIUS = 18;   // % of the map
const BLOCKS = ['harbor', 'building', 'region'];
const BLOCKABLE_BUILDINGS_WITH_POWER = { 'Stone Wall': 100, 'Wooden Wall': 50, 'Armory': 150, "Hero's Forge": 200 };

function readJson(file, key) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8'))[key] || []; }
  catch (e) { console.error(`❌ data/${file}:`, e.message); return []; }
}

module.exports = function registerMonsterRoutes(app, deps) {
  const { authenticateToken, query, run } = deps;
  const voyage = require('./voyage_helpers')({ query, run });
  let GODS = [], MONSTERS = [];
  function loadContent() {
    GODS = readJson('gods.json', 'gods');
    MONSTERS = readJson('monsters.json', 'monsters').map(m => Object.assign({
      difficulty_factor: AGE_FACTOR[m.age] || 0.5, win_points: 25, lose_points: -10, matchups: {}, questions: []
    }, m));
    console.log(`⚔️  Gods: ${GODS.length} · Monsters: ${MONSTERS.length}`);
  }
  loadContent();
  const god = key => GODS.find(g => g.key === key);
  const monster = key => MONSTERS.find(m => m.key === key);

  const isTeacher = req => req.user && req.user.type === 'teacher';
  const teacherOnly = (req, res) => { if (!isTeacher(req)) { res.status(403).json({ error: 'Teacher access required' }); return false; } return true; };
  const getStudent = id => query('SELECT student_id, name, class_period, alliance_id FROM students WHERE student_id = ?', [id])[0] || null;
  const studentOnly = (req, res) => {
    if (req.user.type !== 'student') { res.status(403).json({ error: 'Students only' }); return null; }
    const me = getStudent(req.user.id); if (!me) { res.status(404).json({ error: 'Student not found' }); return null; }
    return me;
  };
  const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
  const clean = (v, max) => typeof v === 'string' ? v.replace(/\u0000/g, '').slice(0, max) : '';
  const words = t => (t || '').trim().split(/\s+/).filter(Boolean).length;
  const getAlliance = id => query('SELECT * FROM alliances WHERE alliance_id = ?', [id])[0] || null;
  const getIM = id => query('SELECT * FROM island_monsters WHERE island_monster_id = ?', [id])[0] || null;
  const getBattle = id => query('SELECT * FROM monster_battles WHERE battle_id = ?', [id])[0] || null;

  // ── Blocks (also used by server.js, routes/voyage.js, routes/island.js) ───
  const awakeFor = allianceId => query(`SELECT * FROM island_monsters WHERE alliance_id = ? AND status = 'awake'`, [allianceId]);
  function blockedBuildings(allianceId) {
    if (!allianceId) return [];
    return awakeFor(allianceId).filter(m => m.blocks === 'building' && m.block_target).map(m => m.block_target);
  }
  function harborBlockedBy(allianceId) {
    if (!allianceId) return null;
    const m = awakeFor(allianceId).find(x => x.blocks === 'harbor');
    return m ? displayName(m) : null;
  }
  // Awake region monsters on one student's island
  function regionMonsters(ownerStudentId) {
    return query(`SELECT * FROM island_monsters WHERE owner_student_id = ? AND blocks = 'region' AND status = 'awake'`, [ownerStudentId])
      .map(m => ({ island_monster_id: m.island_monster_id, name: displayName(m), emoji: displayEmoji(m), x_pct: m.x_pct, y_pct: m.y_pct, radius: REGION_RADIUS }));
  }
  function inRegion(pin, regions) {
    return regions.some(r => pin.x_pct !== null && Math.hypot(pin.x_pct - r.x_pct, pin.y_pct - r.y_pct) <= r.radius);
  }
  function displayName(im) {
    if (im.monster_key) { const m = monster(im.monster_key); return m ? m.name : im.monster_key; }
    const p = im.pin_id && query('SELECT title FROM island_pins WHERE pin_id = ?', [im.pin_id])[0];
    return p ? p.title : 'A monster';
  }
  function displayEmoji(im) { const m = im.monster_key && monster(im.monster_key); return m ? m.emoji : '👹'; }
  function blockText(im) {
    if (im.blocks === 'harbor') return 'is guarding your harbor — no voyages until it is defeated';
    if (im.blocks === 'building') return `has seized your ${im.block_target} — its bonus doesn't count until the monster is defeated`;
    const owner = im.owner_student_id && getStudent(im.owner_student_id);
    return `is lurking on ${owner ? owner.name + '\'s' : 'an'} island — that region stays in fog and can't be visited`;
  }

  // Battle power, following the Fate battle rules (tech multiplier, walls,
  // armory, forge, underdog +25%). A building a monster has seized gives nothing.
  function battlePower(alliance) {
    let power = alliance.total_points;
    const members = query('SELECT technologies_unlocked FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)', [alliance.alliance_id]);
    let tech = 1.0;
    members.forEach(m => {
      const techs = parse(m.technologies_unlocked || '[]', []);
      if (!techs.length) return;
      query(`SELECT bonus_value, bonus_type FROM technologies_ref WHERE tech_name IN (${techs.map(() => '?').join(',')})`, techs)
        .forEach(t => { if (t.bonus_type === 'earning_multiplier') tech *= (1 + t.bonus_value); });
    });
    power = Math.floor(power * tech);
    const owned = parse(alliance.buildings_owned || '[]', []);
    const blocked = new Set(blockedBuildings(alliance.alliance_id));
    const has = b => owned.includes(b) && !blocked.has(b);
    if (has('Stone Wall')) power += 100; else if (has('Wooden Wall')) power += 50;
    if (has('Armory')) power += 150;
    if (has("Hero's Forge")) power += 200;
    const lowest = query('SELECT alliance_id FROM alliances WHERE class_period = ? AND is_disbanded = 0 ORDER BY total_points ASC LIMIT 1', [alliance.class_period])[0];
    const underdog = !!(lowest && lowest.alliance_id === alliance.alliance_id);
    if (underdog) power = Math.floor(power * 1.25);
    return { power, underdog };
  }

  // Powers the alliance can use: approved cards held by its (real) members
  function alliancePowers(allianceId) {
    const rows = query(`SELECT gp.god, s.name, s.student_id FROM god_powers gp JOIN students s ON s.student_id = gp.student_id
      WHERE s.alliance_id = ? AND gp.status = 'approved' AND (s.is_ghost = 0 OR s.is_ghost IS NULL) ORDER BY gp.god`, [allianceId]);
    const out = {};
    rows.forEach(r => { (out[r.god] = out[r.god] || []).push({ student_id: r.student_id, name: r.name }); });
    return Object.entries(out).map(([g, holders]) => {
      const gd = god(g) || { key: g, name: g, emoji: '✨', power: g };
      return { god: g, name: gd.name, emoji: gd.emoji, power: gd.power, holders };
    });
  }

  // Can the alliance fight this monster right now?
  function battleBlock(im) {
    if (im.status !== 'awake') return 'This monster isn\'t awake.';
    const open = query(`SELECT battle_id FROM monster_battles WHERE island_monster_id = ? AND status != 'done' LIMIT 1`, [im.island_monster_id])[0];
    if (open) return null;   // continue it
    if (!im.rematch_ok) {
      const lostToday = query(`SELECT 1 FROM monster_battles WHERE island_monster_id = ? AND outcome = 'lost' AND date(finished_at) = date('now') LIMIT 1`, [im.island_monster_id]);
      if (lostToday.length) return 'Your alliance lost to this monster today. Rest and try again next class.';
    }
    if (!alliancePowers(im.alliance_id).length) return 'Your alliance needs at least one god power. Earn one with an evidence card.';
    return null;
  }
  function imOut(im) {
    const m = im.monster_key ? monster(im.monster_key) : null;
    const open = query(`SELECT battle_id FROM monster_battles WHERE island_monster_id = ? AND status != 'done' LIMIT 1`, [im.island_monster_id])[0];
    const last = query(`SELECT outcome, finished_at FROM monster_battles WHERE island_monster_id = ? AND status = 'done' ORDER BY battle_id DESC LIMIT 1`, [im.island_monster_id])[0];
    return {
      island_monster_id: im.island_monster_id, monster_key: im.monster_key, name: displayName(im), emoji: displayEmoji(im),
      age: m ? m.age : null, terrain: m ? m.terrain : null, myth: m ? m.myth : null,
      blocks: im.blocks, block_target: im.block_target, block_text: blockText(im), owner_student_id: im.owner_student_id,
      status: im.status, awakened_at: im.awakened_at, defeated_at: im.defeated_at,
      battle_id: open ? open.battle_id : null, can_battle_reason: im.status === 'awake' ? battleBlock(im) : null,
      last_outcome: last ? last.outcome : null
    };
  }

  // ── STUDENT: god powers ───────────────────────────────────────────────────
  app.get('/api/gods', authenticateToken, (req, res) => {
    const me = studentOnly(req, res); if (!me) return;
    const cards = query('SELECT * FROM god_powers WHERE student_id = ?', [me.student_id]);
    res.json({
      gods: GODS.map(g => { const c = cards.find(x => x.god === g.key);
        return Object.assign({}, g, { card: c ? { status: c.status, claim: c.claim, evidence_text: c.evidence_text, source_note: c.source_note, teacher_note: c.teacher_note } : null }); }),
      alliance_powers: me.alliance_id ? alliancePowers(me.alliance_id) : []
    });
  });
  // Autosave a card (draft or returned)
  app.put('/api/gods/:key/card', authenticateToken, (req, res) => {
    const me = studentOnly(req, res); if (!me) return;
    if (!god(req.params.key)) return res.status(404).json({ error: 'Unknown god' });
    const c = query('SELECT * FROM god_powers WHERE student_id = ? AND god = ?', [me.student_id, req.params.key])[0];
    if (c && !['draft', 'returned'].includes(c.status)) return res.status(409).json({ error: c.status === 'approved' ? 'You already hold this power.' : 'Waiting for teacher approval — it can\'t be changed right now.' });
    const b = req.body || {};
    const claim = clean(b.claim, 1000), ev = clean(b.evidence_text, 2000), src = clean(b.source_note, 200);
    if (c) run(`UPDATE god_powers SET claim=?, evidence_text=?, source_note=?, updated_at=CURRENT_TIMESTAMP WHERE power_id=?`, [claim, ev, src, c.power_id]);
    else run(`INSERT INTO god_powers (student_id, god, claim, evidence_text, source_note) VALUES (?,?,?,?,?)`, [me.student_id, req.params.key, claim, ev, src]);
    res.json({ saved: true });
  });
  app.post('/api/gods/:key/card/submit', authenticateToken, (req, res) => {
    const me = studentOnly(req, res); if (!me) return;
    const c = query('SELECT * FROM god_powers WHERE student_id = ? AND god = ?', [me.student_id, req.params.key])[0];
    if (!c) return res.status(400).json({ error: 'Write your evidence card first.' });
    if (c.status === 'submitted' || c.status === 'approved') return res.json({ status: c.status, already: true });
    if (words(c.claim) < 8) return res.status(400).json({ error: `Write a full claim (at least 8 words; you have ${words(c.claim)}).` });
    if (words(c.evidence_text) < 5) return res.status(400).json({ error: 'Add a quotation from the text as your evidence.' });
    run(`UPDATE god_powers SET status='submitted', submitted_at=CURRENT_TIMESTAMP WHERE power_id=?`, [c.power_id]);
    res.json({ status: 'submitted' });
  });

  // ── STUDENT: monsters and battles ─────────────────────────────────────────
  app.get('/api/monsters/mine', authenticateToken, (req, res) => {
    const me = studentOnly(req, res); if (!me) return;
    if (!me.alliance_id) return res.json({ monsters: [], defeated: [], powers: [] });
    const all = query('SELECT * FROM island_monsters WHERE alliance_id = ? AND monster_key IS NOT NULL ORDER BY island_monster_id DESC', [me.alliance_id]);
    res.json({ monsters: all.filter(m => m.status === 'awake').map(imOut), defeated: all.filter(m => m.status === 'defeated').map(imOut), powers: alliancePowers(me.alliance_id) });
  });

  function battleOut(b) {
    const im = getIM(b.island_monster_id), m = monster(im.monster_key);
    const qids = parse(b.question_ids, []), answers = parse(b.answers, {});
    const alliance = getAlliance(b.alliance_id);
    return {
      battle_id: b.battle_id, status: b.status, island_monster_id: im.island_monster_id,
      monster: { name: m.name, emoji: m.emoji, myth: m.myth, age: m.age, terrain: m.terrain, passage: m.passage, block_text: blockText(im) },
      powers: alliancePowers(b.alliance_id).map(p => Object.assign(p, { matchup: m.matchups[p.god] || 'neutral' })),
      power_god: b.power_god, matchup: b.matchup,
      questions: qids.map((qi, n) => {
        const q = m.questions[qi]; const a = answers[n];
        return { index: n, prompt: q.prompt, options: q.options, answer_index: a === undefined ? null : a,
          correct: a === undefined ? null : a === q.correct_index, correct_index: a === undefined ? undefined : q.correct_index };
      }),
      questions_correct: b.questions_correct, alliance_points: alliance.total_points,
      alliance_max: b.alliance_max, monster_max: b.monster_max, alliance_roll: b.alliance_roll, monster_roll: b.monster_roll,
      outcome: b.outcome, points_change: b.points_change
    };
  }
  const memberBattle = (req, res) => {
    const me = studentOnly(req, res); if (!me) return null;
    const b = getBattle(parseInt(req.params.id));
    if (!b || b.alliance_id !== me.alliance_id) { res.status(404).json({ error: 'Battle not found' }); return null; }
    return { me, b };
  };

  // Start (or rejoin) the battle against an awake monster
  app.post('/api/monsters/:imId/battles', authenticateToken, (req, res) => {
    const me = studentOnly(req, res); if (!me) return;
    const im = getIM(parseInt(req.params.imId));
    if (!im || im.alliance_id !== me.alliance_id || !im.monster_key) return res.status(404).json({ error: 'Monster not found' });
    const open = query(`SELECT * FROM monster_battles WHERE island_monster_id = ? AND status != 'done' LIMIT 1`, [im.island_monster_id])[0];
    if (open) return res.json({ battle: battleOut(open), rejoined: true });
    const why = battleBlock(im);
    if (why) return res.status(409).json({ error: why });
    const m = monster(im.monster_key);
    const pool = m.questions.map((_, i) => i).sort(() => Math.random() - 0.5).slice(0, QUESTIONS_PER_BATTLE);
    run(`INSERT INTO monster_battles (island_monster_id, alliance_id, started_by, question_ids) VALUES (?,?,?,?)`,
      [im.island_monster_id, me.alliance_id, me.student_id, JSON.stringify(pool)]);
    run('UPDATE island_monsters SET rematch_ok = 0 WHERE island_monster_id = ?', [im.island_monster_id]);
    res.json({ battle: battleOut(getBattle(query('SELECT last_insert_rowid() AS id')[0].id)) });
  });

  app.get('/api/monsters/battles/:id', authenticateToken, (req, res) => {
    const x = memberBattle(req, res); if (!x) return;
    res.json({ battle: battleOut(x.b) });
  });

  // Step 1: choose one god power held by the alliance
  app.post('/api/monsters/battles/:id/power', authenticateToken, (req, res) => {
    const x = memberBattle(req, res); if (!x) return;
    const { b } = x;
    if (b.status !== 'choose_power') return res.json({ battle: battleOut(b) });
    const g = (req.body || {}).god;
    const p = alliancePowers(b.alliance_id).find(pw => pw.god === g);
    if (!p) return res.status(400).json({ error: 'Your alliance doesn\'t hold that power yet.' });
    const m = monster(getIM(b.island_monster_id).monster_key);
    run(`UPDATE monster_battles SET power_god = ?, power_student_id = ?, matchup = ?, status = 'questions' WHERE battle_id = ? AND status = 'choose_power'`,
      [g, p.holders[0].student_id, m.matchups[g] || 'neutral', b.battle_id]);
    res.json({ battle: battleOut(getBattle(b.battle_id)) });
  });

  // Step 2: one try per question
  app.post('/api/monsters/battles/:id/answer', authenticateToken, (req, res) => {
    const x = memberBattle(req, res); if (!x) return;
    const { b } = x;
    if (b.status !== 'questions') return res.json({ battle: battleOut(b) });
    const qn = parseInt((req.body || {}).question), ai = parseInt((req.body || {}).answer_index);
    const qids = parse(b.question_ids, []), answers = parse(b.answers, {});
    const m = monster(getIM(b.island_monster_id).monster_key);
    if (!Number.isInteger(qn) || qn < 0 || qn >= qids.length) return res.status(400).json({ error: 'Unknown question' });
    if (answers[qn] !== undefined) return res.json({ battle: battleOut(b) });
    const q = m.questions[qids[qn]];
    if (!Number.isInteger(ai) || ai < 0 || ai >= q.options.length) return res.status(400).json({ error: 'Choose an answer.' });
    answers[qn] = ai;
    const correct = qids.filter((qi, n) => answers[n] === m.questions[qi].correct_index).length;
    const done = Object.keys(answers).length === qids.length;
    run(`UPDATE monster_battles SET answers = ?, questions_correct = ?, status = ? WHERE battle_id = ?`,
      [JSON.stringify(answers), correct, done ? 'roll' : 'questions', b.battle_id]);
    res.json({ battle: battleOut(getBattle(b.battle_id)) });
  });

  // Step 3: roll the dice
  app.post('/api/monsters/battles/:id/roll', authenticateToken, (req, res) => {
    const x = memberBattle(req, res); if (!x) return;
    const { b } = x;
    if (b.status !== 'roll') return res.json({ battle: battleOut(b) });
    const im = getIM(b.island_monster_id), m = monster(im.monster_key), alliance = getAlliance(b.alliance_id);
    const { power } = battlePower(alliance);
    const allianceMax = Math.floor(power * (1 + ANSWER_BONUS * b.questions_correct));
    const reduction = MATCHUP_REDUCTION[b.matchup] ?? MATCHUP_REDUCTION.neutral;
    const monsterMax = Math.floor(alliance.total_points * m.difficulty_factor * (1 - reduction));
    const aRoll = Math.floor(Math.random() * (allianceMax + 1));
    const mRoll = Math.floor(Math.random() * (monsterMax + 1));
    const won = aRoll > mRoll;
    let change = won ? m.win_points : -Math.min(Math.abs(m.lose_points), alliance.total_points);
    // Mark the battle done first so a double click can't apply points twice
    run(`UPDATE monster_battles SET status = 'done', alliance_max = ?, monster_max = ?, alliance_roll = ?, monster_roll = ?, outcome = ?,
         points_change = ?, finished_at = CURRENT_TIMESTAMP WHERE battle_id = ? AND status = 'roll'`,
      [allianceMax, monsterMax, aRoll, mRoll, won ? 'won' : 'lost', change, b.battle_id]);
    if (change) voyage.addPoints(alliance.alliance_id, x.me.student_id, change, 'monster_battle',
      `${won ? 'Defeated' : 'Lost to'} ${m.name} (${b.power_god} power, ${b.questions_correct}/${parse(b.question_ids, []).length} right)`);
    if (won) run(`UPDATE island_monsters SET status = 'defeated', defeated_at = CURRENT_TIMESTAMP WHERE island_monster_id = ?`, [im.island_monster_id]);
    res.json({ battle: battleOut(getBattle(b.battle_id)) });
  });

  // ── TEACHER: evidence cards ───────────────────────────────────────────────
  app.get('/api/teacher/gods/cards', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    const period = req.query.period || null;
    const rows = query(`SELECT gp.*, s.name AS student_name, s.class_period, a.alliance_name FROM god_powers gp
      JOIN students s ON s.student_id = gp.student_id LEFT JOIN alliances a ON a.alliance_id = s.alliance_id
      WHERE gp.status = 'submitted' ${period ? 'AND s.class_period = ?' : ''} ORDER BY gp.submitted_at`, period ? [period] : []);
    res.json({ cards: rows.map(r => Object.assign(r, { god_name: (god(r.god) || {}).name || r.god, god_emoji: (god(r.god) || {}).emoji || '', prompt: (god(r.god) || {}).prompt || '' })) });
  });
  app.post('/api/teacher/gods/cards/:id/review', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    const c = query('SELECT * FROM god_powers WHERE power_id = ?', [parseInt(req.params.id)])[0];
    if (!c) return res.status(404).json({ error: 'Card not found' });
    const { action } = req.body || {}; const note = clean((req.body || {}).note, 1000).trim();
    if (action === 'approve') { run(`UPDATE god_powers SET status='approved', teacher_note=?, reviewed_at=CURRENT_TIMESTAMP WHERE power_id=?`, [note || null, c.power_id]); return res.json({ status: 'approved' }); }
    if (action === 'return') {
      if (!note) return res.status(400).json({ error: 'Add a note telling the student what to change.' });
      run(`UPDATE god_powers SET status='returned', teacher_note=?, reviewed_at=CURRENT_TIMESTAMP WHERE power_id=?`, [note, c.power_id]); return res.json({ status: 'returned' });
    }
    res.status(400).json({ error: 'action must be approve or return' });
  });

  // ── TEACHER: monsters ─────────────────────────────────────────────────────
  app.get('/api/teacher/monsters/overview', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    const period = req.query.period;
    if (!period) return res.status(400).json({ error: 'Choose a period.' });
    const alliances = query(`SELECT * FROM alliances WHERE class_period = ? AND is_disbanded = 0 ORDER BY alliance_name`, [period]).map(a => {
      const bp = battlePower(a);
      return {
        alliance_id: a.alliance_id, alliance_name: a.alliance_name, total_points: a.total_points, current_age: a.current_age,
        battle_power: bp.power, underdog: bp.underdog,
        buildings: parse(a.buildings_owned || '[]', []),
        members: query(`SELECT student_id, name, CASE WHEN map_image IS NOT NULL AND map_image != '' THEN 1 ELSE 0 END AS has_map
          FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL) ORDER BY name`, [a.alliance_id]),
        powers: alliancePowers(a.alliance_id),
        monsters: query(`SELECT * FROM island_monsters WHERE alliance_id = ? AND monster_key IS NOT NULL ORDER BY island_monster_id DESC`, [a.alliance_id]).map(im => Object.assign(imOut(im), { rematch_ok: !!im.rematch_ok })),
        battles: query(`SELECT battle_id, island_monster_id, power_god, matchup, questions_correct, alliance_max, monster_max, alliance_roll, monster_roll, outcome, points_change, finished_at
          FROM monster_battles WHERE alliance_id = ? AND status = 'done' ORDER BY battle_id DESC LIMIT 10`, [a.alliance_id])
      };
    });
    res.json({ monsters: MONSTERS.map(m => ({ key: m.key, name: m.name, emoji: m.emoji, age: m.age, terrain: m.terrain, myth: m.myth,
      difficulty_factor: m.difficulty_factor, win_points: m.win_points, lose_points: m.lose_points, matchups: m.matchups })), gods: GODS, alliances });
  });

  // Awaken a monster against an alliance. random: true picks a monster for
  // the alliance's age and a block it can actually suffer (the "Fate" roll).
  app.post('/api/teacher/monsters/awaken', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    const b = req.body || {};
    const alliance = getAlliance(parseInt(b.alliance_id));
    if (!alliance) return res.status(404).json({ error: 'Alliance not found' });
    const owned = parse(alliance.buildings_owned || '[]', []);
    const members = query(`SELECT student_id FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL) AND map_image IS NOT NULL AND map_image != ''`, [alliance.alliance_id]);
    const awake = awakeFor(alliance.alliance_id);
    let key = b.monster_key, blocks = b.blocks, target = b.block_target || null, owner = b.owner_student_id ? parseInt(b.owner_student_id) : null;
    let x = b.x_pct !== undefined ? Number(b.x_pct) : null, y = b.y_pct !== undefined ? Number(b.y_pct) : null, placedOnTerrain = false;
    const pick = arr => arr[Math.floor(Math.random() * arr.length)];
    if (b.random) {
      const age = alliance.current_age || 'Archaic';
      const asleep = MONSTERS.filter(m => !awake.some(a => a.monster_key === m.key));
      const fits = asleep.filter(m => m.age === age);
      const pool = fits.length ? fits : asleep;
      if (!pool.length) return res.status(409).json({ error: 'Every monster is already awake for this alliance.' });
      key = pick(pool).key;
      const options = [];
      if (!awake.some(a => a.blocks === 'harbor')) options.push('harbor');
      if (owned.some(bd => !awake.some(a => a.block_target === bd))) options.push('building');
      if (members.length) options.push('region');
      blocks = pick(options.length ? options : ['harbor']);
    }
    if (!monster(key)) return res.status(400).json({ error: 'Choose a monster.' });
    if (!BLOCKS.includes(blocks)) return res.status(400).json({ error: 'Choose what the monster blocks (harbor, building or region).' });
    if (awake.some(a => a.monster_key === key)) return res.status(409).json({ error: `${monster(key).name} is already awake for this alliance.` });
    if (blocks === 'harbor' && awake.some(a => a.blocks === 'harbor')) return res.status(409).json({ error: 'A monster already guards this alliance\'s harbor.' });
    if (blocks === 'building') {
      if (!target && b.random) target = pick(owned.filter(bd => !awake.some(a => a.block_target === bd)));
      if (!target || !owned.includes(target)) return res.status(400).json({ error: 'Choose a building this alliance owns.' });
    } else target = null;
    if (blocks === 'region') {
      if (!owner && b.random) owner = pick(members).student_id;
      if (!owner || !members.some(m => m.student_id === owner)) return res.status(400).json({ error: 'Choose a member who has uploaded an island map.' });
      if (x === null || !Number.isFinite(x) || y === null || !Number.isFinite(y)) {
        const home = terrain ? terrain.cellsOf(owner, monster(key).terrain) : [];
        // keep away from the very edge so its region stays on the map
        const inner = home.filter(c => c.x_pct > 8 && c.x_pct < 92 && c.y_pct > 8 && c.y_pct < 92);
        const spot = (inner.length ? inner : home)[Math.floor(Math.random() * (inner.length ? inner : home).length)];
        if (spot) { x = spot.x_pct; y = spot.y_pct; placedOnTerrain = true; }
        else { x = 25 + Math.random() * 50; y = 25 + Math.random() * 50; }
      }
    } else { owner = null; x = null; y = null; }
    run(`INSERT INTO island_monsters (alliance_id, monster_key, owner_student_id, x_pct, y_pct, blocks, block_target, status, awakened_by)
         VALUES (?,?,?,?,?,?,?,'awake',?)`, [alliance.alliance_id, key, owner, x, y, blocks, target, b.random ? 'fate' : 'teacher']);
    const im = getIM(query('SELECT last_insert_rowid() AS id')[0].id);
    res.json({ monster: imOut(im), placed_on_terrain: placedOnTerrain, message: `${monster(key).emoji} ${monster(key).name} awakens and ${blockText(im)}.${blocks === 'region' ? (placedOnTerrain ? ` It settles on ${monster(key).terrain}.` : '') : ''}` });
  });

  // One-click fixes
  app.post('/api/teacher/monsters/:imId/sleep', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    const im = getIM(parseInt(req.params.imId));
    if (!im) return res.status(404).json({ error: 'Monster not found' });
    run(`DELETE FROM monster_battles WHERE island_monster_id = ? AND status != 'done'`, [im.island_monster_id]);
    run(`UPDATE island_monsters SET status = 'asleep' WHERE island_monster_id = ?`, [im.island_monster_id]);
    res.json({ status: 'asleep' });
  });
  app.post('/api/teacher/monsters/:imId/rematch', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    const im = getIM(parseInt(req.params.imId));
    if (!im) return res.status(404).json({ error: 'Monster not found' });
    run('UPDATE island_monsters SET rematch_ok = 1 WHERE island_monster_id = ?', [im.island_monster_id]);
    res.json({ rematch_ok: true });
  });

  // Stage 5: place region monsters on their own kind of terrain when the
  // island's terrain has been checked by its owner
  let terrain = null;
  function useTerrain(t) { terrain = t; }

  return { useTerrain, loadContent, blockedBuildings, harborBlockedBy, regionMonsters, inRegion, alliancePowers, god: k => god(k), gods: () => GODS };
};
