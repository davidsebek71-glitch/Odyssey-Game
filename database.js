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
      is_active INTEGER DEFAULT 1
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
  // ==================== END MIGRATIONS ====================
  
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
      ['Pickaxe', 'earning_multiplier', 0.10, null, 'Complete Hephaestus side quest', 'Hephaestus', 'Archaic', 'Improves gold gather rate by +10%'],
      ['Handaxe', 'earning_multiplier', 0.10, null, 'Complete Artemis side quest', 'Artemis', 'Archaic', 'Increases wood gather rate by +10%'],
      ['Hunting Dogs', 'earning_multiplier', 0.10, null, 'Build Storehouse', 'Artemis', 'Archaic', 'Increases hunting rate by +10%'],
      ['Husbandry', 'earning_multiplier', 0.10, null, 'Build Granary', 'Hermes', 'Archaic', 'Increases food production by +10%']
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
        ['The Ring of Many', 'Hephaestus', 'A powerful ring forged by Hephaestus has fallen from the heavens. Return it to the gods and prove your worth.', 'technology', 'Pickaxe', '-10% cost on all building purchases', 'https://docs.google.com/forms/d/1GmU7Etpre0In5GXWcEy-Xlbsae5PdsW_0DcHlq0g-6s/viewform', '🪓'],
        ['Panacea\'s Remedy', 'Artemis', 'One of Artemis\' nymphs has been injured by Echidna. Journey to find Panacea\'s remedy to save her.', 'technology', 'Handaxe', '+5% on all points earned', 'https://docs.google.com/forms/d/1sxZVm3NP5w5mn1zGg1I2CsaT2cFUIh0eBjPricwXWmQ/viewform', '🪓'],
        ['The Three Seeds', 'Demeter', 'When Hades stole Persephone, she dropped three seeds. Find them and return them to Demeter.', 'building_unlock', 'Granary', 'Unlocks Granary building (-30% negative Fate outcomes)', 'https://docs.google.com/forms/d/1RfocW-Bzl-ajEaaOgPzIcFR-RueCe1S6qjCk32bGd-w/viewform', '🌾']
      ];

      sideQuests.forEach(sq => {
        db.run(`INSERT INTO side_quests_ref (quest_name, god_associated, description, reward_type, reward_name, reward_description, form_url, icon) 
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, sq);
      });
      console.log('✅ Side quests seeded');
    }

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
      
      ['bonus', 'bonus', 'Prometheus', 'Prometheus Bonus', 5,
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
        ]), 1, 'Archaic']
    ];
    
    assignments.forEach(a => {
      db.run(`INSERT INTO assignments_ref (section, assignment_type, myth_god, display_name, max_points, description, resource_links, is_bonus, age) 
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, a);
    });
    
    console.log('✅ Assignments seeded');
  } else {
    console.log('✅ Assignments already exist');
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
