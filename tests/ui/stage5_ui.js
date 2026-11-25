const ENV = require('../lib/env');
const { chromium } = require('playwright');
const fs = require('fs');
const SC = ENV.SHOTS + '/stage5_shots';
fs.mkdirSync(SC, { recursive: true });
const B = ENV.BASE;
const call = async (t, m, p, b) => (await fetch(B + '/api' + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json();
const login = async (k, e) => (await call(null, 'POST', `/auth/${k}/login`, { email: e, password: 'pw-test-1' })).token;
const results = []; const check = (ok, m) => { results.push((ok ? '✓ ' : '✗ ') + m); };
// The truth for the synthetic map, in fractions of width/height
const truth = (x, y) => x < 0.33 ? 'w' : x > 0.72 ? 'm' : y < 0.5 ? 'f' : 'l';

(async () => {
  const T = await login('teacher', 'teacher@test.local'), F = await login('student', 'stuF@test.local');
  const fId = (await call(F, 'GET', '/island/me')).student.student_id;
  const br = await chromium.launch();

  // ── 1. Draw a "marker map" and save it as a PDF
  const maker = await br.newPage();
  const png = await maker.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 600; const g = c.getContext('2d');
    const fill = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    fill(0, 0, 264, 600, '#3d7fd6'); fill(264, 0, 312, 300, '#2f8a3c'); fill(264, 300, 312, 300, '#e3d3a1'); fill(576, 0, 224, 600, '#8a7a6a');
    // marker texture: random streaks of slightly different shades
    for (let i = 0; i < 4000; i++) { const x = Math.random() * 800, y = Math.random() * 600; const d = (Math.random() - 0.5) * 40;
      const base = x < 264 ? [61, 127, 214] : x > 576 ? [138, 122, 106] : y < 300 ? [47, 138, 60] : [227, 211, 161];
      g.fillStyle = `rgb(${base.map(v => Math.max(0, Math.min(255, v + d))).join(',')})`; g.fillRect(x, y, 6, 2); }
    // black outlines like a hand-drawn map
    g.strokeStyle = '#111'; g.lineWidth = 3; g.beginPath(); g.moveTo(264, 0); g.lineTo(264, 600); g.moveTo(576, 0); g.lineTo(576, 600); g.moveTo(264, 300); g.lineTo(576, 300); g.stroke();
    return c.toDataURL('image/png');
  });
  await maker.setContent(`<html><body style="margin:0"><img src="${png}" style="width:100%"></body></html>`);
  const pdfPath = `${SC}/marker-map.pdf`;
  await maker.pdf({ path: pdfPath, width: '8in', height: '6in', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  check(fs.statSync(pdfPath).size > 1000, `made a test map PDF (${Math.round(fs.statSync(pdfPath).size / 1024)} KB)`);

  async function open(tok, url, who) {
    const ctx = await br.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage(); p.setDefaultTimeout(20000);
    p.errs = []; p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') p.errs.push(m.text()); });
    p.dialogs = []; p.on('dialog', d => { p.dialogs.push(d.message()); d.accept(); });
    await p.goto(B + '/index.html');
    await p.evaluate(([t, u]) => { localStorage.setItem('token', t); localStorage.setItem('user', JSON.stringify(u)); }, [tok, who]);
    await p.goto(B + url); return p;
  }

  // ── 2. Upload the PDF through the real My Map button
  const s = await open(F, '/student.html', { name: 'Student F', type: 'student', id: fId, student_id: fId });
  await s.waitForSelector('#map-btn'); await s.click('#map-btn');
  const fileInput = s.locator('#map-file-input, #map-file-input-replace').first();
  await fileInput.waitFor({ state: 'attached' });
  await fileInput.setInputFiles(pdfPath);
  await s.waitForFunction(() => true); await s.waitForTimeout(5000);
  const mapNow = await call(F, 'GET', '/island/me');
  check(s.dialogs.some(d => /Map uploaded/.test(d)) && /^data:image\//.test(mapNow.map_image || ''), `PDF map upload: "${s.dialogs.join(' | ')}"`);

  // ── 3. Color key + detection
  const t = await open(F, '/terrain.html', { name: 'Student F', type: 'student' });
  await t.waitForSelector('#board');
  check(/needs its terrain/.test(await t.textContent('main')), 'terrain page asks for the terrain to be found');
  const tapMap = async (fx, fy) => { const b = await t.locator('#board').boundingBox(); await t.mouse.click(b.x + b.width * fx, b.y + b.height * fy); };
  const spots = { Water: [0.15, 0.5], Forest: [0.5, 0.2], Mountain: [0.86, 0.5], Land: [0.5, 0.8] };
  for (const [name, [x, y]] of Object.entries(spots)) {
    await t.locator('.key-row', { hasText: name }).getByRole('button').click();
    await t.locator('#board').scrollIntoViewIfNeeded(); await tapMap(x, y);
  }
  const keyColors = await t.$$eval('.key-row input[type=color]', xs => xs.map(x => x.value));
  check(keyColors.length === 4, `color key picked from the map: ${keyColors.join(' ')}`);
  await t.getByRole('button', { name: 'Find the terrain', exact: true }).click();
  await t.waitForSelector('text=3 · Check and fix');
  const grid = await t.evaluate(() => grid);
  let right = 0; for (let i = 0; i < 3072; i++) if (grid[i] === truth(((i % 64) + 0.5) / 64, (Math.floor(i / 64) + 0.5) / 48)) right++;
  check(right / 3072 > 0.9, `detection matched the drawn regions in ${(right / 30.72).toFixed(1)}% of cells`);
  await t.screenshot({ path: `${SC}/1-detected.png` });
  check(await t.isDisabled('#save'), 'Save stays off until "I checked it" is ticked');

  // ── 4. Fix by dragging and by keyboard, then save
  const b = await t.locator('#board').boundingBox();
  await t.click('text=1 Water'); await t.click('text=3×3');
  await t.mouse.move(b.x + b.width * 0.40, b.y + b.height * 0.85); await t.mouse.down();
  await t.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.85, { steps: 8 }); await t.mouse.up();
  const afterDrag = await t.evaluate(() => grid);
  const lakeCell = Math.floor(0.85 * 48) * 64 + Math.floor(0.47 * 64);
  check(afterDrag[lakeCell] === 'w', 'dragging a 3×3 water brush painted a lake into the land');
  await t.focus('#board');
  await t.keyboard.press('2');
  for (let i = 0; i < 5; i++) await t.keyboard.press('ArrowRight');
  await t.keyboard.press('Space');
  const afterKey = await t.evaluate(() => ({ g: grid, c: cursor }));
  check(afterKey.g[afterKey.c.r * 64 + afterKey.c.c] === 'f', 'keyboard: 2 chooses forest, arrows move, Space paints');
  await t.check('#checked'); await t.click('#save'); await t.waitForSelector('text=✓ Saved');
  const savedT = (await call(F, 'GET', '/terrain/me')).terrain;
  check(savedT.reviewed && savedT.grid[lakeCell] === 'w', 'saved and marked as checked');
  await t.screenshot({ path: `${SC}/2-fixed.png` });

  // ── 5. Monster placement on its own terrain
  const ov = await call(T, 'GET', '/teacher/monsters/overview?period=Test');
  for (const al of ov.alliances) for (const m of al.monsters.filter(x => x.status === 'awake' && x.monster_key === 'hydra')) await call(T, 'POST', `/teacher/monsters/${m.island_monster_id}/sleep`);
  const aw = await call(T, 'POST', '/teacher/monsters/awaken', { alliance_id: 3, monster_key: 'hydra', blocks: 'region', owner_student_id: fId });
  const hydra = (await call(F, 'GET', '/island/me')).monsters.find(m => /Hydra/.test(m.name));
  const cell = Math.floor(hydra.y_pct / 100 * 48) * 64 + Math.floor(hydra.x_pct / 100 * 64);
  check(aw.placed_on_terrain && savedT.grid[cell] === 'w', `the Hydra (water monster) was placed on a water cell (${hydra.x_pct.toFixed(1)}%, ${hydra.y_pct.toFixed(1)}%): "${aw.message}"`);
  await call(T, 'POST', `/teacher/monsters/${aw.monster.island_monster_id}/sleep`);
  const studs = await call(T, 'GET', '/teacher/island/students?period=Test');
  check(studs.students.find(x => x.student_id === fId).terrain_ok === 1, 'teacher\'s island list shows F\'s terrain as checked');

  // ── 6. A new map makes the terrain stale
  await call(F, 'POST', '/student/upload-map', { map_image: png });
  const stale = (await call(F, 'GET', '/terrain/me')).terrain;
  check(stale.stale && !stale.reviewed, 'uploading a new map marks the saved terrain as out of date');
  await t.reload(); await t.waitForSelector('#board');
  check(/uploaded a new map/.test(await t.textContent('main')), 'the terrain page says to redo it');

  for (const [n, p] of [['student', s], ['terrain', t]]) check(!p.errs.length, `${n} page errors: ${p.errs.length ? [...new Set(p.errs)].join(' | ') : 'none'}`);
  console.log(results.join('\n'));
  await br.close();
})().catch(e => { console.log(results.join('\n')); console.error('FAIL', e.message.split('\n').slice(0, 2).join(' ')); process.exit(1); });
