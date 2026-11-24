// ============================================================================
// MINI GAMES — Stage 7: one mini game per story, built from WHEN/THEN rules
// ----------------------------------------------------------------------------
// The game is data (things, rules, start) run by public/js/minigame.js, the
// same engine in the browser and here. Student input is never run as code.
//
// Levels
//   starter  — a template (data/game_templates.json); only names, pictures,
//              words, questions and positions may change
//   builder  — a template plus adding/removing things and rules (max 10 rules)
//   inventor — start blank (max 8 rules)
//
// Safeguards
//   - the survival clue (a sentence the author picks) must appear in the story
//   - the engine must find a winning path before the game can be submitted
//   - moderation first, then a teammate play-test:
//       draft → submitted → (teacher) approved → (teammate play-test) published
//       the teacher can also return it with a note, or publish it directly
//     Play-test feedback is chosen from fixed answers (no free text), so no
//     unreviewed student writing reaches anyone.
//   - losing just returns the reader to the story: no penalty, no points
// ============================================================================
const fs = require('fs');
const path = require('path');
const MG = require('../public/js/minigame.js');
const LIMITS = { starter: { maxRules: 10, maxThings: 12 }, builder: { maxRules: 10, maxThings: 12 }, inventor: { maxRules: 8, maxThings: 12 } };
const EDITABLE = ['draft', 'returned'];
const PLAYTEST = {
  works: null,
  cant_survive: 'A teammate play-tested it and couldn\'t find a way to survive.',
  unexpected: 'A teammate play-tested it and something didn\'t happen the way they expected.',
  words: 'A teammate play-tested it and some words need fixing.'
};

function loadTemplates() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'game_templates.json'), 'utf8')).templates || []; }
  catch (e) { console.error('❌ game_templates.json:', e.message); return []; }
}
const str = (v, max) => typeof v === 'string' ? v.replace(/\u0000/g, '').slice(0, max) : '';
const int = v => Number.isInteger(v) ? v : parseInt(v);

// Clean whatever the browser sent into the exact shape the engine expects
function sanitize(b) {
  const things = (Array.isArray(b.things) ? b.things : []).slice(0, 12).map(t => {
    const out = {
      id: str(t && t.id, 20).replace(/[^a-z0-9_]/gi, '') || null, name: str(t && t.name, 40),
      emoji: MG.EMOJI.includes(t && t.emoji) ? t.emoji : '⭐', type: MG.TYPES.includes(t && t.type) ? t.type : 'item',
      x: int(t && t.x), y: int(t && t.y), hidden: !!(t && t.hidden)
    };
    if (t && t.question && out.type === 'character') {
      const opts = (Array.isArray(t.question.options) ? t.question.options : []).slice(0, 4).map(o => str(o, 80));
      const ci = int(t.question.correct_index);
      out.question = { prompt: str(t.question.prompt, 200), options: opts, correct_index: Number.isInteger(ci) && ci >= 0 && ci < opts.length ? ci : null };
    }
    return out;
  });
  const rules = (Array.isArray(b.rules) ? b.rules : []).slice(0, 12).map(r => {
    const w = (r && r.when) || {}, th = (r && r.then) || {};
    const out = { when: { event: str(w.event, 20), thing: str(w.thing, 20) }, then: { do: str(th.do, 20) } };
    if (w.event === 'answers') out.when.answer = w.answer === 'wrong' ? 'wrong' : 'correct';
    if (r && r.if && r.if.carrying) out.if = { carrying: str(r.if.carrying, 20), not: !!r.if.not };
    if (['open_path', 'appear', 'vanish'].includes(th.do)) out.then.thing = str(th.thing, 20);
    if (th.do === 'message') out.then.text = str(th.text, 200);
    if (th.do === 'move') { out.then.x = int(th.x); out.then.y = int(th.y); }
    return out;
  });
  const start = { x: int(b.start && b.start.x), y: int(b.start && b.start.y) };
  return { things, rules, start };
}
// Starter games may not change the template's structure
function starterProblem(game, tpl) {
  if (!tpl) return 'Choose a template.';
  const sig = t => `${t.id}:${t.type}:${!!t.question}:${!!t.hidden}`;
  if (game.things.map(sig).sort().join('|') !== tpl.things.map(t => sig(Object.assign({ hidden: false }, t))).sort().join('|')) return 'At Starter level you can change names, pictures, words and positions, but not add or remove things. (Builder level lets you.)';
  const rsig = r => JSON.stringify([r.when.event, r.when.thing, r.when.answer || '', r.if ? [r.if.carrying, !!r.if.not] : '', r.then.do, r.then.thing || '', r.then.x ?? '', r.then.y ?? '']);
  if (game.rules.map(rsig).join('|') !== tpl.rules.map(r => rsig(Object.assign({}, r, { if: r.if && r.if.carrying ? r.if : undefined }))).join('|')) return 'At Starter level the rules stay as they are; you can change the words. (Builder level lets you change rules.)';
  return null;
}
const norm = t => String(t || '').toLowerCase().replace(/[“”"’'‘]/g, '').replace(/\s+/g, ' ').trim();

module.exports = function registerGameRoutes(app, deps) {
  const { authenticateToken, query, run, island } = deps;
  const { getPin, getStudent } = island;
  const isTeacher = req => req.user && req.user.type === 'teacher';
  const getGame = pinId => query('SELECT * FROM pin_games WHERE pin_id = ?', [pinId])[0] || null;
  const parse = (s, d) => { try { return JSON.parse(s); } catch (e) { return d; } };
  const gameData = g => ({ things: parse(g.things, []), rules: parse(g.rules, []), start: parse(g.start, { x: 0, y: 0 }) });
  const templates = () => loadTemplates();

  function checkGame(g, pin) {
    const data = gameData(g);
    const r = MG.check(data, LIMITS[g.level] || LIMITS.inventor);
    const problems = r.problems.slice();
    if (g.level === 'starter') { const sp = starterProblem(data, templates().find(t => t.key === g.template)); if (sp) problems.unshift(sp); }
    if (!norm(g.clue_text)) problems.unshift('Pick the sentence in your story that holds the survival clue.');
    else if (!norm(pin.body).includes(norm(g.clue_text))) problems.unshift('The survival clue must be a sentence from your story.');
    return { ok: problems.length === 0, problems, winning_moves: r.winning_moves || null };
  }
  function sameAlliance(req, ownerId) {
    if (req.user.type !== 'student') return false;
    const me = getStudent(req.user.id), o = getStudent(ownerId);
    return !!(me && o && me.alliance_id && me.alliance_id === o.alliance_id && me.student_id !== o.student_id);
  }
  // Who may play: teacher, author; teammates once approved (play-test);
  // anyone who can read the published story once the game is published
  function canPlay(req, g, pin) {
    if (isTeacher(req) || req.user.id === g.owner_student_id) return true;
    if (g.status === 'approved') return sameAlliance(req, g.owner_student_id);
    if (g.status === 'published') {
      if (pin.status !== 'published') return false;
      if (sameAlliance(req, g.owner_student_id)) return true;
      const access = island.islandAccess(req, pin.owner_student_id);
      return access === 'full' || !!island.myVisit(req, pin.pin_id);
    }
    return false;
  }
  function out(g, pin, req, withCheck) {
    const o = { pin_id: g.pin_id, owner_student_id: g.owner_student_id, level: g.level, template: g.template, status: g.status, clue_text: g.clue_text,
      teacher_note: (isTeacher(req) || req.user.id === g.owner_student_id) ? g.teacher_note : undefined,
      playtested: !!g.playtested_by, story_title: pin.title, ...gameData(g) };
    if (withCheck) o.check = checkGame(g, pin);
    return o;
  }

  app.get('/api/games/templates', authenticateToken, (req, res) => res.json({ templates: templates(), limits: LIMITS }));

  // A pin's game: for its author (editing) or a player
  app.get('/api/games/pin/:pinId', authenticateToken, (req, res) => {
    const pin = getPin(parseInt(req.params.pinId));
    if (!pin) return res.status(404).json({ error: 'Story not found' });
    const g = getGame(pin.pin_id);
    const mine = req.user.type === 'student' && req.user.id === pin.owner_student_id;
    if (!g) return res.json({ game: null, can_edit: mine && !!pin.quest_id, story: mine ? { title: pin.title, body: pin.body } : undefined });
    const play = canPlay(req, g, pin);
    if (!mine && !play) return res.json({ game: null, can_play: false });
    res.json({ game: out(g, pin, req, mine || isTeacher(req)), can_edit: mine, can_play: play,
      can_playtest: g.status === 'approved' && sameAlliance(req, g.owner_student_id),
      story: (mine || isTeacher(req)) ? { title: pin.title, body: pin.body } : undefined });
  });

  // Save (author; draft or returned). Starting from a template copies it.
  app.put('/api/games/pin/:pinId', authenticateToken, (req, res) => {
    try {
      if (req.user.type !== 'student') return res.status(403).json({ error: 'Students only' });
      const pin = getPin(parseInt(req.params.pinId));
      if (!pin || pin.owner_student_id !== req.user.id) return res.status(404).json({ error: 'Story not found' });
      if (!pin.quest_id) return res.status(400).json({ error: 'Mini games go with a story (a quest piece), not a named place.' });
      let g = getGame(pin.pin_id);
      if (g && !EDITABLE.includes(g.status)) return res.status(409).json({ error: 'This game is with your teacher or already published. Use "Edit again" to change it.' });
      const b = req.body || {};
      const level = ['starter', 'builder', 'inventor'].includes(b.level) ? b.level : 'starter';
      let data;
      if (b.from_template) {
        const tpl = templates().find(t => t.key === b.from_template);
        if (!tpl) return res.status(400).json({ error: 'Unknown template' });
        data = { things: tpl.things.map(t => Object.assign({ hidden: false }, t)), rules: tpl.rules, start: tpl.start };
      } else if (b.blank) {
        data = { things: [], rules: [], start: { x: 1, y: 6 } };
      } else data = sanitize(b);
      const template = b.from_template || (b.blank ? null : (b.template ?? (g && g.template)));
      const clue = b.clue_text !== undefined ? str(b.clue_text, 400) : (g ? g.clue_text : '');
      if (g) run(`UPDATE pin_games SET level=?, template=?, things=?, rules=?, start=?, clue_text=?, updated_at=CURRENT_TIMESTAMP WHERE pin_id=?`,
        [level, template, JSON.stringify(data.things), JSON.stringify(data.rules), JSON.stringify(data.start), clue, pin.pin_id]);
      else run(`INSERT INTO pin_games (pin_id, owner_student_id, level, template, things, rules, start, clue_text) VALUES (?,?,?,?,?,?,?,?)`,
        [pin.pin_id, req.user.id, level, template, JSON.stringify(data.things), JSON.stringify(data.rules), JSON.stringify(data.start), clue]);
      g = getGame(pin.pin_id);
      res.json({ game: out(g, pin, req, true) });
    } catch (e) { console.error('game save:', e); res.status(500).json({ error: 'Could not save the game. Try again.' }); }
  });

  app.post('/api/games/pin/:pinId/submit', authenticateToken, (req, res) => {
    const pin = getPin(parseInt(req.params.pinId)), g = pin && getGame(pin.pin_id);
    if (!g || g.owner_student_id !== req.user.id) return res.status(404).json({ error: 'Game not found' });
    if (!EDITABLE.includes(g.status)) return res.json({ status: g.status, already: true });
    const c = checkGame(g, pin);
    if (!c.ok) return res.status(400).json({ error: c.problems[0], problems: c.problems });
    run(`UPDATE pin_games SET status='submitted', submitted_at=CURRENT_TIMESTAMP WHERE pin_id=?`, [pin.pin_id]);
    res.json({ status: 'submitted' });
  });
  // Take a game back to change it (it leaves play until approved again)
  app.post('/api/games/pin/:pinId/edit-again', authenticateToken, (req, res) => {
    const g = getGame(parseInt(req.params.pinId));
    if (!g || g.owner_student_id !== req.user.id) return res.status(404).json({ error: 'Game not found' });
    run(`UPDATE pin_games SET status='draft', playtested_by=NULL WHERE pin_id=?`, [g.pin_id]);
    res.json({ status: 'draft' });
  });

  // Teammate play-test (fixed answers only)
  app.post('/api/games/pin/:pinId/playtest', authenticateToken, (req, res) => {
    const g = getGame(parseInt(req.params.pinId));
    if (!g) return res.status(404).json({ error: 'Game not found' });
    if (g.status !== 'approved' || !sameAlliance(req, g.owner_student_id)) return res.status(403).json({ error: 'Only a teammate can play-test this game, after the teacher approves it.' });
    const result = (req.body || {}).result;
    if (!(result in PLAYTEST)) return res.status(400).json({ error: 'Choose how the play-test went.' });
    if (result === 'works') run(`UPDATE pin_games SET status='published', playtested_by=?, published_at=CURRENT_TIMESTAMP WHERE pin_id=?`, [req.user.id, g.pin_id]);
    else run(`UPDATE pin_games SET status='returned', teacher_note=? WHERE pin_id=?`, [PLAYTEST[result], g.pin_id]);
    res.json({ status: result === 'works' ? 'published' : 'returned' });
  });

  // ── Teacher ───────────────────────────────────────────────────────────────
  app.get('/api/teacher/games', authenticateToken, (req, res) => {
    if (!isTeacher(req)) return res.status(403).json({ error: 'Teacher access required' });
    const period = req.query.period || null;
    const rows = query(`SELECT g.*, s.name AS student_name, s.class_period, p.title AS story_title FROM pin_games g
      JOIN students s ON s.student_id = g.owner_student_id JOIN island_pins p ON p.pin_id = g.pin_id
      WHERE g.status IN ('submitted','approved') ${period ? 'AND s.class_period = ?' : ''} ORDER BY g.submitted_at`, period ? [period] : []);
    res.json({ games: rows.map(r => Object.assign({ pin_id: r.pin_id, student_name: r.student_name, class_period: r.class_period, story_title: r.story_title,
      status: r.status, level: r.level, clue_text: r.clue_text }, gameData(r), { check: checkGame(r, getPin(r.pin_id)) })) });
  });
  app.post('/api/teacher/games/:pinId/review', authenticateToken, (req, res) => {
    if (!isTeacher(req)) return res.status(403).json({ error: 'Teacher access required' });
    const g = getGame(parseInt(req.params.pinId));
    if (!g) return res.status(404).json({ error: 'Game not found' });
    const { action } = req.body || {}; const note = str((req.body || {}).note, 500).trim();
    if (action === 'approve') { run(`UPDATE pin_games SET status='approved', teacher_note=?, reviewed_at=CURRENT_TIMESTAMP WHERE pin_id=?`, [note || null, g.pin_id]); return res.json({ status: 'approved' }); }
    if (action === 'publish') { run(`UPDATE pin_games SET status='published', teacher_note=?, reviewed_at=CURRENT_TIMESTAMP, published_at=CURRENT_TIMESTAMP WHERE pin_id=?`, [note || null, g.pin_id]); return res.json({ status: 'published' }); }
    if (action === 'return') {
      if (!note) return res.status(400).json({ error: 'Add a note telling the student what to change.' });
      run(`UPDATE pin_games SET status='returned', teacher_note=?, reviewed_at=CURRENT_TIMESTAMP WHERE pin_id=?`, [note, g.pin_id]); return res.json({ status: 'returned' });
    }
    res.status(400).json({ error: 'action must be approve, publish or return' });
  });
};
