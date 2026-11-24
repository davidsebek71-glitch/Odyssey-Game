// ============================================================================
// ISLANDS — Stage 1: quest sites and story pins
// ----------------------------------------------------------------------------
// Each student has their own island (their uploaded map, students.map_image).
// Passing a myth's quiz unlocks that myth's island quests. A student places a
// pin on their map, writes and/or photographs their work, and submits it.
// The teacher approves (pin is published, points awarded once) or returns it
// with a note. Nobody but the author and the teacher sees a pin before it is
// published. In Stage 1 a published pin can be opened by the author's
// alliance-mates; Stage 2 (voyages) widens that.
//
// Status flow: draft -> submitted -> published
//                          \-> returned -> (edit) -> submitted ...
// ============================================================================
const fs = require('fs');
const path = require('path');

const TEST_PERIOD = 'Test';
const PIN_TYPES = ['shrine', 'creature', 'landmark', 'poem', 'lair', 'guardian', 'monster'];
const FEATURE_TYPES = ['river', 'mountain', 'city'];
const MAX_FEATURES = 20;
const MAX_TITLE = 80;
const MAX_BODY = 5000;
const MAX_PHOTO_BYTES = 3 * 1024 * 1024;  // after the browser shrinks it, a photo is ~200-600 KB
const EDITABLE = ['draft', 'returned'];

// Same counting rule as the editor in island.html
function countWords(text) { return (text || '').trim().split(/\s+/).filter(Boolean).length; }
function countLines(text) { return (text || '').split(/\r?\n/).filter(l => l.trim().length > 0).length; }

function cleanText(v, max) { return typeof v === 'string' ? v.replace(/\u0000/g, '').slice(0, max) : ''; }
function cleanPct(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, Math.round(n * 100) / 100));
}
function cleanVideoUrl(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || v.length > 300) return undefined;
  try {
    const u = new URL(v.trim());
    return (u.protocol === 'https:' || u.protocol === 'http:') ? u.toString() : undefined;
  } catch (e) { return undefined; }
}

module.exports = function registerIslandRoutes(app, deps) {
  const { authenticateToken, query, run, saveDatabase, DATA_DIR, monsters } = deps;
  const voyage = require('./voyage_helpers')({ query, run });
  const UPLOAD_DIR = path.join(DATA_DIR, 'uploads', 'pins');
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (e) { console.error('island upload dir:', e.message); }

  // ── Quest content: data/island_quests.json → island_quests (upsert by quest_key)
  function loadQuestFile() {
    const file = path.join(__dirname, '..', 'data', 'island_quests.json');
    let data;
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { console.error('❌ island_quests.json could not be read:', e.message); return; }
    let n = 0;
    for (const q of (data.quests || [])) {
      if (!q.quest_key || !q.title) { console.warn('island quest skipped (needs quest_key and title):', q); continue; }
      const pinType = PIN_TYPES.includes(q.pin_type) ? q.pin_type : 'landmark';
      const vals = [q.title, q.age || 'Classical', q.tier === 'core' ? 'core' : 'optional', q.unlock_myth || null,
        q.directions || '', JSON.stringify(Array.isArray(q.images) ? q.images : []),
        parseInt(q.min_words) || 0, parseInt(q.min_lines) || 0, parseInt(q.points) || 0, pinType,
        q.test_only ? 1 : 0, q.active === false ? 0 : 1, parseInt(q.sort_order) || 0];
      const exists = query('SELECT quest_id FROM island_quests WHERE quest_key = ?', [q.quest_key])[0];
      if (exists) {
        run(`UPDATE island_quests SET title=?, age=?, tier=?, unlock_myth=?, directions=?, images=?, min_words=?, min_lines=?,
             points=?, pin_type=?, test_only=?, active=?, sort_order=?, updated_at=CURRENT_TIMESTAMP WHERE quest_key=?`,
          [...vals, q.quest_key]);
      } else {
        run(`INSERT INTO island_quests (title, age, tier, unlock_myth, directions, images, min_words, min_lines, points,
             pin_type, test_only, active, sort_order, quest_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [...vals, q.quest_key]);
      }
      n++;
    }
    console.log(`🏝️  Island quests loaded: ${n}`);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const isTeacher = req => req.user && req.user.type === 'teacher';
  const getStudent = id => query(
    'SELECT student_id, name, class_period, alliance_id, is_ghost FROM students WHERE student_id = ?', [id])[0] || null;
  const getPin = id => query('SELECT * FROM island_pins WHERE pin_id = ?', [id])[0] || null;
  const getQuest = id => query('SELECT * FROM island_quests WHERE quest_id = ?', [id])[0] || null;

  function questVisibleTo(quest, student) {
    if (!quest || !quest.active) return false;
    if (quest.test_only && (!student || student.class_period !== TEST_PERIOD)) return false;
    return true;
  }
  function questUnlocked(quest, studentId) {
    if (!quest.unlock_myth) return true;
    return query(
      `SELECT 1 FROM myth_quiz_attempts a JOIN myth_portals p ON p.portal_id = a.portal_id
       WHERE a.student_id = ? AND a.passed = 1 AND p.myth_name = ? LIMIT 1`,
      [studentId, quest.unlock_myth]).length > 0;
  }
  // A visit (open or completed) this student made to this pin
  function myVisit(req, pinId) {
    if (!req.user || req.user.type !== 'student') return null;
    return query(`SELECT * FROM island_visits WHERE visitor_student_id = ? AND pin_id = ? AND status IN ('open','completed')`,
      [req.user.id, pinId])[0] || null;
  }
  // How much of someone's island a viewer may see:
  //  'full'    — teacher, the owner, or the owner's alliance-mates (published work)
  //  'visitor' — a student in the same period while a voyage is open (or who
  //              already visited this island): sees the map and what's there,
  //              but a piece's content only after spending a token to visit it
  //  null      — nothing
  function islandAccess(req, ownerId) {
    if (isTeacher(req)) return 'full';
    if (req.user.id === ownerId) return 'full';
    const me = getStudent(req.user.id), owner = getStudent(ownerId);
    if (!me || !owner) return null;
    if (me.alliance_id && me.alliance_id === owner.alliance_id) return 'full';
    if (me.class_period && me.class_period === owner.class_period) {
      if (voyage.getSettings(me.class_period).mode === 'voyage') return 'visitor';
      const visited = query(`SELECT 1 FROM island_visits v JOIN island_pins p ON p.pin_id = v.pin_id
        WHERE v.visitor_student_id = ? AND p.owner_student_id = ? AND v.status IN ('open','completed') LIMIT 1`, [me.student_id, ownerId]);
      if (visited.length) return 'visitor';
    }
    return null;
  }
  // Who may open a pin: the teacher and the author/owner always; once it's
  // published, the owner's alliance-mates and anyone who visited it.
  function canViewPin(req, pin) {
    if (isTeacher(req)) return true;
    if (req.user.id === pin.owner_student_id || req.user.id === pin.author_student_id) return true;
    if (pin.status !== 'published') return false;
    if (islandAccess(req, pin.owner_student_id) === 'full') return true;
    return !!myVisit(req, pin.pin_id);
  }
  function canViewIsland(req, ownerId) { return !!islandAccess(req, ownerId); }

  function getQuestion(pinId) {
    const q = query('SELECT * FROM pin_questions WHERE pin_id = ?', [pinId])[0];
    if (!q) return null;
    let options = []; try { options = JSON.parse(q.options || '[]'); } catch (e) {}
    return { prompt: q.prompt, options, correct_index: q.correct_index };
  }
  function questionProblem(q) {
    if (!q) return 'Write a question for visitors about your piece.';
    if (!q.prompt || q.prompt.trim().length < 5) return 'Write the question visitors will answer.';
    const opts = (q.options || []).map(o => (o || '').trim()).filter(Boolean);
    if (opts.length < 2) return 'Give your question at least two answer choices.';
    if (q.correct_index === null || q.correct_index === undefined || !(q.options[q.correct_index] || '').trim()) return 'Mark which answer is correct.';
    return null;
  }
  function pinOut(pin, includePrivate) {
    const quest = pin.quest_id ? getQuest(pin.quest_id) : null;
    const out = {
      pin_id: pin.pin_id, quest_id: pin.quest_id, quest_title: quest ? quest.title : null,
      owner_student_id: pin.owner_student_id, x_pct: pin.x_pct, y_pct: pin.y_pct, pin_type: pin.pin_type,
      title: pin.title, body: pin.body, has_photo: !!pin.image_path, video_url: pin.video_url,
      status: pin.status, published_at: pin.published_at,
      word_count: countWords(pin.body), line_count: countLines(pin.body),
      min_words: quest ? quest.min_words : 0, min_lines: quest ? quest.min_lines : 0
    };
    if (includePrivate) Object.assign(out, {
      teacher_note: pin.teacher_note, submitted_at: pin.submitted_at, reviewed_at: pin.reviewed_at,
      updated_at: pin.updated_at, points_awarded: pin.points_awarded,
      question: pin.quest_id ? getQuestion(pin.pin_id) : null,
      extra: getExtra(pin),
      attributes: pin.pin_type === 'monster' ? getAttributes(pin.pin_id) : undefined
    });
    return out;
  }

  // ── Stage 4B: student-made Guardian / Lair / Monster pieces ───────────────
  // guardian: its visitor question is "the Guardian's Test"
  // lair:     extra.dangers = four { label, x_pct, y_pct } placed on the lair photo
  // monster:  four attributes (monster_attributes), each with a counter: a god
  //           power (counter_value = god key) or a question (counter_value =
  //           JSON { prompt, options, correct_index }); extra.hero_gains = what
  //           the hero gains (the reward a visiting alliance earns)
  function getExtra(pin) { try { return JSON.parse(pin.extra || '{}') || {}; } catch (e) { return {}; } }
  function getAttributes(pinId) {
    return query('SELECT * FROM monster_attributes WHERE pin_id = ? ORDER BY sort_order, attribute_id', [pinId]).map(a => {
      let v = a.counter_value;
      if (a.counter_type === 'question') { try { v = JSON.parse(a.counter_value); } catch (e) { v = null; } }
      return { description: a.description, counter_type: a.counter_type, counter_value: v };
    });
  }
  function extraProblem(pin) {
    const ex = getExtra(pin);
    if (pin.pin_type === 'lair') {
      if (!pin.image_path) return 'Add a photo of your lair map.';
      const d = (ex.dangers || []).filter(x => x && x.label && x.label.trim() && x.x_pct !== null && x.x_pct !== undefined);
      if (d.length < 4) return `Label and place all four dangers on your lair map (${d.length} of 4 done).`;
    }
    if (pin.pin_type === 'monster') {
      const attrs = getAttributes(pin.pin_id);
      if (attrs.length < 4 || attrs.some(a => !a.description || a.description.trim().length < 3)) return 'Describe all four of your monster\'s "impossible to escape" attributes.';
      for (let i = 0; i < 4; i++) {
        const a = attrs[i];
        if (a.counter_type === 'god' && !a.counter_value) return `Attribute ${i + 1}: choose the god whose power counters it.`;
        if (a.counter_type === 'question') { const p = questionProblem(a.counter_value); if (p) return `Attribute ${i + 1}: ${p}`; }
      }
      if (countWords(ex.hero_gains) < 3) return 'Write what the hero gains by defeating your monster.';
    }
    return null;
  }
  // What a visitor sees before visiting: where it is and what it's called
  function pinTeaser(pin) {
    const quest = pin.quest_id ? getQuest(pin.quest_id) : null;
    return {
      pin_id: pin.pin_id, quest_id: pin.quest_id, quest_title: quest ? quest.title : null,
      owner_student_id: pin.owner_student_id, x_pct: pin.x_pct, y_pct: pin.y_pct, pin_type: pin.pin_type,
      title: pin.title, status: pin.status, locked: true, has_question: !!getQuestion(pin.pin_id)
    };
  }
  // Why a pin cannot be submitted yet (null = ready)
  function submitProblem(pin) {
    if (pin.x_pct === null || pin.y_pct === null) return 'Tap your map to choose where this goes.';
    if (!pin.title || !pin.title.trim()) return 'Give it a title.';
    const quest = pin.quest_id ? getQuest(pin.quest_id) : null;
    const words = countWords(pin.body), lines = countLines(pin.body);
    if (!quest) {
      if (words < 3) return 'Write a sentence explaining why this place is here (use the text).';
      return null;
    }
    if (quest.min_words && words < quest.min_words) return `Write at least ${quest.min_words} words (you have ${words}).`;
    if (quest.min_lines && lines < quest.min_lines) return `Write at least ${quest.min_lines} lines (you have ${lines}).`;
    if (!words && !pin.image_path) return 'Add your writing or a photo of your work.';
    // Lairs and monsters are faced in an encounter, not answered as a visit
    if (pin.pin_type === 'lair' || pin.pin_type === 'monster') return extraProblem(pin);
    const qp = questionProblem(getQuestion(pin.pin_id));
    if (qp && pin.pin_type === 'guardian') return qp.replace('a question for visitors about your piece', 'the Guardian\'s Test').replace('the question visitors will answer', 'the Guardian\'s Test question');
    return qp;
  }
  function photoFile(pin) {
    if (!pin.image_path) return null;
    const f = path.join(UPLOAD_DIR, path.basename(pin.image_path));
    return fs.existsSync(f) ? f : null;
  }
  function removePhotoFile(pin) {
    const f = photoFile(pin);
    if (f) { try { fs.unlinkSync(f); } catch (e) { /* ignore */ } }
  }
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

  // ── STUDENT: my island (map, quests with status, my pins) ─────────────────
  app.get('/api/island/me', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const mapRow = query('SELECT map_image FROM students WHERE student_id = ?', [me.student_id])[0];
      const pins = query('SELECT * FROM island_pins WHERE owner_student_id = ? ORDER BY pin_id', [me.student_id]);
      const pinByQuest = {};
      pins.forEach(p => { if (p.quest_id) pinByQuest[p.quest_id] = p; });
      const quests = query('SELECT * FROM island_quests WHERE active = 1 ORDER BY sort_order, quest_id')
        .filter(q => questVisibleTo(q, me))
        .map(q => {
          const unlocked = questUnlocked(q, me.student_id);
          const pin = pinByQuest[q.quest_id];
          return {
            quest_id: q.quest_id, title: q.title, age: q.age, tier: q.tier, directions: q.directions,
            images: JSON.parse(q.images || '[]'), min_words: q.min_words, min_lines: q.min_lines,
            points: q.points, pin_type: q.pin_type, unlock_myth: q.unlock_myth,
            unlocked, lock_reason: unlocked ? null : `Pass the ${q.unlock_myth} quiz to unlock this quest.`,
            pin_id: pin ? pin.pin_id : null, pin_status: pin ? pin.status : null
          };
        });
      res.json({
        student: { student_id: me.student_id, name: me.name, class_period: me.class_period },
        map_image: mapRow && mapRow.map_image ? mapRow.map_image : null,
        quests,
        pins: pins.map(p => pinOut(p, true)),
        feature_types: FEATURE_TYPES,
        monsters: monsters ? monsters.regionMonsters(me.student_id) : []
      });
    } catch (e) { console.error('island/me:', e); res.status(500).json({ error: 'Could not load your island.' }); }
  });

  // ── View an island (own, alliance-mate's, or any for the teacher) ─────────
  app.get('/api/island/view/:studentId', authenticateToken, (req, res) => {
    try {
      const ownerId = parseInt(req.params.studentId);
      const owner = getStudent(ownerId);
      if (!owner) return res.status(404).json({ error: 'Island not found' });
      const access = islandAccess(req, ownerId);
      if (!access) return res.status(403).json({ error: 'You can visit this island when your teacher opens a voyage.' });
      const seeAll = isTeacher(req) || req.user.id === ownerId;
      const pins = query(
        `SELECT * FROM island_pins WHERE owner_student_id = ? ${seeAll ? '' : "AND status = 'published'"} ORDER BY pin_id`,
        [ownerId]);
      const mapRow = query('SELECT map_image FROM students WHERE student_id = ?', [ownerId])[0];
      const regions = monsters ? monsters.regionMonsters(ownerId) : [];
      const out = pins.map(p => {
        if (access === 'full') return Object.assign(pinOut(p, seeAll), regions.length && monsters.inRegion(p, regions) ? { in_monster_region: true } : {});
        // Visitor: named places are labels anyone may read; quest work stays
        // locked until this student has visited it (and can't be visited
        // while a monster lurks near it).
        const v = myVisit(req, p.pin_id);
        if (!p.quest_id) return pinOut(p, false);
        if (v) return Object.assign(pinOut(p, false), { visit_id: v.visit_id, visit_status: v.status });
        return Object.assign(pinTeaser(p), regions.length && monsters.inRegion(p, regions) ? { blocked: true } : {});
      });
      res.json({
        owner: { student_id: owner.student_id, name: owner.name, class_period: owner.class_period },
        map_image: mapRow && mapRow.map_image ? mapRow.map_image : null,
        pins: out,
        monsters: regions,
        access,
        viewer_is_owner: req.user.id === ownerId && !isTeacher(req)
      });
    } catch (e) { console.error('island/view:', e); res.status(500).json({ error: 'Could not load that island.' }); }
  });

  // ── One pin ───────────────────────────────────────────────────────────────
  app.get('/api/island/pins/:id', authenticateToken, (req, res) => {
    try {
      const pin = getPin(parseInt(req.params.id));
      if (!pin || !canViewPin(req, pin)) return res.status(404).json({ error: 'Pin not found' });
      const priv = isTeacher(req) || req.user.id === pin.owner_student_id;
      const quest = pin.quest_id ? getQuest(pin.quest_id) : null;
      res.json({ pin: pinOut(pin, priv), quest: quest ? { title: quest.title, directions: quest.directions, points: quest.points } : null });
    } catch (e) { res.status(500).json({ error: 'Could not load that pin.' }); }
  });

  // Photo — served only through this permission check (never a public URL)
  app.get('/api/island/pins/:id/photo', authenticateToken, (req, res) => {
    try {
      const pin = getPin(parseInt(req.params.id));
      if (!pin || !canViewPin(req, pin)) return res.status(404).json({ error: 'Photo not found' });
      const f = photoFile(pin);
      if (!f) return res.status(404).json({ error: 'Photo not found' });
      res.set('Cache-Control', 'private, max-age=300');
      res.sendFile(f);
    } catch (e) { res.status(500).json({ error: 'Could not load the photo.' }); }
  });

  // ── Create a pin (quest pin or named map feature), as a draft ─────────────
  app.post('/api/island/pins', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const { quest_id, feature_type } = req.body || {};
      const x = req.body && req.body.x_pct !== undefined ? cleanPct(req.body.x_pct) : null;
      const y = req.body && req.body.y_pct !== undefined ? cleanPct(req.body.y_pct) : null;
      let pinType, qid = null;
      if (quest_id) {
        const quest = getQuest(parseInt(quest_id));
        if (!questVisibleTo(quest, me)) return res.status(404).json({ error: 'Quest not found.' });
        if (!questUnlocked(quest, me.student_id)) return res.status(403).json({ error: `Pass the ${quest.unlock_myth} quiz to unlock this quest.` });
        const existing = query('SELECT pin_id FROM island_pins WHERE owner_student_id = ? AND quest_id = ?', [me.student_id, quest.quest_id])[0];
        if (existing) return res.json({ pin: pinOut(getPin(existing.pin_id), true), existing: true });
        pinType = quest.pin_type; qid = quest.quest_id;
      } else if (FEATURE_TYPES.includes(feature_type)) {
        const n = query('SELECT COUNT(*) AS n FROM island_pins WHERE owner_student_id = ? AND quest_id IS NULL', [me.student_id])[0].n;
        if (n >= MAX_FEATURES) return res.status(400).json({ error: `You can name up to ${MAX_FEATURES} places.` });
        pinType = feature_type;
      } else {
        return res.status(400).json({ error: 'Choose a quest or a kind of place (river, mountain, city).' });
      }
      run(`INSERT INTO island_pins (quest_id, owner_student_id, author_student_id, alliance_id, class_period, x_pct, y_pct, pin_type, status)
           VALUES (?,?,?,?,?,?,?,?,'draft')`,
        [qid, me.student_id, me.student_id, me.alliance_id || null, me.class_period, x, y, pinType]);
      const id = query('SELECT last_insert_rowid() AS id')[0].id;
      res.json({ pin: pinOut(getPin(id), true) });
    } catch (e) { console.error('island create pin:', e); res.status(500).json({ error: 'Could not start that pin. Try again.' }); }
  });

  // ── Autosave edits (owner only, draft/returned only) ──────────────────────
  app.patch('/api/island/pins/:id', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const pin = getPin(parseInt(req.params.id));
      if (!pin || pin.owner_student_id !== me.student_id) return res.status(404).json({ error: 'Pin not found' });
      if (!EDITABLE.includes(pin.status)) {
        return res.status(409).json({ error: pin.status === 'submitted' ? 'This is waiting for teacher approval, so it can\'t be changed right now.' : 'This is already published.' });
      }
      const b = req.body || {};
      const sets = [], vals = [];
      if (b.title !== undefined) { sets.push('title=?'); vals.push(cleanText(b.title, MAX_TITLE)); }
      if (b.body !== undefined) { sets.push('body=?'); vals.push(cleanText(b.body, MAX_BODY)); }
      if (b.x_pct !== undefined) { const v = cleanPct(b.x_pct); if (v === null) return res.status(400).json({ error: 'Bad position' }); sets.push('x_pct=?'); vals.push(v); }
      if (b.y_pct !== undefined) { const v = cleanPct(b.y_pct); if (v === null) return res.status(400).json({ error: 'Bad position' }); sets.push('y_pct=?'); vals.push(v); }
      if (b.video_url !== undefined) {
        const v = cleanVideoUrl(b.video_url);
        if (v === undefined) return res.status(400).json({ error: 'The video link must start with https:// (for example a YouTube or Google Drive link).' });
        sets.push('video_url=?'); vals.push(v);
      }
      if (!sets.length) return res.json({ pin: pinOut(pin, true) });
      run(`UPDATE island_pins SET ${sets.join(', ')}, updated_at=CURRENT_TIMESTAMP WHERE pin_id=?`, [...vals, pin.pin_id]);
      res.json({ pin: pinOut(getPin(pin.pin_id), true) });
    } catch (e) { console.error('island save pin:', e); res.status(500).json({ error: 'Could not save. Your text is still on screen — try again in a moment.' }); }
  });

  // ── Photo upload (owner only, draft/returned). The browser shrinks it first.
  app.post('/api/island/pins/:id/photo', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const pin = getPin(parseInt(req.params.id));
      if (!pin || pin.owner_student_id !== me.student_id) return res.status(404).json({ error: 'Pin not found' });
      if (!EDITABLE.includes(pin.status)) return res.status(409).json({ error: 'This can\'t be changed right now.' });
      const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec((req.body && req.body.image_data) || '');
      if (!m) return res.status(400).json({ error: 'That file isn\'t a photo. Use a JPG or PNG picture.' });
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > MAX_PHOTO_BYTES) return res.status(413).json({ error: 'That photo is too large. Try a smaller picture.' });
      const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
      const isPng = buf.slice(0, 4).toString('hex') === '89504e47';
      const isWebp = buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP';
      if (!(isJpeg || isPng || isWebp)) return res.status(400).json({ error: 'That file isn\'t a photo. Use a JPG or PNG picture.' });
      const ext = isJpeg ? 'jpg' : isPng ? 'png' : 'webp';
      const name = `pin-${pin.pin_id}-${Date.now()}.${ext}`;
      fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
      removePhotoFile(pin);  // replace the old draft photo
      run('UPDATE island_pins SET image_path=?, updated_at=CURRENT_TIMESTAMP WHERE pin_id=?', [name, pin.pin_id]);
      res.json({ pin: pinOut(getPin(pin.pin_id), true) });
    } catch (e) { console.error('island photo:', e); res.status(500).json({ error: 'The photo didn\'t upload. Try again.' }); }
  });

  app.delete('/api/island/pins/:id/photo', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const pin = getPin(parseInt(req.params.id));
      if (!pin || pin.owner_student_id !== me.student_id) return res.status(404).json({ error: 'Pin not found' });
      if (!EDITABLE.includes(pin.status)) return res.status(409).json({ error: 'This can\'t be changed right now.' });
      removePhotoFile(pin);
      run('UPDATE island_pins SET image_path=NULL, updated_at=CURRENT_TIMESTAMP WHERE pin_id=?', [pin.pin_id]);
      res.json({ pin: pinOut(getPin(pin.pin_id), true) });
    } catch (e) { res.status(500).json({ error: 'Could not remove the photo.' }); }
  });

  // ── The question visitors answer (quest pins; draft/returned only) ────────
  app.put('/api/island/pins/:id/question', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const pin = getPin(parseInt(req.params.id));
      if (!pin || pin.owner_student_id !== me.student_id) return res.status(404).json({ error: 'Pin not found' });
      if (!pin.quest_id) return res.status(400).json({ error: 'Named places don\'t need a question.' });
      if (!EDITABLE.includes(pin.status)) return res.status(409).json({ error: 'This can\'t be changed right now.' });
      const b = req.body || {};
      const prompt = cleanText(b.prompt, 300);
      const options = (Array.isArray(b.options) ? b.options : []).slice(0, 4).map(o => cleanText(o, 150));
      while (options.length < 2) options.push('');
      // -1 = the student hasn't marked a correct answer yet (submit will ask for it)
      let ci = parseInt(b.correct_index);
      if (!Number.isInteger(ci) || ci < 0 || ci >= options.length) ci = -1;
      run(`INSERT INTO pin_questions (pin_id, prompt, options, correct_index) VALUES (?,?,?,?)
           ON CONFLICT(pin_id) DO UPDATE SET prompt=excluded.prompt, options=excluded.options,
           correct_index=excluded.correct_index, updated_at=CURRENT_TIMESTAMP`,
        [pin.pin_id, prompt, JSON.stringify(options), ci]);
      run('UPDATE island_pins SET updated_at=CURRENT_TIMESTAMP WHERE pin_id=?', [pin.pin_id]);
      res.json({ question: getQuestion(pin.pin_id), problem: questionProblem(getQuestion(pin.pin_id)) });
    } catch (e) { console.error('island question:', e); res.status(500).json({ error: 'Could not save the question. Try again.' }); }
  });

  // Lair dangers / the hero's reward (lair and monster pieces)
  app.put('/api/island/pins/:id/extra', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const pin = getPin(parseInt(req.params.id));
      if (!pin || pin.owner_student_id !== me.student_id) return res.status(404).json({ error: 'Pin not found' });
      if (!['lair', 'monster'].includes(pin.pin_type)) return res.status(400).json({ error: 'Only lairs and monsters have these.' });
      if (!EDITABLE.includes(pin.status)) return res.status(409).json({ error: 'This can\'t be changed right now.' });
      const b = req.body || {}, ex = getExtra(pin);
      if (pin.pin_type === 'lair' && Array.isArray(b.dangers)) {
        ex.dangers = b.dangers.slice(0, 4).map(d => ({ label: cleanText(d && d.label, 80),
          x_pct: d && d.x_pct !== null && d.x_pct !== undefined ? cleanPct(d.x_pct) : null, y_pct: d && d.y_pct !== null && d.y_pct !== undefined ? cleanPct(d.y_pct) : null }));
      }
      if (pin.pin_type === 'monster' && b.hero_gains !== undefined) ex.hero_gains = cleanText(b.hero_gains, 500);
      run('UPDATE island_pins SET extra = ?, updated_at = CURRENT_TIMESTAMP WHERE pin_id = ?', [JSON.stringify(ex), pin.pin_id]);
      res.json({ extra: ex, problem: extraProblem(getPin(pin.pin_id)) });
    } catch (e) { console.error('island extra:', e); res.status(500).json({ error: 'Could not save. Try again.' }); }
  });
  // A monster's four attributes and their counters
  app.put('/api/island/pins/:id/attributes', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const pin = getPin(parseInt(req.params.id));
      if (!pin || pin.owner_student_id !== me.student_id) return res.status(404).json({ error: 'Pin not found' });
      if (pin.pin_type !== 'monster') return res.status(400).json({ error: 'Only monsters have attributes.' });
      if (!EDITABLE.includes(pin.status)) return res.status(409).json({ error: 'This can\'t be changed right now.' });
      const list = (Array.isArray((req.body || {}).attributes) ? req.body.attributes : []).slice(0, 4);
      run('DELETE FROM monster_attributes WHERE pin_id = ?', [pin.pin_id]);
      list.forEach((a, i) => {
        const type = a && a.counter_type === 'god' ? 'god' : 'question';
        let value = '';
        if (type === 'god') value = typeof a.counter_value === 'string' && monsters && monsters.god(a.counter_value) ? a.counter_value : '';
        else {
          const q = (a && a.counter_value) || {};
          const options = (Array.isArray(q.options) ? q.options : []).slice(0, 4).map(o => cleanText(o, 150));
          let ci = parseInt(q.correct_index); if (!Number.isInteger(ci) || ci < 0 || ci >= options.length) ci = -1;
          value = JSON.stringify({ prompt: cleanText(q.prompt, 300), options, correct_index: ci });
        }
        run(`INSERT INTO monster_attributes (pin_id, sort_order, description, counter_type, counter_value) VALUES (?,?,?,?,?)`,
          [pin.pin_id, i, cleanText(a && a.description, 300), type, value]);
      });
      run('UPDATE island_pins SET updated_at = CURRENT_TIMESTAMP WHERE pin_id = ?', [pin.pin_id]);
      res.json({ attributes: getAttributes(pin.pin_id), problem: extraProblem(getPin(pin.pin_id)) });
    } catch (e) { console.error('island attributes:', e); res.status(500).json({ error: 'Could not save. Try again.' }); }
  });

  // ── Submit for approval ───────────────────────────────────────────────────
  app.post('/api/island/pins/:id/submit', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const pin = getPin(parseInt(req.params.id));
      if (!pin || pin.owner_student_id !== me.student_id) return res.status(404).json({ error: 'Pin not found' });
      if (pin.status === 'submitted') return res.json({ pin: pinOut(pin, true), already: true });
      if (!EDITABLE.includes(pin.status)) return res.status(409).json({ error: 'This is already published.' });
      const problem = submitProblem(pin);
      if (problem) return res.status(400).json({ error: problem });
      run(`UPDATE island_pins SET status='submitted', submitted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE pin_id=?`, [pin.pin_id]);
      res.json({ pin: pinOut(getPin(pin.pin_id), true) });
    } catch (e) { console.error('island submit:', e); res.status(500).json({ error: 'Could not submit. Try again.' }); }
  });

  // ── Delete a draft that was never submitted ───────────────────────────────
  app.delete('/api/island/pins/:id', authenticateToken, (req, res) => {
    try {
      const me = studentOnly(req, res); if (!me) return;
      const pin = getPin(parseInt(req.params.id));
      if (!pin || pin.owner_student_id !== me.student_id) return res.status(404).json({ error: 'Pin not found' });
      if (pin.status !== 'draft' || pin.submitted_at) return res.status(409).json({ error: 'Only a draft that was never submitted can be removed.' });
      removePhotoFile(pin);
      run('DELETE FROM island_pins WHERE pin_id=?', [pin.pin_id]);
      res.json({ deleted: true });
    } catch (e) { res.status(500).json({ error: 'Could not remove that draft.' }); }
  });

  // ── TEACHER: approval queue ───────────────────────────────────────────────
  app.get('/api/teacher/island/queue', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    try {
      const period = req.query.period || null;
      const rows = query(
        `SELECT p.*, s.name AS student_name, a.alliance_name
         FROM island_pins p
         JOIN students s ON s.student_id = p.owner_student_id
         LEFT JOIN alliances a ON a.alliance_id = s.alliance_id
         WHERE p.status = 'submitted' ${period ? 'AND p.class_period = ?' : ''}
         ORDER BY p.submitted_at, p.pin_id`, period ? [period] : []);
      res.json({
        pins: rows.map(r => Object.assign(pinOut(r, true), {
          student_name: r.student_name, alliance_name: r.alliance_name, class_period: r.class_period,
          quest_points: r.quest_id ? (getQuest(r.quest_id) || {}).points || 0 : 0,
          submit_problem: submitProblem(r)
        }))
      });
    } catch (e) { console.error('island queue:', e); res.status(500).json({ error: 'Could not load the queue.' }); }
  });

  // approve → published (+ quest points to the alliance, once); return → back to the student with a note
  app.post('/api/teacher/island/pins/:id/review', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    try {
      const pin = getPin(parseInt(req.params.id));
      if (!pin) return res.status(404).json({ error: 'Pin not found' });
      const { action } = req.body || {};
      const note = cleanText((req.body || {}).note, 1000).trim();
      if (action === 'approve') {
        if (pin.status === 'published') return res.json({ pin: pinOut(pin, true), already: true });
        let award = 0;
        const quest = pin.quest_id ? getQuest(pin.quest_id) : null;
        const owner = getStudent(pin.owner_student_id);
        const allianceId = owner && owner.alliance_id;   // the alliance the student is in NOW
        if (quest && quest.points > 0 && !pin.points_awarded && allianceId) {
          award = quest.points;
          run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', [award, allianceId]);
          run(`INSERT INTO point_transactions (alliance_id, student_id, amount, category, reason, teacher_id)
               VALUES (?,?,?,?,?,?)`,
            [allianceId, pin.owner_student_id, award, 'island_quest', `Island quest approved: ${quest.title}`, req.user.id]);
        }
        // Voyage tokens for the alliance (Stage 2): once per published quest piece
        let tokens = 0;
        if (quest && !pin.tokens_awarded && allianceId) {
          tokens = voyage.getSettings(owner.class_period).tokens_per_publish;
          if (tokens > 0) voyage.addTokens(allianceId, tokens);
        }
        run(`UPDATE island_pins SET status='published', teacher_note=?, reviewed_at=CURRENT_TIMESTAMP,
             published_at=COALESCE(published_at, CURRENT_TIMESTAMP), points_awarded=points_awarded+?,
             tokens_awarded=tokens_awarded+?, updated_at=CURRENT_TIMESTAMP
             WHERE pin_id=?`, [note || null, award, tokens, pin.pin_id]);
        return res.json({ pin: pinOut(getPin(pin.pin_id), true), points_awarded: award, tokens_awarded: tokens });
      }
      if (action === 'return') {
        if (!note) return res.status(400).json({ error: 'Add a note telling the student what to change.' });
        if (pin.status === 'published') return res.status(409).json({ error: 'This pin is already published.' });
        run(`UPDATE island_pins SET status='returned', teacher_note=?, reviewed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
             WHERE pin_id=?`, [note, pin.pin_id]);
        return res.json({ pin: pinOut(getPin(pin.pin_id), true) });
      }
      res.status(400).json({ error: 'action must be approve or return' });
    } catch (e) { console.error('island review:', e); res.status(500).json({ error: 'Could not save the review.' }); }
  });

  // Students in a period with their pin counts — to open any island
  app.get('/api/teacher/island/students', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    try {
      const period = req.query.period || null;
      const rows = query(
        `SELECT s.student_id, s.name, s.class_period, a.alliance_name,
                CASE WHEN s.map_image IS NOT NULL AND s.map_image != '' THEN 1 ELSE 0 END AS has_map,
                (SELECT CASE WHEN t.reviewed = 1 AND (t.map_uploaded_at IS s.map_uploaded_at) THEN 1 ELSE 0 END FROM island_terrain t WHERE t.student_id = s.student_id) AS terrain_ok,
                SUM(CASE WHEN p.status='published' THEN 1 ELSE 0 END) AS published,
                SUM(CASE WHEN p.status='submitted' THEN 1 ELSE 0 END) AS submitted,
                SUM(CASE WHEN p.status='returned' THEN 1 ELSE 0 END) AS returned,
                SUM(CASE WHEN p.status='draft' THEN 1 ELSE 0 END) AS drafts
         FROM students s
         LEFT JOIN alliances a ON a.alliance_id = s.alliance_id
         LEFT JOIN island_pins p ON p.owner_student_id = s.student_id
         WHERE (s.is_ghost = 0 OR s.is_ghost IS NULL) ${period ? 'AND s.class_period = ?' : ''}
         GROUP BY s.student_id ORDER BY s.class_period, a.alliance_name, s.name`, period ? [period] : []);
      const periods = query(`SELECT DISTINCT class_period FROM students WHERE class_period IS NOT NULL ORDER BY class_period`).map(r => r.class_period);
      res.json({ students: rows, periods });
    } catch (e) { console.error('island students:', e); res.status(500).json({ error: 'Could not load students.' }); }
  });

  // Test-period reset (real periods are never wiped: nothing a student made is destroyed)
  app.post('/api/teacher/island/reset-test', authenticateToken, (req, res) => {
    if (!teacherOnly(req, res)) return;
    try {
      if ((req.body || {}).confirm_period !== TEST_PERIOD) return res.status(400).json({ error: `confirm_period must be "${TEST_PERIOD}"` });
      const pins = query('SELECT * FROM island_pins WHERE class_period = ?', [TEST_PERIOD]);
      pins.forEach(removePhotoFile);
      run(`DELETE FROM island_visits WHERE class_period = ? OR pin_id IN (SELECT pin_id FROM island_pins WHERE class_period = ?)`, [TEST_PERIOD, TEST_PERIOD]);
      run(`DELETE FROM pin_questions WHERE pin_id IN (SELECT pin_id FROM island_pins WHERE class_period = ?)`, [TEST_PERIOD]);
      run(`DELETE FROM monster_attributes WHERE pin_id IN (SELECT pin_id FROM island_pins WHERE class_period = ?)`, [TEST_PERIOD]);
      run(`DELETE FROM monster_encounters WHERE class_period = ?`, [TEST_PERIOD]);
      run(`DELETE FROM pin_games WHERE pin_id IN (SELECT pin_id FROM island_pins WHERE class_period = ?)`, [TEST_PERIOD]);
      run(`DELETE FROM game_ai_drafts WHERE class_period = ?`, [TEST_PERIOD]);
      run('DELETE FROM island_pins WHERE class_period = ?', [TEST_PERIOD]);
      // Everything else the islands build stores for Test-period students and
      // alliances. Shared content (quests, Oracle trials, logic puzzles) stays.
      const STU = `(SELECT student_id FROM students WHERE class_period = ?)`, ALL = `(SELECT alliance_id FROM alliances WHERE class_period = ?)`;
      const cleared = {};
      const del = (table, where, params) => { const n = query(`SELECT COUNT(*) AS n FROM ${table} WHERE ${where}`, params)[0].n; run(`DELETE FROM ${table} WHERE ${where}`, params); cleared[table] = n; };
      del('voyage_tokens', `alliance_id IN ${ALL}`, [TEST_PERIOD]);
      del('voyage_settings', 'class_period = ?', [TEST_PERIOD]);            // back to defaults (build phase)
      del('monster_battles', `alliance_id IN ${ALL} OR island_monster_id IN (SELECT island_monster_id FROM island_monsters WHERE alliance_id IN ${ALL})`, [TEST_PERIOD, TEST_PERIOD]);
      del('island_monsters', `alliance_id IN ${ALL}`, [TEST_PERIOD]);
      del('god_powers', `student_id IN ${STU}`, [TEST_PERIOD]);
      del('island_terrain', `student_id IN ${STU}`, [TEST_PERIOD]);
      del('oracle_attempts', `class_period = ? OR student_id IN ${STU}`, [TEST_PERIOD, TEST_PERIOD]);
      del('logic_attempts', `student_id IN ${STU} OR alliance_id IN ${ALL}`, [TEST_PERIOD, TEST_PERIOD]);
      del('challenge_assignments', 'class_period = ?', [TEST_PERIOD]);
      del('student_accommodations', `student_id IN ${STU}`, [TEST_PERIOD]);
      del('ai_helper_settings', 'class_period = ?', [TEST_PERIOD]);          // AI helper back to off
      res.json({ reset: true, pins_removed: pins.length, cleared });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Called by server.js once the database is ready; the rest is shared with routes/voyage.js
  return { loadQuestFile, getPin, getQuest, getStudent, getQuestion, pinOut, islandAccess, myVisit, countWords, getExtra, getAttributes, photoFile };
};

module.exports.countWords = countWords;
module.exports.countLines = countLines;
