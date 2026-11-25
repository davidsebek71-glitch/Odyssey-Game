const ENV = require('../lib/env');
const { chromium } = require('playwright');
const fs = require('fs');
const SC = ENV.SHOTS + '/stage6_shots';
fs.mkdirSync(SC, { recursive: true });
const B = ENV.BASE;
const call = async (t, m, p, b) => (await fetch(B + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json();
const login = async (k, e) => (await call(null, 'POST', `/auth/${k}/login`, { email: e, password: 'pw-test-1' })).token;
const results = []; const check = (ok, m) => { results.push((ok ? '✓ ' : '✗ ') + m); };
const truth = (x, y) => x < 0.33 ? 'w' : x > 0.72 ? 'm' : y < 0.5 ? 'f' : 'l';
let GRID = ''; for (let i = 0; i < 3072; i++) GRID += truth(((i % 64) + 0.5) / 64, (Math.floor(i / 64) + 0.5) / 48);

(async () => {
  const T = await login('teacher', 'teacher@test.local'), F = await login('student', 'stuF@test.local'), G = await login('student', 'stuG@test.local');
  const fId = (await call(F, 'GET', '/island/me')).student.student_id;
  // ── setup: terrain, four named places, no monsters on F's island
  await call(T, 'POST', '/teacher/island/reset-test', { confirm_period: 'Test' });
  const ov = await call(T, 'GET', '/teacher/monsters/overview?period=Test');
  for (const a of ov.alliances) for (const m of a.monsters.filter(x => x.status === 'awake')) await call(T, 'POST', `/teacher/monsters/${m.island_monster_id}/sleep`);
  const tr = await call(F, 'PUT', '/terrain/me', { grid: GRID, color_key: {}, reviewed: true });
  const place = async (type, title, x, y) => { const p = (await call(F, 'POST', '/island/pins', { feature_type: type, x_pct: x, y_pct: y })).pin;
    await call(F, 'PATCH', `/island/pins/${p.pin_id}`, { title, body: 'It is here because the myth says so.' });
    await call(F, 'POST', `/island/pins/${p.pin_id}/submit`); await call(T, 'POST', `/teacher/island/pins/${p.pin_id}/review`, { action: 'approve' }); return p.pin_id; };
  const pins = { river: await place('river', 'River of Echoes', 15, 50), forest: await place('city', 'Hidden Grove Village', 50, 22),
    city: await place('city', 'Harbor Town', 48, 70), mount: await place('mountain', 'Mount Ida', 86, 40) };
  check(tr.terrain && tr.terrain.reviewed, 'setup: F\'s terrain saved and four named places published');

  const br = await chromium.launch();
  async function open(tok, url, who) {
    const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); });
    await p.goto(B + '/index.html');
    await p.evaluate(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [tok, who]);
    await p.goto(B + url); return p;
  }
  const settle = async p => { await p.waitForFunction(() => !anim && !path.length, null, { timeout: 30000 }); };
  const tapCell = async (p, c, r) => { await p.locator('#world').scrollIntoViewIfNeeded(); const b = await p.locator('#world').boundingBox(); await p.mouse.click(b.x + (c + 0.5) / 64 * b.width, b.y + (r + 0.5) / 48 * b.height); };

  // ── F walks (alliance owns a Transport Ship)
  const f = await open(F, '/island.html', { name: 'Student F', type: 'student' });
  await f.click('#walk-link'); await f.waitForURL('**/walk.html'); await f.waitForSelector('#world');
  await f.waitForSelector('text=You land at the dock');
  const dock = await f.evaluate(() => ({ dock, pos }));
  const g = GRID, ix = (c, r) => r * 64 + c;
  const coast = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g[ix(dock.dock.c + dx, dock.dock.r + dy)] === 'w');
  check(g[ix(dock.dock.c, dock.dock.r)] !== 'w' && coast && dock.pos.c === dock.dock.c, `start at the dock on the coast (cell ${dock.dock.c},${dock.dock.r})`);
  check(/3 of 4 places found — some hide in the forest/.test(await f.textContent('#side')), 'the forest place starts hidden: "3 of 4 places found — some hide in the forest"');
  check(/Transport Ship can sail/.test(await f.textContent('#side')), 'F\'s alliance has a Transport Ship');
  await f.screenshot({ path: `${SC}/1-dock.png` });
  // walk to the hidden village in the forest
  await tapCell(f, 32, 10); await settle(f);
  check(/You found something hidden in the forest/.test(await f.textContent('#say')) || (await f.textContent('#side')).includes('Hidden Grove Village'), 'walking into the forest reveals the hidden village');
  check((await f.textContent('.card.found')).includes('Hidden Grove Village'), 'standing on it opens its card');
  check(/4 of 4 places found/.test(await f.textContent('#side')), 'now 4 of 4 places found');
  await f.screenshot({ path: `${SC}/2-forest-find.png` });
  // mountains are slow
  await tapCell(f, 52, 10); await settle(f);
  await f.focus('#world'); await f.keyboard.press('ArrowRight');
  const ms = await f.evaluate(() => anim && anim.ms); await settle(f);
  check(ms === 360, `stepping onto a mountain takes ${ms} ms (land 110 ms)`);
  // sail on the water with the ship
  await tapCell(f, 8, 24); await settle(f);
  const onWater = await f.evaluate(() => grid[pos.r * 64 + pos.c]);
  check(onWater === 'w', 'with a ship, F sails onto the water');
  await f.screenshot({ path: `${SC}/3-sailing.png` });
  // back to the dock → offer to return to the World Map
  await f.click('button[aria-label="Back to the dock"]'); await settle(f);
  check((await f.textContent('#side')).includes('Back at the dock') && await f.isVisible('text=Sail to the World Map'), 'walking back to the dock offers "Sail to the World Map"');
  // open a place from the walk
  await tapCell(f, 30, 33); await settle(f);
  await f.click('.card.found >> text=Open it →');
  await f.waitForURL('**/island.html?pin=*'); await f.waitForSelector('.viewer-body');
  check((await f.textContent('#panel')).includes('Harbor Town'), '"Open it" goes to the island page with that place open');

  // ── a monster seizes the ship, and one blocks a region
  await call(T, 'POST', '/teacher/monsters/awaken', { alliance_id: 3, monster_key: 'hydra', blocks: 'building', block_target: 'Transport Ship' });
  const mino = await call(T, 'POST', '/teacher/monsters/awaken', { alliance_id: 3, monster_key: 'minotaur', blocks: 'region', owner_student_id: fId, x_pct: 50, y_pct: 80 });
  await f.goto(B + '/walk.html'); await f.waitForSelector('#world');
  check(/seized your ship/.test(await f.textContent('#side')), 'the Hydra seizes the Transport Ship: "A monster has seized your ship"');
  await tapCell(f, 5, 20); await settle(f);
  check(/seized your alliance's ship/.test(await f.textContent('#say')), `tapping the water: "${await f.textContent('#say')}"`);
  await tapCell(f, 32, 38); await settle(f);
  check(/Minotaur blocks the way/.test(await f.textContent('#say')), `tapping inside the Minotaur's region: "${await f.textContent('#say')}"`);
  await f.screenshot({ path: `${SC}/4-monster-blocks.png` });
  for (const m of (await call(T, 'GET', '/teacher/monsters/overview?period=Test')).alliances.find(a => a.alliance_id === 3).monsters.filter(x => x.status === 'awake')) await call(T, 'POST', `/teacher/monsters/${m.island_monster_id}/sleep`);

  // ── G (another alliance, no ship) visits during a voyage
  await call(T, 'POST', '/teacher/voyage/settings', { class_period: 'Test', mode: 'voyage' });
  const v = await open(G, `/walk.html?student=${fId}`, { name: 'Student G', type: 'student' });
  await v.waitForSelector('#world');
  check((await v.textContent('#title')).includes("Student F's Island"), 'G can walk F\'s island during a voyage');
  await v.focus('#world'); for (let i = 0; i < 4; i++) await v.keyboard.press('ArrowLeft'); await settle(v);
  await v.keyboard.press('ArrowLeft'); await v.keyboard.press('ArrowLeft'); await v.keyboard.press('ArrowLeft');
  check(/needs a ship/.test(await v.textContent('#say')) || /needs a ship/.test(await v.textContent('#side')), `G without a ship can't enter the water: "${await v.textContent('#say')}"`);
  await call(T, 'POST', '/teacher/voyage/settings', { class_period: 'Test', mode: 'build' });
  const b2 = await open(G, `/walk.html?student=${fId}`, { name: 'Student G', type: 'student' });
  await b2.waitForSelector('.empty');
  check(/voyage/.test(await b2.textContent('.empty')), `in build time G can't walk it: "${(await b2.textContent('.empty')).trim()}"`);

  for (const [n, p] of [['F', f], ['G', v]]) check(!p.errs.length, `${n} page errors: ${p.errs.length ? [...new Set(p.errs)].join(' | ') : 'none'}`);
  console.log(results.join('\n'));
  await br.close();
})().catch(e => { console.log(results.join('\n')); console.error('FAIL', e.message.split('\n').slice(0, 2).join(' ')); process.exit(1); });
