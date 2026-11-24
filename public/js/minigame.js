// ============================================================================
// MINI GAME ENGINE — Stage 7 (one file, used by the browser AND the server)
// ----------------------------------------------------------------------------
// A mini game is DATA, never code. This engine is the only thing that runs it.
//
// Room: COLS x ROWS tiles. The reader (the hero) starts at game.start {x, y}.
// Things: { id, name, emoji, type, x, y, hidden, question? }
//   type: item       — stepping on it picks it up (it leaves the room)
//         character  — solid; bumping into it means "talks to"; may ask a
//                      question { prompt, options[], correct_index }
//         obstacle   — solid (a gate, a wall, a boulder)
//         place      — the reader can step onto it ("enters")
//   hidden: starts out of sight until a rule makes it appear
// Rules: { when: { event, thing, answer? }, if?: { carrying, not? }, then: { do, thing?, text?, x?, y? } }
//   events:  touches | picks_up | enters | talks_to | answers (answer: 'correct' | 'wrong')
//   if:      the reader is carrying (or, with not: true, is NOT carrying) an item
//   then.do: survive | perish | message | open_path | appear | vanish | move
// There is no timer trigger. Losing just returns the reader to the story.
// ============================================================================
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MiniGame = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const COLS = 12, ROWS = 8;
  const TYPES = ['item', 'character', 'obstacle', 'place'];
  const EVENTS = ['touches', 'picks_up', 'enters', 'talks_to', 'answers'];
  const RESULTS = ['survive', 'perish', 'message', 'open_path', 'appear', 'vanish', 'move'];
  const EMOJI = ['🗝️', '🚪', '🧱', '🪨', '🔥', '🌊', '🕳️', '🏛️', '⛩️', '🗿', '🐍', '🐉', '🦁', '🐂', '🦉', '🧙', '👸', '🤴', '👻', '💀',
    '🗡️', '🛡️', '🏺', '📜', '💎', '🍎', '🌿', '🕯️', '🪔', '🧵', '🪞', '🎶', '⭐', '🌀', '⚓', '🚩', '🌳', '⛰️', '🌉', '🪜'];
  const SOLID = { character: true, obstacle: true };

  // ── Play state ────────────────────────────────────────────────────────────
  function newState(game) {
    const things = {};
    (game.things || []).forEach(t => { things[t.id] = { x: t.x, y: t.y, visible: !t.hidden }; });
    return { px: game.start.x, py: game.start.y, carrying: [], things, over: null, messages: [], asking: null };
  }
  const thingDef = (game, id) => (game.things || []).find(t => t.id === id);
  function thingAt(game, st, x, y) {
    return (game.things || []).find(t => st.things[t.id] && st.things[t.id].visible && st.things[t.id].x === x && st.things[t.id].y === y) || null;
  }
  // Fire every rule that matches this event (in order) until the game ends
  function fire(game, st, event, thingId, answer) {
    for (const r of game.rules || []) {
      if (st.over) break;
      const w = r.when || {};
      if (w.event !== event || w.thing !== thingId) continue;
      if (event === 'answers' && w.answer && w.answer !== answer) continue;
      if (r.if && r.if.carrying) {
        const has = st.carrying.includes(r.if.carrying);
        if (r.if.not ? has : !has) continue;
      }
      const t = r.then || {};
      if (t.do === 'survive' || t.do === 'perish') st.over = t.do;
      else if (t.do === 'message') st.messages.push(String(t.text || ''));
      else if ((t.do === 'open_path' || t.do === 'vanish') && st.things[t.thing]) st.things[t.thing].visible = false;
      else if (t.do === 'appear' && st.things[t.thing]) st.things[t.thing].visible = true;
      else if (t.do === 'move' && inRoom(t.x, t.y)) { st.px = t.x; st.py = t.y; }
    }
  }
  const inRoom = (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < COLS && y < ROWS;

  // The reader tries to step by (dx, dy). Returns the new state (a copy).
  function step(game, state, dx, dy) {
    const st = clone(state);
    st.messages = []; st.asking = null;
    if (st.over) return st;
    const nx = st.px + dx, ny = st.py + dy;
    if (!inRoom(nx, ny)) return st;
    const t = thingAt(game, st, nx, ny);
    if (t && SOLID[t.type]) {
      fire(game, st, 'touches', t.id);
      if (t.type === 'character' && !st.over) {
        fire(game, st, 'talks_to', t.id);
        if (t.question && !st.over) st.asking = t.id;
      }
      return st;
    }
    st.px = nx; st.py = ny;
    if (t && t.type === 'item') {
      st.carrying.push(t.id); st.things[t.id].visible = false;
      fire(game, st, 'picks_up', t.id);
    } else if (t && t.type === 'place') {
      fire(game, st, 'enters', t.id);
    } else if (t) fire(game, st, 'touches', t.id);
    return st;
  }
  // The reader answers the question a character asked
  function answer(game, state, charId, optionIndex) {
    const st = clone(state);
    st.messages = []; st.asking = null;
    const c = thingDef(game, charId);
    if (!c || !c.question || st.over) return st;
    fire(game, st, 'answers', charId, optionIndex === c.question.correct_index ? 'correct' : 'wrong');
    return st;
  }
  function clone(s) { return { px: s.px, py: s.py, carrying: s.carrying.slice(), things: JSON.parse(JSON.stringify(s.things)), over: s.over, messages: s.messages.slice(), asking: s.asking }; }

  // ── Checking a game (the builder and the server both use this) ───────────
  function problems(game, limits) {
    const out = [];
    const things = game.things || [], rules = game.rules || [];
    if (!game.start || !inRoom(game.start.x, game.start.y)) out.push('Choose where the reader starts.');
    if (things.length > (limits.maxThings || 12)) out.push(`Use at most ${limits.maxThings || 12} things.`);
    if (rules.length > limits.maxRules) out.push(`Use at most ${limits.maxRules} rules at this level.`);
    const ids = new Set();
    things.forEach((t, i) => {
      if (!t.id || ids.has(t.id)) out.push(`Thing ${i + 1} needs its own id.`); ids.add(t.id);
      if (!t.name || !String(t.name).trim()) out.push(`Thing ${i + 1} needs a name.`);
      if (!TYPES.includes(t.type)) out.push(`${t.name || 'A thing'}: choose what kind of thing it is.`);
      if (!inRoom(t.x, t.y)) out.push(`${t.name || 'A thing'}: place it in the room.`);
      else if (game.start && t.x === game.start.x && t.y === game.start.y && !t.hidden) out.push(`${t.name}: it sits where the reader starts. Move it.`);
      if (t.question) {
        const q = t.question, opts = (q.options || []).filter(o => String(o || '').trim());
        if (t.type !== 'character') out.push(`${t.name}: only characters can ask questions.`);
        else if (!q.prompt || !String(q.prompt).trim() || opts.length < 2) out.push(`${t.name}: write the question and at least two answers.`);
        else if (!Number.isInteger(q.correct_index) || !String((q.options || [])[q.correct_index] || '').trim()) out.push(`${t.name}: mark the right answer.`);
      }
    });
    const seen = {};
    things.forEach(t => { if (t.hidden) return; const k = `${t.x},${t.y}`; if (seen[k]) out.push(`${seen[k]} and ${t.name} are on the same square.`); seen[k] = t.name; });
    rules.forEach((r, i) => {
      const n = `Rule ${i + 1}`, w = r.when || {}, t = r.then || {};
      if (!EVENTS.includes(w.event)) out.push(`${n}: choose WHEN.`);
      const wt = thingDef(game, w.thing);
      if (!wt) out.push(`${n}: choose the thing the WHEN is about.`);
      else {
        if (w.event === 'picks_up' && wt.type !== 'item') out.push(`${n}: only items can be picked up.`);
        if (w.event === 'enters' && wt.type !== 'place') out.push(`${n}: only places can be entered.`);
        if ((w.event === 'talks_to' || w.event === 'answers') && wt.type !== 'character') out.push(`${n}: only characters can be talked to.`);
        if (w.event === 'answers' && !wt.question) out.push(`${n}: ${wt.name} doesn't ask a question.`);
        if (w.event === 'answers' && !['correct', 'wrong'].includes(w.answer)) out.push(`${n}: choose a right or wrong answer.`);
      }
      if (r.if && r.if.carrying) { const it = thingDef(game, r.if.carrying); if (!it || it.type !== 'item') out.push(`${n}: "carrying" must name an item.`); }
      if (!RESULTS.includes(t.do)) out.push(`${n}: choose THEN.`);
      if (['open_path', 'appear', 'vanish'].includes(t.do) && !thingDef(game, t.thing)) out.push(`${n}: choose the thing for THEN.`);
      if (t.do === 'message' && !String(t.text || '').trim()) out.push(`${n}: write the message.`);
      if (t.do === 'move' && !inRoom(t.x, t.y)) out.push(`${n}: choose where the reader is moved.`);
    });
    if (!rules.some(r => r.then && r.then.do === 'survive')) out.push('Add a rule that lets the reader survive.');
    return out;
  }

  // Search every way the reader could play (moves and answers). Finds whether
  // the reader can survive, and the shortest winning moves if so.
  function findWin(game, maxStates = 40000) {
    const start = newState(game);
    const key = s => `${s.px},${s.py}|${s.carrying.slice().sort().join(',')}|${Object.keys(s.things).sort().map(k => s.things[k].visible ? 1 : 0).join('')}|${s.asking || ''}`;
    const seen = new Set([key(start)]);
    const queue = [{ s: start, moves: [] }];
    let perishSeen = false, explored = 0;
    while (queue.length && explored < maxStates) {
      const { s, moves } = queue.shift(); explored++;
      const next = [];
      [[0, -1, 'up'], [0, 1, 'down'], [-1, 0, 'left'], [1, 0, 'right']].forEach(([dx, dy, name]) => next.push([step(game, s, dx, dy), name]));
      if (s.asking) { const c = thingDef(game, s.asking); c.question.options.forEach((o, i) => { if (String(o || '').trim()) next.push([answer(game, s, s.asking, i), `answer ${i + 1}`]); }); }
      for (const [n, name] of next) {
        if (n.over === 'survive') return { canWin: true, moves: moves.concat(name), explored };
        if (n.over === 'perish') { perishSeen = true; continue; }
        const k = key(n);
        if (seen.has(k)) continue;
        seen.add(k); queue.push({ s: n, moves: moves.concat(name) });
      }
    }
    return { canWin: false, explored, perishSeen, gaveUp: explored >= maxStates };
  }

  function check(game, limits) {
    const p = problems(game, limits);
    if (p.length) return { ok: false, problems: p };
    const w = findWin(game);
    if (!w.canWin) return { ok: false, problems: [w.gaveUp ? 'This game is too big to check. Use fewer things or rules.' : 'No one can survive this game yet: there is no way to reach a "survive" rule. Check your rules.'] };
    return { ok: true, problems: [], winning_moves: w.moves.length };
  }

  return { COLS, ROWS, TYPES, EVENTS, RESULTS, EMOJI, newState, step, answer, thingAt, problems, findWin, check };
});
