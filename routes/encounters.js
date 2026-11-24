// ============================================================================
// ENCOUNTERS — Stage 4B: facing a student-made Guardian, Lair and Monster
// ----------------------------------------------------------------------------
// When a student's island has a published Monster piece (and usually a
// Guardian and a Lair), visitors from other alliances can face it during a
// voyage. Starting an encounter costs one voyage token (like a visit).
//
//   1. Guardian — answer the Guardian's Test (the guardian piece's question).
//                 Two tries; after the second miss the Guardian turns you back.
//   2. Lair     — see the lair map with its four labeled dangers.
//   3. Monster  — each of its four "impossible to escape" attributes has a
//                 counter: a god power (countered if your alliance holds it) or
//                 a question about the myth (one try).
//      Counter at least 3 of 4 → the monster is defeated: the visiting
//      alliance earns ENCOUNTER_POINTS and "what the hero gains".
//   The author's alliance earns author_points (voyage settings) when a
//   visitor finishes facing their monster, win or lose. Nothing is timed.
// ============================================================================
const ENCOUNTER_POINTS = 15;
const NEEDED_TO_WIN = 3;

module.exports = function registerEncounterRoutes(app, deps) {
  const { authenticateToken, query, run, island, monsters } = deps;
  const voyage = require('./voyage_helpers')({ query, run });
  const { getPin, getStudent, getQuestion, getExtra, getAttributes, photoFile } = island;
  const isTeacher = req => req.user && req.user.type === 'teacher';
  const studentOnly = (req, res) => {
    if (req.user.type !== 'student') { res.status(403).json({ error: 'Students only' }); return null; }
    const me = getStudent(req.user.id); if (!me) { res.status(404).json({ error: 'Student not found' }); return null; }
    return me;
  };
  const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
  const piece = (owner, type) => query(`SELECT * FROM island_pins WHERE owner_student_id = ? AND pin_type = ? AND status = 'published' ORDER BY pin_id DESC LIMIT 1`, [owner, type])[0] || null;
  const getEnc = id => query('SELECT * FROM monster_encounters WHERE encounter_id = ?', [id])[0] || null;

  // Can this student face the monster on this island now? (null = yes)
  function startProblem(me, owner) {
    if (!owner || owner.class_period !== me.class_period) return 'That island isn\'t in your class.';
    if (owner.student_id === me.student_id) return 'That\'s your own monster.';
    if (me.alliance_id && owner.alliance_id === me.alliance_id) return 'That monster belongs to your own alliance.';
    if (!piece(owner.student_id, 'monster')) return 'This island has no monster to face.';
    const s = voyage.getSettings(me.class_period);
    if (s.mode !== 'voyage') return 'Encounters happen during voyages. Your teacher will open the next voyage.';
    const harbor = monsters && monsters.harborBlockedBy(me.alliance_id);
    if (harbor) return `${harbor} is guarding your harbor. Defeat it before you can sail.`;
    if (!me.alliance_id) return 'Join an alliance to go on voyages.';
    if (voyage.getBalance(me.alliance_id) < 1) return 'Your alliance has no voyage tokens left. Publishing approved work earns more.';
    return null;
  }

  function encOut(e) {
    const owner = getStudent(e.owner_student_id);
    const out = { encounter_id: e.encounter_id, stage: e.stage, outcome: e.outcome, guardian_attempts: e.guardian_attempts,
      owner: { student_id: owner.student_id, name: owner.name }, points_awarded: e.points_awarded };
    const g = e.guardian_pin_id && getPin(e.guardian_pin_id);
    if (g) {
      const q = getQuestion(g.pin_id);
      out.guardian = { title: g.title, body: g.body, test: q ? { prompt: q.prompt, options: q.options } : null };
    }
    const lair = piece(e.owner_student_id, 'lair');
    if (lair && e.stage !== 'guardian' && e.outcome !== 'turned_back') {
      out.lair = { pin_id: lair.pin_id, title: lair.title, body: lair.body, has_photo: !!lair.image_path, dangers: getExtra(lair).dangers || [] };
    }
    if (e.stage === 'monster' || e.stage === 'done') {
      const m = getPin(e.monster_pin_id);
      const results = parse(e.results, {});
      const powers = monsters && e.visitor_alliance_id ? monsters.alliancePowers(e.visitor_alliance_id).map(p => p.god) : [];
      out.monster = {
        title: m.title, body: m.body,
        attributes: getAttributes(m.pin_id).map((a, i) => {
          const r = results[i];
          const base = { index: i, description: a.description, counter_type: a.counter_type, result: r ? r.countered : null };
          if (a.counter_type === 'god') {
            const gd = monsters && monsters.god(a.counter_value);
            return Object.assign(base, { god: a.counter_value, god_name: gd ? gd.name : a.counter_value, god_power: gd ? gd.power : '', god_emoji: gd ? gd.emoji : '', alliance_has_power: powers.includes(a.counter_value) });
          }
          const q = a.counter_value || {};
          return Object.assign(base, { question: { prompt: q.prompt, options: q.options || [] }, answer_index: r ? r.answer_index : null,
            correct_index: r ? q.correct_index : undefined });
        })
      };
      if (e.stage === 'done') out.monster.countered = Object.values(results).filter(r => r.countered).length;
      if (e.outcome === 'defeated') out.hero_gains = getExtra(m).hero_gains || '';
    }
    return out;
  }

  // ── What can be faced on this island ──────────────────────────────────────
  app.get('/api/encounters/island/:ownerId', authenticateToken, (req, res) => {
    const me = studentOnly(req, res); if (!me) return;
    const owner = getStudent(parseInt(req.params.ownerId));
    if (!owner) return res.status(404).json({ error: 'Island not found' });
    const monster = piece(owner.student_id, 'monster');
    if (!monster) return res.json({ available: false });
    const mine = query(`SELECT * FROM monster_encounters WHERE visitor_student_id = ? AND monster_pin_id = ? ORDER BY encounter_id DESC LIMIT 1`, [me.student_id, monster.pin_id])[0];
    res.json({
      available: true, monster_title: monster.title, has_guardian: !!piece(owner.student_id, 'guardian'), has_lair: !!piece(owner.student_id, 'lair'),
      encounter: mine ? { encounter_id: mine.encounter_id, stage: mine.stage, outcome: mine.outcome } : null,
      start_problem: mine ? (mine.stage === 'done' ? 'You already faced this monster.' : null) : startProblem(me, owner)
    });
  });

  // Start: spends one voyage token
  app.post('/api/encounters', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const owner = getStudent(parseInt((req.body || {}).owner_student_id));
      const monster = owner && piece(owner.student_id, 'monster');
      if (monster) {
        const mine = query(`SELECT * FROM monster_encounters WHERE visitor_student_id = ? AND monster_pin_id = ?`, [me.student_id, monster.pin_id])[0];
        if (mine && mine.stage !== 'done') return res.json({ encounter: encOut(mine), resumed: true });
        if (mine) return res.status(409).json({ error: 'You already faced this monster.' });
      }
      const p = startProblem(me, owner);
      if (p) return res.status(409).json({ error: p });
      const guardian = piece(owner.student_id, 'guardian');
      const hasTest = guardian && getQuestion(guardian.pin_id);
      const firstStage = hasTest ? 'guardian' : piece(owner.student_id, 'lair') ? 'lair' : 'monster';
      voyage.addTokens(me.alliance_id, -1);
      run(`INSERT INTO monster_encounters (visitor_student_id, visitor_alliance_id, owner_student_id, guardian_pin_id, monster_pin_id, class_period, stage)
           VALUES (?,?,?,?,?,?,?)`, [me.student_id, me.alliance_id, owner.student_id, hasTest ? guardian.pin_id : null, monster.pin_id, me.class_period, firstStage]);
      res.json({ encounter: encOut(getEnc(query('SELECT last_insert_rowid() AS id')[0].id)), tokens_left: voyage.getBalance(me.alliance_id) });
    } catch (e) { console.error('encounter start:', e); res.status(500).json({ error: 'Could not start the encounter.' }); }
  });

  const mineEnc = (req, res) => {
    const me = studentOnly(req, res); if (!me) return null;
    const e = getEnc(parseInt(req.params.id));
    if (!e || e.visitor_student_id !== me.student_id) { res.status(404).json({ error: 'Encounter not found' }); return null; }
    return { me, e };
  };
  app.get('/api/encounters/:id', authenticateToken, (req, res) => { const x = mineEnc(req, res); if (x) res.json({ encounter: encOut(x.e) }); });

  // The lair map, only for someone who got past the guardian
  app.get('/api/encounters/:id/lair-photo', authenticateToken, (req, res) => {
    const x = mineEnc(req, res); if (!x) return;
    if (x.e.stage === 'guardian' || x.e.outcome === 'turned_back') return res.status(404).json({ error: 'Not yet' });
    const lair = piece(x.e.owner_student_id, 'lair');
    const f = lair && photoFile(lair);
    if (!f) return res.status(404).json({ error: 'No lair map' });
    res.set('Cache-Control', 'private, max-age=300'); res.sendFile(f);
  });

  // 1. The Guardian's Test: two tries
  app.post('/api/encounters/:id/guardian', authenticateToken, (req, res) => {
    const x = mineEnc(req, res); if (!x) return;
    const { e } = x;
    if (e.stage !== 'guardian') return res.json({ encounter: encOut(e) });
    const q = getQuestion(e.guardian_pin_id);
    const ai = parseInt((req.body || {}).answer_index);
    if (!q || !Number.isInteger(ai) || ai < 0 || ai >= q.options.length) return res.status(400).json({ error: 'Choose an answer.' });
    const attempts = e.guardian_attempts + 1;
    if (ai === q.correct_index) {
      const next = piece(e.owner_student_id, 'lair') ? 'lair' : 'monster';
      run('UPDATE monster_encounters SET guardian_attempts = ?, stage = ? WHERE encounter_id = ?', [attempts, next, e.encounter_id]);
      return res.json({ passed: true, encounter: encOut(getEnc(e.encounter_id)) });
    }
    if (attempts >= 2) {
      run(`UPDATE monster_encounters SET guardian_attempts = ?, stage = 'done', outcome = 'turned_back', finished_at = CURRENT_TIMESTAMP WHERE encounter_id = ?`, [attempts, e.encounter_id]);
      return res.json({ passed: false, turned_back: true, encounter: encOut(getEnc(e.encounter_id)) });
    }
    run('UPDATE monster_encounters SET guardian_attempts = ? WHERE encounter_id = ?', [attempts, e.encounter_id]);
    res.json({ passed: false, encounter: encOut(getEnc(e.encounter_id)) });
  });

  // 2. Past the lair
  app.post('/api/encounters/:id/lair', authenticateToken, (req, res) => {
    const x = mineEnc(req, res); if (!x) return;
    if (x.e.stage === 'lair') run(`UPDATE monster_encounters SET stage = 'monster' WHERE encounter_id = ?`, [x.e.encounter_id]);
    res.json({ encounter: encOut(getEnc(x.e.encounter_id)) });
  });

  // 3. Counter one attribute (god power or one try at its question)
  app.post('/api/encounters/:id/counter', authenticateToken, (req, res) => {
    const x = mineEnc(req, res); if (!x) return;
    const { e, me } = x;
    if (e.stage !== 'monster') return res.json({ encounter: encOut(e) });
    const idx = parseInt((req.body || {}).attribute);
    const attrs = getAttributes(e.monster_pin_id);
    const results = parse(e.results, {});
    if (!Number.isInteger(idx) || idx < 0 || idx >= attrs.length) return res.status(400).json({ error: 'Unknown attribute' });
    if (results[idx]) return res.json({ encounter: encOut(e) });
    const a = attrs[idx];
    if (a.counter_type === 'god') {
      const has = monsters ? monsters.alliancePowers(e.visitor_alliance_id).some(p => p.god === a.counter_value) : false;
      results[idx] = { countered: has };
    } else {
      const ai = parseInt((req.body || {}).answer_index);
      const q = a.counter_value || {};
      if (!Number.isInteger(ai) || ai < 0 || ai >= (q.options || []).length) return res.status(400).json({ error: 'Choose an answer.' });
      results[idx] = { countered: ai === q.correct_index, answer_index: ai };
    }
    const done = Object.keys(results).length >= attrs.length;
    let outcome = null, points = 0;
    if (done) {
      const countered = Object.values(results).filter(r => r.countered).length;
      outcome = countered >= NEEDED_TO_WIN ? 'defeated' : 'escaped';
      const monster = getPin(e.monster_pin_id);
      if (outcome === 'defeated' && e.visitor_alliance_id) {
        points = ENCOUNTER_POINTS;
        voyage.addPoints(e.visitor_alliance_id, me.student_id, points, 'monster_encounter', `Defeated ${getStudent(e.owner_student_id).name}'s monster "${monster.title}"`);
      }
      const author = getStudent(e.owner_student_id);
      const ap = voyage.getSettings(e.class_period).author_points;
      if (author && author.alliance_id && ap) voyage.addPoints(author.alliance_id, author.student_id, ap, 'monster_encounter_faced', `A hero faced "${monster.title}"`);
    }
    run(`UPDATE monster_encounters SET results = ?, stage = ?, outcome = ?, points_awarded = points_awarded + ?, finished_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE finished_at END
         WHERE encounter_id = ? AND stage = 'monster'`, [JSON.stringify(results), done ? 'done' : 'monster', outcome, points, done ? 1 : 0, e.encounter_id]);
    res.json({ encounter: encOut(getEnc(e.encounter_id)) });
  });

  // ── Teacher: who faced what; end a stuck encounter (token back) ───────────
  app.get('/api/teacher/encounters', authenticateToken, (req, res) => {
    if (!isTeacher(req)) return res.status(403).json({ error: 'Teacher access required' });
    const period = req.query.period || null;
    res.json({ encounters: query(`SELECT e.encounter_id, e.stage, e.outcome, e.guardian_attempts, e.points_awarded, e.started_at, e.finished_at, e.results,
      v.name AS visitor_name, o.name AS owner_name, p.title AS monster_title FROM monster_encounters e
      JOIN students v ON v.student_id = e.visitor_student_id JOIN students o ON o.student_id = e.owner_student_id JOIN island_pins p ON p.pin_id = e.monster_pin_id
      ${period ? 'WHERE e.class_period = ?' : ''} ORDER BY e.encounter_id DESC LIMIT 200`, period ? [period] : [])
      .map(r => Object.assign(r, { countered: Object.values(parse(r.results, {})).filter(x => x.countered).length, results: undefined })) });
  });
  app.post('/api/teacher/encounters/:id/cancel', authenticateToken, (req, res) => {
    if (!isTeacher(req)) return res.status(403).json({ error: 'Teacher access required' });
    const e = getEnc(parseInt(req.params.id));
    if (!e || e.stage === 'done') return res.status(404).json({ error: 'No encounter in progress with that id' });
    run('DELETE FROM monster_encounters WHERE encounter_id = ?', [e.encounter_id]);
    if (e.visitor_alliance_id) voyage.addTokens(e.visitor_alliance_id, 1);
    res.json({ cancelled: true });
  });
};
