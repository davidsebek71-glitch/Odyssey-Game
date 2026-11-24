// ============================================================================
// LABYRINTH LOGIC — Stage 3: logic grid puzzles
// ----------------------------------------------------------------------------
// The teacher builds a puzzle from categories and structured clues (lib/logic.js
// works out the answer). A puzzle can be published only when exactly one answer
// fits the clues. Published puzzles are assigned to periods and opened/closed.
// Students solve on a grid (autosaved). Checking tells them how many matches
// are right; no timer. The first correct solve earns alliance points.
// Puzzles can later be reused as capstone puzzle boxes and guardian challenges.
// ============================================================================
const logic = require('../lib/logic');
const points = (cats) => cats.length === 3 ? 20 : cats[0].items.length === 4 ? 15 : 10;

module.exports = function registerLabyrinthRoutes(app, deps) {
  const { authenticateToken, query, run } = deps;
  const voyage = require('./voyage_helpers')({ query, run });
  const isTeacher = req => req.user && req.user.type === 'teacher';
  const teacherOnly = (req, res) => { if (!isTeacher(req)) { res.status(403).json({ error: 'Teacher access required' }); return false; } return true; };
  const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
  const getStudent = id => query('SELECT student_id, name, class_period, alliance_id FROM students WHERE student_id = ?', [id])[0] || null;
  const studentOnly = (req, res) => {
    if (req.user.type !== 'student') { res.status(403).json({ error: 'Students only' }); return null; }
    const me = getStudent(req.user.id); if (!me) { res.status(404).json({ error: 'Student not found' }); return null; }
    return me;
  };
  const getPuzzle = id => query('SELECT * FROM logic_puzzles WHERE puzzle_id = ?', [id])[0] || null;
  const assignment = (id, period) => query(`SELECT * FROM challenge_assignments WHERE kind = 'logic' AND item_id = ? AND class_period = ?`, [id, period])[0] || null;
  const attemptCount = id => query('SELECT COUNT(*) AS n FROM logic_attempts WHERE puzzle_id = ?', [id])[0].n;

  function readPuzzle(b) {
    const title = typeof b.title === 'string' ? b.title.trim().slice(0, 200) : '';
    if (!title) return { error: 'Give the puzzle a title.' };
    const categories = (Array.isArray(b.categories) ? b.categories : []).slice(0, 3).map(c => ({
      name: String((c && c.name) || '').trim().slice(0, 60),
      items: (Array.isArray(c && c.items) ? c.items : []).slice(0, 4).map(x => String(x || '').trim().slice(0, 60))
    }));
    const clues = (Array.isArray(b.clues) ? b.clues : []).slice(0, 30).map(c => {
      const ref = r => r ? { c: parseInt(r.c), i: parseInt(r.i) } : null;
      const out = { type: c && c.type, a: ref(c && c.a), b: ref(c && c.b) };
      if (out.type === 'either') out.b2 = ref(c.b2);
      if (c && typeof c.text === 'string' && c.text.trim()) out.text = c.text.trim().slice(0, 300);
      return out;
    });
    return { puzzle: { title, intro: typeof b.intro === 'string' ? b.intro.slice(0, 1500) : '', age: typeof b.age === 'string' ? b.age.slice(0, 20) : 'Classical', categories, clues } };
  }

  // ── TEACHER ───────────────────────────────────────────────────────────────
  // Live check for the builder: how many answers fit these clues?
  app.post('/api/teacher/logic/check', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    const r = readPuzzle(Object.assign({ title: 'x' }, req.body || {}));
    const c = logic.check(r.puzzle.categories, r.puzzle.clues);
    res.json({ ok: c.ok, count: c.count, problem: c.problem, clue_texts: c.problem && c.count === null ? [] : r.puzzle.clues.map(cl => logic.clueText(cl, r.puzzle.categories)) });
  });

  app.get('/api/teacher/logic/puzzles', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    const puzzles = query('SELECT * FROM logic_puzzles ORDER BY puzzle_id DESC').map(p => {
      const cats = parse(p.categories, []);
      return { puzzle_id: p.puzzle_id, title: p.title, status: p.status, age: p.age,
        size: cats.length ? `${cats.length} categories × ${(cats[0].items || []).length}` : '',
        attempts: attemptCount(p.puzzle_id), solved: query('SELECT COUNT(*) AS n FROM logic_attempts WHERE puzzle_id = ? AND solved = 1', [p.puzzle_id])[0].n,
        assignments: query(`SELECT class_period, status FROM challenge_assignments WHERE kind = 'logic' AND item_id = ? ORDER BY class_period`, [p.puzzle_id]) };
    });
    res.json({ puzzles });
  });
  app.get('/api/teacher/logic/puzzles/:id', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    const p = getPuzzle(parseInt(req.params.id));
    if (!p) return res.status(404).json({ error: 'Puzzle not found' });
    res.json({ puzzle: Object.assign(p, { categories: parse(p.categories, []), clues: parse(p.clues, []), solution: parse(p.solution, null) }), attempts: attemptCount(p.puzzle_id) });
  });

  // Save (as a draft). Publishing is a separate step that requires one answer.
  function save(req, res, existing) {
    const r = readPuzzle(req.body || {});
    if (r.error) return res.status(400).json({ error: r.error });
    const p = r.puzzle;
    if (existing) {
      if (attemptCount(existing.puzzle_id)) return res.status(409).json({ error: 'Students have already worked on this puzzle, so it can\'t be changed.' });
      run(`UPDATE logic_puzzles SET title=?, intro=?, age=?, categories=?, clues=?, solution=NULL, status='draft', updated_at=CURRENT_TIMESTAMP WHERE puzzle_id=?`,
        [p.title, p.intro, p.age, JSON.stringify(p.categories), JSON.stringify(p.clues), existing.puzzle_id]);
      return res.json({ puzzle_id: existing.puzzle_id, status: 'draft', check: logic.check(p.categories, p.clues) });
    }
    run(`INSERT INTO logic_puzzles (title, intro, age, categories, clues, status) VALUES (?,?,?,?,?,'draft')`,
      [p.title, p.intro, p.age, JSON.stringify(p.categories), JSON.stringify(p.clues)]);
    res.json({ puzzle_id: query('SELECT last_insert_rowid() AS id')[0].id, status: 'draft', check: logic.check(p.categories, p.clues) });
  }
  app.post('/api/teacher/logic/puzzles', authenticateToken, (req, res) => { if (teacherOnly(req, res)) { try { save(req, res, null); } catch (e) { res.status(500).json({ error: 'Could not save.' }); } } });
  app.put('/api/teacher/logic/puzzles/:id', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    const p = getPuzzle(parseInt(req.params.id));
    if (!p) return res.status(404).json({ error: 'Puzzle not found' });
    try { save(req, res, p); } catch (e) { res.status(500).json({ error: 'Could not save.' }); }
  });

  app.post('/api/teacher/logic/puzzles/:id/publish', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    const p = getPuzzle(parseInt(req.params.id));
    if (!p) return res.status(404).json({ error: 'Puzzle not found' });
    const c = logic.check(parse(p.categories, []), parse(p.clues, []));
    if (!c.ok) return res.status(400).json({ error: `Can't publish yet: ${c.problem}`, count: c.count });
    run(`UPDATE logic_puzzles SET status='published', solution=?, updated_at=CURRENT_TIMESTAMP WHERE puzzle_id=?`, [JSON.stringify(c.solution), p.puzzle_id]);
    res.json({ status: 'published' });
  });

  app.delete('/api/teacher/logic/puzzles/:id', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    const p = getPuzzle(parseInt(req.params.id));
    if (!p) return res.status(404).json({ error: 'Puzzle not found' });
    if (attemptCount(p.puzzle_id)) return res.status(409).json({ error: 'Students have worked on this puzzle, so it is kept.' });
    run(`DELETE FROM challenge_assignments WHERE kind = 'logic' AND item_id = ?`, [p.puzzle_id]);
    run('DELETE FROM logic_puzzles WHERE puzzle_id = ?', [p.puzzle_id]);
    res.json({ deleted: true });
  });

  app.post('/api/teacher/logic/puzzles/:id/assign', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    const p = getPuzzle(parseInt(req.params.id));
    if (!p) return res.status(404).json({ error: 'Puzzle not found' });
    const { class_period, status } = req.body || {};
    if (!class_period) return res.status(400).json({ error: 'Choose a period.' });
    if (p.status !== 'published') return res.status(409).json({ error: 'Publish the puzzle first (it needs exactly one answer).' });
    if (status === 'remove') {
      run(`DELETE FROM challenge_assignments WHERE kind = 'logic' AND item_id = ? AND class_period = ?`, [p.puzzle_id, class_period]);
      return res.json({ removed: true });
    }
    if (!['open', 'closed'].includes(status)) return res.status(400).json({ error: 'status must be open, closed or remove' });
    run(`INSERT INTO challenge_assignments (kind, item_id, class_period, status) VALUES ('logic', ?, ?, ?)
         ON CONFLICT(kind, item_id, class_period) DO UPDATE SET status = excluded.status,
         closed_at = CASE WHEN excluded.status = 'closed' THEN CURRENT_TIMESTAMP ELSE NULL END`, [p.puzzle_id, class_period, status]);
    res.json({ class_period, status });
  });

  // ── STUDENT ───────────────────────────────────────────────────────────────
  app.get('/api/logic/puzzles', authenticateToken, (req, res) => {
    const me = studentOnly(req, res); if (!me) return;
    const rows = query(
      `SELECT p.puzzle_id, p.title, p.categories, ca.status AS period_status, la.solved, la.checks
       FROM challenge_assignments ca JOIN logic_puzzles p ON p.puzzle_id = ca.item_id
       LEFT JOIN logic_attempts la ON la.puzzle_id = p.puzzle_id AND la.student_id = ?
       WHERE ca.kind = 'logic' AND ca.class_period = ? AND p.status = 'published' ORDER BY p.puzzle_id DESC`, [me.student_id, me.class_period]);
    res.json({ puzzles: rows.map(r => { const c = parse(r.categories, []); delete r.categories;
      return Object.assign(r, { size: `${c.length} × ${(c[0] || { items: [] }).items.length}`, solved: !!r.solved }); }) });
  });

  app.get('/api/logic/puzzles/:id', authenticateToken, (req, res) => {
    const me = studentOnly(req, res); if (!me) return;
    const p = getPuzzle(parseInt(req.params.id));
    const asg = p && assignment(p.puzzle_id, me.class_period);
    if (!p || !asg || p.status !== 'published') return res.status(404).json({ error: 'This puzzle isn\'t assigned to your class.' });
    const cats = parse(p.categories, []), clues = parse(p.clues, []);
    const att = query('SELECT * FROM logic_attempts WHERE student_id = ? AND puzzle_id = ?', [me.student_id, p.puzzle_id])[0];
    const acc = query('SELECT settings FROM student_accommodations WHERE student_id = ?', [me.student_id])[0];
    const s = acc ? parse(acc.settings, {}) : {};
    res.json({
      puzzle: { puzzle_id: p.puzzle_id, title: p.title, intro: p.intro, categories: cats, clues: clues.map(c => logic.clueText(c, cats)), points: points(cats) },
      period_status: asg.status, grid: att ? parse(att.grid, {}) : {}, solved: !!(att && att.solved), checks: att ? att.checks : 0,
      accommodations: { large_text: !!s.large_text, read_aloud: !!s.read_aloud }
    });
  });

  function ensureAttempt(me, p) {
    run('INSERT OR IGNORE INTO logic_attempts (student_id, alliance_id, puzzle_id) VALUES (?,?,?)', [me.student_id, me.alliance_id || null, p.puzzle_id]);
    return query('SELECT * FROM logic_attempts WHERE student_id = ? AND puzzle_id = ?', [me.student_id, p.puzzle_id])[0];
  }
  app.put('/api/logic/puzzles/:id/grid', authenticateToken, (req, res) => {
    const me = studentOnly(req, res); if (!me) return;
    const p = getPuzzle(parseInt(req.params.id));
    const asg = p && assignment(p.puzzle_id, me.class_period);
    if (!p || !asg) return res.status(404).json({ error: 'Puzzle not found' });
    const grid = (req.body || {}).grid;
    const json = JSON.stringify(grid && typeof grid === 'object' ? grid : {});
    if (json.length > 5000) return res.status(400).json({ error: 'Grid too large' });
    const att = ensureAttempt(me, p);
    run('UPDATE logic_attempts SET grid = ? WHERE attempt_id = ?', [json, att.attempt_id]);
    res.json({ saved: true });
  });

  // Check an answer. answer = rows like the solution: answer[i][c] = item of
  // category c that goes with item i of category 0.
  app.post('/api/logic/puzzles/:id/check', authenticateToken, (req, res) => {
    const me = studentOnly(req, res); if (!me) return;
    const p = getPuzzle(parseInt(req.params.id));
    const asg = p && assignment(p.puzzle_id, me.class_period);
    if (!p || !asg) return res.status(404).json({ error: 'Puzzle not found' });
    if (asg.status !== 'open') return res.status(409).json({ error: 'This puzzle is closed.' });
    const solution = parse(p.solution, null), cats = parse(p.categories, []);
    const answer = (req.body || {}).answer;
    const n = cats[0].items.length, k = cats.length;
    const complete = Array.isArray(answer) && answer.length === n && answer.every((row, i) => Array.isArray(row) && row.length === k && row[0] === i &&
      row.slice(1).every(v => Number.isInteger(v) && v >= 0 && v < n));
    if (!complete) return res.status(400).json({ error: `Mark one ● for each ${cats[0].name.toLowerCase()} in every grid before checking.` });
    const att = ensureAttempt(me, p);
    const right = solution.reduce((s, row, i) => s + row.slice(1).filter((v, c) => answer[i][c + 1] === v).length, 0);
    const totalLinks = n * (k - 1);
    const correct = logic.isCorrect(solution, answer);
    let awarded = 0;
    if (correct && !att.solved && me.alliance_id) {
      awarded = points(cats);
      voyage.addPoints(me.alliance_id, me.student_id, awarded, 'labyrinth_logic', `Solved Labyrinth Logic "${p.title}"`);
    }
    run(`UPDATE logic_attempts SET checks = checks + 1, solved = MAX(solved, ?), points_awarded = points_awarded + ?,
         completed_at = CASE WHEN ? = 1 AND completed_at IS NULL THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE attempt_id = ?`,
      [correct ? 1 : 0, awarded, correct ? 1 : 0, att.attempt_id]);
    res.json({ correct, right, total: totalLinks, points_awarded: awarded,
      message: correct ? 'Solved! The labyrinth opens.' : `${right} of ${totalLinks} matches are right. Look at the clues again.` });
  });
};
