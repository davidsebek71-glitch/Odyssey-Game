const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// Use /app/data for Railway volume, fallback to local for development
const DATA_DIR = process.env.RAILWAY_ENVIRONMENT ? '/app/data' : __dirname;
const DB_PATH = path.join(DATA_DIR, 'odyssey_game.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

console.log('📁 Database path:', DB_PATH);

let db = null;

async function initDatabase() {
  const SQL = await initSqlJs();
  
  // Try to load existing database
  let buffer;
  try {
    buffer = fs.readFileSync(DB_PATH);
  } catch (err) {
    // Database doesn't exist, will create new one
    buffer = null;
  }

  db = new SQL.Database(buffer);

  // Create tables if they don't exist
  db.run(`
    CREATE TABLE IF NOT EXISTS teachers (
      teacher_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS alliances (
      alliance_id INTEGER PRIMARY KEY AUTOINCREMENT,
      alliance_name TEXT NOT NULL,
      class_period TEXT,
      total_points INTEGER DEFAULT 0,
      current_age TEXT DEFAULT 'Archaic',
      buildings_owned TEXT DEFAULT '[]',
      building_powers TEXT DEFAULT '{}',
      underdog_blessing INTEGER DEFAULT 0,
      reverse_cards INTEGER DEFAULT 0,
      rite_of_passage_complete INTEGER DEFAULT 0,
      civilization_map_complete INTEGER DEFAULT 0,
      is_disbanded INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Track age gate status per class period
  db.run(`
    CREATE TABLE IF NOT EXISTS age_gates (
      gate_id INTEGER PRIMARY KEY AUTOINCREMENT,
      class_period TEXT NOT NULL UNIQUE,
      current_age TEXT DEFAULT 'Archaic',
      classical_unlocked INTEGER DEFAULT 0,
      classical_unlocked_at DATETIME,
      classical_unlocked_by INTEGER,
      heroic_unlocked INTEGER DEFAULT 0,
      heroic_unlocked_at DATETIME,
      heroic_unlocked_by INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS students (
      student_id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      class_period TEXT,
      alliance_id INTEGER,
      civilization_name TEXT,
      map_image TEXT,
      map_uploaded_at DATETIME,
      wall_points TEXT,
      reverse_shield_count INTEGER DEFAULT 0,
      technologies_unlocked TEXT DEFAULT '[]',
      badges_earned TEXT DEFAULT '[]',
      secret_objective_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (alliance_id) REFERENCES alliances(alliance_id)
    )
  `);

  // Track building placements on student maps
  db.run(`
    CREATE TABLE IF NOT EXISTS building_placements (
      placement_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      building_name TEXT NOT NULL,
      instance_number INTEGER DEFAULT 1,
      x_position REAL NOT NULL,
      y_position REAL NOT NULL,
      placed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(student_id)
    )
  `);

  // Track student achievement progress for power-ups
  db.run(`
    CREATE TABLE IF NOT EXISTS student_achievement_progress (
      progress_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL UNIQUE,
      quiz_count INTEGER DEFAULT 0,
      quiz_total_earned INTEGER DEFAULT 0,
      quiz_total_possible INTEGER DEFAULT 0,
      comp_conn_count INTEGER DEFAULT 0,
      comp_conn_total_earned INTEGER DEFAULT 0,
      comp_conn_total_possible INTEGER DEFAULT 0,
      mural_count INTEGER DEFAULT 0,
      video_count INTEGER DEFAULT 0,
      coeus_unlocked INTEGER DEFAULT 0,
      coeus_unlocked_at DATETIME,
      metis_unlocked INTEGER DEFAULT 0,
      metis_unlocked_at DATETIME,
      apollo_unlocked INTEGER DEFAULT 0,
      apollo_unlocked_at DATETIME,
      delphi_unlocked INTEGER DEFAULT 0,
      delphi_unlocked_at DATETIME,
      FOREIGN KEY (student_id) REFERENCES students(student_id)
    )
  `);

  // Track individual student contributions (persists through alliance changes)
  db.run(`
    CREATE TABLE IF NOT EXISTS student_contributions (
      contribution_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      alliance_id INTEGER,
      points_contributed INTEGER DEFAULT 0,
      buildings_contributed TEXT DEFAULT '[]',
      contribution_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(student_id),
      FOREIGN KEY (alliance_id) REFERENCES alliances(alliance_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS point_transactions (
      transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
      alliance_id INTEGER NOT NULL,
      student_id INTEGER,
      amount INTEGER NOT NULL,
      category TEXT NOT NULL,
      reason TEXT,
      teacher_id INTEGER,
      fate_id INTEGER,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (alliance_id) REFERENCES alliances(alliance_id),
      FOREIGN KEY (student_id) REFERENCES students(student_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS buildings_ref (
      building_id INTEGER PRIMARY KEY AUTOINCREMENT,
      building_name TEXT NOT NULL UNIQUE,
      cost_points INTEGER NOT NULL,
      prerequisite_building_id INTEGER,
      god_associated TEXT,
      requires_god_assignment INTEGER DEFAULT 0,
      max_per_alliance INTEGER DEFAULT 1,
      age_available TEXT DEFAULT 'Archaic',
      battle_bonus INTEGER DEFAULT 0,
      point_bonus REAL DEFAULT 0,
      active_duration_hours INTEGER DEFAULT 0,
      cooldown_hours INTEGER DEFAULT 0,
      always_active INTEGER DEFAULT 0,
      required_for_age INTEGER DEFAULT 0,
      description TEXT,
      FOREIGN KEY (prerequisite_building_id) REFERENCES buildings_ref(building_id)
    )
  `);

  // Track building requests (for buildings requiring god assignments)
  db.run(`
    CREATE TABLE IF NOT EXISTS building_requests (
      request_id INTEGER PRIMARY KEY AUTOINCREMENT,
      alliance_id INTEGER NOT NULL,
      building_id INTEGER NOT NULL,
      requested_by_student_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      reviewed_by_teacher_id INTEGER,
      teacher_notes TEXT,
      FOREIGN KEY (alliance_id) REFERENCES alliances(alliance_id),
      FOREIGN KEY (building_id) REFERENCES buildings_ref(building_id),
      FOREIGN KEY (requested_by_student_id) REFERENCES students(student_id)
    )
  `);

  // Track building activations per alliance
  db.run(`
    CREATE TABLE IF NOT EXISTS building_activations (
      activation_id INTEGER PRIMARY KEY AUTOINCREMENT,
      alliance_id INTEGER NOT NULL,
      building_name TEXT NOT NULL,
      building_instance INTEGER DEFAULT 1,
      activated_at DATETIME,
      active_until DATETIME,
      cooldown_until DATETIME,
      activated_by_student_id INTEGER,
      FOREIGN KEY (alliance_id) REFERENCES alliances(alliance_id)
    )
  `);

  // Track god assignment completions per alliance
  db.run(`
    CREATE TABLE IF NOT EXISTS god_assignments (
      assignment_id INTEGER PRIMARY KEY AUTOINCREMENT,
      alliance_id INTEGER NOT NULL,
      god_name TEXT NOT NULL,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_by_teacher_id INTEGER,
      FOREIGN KEY (alliance_id) REFERENCES alliances(alliance_id),
      UNIQUE(alliance_id, god_name)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS technologies_ref (
      tech_id INTEGER PRIMARY KEY AUTOINCREMENT,
      tech_name TEXT NOT NULL UNIQUE,
      bonus_type TEXT NOT NULL,
      bonus_value REAL,
      specific_assignment_type TEXT,
      cost_description TEXT,
      god_associated TEXT,
      age_available TEXT DEFAULT 'Archaic',
      description TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS fates_ref (
      fate_id INTEGER PRIMARY KEY AUTOINCREMENT,
      fate_number INTEGER NOT NULL UNIQUE,
      fate_name TEXT NOT NULL,
      fate_type TEXT NOT NULL,
      description TEXT NOT NULL,
      god_associated TEXT,
      icon_url TEXT,
      point_effect INTEGER,
      steals_from_others INTEGER DEFAULT 0,
      gives_to_others INTEGER DEFAULT 0,
      transfer_amount INTEGER,
      is_battle INTEGER DEFAULT 0,
      battle_threat_percent REAL,
      battle_win_points INTEGER,
      battle_lose_points INTEGER,
      battle_description TEXT,
      age_available TEXT DEFAULT 'Archaic'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS fate_choices (
      choice_id INTEGER PRIMARY KEY AUTOINCREMENT,
      fate_id INTEGER NOT NULL,
      risk_level TEXT NOT NULL CHECK(risk_level IN ('conservative', 'moderate', 'aggressive')),
      description TEXT NOT NULL,
      success_chance REAL NOT NULL,
      success_points INTEGER NOT NULL,
      failure_points INTEGER NOT NULL,
      FOREIGN KEY (fate_id) REFERENCES fates_ref(fate_id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS fate_outcomes (
      outcome_id INTEGER PRIMARY KEY AUTOINCREMENT,
      alliance_id INTEGER NOT NULL,
      fate_id INTEGER NOT NULL,
      outcome_type TEXT NOT NULL,
      choice_made TEXT,
      alliance_roll INTEGER,
      threat_roll INTEGER,
      points_awarded INTEGER NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (alliance_id) REFERENCES alliances(alliance_id),
      FOREIGN KEY (fate_id) REFERENCES fates_ref(fate_id)
    )
  `);

  // Alliance Invitations table
  db.run(`
    CREATE TABLE IF NOT EXISTS alliance_invitations (
      invitation_id INTEGER PRIMARY KEY AUTOINCREMENT,
      alliance_id INTEGER NOT NULL,
      inviter_student_id INTEGER NOT NULL,
      invited_student_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      responded_at DATETIME,
      FOREIGN KEY (alliance_id) REFERENCES alliances(alliance_id),
      FOREIGN KEY (inviter_student_id) REFERENCES students(student_id),
      FOREIGN KEY (invited_student_id) REFERENCES students(student_id)
    )
  `);

  // Point Submissions table
  db.run(`
    CREATE TABLE IF NOT EXISTS point_submissions (
      submission_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      alliance_id INTEGER NOT NULL,
      points_claimed INTEGER NOT NULL,
      max_points INTEGER,
      category TEXT NOT NULL,
      myth_god TEXT,
      section TEXT,
      description TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      reviewed_by_teacher_id INTEGER,
      teacher_notes TEXT,
      FOREIGN KEY (student_id) REFERENCES students(student_id),
      FOREIGN KEY (alliance_id) REFERENCES alliances(alliance_id),
      FOREIGN KEY (reviewed_by_teacher_id) REFERENCES teachers(teacher_id)
    )
  `);

  // Assignments Reference table - defines all gradeable assignments
  db.run(`
    CREATE TABLE IF NOT EXISTS assignments_ref (
      assignment_id INTEGER PRIMARY KEY AUTOINCREMENT,
      section TEXT NOT NULL,
      assignment_type TEXT NOT NULL,
      myth_god TEXT NOT NULL,
      display_name TEXT NOT NULL,
      max_points INTEGER NOT NULL,
      description TEXT,
      resource_links TEXT,
      is_bonus INTEGER DEFAULT 0,
      age TEXT DEFAULT 'Archaic',
      UNIQUE(section, assignment_type, myth_god)
    )
  `);

  // Grade Records table - tracks completed assignments per student
  db.run(`
    CREATE TABLE IF NOT EXISTS grade_records (
      record_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      assignment_id INTEGER NOT NULL,
      points_earned INTEGER NOT NULL,
      points_possible INTEGER NOT NULL,
      submission_id INTEGER,
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(student_id),
      FOREIGN KEY (assignment_id) REFERENCES assignments_ref(assignment_id),
      FOREIGN KEY (submission_id) REFERENCES point_submissions(submission_id),
      UNIQUE(student_id, assignment_id)
    )
  `);

  // Fate Spins table
  db.run(`
    CREATE TABLE IF NOT EXISTS fate_spins (
      spin_id INTEGER PRIMARY KEY AUTOINCREMENT,
      alliance_id INTEGER NOT NULL,
      fate_id INTEGER NOT NULL,
      fate_name TEXT NOT NULL,
      result_type TEXT NOT NULL,
      points_change INTEGER,
      teacher_id INTEGER NOT NULL,
      spun_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (alliance_id) REFERENCES alliances(alliance_id),
      FOREIGN KEY (fate_id) REFERENCES fates_ref(fate_id),
      FOREIGN KEY (teacher_id) REFERENCES teachers(teacher_id)
    )
  `);

  // Battle Events table
  db.run(`
    CREATE TABLE IF NOT EXISTS battle_events (
      battle_id INTEGER PRIMARY KEY AUTOINCREMENT,
      alliance_id INTEGER NOT NULL,
      fate_name TEXT NOT NULL,
      alliance_power INTEGER NOT NULL,
      threat_power INTEGER NOT NULL,
      alliance_roll INTEGER NOT NULL,
      threat_roll INTEGER NOT NULL,
      victory INTEGER NOT NULL,
      points_change INTEGER NOT NULL,
      teacher_id INTEGER NOT NULL,
      battled_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (alliance_id) REFERENCES alliances(alliance_id),
      FOREIGN KEY (teacher_id) REFERENCES teachers(teacher_id)
    )
  `);

  // Side Quests Reference table - defines available side quests
  db.run(`
    CREATE TABLE IF NOT EXISTS side_quests_ref (
      quest_id INTEGER PRIMARY KEY AUTOINCREMENT,
      quest_name TEXT NOT NULL UNIQUE,
      god_associated TEXT NOT NULL,
      description TEXT,
      reward_type TEXT NOT NULL,
      reward_name TEXT NOT NULL,
      reward_description TEXT,
      form_url TEXT,
      icon TEXT
    )
  `);

  // Side Quest Completions - tracks individual student completions
  db.run(`
    CREATE TABLE IF NOT EXISTS side_quest_completions (
      completion_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      quest_id INTEGER NOT NULL,
      alliance_id INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      reviewed_by_teacher_id INTEGER,
      teacher_notes TEXT,
      FOREIGN KEY (student_id) REFERENCES students(student_id),
      FOREIGN KEY (quest_id) REFERENCES side_quests_ref(quest_id),
      FOREIGN KEY (alliance_id) REFERENCES alliances(alliance_id),
      FOREIGN KEY (reviewed_by_teacher_id) REFERENCES teachers(teacher_id),
      UNIQUE(student_id, quest_id)
    )
  `);

  // Alliance Technologies - tracks unlocked technologies per alliance
  db.run(`
    CREATE TABLE IF NOT EXISTS alliance_technologies (
      tech_id INTEGER PRIMARY KEY AUTOINCREMENT,
      alliance_id INTEGER NOT NULL,
      tech_name TEXT NOT NULL,
      source_quest_id INTEGER,
      unlocked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (alliance_id) REFERENCES alliances(alliance_id),
      FOREIGN KEY (source_quest_id) REFERENCES side_quests_ref(quest_id),
      UNIQUE(alliance_id, tech_name)
    )
  `);

  // ==================== BATTLE ARENA SYSTEM ====================
  
  // Battle Questions Reference - trivia questions for arena battles
  db.run(`
    CREATE TABLE IF NOT EXISTS battle_questions (
      question_id INTEGER PRIMARY KEY AUTOINCREMENT,
      god_associated TEXT NOT NULL,
      question_text TEXT NOT NULL,
      correct_answer TEXT NOT NULL,
      wrong_answer_1 TEXT NOT NULL,
      wrong_answer_2 TEXT NOT NULL,
      wrong_answer_3 TEXT NOT NULL,
      difficulty TEXT DEFAULT 'medium',
      is_active INTEGER DEFAULT 1,
      age TEXT DEFAULT 'Archaic',
      myth_name TEXT
    )
  `);
  
  // Arena Battles - tracks battle matches between students
  db.run(`
    CREATE TABLE IF NOT EXISTS arena_battles (
      battle_id INTEGER PRIMARY KEY AUTOINCREMENT,
      challenger_id INTEGER NOT NULL,
      defender_id INTEGER NOT NULL,
      challenger_alliance_id INTEGER NOT NULL,
      defender_alliance_id INTEGER NOT NULL,
      point_stakes INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      winner_id INTEGER,
      challenger_score INTEGER DEFAULT 0,
      defender_score INTEGER DEFAULT 0,
      challenger_gods TEXT DEFAULT '[]',
      defender_gods TEXT DEFAULT '[]',
      current_round INTEGER DEFAULT 0,
      class_period TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME,
      FOREIGN KEY (challenger_id) REFERENCES students(student_id),
      FOREIGN KEY (defender_id) REFERENCES students(student_id),
      FOREIGN KEY (challenger_alliance_id) REFERENCES alliances(alliance_id),
      FOREIGN KEY (defender_alliance_id) REFERENCES alliances(alliance_id)
    )
  `);
  
  // Arena Battle Rounds - tracks each round of a battle
  db.run(`
    CREATE TABLE IF NOT EXISTS arena_battle_rounds (
      round_id INTEGER PRIMARY KEY AUTOINCREMENT,
      battle_id INTEGER NOT NULL,
      round_number INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      challenger_god_used TEXT,
      defender_god_used TEXT,
      challenger_answer TEXT,
      defender_answer TEXT,
      challenger_time_ms INTEGER,
      defender_time_ms INTEGER,
      round_winner_id INTEGER,
      god_effects TEXT DEFAULT '{}',
      started_at DATETIME,
      completed_at DATETIME,
      FOREIGN KEY (battle_id) REFERENCES arena_battles(battle_id),
      FOREIGN KEY (question_id) REFERENCES battle_questions(question_id)
    )
  `);
  
  // Arena Battle Stats - tracks student battle statistics
  db.run(`
    CREATE TABLE IF NOT EXISTS arena_battle_stats (
      stat_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL UNIQUE,
      total_battles INTEGER DEFAULT 0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      current_streak INTEGER DEFAULT 0,
      best_streak INTEGER DEFAULT 0,
      total_points_won INTEGER DEFAULT 0,
      total_points_lost INTEGER DEFAULT 0,
      battles_today INTEGER DEFAULT 0,
      last_battle_date DATE,
      last_opponent_id INTEGER,
      FOREIGN KEY (student_id) REFERENCES students(student_id)
    )
  `);
  
  // Arena Settings - per-period and per-student battle controls
  db.run(`
    CREATE TABLE IF NOT EXISTS arena_settings (
      setting_id INTEGER PRIMARY KEY AUTOINCREMENT,
      setting_type TEXT NOT NULL,
      setting_key TEXT NOT NULL,
      setting_value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(setting_type, setting_key)
    )
  `);

  // ==================== CLASSICAL AGE TABLES ====================
  
  // Myth portal definitions (7 myths)
  db.run(`
    CREATE TABLE IF NOT EXISTS myth_portals (
      portal_id INTEGER PRIMARY KEY AUTOINCREMENT,
      myth_name TEXT NOT NULL,
      myth_number INTEGER NOT NULL,
      display_name TEXT,
      icon_placeholder TEXT,
      icon_url TEXT,
      glow_color TEXT,
      description TEXT,
      virtue_greek TEXT,
      virtue_english TEXT,
      virtue_description TEXT,
      virtue_emoji TEXT
    )
  `);

  // Teacher activation of myth portals per class period
  db.run(`
    CREATE TABLE IF NOT EXISTS myth_portal_status (
      status_id INTEGER PRIMARY KEY AUTOINCREMENT,
      portal_id INTEGER NOT NULL,
      class_period TEXT NOT NULL,
      activated INTEGER DEFAULT 0,
      activated_at DATETIME,
      activated_by INTEGER,
      FOREIGN KEY (portal_id) REFERENCES myth_portals(portal_id),
      UNIQUE(portal_id, class_period)
    )
  `);

  // In-game quiz questions per myth (80% threshold to unlock assignments)
  db.run(`
    CREATE TABLE IF NOT EXISTS myth_quiz_questions (
      question_id INTEGER PRIMARY KEY AUTOINCREMENT,
      portal_id INTEGER NOT NULL,
      question_text TEXT NOT NULL,
      option_a TEXT NOT NULL,
      option_b TEXT NOT NULL,
      option_c TEXT NOT NULL,
      option_d TEXT NOT NULL,
      correct_answer TEXT NOT NULL,
      FOREIGN KEY (portal_id) REFERENCES myth_portals(portal_id)
    )
  `);

  // Student quiz attempt tracking
  db.run(`
    CREATE TABLE IF NOT EXISTS myth_quiz_attempts (
      attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      portal_id INTEGER NOT NULL,
      score INTEGER NOT NULL,
      total_questions INTEGER NOT NULL,
      percentage REAL NOT NULL,
      passed INTEGER DEFAULT 0,
      attempted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(student_id),
      FOREIGN KEY (portal_id) REFERENCES myth_portals(portal_id)
    )
  `);

  // ==================== TRADE SYSTEM TABLES ====================

  // Alliance native resource assignments (no shared pool — students buy directly)
  db.run(`
    CREATE TABLE IF NOT EXISTS alliance_resources (
      alliance_id INTEGER PRIMARY KEY,
      native_resource TEXT NOT NULL,
      FOREIGN KEY (alliance_id) REFERENCES alliances(alliance_id)
    )
  `);

  // Student personal resource inventories
  db.run(`
    CREATE TABLE IF NOT EXISTS student_resources (
      student_id INTEGER PRIMARY KEY,
      olive INTEGER DEFAULT 0,
      grape INTEGER DEFAULT 0,
      iron INTEGER DEFAULT 0,
      grain INTEGER DEFAULT 0,
      FOREIGN KEY (student_id) REFERENCES students(student_id)
    )
  `);

  // Trade records
  db.run(`
    CREATE TABLE IF NOT EXISTS trades (
      trade_id INTEGER PRIMARY KEY AUTOINCREMENT,
      period TEXT NOT NULL,
      initiator_id INTEGER NOT NULL,
      partner_id INTEGER NOT NULL,
      give_resource TEXT NOT NULL,
      give_amount INTEGER NOT NULL,
      receive_resource TEXT NOT NULL,
      receive_amount INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      flagged INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME,
      FOREIGN KEY (initiator_id) REFERENCES students(student_id),
      FOREIGN KEY (partner_id) REFERENCES students(student_id)
    )
  `);

  // Resource buy log (student buys native resource directly into personal inventory)
  db.run(`
    CREATE TABLE IF NOT EXISTS resource_buys (
      buy_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      alliance_id INTEGER NOT NULL,
      resource_type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      points_spent INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(student_id),
      FOREIGN KEY (alliance_id) REFERENCES alliances(alliance_id)
    )
  `);

  // Sell-back records
  db.run(`
    CREATE TABLE IF NOT EXISTS resource_sellbacks (
      sellback_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      alliance_id INTEGER NOT NULL,
      resource_type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      market_value REAL NOT NULL,
      points_earned INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES students(student_id),
      FOREIGN KEY (alliance_id) REFERENCES alliances(alliance_id)
    )
  `);

  // Trade window status per period (with configurable threshold)
  db.run(`
    CREATE TABLE IF NOT EXISTS trade_window (
      period TEXT PRIMARY KEY,
      is_open INTEGER DEFAULT 0,
      opened_at DATETIME,
      closed_at DATETIME,
      opened_by INTEGER,
      resource_threshold INTEGER DEFAULT 500
    )
  `);

  // Run migrations for existing databases
  runMigrations();
  
  // Seed initial data
  seedReferenceData();
  
  // Save database to file
  saveDatabase();
  
  return db;
}

// Add missing columns to existing databases
function runMigrations() {
  console.log('🔄 Running database migrations...');
  
  // Ensure students table has current_age column
  try {
    const studentCols = db.exec("PRAGMA table_info(students)");
    const studentColNames = studentCols[0] ? studentCols[0].values.map(c => c[1]) : [];
    if (!studentColNames.includes('current_age')) {
      console.log('  Adding current_age column to students...');
      db.run("ALTER TABLE students ADD COLUMN current_age TEXT DEFAULT 'Archaic'");
      console.log('✅ students.current_age column added');
    }
  } catch (err) {
    console.log('students current_age migration note:', err.message);
  }
  
  // Ensure alliances table has current_age column
  try {
    const allianceCols = db.exec("PRAGMA table_info(alliances)");
    const allianceColNames = allianceCols[0] ? allianceCols[0].values.map(c => c[1]) : [];
    if (!allianceColNames.includes('current_age')) {
      console.log('  Adding current_age column to alliances...');
      db.run("ALTER TABLE alliances ADD COLUMN current_age TEXT DEFAULT 'Archaic'");
      console.log('✅ alliances.current_age column added');
    }
  } catch (err) {
    console.log('alliances current_age migration note:', err.message);
  }
  
  // Check and add missing columns to alliances table
  try {
    // Check if civilization_map_complete column exists
    const cols = db.exec("PRAGMA table_info(alliances)");
    const colNames = cols[0] ? cols[0].values.map(c => c[1]) : [];
    
    if (!colNames.includes('civilization_map_complete')) {
      console.log('  Adding civilization_map_complete column to alliances...');
      db.run('ALTER TABLE alliances ADD COLUMN civilization_map_complete INTEGER DEFAULT 0');
    }
    
    if (!colNames.includes('rite_of_passage_complete')) {
      console.log('  Adding rite_of_passage_complete column to alliances...');
      db.run('ALTER TABLE alliances ADD COLUMN rite_of_passage_complete INTEGER DEFAULT 0');
    }
    
    if (!colNames.includes('reverse_cards')) {
      console.log('  Adding reverse_cards column to alliances...');
      db.run('ALTER TABLE alliances ADD COLUMN reverse_cards INTEGER DEFAULT 0');
    }
    
    if (!colNames.includes('underdog_blessing')) {
      console.log('  Adding underdog_blessing column to alliances...');
      db.run('ALTER TABLE alliances ADD COLUMN underdog_blessing INTEGER DEFAULT 0');
    }
    
    if (!colNames.includes('side_quest_rewards')) {
      console.log('  Adding side_quest_rewards column to alliances...');
      db.run("ALTER TABLE alliances ADD COLUMN side_quest_rewards TEXT DEFAULT '[]'");
    }
    
    // Check and add pantheon unlock columns to student_achievement_progress
    const achieveCols = db.exec("PRAGMA table_info(student_achievement_progress)");
    const achieveColNames = achieveCols[0] ? achieveCols[0].values.map(c => c[1]) : [];
    
    // Pantheon god unlocks - each god unlocked by specific achievement
    const pantheonGods = ['zeus', 'hera', 'poseidon', 'athena', 'apollo', 'artemis', 'aphrodite', 'ares', 'hephaestus', 'hermes', 'demeter', 'prometheus', 'hades'];
    
    for (const god of pantheonGods) {
      const colName = `pantheon_${god}_unlocked`;
      const colNameAt = `pantheon_${god}_unlocked_at`;
      const colNameSeen = `pantheon_${god}_celebration_seen`;
      const colBonusSeen = `pantheon_${god}_bonus_seen`;
      
      if (!achieveColNames.includes(colName)) {
        console.log(`  Adding ${colName} column to student_achievement_progress...`);
        db.run(`ALTER TABLE student_achievement_progress ADD COLUMN ${colName} INTEGER DEFAULT 0`);
      }
      if (!achieveColNames.includes(colNameAt)) {
        db.run(`ALTER TABLE student_achievement_progress ADD COLUMN ${colNameAt} DATETIME`);
      }
      if (!achieveColNames.includes(colNameSeen)) {
        db.run(`ALTER TABLE student_achievement_progress ADD COLUMN ${colNameSeen} INTEGER DEFAULT 0`);
      }
      // Add bonus celebration seen column
      if (!achieveColNames.includes(colBonusSeen)) {
        console.log(`  Adding ${colBonusSeen} column to student_achievement_progress...`);
        db.run(`ALTER TABLE student_achievement_progress ADD COLUMN ${colBonusSeen} INTEGER DEFAULT 0`);
      }
    }
    
    // Fix word cloud points: should be 12, not 20
    try {
      const wcCheck = db.exec("SELECT COUNT(*) FROM assignments_ref WHERE assignment_type = 'word_cloud' AND age = 'Classical' AND max_points != 12");
      const wcCount = wcCheck[0] ? wcCheck[0].values[0][0] : 0;
      if (wcCount > 0) {
        db.run("UPDATE assignments_ref SET max_points = 12 WHERE assignment_type = 'word_cloud' AND age = 'Classical'");
        console.log(`✅ Fixed ${wcCount} Classical word cloud assignments → 12 pts`);
      }
      // Also fix any grade_records that recorded points_possible as 20 for Classical word clouds
      const grCheck = db.exec(`SELECT COUNT(*) FROM grade_records WHERE points_possible = 20 AND assignment_id IN 
        (SELECT assignment_id FROM assignments_ref WHERE assignment_type = 'word_cloud' AND age = 'Classical')`);
      const grCount = grCheck[0] ? grCheck[0].values[0][0] : 0;
      if (grCount > 0) {
        db.run(`UPDATE grade_records SET points_possible = 12, points_earned = MIN(points_earned, 12) WHERE assignment_id IN 
          (SELECT assignment_id FROM assignments_ref WHERE assignment_type = 'word_cloud' AND age = 'Classical')`);
        console.log(`✅ Fixed ${grCount} grade records: word cloud points_possible → 12`);
      }
    } catch (err) {
      console.log('Word cloud migration note:', err.message);
    }

    // Ensure ALL 14 Classical bonus assignments exist in production
    // Always runs - Set-based dedup prevents duplicates
    try {
      let existingNames = new Set();
      let existingCount = 0;
      try {
        const existing = db.exec("SELECT display_name FROM assignments_ref WHERE section = 'bonus' AND age = 'Classical'");
        if (existing[0]) {
          existingCount = existing[0].values.length;
          existing[0].values.forEach(row => existingNames.add(row[0]));
        }
      } catch(e) {}
      console.log(`📝 Classical bonuses: ${existingCount} rows, ${existingNames.size} unique names`);
      console.log(`  Existing: [${Array.from(existingNames).join('] [')}]`);
      
      // Fix existing rows: update assignment_type from 'bonus' to unique slugs
      const typeMap = {
        'Pandora Retelling': 'bonus_retelling',
        "Pandora's Box 2026": 'bonus_box2026',
        "Phaethon's Caution": 'bonus_caution_poem',
        'Orpheus New Ending': 'bonus_new_ending',
        'Narcissus Cautionary Tale': 'bonus_ct_narcissus',
        'Icarus Cautionary Tale': 'bonus_ct_icarus',
        'Eros and Psyche Cautionary Tale': 'bonus_ct_psyche',
        'I, Icarus': 'bonus_i_icarus',
        'Eros and Psyche Character Study': 'bonus_char_study',
        'Constellation Story': 'bonus_constellation',
        'Echo and Narcissus Metamorphosis': 'bonus_metamorphosis',
        'Morals': 'bonus_morals_cross',
        'Three Word Description': 'bonus_three_word',
        'Eros and Psyche Morals': 'bonus_morals_ep'
      };
      let updated = 0;
      for (const [displayName, newType] of Object.entries(typeMap)) {
        try {
          const check = db.exec(`SELECT assignment_id, assignment_type FROM assignments_ref WHERE display_name = '${displayName.replace(/'/g, "''")}' AND age = 'Classical' AND section = 'bonus' AND assignment_type = 'bonus'`);
          if (check[0] && check[0].values.length > 0) {
            const id = check[0].values[0][0];
            db.run(`UPDATE assignments_ref SET assignment_type = '${newType}' WHERE assignment_id = ${id}`);
            console.log(`  ~ Updated type: ${displayName} → ${newType}`);
            updated++;
          }
        } catch(e) {}
      }
      if (updated > 0) console.log(`  Fixed ${updated} existing assignment_type values`);
      {
        const allClassicalBonuses = [
          ['bonus', 'bonus_retelling', 'Pandora', 'Pandora Retelling', 20,
            'Use one of the paintings in the provided link that you find the most expressive and make a retelling of Pandora\'s myth that matches the tone and idea of the painting. Write your story based on the painting you choose.',
            JSON.stringify([{label: "Pandora Paintings (Link Coming Soon)", url: null}]), 1, 'Classical'],
          ['bonus', 'bonus_box2026', 'Pandora (Box)', 'Pandora\'s Box 2026', 50,
            'Create a new box that will release emotion into the world. Follow the directions to earn credit for your Pandora\'s Box 2026. This is a major creative project worth 50 points.',
            JSON.stringify([{label: "Pandora\'s Box Directions (Link Coming Soon)", url: null}]), 1, 'Classical'],
          ['bonus', 'bonus_caution_poem', 'Phaethon', 'Phaethon\'s Caution', 15,
            'A cautionary poem tells a story with dire consequences in order to show readers what to avoid. Write a cautionary poem about Phaethon\'s ride across the sky in his father\'s sun chariot. Your poem should warn readers about the dangers of hubris and ignoring wise counsel.',
            JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
          ['bonus', 'bonus_new_ending', 'Orpheus', 'Orpheus New Ending', 20,
            'Have you ever wished that you could undo something that you had done? Would you do it differently if you had another opportunity to try again? Give Orpheus a second chance by changing the outcome of his tragic trip through Tartarus. Write a new ending for Orpheus and Eurydice.',
            JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
          ['bonus', 'bonus_i_icarus', 'Icarus', 'I, Icarus', 20,
            'Pass the challenge of I, Icarus and create a new myth for your land. Use the story of Icarus and Daedalus as inspiration to craft an original myth about innovation, ambition, and the limits of human achievement.',
            JSON.stringify([{label: "I, Icarus Challenge (Link Coming Soon)", url: null}]), 1, 'Classical'],
          ['bonus', 'bonus_char_study', 'Eros and Psyche', 'Eros and Psyche Character Study', 15,
            'Using a chart, list 10 Greek gods, goddesses or other characters you learned about in your readings and generalize, or draw a conclusion, about the qualities of each. Choose three words to describe each character and use details from the text to support your thinking.',
            JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
          ['bonus', 'bonus_constellation', 'Constellations', 'Constellation Story', 20,
            'Using the questions at the bottom of your note taking sheet you will write the story of your constellation. Create an original myth explaining how a constellation came to be in the night sky.',
            JSON.stringify([{label: "Note Taking Sheet (Link Coming Soon)", url: null}]), 1, 'Classical'],
          ['bonus', 'bonus_metamorphosis', 'Echo and Narcissus', 'Echo and Narcissus Metamorphosis', 15,
            'Greek myths, like Athena and Arachne, often feature a mortal who is transformed into a nonhuman creature because of pride. Into what would you turn a person who is spiteful? lazy? loud? Read the directions so that you understand how to present your ideas and make it clear what you are showing.',
            JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
          ['bonus', 'bonus_morals_cross', 'Morals', 'Morals', 5,
            '"Arachne" has a clear moral, best summed up in Athena\'s final statement to Arachne: "...it is not wise to strive with [gods/goddesses]." Look at the myths about Persephone trapped in the Underworld and Narcissus and Echo and write a moral that best states the themes of these two tales. Explain how the story creates this moral.',
            JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
          ['bonus', 'bonus_ct_narcissus', 'Echo and Narcissus', 'Narcissus Cautionary Tale', 15,
            'A cautionary tale tells a story with dire consequences to warn readers about dangerous behavior. Write a cautionary tale inspired by the myth of Echo and Narcissus that warns about the dangers of self-obsession and ignoring the people who care about you.',
            JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
          ['bonus', 'bonus_ct_icarus', 'Icarus', 'Icarus Cautionary Tale', 15,
            'A cautionary tale tells a story with dire consequences to warn readers about dangerous behavior. Write a cautionary tale inspired by the myth of Icarus that warns about the dangers of ignoring wise counsel and pushing past safe limits.',
            JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
          ['bonus', 'bonus_ct_psyche', 'Eros and Psyche', 'Eros and Psyche Cautionary Tale', 15,
            'A cautionary tale tells a story with dire consequences to warn readers about dangerous behavior. Write a cautionary tale inspired by the myth of Eros and Psyche that warns about the dangers of jealousy, distrust, or letting fear destroy something good.',
            JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
          ['bonus', 'bonus_three_word', 'Eros and Psyche', 'Three Word Description', 15,
            'Choose 10 Greek gods, goddesses, or other characters you learned about in your readings. For each character, choose three words that describe them and use specific details from the text to support your thinking. Defend your word choices with evidence.',
            JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
          ['bonus', 'bonus_morals_ep', 'Eros and Psyche', 'Eros and Psyche Morals', 10,
            'Analyze the moral lessons found in the myth of Eros and Psyche. What does the story teach us about love, trust, jealousy, and forgiveness? Write a clear explanation of at least two morals from this myth using evidence from the text.',
            JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical']
        ];
        const requiredNames = allClassicalBonuses.map(a => a[3]);
        const missingNames = requiredNames.filter(n => !existingNames.has(n));
        console.log(`  Missing (${missingNames.length}): ${missingNames.length > 0 ? missingNames.join(', ') : 'none'}`);
        
        let added = 0;
        allClassicalBonuses.forEach(a => {
          const displayName = a[3];
          if (!existingNames.has(displayName)) {
            try {
              const stmt = db.prepare('INSERT INTO assignments_ref (section, assignment_type, myth_god, display_name, max_points, description, resource_links, is_bonus, age) VALUES (?,?,?,?,?,?,?,?,?)');
              stmt.run(a);
              stmt.free();
              console.log(`  + Inserted: ${displayName} (${a[4]} pts)`);
              added++;
            } catch (insertErr) {
              console.log(`  ✗ FAILED to insert ${displayName}: ${insertErr.message}`);
            }
          }
        });
        if (added > 0) {
          console.log(`✅ Classical bonuses: added ${added} new assignments`);
        } else {
          console.log(`✅ Classical bonuses: all 14 present`);
        }
      }
    } catch (err) {
      console.log('Classical bonus migration note:', err.message);
    }
    
    console.log('✅ Migrations complete');
  } catch (err) {
    console.log('Migration note:', err.message);
  }
  
  // Battle Arena migrations
  try {
    // Add Prometheus daily usage tracking to arena_battle_stats
    const statsCols = db.exec("PRAGMA table_info(arena_battle_stats)");
    const statsColNames = statsCols[0] ? statsCols[0].values.map(c => c[1]) : [];
    
    if (!statsColNames.includes('prometheus_used_date')) {
      console.log('  Adding prometheus_used_date column to arena_battle_stats...');
      db.run('ALTER TABLE arena_battle_stats ADD COLUMN prometheus_used_date DATE');
    }
    
    // Add god cooldowns and deployment tracking to arena_battles
    const battleCols = db.exec("PRAGMA table_info(arena_battles)");
    const battleColNames = battleCols[0] ? battleCols[0].values.map(c => c[1]) : [];
    
    if (!battleColNames.includes('challenger_god_cooldowns')) {
      console.log('  Adding challenger_god_cooldowns column to arena_battles...');
      db.run("ALTER TABLE arena_battles ADD COLUMN challenger_god_cooldowns TEXT DEFAULT '{}'");
    }
    if (!battleColNames.includes('defender_god_cooldowns')) {
      console.log('  Adding defender_god_cooldowns column to arena_battles...');
      db.run("ALTER TABLE arena_battles ADD COLUMN defender_god_cooldowns TEXT DEFAULT '{}'");
    }
    
    // Add god deployment tracking to arena_battle_rounds
    const roundCols = db.exec("PRAGMA table_info(arena_battle_rounds)");
    const roundColNames = roundCols[0] ? roundCols[0].values.map(c => c[1]) : [];
    
    if (!roundColNames.includes('challenger_god_deployed')) {
      console.log('  Adding challenger_god_deployed column to arena_battle_rounds...');
      db.run('ALTER TABLE arena_battle_rounds ADD COLUMN challenger_god_deployed TEXT');
    }
    if (!roundColNames.includes('defender_god_deployed')) {
      console.log('  Adding defender_god_deployed column to arena_battle_rounds...');
      db.run('ALTER TABLE arena_battle_rounds ADD COLUMN defender_god_deployed TEXT');
    }
    if (!roundColNames.includes('challenger_god_blocked')) {
      console.log('  Adding challenger_god_blocked column to arena_battle_rounds...');
      db.run('ALTER TABLE arena_battle_rounds ADD COLUMN challenger_god_blocked INTEGER DEFAULT 0');
    }
    if (!roundColNames.includes('defender_god_blocked')) {
      console.log('  Adding defender_god_blocked column to arena_battle_rounds...');
      db.run('ALTER TABLE arena_battle_rounds ADD COLUMN defender_god_blocked INTEGER DEFAULT 0');
    }
    if (!roundColNames.includes('artemis_bonus_challenger')) {
      console.log('  Adding artemis_bonus columns to arena_battle_rounds...');
      db.run('ALTER TABLE arena_battle_rounds ADD COLUMN artemis_bonus_challenger REAL DEFAULT 0');
      db.run('ALTER TABLE arena_battle_rounds ADD COLUMN artemis_bonus_defender REAL DEFAULT 0');
    }
    // Add phase tracking for synchronized gameplay
    if (!roundColNames.includes('phase')) {
      console.log('  Adding phase column to arena_battle_rounds...');
      db.run("ALTER TABLE arena_battle_rounds ADD COLUMN phase TEXT DEFAULT 'deploy'"); // deploy, question, results
    }
    if (!roundColNames.includes('phase_ends_at')) {
      console.log('  Adding phase_ends_at column to arena_battle_rounds...');
      db.run('ALTER TABLE arena_battle_rounds ADD COLUMN phase_ends_at DATETIME');
    }
    if (!roundColNames.includes('challenger_deploy_ready')) {
      console.log('  Adding deploy ready columns to arena_battle_rounds...');
      db.run('ALTER TABLE arena_battle_rounds ADD COLUMN challenger_deploy_ready INTEGER DEFAULT 0');
      db.run('ALTER TABLE arena_battle_rounds ADD COLUMN defender_deploy_ready INTEGER DEFAULT 0');
    }
    // Add question_starts_at for synchronized question start times
    if (!roundColNames.includes('question_starts_at')) {
      console.log('  Adding question_starts_at column to arena_battle_rounds...');
      db.run('ALTER TABLE arena_battle_rounds ADD COLUMN question_starts_at DATETIME');
    }
    // Add question display sync - tracks when each client has acknowledged the question
    if (!roundColNames.includes('challenger_question_ready')) {
      console.log('  Adding question ready columns to arena_battle_rounds...');
      db.run('ALTER TABLE arena_battle_rounds ADD COLUMN challenger_question_ready INTEGER DEFAULT 0');
      db.run('ALTER TABLE arena_battle_rounds ADD COLUMN defender_question_ready INTEGER DEFAULT 0');
      db.run('ALTER TABLE arena_battle_rounds ADD COLUMN question_display_time DATETIME');
    }
    
    // Add god selection ready flags to arena_battles
    if (!battleColNames.includes('challenger_gods_ready')) {
      console.log('  Adding gods ready columns to arena_battles...');
      db.run('ALTER TABLE arena_battles ADD COLUMN challenger_gods_ready INTEGER DEFAULT 0');
      db.run('ALTER TABLE arena_battles ADD COLUMN defender_gods_ready INTEGER DEFAULT 0');
    }
    
    console.log('✅ Battle Arena migrations complete');
  } catch (err) {
    console.log('Battle Arena migration note:', err.message);
  }

  // Classical Age migrations
  try {
    // Add classical columns to alliances
    const allianceCols = db.exec("PRAGMA table_info(alliances)");
    const allianceColNames = allianceCols[0] ? allianceCols[0].values.map(c => c[1]) : [];
    
    if (!allianceColNames.includes('prometheus_cards')) {
      console.log('  Adding prometheus_cards column to alliances...');
      db.run('ALTER TABLE alliances ADD COLUMN prometheus_cards INTEGER DEFAULT 0');
    }
    
    // Add classical_entered to students
    const studentCols = db.exec("PRAGMA table_info(students)");
    const studentColNames = studentCols[0] ? studentCols[0].values.map(c => c[1]) : [];
    
    if (!studentColNames.includes('classical_entered')) {
      console.log('  Adding classical_entered column to students...');
      db.run('ALTER TABLE students ADD COLUMN classical_entered INTEGER DEFAULT 0');
    }
    
    console.log('✅ Classical Age migrations complete');
  } catch (err) {
    console.log('Classical Age migration note:', err.message);
  }

  // Fix myth_portal_status: if it has alliance_id (from bad migration), recreate with class_period
  try {
    const mpsCols = db.exec("PRAGMA table_info(myth_portal_status)");
    const mpsColNames = mpsCols[0] ? mpsCols[0].values.map(c => c[1]) : [];
    
    if (mpsColNames.includes('alliance_id') && !mpsColNames.includes('class_period')) {
      console.log('🔄 Fixing myth_portal_status: alliance_id → class_period...');
      // Table has no real data yet (no portals activated), safe to recreate
      db.run('DROP TABLE IF EXISTS myth_portal_status');
      db.run(`CREATE TABLE myth_portal_status (
        status_id INTEGER PRIMARY KEY AUTOINCREMENT,
        portal_id INTEGER NOT NULL,
        class_period TEXT NOT NULL,
        activated INTEGER DEFAULT 0,
        activated_at DATETIME,
        activated_by INTEGER,
        FOREIGN KEY (portal_id) REFERENCES myth_portals(portal_id),
        UNIQUE(portal_id, class_period)
      )`);
      console.log('✅ myth_portal_status fixed to use class_period');
    }
  } catch (err) {
    console.log('myth_portal_status fix note:', err.message);
  }
  
  // Side quest age column migration
  try {
    const sqCols = db.exec("PRAGMA table_info(side_quests_ref)");
    const sqColNames = sqCols[0] ? sqCols[0].values.map(c => c[1]) : [];
    
    if (!sqColNames.includes('age')) {
      console.log('  Adding age column to side_quests_ref...');
      db.run("ALTER TABLE side_quests_ref ADD COLUMN age TEXT DEFAULT 'Archaic'");
      db.run("UPDATE side_quests_ref SET age = 'Archaic' WHERE age IS NULL");
    }
    
    // Ensure assignments_ref has age column
    const arCols = db.exec("PRAGMA table_info(assignments_ref)");
    const arColNames = arCols[0] ? arCols[0].values.map(c => c[1]) : [];
    if (!arColNames.includes('age')) {
      console.log('  Adding age column to assignments_ref...');
      db.run("ALTER TABLE assignments_ref ADD COLUMN age TEXT DEFAULT 'Archaic'");
      db.run("UPDATE assignments_ref SET age = 'Archaic' WHERE age IS NULL");
      console.log('✅ assignments_ref age column added');
    }
    
    // Seed Hearth of Hestia if not exists
    const hestiaCheck = db.exec("SELECT COUNT(*) FROM side_quests_ref WHERE quest_name = 'Hearth of Hestia'");
    const hestiaExists = hestiaCheck[0] && hestiaCheck[0].values[0][0] > 0;
    if (!hestiaExists) {
      console.log('  Seeding Hearth of Hestia side quest...');
      db.run(`INSERT INTO side_quests_ref (quest_name, god_associated, description, reward_type, reward_name, reward_description, form_url, icon, age) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ['Hearth of Hestia', 'Hestia', 'Hestia, goddess of the hearth, has let her sacred flame grow dim. Without it, your city-state has no center — no warmth, no unity, no home. Journey to rekindle the flame and prove your alliance is worthy of her blessing.', 'technology', 'Sacred Flame', '+8% alliance point bonus (always active)', 'https://forms.gle/Sbz9rVbHXRJExtPd6', '🔥', 'Classical']
      );
      console.log('✅ Hearth of Hestia seeded');
    }
    
    // Seed Sacred Flame technology if not exists
    const sacredFlameCheck = db.exec("SELECT COUNT(*) FROM technologies_ref WHERE tech_name = 'Sacred Flame'");
    const sacredFlameExists = sacredFlameCheck[0] && sacredFlameCheck[0].values[0][0] > 0;
    if (!sacredFlameExists) {
      db.run(`INSERT INTO technologies_ref (tech_name, bonus_type, bonus_value, specific_assignment_type, cost_description, god_associated, age_available, description) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ['Sacred Flame', 'earning_multiplier', 0.08, null, 'Complete Hestia side quest', 'Hestia', 'Classical', 'Hestia\'s sacred flame warms your city-state. +8% alliance point bonus.']
      );
      console.log('✅ Sacred Flame technology seeded');
    }
  } catch (err) {
    console.log('Side quest migration note:', err.message);
  }
}

function seedReferenceData() {
  console.log('🌱 Checking database seed status...');
  
  // Check what's already seeded
  const buildingsCheck = db.exec('SELECT COUNT(*) as count FROM buildings_ref');
  const buildingsExist = buildingsCheck[0] && buildingsCheck[0].values[0][0] > 0;
  
  const choicesCheck = db.exec('SELECT COUNT(*) as count FROM fate_choices');
  const choicesExist = choicesCheck[0] && choicesCheck[0].values[0][0] > 0;
  
  // Check for side quests
  let sideQuestsExist = false;
  try {
    const sideQuestsCheck = db.exec('SELECT COUNT(*) as count FROM side_quests_ref');
    sideQuestsExist = sideQuestsCheck[0] && sideQuestsCheck[0].values[0][0] > 0;
  } catch (e) {
    sideQuestsExist = false;
  }
  
  // ==================== MIGRATIONS ====================
  // Add wall_points column to students if it doesn't exist
  try {
    db.exec('SELECT wall_points FROM students LIMIT 1');
  } catch (e) {
    console.log('🔧 Adding wall_points column to students table...');
    db.run('ALTER TABLE students ADD COLUMN wall_points TEXT');
    console.log('✅ wall_points column added');
  }
  
  // Fix Exit Ticket max points (was 5, should be 2)
  // V91 FIX: Changed assignment_name to display_name (correct column name)
  try {
    db.run("UPDATE assignments_ref SET max_points = 2 WHERE display_name = 'Exit Ticket'");
    // Fix ALL pending quiz submissions with max_points=5 where description mentions EXIT TICKET
    db.run("UPDATE point_submissions SET max_points = 2 WHERE max_points = 5 AND UPPER(description) LIKE '%EXIT%TICKET%'");
    // And fix any grade records
    db.run("UPDATE grade_records SET points_possible = 2 WHERE assignment_id IN (SELECT assignment_id FROM assignments_ref WHERE display_name = 'Exit Ticket')");
    console.log('✅ Exit Ticket max points updated to 2');
  } catch (e) {
    console.log('Migration note: Exit Ticket update -', e.message);
  }
  
  // Update Demeter question wording
  try {
    db.run("UPDATE battle_questions SET question_text = 'The main purpose of the Demeter myth is to...' WHERE question_text = 'The main purpose of this myth is to...' AND god_associated = 'Demeter'");
    console.log('✅ Demeter question updated');
  } catch (e) {
    console.log('Migration note: Demeter question -', e.message);
  }
  // Trade system schema migration: add resource_threshold, create resource_buys
  try {
    const twCols = db.exec("PRAGMA table_info(trade_window)");
    const twColNames = twCols[0] ? twCols[0].values.map(c => c[1]) : [];
    if (!twColNames.includes('resource_threshold')) {
      db.run("ALTER TABLE trade_window ADD COLUMN resource_threshold INTEGER DEFAULT 500");
      console.log('✅ Added resource_threshold column to trade_window');
    }
  } catch (e) { console.log('Migration note: trade_window threshold -', e.message); }
  
  try {
    db.run(`CREATE TABLE IF NOT EXISTS resource_buys (
      buy_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      alliance_id INTEGER NOT NULL,
      resource_type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      points_spent INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
  } catch (e) { console.log('Migration note: resource_buys -', e.message); }

  // V91 FIX: Classical Age building prices increased by 55%
  try {
    db.run("UPDATE buildings_ref SET cost_points = 341 WHERE building_name = 'Transport Ship' AND cost_points IN (220, 308)");
    db.run("UPDATE buildings_ref SET cost_points = 465 WHERE building_name = 'Armory' AND cost_points IN (300, 420)");
    db.run("UPDATE buildings_ref SET cost_points = 186 WHERE building_name = 'Theater' AND cost_points IN (120, 168)");
    db.run("UPDATE buildings_ref SET cost_points = 124 WHERE building_name = 'Agora' AND cost_points IN (80, 112)");
    db.run("UPDATE buildings_ref SET cost_points = 232 WHERE building_name = 'Oracle' AND cost_points IN (150, 210)");
    console.log('✅ Classical Age building prices increased by 55%');
  } catch (e) {
    console.log('Migration note: Classical building price update -', e.message);
  }

  // V91 FIX: Reduce Archaic tech bonuses from 10% to 3% (beta year rebalancing)
  try {
    db.run("UPDATE technologies_ref SET bonus_value = 0.03, description = 'Improves gold gather rate by +3%' WHERE tech_name = 'Pickaxe' AND bonus_value = 0.10");
    db.run("UPDATE technologies_ref SET bonus_value = 0.03, description = 'Increases wood gather rate by +3%' WHERE tech_name = 'Handaxe' AND bonus_value = 0.10");
    db.run("UPDATE technologies_ref SET bonus_value = 0.03, description = 'Increases hunting rate by +3%' WHERE tech_name = 'Hunting Dogs' AND bonus_value = 0.10");
    db.run("UPDATE technologies_ref SET bonus_value = 0.03, description = 'Increases food production by +3%' WHERE tech_name = 'Husbandry' AND bonus_value = 0.10");
    console.log('✅ Archaic tech bonuses reduced from 10% to 3%');
  } catch (e) {
    console.log('Migration note: tech bonus update -', e.message);
  }

  // V91 FIX: Prometheus BioPoem bonus increased from 5 to 10 points
  try {
    db.run("UPDATE assignments_ref SET max_points = 10 WHERE section = 'bonus' AND myth_god = 'Prometheus' AND assignment_type = 'bonus'");
    db.run(`UPDATE grade_records SET points_earned = 10 WHERE points_earned = 5 AND assignment_id IN (SELECT assignment_id FROM assignments_ref WHERE section = 'bonus' AND myth_god = 'Prometheus' AND assignment_type = 'bonus')`);
    // Award +5 correction to alliances where a student got bumped
    const affected = db.prepare(`
      SELECT DISTINCT s.alliance_id, gr.student_id
      FROM grade_records gr
      JOIN students s ON gr.student_id = s.student_id
      WHERE gr.points_earned = 10
      AND gr.assignment_id IN (SELECT assignment_id FROM assignments_ref WHERE section = 'bonus' AND myth_god = 'Prometheus' AND assignment_type = 'bonus')
      AND s.alliance_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM point_transactions pt WHERE pt.student_id = gr.student_id AND pt.reason LIKE '%Prometheus BioPoem retroactive%'
      )
    `).all();
    let correctedCount = 0;
    for (const row of affected) {
      db.prepare("INSERT INTO point_transactions (alliance_id, student_id, amount, category, reason) VALUES (?, ?, 5, 'extra_credit', 'Prometheus BioPoem retroactive correction: 5to10 pts')").run(row.alliance_id, row.student_id);
      db.prepare("UPDATE alliances SET total_points = total_points + 5 WHERE alliance_id = ?").run(row.alliance_id);
      correctedCount++;
    }
    console.log(`✅ Prometheus BioPoem updated to 10 pts. Retroactively corrected ${correctedCount} student(s).`);
  } catch (e) {
    console.log('Migration note: Prometheus bonus update -', e.message);
  }

  // ==================== END MIGRATIONS ====================
  
  // ==================== CLASSICAL AGE SEED DATA ====================
  // Always run Classical seeding — it has its own internal guards
  // This must be ABOVE the early return so it runs even when Archaic data exists
  seedClassicalData();
  
  if (buildingsExist && choicesExist && sideQuestsExist) {
    console.log('✅ Database already fully seeded');
    return;
  }
  
  // Seed buildings if needed
  if (!buildingsExist) {
    console.log('📦 Seeding buildings...');
    // Format: [name, cost, prereq_id, god, requires_god_assignment, max_per_alliance, age, battle_bonus, point_bonus, active_hours, cooldown_hours, always_active, required_for_age, description]
    const buildings = [
      // Town Center - 175 pts, requires Prometheus + Zeus grades, REQUIRED for Classical
      ['Town Center', 175, null, 'Zeus', 0, 1, 'Archaic', 0, 0, 0, 0, 0, 1, 'Central hub for civilization. Requires Prometheus & Zeus assignments completed. Required for Classical Age.'],
      // Library - 80 pts, +8%, requires Athena Bonus, REQUIRED for Classical
      ['Library', 80, 1, 'Athena', 1, 1, 'Archaic', 0, 0.08, 48, 72, 0, 1, 'Houses knowledge. +8% point bonus when active. Requires Athena Bonus. Required for Classical Age.'],
      // House - 40 pts, +3% each, max 4, just points, REQUIRED for Classical (at least 1)
      ['House', 40, 1, 'Hestia', 0, 4, 'Archaic', 0, 0.03, 48, 24, 0, 1, 'Population growth. +3% point bonus per house when active. Maximum 4. Required for Classical Age.'],
      // Wooden Wall - 80 pts, battle only, requires Ares Bonus, REQUIRED for Classical
      ['Wooden Wall', 80, 1, 'Ares', 1, 1, 'Archaic', 50, 0, 0, 0, 1, 1, 'Defensive structure. +50 battle bonus. Always active. Requires Ares Bonus. Required for Classical Age.'],
      // Stone Wall - 150 pts, battle only, NOT required
      ['Stone Wall', 150, 4, 'Ares', 0, 1, 'Archaic', 100, 0, 0, 0, 1, 0, 'Enhanced defense. +100 battle bonus. Always active. Replaces Wooden Wall bonus.'],
      // Dock - 50 pts, +6%, requires Poseidon Bonus, REQUIRED for Classical
      ['Dock', 50, 2, 'Poseidon', 1, 1, 'Archaic', 0, 0.06, 48, 48, 0, 1, 'Coastal trade hub. +6% point bonus when active. Requires Poseidon Bonus. Required for Classical Age.'],
      // Granary - 30 pts, requires Demeter Side Quest, reduces negative Fate outcomes
      ['Granary', 30, 2, 'Demeter', 1, 1, 'Archaic', 0, 0, 0, 0, 0, 0, 'Food storage. Reduces negative Fate outcomes by 30%. Requires Demeter Side Quest.'],
      // Storehouse - 30 pts, +4%, requires Library, NOT required
      ['Storehouse', 30, 2, 'Apollo', 0, 1, 'Archaic', 0, 0.04, 48, 48, 0, 0, 'Resource storage. +4% point bonus when active. Requires Library.'],
      // Fishing Ship - 50 pts, +10%, requires Dock, REQUIRED for Classical
      ['Fishing Ship', 50, 6, 'Poseidon', 0, 1, 'Archaic', 0, 0.10, 24, 12, 0, 1, 'Maritime gathering. +10% point bonus when active. Requires Dock. Required for Classical Age.']
    ];

    buildings.forEach(b => {
      db.run(`INSERT INTO buildings_ref (building_name, cost_points, prerequisite_building_id, god_associated, requires_god_assignment, max_per_alliance, age_available, battle_bonus, point_bonus, active_duration_hours, cooldown_hours, always_active, required_for_age, description) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, b);
    });
    console.log('✅ Buildings seeded');
    
    // Seed technologies
    console.log('⚙️  Seeding technologies...');
    const technologies = [
      ['Olympic Parentage', 'earning_multiplier', 0.10, null, 'Complete Zeus extra credit', 'Zeus', 'Archaic', 'Increases defense by +10%'],
      ['Lord of Horses', 'earning_multiplier', 0.10, null, 'Complete Poseidon extra credit', 'Poseidon', 'Archaic', 'Increases attack/earning by +10%'],
      ['Vaults of Erebus', 'earning_multiplier', 0.15, 'membean', 'Complete Hades quiz and map', 'Hades', 'Archaic', 'Increases Membean scores by +15%'],
      ['Pickaxe', 'earning_multiplier', 0.03, null, 'Complete Hephaestus side quest', 'Hephaestus', 'Archaic', 'Improves gold gather rate by +3%'],
      ['Handaxe', 'earning_multiplier', 0.03, null, 'Complete Artemis side quest', 'Artemis', 'Archaic', 'Increases wood gather rate by +3%'],
      ['Hunting Dogs', 'earning_multiplier', 0.03, null, 'Build Storehouse', 'Artemis', 'Archaic', 'Increases hunting rate by +3%'],
      ['Husbandry', 'earning_multiplier', 0.03, null, 'Build Granary', 'Hermes', 'Archaic', 'Increases food production by +3%']
    ];

    technologies.forEach(t => {
      db.run(`INSERT INTO technologies_ref (tech_name, bonus_type, bonus_value, specific_assignment_type, cost_description, god_associated, age_available, description) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, t);
    });
    console.log('✅ Technologies seeded');

    // Seed Side Quests (if not already seeded)
    if (!sideQuestsExist) {
      console.log('🗺️  Seeding side quests...');
      const sideQuests = [
        // Format: [quest_name, god_associated, description, reward_type, reward_name, reward_description, form_url, icon]
        ['The Ring of Many', 'Hephaestus', 'A powerful ring forged by Hephaestus has fallen from the heavens. Return it to the gods and prove your worth.', 'technology', 'Pickaxe', '-10% cost on all building purchases', 'https://docs.google.com/forms/d/1GmU7Etpre0In5GXWcEy-Xlbsae5PdsW_0DcHlq0g-6s/viewform', '🔨'],
        ['Panacea\'s Remedy', 'Artemis', 'One of Artemis\' nymphs has been injured by Echidna. Journey to find Panacea\'s remedy to save her.', 'technology', 'Handaxe', '+5% on all points earned', 'https://docs.google.com/forms/d/1sxZVm3NP5w5mn1zGg1I2CsaT2cFUIh0eBjPricwXWmQ/viewform', '🏹'],
        ['The Three Seeds', 'Demeter', 'When Hades stole Persephone, she dropped three seeds. Find them and return them to Demeter.', 'building_unlock', 'Granary', 'Unlocks Granary building (-30% negative Fate outcomes)', 'https://docs.google.com/forms/d/1RfocW-Bzl-ajEaaOgPzIcFR-RueCe1S6qjCk32bGd-w/viewform', '🌾']
      ];

      sideQuests.forEach(sq => {
        db.run(`INSERT INTO side_quests_ref (quest_name, god_associated, description, reward_type, reward_name, reward_description, form_url, icon) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, sq);
      });
      console.log('✅ Side quests seeded');
    }
    
    // Fix side quest icons for existing databases (emoji update)
    db.run("UPDATE side_quests_ref SET icon = '🔨' WHERE quest_name = 'The Ring of Many' AND icon != '🔨'");
    db.run("UPDATE side_quests_ref SET icon = '🏹' WHERE quest_name = 'Panacea''s Remedy' AND icon != '🏹'");

    // Seed Fates (20 Archaic Age fates) - MUST be in order 1-20 so fate_id = fate_number
    console.log('🎲 Seeding fates...');
    const fates = [
    // Fate 1: Aphrodite's Delight (POSITIVE)
    [1, "Aphrodite's Delight", 'choice', "Aphrodite is delighted by the harmony and evidence of love in your country. You are awarded for your unity and the remarkable beauty of your citizens.", 'Aphrodite', null, null, 0, 0, null, 0, null, null, null, null, 'Archaic'],
    // Fate 2: Apollo's Favor (POSITIVE)
    [2, "Apollo's Favor", 'choice', "Apollo is pleased by the skills your people show while playing the lyre, dancing and healing the sick. He directs the sun to shine on your country and your crops thrive.", 'Apollo', null, null, 0, 0, null, 0, null, null, null, null, 'Archaic'],
    // Fate 3: Ares' Displeasure (NEGATIVE)
    [3, "Ares' Displeasure", 'choice', "Ares is displeased with the cowardice of your warriors. He also noticed some treachery among your leaders.", 'Ares', null, null, 0, 0, null, 0, null, null, null, null, 'Archaic'],
    // Fate 4: Athena's Pride (POSITIVE)
    [4, "Athena's Pride", 'choice', "Athena is justly proud of the intellectual pursuits in your country, especially your scholars' work in vocabulary and reading.", 'Athena', null, null, 0, 0, null, 0, null, null, null, null, 'Archaic'],
    // Fate 5: Zeus's Thunderstorm (NEGATIVE)
    [5, "Zeus's Thunderstorm", 'choice', "Zeus sends thunderstorms to extinguish your fires. Your village must weather the storm!", 'Zeus', null, null, 0, 0, null, 0, null, null, null, null, 'Archaic'],
    // Fate 6: Artemis' Sadness (NEGATIVE)
    [6, "Artemis' Sadness", 'choice', "Artemis is saddened by the poor care you have given your forests and animals.", 'Artemis', null, null, 0, 0, null, 0, null, null, null, null, 'Archaic'],
    // Fate 7: Demeter's Gratitude (POSITIVE)
    [7, "Demeter's Gratitude", 'choice', "Demeter is gratified by your country's diligence in tilling the soil and tending to the fields.", 'Demeter', null, null, 0, 0, null, 0, null, null, null, null, 'Archaic'],
    // Fate 8: Taraxippus Ghost (BATTLE)
    [8, "Taraxippus Ghost", 'battle', "A ghost haunts your village, frightening horses and preventing your advancement!", 'Artemis', null, null, 0, 0, null, 1, 0.80, 20, -20, "A taraxippus is haunting your village.", 'Archaic'],
    // Fate 9: Countdown Your Fate (SPECIAL)
    [9, "Countdown Your Fate", 'special', "The fates have decreed a game of wit and strategy!", 'The Moirai', null, null, 0, 0, null, 0, null, null, null, null, 'Archaic'],
    // Fate 10: Hephaestus' Forge (POSITIVE)
    [10, "Hephaestus' Forge", 'choice', "Hephaestus is pleased with the quality metals and supplies your people have brought to his forge. He considers blessing your craftsmen!", 'Hephaestus', null, null, 0, 0, null, 0, null, null, null, null, 'Archaic'],
    // Fate 11: Dionysus' Celebration (POSITIVE)
    [11, "Dionysus' Celebration", 'choice', "Dionysus is delighted by the outstanding dramatic performances and festivals your country has presented.", 'Dionysus', null, null, 0, 0, null, 0, null, null, null, null, 'Archaic'],
    // Fate 12: Reverse Card (SPECIAL)
    [12, "Reverse Card", 'special', "You have drawn a Reverse Card! Save it to turn a future negative fate into positive points.", 'The Moirai', null, null, 0, 0, null, 0, null, null, null, null, 'Archaic'],
    // Fate 13: Hera's Distress (NEGATIVE)
    [13, "Hera's Distress", 'choice', "Hera is distraught over the numbers of divorces and troublesome children in your country.", 'Hera', null, null, 0, 0, null, 0, null, null, null, null, 'Archaic'],
    // Fate 14: Persian Invaders (BATTLE)
    [14, "Persian Invaders", 'battle', "Invaders from Persia land on your beach to steal your fire. Defend yourself!", 'Ares', null, null, 0, 0, null, 1, 0.80, 20, -20, "Use your country's points to defend against invaders.", 'Archaic'],
    // Fate 15: Poseidon's Rage (NEGATIVE)
    [15, "Poseidon's Rage", 'choice', "Poseidon is enraged over his unlucky relationships and with his son Triton's mischief. He punishes you!", 'Poseidon', null, null, 0, 0, null, 0, null, null, null, null, 'Archaic'],
    // Fate 16: Hermes' Elation (POSITIVE)
    [16, "Hermes' Elation", 'choice', "Hermes is elated over how effectively your orators and writers perform in the assembly.", 'Hermes', null, null, 0, 0, null, 0, null, null, null, null, 'Archaic'],
    // Fate 17: Cercopes Monkeys (BATTLE)
    [17, "Cercopes Monkeys", 'battle', "Chaos-causing monkeys invade! Chase them away before they steal your sandals!", 'Hermes', null, null, 0, 0, null, 1, 0.80, 20, -20, "Mischievous monkeys are causing chaos in your village.", 'Archaic'],
    // Fate 18: Zeus' Anger (NEGATIVE)
    [18, "Zeus' Anger", 'choice', "Zeus is angry for no apparent reason. Thunder and rain disrupt life in your country.", 'Zeus', null, null, 0, 0, null, 0, null, null, null, null, 'Archaic'],
    // Fate 19: Arachne's Spiders (NEGATIVE)
    [19, "Arachne's Spiders", 'choice', "Arachne's enchanted spiders have infested your textile workshops! This is a curse from Athena.", 'Athena', null, null, 0, 0, null, 0, null, null, null, null, 'Archaic'],
    // Fate 20: Apollo's Musical Duel (NEGATIVE)
    [20, "Apollo's Musical Duel", 'choice', "The satyr Marsyas has challenged your musicians and you have lost! Apollo is displeased.", 'Apollo', null, null, 0, 0, null, 0, null, null, null, null, 'Archaic']
  ];

  fates.forEach(f => {
    db.run(`INSERT INTO fates_ref (fate_number, fate_name, fate_type, description, god_associated, icon_url, point_effect, steals_from_others, gives_to_others, transfer_amount, is_battle, battle_threat_percent, battle_win_points, battle_lose_points, battle_description, age_available) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, f);
  });
    console.log('✅ Fates seeded');
  }
  
  
  // Seed fate_choices (independent check - can be added to existing databases)
  if (!choicesExist) {
    console.log('🎲 Seeding fate choices...');
    
    // Since fates are inserted in order 1-20, fate_id = fate_number
    // Format: [fate_id, risk_level, description, success_chance, success_points, failure_points]
    const fateChoices = [
      // POSITIVE FATES (Conservative max loss = -4)
      [1, 'conservative', "Accept Aphrodite's gentle blessing with gratitude", 0.85, 12, -4],
      [1, 'moderate', "Host a grand festival in Aphrodite's honor", 0.55, 24, -10],
      [1, 'aggressive', "Challenge Aphrodite to prove your beauty surpasses hers", 0.30, 48, -22],
      
      [2, 'conservative', "Accept modest tribute from other alliances", 0.85, 8, -4],
      [2, 'moderate', "Negotiate diplomatic agreements for shared resources", 0.55, 16, -8],
      [2, 'aggressive', "Demand maximum tribute as Apollo's favored", 0.30, 28, -15],
      
      [4, 'conservative', "Display your scholarly achievements humbly", 0.85, 12, -4],
      [4, 'moderate', "Challenge Athena to a contest of wisdom", 0.55, 26, -12],
      [4, 'aggressive', "Claim your intellect rivals the goddess herself", 0.30, 52, -24],
      
      [7, 'conservative', "Accept the harvest blessing with thanks", 0.85, 12, -4],
      [7, 'moderate', "Request abundant crops for the coming year", 0.55, 24, -10],
      [7, 'aggressive', "Demand eternal spring and endless harvests", 0.30, 48, -20],
      
      [10, 'conservative', "Offer humble supplies and thank Hephaestus for his craft", 0.85, 12, -4],
      [10, 'moderate', "Present rare ores and request blessed weapons", 0.55, 24, -10],
      [10, 'aggressive', "Demand Hephaestus forge you armor rivaling the gods!", 0.30, 48, -22],
      
      [11, 'conservative', "Host modest celebrations honoring Dionysus", 0.85, 12, -4],
      [11, 'moderate', "Throw a grand festival with wine and theater", 0.55, 26, -10],
      [11, 'aggressive', "Hold the wildest celebration Greece has ever seen!", 0.30, 52, -20],
      
      [16, 'conservative', "Accept Hermes' blessing for your merchants", 0.85, 12, -4],
      [16, 'moderate', "Request enhanced eloquence for your diplomats", 0.55, 24, -10],
      [16, 'aggressive', "Ask to become Hermes' personal messenger", 0.30, 48, -18],
      
      // NEGATIVE FATES (Damage control pattern)
      [3, 'conservative', "Pay tribute to appease Ares' wrath", 0.85, -8, -20],
      [3, 'moderate', "Send warriors to prove your courage", 0.55, 3, -26],
      [3, 'aggressive', "Challenge Ares to single combat!", 0.30, 22, -38],
      
      [5, 'conservative', "Seek shelter and offer prayers to Zeus", 0.85, -10, -24],
      [5, 'moderate', "Build makeshift defenses against the storm", 0.55, 0, -28],
      [5, 'aggressive', "Stand defiant in the storm and challenge Zeus!", 0.30, 20, -40],
      
      [6, 'conservative', "Plant new forests and protect wildlife", 0.85, -10, -24],
      [6, 'moderate', "Organize conservation efforts across your lands", 0.55, 0, -28],
      [6, 'aggressive', "Hunt dangerous beasts to prove your worth to Artemis", 0.30, 20, -40],
      
      [13, 'conservative', "Establish marriage counseling and strengthen families", 0.85, -10, -22],
      [13, 'moderate', "Hold family festivals to promote unity", 0.55, 2, -28],
      [13, 'aggressive', "Defy Hera - relationships should be free!", 0.30, 25, -42],
      
      [15, 'conservative', "Offer grand sacrifices to calm the sea god", 0.85, -8, -18],
      [15, 'moderate', "Send envoys to negotiate with Triton", 0.55, 4, -22],
      [15, 'aggressive', "Defy Poseidon and sail through the storm!", 0.30, 30, -35],
      
      [18, 'conservative', "Weather the storm and pray for mercy", 0.85, -12, -26],
      [18, 'moderate', "Make grand offerings to appease Zeus", 0.55, 0, -32],
      [18, 'aggressive', "Shout defiance at the sky itself!", 0.30, 28, -48],
      
      [19, 'conservative', "Evacuate and burn the infested workshops", 0.85, -8, -18],
      [19, 'moderate', "Fight the spiders with fire and steel", 0.55, 2, -24],
      [19, 'aggressive', "Challenge Arachne herself to weaving contest!", 0.30, 22, -38],
      
      [20, 'conservative', "Pay tribute and apologize for the loss", 0.85, -10, -20],
      [20, 'moderate', "Request a rematch with your best musicians", 0.55, 0, -26],
      [20, 'aggressive', "Challenge Apollo himself to prove your worth!", 0.30, 24, -40],
      
      // SPECIAL FATES (Placeholder)
      [8, 'conservative', "Battle - handled by battle system", 0.85, 0, 0],
      [8, 'moderate', "Battle - handled by battle system", 0.55, 0, 0],
      [8, 'aggressive', "Battle - handled by battle system", 0.30, 0, 0],
      
      [9, 'conservative', "Countdown - handled by teacher input", 0.85, 0, 0],
      [9, 'moderate', "Countdown - handled by teacher input", 0.55, 0, 0],
      [9, 'aggressive', "Countdown - handled by teacher input", 0.30, 0, 0],
      
      [12, 'conservative', "Reverse Card - goes to inventory", 0.85, 0, 0],
      [12, 'moderate', "Reverse Card - goes to inventory", 0.55, 0, 0],
      [12, 'aggressive', "Reverse Card - goes to inventory", 0.30, 0, 0],
      
      [14, 'conservative', "Battle - handled by battle system", 0.85, 0, 0],
      [14, 'moderate', "Battle - handled by battle system", 0.55, 0, 0],
      [14, 'aggressive', "Battle - handled by battle system", 0.30, 0, 0],
      
      [17, 'conservative', "Battle - handled by battle system", 0.85, 0, 0],
      [17, 'moderate', "Battle - handled by battle system", 0.55, 0, 0],
      [17, 'aggressive', "Battle - handled by battle system", 0.30, 0, 0]
    ];

    fateChoices.forEach(choice => {
      db.run(`INSERT INTO fate_choices (fate_id, risk_level, description, success_chance, success_points, failure_points)
              VALUES (?, ?, ?, ?, ?, ?)`, choice);
    });
    
    console.log('✅ Fate choices seeded successfully');
  } else {
    console.log('✅ Fate choices already exist');
  }

  // Seed assignments if needed
  const assignmentsCheck = db.exec('SELECT COUNT(*) as count FROM assignments_ref');
  const assignmentsExist = assignmentsCheck[0] && assignmentsCheck[0].values[0][0] > 0;
  
  if (!assignmentsExist) {
    console.log('📚 Seeding assignments...');
    
    // Format: [section, assignment_type, myth_god, display_name, max_points, description, resource_links, is_bonus, age]
    const assignments = [
      // ==================== SECTION ONE (100 pts total) ====================
      // Reading Notes (Comp Conns) - Section 1
      ['section_1', 'comp_conn', 'Greek Pantheon', 'Greek Pantheon Reading Notes', 10, 'Reading notes on the Greek Pantheon', null, 0, 'Archaic'],
      ['section_1', 'comp_conn', 'Zeus', 'Zeus Reading Notes', 10, 'Reading notes on Zeus', null, 0, 'Archaic'],
      ['section_1', 'comp_conn', 'Prometheus', 'Prometheus Reading Notes', 10, 'Reading notes on Prometheus', null, 0, 'Archaic'],
      ['section_1', 'comp_conn', 'Apollo', 'Apollo Reading Notes', 10, 'Reading notes on Apollo', null, 0, 'Archaic'],
      ['section_1', 'comp_conn', 'Athena', 'Athena Reading Notes', 10, 'Reading notes on Athena', null, 0, 'Archaic'],
      ['section_1', 'comp_conn', 'Hera', 'Hera Reading Notes', 10, 'Reading notes on Hera', null, 0, 'Archaic'],
      
      // Quizzes - Section 1
      ['section_1', 'quiz', 'Zeus', 'Zeus Quiz', 5, 'Quiz on Zeus', null, 0, 'Archaic'],
      ['section_1', 'quiz', 'Prometheus', 'Prometheus Quiz', 10, 'Quiz on Prometheus', null, 0, 'Archaic'],
      ['section_1', 'quiz', 'Nine Muses', 'Nine Muses Quiz', 10, 'Quiz on the Nine Muses', null, 0, 'Archaic'],
      ['section_1', 'quiz', 'Athena', 'Athena Quiz', 5, 'Quiz on Athena', null, 0, 'Archaic'],
      ['section_1', 'quiz', 'Hera', 'Hera Quiz', 5, 'Quiz on Hera', null, 0, 'Archaic'],
      ['section_1', 'quiz', 'Exit Ticket', 'Exit Ticket', 2, 'Exit ticket assessment', null, 0, 'Archaic'],
      
      // Mural - Section 1
      ['section_1', 'mural', 'Pixton Retelling', 'Pixton Retelling', 8, 'Comic retelling using Pixton', null, 0, 'Archaic'],
      
      // ==================== SECTION TWO ====================
      // Reading Notes (Comp Conns) - Section 2
      ['section_2', 'comp_conn', 'Aphrodite', 'Aphrodite Reading Notes', 10, 'Reading notes on Aphrodite', null, 0, 'Archaic'],
      ['section_2', 'comp_conn', 'Poseidon', 'Poseidon Reading Notes', 10, 'Reading notes on Poseidon', null, 0, 'Archaic'],
      ['section_2', 'comp_conn', 'Artemis', 'Artemis Reading Notes', 10, 'Reading notes on Artemis', null, 0, 'Archaic'],
      ['section_2', 'comp_conn', 'Demeter', 'Demeter Reading Notes', 10, 'Reading notes on Demeter', null, 0, 'Archaic'],
      ['section_2', 'comp_conn', 'Hermes', 'Hermes Reading Notes', 10, 'Reading notes on Hermes', null, 0, 'Archaic'],
      ['section_2', 'comp_conn', 'Hephaestus', 'Hephaestus Reading Notes', 10, 'Reading notes on Hephaestus', null, 0, 'Archaic'],
      
      // Quizzes - Section 2
      ['section_2', 'quiz', 'Apollo and Artemis', 'Apollo and Artemis Quiz', 5, 'Quiz on Apollo and Artemis', null, 0, 'Archaic'],
      ['section_2', 'quiz', 'Aphrodite', 'Aphrodite Quiz', 5, 'Quiz on Aphrodite', null, 0, 'Archaic'],
      ['section_2', 'quiz', 'Poseidon', 'Poseidon Quiz', 5, 'Quiz on Poseidon', null, 0, 'Archaic'],
      ['section_2', 'quiz', 'Demeter', 'Demeter Quiz', 5, 'Quiz on Demeter', null, 0, 'Archaic'],
      ['section_2', 'quiz', 'Hermes', 'Hermes Quiz', 5, 'Quiz on Hermes', null, 0, 'Archaic'],
      ['section_2', 'quiz', 'Hephaestus', 'Hephaestus Quiz', 5, 'Quiz on Hephaestus', null, 0, 'Archaic'],
      
      // Video - Section 2
      ['section_2', 'video', 'WeVideo Movie', 'WeVideo Movie', 10, 'Video retelling using WeVideo', null, 0, 'Archaic'],
      
      // ==================== BONUS / EXTRA CREDIT ====================
      ['bonus', 'bonus', 'Zeus', 'Zeus Bonus', 15, 
        'Zeus has many stories about his actions towards mortals. Using the Rick Riordan novel "Percy Jackson\'s Greek Gods" page 216 (audio version start with video 69), find three other stories about Zeus. Create a three column chart. In each column explain, using pictures and words, if you feel Zeus\'s actions in those stories were justified or not. Summarize the story in two or three sentences and then add your explanation.',
        JSON.stringify([
          {label: "Percy Jackson's Greek Gods (Book)", url: "https://anyflip.com/sbybe/wnap/basic"},
          {label: "Audio Version - Video 69", url: "https://youtu.be/U6-Nw8_zEmk?si=ayhuLeweNXdSG-dq"}
        ]), 1, 'Archaic'],
      
      ['bonus', 'bonus', 'Prometheus', 'Prometheus Bonus', 10,
        'Prometheus lives on in the history of man. Celebrate him by creating a bio poem that celebrates his story. Use the provided link to find the format and example of what is expected from your bio poem about Prometheus.',
        JSON.stringify([
          {label: "Bio Poem Format & Example", url: "https://www.readwritethink.org/sites/default/files/resources/lesson_images/lesson398/biopoem.pdf"}
        ]), 1, 'Archaic'],
      
      ['bonus', 'bonus', 'Hera', 'Hera Bonus', 15,
        'Hera is called "the queen of intriguers." Define the word intrigue (as a noun not a verb) and then find three more examples of Hera being an intriguer. Create an organizer that has Hera\'s name at the top with the definition of intrigue (noun). Then create three columns that use words and pictures to describe why Hera is the Queen of Intriguers.',
        JSON.stringify([
          {label: "Examples of Hera as Intriguer", url: "https://www.ancient.eu/Hera/"}
        ]), 1, 'Archaic'],
      
      ['bonus', 'bonus', 'Athena', 'Athena Bonus', 15,
        'Athena was a symbol of many ideals. Choose one of the four ideals and create a three column chart with Athena\'s name at the top. Use pictures and words to find three pieces of evidence to illustrate one of these ideals. Use Rick Riordan\'s "Percy Jackson\'s Greek Gods" page 245 as your source material (audio version start with video 78). The ideals to choose from are: Be skillful and wise, Speak up and be bold, Let failure be your teacher, or Expand your mind.',
        JSON.stringify([
          {label: "Percy Jackson's Greek Gods (Book)", url: "https://anyflip.com/sbybe/wnap/basic"},
          {label: "Audio Version - Video 78", url: "https://youtu.be/HbkoiiWXnww?si=GCW_RUB8jn8vVuVv"}
        ]), 1, 'Archaic'],
      
      ['bonus', 'bonus', 'Ares', 'Ares Bonus', 15,
        'Aphrodite and Ares had many children, for this assignment focus on these four: Deimos, Phobos, Harmonia and Eros. Make a four column chart, with the title being Children of Aphrodite and Ares. Make sure to leave room at the bottom of the page to answer the last comprehension question. In each column use pictures and words to describe the important attributes of each of the four children. In the space you left on the bottom, tell the reader who is the strongest of the four gods and why you believe that to be true from your life experience.',
        JSON.stringify([
          {label: "Deimos (Wikipedia)", url: "https://en.wikipedia.org/wiki/Deimos_(deity)"},
          {label: "Phobos (Wikipedia)", url: "https://en.wikipedia.org/wiki/Phobos_(mythology)"},
          {label: "Harmonia (Theoi)", url: "https://www.theoi.com/Ouranios/Harmonia.html"},
          {label: "Eros (Mr. Donn)", url: "https://greece.mrdonn.org/greekgods/eros.html"}
        ]), 1, 'Archaic'],
      
      ['bonus', 'bonus', 'Poseidon', 'Poseidon Bonus', 15,
        'Poseidon made many creatures. Design a new creature that was very useful to early Greek civilization. Use Canva to create a picture of it and write the myth of its creation. You can use the different versions of the horse myth on pages 17 and 18 of Heroes, Gods and Monsters as a template. Do not write a myth about horses but there are different versions of the story that will inspire your creation story. Make sure to conclude with how the creature was helpful to the Greeks.',
        JSON.stringify([
          {label: "Heroes, Gods and Monsters (pages 17-18)", url: null}
        ]), 1, 'Archaic'],
      
      ['bonus', 'bonus', 'Hades', 'Hades Bonus', 15,
        'Create a map of the Underworld based on the descriptions provided by Rick Riordan\'s book "Percy Jackson\'s Greek Gods" page 163 (audio version start with video 52) or use the excerpt from Edith Hamilton\'s "Mythology" pages 42-44. There are images on the internet, but Mr. Sebek has seen them all and they are not original, use your own imagination. Use the directions for making a map from Social Studies. Paper and pencil will work, however if you have another idea for creating the Underworld let Mr. Sebek know.',
        JSON.stringify([
          {label: "Percy Jackson's Greek Gods (Book)", url: "https://anyflip.com/sbybe/wnap/basic"},
          {label: "Audio Version - Video 52", url: "https://youtu.be/nu61_IT__SU?si=OmHpz4wRurcHGIg8"}
        ]), 1, 'Archaic'],
      
      ['bonus', 'bonus', 'Demeter', 'Demeter Bonus', 15,
        'Do some research on pomegranates. Why is the pomegranate such an important fruit to Greek mythology and this myth in particular? Create an advertising poster that would be used by ancient Greeks to persuade citizens to eat pomegranates. Use information from the website as well as color and persuasive writing to convince the ancients to eat more pomegranates.',
        JSON.stringify([
          {label: "Pomegranate in Ancient Greece", url: "https://greekreporter.com/2023/04/07/pomegranate-ancient-greece/"}
        ]), 1, 'Archaic'],
      
      ['bonus', 'bonus', 'Hermes', 'Hermes Bonus', 15,
        'The role of the conductor of souls to the underworld is very important. Research Egyptian mythology. Who is the conductor of souls in Egyptian mythology and how is it the same/different from Hermes? Make a two column chart and use words and pictures to compare the two.',
        JSON.stringify([
          {label: "Anubis - Conductor of Souls", url: "https://www.ancient.eu/Anubis/"}
        ]), 1, 'Archaic'],
      
      ['bonus', 'bonus', 'Hephaestus', 'Hephaestus Bonus', 15,
        'Using "Percy Jackson\'s Greek Gods" (audio version start with video 102) by Rick Riordan, explain the events in comic or poetic form that led to Hephaestus eventually forgiving Hera for throwing him down the mountain as a baby (pages 313-322). You may use Pixton or create your own panels. Make sure to include how Hephaestus chose to punish Hera, Zeus\'s reaction and the two gods it took to convince Hephaestus to forgive Hera. Also, include how this part of Hephaestus\'s story ended on page 322.',
        JSON.stringify([
          {label: "Percy Jackson's Greek Gods (Book)", url: "https://anyflip.com/sbybe/wnap/basic"},
          {label: "Audio Version - Video 102", url: "https://youtu.be/t2MZ6dQZeaA?si=jnSf_3BX1LqwFb5H"}
        ]), 1, 'Archaic'],
      
      ['bonus', 'bonus', 'Aphrodite', 'Aphrodite Bonus', 10,
        'Aphrodite was beloved by the Greeks. But not everything was great about the goddess of love and beauty. Nothing is perfect. Use "Rick Riordan\'s Greek Gods" page 271 (audio version start with video 87) to use words and pictures to illustrate two ways that Aphrodite may not have been beautiful on the inside. Make sure to make a two column chart and place Aphrodite\'s name at the top.',
        JSON.stringify([
          {label: "Percy Jackson's Greek Gods (Book)", url: "https://anyflip.com/sbybe/wnap/basic"},
          {label: "Audio Version - Video 87", url: "https://youtu.be/KS86wCZ99Go?si=4-nuFnmqE8cMigQd"}
        ]), 1, 'Archaic'],
      
      // ==================== CLASSICAL AGE ASSIGNMENTS ====================
      // Reading Notes (Comp Conns) - Classical Age
      ['classical', 'comp_conn', 'Pandora', 'Pandora Reading Guide', 12, 'Reading guide on the myth of Pandora', null, 0, 'Classical'],
      ['classical', 'comp_conn', 'Phaethon', 'Phaethon Reading Guide', 12, 'Reading guide on the myth of Phaethon', null, 0, 'Classical'],
      ['classical', 'comp_conn', 'Orpheus', 'Orpheus Reading Guide', 12, 'Reading guide on the myth of Orpheus and Eurydice', null, 0, 'Classical'],
      ['classical', 'comp_conn', 'Echo and Narcissus', 'Echo and Narcissus Reading Guide', 12, 'Reading guide on the myth of Echo and Narcissus', null, 0, 'Classical'],
      ['classical', 'comp_conn', 'Icarus', 'Icarus and Daedalus Reading Guide', 12, 'Reading guide on the myth of Icarus and Daedalus', null, 0, 'Classical'],
      ['classical', 'comp_conn', 'Eros and Psyche', 'Eros and Psyche Reading Guide', 12, 'Reading guide on the myth of Eros and Psyche', null, 0, 'Classical'],
      ['classical', 'comp_conn', 'Constellations', 'Constellations Reading Guide', 12, 'Reading guide on the constellation myths (Callisto, Orion, Andromeda)', null, 0, 'Classical'],
      
      // Quizzes - Classical Age
      ['classical', 'quiz', 'Pandora', 'Pandora Quiz', 10, 'Quiz on Pandora', null, 0, 'Classical'],
      ['classical', 'quiz', 'Phaethon', 'Phaethon Quiz', 10, 'Quiz on Phaethon', null, 0, 'Classical'],
      ['classical', 'quiz', 'Orpheus', 'Orpheus Quiz', 10, 'Quiz on Orpheus and Eurydice', null, 0, 'Classical'],
      ['classical', 'quiz', 'Echo and Narcissus', 'Echo and Narcissus Quiz', 10, 'Quiz on Echo and Narcissus', null, 0, 'Classical'],
      ['classical', 'quiz', 'Icarus', 'Icarus and Daedalus Quiz', 10, 'Quiz on Icarus and Daedalus', null, 0, 'Classical'],
      ['classical', 'quiz', 'Eros and Psyche', 'Eros and Psyche Quiz', 10, 'Quiz on Eros and Psyche', null, 0, 'Classical'],
      ['classical', 'quiz', 'Constellations', 'Constellations Quiz', 10, 'Quiz on the constellation myths', null, 0, 'Classical'],
      
      // ==================== CLASSICAL AGE CREATIVE PORTFOLIO ====================
      // Pixton Comics (16 pts each) — Visual myths only
      ['classical_creative', 'mural', 'Phaethon', 'Phaethon Pixton', 16, 'Comic retelling of the Phaethon myth using Pixton', null, 0, 'Classical'],
      ['classical_creative', 'mural', 'Echo and Narcissus', 'Echo and Narcissus Pixton', 16, 'Comic retelling of Echo and Narcissus using Pixton', null, 0, 'Classical'],
      ['classical_creative', 'mural', 'Icarus', 'Icarus Pixton', 16, 'Comic retelling of Icarus and Daedalus using Pixton', null, 0, 'Classical'],
      ['classical_creative', 'mural', 'Constellations', 'Constellations Pixton', 16, 'Comic retelling of a constellation myth using Pixton', null, 0, 'Classical'],
      
      // WeVideo Digital Retellings — REMOVED per Classical Age redesign (retellings replaced by original creative work)
      
      // Word Clouds (12 pts each)
      ['classical_creative', 'word_cloud', 'Pandora', 'Pandora Word Cloud', 12, 'Word cloud capturing key themes and vocabulary from the Pandora myth', null, 0, 'Classical'],
      ['classical_creative', 'word_cloud', 'Phaethon', 'Phaethon Word Cloud', 12, 'Word cloud capturing key themes and vocabulary from the Phaethon myth', null, 0, 'Classical'],
      ['classical_creative', 'word_cloud', 'Orpheus', 'Orpheus Word Cloud', 12, 'Word cloud capturing key themes and vocabulary from the Orpheus myth', null, 0, 'Classical'],
      ['classical_creative', 'word_cloud', 'Echo and Narcissus', 'Echo and Narcissus Word Cloud', 12, 'Word cloud capturing key themes and vocabulary from Echo and Narcissus', null, 0, 'Classical'],
      ['classical_creative', 'word_cloud', 'Icarus', 'Icarus Word Cloud', 12, 'Word cloud capturing key themes and vocabulary from the Icarus myth', null, 0, 'Classical'],
      ['classical_creative', 'word_cloud', 'Eros and Psyche', 'Eros and Psyche Word Cloud', 12, 'Word cloud capturing key themes and vocabulary from Eros and Psyche', null, 0, 'Classical'],
      ['classical_creative', 'word_cloud', 'Constellations', 'Constellations Word Cloud', 12, 'Word cloud capturing key themes and vocabulary from the constellation myths', null, 0, 'Classical'],
      
      // ==================== CLASSICAL AGE BONUSES ====================
      ['bonus', 'bonus_retelling', 'Pandora', 'Pandora Retelling', 20,
        'Use one of the paintings in the provided link that you find the most expressive and make a retelling of Pandora\'s myth that matches the tone and idea of the painting. Write your story based on the painting you choose.',
        JSON.stringify([{label: "Pandora Paintings (Link Coming Soon)", url: null}]), 1, 'Classical'],
      ['bonus', 'bonus_box2026', 'Pandora (Box)', 'Pandora\'s Box 2026', 50,
        'Create a new box that will release emotion into the world. Follow the directions to earn credit for your Pandora\'s Box 2026. This is a major creative project worth 50 points.',
        JSON.stringify([{label: "Pandora's Box Directions (Link Coming Soon)", url: null}]), 1, 'Classical'],
      ['bonus', 'bonus_caution_poem', 'Phaethon', 'Phaethon\'s Caution', 15,
        'A cautionary poem tells a story with dire consequences in order to show readers what to avoid. Write a cautionary poem about Phaethon\'s ride across the sky in his father\'s sun chariot. Your poem should warn readers about the dangers of hubris and ignoring wise counsel.',
        JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
      ['bonus', 'bonus_new_ending', 'Orpheus', 'Orpheus New Ending', 20,
        'Have you ever wished that you could undo something that you had done? Would you do it differently if you had another opportunity to try again? Give Orpheus a second chance by changing the outcome of his tragic trip through Tartarus. Write a new ending for Orpheus and Eurydice.',
        JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
      ['bonus', 'bonus_i_icarus', 'Icarus', 'I, Icarus', 20,
        'Pass the challenge of I, Icarus and create a new myth for your land. Use the story of Icarus and Daedalus as inspiration to craft an original myth about innovation, ambition, and the limits of human achievement.',
        JSON.stringify([{label: "I, Icarus Challenge (Link Coming Soon)", url: null}]), 1, 'Classical'],
      ['bonus', 'bonus_char_study', 'Eros and Psyche', 'Eros and Psyche Character Study', 15,
        'Using a chart, list 10 Greek gods, goddesses or other characters you learned about in your readings and generalize, or draw a conclusion, about the qualities of each. Choose three words to describe each character and use details from the text to support your thinking.',
        JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
      ['bonus', 'bonus_constellation', 'Constellations', 'Constellation Story', 20,
        'Using the questions at the bottom of your note taking sheet you will write the story of your constellation. Create an original myth explaining how a constellation came to be in the night sky.',
        JSON.stringify([{label: "Note Taking Sheet (Link Coming Soon)", url: null}]), 1, 'Classical'],
      ['bonus', 'bonus_metamorphosis', 'Echo and Narcissus', 'Echo and Narcissus Metamorphosis', 15,
        'Greek myths, like Athena and Arachne, often feature a mortal who is transformed into a nonhuman creature because of pride. Into what would you turn a person who is spiteful? lazy? loud? Read the directions so that you understand how to present your ideas and make it clear what you are showing.',
        JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
      ['bonus', 'bonus_morals_cross', 'Morals', 'Morals', 5,
        '"Arachne" has a clear moral, best summed up in Athena\'s final statement to Arachne: "...it is not wise to strive with [gods/goddesses]." Look at the myths about Persephone trapped in the Underworld and Narcissus and Echo and write a moral that best states the themes of these two tales. Explain how the story creates this moral.',
        JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
      ['bonus', 'bonus_ct_narcissus', 'Echo and Narcissus', 'Narcissus Cautionary Tale', 15,
        'A cautionary tale tells a story with dire consequences to warn readers about dangerous behavior. Write a cautionary tale inspired by the myth of Echo and Narcissus that warns about the dangers of self-obsession and ignoring the people who care about you.',
        JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
      ['bonus', 'bonus_ct_icarus', 'Icarus', 'Icarus Cautionary Tale', 15,
        'A cautionary tale tells a story with dire consequences to warn readers about dangerous behavior. Write a cautionary tale inspired by the myth of Icarus that warns about the dangers of ignoring wise counsel and pushing past safe limits.',
        JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
      ['bonus', 'bonus_ct_psyche', 'Eros and Psyche', 'Eros and Psyche Cautionary Tale', 15,
        'A cautionary tale tells a story with dire consequences to warn readers about dangerous behavior. Write a cautionary tale inspired by the myth of Eros and Psyche that warns about the dangers of jealousy, distrust, or letting fear destroy something good.',
        JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
      ['bonus', 'bonus_three_word', 'Eros and Psyche', 'Three Word Description', 15,
        'Choose 10 Greek gods, goddesses, or other characters you learned about in your readings. For each character, choose three words that describe them and use specific details from the text to support your thinking. Defend your word choices with evidence.',
        JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical'],
      ['bonus', 'bonus_morals_ep', 'Eros and Psyche', 'Eros and Psyche Morals', 10,
        'Analyze the moral lessons found in the myth of Eros and Psyche. What does the story teach us about love, trust, jealousy, and forgiveness? Write a clear explanation of at least two morals from this myth using evidence from the text.',
        JSON.stringify([{label: "Assignment Instructions (Link Coming Soon)", url: null}]), 1, 'Classical']
    ];
    
    assignments.forEach(a => {
      db.run(`INSERT INTO assignments_ref (section, assignment_type, myth_god, display_name, max_points, description, resource_links, is_bonus, age) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, a);
    });
    
    console.log('✅ Assignments seeded');
  } else {
    console.log('✅ Assignments already exist');
    
    // Check if Classical assignments need to be added (they may not exist if Archaic was seeded before Classical code)
    try {
      const classicalCheck = db.exec("SELECT COUNT(*) FROM assignments_ref WHERE section = 'classical'");
      const classicalExists = classicalCheck[0] && classicalCheck[0].values[0][0] > 0;
      
      if (!classicalExists) {
        console.log('📚 Seeding Classical Age assignments...');
        const classicalAssignments = [
          ['classical', 'comp_conn', 'Pandora', 'Pandora Reading Guide', 12, 'Reading guide on the myth of Pandora', null, 0, 'Classical'],
          ['classical', 'comp_conn', 'Phaethon', 'Phaethon Reading Guide', 12, 'Reading guide on the myth of Phaethon', null, 0, 'Classical'],
          ['classical', 'comp_conn', 'Orpheus', 'Orpheus Reading Guide', 12, 'Reading guide on the myth of Orpheus and Eurydice', null, 0, 'Classical'],
          ['classical', 'comp_conn', 'Echo and Narcissus', 'Echo and Narcissus Reading Guide', 12, 'Reading guide on the myth of Echo and Narcissus', null, 0, 'Classical'],
          ['classical', 'comp_conn', 'Icarus', 'Icarus and Daedalus Reading Guide', 12, 'Reading guide on the myth of Icarus and Daedalus', null, 0, 'Classical'],
          ['classical', 'comp_conn', 'Eros and Psyche', 'Eros and Psyche Reading Guide', 12, 'Reading guide on the myth of Eros and Psyche', null, 0, 'Classical'],
          ['classical', 'comp_conn', 'Constellations', 'Constellations Reading Guide', 12, 'Reading guide on the constellation myths (Callisto, Orion, Andromeda)', null, 0, 'Classical'],
          ['classical', 'quiz', 'Pandora', 'Pandora Quiz', 10, 'Quiz on Pandora', null, 0, 'Classical'],
          ['classical', 'quiz', 'Phaethon', 'Phaethon Quiz', 10, 'Quiz on Phaethon', null, 0, 'Classical'],
          ['classical', 'quiz', 'Orpheus', 'Orpheus Quiz', 10, 'Quiz on Orpheus and Eurydice', null, 0, 'Classical'],
          ['classical', 'quiz', 'Echo and Narcissus', 'Echo and Narcissus Quiz', 10, 'Quiz on Echo and Narcissus', null, 0, 'Classical'],
          ['classical', 'quiz', 'Icarus', 'Icarus and Daedalus Quiz', 10, 'Quiz on Icarus and Daedalus', null, 0, 'Classical'],
          ['classical', 'quiz', 'Eros and Psyche', 'Eros and Psyche Quiz', 10, 'Quiz on Eros and Psyche', null, 0, 'Classical'],
          ['classical', 'quiz', 'Constellations', 'Constellations Quiz', 10, 'Quiz on the constellation myths', null, 0, 'Classical'],
          ['classical_creative', 'mural', 'Phaethon', 'Phaethon Pixton', 16, 'Comic retelling of the Phaethon myth using Pixton', null, 0, 'Classical'],
          ['classical_creative', 'mural', 'Echo and Narcissus', 'Echo and Narcissus Pixton', 16, 'Comic retelling of Echo and Narcissus using Pixton', null, 0, 'Classical'],
          ['classical_creative', 'mural', 'Icarus', 'Icarus Pixton', 16, 'Comic retelling of Icarus and Daedalus using Pixton', null, 0, 'Classical'],
          ['classical_creative', 'mural', 'Constellations', 'Constellations Pixton', 16, 'Comic retelling of a constellation myth using Pixton', null, 0, 'Classical'],
          ['classical_creative', 'word_cloud', 'Pandora', 'Pandora Word Cloud', 12, 'Word cloud for Pandora myth', null, 0, 'Classical'],
          ['classical_creative', 'word_cloud', 'Phaethon', 'Phaethon Word Cloud', 12, 'Word cloud for Phaethon myth', null, 0, 'Classical'],
          ['classical_creative', 'word_cloud', 'Orpheus', 'Orpheus Word Cloud', 12, 'Word cloud for Orpheus myth', null, 0, 'Classical'],
          ['classical_creative', 'word_cloud', 'Echo and Narcissus', 'Echo and Narcissus Word Cloud', 12, 'Word cloud for Echo and Narcissus', null, 0, 'Classical'],
          ['classical_creative', 'word_cloud', 'Icarus', 'Icarus Word Cloud', 12, 'Word cloud for Icarus myth', null, 0, 'Classical'],
          ['classical_creative', 'word_cloud', 'Eros and Psyche', 'Eros and Psyche Word Cloud', 12, 'Word cloud for Eros and Psyche', null, 0, 'Classical'],
          ['classical_creative', 'word_cloud', 'Constellations', 'Constellations Word Cloud', 12, 'Word cloud for constellation myths', null, 0, 'Classical']
        ];
        classicalAssignments.forEach(a => {
          db.run(`INSERT OR IGNORE INTO assignments_ref (section, assignment_type, myth_god, display_name, max_points, description, resource_links, is_bonus, age) 
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, a);
        });
        console.log('✅ Classical assignments seeded (' + classicalAssignments.length + ' assignments)');
      }
    } catch (err) {
      console.log('Classical assignments seed note:', err.message);
    }
  }

  // Seed Battle Arena Questions
  const existingQuestions = db.exec("SELECT COUNT(*) FROM battle_questions");
  const questionCount = existingQuestions[0] ? existingQuestions[0].values[0][0] : 0;
  
  if (questionCount === 0) {
    console.log('🎮 Seeding Battle Arena questions...');
    
    const battleQuestions = [
      ['Zeus', 'What did Zeus give Cronus to make Cronus throw up Zeus\'s brothers and sisters?', 'Mustard and Salt with Nectar', 'Pepto Bismol', 'Wine', 'Sea Salt and Vinegar', 'medium'],
      ['Zeus', 'How did Rhea trick Cronus into thinking he was swallowing Zeus?', 'Wrapped a stone in a blanket', 'Wrapped a baby doll in a blanket', 'Wrapped a piglet in a blanket', 'Fed him a potion that made him see an illusion', 'easy'],
      ['Zeus', 'How does Zeus finally defeat The Titans?', 'He ambushes The Titans with the help of The Hundred Handed Men', 'Zeus traps the Titans in a labyrinth they can never escape', 'He drops a mountain on top of them', 'He drives them all into the ocean with the help of Poseidon', 'medium'],
      ['Poseidon', 'How was the newly won empire split between the three sons of Cronus?', 'They played dice', 'Zeus was the youngest so he was able to choose first', 'They threw darts', 'Zeus divided it based on each brother\'s strengths', 'medium'],
      ['Poseidon', 'How do we know that Poseidon was a difficult god to deal with?', 'He was changeful and quarrelsome and did bear grudges', 'He would not leave Demeter alone', 'He was a world traveler and had many children', 'He liked to startle nymphs with monsters', 'medium'],
      ['Poseidon', 'What line from the text suggests that Hades may not have been happy with his winning the Underworld?', 'Hades, who was unlucky, had to take the underworld', 'The earth was held as a commonwealth and left to the goddesses to manage', 'Poseidon chose the sea', 'Zeus gave his brothers the realms they deserved', 'hard'],
      ['Poseidon', 'The main idea of this myth is to show...', 'examples of Poseidon\'s behavior', 'how the gods divided up their responsibilities', 'how horses were created', 'the relationship of the gods with man', 'medium'],
      ['Hera', 'How long did the gods reign on Mount Olympus?', '3,000 years', '10,000 years', '100 years', '1,000 years', 'easy'],
      ['Hera', 'Zeus was tied down. How come he could not break free?', 'The other gods had stolen his thunderbolt', 'The straps were made of a special material created by Hephaestus', 'He could not untie the knots that Hephaestus had tied', 'Poseidon had bound him with enchanted chains from the sea', 'medium'],
      ['Hera', 'Who set Zeus free?', 'Briareus, a hundred handed man', 'Hermes', 'The cyclops', 'Uranus', 'medium'],
      ['Hera', 'Why did Zeus finally set Hera free after hanging her in the sky?', 'She cried so much that Zeus could not sleep', 'Ares talked him into letting her down if she promised not to rebel again', 'The other gods rescued her. Zeus would have left her there for eternity', 'He realized how much he loved her and needed her', 'medium'],
      ['Athena', 'Who is Athena\'s mother?', 'The Titaness Metis', 'The goddess Hera', 'The goddess Aphrodite', 'The Titaness Leto', 'easy'],
      ['Athena', 'Why did Zeus swallow Athena\'s mother?', 'Animals had prophesized that she would have a son that would overthrow Zeus', 'She was plotting to help Hera overthrow Zeus', 'She turned into a bird and Zeus became a snake and captured her', 'She disguised herself as an apple and Zeus ate her by mistake', 'medium'],
      ['Athena', 'What was Athena\'s worst character trait?', 'Jealousy', 'Selfishness', 'Anger', 'Greed', 'easy'],
      ['Athena', 'Which god did Athena hate the most and enjoyed beating in battles?', 'Ares', 'Poseidon', 'Zeus', 'Apollo', 'easy'],
      ['Athena', 'Why did Athena feel the need to visit Arachne?', 'Arachne was bragging she was better than Athena at weaving', 'Zeus was their father', 'Arachne was inventing spiders', 'Ares kidnapped Arachne and Arachne prayed for Athena to save her', 'medium'],
      ['Apollo and Artemis', 'Who are the parents of these twin gods?', 'Leto and Zeus', 'Hera and Zeus', 'Aphrodite and Ares', 'Demeter and Zeus', 'easy'],
      ['Apollo and Artemis', 'Artemis is famous for shooting her silver bow four times. What can we tell from the text about the bow?', 'It was powerful', 'The golden bow and arrows were a special gift from Zeus and Hephaestus', 'The bow was so beautiful that her foes would fall in awe of its great beauty', 'She used it to destroy the mortal Actaeon', 'medium'],
      ['Apollo and Artemis', 'What did Pan give Artemis?', 'Hunting dogs', 'Silver bow and arrows', 'Golden chariot drawn by golden ponies', 'White stags', 'medium'],
      ['Apollo and Artemis', 'Artemis tells Zeus, "I wish to be your maiden always, never a woman." This shows Artemis\'s refusal to...', 'Grow up and become an adult', 'Give up her divinity and become a mortal', 'Stop hunting and learn to cook', 'Give her toys away', 'medium'],
      ['Aphrodite', 'Aphrodite thinks of nothing but...', 'love', 'work', 'beauty', 'revenge', 'easy'],
      ['Aphrodite', 'What two things mixed together to form Aphrodite?', 'Uranus\'s blood and sea water', 'Cronus\'s blood and sea water', 'Zeus\'s blood and sea water', 'Athena\'s wisdom and an olive tree', 'medium'],
      ['Aphrodite', 'Who forced Hephaestus to step up and try and woo Aphrodite?', 'Hera', 'Zeus', 'Poseidon', 'Artemis', 'medium'],
      ['Aphrodite', 'What was Aphrodite\'s reaction when Poseidon "claimed" her?', 'She smiled and said nothing', 'She was so happy she cried', 'She yelled and begged Zeus not to let Poseidon take her away', 'She fell into a deep sleep', 'medium'],
      ['Aphrodite', 'How did Aphrodite show she would marry Hephaestus?', 'She kissed him', 'She said yes', 'She walked away', 'She told the other gods she would marry him', 'easy'],
      ['Ares', 'When Hera and Zeus realized baby Ares was a handful, how did they handle his upbringing?', 'Found a mountain nymph named Thero to be his nanny', 'Sent him to be raised by the titan Thanos', 'They tossed him down Mt. Olympus, where he fell into the sea and was raised by sea nymphs', 'Gave him to the Spartans to raise as a warrior', 'medium'],
      ['Ares', 'Why was it ironic that Ares was considered the god of courage?', 'In one on one combat he runs away like a coward', 'He was the god of so many other things', 'He is really very peaceful at heart and is misunderstood', 'He always needed other gods to fight his battles for him', 'medium'],
      ['Ares', 'What do Ares\' sons Phobos and Deimos represent?', 'Fear and panic', 'End and beginning', 'Death and destruction', 'War and peace', 'easy'],
      ['Ares', 'Which of these groups really did not worship Ares?', 'Greeks', 'Spartans', 'Amazons', 'Thracians', 'hard'],
      ['Ares', 'What happened to Cadmus after he killed one of Ares\' dragons?', 'Ares transformed Cadmus and his wife Harmonia into snakes', 'Cadmus became king of the dragons', 'Cadmus was placed in the sky as a constellation', 'Ares transformed him into a dragon as a replacement', 'hard'],
      ['Ares', 'Ares and Poseidon get in a big fight. What was the outcome?', 'Ares is put on trial for killing Poseidon\'s son, Ares is found innocent', 'Poseidon and Ares are put in timeout in Tartarus', 'Ares writes an apology note to Poseidon', 'Ares is beat up and vanquished from Mt. Olympus', 'hard'],
      ['Ares', 'What happened to Ares when he went to stop the giants from destroying the world?', 'The giants destroyed Ares\' chariot and kidnapped the god of war', 'He won the heart of Aphrodite for his bravery', 'Ares took a vacation and let Athena clean up the mess', 'He defeated all the giants single-handedly', 'medium'],
      ['Ares', 'Who finally rescued Ares from his captors?', 'Hermes', 'Hephaestus', 'Hera', 'Zeus', 'medium'],
      ['Ares', 'Ares\' second dragon son was sent to Colchis to guard what magical item?', 'Golden Fleece', 'Artemis\'s Bow', 'Hydra\'s Crown', 'Zeus\'s Lightning Bolt', 'medium'],
      ['Ares', 'How did Athena try to protect Cadmus from Ares?', 'Showed him how to make fighters by planting dragon teeth', 'Taught him to fight like a god', 'Gave him a shield and sword', 'Showed him how to disguise the bushes to look like a dragon', 'hard'],
      ['Hephaestus', 'What did Hera hope for with the birth of Hephaestus?', 'A child, so beautiful and gifted, Zeus would forget about other women', 'A great warrior to destroy the Titans', 'A wise scholar to outwit all of Zeus\'s enemies', 'A master craftsman who would amaze the gods with his creations', 'medium'],
      ['Hephaestus', 'What did Hera do to Hephaestus when he was born?', 'Tossed him down Mt. Olympus, where he fell for a night and a day', 'Tossed him into the sea where Poseidon found him and cared for him', 'Tossed him into the Underworld with Hades', 'Had Hermes fly him to the other side of the world where he was raised by druids', 'easy'],
      ['Hephaestus', 'How did Hephaestus\'s handiwork become known to the gods?', 'He made a necklace for Thetis, which was noticed by Hera', 'He made Poseidon a new trident for a battle with The Titans', 'Hephaestus found Zeus\'s thunderbolt after Hera had hidden it', 'He crafted a golden throne that trapped Hera when she sat on it', 'medium'],
      ['Hephaestus', 'What natural phenomena is a result of Hephaestus\'s work?', 'Volcanoes', 'Tsunamis', 'Droughts', 'Asteroids impacting earth', 'easy'],
      ['Hermes', 'Who tried to tell Apollo that his cows had been stolen?', 'Crows', 'An old farmer', 'Nobody, Apollo found them in a cave', 'A shepherd tending his flock nearby', 'medium'],
      ['Hermes', 'What character archetype does Hermes represent?', 'Herald', 'Shadow', 'Hero', 'Ally', 'hard'],
      ['Hermes', 'What is the best trait to describe Hermes\' behavior throughout the myth?', 'Witty', 'Dimwitted', 'Jealous', 'Honest', 'easy'],
      ['Hermes', 'What devious idea did Hermes give Zeus?', 'Disguise himself and mingle with the mortals', 'Hide Apollo\'s cows', 'Hermes wished to answer the pantheon', 'That Hermes was so smart that he could be the messenger god', 'medium'],
      ['Hermes', 'What did Hermes trade Apollo for his golden staff?', 'Pipes', 'Lyre', 'Cows', 'His winged sandals', 'medium'],
      ['Demeter', 'The main purpose of the Demeter myth is to...', 'tell the story of why we have the seasons', 'show how important Demeter was to growing things', 'show how much Zeus loved her', 'tell the story of fruit in the Underworld', 'easy'],
      ['Demeter', 'Who stole Persephone from Demeter?', 'Hades', 'Poseidon', 'Zeus', 'Ares', 'easy'],
      ['Demeter', 'What is the Law of the Abode?', 'If you eat food in the Underworld you have to stay in the Underworld', 'If you pick flowers in the Underworld you have to stay in the Underworld', 'If you sleep in the Underworld you have to stay in the Underworld', 'If you take your shoes off in the Underworld you have to stay in the Underworld', 'medium'],
      ['Demeter', 'What did Zeus see and hear that made him realize that he needed to settle the dispute over Persephone?', 'He looked down upon the earth. Nothing grew', 'Demeter was running away from Poseidon', 'Hera would not stop crying', 'Hephaestus was making noise making lightning bolts', 'medium'],
      ['Demeter', 'Persephone and Demeter view the outcome of this myth in different ways. How did they differ?', 'Persephone told Demeter be happy for the time we have together while Demeter cried, "I suffer!"', 'Demeter organized a revolt against Hades while Persephone begged her mother not to hurt Hades', 'Demeter rejoiced that Persephone found a husband while Persephone was sad to be married to Hades', 'Both were equally happy with the compromise Zeus created', 'hard'],
      ['Prometheus', 'What does Prometheus do to annoy Zeus at the beginning of the myth?', 'Ask questions', 'Teach man to melt metal', 'Steal food from the gods\' table', 'Refuse to bow before Zeus', 'easy'],
      ['Prometheus', 'What was Zeus\'s reason for keeping man hidden in "ignorance and darkness?"', 'Man was innocent and happy', 'Man was not mature enough to handle the responsibility', 'Man needed darkness to rest', 'Zeus feared man would become more powerful than the gods', 'medium'],
      ['Prometheus', 'Why was man made?', 'To worship the Gods', 'To build ships and cities', 'To occupy the empty lands', 'To hunt the animals that overpopulated the earth', 'easy'],
      ['Prometheus', 'In what mountain range was Prometheus dragged off to?', 'Caucasus', 'Appalachian', 'Alps', 'Olympus', 'medium'],
      ['Prometheus', 'At the beginning of the myth, Prometheus was...', 'a young Titan, no great admirer of Zeus', 'an old Titan, tired of Hera', 'a loyal servant of Zeus who later rebelled', 'a god who had been banished from Olympus', 'medium'],
      ['Prometheus', 'What was man\'s initial reaction to the gift of fire?', 'They were frightened of the fire and asked for Prometheus to take it away', 'They danced and created many stories about fire\'s magic properties', 'Man hid the fire because they knew the gods would be angry', 'They immediately began cooking food and forging tools', 'medium'],
      ['Prometheus', 'Who made the chains that bound Prometheus to the mountain?', 'Hephaestus', 'Zeus', 'Hercules', 'The Cyclopes', 'medium'],
      ['Prometheus', 'How does Prometheus describe fire to man?', 'It is an ill-natured spirit, a little brother of the sun', 'It is a demon from the center of the earth', 'It is a friend of your home', 'It is the center of your universe', 'hard'],
      ['Prometheus', 'Who finally freed Prometheus from his imprisonment and torture?', 'Hercules', 'Hermes', 'Aphrodite', 'Zeus, after Prometheus revealed a prophecy', 'easy'],
      ['Prometheus', 'Prometheus is a symbol of...', 'sacrifice', 'arrogance', 'envy', 'selfishness', 'easy'],
      ['Hades', 'The main idea of this myth is...', 'to describe Greeks\' ideas of the afterlife', 'to teach others how to prepare the dead for their trip to the Underworld', 'to share stories about Hades', 'to help you understand why Hades hates his brothers', 'easy'],
      ['Hades', 'Why did you have to leave a coin under the tongue of the deceased?', 'To pay Charon to carry the dead across the River Styx', 'To pay for the burial', 'To pay Hades for keeping the dead', 'To bribe Cerberus to let them pass', 'easy'],
      ['Hades', 'Where did those judged to be of "unusual virtue" spend their time in the Underworld?', 'Elysian Fields', 'Tartarus', 'Erebus', 'Field of Asphodel', 'medium'],
      ['Hades', 'How is Tantalus\' punishment tied to Sisyphus\' punishment?', 'Tantalus is stuck for as long as Sisyphus has to roll his stone', 'They are not tied together, this is a trick question', 'Sisyphus is pushing the rock away from Tantalus', 'Tantalus has to drink away the river blocking Sisyphus', 'hard']
    ];
    
    battleQuestions.forEach(q => {
      db.run(`INSERT INTO battle_questions (god_associated, question_text, correct_answer, wrong_answer_1, wrong_answer_2, wrong_answer_3, difficulty) 
              VALUES (?, ?, ?, ?, ?, ?, ?)`, q);
    });
    
    console.log(`✅ Battle Arena questions seeded (${battleQuestions.length} questions)`);
  } else {
    console.log(`✅ Battle Arena questions already exist (${questionCount} questions)`);
  }

  console.log('✅ Reference data seeded successfully');
}

function seedClassicalData() {
  console.log('🏛️ Checking Classical Age data...');
  
  // === CLASSICAL BUILDINGS ===
  try {
    const classicalBuildingsCheck = db.exec("SELECT COUNT(*) FROM buildings_ref WHERE age_available = 'Classical'");
    const classicalBuildingsExist = classicalBuildingsCheck[0] && classicalBuildingsCheck[0].values[0][0] > 0;
    
    if (!classicalBuildingsExist) {
      console.log('🏗️ Seeding Classical buildings...');
      // Need to get the building IDs for prerequisites
      // Town Center = 1, Library = 2, House = 3, Wooden Wall = 4, Stone Wall = 5, Dock = 6
      const classicalBuildings = [
        // Transport Ship: 308 pts (was 220, +55% V91 rebalance), requires Dock (6), Poseidon themed
        ['Transport Ship', 341, 6, 'Poseidon', 0, 1, 'Classical', 0, 0, 0, 0, 0, 0, 'Ocean-going vessel for trade and exploration. Requires Dock. Enables Classical trade routes.'],
        // Armory: 420 pts (was 300, +55% V91 rebalance), requires Library (2), Hephaestus themed, +150 battle bonus
        ['Armory', 465, 2, 'Hephaestus', 0, 1, 'Classical', 150, 0, 0, 0, 1, 0, 'Weapons and armor forge. +150 battle bonus. Always active. Requires Library.'],
        // Theater: 168 pts (was 120, +55% V91 rebalance), requires Library (2), Apollo themed, +8% points
        ['Theater', 186, 2, 'Apollo', 0, 1, 'Classical', 0, 0.08, 48, 72, 0, 0, 'Cultural center for drama and music. +8% point bonus when active. Requires Library.'],
        // Agora: 112 pts (was 80, +55% V91 rebalance), requires Town Center (1), Hermes themed
        ['Agora', 124, 1, 'Hermes', 0, 1, 'Classical', 0, 0.05, 48, 48, 0, 0, 'Marketplace and civic center. +5% point bonus when active. Requires Town Center.'],
        // Oracle: 210 pts (was 150, +55% V91 rebalance), requires Stone Wall (5), Apollo themed
        ['Oracle', 232, 5, 'Apollo', 0, 1, 'Classical', 0, 0, 0, 0, 0, 0, 'Sacred prophecy site. Grants 1 free fate re-spin per week. Requires Stone Wall.']
      ];

      classicalBuildings.forEach(b => {
        db.run(`INSERT INTO buildings_ref (building_name, cost_points, prerequisite_building_id, god_associated, requires_god_assignment, max_per_alliance, age_available, battle_bonus, point_bonus, active_duration_hours, cooldown_hours, always_active, required_for_age, description) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, b);
      });
      console.log('✅ Classical buildings seeded (5 buildings)');
    }
  } catch (err) {
    console.log('Classical buildings seed note:', err.message);
  }

  // === MYTH PORTALS ===
  try {
    // Migrate myth_portals: add virtue columns if they don't exist
    try {
      db.exec("SELECT virtue_english FROM myth_portals LIMIT 0");
    } catch (e) {
      console.log('📜 Adding virtue columns to myth_portals...');
      try { db.run("ALTER TABLE myth_portals ADD COLUMN virtue_greek TEXT"); } catch(e2) {}
      try { db.run("ALTER TABLE myth_portals ADD COLUMN virtue_english TEXT"); } catch(e2) {}
      try { db.run("ALTER TABLE myth_portals ADD COLUMN virtue_description TEXT"); } catch(e2) {}
      try { db.run("ALTER TABLE myth_portals ADD COLUMN virtue_emoji TEXT"); } catch(e2) {}
      console.log('✅ Virtue columns added to myth_portals');
      // Force re-seed since old data won't have virtue info
      db.run('DELETE FROM myth_portals');
      console.log('📜 Cleared old portals for re-seed with virtue data');
    }

    const portalsCheck = db.exec('SELECT COUNT(*) FROM myth_portals');
    const portalsExist = portalsCheck[0] && portalsCheck[0].values[0][0] > 0;
    
    // Check if virtue columns exist and have data
    let needsReseed = !portalsExist;
    if (portalsExist) {
      try {
        const virtueCheck = db.exec("SELECT virtue_english FROM myth_portals LIMIT 1");
        if (!virtueCheck[0] || !virtueCheck[0].values[0][0]) needsReseed = true;
      } catch (e) {
        // Column doesn't exist yet — need to re-seed
        needsReseed = true;
      }
    }
    
    if (needsReseed) {
      // Clear old data if it exists without virtue columns
      if (portalsExist) {
        console.log('📜 Myth portals missing virtue data — re-seeding...');
        db.run('DELETE FROM myth_portals');
      }
      console.log('📜 Seeding myth portals...');
      const mythPortals = [
        [1, 'Pandora', "Pandora's Box", '🏺', '/images/classical/myths/Pandora.png', '#FFD700', 'The story of the first woman and the jar that unleashed suffering upon the world — yet Hope remained.', 'Σωφροσύνη', 'Temperance', 'She opened the jar on impulse — temperance is the restraint she lacked.', '🏺'],
        [2, 'Phaethon', "Phaethon's Chariot", '☀️', '/images/classical/myths/Phaethon.png', '#FF8C00', 'The tale of the boy who drove the sun chariot across the sky — and the catastrophe that followed.', 'Ταπεινοφροσύνη', 'Humility', 'He demanded the sun chariot beyond his ability — humility is knowing your limits.', '☀️'],
        [3, 'Orpheus & Eurydice', 'Orpheus & Eurydice', '🎵', '/images/classical/myths/Orpheus.png', '#8B5CF6', 'The greatest musician who descended into the Underworld to bring back his beloved — if only he could resist looking back.', 'Καρτερία', 'Resolve', 'He looked back and lost everything — resolve is the strength to trust the path.', '🎵'],
        [4, 'Echo & Narcissus', 'Echo & Narcissus', '🪞', '/images/classical/myths/Narcissus.png', '#EC4899', 'The nymph cursed to repeat others\' words and the beautiful youth who fell in love with his own reflection.', 'Γνῶθι Σαυτόν', 'Self-Knowledge', '"Know Thyself" — inscribed at Delphi. Narcissus was destroyed by not truly knowing himself.', '🪞'],
        [5, 'Icarus & Daedalus', 'Icarus & Daedalus', '🪶', '/images/classical/myths/Icarus.png', '#3B82F6', 'The master craftsman and his son who escaped the labyrinth on wings of wax — but flew too close to the sun.', 'Φρόνησις', 'Prudence', 'He ignored his father\'s wisdom — prudence is wisdom in the face of freedom.', '🪶'],
        [6, 'Eros & Psyche', 'Eros & Psyche', '💘', '/images/classical/myths/Psyche.png', '#EF4444', 'The mortal woman so beautiful she rivaled Aphrodite, and the god of love who fell for her.', 'Πίστις', 'Faith', 'She endured impossible trials — faith is trust through the darkness.', '🦋'],
        [7, 'Constellations', 'Callisto, Orion & Andromeda', '⭐', '/images/classical/myths/Orion.png', '#C0C0C0', 'The myths behind the stars — hunters, bears, and princesses placed in the heavens by the gods.', 'Κλέος', 'Glory', 'Heroes immortalized in the stars — glory that outlasts death, the ultimate Greek value.', '⭐']
      ];

      mythPortals.forEach(p => {
        db.run(`INSERT INTO myth_portals (myth_number, myth_name, display_name, icon_placeholder, icon_url, glow_color, description, virtue_greek, virtue_english, virtue_description, virtue_emoji)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, p);
      });
      console.log('✅ Myth portals seeded (7 portals)');
    }
  } catch (err) {
    console.log('Myth portals seed note:', err.message);
  }

  // === CLASSICAL MYTH QUIZ QUESTIONS ===
  // Portal IDs: 1=Pandora, 2=Phaethon, 3=Orpheus, 4=Echo&Narcissus, 5=Icarus, 6=Eros&Psyche, 7=Constellations
  try {
    const quizCheck = db.exec("SELECT COUNT(*) FROM myth_quiz_questions");
    const quizCount = quizCheck[0] ? quizCheck[0].values[0][0] : 0;
    
    if (quizCount === 0) {
      console.log('📝 Seeding myth quiz questions...');
      
      // Format: [portal_id, question_text, answer_a, answer_b, answer_c, answer_d, correct_answer]
      const quizQuestions = [
        // ==================== PANDORA (portal_id = 1) ====================
        [1, 'What is inside Pandora\'s box? p.64', 'Food and drink', 'Happiness, Joy and Cheer', 'Pain, Sorrow and Death', 'Gold, Silver and Jewels', 'c'],
        [1, 'What happens after Pandora opens the box? p.64', 'She is no longer hungry or thirsty', 'Everyone in the world is happy', 'Pandora becomes the most beautiful woman in the world', 'Trouble and woe comes into the world, as well as hope.', 'd'],
        [1, 'Pandora means... p.62', '"all knowing"', '"bringer of misfortune"', '"all-giving" or "all-gifted"', '"into darkness"', 'c'],
        [1, 'Who did Zeus send Pandora to? p.61', 'Prometheus', 'Hermes', 'Epimetheus', 'Hephaestus', 'c'],
        [1, 'What did Hermes tell Pandora when he gave her the box? p.61', '"Don\'t tell anybody about the box."', '"Open it when I tell you to."', '"Open it on a special day."', '"Never open it."', 'd'],
        [1, 'Finish this line: For though he can bear endless trouble... p.64', 'he cannot live with no hope at all.', 'he will have detention.', 'he will have to reset the wifi router.', 'he will be reborn in a heroic form.', 'a'],
        [1, 'After Zeus had condemned Prometheus for giving fire to man, he.... p.61', 'took a week off and went on vacation', 'ordered Hephaestus to make a girl out of clay', 'flew the sun chariot across the sky', 'sent a storm to earth to punish man', 'b'],
        [1, 'What was the most dangerous creature Pandora was able to shut in the box? p.64', 'Ignorance', 'Foreboding', 'Fear', 'Anger', 'b'],
        [1, 'Which god gave Pandora a golden box? p.61', 'Apollo', 'Hermes', 'Athena', 'Hestia', 'b'],
        [1, 'Which gift did Hera give to Pandora? p.61', 'Beauty', 'Wisdom', 'Curiosity', 'Strength', 'c'],

        // ==================== PHAETHON (portal_id = 2) ====================
        [2, 'In the Evslin book, why does Phaethon go to find his father? p.65', 'Phaethon is lost and asks to be saved by Apollo', 'Zeus wants to destroy Phaethon', 'Apollo calls for Phaethon to come see him', 'Epaphus, the son of Zeus, does not believe that Phaethon is the son of Apollo', 'd'],
        [2, 'According to Evslin, Phaethon does not make it to the palace of his father on his own, he needs help. How is Phaethon helped? p.68', 'Apollo sends his chariot to pick up Phaethon', 'Poseidon sends a helpful wave to lift Phaethon up to the sun', 'Four sun hawks carried Phaethon who laid on a rug', 'Hephaestus builds a floating disc to carry the young traveler to his father', 'c'],
        [2, 'Phaethon\'s father makes an unbreakable promise. What does the father figure swear to that makes it impossible to take his word back? p.70', 'The Elysian Fields', 'Zeus\'s name', 'Poseidon\'s Trident', 'The River Styx', 'd'],
        [2, 'How was the chariot finally stopped? p.76', 'Zeus struck the chariot down with a lightning bolt', 'The chariot crashed on the moon', 'Apollo took over and reined the horses in', 'Phaethon returned the chariot to the stable', 'a'],
        [2, 'Who came to mourn Phaethon and what did they become? p.76', 'Narcissus (brother); flower', 'Echo (sister); disappeared', 'Actaeon (cousin); stag', 'Heliades (yellow haired sisters); poplar trees', 'd'],
        [2, 'Phaethon\'s father felt ______________ when he realized the promise he agreed to would kill Phaethon. p.71', 'Joy', 'Envy', 'Regret', 'Pride', 'c'],
        [2, 'Which of these describes the horses that pull the sun chariot? p.71', 'Jet black with hot yellow eyes', 'Giant fire white with golden manes and golden hooves', 'Gray with black smoke from their noses', 'Small brown ponies with silver wings', 'b'],
        [2, 'What color are the nostrils of the chariot horses? p.71', 'Golden', 'Fire red', 'Ice blue', 'Jet black', 'b'],

        // ==================== ORPHEUS (portal_id = 3) — 5 questions ====================
        [3, 'Orpheus was gifted and lucky to know some great mentors. What was he famous for? p.77', 'Singing and dancing', 'Music and poetry', 'Running and athletics', 'Mathematics and science', 'b'],
        [3, 'How did Eurydice die? p.80', 'She was turned into a poplar tree by a merciful Zeus', 'A young king shot her by accident with the golden bow he stole from Apollo', 'She was chased through the forest and stepped in a bed of snakes.', 'She tripped, running from a young king, and hit her head on a rock', 'c'],
        [3, 'How did Orpheus get past Charon, the threshold guardian of the River Styx and the Underworld? p.81', 'He bribed Charon with one hundred souls', 'He tricked Charon by playing Charon a song that reminded the boatman of his youth', 'He hid behind a group of souls and Charon never saw him', 'He wrote a poem about Charon that made him cry', 'b'],
        [3, 'Why did Orpheus turn around, causing Eurydice to return to the Underworld forever? p.86', 'Hermes flew past him with new souls', 'Persephone told Orpheus Hades was tricking him', 'He doubted she was really there', 'Cerberus began chasing them', 'c'],
        [3, 'Which type of song did Orpheus NOT play for Cerberus? p.81', 'Sad song', 'Dog song', 'Sleeping song', 'Hunting song', 'b'],

        // ==================== ECHO & NARCISSUS (portal_id = 4) — 5 questions ====================
        [4, 'What did Narcissus hope to find as he wandered through the woods?', 'His way home', 'The Golden Fleece', 'The Minotaur', 'Someone as beautiful as himself', 'd'],
        [4, 'Which goddess enjoyed talking with Echo?', 'Hera', 'Hestia', 'Aphrodite', 'Demeter', 'a'],
        [4, 'Why was Echo punished?', 'She lied to Zeus about where Hera really was', 'She lied to Hera about where Zeus really was', 'She offended Aphrodite by hiding her water nymph', 'She tricked Narcissus into following her', 'b'],
        [4, 'Why was Echo so sad after Narcissus left her?', 'She could not hunt for food without him', 'She had lost her only friend', 'She could not call to him because of Hera\'s curse', 'She was lost in the forest', 'c'],
        [4, 'What happened to Narcissus?', 'He became king of Athens', 'He married Echo and they lived happily ever after', 'He fell in love with his own reflection and died', 'He was turned into a statue by Athena', 'c'],

        // ==================== ICARUS (portal_id = 5) ====================
        [5, 'Who built the Labyrinth? p.87', 'Zeus', 'Theseus', 'Daedalus', 'Minos', 'c'],
        [5, 'Why were Daedalus and Icarus imprisoned? p.88', 'They stole from the king', 'King Minos wanted to keep Daedalus\'s genius trapped on Crete', 'They tried to kill the Minotaur', 'They refused to build a temple', 'b'],
        [5, 'What did Daedalus use to build the wings? p.89', 'Metal and leather', 'Feathers and wax', 'Silk and wood', 'Leaves and clay', 'b'],
        [5, 'What warning did Daedalus give Icarus? p.89', 'Don\'t fly at night', 'Don\'t fly over the sea', 'Don\'t fly too close to the sun or too close to the sea', 'Don\'t fly faster than the birds', 'c'],
        [5, 'What happened to Icarus? p.90', 'He made it to safety', 'He flew too high, the wax melted, and he fell into the sea', 'He was caught by King Minos', 'He landed on Mount Olympus', 'b'],
        [5, 'What was the Minotaur? p.87', 'A giant snake', 'A three-headed dog', 'Half man, half bull', 'A flying horse', 'c'],
        [5, 'Who was King Minos? p.87', 'King of Athens', 'King of Sparta', 'King of Crete', 'King of Troy', 'c'],
        [5, 'Why didn\'t Daedalus and Icarus escape by boat? p.88', 'They couldn\'t swim', 'Minos controlled all the ships and searched them', 'The sea was too rough', 'There were sea monsters', 'b'],
        [5, 'What sea is named after Icarus? p.90', 'The Aegean Sea', 'The Mediterranean Sea', 'The Icarian Sea', 'The Red Sea', 'c'],
        [5, 'What is the main lesson of Icarus\'s story?', 'Never try to fly', 'Prudence — know the limits and find the wise middle path', 'Always obey your father', 'Technology is dangerous', 'b'],

        // ==================== EROS & PSYCHE (portal_id = 6) ====================
        [6, 'Which goddess was jealous of Psyche?', 'Athena', 'Aphrodite', 'Hera', 'Demeter', 'b'],
        [6, 'The goddess, insulted by Psyche\'s beauty, came up with a plan. What was her plan?', 'Send the giant Python to eat Psyche', 'Send her son Eros to pierce Psyche with an arrow', 'Trick Psyche into falling in love with a statue', 'Lock Psyche in a castle tower', 'b'],
        [6, 'What is Eros\' reaction to Aphrodite\'s plan?', 'He says its the best plan ever', 'It\'s a boring plan and he wants to do something better', 'He thinks it is a cruel trick', 'He tells Zeus about the plan', 'c'],
        [6, 'Eros finds Psyche to be beautiful. What happens when she opens her eyes and startles him?', 'He pokes her shoulder and she falls in love with the gardener.', 'He scratches his own hand.', 'He drops the arrow and flies away.', 'He disguises himself as a donkey.', 'b'],
        [6, 'What was Aphrodite\'s reaction to Eros\' mistake?', 'She praised Eros and said he was a good boy', 'She sent him to timeout in Tartarus', 'She sent Eros away and cast a curse on Psyche', 'She shrugged her shoulders and said, "Better luck next time."', 'c'],
        [6, 'What was the curse that Aphrodite put on Psyche?', 'Cast an invisible hedge of thorns around Psyche, so no suitor would come close', 'Turned her invisible', 'Made Psyche jealous of her own reflection', 'Turned Psyche into a bear and left her in the forest', 'a'],
        [6, 'What was Eros\' response to Aphrodite\'s curse?', 'He celebrated her wise decision.', 'He became angry and refused to fire any more arrows.', 'He left Mount Olympus.', 'He went to sit with Psyche and console her.', 'b'],
        [6, 'What idea did Psyche\'s sisters place in her head?', 'Eros was a monster', 'Eros was just her imagination', 'Eros was a mortal', 'Eros was tricking her', 'a'],
        [6, 'What were the consequences of Psyche shining a lamp on Eros?', 'Eros smiles and hugs her', 'Eros yells, "Wretched girl - you are not ready to accept love."', 'Eros is blinded by the mortal light.', 'Eros cries and sacrifices Psyche to Aphrodite', 'b'],
        [6, 'According to the book, which is NOT a possible ending for Psyche\'s story?', 'Everything disappears and she wanders forever, transforming into an owl', 'She turned into a bat and lives in old ruins', 'Eros forgives her and she helps him create love in the world', 'She lives to be an old lady in a castle, never finding love', 'd'],

        // ==================== CONSTELLATIONS (portal_id = 7) ====================
        [7, 'Who shot Orion?', 'Artemis', 'Apollo', 'Athena', 'Ares', 'a'],
        [7, 'What special ability did Orion possess?', 'He was a great hunter', 'He was friends with Apollo', 'He could fly', 'He walked on water', 'a'],
        [7, 'Which animal chased Orion?', 'Scorpion', 'Python', 'Ram', 'Dog', 'a'],
        [7, 'What is Callisto?', 'Nymph', 'Fairy', 'Elf', 'Hobbit', 'a'],
        [7, 'Who turned Callisto into a she-bear?', 'Zeus', 'Hera', 'Athena', 'Aphrodite', 'b'],
        [7, 'What scene depicts Callisto\'s fate in the woods?', 'Callisto\'s son about to shoot her in the woods.', 'Apollo hunting in the woods.', 'A bear about to attack Orion.', 'The original ending of the three little bears story', 'a'],
        [7, 'Cassiopeia gets in trouble because...', 'she brags about her daughter\'s beauty.', 'she hides seeds from Demeter.', 'she steals Poseidon\'s trident.', 'she shoots her husband with Eros\'s love arrows.', 'a'],
        [7, 'Andromeda has to pay the price. What is her punishment?', 'Get eaten by Cetus the sea monster', 'Leave the country forever', 'No dessert after dinner', 'Get locked in a tower for twenty years', 'a'],
        [7, 'Who saves Andromeda from her punishment?', 'Perseus', 'Theseus', 'Daedalus', 'Icarus', 'a'],
        [7, 'What happens to Cassiopeia?', 'She is placed upside down in the sky', 'She is honored as a wonderful mother', 'She dies from sadness', 'She marries Poseidon', 'a']
      ];

      quizQuestions.forEach(q => {
        db.run(`INSERT INTO myth_quiz_questions (portal_id, question_text, answer_a, answer_b, answer_c, answer_d, correct_answer)
                VALUES (?, ?, ?, ?, ?, ?, ?)`, q);
      });
      console.log('✅ Myth quiz questions seeded (' + quizQuestions.length + ' questions)');
    }
  } catch (err) {
    console.log('Quiz questions seed note:', err.message);
  }

  // === CLASSICAL FATES (24 fates, numbered 21-44 to avoid conflicts with Archaic 1-20) ===
  try {
    const classicalFatesCheck = db.exec("SELECT COUNT(*) FROM fates_ref WHERE age_available = 'Classical'");
    const classicalFatesCount = classicalFatesCheck[0] ? classicalFatesCheck[0].values[0][0] : 0;
    
    if (classicalFatesCount !== 24) {
      if (classicalFatesCount > 0) {
        console.log(`⚠️ Found ${classicalFatesCount} Classical fates (expected 24), re-seeding...`);
        db.run("DELETE FROM fates_ref WHERE age_available = 'Classical'");
        db.run("DELETE FROM fate_choices WHERE fate_id NOT IN (SELECT fate_id FROM fates_ref)");
      }
      console.log('🎲 Seeding Classical fates...');
      
      const classicalFates = [
        // Fate 21: Artemis Forest Fires (STEAL-CHOICE NEGATIVE — give pts to each)
        [21, "Artemis Forest Fires", 'steal_choice', "Forest fires in your land have angered Artemis. She is enraged and crushes your economy. You give points to each country.", 'Artemis', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 22: Poseidon Fishing Storms (CHOICE NEGATIVE)
        [22, "Poseidon Fishing Storms", 'choice', "Your fishing boats have been very productive. So productive that Poseidon is getting upset with the amount of fish taken from the sea. Frequent storms damage your boats.", 'Poseidon', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 23: Athena/Arachne Disorder (CHOICE NEGATIVE)
        [23, "Athena/Arachne Disorder", 'choice', "Your people are angry with Athena for her treatment of Arachne. The split between supporters and protesters is causing disorder.", 'Athena', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 24: Ares Wild Boar Battle (BATTLE — 95% threat, ±40)
        [24, "Ares Wild Boar Battle", 'battle', "Ares sends wild boars to attack your village! Their tusks could do up to 40 points of damage. The boar's power is 95% of your country's total points.", 'Ares', null, null, 0, 0, null, 1, 0.95, 40, -40, "Wild boars with razor tusks charge through your village!", 'Classical'],
        // Fate 25: Hephaestus Ichor Discovery (CHOICE POSITIVE)
        [25, "Hephaestus Ichor Discovery", 'choice', "The lava from Hephaestus's forge has created a new scientific element, Ichor. It is an excellent new source of power.", 'Hephaestus', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 26: Demeter's Depression (CHOICE NEGATIVE)
        [26, "Demeter's Depression", 'choice', "Persephone has disappeared, Demeter is depressed. Crops are failing across the land.", 'Demeter', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 27: Kobalos Attack (BATTLE — 95% threat, Armory +10%)
        [27, "Kobalos Attack", 'battle', "Dionysus has been checking on his grapes. The mischievous Kobalos are running free through your village! They have 95% of your power. If you have an armory you get a bonus.", 'Dionysus', null, null, 0, 0, null, 1, 0.95, 35, -35, "Mischievous Kobalos steal everything in sight!", 'Classical'],
        // Fate 28: Constellation Blessing (STEAL-CHOICE POSITIVE — steal from each)
        [28, "Constellation Blessing", 'steal_choice', "Your land is favored by the gods and you have been granted a constellation in the sky! You gain points from each country.", 'Zeus', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 29: Countdown Your Fate (SPECIAL — teacher input)
        [29, "Countdown Your Fate", 'special', "The fates have decreed a game of wit and strategy! The citizen that wins shall gain the points.", 'The Moirai', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 30: Power of Prometheus (SPECIAL — stored card)
        [30, "Power of Prometheus", 'special', "Prometheus stole fire from the gods — you now have the power to steal a fate from another country! Save this card.", 'Prometheus', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 31: Hera Marriage Laws (CHOICE POSITIVE)
        [31, "Hera Marriage Laws", 'choice', "New laws make it easier for people to get married and give equal rights. Hera is ecstatic with your land!", 'Hera', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 32: Reverse Card (SPECIAL — stored card)
        [32, "Reverse Card", 'special', "Reverse the points of any fate played against you! Turn the negative points into positive points.", 'The Moirai', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 33: Hermes on Strike (CHOICE NEGATIVE)
        [33, "Hermes on Strike", 'choice', "Hermes is on strike! Angered by Hades, he will no longer conduct souls to the Underworld. Spirits roam your cities.", 'Hermes', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 34: Giant Echion (BATTLE — 95% threat, -40 on loss, Armory bonus)
        [34, "Giant Echion", 'battle', "The giant Echion has found his way to your island! Using his great strength, he threatens your fishing fleet. His power is 95% of yours.", 'Prometheus', null, null, 0, 0, null, 1, 0.95, 40, -40, "Giant Echion towers over your village!", 'Classical'],
        // Fate 35: Dionysus Drought (STEAL-CHOICE NEGATIVE — lose to each)
        [35, "Dionysus Drought", 'steal_choice', "A severe drought has killed off many grape vines. Dionysus is upset. You lose points to each country.", 'Dionysus', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 36: Cerastes Vipers (BATTLE — 95% threat, ±35)
        [36, "Cerastes Vipers", 'battle', "Cerastes, horned vipers, are causing chaos in your village! Many villagers have been bitten. Their attack is 95% of your power.", 'Ares', null, null, 0, 0, null, 1, 0.95, 35, -35, "Horned vipers slither through your streets!", 'Classical'],
        // Fate 37: Hestia's Blessing (CHOICE POSITIVE)
        [37, "Hestia's Blessing", 'choice', "Hestia has favored your land because it is so peaceful and welcoming. As the Goddess of the Hearth, she appreciates your balanced environment.", 'Hestia', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 38: River Nymphs (CHOICE NEGATIVE)
        [38, "River Nymphs", 'choice', "River nymphs are causing chaos along your waterways. Boats are unable to move due to the nymphs playing rough with sailors.", 'Poseidon', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 39: Athena's Olive Tree (CHOICE POSITIVE)
        [39, "Athena's Olive Tree", 'choice', "Athena has blessed your land with a sacred olive tree. Its fruit brings prosperity and its oil is prized across all of Greece.", 'Athena', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 40: Dionysus Party Chaos (CHOICE NEGATIVE)
        [40, "Dionysus Party Chaos", 'choice', "Dionysus has caused chaos within your land with all of the partying. Large parties are disrupting your cities.", 'Dionysus', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 41: Swamp Reptile (SPECIAL — teacher input, like Countdown)
        [41, "Swamp Reptile", 'special', "A massive reptile emerges from the swamps near your village! The fates decree a challenge to drive it away.", 'The Moirai', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 42: Phaethon's Chariot (CHOICE — high swing +/-) 
        [42, "Phaethon's Chariot", 'choice', "Phaethon has lost control of the sun chariot and it races across your sky! The heat scorches your crops but the light reveals hidden treasures.", 'Apollo', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 43: Orpheus's Lament (CHOICE NEGATIVE)
        [43, "Orpheus's Lament", 'choice', "The grief of Orpheus echoes through your land. His music is so sorrowful that your workers stop to weep, halting all productivity.", 'Apollo', null, null, 0, 0, null, 0, null, null, null, null, 'Classical'],
        // Fate 44: Pandora's Echo (STEAL-CHOICE POSITIVE — steal from each)
        [44, "Pandora's Echo", 'steal_choice', "A fragment of Pandora's box washes ashore. Inside, a wisp of Hope remains. You may share it with others or try to keep it all.", 'Athena', null, null, 0, 0, null, 0, null, null, null, null, 'Classical']
      ];

      classicalFates.forEach(f => {
        db.run(`INSERT INTO fates_ref (fate_number, fate_name, fate_type, description, god_associated, icon_url, point_effect, steals_from_others, gives_to_others, transfer_amount, is_battle, battle_threat_percent, battle_win_points, battle_lose_points, battle_description, age_available) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, f);
      });
      console.log('✅ Classical fates seeded (24 fates)');

      // === CLASSICAL FATE CHOICES (3 tiers per fate) ===
      console.log('🎲 Seeding Classical fate choices...');
      
      // Get the fate_ids for Classical fates (they may not be 21-44 if auto-increment differs)
      const classicalFateIds = {};
      const fateRows = db.exec("SELECT fate_id, fate_number FROM fates_ref WHERE age_available = 'Classical'");
      if (fateRows[0]) {
        fateRows[0].values.forEach(row => {
          classicalFateIds[row[1]] = row[0]; // fate_number -> fate_id
        });
      }

      const classicalChoices = [
        // === STEAL-CHOICE FATES (amounts are PER ALLIANCE from spinner's perspective) ===
        // Positive value = spinner steals FROM each other alliance
        // Negative value = spinner gives TO each other alliance
        
        // Fate 21: Artemis Forest Fires (NEGATIVE steal — you're in trouble, limit the damage)
        // Conservative: safe damage control. Moderate: chance to escape. Aggressive: hero play or disaster.
        [classicalFateIds[21], 'conservative', "Offer tribute to calm Artemis — limit the damage", 0.85, -5, -10],
        [classicalFateIds[21], 'moderate', "Rally firefighting crews — might turn the tide", 0.55, 0, -12],
        [classicalFateIds[21], 'aggressive', "Harness the flames to forge new weapons!", 0.30, 8, -15],
        
        // Fate 28: Constellation Blessing (POSITIVE steal — you're blessed, how greedy will you be?)
        // Conservative: safe win. Moderate: bigger haul. Aggressive: massive or painful reversal.
        [classicalFateIds[28], 'conservative', "Accept the stars' modest gift", 0.85, 8, -4],
        [classicalFateIds[28], 'moderate', "Claim a greater constellation for your people", 0.55, 12, -6],
        [classicalFateIds[28], 'aggressive', "Demand the grandest constellation in the heavens!", 0.30, 18, -12],
        
        // Fate 35: Dionysus Drought (NEGATIVE steal — worse than Artemis, higher stakes)
        // Conservative: contained loss. Moderate: almost escaped. Aggressive: forgiven or catastrophic.
        [classicalFateIds[35], 'conservative', "Ration remaining wine and pray for rain", 0.85, -6, -12],
        [classicalFateIds[35], 'moderate', "Send scouts to find hidden springs", 0.55, -3, -15],
        [classicalFateIds[35], 'aggressive', "Steal wine reserves from neighboring lands!", 0.30, 5, -18],
        
        // Fate 44: Pandora's Echo (POSITIVE steal — similar to Constellation but different theme)
        [classicalFateIds[44], 'conservative', "Carefully contain the fragment of Hope", 0.85, 8, -4],
        [classicalFateIds[44], 'moderate', "Use Hope to inspire your people to greatness", 0.55, 12, -6],
        [classicalFateIds[44], 'aggressive', "Open the fragment fully and release all of Hope!", 0.30, 18, -12],

        // === STANDARD CHOICE FATES ===
        
        // Fate 22: Poseidon Fishing Storms (-15 base)
        [classicalFateIds[22], 'conservative', "Dock your boats and wait out the storms", 0.85, -8, -20],
        [classicalFateIds[22], 'moderate', "Send scouts to negotiate with Poseidon", 0.55, 3, -26],
        [classicalFateIds[22], 'aggressive', "Sail into the storm to prove your worth!", 0.30, 20, -35],
        
        // Fate 23: Athena/Arachne Disorder (-25 base)
        [classicalFateIds[23], 'conservative', "Call for unity and peaceful dialogue", 0.85, -12, -28],
        [classicalFateIds[23], 'moderate', "Host a weaving contest to honor both sides", 0.55, 0, -35],
        [classicalFateIds[23], 'aggressive', "Side with Arachne against Athena!", 0.30, 25, -45],
        
        // Fate 25: Hephaestus Ichor Discovery (+20 base)
        [classicalFateIds[25], 'conservative', "Carefully study the new element", 0.85, 15, -5],
        [classicalFateIds[25], 'moderate', "Build a laboratory to harness Ichor's power", 0.55, 28, -12],
        [classicalFateIds[25], 'aggressive', "Attempt to forge divine weapons with Ichor!", 0.30, 50, -25],
        
        // Fate 26: Demeter's Depression (-20 base)
        [classicalFateIds[26], 'conservative', "Plant emergency crops and pray for Persephone's return", 0.85, -10, -24],
        [classicalFateIds[26], 'moderate', "Send search parties to find Persephone", 0.55, 0, -30],
        [classicalFateIds[26], 'aggressive', "Storm the Underworld gates to retrieve Persephone!", 0.30, 22, -40],
        
        // Fate 31: Hera Marriage Laws (+25 base)
        [classicalFateIds[31], 'conservative', "Accept Hera's blessing with gratitude", 0.85, 18, -5],
        [classicalFateIds[31], 'moderate', "Declare a grand wedding festival in Hera's honor", 0.55, 32, -12],
        [classicalFateIds[31], 'aggressive', "Claim your marriages are blessed by ALL the gods!", 0.30, 55, -28],
        
        // Fate 33: Hermes on Strike (-15 base)
        [classicalFateIds[33], 'conservative', "Hire mortal guides for lost spirits", 0.85, -8, -18],
        [classicalFateIds[33], 'moderate', "Negotiate Hermes's return to duty", 0.55, 5, -24],
        [classicalFateIds[33], 'aggressive', "Build your own path to the Underworld!", 0.30, 22, -35],
        
        // Fate 37: Hestia's Blessing (+25 base)
        [classicalFateIds[37], 'conservative', "Welcome Hestia's warmth into your homes", 0.85, 18, -5],
        [classicalFateIds[37], 'moderate', "Build a grand hearth temple in her honor", 0.55, 32, -12],
        [classicalFateIds[37], 'aggressive', "Declare your hearth the center of ALL Greece!", 0.30, 55, -28],
        
        // Fate 38: River Nymphs (-20 base)
        [classicalFateIds[38], 'conservative', "Offer flowers and songs to calm the nymphs", 0.85, -10, -24],
        [classicalFateIds[38], 'moderate', "Send diplomats to negotiate river passage", 0.55, 2, -28],
        [classicalFateIds[38], 'aggressive', "Challenge the nymphs to a swimming race!", 0.30, 22, -38],
        
        // Fate 39: Athena's Olive Tree (+20 base)
        [classicalFateIds[39], 'conservative', "Harvest the olives and share with your people", 0.85, 15, -5],
        [classicalFateIds[39], 'moderate', "Trade olive oil to neighboring villages for profit", 0.55, 28, -12],
        [classicalFateIds[39], 'aggressive', "Claim the tree grants you divine wisdom over all!", 0.30, 50, -25],
        
        // Fate 40: Dionysus Party Chaos (-20 base)
        [classicalFateIds[40], 'conservative', "Establish curfews and restore order", 0.85, -10, -24],
        [classicalFateIds[40], 'moderate', "Channel the chaos into organized festivals", 0.55, 2, -28],
        [classicalFateIds[40], 'aggressive', "Join the party and try to impress Dionysus!", 0.30, 22, -38],
        
        // Fate 42: Phaethon's Chariot (high swing)
        [classicalFateIds[42], 'conservative', "Take shelter from the sun's heat", 0.85, 15, -5],
        [classicalFateIds[42], 'moderate', "Search for treasures revealed by the light", 0.55, 30, -15],
        [classicalFateIds[42], 'aggressive', "Try to catch the chariot reins yourself!", 0.30, 50, -30],
        
        // Fate 43: Orpheus's Lament (negative)
        [classicalFateIds[43], 'conservative', "Play cheerful music to counter the grief", 0.85, -8, -18],
        [classicalFateIds[43], 'moderate', "Challenge Orpheus to a musical contest", 0.55, 5, -22],
        [classicalFateIds[43], 'aggressive', "Journey to the Underworld to reunite Orpheus with Eurydice!", 0.30, 20, -35],

        // === SPECIAL FATES (placeholder choices — handled by special mechanics) ===
        
        // Fate 24: Ares Wild Boar Battle
        [classicalFateIds[24], 'conservative', "Battle — handled by battle system", 0.85, 0, 0],
        [classicalFateIds[24], 'moderate', "Battle — handled by battle system", 0.55, 0, 0],
        [classicalFateIds[24], 'aggressive', "Battle — handled by battle system", 0.30, 0, 0],
        
        // Fate 27: Kobalos Attack
        [classicalFateIds[27], 'conservative', "Battle — handled by battle system", 0.85, 0, 0],
        [classicalFateIds[27], 'moderate', "Battle — handled by battle system", 0.55, 0, 0],
        [classicalFateIds[27], 'aggressive', "Battle — handled by battle system", 0.30, 0, 0],
        
        // Fate 29: Countdown Your Fate
        [classicalFateIds[29], 'conservative', "Countdown — handled by teacher input", 0.85, 0, 0],
        [classicalFateIds[29], 'moderate', "Countdown — handled by teacher input", 0.55, 0, 0],
        [classicalFateIds[29], 'aggressive', "Countdown — handled by teacher input", 0.30, 0, 0],
        
        // Fate 30: Power of Prometheus (stored card)
        [classicalFateIds[30], 'conservative', "Prometheus Card — goes to inventory", 0.85, 0, 0],
        [classicalFateIds[30], 'moderate', "Prometheus Card — goes to inventory", 0.55, 0, 0],
        [classicalFateIds[30], 'aggressive', "Prometheus Card — goes to inventory", 0.30, 0, 0],
        
        // Fate 32: Reverse Card (stored card)
        [classicalFateIds[32], 'conservative', "Reverse Card — goes to inventory", 0.85, 0, 0],
        [classicalFateIds[32], 'moderate', "Reverse Card — goes to inventory", 0.55, 0, 0],
        [classicalFateIds[32], 'aggressive', "Reverse Card — goes to inventory", 0.30, 0, 0],
        
        // Fate 34: Giant Echion
        [classicalFateIds[34], 'conservative', "Battle — handled by battle system", 0.85, 0, 0],
        [classicalFateIds[34], 'moderate', "Battle — handled by battle system", 0.55, 0, 0],
        [classicalFateIds[34], 'aggressive', "Battle — handled by battle system", 0.30, 0, 0],
        
        // Fate 36: Cerastes Vipers
        [classicalFateIds[36], 'conservative', "Battle — handled by battle system", 0.85, 0, 0],
        [classicalFateIds[36], 'moderate', "Battle — handled by battle system", 0.55, 0, 0],
        [classicalFateIds[36], 'aggressive', "Battle — handled by battle system", 0.30, 0, 0],
        
        // Fate 41: Swamp Reptile
        [classicalFateIds[41], 'conservative', "Swamp challenge — handled by teacher input", 0.85, 0, 0],
        [classicalFateIds[41], 'moderate', "Swamp challenge — handled by teacher input", 0.55, 0, 0],
        [classicalFateIds[41], 'aggressive', "Swamp challenge — handled by teacher input", 0.30, 0, 0]
      ];

      classicalChoices.forEach(choice => {
        db.run(`INSERT INTO fate_choices (fate_id, risk_level, description, success_chance, success_points, failure_points)
                VALUES (?, ?, ?, ?, ?, ?)`, choice);
      });
      console.log('✅ Classical fate choices seeded (72 choices)');
      
      // Force save and verify
      saveDatabaseNow();
      const verifyCount = db.exec("SELECT COUNT(*) FROM fates_ref WHERE age_available = 'Classical'");
      console.log('🔍 Verification - Classical fates in DB:', verifyCount[0] ? verifyCount[0].values[0][0] : 'QUERY FAILED');
    }
  } catch (err) {
    console.error('❌ Classical fates seed ERROR:', err.message);
    console.error('❌ Full error:', err.stack || err);
  }

  // Double-check: verify total fates counts
  try {
    const allFatesCheck = db.exec("SELECT age_available, COUNT(*) as cnt FROM fates_ref GROUP BY age_available");
    if (allFatesCheck[0]) {
      const cols = allFatesCheck[0].columns;
      const vals = allFatesCheck[0].values;
      console.log('📊 Fates summary:', vals.map(v => `${v[0]}: ${v[1]}`).join(', '));
    }
  } catch (e) {
    console.log('Fates summary check failed:', e.message);
  }

  // === CLASSICAL BATTLE QUESTIONS (converted from myth quiz questions) ===
  // Add age and myth_name columns if they don't exist (migration for existing DBs)
  try {
    const cols = db.exec("PRAGMA table_info(battle_questions)");
    const colNames = cols[0] ? cols[0].values.map(c => c[1]) : [];
    if (!colNames.includes('age')) {
      db.run("ALTER TABLE battle_questions ADD COLUMN age TEXT DEFAULT 'Archaic'");
      console.log('✅ Added age column to battle_questions');
    }
    if (!colNames.includes('myth_name')) {
      db.run("ALTER TABLE battle_questions ADD COLUMN myth_name TEXT");
      console.log('✅ Added myth_name column to battle_questions');
    }
  } catch (e) {
    console.log('battle_questions column migration note:', e.message);
  }

  // Sync Classical battle questions from myth_quiz_questions
  try {
    const classicalBattleCheck = db.exec("SELECT COUNT(*) FROM battle_questions WHERE age = 'Classical'");
    const classicalBattleCount = classicalBattleCheck[0] ? classicalBattleCheck[0].values[0][0] : 0;
    
    // Get current myth quiz count to detect if new questions were added
    const quizCountCheck = db.exec("SELECT COUNT(*) FROM myth_quiz_questions");
    const totalQuizQuestions = quizCountCheck[0] ? quizCountCheck[0].values[0][0] : 0;
    
    if (classicalBattleCount !== totalQuizQuestions) {
      if (classicalBattleCount > 0) {
        console.log(`⚠️ Classical battle questions (${classicalBattleCount}) != quiz questions (${totalQuizQuestions}), re-syncing...`);
        db.run("DELETE FROM battle_questions WHERE age = 'Classical'");
      }
      
      // Portal ID to myth name mapping
      const portalNames = {
        1: 'Pandora', 2: 'Phaethon', 3: 'Orpheus', 4: 'Echo & Narcissus',
        5: 'Icarus', 6: 'Eros & Psyche', 7: 'Constellations'
      };
      
      // Get all quiz questions
      const quizRows = db.exec("SELECT portal_id, question_text, option_a, option_b, option_c, option_d, correct_answer FROM myth_quiz_questions");
      if (quizRows[0]) {
        let inserted = 0;
        quizRows[0].values.forEach(row => {
          const [portalId, questionText, optA, optB, optC, optD, correctLetter] = row;
          const mythName = portalNames[portalId] || 'Unknown';
          
          // Convert letter answer to actual text values for battle format
          const answers = { a: optA, b: optB, c: optC, d: optD };
          const correctAnswer = answers[correctLetter] || optA;
          
          // Get wrong answers (all options except the correct one)
          const wrongAnswers = Object.entries(answers)
            .filter(([letter]) => letter !== correctLetter)
            .map(([, text]) => text);
          
          db.run(`INSERT INTO battle_questions (god_associated, question_text, correct_answer, wrong_answer_1, wrong_answer_2, wrong_answer_3, difficulty, age, myth_name)
                  VALUES (?, ?, ?, ?, ?, ?, 'medium', 'Classical', ?)`,
            [mythName, questionText, correctAnswer, wrongAnswers[0], wrongAnswers[1], wrongAnswers[2], mythName]);
          inserted++;
        });
        console.log(`✅ Classical battle questions synced (${inserted} questions from ${Object.keys(portalNames).length} myths)`);
      }
      saveDatabaseNow();
    } else {
      console.log(`✅ Classical battle questions already synced (${classicalBattleCount} questions)`);
    }
  } catch (err) {
    console.error('❌ Classical battle questions sync error:', err.message);
  }

  console.log('🏛️ Classical Age data check complete');
}

// Debounced save to prevent EBUSY errors from rapid writes
let saveTimeout = null;
let pendingSave = false;

function saveDatabase() {
  // Mark that we need to save
  pendingSave = true;
  
  // If there's already a pending save, don't create another timeout
  if (saveTimeout) return;
  
  // Debounce: save after 100ms of no new save requests
  saveTimeout = setTimeout(() => {
    if (pendingSave) {
      try {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
        pendingSave = false;
      } catch (err) {
        if (err.code === 'EBUSY') {
          // File is busy, retry after a short delay
          console.log('Database busy, retrying save in 200ms...');
          setTimeout(saveDatabase, 200);
        } else {
          console.error('Save database error:', err);
        }
      }
    }
    saveTimeout = null;
  }, 100);
}

// Force immediate save (use sparingly)
function saveDatabaseNow() {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
    pendingSave = false;
  } catch (err) {
    if (err.code === 'EBUSY') {
      console.log('Database busy on immediate save, will retry...');
      pendingSave = true;
      saveDatabase(); // Queue a debounced save
    } else {
      console.error('Save database error:', err);
      throw err;
    }
  }
}

function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// Helper functions for common queries
function query(sql, params = []) {
  try {
    const results = db.exec(sql, params);
    return results[0] ? results[0].values.map(row => {
      const obj = {};
      results[0].columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    }) : [];
  } catch (err) {
    console.error('Query error:', err);
    throw err;
  }
}

function run(sql, params = []) {
  try {
    db.run(sql, params);
    saveDatabase();
    return { changes: db.getRowsModified() };
  } catch (err) {
    console.error('Run error:', err);
    throw err;
  }
}

module.exports = {
  initDatabase,
  getDatabase,
  saveDatabase,
  saveDatabaseNow,
  query,
  run
};
