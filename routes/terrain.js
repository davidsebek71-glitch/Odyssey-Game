// ============================================================================
// TERRAIN — Stage 5: terrain read from the color key on a student's map
// ----------------------------------------------------------------------------
// The browser (public/terrain.html) does the reading: the student taps a spot
// of each terrain color on their own map (their color key), the page averages
// the map into a 64 x 48 grid and gives each cell the nearest key color. The
// student MUST check and repaint mistakes before saving ("I checked it"),
// because detection on marker drawings is never perfect.
//
// Stored per student: grid = 3072 characters, row by row (w water, f forest,
// m mountain, l land). If the student uploads a new map afterwards, the saved
// terrain is reported as stale until they redo it.
//
// Used by: monster placement (routes/monsters.js puts a region monster on its
// own kind of terrain) and, in Stage 6, walking the island.
// ============================================================================
const COLS = 64, ROWS = 48;
const SHIPS = ['Transport Ship', 'Fishing Ship'];   // Stage 6: either lets a walker sail
const TERRAINS = { w: 'water', f: 'forest', m: 'mountain', l: 'land' };
const HEX = /^#[0-9a-f]{6}$/i;

module.exports = function registerTerrainRoutes(app, deps) {
  const { authenticateToken, query, run, island, monsters } = deps;

  // Stage 6: can this viewer's alliance sail? (a ship a monster has seized doesn't count)
  function walkerFor(req) {
    if (isTeacher(req)) return { has_ship: true, ship: 'Teacher view' };
    const me = query('SELECT alliance_id FROM students WHERE student_id = ?', [req.user.id])[0];
    const a = me && me.alliance_id && query('SELECT buildings_owned FROM alliances WHERE alliance_id = ?', [me.alliance_id])[0];
    let owned = []; try { owned = JSON.parse((a && a.buildings_owned) || '[]'); } catch (e) {}
    const seized = monsters ? monsters.blockedBuildings(me && me.alliance_id) : [];
    const ship = SHIPS.find(s => owned.includes(s) && !seized.includes(s));
    const seizedShip = SHIPS.find(s => owned.includes(s) && seized.includes(s));
    return { has_ship: !!ship, ship: ship || null, ship_seized: !ship && !!seizedShip };
  }
  const isTeacher = req => req.user && req.user.type === 'teacher';

  function terrainFor(studentId) {
    const t = query('SELECT * FROM island_terrain WHERE student_id = ?', [studentId])[0];
    if (!t) return null;
    const s = query('SELECT map_uploaded_at FROM students WHERE student_id = ?', [studentId])[0] || {};
    const stale = !!(s.map_uploaded_at && t.map_uploaded_at && s.map_uploaded_at !== t.map_uploaded_at);
    let key = {}; try { key = JSON.parse(t.color_key || '{}'); } catch (e) {}
    return { grid: t.grid, cols: COLS, rows: ROWS, color_key: key, reviewed: !!t.reviewed && !stale, stale, updated_at: t.updated_at };
  }
  // Cells of one terrain kind, as % positions of the cell centers (for placement)
  function cellsOf(studentId, kind) {
    const t = terrainFor(studentId);
    if (!t || !t.reviewed) return [];
    const code = Object.keys(TERRAINS).find(k => TERRAINS[k] === kind);
    const out = [];
    for (let i = 0; i < t.grid.length; i++) if (t.grid[i] === code) out.push({ x_pct: ((i % COLS) + 0.5) / COLS * 100, y_pct: (Math.floor(i / COLS) + 0.5) / ROWS * 100 });
    return out;
  }

  app.get('/api/terrain/:studentId', authenticateToken, (req, res) => {
    const id = req.params.studentId === 'me' ? req.user.id : parseInt(req.params.studentId);
    if (req.params.studentId === 'me' && req.user.type !== 'student') return res.status(403).json({ error: 'Students only' });
    if (!isTeacher(req) && req.user.id !== id && !island.islandAccess(req, id)) return res.status(403).json({ error: 'You can\'t see that island.' });
    res.json({ terrain: terrainFor(id), cols: COLS, rows: ROWS, kinds: TERRAINS, walker: walkerFor(req) });
  });

  // Save the checked grid. reviewed must be true: the student confirms they
  // looked it over and fixed mistakes.
  app.put('/api/terrain/me', authenticateToken, (req, res) => {
    if (req.user.type !== 'student') return res.status(403).json({ error: 'Students only' });
    const b = req.body || {};
    if (typeof b.grid !== 'string' || b.grid.length !== COLS * ROWS || /[^wfml]/.test(b.grid)) return res.status(400).json({ error: 'The terrain grid is not valid.' });
    if (b.reviewed !== true) return res.status(400).json({ error: 'Check the terrain against your map and fix any mistakes before saving.' });
    const key = {};
    for (const k of Object.values(TERRAINS)) if (b.color_key && HEX.test(b.color_key[k] || '')) key[k] = b.color_key[k].toLowerCase();
    const s = query('SELECT map_uploaded_at, map_image FROM students WHERE student_id = ?', [req.user.id])[0];
    if (!s || !s.map_image) return res.status(400).json({ error: 'Upload your island map first.' });
    run(`INSERT INTO island_terrain (student_id, grid, color_key, reviewed, map_uploaded_at) VALUES (?,?,?,1,?)
         ON CONFLICT(student_id) DO UPDATE SET grid = excluded.grid, color_key = excluded.color_key, reviewed = 1,
         map_uploaded_at = excluded.map_uploaded_at, updated_at = CURRENT_TIMESTAMP`, [req.user.id, b.grid, JSON.stringify(key), s.map_uploaded_at]);
    res.json({ terrain: terrainFor(req.user.id) });
  });

  return { terrainFor, cellsOf, COLS, ROWS };
};
