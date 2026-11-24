// Shared voyage helpers (used by routes/island.js and routes/voyage.js)
const DEFAULTS = { mode: 'build', window_id: 0, tokens_per_publish: 2, visit_cap: 2, visitor_points: 5, author_points: 3, min_response_words: 15 };
const SETTING_LIMITS = {
  tokens_per_publish: [0, 20], visit_cap: [0, 20], visitor_points: [0, 500], author_points: [0, 500], min_response_words: [1, 200]
};

module.exports = function voyageHelpers({ query, run }) {
  // Settings for a period (defaults if the teacher never changed them)
  function getSettings(period) {
    const row = period ? query('SELECT * FROM voyage_settings WHERE class_period = ?', [period])[0] : null;
    return Object.assign({ class_period: period }, DEFAULTS, row || {});
  }
  function ensureSettingsRow(period) {
    run('INSERT OR IGNORE INTO voyage_settings (class_period) VALUES (?)', [period]);
  }
  function getBalance(allianceId) {
    if (!allianceId) return 0;
    const r = query('SELECT balance FROM voyage_tokens WHERE alliance_id = ?', [allianceId])[0];
    return r ? r.balance : 0;
  }
  // Adds (or with a negative delta, removes) tokens; never goes below zero
  function addTokens(allianceId, delta) {
    if (!allianceId || !delta) return getBalance(allianceId);
    run('INSERT OR IGNORE INTO voyage_tokens (alliance_id, balance) VALUES (?, 0)', [allianceId]);
    run('UPDATE voyage_tokens SET balance = MAX(0, balance + ?), updated_at = CURRENT_TIMESTAMP WHERE alliance_id = ?', [delta, allianceId]);
    return getBalance(allianceId);
  }
  // Points with a ledger entry, like the rest of the game
  function addPoints(allianceId, studentId, amount, category, reason, teacherId = null) {
    if (!allianceId || !amount) return;
    run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', [amount, allianceId]);
    run(`INSERT INTO point_transactions (alliance_id, student_id, amount, category, reason, teacher_id) VALUES (?,?,?,?,?,?)`,
      [allianceId, studentId || null, amount, category, reason, teacherId]);
  }
  return { getSettings, ensureSettingsRow, getBalance, addTokens, addPoints, DEFAULTS, SETTING_LIMITS };
};
