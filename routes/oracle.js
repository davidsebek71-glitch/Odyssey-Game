// ============================================================================
// ORACLE TRIALS — Stage 3: weekly long-passage reading assessments (ERB style)
// ----------------------------------------------------------------------------
// The teacher writes or imports a trial: a passage split into sections and
// multiple-choice questions, each tagged with a question type and the section
// it is about. Trials are assigned to periods and opened / closed.
// Passages are copyrighted classroom texts: they live only in the database and
// are served only to logged-in students in an assigned period.
//
// Students: no timer. Answers autosave. On submit they see their score and
// their result by question type; the question-by-question review (with the
// right answers) opens when the teacher closes the trial.
//
// Accommodations (student_accommodations, set by the teacher, never shown to
// other students): short_set (only questions marked in_short_set), chunked
// (each section shown with its questions), large_text, read_aloud,
// extended_time (recorded; nothing in this game is timed).
//
// Reward (weighted toward growth): BASE_POINTS for finishing, plus 1 point for
// every 2 percentage points above the student's own average on earlier trials
// (up to MAX_GROWTH_BONUS). Points go to the student's alliance once.
// ============================================================================
const QUESTION_TYPES = ['main_idea', 'inference', 'vocab_in_context', 'authors_purpose', 'text_structure'];
const SOURCES = ['evslin', 'cold_read'];
const ACCOMMODATIONS = ['extended_time', 'read_aloud', 'short_set', 'chunked', 'large_text'];
const BASE_POINTS = 5;
const MAX_GROWTH_BONUS = 15;

const countWords = t => (t || '').trim().split(/\s+/).filter(Boolean).length;
const clean = (v, max) => typeof v === 'string' ? v.replace(/\u0000/g, '').slice(0, max) : '';

module.exports = function registerOracleRoutes(app, deps) {
  const { authenticateToken, query, run } = deps;
  const voyage = require('./voyage_helpers')({ query, run });   // addPoints

  const isTeacher = req => req.user && req.user.type === 'teacher';
  const teacherOnly = (req, res) => { if (!isTeacher(req)) { res.status(403).json({ error: 'Teacher access required' }); return false; } return true; };
  const getStudent = id => query('SELECT student_id, name, class_period, alliance_id FROM students WHERE student_id = ?', [id])[0] || null;
  const studentOnly = (req, res) => {
    if (req.user.type !== 'student') { res.status(403).json({ error: 'Students only' }); return null; }
    const me = getStudent(req.user.id); if (!me) { res.status(404).json({ error: 'Student not found' }); return null; }
    return me;
  };
  const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
  const getTrial = id => query('SELECT * FROM oracle_trials WHERE trial_id = ?', [id])[0] || null;
  const getQuestions = id => query('SELECT * FROM oracle_questions WHERE trial_id = ? ORDER BY sort_order, question_id', [id])
    .map(q => Object.assign(q, { options: parse(q.options, []) }));
  const assignment = (kind, id, period) => query('SELECT * FROM challenge_assignments WHERE kind = ? AND item_id = ? AND class_period = ?', [kind, id, period])[0] || null;

  function accommodationsFor(studentId) {
    const r = query('SELECT settings FROM student_accommodations WHERE student_id = ?', [studentId])[0];
    const s = r ? parse(r.settings, {}) : {};
    const out = {}; ACCOMMODATIONS.forEach(k => { out[k] = !!s[k]; });
    return out;
  }

  // Validate a trial sent by the teacher (create, edit or import)
  function readTrial(b) {
    const title = clean(b.title, 200).trim();
    if (!title) return { error: 'Give the trial a title.' };
    const source = SOURCES.includes(b.source) ? b.source : 'cold_read';
    const week = b.week === null || b.week === undefined || b.week === '' ? null : parseInt(b.week);
    if (week !== null && (!Number.isInteger(week) || week < 0 || week > 60)) return { error: 'Week must be a number.' };
    let sections = Array.isArray(b.sections) ? b.sections : (typeof b.passage === 'string' ? b.passage.split(/\n\s*\n/) : []);
    sections = sections.map(x => clean(x, 20000).trim()).filter(Boolean);
    if (!sections.length) return { error: 'Add the passage.' };
    const qs = Array.isArray(b.questions) ? b.questions : [];
    if (!qs.length) return { error: 'Add at least one question.' };
    const questions = [];
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i] || {};
      const prompt = clean(q.prompt, 1000).trim();
      const options = (Array.isArray(q.options) ? q.options : []).map(o => clean(o, 500).trim()).filter(Boolean);
      if (!prompt) return { error: `Question ${i + 1} needs its question text.` };
      if (options.length < 2 || options.length > 5) return { error: `Question ${i + 1} needs 2 to 5 answer choices.` };
      const ci = parseInt(q.correct_index);
      if (!Number.isInteger(ci) || ci < 0 || ci >= options.length) return { error: `Question ${i + 1}: mark the correct answer.` };
      const type = QUESTION_TYPES.includes(q.question_type) ? q.question_type : null;
      if (!type) return { error: `Question ${i + 1}: choose a question type (${QUESTION_TYPES.join(', ')}).` };
      let si = q.section_index === null || q.section_index === undefined || q.section_index === '' ? null : parseInt(q.section_index);
      if (si !== null && (!Number.isInteger(si) || si < 0 || si >= sections.length)) return { error: `Question ${i + 1}: the section number is outside the passage.` };
      questions.push({ prompt, options, correct_index: ci, question_type: type, section_index: si, in_short_set: q.in_short_set ? 1 : 0 });
    }
    return { trial: { title, source, week, sections, word_count: countWords(sections.join(' ')) }, questions };
  }
  function saveQuestions(trialId, questions) {
    run('DELETE FROM oracle_questions WHERE trial_id = ?', [trialId]);
    questions.forEach((q, i) => run(
      `INSERT INTO oracle_questions (trial_id, sort_order, prompt, options, correct_index, question_type, section_index, in_short_set)
       VALUES (?,?,?,?,?,?,?,?)`, [trialId, i, q.prompt, JSON.stringify(q.options), q.correct_index, q.question_type, q.section_index, q.in_short_set]));
  }
  const attemptCount = id => query('SELECT COUNT(*) AS n FROM oracle_attempts WHERE trial_id = ?', [id])[0].n;

  // ── TEACHER: trials ───────────────────────────────────────────────────────
  app.get('/api/teacher/oracle/trials', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    try {
      const trials = query('SELECT * FROM oracle_trials ORDER BY COALESCE(week, 999), trial_id').map(t => ({
        trial_id: t.trial_id, title: t.title, source: t.source, week: t.week, word_count: t.word_count,
        sections: parse(t.sections, []).length,
        questions: query('SELECT COUNT(*) AS n FROM oracle_questions WHERE trial_id = ?', [t.trial_id])[0].n,
        short_set: query('SELECT COUNT(*) AS n FROM oracle_questions WHERE trial_id = ? AND in_short_set = 1', [t.trial_id])[0].n,
        attempts: attemptCount(t.trial_id),
        submitted: query(`SELECT COUNT(*) AS n FROM oracle_attempts WHERE trial_id = ? AND status = 'submitted'`, [t.trial_id])[0].n,
        assignments: query(`SELECT class_period, status FROM challenge_assignments WHERE kind = 'oracle' AND item_id = ? ORDER BY class_period`, [t.trial_id])
      }));
      res.json({ trials, question_types: QUESTION_TYPES, sources: SOURCES });
    } catch (e) { console.error('oracle trials:', e); res.status(500).json({ error: 'Could not load trials.' }); }
  });

  app.get('/api/teacher/oracle/trials/:id', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    const t = getTrial(parseInt(req.params.id));
    if (!t) return res.status(404).json({ error: 'Trial not found' });
    res.json({ trial: Object.assign(t, { sections: parse(t.sections, []) }), questions: getQuestions(t.trial_id), attempts: attemptCount(t.trial_id) });
  });

  // Create or import (same JSON shape; see data/oracle_trial_format.json)
  app.post('/api/teacher/oracle/trials', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    try {
      const r = readTrial(req.body || {});
      if (r.error) return res.status(400).json({ error: r.error });
      run(`INSERT INTO oracle_trials (title, source, week, sections, word_count) VALUES (?,?,?,?,?)`,
        [r.trial.title, r.trial.source, r.trial.week, JSON.stringify(r.trial.sections), r.trial.word_count]);
      const id = query('SELECT last_insert_rowid() AS id')[0].id;
      saveQuestions(id, r.questions);
      res.json({ trial_id: id, word_count: r.trial.word_count, questions: r.questions.length });
    } catch (e) { console.error('oracle create:', e); res.status(500).json({ error: 'Could not save the trial.' }); }
  });

  app.put('/api/teacher/oracle/trials/:id', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    try {
      const t = getTrial(parseInt(req.params.id));
      if (!t) return res.status(404).json({ error: 'Trial not found' });
      if (attemptCount(t.trial_id)) return res.status(409).json({ error: 'Students have already started this trial, so it can\'t be changed (their scores would no longer match). Copy it into a new trial instead.' });
      const r = readTrial(req.body || {});
      if (r.error) return res.status(400).json({ error: r.error });
      run(`UPDATE oracle_trials SET title=?, source=?, week=?, sections=?, word_count=?, updated_at=CURRENT_TIMESTAMP WHERE trial_id=?`,
        [r.trial.title, r.trial.source, r.trial.week, JSON.stringify(r.trial.sections), r.trial.word_count, t.trial_id]);
      saveQuestions(t.trial_id, r.questions);
      res.json({ trial_id: t.trial_id, word_count: r.trial.word_count, questions: r.questions.length });
    } catch (e) { console.error('oracle edit:', e); res.status(500).json({ error: 'Could not save the trial.' }); }
  });

  app.delete('/api/teacher/oracle/trials/:id', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    const t = getTrial(parseInt(req.params.id));
    if (!t) return res.status(404).json({ error: 'Trial not found' });
    if (attemptCount(t.trial_id)) return res.status(409).json({ error: 'Students have taken this trial, so it is kept for their results.' });
    run('DELETE FROM oracle_questions WHERE trial_id = ?', [t.trial_id]);
    run(`DELETE FROM challenge_assignments WHERE kind = 'oracle' AND item_id = ?`, [t.trial_id]);
    run('DELETE FROM oracle_trials WHERE trial_id = ?', [t.trial_id]);
    res.json({ deleted: true });
  });

  // Assign to a period and open / close it (status 'remove' unassigns if nobody started)
  app.post('/api/teacher/oracle/trials/:id/assign', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    try {
      const t = getTrial(parseInt(req.params.id));
      if (!t) return res.status(404).json({ error: 'Trial not found' });
      const { class_period, status } = req.body || {};
      if (!class_period) return res.status(400).json({ error: 'Choose a period.' });
      if (status === 'remove') {
        const started = query(`SELECT COUNT(*) AS n FROM oracle_attempts WHERE trial_id = ? AND class_period = ?`, [t.trial_id, class_period])[0].n;
        if (started) return res.status(409).json({ error: 'Students in this period have started it. Close it instead.' });
        run(`DELETE FROM challenge_assignments WHERE kind = 'oracle' AND item_id = ? AND class_period = ?`, [t.trial_id, class_period]);
        return res.json({ removed: true });
      }
      if (!['open', 'closed'].includes(status)) return res.status(400).json({ error: 'status must be open, closed or remove' });
      run(`INSERT INTO challenge_assignments (kind, item_id, class_period, status) VALUES ('oracle', ?, ?, ?)
           ON CONFLICT(kind, item_id, class_period) DO UPDATE SET status = excluded.status,
           closed_at = CASE WHEN excluded.status = 'closed' THEN CURRENT_TIMESTAMP ELSE NULL END`, [t.trial_id, class_period, status]);
      res.json({ class_period, status });
    } catch (e) { console.error('oracle assign:', e); res.status(500).json({ error: 'Could not change the assignment.' }); }
  });

  // One-click fix: let a student continue (or redo) a submitted trial. Answers
  // are kept; points already given are not given again.
  app.post('/api/teacher/oracle/attempts/:id/reopen', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    const a = query('SELECT * FROM oracle_attempts WHERE attempt_id = ?', [parseInt(req.params.id)])[0];
    if (!a) return res.status(404).json({ error: 'Attempt not found' });
    run(`UPDATE oracle_attempts SET status = 'in_progress', completed_at = NULL WHERE attempt_id = ?`, [a.attempt_id]);
    res.json({ reopened: true });
  });

  // ── TEACHER: accommodations (private) ─────────────────────────────────────
  app.get('/api/teacher/accommodations', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    try {
      const period = req.query.period || null;
      const rows = query(`SELECT student_id, name, class_period FROM students WHERE (is_ghost = 0 OR is_ghost IS NULL)
        ${period ? 'AND class_period = ?' : ''} ORDER BY class_period, name`, period ? [period] : []);
      res.json({ students: rows.map(s => Object.assign(s, { settings: accommodationsFor(s.student_id) })), keys: ACCOMMODATIONS });
    } catch (e) { res.status(500).json({ error: 'Could not load accommodations.' }); }
  });
  app.put('/api/teacher/accommodations/:studentId', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    const sid = parseInt(req.params.studentId);
    if (!getStudent(sid)) return res.status(404).json({ error: 'Student not found' });
    const b = (req.body || {}).settings || {};
    const s = {}; ACCOMMODATIONS.forEach(k => { s[k] = !!b[k]; });
    run(`INSERT INTO student_accommodations (student_id, settings) VALUES (?, ?)
         ON CONFLICT(student_id) DO UPDATE SET settings = excluded.settings, updated_at = CURRENT_TIMESTAMP`, [sid, JSON.stringify(s)]);
    res.json({ student_id: sid, settings: s });
  });

  // ── STUDENT ───────────────────────────────────────────────────────────────
  app.get('/api/oracle/trials', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const rows = query(
        `SELECT t.trial_id, t.title, t.week, t.word_count, ca.status AS period_status,
                a.status AS my_status, a.percentage, a.score, a.total
         FROM challenge_assignments ca JOIN oracle_trials t ON t.trial_id = ca.item_id
         LEFT JOIN oracle_attempts a ON a.trial_id = t.trial_id AND a.student_id = ?
         WHERE ca.kind = 'oracle' AND ca.class_period = ? ORDER BY COALESCE(t.week, 999) DESC, t.trial_id DESC`,
        [me.student_id, me.class_period]);
      res.json({ trials: rows });
    } catch (e) { res.status(500).json({ error: 'Could not load trials.' }); }
  });

  function studentView(me, t, attempt, periodStatus) {
    const sections = parse(t.sections, []);
    const ids = parse(attempt.question_ids, []);
    const all = getQuestions(t.trial_id);
    const qs = ids.map(id => all.find(q => q.question_id === id)).filter(Boolean);
    const review = attempt.status === 'submitted' && periodStatus === 'closed';
    const answers = parse(attempt.answers, {});
    return {
      trial: { trial_id: t.trial_id, title: t.title, week: t.week, word_count: t.word_count, sections },
      period_status: periodStatus,
      accommodations: parse(attempt.accommodations, {}),
      status: attempt.status,
      answers,
      questions: qs.map((q, n) => ({
        question_id: q.question_id, number: n + 1, prompt: q.prompt, options: q.options, section_index: q.section_index,
        question_type: q.question_type,
        correct_index: review ? q.correct_index : undefined,
        correct: review ? answers[q.question_id] === q.correct_index : undefined
      })),
      result: attempt.status === 'submitted' ? {
        score: attempt.score, total: attempt.total, percentage: attempt.percentage, by_type: parse(attempt.by_type, {}),
        points_awarded: attempt.points_awarded, review_open: review
      } : null
    };
  }

  // Open a trial: starts the attempt the first time (fixing the question set
  // and accommodations at that moment) and resumes it afterwards
  app.get('/api/oracle/trials/:id', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const t = getTrial(parseInt(req.params.id));
      const asg = t && assignment('oracle', t.trial_id, me.class_period);
      if (!t || !asg) return res.status(404).json({ error: 'This trial isn\'t assigned to your class.' });
      let attempt = query('SELECT * FROM oracle_attempts WHERE student_id = ? AND trial_id = ?', [me.student_id, t.trial_id])[0];
      if (!attempt) {
        if (asg.status !== 'open') return res.status(409).json({ error: 'This trial is closed.' });
        const acc = accommodationsFor(me.student_id);
        let qs = getQuestions(t.trial_id);
        if (acc.short_set && qs.some(q => q.in_short_set)) qs = qs.filter(q => q.in_short_set);
        run(`INSERT INTO oracle_attempts (student_id, trial_id, class_period, question_ids, accommodations) VALUES (?,?,?,?,?)`,
          [me.student_id, t.trial_id, me.class_period, JSON.stringify(qs.map(q => q.question_id)), JSON.stringify(acc)]);
        attempt = query('SELECT * FROM oracle_attempts WHERE student_id = ? AND trial_id = ?', [me.student_id, t.trial_id])[0];
      } else if (attempt.status === 'in_progress') {
        // A setting the teacher changed since (e.g. larger text) applies now;
        // the question set stays the one the student started with.
        const acc = accommodationsFor(me.student_id);
        run('UPDATE oracle_attempts SET accommodations = ? WHERE attempt_id = ?', [JSON.stringify(acc), attempt.attempt_id]);
        attempt.accommodations = JSON.stringify(acc);
      }
      res.json(studentView(me, t, attempt, asg.status));
    } catch (e) { console.error('oracle open:', e); res.status(500).json({ error: 'Could not open the trial.' }); }
  });

  app.put('/api/oracle/trials/:id/answers', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const tid = parseInt(req.params.id);
      const asg = assignment('oracle', tid, me.class_period);
      const attempt = query('SELECT * FROM oracle_attempts WHERE student_id = ? AND trial_id = ?', [me.student_id, tid])[0];
      if (!asg || !attempt) return res.status(404).json({ error: 'Trial not found' });
      if (attempt.status !== 'in_progress') return res.status(409).json({ error: 'You already turned this in.' });
      if (asg.status !== 'open') return res.status(409).json({ error: 'This trial was closed. Tell your teacher if you weren\'t finished.' });
      const ids = new Set(parse(attempt.question_ids, []));
      const answers = parse(attempt.answers, {});
      for (const [k, v] of Object.entries((req.body || {}).answers || {})) {
        const qid = parseInt(k), idx = parseInt(v);
        if (ids.has(qid) && Number.isInteger(idx) && idx >= 0 && idx < 6) answers[qid] = idx;
      }
      run('UPDATE oracle_attempts SET answers = ? WHERE attempt_id = ?', [JSON.stringify(answers), attempt.attempt_id]);
      res.json({ saved: Object.keys(answers).length });
    } catch (e) { res.status(500).json({ error: 'Could not save. Your answers are still on screen — try again.' }); }
  });

  app.post('/api/oracle/trials/:id/submit', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const t = getTrial(parseInt(req.params.id));
      const asg = t && assignment('oracle', t.trial_id, me.class_period);
      const attempt = t && query('SELECT * FROM oracle_attempts WHERE student_id = ? AND trial_id = ?', [me.student_id, t.trial_id])[0];
      if (!asg || !attempt) return res.status(404).json({ error: 'Trial not found' });
      if (attempt.status === 'submitted') return res.json(studentView(me, t, attempt, asg.status));
      if (asg.status !== 'open') return res.status(409).json({ error: 'This trial was closed. Tell your teacher if you weren\'t finished.' });
      const answers = parse(attempt.answers, {});
      const all = getQuestions(t.trial_id);
      const qs = parse(attempt.question_ids, []).map(id => all.find(q => q.question_id === id)).filter(Boolean);
      const unanswered = qs.filter(q => answers[q.question_id] === undefined).length;
      if (unanswered && !(req.body || {}).confirm_unanswered) {
        return res.status(400).json({ error: `${unanswered} question${unanswered === 1 ? ' is' : 's are'} not answered yet.`, unanswered });
      }
      const byType = {};
      let score = 0;
      qs.forEach(q => {
        const bt = byType[q.question_type] || (byType[q.question_type] = { correct: 0, total: 0 });
        bt.total++;
        if (answers[q.question_id] === q.correct_index) { bt.correct++; score++; }
      });
      const total = qs.length;
      const pct = total ? Math.round(score / total * 1000) / 10 : 0;
      // Growth reward: compare with this student's own earlier trials
      let points = 0;
      if (!attempt.points_awarded) {
        const prior = query(`SELECT AVG(percentage) AS avg FROM oracle_attempts WHERE student_id = ? AND status = 'submitted' AND trial_id != ?`,
          [me.student_id, t.trial_id])[0].avg;
        const bonus = prior === null || prior === undefined ? 0 : Math.max(0, Math.min(MAX_GROWTH_BONUS, Math.floor((pct - prior) / 2)));
        points = BASE_POINTS + bonus;
        if (me.alliance_id) voyage.addPoints(me.alliance_id, me.student_id, points, 'oracle_trial',
          `Oracle Trial "${t.title}" (${pct}%${bonus ? `, +${bonus} for growth` : ''})`);
        else points = 0;
      }
      run(`UPDATE oracle_attempts SET status='submitted', score=?, total=?, percentage=?, by_type=?, completed_at=CURRENT_TIMESTAMP,
           points_awarded = points_awarded + ? WHERE attempt_id = ?`, [score, total, pct, JSON.stringify(byType), points, attempt.attempt_id]);
      const fresh = query('SELECT * FROM oracle_attempts WHERE attempt_id = ?', [attempt.attempt_id])[0];
      res.json(Object.assign(studentView(me, t, fresh, asg.status), { points_this_time: points }));
    } catch (e) { console.error('oracle submit:', e); res.status(500).json({ error: 'Could not turn it in. Your answers are saved — try again.' }); }
  });

  // ── TEACHER: reading dashboard ────────────────────────────────────────────
  // Per period: every assigned trial (by week) with averages by question type,
  // and every student's score per trial plus their totals by question type.
  app.get('/api/teacher/reading/dashboard', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    try {
      const period = req.query.period;
      if (!period) return res.status(400).json({ error: 'Choose a period.' });
      const trials = query(
        `SELECT t.trial_id, t.title, t.week, t.source, t.word_count, ca.status FROM challenge_assignments ca
         JOIN oracle_trials t ON t.trial_id = ca.item_id WHERE ca.kind = 'oracle' AND ca.class_period = ?
         ORDER BY COALESCE(t.week, 999), t.trial_id`, [period]);
      const students = query(`SELECT s.student_id, s.name, a.alliance_name FROM students s LEFT JOIN alliances a ON a.alliance_id = s.alliance_id
        WHERE s.class_period = ? AND (s.is_ghost = 0 OR s.is_ghost IS NULL) ORDER BY s.name`, [period]);
      const attempts = query(`SELECT attempt_id, student_id, trial_id, status, percentage, by_type, accommodations FROM oracle_attempts WHERE class_period = ?`, [period]);
      const addType = (acc, bt) => { for (const [k, v] of Object.entries(bt || {})) { const a = acc[k] || (acc[k] = { correct: 0, total: 0 }); a.correct += v.correct; a.total += v.total; } };
      const trialRows = trials.map(t => {
        const sub = attempts.filter(a => a.trial_id === t.trial_id && a.status === 'submitted');
        const types = {}; sub.forEach(a => addType(types, parse(a.by_type, {})));
        return Object.assign(t, {
          submitted: sub.length, in_progress: attempts.filter(a => a.trial_id === t.trial_id && a.status === 'in_progress').length,
          average: sub.length ? Math.round(sub.reduce((s, a) => s + a.percentage, 0) / sub.length * 10) / 10 : null, by_type: types
        });
      });
      const studentRows = students.map(s => {
        const mine = attempts.filter(a => a.student_id === s.student_id);
        const types = {}; mine.filter(a => a.status === 'submitted').forEach(a => addType(types, parse(a.by_type, {})));
        const scores = {}; mine.forEach(a => { scores[a.trial_id] = { attempt_id: a.attempt_id, status: a.status, percentage: a.percentage,
          adjusted: Object.values(parse(a.accommodations, {})).some(Boolean) }; });
        const ordered = trialRows.map(t => scores[t.trial_id]).filter(x => x && x.status === 'submitted');
        return Object.assign(s, { scores, by_type: types,
          change: ordered.length >= 2 ? Math.round((ordered[ordered.length - 1].percentage - ordered[0].percentage) * 10) / 10 : null });
      });
      // Labyrinth Logic summary for the same period
      const logic = query(`SELECT la.student_id, SUM(la.solved) AS solved, COUNT(*) AS tried FROM logic_attempts la
        JOIN students s ON s.student_id = la.student_id WHERE s.class_period = ? GROUP BY la.student_id`, [period]);
      studentRows.forEach(s => { const l = logic.find(x => x.student_id === s.student_id); s.logic_solved = l ? l.solved : 0; s.logic_tried = l ? l.tried : 0; });
      res.json({ period, trials: trialRows, students: studentRows, question_types: QUESTION_TYPES });
    } catch (e) { console.error('reading dashboard:', e); res.status(500).json({ error: 'Could not load the dashboard.' }); }
  });
};
