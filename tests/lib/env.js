// Shared settings for the test scripts. tests/run.sh sets these; the defaults
// let a single script run against a server you started yourself.
const path = require('path');
const os = require('os');
const REPO = path.resolve(__dirname, '..', '..');
const BASE = process.env.TEST_BASE || 'http://localhost:4200';
module.exports = {
  REPO,
  BASE,
  API: BASE + '/api',
  SHOTS: process.env.SHOTS_DIR || path.join(os.tmpdir(), 'odyssey-test-shots'),
  RNG_FILE: process.env.RNG_FILE || path.join(os.tmpdir(), 'odyssey-test-rng.json'),
  MOCK_LOG: process.env.MOCK_LOG || path.join(os.tmpdir(), 'odyssey-test-mock-requests.json'),
  PASSWORD: 'pw-test-1'
};
