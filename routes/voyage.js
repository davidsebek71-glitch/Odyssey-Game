// ============================================================================
// VOYAGES — Stage 2: world map, build/voyage phases, tokens and island visits
// ----------------------------------------------------------------------------
// Each period is in BUILD mode (students make their islands) or VOYAGE mode
// (students visit other alliances' islands). The teacher switches modes.
//
// Tokens: when the teacher approves a quest piece, the author's alliance gets
// tokens_per_publish voyage tokens (routes/island.js). Any student in that
// alliance spends one token to start a visit to a published piece on another
// alliance's island in the same period.
//
// A visit: read the piece → answer the author's question (retry allowed; after
// two misses the answer is shown, so nobody gets stuck) → write a response of
// at least min_response_words. Completing it gives visitor_points to the
// visitor's alliance and author_points to the author's alliance. The response
// reaches the author only after the teacher approves it; hiding it takes the
// points back. A student can have one open visit at a time and at most
// visit_cap visits per voyage (window_id goes up each time a voyage opens).
// Nothing here is timed.
// ============================================================================
const { countWords } = require('./island');
const SETTING_KEYS = ['tokens_per_publish', 'visit_cap', 'visitor_points', 'author_points', 'min_response_words'];
const MAX_RESPONSE = 3000;

module.exports = function registerVoyageRoutes(app, deps) {
  const { authenticateToken, query, run, island } = deps;
  const voyage = require('./voyage_helpers')({ query, run });
  const { getPin, getStudent, getQuestion, pinOut } = island;

  const isTeacher = req => req.user && req.user.type === 'teacher';
  const studentOnly = (req, res) => {
    if (req.user.type !== 'student') { res.status(403).json({ error: 'Students only' }); return null; }
    const me = getStudent(req.user.id);
    if (!me) { res.status(404).json({ error: 'Student not found' }); return null; }
    return me;
  };
  const teacherOnly = (req, res) => {
    if (!isTeacher(req)) { res.status(403).json({ error: 'Teacher access required' }); return false; }
    return true;
  };
  const openVisitFor = studentId => query(
    `SELECT v.*, p.title AS pin_title, p.owner_student_id FROM island_visits v JOIN island_pins p ON p.pin_id = v.pin_id
     WHERE v.visitor_student_id = ? AND v.status = 'open' LIMIT 1`, [studentId])[0] || null;
  const visitsThisVoyage = (studentId, windowId) => query(
    `SELECT COUNT(*) AS n FROM island_visits WHERE visitor_student_id = ? AND window_id = ? AND status IN ('open','completed')`,
    [studentId, windowId])[0].n;
  const getVisit = id => query('SELECT * FROM island_visits WHERE visit_id = ?', [id])[0] || null;
  const allianceName = id => (id && (query('SELECT alliance_name FROM alliances WHERE alliance_id = ?', [id])[0] || {}).alliance_name) || null;

  // The visitor's view of a visit: the piece, the question (answer hidden
  // until they get it right or it's revealed), and where they are.
  function visitOut(v) {
    const pin = getPin(v.pin_id);
    const q = getQuestion(v.pin_id);
    const owner = getStudent(pin.owner_student_id);
    const s = voyage.getSettings(v.class_period);
    const done = !!(v.answer_correct || v.answer_revealed);
    return {
      visit_id: v.visit_id, status: v.status, pin_id: v.pin_id,
      owner: { student_id: owner.student_id, name: owner.name, alliance_name: allianceName(owner.alliance_id) },
      pin: pinOut(pin, false),
      question: q ? { prompt: q.prompt, options: q.options, correct_index: done ? q.correct_index : undefined } : null,
      attempts: v.attempts, answer_index: v.answer_index, answer_correct: !!v.answer_correct, answer_revealed: !!v.answer_revealed,
      step: v.status === 'completed' ? 'done' : done ? 'respond' : 'answer',
      min_response_words: s.min_response_words,
      response_text: v.status === 'completed' ? v.response_text : undefined,
      response_status: v.status === 'completed' ? v.response_status : undefined,
      points_visitor: v.points_visitor
    };
  }

  // ── STUDENT: the world map for my period ──────────────────────────────────
  app.get('/api/voyage/world', authenticateToken, (req, res) => {
    try {
      let me = null, period;
      if (isTeacher(req)) { period = req.query.period; if (!period) return res.status(400).json({ error: 'period required' }); }
      else { me = studentOnly(req, res); if (!me) return; period = me.class_period; }
      const s = voyage.getSettings(period);
      const alliances = query(
        `SELECT alliance_id, alliance_name FROM alliances WHERE class_period = ? AND (is_disbanded = 0 OR is_disbanded IS NULL) ORDER BY alliance_id`, [period]);
      const visited = me ? new Set(query(`SELECT pin_id FROM island_visits WHERE visitor_student_id = ? AND status IN ('open','completed')`,
        [me.student_id]).map(r => r.pin_id)) : new Set();
      const out = alliances.map(a => {
        const members = query(
          `SELECT student_id, name, CASE WHEN map_image IS NOT NULL AND map_image != '' THEN 1 ELSE 0 END AS has_map
           FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL) ORDER BY name`, [a.alliance_id]);
        return {
          alliance_id: a.alliance_id, alliance_name: a.alliance_name, is_mine: !!(me && me.alliance_id === a.alliance_id),
          members: members.map(m => {
            const pubs = query(`SELECT p.pin_id, (SELECT COUNT(*) FROM pin_questions q WHERE q.pin_id = p.pin_id) AS hasq
              FROM island_pins p WHERE p.owner_student_id = ? AND p.status = 'published' AND p.quest_id IS NOT NULL`, [m.student_id]);
            return { student_id: m.student_id, name: m.name, has_map: !!m.has_map, published: pubs.length,
              to_visit: pubs.filter(p => p.hasq && !visited.has(p.pin_id)).length };
          })
        };
      });
      const open = me ? openVisitFor(me.student_id) : null;
      res.json({
        period, mode: s.mode, visit_cap: s.visit_cap, min_response_words: s.min_response_words,
        my_alliance_id: me ? me.alliance_id : null,
        tokens: me ? voyage.getBalance(me.alliance_id) : null,
        visits_used: me ? visitsThisVoyage(me.student_id, s.window_id) : null,
        open_visit: open ? { visit_id: open.visit_id, pin_id: open.pin_id, pin_title: open.pin_title, owner_student_id: open.owner_student_id } : null,
        alliances: out
      });
    } catch (e) { console.error('voyage/world:', e); res.status(500).json({ error: 'Could not load the world map.' }); }
  });

  // ── Start a visit: spends one alliance token ──────────────────────────────
  app.post('/api/voyage/visits', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const pin = getPin(parseInt((req.body || {}).pin_id));
      if (!pin || pin.status !== 'published' || !pin.quest_id) return res.status(404).json({ error: 'That piece can\'t be visited.' });
      const owner = getStudent(pin.owner_student_id);
      if (!owner || owner.class_period !== me.class_period) return res.status(404).json({ error: 'That piece can\'t be visited.' });
      if (owner.student_id === me.student_id) return res.status(400).json({ error: 'That\'s your own work.' });
      if (me.alliance_id && owner.alliance_id === me.alliance_id) return res.status(400).json({ error: 'Your alliance can already read this one. Visit another alliance\'s island.' });
      if (!getQuestion(pin.pin_id)) return res.status(409).json({ error: 'This piece has no question yet, so it can\'t be visited.' });
      const s = voyage.getSettings(me.class_period);
      if (s.mode !== 'voyage') return res.status(409).json({ error: 'Voyages are closed right now. Your teacher will open the next voyage.' });
      const open = openVisitFor(me.student_id);
      if (open) {
        if (open.pin_id === pin.pin_id) return res.json({ visit: visitOut(getVisit(open.visit_id)), resumed: true });
        return res.status(409).json({ error: `Finish your visit to "${open.pin_title}" first.`, open_visit_id: open.visit_id, open_owner_id: open.owner_student_id });
      }
      if (query(`SELECT 1 FROM island_visits WHERE visitor_student_id = ? AND pin_id = ? AND status = 'completed'`, [me.student_id, pin.pin_id]).length) {
        return res.status(409).json({ error: 'You already visited this piece.' });
      }
      const used = visitsThisVoyage(me.student_id, s.window_id);
      if (used >= s.visit_cap) return res.status(409).json({ error: `You've made ${used} visit${used === 1 ? '' : 's'} this voyage, the limit. You can visit again on the next voyage.` });
      if (!me.alliance_id) return res.status(409).json({ error: 'Join an alliance to go on voyages.' });
      if (voyage.getBalance(me.alliance_id) < 1) return res.status(409).json({ error: 'Your alliance has no voyage tokens left. Publishing approved work earns more.' });
      voyage.addTokens(me.alliance_id, -1);
      run(`INSERT INTO island_visits (visitor_student_id, visitor_alliance_id, pin_id, class_period, window_id, author_alliance_id, status)
           VALUES (?,?,?,?,?,?,'open')`, [me.student_id, me.alliance_id, pin.pin_id, me.class_period, s.window_id, owner.alliance_id || null]);
      const id = query('SELECT last_insert_rowid() AS id')[0].id;
      res.json({ visit: visitOut(getVisit(id)), tokens_left: voyage.getBalance(me.alliance_id) });
    } catch (e) { console.error('voyage start:', e); res.status(500).json({ error: 'Could not start the visit. Try again.' }); }
  });

  app.get('/api/voyage/visits/:id', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const v = getVisit(parseInt(req.params.id));
      if (!v || v.visitor_student_id !== me.student_id || v.status === 'cancelled') return res.status(404).json({ error: 'Visit not found' });
      res.json({ visit: visitOut(v) });
    } catch (e) { res.status(500).json({ error: 'Could not load the visit.' }); }
  });

  // Answer the author's question. Wrong answers can be retried; after the
  // second miss the right answer is shown so the visit can go on.
  app.post('/api/voyage/visits/:id/answer', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const v = getVisit(parseInt(req.params.id));
      if (!v || v.visitor_student_id !== me.student_id) return res.status(404).json({ error: 'Visit not found' });
      if (v.status !== 'open' || v.answer_correct || v.answer_revealed) return res.json({ visit: visitOut(v) });
      const q = getQuestion(v.pin_id);
      const idx = parseInt((req.body || {}).answer_index);
      if (!q || !Number.isInteger(idx) || idx < 0 || idx >= q.options.length) return res.status(400).json({ error: 'Choose an answer.' });
      const correct = idx === q.correct_index;
      const attempts = (v.attempts || 0) + 1;
      const reveal = !correct && attempts >= 2 ? 1 : 0;
      run(`UPDATE island_visits SET answer_index = ?, attempts = ?, answer_correct = ?, answer_revealed = ? WHERE visit_id = ?`,
        [idx, attempts, correct ? 1 : 0, reveal, v.visit_id]);
      res.json({ correct, revealed: !!reveal, visit: visitOut(getVisit(v.visit_id)) });
    } catch (e) { res.status(500).json({ error: 'Could not check the answer. Try again.' }); }
  });

  // Finish: requires the question step and a written response
  app.post('/api/voyage/visits/:id/complete', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const v = getVisit(parseInt(req.params.id));
      if (!v || v.visitor_student_id !== me.student_id) return res.status(404).json({ error: 'Visit not found' });
      if (v.status === 'completed') return res.json({ visit: visitOut(v), already: true });
      if (v.status !== 'open') return res.status(409).json({ error: 'This visit was ended.' });
      if (!v.answer_correct && !v.answer_revealed) return res.status(400).json({ error: 'Answer the question first.' });
      const text = typeof (req.body || {}).response_text === 'string' ? req.body.response_text.replace(/\u0000/g, '').slice(0, MAX_RESPONSE).trim() : '';
      const s = voyage.getSettings(v.class_period);
      const words = countWords(text);
      if (words < s.min_response_words) return res.status(400).json({ error: `Write at least ${s.min_response_words} words to the author (you have ${words}).` });
      const pin = getPin(v.pin_id);
      const owner = getStudent(pin.owner_student_id);
      const authorAlliance = owner ? owner.alliance_id : v.author_alliance_id;
      voyage.addPoints(v.visitor_alliance_id, me.student_id, s.visitor_points, 'voyage_visit', `Visited "${pin.title}"`);
      voyage.addPoints(authorAlliance, pin.owner_student_id, s.author_points, 'voyage_visited', `"${pin.title}" was visited`);
      run(`UPDATE island_visits SET status = 'completed', response_text = ?, response_status = 'pending', completed_at = CURRENT_TIMESTAMP,
           points_visitor = ?, points_author = ?, author_alliance_id = ? WHERE visit_id = ?`,
        [text, v.visitor_alliance_id ? s.visitor_points : 0, authorAlliance ? s.author_points : 0, authorAlliance || null, v.visit_id]);
      res.json({ visit: visitOut(getVisit(v.visit_id)) });
    } catch (e) { console.error('voyage complete:', e); res.status(500).json({ error: 'Could not finish the visit. Your response is still on screen — try again.' }); }
  });

  // Leave an open visit; the token goes back to the alliance
  function cancelVisit(v) {
    run('DELETE FROM island_visits WHERE visit_id = ?', [v.visit_id]);
    if (v.visitor_alliance_id) voyage.addTokens(v.visitor_alliance_id, 1);
  }
  app.post('/api/voyage/visits/:id/cancel', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const v = getVisit(parseInt(req.params.id));
      if (!v || v.visitor_student_id !== me.student_id) return res.status(404).json({ error: 'Visit not found' });
      if (v.status !== 'open') return res.status(409).json({ error: 'Only a visit in progress can be left.' });
      cancelVisit(v);
      res.json({ cancelled: true, tokens: voyage.getBalance(v.visitor_alliance_id) });
    } catch (e) { res.status(500).json({ error: 'Could not leave the visit.' }); }
  });

  // Approved responses visitors left on my pieces
  app.get('/api/voyage/responses/mine', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const rows = query(
        `SELECT v.visit_id, v.pin_id, v.response_text, v.completed_at, s.name AS visitor_name, a.alliance_name AS visitor_alliance, p.title AS pin_title
         FROM island_visits v JOIN island_pins p ON p.pin_id = v.pin_id JOIN students s ON s.student_id = v.visitor_student_id
         LEFT JOIN alliances a ON a.alliance_id = v.visitor_alliance_id
         WHERE p.owner_student_id = ? AND v.status = 'completed' AND v.response_status = 'approved' ORDER BY v.completed_at DESC`, [me.student_id]);
      res.json({ responses: rows });
    } catch (e) { res.status(500).json({ error: 'Could not load responses.' }); }
  });

  // ── TEACHER ───────────────────────────────────────────────────────────────
  app.get('/api/teacher/voyage/overview', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    try {
      const period = req.query.period;
      if (!period) return res.status(400).json({ error: 'Choose a period.' });
      const s = voyage.getSettings(period);
      const alliances = query(`SELECT alliance_id, alliance_name FROM alliances WHERE class_period = ? AND (is_disbanded = 0 OR is_disbanded IS NULL) ORDER BY alliance_name`, [period])
        .map(a => Object.assign(a, { tokens: voyage.getBalance(a.alliance_id) }));
      const students = query(
        `SELECT s.student_id, s.name, a.alliance_name,
           (SELECT COUNT(*) FROM island_pins p WHERE p.owner_student_id = s.student_id AND p.status = 'published' AND p.quest_id IS NOT NULL) AS published,
           (SELECT COUNT(*) FROM island_visits v WHERE v.visitor_student_id = s.student_id AND v.status = 'completed') AS visits_made,
           (SELECT COUNT(*) FROM island_visits v WHERE v.visitor_student_id = s.student_id AND v.status = 'completed' AND v.window_id = ?) AS visits_this_voyage,
           (SELECT COUNT(*) FROM island_visits v WHERE v.visitor_student_id = s.student_id AND v.status = 'completed' AND v.response_status = 'approved') AS responses_left,
           (SELECT COUNT(*) FROM island_visits v WHERE v.visitor_student_id = s.student_id AND v.status = 'completed' AND v.response_status = 'pending') AS responses_waiting,
           (SELECT COUNT(*) FROM island_visits v JOIN island_pins p ON p.pin_id = v.pin_id WHERE p.owner_student_id = s.student_id AND v.status = 'completed') AS times_visited,
           (SELECT v.visit_id FROM island_visits v WHERE v.visitor_student_id = s.student_id AND v.status = 'open' LIMIT 1) AS open_visit_id
         FROM students s LEFT JOIN alliances a ON a.alliance_id = s.alliance_id
         WHERE s.class_period = ? AND (s.is_ghost = 0 OR s.is_ghost IS NULL)
         ORDER BY a.alliance_name, s.name`, [s.window_id, period]);
      res.json({ settings: s, alliances, students });
    } catch (e) { console.error('voyage overview:', e); res.status(500).json({ error: 'Could not load voyages.' }); }
  });

  // Phase and numbers for a period. Opening a voyage starts a new window,
  // so every student's per-voyage visit count starts again at zero.
  app.post('/api/teacher/voyage/settings', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    try {
      const b = req.body || {};
      const period = b.class_period;
      if (!period) return res.status(400).json({ error: 'class_period required' });
      voyage.ensureSettingsRow(period);
      const cur = voyage.getSettings(period);
      if (b.mode !== undefined) {
        if (!['build', 'voyage'].includes(b.mode)) return res.status(400).json({ error: 'mode must be build or voyage' });
        if (b.mode !== cur.mode) {
          run(`UPDATE voyage_settings SET mode = ?, window_id = window_id + ?, updated_at = CURRENT_TIMESTAMP WHERE class_period = ?`,
            [b.mode, b.mode === 'voyage' ? 1 : 0, period]);
        }
      }
      for (const k of SETTING_KEYS) {
        if (b[k] === undefined) continue;
        const n = parseInt(b[k]); const [lo, hi] = voyage.SETTING_LIMITS[k];
        if (!Number.isInteger(n) || n < lo || n > hi) return res.status(400).json({ error: `${k} must be a whole number from ${lo} to ${hi}` });
        run(`UPDATE voyage_settings SET ${k} = ?, updated_at = CURRENT_TIMESTAMP WHERE class_period = ?`, [n, period]);
      }
      res.json({ settings: voyage.getSettings(period) });
    } catch (e) { console.error('voyage settings:', e); res.status(500).json({ error: 'Could not save the settings.' }); }
  });

  app.post('/api/teacher/voyage/tokens', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    try {
      const { alliance_id } = req.body || {};
      const delta = parseInt((req.body || {}).delta);
      if (!alliance_id || !Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 50) return res.status(400).json({ error: 'alliance_id and a delta from -50 to 50 are required' });
      res.json({ alliance_id, tokens: voyage.addTokens(alliance_id, delta) });
    } catch (e) { res.status(500).json({ error: 'Could not change tokens.' }); }
  });

  // Responses waiting for approval before the author can read them
  app.get('/api/teacher/voyage/responses', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    try {
      const period = req.query.period || null;
      const rows = query(
        `SELECT v.visit_id, v.response_text, v.completed_at, v.class_period, v.answer_correct, v.answer_revealed, v.attempts,
                v.points_visitor, v.points_author, vs.name AS visitor_name, va.alliance_name AS visitor_alliance,
                p.title AS pin_title, p.pin_id, os.name AS author_name
         FROM island_visits v JOIN island_pins p ON p.pin_id = v.pin_id
         JOIN students vs ON vs.student_id = v.visitor_student_id JOIN students os ON os.student_id = p.owner_student_id
         LEFT JOIN alliances va ON va.alliance_id = v.visitor_alliance_id
         WHERE v.status = 'completed' AND v.response_status = 'pending' ${period ? 'AND v.class_period = ?' : ''}
         ORDER BY v.completed_at, v.visit_id`, period ? [period] : []);
      res.json({ responses: rows.map(r => Object.assign(r, { word_count: countWords(r.response_text) })) });
    } catch (e) { console.error('voyage responses:', e); res.status(500).json({ error: 'Could not load responses.' }); }
  });

  // approve → the author can read it. hide → the author never sees it and the
  // visit's points are taken back from both alliances.
  app.post('/api/teacher/voyage/responses/:id', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    try {
      const v = getVisit(parseInt(req.params.id));
      if (!v || v.status !== 'completed') return res.status(404).json({ error: 'Response not found' });
      const action = (req.body || {}).action;
      if (action === 'approve') {
        run(`UPDATE island_visits SET response_status = 'approved', reviewed_at = CURRENT_TIMESTAMP WHERE visit_id = ?`, [v.visit_id]);
        return res.json({ response_status: 'approved' });
      }
      if (action === 'hide') {
        if (v.response_status !== 'hidden') {
          const pin = getPin(v.pin_id);
          if (v.points_visitor) voyage.addPoints(v.visitor_alliance_id, v.visitor_student_id, -v.points_visitor, 'voyage_visit', `Visit response hidden by teacher ("${pin.title}")`, req.user.id);
          if (v.points_author) voyage.addPoints(v.author_alliance_id, pin.owner_student_id, -v.points_author, 'voyage_visited', `Visit response hidden by teacher ("${pin.title}")`, req.user.id);
          run(`UPDATE island_visits SET response_status = 'hidden', points_visitor = 0, points_author = 0, reviewed_at = CURRENT_TIMESTAMP WHERE visit_id = ?`, [v.visit_id]);
        }
        return res.json({ response_status: 'hidden', points_removed: (v.points_visitor || 0) + (v.points_author || 0) });
      }
      res.status(400).json({ error: 'action must be approve or hide' });
    } catch (e) { console.error('voyage review:', e); res.status(500).json({ error: 'Could not save.' }); }
  });

  // One-click fix: end a stuck visit (token goes back)
  app.post('/api/teacher/voyage/visits/:id/cancel', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    try {
      const v = getVisit(parseInt(req.params.id));
      if (!v || v.status !== 'open') return res.status(404).json({ error: 'No visit in progress with that id' });
      cancelVisit(v);
      res.json({ cancelled: true });
    } catch (e) { res.status(500).json({ error: 'Could not end the visit.' }); }
  });
};
