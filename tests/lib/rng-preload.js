// TEST ONLY (loaded with node -r): lets a test force the server's next
// Math.random() values by writing a JSON array to RNG_FILE. Used for dice rolls.
const fs = require('fs');
const F = require('./env').RNG_FILE;
const orig = Math.random;
Math.random = function () {
  try { const q = JSON.parse(fs.readFileSync(F, 'utf8')); if (q.length) { const v = q.shift(); fs.writeFileSync(F, JSON.stringify(q)); return v; } } catch (e) {}
  return orig();
};
