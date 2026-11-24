// Gives two test alliances the buildings the tests rely on, by editing the
// database file directly (there is no API for granting buildings). Run by
// tests/run.sh while the server is STOPPED. Argument: path to odyssey_game.db
//   Test Argonauts: Armory + Dock, with the Dock activated for a year
//                   (Stage 4A battle power and the points bonus)
//   Test Minoans:   Transport Ship (Stage 6 walking)
const fs = require('fs');
const initSql = require('sql.js');
const file = process.argv[2];
initSql().then(SQL => {
  const db = new SQL.Database(fs.readFileSync(file));
  db.run(`UPDATE alliances SET buildings_owned = ? WHERE alliance_name = 'Test Argonauts'`, [JSON.stringify(['Armory', 'Dock'])]);
  db.run(`INSERT INTO building_activations (alliance_id, building_name, activated_at, active_until)
    SELECT alliance_id, 'Dock', datetime('now'), datetime('now', '+365 days') FROM alliances WHERE alliance_name = 'Test Argonauts'`);
  db.run(`UPDATE alliances SET buildings_owned = ? WHERE alliance_name = 'Test Minoans'`, [JSON.stringify(['Transport Ship'])]);
  fs.writeFileSync(file, Buffer.from(db.export()));
  console.log('test buildings granted');
});
