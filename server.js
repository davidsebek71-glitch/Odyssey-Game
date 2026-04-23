const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const { initDatabase, query, run, saveDatabase } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'odyssey-secret-key-change-in-production';

// Test Period Configuration - Hidden from regular students
const TEST_PERIOD = 'Test';
function isTestPeriod(period) {
  return period === TEST_PERIOD;
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Increased limit for map image uploads
app.use(express.static('public'));

// Initialize database
let dbReady = false;
initDatabase().then(() => {
  dbReady = true;
  console.log('✅ Database initialized');

  // ── Heroic Age column migration ───────────────────────────────────────────
  // Runs immediately after DB is ready — before any queries can fire.
  // PRAGMA table_info is safe and returns existing columns only.
  try {
    const studentCols = query('PRAGMA table_info(students)').map(c => c.name);
    if (!studentCols.includes('selected_avatar')) {
      run('ALTER TABLE students ADD COLUMN selected_avatar TEXT DEFAULT NULL');
      console.log('✅ Migration: added selected_avatar to students');
    }
    if (!studentCols.includes('avatar_selected_at')) {
      run('ALTER TABLE students ADD COLUMN avatar_selected_at DATETIME DEFAULT NULL');
      console.log('✅ Migration: added avatar_selected_at to students');
    }
    if (!studentCols.includes('drachma')) {
      run('ALTER TABLE students ADD COLUMN drachma INTEGER DEFAULT 0');
      console.log('✅ Migration: added drachma to students');
    }
    saveDatabase();
  } catch (err) {
    console.error('❌ Heroic column migration error:', err.message);
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Hercules 12 Labors tables ─────────────────────────────────────────
  try {
    run(`CREATE TABLE IF NOT EXISTS hercules_log_completions (
      completion_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_name TEXT NOT NULL,
      class_period TEXT NOT NULL,
      alliance_name TEXT,
      hero_code TEXT,
      rank_tier TEXT,
      total_score INTEGER DEFAULT 0,
      stop_scores TEXT DEFAULT '{}',
      written_answers TEXT DEFAULT '{}',
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      override_by_teacher INTEGER DEFAULT 0,
      UNIQUE(student_name, class_period)
    )`);
    run(`CREATE TABLE IF NOT EXISTS hercules_log_progress (
      student_name TEXT NOT NULL,
      class_period TEXT NOT NULL,
      state_json TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (student_name, class_period)
    )`);
    run(`CREATE TABLE IF NOT EXISTS hercules_log_unlocks (
      class_period TEXT PRIMARY KEY,
      unlocked_up_to INTEGER DEFAULT -1
    )`);
    saveDatabase();
    console.log('🦁 Hercules log tables ensured');
  } catch (e) {
    console.log('🦁 Hercules tables already exist or migration skipped:', e.message);
  }

  // ── Theseus Road to the Labyrinth tables ────────────────────────────────
  try {
    run(`CREATE TABLE IF NOT EXISTS theseus_log_completions (
      completion_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_name TEXT NOT NULL,
      class_period TEXT NOT NULL,
      alliance_name TEXT,
      hero_code TEXT,
      rank_tier TEXT,
      total_score INTEGER DEFAULT 0,
      stop_scores TEXT DEFAULT '{}',
      written_answers TEXT DEFAULT '{}',
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      override_by_teacher INTEGER DEFAULT 0,
      UNIQUE(student_name, class_period)
    )`);
    run(`CREATE TABLE IF NOT EXISTS theseus_log_progress (
      student_name TEXT NOT NULL,
      class_period TEXT NOT NULL,
      student_id INTEGER,
      state_json TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (student_name, class_period)
    )`);
    run(`CREATE TABLE IF NOT EXISTS theseus_log_unlocks (
      class_period TEXT PRIMARY KEY,
      unlocked_up_to INTEGER DEFAULT -1
    )`);
    saveDatabase();
    console.log('🗡️ Theseus log tables ensured');
  } catch (e) {
    console.log('🗡️ Theseus tables already exist or migration skipped:', e.message);
  }

  // ── Perseus log tables ──
  try {
    run(`CREATE TABLE IF NOT EXISTS perseus_log_completions (
      completion_id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_name TEXT NOT NULL,
      class_period TEXT NOT NULL,
      alliance_name TEXT,
      hero_code TEXT,
      rank_tier TEXT,
      total_score INTEGER DEFAULT 0,
      stop_scores TEXT DEFAULT '{}',
      written_answers TEXT DEFAULT '{}',
      completed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      override_by_teacher INTEGER DEFAULT 0,
      UNIQUE(student_name, class_period)
    )`);
    run(`CREATE TABLE IF NOT EXISTS perseus_log_progress (
      student_name TEXT NOT NULL,
      class_period TEXT NOT NULL,
      student_id INTEGER,
      state_json TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (student_name, class_period)
    )`);
    run(`CREATE TABLE IF NOT EXISTS perseus_log_unlocks (
      class_period TEXT PRIMARY KEY,
      unlocked_up_to INTEGER DEFAULT -1
    )`);
    saveDatabase();
    console.log('🪽 Perseus log tables ensured');
  } catch (e) {
    console.log('🪽 Perseus tables already exist or migration skipped:', e.message);
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Voyage Log: add student_id column to existing voyage_log_progress ──
  // Brings Jason's login parity with Theseus/Perseus/Hercules (cascading dropdown).
  // Safe ALTER — skips if column already exists. Old rows keep NULL student_id
  // until they log in once, then the load-by-id endpoint backfills it.
  try {
    try { run('ALTER TABLE voyage_log_progress ADD COLUMN student_id INTEGER'); } catch(e) {}
    saveDatabase();
    console.log('⚓ Voyage log progress.student_id column ensured');
  } catch(e) {
    console.log('Voyage log migration note:', e.message);
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Hercules + Theseus student columns (safe ALTER — skips if exists) ──
  try {
    try { run('ALTER TABLE students ADD COLUMN hercules_log_completed INTEGER DEFAULT 0'); } catch(e) {}
    try { run('ALTER TABLE students ADD COLUMN hercules_hero_code TEXT DEFAULT NULL'); } catch(e) {}
    try { run('ALTER TABLE students ADD COLUMN hercules_rank_tier TEXT DEFAULT NULL'); } catch(e) {}
    try { run('ALTER TABLE students ADD COLUMN theseus_log_completed INTEGER DEFAULT 0'); } catch(e) {}
    try { run('ALTER TABLE students ADD COLUMN theseus_hero_code TEXT DEFAULT NULL'); } catch(e) {}
    try { run('ALTER TABLE students ADD COLUMN theseus_rank_tier TEXT DEFAULT NULL'); } catch(e) {}
    try { run('ALTER TABLE students ADD COLUMN perseus_log_completed INTEGER DEFAULT 0'); } catch(e) {}
    try { run('ALTER TABLE students ADD COLUMN perseus_hero_code TEXT DEFAULT NULL'); } catch(e) {}
    try { run('ALTER TABLE students ADD COLUMN perseus_rank_tier TEXT DEFAULT NULL'); } catch(e) {}
    saveDatabase();
    console.log('✅ Hercules + Theseus + Perseus student columns ensured');
  } catch(e) {
    console.log('Column migration note:', e.message);
  }
  // ─────────────────────────────────────────────────────────────────────────
  // before this feature was deployed. Safe to re-run — INSERT OR IGNORE skips existing rows.
  try {
    const triggerMap = [
      { portal_id: 3, trigger_ref: 'Orpheus Quiz' },
      { portal_id: 4, trigger_ref: 'Echo and Narcissus Quiz' },
      { portal_id: 6, trigger_ref: 'Eros and Psyche Quiz' }
    ];
    let backfilled = 0;
    triggerMap.forEach(({ portal_id, trigger_ref }) => {
      const quest = query(
        "SELECT quest_id FROM side_quests_ref WHERE quest_type = 'game_link' AND unlock_trigger_ref = ?",
        [trigger_ref]
      )[0];
      if (!quest) return;
      // Find all students who have ever passed this quiz
      const passedStudents = query(
        'SELECT DISTINCT student_id FROM myth_quiz_attempts WHERE portal_id = ? AND passed = 1',
        [portal_id]
      );
      passedStudents.forEach(({ student_id }) => {
        run(
          `INSERT OR IGNORE INTO side_quest_availability (student_id, quest_id, status, unlocked_at)
           VALUES (?, ?, 'available', ?)`,
          [student_id, quest.quest_id, Math.floor(Date.now() / 1000)]
        );
        backfilled++;
      });
    });
    if (backfilled > 0) {
      saveDatabase();
      console.log(`🔓 V97 backfill: unlocked game quests for ${backfilled} existing quiz passes`);
    } else {
      console.log('✅ V97 backfill: no existing quiz passes to backfill');
    }
  } catch (backfillErr) {
    console.error('V97 backfill error (non-fatal):', backfillErr.message);
  }

  // ── V98 backfill: Fix missing quiz grades caused by portal-to-assignment naming mismatch ──
  // myth_portals uses names like 'Icarus & Daedalus' but assignments_ref uses 'Icarus'
  // Students who passed quizzes via /api/student/submit-quiz never got grade_records entries
  try {
    const portalToAssignmentName = {
      'Icarus & Daedalus': 'Icarus',
      'Icarus and Daedalus': 'Icarus',
      'Echo & Narcissus': 'Echo and Narcissus',
      'Orpheus & Eurydice': 'Orpheus',
      'Eros & Psyche': 'Eros and Psyche',
      'Eros and Psyche': 'Eros and Psyche'
    };

    // Get all portals
    const portals = query('SELECT portal_id, myth_name FROM myth_portals');
    let backfilledGrades = 0;

    portals.forEach(portal => {
      const assignmentMythGod = portalToAssignmentName[portal.myth_name] || portal.myth_name;
      
      // Find the quiz assignment for this portal
      const quizAssignment = query(
        "SELECT assignment_id, max_points FROM assignments_ref WHERE section = 'classical' AND assignment_type = 'quiz' AND myth_god = ?",
        [assignmentMythGod]
      )[0];
      if (!quizAssignment) return;

      // Find students who passed this quiz (best attempt) but have no grade_records entry
      const passedStudents = query(
        `SELECT mqa.student_id, MAX(mqa.score) as best_score, MAX(mqa.total_questions) as total_q
         FROM myth_quiz_attempts mqa
         WHERE mqa.portal_id = ? AND mqa.passed = 1
         AND NOT EXISTS (
           SELECT 1 FROM grade_records gr 
           WHERE gr.student_id = mqa.student_id AND gr.assignment_id = ?
         )
         GROUP BY mqa.student_id`,
        [portal.portal_id, quizAssignment.assignment_id]
      );

      passedStudents.forEach(s => {
        const pointsEarned = Math.round((s.best_score / s.total_q) * quizAssignment.max_points);
        run(
          `INSERT INTO grade_records (student_id, assignment_id, points_earned, points_possible)
           VALUES (?, ?, ?, ?)`,
          [s.student_id, quizAssignment.assignment_id, pointsEarned, quizAssignment.max_points]
        );
        backfilledGrades++;
        console.log(`📝 V98 backfill: grade recorded for student ${s.student_id} - portal ${portal.myth_name} → ${assignmentMythGod} (${pointsEarned}/${quizAssignment.max_points})`);
      });
    });

    if (backfilledGrades > 0) {
      saveDatabase();
      console.log(`📝 V98 backfill: recorded ${backfilledGrades} missing quiz grades`);
    } else {
      console.log('✅ V98 backfill: no missing quiz grades found');
    }
  } catch (backfillErr) {
    console.error('V98 backfill error (non-fatal):', backfillErr.message);
  }

}).catch(err => {
  console.error('❌ Database initialization failed:', err);
  process.exit(1);
});

// Middleware to check if database is ready
function requireDbReady(req, res, next) {
  if (!dbReady) {
    return res.status(503).json({ error: 'Server is starting up, please wait...' });
  }
  next();
}

// Apply database check to all API routes
app.use('/api', requireDbReady);

// Auth middleware
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid token' });
    }
    req.user = user;
    next();
  });
}

// ====================
// ACHIEVEMENT TRACKING HELPERS
// ====================

// Ensure student has an achievement progress record
function ensureAchievementProgress(student_id) {
  const existing = query('SELECT * FROM student_achievement_progress WHERE student_id = ?', [student_id]);
  if (existing.length === 0) {
    run('INSERT INTO student_achievement_progress (student_id) VALUES (?)', [student_id]);
  }
}

// Update achievement progress when a submission is approved
function updateAchievementProgress(student_id, category, points_earned, max_points) {
  ensureAchievementProgress(student_id);
  
  const progress = query('SELECT * FROM student_achievement_progress WHERE student_id = ?', [student_id])[0];
  
  if (category === 'quiz' && max_points) {
    // Update quiz tracking
    const newQuizCount = progress.quiz_count + 1;
    const newQuizEarned = progress.quiz_total_earned + points_earned;
    const newQuizPossible = progress.quiz_total_possible + max_points;
    
    run(`UPDATE student_achievement_progress 
         SET quiz_count = ?, quiz_total_earned = ?, quiz_total_possible = ?
         WHERE student_id = ?`,
        [newQuizCount, newQuizEarned, newQuizPossible, student_id]);
    
    // Check for Coeus unlock (8+ quizzes with 80%+ average)
    if (newQuizCount >= 8 && !progress.coeus_unlocked) {
      const avgPercent = (newQuizEarned / newQuizPossible) * 100;
      if (avgPercent >= 80) {
        run(`UPDATE student_achievement_progress 
             SET coeus_unlocked = 1, coeus_unlocked_at = CURRENT_TIMESTAMP
             WHERE student_id = ?`, [student_id]);
        console.log(`🏆 Student ${student_id} unlocked Curiosity of Coeus!`);
      }
    }
  } else if ((category === 'myth_comp_conn' || category === 'comp_conn') && max_points) {
    // Update comp conn tracking
    const newCompCount = progress.comp_conn_count + 1;
    const newCompEarned = progress.comp_conn_total_earned + points_earned;
    const newCompPossible = progress.comp_conn_total_possible + max_points;
    
    run(`UPDATE student_achievement_progress 
         SET comp_conn_count = ?, comp_conn_total_earned = ?, comp_conn_total_possible = ?
         WHERE student_id = ?`,
        [newCompCount, newCompEarned, newCompPossible, student_id]);
    
    // Check for Metis unlock (8+ comp conns with 80%+ average)
    if (newCompCount >= 8 && !progress.metis_unlocked) {
      const avgPercent = (newCompEarned / newCompPossible) * 100;
      if (avgPercent >= 80) {
        run(`UPDATE student_achievement_progress 
             SET metis_unlocked = 1, metis_unlocked_at = CURRENT_TIMESTAMP
             WHERE student_id = ?`, [student_id]);
        console.log(`🏆 Student ${student_id} unlocked Mind of Metis!`);
      }
    }
  } else if (category === 'mural') {
    // Update mural count
    const newMuralCount = progress.mural_count + 1;
    
    run(`UPDATE student_achievement_progress SET mural_count = ? WHERE student_id = ?`,
        [newMuralCount, student_id]);
    
    // Check for Apollo unlock (2+ murals)
    if (newMuralCount >= 2 && !progress.apollo_unlocked) {
      run(`UPDATE student_achievement_progress 
           SET apollo_unlocked = 1, apollo_unlocked_at = CURRENT_TIMESTAMP
           WHERE student_id = ?`, [student_id]);
      console.log(`🏆 Student ${student_id} unlocked Apollo's Blessing!`);
    }
  }
}

// Update achievement progress for RESUBMISSIONS (adjust totals without incrementing count)
function updateAchievementProgressForResubmission(student_id, category, points_diff, max_points_diff) {
  ensureAchievementProgress(student_id);
  
  const progress = query('SELECT * FROM student_achievement_progress WHERE student_id = ?', [student_id])[0];
  
  if (category === 'quiz' && max_points_diff !== undefined) {
    // Adjust quiz totals (don't increment count)
    const newQuizEarned = progress.quiz_total_earned + points_diff;
    const newQuizPossible = progress.quiz_total_possible + max_points_diff;
    
    run(`UPDATE student_achievement_progress 
         SET quiz_total_earned = ?, quiz_total_possible = ?
         WHERE student_id = ?`,
        [newQuizEarned, newQuizPossible, student_id]);
    
    console.log(`Resubmission: Adjusted quiz totals by ${points_diff}/${max_points_diff}`);
    
    // Recheck for Coeus unlock
    if (progress.quiz_count >= 8 && !progress.coeus_unlocked) {
      const avgPercent = (newQuizEarned / newQuizPossible) * 100;
      if (avgPercent >= 80) {
        run(`UPDATE student_achievement_progress 
             SET coeus_unlocked = 1, coeus_unlocked_at = CURRENT_TIMESTAMP
             WHERE student_id = ?`, [student_id]);
        console.log(`🏆 Student ${student_id} unlocked Curiosity of Coeus!`);
      }
    }
  } else if ((category === 'myth_comp_conn' || category === 'comp_conn') && max_points_diff !== undefined) {
    // Adjust comp conn totals (don't increment count)
    const newCompEarned = progress.comp_conn_total_earned + points_diff;
    const newCompPossible = progress.comp_conn_total_possible + max_points_diff;
    
    run(`UPDATE student_achievement_progress 
         SET comp_conn_total_earned = ?, comp_conn_total_possible = ?
         WHERE student_id = ?`,
        [newCompEarned, newCompPossible, student_id]);
    
    console.log(`Resubmission: Adjusted comp_conn totals by ${points_diff}/${max_points_diff}`);
    
    // Recheck for Metis unlock
    if (progress.comp_conn_count >= 8 && !progress.metis_unlocked) {
      const avgPercent = (newCompEarned / newCompPossible) * 100;
      if (avgPercent >= 80) {
        run(`UPDATE student_achievement_progress 
             SET metis_unlocked = 1, metis_unlocked_at = CURRENT_TIMESTAMP
             WHERE student_id = ?`, [student_id]);
        console.log(`🏆 Student ${student_id} unlocked Mind of Metis!`);
      }
    }
  }
  // Note: Murals don't typically have resubmissions that change points
}

// Get achievement bonus multiplier for a category
function getAchievementBonus(student_id, category) {
  const progress = query('SELECT * FROM student_achievement_progress WHERE student_id = ?', [student_id])[0];
  if (!progress) return 0;
  
  let bonus = 0;
  
  if (category === 'quiz' && progress.coeus_unlocked) {
    bonus = 0.10; // +10% for quizzes
  } else if ((category === 'myth_comp_conn' || category === 'comp_conn') && progress.metis_unlocked) {
    bonus = 0.15; // +15% for comp conns
  } else if (category === 'mural' && progress.apollo_unlocked) {
    bonus = 0.33; // +33% for murals
  }
  
  return bonus;
}

// ====================
// AUTH ROUTES
// ====================

// Teacher Registration
app.post('/api/auth/teacher/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    
    // Check if teacher exists
    const existing = query('SELECT * FROM teachers WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Teacher already exists' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);
    
    // Insert teacher
    run('INSERT INTO teachers (name, email, password_hash) VALUES (?, ?, ?)', 
        [name, email, password_hash]);
    
    const teacher = query('SELECT teacher_id, name, email FROM teachers WHERE email = ?', [email])[0];
    
    // Generate token
    const token = jwt.sign({ id: teacher.teacher_id, type: 'teacher' }, JWT_SECRET);
    
    res.json({ token, teacher });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Teacher Login
app.post('/api/auth/teacher/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const teachers = query('SELECT * FROM teachers WHERE email = ?', [email]);
    if (teachers.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const teacher = teachers[0];
    const validPassword = await bcrypt.compare(password, teacher.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ id: teacher.teacher_id, type: 'teacher' }, JWT_SECRET);
    
    res.json({ 
      token, 
      teacher: { 
        teacher_id: teacher.teacher_id, 
        name: teacher.name, 
        email: teacher.email 
      } 
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Student Registration
app.post('/api/auth/student/register', async (req, res) => {
  try {
    const { name, email, password, class_period } = req.body;
    
    // Validate required fields
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if (!email || !email.trim()) {
      return res.status(400).json({ error: 'Email is required' });
    }
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }
    
    const existing = query('SELECT * FROM students WHERE email = ?', [email]);
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Student already exists' });
    }

    const password_hash = await bcrypt.hash(password, 10);
    
    run('INSERT INTO students (name, email, password_hash, class_period) VALUES (?, ?, ?, ?)', 
        [name.trim(), email.trim(), password_hash, class_period || null]);
    
    const student = query('SELECT student_id, name, email, class_period FROM students WHERE email = ?', [email])[0];
    
    const token = jwt.sign({ id: student.student_id, type: 'student' }, JWT_SECRET);
    
    res.json({ token, student });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Student Login
app.post('/api/auth/student/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    const students = query('SELECT * FROM students WHERE email = ?', [email]);
    if (students.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const student = students[0];
    
    // Block ghost students from logging in
    if (student.is_ghost) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const validPassword = await bcrypt.compare(password, student.password_hash);
    
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const token = jwt.sign({ id: student.student_id, type: 'student' }, JWT_SECRET);
    
    res.json({ 
      token, 
      student: { 
        student_id: student.student_id, 
        name: student.name, 
        email: student.email,
        alliance_id: student.alliance_id
      } 
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ====================
// TEACHER ROUTES
// ====================

// Get Leaderboard
app.get('/api/teacher/leaderboard', authenticateToken, (req, res) => {
  try {
    const { class_period } = req.query; // Optional filter
    
    let whereClause = 'WHERE a.is_disbanded = 0';
    let params = [];
    
    if (class_period) {
      whereClause += ' AND a.class_period = ?';
      params.push(class_period);
    }
    
    const alliances = query(`
      SELECT 
        a.alliance_id,
        a.alliance_name,
        a.class_period,
        a.total_points,
        a.current_age,
        a.buildings_owned,
        a.underdog_blessing,
        a.side_quest_rewards,
        COUNT(s.student_id) as member_count
      FROM alliances a
      LEFT JOIN students s ON a.alliance_id = s.alliance_id
      ${whereClause}
      GROUP BY a.alliance_id
      ORDER BY a.class_period, a.total_points DESC
    `, params);
    
    // Parse JSON fields and get member names
    alliances.forEach(alliance => {
      alliance.buildings_owned = JSON.parse(alliance.buildings_owned || '[]');
      
      // Get real member names
      const realMembers = query(`
        SELECT name FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL) ORDER BY name
      `, [alliance.alliance_id]);
      
      // Get ghost member names
      const ghostMembers = query(`
        SELECT name FROM students WHERE alliance_id = ? AND is_ghost = 1 ORDER BY name
      `, [alliance.alliance_id]);
      
      alliance.member_names = realMembers.map(m => m.name);
      alliance.ghost_names = ghostMembers.map(m => m.name);
      alliance.real_member_count = realMembers.length;
      alliance.ghost_count = ghostMembers.length;
      
      // Calculate ghost bonus points
      // Ghost display: each ghost adds 1x total_points. display = total × (ghost_count + 1)
      alliance.ghost_bonus = alliance.total_points * ghostMembers.length;
      alliance.display_points = alliance.total_points + alliance.ghost_bonus;
      
      // Parse side quest rewards and convert to emoji icons
      const rewards = JSON.parse(alliance.side_quest_rewards || '[]');
      alliance.side_quest_reward_icons = rewards.map(questId => {
        if (questId === 1) return '🔨';
        if (questId === 2) return '🏹';
        if (questId === 3) return '🌾';
        if (questId === 4) return '🏠';
        if (questId === 5) return '🦉';
        return '';
      }).join('');
    });
    
    // Re-sort by class_period then display_points (includes ghost bonus)
    alliances.sort((a, b) => {
      if (a.class_period !== b.class_period) return (a.class_period || '').localeCompare(b.class_period || '');
      return b.display_points - a.display_points;
    });
    
    res.json(alliances);
  } catch (err) {
    console.error('Leaderboard error:', err);
    res.status(500).json({ error: 'Failed to fetch leaderboard' });
  }
});

// Award Points
app.post('/api/teacher/award-points', authenticateToken, (req, res) => {
  try {
    const { alliance_id, student_id, amount, max_points, category, reason } = req.body;
    const teacher_id = req.user.id;
    
    if (!alliance_id) {
      return res.status(400).json({ error: 'alliance_id required' });
    }

    // V91 FIX: Membean cap — max 45 points per manual award
    const MEMBEAN_MAX = 45;
    if (category === 'membean' && amount > MEMBEAN_MAX) {
      return res.status(400).json({ 
        error: 'Membean awards are capped at ' + MEMBEAN_MAX + ' points per entry. You entered ' + amount + '. Please correct and resubmit.'
      });
    }

    // V91 FIX: Duplicate detection for manual quiz/reading note awards
    // If same student+category+reason already has points, deduct old before adding new
    if (student_id && amount > 0 && ['quiz', 'myth_comp_conn', 'comp_conn', 'mural'].includes(category) && reason) {
      const existing = query(
        'SELECT transaction_id, amount FROM point_transactions WHERE student_id = ? AND category = ? AND reason = ? AND amount > 0 ORDER BY timestamp DESC LIMIT 1',
        [student_id, category, reason]
      )[0];

      if (existing) {
        if (existing.amount === amount) {
          return res.status(400).json({ 
            error: 'Duplicate detected: ' + reason + ' was already awarded ' + existing.amount + ' pts to this student. No change made.'
          });
        }
        // Score changed (resubmit) — deduct old amount before new one is applied below
        run('UPDATE alliances SET total_points = total_points - ? WHERE alliance_id = ?', [existing.amount, alliance_id]);
        run(
          'INSERT INTO point_transactions (alliance_id, student_id, amount, category, reason, teacher_id) VALUES (?, ?, ?, ?, ?, ?)',
          [alliance_id, student_id, -existing.amount, category, 'Duplicate correction: removed previous ' + reason, teacher_id]
        );
        console.log('Duplicate manual award detected for ' + category + '/' + reason + ' - deducted previous ' + existing.amount + ' pts');
      }
    }


    
    // Start with base amount
    let finalAmount = amount;
    let techMultiplier = 1.0;
    let buildingBonus = 0;
    let achievementBonus = 0;
    
    // Categories exempt from all multipliers — a bonus is a reward in itself
    const EXEMPT_CATEGORIES = ['bonus_work', 'extra_credit', 'citizenship'];
    const isExempt = EXEMPT_CATEGORIES.includes(category);
    
    // Only apply bonuses to positive point awards that aren't exempt
    if (amount > 0 && !isExempt) {
      // Track achievement progress if student specified
      if (student_id && category) {
        updateAchievementProgress(student_id, category, amount, max_points || null);
      }
      
      // Calculate technology bonuses if student specified
      if (student_id) {
        const student = query('SELECT technologies_unlocked FROM students WHERE student_id = ?', [student_id])[0];
        if (student) {
          const techs = JSON.parse(student.technologies_unlocked || '[]');
          if (techs.length > 0) {
            const techDetails = query(`SELECT bonus_value, specific_assignment_type FROM technologies_ref WHERE tech_name IN (${techs.map(() => '?').join(',')})`, techs);
            
            techDetails.forEach(tech => {
              // Apply bonus if it's general or matches the category
              if (!tech.specific_assignment_type || tech.specific_assignment_type === category) {
                techMultiplier *= (1 + tech.bonus_value);
              }
            });
          }
        }
        
        // Get achievement power-up bonus
        achievementBonus = getAchievementBonus(student_id, category);
      }
      
      // Calculate building activation bonuses
      buildingBonus = getAllianceBuildingBonus(alliance_id);
      
      // Apply all bonuses: (base * tech multiplier) * (1 + building bonus) * (1 + achievement bonus)
      finalAmount = Math.round(amount * techMultiplier * (1 + buildingBonus) * (1 + achievementBonus));
    }
    
    // Add points to alliance
    run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
        [finalAmount, alliance_id]);
    
    // Log transaction - use null for undefined student_id
    run(`INSERT INTO point_transactions (alliance_id, student_id, amount, category, reason, teacher_id) 
         VALUES (?, ?, ?, ?, ?, ?)`, 
        [alliance_id, student_id || null, finalAmount, category || 'general', reason || 'Points awarded', teacher_id]);
    
    // Get updated alliance
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    
    // Build bonus breakdown for response
    const bonusBreakdown = {
      base_amount: amount,
      tech_multiplier: Math.round((techMultiplier - 1) * 100),
      building_bonus: Math.round(buildingBonus * 100),
      achievement_bonus: Math.round(achievementBonus * 100),
      final_amount: finalAmount
    };
    
    res.json({ 
      success: true, 
      finalAmount,
      bonusBreakdown,
      alliance
    });
    
    // Auto-award Citizen badge when citizenship points are given to a specific student
    if (category === 'citizenship' && student_id) {
      try {
        const newBadges = scanForBadges(student_id);
        newBadges.forEach(badge => {
          try {
            run(`INSERT OR IGNORE INTO student_badges (student_id, badge_id, ring_level, claimed, awarded_by)
                 VALUES (?, ?, 0, 0, 'system')`, [student_id, badge.badge_id]);
          } catch(e) { /* already exists */ }
        });
        if (newBadges.length > 0) saveDatabase();
      } catch(e) { /* non-critical */ }
    }
  } catch (err) {
    console.error('Award points error:', err);
    res.status(500).json({ error: 'Failed to award points' });
  }
});

// Deduct Points
app.post('/api/teacher/deduct-points', authenticateToken, (req, res) => {
  try {
    const { alliance_id, amount, reason } = req.body;
    const teacher_id = req.user.id;
    
    run('UPDATE alliances SET total_points = total_points - ? WHERE alliance_id = ?', 
        [amount, alliance_id]);
    
    run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) 
         VALUES (?, ?, ?, ?, ?)`, 
        [alliance_id, -amount, 'deduction', reason, teacher_id]);
    
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    
    res.json({ success: true, alliance });
  } catch (err) {
    console.error('Deduct points error:', err);
    res.status(500).json({ error: 'Failed to deduct points' });
  }
});

// Set Points (override) - for fixing corrupted point values
app.post('/api/teacher/set-points', authenticateToken, (req, res) => {
  try {
    const { alliance_id, new_total, reason } = req.body;
    const teacher_id = req.user.id;
    
    if (new_total === undefined || new_total === null) {
      return res.status(400).json({ error: 'new_total is required' });
    }
    
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    if (!alliance) {
      return res.status(404).json({ error: 'Alliance not found' });
    }
    
    const oldTotal = alliance.total_points;
    
    // Directly set the points
    run('UPDATE alliances SET total_points = ? WHERE alliance_id = ?', 
        [Math.floor(new_total), alliance_id]);
    
    // Log the correction
    run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) 
         VALUES (?, ?, ?, ?, ?)`, 
        [alliance_id, Math.floor(new_total) - oldTotal, 'correction', 
         reason || `Points reset from ${oldTotal} to ${new_total}`, teacher_id]);
    
    saveDatabase();
    
    const updated = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    
    console.log(`🔧 Points corrected for ${updated.alliance_name}: ${oldTotal} → ${new_total}`);
    
    res.json({ success: true, old_total: oldTotal, new_total: updated.total_points, alliance: updated });
  } catch (err) {
    console.error('Set points error:', err);
    res.status(500).json({ error: 'Failed to set points' });
  }
});

// Get Recent Transactions
app.get('/api/teacher/transactions', authenticateToken, (req, res) => {
  try {
    const limit = req.query.limit || 20;
    const transactions = query(`
      SELECT 
        t.*,
        a.alliance_name,
        s.name as student_name
      FROM point_transactions t
      LEFT JOIN alliances a ON t.alliance_id = a.alliance_id
      LEFT JOIN students s ON t.student_id = s.student_id
      ORDER BY t.timestamp DESC
      LIMIT ?
    `, [limit]);
    
    res.json(transactions);
  } catch (err) {
    console.error('Transactions error:', err);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// Get Alliance Details
app.get('/api/teacher/alliance/:id', authenticateToken, (req, res) => {
  try {
    const alliance_id = req.params.id;
    
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    if (!alliance) {
      return res.status(404).json({ error: 'Alliance not found' });
    }
    
    const members = query('SELECT student_id, name, technologies_unlocked FROM students WHERE alliance_id = ?', [alliance_id]);
    
    alliance.buildings_owned = JSON.parse(alliance.buildings_owned || '[]');
    members.forEach(m => {
      m.technologies_unlocked = JSON.parse(m.technologies_unlocked || '[]');
    });
    
    res.json({ alliance, members });
  } catch (err) {
    console.error('Alliance details error:', err);
    res.status(500).json({ error: 'Failed to fetch alliance details' });
  }
});

// Get All Alliances for Teacher Management
app.get('/api/teacher/alliances', authenticateToken, (req, res) => {
  try {
    const alliances = query(`
      SELECT 
        a.alliance_id,
        a.alliance_name,
        a.class_period,
        a.total_points,
        a.buildings_owned,
        a.is_disbanded,
        a.created_at
      FROM alliances a
      WHERE a.is_disbanded = 0
      ORDER BY a.class_period, a.total_points DESC
    `);

    // Enrich each alliance with separated real/ghost member data
    alliances.forEach(alliance => {
      const realMembers = query(
        'SELECT student_id, name FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL) ORDER BY name',
        [alliance.alliance_id]
      );
      const ghostMembers = query(
        'SELECT student_id, name FROM students WHERE alliance_id = ? AND is_ghost = 1 ORDER BY name',
        [alliance.alliance_id]
      );
      alliance.member_names = realMembers.map(m => m.name);
      alliance.member_count = realMembers.length;
      alliance.real_member_count = realMembers.length;
      alliance.ghost_members = ghostMembers; // [{student_id, name}]
      alliance.ghost_names = ghostMembers.map(m => m.name);
      alliance.ghost_count = ghostMembers.length;
      // Ghost display bonus (same formula as leaderboard)
      // Ghost display: each ghost adds 1x total_points. display = total × (ghost_count + 1)
      alliance.display_points = alliance.total_points + (alliance.total_points * ghostMembers.length);
    });

    res.json(alliances);
  } catch (err) {
    console.error('Get alliances error:', err);
    res.status(500).json({ error: 'Failed to fetch alliances' });
  }
});

// Disband Alliance (Teacher only)
app.post('/api/teacher/disband-alliance', authenticateToken, (req, res) => {
  try {
    const { alliance_id } = req.body;
    
    // Get alliance info before disbanding
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    if (!alliance) {
      return res.status(404).json({ error: 'Alliance not found' });
    }
    
    // Calculate building values to sell back
    const ownedBuildings = JSON.parse(alliance.buildings_owned || '[]');
    let buildingRefundTotal = 0;
    
    // Get building prices for refund calculation
    const buildingPrices = query('SELECT building_name, cost_points FROM buildings_ref');
    const priceMap = {};
    buildingPrices.forEach(b => { priceMap[b.building_name] = b.cost_points; });
    
    // Refund all buildings at full cost
    ownedBuildings.forEach(buildingName => {
      buildingRefundTotal += priceMap[buildingName] || 0;
    });
    
    // Total points to distribute = current points + building refunds
    const totalToDistribute = alliance.total_points + buildingRefundTotal;
    
    // Get all members
    const members = query(`
      SELECT 
        s.student_id,
        s.name,
        COALESCE(SUM(CASE WHEN pt.amount > 0 THEN pt.amount ELSE 0 END), 0) as points_contributed
      FROM students s
      LEFT JOIN point_transactions pt ON s.student_id = pt.student_id AND pt.alliance_id = ?
      WHERE s.alliance_id = ?
      GROUP BY s.student_id
    `, [alliance_id, alliance_id]);
    
    const memberCount = members.length;
    const pointsPerMember = memberCount > 0 ? Math.floor(totalToDistribute / memberCount) : 0;
    
    // Save each member's contributions and give them their share
    members.forEach(member => {
      // Record their contribution history
      run(`INSERT INTO student_contributions (student_id, alliance_id, points_contributed, buildings_contributed)
           VALUES (?, ?, ?, ?)`,
          [member.student_id, alliance_id, member.points_contributed, alliance.buildings_owned]);
      
      // Remove from alliance (make them free agents)
      run('UPDATE students SET alliance_id = NULL WHERE student_id = ?', [member.student_id]);
      
      // Delete their building placements (buildings are gone)
      run('DELETE FROM building_placements WHERE student_id = ?', [member.student_id]);
    });
    
    // Mark alliance as disbanded (don't delete, keep for history)
    run('UPDATE alliances SET is_disbanded = 1, total_points = 0, buildings_owned = ? WHERE alliance_id = ?', 
        [JSON.stringify([]), alliance_id]);
    
    // Cancel any pending invitations
    run("UPDATE alliance_invitations SET status = 'cancelled' WHERE alliance_id = ? AND status = 'pending'", [alliance_id]);
    
    // Delete god assignments for this alliance
    run('DELETE FROM god_assignments WHERE alliance_id = ?', [alliance_id]);
    
    // Delete building activations for this alliance
    run('DELETE FROM building_activations WHERE alliance_id = ?', [alliance_id]);
    
    res.json({ 
      success: true, 
      message: `Alliance "${alliance.alliance_name}" disbanded. Buildings sold for ${buildingRefundTotal} points. ${pointsPerMember} points returned to each of ${memberCount} members.`,
      freedMembers: members.map(m => m.name),
      pointsPerMember,
      buildingRefund: buildingRefundTotal
    });
  } catch (err) {
    console.error('Disband alliance error:', err);
    res.status(500).json({ error: 'Failed to disband alliance' });
  }
});

// Teacher: Remove an empty alliance (no real members, only ghosts or truly empty)
app.post('/api/teacher/remove-empty-alliance', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher' && req.user.role !== 'teacher') return res.status(403).json({ error: 'Not authorized' });
    const { alliance_id } = req.body;
    if (!alliance_id) return res.status(400).json({ error: 'Missing alliance_id' });

    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    if (!alliance) return res.status(404).json({ error: 'Alliance not found' });

    // Count real (non-ghost) members
    const realCount = query(
      'SELECT COUNT(*) as count FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)',
      [alliance_id]
    )[0].count;

    if (realCount > 0) {
      return res.status(400).json({ error: `Cannot remove — alliance still has ${realCount} real member(s). Use Disband instead.` });
    }

    // Remove orphaned ghost students from this alliance
    const ghostCount = query('SELECT COUNT(*) as count FROM students WHERE alliance_id = ? AND is_ghost = 1', [alliance_id])[0].count;
    if (ghostCount > 0) {
      run('UPDATE students SET alliance_id = NULL WHERE alliance_id = ? AND is_ghost = 1', [alliance_id]);
    }

    // Clean up related data
    try { run('DELETE FROM god_assignments WHERE alliance_id = ?', [alliance_id]); } catch(e) {}
    try { run('DELETE FROM building_activations WHERE alliance_id = ?', [alliance_id]); } catch(e) {}
    try { run("UPDATE alliance_invitations SET status = 'cancelled' WHERE alliance_id = ? AND status = 'pending'", [alliance_id]); } catch(e) {}

    // Delete the alliance
    run('DELETE FROM alliances WHERE alliance_id = ?', [alliance_id]);

    saveDatabase();
    console.log(`🗑️ Teacher removed empty alliance ${alliance_id} (${alliance.alliance_name}) — ${ghostCount} ghost(s) cleaned up`);
    res.json({ success: true, message: `Removed empty alliance "${alliance.alliance_name}"${ghostCount > 0 ? ` (${ghostCount} ghost member(s) cleaned up)` : ''}.` });
  } catch (err) {
    console.error('Remove empty alliance error:', err);
    res.status(500).json({ error: 'Failed to remove alliance' });
  }
});

// Teacher: Recalculate alliance points from approved submissions
// Useful for fixing point discrepancies or after reforming alliances
app.post('/api/teacher/recalculate-alliance-points', authenticateToken, (req, res) => {
  try {
    const { alliance_id } = req.body;
    
    if (alliance_id) {
      // Recalculate single alliance
      const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
      if (!alliance) {
        return res.status(404).json({ error: 'Alliance not found' });
      }
      
      // Get all members of this alliance
      const members = query('SELECT student_id FROM students WHERE alliance_id = ?', [alliance_id]);
      const memberIds = members.map(m => m.student_id);
      
      let totalPoints = 0;
      if (memberIds.length > 0) {
        // Sum all approved point submissions for these members
        const placeholders = memberIds.map(() => '?').join(',');
        const result = query(`
          SELECT COALESCE(SUM(points_claimed), 0) as total
          FROM point_submissions 
          WHERE student_id IN (${placeholders}) AND status = 'approved'
        `, memberIds)[0];
        totalPoints = result.total || 0;
      }
      
      const oldPoints = alliance.total_points;
      run('UPDATE alliances SET total_points = ? WHERE alliance_id = ?', [totalPoints, alliance_id]);
      saveDatabase();
      
      console.log(`🔄 Recalculated ${alliance.alliance_name}: ${oldPoints} → ${totalPoints} points`);
      
      res.json({ 
        success: true, 
        alliance_name: alliance.alliance_name,
        old_points: oldPoints,
        new_points: totalPoints,
        member_count: memberIds.length
      });
    } else {
      // Recalculate ALL alliances
      const alliances = query('SELECT * FROM alliances WHERE is_disbanded = 0');
      const results = [];
      
      alliances.forEach(alliance => {
        const members = query('SELECT student_id FROM students WHERE alliance_id = ?', [alliance.alliance_id]);
        const memberIds = members.map(m => m.student_id);
        
        let totalPoints = 0;
        if (memberIds.length > 0) {
          const placeholders = memberIds.map(() => '?').join(',');
          const result = query(`
            SELECT COALESCE(SUM(points_claimed), 0) as total
            FROM point_submissions 
            WHERE student_id IN (${placeholders}) AND status = 'approved'
          `, memberIds)[0];
          totalPoints = result.total || 0;
        }
        
        const oldPoints = alliance.total_points;
        run('UPDATE alliances SET total_points = ? WHERE alliance_id = ?', [totalPoints, alliance.alliance_id]);
        
        results.push({
          alliance_name: alliance.alliance_name,
          class_period: alliance.class_period,
          old_points: oldPoints,
          new_points: totalPoints,
          difference: totalPoints - oldPoints
        });
      });
      
      saveDatabase();
      console.log(`🔄 Recalculated points for ${results.length} alliances`);
      
      res.json({ 
        success: true, 
        message: `Recalculated ${results.length} alliances`,
        results 
      });
    }
  } catch (err) {
    console.error('Recalculate alliance points error:', err);
    res.status(500).json({ error: 'Failed to recalculate points' });
  }
});

// Get Student's Contribution History (for carrying over to new alliance)
app.get('/api/student/contribution-history', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    
    const contributions = query(`
      SELECT 
        sc.*,
        a.alliance_name
      FROM student_contributions sc
      JOIN alliances a ON sc.alliance_id = a.alliance_id
      WHERE sc.student_id = ?
      ORDER BY sc.contribution_date DESC
    `, [student_id]);
    
    // Calculate totals
    const totalPoints = contributions.reduce((sum, c) => sum + c.points_contributed, 0);
    
    res.json({ contributions, totalPoints });
  } catch (err) {
    console.error('Get contribution history error:', err);
    res.status(500).json({ error: 'Failed to fetch contribution history' });
  }
});

// Get All Students (for point awarding and student management)
app.get('/api/teacher/students', authenticateToken, (req, res) => {
  try {
    const students = query(`
      SELECT 
        s.student_id,
        s.name,
        s.email,
        s.class_period,
        s.alliance_id,
        s.scout_status,
        s.voyage_log_completed, s.voyage_rank_tier, s.voyage_crew_code,
        s.is_ghost,
        a.alliance_name,
        a.current_age as alliance_age
      FROM students s
      LEFT JOIN alliances a ON s.alliance_id = a.alliance_id
      ORDER BY s.class_period, a.alliance_name, s.name
    `);
    
    // Return in format that works for both award modal and student management
    res.json({ students });
  } catch (err) {
    console.error('Students error:', err);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// Get Pending Point Submissions
app.get('/api/teacher/pending-submissions', authenticateToken, (req, res) => {
  try {
    // V91 FIX: Changed ar.assignment_name to ar.display_name (correct column name)
    const submissions = query(`
      SELECT 
        ps.*,
        s.name as student_name,
        a.alliance_name,
        ar.max_points as correct_max_points
      FROM point_submissions ps
      JOIN students s ON ps.student_id = s.student_id
      JOIN alliances a ON ps.alliance_id = a.alliance_id
      LEFT JOIN assignments_ref ar ON UPPER(ps.description) LIKE '%' || UPPER(ar.display_name) || '%'
      WHERE ps.status = 'pending'
      ORDER BY ps.submitted_at ASC
    `);
    
    // Use correct_max_points from assignments_ref if available
    const fixedSubmissions = submissions.map(s => ({
      ...s,
      max_points: s.correct_max_points || s.max_points
    }));
    
    res.json(fixedSubmissions);
  } catch (err) {
    console.error('Pending submissions error:', err);
    res.status(500).json({ error: 'Failed to fetch pending submissions' });
  }
});

// Helper: Bridge a graded submission to the myth portal system
// When a Classical myth assignment is graded (approved or partial), update student_myth_completion
const MYTH_GOD_TO_PORTAL = {
  'Pandora': 1, 'Phaethon': 2, 'Orpheus': 3, 
  'Echo and Narcissus': 4, 'Echo & Narcissus': 4,
  'Icarus': 5, 'Eros and Psyche': 6, 'Eros & Psyche': 6, 
  'Constellations': 7
};

function bridgeSubmissionToMythPortal(submission, pointsAwarded, teacherId) {
  // Only bridge Classical myth assignments (not Archaic bonuses)
  const portalId = MYTH_GOD_TO_PORTAL[submission.myth_god];
  if (!portalId) return; // Not a Classical myth
  
  // Only bridge portal-assignment categories (cer, creative, bonus creative work)
  // NOT comp_conn (reading guides) or quiz (handled separately)
  const isPortalAssignment = (
    submission.section === 'bonus' && submission.category !== 'comp_conn' && submission.category !== 'quiz'
  ) || (
    submission.section === 'classical_creative'
  );
  
  if (!isPortalAssignment) return;
  
  try {
    // Determine path from category
    const path = (submission.category === 'cer' || submission.category === 'bonus_retelling') ? 'analytical' : 'creative';
    
    const existing = query('SELECT * FROM student_myth_completion WHERE student_id = ? AND portal_id = ?', 
      [submission.student_id, portalId]);
    
    if (existing.length > 0) {
      // Update existing - set approved with score
      run(`UPDATE student_myth_completion 
           SET assignment_path = ?, teacher_approved = 1, approved_at = CURRENT_TIMESTAMP, points_earned = ?
           WHERE student_id = ? AND portal_id = ?`,
        [path, pointsAwarded, submission.student_id, portalId]);
    } else {
      // Create new
      run(`INSERT INTO student_myth_completion (student_id, portal_id, assignment_path, teacher_approved, approved_at, points_earned)
           VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, ?)`,
        [submission.student_id, portalId, path, pointsAwarded]);
    }
    
    console.log(`🏛️ Bridged to myth portal: student ${submission.student_id}, portal ${portalId} (${submission.myth_god}), ${pointsAwarded} pts, ${path} path`);
  } catch (err) {
    console.error('Bridge to myth portal error:', err.message);
  }
}

// Approve/Reject Point Submission
app.post('/api/teacher/review-submission', authenticateToken, (req, res) => {
  try {
    console.log('📋 Review submission request:', JSON.stringify(req.body));
    const { submission_id, approve, teacher_notes } = req.body;
    const teacher_id = req.user.id;
    
    // Get submission
    const submission = query('SELECT * FROM point_submissions WHERE submission_id = ?', [submission_id])[0];
    console.log('📋 Found submission:', submission ? submission.submission_id : 'NOT FOUND');
    
    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    
    if (submission.status !== 'pending') {
      return res.status(400).json({ error: 'Submission already reviewed' });
    }
    
    if (approve) {
      console.log('📋 APPROVE path - starting...');
      // Check if this is a resubmission (grade record already exists)
      let isResubmission = false;
      let previousPoints = 0;
      let previousMaxPoints = 0;
      
      if (submission.myth_god && submission.section) {
        const assignment = query(`
          SELECT assignment_id FROM assignments_ref 
          WHERE section = ? AND myth_god = ? AND assignment_type = ?
        `, [submission.section, submission.myth_god, submission.category])[0];
        
        if (assignment) {
          const existingRecord = query(`
            SELECT points_earned, points_possible FROM grade_records 
            WHERE student_id = ? AND assignment_id = ?
          `, [submission.student_id, assignment.assignment_id])[0];
          
          if (existingRecord) {
            isResubmission = true;
            previousPoints = existingRecord.points_earned;
            previousMaxPoints = existingRecord.points_possible;
            console.log(`Resubmission detected - previous score: ${previousPoints}/${previousMaxPoints}`);
          }
        }
      }
      
      console.log('📋 APPROVE: resubmission check done, isResubmission:', isResubmission);
      
      // Update achievement tracking (handle resubmissions by passing difference)
      if (isResubmission) {
        // For resubmissions, update with the DIFFERENCE in points
        const pointsDiff = submission.points_claimed - previousPoints;
        const maxPointsDiff = (submission.max_points || submission.points_claimed) - previousMaxPoints;
        // Don't increment count for resubmissions, just adjust totals
        updateAchievementProgressForResubmission(submission.student_id, submission.category, pointsDiff, maxPointsDiff);
      } else {
        // New submission - add full points and increment count
        updateAchievementProgress(submission.student_id, submission.category, submission.points_claimed, submission.max_points);
      }
      
      console.log('📋 APPROVE: achievement tracking done');
      
      // Approve - add points to alliance with technology, building, AND achievement bonuses
      const student = query('SELECT technologies_unlocked FROM students WHERE student_id = ?', [submission.student_id])[0];
      
      let techMultiplier = 1.0;
      
      // Apply technology bonuses
      if (student) {
        const techs = JSON.parse(student.technologies_unlocked || '[]');
        if (techs.length > 0) {
          const techDetails = query(`SELECT bonus_value, specific_assignment_type FROM technologies_ref WHERE tech_name IN (${techs.map(() => '?').join(',')})`, techs);
          
          techDetails.forEach(tech => {
            if (!tech.specific_assignment_type || tech.specific_assignment_type === submission.category) {
              techMultiplier *= (1 + tech.bonus_value);
            }
          });
        }
      }
      
      // Apply building bonuses
      const buildingBonus = getAllianceBuildingBonus(submission.alliance_id);
      
      // Apply achievement power-up bonuses
      const achievementBonus = getAchievementBonus(submission.student_id, submission.category);
      
      // Apply Handaxe bonus (+5% points earned) if alliance has it
      const allianceTechs = query(
        'SELECT tech_name FROM alliance_technologies WHERE alliance_id = ?',
        [submission.alliance_id]
      ).map(t => t.tech_name);
      const hasHandaxe = allianceTechs.includes('Handaxe');
      const handaxeBonus = hasHandaxe ? 0.05 : 0;
      
      console.log('📋 APPROVE: bonuses calculated - building:', buildingBonus, 'achievement:', achievementBonus, 'handaxe:', handaxeBonus);
      
      // Calculate final: base * tech * (1 + building) * (1 + achievement) * (1 + handaxe)
      // For resubmissions, only award the DIFFERENCE in points
      let baseAmount = submission.points_claimed;
      if (isResubmission) {
        baseAmount = submission.points_claimed - previousPoints; // Only the improvement
        console.log(`Resubmission: Awarding difference of ${baseAmount} points (${submission.points_claimed} - ${previousPoints})`);
      }
      
      // Only add points if there's a positive difference (or it's not a resubmission)
      let finalAmount = 0;
      if (baseAmount > 0) {
        finalAmount = Math.round(baseAmount * techMultiplier * (1 + buildingBonus) * (1 + achievementBonus) * (1 + handaxeBonus));
        
        // Add points to alliance
        run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
            [finalAmount, submission.alliance_id]);
        
        // Log transaction with god name and assignment type
        const godName = submission.myth_god || '';
        const assignmentType = submission.category === 'comp_conn' ? 'Reading Notes' : 
                               submission.category === 'quiz' ? 'Quiz' :
                               submission.category === 'mural' ? 'Mural' :
                               submission.category;
        const assignmentName = godName ? `${godName} ${assignmentType}` : assignmentType;
        
        run(`INSERT INTO point_transactions (alliance_id, student_id, amount, category, reason, teacher_id) 
             VALUES (?, ?, ?, ?, ?, ?)`, 
            [submission.alliance_id, submission.student_id, finalAmount, submission.category, 
             assignmentName, teacher_id]);
      } else if (isResubmission && baseAmount < 0) {
        // Score went down - log but don't subtract points (be nice to students!)
        console.log(`Resubmission: Score decreased from ${previousPoints} to ${submission.points_claimed} - not subtracting points`);
      }
      
      // Create grade record if myth_god and section are provided
      if (submission.myth_god && submission.section) {
        console.log('Creating grade record for:', {
          section: submission.section,
          myth_god: submission.myth_god,
          category: submission.category
        });
        
        // Find the matching assignment
        const assignment = query(`
          SELECT assignment_id, display_name FROM assignments_ref 
          WHERE section = ? AND myth_god = ? AND assignment_type = ?
        `, [submission.section, submission.myth_god, submission.category])[0];
        
        console.log('Found assignment:', assignment);
        
        if (assignment) {
          // Check if record already exists (update) or needs to be created
          const existingRecord = query(`
            SELECT record_id FROM grade_records 
            WHERE student_id = ? AND assignment_id = ?
          `, [submission.student_id, assignment.assignment_id])[0];
          
          if (existingRecord) {
            // Update existing record (allow resubmission/improvement)
            run(`UPDATE grade_records 
                 SET points_earned = ?, points_possible = ?, submission_id = ?, completed_at = CURRENT_TIMESTAMP
                 WHERE record_id = ?`,
                [submission.points_claimed, submission.max_points || submission.points_claimed, submission_id, existingRecord.record_id]);
            console.log('Updated existing grade record');
          } else {
            // Create new grade record
            run(`INSERT INTO grade_records (student_id, assignment_id, points_earned, points_possible, submission_id)
                 VALUES (?, ?, ?, ?, ?)`,
                [submission.student_id, assignment.assignment_id, submission.points_claimed, submission.max_points || submission.points_claimed, submission_id]);
            console.log('Created new grade record for:', assignment.display_name);
          }
        } else {
          console.log('WARNING: No matching assignment found for submission');
        }
      } else {
        console.log('Skipping grade record - no myth_god or section:', {
          myth_god: submission.myth_god,
          section: submission.section
        });
      }
      
      // Check if this is a Rite of Passage submission - mark alliance as complete
      console.log('📋 APPROVE: grade record section done');
      
      // Bridge to myth portal system for Classical assignments
      bridgeSubmissionToMythPortal(submission, submission.points_claimed, teacher_id);
      
      if (submission.category === 'rite_of_passage') {
        run('UPDATE alliances SET rite_of_passage_complete = 1 WHERE alliance_id = ?', 
            [submission.alliance_id]);
      }
      
      // Update submission status
      run(`UPDATE point_submissions 
           SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, 
               reviewed_by_teacher_id = ?, teacher_notes = ?
           WHERE submission_id = ?`, 
          [teacher_id, teacher_notes || '', submission_id]);
      
      // Build message with bonus info
      let bonusInfo = '';
      if (buildingBonus > 0) bonusInfo += ` +${Math.round(buildingBonus * 100)}% building`;
      if (achievementBonus > 0) bonusInfo += ` +${Math.round(achievementBonus * 100)}% power-up`;
      if (handaxeBonus > 0) bonusInfo += ` +5% Handaxe`;
      if (bonusInfo) bonusInfo = ` (includes${bonusInfo})`;
      
      // Add Rite of Passage completion note
      let riteNote = '';
      if (submission.category === 'rite_of_passage') {
        riteNote = ' (Alliance Rite of Passage requirement fulfilled!)';
      }
      
      console.log('📋 APPROVE: sending response, finalAmount:', finalAmount);
      res.json({ success: true, message: `Approved! ${finalAmount} points awarded${bonusInfo}.${riteNote}`, finalAmount });
    } else {
      // Reject — with optional partial points
      const partialPoints = req.body.partial_points !== undefined && req.body.partial_points !== null && req.body.partial_points !== '' 
        ? parseFloat(req.body.partial_points) : null;
      
      if (partialPoints !== null && partialPoints > 0) {
        // PARTIAL CREDIT: Award reduced points and create grade record
        const student = query('SELECT technologies_unlocked FROM students WHERE student_id = ?', [submission.student_id])[0];
        
        // Check for resubmission (existing grade record)
        let isResubmission = false;
        let previousPoints = 0;
        if (submission.myth_god && submission.section) {
          const assignmentCheck = query(`
            SELECT ar.assignment_id FROM assignments_ref ar
            WHERE ar.section = ? AND ar.myth_god = ? AND ar.assignment_type = ?
          `, [submission.section, submission.myth_god, submission.category])[0];
          
          if (assignmentCheck) {
            const existingGrade = query(`
              SELECT points_earned FROM grade_records 
              WHERE student_id = ? AND assignment_id = ?
            `, [submission.student_id, assignmentCheck.assignment_id])[0];
            
            if (existingGrade) {
              isResubmission = true;
              previousPoints = existingGrade.points_earned;
              // Only award if new score is higher
              if (partialPoints <= previousPoints) {
                saveDatabase();
                return res.json({ success: true, message: `Score ${partialPoints} is not higher than existing ${previousPoints}. No change made.` });
              }
            }
          }
        }
        
        // Apply building/tech bonuses
        let buildingBonus = getAllianceBuildingBonus(submission.alliance_id);
        let achievementBonus = getAchievementBonus(submission.student_id, submission.category);
        let handaxeBonus = 0;
        
        if (student && student.technologies_unlocked) {
          try {
            const techs = JSON.parse(student.technologies_unlocked);
            if (techs.includes('Handaxe')) handaxeBonus = 0.05;
          } catch(e) {}
        }
        
        const totalBonus = 1 + buildingBonus + achievementBonus + handaxeBonus;
        
        // For resubmissions, only award the DIFFERENCE
        const pointsToAward = isResubmission ? (partialPoints - previousPoints) : partialPoints;
        const finalAmount = Math.round(pointsToAward * totalBonus);
        
        // Award points to alliance
        if (finalAmount > 0) {
          run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?',
            [finalAmount, submission.alliance_id]);
          
          const godName = submission.myth_god || '';
          const assignmentType = submission.category === 'comp_conn' ? 'Reading Notes' : 
                                 submission.category === 'quiz' ? 'Quiz' :
                                 submission.category === 'mural' ? 'Mural' :
                                 submission.category;
          const assignmentName = godName ? `${godName} ${assignmentType}` : assignmentType;
          
          run(`INSERT INTO point_transactions (alliance_id, student_id, amount, category, reason, teacher_id) 
               VALUES (?, ?, ?, ?, ?, ?)`, 
              [submission.alliance_id, submission.student_id, finalAmount, submission.category, 
               `${assignmentName} (${isResubmission ? 'resubmit partial' : 'partial credit'})`, teacher_id]);
        }
        
        // Update achievement tracking
        if (isResubmission) {
          updateAchievementProgressForResubmission(submission.student_id, submission.category, pointsToAward, 0);
        } else {
          updateAchievementProgress(submission.student_id, submission.category, partialPoints, submission.max_points);
        }
        
        // Create/update grade record with partial score
        if (submission.myth_god && submission.section) {
          const assignment = query(`
            SELECT assignment_id, display_name FROM assignments_ref 
            WHERE section = ? AND myth_god = ? AND assignment_type = ?
          `, [submission.section, submission.myth_god, submission.category])[0];
          
          if (assignment) {
            const existingRecord = query(`
              SELECT record_id FROM grade_records 
              WHERE student_id = ? AND assignment_id = ?
            `, [submission.student_id, assignment.assignment_id])[0];
            
            if (existingRecord) {
              run(`UPDATE grade_records 
                   SET points_earned = ?, points_possible = ?, submission_id = ?, completed_at = CURRENT_TIMESTAMP
                   WHERE record_id = ?`,
                  [partialPoints, submission.max_points || submission.points_claimed, submission_id, existingRecord.record_id]);
            } else {
              run(`INSERT INTO grade_records (student_id, assignment_id, points_earned, points_possible, submission_id)
                   VALUES (?, ?, ?, ?, ?)`,
                  [submission.student_id, assignment.assignment_id, partialPoints, submission.max_points || submission.points_claimed, submission_id]);
            }
            console.log(`📝 Partial credit grade record: ${partialPoints}/${submission.max_points || submission.points_claimed} for ${assignment.display_name}${isResubmission ? ' (resubmit, prev: ' + previousPoints + ')' : ''}`);
          }
        }
        
        // Bridge to myth portal system for Classical assignments
        bridgeSubmissionToMythPortal(submission, partialPoints, teacher_id);
        
        // Mark as partial
        run(`UPDATE point_submissions 
             SET status = 'partial', reviewed_at = CURRENT_TIMESTAMP, 
                 reviewed_by_teacher_id = ?, teacher_notes = ?
             WHERE submission_id = ?`, 
            [teacher_id, teacher_notes || '', submission_id]);
        
        let bonusInfo = '';
        if (buildingBonus > 0) bonusInfo += ` +${Math.round(buildingBonus * 100)}% building`;
        if (achievementBonus > 0) bonusInfo += ` +${Math.round(achievementBonus * 100)}% power-up`;
        if (handaxeBonus > 0) bonusInfo += ` +5% Handaxe`;
        if (bonusInfo) bonusInfo = ` (includes${bonusInfo})`;
        
        const resubNote = isResubmission ? ` (upgraded from ${previousPoints})` : '';
        saveDatabase();
        res.json({ success: true, message: `Partial credit: ${finalAmount} points awarded (${partialPoints}/${submission.max_points || submission.points_claimed})${resubNote}${bonusInfo}` });
      } else {
        // Full rejection — no points
        run(`UPDATE point_submissions 
             SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP, 
                 reviewed_by_teacher_id = ?, teacher_notes = ?
             WHERE submission_id = ?`, 
            [teacher_id, teacher_notes || '', submission_id]);
        
        res.json({ success: true, message: 'Submission rejected' });
      }
    }
  } catch (err) {
    console.error('Review submission error:', err);
    res.status(500).json({ error: 'Failed to review submission: ' + err.message });
  }
});

// ====================
// STUDENT ROUTES
// ====================

// Get Student Dashboard Data
app.get('/api/student/dashboard', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    
    // Get student info (explicitly exclude map_image which can be 100KB+ base64)
    const student = query(`
      SELECT 
        s.student_id, s.name, s.class_period, s.alliance_id, s.civilization_name,
        s.technologies_unlocked, s.badges_earned, s.is_ghost, s.classical_entered,
        s.scout_status,
        s.voyage_log_completed, s.voyage_rank_tier, s.voyage_crew_code,
        a.alliance_name,
        a.total_points as alliance_points,
        a.current_age,
        a.buildings_owned,
        a.reverse_cards,
        a.side_quest_rewards
      FROM students s
      LEFT JOIN alliances a ON s.alliance_id = a.alliance_id
      WHERE s.student_id = ?
    `, [student_id])[0];
    
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    // Safely add avatar data (columns may not exist if migration hasn't run)
    try {
      const avatarInfo = query('SELECT selected_avatar, drachma FROM students WHERE student_id = ?', [student_id])[0];
      student.selected_avatar = avatarInfo ? avatarInfo.selected_avatar : null;
      student.drachma = avatarInfo ? avatarInfo.drachma : 0;
    } catch(e) {
      student.selected_avatar = null;
      student.drachma = 0;
    }
    
    // Scout status override: if student is a scout for a higher age, use that age
    if (student.scout_status) {
      const allianceAge = student.current_age || 'Archaic';
      const ageOrder = { 'Archaic': 0, 'Classical': 1, 'Heroic': 2 };
      if ((ageOrder[student.scout_status] || 0) > (ageOrder[allianceAge] || 0)) {
        student.current_age = student.scout_status;
        student.is_scout = true;
      }
    }
    
    // Parse side quest rewards for display
    const rewards = JSON.parse(student.side_quest_rewards || '[]');
    student.side_quest_reward_icons = rewards.map(questId => {
      if (questId === 1) return '🔨';
      if (questId === 2) return '🏹';
      if (questId === 3) return '🌾';
        if (questId === 4) return '🏠';
        if (questId === 5) return '🦉';
      return '';
    }).join('');
    
    // Parse JSON fields
    student.technologies_unlocked = JSON.parse(student.technologies_unlocked || '[]');
    student.badges_earned = JSON.parse(student.badges_earned || '[]');
    student.buildings_owned = JSON.parse(student.buildings_owned || '[]');
    
    // Get alliance members
    let members = [];
    let ghostMembers = [];
    if (student.alliance_id) {
      members = query(`
        SELECT student_id, name, technologies_unlocked, is_ghost, selected_avatar
        FROM students
        WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)
      `, [student.alliance_id]);
      
      members.forEach(m => {
        m.technologies_unlocked = JSON.parse(m.technologies_unlocked || '[]');
        m.is_ghost = 0;
      });
      
      // Get ghost members in this alliance
      ghostMembers = query(`
        SELECT student_id, name, is_ghost
        FROM students
        WHERE alliance_id = ? AND is_ghost = 1
      `, [student.alliance_id]);
      
      // Calculate ghost points: alliance total_points / living member count
      const livingCount = members.length;
      // Ghost display: each ghost adds 1x total_points (not per-member share)
      const ghostPointsEach = student.alliance_points;
      
      ghostMembers.forEach(g => {
        g.technologies_unlocked = [];
        g.is_ghost = 1;
        g.ghost_points = ghostPointsEach;
      });
      
      // Add ghost bonus to display total
      student.ghost_bonus_points = ghostPointsEach * ghostMembers.length;
      student.alliance_display_points = student.alliance_points + student.ghost_bonus_points;
    }
    
    // Get leaderboard with technologies and member counts in batch queries
    // Test period isolation: Test students only see Test alliances, regular students never see Test alliances
    const studentPeriod = student.class_period;
    const isStudentInTestPeriod = isTestPeriod(studentPeriod);
    
    let leaderboard;
    if (isStudentInTestPeriod) {
      // Test student: only show Test period alliances
      leaderboard = query(`
        SELECT 
          a.alliance_id,
          a.alliance_name,
          a.total_points,
          a.current_age,
          a.side_quest_rewards
        FROM alliances a
        WHERE a.is_disbanded = 0 AND a.class_period = ?
        ORDER BY a.total_points DESC
      `, [TEST_PERIOD]);
    } else {
      // Regular student: exclude Test period alliances
      leaderboard = query(`
        SELECT 
          a.alliance_id,
          a.alliance_name,
          a.total_points,
          a.current_age,
          a.side_quest_rewards
        FROM alliances a
        WHERE a.is_disbanded = 0 AND (a.class_period IS NULL OR a.class_period != ?)
        ORDER BY a.total_points DESC
      `, [TEST_PERIOD]);
    }
    
    // Batch: get all technologies for all alliances at once
    const allTechs = query('SELECT alliance_id, tech_name FROM alliance_technologies');
    const techsByAlliance = {};
    allTechs.forEach(t => {
      if (!techsByAlliance[t.alliance_id]) techsByAlliance[t.alliance_id] = [];
      techsByAlliance[t.alliance_id].push(t.tech_name);
    });
    
    // Batch: get living and ghost counts for all alliances at once
    const memberCounts = query(`
      SELECT alliance_id,
        SUM(CASE WHEN is_ghost = 0 OR is_ghost IS NULL THEN 1 ELSE 0 END) as living_count,
        SUM(CASE WHEN is_ghost = 1 THEN 1 ELSE 0 END) as ghost_count
      FROM students
      WHERE alliance_id IS NOT NULL
      GROUP BY alliance_id
    `);
    const countsByAlliance = {};
    memberCounts.forEach(m => {
      countsByAlliance[m.alliance_id] = { living: m.living_count, ghost: m.ghost_count };
    });
    
    // Build leaderboard with batch data (no per-alliance queries)
    const leaderboardWithTechs = leaderboard.map(alliance => {
      const rewards = JSON.parse(alliance.side_quest_rewards || '[]');
      const rewardIcons = rewards.map(questId => {
        if (questId === 1) return '🔨';
        if (questId === 2) return '🏹';
        if (questId === 3) return '🌾';
        if (questId === 4) return '🏠';
        if (questId === 5) return '🦉';
        return '';
      }).join('');
      
      const counts = countsByAlliance[alliance.alliance_id] || { living: 0, ghost: 0 };
      // Ghost display: each ghost adds 1x total_points. display = total × (ghost_count + 1)
      const ghostBonus = alliance.total_points * counts.ghost;
      
      return { 
        ...alliance, 
        technologies: techsByAlliance[alliance.alliance_id] || [], 
        side_quest_reward_icons: rewardIcons,
        display_points: alliance.total_points + ghostBonus,
        ghost_bonus: ghostBonus
      };
    });
    
    // Sort by display_points (includes ghost bonus) so rankings update correctly
    leaderboardWithTechs.sort((a, b) => b.display_points - a.display_points);
    
    res.json({
      student,
      members: [...members, ...ghostMembers],
      leaderboard: leaderboardWithTechs
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to fetch dashboard' });
  }
});

// Get Buildings Reference
app.get('/api/buildings', (req, res) => {
  try {
    const buildings = query('SELECT * FROM buildings_ref ORDER BY cost_points');
    res.json(buildings);
  } catch (err) {
    console.error('Buildings error:', err);
    res.status(500).json({ error: 'Failed to fetch buildings' });
  }
});

// ====================
// STUDENT POINT SUBMISSION
// ====================

// Submit Points for Approval
app.post('/api/student/submit-points', authenticateToken, (req, res) => {
  try {
    const { points_claimed, max_points, category, myth_god, section, description } = req.body;
    const student_id = req.user.id;

    // Validate points
    if (!points_claimed || points_claimed < 1) {
      return res.status(400).json({ error: 'Points must be at least 1' });
    }
    if (points_claimed > 100) {
      return res.status(400).json({ error: 'Maximum submission is 100 points. Contact your teacher if you need to submit more.' });
    }

    // ── Daily submission limit: max 10 per student per day ──
    const todayCount = query(
      `SELECT COUNT(*) as cnt FROM point_submissions WHERE student_id = ? AND DATE(submitted_at) = DATE('now')`,
      [student_id]
    )[0];
    if (todayCount && todayCount.cnt >= 10) {
      return res.status(429).json({ error: 'You have reached the daily limit of 10 submissions. See your teacher if you need to submit more.' });
    }

    // ── Description word limit: max 10 words ──
    const rawDesc = (description || '').trim();
    const wordCount = rawDesc === '' ? 0 : rawDesc.split(/\s+/).length;
    if (wordCount > 10) {
      return res.status(400).json({ error: `Description is too long (${wordCount} words). Please keep it to 10 words or fewer.` });
    }
    // Also hard-cap characters to prevent giant strings even with short word count
    const safeDesc = rawDesc.slice(0, 100);

    // Get student's alliance
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    if (!student || !student.alliance_id) {
      return res.status(400).json({ error: 'You must be in an alliance to submit points' });
    }

    // Create submission
    run(`INSERT INTO point_submissions (student_id, alliance_id, points_claimed, max_points, category, myth_god, section, description, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [student_id, student.alliance_id, points_claimed, max_points || null, category, myth_god || null, section || null, safeDesc]);

    const remaining = 10 - (todayCount.cnt + 1);
    res.json({ success: true, message: `Points submitted for teacher approval! (${remaining} submission${remaining !== 1 ? 's' : ''} remaining today)` });
  } catch (err) {
    console.error('Submit points error:', err);
    res.status(500).json({ error: 'Failed to submit points' });
  }
});

// Get Student's Pending Submissions
app.get('/api/student/my-submissions', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    
    const submissions = query(`
      SELECT * FROM point_submissions 
      WHERE student_id = ? 
      ORDER BY submitted_at DESC
      LIMIT 20
    `, [student_id]);
    
    res.json(submissions);
  } catch (err) {
    console.error('Get submissions error:', err);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// Get Student's Alliance Info
app.get('/api/student/alliance', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    if (!student || !student.alliance_id) {
      return res.json({ alliance: null });
    }
    
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [student.alliance_id])[0];
    
    res.json({ alliance });
  } catch (err) {
    console.error('Get alliance error:', err);
    res.status(500).json({ error: 'Failed to fetch alliance' });
  }
});

// Get Student Achievement Progress
app.get('/api/student/achievements', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    
    ensureAchievementProgress(student_id);
    
    const progress = query('SELECT * FROM student_achievement_progress WHERE student_id = ?', [student_id])[0];
    
    // Calculate percentages
    const quizAvg = progress.quiz_total_possible > 0 
      ? Math.round((progress.quiz_total_earned / progress.quiz_total_possible) * 100) 
      : 0;
    const compConnAvg = progress.comp_conn_total_possible > 0 
      ? Math.round((progress.comp_conn_total_earned / progress.comp_conn_total_possible) * 100) 
      : 0;
    
    res.json({
      // Curiosity of Coeus (Quiz mastery)
      coeus: {
        name: 'Curiosity of Coeus',
        description: 'The Titan of Curiosity rewards those who seek knowledge',
        requirement: 'Score 80%+ average on 8 quizzes',
        effect: '+10% on future quiz points',
        unlocked: progress.coeus_unlocked === 1,
        unlocked_at: progress.coeus_unlocked_at,
        progress: {
          count: progress.quiz_count,
          needed: 8,
          average: quizAvg,
          threshold: 80
        }
      },
      // Mind of Metis (Comp Conn mastery)
      metis: {
        name: 'Mind of Metis',
        description: "Athena's mother blesses those with wisdom in writing",
        requirement: 'Score 80%+ average on 8 comprehension connections',
        effect: '+15% on future comp conn points',
        unlocked: progress.metis_unlocked === 1,
        unlocked_at: progress.metis_unlocked_at,
        progress: {
          count: progress.comp_conn_count,
          needed: 8,
          average: compConnAvg,
          threshold: 80
        }
      },
      // Apollo's Blessing (Mural mastery)
      apollo: {
        name: "Apollo's Blessing",
        description: 'The god of art rewards dedicated creators',
        requirement: 'Create 2 murals or comics',
        effect: '+33% on future mural/comic points',
        unlocked: progress.apollo_unlocked === 1,
        unlocked_at: progress.apollo_unlocked_at,
        progress: {
          count: progress.mural_count,
          needed: 2
        }
      }
    });
  } catch (err) {
    console.error('Get achievements error:', err);
    res.status(500).json({ error: 'Failed to fetch achievements' });
  }
});

// ====================
// PANTHEON UNLOCK SYSTEM
// ====================

// Helper function to get quiz + notes score for a god
function getGodScore(student_id, godName, quizGod = null) {
  // quizGod is used when the quiz is shared (e.g., Apollo and Artemis share a quiz)
  const quizGodName = quizGod || godName;
  
  const quiz = query(`
    SELECT gr.points_earned 
    FROM grade_records gr
    JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
    WHERE gr.student_id = ? AND ar.myth_god = ? AND ar.assignment_type = 'quiz'
  `, [student_id, quizGodName])[0];
  
  const notes = query(`
    SELECT gr.points_earned 
    FROM grade_records gr
    JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
    WHERE gr.student_id = ? AND ar.myth_god = ? AND ar.assignment_type = 'comp_conn'
  `, [student_id, godName])[0];
  
  return {
    quizScore: quiz ? quiz.points_earned : 0,
    notesScore: notes ? notes.points_earned : 0,
    total: (quiz ? quiz.points_earned : 0) + (notes ? notes.points_earned : 0)
  };
}

// Helper function to check if bonus is complete
function isBonusComplete(student_id, godName) {
  const bonus = query(`
    SELECT gr.points_earned 
    FROM grade_records gr
    JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
    WHERE gr.student_id = ? AND ar.myth_god = ? AND ar.section = 'bonus'
  `, [student_id, godName])[0];
  
  return bonus && bonus.points_earned > 0;
}

// Get student's pantheon unlock status
app.get('/api/student/pantheon', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    
    // Get student name for logging
    const student = query('SELECT name FROM students WHERE student_id = ?', [student_id])[0];
    const studentName = student ? student.name : `Student ${student_id}`;
    
    ensureAchievementProgress(student_id);
    let progress = query('SELECT * FROM student_achievement_progress WHERE student_id = ?', [student_id])[0];
    
    // Batch: get ALL grade records for this student in one query
    const allGrades = query(`
      SELECT ar.myth_god, ar.assignment_type, ar.section, gr.points_earned
      FROM grade_records gr
      JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
      WHERE gr.student_id = ?
    `, [student_id]);
    
    // Build lookup maps from batch results
    const quizScores = {};  // myth_god -> points_earned
    const notesScores = {}; // myth_god -> points_earned
    const bonusComplete = {}; // myth_god -> true/false
    allGrades.forEach(g => {
      if (g.assignment_type === 'quiz') quizScores[g.myth_god] = g.points_earned;
      if (g.assignment_type === 'comp_conn') notesScores[g.myth_god] = g.points_earned;
      if (g.section === 'bonus' && g.points_earned > 0) bonusComplete[g.myth_god] = true;
    });
    
    // Helper using batch data
    function getGodScoreBatch(godName, quizGod) {
      const qGod = quizGod || godName;
      const quizScore = quizScores[qGod] || 0;
      const notesScore = notesScores[godName] || 0;
      return { quizScore, notesScore, total: quizScore + notesScore };
    }
    
    // Define all gods with their unlock requirements
    const godConfigs = [
      { name: 'zeus', emoji: '⚡', threshold: 13, maxScore: 15, quizMax: 5, notesMax: 10 },
      { name: 'poseidon', emoji: '🔱', threshold: 13, maxScore: 15, quizMax: 5, notesMax: 10 },
      { name: 'prometheus', emoji: '🔥', threshold: 17, maxScore: 20, quizMax: 10, notesMax: 10 },
      { name: 'apollo', emoji: '☀️', threshold: 13, maxScore: 15, quizMax: 5, notesMax: 10, quizGod: 'Apollo and Artemis' },
      { name: 'artemis', emoji: '🏹', threshold: 13, maxScore: 15, quizMax: 5, notesMax: 10, quizGod: 'Apollo and Artemis' },
      { name: 'athena', emoji: '🦉', threshold: 13, maxScore: 15, quizMax: 5, notesMax: 10 },
      { name: 'hera', emoji: '🦚', threshold: 13, maxScore: 15, quizMax: 5, notesMax: 10 },
      { name: 'aphrodite', emoji: '💕', threshold: 13, maxScore: 15, quizMax: 5, notesMax: 10 },
      { name: 'demeter', emoji: '🌾', threshold: 13, maxScore: 15, quizMax: 5, notesMax: 10 },
      { name: 'hermes', emoji: '🪽', threshold: 13, maxScore: 15, quizMax: 5, notesMax: 10 },
      { name: 'hephaestus', emoji: '🔨', threshold: 13, maxScore: 15, quizMax: 5, notesMax: 10 },
      { name: 'hades', emoji: '💀', isBonus: true },
      { name: 'ares', emoji: '⚔️', isBonus: true }
    ];
    
    const pantheon = {};
    const newUnlocks = [];
    
    for (const god of godConfigs) {
      const godNameCap = god.name.charAt(0).toUpperCase() + god.name.slice(1);
      const colUnlocked = `pantheon_${god.name}_unlocked`;
      const colUnlockedAt = `pantheon_${god.name}_unlocked_at`;
      const colSeen = `pantheon_${god.name}_celebration_seen`;
      
      let qualifies = false;
      let scoreInfo = {};
      
      if (god.isBonus) {
        qualifies = !!bonusComplete[godNameCap];
        scoreInfo = {
          requirement: `Complete ${godNameCap} Bonus assignment`,
          current_score: qualifies ? 'Bonus Complete ✓' : 'Bonus not complete'
        };
      } else {
        const quizGod = god.quizGod || godNameCap;
        const scores = getGodScoreBatch(godNameCap, quizGod);
        qualifies = scores.total >= god.threshold;
        scoreInfo = {
          requirement: `Combined ${god.threshold}+ on quiz and reading notes`,
          current_score: `${scores.total}/${god.maxScore} (Quiz: ${scores.quizScore}/${god.quizMax}, Notes: ${scores.notesScore}/${god.notesMax})`
        };
      }
      
      // Check if should unlock
      if (qualifies && !progress[colUnlocked]) {
        run(`UPDATE student_achievement_progress 
             SET ${colUnlocked} = 1, ${colUnlockedAt} = CURRENT_TIMESTAMP
             WHERE student_id = ?`, [student_id]);
        console.log(`${god.emoji} ${studentName} unlocked ${godNameCap} in the Pantheon!`);
        progress = query('SELECT * FROM student_achievement_progress WHERE student_id = ?', [student_id])[0];
      }
      
      const colBonusSeen = `pantheon_${god.name}_bonus_seen`;
      
      pantheon[god.name] = {
        unlocked: progress[colUnlocked] === 1,
        unlocked_at: progress[colUnlockedAt],
        celebration_seen: progress[colSeen] === 1,
        bonus_complete: god.isBonus ? qualifies : !!bonusComplete[godNameCap],
        bonus_celebration_seen: progress[colBonusSeen] === 1,
        ...scoreInfo
      };
      
      if (pantheon[god.name].unlocked && !pantheon[god.name].celebration_seen) {
        newUnlocks.push(god.name);
      }
    }
    
    const newBonuses = [];
    for (const god of godConfigs) {
      const godData = pantheon[god.name];
      if (god.isBonus) {
        // Hades/Ares: bonus celebration triggers with unlock celebration
      } else {
        if (godData.unlocked && godData.celebration_seen && godData.bonus_complete && !godData.bonus_celebration_seen) {
          newBonuses.push(god.name);
        }
      }
    }
    
    res.json({ pantheon, newUnlocks, newBonuses });
  } catch (err) {
    console.error('Get pantheon error:', err);
    res.status(500).json({ error: 'Failed to fetch pantheon status' });
  }
});

// Mark celebration as seen
app.post('/api/student/pantheon/celebration-seen', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { god } = req.body;
    
    const validGods = ['zeus', 'hera', 'poseidon', 'athena', 'apollo', 'artemis', 'aphrodite', 'ares', 'hephaestus', 'hermes', 'demeter', 'prometheus', 'hades'];
    if (!validGods.includes(god)) {
      return res.status(400).json({ error: 'Invalid god name' });
    }
    
    run(`UPDATE student_achievement_progress 
         SET pantheon_${god}_celebration_seen = 1
         WHERE student_id = ?`, [student_id]);
    
    // For Hades and Ares, also mark bonus as seen since they unlock via bonus
    if (god === 'hades' || god === 'ares') {
      run(`UPDATE student_achievement_progress 
           SET pantheon_${god}_bonus_seen = 1
           WHERE student_id = ?`, [student_id]);
    }
    
    saveDatabase();
    
    res.json({ success: true, message: `${god} celebration marked as seen` });
  } catch (err) {
    console.error('Mark celebration seen error:', err);
    res.status(500).json({ error: 'Failed to mark celebration' });
  }
});

// Mark bonus celebration as seen
app.post('/api/student/pantheon/bonus-seen', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { god } = req.body;
    
    const validGods = ['zeus', 'hera', 'poseidon', 'athena', 'apollo', 'artemis', 'aphrodite', 'ares', 'hephaestus', 'hermes', 'demeter', 'prometheus', 'hades'];
    if (!validGods.includes(god)) {
      return res.status(400).json({ error: 'Invalid god name' });
    }
    
    run(`UPDATE student_achievement_progress 
         SET pantheon_${god}_bonus_seen = 1
         WHERE student_id = ?`, [student_id]);
    
    saveDatabase();
    
    res.json({ success: true, message: `${god} bonus celebration marked as seen` });
  } catch (err) {
    console.error('Mark bonus celebration seen error:', err);
    res.status(500).json({ error: 'Failed to mark bonus celebration' });
  }
});

// ====================
// GRADE TRACKING SYSTEM
// ====================

// Get all assignments (for dropdowns)
app.get('/api/assignments', authenticateToken, (req, res) => {
  try {
    const assignments = query(`
      SELECT * FROM assignments_ref 
      WHERE age = 'Archaic'
      ORDER BY section, assignment_type, myth_god
    `);
    
    res.json(assignments);
  } catch (err) {
    console.error('Get assignments error:', err);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

// Get assignments by section and type (for filtered dropdowns)
app.get('/api/assignments/filter', authenticateToken, (req, res) => {
  try {
    const { section, assignment_type } = req.query;
    
    let sql = 'SELECT * FROM assignments_ref WHERE age = ?';
    let params = ['Archaic'];
    
    if (section) {
      sql += ' AND section = ?';
      params.push(section);
    }
    
    if (assignment_type) {
      sql += ' AND assignment_type = ?';
      params.push(assignment_type);
    }
    
    sql += ' ORDER BY myth_god';
    
    const assignments = query(sql, params);
    res.json(assignments);
  } catch (err) {
    console.error('Filter assignments error:', err);
    res.status(500).json({ error: 'Failed to filter assignments' });
  }
});

// Get student's grade summary
app.get('/api/student/grades', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    
    // Get student's current age from their alliance (same source as dashboard)
    const student = query(`
      SELECT s.student_id, s.alliance_id, COALESCE(a.current_age, 'Archaic') as current_age
      FROM students s
      LEFT JOIN alliances a ON s.alliance_id = a.alliance_id
      WHERE s.student_id = ?
    `, [student_id])[0];
    const currentAge = (student && student.current_age) || 'Archaic';
    
    if (currentAge === 'Archaic') {
      // ARCHAIC AGE GRADES - Section 1, Section 2, Bonus
      const allAssignments = query(`
        SELECT * FROM assignments_ref WHERE section IN ('section_1', 'section_2', 'bonus') AND assignment_type != 'video'
      `);
      
      const completedRecords = query(`
        SELECT gr.*, ar.section, ar.assignment_type, ar.myth_god, ar.display_name, ar.max_points as assignment_max, ar.is_bonus
        FROM grade_records gr
        JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
        WHERE gr.student_id = ?
      `, [student_id]);
      
      const section1Assignments = allAssignments.filter(a => a.section === 'section_1');
      const section2Assignments = allAssignments.filter(a => a.section === 'section_2');
      const bonusAssignments = allAssignments.filter(a => a.section === 'bonus');
      
      const section1Completed = completedRecords.filter(r => r.section === 'section_1');
      const section2Completed = completedRecords.filter(r => r.section === 'section_2');
      const bonusCompleted = completedRecords.filter(r => r.section === 'bonus');
      
      const section1Earned = section1Completed.reduce((sum, r) => sum + r.points_earned, 0);
      const section2Earned = section2Completed.reduce((sum, r) => sum + r.points_earned, 0);
      const bonusEarned = bonusCompleted.reduce((sum, r) => sum + r.points_earned, 0);
      
      const section1Max = section1Assignments.reduce((sum, a) => sum + a.max_points, 0);
      const section2Max = section2Assignments.reduce((sum, a) => sum + a.max_points, 0);
      const bonusMax = bonusAssignments.reduce((sum, a) => sum + a.max_points, 0);
      
      const completedAssignmentIds = new Set(completedRecords.map(r => r.assignment_id));
      
      const section1Missing = section1Assignments
        .filter(a => !completedAssignmentIds.has(a.assignment_id))
        .map(a => ({ display_name: a.display_name, max_points: a.max_points, myth_god: a.myth_god, assignment_type: a.assignment_type }));
      
      const section2Missing = section2Assignments
        .filter(a => !completedAssignmentIds.has(a.assignment_id))
        .map(a => ({ display_name: a.display_name, max_points: a.max_points, myth_god: a.myth_god, assignment_type: a.assignment_type }));
      
      res.json({
        age: 'Archaic',
        section1: {
          earned: section1Earned, max: section1Max,
          percentage: section1Max > 0 ? Math.round((section1Earned / section1Max) * 100) : 0,
          completed: section1Completed.map(r => ({ display_name: r.display_name, myth_god: r.myth_god, points_earned: r.points_earned, points_possible: r.assignment_max || r.points_possible, assignment_type: r.assignment_type })),
          missing: section1Missing
        },
        section2: {
          earned: section2Earned, max: section2Max,
          percentage: section2Max > 0 ? Math.round((section2Earned / section2Max) * 100) : 0,
          completed: section2Completed.map(r => ({ display_name: r.display_name, myth_god: r.myth_god, points_earned: r.points_earned, points_possible: r.assignment_max || r.points_possible, assignment_type: r.assignment_type })),
          missing: section2Missing
        },
        bonus: {
          earned: bonusEarned, max: bonusMax,
          percentage: bonusMax > 0 ? Math.round((bonusEarned / bonusMax) * 100) : 0,
          completed: bonusCompleted.map(r => ({ display_name: r.display_name, myth_god: r.myth_god, points_earned: r.points_earned, points_possible: r.assignment_max || r.points_possible }))
        }
      });
    } else if (currentAge === 'Heroic') {
      // HEROIC AGE GRADES - Four heroes with placeholder structure
      const heroMyths = ['Jason', 'Hercules', 'Theseus', 'Perseus'];
      const heroes = heroMyths.map(name => ({
        myth_name: name,
        earned: 0,
        possible: 0,
        percentage: 0,
        assignments: []
      }));
      
      res.json({
        age: 'Heroic',
        heroes: heroes,
        total_earned: 0,
        total_possible: 0,
        total_percentage: 0
      });
    } else {
      // CLASSICAL AGE GRADES - Split by myth grouping per grading breakdown doc
      // Section 1: Myths 1-4 (Pandora, Phaethon, Orpheus, Echo and Narcissus) = 136 baseline
      // Section 2: Myths 5-7 (Icarus, Eros and Psyche, Constellations) = 102 baseline
      // Pixtons are extra credit within each section
      // Bonus: 100 pt target from 250 available
      
      const section1Myths = ['Pandora', 'Phaethon', 'Orpheus', 'Echo and Narcissus'];
      const section2Myths = ['Icarus', 'Eros and Psyche', 'Constellations'];
      
      const allClassical = query(`
        SELECT * FROM assignments_ref WHERE section IN ('classical', 'classical_creative')
      `);
      
      const completedRecords = query(`
        SELECT gr.*, ar.section, ar.assignment_type, ar.myth_god, ar.display_name, ar.max_points as assignment_max, ar.is_bonus
        FROM grade_records gr
        JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
        WHERE gr.student_id = ? AND ar.section IN ('classical', 'classical_creative')
      `, [student_id]);
      
      const completedIds = new Set(completedRecords.map(r => r.assignment_id));
      
      // Helper: build section data for a myth group
      function buildSection(mythNames, label) {
        const assignments = allClassical.filter(a => mythNames.includes(a.myth_god));
        const baseline = assignments.filter(a => a.assignment_type !== 'mural');
        const pixton = assignments.filter(a => a.assignment_type === 'mural');
        const completed = completedRecords.filter(r => mythNames.includes(r.myth_god));
        const baselineCompleted = completed.filter(r => r.assignment_type !== 'mural');
        const pixtonCompleted = completed.filter(r => r.assignment_type === 'mural');
        
        const baselineEarned = baselineCompleted.reduce((sum, r) => sum + r.points_earned, 0);
        const baselineMax = baseline.reduce((sum, a) => sum + a.max_points, 0);
        const pixtonEarned = pixtonCompleted.reduce((sum, r) => sum + r.points_earned, 0);
        const pixtonMax = pixton.reduce((sum, a) => sum + a.max_points, 0);
        
        // Group missing by myth for the UI
        const missingByMyth = {};
        assignments.forEach(a => {
          if (!completedIds.has(a.assignment_id)) {
            if (!missingByMyth[a.myth_god]) missingByMyth[a.myth_god] = [];
            missingByMyth[a.myth_god].push({
              display_name: a.display_name, max_points: a.max_points,
              myth_god: a.myth_god, assignment_type: a.assignment_type,
              is_pixton: a.assignment_type === 'mural'
            });
          }
        });
        
        // Group completed by myth for the UI
        const completedByMyth = {};
        completed.forEach(r => {
          if (!completedByMyth[r.myth_god]) completedByMyth[r.myth_god] = [];
          completedByMyth[r.myth_god].push({
            display_name: r.display_name, myth_god: r.myth_god,
            points_earned: r.points_earned, points_possible: r.assignment_max || r.points_possible,
            assignment_type: r.assignment_type, is_pixton: r.assignment_type === 'mural'
          });
        });
        
        return {
          label,
          earned: baselineEarned, max: baselineMax,
          percentage: baselineMax > 0 ? Math.round((baselineEarned / baselineMax) * 100) : 0,
          pixton_earned: pixtonEarned, pixton_max: pixtonMax,
          completed: completed.map(r => ({
            display_name: r.display_name, myth_god: r.myth_god,
            points_earned: r.points_earned, points_possible: r.assignment_max || r.points_possible,
            assignment_type: r.assignment_type, is_pixton: r.assignment_type === 'mural'
          })),
          completed_by_myth: completedByMyth,
          missing_by_myth: missingByMyth,
          myth_order: mythNames
        };
      }
      
      const s1 = buildSection(section1Myths, 'SECTION 1: MYTHS 1-4');
      const s2 = buildSection(section2Myths, 'SECTION 2: MYTHS 5-7');
      
      // Classical bonus assignments  
      const bonusAssignments = query(`
        SELECT * FROM assignments_ref WHERE section = 'bonus' AND age = 'Classical'
      `);
      const bonusRecords = query(`
        SELECT gr.*, ar.section, ar.assignment_type, ar.myth_god, ar.display_name, ar.max_points as assignment_max
        FROM grade_records gr
        JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
        WHERE gr.student_id = ? AND ar.section = 'bonus' AND ar.age = 'Classical'
      `, [student_id]);
      const bonusEarned = bonusRecords.reduce((sum, r) => sum + r.points_earned, 0);
      const bonusTarget = 100;
      const bonusCompletedIds = new Set(bonusRecords.map(r => r.assignment_id));
      
      // Group bonus missing by myth
      const bonusMissingByMyth = {};
      bonusAssignments.forEach(a => {
        if (!bonusCompletedIds.has(a.assignment_id)) {
          const mythKey = a.myth_god === 'Pandora (Box)' ? 'Pandora' : a.myth_god;
          if (!bonusMissingByMyth[mythKey]) bonusMissingByMyth[mythKey] = [];
          bonusMissingByMyth[mythKey].push({
            display_name: a.display_name, max_points: a.max_points,
            myth_god: a.myth_god, assignment_type: a.assignment_type
          });
        }
      });
      const bonusCompletedByMyth = {};
      bonusRecords.forEach(r => {
        const mythKey = r.myth_god === 'Pandora (Box)' ? 'Pandora' : r.myth_god;
        if (!bonusCompletedByMyth[mythKey]) bonusCompletedByMyth[mythKey] = [];
        bonusCompletedByMyth[mythKey].push({
          display_name: r.display_name, myth_god: r.myth_god,
          points_earned: r.points_earned, points_possible: r.assignment_max || r.points_possible
        });
      });

      res.json({
        age: 'Classical',
        section1: s1,
        section2: s2,
        bonus: {
          label: 'EXTRA CREDIT',
          earned: bonusEarned, max: bonusTarget,
          percentage: bonusTarget > 0 ? Math.round((Math.min(bonusEarned, bonusTarget) / bonusTarget) * 100) : 0,
          completed: bonusRecords.map(r => ({ display_name: r.display_name, myth_god: r.myth_god, points_earned: r.points_earned, points_possible: r.assignment_max || r.points_possible })),
          completed_by_myth: bonusCompletedByMyth,
          missing_by_myth: bonusMissingByMyth,
          myth_order: ['Pandora', 'Phaethon', 'Orpheus', 'Echo and Narcissus', 'Icarus', 'Eros and Psyche', 'Constellations', 'Morals']
        }
      });
    }
  } catch (err) {
    console.error('Get grades error:', err);
    res.status(500).json({ error: 'Failed to fetch grades' });
  }
});

// Get bonus assignments with full details (for portal)
app.get('/api/student/bonus-assignments', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    
    // Get all bonus assignments
    const bonusAssignments = query(`
      SELECT * FROM assignments_ref 
      WHERE section = 'bonus' AND age = 'Archaic'
      ORDER BY myth_god
    `);
    
    // Get student's completed bonus records
    const completedRecords = query(`
      SELECT gr.*, ar.myth_god
      FROM grade_records gr
      JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
      WHERE gr.student_id = ? AND ar.section = 'bonus'
    `, [student_id]);
    
    // Get pending submissions for bonus work
    const pendingSubmissions = query(`
      SELECT myth_god FROM point_submissions
      WHERE student_id = ? AND section = 'bonus' AND status = 'pending'
    `, [student_id]);
    
    const completedGods = new Set(completedRecords.map(r => r.myth_god));
    const pendingGods = new Set(pendingSubmissions.map(s => s.myth_god));
    
    // Add status to each assignment
    const assignmentsWithStatus = bonusAssignments.map(a => {
      let status = 'not_started';
      let points_earned = null;
      
      if (completedGods.has(a.myth_god)) {
        status = 'completed';
        const record = completedRecords.find(r => r.myth_god === a.myth_god);
        points_earned = record ? record.points_earned : null;
      } else if (pendingGods.has(a.myth_god)) {
        status = 'pending';
      }
      
      return {
        ...a,
        status,
        points_earned
      };
    });
    
    res.json(assignmentsWithStatus);
  } catch (err) {
    console.error('Get bonus assignments error:', err);
    res.status(500).json({ error: 'Failed to fetch bonus assignments' });
  }
});

// Student: Get Classical Age bonus assignments with status
app.get('/api/student/classical-bonus-assignments', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    
    // Get all Classical bonus assignments
    const bonusAssignments = query(`
      SELECT * FROM assignments_ref 
      WHERE section = 'bonus' AND age = 'Classical'
      ORDER BY myth_god, max_points DESC
    `);
    
    // Get student's completed bonus records
    const completedRecords = query(`
      SELECT gr.assignment_id, gr.points_earned, ar.myth_god, ar.display_name
      FROM grade_records gr
      JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
      WHERE gr.student_id = ? AND ar.section = 'bonus' AND ar.age = 'Classical'
    `, [student_id]);
    
    // Get pending submissions
    const pendingSubmissions = query(`
      SELECT ps.description, ps.myth_god FROM point_submissions ps
      WHERE ps.student_id = ? AND ps.section = 'bonus' AND ps.status = 'pending'
    `, [student_id]);
    
    const completedIds = new Set(completedRecords.map(r => r.assignment_id));
    const pendingDescs = new Set(pendingSubmissions.map(s => s.description));
    
    const assignmentsWithStatus = bonusAssignments.map(a => {
      let status = 'not_started';
      let points_earned = null;
      
      if (completedIds.has(a.assignment_id)) {
        status = 'completed';
        const record = completedRecords.find(r => r.assignment_id === a.assignment_id);
        points_earned = record ? record.points_earned : null;
      } else if (pendingDescs.has(a.display_name)) {
        status = 'pending';
      }
      
      return { ...a, status, points_earned };
    });
    
    res.json(assignmentsWithStatus);
  } catch (err) {
    console.error('Get classical bonus assignments error:', err);
    res.status(500).json({ error: 'Failed to fetch classical bonus assignments' });
  }
});

// Teacher: View a specific student's grades
app.get('/api/teacher/student-grades/:student_id', authenticateToken, (req, res) => {
  try {
    const { student_id } = req.params;
    
    // Get student info
    const student = query('SELECT student_id, name, class_period FROM students WHERE student_id = ?', [student_id])[0];
    
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    // Get all assignments (exclude video - WeVideo removed)
    const allAssignments = query(`
      SELECT * FROM assignments_ref WHERE age = 'Archaic' AND assignment_type != 'video'
    `);
    
    // Get student's completed assignments
    const completedRecords = query(`
      SELECT gr.*, ar.section, ar.assignment_type, ar.myth_god, ar.display_name, ar.max_points as assignment_max, ar.is_bonus
      FROM grade_records gr
      JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
      WHERE gr.student_id = ?
    `, [student_id]);
    
    // Calculate totals by section
    const section1Assignments = allAssignments.filter(a => a.section === 'section_1');
    const section2Assignments = allAssignments.filter(a => a.section === 'section_2');
    const bonusAssignments = allAssignments.filter(a => a.section === 'bonus');
    
    const section1Completed = completedRecords.filter(r => r.section === 'section_1');
    const section2Completed = completedRecords.filter(r => r.section === 'section_2');
    const bonusCompleted = completedRecords.filter(r => r.section === 'bonus');
    
    const section1Earned = section1Completed.reduce((sum, r) => sum + r.points_earned, 0);
    const section2Earned = section2Completed.reduce((sum, r) => sum + r.points_earned, 0);
    const bonusEarned = bonusCompleted.reduce((sum, r) => sum + r.points_earned, 0);
    
    const section1Max = section1Assignments.reduce((sum, a) => sum + a.max_points, 0);
    const section2Max = section2Assignments.reduce((sum, a) => sum + a.max_points, 0);
    const bonusMax = bonusAssignments.reduce((sum, a) => sum + a.max_points, 0);
    
    res.json({
      student,
      section1: {
        earned: section1Earned,
        max: section1Max,
        percentage: section1Max > 0 ? Math.round((section1Earned / section1Max) * 100) : 0,
        completed: section1Completed
      },
      section2: {
        earned: section2Earned,
        max: section2Max,
        percentage: section2Max > 0 ? Math.round((section2Earned / section2Max) * 100) : 0,
        completed: section2Completed
      },
      bonus: {
        earned: bonusEarned,
        max: bonusMax,
        percentage: bonusMax > 0 ? Math.round((bonusEarned / bonusMax) * 100) : 0,
        completed: bonusCompleted
      }
    });
  } catch (err) {
    console.error('Get student grades error:', err);
    res.status(500).json({ error: 'Failed to fetch student grades' });
  }
});

// Teacher: Get all students' grade overview by class period
app.get('/api/teacher/grade-overview', authenticateToken, (req, res) => {
  try {
    // Get all students with their current age (from alliance)
    const students = query(`
      SELECT s.student_id, s.name, s.class_period, s.alliance_id,
             COALESCE(a.current_age, 'Archaic') as current_age
      FROM students s
      LEFT JOIN alliances a ON s.alliance_id = a.alliance_id
      ORDER BY s.class_period, s.name
    `);
    
    // === ARCHAIC MAX POINTS ===
    const archaicAssignments = query(`SELECT * FROM assignments_ref WHERE age = 'Archaic' AND assignment_type != 'video'`);
    const archaicMax = {
      section1: archaicAssignments.filter(a => a.section === 'section_1').reduce((sum, a) => sum + a.max_points, 0),
      section2: archaicAssignments.filter(a => a.section === 'section_2').reduce((sum, a) => sum + a.max_points, 0),
      bonus: archaicAssignments.filter(a => a.section === 'bonus').reduce((sum, a) => sum + a.max_points, 0)
    };
    
    // === CLASSICAL MAX POINTS ===
    const section1Myths = ['Pandora', 'Phaethon', 'Orpheus', 'Echo and Narcissus'];
    const section2Myths = ['Icarus', 'Eros and Psyche', 'Constellations'];
    const classicalAssignments = query(`SELECT * FROM assignments_ref WHERE section IN ('classical', 'classical_creative')`);
    const classicalBonusAssignments = query(`SELECT * FROM assignments_ref WHERE section = 'bonus' AND age = 'Classical'`);
    
    const classicalMax = {
      section1: classicalAssignments.filter(a => section1Myths.includes(a.myth_god) && a.assignment_type !== 'mural').reduce((sum, a) => sum + a.max_points, 0),
      section2: classicalAssignments.filter(a => section2Myths.includes(a.myth_god) && a.assignment_type !== 'mural').reduce((sum, a) => sum + a.max_points, 0),
      bonus: 100 // Target, not total available
    };
    
    // === ALL GRADE RECORDS (single query) ===
    const allGradeRecords = query(`
      SELECT gr.student_id, gr.points_earned, ar.section, ar.myth_god, ar.assignment_type, ar.age
      FROM grade_records gr
      JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
    `);
    
    // === QUIZ ATTEMPTS & MYTH COMPLETIONS (for Classical grading) ===
    const allQuizAttempts = query('SELECT student_id, portal_id, passed FROM myth_quiz_attempts WHERE passed = 1');
    let allMythCompletions = [];
    try {
      allMythCompletions = query('SELECT student_id, portal_id, teacher_approved, points_earned FROM student_myth_completion WHERE teacher_approved = 1');
    } catch (e) { /* table may not exist yet */ }
    
    // Calculate grades for each student - return BOTH ages for Classical students
    const studentsWithGrades = students.map(student => {
      const age = student.current_age || 'Archaic';
      const studentRecords = allGradeRecords.filter(r => r.student_id === student.student_id);
      
      // Always compute Archaic grades (every student has these)
      const arcS1 = studentRecords.filter(r => r.section === 'section_1').reduce((sum, r) => sum + r.points_earned, 0);
      const arcS2 = studentRecords.filter(r => r.section === 'section_2').reduce((sum, r) => sum + r.points_earned, 0);
      const arcBonus = studentRecords.filter(r => r.section === 'bonus' && r.age !== 'Classical').reduce((sum, r) => sum + r.points_earned, 0);
      
      const result = {
        student_id: student.student_id,
        name: student.name,
        class_period: student.class_period || 'Unassigned',
        age: age,
        archaic: {
          section1: { earned: arcS1, max: archaicMax.section1, percentage: archaicMax.section1 > 0 ? Math.round((arcS1 / archaicMax.section1) * 100) : 0 },
          section2: { earned: arcS2, max: archaicMax.section2, percentage: archaicMax.section2 > 0 ? Math.round((arcS2 / archaicMax.section2) * 100) : 0 },
          bonus: { earned: arcBonus, max: archaicMax.bonus, percentage: archaicMax.bonus > 0 ? Math.round((arcBonus / archaicMax.bonus) * 100) : 0 }
        }
      };
      
      // Compute Classical grades for Classical-age students
      if (age === 'Classical') {
        const mythNames = ['Pandora', 'Phaethon', 'Orpheus & Eurydice', 'Echo & Narcissus', 'Icarus & Daedalus', 'Eros & Psyche', 'Constellations'];
        // Map portal myth_name to possible grade record myth_god values
        const mythAliases = {
          'Pandora': ['Pandora'],
          'Phaethon': ['Phaethon'],
          'Orpheus & Eurydice': ['Orpheus & Eurydice', 'Orpheus', 'Orpheus and Eurydice'],
          'Echo & Narcissus': ['Echo & Narcissus', 'Echo and Narcissus'],
          'Icarus & Daedalus': ['Icarus & Daedalus', 'Icarus', 'Icarus and Daedalus'],
          'Eros & Psyche': ['Eros & Psyche', 'Eros and Psyche'],
          'Constellations': ['Constellations']
        };
        
        // Get quiz scores for this student
        const studentQuizzes = allQuizAttempts.filter(q => q.student_id === student.student_id && q.passed === 1);
        // Get portal assignment approvals
        const studentCompletions = allMythCompletions.filter(c => c.student_id === student.student_id && c.teacher_approved === 1);
        
        const classicalMyths = {};
        mythNames.forEach((mythName, idx) => {
          const portalId = idx + 1;
          const aliases = mythAliases[mythName] || [mythName];
          
          // Reading guide: actual points from grade_records
          const guideRecord = studentRecords.find(r => 
            r.assignment_type === 'comp_conn' && r.section === 'classical' && aliases.some(a => r.myth_god === a)
          );
          const guidePoints = guideRecord ? guideRecord.points_earned : 0;
          // Guide max from assignments_ref
          const guideRef = classicalAssignments.find(a => 
            a.assignment_type === 'comp_conn' && a.section === 'classical' && aliases.some(al => a.myth_god === al)
          );
          const guideMax = guideRef ? guideRef.max_points : 12;
          
          // Quiz: actual points from grade_records (not hardcoded 10)
          const quizRecord = studentRecords.find(r => 
            r.assignment_type === 'quiz' && r.section === 'classical' && aliases.some(a => r.myth_god === a)
          );
          const quizPoints = quizRecord ? quizRecord.points_earned : 0;
          // Quiz max from assignments_ref
          const quizRef = classicalAssignments.find(a => 
            a.assignment_type === 'quiz' && a.section === 'classical' && aliases.some(al => a.myth_god === al)
          );
          const quizMax = quizRef ? quizRef.max_points : 10;
          
          // Portal assignment: actual points from student_myth_completion
          const completion = studentCompletions.find(c => c.portal_id === portalId);
          const portalPoints = completion ? (completion.points_earned || 15) : 0;
          // Portal max: use the highest creative assignment max for this myth
          const creativeRef = classicalAssignments.filter(a => 
            a.section === 'classical_creative' && aliases.some(al => a.myth_god === al)
          );
          const portalMax = creativeRef.length > 0 ? Math.max(...creativeRef.map(a => a.max_points)) : 15;
          
          const mythMax = guideMax + quizMax + portalMax;
          const earned = guidePoints + quizPoints + portalPoints;
          classicalMyths[mythName] = { earned, guide: guidePoints, quiz: quizPoints, portal: portalPoints, max: mythMax, guideMax, quizMax, portalMax };
        });
        
        const claBonus = studentRecords.filter(r => r.section === 'bonus' && r.age === 'Classical').reduce((sum, r) => sum + r.points_earned, 0);
        
        result.classicalMyths = classicalMyths;
        result.classical = {
          section1: { earned: 0, max: 0, percentage: 0 },
          section2: { earned: 0, max: 0, percentage: 0 },
          bonus: { earned: claBonus, max: 100, percentage: claBonus > 0 ? Math.round((Math.min(claBonus, 100) / 100) * 100) : 0 }
        };
      }
      
      return result;
    });
    
    // Group by class period
    const periods = ['1st', '2nd', '3rd', '4th', 'Unassigned'];
    const byPeriod = periods.map(period => {
      const periodStudents = studentsWithGrades.filter(s => s.class_period === period).sort((a, b) => a.name.localeCompare(b.name));
      // Determine dominant age for the period (for column headers)
      const classicalCount = periodStudents.filter(s => s.age === 'Classical').length;
      const dominantAge = classicalCount > periodStudents.length / 2 ? 'Classical' : 'Archaic';
      return { period, students: periodStudents, dominantAge };
    }).filter(p => p.students.length > 0);
    
    res.json({
      byPeriod,
      maxPoints: { archaic: archaicMax, classical: classicalMax }
    });
  } catch (err) {
    console.error('Get grade overview error:', err);
    res.status(500).json({ error: 'Failed to fetch grade overview' });
  }
});

// Teacher: Update a student (name, class_period, alliance, password)
app.put('/api/teacher/student/:student_id', authenticateToken, async (req, res) => {
  try {
    const { student_id } = req.params;
    const { name, class_period, alliance_id, new_password } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    // Get student's current info
    const student = query('SELECT * FROM students WHERE student_id = ?', [student_id])[0];
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    const oldAllianceId = student.alliance_id;
    const classChanged = student.class_period !== class_period;
    const allianceChanged = String(oldAllianceId || '') !== String(alliance_id || '');
    
    // Handle password reset if provided
    if (new_password && new_password.trim()) {
      const password_hash = await bcrypt.hash(new_password.trim(), 10);
      run(`UPDATE students SET password_hash = ? WHERE student_id = ?`, [password_hash, student_id]);
      console.log(`🔑 Password reset for student ${student_id}`);
    }
    
    // Update student info
    run(`UPDATE students SET name = ?, class_period = ?, alliance_id = ? WHERE student_id = ?`, 
      [name.trim(), class_period, alliance_id || null, student_id]);
    
    // Check if old alliance is now empty (no real members) and clean it up
    if (oldAllianceId && (classChanged || allianceChanged)) {
      const remainingReal = query(
        'SELECT COUNT(*) as count FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)',
        [oldAllianceId]
      )[0];
      if (remainingReal.count === 0) {
        // Remove any orphaned ghost students from this alliance
        const orphanedGhosts = query(
          'SELECT student_id FROM students WHERE alliance_id = ? AND is_ghost = 1',
          [oldAllianceId]
        );
        if (orphanedGhosts.length > 0) {
          run('UPDATE students SET alliance_id = NULL WHERE alliance_id = ? AND is_ghost = 1', [oldAllianceId]);
          console.log(`👻 Removed ${orphanedGhosts.length} orphaned ghost(s) from alliance ${oldAllianceId}`);
        }
        run('DELETE FROM alliances WHERE alliance_id = ?', [oldAllianceId]);
        console.log(`🗑️ Deleted empty alliance ${oldAllianceId}`);
      }
    }
    
    saveDatabase();
    res.json({ 
      success: true, 
      classChanged, 
      allianceChanged,
      passwordReset: !!(new_password && new_password.trim())
    });
  } catch (err) {
    console.error('Update student error:', err);
    res.status(500).json({ error: 'Failed to update student' });
  }
});

// Teacher: Toggle scout status for a student
app.post('/api/teacher/student/scout-status', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Not authorized' });
    const { student_id, scout_age } = req.body;
    // scout_age = 'Classical', 'Heroic', or null (to remove scout status)
    
    const student = query('SELECT s.*, a.current_age as alliance_age FROM students s LEFT JOIN alliances a ON s.alliance_id = a.alliance_id WHERE s.student_id = ?', [student_id])[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    
    if (scout_age) {
      run('UPDATE students SET scout_status = ? WHERE student_id = ?', [scout_age, student_id]);
      console.log(`🏹 Scout status granted: ${student.name} → ${scout_age} (alliance still ${student.alliance_age || 'Archaic'})`);
      res.json({ success: true, message: `${student.name} is now a Scout for ${scout_age} Age` });
    } else {
      run('UPDATE students SET scout_status = NULL WHERE student_id = ?', [student_id]);
      console.log(`🏹 Scout status removed: ${student.name}`);
      res.json({ success: true, message: `Scout status removed for ${student.name}` });
    }
    saveDatabase();
  } catch (err) {
    console.error('Scout status error:', err);
    res.status(500).json({ error: 'Failed to update scout status' });
  }
});

// Teacher: Delete a student
app.delete('/api/teacher/student/:student_id', authenticateToken, (req, res) => {
  try {
    const { student_id } = req.params;
    
    // Get student's alliance before deleting
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    const allianceId = student ? student.alliance_id : null;
    
    // Delete related records first
    run('DELETE FROM grade_records WHERE student_id = ?', [student_id]);
    run('DELETE FROM point_submissions WHERE student_id = ?', [student_id]);
    run('DELETE FROM arena_battles WHERE challenger_id = ? OR defender_id = ?', [student_id, student_id]);
    run('DELETE FROM arena_battle_rounds WHERE battle_id NOT IN (SELECT battle_id FROM arena_battles)');
    
    // Delete the student
    run('DELETE FROM students WHERE student_id = ?', [student_id]);
    
    // Check if alliance is now empty and delete it
    if (allianceId) {
      const remainingMembers = query('SELECT COUNT(*) as count FROM students WHERE alliance_id = ?', [allianceId])[0];
      if (remainingMembers.count === 0) {
        run('DELETE FROM alliances WHERE alliance_id = ?', [allianceId]);
        console.log(`🗑️ Deleted empty alliance ${allianceId}`);
      }
    }
    
    saveDatabase();
    res.json({ success: true });
  } catch (err) {
    console.error('Delete student error:', err);
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

// Create a ghost player (teacher only)
// Ghost players have no login — they pad alliance display points proportionally
app.post('/api/teacher/create-ghost', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });

    const { name } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ error: 'Name is required' });

    const ghostName = name.trim();

    // Generate a unique dummy email — never used for login
    const slug = ghostName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const ts = Date.now();
    const email = `ghost_${slug}_${ts}@odyssey.internal`;

    // Dummy password hash — bcrypt hash of a random UUID, impossible to reverse
    const dummyHash = '$2b$10$GHOSTPLAYERXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX'.substring(0, 60);

    run(
      'INSERT INTO students (name, email, password_hash, is_ghost, class_period, alliance_id) VALUES (?, ?, ?, 1, NULL, NULL)',
      [ghostName, email, dummyHash]
    );
    saveDatabase();

    const ghost = query('SELECT student_id, name, is_ghost FROM students WHERE email = ?', [email])[0];
    console.log(`👻 Teacher created ghost player: ${ghostName} (id ${ghost.student_id})`);

    res.json({ success: true, ghost });
  } catch (err) {
    console.error('Create ghost error:', err);
    res.status(500).json({ error: 'Failed to create ghost player' });
  }
});

// Remove a ghost player from an alliance (teacher only)
// Sets alliance_id = NULL, returning them to the pool
app.post('/api/teacher/remove-ghost', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });

    const { ghost_student_id } = req.body;
    if (!ghost_student_id) return res.status(400).json({ error: 'ghost_student_id required' });

    const ghost = query(
      'SELECT student_id, name, alliance_id, is_ghost FROM students WHERE student_id = ?',
      [ghost_student_id]
    )[0];

    if (!ghost) return res.status(404).json({ error: 'Student not found' });
    if (!ghost.is_ghost) return res.status(400).json({ error: 'Not a ghost player' });
    if (!ghost.alliance_id) return res.status(400).json({ error: 'Ghost is not in any alliance' });

    const allianceName = query('SELECT alliance_name FROM alliances WHERE alliance_id = ?', [ghost.alliance_id])[0]?.alliance_name || 'unknown';

    run('UPDATE students SET alliance_id = NULL WHERE student_id = ?', [ghost_student_id]);
    saveDatabase();

    console.log(`👻 Teacher removed ghost ${ghost.name} from alliance ${allianceName}`);
    res.json({ success: true, message: `👻 ${ghost.name} removed from ${allianceName}` });
  } catch (err) {
    console.error('Remove ghost error:', err);
    res.status(500).json({ error: 'Failed to remove ghost player' });
  }
});

// Get all submissions for a specific student (for teacher to view/delete)
app.get('/api/teacher/student-submissions/:student_id', authenticateToken, (req, res) => {
  try {
    const { student_id } = req.params;
    
    const submissions = query(`
      SELECT 
        submission_id,
        category,
        section,
        myth_god,
        points_claimed,
        max_points,
        status,
        submitted_at,
        reviewed_at,
        description
      FROM point_submissions
      WHERE student_id = ?
      ORDER BY submitted_at DESC
    `, [student_id]);
    
    res.json(submissions);
  } catch (err) {
    console.error('Get student submissions error:', err);
    res.status(500).json({ error: 'Failed to fetch submissions' });
  }
});

// Delete a submission (teacher only)
app.delete('/api/teacher/delete-submission/:submission_id', authenticateToken, (req, res) => {
  try {
    const { submission_id } = req.params;

    // Get the submission first to know how many points to remove
    const submission = query('SELECT * FROM point_submissions WHERE submission_id = ?', [submission_id])[0];

    if (!submission) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    // Only allow deleting approved submissions (pending ones can just be rejected)
    if (submission.status !== 'approved') {
      return res.status(400).json({ error: 'Can only delete approved submissions. Reject pending submissions instead.' });
    }

    const student_id = submission.student_id;
    const points_to_remove = submission.points_claimed || 0;
    const myth_god = submission.myth_god || null;

    // Get student's alliance
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];

    // --- Cascade: clean up myth portal completion if applicable ---
    // Only wipe student_myth_completion if this submission was the SOLE approved source for that myth
    const MYTH_GOD_TO_PORTAL = {
      'Pandora': 1, 'Phaethon': 2, 'Orpheus': 3,
      'Echo and Narcissus': 4, 'Echo & Narcissus': 4,
      'Icarus': 5, 'Eros and Psyche': 6, 'Eros & Psyche': 6,
      'Constellations': 7
    };
    const portalId = myth_god ? MYTH_GOD_TO_PORTAL[myth_god] : null;
    let mythPortalCleared = false;

    if (portalId) {
      // Check if there are OTHER approved submissions for this student+myth beyond this one
      const otherApproved = query(
        `SELECT COUNT(*) as cnt FROM point_submissions
         WHERE student_id = ? AND myth_god = ? AND status = 'approved' AND submission_id != ?`,
        [student_id, myth_god, submission_id]
      )[0];
      const otherGradeRecords = query(
        `SELECT COUNT(*) as cnt FROM grade_records gr
         JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
         WHERE gr.student_id = ? AND ar.myth_god IN (?, ?) AND gr.submission_id != ?`,
        [student_id, myth_god, myth_god === 'Icarus' ? 'Icarus & Daedalus' : myth_god, submission_id]
      )[0];
      const noOtherSources = (otherApproved.cnt === 0) && (otherGradeRecords.cnt === 0);
      if (noOtherSources) {
        run('DELETE FROM student_myth_completion WHERE student_id = ? AND portal_id = ?', [student_id, portalId]);
        mythPortalCleared = true;
        console.log(`🏛️ Cleared myth portal completion: student ${student_id}, portal ${portalId} (${myth_god})`);
      }
    }

    // Delete the submission
    run('DELETE FROM point_submissions WHERE submission_id = ?', [submission_id]);

    // Delete from grade_records if exists
    run('DELETE FROM grade_records WHERE submission_id = ?', [submission_id]);

    // Subtract points from alliance if student is in one
    if (student && student.alliance_id && points_to_remove > 0) {
      run('UPDATE alliances SET total_points = MAX(0, total_points - ?) WHERE alliance_id = ?',
        [points_to_remove, student.alliance_id]);
    }

    console.log(`Deleted submission ${submission_id} for student ${student_id}, removed ${points_to_remove} points`);

    res.json({
      message: 'Submission deleted successfully',
      points_removed: points_to_remove,
      myth_portal_cleared: mythPortalCleared
    });

    saveDatabase();
  } catch (err) {
    console.error('Delete submission error:', err);
    res.status(500).json({ error: 'Failed to delete submission' });
  }
});

// ====================
// MAP SYSTEM
// ====================

// Building icon mapping
const BUILDING_ICONS = {
  'Town Center': '/buildings/town_center.png',
  'Library': '/buildings/library.png',
  'House': '/buildings/house.png',
  'Wooden Wall': '🧱',
  'Stone Wall': '🪨',
  'Dock': '/buildings/dock.png',
  'Fishing Ship': '/buildings/fishing_boat.png',
  'Granary': '/buildings/granary.png',
  'Storehouse': '/buildings/storehouse.png',
  'Transport Ship': '/buildings/transport_ship.png',
  'Armory': '/buildings/armory.png',
  'Theater': '/buildings/theater.png',
  'Agora': '/buildings/agora.png',
  'Oracle': '/buildings/oracle.png',
  "Hero's Forge": '🔥',
  'Harbor of the Argo': '⚓',
  'Labyrinth Arena': '🏟️',
  'Shrine of the Fates': '🏛️'
};

// Student: Upload map
app.post('/api/student/upload-map', authenticateToken, (req, res) => {
  try {
    const { map_image } = req.body; // base64 encoded image
    const student_id = req.user.id;
    
    console.log('Upload map request received for student:', student_id);
    console.log('Image data length:', map_image ? map_image.length : 'no image');
    
    if (!map_image) {
      return res.status(400).json({ error: 'No map image provided' });
    }
    
    // Validate it's a base64 image
    if (!map_image.startsWith('data:image/')) {
      console.log('Invalid image format, starts with:', map_image.substring(0, 50));
      return res.status(400).json({ error: 'Invalid image format' });
    }
    
    // Save map
    console.log('Saving map to database...');
    run('UPDATE students SET map_image = ?, map_uploaded_at = CURRENT_TIMESTAMP WHERE student_id = ?',
        [map_image, student_id]);
    
    // Check if ALL non-ghost alliance members have uploaded maps
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    console.log('Student alliance_id:', student ? student.alliance_id : 'no student found');
    
    if (student && student.alliance_id) {
      const totalNonGhost = query(
        'SELECT COUNT(*) as count FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)',
        [student.alliance_id]
      )[0].count;
      const membersWithMap = query(
        'SELECT COUNT(*) as count FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL) AND map_image IS NOT NULL AND map_image != ""',
        [student.alliance_id]
      )[0].count;
      
      console.log(`Map check: ${membersWithMap}/${totalNonGhost} non-ghost members have maps`);
      
      if (membersWithMap >= totalNonGhost && totalNonGhost > 0) {
        run('UPDATE alliances SET civilization_map_complete = 1 WHERE alliance_id = ?', [student.alliance_id]);
        console.log('All members have maps - alliance map requirement marked complete');
      } else {
        // Reset to incomplete if not all members have maps (handles edge case of map deletion)
        run('UPDATE alliances SET civilization_map_complete = 0 WHERE alliance_id = ?', [student.alliance_id]);
        console.log(`Waiting for ${totalNonGhost - membersWithMap} more member maps`);
      }
    }
    
    // Save database to persist
    saveDatabase();
    
    console.log('Map saved successfully!');
    res.json({ success: true, message: 'Map uploaded successfully!' });
  } catch (err) {
    console.error('Upload map error:', err);
    res.status(500).json({ error: 'Failed to upload map: ' + err.message });
  }
});

// Student: Get my map and placements
app.get('/api/student/my-map', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    console.log('Loading map for student:', student_id);
    
    const student = query(`
      SELECT s.*, a.buildings_owned, a.alliance_name 
      FROM students s 
      LEFT JOIN alliances a ON s.alliance_id = a.alliance_id 
      WHERE s.student_id = ?
    `, [student_id])[0];
    
    if (!student) {
      console.log('Student not found');
      return res.status(404).json({ error: 'Student not found' });
    }
    
    console.log('Student found, has map:', !!student.map_image);
    console.log('Map image length:', student.map_image ? student.map_image.length : 0);
    
    const placements = query('SELECT * FROM building_placements WHERE student_id = ?', [student_id]);
    console.log('Placements found:', placements.length);
    
    // Get available buildings to place (owned by alliance but not yet placed by this student)
    const ownedBuildings = JSON.parse(student.buildings_owned || '[]');
    console.log('Owned buildings:', ownedBuildings);
    
    // Count placements per building
    const placementCounts = {};
    placements.forEach(p => {
      placementCounts[p.building_name] = (placementCounts[p.building_name] || 0) + 1;
    });
    
    // Calculate what can still be placed
    const buildingsToPlace = [];
    const buildingCounts = {};
    ownedBuildings.forEach(b => {
      buildingCounts[b] = (buildingCounts[b] || 0) + 1;
    });
    
    Object.keys(buildingCounts).forEach(building => {
      const owned = buildingCounts[building];
      const placed = placementCounts[building] || 0;
      const remaining = owned - placed;
      if (remaining > 0) {
        buildingsToPlace.push({
          building_name: building,
          icon: BUILDING_ICONS[building] || '🏗️',
          count: remaining
        });
      }
    });
    
    console.log('Sending response...');
    
    // Safely get wall_points (column might not exist in older databases)
    let wallPoints = null;
    try {
      if (student.wall_points) {
        wallPoints = JSON.parse(student.wall_points);
      }
    } catch (e) {
      console.log('Could not parse wall_points:', e.message);
    }
    
    res.json({
      hasMap: !!student.map_image,
      map_image: student.map_image,
      map_uploaded_at: student.map_uploaded_at,
      wall_points: wallPoints,
      placements: placements.map(p => ({
        ...p,
        icon: BUILDING_ICONS[p.building_name] || '🏗️'
      })),
      buildingsToPlace,
      alliance_name: student.alliance_name
    });
    console.log('Response sent successfully');
  } catch (err) {
    console.error('Get my map error:', err);
    res.status(500).json({ error: 'Failed to fetch map: ' + err.message });
  }
});

// Student: Place building on map
app.post('/api/student/place-building', authenticateToken, (req, res) => {
  try {
    const { building_name, x_position, y_position } = req.body;
    const student_id = req.user.id;
    
    // Check student has a map (use length check to avoid loading full blob)
    const student = query(`
      SELECT s.student_id, s.alliance_id, s.class_period, 
             CASE WHEN s.map_image IS NOT NULL AND s.map_image != '' THEN 1 ELSE 0 END as has_map,
             a.buildings_owned 
      FROM students s 
      LEFT JOIN alliances a ON s.alliance_id = a.alliance_id 
      WHERE s.student_id = ?
    `, [student_id])[0];
    
    if (!student.has_map) {
      return res.status(400).json({ error: 'You must upload a map first' });
    }
    
    // Check alliance owns this building
    const ownedBuildings = JSON.parse(student.buildings_owned || '[]');
    const ownedCount = ownedBuildings.filter(b => b === building_name).length;
    
    if (ownedCount === 0) {
      return res.status(400).json({ error: 'Your alliance does not own this building' });
    }
    
    // Check how many this student has already placed
    const placedCount = query(
      'SELECT COUNT(*) as count FROM building_placements WHERE student_id = ? AND building_name = ?',
      [student_id, building_name]
    )[0].count;
    
    if (placedCount >= ownedCount) {
      return res.status(400).json({ error: 'You have already placed all of these buildings' });
    }
    
    // Place the building
    const instance = placedCount + 1;
    run(`INSERT INTO building_placements (student_id, building_name, instance_number, x_position, y_position)
         VALUES (?, ?, ?, ?, ?)`,
        [student_id, building_name, instance, x_position, y_position]);
    
    res.json({ 
      success: true, 
      message: `${building_name} placed on your map!`,
      icon: BUILDING_ICONS[building_name] || '🏗️'
    });
  } catch (err) {
    console.error('Place building error:', err);
    res.status(500).json({ error: 'Failed to place building' });
  }
});

// Student: Move building on map
app.post('/api/student/move-building', authenticateToken, (req, res) => {
  try {
    const { placement_id, x_position, y_position } = req.body;
    const student_id = req.user.id;
    
    // Verify ownership
    const placement = query('SELECT * FROM building_placements WHERE placement_id = ? AND student_id = ?',
                           [placement_id, student_id])[0];
    
    if (!placement) {
      return res.status(404).json({ error: 'Placement not found' });
    }
    
    run('UPDATE building_placements SET x_position = ?, y_position = ? WHERE placement_id = ?',
        [x_position, y_position, placement_id]);
    
    res.json({ success: true });
  } catch (err) {
    console.error('Move building error:', err);
    res.status(500).json({ error: 'Failed to move building' });
  }
});

// Student: Save wall drawing
app.post('/api/student/save-wall', authenticateToken, (req, res) => {
  try {
    const { wall_points } = req.body;
    const student_id = req.user.id;
    
    // Validate wall points
    if (!wall_points || !Array.isArray(wall_points) || wall_points.length < 3) {
      return res.status(400).json({ error: 'Wall must have at least 3 points' });
    }
    
    // Check student has a wall building
    const student = query(`
      SELECT s.student_id, s.alliance_id, s.wall_points, a.buildings_owned 
      FROM students s 
      LEFT JOIN alliances a ON s.alliance_id = a.alliance_id 
      WHERE s.student_id = ?
    `, [student_id])[0];
    
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    const ownedBuildings = JSON.parse(student.buildings_owned || '[]');
    const hasWall = ownedBuildings.includes('Wooden Wall') || ownedBuildings.includes('Stone Wall');
    
    if (!hasWall) {
      return res.status(400).json({ error: 'You must own a wall building to draw walls' });
    }
    
    // Save wall points as JSON
    const wallPointsJson = JSON.stringify(wall_points);
    run('UPDATE students SET wall_points = ? WHERE student_id = ?', [wallPointsJson, student_id]);
    
    console.log(`🏰 Student ${student_id} saved wall with ${wall_points.length} points`);
    
    res.json({ success: true, wall_points });
  } catch (err) {
    console.error('Save wall error:', err);
    res.status(500).json({ error: 'Failed to save wall' });
  }
});

// Get alliance maps (for viewing alliance members' maps)
app.get('/api/alliance/maps/:alliance_id', authenticateToken, (req, res) => {
  try {
    const { alliance_id } = req.params;
    
    const members = query(`
      SELECT student_id, name, map_image, map_uploaded_at, wall_points 
      FROM students 
      WHERE alliance_id = ?
    `, [alliance_id]);
    
    const mapsWithPlacements = members.map(member => {
      const placements = query('SELECT * FROM building_placements WHERE student_id = ?', [member.student_id]);
      
      // Parse wall_points safely
      let wallPoints = null;
      try {
        if (member.wall_points) {
          wallPoints = JSON.parse(member.wall_points);
        }
      } catch (e) {
        console.log('Could not parse wall_points for student', member.student_id);
      }
      
      return {
        ...member,
        hasMap: !!member.map_image,
        wall_points: wallPoints,
        placements: placements.map(p => ({
          ...p,
          icon: BUILDING_ICONS[p.building_name] || '🏗️'
        }))
      };
    });
    
    res.json(mapsWithPlacements);
  } catch (err) {
    console.error('Get alliance maps error:', err);
    res.status(500).json({ error: 'Failed to fetch alliance maps' });
  }
});

// Get single student's map (for gallery view)
app.get('/api/student/map/:student_id', authenticateToken, (req, res) => {
  try {
    const { student_id } = req.params;
    
    const student = query(`
      SELECT s.student_id, s.name, s.map_image, s.map_uploaded_at, s.wall_points, a.alliance_name, a.buildings_owned
      FROM students s
      LEFT JOIN alliances a ON s.alliance_id = a.alliance_id
      WHERE s.student_id = ?
    `, [student_id])[0];
    
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    const placements = query('SELECT * FROM building_placements WHERE student_id = ?', [student_id]);
    
    // Parse wall_points safely
    let wallPoints = null;
    try {
      if (student.wall_points) {
        wallPoints = JSON.parse(student.wall_points);
      }
    } catch (e) {
      console.log('Could not parse wall_points');
    }
    
    res.json({
      ...student,
      hasMap: !!student.map_image,
      wall_points: wallPoints,
      placements: placements.map(p => ({
        ...p,
        icon: BUILDING_ICONS[p.building_name] || '🏗️'
      }))
    });
  } catch (err) {
    console.error('Get student map error:', err);
    res.status(500).json({ error: 'Failed to fetch map' });
  }
});

// Check if student has map (for purchase blocking)
app.get('/api/student/has-map', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const student = query('SELECT map_image FROM students WHERE student_id = ?', [student_id])[0];
    res.json({ hasMap: !!student.map_image });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check map status' });
  }
});

// ====================
// ALLIANCE INVITATIONS
// ====================

// Send Alliance Invitation
app.post('/api/alliance/invite', authenticateToken, (req, res) => {
  try {
    const { invited_student_id } = req.body;
    const inviter_id = req.user.id;
    
    // Get inviter's info including class period and alliance
    const inviter = query('SELECT s.alliance_id, s.class_period FROM students s WHERE s.student_id = ?', [inviter_id])[0];
    
    if (!inviter || !inviter.alliance_id) {
      return res.status(400).json({ error: 'You must be in an alliance to send invitations' });
    }
    
    // Check if invited student exists and get their info
    const invited = query('SELECT student_id, alliance_id, class_period, is_ghost FROM students WHERE student_id = ?', [invited_student_id])[0];
    
    if (!invited) {
      return res.status(404).json({ error: 'Student not found' });
    }
    
    if (invited.alliance_id) {
      return res.status(400).json({ error: 'This student is already in an alliance' });
    }
    
    // Count real and ghost members
    const realMemberCount = query(
      'SELECT COUNT(*) as count FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)',
      [inviter.alliance_id]
    )[0].count;
    
    const ghostMemberCount = query(
      'SELECT COUNT(*) as count FROM students WHERE alliance_id = ? AND is_ghost = 1',
      [inviter.alliance_id]
    )[0].count;
    
    const totalMembers = realMemberCount + ghostMemberCount;
    
    if (totalMembers >= 4) {
      return res.status(400).json({ error: 'Your alliance is full (4 members maximum)' });
    }
    
    if (invited.is_ghost) {
      // Ghost-specific checks — total member cap (real+ghost <= 4) already enforced above
      if (realMemberCount >= 4) {
        return res.status(400).json({ error: 'Your alliance already has 4 real members — no ghosts needed' });
      }
      
      // Auto-accept: directly assign ghost to alliance
      run('UPDATE students SET alliance_id = ? WHERE student_id = ?', [inviter.alliance_id, invited.student_id]);
      saveDatabase();
      
      const ghostName = query('SELECT name FROM students WHERE student_id = ?', [invited.student_id])[0].name;
      return res.json({ success: true, message: `👻 ${ghostName} has joined your alliance!` });
    }
    
    // Regular student invite flow
    // Must be same class period
    if (invited.class_period !== inviter.class_period) {
      return res.status(400).json({ error: 'Can only invite students from your class period' });
    }
    
    // Check if invitation already exists
    const existing = query(`
      SELECT * FROM alliance_invitations 
      WHERE alliance_id = ? AND invited_student_id = ? AND status = 'pending'
    `, [inviter.alliance_id, invited_student_id]);
    
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Invitation already sent to this student' });
    }
    
    // Create invitation
    run(`INSERT INTO alliance_invitations (alliance_id, inviter_student_id, invited_student_id, status) 
         VALUES (?, ?, ?, 'pending')`, 
        [inviter.alliance_id, inviter_id, invited_student_id]);
    
    res.json({ success: true, message: 'Invitation sent!' });
  } catch (err) {
    console.error('Send invitation error:', err);
    res.status(500).json({ error: 'Failed to send invitation' });
  }
});

// Kick ghost from alliance
app.post('/api/alliance/kick-ghost', authenticateToken, (req, res) => {
  try {
    const { ghost_student_id } = req.body;
    const student_id = req.user.id;
    
    // Get requester's alliance
    const requester = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    if (!requester || !requester.alliance_id) {
      return res.status(400).json({ error: 'You must be in an alliance' });
    }
    
    // Verify the target is a ghost in the same alliance
    const ghost = query('SELECT student_id, name, alliance_id, is_ghost FROM students WHERE student_id = ?', [ghost_student_id])[0];
    if (!ghost || !ghost.is_ghost) {
      return res.status(400).json({ error: 'Not a ghost student' });
    }
    if (ghost.alliance_id !== requester.alliance_id) {
      return res.status(400).json({ error: 'This ghost is not in your alliance' });
    }
    
    // Remove ghost from alliance
    run('UPDATE students SET alliance_id = NULL WHERE student_id = ?', [ghost_student_id]);
    saveDatabase();
    
    res.json({ success: true, message: `👻 ${ghost.name} has been removed from your alliance.` });
  } catch (err) {
    console.error('Kick ghost error:', err);
    res.status(500).json({ error: 'Failed to remove ghost' });
  }
});

// Get Student's Pending Invitations
app.get('/api/student/invitations', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    
    // If student is already in an alliance, auto-cancel all pending invitations
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    if (student && student.alliance_id) {
      const stale = query('SELECT COUNT(*) as count FROM alliance_invitations WHERE invited_student_id = ? AND status = ?', [student_id, 'pending'])[0].count;
      if (stale > 0) {
        run("UPDATE alliance_invitations SET status = 'cancelled' WHERE invited_student_id = ? AND status = 'pending'", [student_id]);
        console.log(`🧹 Auto-cancelled ${stale} stale invitations for student ${student_id} (already in alliance ${student.alliance_id})`);
      }
      return res.json([]);
    }
    
    const invitations = query(`
      SELECT 
        i.*,
        a.alliance_name,
        s.name as inviter_name
      FROM alliance_invitations i
      JOIN alliances a ON i.alliance_id = a.alliance_id
      JOIN students s ON i.inviter_student_id = s.student_id
      WHERE i.invited_student_id = ? AND i.status = 'pending'
      ORDER BY i.created_at DESC
    `, [student_id]);
    
    res.json(invitations);
  } catch (err) {
    console.error('Get invitations error:', err);
    res.status(500).json({ error: 'Failed to fetch invitations' });
  }
});

// Respond to Alliance Invitation
app.post('/api/alliance/respond-invitation', authenticateToken, (req, res) => {
  try {
    const { invitation_id, accept } = req.body;
    const student_id = req.user.id;
    
    // Get invitation
    const invitation = query(`
      SELECT * FROM alliance_invitations 
      WHERE invitation_id = ? AND invited_student_id = ?
    `, [invitation_id, student_id])[0];
    
    if (!invitation) {
      return res.status(404).json({ error: 'Invitation not found' });
    }
    
    if (invitation.status !== 'pending') {
      return res.status(400).json({ error: 'Invitation already responded to' });
    }
    
    // Check if student is already in an alliance
    const student = query('SELECT alliance_id, class_period FROM students WHERE student_id = ?', [student_id])[0];
    if (student.alliance_id) {
      return res.status(400).json({ error: 'You are already in an alliance' });
    }
    
    if (accept) {
      // Verify class period matches before accepting
      const alliance = query('SELECT class_period FROM alliances WHERE alliance_id = ?', [invitation.alliance_id])[0];
      if (alliance && alliance.class_period !== student.class_period) {
        // Cancel this invalid invitation
        run(`UPDATE alliance_invitations SET status = 'cancelled' WHERE invitation_id = ?`, [invitation_id]);
        return res.status(400).json({ error: 'Cannot join alliance from different class period' });
      }
      
      // Accept invitation - add student to alliance
      run('UPDATE students SET alliance_id = ? WHERE student_id = ?', 
          [invitation.alliance_id, student_id]);
      
      run(`UPDATE alliance_invitations 
           SET status = 'accepted', responded_at = CURRENT_TIMESTAMP 
           WHERE invitation_id = ?`, 
          [invitation_id]);
      
      // Cancel any other pending invitations for this student
      run(`UPDATE alliance_invitations 
           SET status = 'cancelled' 
           WHERE invited_student_id = ? AND status = 'pending' AND invitation_id != ?`,
          [student_id, invitation_id]);
      
      // Auto-remove ghosts if alliance now has 4+ real members
      const realCount = query(
        'SELECT COUNT(*) as count FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)',
        [invitation.alliance_id]
      )[0].count;
      
      if (realCount >= 4) {
        run('UPDATE students SET alliance_id = NULL WHERE alliance_id = ? AND is_ghost = 1', [invitation.alliance_id]);
        console.log(`👻 Auto-removed ghosts from alliance ${invitation.alliance_id} (now has ${realCount} real members)`);
      }
      
      saveDatabase();
      
      res.json({ success: true, message: 'You joined the alliance!' });
    } else {
      // Decline invitation
      run(`UPDATE alliance_invitations 
           SET status = 'declined', responded_at = CURRENT_TIMESTAMP 
           WHERE invitation_id = ?`, 
          [invitation_id]);
      
      res.json({ success: true, message: 'Invitation declined' });
    }
  } catch (err) {
    console.error('Respond invitation error:', err);
    res.status(500).json({ error: 'Failed to respond to invitation' });
  }
});

// Get students available to invite (same class period, not in any alliance) + ghost students
app.get('/api/alliance/available-students', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    
    // Get current student's class period and alliance
    const currentStudent = query('SELECT class_period, alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    
    // Get real students without an alliance, same class period
    const realStudents = query(`
      SELECT student_id, name, class_period, 0 as is_ghost 
      FROM students 
      WHERE alliance_id IS NULL 
        AND student_id != ?
        AND class_period = ?
        AND (is_ghost = 0 OR is_ghost IS NULL)
      ORDER BY name
    `, [student_id, currentStudent.class_period]);
    
    // Check if this alliance can invite ghosts (fewer than 4 real members, max 2 ghosts)
    let ghostStudents = [];
    if (currentStudent.alliance_id) {
      const realMemberCount = query(
        'SELECT COUNT(*) as count FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)',
        [currentStudent.alliance_id]
      )[0].count;
      
      const ghostMemberCount = query(
        'SELECT COUNT(*) as count FROM students WHERE alliance_id = ? AND is_ghost = 1',
        [currentStudent.alliance_id]
      )[0].count;
      
      const totalMemberCount = realMemberCount + ghostMemberCount;
      
      if (totalMemberCount < 4) {
        ghostStudents = query(`
          SELECT student_id, name, NULL as class_period, 1 as is_ghost
          FROM students
          WHERE is_ghost = 1 AND alliance_id IS NULL
          ORDER BY name
        `);
      }
    }
    
    res.json([...realStudents, ...ghostStudents]);
  } catch (err) {
    console.error('Get available students error:', err);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// ====================
// ALLIANCE ROUTES
// ====================

// Create Alliance
app.post('/api/alliance/create', authenticateToken, (req, res) => {
  try {
    const { alliance_name } = req.body;
    const student_id = req.user.id;
    
    // Check if student is already in an alliance
    const student = query('SELECT alliance_id, class_period FROM students WHERE student_id = ?', [student_id])[0];
    if (student.alliance_id) {
      return res.status(400).json({ error: 'Already in an alliance' });
    }
    
    // Check if alliance name already exists (must be unique across entire game)
    const existingAlliance = query('SELECT * FROM alliances WHERE alliance_name = ? AND is_disbanded = 0', [alliance_name]);
    if (existingAlliance.length > 0) {
      return res.status(400).json({ error: 'An alliance with this name already exists. Please choose a different name.' });
    }
    
    // Create alliance with empty buildings (must purchase Town Center)
    run('INSERT INTO alliances (alliance_name, class_period, buildings_owned) VALUES (?, ?, ?)', 
        [alliance_name, student.class_period, JSON.stringify([])]);
    
    // Get the newly created alliance by ID (not by name, to avoid confusion)
    const alliance = query('SELECT * FROM alliances WHERE alliance_name = ? AND class_period = ? ORDER BY alliance_id DESC LIMIT 1', 
        [alliance_name, student.class_period])[0];
    
    // Add student to alliance
    run('UPDATE students SET alliance_id = ? WHERE student_id = ?', 
        [alliance.alliance_id, student_id]);
    
    res.json({ success: true, alliance });
  } catch (err) {
    console.error('Create alliance error:', err);
    res.status(500).json({ error: 'Failed to create alliance' });
  }
});

// ====================
// PHASE 3: BUILDINGS & MARKET
// ====================

// Get all buildings for market display
app.get('/api/buildings', authenticateToken, (req, res) => {
  try {
    const buildings = query(`
      SELECT 
        b.*,
        pb.building_name as prerequisite_name
      FROM buildings_ref b
      LEFT JOIN buildings_ref pb ON b.prerequisite_building_id = pb.building_id
      ORDER BY b.building_id
    `);
    
    res.json(buildings);
  } catch (err) {
    console.error('Get buildings error:', err);
    res.status(500).json({ error: 'Failed to fetch buildings' });
  }
});

// Get alliance's owned buildings and purchase eligibility
app.get('/api/alliance/buildings/:alliance_id', authenticateToken, (req, res) => {
  try {
    const { alliance_id } = req.params;
    
    // Get alliance info
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    if (!alliance) {
      return res.status(404).json({ error: 'Alliance not found' });
    }
    
    const ownedBuildings = JSON.parse(alliance.buildings_owned || '[]');
    const currentAge = alliance.current_age || 'Archaic';
    
    // Get buildings available for current age (Archaic shows Archaic, Classical shows both, Heroic shows all)
    const allBuildings = query(`
      SELECT 
        b.*,
        pb.building_name as prerequisite_name
      FROM buildings_ref b
      LEFT JOIN buildings_ref pb ON b.prerequisite_building_id = pb.building_id
      WHERE b.age_available = ? 
        OR (? = 'Classical' AND b.age_available = 'Archaic')
        OR (? = 'Heroic' AND b.age_available IN ('Archaic', 'Classical'))
      ORDER BY b.age_available, b.building_id
    `, [currentAge, currentAge, currentAge]);
    
    // Get completed god assignments for this alliance - check BOTH god_assignments table AND grade_records for bonus assignments
    const godAssignmentsFromTable = query(
      'SELECT god_name FROM god_assignments WHERE alliance_id = ?', 
      [alliance_id]
    ).map(a => a.god_name);
    
    // Also check grade_records for completed bonus assignments (any alliance member)
    // IMPORTANT: Only count real (non-ghost) members for qualification requirements
    const allianceMembers = query('SELECT student_id, name FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)', [alliance_id]);
    const memberIds = allianceMembers.map(m => m.student_id);
    const memberCount = allianceMembers.length;
    
    let completedBonusGods = [];
    let bonusProgress = {}; // Track how many members completed each bonus
    
    if (memberIds.length > 0) {
      // Get distinct gods that ANY member has completed
      const bonusGrades = query(`
        SELECT DISTINCT ar.myth_god 
        FROM grade_records gr
        JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
        WHERE gr.student_id IN (${memberIds.join(',')}) 
          AND ar.section = 'bonus' 
          AND gr.points_earned > 0
      `);
      completedBonusGods = bonusGrades.map(g => g.myth_god);
      
      // Get count of members who completed each bonus god
      const bonusCountQuery = query(`
        SELECT ar.myth_god, COUNT(DISTINCT gr.student_id) as completed_count
        FROM grade_records gr
        JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
        WHERE gr.student_id IN (${memberIds.join(',')}) 
          AND ar.section = 'bonus' 
          AND gr.points_earned > 0
        GROUP BY ar.myth_god
      `);
      bonusCountQuery.forEach(row => {
        bonusProgress[row.myth_god] = row.completed_count;
      });
    }
    
    // Combine both sources
    const completedAssignments = [...new Set([...godAssignmentsFromTable, ...completedBonusGods])];
    console.log('Completed god assignments for alliance', alliance_id, ':', completedAssignments);
    console.log('Bonus progress:', bonusProgress);
    
    // Check if any member has completed Prometheus AND Zeus assignments (for Town Center)
    let hasTownCenterRequirement = false;
    for (const member of allianceMembers) {
      const prometheusGrade = query(`
        SELECT gr.* FROM grade_records gr
        JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
        WHERE gr.student_id = ? AND ar.myth_god = 'Prometheus' AND gr.points_earned > 0
      `, [member.student_id]);
      
      const zeusGrade = query(`
        SELECT gr.* FROM grade_records gr
        JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
        WHERE gr.student_id = ? AND ar.myth_god = 'Zeus' AND gr.points_earned > 0
      `, [member.student_id]);
      
      if (prometheusGrade.length > 0 && zeusGrade.length > 0) {
        hasTownCenterRequirement = true;
        break;
      }
    }
    
    // Check for alliance technologies (Pickaxe = -10% building cost)
    let allianceTechs = [];
    try {
      allianceTechs = query(
        'SELECT tech_name FROM alliance_technologies WHERE alliance_id = ?',
        [alliance_id]
      ).map(t => t.tech_name);
    } catch (techErr) {
      console.log('Note: alliance_technologies table may not exist yet');
      allianceTechs = [];
    }
    
    const hasPickaxe = allianceTechs.includes('Pickaxe');
    const hasGranaryUnlock = allianceTechs.includes('Granary'); // Demeter side quest completed
    
    // Calculate eligibility for each building
    const buildingsWithEligibility = allBuildings.map(building => {
      const owned = ownedBuildings.filter(b => b === building.building_name).length;
      
      // Apply Pickaxe discount (-10% on all building costs)
      const baseCost = building.cost_points;
      const effectiveCost = hasPickaxe ? Math.floor(baseCost * 0.9) : baseCost;
      
      const canAfford = alliance.total_points >= effectiveCost;
      const hasPrerequisite = !building.prerequisite_building_id || 
        ownedBuildings.includes(building.prerequisite_name);
      
      // Special handling for different buildings
      let hasGodAssignment = true;
      let specialRequirement = null;
      let bonusCompletedCount = 0;
      
      if (building.building_name === 'Town Center') {
        // Town Center requires Prometheus + Zeus grades
        hasGodAssignment = hasTownCenterRequirement;
        if (!hasGodAssignment) {
          specialRequirement = 'Requires Prometheus & Zeus assignments';
        }
      } else if (building.building_name === 'Granary') {
        // Granary requires Demeter Side Quest completion
        hasGodAssignment = hasGranaryUnlock;
        if (!hasGodAssignment) {
          specialRequirement = 'Requires Demeter Side Quest';
        }
      } else if (building.requires_god_assignment) {
        // Normal god assignment requirement - needs ALL members to complete the bonus
        bonusCompletedCount = bonusProgress[building.god_associated] || 0;
        hasGodAssignment = bonusCompletedCount >= memberCount; // ALL members must complete
      }
      
      const underMaxLimit = owned < building.max_per_alliance;
      
      return {
        ...building,
        owned_count: owned,
        can_afford: canAfford,
        has_prerequisite: hasPrerequisite,
        has_god_assignment: hasGodAssignment,
        under_max_limit: underMaxLimit,
        can_purchase: canAfford && hasPrerequisite && hasGodAssignment && underMaxLimit,
        base_cost: baseCost,
        effective_cost: effectiveCost,
        has_discount: hasPickaxe,
        bonus_completed_count: bonusCompletedCount,
        member_count: memberCount,
        reason_cannot_purchase: specialRequirement ? specialRequirement :
          !canAfford ? 'Not enough points' :
          !hasPrerequisite ? `Requires ${building.prerequisite_name}` :
          !hasGodAssignment ? `${building.god_associated} Bonus: ${bonusCompletedCount}/${memberCount} members` :
          !underMaxLimit ? `Maximum ${building.max_per_alliance} allowed` : null
      };
    });
    
    res.json({
      alliance_points: alliance.total_points,
      owned_buildings: ownedBuildings,
      completed_assignments: completedAssignments,
      alliance_technologies: allianceTechs,
      member_count: memberCount,
      current_age: currentAge,
      buildings: buildingsWithEligibility
    });
  } catch (err) {
    console.error('Get alliance buildings error:', err);
    console.error('Error stack:', err.stack);
    res.status(500).json({ error: 'Failed to fetch alliance buildings: ' + err.message });
  }
});

// Purchase a building
app.post('/api/alliance/purchase-building', authenticateToken, (req, res) => {
  try {
    const { building_id } = req.body;
    const student_id = req.user.id;
    
    // Get student's alliance and map status
    const student = query('SELECT alliance_id, map_image FROM students WHERE student_id = ?', [student_id])[0];
    if (!student || !student.alliance_id) {
      return res.status(400).json({ error: 'You must be in an alliance to purchase buildings' });
    }
    
    // Check if student has uploaded a map
    if (!student.map_image) {
      return res.status(400).json({ error: 'You must upload your civilization map before purchasing buildings. Click "Upload Map" to get started!' });
    }
    
    const alliance_id = student.alliance_id;
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    const ownedBuildings = JSON.parse(alliance.buildings_owned || '[]');
    
    // Check for Pickaxe technology (-10% building cost)
    const allianceTechs = query(
      'SELECT tech_name FROM alliance_technologies WHERE alliance_id = ?',
      [alliance_id]
    ).map(t => t.tech_name);
    const hasPickaxe = allianceTechs.includes('Pickaxe');
    
    // Get building info
    const building = query(`
      SELECT b.*, pb.building_name as prerequisite_name
      FROM buildings_ref b
      LEFT JOIN buildings_ref pb ON b.prerequisite_building_id = pb.building_id
      WHERE b.building_id = ?
    `, [building_id])[0];
    
    if (!building) {
      return res.status(404).json({ error: 'Building not found' });
    }
    
    // Check if building is available for alliance's current age
    const currentAge = alliance.current_age || 'Archaic';
    const ageAllowed = building.age_available === currentAge 
      || (currentAge === 'Classical' && building.age_available === 'Archaic')
      || (currentAge === 'Heroic' && (building.age_available === 'Archaic' || building.age_available === 'Classical'));
    if (!ageAllowed) {
      return res.status(400).json({ error: `This building requires ${building.age_available} Age` });
    }
    
    // Calculate effective cost with Pickaxe discount
    const effectiveCost = hasPickaxe ? Math.floor(building.cost_points * 0.9) : building.cost_points;
    
    // Check all requirements
    const owned = ownedBuildings.filter(b => b === building.building_name).length;
    
    if (alliance.total_points < effectiveCost) {
      return res.status(400).json({ error: 'Not enough points' });
    }
    
    if (building.prerequisite_building_id && !ownedBuildings.includes(building.prerequisite_name)) {
      return res.status(400).json({ error: `Requires ${building.prerequisite_name} first` });
    }
    
    // Special handling for Granary (requires Demeter Side Quest)
    if (building.building_name === 'Granary') {
      const hasGranaryUnlock = allianceTechs.includes('Granary');
      if (!hasGranaryUnlock) {
        return res.status(400).json({ error: 'Requires Demeter Side Quest completion' });
      }
    } else if (building.building_name === 'Gate of Erebus') {
      // Requires ALL members of the alliance to have completed Orpheus:
      //   1. Reading Guide (comp_conn graded for Orpheus in classical section)
      //   2. Quiz passed (myth_quiz_attempts portal_id = 3, passed = 1)
      //   3. Writing assignment approved (student_myth_completion portal_id = 3, teacher_approved = 1)
      const allianceMembers = query('SELECT student_id FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)', [alliance_id]);
      if (allianceMembers.length === 0) {
        return res.status(400).json({ error: 'No alliance members found' });
      }
      for (const member of allianceMembers) {
        const sid = member.student_id;
        // 1. Reading Guide: comp_conn graded for Orpheus in classical section
        const hasReadingGuide = query(
          `SELECT 1 FROM grade_records gr
           JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
           WHERE gr.student_id = ? AND ar.assignment_type = 'comp_conn' 
           AND ar.myth_god = 'Orpheus' AND ar.section = 'classical' AND gr.points_earned > 0 LIMIT 1`,
          [sid]
        );
        if (!hasReadingGuide.length) {
          const memberInfo = query('SELECT name FROM students WHERE student_id = ?', [sid])[0];
          return res.status(400).json({ 
            error: `Gate of Erebus requires all members to complete Orpheus. ${memberInfo ? memberInfo.name : 'A member'} has not submitted the Orpheus Reading Guide.`
          });
        }
        // 2. Quiz passed (portal_id = 3 is Orpheus)
        const quizPassed = query(
          'SELECT 1 FROM myth_quiz_attempts WHERE student_id = ? AND portal_id = 3 AND passed = 1 LIMIT 1',
          [sid]
        );
        if (!quizPassed.length) {
          const memberInfo = query('SELECT name FROM students WHERE student_id = ?', [sid])[0];
          return res.status(400).json({ 
            error: `Gate of Erebus requires all members to complete Orpheus. ${memberInfo ? memberInfo.name : 'A member'} has not passed the Orpheus quiz.`
          });
        }
        // 3. Writing assignment teacher-approved (portal_id = 3)
        const writingApproved = query(
          'SELECT 1 FROM student_myth_completion WHERE student_id = ? AND portal_id = 3 AND teacher_approved = 1 LIMIT 1',
          [sid]
        );
        if (!writingApproved.length) {
          const memberInfo = query('SELECT name FROM students WHERE student_id = ?', [sid])[0];
          return res.status(400).json({ 
            error: `Gate of Erebus requires all members to complete Orpheus. ${memberInfo ? memberInfo.name : 'A member'} has not had their Orpheus writing approved.`
          });
        }
      }
    } else if (building.requires_god_assignment) {
      const hasAssignment = query(
        'SELECT * FROM god_assignments WHERE alliance_id = ? AND god_name = ?',
        [alliance_id, building.god_associated]
      );
      if (hasAssignment.length === 0) {
        return res.status(400).json({ error: `Requires ${building.god_associated} assignment completion` });
      }
    }
    
    if (owned >= building.max_per_alliance) {
      return res.status(400).json({ error: `Maximum ${building.max_per_alliance} ${building.building_name}(s) allowed` });
    }
    
    // Purchase the building
    ownedBuildings.push(building.building_name);
    
    // Deduct points (using effective cost with discount) and update buildings
    run('UPDATE alliances SET total_points = total_points - ?, buildings_owned = ? WHERE alliance_id = ?',
        [effectiveCost, JSON.stringify(ownedBuildings), alliance_id]);
    
    // Log transaction (student_id = NULL so it's an alliance transaction, not personal)
    // This prevents building purchases from affecting personal contribution tracking
    const discountNote = hasPickaxe ? ' (10% Pickaxe discount applied)' : '';
    run(`INSERT INTO point_transactions (alliance_id, student_id, amount, category, reason)
         VALUES (?, NULL, ?, ?, ?)`,
        [alliance_id, -effectiveCost, 'Building Purchase', `Purchased ${building.building_name} (by ${req.user.name})${discountNote}`]);
    
    // Create activation record for this building (starts as ready to activate)
    const instanceNum = owned + 1;
    run(`INSERT INTO building_activations (alliance_id, building_name, building_instance)
         VALUES (?, ?, ?)`,
        [alliance_id, building.building_name, instanceNum]);
    
    // Special: Harbor of the Argo grants +1 Reverse Card on purchase
    let reverseCardBonus = false;
    if (building.building_name === 'Harbor of the Argo') {
      run('UPDATE alliances SET reverse_cards = COALESCE(reverse_cards, 0) + 1 WHERE alliance_id = ?', [alliance_id]);
      reverseCardBonus = true;
      console.log(`🔄 Harbor of the Argo: +1 Reverse Card awarded to alliance ${alliance_id}`);
    }
    
    res.json({ 
      success: true, 
      message: `Purchased ${building.building_name} for ${effectiveCost} points${hasPickaxe ? ' (10% discount!)' : ''}${reverseCardBonus ? ' +1 Reverse Card!' : ''}`,
      new_balance: alliance.total_points - effectiveCost,
      buildings_owned: ownedBuildings,
      reverseCardBonus
    });
  } catch (err) {
    console.error('Purchase building error:', err);
    res.status(500).json({ error: 'Failed to purchase building' });
  }
});

// Student: Sell back a building (-10% fee from original cost_points, same-age only, no Transport Ship)
app.post('/api/alliance/sell-building', authenticateToken, (req, res) => {
  try {
    const { building_name } = req.body;
    const student_id = req.user.id;

    if (!building_name) {
      return res.status(400).json({ error: 'building_name required' });
    }

    // Cannot sell Transport Ship
    if (building_name === 'Transport Ship') {
      return res.status(400).json({ error: 'Transport Ship cannot be sold back' });
    }

    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    if (!student || !student.alliance_id) {
      return res.status(400).json({ error: 'You must be in an alliance to sell buildings' });
    }
    const alliance_id = student.alliance_id;

    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    if (!alliance) return res.status(404).json({ error: 'Alliance not found' });

    const currentAge = alliance.current_age || 'Archaic';
    const ownedBuildings = JSON.parse(alliance.buildings_owned || '[]');

    // Check that the alliance actually owns at least one of this building
    if (!ownedBuildings.includes(building_name)) {
      return res.status(400).json({ error: `Your alliance does not own a ${building_name}` });
    }

    // Get building definition
    const building = query('SELECT * FROM buildings_ref WHERE building_name = ?', [building_name])[0];
    if (!building) return res.status(404).json({ error: 'Building not found in reference data' });

    // Can only sell buildings from current age or earlier (not future ages)
    const ageOrder = ['Archaic', 'Classical', 'Heroic'];
    const currentAgeIdx = ageOrder.indexOf(currentAge);
    const buildingAgeIdx = ageOrder.indexOf(building.age_available);
    if (buildingAgeIdx > currentAgeIdx) {
      return res.status(400).json({ 
        error: `You can only sell buildings from your current age or earlier. ${building_name} is a ${building.age_available} Age building.`
      });
    }

    // Refund = 90% of original cost_points (not discounted effectiveCost)
    const refundAmount = Math.floor(building.cost_points * 0.9);

    // Remove one instance of the building from buildings_owned array
    const idx = ownedBuildings.indexOf(building_name);
    ownedBuildings.splice(idx, 1);

    // Delete one building_activations record (the most recently inserted for this building+alliance)
    const activation = query(
      'SELECT activation_id FROM building_activations WHERE alliance_id = ? AND building_name = ? ORDER BY activation_id DESC LIMIT 1',
      [alliance_id, building_name]
    )[0];
    if (activation) {
      run('DELETE FROM building_activations WHERE activation_id = ?', [activation.activation_id]);
    }

    // Return points and update buildings_owned
    run('UPDATE alliances SET total_points = total_points + ?, buildings_owned = ? WHERE alliance_id = ?',
        [refundAmount, JSON.stringify(ownedBuildings), alliance_id]);

    // Log transaction
    run(`INSERT INTO point_transactions (alliance_id, student_id, amount, category, reason) VALUES (?, NULL, ?, ?, ?)`,
        [alliance_id, refundAmount, 'Building Sellback', `Sold back ${building_name} for ${refundAmount} pts (by ${req.user.name})`]);

    saveDatabase();
    console.log(`🏦 Sell-back: ${req.user.name} sold ${building_name} for ${refundAmount} pts (alliance ${alliance_id})`);

    res.json({
      success: true,
      message: `Sold ${building_name} for ${refundAmount} points`,
      refund_amount: refundAmount,
      new_balance: alliance.total_points + refundAmount,
      buildings_owned: ownedBuildings
    });
  } catch (err) {
    console.error('Sell building error:', err);
    res.status(500).json({ error: 'Failed to sell building' });
  }
});


app.get('/api/teacher/eligible-alliances-for-god-bonus', authenticateToken, (req, res) => {
  try {
    const { god_name } = req.query;
    
    if (!god_name) {
      return res.status(400).json({ error: 'god_name required' });
    }
    
    // Find the bonus assignment for this god
    const bonusAssignment = query(
      "SELECT * FROM assignments_ref WHERE section = 'bonus' AND myth_god = ? AND age = 'Archaic'",
      [god_name]
    )[0];
    
    if (!bonusAssignment) {
      return res.status(404).json({ error: `No bonus assignment found for ${god_name}` });
    }
    
    const threshold = 1; // Any points earned counts as complete
    
    // Get all active alliances with member counts (only real members, not ghosts)
    const alliances = query(`
      SELECT a.alliance_id, a.alliance_name, a.class_period,
             COUNT(s.student_id) as member_count
      FROM alliances a
      JOIN students s ON a.alliance_id = s.alliance_id AND (s.is_ghost = 0 OR s.is_ghost IS NULL)
      WHERE a.is_disbanded = 0
      GROUP BY a.alliance_id
    `);
    
    const eligibleAlliances = [];
    
    for (const alliance of alliances) {
      // Check if already granted
      const alreadyGranted = query(
        'SELECT * FROM god_assignments WHERE alliance_id = ? AND god_name = ?',
        [alliance.alliance_id, god_name]
      ).length > 0;
      
      if (alreadyGranted) continue;
      
      // Count members who earned any points on this god's bonus
      const qualifiedCount = query(`
        SELECT COUNT(DISTINCT gr.student_id) as count
        FROM grade_records gr
        JOIN students s ON gr.student_id = s.student_id
        WHERE s.alliance_id = ? AND gr.assignment_id = ? AND gr.points_earned >= ?
      `, [alliance.alliance_id, bonusAssignment.assignment_id, threshold])[0].count;
      
      if (qualifiedCount >= alliance.member_count) {
        eligibleAlliances.push({
          alliance_id: alliance.alliance_id,
          alliance_name: alliance.alliance_name,
          class_period: alliance.class_period,
          member_count: alliance.member_count,
          qualified_count: qualifiedCount
        });
      }
    }
    
    res.json({
      god_name,
      bonus_assignment: bonusAssignment.display_name,
      threshold: `Any points (${bonusAssignment.max_points} max)`,
      eligible_alliances: eligibleAlliances
    });
  } catch (err) {
    console.error('Eligible alliances for god bonus error:', err);
    res.status(500).json({ error: 'Failed to fetch eligible alliances' });
  }
});

// Teacher: Grant god assignment completion to an alliance
app.post('/api/teacher/grant-god-assignment', authenticateToken, (req, res) => {
  try {
    const { alliance_id, god_name } = req.body;
    const teacher_id = req.user.id;
    
    // Check if already granted
    const existing = query(
      'SELECT * FROM god_assignments WHERE alliance_id = ? AND god_name = ?',
      [alliance_id, god_name]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ error: `${god_name} assignment already completed for this alliance` });
    }
    
    run(`INSERT INTO god_assignments (alliance_id, god_name, completed_by_teacher_id) VALUES (?, ?, ?)`,
        [alliance_id, god_name, teacher_id]);
    
    saveDatabase();
    
    // Get alliance name for response
    const alliance = query('SELECT alliance_name FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    
    res.json({ 
      success: true, 
      message: `${god_name} assignment granted to ${alliance.alliance_name}` 
    });
  } catch (err) {
    console.error('Grant god assignment error:', err);
    res.status(500).json({ error: 'Failed to grant god assignment' });
  }
});

// Teacher: Remove god assignment from an alliance
app.post('/api/teacher/revoke-god-assignment', authenticateToken, (req, res) => {
  try {
    const { alliance_id, god_name } = req.body;
    
    run('DELETE FROM god_assignments WHERE alliance_id = ? AND god_name = ?',
        [alliance_id, god_name]);
    
    res.json({ success: true, message: `${god_name} assignment revoked` });
  } catch (err) {
    console.error('Revoke god assignment error:', err);
    res.status(500).json({ error: 'Failed to revoke god assignment' });
  }
});

// Teacher: Get all god assignments
app.get('/api/teacher/god-assignments', authenticateToken, (req, res) => {
  try {
    const assignments = query(`
      SELECT 
        ga.*,
        a.alliance_name
      FROM god_assignments ga
      JOIN alliances a ON ga.alliance_id = a.alliance_id
      ORDER BY a.alliance_name, ga.god_name
    `);
    
    res.json(assignments);
  } catch (err) {
    console.error('Get god assignments error:', err);
    res.status(500).json({ error: 'Failed to fetch god assignments' });
  }
});

// ====================
// BUILDING REQUESTS (Hybrid System)
// ====================

// Student: Request a building that requires god assignment
app.post('/api/student/request-building', authenticateToken, (req, res) => {
  try {
    const { building_id } = req.body;
    const student_id = req.user.id;
    
    // Get student's alliance
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    if (!student || !student.alliance_id) {
      return res.status(400).json({ error: 'You must be in an alliance to request buildings' });
    }
    
    // Get building info
    const building = query('SELECT * FROM buildings_ref WHERE building_id = ?', [building_id])[0];
    if (!building) {
      return res.status(404).json({ error: 'Building not found' });
    }
    
    // Check if building requires god assignment
    if (!building.requires_god_assignment) {
      return res.status(400).json({ error: 'This building does not require a request. You can purchase it directly.' });
    }
    
    // Check if already have god assignment (can purchase directly)
    const hasAssignment = query(
      'SELECT * FROM god_assignments WHERE alliance_id = ? AND god_name = ?',
      [student.alliance_id, building.god_associated]
    );
    if (hasAssignment.length > 0) {
      return res.status(400).json({ error: 'Your alliance already has this god assignment. You can purchase directly.' });
    }
    
    // Check for existing pending request
    const existingRequest = query(
      'SELECT * FROM building_requests WHERE alliance_id = ? AND building_id = ? AND status = ?',
      [student.alliance_id, building_id, 'pending']
    );
    if (existingRequest.length > 0) {
      return res.status(400).json({ error: 'A request for this building is already pending' });
    }
    
    // Create request
    run(`INSERT INTO building_requests (alliance_id, building_id, requested_by_student_id, status)
         VALUES (?, ?, ?, 'pending')`,
        [student.alliance_id, building_id, student_id]);
    
    res.json({ success: true, message: `Request submitted for ${building.building_name}. Waiting for teacher approval.` });
  } catch (err) {
    console.error('Request building error:', err);
    res.status(500).json({ error: 'Failed to request building' });
  }
});

// Student: Get my alliance's building requests
app.get('/api/student/building-requests', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    
    if (!student || !student.alliance_id) {
      return res.json([]);
    }
    
    const requests = query(`
      SELECT 
        br.*,
        b.building_name,
        b.god_associated,
        b.cost_points
      FROM building_requests br
      JOIN buildings_ref b ON br.building_id = b.building_id
      WHERE br.alliance_id = ?
      ORDER BY br.requested_at DESC
    `, [student.alliance_id]);
    
    res.json(requests);
  } catch (err) {
    console.error('Get building requests error:', err);
    res.status(500).json({ error: 'Failed to fetch building requests' });
  }
});

// Teacher: Get all pending building requests
app.get('/api/teacher/building-requests', authenticateToken, (req, res) => {
  try {
    const requests = query(`
      SELECT 
        br.*,
        b.building_name,
        b.god_associated,
        b.cost_points,
        b.requires_god_assignment,
        a.alliance_name,
        a.total_points,
        a.class_period,
        s.name as requested_by_name
      FROM building_requests br
      JOIN buildings_ref b ON br.building_id = b.building_id
      JOIN alliances a ON br.alliance_id = a.alliance_id
      JOIN students s ON br.requested_by_student_id = s.student_id
      WHERE br.status = 'pending'
      ORDER BY br.requested_at ASC
    `);
    
    res.json(requests);
  } catch (err) {
    console.error('Get building requests error:', err);
    res.status(500).json({ error: 'Failed to fetch building requests' });
  }
});

// Teacher: Approve building request (grants god assignment + purchases building)
app.post('/api/teacher/approve-building-request', authenticateToken, (req, res) => {
  try {
    const { request_id } = req.body;
    const teacher_id = req.user.id;
    
    // Get request
    const request = query(`
      SELECT br.*, b.*, a.total_points, a.buildings_owned
      FROM building_requests br
      JOIN buildings_ref b ON br.building_id = b.building_id
      JOIN alliances a ON br.alliance_id = a.alliance_id
      WHERE br.request_id = ?
    `, [request_id])[0];
    
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request already reviewed' });
    }
    
    // Check if alliance can afford
    if (request.total_points < request.cost_points) {
      return res.status(400).json({ error: `Alliance cannot afford this building. Needs ${request.cost_points} pts, has ${request.total_points} pts.` });
    }
    
    // Check prerequisites
    const ownedBuildings = JSON.parse(request.buildings_owned || '[]');
    if (request.prerequisite_building_id) {
      const prereq = query('SELECT building_name FROM buildings_ref WHERE building_id = ?', [request.prerequisite_building_id])[0];
      if (!ownedBuildings.includes(prereq.building_name)) {
        return res.status(400).json({ error: `Alliance needs ${prereq.building_name} first` });
      }
    }
    
    // Grant god assignment
    const existingAssignment = query(
      'SELECT * FROM god_assignments WHERE alliance_id = ? AND god_name = ?',
      [request.alliance_id, request.god_associated]
    );
    if (existingAssignment.length === 0) {
      run(`INSERT INTO god_assignments (alliance_id, god_name, completed_by_teacher_id)
           VALUES (?, ?, ?)`,
          [request.alliance_id, request.god_associated, teacher_id]);
    }
    
    // Purchase building
    ownedBuildings.push(request.building_name);
    run('UPDATE alliances SET total_points = total_points - ?, buildings_owned = ? WHERE alliance_id = ?',
        [request.cost_points, JSON.stringify(ownedBuildings), request.alliance_id]);
    
    // Log transaction
    run(`INSERT INTO point_transactions (alliance_id, student_id, amount, category, reason, teacher_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [request.alliance_id, request.requested_by_student_id, -request.cost_points, 'Building Purchase', 
         `Purchased ${request.building_name} (approved request)`, teacher_id]);
    
    // Create activation record
    const owned = ownedBuildings.filter(b => b === request.building_name).length;
    run(`INSERT INTO building_activations (alliance_id, building_name, building_instance)
         VALUES (?, ?, ?)`,
        [request.alliance_id, request.building_name, owned]);
    
    // Update request status
    run(`UPDATE building_requests SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by_teacher_id = ?
         WHERE request_id = ?`,
        [teacher_id, request_id]);
    
    res.json({ 
      success: true, 
      message: `Approved! ${request.god_associated} assignment granted and ${request.building_name} purchased.`
    });
  } catch (err) {
    console.error('Approve building request error:', err);
    res.status(500).json({ error: 'Failed to approve request' });
  }
});

// Teacher: Reject building request
app.post('/api/teacher/reject-building-request', authenticateToken, (req, res) => {
  try {
    const { request_id, teacher_notes } = req.body;
    const teacher_id = req.user.id;
    
    const request = query('SELECT * FROM building_requests WHERE request_id = ?', [request_id])[0];
    if (!request) {
      return res.status(404).json({ error: 'Request not found' });
    }
    
    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Request already reviewed' });
    }
    
    run(`UPDATE building_requests 
         SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP, reviewed_by_teacher_id = ?, teacher_notes = ?
         WHERE request_id = ?`,
        [teacher_id, teacher_notes || 'Complete the required extra credit first', request_id]);
    
    res.json({ success: true, message: 'Request rejected' });
  } catch (err) {
    console.error('Reject building request error:', err);
    res.status(500).json({ error: 'Failed to reject request' });
  }
});

// ====================
// AGE PROGRESSION SYSTEM
// ====================

// Helper: Ensure age gate record exists for a period
function ensureAgeGate(class_period) {
  const existing = query('SELECT * FROM age_gates WHERE class_period = ?', [class_period]);
  if (existing.length === 0) {
    run('INSERT INTO age_gates (class_period) VALUES (?)', [class_period]);
  }
}

// Helper: Calculate age readiness for an alliance
function calculateAgeReadiness(alliance) {
  const ownedBuildings = JSON.parse(alliance.buildings_owned || '[]');
  const memberCount = query('SELECT COUNT(*) as count FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)', [alliance.alliance_id])[0].count;
  const currentAge = alliance.current_age || 'Archaic';
  
  let requiredBuildings, pointsThreshold;
  
  if (currentAge === 'Classical' || currentAge === 'Heroic') {
    // Classical → Heroic requirements: 8 of 11 buildings, reduced point thresholds
    requiredBuildings = ['Town Center', 'Library', 'House', 'Dock', 'Fishing Ship', 'Wooden Wall', 'Transport Ship', 'Armory', 'Theater', 'Agora', 'Oracle'];
    requiredBuildingCount = 8; // need any 8 of 11
    pointsThreshold = memberCount === 1 ? 150 : memberCount === 2 ? 300 : memberCount === 3 ? 450 : 600;
  } else {
    // Archaic → Classical requirements
    requiredBuildings = ['Town Center', 'Library', 'House', 'Dock', 'Fishing Ship', 'Wooden Wall'];
    requiredBuildingCount = 6; // need all 6
    pointsThreshold = memberCount === 1 ? 100 : memberCount === 2 ? 200 : memberCount === 3 ? 300 : 400;
  }
  
  const ownedRequired = requiredBuildings.filter(b => ownedBuildings.includes(b));
  
  // Map check: count how many non-ghost members have uploaded maps
  const membersWithMap = query(
    'SELECT COUNT(*) as count FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL) AND map_image IS NOT NULL AND map_image != ""',
    [alliance.alliance_id]
  )[0].count;
  const allMapsUploaded = membersWithMap >= memberCount && memberCount > 0;
  
  // Respect teacher's manual override: if civilization_map_complete is already 1, keep it.
  // Only auto-MARK when all students upload maps, never auto-UNMARK a teacher override.
  const mapManuallyMarked = alliance.civilization_map_complete === 1;
  const allMapsComplete = mapManuallyMarked || allMapsUploaded;
  
  // Auto-mark if all students uploaded (but never auto-unmark)
  if (allMapsUploaded && !alliance.civilization_map_complete) {
    run('UPDATE alliances SET civilization_map_complete = 1 WHERE alliance_id = ?', [alliance.alliance_id]);
  }
  
  // Calculate progress
  const buildingsProgress = (ownedRequired.length / requiredBuildingCount) * 100;
  const pointsProgress = Math.min(100, (alliance.total_points / pointsThreshold) * 100);
  const mapProgress = allMapsComplete ? 100 : (memberCount > 0 ? (membersWithMap / memberCount) * 100 : 0);
  
  // Virtue check for Classical → Heroic: every non-ghost member needs all 7 virtues
  let virtuesMet = true;
  let lowestVirtueCount = 7;
  let memberVirtues = [];
  if (currentAge === 'Classical') {
    const members = query('SELECT student_id, name FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)', [alliance.alliance_id]);
    members.forEach(m => {
      const vc = query('SELECT COUNT(*) as cnt FROM student_myth_completion WHERE student_id = ? AND virtue_claimed = 1', [m.student_id])[0].cnt;
      memberVirtues.push({ student_id: m.student_id, name: m.name, virtues: vc });
      if (vc < 7) virtuesMet = false;
      if (vc < lowestVirtueCount) lowestVirtueCount = vc;
    });
  }
  
  // Overall progress (weighted: buildings 35%, points 25%, maps 15%, virtues 25% for Classical→Heroic)
  let overallProgress;
  if (currentAge === 'Classical') {
    const virtueProgress = (lowestVirtueCount / 7) * 100;
    overallProgress = (buildingsProgress * 0.35 + pointsProgress * 0.25 + mapProgress * 0.15 + virtueProgress * 0.25);
  } else {
    overallProgress = (buildingsProgress * 0.45 + pointsProgress * 0.35 + mapProgress * 0.20);
  }
  
  const baseReady = ownedRequired.length >= requiredBuildingCount &&
                  alliance.total_points >= pointsThreshold &&
                  allMapsComplete;
  
  // For Classical → Heroic, also require all virtues
  const isReady = currentAge === 'Classical' ? (baseReady && virtuesMet) : baseReady;
  
  return {
    currentAge,
    memberCount,
    pointsThreshold,
    pointsHave: alliance.total_points,
    pointsMet: alliance.total_points >= pointsThreshold,
    requiredBuildings,
    requiredBuildingCount,
    ownedRequired,
    buildingsMet: ownedRequired.length >= requiredBuildingCount,
    mapComplete: allMapsComplete,
    mapsSubmitted: membersWithMap,
    mapsRequired: memberCount,
    riteComplete: alliance.rite_of_passage_complete === 1,
    virtuesMet,
    lowestVirtueCount,
    memberVirtues,
    overallProgress: Math.round(overallProgress),
    isReady
  };
}

// Student: Get age progress for their alliance
app.get('/api/student/age-progress', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const student = query('SELECT alliance_id, class_period FROM students WHERE student_id = ?', [student_id])[0];
    
    if (!student || !student.alliance_id) {
      return res.json({ error: 'Not in an alliance', hasAlliance: false });
    }
    
    let alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [student.alliance_id])[0];
    if (!alliance) {
      return res.json({ error: 'Alliance not found', hasAlliance: false });
    }
    
    // Check if ALL non-ghost alliance members have uploaded maps
    if (!alliance.civilization_map_complete) {
      const totalNonGhost = query(
        'SELECT COUNT(*) as count FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)',
        [student.alliance_id]
      )[0].count;
      const membersWithMap = query(
        'SELECT COUNT(*) as count FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL) AND map_image IS NOT NULL AND map_image != ""',
        [student.alliance_id]
      )[0].count;
      
      if (membersWithMap >= totalNonGhost && totalNonGhost > 0) {
        run('UPDATE alliances SET civilization_map_complete = 1 WHERE alliance_id = ?', [student.alliance_id]);
        saveDatabase();
        alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [student.alliance_id])[0];
        console.log('Auto-marked civilization_map_complete for alliance:', student.alliance_id, `(${membersWithMap}/${totalNonGhost} maps)`);
      }
    }
    
    // Get age gate status for this period
    ensureAgeGate(student.class_period);
    const ageGate = query('SELECT * FROM age_gates WHERE class_period = ?', [student.class_period])[0];
    
    const readiness = calculateAgeReadiness(alliance);
    
    // Auto-advance if ready and gate is open (handles case where gate opened before alliance was ready)
    if (readiness.isReady && alliance.current_age === 'Archaic' && ageGate.classical_unlocked === 1) {
      run('UPDATE alliances SET current_age = ? WHERE alliance_id = ?', ['Classical', alliance.alliance_id]);
      alliance.current_age = 'Classical';
      saveDatabase();
      console.log(`Auto-advanced alliance ${alliance.alliance_id} (${alliance.alliance_name}) to Classical Age via age-progress poll`);
    } else if (readiness.isReady && alliance.current_age === 'Classical' && ageGate.heroic_unlocked === 1) {
      run('UPDATE alliances SET current_age = ? WHERE alliance_id = ?', ['Heroic', alliance.alliance_id]);
      alliance.current_age = 'Heroic';
      saveDatabase();
      console.log(`Auto-advanced alliance ${alliance.alliance_id} (${alliance.alliance_name}) to Heroic Age via age-progress poll`);
    }
    
    res.json({
      hasAlliance: true,
      currentAge: alliance.current_age,
      nextAge: alliance.current_age === 'Archaic' ? 'Classical' : alliance.current_age === 'Classical' ? 'Heroic' : null,
      gateOpen: alliance.current_age === 'Archaic' ? ageGate.classical_unlocked === 1 : 
                alliance.current_age === 'Classical' ? ageGate.heroic_unlocked === 1 : false,
      currentPoints: alliance.total_points,
      readiness,
      canAdvance: readiness.isReady && (
        (alliance.current_age === 'Archaic' && ageGate.classical_unlocked === 1) ||
        (alliance.current_age === 'Classical' && ageGate.heroic_unlocked === 1)
      )
    });
  } catch (err) {
    console.error('Get age progress error:', err);
    res.status(500).json({ error: 'Failed to fetch age progress' });
  }
});

// Student: Get available buildings for purchase (for map sidebar)
app.get('/api/student/available-buildings', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    
    if (!student || !student.alliance_id) {
      return res.json({ buildings: [], alliancePoints: 0, error: 'Not in an alliance' });
    }
    
    const alliance = query('SELECT total_points, buildings_owned, current_age FROM alliances WHERE alliance_id = ?', [student.alliance_id])[0];
    if (!alliance) {
      return res.json({ buildings: [], alliancePoints: 0, error: 'Alliance not found' });
    }
    
    const buildingsOwned = JSON.parse(alliance.buildings_owned || '[]');
    
    // Get all available buildings for current age (higher ages see all lower-age buildings too)
    const currentAge = alliance.current_age || 'Archaic';
    const buildings = query(`
      SELECT * FROM buildings_ref 
      WHERE age_available = ?
        OR (? = 'Classical' AND age_available = 'Archaic')
        OR (? = 'Heroic' AND age_available IN ('Archaic', 'Classical'))
      ORDER BY age_available, cost_points ASC
    `, [currentAge, currentAge, currentAge]);
    
    // For Gate of Erebus: check if all alliance members have completed Orpheus
    let orpheusUnlocked = false;
    if (alliance.current_age === 'Classical') {
      try {
        const allianceMembers = query('SELECT student_id FROM students WHERE alliance_id = ?', [student.alliance_id]);
        orpheusUnlocked = allianceMembers.length > 0 && allianceMembers.every(member => {
          const sid = member.student_id;
          const hasReadingGuide = query(
            `SELECT 1 FROM grade_records WHERE student_id = ? AND assignment_type = 'comp_conn' 
             AND myth_god = 'Orpheus & Eurydice' AND section = 'classical' AND points_earned > 0 LIMIT 1`, [sid]
          ).length > 0;
          const quizPassed = query(
            'SELECT 1 FROM myth_quiz_attempts WHERE student_id = ? AND portal_id = 3 AND passed = 1 LIMIT 1', [sid]
          ).length > 0;
          const writingApproved = query(
            'SELECT 1 FROM student_myth_completion WHERE student_id = ? AND portal_id = 3 AND teacher_approved = 1 LIMIT 1', [sid]
          ).length > 0;
          return hasReadingGuide && quizPassed && writingApproved;
        });
      } catch (e) {
        orpheusUnlocked = false;
      }
    }
    
    // Count owned buildings
    const buildingsWithOwned = buildings.map(b => {
      const owned = buildingsOwned.filter(name => name === b.building_name).length;
      let locked = false;
      let lockReason = null;
      if (b.building_name === 'Gate of Erebus' && !orpheusUnlocked) {
        locked = true;
        lockReason = 'All alliance members must complete Orpheus & Eurydice (Reading Guide + Quiz + Writing) to unlock this building.';
      }
      return {
        ...b,
        owned,
        icon: BUILDING_ICONS[b.building_name] || '🏛️',
        locked,
        lock_reason: lockReason
      };
    });
    
    res.json({
      buildings: buildingsWithOwned,
      alliancePoints: alliance.total_points
    });
  } catch (err) {
    console.error('Get available buildings error:', err);
    res.status(500).json({ error: 'Failed to fetch buildings' });
  }
});

// Teacher: Get age gate status and alliance readiness for all periods
app.get('/api/teacher/age-gates', authenticateToken, (req, res) => {
  try {
    const periods = ['1st', '2nd', '3rd', '4th', 'Test'];
    
    // Ensure all gates exist
    periods.forEach(p => ensureAgeGate(p));
    
    const gates = query('SELECT * FROM age_gates');
    const alliances = query('SELECT * FROM alliances WHERE is_disbanded = 0');
    
    // Calculate readiness for each alliance
    const alliancesWithReadiness = alliances.map(a => ({
      ...a,
      readiness: calculateAgeReadiness(a)
    }));
    
    // Group by period
    const byPeriod = periods.map(period => {
      const gate = gates.find(g => g.class_period === period) || { class_period: period, classical_unlocked: 0, heroic_unlocked: 0 };
      const periodAlliances = alliancesWithReadiness.filter(a => a.class_period === period);
      const readyCount = periodAlliances.filter(a => a.readiness.isReady).length;
      
      return {
        period,
        gate,
        alliances: periodAlliances,
        totalAlliances: periodAlliances.length,
        readyCount
      };
    });
    
    res.json(byPeriod);
  } catch (err) {
    console.error('Get age gates error:', err);
    res.status(500).json({ error: 'Failed to fetch age gates' });
  }
});

// Teacher: Open age gate for a period
app.post('/api/teacher/open-age-gate', authenticateToken, (req, res) => {
  try {
    const { class_period, target_age } = req.body;
    const teacher_id = req.user.id;
    
    ensureAgeGate(class_period);
    
    if (target_age === 'Classical') {
      run(`UPDATE age_gates SET classical_unlocked = 1, classical_unlocked_at = CURRENT_TIMESTAMP, classical_unlocked_by = ?
           WHERE class_period = ?`, [teacher_id, class_period]);
      
      // Automatically advance ready alliances
      const alliances = query('SELECT * FROM alliances WHERE class_period = ? AND current_age = ? AND is_disbanded = 0', 
                              [class_period, 'Archaic']);
      
      let advancedCount = 0;
      alliances.forEach(alliance => {
        const readiness = calculateAgeReadiness(alliance);
        if (readiness.isReady) {
          run('UPDATE alliances SET current_age = ? WHERE alliance_id = ?', ['Classical', alliance.alliance_id]);
          advancedCount++;
        }
      });
      
      res.json({ 
        success: true, 
        message: `Classical Age gate opened for ${class_period} period! ${advancedCount} alliance(s) advanced.`
      });
    } else if (target_age === 'Heroic') {
      run(`UPDATE age_gates SET heroic_unlocked = 1, heroic_unlocked_at = CURRENT_TIMESTAMP, heroic_unlocked_by = ?
           WHERE class_period = ?`, [teacher_id, class_period]);
      
      res.json({ success: true, message: `Heroic Age gate opened for ${class_period} period!` });
    } else {
      res.status(400).json({ error: 'Invalid target age' });
    }
  } catch (err) {
    console.error('Open age gate error:', err);
    res.status(500).json({ error: 'Failed to open age gate' });
  }
});

// Teacher: Override — advance a specific alliance to Classical Age (bypasses requirements)
app.post('/api/teacher/advance-alliance', authenticateToken, (req, res) => {
  try {
    const { alliance_id, target_age } = req.body;
    if (!alliance_id || !target_age) return res.status(400).json({ error: 'Missing alliance_id or target_age' });
    
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    if (!alliance) return res.status(404).json({ error: 'Alliance not found' });
    
    if (target_age === 'Classical' && alliance.current_age === 'Archaic') {
      run('UPDATE alliances SET current_age = ? WHERE alliance_id = ?', ['Classical', alliance_id]);
      
      ensureAgeGate(alliance.class_period);
      run(`UPDATE age_gates SET classical_unlocked = 1, classical_unlocked_at = COALESCE(classical_unlocked_at, CURRENT_TIMESTAMP), classical_unlocked_by = COALESCE(classical_unlocked_by, ?)
           WHERE class_period = ? AND classical_unlocked = 0`, [req.user.id, alliance.class_period]);
      
      saveDatabase();
      res.json({ success: true, message: `${alliance.alliance_name} has been advanced to the Classical Age!` });
    } else if (target_age === 'Heroic' && alliance.current_age === 'Classical') {
      run('UPDATE alliances SET current_age = ? WHERE alliance_id = ?', ['Heroic', alliance_id]);
      saveDatabase();
      res.json({ success: true, message: `${alliance.alliance_name} has been advanced to the Heroic Age!` });
    } else {
      res.status(400).json({ error: `Cannot advance ${alliance.alliance_name} from ${alliance.current_age} to ${target_age}` });
    }
  } catch (err) {
    console.error('Advance alliance error:', err);
    res.status(500).json({ error: 'Failed to advance alliance' });
  }
});

// Teacher: Mark alliance Rite of Passage complete
app.post('/api/teacher/mark-rite-complete', authenticateToken, (req, res) => {
  try {
    const { alliance_id, complete } = req.body;
    
    run('UPDATE alliances SET rite_of_passage_complete = ? WHERE alliance_id = ?', 
        [complete ? 1 : 0, alliance_id]);
    
    // Check if alliance can now advance
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    const readiness = calculateAgeReadiness(alliance);
    
    ensureAgeGate(alliance.class_period);
    const gate = query('SELECT * FROM age_gates WHERE class_period = ?', [alliance.class_period])[0];
    
    // Auto-advance if ready and gate is open
    if (readiness.isReady && alliance.current_age === 'Archaic' && gate.classical_unlocked) {
      run('UPDATE alliances SET current_age = ? WHERE alliance_id = ?', ['Classical', alliance_id]);
      res.json({ success: true, message: 'Rite of Passage marked complete. Alliance advanced to Classical Age!' });
    } else {
      res.json({ success: true, message: `Rite of Passage ${complete ? 'marked complete' : 'unmarked'}` });
    }
  } catch (err) {
    console.error('Mark rite complete error:', err);
    res.status(500).json({ error: 'Failed to update rite status' });
  }
});

// Teacher: Reset all battle counts (for testing)
app.post('/api/teacher/reset-battle-counts', authenticateToken, (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    console.log(`🔄 Reset battle counts requested. Today = ${today}`);
    
    // Find battles that count toward daily limits
    const countedBattles = query(`
      SELECT battle_id, status FROM arena_battles 
      WHERE DATE(started_at) = ? AND status IN ('in_progress', 'completed')
    `, [today]);
    
    // Find ALL of today's battles to backdate
    const allTodaysBattles = query(`
      SELECT battle_id FROM arena_battles WHERE DATE(started_at) = ? OR DATE(created_at) = ?
    `, [today, today]);
    
    console.log(`🔄 Found ${allTodaysBattles.length} total battles today (${countedBattles.length} count toward limit)`);
    
    // Backdate ALL of today's battles regardless of status
    // Must backdate BOTH started_at AND created_at because:
    // - countBattlesToday() checks DATE(started_at) for daily limits
    // - opponent filter checks DATE(created_at) to prevent rematches
    if (allTodaysBattles.length > 0) {
      run(`UPDATE arena_battles SET started_at = datetime(started_at, '-1 day'), created_at = datetime(created_at, '-1 day') WHERE DATE(started_at) = ? OR DATE(created_at) = ?`, [today, today]);
      console.log(`🔄 Backdated ${allTodaysBattles.length} battles (started_at + created_at)`);
    }
    
    // Reset stats and prometheus usage
    run('UPDATE arena_battle_stats SET battles_today = 0, last_battle_date = NULL, prometheus_used_date = NULL');
    console.log('🔄 Reset arena_battle_stats and prometheus usage');
    
    saveDatabase();
    
    const message = `Reset complete! ${countedBattles.length} counted battles backdated. Everyone can battle again!`;
    console.log(`🔄 ${message}`);
    res.json({ success: true, message });
  } catch (err) {
    console.error('Reset battle counts error:', err);
    res.status(500).json({ error: 'Failed to reset battle counts: ' + err.message });
  }
});

// Teacher: Cleanup stuck battles
app.post('/api/teacher/cleanup-battles', authenticateToken, (req, res) => {
  try {
    // Cancel all pending and accepted battles (stuck in god selection)
    const stuckPending = query("SELECT * FROM arena_battles WHERE status IN ('pending', 'accepted')");
    run("UPDATE arena_battles SET status = 'cancelled' WHERE status IN ('pending', 'accepted')");
    
    // FIX 4: Also expire in_progress battles older than 5 minutes (previously missed — these are the stuck ones)
    const stuckInProgress = query("SELECT * FROM arena_battles WHERE status = 'in_progress' AND datetime(COALESCE(started_at, created_at), '+5 minutes') < datetime('now')");
    run("UPDATE arena_battles SET status = 'expired' WHERE status = 'in_progress' AND datetime(COALESCE(started_at, created_at), '+5 minutes') < datetime('now')");
    
    const totalCleaned = stuckPending.length + stuckInProgress.length;
    console.log(`🧹 Cleaned up ${stuckPending.length} pending/accepted + ${stuckInProgress.length} stale in-progress battles`);
    saveDatabase();
    res.json({ success: true, message: `Cleaned up ${totalCleaned} stuck battles (${stuckPending.length} pending, ${stuckInProgress.length} stale in-progress)` });
  } catch (err) {
    console.error('Cleanup battles error:', err);
    res.status(500).json({ error: 'Failed to cleanup battles' });
  }
});

// Teacher: Mark alliance Map complete
app.post('/api/teacher/mark-map-complete', authenticateToken, (req, res) => {
  try {
    const { alliance_id, complete } = req.body;
    
    run('UPDATE alliances SET civilization_map_complete = ? WHERE alliance_id = ?', 
        [complete ? 1 : 0, alliance_id]);
    
    // Check if alliance can now advance
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    const readiness = calculateAgeReadiness(alliance);
    
    ensureAgeGate(alliance.class_period);
    const gate = query('SELECT * FROM age_gates WHERE class_period = ?', [alliance.class_period])[0];
    
    // Auto-advance if ready and gate is open
    if (readiness.isReady && alliance.current_age === 'Archaic' && gate.classical_unlocked) {
      run('UPDATE alliances SET current_age = ? WHERE alliance_id = ?', ['Classical', alliance_id]);
      res.json({ success: true, message: 'Map marked complete. Alliance advanced to Classical Age!' });
    } else {
      res.json({ success: true, message: `Civilization Map ${complete ? 'marked complete' : 'unmarked'}` });
    }
  } catch (err) {
    console.error('Mark map complete error:', err);
    res.status(500).json({ error: 'Failed to update map status' });
  }
});

// ====================
// BUILDING ACTIVATION SYSTEM
// ====================

// Get alliance building activations
app.get('/api/alliance/activations/:alliance_id', authenticateToken, (req, res) => {
  try {
    const { alliance_id } = req.params;
    
    const activations = query(`
      SELECT 
        ba.*,
        br.point_bonus,
        br.battle_bonus,
        br.active_duration_hours,
        br.cooldown_hours,
        br.always_active,
        br.description
      FROM building_activations ba
      JOIN buildings_ref br ON ba.building_name = br.building_name
      WHERE ba.alliance_id = ?
      ORDER BY ba.building_name, ba.building_instance
    `, [alliance_id]);
    
    const now = new Date();
    
    // Calculate status for each building
    const activationsWithStatus = activations.map(a => {
      // Always active buildings (walls)
      if (a.always_active) {
        return { ...a, status: 'always_active', bonus_active: true };
      }
      
      const activeUntil = a.active_until ? new Date(a.active_until) : null;
      const cooldownUntil = a.cooldown_until ? new Date(a.cooldown_until) : null;
      
      let status = 'ready';
      let hoursRemaining = 0;
      let bonusActive = false;
      
      if (activeUntil && now < activeUntil) {
        status = 'active';
        hoursRemaining = Math.ceil((activeUntil - now) / (1000 * 60 * 60));
        bonusActive = true;
      } else if (cooldownUntil && now < cooldownUntil) {
        status = 'cooldown';
        hoursRemaining = Math.ceil((cooldownUntil - now) / (1000 * 60 * 60));
        bonusActive = false;
      }
      
      return { ...a, status, hours_remaining: hoursRemaining, bonus_active: bonusActive };
    });
    
    // Calculate total active bonus
    const totalBonus = activationsWithStatus
      .filter(a => a.bonus_active)
      .reduce((sum, a) => sum + (a.point_bonus || 0), 0);
    
    res.json({
      activations: activationsWithStatus,
      total_active_bonus: totalBonus,
      total_active_bonus_percent: Math.round(totalBonus * 100)
    });
  } catch (err) {
    console.error('Get activations error:', err);
    res.status(500).json({ error: 'Failed to fetch activations' });
  }
});

// Activate a building
app.post('/api/alliance/activate-building', authenticateToken, (req, res) => {
  try {
    const { activation_id } = req.body;
    const student_id = req.user.id;
    
    // Get the activation record
    const activation = query(`
      SELECT ba.*, br.active_duration_hours, br.cooldown_hours, br.always_active, br.point_bonus
      FROM building_activations ba
      JOIN buildings_ref br ON ba.building_name = br.building_name
      WHERE ba.activation_id = ?
    `, [activation_id])[0];
    
    if (!activation) {
      return res.status(404).json({ error: 'Building activation not found' });
    }
    
    // Verify student is in this alliance
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    if (!student || student.alliance_id !== activation.alliance_id) {
      return res.status(403).json({ error: 'You can only activate buildings for your own alliance' });
    }
    
    // Check if always active (walls)
    if (activation.always_active) {
      return res.status(400).json({ error: 'This building is always active' });
    }
    
    // Check if already active or on cooldown
    const now = new Date();
    const activeUntil = activation.active_until ? new Date(activation.active_until) : null;
    const cooldownUntil = activation.cooldown_until ? new Date(activation.cooldown_until) : null;
    
    if (activeUntil && now < activeUntil) {
      return res.status(400).json({ error: 'Building is already active' });
    }
    
    if (cooldownUntil && now < cooldownUntil) {
      const hoursLeft = Math.ceil((cooldownUntil - now) / (1000 * 60 * 60));
      return res.status(400).json({ error: `Building is on cooldown. ${hoursLeft} hours remaining.` });
    }
    
    // Activate the building
    const newActiveUntil = new Date(now.getTime() + activation.active_duration_hours * 60 * 60 * 1000);
    const newCooldownUntil = new Date(newActiveUntil.getTime() + activation.cooldown_hours * 60 * 60 * 1000);
    
    run(`UPDATE building_activations 
         SET activated_at = ?, active_until = ?, cooldown_until = ?, activated_by_student_id = ?
         WHERE activation_id = ?`,
        [now.toISOString(), newActiveUntil.toISOString(), newCooldownUntil.toISOString(), student_id, activation_id]);
    
    const bonusPercent = Math.round(activation.point_bonus * 100);
    
    res.json({ 
      success: true, 
      message: `${activation.building_name} activated! +${bonusPercent}% bonus for ${activation.active_duration_hours} hours.`,
      active_until: newActiveUntil,
      cooldown_until: newCooldownUntil
    });
  } catch (err) {
    console.error('Activate building error:', err);
    res.status(500).json({ error: 'Failed to activate building' });
  }
});

// Get current total bonus for an alliance (used when awarding points)
function getAllianceBuildingBonus(alliance_id) {
  const activations = query(`
    SELECT ba.*, br.point_bonus, br.always_active
    FROM building_activations ba
    JOIN buildings_ref br ON ba.building_name = br.building_name
    WHERE ba.alliance_id = ?
  `, [alliance_id]);
  
  const now = new Date();
  let totalBonus = 0;
  
  activations.forEach(a => {
    if (a.always_active) {
      // Walls don't give point bonuses, only battle bonuses
      return;
    }
    
    const activeUntil = a.active_until ? new Date(a.active_until) : null;
    if (activeUntil && now < activeUntil) {
      totalBonus += a.point_bonus || 0;
    }
  });
  
  // V92: Cap total building bonus at 15% to prevent compounding inflation
  const MAX_BUILDING_BONUS = 0.15;
  if (totalBonus > MAX_BUILDING_BONUS) {
    console.log(`⚠️ Building bonus capped: ${Math.round(totalBonus * 100)}% → ${Math.round(MAX_BUILDING_BONUS * 100)}% for alliance ${alliance_id}`);
    totalBonus = MAX_BUILDING_BONUS;
  }
  
  return totalBonus;
}

// ====================
// PHASE 2: FATE WHEEL & BATTLES
// ====================

// Spin Fate Wheel
// Get Fate Choices
app.get('/api/teacher/fate-choices/:fate_id', authenticateToken, (req, res) => {
  try {
    const { fate_id } = req.params;
    
    console.log(`🎲 Requesting choices for fate_id: ${fate_id}`);
    
    // First check if the fate exists
    const fate = query('SELECT * FROM fates_ref WHERE fate_id = ?', [fate_id]);
    if (fate.length === 0) {
      console.error(`❌ Fate ${fate_id} does NOT exist in fates_ref!`);
      return res.status(404).json({ error: `Fate ${fate_id} not found` });
    }
    console.log(`✅ Fate exists: ${fate[0].fate_name}`);
    
    // Now get choices
    const choices = query(`
      SELECT * FROM fate_choices 
      WHERE fate_id = ? 
      ORDER BY CASE risk_level 
        WHEN 'conservative' THEN 1
        WHEN 'moderate' THEN 2  
        WHEN 'aggressive' THEN 3
      END
    `, [fate_id]);
    
    console.log(`📊 Found ${choices.length} choices for fate ${fate_id}`);
    
    if (choices.length === 0) {
      console.error(`❌ NO CHOICES found for fate_id ${fate_id}!`);
      console.error(`   Check: SELECT * FROM fate_choices WHERE fate_id = ${fate_id}`);
    }
    
    res.json(choices);
  } catch (err) {
    console.error('Get fate choices error:', err);
    res.status(500).json({ error: 'Failed to get fate choices', details: err.message });
  }
});

// Process Fate Choice
app.post('/api/teacher/process-fate-choice', authenticateToken, (req, res) => {
  try {
    const { alliance_id, fate_id, choice_id } = req.body;
    const teacher_id = req.user.id;
    
    // Get fate details
    const fate = query('SELECT * FROM fates_ref WHERE fate_id = ?', [fate_id])[0];
    if (!fate) {
      return res.status(404).json({ error: 'Fate not found' });
    }
    
    // Get choice details
    const choice = query('SELECT * FROM fate_choices WHERE choice_id = ?', [choice_id])[0];
    if (!choice || choice.fate_id !== fate_id) {
      return res.status(404).json({ error: 'Choice not found' });
    }
    
    // Get alliance details
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    if (!alliance) {
      return res.status(404).json({ error: 'Alliance not found' });
    }
    
    // Roll the dice!
    const roll = Math.random();
    const success = roll < choice.success_chance;
    const rolledValue = success ? choice.success_points : choice.failure_points;
    
    let pointsChange = rolledValue; // For regular choices, this is the total
    let stealDetails = null;

    // Resolve scroll modifier before DB writes
    const fateIsStealing = fate.fate_type === 'steal_choice' && rolledValue > 0;
    const scrollResult = applyScrollModifier(alliance_id, alliance, rolledValue, fate.fate_type, fateIsStealing);
    const modifiedRolledValue = scrollResult.pointsChange;
    
    if (fate.fate_type === 'steal_choice') {
      // STEAL-CHOICE: rolledValue is PER ALLIANCE
      // Positive = spinner steals FROM each other alliance
      // Negative = spinner gives TO each other alliance
      const perAlliance = rolledValue; // keep original per-alliance amount for other alliances
      
      // Get all other alliances in the same period
      const allPeriodAlliances = query(`
        SELECT DISTINCT a.alliance_id, a.alliance_name, a.total_points
        FROM alliances a 
        JOIN students s ON s.alliance_id = a.alliance_id 
        WHERE s.class_period = (SELECT class_period FROM students WHERE alliance_id = ? LIMIT 1)
          AND a.alliance_id != ? AND a.is_disbanded = 0
      `, [alliance_id, alliance_id]);
      
      const numAlliances = allPeriodAlliances.length;

      if (scrollResult.scrollTriggered && scrollResult.redirectTarget && perAlliance > 0) {
        // Echo's Reflection: stolen points redirected to next-ranked alliance
        const redirect = scrollResult.redirectTarget;
        const totalStolen = perAlliance * numAlliances;

        // Each other alliance still loses the same amount
        allPeriodAlliances.forEach(other => {
          run('UPDATE alliances SET total_points = total_points - ? WHERE alliance_id = ?',
              [perAlliance, other.alliance_id]);
          run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) VALUES (?, ?, ?, ?, ?)`,
              [other.alliance_id, -perAlliance, 'fate',
               `Fate: ${fate.fate_name} (Echo's Reflection — points to ${redirect.alliance_name})`, teacher_id]);
        });
        // Redirect goes to next-ranked alliance, not spinner
        run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?',
            [totalStolen, redirect.alliance_id]);
        run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) VALUES (?, ?, ?, ?, ?)`,
            [redirect.alliance_id, totalStolen, 'fate',
             `Fate: ${fate.fate_name} (Echo's Reflection from ${alliance.alliance_name})`, teacher_id]);

        pointsChange = 0; // spinner got nothing
        stealDetails = {
          perAlliance,
          alliancesAffected: numAlliances,
          totalChange: 0,
          echoRedirect: { allianceName: redirect.alliance_name, pointsReceived: totalStolen },
          affectedAlliances: allPeriodAlliances.map(a => ({ name: a.alliance_name, pointsChange: -perAlliance }))
        };
      } else {
        // Normal steal/give — spinner total = per-alliance amount × number of other alliances
        // When Orpheus's Bargain is active on a negative (give) fate, modifiedRolledValue is halved,
        // so we derive the per-victim amount from that to keep the books balanced.
        const effectivePerAlliance = (scrollResult.scrollTriggered && scrollResult.scrollType === 'orpheus_bargain')
          ? (numAlliances > 0 ? Math.ceil(modifiedRolledValue / numAlliances) : modifiedRolledValue)
          : perAlliance;
        const totalForSpinner = effectivePerAlliance * numAlliances;

        run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
            [totalForSpinner, alliance_id]);
        run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) 
             VALUES (?, ?, ?, ?, ?)`, 
            [alliance_id, totalForSpinner, 'fate', 
             `Fate: ${fate.fate_name} (${choice.risk_level} ${success ? 'success' : 'failure'} — ${effectivePerAlliance > 0 ? 'stole' : 'gave'} ${Math.abs(effectivePerAlliance)} per alliance × ${numAlliances})${scrollResult.scrollNote ? ' [' + scrollResult.scrollNote + ']' : ''}`, teacher_id]);
        
        allPeriodAlliances.forEach(other => {
          const otherChange = -effectivePerAlliance;
          run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
              [otherChange, other.alliance_id]);
          run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) 
               VALUES (?, ?, ?, ?, ?)`, 
              [other.alliance_id, otherChange, 'fate', 
               `Fate: ${fate.fate_name} (${otherChange > 0 ? 'gained from' : 'lost to'} ${alliance.alliance_name})`, teacher_id]);
        });
        
        pointsChange = totalForSpinner;
        stealDetails = {
          perAlliance: effectivePerAlliance,
          alliancesAffected: numAlliances,
          totalChange: totalForSpinner,
          affectedAlliances: allPeriodAlliances.map(a => ({
            name: a.alliance_name,
            pointsChange: -effectivePerAlliance
          }))
        };
      }
    }
    
    // Apply Granary/Shrine protection for regular (non-steal) choices
    let choiceGranaryApplied = false;
    let choiceProtectionSource = null;
    
    if (fate.fate_type !== 'steal_choice') {
      // REGULAR CHOICE: apply modified flat points to this alliance only
      let finalPoints = modifiedRolledValue;
      const choiceBuildingsOwned = JSON.parse(alliance.buildings_owned || '[]');
      // Shrine of the Fates (-35%) overrides Granary (-30%)
      if (choiceBuildingsOwned.includes('Shrine of the Fates') && finalPoints < 0) {
        finalPoints = Math.round(finalPoints * 0.65);
        choiceGranaryApplied = true;
        choiceProtectionSource = 'Shrine of the Fates';
        console.log(`🏛️ Shrine of the Fates protection (choice): ${modifiedRolledValue} → ${finalPoints} for alliance ${alliance_id}`);
      } else if (choiceBuildingsOwned.includes('Granary') && finalPoints < 0) {
        finalPoints = Math.round(finalPoints * 0.7);
        choiceGranaryApplied = true;
        choiceProtectionSource = 'Granary';
        console.log(`🌾 Granary protection (choice): ${modifiedRolledValue} → ${finalPoints} for alliance ${alliance_id}`);
      }
      run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
          [finalPoints, alliance_id]);
      run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) 
           VALUES (?, ?, ?, ?, ?)`, 
          [alliance_id, finalPoints, 'fate',
           `Fate: ${fate.fate_name} (${choice.risk_level} choice - ${success ? 'success' : 'failure'})${choiceGranaryApplied ? ' [' + choiceProtectionSource + ' -' + (choiceProtectionSource === 'Shrine of the Fates' ? '35' : '30') + '%]' : ''}${scrollResult.scrollNote ? ' [' + scrollResult.scrollNote + ']' : ''}`, teacher_id]);
      pointsChange = finalPoints;
    }
    
    // Log the fate outcome
    run(`INSERT INTO fate_outcomes (alliance_id, fate_id, outcome_type, choice_made, points_awarded) 
         VALUES (?, ?, ?, ?, ?)`, 
        [alliance_id, fate_id, success ? 'success' : 'failure', choice.risk_level, pointsChange]);
    
    // Log the fate spin
    run(`INSERT INTO fate_spins (alliance_id, fate_id, fate_name, result_type, points_change, teacher_id) 
         VALUES (?, ?, ?, ?, ?, ?)`, 
        [alliance_id, fate_id, fate.fate_name, 'choice', pointsChange, teacher_id]);
    
    // Auto-detect fates that grant items (for display purposes — teacher awards manually)
    let reverseCardAwarded = false;
    // Note: Circe's Enchantment grants a Reverse Card, but teacher awards it manually via the Award button

    // Get updated alliance
    const updatedAlliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];

    // Check if alliance owns Oracle building (grants 1 free re-spin per week on negative fates)
    let oracleAvailable = false;
    let hasOracle = false;
    try {
      const buildingsOwned = JSON.parse(updatedAlliance.buildings_owned || '[]');
      hasOracle = buildingsOwned.includes('Oracle');
      if (hasOracle && pointsChange < 0) {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - dayOfWeek);
        startOfWeek.setHours(0, 0, 0, 0);
        const respinUsed = query(
          `SELECT COUNT(*) as count FROM fate_spins 
           WHERE alliance_id = ? AND fate_name = 'Oracle Re-spin' AND spun_at >= ?`,
          [alliance_id, startOfWeek.toISOString()]
        )[0].count;
        oracleAvailable = respinUsed === 0;
      }
    } catch(e) { /* non-critical */ }

    // Check if Granary was applied (for display)
    const granaryApplied = choiceGranaryApplied;

    res.json({
      success,
      pointsChange,
      choice,
      fate,
      updatedAlliance,
      roll: (roll * 100).toFixed(1),
      stealDetails,
      hasOracle,
      oracleAvailable,
      reverseCardAwarded,
      granaryApplied,
      granaryReduction: granaryApplied ? Math.abs(modifiedRolledValue) - Math.abs(pointsChange) : 0,
      granaryOriginalLoss: granaryApplied ? modifiedRolledValue : null,
      protectionSource: choiceProtectionSource
    });
  } catch (err) {
    console.error('Process fate choice error:', err);
    res.status(500).json({ error: 'Failed to process fate choice' });
  }
});

// Check if alliance has reverse card
app.get('/api/teacher/check-reverse-card/:alliance_id', authenticateToken, (req, res) => {
  try {
    const { alliance_id } = req.params;
    const alliance = query('SELECT reverse_cards FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    
    if (!alliance) {
      return res.status(404).json({ error: 'Alliance not found' });
    }
    
    const cardCount = alliance.reverse_cards || 0;
    res.json({
      hasCard: cardCount > 0,
      cardCount
    });
  } catch (err) {
    console.error('Check reverse card error:', err);
    res.status(500).json({ error: 'Failed to check reverse card' });
  }
});

// Award reverse card to alliance
app.post('/api/teacher/award-reverse-card/:alliance_id', authenticateToken, (req, res) => {
  try {
    const { alliance_id } = req.params;
    
    // Add one reverse card
    run('UPDATE alliances SET reverse_cards = COALESCE(reverse_cards, 0) + 1 WHERE alliance_id = ?', [alliance_id]);
    
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    
    res.json({
      success: true,
      message: 'Reverse card awarded!',
      cardCount: alliance.reverse_cards
    });
  } catch (err) {
    console.error('Award reverse card error:', err);
    res.status(500).json({ error: 'Failed to award reverse card' });
  }
});

// Use reverse card
app.post('/api/teacher/use-reverse-card/:alliance_id', authenticateToken, (req, res) => {
  try {
    const { alliance_id } = req.params;
    
    // Remove one reverse card
    run('UPDATE alliances SET reverse_cards = COALESCE(reverse_cards, 0) - 1 WHERE alliance_id = ? AND reverse_cards > 0', [alliance_id]);
    
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    
    res.json({
      success: true,
      message: 'Reverse card used!',
      cardCount: alliance.reverse_cards
    });
  } catch (err) {
    console.error('Use reverse card error:', err);
    res.status(500).json({ error: 'Failed to use reverse card' });
  }
});

// ==================== FATE SCROLL ENDPOINTS ====================

// GET /api/fate/alliance-scrolls/:allianceId
// Returns all unplayed scrolls held by an alliance.
// Called by teacher dashboard when an alliance is selected in the Fate Wheel tab.
app.get('/api/fate/alliance-scrolls/:allianceId', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
  try {
    const alliance_id = parseInt(req.params.allianceId);
    if (!alliance_id) return res.status(400).json({ error: 'Invalid alliance_id' });

    const scrolls = query(
      `SELECT id, scroll_type, earned_at
       FROM alliance_scrolls
       WHERE alliance_id = ? AND played_at IS NULL
       ORDER BY earned_at ASC`,
      [alliance_id]
    );

    const scrollMeta = {
      orpheus_bargain: {
        name: "Orpheus's Bargain",
        effect: 'Halves any negative fate outcome',
        myth: 'Orpheus & Eurydice'
      },
      echo_reflection: {
        name: "Echo's Reflection",
        effect: 'Redirects a steal or give fate — stolen points go to next alliance on leaderboard',
        myth: 'Echo & Narcissus'
      },
      psyche_lantern: {
        name: "Psyche's Lantern",
        effect: 'Doubles any positive fate outcome. No protection against negative fates.',
        myth: 'Eros & Psyche'
      }
    };

    const scrollsWithMeta = scrolls.map(s => ({
      ...s,
      ...(scrollMeta[s.scroll_type] || { name: s.scroll_type, effect: '', myth: '' })
    }));

    res.json({ success: true, scrolls: scrollsWithMeta });
  } catch (err) {
    console.error('Get alliance scrolls error:', err);
    res.status(500).json({ error: 'Failed to fetch alliance scrolls' });
  }
});

// POST /api/fate/play-scroll
// Teacher declares a scroll active for the upcoming spin, or passes.
// Records played_at on the scroll. Fate resolution reads this to apply the effect.
app.post('/api/fate/play-scroll', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
  try {
    const { scroll_id, alliance_id } = req.body;
    if (!alliance_id) return res.status(400).json({ error: 'Missing alliance_id' });

    if (!scroll_id) {
      console.log(`📜 Scroll pass: alliance ${alliance_id} chose not to play a scroll`);
      return res.json({ success: true, scrollPlayed: false });
    }

    const scroll = query(
      'SELECT id, alliance_id, scroll_type, played_at FROM alliance_scrolls WHERE id = ?',
      [scroll_id]
    )[0];

    if (!scroll) return res.status(404).json({ error: 'Scroll not found' });
    if (scroll.alliance_id !== alliance_id) return res.status(403).json({ error: 'Scroll does not belong to this alliance' });
    if (scroll.played_at !== null) return res.status(400).json({ error: 'Scroll already played' });

    const now = Math.floor(Date.now() / 1000);
    run('UPDATE alliance_scrolls SET played_at = ? WHERE id = ?', [now, scroll_id]);

    const scrollMeta = {
      orpheus_bargain: { name: "Orpheus's Bargain", effectDescription: 'Halves any negative fate outcome' },
      echo_reflection: { name: "Echo's Reflection", effectDescription: 'Redirects steal/give fate to next alliance on leaderboard' },
      psyche_lantern: { name: "Psyche's Lantern", effectDescription: 'Doubles any positive fate outcome' }
    };
    const meta = scrollMeta[scroll.scroll_type] || { name: scroll.scroll_type, effectDescription: '' };

    console.log(`📜 Scroll played: ${scroll.scroll_type} by alliance ${alliance_id}`);
    saveDatabase();

    res.json({
      success: true,
      scrollPlayed: true,
      scrollId: scroll_id,
      scrollType: scroll.scroll_type,
      scrollName: meta.name,
      effectDescription: meta.effectDescription
    });
  } catch (err) {
    console.error('Play scroll error:', err);
    res.status(500).json({ error: 'Failed to record scroll play' });
  }
});

// ==================== FORBIDDEN ARCHIVE ENDPOINTS ====================

// Get FA unlock status and progress for student's alliance
app.get('/api/student/forbidden-archive-status', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const student = query('SELECT alliance_id, name FROM students WHERE student_id = ?', [student_id])[0];
    if (!student || !student.alliance_id) {
      return res.json({ unlocked: false, error: 'Not in an alliance' });
    }
    
    const members = query(
      `SELECT s.student_id, s.name FROM students s 
       WHERE s.alliance_id = ? AND (s.is_ghost = 0 OR s.is_ghost IS NULL)`,
      [student.alliance_id]
    );
    
    const requiredPortals = [1, 2, 5];
    
    const memberProgress = members.map(m => {
      const quizzes = query(
        `SELECT DISTINCT portal_id FROM myth_quiz_attempts 
         WHERE student_id = ? AND portal_id IN (1, 2, 5) AND passed = 1`,
        [m.student_id]
      );
      const passedPortals = quizzes.map(q => q.portal_id);
      return {
        student_id: m.student_id,
        name: m.name,
        pandora: passedPortals.includes(1),
        phaethon: passedPortals.includes(2),
        icarus: passedPortals.includes(5),
        allPassed: requiredPortals.every(p => passedPortals.includes(p))
      };
    });
    
    const unlocked = memberProgress.every(m => m.allPassed);
    
    const faQuest = query("SELECT quest_id FROM side_quests_ref WHERE quest_name = 'The Forbidden Archive'")[0];
    let myCompletion = null;
    let allianceComplete = false;
    let reverseCards = 0;
    let savedProgress = null;
    
    if (faQuest) {
      myCompletion = query(
        'SELECT status, journey_data FROM side_quest_completions WHERE student_id = ? AND quest_id = ?',
        [student_id, faQuest.quest_id]
      )[0] || null;
      
      const approvedCount = query(
        `SELECT COUNT(*) as count FROM side_quest_completions 
         WHERE quest_id = ? AND alliance_id = ? AND status = 'approved'`,
        [faQuest.quest_id, student.alliance_id]
      )[0].count;
      
      allianceComplete = approvedCount >= members.length && members.length > 0;
      
      const alliance = query('SELECT reverse_cards FROM alliances WHERE alliance_id = ?', [student.alliance_id])[0];
      reverseCards = alliance ? (alliance.reverse_cards || 0) : 0;
      
      if (myCompletion && myCompletion.journey_data) {
        try { savedProgress = JSON.parse(myCompletion.journey_data); } catch(e) {}
      }
    }
    
    res.json({
      unlocked,
      memberProgress,
      myCompletion: myCompletion ? { status: myCompletion.status } : null,
      allianceComplete,
      reverseCards,
      savedProgress,
      questId: faQuest ? faQuest.quest_id : null
    });
  } catch (err) {
    console.error('FA status error:', err);
    res.status(500).json({ error: 'Failed to check Forbidden Archive status' });
  }
});

// Save FA journey progress
app.post('/api/student/forbidden-archive-save', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { journeyData } = req.body;
    
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    
    const faQuest = query("SELECT quest_id FROM side_quests_ref WHERE quest_name = 'The Forbidden Archive'")[0];
    if (!faQuest) return res.status(404).json({ error: 'Quest not found' });
    
    const existing = query(
      'SELECT completion_id, status FROM side_quest_completions WHERE student_id = ? AND quest_id = ?',
      [student_id, faQuest.quest_id]
    )[0];
    
    if (existing) {
      run('UPDATE side_quest_completions SET journey_data = ? WHERE completion_id = ?',
        [JSON.stringify(journeyData), existing.completion_id]);
    } else {
      run(`INSERT INTO side_quest_completions (student_id, quest_id, alliance_id, status, journey_data)
           VALUES (?, ?, ?, 'in_progress', ?)`,
        [student_id, faQuest.quest_id, student.alliance_id, JSON.stringify(journeyData)]);
    }
    
    saveDatabase();
    res.json({ success: true });
  } catch (err) {
    console.error('FA save error:', err);
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

// Complete FA (all 3 journeys done)
app.post('/api/student/forbidden-archive-complete', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { journeyData } = req.body;
    
    const student = query('SELECT alliance_id, name FROM students WHERE student_id = ?', [student_id])[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    
    const faQuest = query("SELECT quest_id FROM side_quests_ref WHERE quest_name = 'The Forbidden Archive'")[0];
    if (!faQuest) return res.status(404).json({ error: 'Quest not found' });
    
    if (!journeyData || !journeyData.pandora || !journeyData.phaethon || !journeyData.icarus) {
      return res.status(400).json({ error: 'All three journeys must be completed' });
    }
    if (!journeyData.pandora.done || !journeyData.phaethon.done || !journeyData.icarus.done) {
      return res.status(400).json({ error: 'All three journeys must be marked complete' });
    }
    
    const existing = query(
      'SELECT completion_id, status FROM side_quest_completions WHERE student_id = ? AND quest_id = ?',
      [student_id, faQuest.quest_id]
    )[0];
    
    if (existing) {
      if (existing.status === 'approved') {
        return res.json({ success: true, message: 'Already approved', alreadyComplete: true });
      }
      run(`UPDATE side_quest_completions SET status = 'pending', journey_data = ? WHERE completion_id = ?`,
        [JSON.stringify(journeyData), existing.completion_id]);
    } else {
      run(`INSERT INTO side_quest_completions (student_id, quest_id, alliance_id, status, journey_data)
           VALUES (?, ?, ?, 'pending', ?)`,
        [student_id, faQuest.quest_id, student.alliance_id, JSON.stringify(journeyData)]);
    }
    
    saveDatabase();
    console.log(`🦉 ${student.name} completed The Forbidden Archive!`);
    res.json({ success: true, message: 'Quest completion submitted for approval!' });
  } catch (err) {
    console.error('FA complete error:', err);
    res.status(500).json({ error: 'Failed to submit completion' });
  }
});

// Student: Use a Reverse Card (from Fate spinner)
app.post('/api/student/use-reverse-card', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    
    const alliance = query('SELECT reverse_cards FROM alliances WHERE alliance_id = ?', [student.alliance_id])[0];
    if (!alliance || !alliance.reverse_cards || alliance.reverse_cards <= 0) {
      return res.status(400).json({ error: 'No Reverse Cards available' });
    }
    
    run('UPDATE alliances SET reverse_cards = reverse_cards - 1 WHERE alliance_id = ?', [student.alliance_id]);
    
    // Award Fate Breaker badge to all alliance members automatically
    const members = query('SELECT student_id FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)', [student.alliance_id]);
    members.forEach(m => {
      try {
        run(`INSERT OR IGNORE INTO student_badges (student_id, badge_id, ring_level, claimed, awarded_by)
             VALUES (?, 'honor_fate_breaker', 0, 0, 'system')`, [m.student_id]);
      } catch(e) { /* already has it */ }
    });
    
    saveDatabase();
    console.log(`🔄 Alliance ${student.alliance_id} used a Reverse Card — Fate Breaker badge awarded to ${members.length} members`);
    res.json({ success: true, remainingCards: alliance.reverse_cards - 1 });
  } catch (err) {
    console.error('Use reverse card error:', err);
    res.status(500).json({ error: 'Failed to use Reverse Card' });
  }
});

// ================================================================
// SCROLL MODIFIER — Applied to fate outcomes when a scroll was played
// Called by both spin-fate and process-fate-choice before DB writes.
// Returns { pointsChange, scrollTriggered, scrollType, scrollNote, redirectTarget }
// scrollTriggered: true if the scroll's condition was met and effect fired
// redirectTarget: only set for echo_reflection — the alliance to receive points instead
// ================================================================
function applyScrollModifier(alliance_id, alliance, pointsChange, fateType, fateIsStealing) {
  // Look up most recently played scroll for this alliance (played in last 10 minutes, not yet marked triggered)
  const tenMinutesAgo = Math.floor(Date.now() / 1000) - 600;
  const scroll = query(
    `SELECT id, scroll_type FROM alliance_scrolls
     WHERE alliance_id = ? AND played_at IS NOT NULL AND played_at >= ? AND triggered IS NULL
     ORDER BY played_at DESC LIMIT 1`,
    [alliance_id, tenMinutesAgo]
  )[0];

  if (!scroll) {
    return { pointsChange, scrollTriggered: false, scrollType: null, scrollNote: '', redirectTarget: null };
  }

  let modified = pointsChange;
  let triggered = false;
  let scrollNote = '';
  let redirectTarget = null;

  if (scroll.scroll_type === 'orpheus_bargain') {
    // Halve any negative outcome (round toward zero)
    if (pointsChange < 0) {
      modified = Math.ceil(pointsChange / 2); // e.g. -10 → -5
      triggered = true;
      scrollNote = `Orpheus's Bargain: loss halved (${pointsChange} → ${modified})`;
    } else {
      // Positive fate — scroll wasted, no effect
      triggered = false;
      scrollNote = `Orpheus's Bargain: positive fate landed, no effect`;
    }
  }

  else if (scroll.scroll_type === 'echo_reflection') {
    // On steal/give (interactive) fates: redirect stolen points to next-ranked alliance
    // On non-interactive fates: no effect
    if (fateType === 'interactive' || fateType === 'steal_choice') {
      if (fateIsStealing) {
        // Spinner was stealing — redirect those points to next alliance above spinner on leaderboard
        const periodAlliances = query(
          `SELECT alliance_id, alliance_name, total_points FROM alliances
           WHERE class_period = ? AND is_disbanded = 0 ORDER BY total_points DESC`,
          [alliance.class_period]
        );
        const spinnerIdx = periodAlliances.findIndex(a => a.alliance_id === alliance_id);
        // Next alliance ranked ABOVE spinner (lower index = higher rank)
        const targetIdx = spinnerIdx > 0 ? spinnerIdx - 1 : null;
        if (targetIdx !== null) {
          redirectTarget = periodAlliances[targetIdx];
          triggered = true;
          scrollNote = `Echo's Reflection: steal redirected — points go to ${redirectTarget.alliance_name} instead`;
        } else {
          // Spinner is already top-ranked — reflection has nowhere to redirect
          triggered = false;
          scrollNote = `Echo's Reflection: spinner is top-ranked, no redirect possible`;
        }
      } else {
        // Give fate — not a steal, no effect
        triggered = false;
        scrollNote = `Echo's Reflection: give fate (not a steal), no effect`;
      }
    } else {
      triggered = false;
      scrollNote = `Echo's Reflection: non-interactive fate, no effect`;
    }
  }

  else if (scroll.scroll_type === 'psyche_lantern') {
    // Double any positive outcome
    if (pointsChange > 0) {
      modified = pointsChange * 2;
      triggered = true;
      scrollNote = `Psyche's Lantern: gain doubled (${pointsChange} → ${modified})`;
    } else {
      // Negative or zero fate — scroll wasted, no effect
      triggered = false;
      scrollNote = `Psyche's Lantern: negative/zero fate landed, no effect`;
    }
  }

  // Record triggered status on the scroll
  run(
    `UPDATE alliance_scrolls SET triggered = ? WHERE id = ?`,
    [triggered ? 'yes' : 'no', scroll.id]
  );

  console.log(`📜 Scroll [${scroll.scroll_type}]: ${scrollNote}`);

  return { pointsChange: modified, scrollTriggered: triggered, scrollType: scroll.scroll_type, scrollNote, redirectTarget };
}

app.post('/api/teacher/spin-fate', authenticateToken, (req, res) => {
  try {
    const { alliance_id, fate_id } = req.body;
    const teacher_id = req.user.id;
    
    // Get fate details
    const fate = query('SELECT * FROM fates_ref WHERE fate_id = ?', [fate_id])[0];
    if (!fate) {
      return res.status(404).json({ error: 'Fate not found' });
    }
    
    // Get alliance details
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    if (!alliance) {
      return res.status(404).json({ error: 'Alliance not found' });
    }
    
    let result = {
      fate,
      alliance,
      pointsChange: 0,
      resultType: fate.fate_type
    };

    // Resolve scroll modifier BEFORE any DB writes
    // We need to know the raw pointsChange first, then modify it
    let rawPointsChange = 0;
    let fateIsStealing = false;

    if (fate.fate_type === 'simple_points') {
      rawPointsChange = fate.point_effect || 0;
    } else if (fate.fate_type === 'interactive') {
      const allAlliancesForCount = query('SELECT alliance_id FROM alliances WHERE alliance_id != ? AND is_disbanded = 0', [alliance_id]);
      const transferAmount = fate.transfer_amount || 0;
      if (fate.steals_from_others) {
        rawPointsChange = transferAmount * allAlliancesForCount.length;
        fateIsStealing = true;
      } else if (fate.gives_to_others) {
        rawPointsChange = -(transferAmount * allAlliancesForCount.length);
      }
    }
    // battle and special: no pointsChange to modify, skip scroll resolution

    let scrollResult = { pointsChange: rawPointsChange, scrollTriggered: false, scrollType: null, scrollNote: '', redirectTarget: null };
    if (fate.fate_type === 'simple_points' || fate.fate_type === 'interactive') {
      scrollResult = applyScrollModifier(alliance_id, alliance, rawPointsChange, fate.fate_type, fateIsStealing);
    }
    const finalPointsChange = scrollResult.pointsChange;
    
    // Apply Granary/Shrine protection: reduce negative fate outcomes
    // Shrine of the Fates (-35%) overrides Granary (-30%)
    let granaryApplied = false;
    let protectionSource = null;
    let preGranaryPoints = finalPointsChange;
    let afterGranaryPoints = finalPointsChange;
    const buildingsOwnedForFate = JSON.parse(alliance.buildings_owned || '[]');
    if (buildingsOwnedForFate.includes('Shrine of the Fates') && finalPointsChange < 0) {
      afterGranaryPoints = Math.round(finalPointsChange * 0.65); // reduce loss by 35%
      granaryApplied = true;
      protectionSource = 'Shrine of the Fates';
      console.log(`🏛️ Shrine of the Fates protection: ${finalPointsChange} → ${afterGranaryPoints} for alliance ${alliance_id}`);
    } else if (buildingsOwnedForFate.includes('Granary') && finalPointsChange < 0) {
      afterGranaryPoints = Math.round(finalPointsChange * 0.7); // reduce loss by 30%
      granaryApplied = true;
      protectionSource = 'Granary';
      console.log(`🌾 Granary protection: ${finalPointsChange} → ${afterGranaryPoints} for alliance ${alliance_id}`);
    }
    const effectivePointsChange = granaryApplied ? afterGranaryPoints : finalPointsChange;
    
    // Process fate based on type (now using effectivePointsChange)
    if (fate.fate_type === 'simple_points') {
      run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
          [effectivePointsChange, alliance_id]);
      
      run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) 
           VALUES (?, ?, ?, ?, ?)`, 
          [alliance_id, effectivePointsChange, 'fate',
           `Fate: ${fate.fate_name}${granaryApplied ? ' [Granary -30%]' : ''}${scrollResult.scrollNote ? ' [' + scrollResult.scrollNote + ']' : ''}`, teacher_id]);
      
      result.pointsChange = effectivePointsChange;
    } 
    else if (fate.fate_type === 'interactive') {
      const allAlliances = query('SELECT alliance_id, total_points, alliance_name FROM alliances WHERE alliance_id != ? AND is_disbanded = 0', [alliance_id]);
      const transferAmount = fate.transfer_amount || 0;
      
      if (fate.steals_from_others) {
        if (scrollResult.scrollTriggered && scrollResult.redirectTarget) {
          // Echo's Reflection: stolen points go to next-ranked alliance instead of spinner
          const redirect = scrollResult.redirectTarget;
          const totalStolen = transferAmount * allAlliances.length;

          // Spinner gets nothing — redirect absorbs the steal
          allAlliances.forEach(other => {
            run('UPDATE alliances SET total_points = total_points - ? WHERE alliance_id = ?',
                [transferAmount, other.alliance_id]);
            run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) VALUES (?, ?, ?, ?, ?)`,
                [other.alliance_id, -transferAmount, 'fate',
                 `Fate: ${fate.fate_name} (Echo's Reflection — points redirected to ${redirect.alliance_name})`, teacher_id]);
          });
          run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?',
              [totalStolen, redirect.alliance_id]);
          run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) VALUES (?, ?, ?, ?, ?)`,
              [redirect.alliance_id, totalStolen, 'fate',
               `Fate: ${fate.fate_name} (Echo's Reflection redirect from ${alliance.alliance_name})`, teacher_id]);

          result.pointsChange = 0; // spinner received nothing
          result.echoRedirect = { allianceName: redirect.alliance_name, pointsReceived: totalStolen };
        } else {
          // Normal steal
          const totalGain = effectivePointsChange;
          run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
              [totalGain, alliance_id]);
          allAlliances.forEach(other => {
            run('UPDATE alliances SET total_points = total_points - ? WHERE alliance_id = ?', 
                [transferAmount, other.alliance_id]);
            run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) VALUES (?, ?, ?, ?, ?)`, 
                [other.alliance_id, -transferAmount, 'fate', `Fate: ${fate.fate_name} (stolen by ${alliance.alliance_name})`, teacher_id]);
          });
          run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) VALUES (?, ?, ?, ?, ?)`, 
              [alliance_id, totalGain, 'fate',
               `Fate: ${fate.fate_name} (stole from each alliance)${scrollResult.scrollNote ? ' [' + scrollResult.scrollNote + ']' : ''}`, teacher_id]);
          result.pointsChange = totalGain;
        }
      } 
      else if (fate.gives_to_others) {
        const totalLoss = Math.abs(effectivePointsChange); // Granary already applied to effectivePointsChange
        const perAlliance = transferAmount; // each other alliance still gets the base amount
        run('UPDATE alliances SET total_points = total_points - ? WHERE alliance_id = ?', 
            [totalLoss, alliance_id]);
        allAlliances.forEach(other => {
          run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
              [perAlliance, other.alliance_id]);
          run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) VALUES (?, ?, ?, ?, ?)`, 
              [other.alliance_id, perAlliance, 'fate', `Fate: ${fate.fate_name} (gift from ${alliance.alliance_name})`, teacher_id]);
        });
        run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) VALUES (?, ?, ?, ?, ?)`, 
            [alliance_id, -totalLoss, 'fate',
             `Fate: ${fate.fate_name} (gave to each alliance)${granaryApplied ? ' [Granary -30%]' : ''}${scrollResult.scrollNote ? ' [' + scrollResult.scrollNote + ']' : ''}`, teacher_id]);
        result.pointsChange = -totalLoss;
      }
    }
    else if (fate.fate_type === 'battle') {
      // Battle will be handled by separate endpoint
      result.needsBattle = true;
      result.battleInfo = {
        threatPercent: fate.battle_threat_percent,
        winPoints: fate.battle_win_points,
        losePoints: fate.battle_lose_points,
        description: fate.battle_description
      };
    }
    else if (fate.fate_type === 'special') {
      // Special fates (Countdown, Reverse Card) handled manually by teacher
      result.specialInstructions = fate.description;
    }

    result.scrollResult = scrollResult.scrollType ? scrollResult : null;
    result.granaryApplied = granaryApplied;
    if (granaryApplied) {
      result.granaryDetail = { before: preGranaryPoints, after: afterGranaryPoints, reduction: '30%' };
    }
    
    // Log the fate spin
    run(`INSERT INTO fate_spins (alliance_id, fate_id, fate_name, result_type, points_change, teacher_id) 
         VALUES (?, ?, ?, ?, ?, ?)`, 
        [alliance_id, fate_id, fate.fate_name, fate.fate_type, result.pointsChange, teacher_id]);
    
    // Check if alliance owns Oracle building (grants 1 free re-spin per week on negative fates)
    const buildingsOwned = JSON.parse(alliance.buildings_owned || '[]');
    const hasOracle = buildingsOwned.includes('Oracle');
    let oracleAvailable = false;
    
    if (hasOracle && result.pointsChange < 0) {
      // Check if Oracle re-spin was used this week (Sunday-Saturday)
      const now = new Date();
      const dayOfWeek = now.getDay(); // 0=Sunday
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - dayOfWeek);
      startOfWeek.setHours(0, 0, 0, 0);
      
      const respinUsed = query(
        `SELECT COUNT(*) as count FROM fate_spins 
         WHERE alliance_id = ? AND fate_name = 'Oracle Re-spin' AND spun_at >= ?`,
        [alliance_id, startOfWeek.toISOString()]
      )[0].count;
      
      oracleAvailable = respinUsed === 0;
    }
    
    result.oracleAvailable = oracleAvailable;
    result.hasOracle = hasOracle;
    
    // Get updated alliance
    const updatedAlliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    result.updatedAlliance = updatedAlliance;
    
    res.json(result);
  } catch (err) {
    console.error('Spin fate error:', err);
    res.status(500).json({ error: 'Failed to spin fate' });
  }
});

// Oracle Re-spin: Undo a negative fate and re-spin (1 per week per alliance)
app.post('/api/teacher/oracle-respin', authenticateToken, (req, res) => {
  try {
    const { alliance_id, original_spin_id, original_points_change } = req.body;
    const teacher_id = req.user.id;
    
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    if (!alliance) return res.status(404).json({ error: 'Alliance not found' });
    
    const buildingsOwned = JSON.parse(alliance.buildings_owned || '[]');
    if (!buildingsOwned.includes('Oracle')) {
      return res.status(400).json({ error: 'Alliance does not own an Oracle' });
    }
    
    // Check weekly usage
    const now = new Date();
    const dayOfWeek = now.getDay();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - dayOfWeek);
    startOfWeek.setHours(0, 0, 0, 0);
    
    const respinUsed = query(
      `SELECT COUNT(*) as count FROM fate_spins 
       WHERE alliance_id = ? AND fate_name = 'Oracle Re-spin' AND spun_at >= ?`,
      [alliance_id, startOfWeek.toISOString()]
    )[0].count;
    
    if (respinUsed > 0) {
      return res.status(400).json({ error: 'Oracle re-spin already used this week' });
    }
    
    // Reverse the negative fate points
    const reverseAmount = Math.abs(original_points_change);
    run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
        [reverseAmount, alliance_id]);
    
    run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) 
         VALUES (?, ?, ?, ?, ?)`, 
        [alliance_id, reverseAmount, 'fate', 'Oracle Re-spin: reversed negative fate', teacher_id]);
    
    // Log the re-spin usage
    run(`INSERT INTO fate_spins (alliance_id, fate_id, fate_name, result_type, points_change, teacher_id) 
         VALUES (?, ?, ?, ?, ?, ?)`, 
        [alliance_id, 0, 'Oracle Re-spin', 'special', reverseAmount, teacher_id]);
    
    saveDatabase();
    
    const updatedAlliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    
    res.json({ 
      success: true, 
      message: `The Oracle's prophecy has changed fate! ${reverseAmount} points restored.`,
      updatedAlliance
    });
  } catch (err) {
    console.error('Oracle respin error:', err);
    res.status(500).json({ error: 'Failed to use Oracle re-spin' });
  }
});

// Roll Battle
app.post('/api/teacher/roll-battle', authenticateToken, (req, res) => {
  try {
    const { alliance_id, fate_id } = req.body;
    const teacher_id = req.user.id;
    
    // Get alliance
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    if (!alliance) {
      return res.status(404).json({ error: 'Alliance not found' });
    }
    
    // Get fate for battle info
    const fate = query('SELECT * FROM fates_ref WHERE fate_id = ?', [fate_id])[0];
    if (!fate || !fate.is_battle) {
      return res.status(400).json({ error: 'Not a battle fate' });
    }
    
    // Use fate.fate_name instead of req.body.fate_name
    const fate_name = fate.fate_name;
    
    // Calculate alliance power (with bonuses)
    let alliancePower = alliance.total_points;
    
    // Apply technology bonuses (multiplicative) — exclude ghost players
    const members = query('SELECT student_id, technologies_unlocked FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)', [alliance_id]);
    let techMultiplier = 1.0;
    members.forEach(member => {
      const techs = JSON.parse(member.technologies_unlocked || '[]');
      const techDetails = query(`SELECT bonus_value, bonus_type FROM technologies_ref WHERE tech_name IN (${techs.map(() => '?').join(',')})`, techs);
      
      techDetails.forEach(tech => {
        if (tech.bonus_type === 'earning_multiplier') {
          techMultiplier *= (1 + tech.bonus_value);
        }
      });
    });
    
    alliancePower = Math.floor(alliancePower * techMultiplier);
    
    // Apply building bonuses (additive) - track for display
    const buildingsOwned = JSON.parse(alliance.buildings_owned || '[]');
    let wallBonus = 0;
    let wallType = null;
    
    if (buildingsOwned.includes('Stone Wall')) {
      wallBonus = 100;
      wallType = 'Stone Wall';
      alliancePower += 100;
    } else if (buildingsOwned.includes('Wooden Wall')) {
      wallBonus = 50;
      wallType = 'Wooden Wall';
      alliancePower += 50;
    }
    
    // Armory bonus: +150 battle power (additive, like walls)
    let armoryBonus = 0;
    if (buildingsOwned.includes('Armory')) {
      armoryBonus = 150;
      alliancePower += 150;
    }
    
    // Hero's Forge bonus: +200 battle power (Heroic Age upgrade to Armory)
    let forgeBonus = 0;
    if (buildingsOwned.includes("Hero's Forge")) {
      forgeBonus = 200;
      alliancePower += 200;
    }
    
    // Get all alliances to determine underdog status
    const allAlliances = query('SELECT alliance_id, total_points FROM alliances WHERE is_disbanded = 0 ORDER BY total_points DESC');
    
    // Calculate threat power based on CURRENT ALLIANCE's points (80% of their own points)
    const threatPercent = fate.battle_threat_percent || 0.80;
    const threatPower = Math.floor(alliance.total_points * threatPercent);
    
    // Apply Underdog Blessing (bottom team in each class period gets +25% power boost)
    // Get alliances in same period, sorted by points ascending (lowest first)
    const periodAlliances = query(
      'SELECT alliance_id, total_points FROM alliances WHERE class_period = ? AND is_disbanded = 0 ORDER BY total_points ASC',
      [alliance.class_period]
    );
    
    // Bottom team in the period is the first one (lowest points)
    const isUnderdog = periodAlliances.length > 0 && periodAlliances[0].alliance_id === alliance_id;
    
    if (isUnderdog) {
      alliancePower = Math.floor(alliancePower * 1.25);
    }
    
    // Update underdog blessing status
    run('UPDATE alliances SET underdog_blessing = ? WHERE alliance_id = ?', 
        [isUnderdog ? 1 : 0, alliance_id]);
    
    // Roll dice
    const allianceRoll = Math.floor(Math.random() * (alliancePower + 1));
    const threatRoll = Math.floor(Math.random() * (threatPower + 1));
    
    // Determine victory
    const victory = allianceRoll > threatRoll;
    let pointsChange = victory ? fate.battle_win_points : fate.battle_lose_points;
    
    // Granary/Shrine protection: reduce battle losses
    // Shrine of the Fates (-35%) overrides Granary (-30%)
    let battleGranaryApplied = false;
    let battleProtectionSource = null;
    if (buildingsOwned.includes('Shrine of the Fates') && pointsChange < 0) {
      const before = pointsChange;
      pointsChange = Math.round(pointsChange * 0.65);
      battleGranaryApplied = true;
      battleProtectionSource = 'Shrine of the Fates';
      console.log(`🏛️ Shrine of the Fates protection (battle): ${before} → ${pointsChange} for alliance ${alliance_id}`);
    } else if (buildingsOwned.includes('Granary') && pointsChange < 0) {
      const before = pointsChange;
      pointsChange = Math.round(pointsChange * 0.7);
      battleGranaryApplied = true;
      battleProtectionSource = 'Granary';
      console.log(`🌾 Granary protection (battle): ${before} → ${pointsChange} for alliance ${alliance_id}`);
    }
    
    // Apply points
    run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
        [pointsChange, alliance_id]);
    
    // Log transaction
    const battleResult = victory ? 'Victory' : 'Defeat';
    run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) 
         VALUES (?, ?, ?, ?, ?)`, 
        [alliance_id, pointsChange, 'battle', `Battle ${battleResult}: ${fate_name}${battleGranaryApplied ? ' [Granary -30%]' : ''}`, teacher_id]);
    
    // Log battle
    run(`INSERT INTO battle_events (alliance_id, fate_name, alliance_power, threat_power, alliance_roll, threat_roll, victory, points_change, teacher_id) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
        [alliance_id, fate_name, alliancePower, threatPower, allianceRoll, threatRoll, victory ? 1 : 0, pointsChange, teacher_id]);
    
    // Get updated alliance
    const updatedAlliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    
    // Get leader points (highest scoring alliance in same period)
    const leader = query(
      'SELECT MAX(total_points) as max_points FROM alliances WHERE class_period = ? AND is_disbanded = 0',
      [alliance.class_period]
    )[0];
    const leaderPoints = leader ? leader.max_points : alliance.total_points;
    
    res.json({
      victory,
      alliancePower,
      basePower: alliance.total_points,
      wallBonus,
      wallType,
      armoryBonus,
      forgeBonus,
      threatPower,
      allianceRoll,
      threatRoll,
      pointsChange,
      updatedAlliance,
      isUnderdog,
      leaderPoints
    });
  } catch (err) {
    console.error('Roll battle error:', err);
    res.status(500).json({ error: 'Failed to roll battle' });
  }
});

// Get today's fate spins
app.get('/api/teacher/fates-today', authenticateToken, (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const spins = query(`
      SELECT 
        fs.*,
        a.alliance_name
      FROM fate_spins fs
      JOIN alliances a ON fs.alliance_id = a.alliance_id
      WHERE DATE(fs.spun_at) = ?
      ORDER BY fs.spun_at DESC
    `, [today]);
    
    res.json(spins);
  } catch (err) {
    console.error('Get fates today error:', err);
    res.status(500).json({ error: 'Failed to get fate spins' });
  }
});

// Get all fates for wheel
app.get('/api/teacher/fates', authenticateToken, (req, res) => {
  try {
    const age = req.query.age || 'Archaic';
    const fates = query('SELECT * FROM fates_ref WHERE age_available = ? ORDER BY fate_number', [age]);
    res.json(fates);
  } catch (err) {
    console.error('Get fates error:', err);
    res.status(500).json({ error: 'Failed to get fates' });
  }
});

// Get random Athena's Challenge question by difficulty
app.get('/api/teacher/athena-challenge', authenticateToken, (req, res) => {
  try {
    const difficulty = req.query.difficulty || 'conservative';
    const validDifficulties = ['conservative', 'moderate', 'aggressive'];
    if (!validDifficulties.includes(difficulty)) {
      return res.status(400).json({ error: 'Invalid difficulty. Use conservative, moderate, or aggressive.' });
    }
    const questions = query('SELECT * FROM athena_challenge_questions WHERE difficulty = ?', [difficulty]);
    if (!questions || questions.length === 0) {
      return res.status(404).json({ error: 'No questions found for this difficulty' });
    }
    // Pick a random question
    const randomQ = questions[Math.floor(Math.random() * questions.length)];
    res.json({
      question_id: randomQ.question_id,
      difficulty: randomQ.difficulty,
      question: randomQ.question,
      options: [
        { letter: 'A', text: randomQ.option_a },
        { letter: 'B', text: randomQ.option_b },
        { letter: 'C', text: randomQ.option_c },
        { letter: 'D', text: randomQ.option_d }
      ],
      correct_answer: randomQ.correct_answer,
      myth_source: randomQ.myth_source
    });
  } catch (err) {
    console.error('Athena challenge error:', err);
    res.status(500).json({ error: 'Failed to get Athena challenge question' });
  }
});

// Get student personal contributions
app.get('/api/student/my-contributions', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    
    // Get student's alliance
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    
    if (!student || !student.alliance_id) {
      return res.json({
        contributions: [],
        totalContribution: 0,
        allianceTotal: 0
      });
    }
    
    const alliance_id = student.alliance_id;
    
    // Get all transactions: personal + alliance-wide (fates/battles)
    const contributions = query(`
      SELECT 
        pt.amount,
        pt.category,
        pt.reason,
        pt.timestamp,
        pt.student_id,
        CASE 
          WHEN pt.student_id = ? THEN 'personal'
          ELSE 'alliance'
        END as source
      FROM point_transactions pt
      WHERE (pt.student_id = ? OR (pt.alliance_id = ? AND pt.student_id IS NULL))
      ORDER BY pt.timestamp DESC
      LIMIT 50
    `, [student_id, student_id, alliance_id]);
    
    // Get total personal contribution (only this student's)
    const personalTotal = query(`
      SELECT SUM(amount) as total
      FROM point_transactions
      WHERE student_id = ?
    `, [student_id])[0];
    
    // Get alliance total
    const alliance = query('SELECT total_points FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    
    res.json({
      contributions,
      totalContribution: personalTotal.total || 0,
      allianceTotal: alliance.total_points || 0
    });
  } catch (err) {
    console.error('Get contributions error:', err);
    res.status(500).json({ error: 'Failed to get contributions' });
  }
});

// ====================
// SIDE QUEST SYSTEM
// ====================

// Get all side quests with student's completion status
app.get('/api/student/side-quests', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    
    if (!student || !student.alliance_id) {
      return res.json({ error: 'Not in an alliance', hasAlliance: false, quests: [] });
    }
    
    // Get alliance's current age to filter quests
    const alliance = query('SELECT current_age FROM alliances WHERE alliance_id = ?', [student.alliance_id])[0];
    const currentAge = alliance ? alliance.current_age : 'Archaic';
    
    // Only show quests available at or below the alliance's current age
    const ageFilter = currentAge === 'Heroic' ? "'Archaic','Classical','Heroic'" :
                      currentAge === 'Classical' ? "'Archaic','Classical'" : "'Archaic'";
    
    // Get side quests filtered by age
    const quests = query(`SELECT * FROM side_quests_ref WHERE age IN (${ageFilter}) ORDER BY quest_id`);
    
    // Get this student's completions
    const myCompletions = query(
      'SELECT quest_id, status FROM side_quest_completions WHERE student_id = ?',
      [student_id]
    );
    const myCompletionMap = {};
    myCompletions.forEach(c => { myCompletionMap[c.quest_id] = c.status; });
    
    // Get all REAL alliance members (ghosts don't do side quests)
    const allianceMembers = query(
      'SELECT student_id, name FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)',
      [student.alliance_id]
    );
    const memberCount = allianceMembers.length;
    
    // Get alliance completions for each quest
    const questsWithStatus = quests.map(quest => {
      // Get all approved completions for this quest in this alliance
      const approvedCompletions = query(
        `SELECT sqc.student_id, s.name 
         FROM side_quest_completions sqc
         JOIN students s ON sqc.student_id = s.student_id
         WHERE sqc.quest_id = ? AND sqc.alliance_id = ? AND sqc.status = 'approved'`,
        [quest.quest_id, student.alliance_id]
      );
      
      const pendingCompletions = query(
        `SELECT sqc.student_id, s.name 
         FROM side_quest_completions sqc
         JOIN students s ON sqc.student_id = s.student_id
         WHERE sqc.quest_id = ? AND sqc.alliance_id = ? AND sqc.status = 'pending'`,
        [quest.quest_id, student.alliance_id]
      );
      
      const completedCount = approvedCompletions.length;
      const allComplete = completedCount === memberCount;
      
      // Check if alliance has earned this reward
      const rewardEarned = allComplete;
      
      return {
        ...quest,
        my_status: myCompletionMap[quest.quest_id] || 'not_started',
        completed_members: approvedCompletions.map(c => c.name),
        pending_members: pendingCompletions.map(c => c.name),
        completed_count: completedCount,
        member_count: memberCount,
        all_complete: allComplete,
        reward_earned: rewardEarned
      };
    });
    
    // Get alliance's earned technologies
    const earnedTechs = query(
      'SELECT tech_name FROM alliance_technologies WHERE alliance_id = ?',
      [student.alliance_id]
    ).map(t => t.tech_name);
    
    res.json({
      hasAlliance: true,
      quests: questsWithStatus,
      earned_technologies: earnedTechs,
      alliance_members: allianceMembers.map(m => m.name)
    });
  } catch (err) {
    console.error('Get side quests error:', err);
    res.status(500).json({ error: 'Failed to fetch side quests' });
  }
});

// Student: Submit side quest completion for approval
app.post('/api/student/submit-side-quest', authenticateToken, (req, res) => {
  try {
    const { quest_id } = req.body;
    const student_id = req.user.id;
    
    console.log('Student submitting side quest:', { student_id, quest_id });
    
    const student = query('SELECT alliance_id, name FROM students WHERE student_id = ?', [student_id])[0];
    if (!student || !student.alliance_id) {
      return res.status(400).json({ error: 'You must be in an alliance to submit side quests' });
    }
    
    // Check if quest exists
    const quest = query('SELECT * FROM side_quests_ref WHERE quest_id = ?', [quest_id])[0];
    if (!quest) {
      console.log('Quest not found:', quest_id);
      return res.status(404).json({ error: 'Side quest not found' });
    }
    
    // Check if alliance is in the right age for this quest
    const alliance = query('SELECT current_age FROM alliances WHERE alliance_id = ?', [student.alliance_id])[0];
    const currentAge = alliance ? alliance.current_age : 'Archaic';
    const allowedAges = currentAge === 'Heroic' ? ['Archaic','Classical','Heroic'] :
                        currentAge === 'Classical' ? ['Archaic','Classical'] : ['Archaic'];
    if (!allowedAges.includes(quest.age || 'Archaic')) {
      return res.status(403).json({ error: 'This quest is not available in your current age' });
    }
    
    // Check if already submitted
    const existing = query(
      'SELECT * FROM side_quest_completions WHERE student_id = ? AND quest_id = ?',
      [student_id, quest_id]
    );
    if (existing.length > 0) {
      console.log('Already submitted:', existing[0]);
      return res.status(400).json({ error: 'You have already submitted this quest' });
    }
    
    // Create submission
    run(`INSERT INTO side_quest_completions (student_id, quest_id, alliance_id, status)
         VALUES (?, ?, ?, 'pending')`,
        [student_id, quest_id, student.alliance_id]);
    
    // Save database
    saveDatabase();
    
    console.log('Side quest submission created successfully');
    
    res.json({ 
      success: true, 
      message: `Quest completion submitted! Awaiting teacher approval.` 
    });
  } catch (err) {
    console.error('Submit side quest error:', err);
    res.status(500).json({ error: 'Failed to submit side quest' });
  }
});

// Teacher: Get pending side quest approvals
app.get('/api/teacher/side-quest-approvals', authenticateToken, (req, res) => {
  try {
    const teacher_id = req.user.id;
    const { period } = req.query;
    
    let baseQuery = `
      SELECT sqc.*, sq.quest_name, sq.god_associated, sq.reward_name,
             s.name as student_name, s.class_period, a.alliance_name
      FROM side_quest_completions sqc
      JOIN side_quests_ref sq ON sqc.quest_id = sq.quest_id
      JOIN students s ON sqc.student_id = s.student_id
      JOIN alliances a ON sqc.alliance_id = a.alliance_id
    `;
    
    const periodFilter = (period && period !== 'all') ? ` AND s.class_period = '${period}'` : '';
    
    const pending = query(baseQuery + ` WHERE sqc.status = 'pending'` + periodFilter + ' ORDER BY sqc.submitted_at DESC');
    // V91: Also return recently approved so teacher can unapprove accidental approvals
    const approved = query(baseQuery + ` WHERE sqc.status = 'approved'` + periodFilter + ' ORDER BY sqc.reviewed_at DESC LIMIT 20');
    
    res.json({ pending, approved });
  } catch (err) {
    console.error('Get side quest approvals error:', err);
    res.status(500).json({ error: 'Failed to fetch side quest approvals' });
  }
});

// Teacher: Approve side quest completion
app.post('/api/teacher/approve-side-quest', authenticateToken, (req, res) => {
  try {
    const { completion_id } = req.body;
    const teacher_id = req.user.id;
    
    console.log('Approving side quest completion:', completion_id);
    
    const completion = query('SELECT * FROM side_quest_completions WHERE completion_id = ?', [completion_id])[0];
    if (!completion) {
      return res.status(404).json({ error: 'Completion not found' });
    }
    
    console.log('Completion found:', completion);
    
    if (completion.status !== 'pending') {
      return res.status(400).json({ error: `Completion already reviewed (status: ${completion.status})` });
    }
    
    // Approve the completion
    run(`UPDATE side_quest_completions 
         SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by_teacher_id = ?
         WHERE completion_id = ?`,
        [teacher_id, completion_id]);
    
    // Save to persist
    saveDatabase();
    
    // Check if ALL alliance members have now completed this quest (info only - teacher must manually grant in God Assignments)
    const quest = query('SELECT * FROM side_quests_ref WHERE quest_id = ?', [completion.quest_id])[0];
    const allianceMembers = query('SELECT student_id FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)', [completion.alliance_id]);
    const approvedCompletions = query(
      `SELECT * FROM side_quest_completions 
       WHERE quest_id = ? AND alliance_id = ? AND status = 'approved'`,
      [completion.quest_id, completion.alliance_id]
    );
    
    console.log(`Alliance members: ${allianceMembers.length}, Approved completions: ${approvedCompletions.length}`);
    
    const allComplete = approvedCompletions.length === allianceMembers.length;
    
    const student = query('SELECT name FROM students WHERE student_id = ?', [completion.student_id])[0];
    const alliance = query('SELECT alliance_name FROM alliances WHERE alliance_id = ?', [completion.alliance_id])[0];
    
    let message = `Approved ${student.name}'s completion of ${quest.quest_name}`;
    if (allComplete) {
      message += ` — ALL members of ${alliance.alliance_name} are now approved!`;
      
      // Auto-grant Reverse Card for Forbidden Archive
      if (quest.quest_name === 'The Forbidden Archive') {
        const currentCards = query('SELECT reverse_cards FROM alliances WHERE alliance_id = ?', [completion.alliance_id])[0];
        const cardsNow = currentCards ? (currentCards.reverse_cards || 0) : 0;
        run('UPDATE alliances SET reverse_cards = ? WHERE alliance_id = ?', [cardsNow + 1, completion.alliance_id]);
        saveDatabase();
        message += ` 🔄 Reverse Card awarded to ${alliance.alliance_name}!`;
        console.log(`🔄 Reverse Card awarded to alliance ${completion.alliance_id} (${alliance.alliance_name})`);
      } else {
        message += ` Go to Grant God Assignments to grant the reward.`;
      }
    } else {
      message += ` (${approvedCompletions.length}/${allianceMembers.length} members approved)`;
    }
    
    res.json({ 
      success: true, 
      message,
      all_members_complete: allComplete,
      approved_count: approvedCompletions.length,
      member_count: allianceMembers.length
    });
  } catch (err) {
    console.error('Approve side quest error:', err);
    res.status(500).json({ error: 'Failed to approve side quest' });
  }
});

// Teacher: Reject side quest completion
app.post('/api/teacher/reject-side-quest', authenticateToken, (req, res) => {
  try {
    const { completion_id, teacher_notes } = req.body;
    const teacher_id = req.user.id;
    
    const completion = query('SELECT * FROM side_quest_completions WHERE completion_id = ?', [completion_id])[0];
    if (!completion) {
      return res.status(404).json({ error: 'Completion not found' });
    }
    
    if (completion.status !== 'pending') {
      return res.status(400).json({ error: 'Completion already reviewed' });
    }
    
    // Reject - delete the record so they can resubmit
    run('DELETE FROM side_quest_completions WHERE completion_id = ?', [completion_id]);
    
    res.json({ 
      success: true, 
      message: 'Side quest completion rejected. Student can resubmit.' 
    });
  } catch (err) {
    console.error('Reject side quest error:', err);
    res.status(500).json({ error: 'Failed to reject side quest' });
  }
});




// Teacher: Unapprove (reverse) an approved side quest completion — V91 FIX
app.post('/api/teacher/unapprove-side-quest', authenticateToken, (req, res) => {
  try {
    const { completion_id } = req.body;
    const teacher_id = req.user.id;

    const completion = query('SELECT * FROM side_quest_completions WHERE completion_id = ?', [completion_id])[0];
    if (!completion) {
      return res.status(404).json({ error: 'Completion not found' });
    }

    if (completion.status !== 'approved') {
      return res.status(400).json({ error: `Cannot unapprove — status is '${completion.status}', not 'approved'` });
    }

    // Revert to pending so student can see it again and teacher can re-review
    run(`UPDATE side_quest_completions SET status = 'pending', reviewed_at = NULL, reviewed_by_teacher_id = NULL WHERE completion_id = ?`, [completion_id]);
    saveDatabase();

    const student = query('SELECT name FROM students WHERE student_id = ?', [completion.student_id])[0];
    const quest = query('SELECT quest_name FROM side_quests_ref WHERE quest_id = ?', [completion.quest_id])[0];

    res.json({
      success: true,
      message: `Reversed approval for ${student ? student.name : 'student'}'s ${quest ? quest.quest_name : 'side quest'}. Status reset to pending.`
    });
  } catch (err) {
    console.error('Unapprove side quest error:', err);
    res.status(500).json({ error: 'Failed to unapprove side quest' });
  }
});

// Get alliance technologies (for applying bonuses)
app.get('/api/alliance/technologies/:alliance_id', authenticateToken, (req, res) => {
  try {
    const { alliance_id } = req.params;
    
    const technologies = query(
      'SELECT * FROM alliance_technologies WHERE alliance_id = ?',
      [alliance_id]
    );
    
    res.json({ technologies });
  } catch (err) {
    console.error('Get alliance technologies error:', err);
    res.status(500).json({ error: 'Failed to fetch technologies' });
  }
});

// Teacher: Get eligible alliances for a side quest reward
app.get('/api/teacher/eligible-alliances-for-quest', authenticateToken, (req, res) => {
  try {
    const { quest_id } = req.query;
    
    if (!quest_id) {
      return res.status(400).json({ error: 'quest_id required' });
    }
    
    // Get the quest info
    const quest = query('SELECT * FROM side_quests_ref WHERE quest_id = ?', [quest_id])[0];
    if (!quest) {
      return res.status(404).json({ error: 'Quest not found' });
    }
    
    // Get all active alliances (only count real members, not ghosts)
    const alliances = query(`
      SELECT a.alliance_id, a.alliance_name, a.class_period,
             COUNT(s.student_id) as member_count
      FROM alliances a
      JOIN students s ON a.alliance_id = s.alliance_id AND (s.is_ghost = 0 OR s.is_ghost IS NULL)
      WHERE a.is_disbanded = 0
      GROUP BY a.alliance_id
    `);
    
    // For each alliance, check how many members have approved completions for this quest
    const eligibleAlliances = [];
    
    for (const alliance of alliances) {
      const approvedCount = query(`
        SELECT COUNT(*) as count FROM side_quest_completions
        WHERE quest_id = ? AND alliance_id = ? AND status = 'approved'
      `, [quest_id, alliance.alliance_id])[0].count;
      
      // Check if this alliance already has the reward
      const alreadyHasReward = query(
        'SELECT * FROM alliance_technologies WHERE alliance_id = ? AND tech_name = ?',
        [alliance.alliance_id, quest.reward_name]
      ).length > 0;
      
      // Eligible if ALL members approved and reward not yet granted
      if (approvedCount >= alliance.member_count && !alreadyHasReward) {
        eligibleAlliances.push({
          alliance_id: alliance.alliance_id,
          alliance_name: alliance.alliance_name,
          class_period: alliance.class_period,
          member_count: alliance.member_count,
          approved_count: approvedCount
        });
      }
    }
    
    res.json({ quest, eligible_alliances: eligibleAlliances });
  } catch (err) {
    console.error('Get eligible alliances error:', err);
    res.status(500).json({ error: 'Failed to fetch eligible alliances' });
  }
});

// Teacher: Grant side quest reward to an alliance
app.post('/api/teacher/grant-side-quest-reward', authenticateToken, (req, res) => {
  try {
    const { quest_id, alliance_id } = req.body;
    const teacher_id = req.user.id;
    
    if (!quest_id || !alliance_id) {
      return res.status(400).json({ error: 'quest_id and alliance_id required' });
    }
    
    // Get quest info
    const quest = query('SELECT * FROM side_quests_ref WHERE quest_id = ?', [quest_id])[0];
    if (!quest) {
      return res.status(404).json({ error: 'Quest not found' });
    }
    
    // Verify alliance exists
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    if (!alliance) {
      return res.status(404).json({ error: 'Alliance not found' });
    }
    
    // Check if reward already granted
    const existingTech = query(
      'SELECT * FROM alliance_technologies WHERE alliance_id = ? AND tech_name = ?',
      [alliance_id, quest.reward_name]
    );
    if (existingTech.length > 0) {
      return res.status(400).json({ error: `${alliance.alliance_name} already has ${quest.reward_name}` });
    }
    
    // Verify all LIVING members have approved completions (exclude ghosts)
    const memberCount = query('SELECT COUNT(*) as count FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)', [alliance_id])[0].count;
    const approvedCount = query(
      'SELECT COUNT(*) as count FROM side_quest_completions WHERE quest_id = ? AND alliance_id = ? AND status = ?',
      [quest_id, alliance_id, 'approved']
    )[0].count;
    
    if (approvedCount < memberCount) {
      return res.status(400).json({ error: `Only ${approvedCount}/${memberCount} members approved. All members must complete the quest.` });
    }
    
    // Grant the technology reward
    run(`INSERT INTO alliance_technologies (alliance_id, tech_name, source_quest_id) VALUES (?, ?, ?)`,
        [alliance_id, quest.reward_name, quest_id]);
    
    // Track the reward on the alliance for emoji display
    const currentRewards = JSON.parse(alliance.side_quest_rewards || '[]');
    if (!currentRewards.includes(parseInt(quest_id))) {
      currentRewards.push(parseInt(quest_id));
      run('UPDATE alliances SET side_quest_rewards = ? WHERE alliance_id = ?',
          [JSON.stringify(currentRewards), alliance_id]);
    }
    
    // Get the emoji for the reward
    const rewardEmojis = { 1: '🔨', 2: '🏹', 3: '🌾' };
    const emoji = rewardEmojis[parseInt(quest_id)] || '⭐';
    
    saveDatabase();
    
    console.log(`🏆 Granted ${quest.reward_name} to ${alliance.alliance_name} for completing ${quest.quest_name}`);
    
    res.json({
      success: true,
      message: `${quest.reward_name} granted to ${alliance.alliance_name}!`,
      reward_name: quest.reward_name,
      reward_description: quest.reward_description || quest.reward_name
    });
  } catch (err) {
    console.error('Grant side quest reward error:', err);
    res.status(500).json({ error: 'Failed to grant side quest reward' });
  }
});

// Teacher: Quest & Bonus Tracker - shows completion grid for side quests and bonus assignments
app.get('/api/teacher/quest-bonus-tracker', authenticateToken, (req, res) => {
  try {
    const { period, age } = req.query;
    const trackerAge = age || 'Archaic'; // Default to Archaic
    
    // Get students, optionally filtered by period (exclude ghosts from student grid)
    let studentsQuery = `
      SELECT s.student_id, s.name, s.class_period, s.alliance_id, s.is_ghost
      FROM students s
      WHERE (s.is_ghost = 0 OR s.is_ghost IS NULL)
      ORDER BY s.class_period, s.name
    `;
    let students = query(studentsQuery);
    
    if (period && period !== 'all') {
      students = students.filter(s => s.class_period === period);
    }
    
    // Get side quests filtered by age
    const sideQuests = query("SELECT * FROM side_quests_ref WHERE age = ? ORDER BY quest_id", [trackerAge]);
    
    // Get bonus assignments filtered by age
    // Classical bonuses are excluded — they now live inside myth portals as post-quiz creative work
    const bonusAssignments = trackerAge === 'Classical' ? [] : query(`
      SELECT * FROM assignments_ref 
      WHERE section = 'bonus' AND age = ?
      ORDER BY assignment_id
    `, [trackerAge]);
    
    // Get all approved side quest completions
    const allSideQuestCompletions = query(`
      SELECT student_id, quest_id FROM side_quest_completions WHERE status = 'approved'
    `);
    
    // Build a lookup: { student_id: { quest_id: true } }
    const sqLookup = {};
    allSideQuestCompletions.forEach(c => {
      if (!sqLookup[c.student_id]) sqLookup[c.student_id] = {};
      sqLookup[c.student_id][c.quest_id] = true;
    });
    
    // Get all bonus grade records — any points earned counts as complete
    const allBonusRecords = query(`
      SELECT gr.student_id, gr.assignment_id, gr.points_earned, ar.max_points
      FROM grade_records gr
      JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
      WHERE ar.section = 'bonus' AND gr.points_earned > 0
    `);
    
    // Build a lookup: { student_id: { assignment_id: true } } - any points earned = complete
    const bonusLookup = {};
    allBonusRecords.forEach(r => {
      if (!bonusLookup[r.student_id]) bonusLookup[r.student_id] = {};
      bonusLookup[r.student_id][r.assignment_id] = r.points_earned > 0;
    });
    
    // Build student response objects
    const studentsWithStatus = students.map(s => ({
      student_id: s.student_id,
      name: s.name,
      class_period: s.class_period || 'Unassigned',
      alliance_id: s.alliance_id,
      is_ghost: s.is_ghost ? 1 : 0,
      side_quests: sqLookup[s.student_id] || {},
      bonuses: bonusLookup[s.student_id] || {}
    }));
    
    // Build alliance-level god bonus tracking (for Athena, Ares, Poseidon building unlocks) - Archaic only
    let allianceGodStatus = null;
    if (trackerAge === 'Archaic') {
      const buildingGods = ['Athena', 'Ares', 'Poseidon'];
      allianceGodStatus = {};
    
    // Get all alliances
    const allAlliances = query(`
      SELECT a.alliance_id, a.alliance_name, a.class_period
      FROM alliances a WHERE a.is_disbanded = 0
    `);
    
    // Get existing god assignments
    const existingGodAssignments = query('SELECT * FROM god_assignments');
    const godAssignmentLookup = {};
    existingGodAssignments.forEach(ga => {
      const key = `${ga.alliance_id}-${ga.god_name}`;
      godAssignmentLookup[key] = true;
    });
    
    for (const alliance of allAlliances) {
      const members = studentsWithStatus.filter(s => s.alliance_id === alliance.alliance_id && !s.is_ghost);
      if (members.length === 0) continue;
      
      allianceGodStatus[alliance.alliance_id] = {
        alliance_name: alliance.alliance_name,
        class_period: alliance.class_period,
        member_count: members.length,
        gods: {}
      };
      
      for (const god of buildingGods) {
        const bonusAssignment = bonusAssignments.find(a => a.myth_god === god);
        if (!bonusAssignment) continue;
        
        const qualifiedCount = members.filter(m => 
          m.bonuses[bonusAssignment.assignment_id] === true
        ).length;
        
        const isGranted = godAssignmentLookup[`${alliance.alliance_id}-${god}`] || false;
        
        allianceGodStatus[alliance.alliance_id].gods[god] = {
          qualified: qualifiedCount,
          total: members.length,
          all_qualified: qualifiedCount >= members.length,
          granted: isGranted
        };
      }
    }
    } // end Archaic-only god status block
    
    res.json({
      students: studentsWithStatus,
      side_quests: sideQuests,
      bonus_assignments: bonusAssignments,
      alliance_god_status: allianceGodStatus
    });
  } catch (err) {
    console.error('Quest bonus tracker error:', err);
    res.status(500).json({ error: 'Failed to load quest bonus tracker' });
  }
});

// ====================
// BATTLE ARENA SYSTEM
// ====================

// BATTLE TIMING CONSTANTS (in milliseconds)
const BATTLE_TIMING = {
  DEPLOY_PHASE: 12000,    // God selection phase: 12 seconds
  QUESTION_PHASE: 20000,  // Question answering phase: 20 seconds
  RESULTS_PHASE: 5000,    // Results display phase: 5 seconds
  ANSWER_FEEDBACK: 3000,  // Time to show correct/wrong after answering: 3 seconds
  SYNC_DELAY: 2000,       // Delay after both ready before showing question/results: 2 seconds
  SUDDEN_DEATH_DEPLOY: 12000,  // Sudden death god selection
  SUDDEN_DEATH_INTRO: 30000    // Sudden death intro screen timeout: 30 seconds
};

// Get a random question, excluding already-used IDs (Fisher-Yates shuffle)
function getRandomQuestion(excludeIds = []) {
  let questions;
  if (excludeIds.length > 0) {
    const placeholders = excludeIds.map(() => '?').join(',');
    questions = query(`SELECT * FROM battle_questions WHERE is_active = 1 AND question_id NOT IN (${placeholders})`, excludeIds);
  } else {
    questions = query('SELECT * FROM battle_questions WHERE is_active = 1');
  }
  
  if (questions.length === 0) {
    // All questions used - reset and pick any
    questions = query('SELECT * FROM battle_questions WHERE is_active = 1');
    if (questions.length === 0) return null;
  }
  
  // Fisher-Yates shuffle
  for (let i = questions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [questions[i], questions[j]] = [questions[j], questions[i]];
  }
  
  return questions[0];
}

// GOD POWERS CONFIGURATION
const GOD_POWERS = {
  // OFFENSIVE GODS
  zeus: {
    type: 'offensive',
    name: 'Lightning Strike',
    description: 'Screen flash blinds opponent',
    baseEffect: 2, // seconds
    bonusEffect: 3, // with 50% bonus
    counteredBy: 'hera',
    emoji: '⚡'
  },
  poseidon: {
    type: 'offensive',
    name: 'Tidal Wave',
    description: 'Answers swim around screen',
    baseEffect: 3,
    bonusEffect: 4.5,
    counteredBy: 'athena',
    emoji: '🔱'
  },
  ares: {
    type: 'offensive',
    name: 'War Cry',
    description: 'Screen shake and loud sound',
    baseEffect: 2,
    bonusEffect: 3,
    counteredBy: 'aphrodite',
    emoji: '⚔️'
  },
  hades: {
    type: 'offensive',
    name: 'Darkness',
    description: 'Screen goes dark',
    baseEffect: 2,
    bonusEffect: 3,
    counteredBy: 'apollo',
    emoji: '💀'
  },
  hephaestus: {
    type: 'offensive',
    name: 'Forge Fire',
    description: 'Answers appear on fire (hard to read)',
    baseEffect: 2,
    bonusEffect: 3,
    counteredBy: 'artemis',
    emoji: '🔨'
  },
  hermes: {
    type: 'offensive',
    name: 'Speed Steal',
    description: 'Opponent clicks delayed',
    baseEffect: 1,
    bonusEffect: 1.5,
    counteredBy: 'demeter',
    emoji: '🪽'
  },
  // SPECIAL GOD
  prometheus: {
    type: 'special',
    name: 'Gift of Fire',
    description: 'See question early (once per day)',
    baseEffect: 5, // seconds early (increased from 2 for readability)
    bonusEffect: 7,
    counteredBy: null, // cannot be blocked
    emoji: '🔥',
    oncePerDay: true
  },
  // DEFENSIVE GODS
  hera: {
    type: 'defensive',
    name: 'Queen\'s Shield',
    description: 'Blocks Zeus lightning',
    blocks: 'zeus',
    passive: 'Opponent\'s click delayed 1 sec',
    passiveEffect: 1,
    bonusPassiveEffect: 1.5,
    emoji: '🦚'
  },
  athena: {
    type: 'defensive',
    name: 'Wisdom',
    description: 'Blocks Poseidon wave',
    blocks: 'poseidon',
    passive: 'Remove 1 wrong answer',
    passiveEffect: 1, // answers removed
    bonusPassiveEffect: 2, // 50/50
    emoji: '🦉'
  },
  apollo: {
    type: 'defensive',
    name: 'Light of Truth',
    description: 'Blocks Hades darkness',
    blocks: 'hades',
    passive: 'Correct answer glows for 1 sec',
    passiveEffect: 1,
    bonusPassiveEffect: 1.5,
    emoji: '☀️'
  },
  artemis: {
    type: 'defensive',
    name: 'Hunter\'s Focus',
    description: 'Blocks Hephaestus fire',
    blocks: 'hephaestus',
    passive: 'Answer in first 5 sec = +0.5 battle score',
    passiveEffect: 0.5,
    bonusPassiveEffect: 0.75,
    emoji: '🏹'
  },
  aphrodite: {
    type: 'defensive',
    name: 'Charm',
    description: 'Blocks Ares war cry',
    blocks: 'ares',
    passive: 'If wrong, 4 sec to retry with different answer',
    passiveEffect: 4,
    bonusPassiveEffect: 5,
    emoji: '💕'
  },
  demeter: {
    type: 'defensive',
    name: 'Harvest Shield',
    description: 'Blocks Hermes speed steal',
    blocks: 'hermes',
    passive: 'Enemy effects last 50% shorter',
    passiveEffect: 0.5, // multiplier
    bonusPassiveEffect: 0.25, // 75% shorter
    emoji: '🌾'
  }
};

// Helper function to check if student has god bonus completed
function hasGodBonus(student_id, godName) {
  try {
    const colName = `pantheon_${godName.toLowerCase()}_bonus_seen`;
    const progress = query(`SELECT ${colName} FROM student_achievement_progress WHERE student_id = ?`, [student_id])[0];
    return progress && progress[colName] === 1;
  } catch (err) {
    return false;
  }
}

// Helper function to check if student has god unlocked
function hasGodUnlocked(student_id, godName) {
  try {
    const colName = `pantheon_${godName.toLowerCase()}_unlocked`;
    const progress = query(`SELECT ${colName} FROM student_achievement_progress WHERE student_id = ?`, [student_id])[0];
    return progress && progress[colName] === 1;
  } catch (err) {
    return false;
  }
}

// DEPRECATED by FIX 8/9: Prometheus is now once-per-battle, not once-per-day
// This function is no longer called but kept for reference
function prometheusUsedToday(student_id) {
  const today = new Date().toISOString().split('T')[0];
  const stats = query('SELECT prometheus_used_date FROM arena_battle_stats WHERE student_id = ?', [student_id])[0];
  return stats && stats.prometheus_used_date === today;
}

// Helper function to count total battles today (as challenger OR defender)
function countBattlesToday(student_id) {
  const today = new Date().toISOString().split('T')[0];
  const result = query(`
    SELECT COUNT(*) as count FROM arena_battles 
    WHERE (challenger_id = ? OR defender_id = ?)
    AND status IN ('in_progress', 'completed')
    AND DATE(started_at) = ?
  `, [student_id, student_id, today])[0];
  return result ? result.count : 0;
}

// Maximum battles per student per day (absolute ceiling)
const MAX_BATTLES_PER_DAY = 6;

// ==================== BADGE SYSTEM ====================

const ARENA_BADGES = {
  // Tier 1 — Newcomer
  first_blood:     { name: 'First Blood',      icon: '🗡️',  tier: 1, hidden: false, desc: 'Win your first battle' },
  trial_by_fire:   { name: 'Trial by Fire',    icon: '🛡️',  tier: 1, hidden: false, desc: 'Fight 5 battles' },
  athenas_favor:   { name: "Athena's Favor",   icon: '⚡',   tier: 1, hidden: false, desc: 'Answer a question correctly in under 3 seconds' },
  // Tier 2 — Warrior
  spartan_grit:    { name: 'Spartan Grit',     icon: '⚔️',  tier: 2, hidden: false, desc: 'Win 10 battles' },
  on_fire:         { name: 'On Fire',          icon: '🔥',   tier: 2, hidden: false, desc: 'Win 3 in a row' },
  tactician:       { name: 'Tactician',        icon: '🎯',   tier: 2, hidden: false, desc: 'Win using 3 different gods' },
  comeback_kid:    { name: 'Comeback Kid',     icon: '💪',   tier: 2, hidden: false, desc: 'Win after being down 2+ rounds' },
  shapeshifter:    { name: 'Shapeshifter',     icon: '🎭',   tier: 2, hidden: false, desc: 'Win 3 in a row with different primary god each battle' },
  // Tier 3 — Elite
  champion:        { name: 'Champion',         icon: '🏆',   tier: 3, hidden: false, desc: 'Win 25 battles' },
  giant_slayer:    { name: 'Giant Slayer',     icon: '⭐',   tier: 3, hidden: false, desc: 'Beat an alliance ranked 3+ above yours' },
  unstoppable:     { name: 'Unstoppable',      icon: '🌋',   tier: 3, hidden: false, desc: 'Win 5 in a row' },
  legend:          { name: 'Legend',            icon: '👑',   tier: 3, hidden: false, desc: 'Win 50 battles' },
  // Tier 4 — Hidden
  thread_of_fate:  { name: 'Thread of Fate',   icon: '🪶',   tier: 4, hidden: true,  desc: 'Win by the narrowest margin' },
  zeus_judgment:   { name: "Zeus's Judgment",   icon: '⚡',   tier: 4, hidden: true,  desc: 'Survive and win when the gods demand overtime' },
  hydra_slayer:    { name: 'Hydra Slayer',     icon: '🐉',   tier: 4, hidden: true,  desc: 'Prove yourself against many different foes' },
};

// Calculate daily battle limit based on badge count
function getDailyBattleLimit(studentId) {
  try {
    const result = query('SELECT COUNT(*) as count FROM arena_badges WHERE student_id = ?', [studentId])[0];
    const badgeCount = result ? result.count : 0;
    if (badgeCount >= 11) return 6;
    if (badgeCount >= 7) return 5;
    if (badgeCount >= 3) return 4;
    return 3;
  } catch (e) {
    return 3; // Default if badge table not ready
  }
}

// Check and award badges after a battle completes
function checkAndAwardBadges(studentId, battleId) {
  try {
  const stats = query('SELECT * FROM arena_battle_stats WHERE student_id = ?', [studentId])[0];
  if (!stats) return;
  
  const battle = query('SELECT * FROM arena_battles WHERE battle_id = ?', [battleId])[0];
  if (!battle) return;
  
  const isWinner = battle.winner_id === studentId;
  const isChallenger = battle.challenger_id === studentId;
  const earned = query('SELECT badge_key FROM arena_badges WHERE student_id = ?', [studentId]).map(b => b.badge_key);

  function award(key) {
    if (!earned.includes(key)) {
      try {
        run('INSERT INTO arena_badges (student_id, badge_key) VALUES (?, ?)', [studentId, key]);
        earned.push(key); // Update local cache so we don't double-award in same call
        console.log(`🏅 Badge awarded: ${key} to student ${studentId}`);
        // Create announcement for Tier 3 and Hidden badges
        const badge = ARENA_BADGES[key];
        if (badge && (badge.tier >= 3 || badge.hidden)) {
          run('INSERT INTO arena_announcements (student_id, badge_key) VALUES (?, ?)', [studentId, key]);
        }
      } catch (e) {
        // UNIQUE constraint violation = already earned, ignore
        console.log(`Badge ${key} already earned by ${studentId}`);
      }
    }
  }

  // === TIER 1 ===
  if (stats.wins >= 1)           award('first_blood');
  if (stats.total_battles >= 5)  award('trial_by_fire');

  // Athena's Favor: answer a question correctly in under 3 seconds
  {
    const timeCol = isChallenger ? 'challenger_time_ms' : 'defender_time_ms';
    const answerCol = isChallenger ? 'challenger_answer' : 'defender_answer';
    const fastCorrect = query(
      `SELECT round_id FROM arena_battle_rounds 
       WHERE battle_id = ? AND ${answerCol} = 'correct' AND ${timeCol} < 3000`,
      [battleId]
    );
    if (fastCorrect.length > 0) {
      award('athenas_favor');
    }
  }

  // === TIER 2 ===
  if (stats.wins >= 10)          award('spartan_grit');
  if (stats.current_streak >= 3) award('on_fire');

  // Tactician: 3+ distinct gods across winning battles
  if (isWinner) {
    const godsAsChallenger = query(`
      SELECT DISTINCT r.challenger_god_deployed as god FROM arena_battle_rounds r
      JOIN arena_battles b ON r.battle_id = b.battle_id
      WHERE b.winner_id = ? AND b.challenger_id = ? AND r.challenger_god_deployed IS NOT NULL
    `, [studentId, studentId]).map(g => g.god);
    const godsAsDefender = query(`
      SELECT DISTINCT r.defender_god_deployed as god FROM arena_battle_rounds r
      JOIN arena_battles b ON r.battle_id = b.battle_id
      WHERE b.winner_id = ? AND b.defender_id = ? AND r.defender_god_deployed IS NOT NULL
    `, [studentId, studentId]).map(g => g.god);
    const uniqueGods = new Set([...godsAsChallenger, ...godsAsDefender]);
    if (uniqueGods.size >= 3) award('tactician');
  }

  // Comeback Kid: won after being down 2+ rounds
  if (isWinner) {
    const rounds = query(
      'SELECT round_winner_id FROM arena_battle_rounds WHERE battle_id = ? ORDER BY round_number',
      [battleId]
    );
    let myScore = 0, oppScore = 0, wasDown2 = false;
    for (const round of rounds) {
      if (round.round_winner_id === studentId) myScore++;
      else if (round.round_winner_id) oppScore++;
      if (oppScore - myScore >= 2) wasDown2 = true;
    }
    if (wasDown2) award('comeback_kid');
  }

  // Shapeshifter: 3 consecutive wins, each with different primary god
  if (isWinner && stats.current_streak >= 3) {
    const recentWins = query(`
      SELECT battle_id, challenger_id FROM arena_battles
      WHERE winner_id = ? AND status = 'completed'
      ORDER BY completed_at DESC LIMIT 3
    `, [studentId]);
    if (recentWins.length === 3) {
      const primaryGods = recentWins.map(b => {
        const wasChallenger = b.challenger_id === studentId;
        const godCol = wasChallenger ? 'challenger_god_deployed' : 'defender_god_deployed';
        const gods = query(
          `SELECT ${godCol} as god, COUNT(*) as cnt FROM arena_battle_rounds
           WHERE battle_id = ? AND ${godCol} IS NOT NULL GROUP BY ${godCol} ORDER BY cnt DESC LIMIT 1`,
          [b.battle_id]
        );
        return gods.length > 0 ? gods[0].god : null;
      });
      if (primaryGods[0] && primaryGods[1] && primaryGods[2] &&
          primaryGods[0] !== primaryGods[1] && primaryGods[1] !== primaryGods[2] &&
          primaryGods[0] !== primaryGods[2]) {
        award('shapeshifter');
      }
    }
  }

  // === TIER 3 ===
  if (stats.wins >= 25)           award('champion');
  if (stats.current_streak >= 5)  award('unstoppable');
  if (stats.wins >= 50)           award('legend');

  // Giant Slayer: beat alliance ranked 3+ above
  if (isWinner) {
    const winnerAllianceId = isChallenger ? battle.challenger_alliance_id : battle.defender_alliance_id;
    const loserAllianceId = isChallenger ? battle.defender_alliance_id : battle.challenger_alliance_id;
    const rankings = query('SELECT alliance_id FROM alliances WHERE is_disbanded = 0 ORDER BY total_points DESC');
    const winnerRank = rankings.findIndex(a => a.alliance_id === winnerAllianceId) + 1;
    const loserRank = rankings.findIndex(a => a.alliance_id === loserAllianceId) + 1;
    if (winnerRank > 0 && loserRank > 0 && winnerRank - loserRank >= 3) {
      award('giant_slayer');
    }
  }

  // === TIER 4 (HIDDEN) ===

  // Thread of Fate: won 3-2
  if (isWinner) {
    const cScore = battle.challenger_score;
    const dScore = battle.defender_score;
    if ((cScore === 3 && dScore === 2) || (cScore === 2 && dScore === 3)) {
      award('thread_of_fate');
    }
  }

  // Zeus's Judgment: won in sudden death (round 6+)
  if (isWinner && battle.current_round > 5) {
    award('zeus_judgment');
  }

  // Hydra Slayer: fought 5 unique opponents
  const uniqueOpponents = query(`
    SELECT COUNT(DISTINCT opponent) as cnt FROM (
      SELECT defender_id as opponent FROM arena_battles
        WHERE challenger_id = ? AND status = 'completed'
      UNION
      SELECT challenger_id as opponent FROM arena_battles
        WHERE defender_id = ? AND status = 'completed'
    )
  `, [studentId, studentId])[0];
  if (uniqueOpponents && uniqueOpponents.cnt >= 5) award('hydra_slayer');
  } catch (err) {
    console.error(`Badge check error for student ${studentId}, battle ${battleId}: ${err.message}`);
  }
}

// Retroactive badge migration - run once on startup if badges table is empty
// Processes in batches to avoid blocking the event loop
function retroactivelyAwardBadges() {
  try {
    const badgeCount = query('SELECT COUNT(*) as count FROM arena_badges')[0];
    if (badgeCount && badgeCount.count > 0) {
      console.log('🏅 Badges already exist, skipping retroactive migration');
      return;
    }
    
    const completedBattles = query("SELECT battle_id, challenger_id, defender_id FROM arena_battles WHERE status = 'completed' ORDER BY completed_at ASC");
    if (completedBattles.length === 0) {
      console.log('🏅 No completed battles, skipping retroactive migration');
      return;
    }
    
    console.log(`🏅 Running retroactive badge awards for ${completedBattles.length} battles (batched)...`);
    
    const BATCH_SIZE = 10;
    let index = 0;
    
    function processBatch() {
      try {
        const end = Math.min(index + BATCH_SIZE, completedBattles.length);
        for (let i = index; i < end; i++) {
          const b = completedBattles[i];
          try {
            if (b.challenger_id) checkAndAwardBadges(b.challenger_id, b.battle_id);
            if (b.defender_id) checkAndAwardBadges(b.defender_id, b.battle_id);
          } catch (badgeErr) {
            console.log(`  Badge check error for battle ${b.battle_id}: ${badgeErr.message}`);
          }
        }
        index = end;
      
        if (index < completedBattles.length) {
          // Yield to event loop, then continue
          setTimeout(processBatch, 50);
        } else {
          // Done - mark all as seen and save
          run('UPDATE arena_badges SET celebration_seen = 1');
          saveDatabase();
          console.log('🏅 Retroactive badge awards complete');
        }
      } catch (batchErr) {
        console.log(`  Batch processing error: ${batchErr.message}`);
      }
    }
    
    processBatch();
  } catch (err) {
    console.log('Retroactive badge migration note:', err.message);
  }
}

// Lightweight challenge check (5-second polling — skips heavy data like opponents, gods, badges)
app.get('/api/arena/check-challenges', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    
    // Expire old pending challenges
    run(`UPDATE arena_battles SET status = 'expired' WHERE status = 'pending' AND datetime(created_at, '+60 seconds') < datetime('now')`);
    
    // Check pending challenges (for defender)
    const pendingChallenges = query(`
      SELECT ab.battle_id, ab.challenger_id, ab.point_stakes, s.name as challenger_name, a.alliance_name as challenger_alliance
      FROM arena_battles ab
      JOIN students s ON ab.challenger_id = s.student_id
      JOIN alliances a ON ab.challenger_alliance_id = a.alliance_id
      WHERE ab.defender_id = ? AND ab.status = 'pending'
      ORDER BY ab.created_at DESC LIMIT 1
    `, [student_id]);
    
    // Check active battle (minimal fields only)
    const activeBattle = query(`
      SELECT battle_id, status, challenger_id, defender_id, challenger_gods_ready, defender_gods_ready, started_at
      FROM arena_battles 
      WHERE (challenger_id = ? OR defender_id = ?) AND status IN ('accepted', 'in_progress')
      LIMIT 1
    `, [student_id, student_id])[0] || null;
    
    res.json({ pending_challenges: pendingChallenges, active_battle: activeBattle });
  } catch (err) {
    res.status(500).json({ error: 'Challenge check failed' });
  }
});

// Get arena status - shows requirements clearly if not met
app.get('/api/arena/status', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    
    // Get student info (exclude map_image blob)
    const student = query('SELECT student_id, name, class_period, alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    if (!student) {
      return res.json({ 
        arena_unlocked: false, 
        reason: 'Student account not found',
        requirements: { hasAlliance: false, hasTownCenter: false, hasHouse: false },
        god_powers: GOD_POWERS
      });
    }
    
    // Check alliance
    if (!student.alliance_id) {
      return res.json({ 
        arena_unlocked: false, 
        reason: 'You must join an alliance first to enter the Battle Arena.',
        requirements: { hasAlliance: false, hasTownCenter: false, hasHouse: false },
        god_powers: GOD_POWERS
      });
    }
    
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ? AND is_disbanded = 0', [student.alliance_id])[0];
    if (!alliance) {
      return res.json({ 
        arena_unlocked: false, 
        reason: 'Your alliance was disbanded.',
        requirements: { hasAlliance: false, hasTownCenter: false, hasHouse: false },
        god_powers: GOD_POWERS
      });
    }
    
    // Check buildings - handle both array format and string format
    let buildings = [];
    try {
      const rawBuildings = alliance.buildings_owned || '[]';
      buildings = typeof rawBuildings === 'string' ? JSON.parse(rawBuildings) : rawBuildings;
    } catch (e) {
      console.log('Building parse error:', e.message, 'Raw:', alliance.buildings_owned);
      buildings = [];
    }
    
    // Check for Town Center and House (handle different formats)
    const hasTownCenter = buildings.some(b => 
      (b.name === 'Town Center') || 
      (b.building_name === 'Town Center') ||
      (typeof b === 'string' && b.includes('Town Center'))
    );
    const hasHouse = buildings.some(b => 
      (b.name === 'House') || 
      (b.building_name === 'House') ||
      (typeof b === 'string' && b.includes('House'))
    );
    
    if (!hasTownCenter || !hasHouse) {
      return res.json({ 
        arena_unlocked: false, 
        reason: 'Your alliance needs to build a Town Center (175 pts) and a House (40 pts) to unlock the Battle Arena.',
        requirements: { 
          hasAlliance: true, 
          hasTownCenter, 
          hasHouse,
          allianceName: alliance.alliance_name,
          alliancePoints: alliance.total_points
        },
        god_powers: GOD_POWERS
      });
    }
    
    // Arena is unlocked! Check if enabled
    const globalSetting = query("SELECT setting_value FROM arena_settings WHERE setting_type = 'global' AND setting_key = 'enabled'")[0];
    const arenaEnabled = !globalSetting || globalSetting.setting_value !== 'false';
    
    if (!arenaEnabled) {
      return res.json({
        arena_unlocked: true,
        arena_enabled: false,
        reason: 'The Battle Arena is currently disabled by your teacher.',
        god_powers: GOD_POWERS
      });
    }
    
    // Check per-student disable
    const studentSetting = query("SELECT setting_value FROM arena_settings WHERE setting_type = 'student' AND setting_key = ?", [String(student_id)])[0];
    if (studentSetting && studentSetting.setting_value === 'false') {
      return res.json({
        arena_unlocked: true,
        arena_enabled: false,
        reason: 'Your access to the Battle Arena has been temporarily disabled by your teacher.',
        god_powers: GOD_POWERS
      });
    }
    
    // Get battle stats
    let stats = query('SELECT * FROM arena_battle_stats WHERE student_id = ?', [student_id])[0];
    if (!stats) {
      run('INSERT INTO arena_battle_stats (student_id) VALUES (?)', [student_id]);
      stats = { total_battles: 0, wins: 0, losses: 0, current_streak: 0, best_streak: 0, battles_today: 0 };
    }
    
    // Get today's date for queries
    const today = new Date().toISOString().split('T')[0];
    
    // Get pending challenges
    run(`UPDATE arena_battles SET status = 'expired' WHERE status = 'pending' AND datetime(created_at, '+60 seconds') < datetime('now')`);
    
    const pendingChallenges = query(`
      SELECT ab.*, s.name as challenger_name, a.alliance_name as challenger_alliance
      FROM arena_battles ab
      JOIN students s ON ab.challenger_id = s.student_id
      JOIN alliances a ON ab.challenger_alliance_id = a.alliance_id
      WHERE ab.defender_id = ? AND ab.status = 'pending'
      ORDER BY ab.created_at DESC
    `, [student_id]);
    
    // Get active battle
    const activeBattle = query(`
      SELECT * FROM arena_battles 
      WHERE (challenger_id = ? OR defender_id = ?) AND status IN ('accepted', 'in_progress')
    `, [student_id, student_id])[0];
    
    // Get available opponents (same period, different alliance, has arena access)
    const opponentsRaw = query(`
      SELECT s.student_id, s.name, s.class_period, a.alliance_name, a.alliance_id,
             (SELECT wins FROM arena_battle_stats WHERE student_id = s.student_id) as wins,
             (SELECT losses FROM arena_battle_stats WHERE student_id = s.student_id) as losses
      FROM students s
      JOIN alliances a ON s.alliance_id = a.alliance_id
      WHERE s.class_period = ? 
        AND s.alliance_id != ?
        AND a.is_disbanded = 0
        AND a.buildings_owned LIKE '%Town Center%'
        AND a.buildings_owned LIKE '%House%'
        AND s.student_id NOT IN (
          SELECT CASE WHEN challenger_id = ? THEN defender_id ELSE challenger_id END
          FROM arena_battles 
          WHERE (challenger_id = ? OR defender_id = ?)
            AND DATE(created_at) = ?
            AND status IN ('completed', 'in_progress')
        )
      ORDER BY a.alliance_name, s.name
    `, [student.class_period, student.alliance_id, student_id, student_id, student_id, today]);
    
    // Add battles_today count for each opponent
    const opponents = opponentsRaw.map(opp => ({
      ...opp,
      battles_today: countBattlesToday(opp.student_id)
    }));
    
    // Get unlocked gods with bonus status
    const progress = query('SELECT * FROM student_achievement_progress WHERE student_id = ?', [student_id])[0];
    const godList = ['zeus', 'poseidon', 'hera', 'athena', 'apollo', 'artemis', 'aphrodite', 'ares', 'hephaestus', 'hermes', 'demeter', 'prometheus', 'hades'];
    // FIX 9: Removed prometheusUsedToday — Prometheus is now once-per-battle, not once-per-day
    
    const unlockedGods = godList.filter(g => progress && progress[`pantheon_${g}_unlocked`] === 1)
      .map(g => {
        const godPower = GOD_POWERS[g];
        const hasBonus = progress[`pantheon_${g}_bonus_seen`] === 1;
        return { 
          name: g, 
          displayName: g.charAt(0).toUpperCase() + g.slice(1),
          hasBonus: hasBonus,
          type: godPower.type,
          powerName: godPower.name,
          description: godPower.description,
          emoji: godPower.emoji,
          passive: godPower.passive || null,
          blocks: godPower.blocks || null,
          counteredBy: godPower.counteredBy || null,
          // Show effect values based on bonus status
          effectValue: hasBonus ? (godPower.bonusEffect || godPower.bonusPassiveEffect) : (godPower.baseEffect || godPower.passiveEffect)
        };
      });
    
    // Get badge data (wrapped in try/catch - gracefully degrades if badge tables not ready)
    let myBadges = [];
    let dailyBattleLimit = 3;
    let announcements = [];
    const opponentBadges = {};
    
    try {
      myBadges = query('SELECT badge_key, celebration_seen FROM arena_badges WHERE student_id = ?', [student_id]);
      dailyBattleLimit = getDailyBattleLimit(student_id);
      
      // Get announcements from last 12 hours (cleanup once per minute max)
      if (!global._lastAnnouncementCleanup || Date.now() - global._lastAnnouncementCleanup > 60000) {
        run("DELETE FROM arena_announcements WHERE created_at < datetime('now', '-12 hours')");
        global._lastAnnouncementCleanup = Date.now();
      }
      announcements = query(`
        SELECT aa.badge_key, aa.created_at, s.name as student_name 
        FROM arena_announcements aa
        JOIN students s ON aa.student_id = s.student_id
        WHERE s.class_period = ?
        ORDER BY aa.created_at DESC LIMIT 10
      `, [student.class_period]);
      
      // Get badge keys for all opponents in ONE query
      const opponentIds = opponents.map(o => o.student_id);
      if (opponentIds.length > 0) {
        const placeholders = opponentIds.map(() => '?').join(',');
        const allOppBadges = query(
          `SELECT student_id, badge_key FROM arena_badges WHERE student_id IN (${placeholders})`,
          opponentIds
        );
        allOppBadges.forEach(b => {
          if (!opponentBadges[b.student_id]) opponentBadges[b.student_id] = [];
          opponentBadges[b.student_id].push(b.badge_key);
        });
      }
    } catch (badgeErr) {
      console.log('Badge data fetch error (non-fatal):', badgeErr.message);
    }
    
    // Check if this player has an outgoing pending challenge
    const outgoingChallenge = query(`
      SELECT ab.battle_id, ab.defender_id, ab.point_stakes, ab.created_at,
             s.name as defender_name, a.alliance_name as defender_alliance
      FROM arena_battles ab
      JOIN students s ON ab.defender_id = s.student_id
      JOIN alliances a ON ab.defender_alliance_id = a.alliance_id
      WHERE ab.challenger_id = ? AND ab.status = 'pending'
      ORDER BY ab.created_at DESC LIMIT 1
    `, [student_id])[0] || null;
    
    res.json({
      arena_unlocked: true,
      arena_enabled: true,
      stats: {
        total_battles: stats.total_battles || 0,
        wins: stats.wins || 0,
        losses: stats.losses || 0,
        current_streak: stats.current_streak || 0,
        best_streak: stats.best_streak || 0
      },
      battles_today: countBattlesToday(student_id),
      max_battles_per_day: dailyBattleLimit,
      pending_challenges: pendingChallenges,
      outgoing_challenge: outgoingChallenge,
      active_battle: activeBattle,
      available_opponents: opponents,
      unlocked_gods: unlockedGods,
      god_powers: GOD_POWERS,
      // FIX 9: Removed prometheus_used_today — now per-battle via prometheus_used_by_me in battle state
      // Badge system data
      my_badges: myBadges,
      badge_definitions: ARENA_BADGES,
      opponent_badges: opponentBadges,
      announcements: announcements,
      daily_battle_limit: dailyBattleLimit
    });
  } catch (err) {
    console.error('Arena status error:', err);
    res.status(500).json({ error: 'Failed to load arena status: ' + err.message });
  }
});

// Challenge another student
app.post('/api/arena/challenge', authenticateToken, (req, res) => {
  try {
    const challenger_id = req.user.id;
    const { defender_id, point_stakes } = req.body;
    
    if (!point_stakes || point_stakes < 1 || point_stakes > 10) {
      return res.status(400).json({ error: 'Point stakes must be between 1 and 10' });
    }
    
    // Block if challenger already has a pending outgoing challenge or active battle
    const existingChallenge = query(
      `SELECT battle_id, status FROM arena_battles 
       WHERE challenger_id = ? AND status IN ('pending', 'accepted', 'in_progress')`,
      [challenger_id]
    )[0];
    if (existingChallenge) {
      if (existingChallenge.status === 'pending') {
        return res.status(400).json({ error: 'You already have a pending challenge. Cancel it first or wait for a response.' });
      }
      return res.status(400).json({ error: 'You already have an active battle.' });
    }
    
    // Block if challenger is a defender in an active battle
    const existingAsDefender = query(
      `SELECT battle_id FROM arena_battles 
       WHERE defender_id = ? AND status IN ('accepted', 'in_progress')`,
      [challenger_id]
    )[0];
    if (existingAsDefender) {
      return res.status(400).json({ error: 'You already have an active battle.' });
    }
    
    // Block if defender already has a pending challenge (incoming or outgoing) or active battle
    const defenderBusy = query(
      `SELECT battle_id FROM arena_battles 
       WHERE (challenger_id = ? OR defender_id = ?) AND status IN ('pending', 'accepted', 'in_progress')`,
      [defender_id, defender_id]
    )[0];
    if (defenderBusy) {
      return res.status(400).json({ error: 'This player already has a pending challenge or active battle.' });
    }
    
    // Check challenger's daily battle limit
    const challengerBattlesToday = countBattlesToday(challenger_id);
    const challengerLimit = getDailyBattleLimit(challenger_id);
    if (challengerBattlesToday >= challengerLimit) {
      return res.status(400).json({ error: `You have reached your daily limit of ${challengerLimit} battles.` });
    }
    
    // Check defender's daily battle limit
    const defenderBattlesToday = countBattlesToday(defender_id);
    const defenderLimit = getDailyBattleLimit(defender_id);
    if (defenderBattlesToday >= defenderLimit) {
      return res.status(400).json({ error: 'This player has reached their daily battle limit.' });
    }
    
    const challenger = query('SELECT student_id, name, class_period, alliance_id FROM students WHERE student_id = ?', [challenger_id])[0];
    const defender = query('SELECT student_id, name, class_period, alliance_id FROM students WHERE student_id = ?', [defender_id])[0];
    
    if (!challenger || !defender) {
      return res.status(400).json({ error: 'Invalid players' });
    }
    
    if (challenger.alliance_id === defender.alliance_id) {
      return res.status(400).json({ error: 'You cannot battle members of your own alliance' });
    }
    
    run(`INSERT INTO arena_battles (challenger_id, defender_id, challenger_alliance_id, defender_alliance_id, point_stakes, class_period, status)
        VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [challenger_id, defender_id, challenger.alliance_id, defender.alliance_id, point_stakes, challenger.class_period]);
    
    res.json({ success: true, message: `Challenge sent to ${defender.name}!` });
  } catch (err) {
    console.error('Challenge error:', err);
    res.status(500).json({ error: 'Failed to send challenge' });
  }
});

// Respond to challenge
app.post('/api/arena/respond', authenticateToken, (req, res) => {
  try {
    const defender_id = req.user.id;
    const { battle_id, accept } = req.body;
    
    const battle = query('SELECT * FROM arena_battles WHERE battle_id = ? AND defender_id = ? AND status = ?', 
      [battle_id, defender_id, 'pending'])[0];
    
    if (!battle) {
      return res.status(404).json({ error: 'Challenge not found or expired' });
    }
    
    if (!accept) {
      run("UPDATE arena_battles SET status = 'declined' WHERE battle_id = ?", [battle_id]);
      return res.json({ success: true, message: 'Challenge declined' });
    }
    
    // Check defender's daily battle limit before accepting
    const defenderBattlesToday = countBattlesToday(defender_id);
    const defenderLimit = getDailyBattleLimit(defender_id);
    if (defenderBattlesToday >= defenderLimit) {
      return res.status(400).json({ error: `You have reached your daily limit of ${defenderLimit} battles. Challenge auto-declined.` });
    }
    
    // Also re-check challenger's limit (they might have battled since sending)
    const challengerBattlesToday = countBattlesToday(battle.challenger_id);
    const challengerLimit = getDailyBattleLimit(battle.challenger_id);
    if (challengerBattlesToday >= challengerLimit) {
      run("UPDATE arena_battles SET status = 'expired' WHERE battle_id = ?", [battle_id]);
      return res.status(400).json({ error: 'The challenger has reached their daily battle limit. Challenge expired.' });
    }
    
    run("UPDATE arena_battles SET status = 'accepted' WHERE battle_id = ?", [battle_id]);
    res.json({ success: true, message: 'Challenge accepted!' });
  } catch (err) {
    console.error('Respond error:', err);
    res.status(500).json({ error: 'Failed to respond' });
  }
});

// Cancel a pending outgoing challenge
app.post('/api/arena/cancel-challenge', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { battle_id } = req.body;
    
    const battle = query(
      "SELECT * FROM arena_battles WHERE battle_id = ? AND challenger_id = ? AND status = 'pending'",
      [battle_id, student_id]
    )[0];
    
    if (!battle) {
      return res.status(404).json({ error: 'Pending challenge not found' });
    }
    
    run("UPDATE arena_battles SET status = 'cancelled' WHERE battle_id = ?", [battle_id]);
    saveDatabase();
    
    res.json({ success: true, message: 'Challenge cancelled' });
  } catch (err) {
    console.error('Cancel challenge error:', err);
    res.status(500).json({ error: 'Failed to cancel challenge' });
  }
});

// Select gods for battle
app.post('/api/arena/select-gods', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { battle_id, gods } = req.body;
    
    const battle = query('SELECT * FROM arena_battles WHERE battle_id = ? AND status = ?', [battle_id, 'accepted'])[0];
    if (!battle) {
      return res.status(404).json({ error: 'Battle not found or not in accepted state' });
    }
    
    const isChallenger = battle.challenger_id === student_id;
    if (!isChallenger && battle.defender_id !== student_id) {
      return res.status(403).json({ error: 'You are not part of this battle' });
    }
    
    const selectedGods = gods || [];
    
    // Validate max 3 gods
    if (selectedGods.length > 3) {
      return res.status(400).json({ error: 'Maximum 3 gods allowed' });
    }
    
    // Validate each god is unlocked
    for (const god of selectedGods) {
      if (!hasGodUnlocked(student_id, god)) {
        return res.status(400).json({ error: `You have not unlocked ${god}` });
      }
    }
    
    // Check Prometheus daily limit - REMOVED: now once-per-battle like Apollo (FIX 8)
    // Prometheus selection is allowed — the once-per-battle limit is enforced at deploy time
    
    // Build god data with bonus status
    const godData = selectedGods.map(g => ({
      name: g,
      hasBonus: hasGodBonus(student_id, g)
    }));
    
    // Save gods and mark as ready
    const godsCol = isChallenger ? 'challenger_gods' : 'defender_gods';
    const readyCol = isChallenger ? 'challenger_gods_ready' : 'defender_gods_ready';
    const cooldownCol = isChallenger ? 'challenger_god_cooldowns' : 'defender_god_cooldowns';
    
    // Initialize cooldowns
    const cooldowns = {};
    selectedGods.forEach(g => cooldowns[g] = 0);
    
    console.log(`🎮 Saving god selection for ${isChallenger ? 'challenger' : 'defender'}: ${readyCol} = 1`);
    
    run(`UPDATE arena_battles SET ${godsCol} = ?, ${readyCol} = 1, ${cooldownCol} = ? WHERE battle_id = ?`, 
      [JSON.stringify(godData), JSON.stringify(cooldowns), battle_id]);
    
    saveDatabase(); // Save immediately after update
    
    // Check if BOTH players are ready
    const updated = query('SELECT * FROM arena_battles WHERE battle_id = ?', [battle_id])[0];
    
    console.log(`📊 After update - challenger_gods_ready: ${updated.challenger_gods_ready}, defender_gods_ready: ${updated.defender_gods_ready}`);
    
    if (updated.challenger_gods_ready === 1 && updated.defender_gods_ready === 1) {
      // BOTH ready - start battle with deploy phase
      // Use adaptive question pool (Archaic + unlocked Classical myths)
      const question = getAdaptiveBattleQuestion(updated.challenger_id, updated.defender_id, []);
      
      if (question) {
        // Set synchronized start time - 1 second from now for both players
        const roundStartsAt = new Date(Date.now() + 1000).toISOString();
        const phaseEndsAt = new Date(Date.now() + 1000 + BATTLE_TIMING.DEPLOY_PHASE).toISOString();
        
        run("UPDATE arena_battles SET status = 'in_progress', started_at = CURRENT_TIMESTAMP, current_round = 1 WHERE battle_id = ?", [battle_id]);
        run(`INSERT INTO arena_battle_rounds (battle_id, round_number, question_id, phase, phase_ends_at, started_at) 
             VALUES (?, 1, ?, 'deploy', ?, ?)`,
          [battle_id, question.question_id, phaseEndsAt, roundStartsAt]);
        
        console.log(`⏱️ Round 1 created - starts at ${roundStartsAt}, question_id: ${question.question_id}`);
      }
      
      saveDatabase();
      return res.json({ success: true, battle_started: true });
    }
    
    saveDatabase();
    res.json({ success: true, waiting_for_opponent: true, your_gods: godData });
  } catch (err) {
    console.error('Select gods error:', err);
    res.status(500).json({ error: 'Failed to select gods' });
  }
});

// Get battle state
app.get('/api/arena/battle/:battle_id', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { battle_id } = req.params;
    
    const battle = query('SELECT * FROM arena_battles WHERE battle_id = ?', [battle_id])[0];
    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' });
    }
    
    const isChallenger = battle.challenger_id === student_id;
    const challenger = query('SELECT name FROM students WHERE student_id = ?', [battle.challenger_id])[0];
    const defender = query('SELECT name FROM students WHERE student_id = ?', [battle.defender_id])[0];
    
    // Parse god data
    const myGods = JSON.parse(isChallenger ? (battle.challenger_gods || '[]') : (battle.defender_gods || '[]'));
    const myCooldowns = JSON.parse(isChallenger ? (battle.challenger_god_cooldowns || '{}') : (battle.defender_god_cooldowns || '{}'));
    
    let question = null;
    let roundData = null;
    let phaseInfo = null;
    const currentRound = query('SELECT * FROM arena_battle_rounds WHERE battle_id = ? AND round_number = ?', 
      [battle_id, battle.current_round])[0];
    
    if (currentRound && battle.status === 'in_progress') {
      // Calculate time remaining in current phase
      const now = new Date();
      const phaseEndsAt = currentRound.phase_ends_at ? new Date(currentRound.phase_ends_at) : null;
      const phaseTimeRemaining = phaseEndsAt ? Math.max(0, Math.floor((phaseEndsAt - now) / 1000)) : 0;
      
      // Auto-advance phase if time expired
      if (phaseEndsAt && now > phaseEndsAt) {
        // FIX 2a: Re-query round to prevent double transitions from concurrent polls
        const freshRound = query('SELECT * FROM arena_battle_rounds WHERE round_id = ?', [currentRound.round_id])[0];
        if (!freshRound || freshRound.phase !== currentRound.phase) {
          console.log(`⚠️ Phase already transitioned (was ${currentRound.phase}, now ${freshRound?.phase}). Skipping double-transition.`);
        } else if (currentRound.phase === 'deploy') {
          // Deploy timeout - move to question phase with sync delay
          // Set question_display_time so the sync gate works correctly
          const questionDisplayTime = new Date(Date.now() + BATTLE_TIMING.SYNC_DELAY).toISOString();
          const newPhaseEnds = new Date(Date.now() + BATTLE_TIMING.SYNC_DELAY + BATTLE_TIMING.QUESTION_PHASE).toISOString();
          run("UPDATE arena_battle_rounds SET phase = 'question', question_display_time = ?, phase_ends_at = ? WHERE round_id = ?", 
            [questionDisplayTime, newPhaseEnds, currentRound.round_id]);
          // Also mark both as question-ready since they had their chance during deploy
          run("UPDATE arena_battle_rounds SET challenger_question_ready = 1, defender_question_ready = 1 WHERE round_id = ?",
            [currentRound.round_id]);
          currentRound.phase = 'question';
          currentRound.question_display_time = questionDisplayTime;
          currentRound.phase_ends_at = newPhaseEnds;
          console.log(`⏱️ Deploy timeout - Question display at ${questionDisplayTime}`);
        } else if (currentRound.phase === 'sudden_death_intro') {
          // Sudden death intro timeout (30s) - auto-transition to question
          const questionDisplayTime = new Date(Date.now() + BATTLE_TIMING.SYNC_DELAY).toISOString();
          const newPhaseEnds = new Date(Date.now() + BATTLE_TIMING.SYNC_DELAY + BATTLE_TIMING.QUESTION_PHASE).toISOString();
          run(`UPDATE arena_battle_rounds SET phase = 'question', question_display_time = ?, phase_ends_at = ? WHERE round_id = ?`,
            [questionDisplayTime, newPhaseEnds, currentRound.round_id]);
          currentRound.phase = 'question';
          currentRound.question_display_time = questionDisplayTime;
          currentRound.phase_ends_at = newPhaseEnds;
          console.log(`⚡ Sudden death intro timeout - auto-transitioning to question`);
        } else if (currentRound.phase === 'question') {
          // Time's up - auto-submit wrong answers for anyone who hasn't answered
          if (!currentRound.challenger_answer) {
            run("UPDATE arena_battle_rounds SET challenger_answer = 'timeout', challenger_time_ms = ? WHERE round_id = ?", 
              [BATTLE_TIMING.QUESTION_PHASE, currentRound.round_id]);
          }
          if (!currentRound.defender_answer) {
            run("UPDATE arena_battle_rounds SET defender_answer = 'timeout', defender_time_ms = ? WHERE round_id = ?", 
              [BATTLE_TIMING.QUESTION_PHASE, currentRound.round_id]);
          }
          // FIX 1: Score the round after filling timeout answers (previously missing — caused stuck battles)
          const timeoutRound = query('SELECT * FROM arena_battle_rounds WHERE round_id = ?', [currentRound.round_id])[0];
          if (timeoutRound && !timeoutRound.completed_at && timeoutRound.challenger_answer && timeoutRound.defender_answer) {
            console.log(`⏱️ Question timeout - scoring round ${currentRound.round_number} now`);
            scoreRound(battle_id, currentRound.round_id);
          }
        } else if (currentRound.phase === 'results') {
          // Results phase ended - create next round
          const nextRoundNum = battle.current_round + 1;
          
          // FIX 2b: Check if next round already exists (prevents duplicate from concurrent poll race condition)
          const existingNextRound = query('SELECT round_id FROM arena_battle_rounds WHERE battle_id = ? AND round_number = ?',
            [battle_id, nextRoundNum])[0];
          if (existingNextRound) {
            console.log(`⚠️ Round ${nextRoundNum} already exists (round_id: ${existingNextRound.round_id}), skipping duplicate creation`);
            battle.current_round = nextRoundNum;
            run('UPDATE arena_battles SET current_round = ? WHERE battle_id = ?', [nextRoundNum, battle_id]);
          } else if (nextRoundNum <= 5 || (battle.challenger_score === battle.defender_score)) {
            // Get unused questions using adaptive pool (Archaic + unlocked Classical myths)
            const usedQuestions = query('SELECT question_id FROM arena_battle_rounds WHERE battle_id = ?', [battle_id]);
            const usedIds = usedQuestions.map(q => q.question_id);
            const nextQ = getAdaptiveBattleQuestion(battle.challenger_id, battle.defender_id, usedIds);
            
            if (nextQ) {
              const isSuddenDeath = nextRoundNum > 5;
              
              if (isSuddenDeath) {
                // Sudden death rounds go through sudden_death_intro phase first
                const phaseEndsAt = new Date(Date.now() + BATTLE_TIMING.SUDDEN_DEATH_INTRO).toISOString();
                run('UPDATE arena_battles SET current_round = ? WHERE battle_id = ?', [nextRoundNum, battle_id]);
                run(`INSERT INTO arena_battle_rounds (battle_id, round_number, question_id, phase, phase_ends_at, 
                     challenger_question_ready, defender_question_ready, started_at) 
                     VALUES (?, ?, ?, 'sudden_death_intro', ?, 0, 0, CURRENT_TIMESTAMP)`,
                  [battle_id, nextRoundNum, nextQ.question_id, phaseEndsAt]);
                console.log(`⚡ SUDDEN DEATH Round ${nextRoundNum} created - phase: sudden_death_intro`);
              } else {
                // Normal round - deploy phase
                const roundStartsAt = new Date(Date.now() + 1000).toISOString();
                const newPhaseEnds = new Date(Date.now() + 1000 + BATTLE_TIMING.DEPLOY_PHASE).toISOString();
                run('UPDATE arena_battles SET current_round = ? WHERE battle_id = ?', [nextRoundNum, battle_id]);
                run(`INSERT INTO arena_battle_rounds (battle_id, round_number, question_id, phase, phase_ends_at, started_at) 
                     VALUES (?, ?, ?, 'deploy', ?, ?)`,
                  [battle_id, nextRoundNum, nextQ.question_id, newPhaseEnds, roundStartsAt]);
                console.log(`⏱️ Round ${nextRoundNum} created - starts at ${roundStartsAt}`);
              }
              
              // Re-query to get the new round
              battle.current_round = nextRoundNum;
              saveDatabase();
            }
          }
        }
      }
      
      // Only show question during question phase (or results phase)
      if (currentRound.phase === 'question' || currentRound.phase === 'results') {
        const q = query('SELECT * FROM battle_questions WHERE question_id = ?', [currentRound.question_id])[0];
        if (q) {
          const seed = currentRound.round_id;
          const answers = [
            { text: q.correct_answer, isCorrect: true },
            { text: q.wrong_answer_1, isCorrect: false },
            { text: q.wrong_answer_2, isCorrect: false },
            { text: q.wrong_answer_3, isCorrect: false }
          ];
          for (let i = answers.length - 1; i > 0; i--) {
            const j = Math.floor(((seed * (i + 1) * 9301 + 49297) % 233280) / 233280 * (i + 1));
            [answers[i], answers[j]] = [answers[j], answers[i]];
          }
          
          question = {
            question_id: q.question_id,
            question_text: q.question_text,
            god_associated: q.god_associated,
            shuffled_answers: answers.map((a, i) => ({ index: i, text: a.text, isCorrect: a.isCorrect }))
          };
        }
      }
      
      // Check if I've deployed a god this round
      const myDeployReady = isChallenger ? currentRound.challenger_deploy_ready : currentRound.defender_deploy_ready;
      const opponentDeployReady = isChallenger ? currentRound.defender_deploy_ready : currentRound.challenger_deploy_ready;
      
      roundData = {
        round_number: currentRound.round_number,
        phase: currentRound.phase || 'deploy',
        phase_time_remaining: phaseTimeRemaining,
        question_starts_at: currentRound.question_starts_at || null,
        question_display_time: currentRound.question_display_time || null,
        round_started_at: currentRound.started_at || null,
        challenger_god_deployed: currentRound.challenger_god_deployed,
        defender_god_deployed: currentRound.defender_god_deployed,
        challenger_answered: currentRound.challenger_answer !== null,
        defender_answered: currentRound.defender_answer !== null,
        challenger_god_blocked: currentRound.challenger_god_blocked === 1,
        defender_god_blocked: currentRound.defender_god_blocked === 1,
        challenger_blocked_by_cerberus: false,
        defender_blocked_by_cerberus: false,
        my_god_deployed: isChallenger ? currentRound.challenger_god_deployed : currentRound.defender_god_deployed,
        opponent_god_deployed: isChallenger ? currentRound.defender_god_deployed : currentRound.challenger_god_deployed,
        my_deploy_ready: myDeployReady === 1,
        opponent_deploy_ready: opponentDeployReady === 1,
        both_deployed: (currentRound.challenger_deploy_ready === 1 && currentRound.defender_deploy_ready === 1),
        // Sudden death ready states
        my_sd_ready: isChallenger ? currentRound.challenger_question_ready === 1 : currentRound.defender_question_ready === 1,
        opponent_sd_ready: isChallenger ? currentRound.defender_question_ready === 1 : currentRound.challenger_question_ready === 1
      };
      
      // Check if any blocks were from Cerberus (Gate of Erebus)
      try {
        if (currentRound.challenger_god_blocked || currentRound.defender_god_blocked) {
          const cerberusBlocks = query(
            'SELECT blocked_player_id FROM cerberus_block_log WHERE battle_id = ? AND round_id = ?',
            [battle_id, currentRound.round_id]
          );
          cerberusBlocks.forEach(cb => {
            if (cb.blocked_player_id === battle.challenger_id) roundData.challenger_blocked_by_cerberus = true;
            if (cb.blocked_player_id === battle.defender_id) roundData.defender_blocked_by_cerberus = true;
          });
        }
      } catch(e) { /* non-critical */ }
      
      // A4: Include Prometheus preview in battle state if player deployed Prometheus
      const myDeployedGod = isChallenger ? currentRound.challenger_god_deployed : currentRound.defender_god_deployed;
      const myGodBlocked = isChallenger ? currentRound.challenger_god_blocked : currentRound.defender_god_blocked;
      if (myDeployedGod === 'prometheus' && !myGodBlocked && currentRound.phase === 'question') {
        const previewQ = query('SELECT question_text FROM battle_questions WHERE question_id = ?', [currentRound.question_id])[0];
        if (previewQ) {
          const promGodData = myGods.find(g => (typeof g === 'string' ? g : g.name) === 'prometheus');
          const promHasBonus = promGodData && typeof promGodData === 'object' && promGodData.hasBonus;
          roundData.prometheus_preview = previewQ.question_text;
          roundData.prometheus_preview_duration = (promHasBonus ? GOD_POWERS.prometheus.bonusEffect : GOD_POWERS.prometheus.baseEffect) * 1000;
        }
      }
      
    }
    
    const myAnswer = currentRound ? (isChallenger ? currentRound.challenger_answer : currentRound.defender_answer) : null;
    
    // Calculate which gods are available (not on cooldown)
    const availableGods = myGods.filter(g => {
      const godName = typeof g === 'string' ? g : g.name;
      return !myCooldowns[godName] || myCooldowns[godName] <= 0;
    });
    
    // A5: Check if this player already used Apollo in a previous round
    const myDeployCol = isChallenger ? 'challenger_god_deployed' : 'defender_god_deployed';
    const apolloUsedByMe = query(
      `SELECT COUNT(*) as cnt FROM arena_battle_rounds 
       WHERE battle_id = ? AND ${myDeployCol} = 'apollo'`,
      [battle_id]
    )[0];
    
    // FIX 8: Check if this player already used Prometheus in a previous round
    const prometheusUsedByMe = query(
      `SELECT COUNT(*) as cnt FROM arena_battle_rounds 
       WHERE battle_id = ? AND ${myDeployCol} = 'prometheus'`,
      [battle_id]
    )[0];

    // V93: Hecatoncheires scramble state
    const myScrambleUsedCol = isChallenger ? 'challenger_scramble_used' : 'defender_scramble_used';
    const oppScrambleUsedCol = isChallenger ? 'defender_scramble_used' : 'challenger_scramble_used';
    const myScrambleUsedThisRound = currentRound ? currentRound[myScrambleUsedCol] === 1 : false;
    const myHecatoncheiresCards = query('SELECT hecatoncheires_cards FROM students WHERE student_id = ?', [student_id])[0];

    // Is a scramble currently active against ME? (opponent used it, it's still within the active window)
    let opponentScrambleActive = false;
    let scrambleEndsAt = null;
    if (currentRound && currentRound.scramble_active_until && currentRound[oppScrambleUsedCol] === 1) {
      const activeUntil = new Date(currentRound.scramble_active_until);
      if (activeUntil > new Date()) {
        opponentScrambleActive = true;
        scrambleEndsAt = currentRound.scramble_active_until;
      }
    }
    
    res.json({
      battle_id: battle.battle_id,
      status: battle.status,
      point_stakes: battle.point_stakes,
      current_round: battle.current_round,
      challenger_score: battle.challenger_score,
      defender_score: battle.defender_score,
      challenger_id: battle.challenger_id,
      defender_id: battle.defender_id,
      challenger_name: challenger?.name,
      defender_name: defender?.name,
      is_challenger: isChallenger,
      my_answer: myAnswer,
      question,
      round_data: roundData,
      winner_id: battle.winner_id,
      // God info (minimal - god_powers already loaded from arena/status)
      my_gods: myGods,
      my_cooldowns: myCooldowns,
      available_gods: availableGods,
      apollo_used_by_me: apolloUsedByMe && apolloUsedByMe.cnt > 0,
      prometheus_used_by_me: prometheusUsedByMe && prometheusUsedByMe.cnt > 0,
      // V93: Hecatoncheires scramble
      hecatoncheires_cards: myHecatoncheiresCards ? (myHecatoncheiresCards.hecatoncheires_cards || 0) : 0,
      my_scramble_used_this_round: myScrambleUsedThisRound,
      opponent_scramble_active: opponentScrambleActive,
      scramble_ends_at: scrambleEndsAt
    });
  } catch (err) {
    console.error('Get battle error:', err);
    res.status(500).json({ error: 'Failed to get battle' });
  }
});

// Deploy god for current round
app.post('/api/arena/deploy-god', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { battle_id, god_name } = req.body; // god_name can be null for "no power"
    
    const battle = query("SELECT * FROM arena_battles WHERE battle_id = ? AND status = 'in_progress'", [battle_id])[0];
    if (!battle) {
      return res.status(404).json({ error: 'Battle not found or not in progress' });
    }
    
    const isChallenger = battle.challenger_id === student_id;
    const currentRound = query('SELECT * FROM arena_battle_rounds WHERE battle_id = ? AND round_number = ?',
      [battle_id, battle.current_round])[0];
    
    if (!currentRound) {
      return res.status(400).json({ error: 'No active round' });
    }
    
    // Check we're in deploy phase
    if (currentRound.phase !== 'deploy') {
      return res.status(400).json({ error: 'Not in deploy phase' });
    }
    
    // Check if already deployed this round
    const deployReadyCol = isChallenger ? 'challenger_deploy_ready' : 'defender_deploy_ready';
    if (currentRound[deployReadyCol] === 1) {
      return res.status(400).json({ error: 'Already made your selection this round' });
    }
    
    // Validate god selection
    if (god_name) {
      // Check if god is in player's selected gods
      const myGods = JSON.parse(isChallenger ? (battle.challenger_gods || '[]') : (battle.defender_gods || '[]'));
      const godNames = myGods.map(g => typeof g === 'string' ? g : g.name);
      if (!godNames.includes(god_name)) {
        return res.status(400).json({ error: 'You did not select this god for battle' });
      }
      
      // A5: Apollo once-per-battle limit
      if (god_name === 'apollo') {
        const myDeployCol = isChallenger ? 'challenger_god_deployed' : 'defender_god_deployed';
        const apolloUsed = query(
          `SELECT COUNT(*) as cnt FROM arena_battle_rounds 
           WHERE battle_id = ? AND ${myDeployCol} = 'apollo' AND round_number < ?`,
          [battle_id, battle.current_round]
        )[0];
        if (apolloUsed && apolloUsed.cnt > 0) {
          return res.status(400).json({ error: 'Apollo can only be used once per battle' });
        }
      }
      
      // FIX 8: Prometheus once-per-battle limit (same pattern as Apollo)
      if (god_name === 'prometheus') {
        const myDeployCol = isChallenger ? 'challenger_god_deployed' : 'defender_god_deployed';
        const prometheusUsed = query(
          `SELECT COUNT(*) as cnt FROM arena_battle_rounds 
           WHERE battle_id = ? AND ${myDeployCol} = 'prometheus' AND round_number < ?`,
          [battle_id, battle.current_round]
        )[0];
        if (prometheusUsed && prometheusUsed.cnt > 0) {
          return res.status(400).json({ error: 'Prometheus can only be used once per battle' });
        }
      }
      
      // Check cooldown
      const myCooldowns = JSON.parse(isChallenger ? (battle.challenger_god_cooldowns || '{}') : (battle.defender_god_cooldowns || '{}'));
      if (myCooldowns[god_name] && myCooldowns[god_name] > 0) {
        return res.status(400).json({ error: `${god_name} is on cooldown for ${myCooldowns[god_name]} more round(s)` });
      }
      
      // Set cooldown (2 rounds)
      const cooldownCol = isChallenger ? 'challenger_god_cooldowns' : 'defender_god_cooldowns';
      myCooldowns[god_name] = 2;
      run(`UPDATE arena_battles SET ${cooldownCol} = ? WHERE battle_id = ?`, [JSON.stringify(myCooldowns), battle_id]);
    }
    
    // Deploy the god and mark as ready
    const deployedCol = isChallenger ? 'challenger_god_deployed' : 'defender_god_deployed';
    run(`UPDATE arena_battle_rounds SET ${deployedCol} = ?, ${deployReadyCol} = 1 WHERE round_id = ?`, 
      [god_name || null, currentRound.round_id]);
    
    // Check if both have made their choices
    const updatedRound = query('SELECT * FROM arena_battle_rounds WHERE round_id = ?', [currentRound.round_id])[0];
    
    if (updatedRound.challenger_deploy_ready === 1 && updatedRound.defender_deploy_ready === 1) {
      // Both ready - check for counters and move to question phase
      const challengerGod = updatedRound.challenger_god_deployed;
      const defenderGod = updatedRound.defender_god_deployed;
      
      // Check for counters
      if (challengerGod && defenderGod && GOD_POWERS[challengerGod] && GOD_POWERS[defenderGod]) {
        const challengerPower = GOD_POWERS[challengerGod];
        const defenderPower = GOD_POWERS[defenderGod];
        
        if (challengerPower.counteredBy === defenderGod) {
          run('UPDATE arena_battle_rounds SET challenger_god_blocked = 1 WHERE round_id = ?', [currentRound.round_id]);
        }
        if (defenderPower.counteredBy === challengerGod) {
          run('UPDATE arena_battle_rounds SET defender_god_blocked = 1 WHERE round_id = ?', [currentRound.round_id]);
        }
      }
      
      // === CERBERUS BLOCK (Gate of Erebus building) ===
      // If a player deployed an offensive god and it wasn't already blocked by a defensive god,
      // check if the OPPONENT owns Gate of Erebus — if so, 33% chance Cerberus blocks it.
      try {
        // Re-fetch the round in case a counter block was just written above
        const roundAfterCounters = query('SELECT * FROM arena_battle_rounds WHERE round_id = ?', [currentRound.round_id])[0];
        
        const challengerAllianceBuildings = JSON.parse(
          query('SELECT buildings_owned FROM alliances WHERE alliance_id = ?', [battle.challenger_alliance_id])[0]?.buildings_owned || '[]'
        );
        const defenderAllianceBuildings = JSON.parse(
          query('SELECT buildings_owned FROM alliances WHERE alliance_id = ?', [battle.defender_alliance_id])[0]?.buildings_owned || '[]'
        );
        const challengerHasErebus = challengerAllianceBuildings.includes('Gate of Erebus');
        const defenderHasErebus = defenderAllianceBuildings.includes('Gate of Erebus');
        
        // Challenger deployed an offensive god → check if DEFENDER has Erebus to block it
        if (challengerGod && GOD_POWERS[challengerGod] && GOD_POWERS[challengerGod].type === 'offensive' 
            && !roundAfterCounters.challenger_god_blocked && defenderHasErebus) {
          const roll = Math.random();
          if (roll < 0.33) {
            run('UPDATE arena_battle_rounds SET challenger_god_blocked = 1 WHERE round_id = ?', [currentRound.round_id]);
            run(`INSERT OR IGNORE INTO cerberus_block_log (battle_id, round_id, blocked_player_id, roll) VALUES (?, ?, ?, ?)`,
              [battle_id, currentRound.round_id, battle.challenger_id, roll]);
            console.log(`🐕 CERBERUS BLOCKED challenger's ${challengerGod}! Roll: ${roll.toFixed(2)}`);
          }
        }
        
        // Defender deployed an offensive god → check if CHALLENGER has Erebus to block it
        if (defenderGod && GOD_POWERS[defenderGod] && GOD_POWERS[defenderGod].type === 'offensive'
            && !roundAfterCounters.defender_god_blocked && challengerHasErebus) {
          const roll = Math.random();
          if (roll < 0.33) {
            run('UPDATE arena_battle_rounds SET defender_god_blocked = 1 WHERE round_id = ?', [currentRound.round_id]);
            run(`INSERT OR IGNORE INTO cerberus_block_log (battle_id, round_id, blocked_player_id, roll) VALUES (?, ?, ?, ?)`,
              [battle_id, currentRound.round_id, battle.defender_id, roll]);
            console.log(`🐕 CERBERUS BLOCKED defender's ${defenderGod}! Roll: ${roll.toFixed(2)}`);
          }
        }
      } catch (cerberusErr) {
        // Non-fatal — Cerberus block is a bonus effect, don't let it break the battle
        console.log('Cerberus block check error (non-fatal):', cerberusErr.message);
      }
      
      // Move to question phase - question won't show until BOTH clients call /question-ready
      // Set phase_ends_at with extra time to account for sync wait
      const phaseEndsAt = new Date(Date.now() + BATTLE_TIMING.QUESTION_PHASE + 10000).toISOString();
      
      run("UPDATE arena_battle_rounds SET phase = 'question', phase_ends_at = ? WHERE round_id = ?", 
        [phaseEndsAt, currentRound.round_id]);
      
      console.log(`⏱️ BOTH DEPLOYED! Waiting for clients to sync via /question-ready`);
      
      // A4: Check if this player deployed Prometheus and it wasn't blocked
      let prometheusPreview = null;
      let prometheusPreviewDuration = null;
      const myDeployed = isChallenger ? updatedRound.challenger_god_deployed : updatedRound.defender_god_deployed;
      const myBlocked = isChallenger ? updatedRound.challenger_god_blocked : updatedRound.defender_god_blocked;
      
      if (myDeployed === 'prometheus' && !myBlocked) {
        // FIX 9: Removed prometheusUsedToday() gate — now once-per-battle (deploy is already blocked by Fix 8)
        // Get question text for preview
        const previewQ = query('SELECT question_text FROM battle_questions WHERE question_id = ?', 
          [currentRound.question_id])[0];
        if (previewQ) {
          // Check for bonus (50% building)
          const myGods = JSON.parse(isChallenger ? (battle.challenger_gods || '[]') : (battle.defender_gods || '[]'));
          const promData = myGods.find(g => (typeof g === 'string' ? g : g.name) === 'prometheus');
          const hasBonus = promData && typeof promData === 'object' && promData.hasBonus;
          
          prometheusPreview = previewQ.question_text;
          prometheusPreviewDuration = (hasBonus ? GOD_POWERS.prometheus.bonusEffect : GOD_POWERS.prometheus.baseEffect) * 1000;
          console.log(`🔥 Prometheus preview for student ${student_id}: ${prometheusPreviewDuration}ms`);
        }
      }
      
      saveDatabase();
      
      // Tell this player to refresh - they'll see question phase and call /question-ready
      return res.json({ 
        success: true, 
        both_ready: true,
        prometheus_preview: prometheusPreview,
        prometheus_preview_duration: prometheusPreviewDuration
      });
    }
    
    saveDatabase();
    res.json({ success: true, god_deployed: god_name, waiting_for_opponent: true });
    
  } catch (err) {
    console.error('Deploy god error:', err);
    res.status(500).json({ error: 'Failed to deploy god' });
  }
});

// === V93: Use Hecatoncheires scramble card ===
// Called by a student during the question phase to scramble their opponent's answers for 2 seconds.
// Requires Constellations virtue to be claimed (enforced at award time, not here).
app.post('/api/arena/use-scramble', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { battle_id } = req.body;

    if (!battle_id) return res.status(400).json({ error: 'Missing battle_id' });

    // 1. Verify the battle is in_progress and the student is in it
    const battle = query("SELECT * FROM arena_battles WHERE battle_id = ? AND status = 'in_progress'", [battle_id])[0];
    if (!battle) return res.status(404).json({ error: 'Battle not found or not in progress' });

    const isChallenger = battle.challenger_id === student_id;
    const isDefender = battle.defender_id === student_id;
    if (!isChallenger && !isDefender) return res.status(403).json({ error: 'You are not in this battle' });

    // 2. Verify the current round is in question phase (scramble fires during answering, not deploy)
    const currentRound = query(
      "SELECT * FROM arena_battle_rounds WHERE battle_id = ? AND round_number = ?",
      [battle_id, battle.current_round]
    )[0];
    if (!currentRound) return res.status(400).json({ error: 'No active round found' });
    if (currentRound.phase !== 'question') {
      return res.status(400).json({ error: 'Scramble can only be used during the question phase' });
    }

    // 3. Check student has a card
    const student = query('SELECT hecatoncheires_cards FROM students WHERE student_id = ?', [student_id])[0];
    if (!student || (student.hecatoncheires_cards || 0) < 1) {
      return res.status(400).json({ error: 'No Hecatoncheires cards available' });
    }

    // 4. Check this student hasn't already used scramble this round
    const myScrambleCol = isChallenger ? 'challenger_scramble_used' : 'defender_scramble_used';
    if (currentRound[myScrambleCol] === 1) {
      return res.status(400).json({ error: 'Already used scramble this round' });
    }

    // 5. Check scramble isn't already active from a previous use this round
    if (currentRound.scramble_active_until) {
      const activeUntil = new Date(currentRound.scramble_active_until);
      if (activeUntil > new Date()) {
        return res.status(400).json({ error: 'A scramble is already active this round' });
      }
    }

    // 6. Deduct the card and activate the scramble
    run('UPDATE students SET hecatoncheires_cards = hecatoncheires_cards - 1 WHERE student_id = ? AND hecatoncheires_cards > 0', [student_id]);

    // Scramble lasts 2500ms (2s effect + 500ms buffer for polling lag)
    const scrambleActiveUntil = new Date(Date.now() + 2500).toISOString();
    run(`UPDATE arena_battle_rounds 
         SET ${myScrambleCol} = 1, scramble_active_until = ?, scramble_used_by = ?
         WHERE round_id = ?`,
      [scrambleActiveUntil, student_id, currentRound.round_id]);

    saveDatabase();
    console.log(`⚡ HECATONCHEIRES SCRAMBLE used by student ${student_id} in battle ${battle_id} round ${battle.current_round}. Active until ${scrambleActiveUntil}`);

    const remainingCards = query('SELECT hecatoncheires_cards FROM students WHERE student_id = ?', [student_id])[0];
    res.json({
      success: true,
      scramble_active_until: scrambleActiveUntil,
      cards_remaining: remainingCards ? remainingCards.hecatoncheires_cards : 0
    });

  } catch (err) {
    console.error('Use scramble error:', err);
    res.status(500).json({ error: 'Failed to use scramble' });
  }
});

// Signal ready for question - both clients must call this before question displays
app.post('/api/arena/question-ready', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { battle_id } = req.body;
    
    const battle = query('SELECT * FROM arena_battles WHERE battle_id = ?', [battle_id])[0];
    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' });
    }
    
    const isChallenger = battle.challenger_id === student_id;
    const currentRound = query('SELECT * FROM arena_battle_rounds WHERE battle_id = ? AND round_number = ?',
      [battle_id, battle.current_round])[0];
    
    if (!currentRound || currentRound.phase !== 'question') {
      return res.json({ success: false, not_ready: true });
    }
    
    // Mark this player as ready
    const readyCol = isChallenger ? 'challenger_question_ready' : 'defender_question_ready';
    run(`UPDATE arena_battle_rounds SET ${readyCol} = 1 WHERE round_id = ?`, [currentRound.round_id]);
    
    // Check if BOTH are now ready
    const updatedRound = query('SELECT * FROM arena_battle_rounds WHERE round_id = ?', [currentRound.round_id])[0];
    
    if (updatedRound.challenger_question_ready === 1 && updatedRound.defender_question_ready === 1) {
      // BOTH ready - set display time 2 seconds in the future so both clients
      // pick it up on their next poll cycle simultaneously
      if (!updatedRound.question_display_time) {
        const displayTime = new Date(Date.now() + BATTLE_TIMING.SYNC_DELAY).toISOString();
        run('UPDATE arena_battle_rounds SET question_display_time = ? WHERE round_id = ?', 
          [displayTime, currentRound.round_id]);
        console.log(`⏱️ BOTH CLIENTS READY! Question will display at ${displayTime} (${BATTLE_TIMING.SYNC_DELAY}ms from now)`);
        saveDatabase();
        return res.json({ 
          success: true, 
          both_ready: true, 
          show_question: true,
          display_time: displayTime
        });
      } else {
        // Already set - return it
        return res.json({ 
          success: true, 
          both_ready: true, 
          show_question: true,
          display_time: updatedRound.question_display_time
        });
      }
    }
    
    // Waiting for other player
    saveDatabase();
    res.json({ success: true, waiting_for_opponent: true });
    
  } catch (err) {
    console.error('Question ready error:', err);
    res.status(500).json({ error: 'Failed to signal ready' });
  }
});

// Sudden Death Ready - both players must click Ready before question appears
app.post('/api/arena/sudden-death-ready', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { battle_id } = req.body;
    
    const battle = query('SELECT * FROM arena_battles WHERE battle_id = ?', [battle_id])[0];
    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' });
    }
    
    const isChallenger = battle.challenger_id === student_id;
    const isDefender = battle.defender_id === student_id;
    
    if (!isChallenger && !isDefender) {
      return res.status(403).json({ error: 'You are not part of this battle' });
    }
    
    const currentRound = query('SELECT * FROM arena_battle_rounds WHERE battle_id = ? AND round_number = ?',
      [battle_id, battle.current_round])[0];
    
    if (!currentRound || currentRound.phase !== 'sudden_death_intro') {
      return res.status(400).json({ error: 'Not in sudden death intro phase' });
    }
    
    // Mark this player as ready
    const readyCol = isChallenger ? 'challenger_question_ready' : 'defender_question_ready';
    run(`UPDATE arena_battle_rounds SET ${readyCol} = 1 WHERE round_id = ?`, [currentRound.round_id]);
    
    // Check if both ready
    const updated = query('SELECT * FROM arena_battle_rounds WHERE round_id = ?', [currentRound.round_id])[0];
    
    if (updated.challenger_question_ready === 1 && updated.defender_question_ready === 1) {
      // V3: Both ready - transition to question phase WITHOUT question_display_time.
      // The /question-ready handshake will set it when both clients signal they're ready.
      // This ensures BOTH players see the full countdown from the start.
      const phaseEndsAt = new Date(Date.now() + BATTLE_TIMING.QUESTION_PHASE + 10000).toISOString();
      
      run(`UPDATE arena_battle_rounds 
           SET phase = 'question', phase_ends_at = ?,
           challenger_question_ready = 0, defender_question_ready = 0
           WHERE round_id = ?`,
        [phaseEndsAt, currentRound.round_id]);
      
      console.log(`⚡ SUDDEN DEATH - Both ready! Waiting for countdown handshake via /question-ready`);
      saveDatabase();
      return res.json({ success: true, both_ready: true });
    }
    
    saveDatabase();
    res.json({ success: true, both_ready: false });
  } catch (err) {
    console.error('Sudden death ready error:', err);
    res.status(500).json({ error: 'Failed to mark ready' });
  }
});

// Score a completed round - extracted for Aphrodite retry delayed scoring
function scoreRound(battle_id, round_id) {
  try {
    const updated = query('SELECT * FROM arena_battle_rounds WHERE round_id = ?', [round_id])[0];
    if (!updated || updated.completed_at) {
      console.log(`⚠️ scoreRound: round ${round_id} already scored or not found`);
      return;
    }
    
    const battle = query('SELECT * FROM arena_battles WHERE battle_id = ?', [battle_id])[0];
    if (!battle) {
      console.log(`⚠️ scoreRound: battle ${battle_id} not found`);
      return;
    }
    
    console.log(`✅ Both answered - processing round results...`);
    
    // Determine round winner
    let roundWinner = null;
    let challengerScore = 0;
    let defenderScore = 0;
    
    // Base scoring: correct answer = 1 point
    if (updated.challenger_answer === 'correct') challengerScore = 1;
    if (updated.defender_answer === 'correct') defenderScore = 1;
    
    // Add Artemis bonuses
    challengerScore += (updated.artemis_bonus_challenger || 0);
    defenderScore += (updated.artemis_bonus_defender || 0);
    
    // Determine winner (if both correct, faster wins; if scores differ, higher wins)
    if (updated.challenger_answer === 'correct' && updated.defender_answer !== 'correct') {
      roundWinner = battle.challenger_id;
    } else if (updated.defender_answer === 'correct' && updated.challenger_answer !== 'correct') {
      roundWinner = battle.defender_id;
    } else if (updated.challenger_answer === 'correct' && updated.defender_answer === 'correct') {
      if (challengerScore > defenderScore) {
        roundWinner = battle.challenger_id;
      } else if (defenderScore > challengerScore) {
        roundWinner = battle.defender_id;
      } else {
        roundWinner = updated.challenger_time_ms < updated.defender_time_ms ? battle.challenger_id : battle.defender_id;
      }
    }
    
    run('UPDATE arena_battle_rounds SET round_winner_id = ?, completed_at = CURRENT_TIMESTAMP WHERE round_id = ?',
      [roundWinner, round_id]);
    
    // Update battle scores
    let newChallengerScore = battle.challenger_score || 0;
    let newDefenderScore = battle.defender_score || 0;
    if (roundWinner === battle.challenger_id) newChallengerScore++;
    if (roundWinner === battle.defender_id) newDefenderScore++;
    
    run('UPDATE arena_battles SET challenger_score = ?, defender_score = ? WHERE battle_id = ?',
      [newChallengerScore, newDefenderScore, battle_id]);
    
    // Decrement cooldowns for next round
    const challengerCooldowns = JSON.parse(battle.challenger_god_cooldowns || '{}');
    const defenderCooldowns = JSON.parse(battle.defender_god_cooldowns || '{}');
    Object.keys(challengerCooldowns).forEach(g => { if (challengerCooldowns[g] > 0) challengerCooldowns[g]--; });
    Object.keys(defenderCooldowns).forEach(g => { if (defenderCooldowns[g] > 0) defenderCooldowns[g]--; });
    run('UPDATE arena_battles SET challenger_god_cooldowns = ?, defender_god_cooldowns = ? WHERE battle_id = ?',
      [JSON.stringify(challengerCooldowns), JSON.stringify(defenderCooldowns), battle_id]);
    
    // Check for battle end
    const isSuddenDeath = battle.current_round > 5;
    const regularBattleOver = (newChallengerScore >= 3 || newDefenderScore >= 3) || 
                              (battle.current_round >= 5 && newChallengerScore !== newDefenderScore);
    const suddenDeathOver = isSuddenDeath && roundWinner !== null;
    
    if (regularBattleOver || suddenDeathOver) {
      const winner = newChallengerScore > newDefenderScore ? battle.challenger_id : 
                     newDefenderScore > newChallengerScore ? battle.defender_id : null;
      
      run("UPDATE arena_battles SET status = 'completed', winner_id = ?, completed_at = CURRENT_TIMESTAMP WHERE battle_id = ?",
        [winner, battle_id]);
      
      if (winner) {
        const challengerWon = winner === battle.challenger_id;
        const stakes = battle.point_stakes || 0;
        
        console.log(`⚔️ BATTLE COMPLETE - Winner: ${winner}, Stakes: ${stakes}, ChallengerWon: ${challengerWon}`);
        
        if (challengerWon) {
          run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
            [stakes, battle.challenger_alliance_id]);
          run('UPDATE alliances SET total_points = MAX(0, total_points - ?) WHERE alliance_id = ?', 
            [Math.floor(stakes / 2), battle.defender_alliance_id]);
        } else {
          run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
            [stakes, battle.defender_alliance_id]);
          run('UPDATE alliances SET total_points = MAX(0, total_points - ?) WHERE alliance_id = ?', 
            [stakes, battle.challenger_alliance_id]);
        }
      }
      
      // Update battle stats
      const today = new Date().toISOString().split('T')[0];
      [battle.challenger_id, battle.defender_id].forEach(pid => {
        const isWinner = pid === winner;
        const isTie = winner === null;
        run(`UPDATE arena_battle_stats SET 
          total_battles = total_battles + 1,
          wins = wins + ?,
          losses = losses + ?,
          current_streak = CASE WHEN ? = 1 THEN current_streak + 1 ELSE 0 END,
          best_streak = CASE WHEN ? = 1 AND current_streak + 1 > best_streak THEN current_streak + 1 ELSE best_streak END,
          battles_today = CASE WHEN last_battle_date = ? THEN battles_today + 1 ELSE 1 END,
          last_battle_date = ?
          WHERE student_id = ?`,
          [isWinner ? 1 : 0, (isTie || isWinner) ? 0 : 1, isWinner ? 1 : 0, isWinner ? 1 : 0, today, today, pid]);
      });
      
      saveDatabase();
      
      // Check and award badges
      try {
        checkAndAwardBadges(battle.challenger_id, battle_id);
        checkAndAwardBadges(battle.defender_id, battle_id);
        saveDatabase();
      } catch (badgeErr) {
        console.error('Badge check error (non-fatal):', badgeErr.message);
      }
    } else if (battle.current_round >= 5 && newChallengerScore === newDefenderScore) {
      // Tied after 5 rounds - sudden death
      const nextRound = battle.current_round + 1;
      const usedQuestions = query('SELECT question_id FROM arena_battle_rounds WHERE battle_id = ?', [battle_id]);
      const usedIds = usedQuestions.map(q => q.question_id);
      const nextQ = getAdaptiveBattleQuestion(battle.challenger_id, battle.defender_id, usedIds);
      
      if (nextQ) {
        const phaseEndsAt = new Date(Date.now() + BATTLE_TIMING.SUDDEN_DEATH_INTRO).toISOString();
        run('UPDATE arena_battles SET current_round = ? WHERE battle_id = ?', [nextRound, battle_id]);
        run(`INSERT INTO arena_battle_rounds (battle_id, round_number, question_id, phase, phase_ends_at, 
             challenger_question_ready, defender_question_ready, started_at) 
             VALUES (?, ?, ?, 'sudden_death_intro', ?, 0, 0, CURRENT_TIMESTAMP)`,
          [battle_id, nextRound, nextQ.question_id, phaseEndsAt]);
        console.log(`⚡ SUDDEN DEATH Round ${nextRound} created - phase: sudden_death_intro`);
      }
      saveDatabase();
    } else {
      // Results phase
      const resultsEndsAt = new Date(Date.now() + BATTLE_TIMING.ANSWER_FEEDBACK + BATTLE_TIMING.RESULTS_PHASE).toISOString();
      run("UPDATE arena_battle_rounds SET phase = 'results', phase_ends_at = ? WHERE round_id = ?",
        [resultsEndsAt, round_id]);
      saveDatabase();
    }
  } catch (err) {
    console.error('scoreRound error:', err);
  }
}

// Submit answer
app.post('/api/arena/answer', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { battle_id, answer_index, time_ms } = req.body;
    
    console.log(`🎯 Answer submission: battle=${battle_id}, student=${student_id}, answer=${answer_index}, time=${time_ms}`);
    
    const battle = query("SELECT * FROM arena_battles WHERE battle_id = ? AND status = 'in_progress'", [battle_id])[0];
    if (!battle) {
      console.log('❌ Battle not found or not in progress');
      return res.status(404).json({ error: 'Battle not found' });
    }
    
    const isChallenger = battle.challenger_id === student_id;
    const currentRound = query('SELECT * FROM arena_battle_rounds WHERE battle_id = ? AND round_number = ?',
      [battle_id, battle.current_round])[0];
    
    if (!currentRound) {
      console.log('❌ No current round found');
      return res.status(400).json({ error: 'No active round' });
    }
    
    console.log(`📊 Current round: ${currentRound.round_number}, phase: ${currentRound.phase}, challenger_ans: ${currentRound.challenger_answer}, defender_ans: ${currentRound.defender_answer}`);
    
    // Check phase - must be in question phase to answer
    if (currentRound.phase !== 'question') {
      console.log(`⚠️ Tried to answer in wrong phase: ${currentRound.phase}`);
      return res.status(400).json({ error: 'Not in question phase' });
    }
    
    // Check if already answered
    const existingAnswer = isChallenger ? currentRound.challenger_answer : currentRound.defender_answer;
    if (existingAnswer) {
      // Allow Aphrodite retry: if first answer was wrong and player has Aphrodite deployed (not blocked)
      const myGodForRetry = isChallenger ? currentRound.challenger_god_deployed : currentRound.defender_god_deployed;
      const myGodBlockedForRetry = isChallenger ? currentRound.challenger_god_blocked : currentRound.defender_god_blocked;
      const myTimeMs = isChallenger ? currentRound.challenger_time_ms : currentRound.defender_time_ms;
      
      if (existingAnswer === 'wrong' && myGodForRetry === 'aphrodite' && !myGodBlockedForRetry && !currentRound.completed_at) {
        // Aphrodite retry allowed - round hasn't been scored yet
        console.log(`💕 Aphrodite retry attempt - first answer was wrong, round not yet scored, retrying`);
        // Allow - fall through to process the new answer
      } else {
        console.log(`⚠️ Already answered: ${existingAnswer}`);
        return res.status(400).json({ error: 'Already answered this round' });
      }
    }
    
    // Get question and use seeded shuffle to match battle state
    const question = query('SELECT * FROM battle_questions WHERE question_id = ?', [currentRound.question_id])[0];
    
    if (!question) {
      console.error('Question not found for round:', currentRound.round_id, 'question_id:', currentRound.question_id);
      return res.status(400).json({ error: 'Question not found for this round' });
    }
    
    const seed = currentRound.round_id;
    const answers = [
      { text: question.correct_answer, isCorrect: true },
      { text: question.wrong_answer_1, isCorrect: false },
      { text: question.wrong_answer_2, isCorrect: false },
      { text: question.wrong_answer_3, isCorrect: false }
    ];
    // Seeded shuffle - MUST match the one in battle state endpoint
    for (let i = answers.length - 1; i > 0; i--) {
      const j = Math.floor(((seed * (i + 1) * 9301 + 49297) % 233280) / 233280 * (i + 1));
      [answers[i], answers[j]] = [answers[j], answers[i]];
    }
    
    const isCorrect = answer_index >= 0 && answer_index < 4 && answers[answer_index]?.isCorrect;
    
    // Check for Artemis bonus (answered correctly in first 5 seconds = +1 alliance point)
    let artemisBonus = 0;
    let artemisAllianceBonus = 0;
    const myGod = isChallenger ? currentRound.challenger_god_deployed : currentRound.defender_god_deployed;
    const myGodBlocked = isChallenger ? currentRound.challenger_god_blocked : currentRound.defender_god_blocked;
    
    if (myGod === 'artemis' && !myGodBlocked && isCorrect && time_ms <= 5000) {
      // Award +1 alliance point for fast correct answer
      artemisAllianceBonus = 1;
      const myAllianceId = isChallenger ? battle.challenger_alliance_id : battle.defender_alliance_id;
      if (myAllianceId) {
        run('UPDATE alliances SET total_points = total_points + 1 WHERE alliance_id = ?', [myAllianceId]);
        console.log(`🏹 Artemis bonus: +1 alliance point to alliance ${myAllianceId} for fast correct answer (${time_ms}ms)`);
      }
    }
    
    const answerCol = isChallenger ? 'challenger_answer' : 'defender_answer';
    const timeCol = isChallenger ? 'challenger_time_ms' : 'defender_time_ms';
    const artemisCol = isChallenger ? 'artemis_bonus_challenger' : 'artemis_bonus_defender';
    
    run(`UPDATE arena_battle_rounds SET ${answerCol} = ?, ${timeCol} = ?, ${artemisCol} = ? WHERE round_id = ?`,
      [isCorrect ? 'correct' : 'wrong', time_ms || 15000, artemisBonus, currentRound.round_id]);
    
    // Check if both answered
    const updated = query('SELECT * FROM arena_battle_rounds WHERE round_id = ?', [currentRound.round_id])[0];
    
    console.log(`📝 Answer submitted - Round ${currentRound.round_number}, Challenger: ${updated.challenger_answer}, Defender: ${updated.defender_answer}`);
    
    if (updated.challenger_answer && updated.defender_answer) {
      // Check if either player has Aphrodite active with a wrong answer - delay scoring for retry
      const challengerGod = updated.challenger_god_deployed;
      const defenderGod = updated.defender_god_deployed;
      const challengerBlocked = updated.challenger_god_blocked;
      const defenderBlocked = updated.defender_god_blocked;
      
      const challengerNeedsRetry = updated.challenger_answer === 'wrong' && challengerGod === 'aphrodite' && !challengerBlocked && !updated.completed_at;
      const defenderNeedsRetry = updated.defender_answer === 'wrong' && defenderGod === 'aphrodite' && !defenderBlocked && !updated.completed_at;
      
      if (challengerNeedsRetry || defenderNeedsRetry) {
        console.log(`💕 Aphrodite retry window active - delaying round scoring for 6 seconds`);
        // Don't score yet - the Aphrodite player may retry
        // Schedule a delayed scoring check in case they don't retry
        const roundId = currentRound.round_id;
        const battleId = battle_id;
        setTimeout(() => {
          try {
            const roundCheck = query('SELECT * FROM arena_battle_rounds WHERE round_id = ?', [roundId])[0];
            if (roundCheck && !roundCheck.completed_at && roundCheck.challenger_answer && roundCheck.defender_answer) {
              console.log(`💕 Aphrodite retry window expired - scoring round now`);
              scoreRound(battleId, roundId);
            }
          } catch (err) {
            console.error('Aphrodite delayed scoring error:', err);
          }
        }, 6000); // FIX 10: 6 seconds — gives comfortable margin over client's 4-second retry window
        
        saveDatabase();
      } else if (!updated.completed_at) {
        // Normal scoring - no Aphrodite retry pending
        scoreRound(battle_id, currentRound.round_id);
      }
    }
    
    saveDatabase();
    
    // Check if Aphrodite retry is available (wrong answer + Aphrodite deployed + not blocked)
    const myGodDeployed = isChallenger ? currentRound.challenger_god_deployed : currentRound.defender_god_deployed;
    const myGodWasBlocked = isChallenger ? currentRound.challenger_god_blocked : currentRound.defender_god_blocked;
    const aphroditeRetryAvailable = !isCorrect && myGodDeployed === 'aphrodite' && !myGodWasBlocked && !existingAnswer;
    
    res.json({ 
      success: true, 
      was_correct: isCorrect, 
      artemis_bonus: artemisBonus,
      artemis_alliance_bonus: artemisAllianceBonus,
      aphrodite_retry_available: aphroditeRetryAvailable
    });
  } catch (err) {
    console.error('Submit answer error:', err);
    res.status(500).json({ error: 'Failed to submit answer' });
  }
});

// Forfeit/Withdraw from battle
app.post('/api/arena/forfeit', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { battle_id } = req.body;
    
    const battle = query('SELECT * FROM arena_battles WHERE battle_id = ?', [battle_id])[0];
    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' });
    }
    
    const isChallenger = battle.challenger_id === student_id;
    const isDefender = battle.defender_id === student_id;
    
    if (!isChallenger && !isDefender) {
      return res.status(403).json({ error: 'You are not part of this battle' });
    }
    
    // Only allow forfeit if battle is pending, accepted, or in_progress
    if (!['pending', 'accepted', 'in_progress'].includes(battle.status)) {
      return res.status(400).json({ error: 'Cannot forfeit a completed battle' });
    }
    
    const winner_id = isChallenger ? battle.defender_id : battle.challenger_id;
    const loser_id = student_id;
    
    // Mark battle as complete with forfeit
    run("UPDATE arena_battles SET status = 'complete', winner_id = ?, completed_at = CURRENT_TIMESTAMP WHERE battle_id = ?",
      [winner_id, battle_id]);
    
    // Get alliances
    const winner = query('SELECT alliance_id FROM students WHERE student_id = ?', [winner_id])[0];
    const loser = query('SELECT alliance_id FROM students WHERE student_id = ?', [loser_id])[0];
    
    // Apply point penalty for forfeit (loser loses full stakes, winner gets half)
    if (winner && loser && battle.point_stakes > 0) {
      const stakes = battle.point_stakes;
      run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', [Math.floor(stakes / 2), winner.alliance_id]);
      run('UPDATE alliances SET total_points = MAX(0, total_points - ?) WHERE alliance_id = ?', [stakes, loser.alliance_id]);
      
      console.log(`🏳️ Battle ${battle_id} forfeited by student ${loser_id}. Winner: ${winner_id}`);
    }
    
    saveDatabase();
    res.json({ success: true, message: 'Battle forfeited' });
  } catch (err) {
    console.error('Forfeit error:', err);
    res.status(500).json({ error: 'Failed to forfeit battle' });
  }
});

// Teacher: Toggle arena
app.post('/api/teacher/arena/toggle', authenticateToken, (req, res) => {
  try {
    const { enabled } = req.body;
    run("INSERT OR REPLACE INTO arena_settings (setting_type, setting_key, setting_value) VALUES ('global', 'enabled', ?)",
      [enabled ? 'true' : 'false']);
    saveDatabase();
    res.json({ success: true, message: `Arena ${enabled ? 'enabled' : 'disabled'}` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle arena' });
  }
});

// Teacher: Toggle arena for specific student
app.post('/api/teacher/arena/toggle-student', authenticateToken, (req, res) => {
  try {
    const { student_id, enabled } = req.body;
    run("INSERT OR REPLACE INTO arena_settings (setting_type, setting_key, setting_value) VALUES ('student', ?, ?)",
      [String(student_id), enabled ? 'true' : 'false']);
    saveDatabase();
    res.json({ success: true, message: `Arena ${enabled ? 'enabled' : 'disabled'} for student` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to toggle arena for student' });
  }
});

// Teacher: Get arena settings
app.get('/api/teacher/arena/settings', authenticateToken, (req, res) => {
  try {
    const globalSetting = query("SELECT setting_value FROM arena_settings WHERE setting_type = 'global' AND setting_key = 'enabled'")[0];
    const studentSettings = query("SELECT setting_key as student_id, setting_value FROM arena_settings WHERE setting_type = 'student'");
    
    res.json({
      global_enabled: !globalSetting || globalSetting.setting_value !== 'false',
      student_settings: studentSettings.reduce((acc, s) => {
        acc[s.student_id] = s.setting_value === 'true';
        return acc;
      }, {})
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get arena settings' });
  }
});

// Abandon/dismiss stuck battle
app.post('/api/arena/abandon-battle', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { battle_id } = req.body;
    
    // Only allow abandoning battles the user is part of
    const battle = query('SELECT * FROM arena_battles WHERE battle_id = ? AND (challenger_id = ? OR defender_id = ?)',
      [battle_id, student_id, student_id])[0];
    
    if (!battle) {
      return res.status(404).json({ error: 'Battle not found' });
    }
    
    // Mark as expired/abandoned
    run("UPDATE arena_battles SET status = 'expired' WHERE battle_id = ?", [battle_id]);
    saveDatabase();
    
    res.json({ success: true, message: 'Battle abandoned' });
  } catch (err) {
    console.error('Abandon battle error:', err);
    res.status(500).json({ error: 'Failed to abandon battle' });
  }
});

// Auto-expire old stuck battles (run on server start and periodically)
function cleanupStuckBattles() {
  if (!dbReady) return; // Don't run if database not ready
  try {
    // Expire battles that have been in_progress for more than 10 minutes
    const result = run(`UPDATE arena_battles SET status = 'expired' 
      WHERE status IN ('pending', 'accepted', 'in_progress') 
      AND datetime(COALESCE(started_at, created_at), '+10 minutes') < datetime('now')`);
    console.log('✅ Cleaned up stuck battles');
  } catch (err) {
    console.log('Cleanup note:', err.message);
  }
}

// Run cleanup every 5 minutes (startup cleanup happens in app.listen)
setInterval(cleanupStuckBattles, 5 * 60 * 1000);

// Get god powers info (public endpoint for info modal)
app.get('/api/arena/god-powers', authenticateToken, (req, res) => {
  try {
    res.json({ god_powers: GOD_POWERS });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get god powers' });
  }
});

// Mark badge celebration as seen
app.post('/api/arena/badge-celebration-seen', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { badge_key } = req.body;
    
    if (!badge_key || !ARENA_BADGES[badge_key]) {
      return res.status(400).json({ error: 'Invalid badge key' });
    }
    
    run('UPDATE arena_badges SET celebration_seen = 1 WHERE student_id = ? AND badge_key = ?',
      [student_id, badge_key]);
    saveDatabase();
    
    res.json({ success: true });
  } catch (err) {
    console.error('Badge celebration seen error:', err);
    res.status(500).json({ error: 'Failed to update badge' });
  }
});

// ====================
// CLASSICAL AGE ENDPOINTS
// ====================

// --- Student: Get Classical Age status (used by hub.html) ---
app.get('/api/student/classical-status', authenticateToken, (req, res) => {
  try {
    const student = query('SELECT * FROM students WHERE student_id = ?', [req.user.id])[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    
    const alliance = student.alliance_id ? 
      query('SELECT * FROM alliances WHERE alliance_id = ?', [student.alliance_id])[0] : null;
    
    // Check if teacher opened Classical gate for this period
    const ageGate = query('SELECT * FROM age_gates WHERE class_period = ?', [student.class_period])[0];
    const gateOpen = ageGate ? ageGate.classical_unlocked === 1 : false;
    
    // Can access if: (gate is open AND alliance is Classical or Heroic) OR student is a scout for Classical+
    const allianceAge = alliance ? alliance.current_age : 'Archaic';
    const isScout = student.scout_status && (student.scout_status === 'Classical' || student.scout_status === 'Heroic');
    const canAccess = (gateOpen && (allianceAge === 'Classical' || allianceAge === 'Heroic')) || isScout;
    
    res.json({
      gateOpen,
      allianceAge: isScout ? student.scout_status : allianceAge,
      canAccess,
      classicalEntered: student.classical_entered === 1,
      isScout: isScout || false,
      heroicGateOpen: ageGate ? ageGate.heroic_unlocked === 1 : false,
      virtueCount: (() => {
        try {
          const vc = query('SELECT COUNT(*) as cnt FROM student_myth_completion WHERE student_id = ? AND virtue_claimed = 1', [req.user.id])[0];
          return vc ? vc.cnt : 0;
        } catch(e) { return 0; }
      })(),
      selectedAvatar: student.selected_avatar || null
    });
  } catch (err) {
    console.error('Classical status error:', err);
    res.status(500).json({ error: 'Failed to get classical status' });
  }
});

// --- Student: Enter Classical Age (first time cinematic trigger) ---
app.post('/api/student/enter-classical', authenticateToken, (req, res) => {
  try {
    const student = query('SELECT * FROM students WHERE student_id = ?', [req.user.id])[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    
    if (student.classical_entered !== 1) {
      run('UPDATE students SET classical_entered = 1 WHERE student_id = ?', [req.user.id]);
      saveDatabase();
    }
    
    res.json({ success: true, firstTime: student.classical_entered !== 1 });
  } catch (err) {
    console.error('Enter classical error:', err);
    res.status(500).json({ error: 'Failed to enter classical' });
  }
});

// --- Student: Get Myth Portals with progress ---
app.get('/api/student/myth-portals', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const student = query('SELECT class_period, alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });

    let portals = [];
    try {
      portals = query(`
        SELECT p.*, 
               COALESCE(ps.activated, 0) as activated,
               ps.activated_at
        FROM myth_portals p
        LEFT JOIN myth_portal_status ps ON p.portal_id = ps.portal_id AND ps.class_period = ?
        ORDER BY p.myth_number
      `, [student.class_period]);
    } catch (tableErr) {
      console.error('myth_portals table error:', tableErr.message);
      return res.json({ portals: [], virtues_earned: 0, error: 'myth_portals table not found' });
    }
    console.log(`Myth portals: ${portals.length} found for student ${student_id} (${student.class_period})`);
    if (portals.length === 0) return res.json({ portals: [], virtues_earned: 0 });

    // Get student's grade records WITH assignment info for virtue checks
    const gradeRecords = query(`
      SELECT gr.*, ar.assignment_type, ar.myth_god, ar.section, ar.age, ar.max_points as assignment_max
      FROM grade_records gr
      JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
      WHERE gr.student_id = ?
    `, [student_id]);
    
    // Get quiz attempts
    const quizAttempts = query('SELECT portal_id, passed, score, percentage FROM myth_quiz_attempts WHERE student_id = ? AND passed = 1', [student_id]);

    // Get myth completion records (teacher-approved portal assignments)
    let mythCompletions = [];
    try {
      mythCompletions = query('SELECT * FROM student_myth_completion WHERE student_id = ?', [student_id]);
    } catch (e) {
      // Table may not exist yet
    }

    // Alias map: myth_portals.myth_name → assignments_ref.myth_god values
    // (portal names use '&' format, assignments_ref uses short/'and' format)
    const portalMythAliases = {
      'Pandora': ['Pandora'],
      'Phaethon': ['Phaethon'],
      'Orpheus & Eurydice': ['Orpheus', 'Orpheus & Eurydice', 'Orpheus and Eurydice'],
      'Echo & Narcissus': ['Echo and Narcissus', 'Echo & Narcissus'],
      'Icarus & Daedalus': ['Icarus', 'Icarus & Daedalus', 'Icarus and Daedalus'],
      'Eros & Psyche': ['Eros and Psyche', 'Eros & Psyche'],
      'Constellations': ['Constellations']
    };

    // Build enriched portal data
    const enrichedPortals = portals.map(portal => {
      const aliases = portalMythAliases[portal.myth_name] || [portal.myth_name];

      // Check reading guide completion (comp_conn for this myth in classical section)
      const hasReadingGuide = gradeRecords.some(g => 
        g.assignment_type === 'comp_conn' && 
        aliases.includes(g.myth_god) && 
        g.section === 'classical' &&
        g.points_earned > 0
      );
      
      // Check quiz passed (from myth_quiz_attempts, 80%+ to pass)
      const quizResult = quizAttempts.find(q => q.portal_id === portal.portal_id);
      const quizPassed = quizResult ? 1 : 0;
      
      // Check creative work (word_cloud, mural, creative, or cer for this myth)
      const hasCreative = gradeRecords.some(g => 
        (g.assignment_type === 'word_cloud' || g.assignment_type === 'mural' || g.assignment_type === 'creative' || g.assignment_type === 'cer') && 
        aliases.includes(g.myth_god) && 
        g.section === 'classical_creative' &&
        g.points_earned > 0
      );
      
      // Check new portal assignment system
      const mythCompletion = mythCompletions.find(mc => mc.portal_id === portal.portal_id);
      const assignmentApproved = mythCompletion ? mythCompletion.teacher_approved === 1 : false;
      const virtueClaimed = mythCompletion ? mythCompletion.virtue_claimed === 1 : false;
      const assignmentPath = mythCompletion ? mythCompletion.assignment_path : null;
      const assignmentPoints = mythCompletion ? (mythCompletion.points_earned || 15) : 0;
      
      // Get actual reading guide score from grade_records
      const guideGrade = gradeRecords.find(g => 
        g.assignment_type === 'comp_conn' && 
        aliases.includes(g.myth_god) && 
        g.section === 'classical'
      );
      const guideEarned = guideGrade ? guideGrade.points_earned : 0;
      const guidePossible = guideGrade ? (guideGrade.assignment_max || guideGrade.points_possible) : 12;
      
      // Virtue ready to claim: reading guide + quiz passed + creative approved (but not yet claimed)
      const virtueReady = hasReadingGuide && quizPassed && (assignmentApproved || hasCreative) && !virtueClaimed ? 1 : 0;
      // Virtue earned: only after student has claimed it
      const virtueEarned = virtueClaimed ? 1 : 0;
      
      return {
        ...portal,
        has_reading_guide: hasReadingGuide ? 1 : 0,
        guide_earned: guideEarned,
        guide_possible: guidePossible,
        quiz_passed: quizPassed,
        quiz_score: quizResult ? quizResult.score : 0,
        has_creative: hasCreative ? 1 : 0,
        assignment_approved: assignmentApproved ? 1 : 0,
        assignment_earned: assignmentApproved ? assignmentPoints : 0,
        assignment_possible: 15,
        assignment_path: assignmentPath,
        virtue_earned: virtueEarned,
        virtue_ready: virtueReady,
        virtue_claimed: virtueClaimed ? 1 : 0
      };
    });
    
    const virtuesEarned = enrichedPortals.filter(p => p.virtue_claimed === 1).length;
    
    res.json({ portals: enrichedPortals, class_period: student.class_period, virtues_earned: virtuesEarned });
  } catch (err) {
    console.error('Myth portals error:', err);
    res.status(500).json({ error: 'Failed to load myth portals' });
  }
});

// --- Student: Claim virtue after teacher approval ---
app.post('/api/student/claim-virtue', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { portal_id } = req.body;
    if (!portal_id) return res.status(400).json({ error: 'Missing portal_id' });
    
    // Get portal data first (needed for all checks)
    const portal = query('SELECT * FROM myth_portals WHERE portal_id = ?', [portal_id])[0];
    if (!portal) return res.status(404).json({ error: 'Portal not found' });
    
    // Alias map for myth_god matching across tables
    const mythAliases = {
      'Pandora': ['Pandora'],
      'Phaethon': ['Phaethon'],
      'Orpheus & Eurydice': ['Orpheus', 'Orpheus & Eurydice', 'Orpheus and Eurydice'],
      'Echo & Narcissus': ['Echo and Narcissus', 'Echo & Narcissus'],
      'Icarus & Daedalus': ['Icarus', 'Icarus & Daedalus', 'Icarus and Daedalus'],
      'Eros & Psyche': ['Eros and Psyche', 'Eros & Psyche'],
      'Constellations': ['Constellations']
    };
    const aliases = mythAliases[portal.myth_name] || [portal.myth_name];
    const placeholders = aliases.map(() => '?').join(',');
    
    // Check quiz passed
    const quizCheck = query(
      'SELECT 1 FROM myth_quiz_attempts WHERE student_id = ? AND portal_id = ? AND passed = 1 LIMIT 1',
      [student_id, portal_id]
    );
    if (!quizCheck.length) {
      return res.status(400).json({ error: 'You must pass the quiz before claiming this virtue' });
    }
    
    // Check reading guide completed
    const guideCheck = query(
      `SELECT 1 FROM grade_records gr
       JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
       WHERE gr.student_id = ? AND ar.assignment_type = 'comp_conn' 
       AND ar.section = 'classical' AND ar.myth_god IN (${placeholders})
       AND gr.points_earned > 0 LIMIT 1`,
      [student_id, ...aliases]
    );
    if (!guideCheck.length) {
      return res.status(400).json({ error: 'You must complete the Reading Guide before claiming this virtue' });
    }
    
    // Check creative/CER assignment completed (grade record exists in classical_creative)
    const creativeCheck = query(
      `SELECT gr.points_earned, ar.assignment_type FROM grade_records gr
       JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
       WHERE gr.student_id = ? AND ar.section = 'classical_creative'
       AND ar.assignment_type IN ('word_cloud', 'mural', 'creative', 'cer')
       AND ar.myth_god IN (${placeholders})
       AND gr.points_earned > 0 LIMIT 1`,
      [student_id, ...aliases]
    );
    
    // Check student_myth_completion row
    let completion = query('SELECT * FROM student_myth_completion WHERE student_id = ? AND portal_id = ?', [student_id, portal_id]);
    
    if (!completion.length || !completion[0].teacher_approved) {
      // No myth_completion row — check if creative grade record exists as proof of completion
      // (the bridge may have failed to create the row even though the assignment was approved)
      if (creativeCheck.length) {
        // All requirements verified via grade_records — auto-create the missing row
        const path = (creativeCheck[0].assignment_type === 'cer') ? 'analytical' : 'creative';
        const pts = creativeCheck[0].points_earned;
        
        if (completion.length) {
          // Row exists but teacher_approved = 0 — update it
          run(`UPDATE student_myth_completion SET assignment_path = ?, teacher_approved = 1, approved_at = CURRENT_TIMESTAMP, points_earned = ? WHERE student_id = ? AND portal_id = ?`,
            [path, pts, student_id, portal_id]);
        } else {
          // No row at all — create it
          run(`INSERT INTO student_myth_completion (student_id, portal_id, assignment_path, teacher_approved, approved_at, points_earned) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, ?)`,
            [student_id, portal_id, path, pts]);
        }
        console.log(`🔧 Auto-created myth_completion for student ${student_id}, portal ${portal_id} (bridge recovery)`);
        
        // Re-fetch the row
        completion = query('SELECT * FROM student_myth_completion WHERE student_id = ? AND portal_id = ?', [student_id, portal_id]);
      } else {
        return res.status(400).json({ error: 'Assignment not yet approved' });
      }
    }
    
    if (completion[0].virtue_claimed) {
      return res.status(400).json({ error: 'Virtue already claimed' });
    }
    
    // Mark virtue as claimed
    run('UPDATE student_myth_completion SET virtue_claimed = 1, virtue_claimed_at = CURRENT_TIMESTAMP WHERE student_id = ? AND portal_id = ?', [student_id, portal_id]);
    
    // Count total virtues earned
    const totalVirtues = query('SELECT COUNT(*) as count FROM student_myth_completion WHERE student_id = ? AND virtue_claimed = 1', [student_id])[0].count;
    
    // === V93: Award Hecatoncheires card for completing Constellations (portal 7) ===
    let hecatoncheiresAwarded = false;
    if (parseInt(portal_id) === 7) {
      // Only award if student doesn't already have one (idempotent — safe if claimed twice somehow)
      const currentCards = query('SELECT hecatoncheires_cards FROM students WHERE student_id = ?', [student_id])[0];
      if (currentCards && (currentCards.hecatoncheires_cards || 0) === 0) {
        run('UPDATE students SET hecatoncheires_cards = 1 WHERE student_id = ?', [student_id]);
        hecatoncheiresAwarded = true;
        console.log(`⚡ Hecatoncheires card awarded to student ${student_id} (Constellations virtue claimed)`);
      }
    }
    
    res.json({
      success: true,
      virtue: {
        myth_name: portal.myth_name,
        display_name: portal.display_name,
        virtue_english: portal.virtue_english,
        virtue_greek: portal.virtue_greek,
        virtue_description: portal.virtue_description,
        virtue_emoji: portal.virtue_emoji,
        glow_color: portal.glow_color
      },
      total_virtues: totalVirtues,
      hecatoncheires_awarded: hecatoncheiresAwarded  // client can show a bonus celebration if true
    });
  } catch (err) {
    console.error('Claim virtue error:', err);
    res.status(500).json({ error: 'Failed to claim virtue' });
  }
});

// --- Student: Select Heroic Age avatar ---
const AVATAR_DRACHMA = {
  seeker: 300,
  fallen: 400,
  devoted: 150,
  mirror: 250,
  builder: 200,
  tested: 100,
  eternal: 200
};
const VALID_AVATARS = Object.keys(AVATAR_DRACHMA);

app.post('/api/student/select-avatar', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { avatar } = req.body;
    
    // Avatar key is composite: 'seeker_male_medium' — validate the base archetype
    const baseAvatar = avatar ? avatar.split('_')[0] : null;
    if (!baseAvatar || !VALID_AVATARS.includes(baseAvatar)) {
      return res.status(400).json({ error: 'Invalid avatar selection' });
    }
    
    const student = query('SELECT student_id, alliance_id, class_period, current_age, selected_avatar FROM students WHERE student_id = ?', [student_id])[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    
    // Block re-selection — this is the permanent gate
    if (student.selected_avatar) {
      return res.status(400).json({ error: 'Avatar already selected. This choice is permanent.' });
    }
    
    // Gate: heroic_unlocked must be open for this period — teacher controls this
    const gate = query('SELECT heroic_unlocked FROM age_gates WHERE class_period = ?', [student.class_period])[0];
    if (!gate || gate.heroic_unlocked !== 1) {
      return res.status(400).json({ error: 'The Heroic Age gate is not yet open' });
    }
    
    // Verify alliance has reached Heroic age (alliance.current_age, not students.current_age)
    const alliance = query('SELECT current_age, alliance_id FROM alliances WHERE alliance_id = ?', [student.alliance_id])[0];
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    if (alliance.current_age !== 'Heroic') {
      return res.status(400).json({ error: 'Your alliance has not yet reached the Heroic Age.' });
    }
    
    // Use base archetype key for drachma lookup (composite key = 'seeker_male_medium')
    const drachma = AVATAR_DRACHMA[baseAvatar];
    run('UPDATE students SET selected_avatar = ?, drachma = ?, avatar_selected_at = CURRENT_TIMESTAMP, current_age = ? WHERE student_id = ?',
      [avatar, drachma, 'Heroic', student_id]);
    
    if (student.alliance_id) {
      run(`INSERT INTO point_transactions (alliance_id, student_id, amount, category, reason) VALUES (?, ?, 0, 'heroic_entry', ?)`,
        [student.alliance_id, student_id, `Selected avatar: The ${baseAvatar.charAt(0).toUpperCase() + baseAvatar.slice(1)} — awarded ${drachma} Drachma`]);
    }
    
    saveDatabase();
    console.log(`⚔️ Student ${student_id} selected avatar '${avatar}', awarded ${drachma} Drachma, entered Heroic Age`);
    
    res.json({
      success: true,
      avatar,
      drachma,
      message: `You are now The ${avatar.charAt(0).toUpperCase() + avatar.slice(1)}! ${drachma} Drachma awarded.`
    });
  } catch (err) {
    console.error('Select avatar error:', err);
    res.status(500).json({ error: 'Failed to select avatar' });
  }
});

// --- Teacher: Reset student avatar (for absences/errors) ---
app.post('/api/teacher/reset-avatar', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher' && req.user.role !== 'teacher') return res.status(403).json({ error: 'Not authorized' });
    const { student_id } = req.body;
    if (!student_id) return res.status(400).json({ error: 'Missing student_id' });
    
    run('UPDATE students SET selected_avatar = NULL, drachma = 0, avatar_selected_at = NULL, current_age = ? WHERE student_id = ?',
      ['Classical', student_id]);
    
    saveDatabase();
    console.log(`🔄 Teacher reset avatar for student ${student_id}`);
    res.json({ success: true, message: 'Avatar reset. Student returned to Classical Age.' });
  } catch (err) {
    console.error('Reset avatar error:', err);
    res.status(500).json({ error: 'Failed to reset avatar' });
  }
});

// --- Teacher: Heroic Age Overview ---

// ── DIAGNOSTIC: heroic-overview data audit ───────────────────────────────────
// Temporary endpoint — compare what's in voyage_log_completions vs students table
// Remove after root cause is confirmed

// ── ONE-TIME DATA REPAIR: fix voyage_log_completions name/period mismatches ──
// Remove this endpoint after confirming repairs are applied.
app.post('/api/teacher/repair-voyage-names', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });

    const repairs = [];

    // 1. King T (3rd) → Tucker (matches students.name in 3rd period)
    const kingT = query("SELECT completion_id, student_name, class_period FROM voyage_log_completions WHERE student_name = 'King T' AND class_period = '3rd'");
    if (kingT.length > 0) {
      run("UPDATE voyage_log_completions SET student_name = 'Tucker' WHERE student_name = 'King T' AND class_period = '3rd'");
      repairs.push({ fixed: 'King T → Tucker (3rd)' });
    } else {
      repairs.push({ skipped: 'King T not found in 3rd — already fixed or never existed' });
    }

    // 2. Penelope Williams (3rd) → class_period = 4th (she submitted under wrong period)
    const penelope = query("SELECT completion_id, student_name, class_period FROM voyage_log_completions WHERE student_name = 'Penelope Williams' AND class_period = '3rd'");
    if (penelope.length > 0) {
      run("UPDATE voyage_log_completions SET class_period = '4th' WHERE student_name = 'Penelope Williams' AND class_period = '3rd'");
      repairs.push({ fixed: 'Penelope Williams period: 3rd → 4th' });
    } else {
      repairs.push({ skipped: 'Penelope Williams/3rd not found — already fixed or never existed' });
    }

    // 3. GREg (Period 1) → class_period = Test
    const greg = query("SELECT completion_id, student_name, class_period FROM voyage_log_completions WHERE student_name = 'GREg' AND class_period = 'Period 1'");
    if (greg.length > 0) {
      run("UPDATE voyage_log_completions SET class_period = 'Test' WHERE student_name = 'GREg' AND class_period = 'Period 1'");
      repairs.push({ fixed: 'GREg period: Period 1 → Test' });
    } else {
      repairs.push({ skipped: 'GREg/Period 1 not found — already fixed or never existed' });
    }

    // 4. Mark Stubbe (3rd) → student_name = m@rk (matches students.name in 3rd period)
    const markStudbe = query("SELECT completion_id FROM voyage_log_completions WHERE student_name = 'Mark Stubbe' AND class_period = '3rd'");
    if (markStudbe.length > 0) {
      run("UPDATE voyage_log_completions SET student_name = 'm@rk' WHERE student_name = 'Mark Stubbe' AND class_period = '3rd'");
      repairs.push({ fixed: 'Mark Stubbe → m@rk (3rd)' });
    } else {
      repairs.push({ skipped: 'Mark Stubbe/3rd not found — already fixed or never existed' });
    }

    saveDatabase();
    res.json({ success: true, repairs });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/teacher/heroic-overview-debug', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
    const { period } = req.query;
    if (!period) return res.status(400).json({ error: 'period required' });

    const students = query(
      'SELECT student_id, name, class_period FROM students WHERE class_period = ? AND (is_ghost = 0 OR is_ghost IS NULL) ORDER BY name',
      [period]
    );

    // All four log completions for this period
    let voyageRows = [], herculesRows = [], theseusRows = [], perseusRows = [];
    try { voyageRows   = query('SELECT student_name, class_period, rank_tier FROM voyage_log_completions   WHERE class_period = ?', [period]); } catch(e) {}
    try { herculesRows = query('SELECT student_name, rank_tier, total_score FROM hercules_log_completions WHERE class_period = ?', [period]); } catch(e) {}
    try { theseusRows  = query('SELECT student_name, rank_tier, total_score FROM theseus_log_completions  WHERE class_period = ?', [period]); } catch(e) {}
    try { perseusRows  = query('SELECT student_name, rank_tier, total_score FROM perseus_log_completions  WHERE class_period = ?', [period]); } catch(e) {}

    // Same 3-strategy match used by heroic-overview
    const nameWords = (str) => new Set(str.toLowerCase().replace(/@/g, 'a').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 1));
    const sharesWord = (a, b) => { const aw = nameWords(a), bw = nameWords(b); for (const w of aw) { if (bw.has(w)) return true; } return false; };
    const findMatch = (rows, name) => {
      const nl = name.toLowerCase().trim();
      return rows.find(r => r.student_name === name) ||
             rows.find(r => typeof r.student_name === 'string' && r.student_name.toLowerCase().trim() === nl) ||
             rows.find(r => typeof r.student_name === 'string' && sharesWord(r.student_name, name)) ||
             null;
    };

    const audit = students.map(s => {
      const vm = findMatch(voyageRows,   s.name);
      const hm = findMatch(herculesRows, s.name);
      const tm = findMatch(theseusRows,  s.name);
      const pm = findMatch(perseusRows,  s.name);
      return {
        student:          s.name,
        jason:   vm ? { complete: true,  rank: vm.rank_tier, stored_as: vm.student_name } : { complete: false },
        hercules:hm ? { complete: true,  rank: hm.rank_tier, stored_as: hm.student_name } : { complete: false },
        theseus: tm ? { complete: true,  rank: tm.rank_tier, stored_as: tm.student_name } : { complete: false },
        perseus: pm ? { complete: true,  rank: pm.rank_tier, stored_as: pm.student_name } : { complete: false },
      };
    });

    // Also show any voyage rows that didn't match any student (orphaned)
    const orphanedVoyage = voyageRows.filter(v =>
      !students.find(s => findMatch([v], s.name))
    );

    res.json({ period, audit, orphaned_voyage_rows: orphanedVoyage });
  } catch(err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

app.get('/api/teacher/heroic-overview', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher' && req.user.role !== 'teacher') return res.status(403).json({ error: 'Not authorized' });
    const { period } = req.query;
    if (!period) return res.status(400).json({ error: 'period required' });

    // Defensive column check — selected_avatar may not exist in older DB
    let hasSelectedAvatar = false;
    try {
      const cols = query('PRAGMA table_info(students)').map(c => c.name);
      hasSelectedAvatar = cols.includes('selected_avatar');
    } catch(e) {}

    const avatarSelect = hasSelectedAvatar ? ', s.selected_avatar' : '';

    // Students in period
    const students = query(`
      SELECT s.student_id, s.name, s.class_period ${avatarSelect},
             a.alliance_name, a.current_age
      FROM students s
      LEFT JOIN alliances a ON s.alliance_id = a.alliance_id
      WHERE s.class_period = ? AND (s.is_ghost = 0 OR s.is_ghost IS NULL)
      ORDER BY s.name ASC
    `, [period]);

    if (!students || students.length === 0) return res.json({ students: [] });

    const studentIds = students.map(s => s.student_id);
    const placeholders = studentIds.map(() => '?').join(',');

    // Grade records for Lore/Craft/Honor
    let records = [];
    try {
      records = query(`
        SELECT gr.student_id, gr.points_earned, ar.assignment_type, ar.section
        FROM grade_records gr
        JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
        WHERE gr.student_id IN (${placeholders}) AND gr.points_earned > 0
      `, studentIds);
    } catch(e) { console.error('heroic-overview grade query failed:', e.message); }

    // Battle wins for Cunning
    let battleRows = [];
    try {
      battleRows = query(`
        SELECT student_id, wins FROM arena_battle_stats
        WHERE student_id IN (${placeholders})
      `, studentIds);
    } catch(e) { console.error('heroic-overview battle query failed:', e.message); }
    const battleByStudent = {};
    battleRows.forEach(b => { battleByStudent[b.student_id] = b.wins || 0; });

    // Voyage log completions — multi-strategy name matching to handle free-text era name mismatches
    // Strategy 1: exact match. Strategy 2: case-insensitive trim. Strategy 3: first-word match within period.
    let voyageRows = [];
    try {
      voyageRows = query('SELECT student_name, rank_tier, total_score FROM voyage_log_completions WHERE class_period = ?', [period]);
    } catch(e) { console.error('heroic-overview voyage query failed:', e.message); }

    // Build lookup: student_id -> voyage row, using best available match


    // Hercules, Theseus, Perseus completions — JOIN on normalized name to avoid case/spacing mismatches
    // Hercules/Theseus/Perseus completions for this period — matched via findInRows() in result map
    let herculesRows = [], theseusRows = [], perseusRows = [];
    try { herculesRows = query('SELECT student_name, rank_tier, total_score FROM hercules_log_completions WHERE class_period = ?', [period]); } catch(e) { console.error('heroic-overview hercules query failed:', e.message); }
    try { theseusRows  = query('SELECT student_name, rank_tier, total_score FROM theseus_log_completions  WHERE class_period = ?', [period]); } catch(e) { console.error('heroic-overview theseus query failed:', e.message); }
    try { perseusRows  = query('SELECT student_name, rank_tier, total_score FROM perseus_log_completions  WHERE class_period = ?', [period]); } catch(e) { console.error('heroic-overview perseus query failed:', e.message); }

    // All-four-logs data — direct query (all columns are confirmed schema columns)
    // Falls back to PRAGMA-safe column detection only if the direct query throws
    let logRows = [];
    try {
      logRows = query(
        `SELECT s.student_id,
                s.voyage_log_completed,   s.voyage_rank_tier,
                s.hercules_log_completed, s.hercules_rank_tier,
                s.theseus_log_completed,  s.theseus_rank_tier,
                s.perseus_log_completed,  s.perseus_rank_tier
         FROM students s WHERE s.student_id IN (${placeholders})`,
        studentIds
      );
    } catch(e) {
      console.error('heroic-overview log query failed, retrying defensively:', e.message);
      try {
        const allCols = query('PRAGMA table_info(students)').map(c => c.name);
        const safe = (col) => allCols.includes(col) ? 's.' + col : '0 as ' + col;
        logRows = query(
          `SELECT s.student_id,
                  ${safe('voyage_log_completed')},   ${safe('voyage_rank_tier')},
                  ${safe('hercules_log_completed')}, ${safe('hercules_rank_tier')},
                  ${safe('theseus_log_completed')},  ${safe('theseus_rank_tier')},
                  ${safe('perseus_log_completed')},  ${safe('perseus_rank_tier')}
           FROM students s WHERE s.student_id IN (${placeholders})`,
          studentIds
        );
      } catch(e2) { console.error('heroic-overview log fallback also failed:', e2.message); }
    }
    const logByStudent = {};
    logRows.forEach(r => { logByStudent[r.student_id] = r; });

    // Aggregate stats
    const statsByStudent = {};
    studentIds.forEach(id => { statsByStudent[id] = { lore: 0, craft: 0, honor: 0 }; });
    records.forEach(r => {
      const s = statsByStudent[r.student_id];
      if (!s) return;
      const t = r.assignment_type;
      const sec = r.section || '';
      if (sec !== 'classical' && sec !== 'classical_creative' && sec !== 'bonus') return;
      if (t === 'quiz')                                                   s.lore  += r.points_earned;
      else if (t === 'mural' || t === 'word_cloud' || t === 'creative')  s.craft += r.points_earned;
      else if (t === 'comp_conn')                                         s.honor += r.points_earned;
    });

    const result = students.map(s => {
      const stats = statsByStudent[s.student_id] || { lore: 0, craft: 0, honor: 0 };
      const cunning = (battleByStudent[s.student_id] || 0) * 3;
      // Multi-strategy name match: exact → case-insensitive → shared-word within period
      // Shared-word: any meaningful word (>1 char) in completion name matches any word in student name
      const nameWords = (str) => new Set(str.toLowerCase().replace(/@/g, 'a').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 1));
      const sharesWord = (rowName, studentName) => {
        const rw = nameWords(rowName), sw = nameWords(studentName);
        for (const w of rw) { if (sw.has(w)) return true; }
        return false;
      };
      const bestMatch = (rows, studentName) => {
        const nl = studentName.toLowerCase().trim();
        return rows.find(r => r.student_name === studentName) ||
               rows.find(r => r.student_name.toLowerCase().trim() === nl) ||
               rows.find(r => sharesWord(r.student_name, studentName)) ||
               null;
      };
      const voyage = bestMatch(voyageRows, s.name);
      const h = stats.honor;
      let heraLabel, heraLevel;
      if      (h >= 45) { heraLabel = 'Favored';     heraLevel = 5; }
      else if (h >= 30) { heraLabel = 'Appeased';    heraLevel = 4; }
      else if (h >= 20) { heraLabel = 'Indifferent'; heraLevel = 3; }
      else if (h >= 10) { heraLabel = 'Suspicious';  heraLevel = 2; }
      else              { heraLabel = 'Wrathful';     heraLevel = 1; }
      return {
        student_id:      s.student_id,
        name:            s.name,
        alliance_name:   s.alliance_name || '—',
        current_age:     s.current_age   || 'Archaic',
        selected_avatar: hasSelectedAvatar ? (s.selected_avatar || null) : null,
        lore:   stats.lore,
        craft:  stats.craft,
        cunning,
        honor:  stats.honor,
        hera_label: heraLabel,
        hera_level: heraLevel,
        voyage_complete: voyage !== null,
        voyage_rank:     voyage ? (voyage.rank_tier || null) : null,
        voyage_score:    voyage ? (voyage.total_score || null) : null,
        logs: (() => {
          // Use each hero's _log_completions table as the authoritative source.
          // The students column bridge is non-fatal and may miss students with name mismatches.
          // Re-use bestMatch (defined above in this scope) for all four logs
          const herc = bestMatch(herculesRows, s.name);
          const thes = bestMatch(theseusRows,  s.name);
          const pers = bestMatch(perseusRows,   s.name);
          return {
            jason:    { complete: voyage !== null, rank_tier: voyage ? (voyage.rank_tier || null) : null, score: voyage ? (voyage.total_score || 0) : null },
            hercules: { complete: herc !== null,   rank_tier: herc   ? (herc.rank_tier   || null) : null, score: herc   ? (herc.total_score   || 0) : null },
            theseus:  { complete: thes !== null,   rank_tier: thes   ? (thes.rank_tier   || null) : null, score: thes   ? (thes.total_score   || 0) : null },
            perseus:  { complete: pers !== null,   rank_tier: pers   ? (pers.rank_tier   || null) : null, score: pers   ? (pers.total_score   || 0) : null }
          };
        })()
      };
    });

    res.json({ students: result });
  } catch (err) {
    console.error('Heroic overview error:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to load heroic overview', detail: err.message });
  }
});

// --- Teacher: Force student into Heroic Age (bypasses all requirements — for testing/absences) ---
app.post('/api/teacher/force-heroic', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher' && req.user.role !== 'teacher') return res.status(403).json({ error: 'Not authorized' });
    const { student_id, avatar } = req.body;
    if (!student_id) return res.status(400).json({ error: 'Missing student_id' });
    
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    
    const avatarChoice = avatar && VALID_AVATARS.includes(avatar) ? avatar : 'seeker';
    const drachma = AVATAR_DRACHMA[avatarChoice];
    
    // Update student
    run('UPDATE students SET selected_avatar = ?, drachma = ?, avatar_selected_at = CURRENT_TIMESTAMP, current_age = ? WHERE student_id = ?',
      [avatarChoice, drachma, 'Heroic', student_id]);
    
    // Also advance the alliance to Heroic so hub.html sees it
    if (student.alliance_id) {
      run('UPDATE alliances SET current_age = ? WHERE alliance_id = ? AND current_age = ?', ['Heroic', student.alliance_id, 'Classical']);
    }
    
    saveDatabase();
    console.log(`⚔️ Teacher forced student ${student_id} into Heroic Age as ${avatarChoice} with ${drachma} Drachma`);
    res.json({ success: true, message: `Student forced into Heroic Age as The ${avatarChoice.charAt(0).toUpperCase() + avatarChoice.slice(1)} with ${drachma} Drachma.` });
  } catch (err) {
    console.error('Force heroic error:', err);
    res.status(500).json({ error: 'Failed to force heroic entry' });
  }
});

// --- Teacher: Reset student(s) from Heroic back to Classical (undoes force-heroic) ---
app.post('/api/teacher/reset-heroic', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher' && req.user.role !== 'teacher') return res.status(403).json({ error: 'Not authorized' });
    const { period } = req.body;
    if (!period) return res.status(400).json({ error: 'Period required' });

    // Reset any Heroic students in this period back to Classical
    const heroicStudents = query(
      "SELECT s.student_id, s.name, s.alliance_id FROM students s WHERE s.class_period = ? AND s.current_age = 'Heroic'",
      [period]
    );
    heroicStudents.forEach(s => {
      run("UPDATE students SET current_age = 'Classical' WHERE student_id = ?", [s.student_id]);
      try { run("UPDATE students SET selected_avatar = NULL, drachma = NULL, avatar_selected_at = NULL WHERE student_id = ?", [s.student_id]); } catch(e) {}
    });

    // ALSO reset any Heroic alliances in this period (even if students were already reset)
    const heroicAlliances = query(
      "SELECT alliance_id, alliance_name FROM alliances WHERE class_period = ? AND current_age = 'Heroic'",
      [period]
    );
    heroicAlliances.forEach(a => {
      run("UPDATE alliances SET current_age = 'Classical' WHERE alliance_id = ?", [a.alliance_id]);
    });

    saveDatabase();
    const studentNames = heroicStudents.map(s => s.name).join(', ');
    const allianceNames = heroicAlliances.map(a => a.alliance_name).join(', ');
    console.log(`🔄 Reset in ${period}: ${heroicStudents.length} students, ${heroicAlliances.length} alliances`);
    res.json({ 
      success: true, 
      students_reset: heroicStudents.length,
      alliances_reset: heroicAlliances.length,
      students: studentNames || 'none',
      alliances: allianceNames || 'none'
    });
  } catch (err) {
    console.error('Reset heroic error:', err);
    res.status(500).json({ error: 'Failed to reset: ' + err.message });
  }
});

// --- Teacher: Approve myth portal assignment ---
app.post('/api/teacher/approve-myth-assignment', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher' && req.user.role !== 'teacher') return res.status(403).json({ error: 'Not authorized' });
    const { student_id, portal_id, assignment_path, points } = req.body;
    if (!student_id || !portal_id || !assignment_path) {
      return res.status(400).json({ error: 'Missing student_id, portal_id, or assignment_path' });
    }
    
    // Default to 15 if no score provided (backward compatible)
    const pointsEarned = (points !== undefined && points !== null && points !== '') ? parseInt(points) : 15;
    
    // Upsert the completion record with score
    const existing = query('SELECT * FROM student_myth_completion WHERE student_id = ? AND portal_id = ?', [student_id, portal_id]);
    if (existing.length > 0) {
      run('UPDATE student_myth_completion SET assignment_path = ?, teacher_approved = 1, approved_at = CURRENT_TIMESTAMP, points_earned = ? WHERE student_id = ? AND portal_id = ?',
        [assignment_path, pointsEarned, student_id, portal_id]);
    } else {
      run('INSERT INTO student_myth_completion (student_id, portal_id, assignment_path, teacher_approved, approved_at, points_earned) VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, ?)',
        [student_id, portal_id, assignment_path, pointsEarned]);
    }
    
    // Award points to the alliance
    const student = query('SELECT s.name, s.alliance_id, a.alliance_name FROM students s LEFT JOIN alliances a ON s.alliance_id = a.alliance_id WHERE s.student_id = ?', [student_id])[0];
    const portal = query('SELECT * FROM myth_portals WHERE portal_id = ?', [portal_id])[0];
    
    if (student && student.alliance_id) {
      // Check if this is a re-approval (already had points awarded)
      const previousPoints = (existing.length > 0 && existing[0].teacher_approved === 1) ? (existing[0].points_earned || 15) : 0;
      const pointsDiff = pointsEarned - previousPoints;
      
      if (pointsDiff !== 0) {
        run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', [pointsDiff, student.alliance_id]);
        run('INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) VALUES (?, ?, ?, ?, ?)',
          [student.alliance_id, pointsDiff, 'assignment', `Myth Portal: ${portal ? portal.myth_name : 'myth'} (${assignment_path} path) - ${student.name}${previousPoints > 0 ? ' (rescored)' : ''}`, req.user.id]);
      }
    }
    
    saveDatabase();
    res.json({ 
      success: true, 
      message: `Approved ${student ? student.name : 'student'}'s ${assignment_path} path for ${portal ? portal.myth_name : 'myth'} (${pointsEarned}/15 pts)` 
    });
  } catch (err) {
    console.error('Approve myth assignment error:', err);
    res.status(500).json({ error: 'Failed to approve' });
  }
});

// --- Teacher: Unapprove myth portal assignment ---
app.post('/api/teacher/unapprove-myth-assignment', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher' && req.user.role !== 'teacher') return res.status(403).json({ error: 'Not authorized' });
    const { student_id, portal_id } = req.body;
    if (!student_id || !portal_id) return res.status(400).json({ error: 'Missing student_id or portal_id' });
    
    run('DELETE FROM student_myth_completion WHERE student_id = ? AND portal_id = ?', [student_id, portal_id]);
    res.json({ success: true, message: 'Assignment unapproved' });
  } catch (err) {
    console.error('Unapprove myth assignment error:', err);
    res.status(500).json({ error: 'Failed to unapprove' });
  }
});

// --- Teacher: Get myth completion overview for a period ---
app.get('/api/teacher/myth-completion-overview', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher' && req.user.role !== 'teacher') return res.status(403).json({ error: 'Not authorized' });
    const period = req.query.period;
    if (!period) return res.status(400).json({ error: 'Missing period parameter' });
    
    const students = query('SELECT student_id, name, alliance_id FROM students WHERE class_period = ? ORDER BY name', [period]);
    const portals = query('SELECT portal_id, myth_name, display_name, virtue_english, virtue_emoji FROM myth_portals ORDER BY myth_number');
    
    // Map myth_name to assignments_ref myth_god
    const mythGodMap = {
      'Pandora': 'Pandora', 'Phaethon': 'Phaethon', 'Orpheus & Eurydice': 'Orpheus',
      'Echo & Narcissus': 'Echo and Narcissus', 'Icarus & Daedalus': 'Icarus',
      'Eros & Psyche': 'Eros and Psyche', 'Constellations': 'Constellations'
    };
    
    // Get all quiz passes for this period
    const quizPasses = query(`SELECT mqa.student_id, mqa.portal_id, mqa.score, mqa.total_questions FROM myth_quiz_attempts mqa 
      JOIN students s ON mqa.student_id = s.student_id WHERE s.class_period = ? AND mqa.passed = 1`, [period]);
    
    // Get all myth completions for this period
    const completions = query(`SELECT smc.* FROM student_myth_completion smc 
      JOIN students s ON smc.student_id = s.student_id WHERE s.class_period = ?`, [period]);
    
    // Get all classical assignments and grade records for this period
    const classicalAssignments = query("SELECT * FROM assignments_ref WHERE section IN ('classical', 'classical_creative')");
    const studentIds = students.map(s => s.student_id);
    let allGrades = [];
    if (studentIds.length > 0) {
      const placeholders = studentIds.map(() => '?').join(',');
      const classicalIds = classicalAssignments.map(a => a.assignment_id);
      if (classicalIds.length > 0) {
        const aidPh = classicalIds.map(() => '?').join(',');
        allGrades = query(
          `SELECT gr.*, ar.myth_god, ar.assignment_type, ar.section, ar.max_points AS ref_max_points
           FROM grade_records gr JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
           WHERE gr.student_id IN (${placeholders}) AND gr.assignment_id IN (${aidPh})`,
          [...studentIds, ...classicalIds]
        );
      }
    }
    
    // Virtue claims are in student_myth_completion.virtue_claimed column
    
    const studentData = students.map(s => {
      const studentGrades = allGrades.filter(g => g.student_id === s.student_id);
      
      const mythProgress = portals.map(p => {
        const mythGod = mythGodMap[p.myth_name] || p.myth_name;
        // Aliases for myth_god matching (some use different name forms)
        const aliases = [mythGod];
        if (mythGod === 'Echo and Narcissus') aliases.push('Echo & Narcissus');
        if (mythGod === 'Eros and Psyche') aliases.push('Eros & Psyche');
        if (mythGod === 'Icarus') aliases.push('Icarus & Daedalus');
        if (mythGod === 'Orpheus') aliases.push('Orpheus & Eurydice');
        
        // Reading guide (comp_conn in classical section)
        const guideGrades = studentGrades.filter(g => g.assignment_type === 'comp_conn' && g.section === 'classical' && aliases.some(a => g.myth_god === a));
        const hasGuide = guideGrades.length > 0;
        const guideEarned = guideGrades.reduce((sum, g) => sum + (g.points_earned || 0), 0);
        const guideMax = guideGrades.reduce((sum, g) => sum + (g.ref_max_points || 0), 0) || 12;
        
        // Quiz
        const quizPass = quizPasses.find(qp => qp.student_id === s.student_id && qp.portal_id === p.portal_id);
        const hasQuiz = !!quizPass;
        const quizScore = quizPass ? quizPass.score : 0;
        const quizTotal = quizPass ? quizPass.total_questions : 10;
        
        // Creative work (word_cloud, mural, creative, or cer in classical_creative)
        const creativeGrades = studentGrades.filter(g => 
          (g.assignment_type === 'word_cloud' || g.assignment_type === 'mural' || g.assignment_type === 'creative' || g.assignment_type === 'cer') && 
          g.section === 'classical_creative' && aliases.some(a => g.myth_god === a));
        const hasCreative = creativeGrades.length > 0;
        const creativeDetails = creativeGrades.map(g => ({
          type: g.assignment_type === 'word_cloud' ? 'Word Cloud' : g.assignment_type === 'mural' ? 'Pixton' : g.assignment_type === 'cer' ? 'CER' : 'Creative',
          earned: g.points_earned || 0,
          possible: g.ref_max_points || 20
        }));
        
        // Virtue earned check (from student_myth_completion)
        const completion = completions.find(c => c.student_id === s.student_id && c.portal_id === p.portal_id);
        const virtueEarned = completion ? completion.virtue_claimed === 1 : false;
        const assignmentApproved = completion ? completion.teacher_approved === 1 : false;
        
        return {
          portal_id: p.portal_id,
          myth_name: p.myth_name,
          has_guide: hasGuide,
          guide_earned: guideEarned,
          guide_max: guideMax,
          guide_pct: guideMax > 0 ? Math.round((guideEarned / guideMax) * 100) : 0,
          has_quiz: hasQuiz,
          quiz_passed: hasQuiz,
          quiz_score: quizScore,
          quiz_total: quizTotal,
          quiz_pct: quizTotal > 0 ? Math.round((quizScore / quizTotal) * 100) : 0,
          has_creative: hasCreative || assignmentApproved,
          creative_details: creativeDetails,
          assignment_approved: assignmentApproved,
          assignment_points: completion ? (completion.points_earned || 0) : 0,
          virtue_earned: virtueEarned
        };
      });
      
      const virtueCount = mythProgress.filter(m => m.virtue_earned).length;
      return { ...s, myths: mythProgress, virtue_count: virtueCount };
    });
    
    res.json({ students: studentData, portals });
  } catch (err) {
    console.error('Myth completion overview error:', err);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

// --- Student: Get quiz questions for a myth portal ---
app.get('/api/student/quiz/:portal_id', authenticateToken, (req, res) => {
  try {
    const portalId = parseInt(req.params.portal_id);
    const questions = query('SELECT * FROM myth_quiz_questions WHERE portal_id = ?', [portalId]);
    
    if (questions.length === 0) {
      return res.json({ questions: [], message: 'No quiz questions available for this myth yet. Quiz is submitted via Google Classroom.' });
    }
    
    // Smart shuffle: scramble question order BUT keep comprehension passage groups together
    // 1. Separate questions into passage groups and non-passage questions
    const passageGroups = {};  // passage_group -> [questions]
    const standaloneQuestions = [];
    
    questions.forEach(q => {
      if (q.passage_group) {
        if (!passageGroups[q.passage_group]) passageGroups[q.passage_group] = [];
        passageGroups[q.passage_group].push(q);
      } else {
        standaloneQuestions.push(q);
      }
    });
    
    // 2. Shuffle standalone questions
    for (let i = standaloneQuestions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [standaloneQuestions[i], standaloneQuestions[j]] = [standaloneQuestions[j], standaloneQuestions[i]];
    }
    
    // 3. Build final order: insert each passage group as a block at a random position among standalones
    let finalOrder = [...standaloneQuestions];
    Object.values(passageGroups).forEach(group => {
      // DON'T shuffle question order within a passage group — they stay in authored order
      const insertPos = Math.floor(Math.random() * (finalOrder.length + 1));
      finalOrder.splice(insertPos, 0, ...group);
    });
    
    // 4. Shuffle answer choices for ALL questions, remapping correct_answer
    const safeQuestions = finalOrder.map(q => {
      const optA = q.option_a || q.answer_a;
      const optB = q.option_b || q.answer_b;
      const optC = q.option_c || q.answer_c;
      const optD = q.option_d || q.answer_d;
      const correctKey = q.correct_answer.toLowerCase();
      
      // Map original correct answer to its text
      const originalOptions = { a: optA, b: optB, c: optC, d: optD };
      const correctText = originalOptions[correctKey];
      
      // Create shuffled options array
      const optionsArr = [
        { text: optA }, { text: optB }, { text: optC }, { text: optD }
      ].filter(o => o.text); // filter out nulls
      
      // Fisher-Yates shuffle the options
      for (let i = optionsArr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [optionsArr[i], optionsArr[j]] = [optionsArr[j], optionsArr[i]];
      }
      
      // Assign shuffled options to A/B/C/D and find new correct key
      const keys = ['a', 'b', 'c', 'd'];
      let newCorrect = 'a';
      const shuffled = {};
      optionsArr.forEach((opt, idx) => {
        shuffled[keys[idx]] = opt.text;
        if (opt.text === correctText) newCorrect = keys[idx];
      });
      
      return {
        question_id: q.question_id,
        question_text: q.question_text,
        option_a: shuffled.a || '',
        option_b: shuffled.b || '',
        option_c: shuffled.c || '',
        option_d: shuffled.d || '',
        correct_answer: newCorrect,
        question_type: q.question_type || 'standard',
        passage_text: q.passage_text || null,
        passage_group: q.passage_group || null
      };
    });
    
    res.json({ questions: safeQuestions });
  } catch (err) {
    console.error('Quiz fetch error:', err);
    res.status(500).json({ error: 'Failed to load quiz' });
  }
});

// Helper: shuffle array
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- Student: Submit quiz answers ---
app.post('/api/student/submit-quiz', authenticateToken, (req, res) => {
  try {
    const { portal_id, answers } = req.body;
    if (!portal_id || !answers) return res.status(400).json({ error: 'Missing portal_id or answers' });
    
    const questions = query('SELECT * FROM myth_quiz_questions WHERE portal_id = ?', [portal_id]);
    if (questions.length === 0) return res.status(400).json({ error: 'No questions for this portal' });
    
    // Build answer map from client submission
    // Client sends: {question_id, selected_answer (key), selected_text (answer text), correct_answer (shuffled key)}
    const answerMap = {};
    if (Array.isArray(answers)) {
      answers.forEach(a => { 
        answerMap[a.question_id] = {
          selectedKey: a.selected_answer ? a.selected_answer.toLowerCase() : '',
          selectedText: a.selected_text || '',
          shuffledCorrectKey: a.correct_answer ? a.correct_answer.toLowerCase() : ''
        };
      });
    } else {
      // Legacy format: object keyed by question_id with just the key
      Object.keys(answers).forEach(k => { 
        answerMap[k] = {
          selectedKey: answers[k] ? answers[k].toLowerCase() : '',
          selectedText: '',
          shuffledCorrectKey: ''
        };
      });
    }
    
    // Grade using TEXT comparison to handle shuffled answer positions
    // The quiz GET endpoint shuffles answer options, so the key positions change.
    // We compare the student's selected answer TEXT against the correct answer TEXT from the DB.
    let correct = 0;
    const results = questions.map(q => {
      const submission = answerMap[q.question_id] || { selectedKey: '', selectedText: '', shuffledCorrectKey: '' };
      
      // Get the correct answer TEXT from the original DB question
      const optionMap = {
        a: q.option_a || q.answer_a || '',
        b: q.option_b || q.answer_b || '',
        c: q.option_c || q.answer_c || '',
        d: q.option_d || q.answer_d || ''
      };
      const correctText = optionMap[q.correct_answer.toLowerCase()] || '';
      
      let isCorrect = false;
      
      if (submission.selectedText && correctText) {
        // Primary method: compare answer text (handles shuffled positions)
        isCorrect = submission.selectedText.trim().toLowerCase() === correctText.trim().toLowerCase();
      } else if (submission.shuffledCorrectKey && submission.selectedKey) {
        // Fallback: client sent the shuffled correct key, check if student picked it
        isCorrect = submission.selectedKey === submission.shuffledCorrectKey;
      } else {
        // Legacy fallback: direct key comparison (only works if answers weren't shuffled)
        isCorrect = submission.selectedKey === q.correct_answer.toLowerCase();
      }
      
      if (isCorrect) correct++;
      return { question_id: q.question_id, correct: isCorrect, correct_answer: q.correct_answer };
    });
    
    const score = questions.length > 0 ? Math.round((correct / questions.length) * 100) : 0;
    const passed = score >= 80;
    
    // Record the attempt
    run(`INSERT INTO myth_quiz_attempts (student_id, portal_id, score, total_questions, percentage, passed, attempted_at)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [req.user.id, portal_id, correct, questions.length, score, passed ? 1 : 0]);
    
    // If passed, record grade for the quiz assignment
    if (passed) {
      try {
        const portal = query('SELECT myth_name FROM myth_portals WHERE portal_id = ?', [portal_id])[0];
        if (portal) {
          // Map portal myth_name to assignments_ref myth_god (naming mismatch fix)
          const portalToAssignmentName = {
            'Icarus & Daedalus': 'Icarus',
            'Icarus and Daedalus': 'Icarus',
            'Echo & Narcissus': 'Echo and Narcissus',
            'Orpheus & Eurydice': 'Orpheus',
            'Eros & Psyche': 'Eros and Psyche',
            'Eros and Psyche': 'Eros and Psyche'
          };
          const assignmentMythGod = portalToAssignmentName[portal.myth_name] || portal.myth_name;
          const quizAssignment = query(
            "SELECT assignment_id, max_points FROM assignments_ref WHERE section = 'classical' AND assignment_type = 'quiz' AND myth_god = ?",
            [assignmentMythGod]
          )[0];
          
          if (quizAssignment) {
            const pointsEarned = Math.round((correct / questions.length) * quizAssignment.max_points);
            const existingGrade = query(
              'SELECT record_id, points_earned FROM grade_records WHERE student_id = ? AND assignment_id = ?',
              [req.user.id, quizAssignment.assignment_id]
            )[0];

            if (!existingGrade) {
              run(`INSERT INTO grade_records (student_id, assignment_id, points_earned, points_possible)
                   VALUES (?, ?, ?, ?)`,
                [req.user.id, quizAssignment.assignment_id, pointsEarned, quizAssignment.max_points]);
              console.log(`✅ Quiz grade recorded: ${portal.myth_name} - ${pointsEarned}/${quizAssignment.max_points}`);
            } else if (pointsEarned > existingGrade.points_earned) {
              // Retake with better score — update to best
              run('UPDATE grade_records SET points_earned = ? WHERE record_id = ?',
                [pointsEarned, existingGrade.record_id]);
              console.log(`✅ Quiz grade IMPROVED: ${portal.myth_name} - prev:${existingGrade.points_earned} new:${pointsEarned}/${quizAssignment.max_points}`);
            } else {
              console.log(`✅ Quiz grade KEPT: ${portal.myth_name} - prev:${existingGrade.points_earned} new:${pointsEarned}, keeping best`);
            }
          }
        }
      } catch (gradeErr) {
        console.error('Quiz grade recording error:', gradeErr.message);
      }
    }
    
    // Auto-unlock game-type side quest if this portal has one and student passed at 80%+
    if (passed && [3, 4, 6].includes(parseInt(portal_id))) {
      try {
        const portalForUnlock = query('SELECT myth_name FROM myth_portals WHERE portal_id = ?', [portal_id])[0];
        if (portalForUnlock) {
          // Map portal myth_name to assignments_ref myth_god naming used in unlock_trigger_ref
          const triggerNameMap = {
            'Orpheus':              'Orpheus Quiz',
            'Orpheus & Eurydice':   'Orpheus Quiz',
            'Echo and Narcissus':   'Echo and Narcissus Quiz',
            'Echo & Narcissus':     'Echo and Narcissus Quiz',
            'Eros and Psyche':      'Eros and Psyche Quiz',
            'Eros & Psyche':        'Eros and Psyche Quiz'
          };
          const triggerName = triggerNameMap[portalForUnlock.myth_name];
          if (triggerName) {
            const quest = query(
              "SELECT quest_id FROM side_quests_ref WHERE quest_type = 'game_link' AND unlock_trigger_ref = ?",
              [triggerName]
            )[0];
            if (quest) {
              // INSERT OR IGNORE — safe on retakes, won't overwrite if already unlocked/completed
              db.run(
                `INSERT OR IGNORE INTO side_quest_availability (student_id, quest_id, status, unlocked_at)
                 VALUES (?, ?, 'available', ?)`,
                [req.user.id, quest.quest_id, Math.floor(Date.now() / 1000)]
              );
              console.log(`🔓 Game quest unlocked: student ${req.user.id} → quest ${quest.quest_id} (${triggerName})`);
            }
          }
        }
      } catch (unlockErr) {
        // Non-fatal — quiz grade was already recorded successfully
        console.error('Game quest unlock error:', unlockErr.message);
      }
    }

    saveDatabase();
    
    res.json({ score, correct, total: questions.length, passed, results });
  } catch (err) {
    console.error('Submit quiz error:', err);
    res.status(500).json({ error: 'Failed to submit quiz' });
  }
});

// --- Student: Complete Wings of Daedalus escape game (replaces quiz for portal 5) ---
app.post('/api/student/daedalus-complete', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { questions, totalTime, flightAttempts, completed } = req.body;

    if (!questions || !Array.isArray(questions)) {
      return res.status(400).json({ error: 'Missing or invalid questions data' });
    }

    const student = query('SELECT student_id, name, alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    if (!student.alliance_id) return res.status(400).json({ error: 'Student has no alliance' });

    // Track attempt count for logging (no hard cap — best score always wins)
    const attemptCount = query(
      'SELECT COUNT(*) as cnt FROM daedalus_game_results WHERE student_id = ?',
      [student_id]
    )[0]?.cnt || 0;

    const totalQuestions = questions.length;
    const firstAttemptCorrect = questions.filter(q => q.isCorrect && q.firstAttempt).length;
    const totalCorrect = questions.filter(q => q.isCorrect).length;
    const percentage = totalQuestions > 0 ? Math.round((firstAttemptCorrect / totalQuestions) * 100) : 0;
    const passed = percentage >= 80;

    // Insert game result
    run(
      `INSERT INTO daedalus_game_results 
       (student_id, total_questions, first_attempt_correct, total_correct, total_time_seconds, flight_attempts, completed, alliance_points_awarded)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [student_id, totalQuestions, firstAttemptCorrect, totalCorrect, totalTime || 0, flightAttempts || 0, completed ? 1 : 0, 0]
    );

    const resultRow = query('SELECT last_insert_rowid() as id')[0];
    const result_id = resultRow ? resultRow.id : null;

    // Insert per-question answers
    if (result_id) {
      questions.forEach(q => {
        run(
          `INSERT INTO daedalus_question_answers 
           (result_id, student_id, stage_number, question_index, question_text, selected_answer, correct_answer, is_correct, is_first_attempt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [result_id, student_id, q.stage || 0, q.index || 0, q.text || '', q.selected || '', q.correct || '', q.isCorrect ? 1 : 0, q.firstAttempt ? 1 : 0]
        );
      });
    }

    // Record in myth_quiz_attempts for portal compatibility
    run(
      `INSERT INTO myth_quiz_attempts (student_id, portal_id, score, total_questions, percentage, passed, attempted_at)
       VALUES (?, 5, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [student_id, firstAttemptCorrect, totalQuestions, percentage, passed ? 1 : 0]
    );

    let alliancePointsAwarded = 0;
    let gradePointsEarned = 0;

    if (completed) {
      // Record grade — always, regardless of pass/fail
      try {
        const quizAssignment = query(
          "SELECT assignment_id, max_points FROM assignments_ref WHERE section = 'classical' AND assignment_type = 'quiz' AND myth_god = 'Icarus'",
          []
        )[0];

        if (quizAssignment) {
          const thisAttemptScore = Math.round((firstAttemptCorrect / totalQuestions) * quizAssignment.max_points);
          
          const existingGrade = query(
            'SELECT record_id, points_earned FROM grade_records WHERE student_id = ? AND assignment_id = ?',
            [student_id, quizAssignment.assignment_id]
          )[0];

          if (existingGrade) {
            // Subsequent attempt: keep best score (mastery = credit)
            if (thisAttemptScore > existingGrade.points_earned) {
              gradePointsEarned = thisAttemptScore;
              run('UPDATE grade_records SET points_earned = ? WHERE record_id = ?',
                [gradePointsEarned, existingGrade.record_id]);
              console.log(`✅ Daedalus grade IMPROVED: ${student.name} - prev:${existingGrade.points_earned} new:${thisAttemptScore}/${quizAssignment.max_points}`);
            } else {
              gradePointsEarned = existingGrade.points_earned;
              console.log(`✅ Daedalus grade KEPT: ${student.name} - prev:${existingGrade.points_earned} new:${thisAttemptScore}, keeping best`);
            }
          } else {
            gradePointsEarned = thisAttemptScore;
            run(
              `INSERT INTO grade_records (student_id, assignment_id, points_earned, points_possible)
               VALUES (?, ?, ?, ?)`,
              [student_id, quizAssignment.assignment_id, gradePointsEarned, quizAssignment.max_points]
            );
            console.log(`✅ Daedalus grade recorded: ${student.name} - ${gradePointsEarned}/${quizAssignment.max_points} (attempt 1)`);
          }
        }
      } catch (gradeErr) {
        console.error('Daedalus grade recording error:', gradeErr.message);
      }

      // Award alliance points if passed
      if (passed) {
        alliancePointsAwarded = firstAttemptCorrect;
        if (alliancePointsAwarded > 0) {
          run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?',
            [alliancePointsAwarded, student.alliance_id]);
          run(
            `INSERT INTO point_transactions (alliance_id, student_id, amount, category, reason)
             VALUES (?, ?, ?, 'quiz', ?)`,
            [student.alliance_id, student_id, alliancePointsAwarded, `Wings of Daedalus — ${firstAttemptCorrect}/${totalQuestions} first-attempt correct`]
          );
        }
        if (result_id) {
          run('UPDATE daedalus_game_results SET alliance_points_awarded = ? WHERE result_id = ?',
            [alliancePointsAwarded, result_id]);
        }
      }
    }

    saveDatabase();
    console.log(`🎮 Daedalus: ${student.name} — ${firstAttemptCorrect}/${totalQuestions} (${percentage}%), ${passed ? 'PASSED' : 'NOT PASSED'}, ${alliancePointsAwarded} AP`);

    res.json({
      success: true,
      alreadyCompleted: false,
      passed,
      percentage,
      firstAttemptCorrect,
      totalCorrect,
      totalQuestions,
      gradePointsEarned,
      alliancePointsAwarded,
      flightAttempts: flightAttempts || 0
    });
  } catch (err) {
    console.error('Daedalus complete error:', err);
    res.status(500).json({ error: 'Failed to record game completion' });
  }
});

// ================================================================
// PSYCHE TRIALS (Portal 6: Eros & Psyche) — Game Completion
// ================================================================
app.post('/api/student/psyche-complete', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { completed, heartsRemaining, virtues, starRating, boxChoice } = req.body;

    if (!completed || !virtues) {
      return res.status(400).json({ error: 'Missing completion data' });
    }

    const student = query('SELECT student_id, name, alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    if (!student.alliance_id) return res.status(400).json({ error: 'Student has no alliance' });

    // Track attempt count for logging (no hard cap — best score always wins)
    const attemptCount = query(
      'SELECT COUNT(*) as cnt FROM psyche_game_results WHERE student_id = ?',
      [student_id]
    )[0]?.cnt || 0;

    // Calculate score from virtue ratings
    const ratingScores = { 'Excellent': 100, 'Good': 75, 'Fair': 50, 'Needs Work': 25 };
    const virtueKeys = ['precision', 'patience', 'trust', 'resolve'];
    let totalVirtueScore = 0;
    virtueKeys.forEach(k => {
      if (virtues[k] && virtues[k].rating) {
        totalVirtueScore += (ratingScores[virtues[k].rating] || 25);
      }
    });
    const percentage = Math.round(totalVirtueScore / 4);
    const passed = percentage >= 60;

    // Insert game result
    run(
      `INSERT INTO psyche_game_results 
       (student_id, hearts_remaining, star_rating, box_choice,
        precision_rating, patience_rating, trust_rating, resolve_rating,
        percentage, passed, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [student_id, heartsRemaining || 0, starRating || 1,
       boxChoice ? 'opened' : 'sealed',
       virtues.precision?.rating || '', virtues.patience?.rating || '',
       virtues.trust?.rating || '', virtues.resolve?.rating || '',
       percentage, passed ? 1 : 0]
    );

    // Record in myth_quiz_attempts for portal compatibility
    const totalQuestions = 4;
    const correctCount = virtueKeys.filter(k => 
      virtues[k]?.rating === 'Excellent' || virtues[k]?.rating === 'Good'
    ).length;

    run(
      `INSERT INTO myth_quiz_attempts (student_id, portal_id, score, total_questions, percentage, passed, attempted_at)
       VALUES (?, 6, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [student_id, correctCount, totalQuestions, percentage, passed ? 1 : 0]
    );

    let alliancePointsAwarded = 0;
    let gradePointsEarned = 0;

    if (completed) {
      // Record grade
      try {
        const quizAssignment = query(
          "SELECT assignment_id, max_points FROM assignments_ref WHERE section = 'classical' AND assignment_type = 'quiz' AND myth_god = 'Eros and Psyche'",
          []
        )[0];

        if (quizAssignment) {
          const thisAttemptScore = Math.round((percentage / 100) * quizAssignment.max_points);

          const existingGrade = query(
            'SELECT record_id, points_earned FROM grade_records WHERE student_id = ? AND assignment_id = ?',
            [student_id, quizAssignment.assignment_id]
          )[0];

          if (existingGrade) {
            // Subsequent attempt: keep best score (mastery = credit)
            if (thisAttemptScore > existingGrade.points_earned) {
              gradePointsEarned = thisAttemptScore;
              run('UPDATE grade_records SET points_earned = ? WHERE record_id = ?',
                [gradePointsEarned, existingGrade.record_id]);
              console.log(`✅ Psyche grade IMPROVED: ${student.name} - prev:${existingGrade.points_earned} new:${thisAttemptScore}/${quizAssignment.max_points}`);
            } else {
              gradePointsEarned = existingGrade.points_earned;
              console.log(`✅ Psyche grade KEPT: ${student.name} - prev:${existingGrade.points_earned} new:${thisAttemptScore}, keeping best`);
            }
          } else {
            gradePointsEarned = thisAttemptScore;
            run(
              `INSERT INTO grade_records (student_id, assignment_id, points_earned, points_possible)
               VALUES (?, ?, ?, ?)`,
              [student_id, quizAssignment.assignment_id, gradePointsEarned, quizAssignment.max_points]
            );
            console.log(`✅ Psyche grade recorded: ${student.name} - ${gradePointsEarned}/${quizAssignment.max_points} (attempt 1)`);
          }
        }
      } catch (gradeErr) {
        console.error('Psyche grade recording error:', gradeErr.message);
      }

    }

    saveDatabase();
    console.log(`💘 Psyche: ${student.name} — ${percentage}%, ${starRating} stars, ${passed ? 'PASSED' : 'NOT PASSED'}, box:${boxChoice ? 'opened' : 'sealed'}`);

    res.json({
      success: true,
      alreadyCompleted: false,
      passed,
      percentage,
      starRating,
      gradePointsEarned
    });
  } catch (err) {
    console.error('Psyche complete error:', err);
    res.status(500).json({ error: 'Failed to record game completion' });
  }
});

// --- Student: Orpheus game completion (legacy endpoint — kept for game file compatibility) ---
// Points are no longer awarded here. Scroll tracking is via /api/side-quest/game-complete.
app.post('/api/student/orpheus-complete', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const student = query('SELECT student_id, name, alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    if (!student.alliance_id) return res.status(400).json({ error: 'Student has no alliance' });

    // Verify quiz was passed for portal 3 (Orpheus)
    const quizPassed = query(
      'SELECT 1 FROM myth_quiz_attempts WHERE student_id = ? AND portal_id = 3 AND passed = 1 LIMIT 1',
      [student_id]
    )[0];
    if (!quizPassed) {
      return res.status(400).json({ error: 'Orpheus quiz not yet passed' });
    }

    console.log(`🎵 Orpheus Game: ${student.name} completed (legacy endpoint — scroll tracked via side-quest/game-complete)`);
    res.json({ success: true, alreadyAwarded: false, pointsAwarded: 0 });
  } catch (err) {
    console.error('Orpheus complete error:', err);
    res.status(500).json({ error: 'Failed to record Orpheus game completion' });
  }
});

// ================================================================
// SIDE QUEST GAME COMPLETION — Scroll issuance + alliance tracking
// ================================================================

// POST /api/side-quest/game-complete
// Called by game files on completion. Tracks per-student completion,
// and issues a scroll to the alliance when all members have finished.
app.post('/api/side-quest/game-complete', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { quest_id, game_url } = req.body;
    if (!quest_id && !game_url) return res.status(400).json({ error: 'Missing quest_id or game_url' });

    const student = query(
      'SELECT student_id, name, alliance_id FROM students WHERE student_id = ?',
      [student_id]
    )[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    if (!student.alliance_id) return res.status(400).json({ error: 'Student has no alliance' });

    // Resolve quest by quest_id or game_url
    const quest = quest_id
      ? query(
          "SELECT quest_id, quest_name, quest_type, reward_name FROM side_quests_ref WHERE quest_id = ? AND quest_type = 'game_link'",
          [quest_id]
        )[0]
      : query(
          "SELECT quest_id, quest_name, quest_type, reward_name FROM side_quests_ref WHERE game_url = ? AND quest_type = 'game_link'",
          [game_url]
        )[0];
    if (!quest) return res.status(404).json({ error: 'Game quest not found' });

    // Confirm this student has the quest unlocked
    const availability = query(
      "SELECT id, status FROM side_quest_availability WHERE student_id = ? AND quest_id = ?",
      [student_id, quest.quest_id]
    )[0];
    if (!availability) return res.status(403).json({ error: 'Quest not unlocked for this student' });
    if (availability.status === 'completed') {
      return res.json({ success: true, alreadyCompleted: true, scrollIssued: false });
    }

    const now = Math.floor(Date.now() / 1000);

    // Mark this student as completed
    run(
      `UPDATE side_quest_availability SET status = 'completed', completed_at = ? WHERE student_id = ? AND quest_id = ?`,
      [now, student_id, quest.quest_id]
    );

    // Record in side_quest_completions for teacher visibility
    run(
      `INSERT OR IGNORE INTO side_quest_completions
         (student_id, quest_id, alliance_id, status, completion_source, completed_at_timestamp, submitted_at)
       VALUES (?, ?, ?, 'approved', 'game_self_report', ?, CURRENT_TIMESTAMP)`,
      [student_id, quest.quest_id, student.alliance_id, now]
    );

    console.log(`🎮 Game complete: ${student.name} — quest ${quest.quest_name}`);

    // Check if all active alliance members have now completed this quest
    const allianceMembers = query(
      'SELECT student_id FROM students WHERE alliance_id = ?',
      [student.alliance_id]
    );

    // Count how many members have completed (status = 'completed')
    const completedRows = query(
      "SELECT COUNT(*) as cnt FROM side_quest_availability WHERE quest_id = ? AND status = 'completed' AND student_id IN (SELECT student_id FROM students WHERE alliance_id = ?)",
      [quest.quest_id, student.alliance_id]
    )[0];
    const completedCount = completedRows ? completedRows.cnt : 0;
    const totalMembers = allianceMembers.length;
    const allDone = totalMembers > 0 && completedCount >= totalMembers;

    let scrollIssued = false;

    if (allDone) {
      // Check if scroll already issued to this alliance for this quest
      const scrollTypeMap = {
        'Orpheus in the Underworld': 'orpheus_bargain',
        "Echo's Lament":             'echo_reflection',
        'The Trials of Psyche':      'psyche_lantern'
      };
      const scrollType = scrollTypeMap[quest.quest_name];

      if (scrollType) {
        const existingScroll = query(
          'SELECT id FROM alliance_scrolls WHERE alliance_id = ? AND scroll_type = ? AND played_at IS NULL',
          [student.alliance_id, scrollType]
        )[0];

        if (!existingScroll) {
          run(
            `INSERT INTO alliance_scrolls (alliance_id, scroll_type, earned_at)
             VALUES (?, ?, ?)`,
            [student.alliance_id, scrollType, now]
          );
          scrollIssued = true;
          console.log(`📜 Scroll issued: ${scrollType} → alliance ${student.alliance_id} (${quest.quest_name})`);
        }
      }
    }

    saveDatabase();

    res.json({
      success: true,
      alreadyCompleted: false,
      scrollIssued,
      allianceProgress: { completed: completedCount, total: totalMembers }
    });
  } catch (err) {
    console.error('Game complete error:', err);
    res.status(500).json({ error: 'Failed to record game completion' });
  }
});

// GET /api/side-quest/availability/:studentId
// Returns game-quest unlock/completion status for a student.
// Returns ALL game-link quests — even ones with no availability row yet.
// A quest only shows as 'available' when ALL alliance members have passed
// the required quiz at 80%+. Uses portal_id_ref from side_quests_ref directly.
app.get('/api/side-quest/availability/:studentId', authenticateToken, (req, res) => {
  try {
    const student_id = parseInt(req.params.studentId);
    if (req.user.id !== student_id && req.user.type !== 'teacher') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Get student's alliance
    const student = query(
      'SELECT alliance_id FROM students WHERE student_id = ?',
      [student_id]
    )[0];
    const alliance_id = student ? student.alliance_id : null;

    // Get ALL game-link quests from ref table
    const allGameQuests = query(
      `SELECT quest_id, quest_name, reward_name, game_url, icon,
              description, unlock_trigger_ref, portal_id_ref
       FROM side_quests_ref
       WHERE quest_type = 'game_link'
       ORDER BY quest_id`
    );

    // Get this student's availability rows (may be empty)
    const myAvailRows = query(
      `SELECT quest_id, status, unlocked_at, completed_at
       FROM side_quest_availability
       WHERE student_id = ?`,
      [student_id]
    );
    const availMap = {};
    myAvailRows.forEach(r => { availMap[r.quest_id] = r; });

    // Get all non-ghost alliance members
    const members = alliance_id ? query(
      'SELECT student_id, name FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)',
      [alliance_id]
    ) : [];

    const enriched = allGameQuests.map(quest => {
      const avail = availMap[quest.quest_id] || null;
      const currentStatus = avail ? avail.status : null;

      // Already completed — always show as completed
      if (currentStatus === 'completed') {
        return {
          ...quest,
          status: 'completed',
          unlocked_at: avail.unlocked_at,
          completed_at: avail.completed_at,
          quiz_passed_count: members.length,
          quiz_member_count: members.length,
          quiz_passed_names: members.map(m => m.name)
        };
      }

      const portal_id = quest.portal_id_ref;
      if (!portal_id || !alliance_id || members.length === 0) {
        return { ...quest, status: 'locked', quiz_passed_count: 0, quiz_member_count: members.length, quiz_passed_names: [] };
      }

      // Check each alliance member's quiz pass for this portal
      const passedNames = [];
      members.forEach(m => {
        const rows = query(
          'SELECT 1 FROM myth_quiz_attempts WHERE student_id = ? AND portal_id = ? AND passed = 1 LIMIT 1',
          [m.student_id, portal_id]
        );
        if (rows.length > 0) passedNames.push(m.name);
      });
      const allPassed = passedNames.length === members.length;

      const quizMeta = {
        quiz_passed_count: passedNames.length,
        quiz_member_count: members.length,
        quiz_passed_names: passedNames
      };

      if (!allPassed) {
        return { ...quest, status: 'locked', ...quizMeta };
      }

      // All passed — available (or keep existing status if row exists)
      return {
        ...quest,
        status: currentStatus || 'available',
        unlocked_at: avail ? avail.unlocked_at : null,
        completed_at: avail ? avail.completed_at : null,
        ...quizMeta
      };
    });

    res.json({ success: true, quests: enriched });
  } catch (err) {
    console.error('Side quest availability error:', err.message, err.stack);
    res.status(500).json({ error: 'Failed to fetch quest availability', detail: err.message });
  }
});

// POST /api/teacher/side-quest/manual-complete
// Allows teacher to mark an individual student complete on a game quest
// (e.g. for absences). Issues scroll if this completes the alliance.
app.post('/api/teacher/side-quest/manual-complete', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
  try {
    const { student_id, quest_id } = req.body;
    if (!student_id || !quest_id) return res.status(400).json({ error: 'Missing student_id or quest_id' });

    const student = query(
      'SELECT student_id, name, alliance_id FROM students WHERE student_id = ?',
      [student_id]
    )[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    if (!student.alliance_id) return res.status(400).json({ error: 'Student has no alliance' });

    const quest = query(
      "SELECT quest_id, quest_name, quest_type FROM side_quests_ref WHERE quest_id = ? AND quest_type = 'game_link'",
      [quest_id]
    )[0];
    if (!quest) return res.status(404).json({ error: 'Game quest not found' });

    const now = Math.floor(Date.now() / 1000);

    // Upsert availability row to completed
    const existing = query(
      'SELECT id, status FROM side_quest_availability WHERE student_id = ? AND quest_id = ?',
      [student_id, quest_id]
    )[0];

    if (existing) {
      if (existing.status === 'completed') {
        return res.json({ success: true, alreadyCompleted: true, scrollIssued: false });
      }
      run(
        `UPDATE side_quest_availability SET status = 'completed', completed_at = ? WHERE student_id = ? AND quest_id = ?`,
        [now, student_id, quest_id]
      );
    } else {
      run(
        `INSERT INTO side_quest_availability (student_id, quest_id, status, unlocked_at, completed_at)
         VALUES (?, ?, 'completed', ?, ?)`,
        [student_id, quest_id, now, now]
      );
    }

    // Record in side_quest_completions
    run(
      `INSERT OR IGNORE INTO side_quest_completions
         (student_id, quest_id, alliance_id, status, completion_source, completed_at_timestamp, submitted_at)
       VALUES (?, ?, ?, 'approved', 'teacher_manual', ?, CURRENT_TIMESTAMP)`,
      [student_id, quest_id, student.alliance_id, now]
    );

    console.log(`📋 Teacher manual complete: ${student.name} — quest ${quest.quest_name}`);

    // Check alliance completion and issue scroll if all done
    const allianceMembers = query(
      'SELECT student_id FROM students WHERE alliance_id = ?',
      [student.alliance_id]
    );
    const completedRows = query(
      "SELECT COUNT(*) as cnt FROM side_quest_availability WHERE quest_id = ? AND status = 'completed' AND student_id IN (SELECT student_id FROM students WHERE alliance_id = ?)",
      [quest_id, student.alliance_id]
    )[0];
    const completedCount = completedRows ? completedRows.cnt : 0;
    const totalMembers = allianceMembers.length;
    const allDone = totalMembers > 0 && completedCount >= totalMembers;

    let scrollIssued = false;
    if (allDone) {
      const scrollTypeMap = {
        'Orpheus in the Underworld': 'orpheus_bargain',
        "Echo's Lament":             'echo_reflection',
        'The Trials of Psyche':      'psyche_lantern'
      };
      const scrollType = scrollTypeMap[quest.quest_name];
      if (scrollType) {
        const existingScroll = query(
          'SELECT id FROM alliance_scrolls WHERE alliance_id = ? AND scroll_type = ? AND played_at IS NULL',
          [student.alliance_id, scrollType]
        )[0];
        if (!existingScroll) {
          run(
            `INSERT INTO alliance_scrolls (alliance_id, scroll_type, earned_at) VALUES (?, ?, ?)`,
            [student.alliance_id, scrollType, now]
          );
          scrollIssued = true;
          console.log(`📜 Scroll issued (manual): ${scrollType} → alliance ${student.alliance_id}`);
        }
      }
    }

    saveDatabase();
    res.json({
      success: true,
      alreadyCompleted: false,
      scrollIssued,
      allianceProgress: { completed: completedCount, total: totalMembers }
    });
  } catch (err) {
    console.error('Manual complete error:', err);
    res.status(500).json({ error: 'Failed to manually complete quest' });
  }
});

// --- Student: Get assignments for a myth portal (after quiz passed) ---
app.get('/api/student/myth-assignments/:portal_id', authenticateToken, (req, res) => {
  try {
    const portalId = parseInt(req.params.portal_id);
    const student_id = req.user.id;
    
    const portal = query('SELECT * FROM myth_portals WHERE portal_id = ?', [portalId])[0];
    if (!portal) return res.status(404).json({ error: 'Portal not found' });
    
    // Map portal myth_name to assignments_ref myth_god
    const mythGodMap = {
      'Pandora': 'Pandora',
      'Phaethon': 'Phaethon',
      'Orpheus & Eurydice': 'Orpheus',
      'Echo & Narcissus': 'Echo and Narcissus',
      'Icarus & Daedalus': 'Icarus',
      'Eros & Psyche': 'Eros and Psyche',
      'Constellations': 'Constellations'
    };
    const mythGod = mythGodMap[portal.myth_name] || portal.myth_name;
    
    // Get baseline assignments (reading guide, quiz, word cloud)
    const baselineAssignments = query(
      "SELECT * FROM assignments_ref WHERE myth_god = ? AND section IN ('classical', 'classical_creative') AND assignment_type != 'mural'",
      [mythGod]
    );
    
    // Get pixton (extra credit mural)
    const pixtonAssignment = query(
      "SELECT * FROM assignments_ref WHERE myth_god = ? AND section = 'classical_creative' AND assignment_type = 'mural'",
      [mythGod]
    );
    
    // Get bonus assignments for this myth
    const bonusMythGods = [mythGod];
    // Pandora also has Pandora (Box) bonus
    if (mythGod === 'Pandora') bonusMythGods.push('Pandora (Box)');
    const placeholders = bonusMythGods.map(() => '?').join(',');
    const bonusAssignments = query(
      `SELECT * FROM assignments_ref WHERE myth_god IN (${placeholders}) AND section = 'bonus' AND age = 'Classical'`,
      bonusMythGods
    );
    
    // Get student's completed records for these assignments
    const allAssignmentIds = [
      ...baselineAssignments.map(a => a.assignment_id),
      ...pixtonAssignment.map(a => a.assignment_id),
      ...bonusAssignments.map(a => a.assignment_id)
    ];
    
    let gradeRecords = [];
    if (allAssignmentIds.length > 0) {
      const idPlaceholders = allAssignmentIds.map(() => '?').join(',');
      gradeRecords = query(
        `SELECT * FROM grade_records WHERE student_id = ? AND assignment_id IN (${idPlaceholders})`,
        [student_id, ...allAssignmentIds]
      );
    }
    const completedIds = new Set(gradeRecords.map(g => g.assignment_id));
    
    const formatAssignment = (a) => ({
      assignment_id: a.assignment_id,
      display_name: a.display_name,
      assignment_type: a.assignment_type,
      max_points: a.max_points,
      description: a.description,
      resource_links: a.resource_links,
      completed: completedIds.has(a.assignment_id),
      points_earned: gradeRecords.find(g => g.assignment_id === a.assignment_id)?.points_earned || 0
    });
    
    res.json({
      portal: {
        portal_id: portal.portal_id,
        myth_name: portal.myth_name,
        display_name: portal.display_name,
        virtue_english: portal.virtue_english,
        virtue_greek: portal.virtue_greek,
        virtue_emoji: portal.virtue_emoji,
        glow_color: portal.glow_color
      },
      myth_god: mythGod,
      baseline: baselineAssignments.map(formatAssignment),
      pixton: pixtonAssignment.map(formatAssignment),
      bonus: bonusAssignments.map(formatAssignment),
      virtue_progress: {
        reading_guide: baselineAssignments.some(a => a.assignment_type === 'comp_conn' && completedIds.has(a.assignment_id)),
        quiz_passed: true,
        creative_done: baselineAssignments.some(a => a.assignment_type === 'word_cloud' && completedIds.has(a.assignment_id)) ||
                       pixtonAssignment.some(a => completedIds.has(a.assignment_id)),
        bonus_done: bonusAssignments.some(a => completedIds.has(a.assignment_id)),
        virtue_earned: baselineAssignments.some(a => a.assignment_type === 'comp_conn' && completedIds.has(a.assignment_id)) &&
                       (baselineAssignments.some(a => a.assignment_type === 'word_cloud' && completedIds.has(a.assignment_id)) ||
                        pixtonAssignment.some(a => completedIds.has(a.assignment_id))) &&
                       bonusAssignments.some(a => completedIds.has(a.assignment_id))
      }
    });
  } catch (err) {
    console.error('Myth assignments error:', err);
    res.status(500).json({ error: 'Failed to load myth assignments' });
  }
});

// --- Student: Get quiz status for a portal ---
app.get('/api/student/quiz-status', authenticateToken, (req, res) => {
  try {
    const attempts = query(
      'SELECT portal_id, COUNT(*) as attempt_count, MAX(percentage) as best_score, MAX(passed) as ever_passed FROM myth_quiz_attempts WHERE student_id = ? GROUP BY portal_id',
      [req.user.id]
    );
    const passed = attempts.filter(a => a.ever_passed === 1);
    res.json({ attempts, passed });
  } catch (err) {
    console.error('Quiz status error:', err);
    res.status(500).json({ error: 'Failed to get quiz status' });
  }
});

// --- Student: Heroic Age stat scores (Lore / Craft / Cunning / Honor) ---
// Lore    = Classical quiz points
// Craft   = Classical mural + word_cloud + creative points
// Honor   = Classical comp_conn points
// Cunning = arena battle wins × 3
app.get('/api/student/heroic-stats', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;

    const records = query(`
      SELECT gr.points_earned, ar.assignment_type, ar.section
      FROM grade_records gr
      JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
      WHERE gr.student_id = ? AND gr.points_earned > 0
    `, [student_id]);

    let lore = 0, craft = 0, honor = 0;
    for (const r of records) {
      const t = r.assignment_type;
      const s = r.section || '';
      const isClassical = s === 'classical' || s === 'classical_creative' || s === 'bonus';
      if (!isClassical) continue;
      if (t === 'quiz')                                          lore  += r.points_earned;
      else if (t === 'mural' || t === 'word_cloud' || t === 'creative') craft += r.points_earned;
      else if (t === 'comp_conn')                                honor += r.points_earned;
    }

    const battleStats = query(
      'SELECT wins FROM arena_battle_stats WHERE student_id = ?',
      [student_id]
    )[0];
    const cunning = ((battleStats && battleStats.wins) || 0) * 3;

    res.json({ lore, craft, cunning, honor });
  } catch (err) {
    console.error('Heroic stats error:', err);
    res.status(500).json({ error: 'Failed to compute heroic stats' });
  }
});

// --- Student: Get virtue summary ---
app.get('/api/student/virtues', authenticateToken, (req, res) => {
  try {
    // Reuse myth-portals logic to compute virtues
    const student = query('SELECT * FROM students WHERE student_id = ?', [req.user.id])[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    
    const portals = query('SELECT * FROM myth_portals ORDER BY myth_number');
    const gradeRecords = query(`
      SELECT gr.*, ar.assignment_type, ar.myth_god, ar.section
      FROM grade_records gr
      JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
      WHERE gr.student_id = ?
    `, [req.user.id]);
    const quizAttempts = query('SELECT portal_id, passed FROM myth_quiz_attempts WHERE student_id = ? AND passed = 1', [req.user.id]);
    
    const virtues = portals.map(portal => {
      const hasReadingGuide = gradeRecords.some(g => g.assignment_type === 'comp_conn' && g.myth_god === portal.myth_name && g.section === 'classical' && g.points_earned > 0);
      const quizPassed = quizAttempts.some(q => q.portal_id === portal.portal_id);
      const hasCreative = gradeRecords.some(g => (g.assignment_type === 'word_cloud' || g.assignment_type === 'mural') && g.myth_god === portal.myth_name && g.section === 'classical_creative' && g.points_earned > 0);
      
      return {
        myth_name: portal.myth_name,
        virtue_greek: portal.virtue_greek,
        virtue_english: portal.virtue_english,
        virtue_emoji: portal.virtue_emoji,
        earned: hasReadingGuide && quizPassed && hasCreative
      };
    });
    
    res.json({ 
      virtues, 
      total_earned: virtues.filter(v => v.earned).length,
      total_possible: 7
    });
  } catch (err) {
    console.error('Virtues error:', err);
    res.status(500).json({ error: 'Failed to get virtues' });
  }
});

// --- Teacher: Activate a myth portal for a specific period ---
app.post('/api/teacher/activate-portal', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
    
    const { portal_id, class_period, activated } = req.body;
    if (!portal_id || !class_period) return res.status(400).json({ error: 'portal_id and class_period required' });
    
    const existing = query('SELECT * FROM myth_portal_status WHERE portal_id = ? AND class_period = ?', 
                           [portal_id, class_period])[0];
    
    if (existing) {
      run('UPDATE myth_portal_status SET activated = ?, activated_at = CURRENT_TIMESTAMP, activated_by = ? WHERE status_id = ?',
          [activated ? 1 : 0, req.user.id, existing.status_id]);
    } else {
      run(`INSERT INTO myth_portal_status (portal_id, class_period, activated, activated_at, activated_by)
           VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)`, [portal_id, class_period, activated ? 1 : 0, req.user.id]);
    }
    
    saveDatabase();
    const portal = query('SELECT * FROM myth_portals WHERE portal_id = ?', [portal_id])[0];
    res.json({ 
      success: true, 
      message: `${portal ? portal.display_name : 'Portal'} ${activated ? 'activated' : 'deactivated'} for ${class_period} period` 
    });
  } catch (err) {
    console.error('Activate portal error:', err);
    res.status(500).json({ error: 'Failed to activate portal' });
  }
});

// --- Teacher: Get virtue progress for all students ---
app.get('/api/teacher/virtue-progress', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
    
    const students = query('SELECT s.student_id, s.name, s.class_period, s.alliance_id, a.alliance_name FROM students s LEFT JOIN alliances a ON s.alliance_id = a.alliance_id ORDER BY s.class_period, s.name');
    const portals = query('SELECT * FROM myth_portals ORDER BY myth_number');
    const allGrades = query("SELECT * FROM grade_records WHERE age = 'Classical'");
    
    const progress = students.map(student => {
      const studentGrades = allGrades.filter(g => g.student_id === student.student_id);
      
      const virtueStatus = portals.map(portal => {
        const hasRG = studentGrades.some(g => g.assignment_type === 'comp_conn' && g.myth_god === portal.myth_name && g.points_earned > 0);
        const quizG = studentGrades.find(g => g.assignment_type === 'quiz' && g.myth_god === portal.myth_name);
        const qPassed = quizG ? (quizG.points_earned / quizG.max_points >= 0.8) : false;
        const hasCr = studentGrades.some(g => (g.assignment_type === 'bonus' || g.assignment_type === 'word_cloud' || g.assignment_type === 'wildcard') && g.myth_god === portal.myth_name && g.points_earned > 0);
        return { myth: portal.myth_name, earned: hasRG && qPassed && hasCr };
      });
      
      return {
        student_id: student.student_id,
        name: student.name,
        class_period: student.class_period,
        alliance_name: student.alliance_name,
        virtues: virtueStatus,
        total_earned: virtueStatus.filter(v => v.earned).length
      };
    });
    
    res.json({ progress });
  } catch (err) {
    console.error('Virtue progress error:', err);
    res.status(500).json({ error: 'Failed to get virtue progress' });
  }
});

// --- Teacher: Get myth portal statuses for all periods ---
app.get('/api/teacher/myth-portals', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
    
    const portals = query('SELECT * FROM myth_portals ORDER BY myth_number');
    const statuses = query('SELECT * FROM myth_portal_status');
    
    // Group statuses by portal and period
    const portalData = portals.map(p => ({
      ...p,
      periods: {
        '1st': statuses.find(s => s.portal_id === p.portal_id && s.class_period === '1st') || { activated: 0 },
        '2nd': statuses.find(s => s.portal_id === p.portal_id && s.class_period === '2nd') || { activated: 0 },
        '3rd': statuses.find(s => s.portal_id === p.portal_id && s.class_period === '3rd') || { activated: 0 },
        '4th': statuses.find(s => s.portal_id === p.portal_id && s.class_period === '4th') || { activated: 0 },
        'Test': statuses.find(s => s.portal_id === p.portal_id && s.class_period === 'Test') || { activated: 0 }
      }
    }));

    res.json(portalData);
  } catch (err) {
    console.error('Teacher myth portals error:', err);
    res.status(500).json({ error: 'Failed to get myth portals' });
  }
});

// ====================
// ADAPTIVE BATTLE QUESTION POOL
// ====================

// Override the getRandomQuestion function to support adaptive Classical pool
// Uses intersection of both battlers' unlocked myths with 70/30 Classical/Archaic weighting

function getAdaptiveBattleQuestion(challengerId, defenderId, excludeIds = []) {
  // Get both students' class periods
  const challenger = query('SELECT class_period FROM students WHERE student_id = ?', [challengerId])[0];
  const defender = defenderId ? query('SELECT class_period FROM students WHERE student_id = ?', [defenderId])[0] : null;
  
  if (!challenger || !challenger.class_period) {
    console.log(`⚠️ BQ: No class_period for challenger ${challengerId}, falling back to random`);
    return getRandomQuestion(excludeIds);
  }
  
  // Get myths unlocked for this period (portals activated by teacher)
  const unlockedPortals = query(
    'SELECT mp.portal_id, mp.myth_name FROM myth_portal_status mps JOIN myth_portals mp ON mps.portal_id = mp.portal_id WHERE mps.class_period = ? AND mps.activated = 1',
    [challenger.class_period]
  );
  
  console.log(`📊 BQ: Period ${challenger.class_period}, unlocked portals: ${unlockedPortals.map(p => p.myth_name).join(', ') || 'NONE'}`);
  
  // Filter to only myths BOTH students have passed the quiz for
  let sharedMyths = [];
  if (unlockedPortals.length > 0) {
    for (const portal of unlockedPortals) {
      const challengerPassed = query(
        'SELECT 1 FROM myth_quiz_attempts WHERE student_id = ? AND portal_id = ? AND passed = 1 LIMIT 1',
        [challengerId, portal.portal_id]
      );
      
      // If no defender (edge case), just check challenger
      if (!defenderId) {
        if (challengerPassed.length > 0) sharedMyths.push(portal.myth_name);
        continue;
      }
      
      const defenderPassed = query(
        'SELECT 1 FROM myth_quiz_attempts WHERE student_id = ? AND portal_id = ? AND passed = 1 LIMIT 1',
        [defenderId, portal.portal_id]
      );
      
      if (challengerPassed.length > 0 && defenderPassed.length > 0) {
        sharedMyths.push(portal.myth_name);
      } else {
        console.log(`📊 BQ: ${portal.myth_name} — challenger passed: ${challengerPassed.length > 0}, defender passed: ${defenderPassed.length > 0}`);
      }
    }
  }
  
  console.log(`📊 BQ: Shared myths (both passed): ${sharedMyths.join(', ') || 'NONE'}`);
  
  // Build exclude clause
  const excludeClause = excludeIds.length > 0 
    ? `AND question_id NOT IN (${excludeIds.map(() => '?').join(',')})` 
    : '';
  const excludeParams = excludeIds.length > 0 ? [...excludeIds] : [];
  
  // Get Archaic and Classical question pools separately
  const archaicQuestions = query(
    `SELECT * FROM battle_questions WHERE is_active = 1 AND (age = 'Archaic' OR age IS NULL) ${excludeClause}`,
    excludeParams
  );
  
  let classicalQuestions = [];
  if (sharedMyths.length > 0) {
    const mythPlaceholders = sharedMyths.map(() => '?').join(',');
    classicalQuestions = query(
      `SELECT * FROM battle_questions WHERE is_active = 1 AND age = 'Classical' AND myth_name IN (${mythPlaceholders}) ${excludeClause}`,
      [...sharedMyths, ...excludeParams]
    );
  }
  
  console.log(`📊 BQ: Archaic pool: ${archaicQuestions.length}, Classical pool: ${classicalQuestions.length}`);
  
  // 70/30 weighting: if Classical questions exist, 70% chance of Classical, 30% Archaic
  let pool;
  if (classicalQuestions.length > 0 && archaicQuestions.length > 0) {
    pool = Math.random() < 0.7 ? classicalQuestions : archaicQuestions;
  } else if (classicalQuestions.length > 0) {
    pool = classicalQuestions;
  } else if (archaicQuestions.length > 0) {
    pool = archaicQuestions;
  } else {
    // Absolute fallback
    pool = query('SELECT * FROM battle_questions WHERE is_active = 1');
    if (pool.length === 0) return null;
  }
  
  // Fisher-Yates shuffle and return first
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  
  return pool[0];
}

// ====================
// PERCENTAGE-BASED AGGRESSIVE FATE PENALTY
// ====================

// Helper: Apply percentage-based floor for aggressive fate failures
// If the flat failure points are less than 10% of alliance total, use 10% instead
// applyAggressivePenalty removed V91 — fate outcomes apply exactly as written

// ====================
// BATTLE QUESTION DIAGNOSTIC (teacher only — remove after debugging)
app.get('/api/diag/battle-questions', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
  try {
    const allQuestions = query('SELECT question_id, god_associated, age, myth_name, is_active, substr(question_text, 1, 60) as preview FROM battle_questions ORDER BY age, myth_name');
    const byAge = {};
    allQuestions.forEach(q => {
      const key = `${q.age || 'NULL'}_${q.is_active ? 'active' : 'inactive'}`;
      byAge[key] = (byAge[key] || 0) + 1;
    });
    
    const portals = query('SELECT mp.portal_id, mp.myth_name, mps.class_period, mps.activated FROM myth_portal_status mps JOIN myth_portals mp ON mps.portal_id = mp.portal_id ORDER BY mps.class_period, mp.portal_id');
    
    const quizAttempts = query('SELECT portal_id, COUNT(DISTINCT student_id) as students_passed FROM myth_quiz_attempts WHERE passed = 1 GROUP BY portal_id');
    
    const quizQuestionCount = query('SELECT COUNT(*) as cnt FROM myth_quiz_questions')[0];
    const classicalBattleCount = query("SELECT COUNT(*) as cnt FROM battle_questions WHERE age = 'Classical'")[0];
    
    res.json({
      summary: byAge,
      total_questions: allQuestions.length,
      quiz_questions_in_db: quizQuestionCount?.cnt || 0,
      classical_battle_questions: classicalBattleCount?.cnt || 0,
      portal_activation: portals,
      quiz_passes_by_portal: quizAttempts,
      sample_classical: allQuestions.filter(q => q.age === 'Classical').slice(0, 5),
      sample_archaic: allQuestions.filter(q => q.age === 'Archaic' && q.is_active).slice(0, 3)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DIAGNOSTIC: Virtue claim pipeline for a specific student
app.get('/api/diag/virtue-pipeline/:studentId', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
  try {
    const sid = parseInt(req.params.studentId);
    const student = query('SELECT student_id, name, class_period FROM students WHERE student_id = ?', [sid])[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });

    // 1. All submissions for this student (with section, category, myth_god, status)
    const submissions = query(
      `SELECT submission_id, category, section, myth_god, points_claimed, max_points, status, submitted_at, reviewed_at
       FROM point_submissions WHERE student_id = ? ORDER BY submitted_at DESC`, [sid]
    );

    // 2. All myth completion rows
    const mythCompletions = query(
      'SELECT * FROM student_myth_completion WHERE student_id = ?', [sid]
    );

    // 3. All classical grade records
    const gradeRecords = query(
      `SELECT gr.record_id, gr.assignment_id, gr.points_earned, gr.points_possible, gr.submission_id,
              ar.section, ar.assignment_type, ar.myth_god, ar.display_name
       FROM grade_records gr
       JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
       WHERE gr.student_id = ? AND ar.section IN ('classical', 'classical_creative')
       ORDER BY ar.myth_god, ar.assignment_type`, [sid]
    );

    // 4. Quiz attempts
    const quizAttempts = query(
      'SELECT portal_id, passed, score, percentage FROM myth_quiz_attempts WHERE student_id = ?', [sid]
    );

    // 5. Portal definitions for reference
    const portals = query('SELECT portal_id, myth_name, virtue_english FROM myth_portals ORDER BY portal_id');

    // Build per-portal summary
    const portalSummary = portals.map(p => {
      const completion = mythCompletions.find(mc => mc.portal_id === p.portal_id);
      const quiz = quizAttempts.find(q => q.portal_id === p.portal_id && q.passed === 1);
      const guide = gradeRecords.find(g => g.assignment_type === 'comp_conn' && g.section === 'classical' && g.myth_god === p.myth_name && g.points_earned > 0);
      const creative = gradeRecords.filter(g => 
        ['word_cloud', 'mural', 'creative', 'cer'].includes(g.assignment_type) && 
        g.section === 'classical_creative' && g.myth_god === p.myth_name && g.points_earned > 0
      );
      const subs = submissions.filter(s => s.myth_god === p.myth_name);

      return {
        portal_id: p.portal_id,
        myth_name: p.myth_name,
        virtue: p.virtue_english,
        has_quiz_pass: !!quiz,
        has_reading_guide: !!guide,
        guide_points: guide ? guide.points_earned : 0,
        creative_grade_records: creative.map(c => ({ type: c.assignment_type, earned: c.points_earned, display: c.display_name })),
        myth_completion_row: completion || 'MISSING',
        teacher_approved: completion ? completion.teacher_approved : 'NO ROW',
        virtue_claimed: completion ? completion.virtue_claimed : 'NO ROW',
        submissions: subs.map(s => ({ id: s.submission_id, cat: s.category, section: s.section, status: s.status, pts: s.points_claimed }))
      };
    });

    res.json({
      student,
      portal_summary: portalSummary,
      raw: { submissions_count: submissions.length, myth_completions: mythCompletions, grade_records_classical: gradeRecords.length, quiz_attempts: quizAttempts }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DIAGNOSTIC: System-wide virtue audit — find ALL mismatches across all students
app.get('/api/diag/virtue-audit', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
  try {
    const students = query('SELECT student_id, name, class_period FROM students ORDER BY class_period, name');
    const portals = query('SELECT portal_id, myth_name, virtue_english FROM myth_portals ORDER BY portal_id');
    const allCompletions = query('SELECT * FROM student_myth_completion');
    const allQuizPasses = query('SELECT student_id, portal_id FROM myth_quiz_attempts WHERE passed = 1');
    const allGrades = query(
      `SELECT gr.student_id, gr.points_earned, ar.assignment_type, ar.section, ar.myth_god
       FROM grade_records gr JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
       WHERE ar.section IN ('classical', 'classical_creative') AND gr.points_earned > 0`
    );

    // Alias map matching the dashboard logic
    const portalAliases = {
      'Pandora': ['Pandora'], 'Phaethon': ['Phaethon'],
      'Orpheus & Eurydice': ['Orpheus', 'Orpheus & Eurydice', 'Orpheus and Eurydice'],
      'Echo & Narcissus': ['Echo and Narcissus', 'Echo & Narcissus'],
      'Icarus & Daedalus': ['Icarus', 'Icarus & Daedalus', 'Icarus and Daedalus'],
      'Eros & Psyche': ['Eros and Psyche', 'Eros & Psyche'],
      'Constellations': ['Constellations']
    };

    const mismatches = [];
    const stats = { total_students: students.length, total_checked: 0, virtues_ready: 0, missing_rows: 0, already_claimed: 0 };

    students.forEach(s => {
      portals.forEach(p => {
        stats.total_checked++;
        const aliases = portalAliases[p.myth_name] || [p.myth_name];

        // Dashboard logic: virtueReady
        const hasQuiz = allQuizPasses.some(q => q.student_id === s.student_id && q.portal_id === p.portal_id);
        const hasGuide = allGrades.some(g => g.student_id === s.student_id && g.assignment_type === 'comp_conn' && g.section === 'classical' && aliases.includes(g.myth_god));
        const hasCreative = allGrades.some(g => g.student_id === s.student_id && ['word_cloud','mural','creative','cer'].includes(g.assignment_type) && g.section === 'classical_creative' && aliases.includes(g.myth_god));

        const completion = allCompletions.find(c => c.student_id === s.student_id && c.portal_id === p.portal_id);
        const assignmentApproved = completion ? completion.teacher_approved === 1 : false;
        const virtueClaimed = completion ? completion.virtue_claimed === 1 : false;

        const dashboardReady = hasQuiz && hasGuide && (assignmentApproved || hasCreative) && !virtueClaimed;

        if (virtueClaimed) stats.already_claimed++;
        if (dashboardReady) stats.virtues_ready++;

        // Check for mismatch: dashboard shows ready but myth_completion row is missing
        if (dashboardReady && !assignmentApproved) {
          stats.missing_rows++;
          mismatches.push({
            student: s.name,
            period: s.class_period,
            student_id: s.student_id,
            myth: p.myth_name,
            portal_id: p.portal_id,
            issue: 'Dashboard shows virtue ready but student_myth_completion row is missing or not approved',
            has_quiz: hasQuiz,
            has_guide: hasGuide,
            has_creative: hasCreative,
            has_completion_row: !!completion,
            note: 'Fix applied: claim-virtue endpoint will auto-create row when student clicks Claim'
          });
        }
      });
    });

    res.json({
      stats,
      mismatches,
      message: mismatches.length === 0 
        ? 'All virtue pipelines are consistent — no mismatches found.' 
        : `Found ${mismatches.length} mismatch(es). These students will see "Claim Your Virtue" and the claim WILL work thanks to the auto-recovery fix.`
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Diagnostic: Icarus virtue + quiz pipeline for named students
// Usage: GET /api/diag/student-issues?names=Tapley,Vaughn
app.get('/api/diag/student-issues', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
  try {
    const { names } = req.query;
    if (!names) return res.status(400).json({ error: 'Provide ?names=Name1,Name2' });

    const nameList = names.split(',').map(n => n.trim().toLowerCase());
    const allStudents = query('SELECT student_id, name, class_period FROM students WHERE is_ghost = 0 OR is_ghost IS NULL');
    const matched = allStudents.filter(s => nameList.some(n => s.name.toLowerCase().includes(n)));
    if (!matched.length) return res.status(404).json({ error: 'No students found', searched: nameList });

    // Icarus portal_id — find it dynamically
    const icarusPortal = query("SELECT portal_id, myth_name FROM myth_portals WHERE myth_name LIKE '%Icarus%' LIMIT 1")[0];
    if (!icarusPortal) return res.status(500).json({ error: 'Icarus portal not found in myth_portals' });

    const icarusAliases = ['Icarus', 'Icarus & Daedalus', 'Icarus and Daedalus'];

    const results = matched.map(student => {
      const sid = student.student_id;

      // All quiz attempts for Icarus
      const quizAttempts = query(
        'SELECT score, total_questions, percentage, passed, attempted_at FROM myth_quiz_attempts WHERE student_id = ? AND portal_id = ? ORDER BY attempted_at',
        [sid, icarusPortal.portal_id]
      );
      const quizPassed = quizAttempts.some(a => a.passed === 1);
      const bestAttempt = quizAttempts.reduce((best, a) => (!best || a.percentage > best.percentage) ? a : best, null);

      // Reading guide: comp_conn in classical section for Icarus
      const guides = query(
        `SELECT ar.myth_god, ar.assignment_type, ar.section, ar.display_name, gr.points_earned, gr.completed_at
         FROM grade_records gr
         JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
         WHERE gr.student_id = ? AND ar.assignment_type = 'comp_conn' AND ar.section = 'classical'
         AND ar.myth_god IN (${icarusAliases.map(() => '?').join(',')})`,
        [sid, ...icarusAliases]
      );

      // Creative: word_cloud / mural / creative / cer in classical_creative for Icarus
      const creatives = query(
        `SELECT ar.myth_god, ar.assignment_type, ar.section, ar.display_name, gr.points_earned, gr.completed_at
         FROM grade_records gr
         JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
         WHERE gr.student_id = ? AND ar.section = 'classical_creative'
         AND ar.assignment_type IN ('word_cloud','mural','creative','cer')
         AND ar.myth_god IN (${icarusAliases.map(() => '?').join(',')})`,
        [sid, ...icarusAliases]
      );

      // Also pull ALL classical_creative records to see what's actually there
      const allCreativeRecords = query(
        `SELECT ar.myth_god, ar.assignment_type, ar.section, ar.display_name, gr.points_earned
         FROM grade_records gr
         JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
         WHERE gr.student_id = ? AND ar.section = 'classical_creative'`,
        [sid]
      );

      // myth_completion row for Icarus
      const completion = query(
        'SELECT assignment_path, teacher_approved, approved_at, virtue_claimed, virtue_claimed_at, points_earned FROM student_myth_completion WHERE student_id = ? AND portal_id = ?',
        [sid, icarusPortal.portal_id]
      )[0] || null;

      const hasGuide = guides.some(g => g.points_earned > 0);
      const hasCreative = creatives.some(c => c.points_earned > 0);
      const approvedCompletion = completion && completion.teacher_approved;

      let blocker = 'None — should be claimable';
      if (!quizPassed) blocker = 'QUIZ NOT PASSED';
      else if (!hasGuide) blocker = 'READING GUIDE missing or not graded';
      else if (!hasCreative && !approvedCompletion) blocker = 'CREATIVE ASSIGNMENT missing or not approved';
      else if (completion && completion.virtue_claimed) blocker = 'Virtue already claimed';
      else if (!completion) blocker = 'No myth_completion row — auto-recovery will run on claim attempt';

      return {
        name: student.name,
        period: student.class_period,
        student_id: sid,
        icarus_portal_id: icarusPortal.portal_id,
        BLOCKER: blocker,
        quiz: {
          attempt_count: quizAttempts.length,
          passed: quizPassed,
          best: bestAttempt ? `${bestAttempt.score}/${bestAttempt.total_questions} = ${bestAttempt.percentage}% (passed=${bestAttempt.passed})` : 'no attempts',
          all_attempts: quizAttempts.map(a => `${a.score}/${a.total_questions} ${a.percentage}% passed=${a.passed} [${a.attempted_at}]`)
        },
        reading_guide: {
          found: hasGuide,
          records: guides
        },
        creative_assignment: {
          found: hasCreative,
          icarus_records: creatives,
          ALL_classical_creative_records: allCreativeRecords
        },
        myth_completion_row: completion || 'NO ROW'
      };
    });

    res.json({ students: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Diagnostic + Repair: Check and fix quiz grades for specific students
// GET  /api/admin/repair-quiz-grades?names=Lincoln,Anneliese  (dry run)
// POST /api/admin/repair-quiz-grades  body: { names: "Lincoln,Anneliese" }  (execute)
app.all('/api/admin/repair-quiz-grades', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
  const isDryRun = req.method === 'GET';
  try {
    const names = (req.query.names || req.body?.names || '').toString();
    if (!names) return res.status(400).json({ error: 'Provide names=Lincoln,Anneliese' });

    const nameList = names.split(',').map(n => n.trim().toLowerCase());
    const allStudents = query('SELECT student_id, name, class_period FROM students WHERE is_ghost = 0 OR is_ghost IS NULL');
    const matched = allStudents.filter(s => nameList.some(n => s.name.toLowerCase().includes(n)));
    if (!matched.length) return res.status(404).json({ error: 'No students found', searched: nameList });

    const portals = query('SELECT portal_id, myth_name FROM myth_portals ORDER BY portal_id');
    const portalToAssignmentName = {
      'Icarus & Daedalus': 'Icarus', 'Icarus and Daedalus': 'Icarus',
      'Echo & Narcissus': 'Echo and Narcissus', 'Orpheus & Eurydice': 'Orpheus',
      'Eros & Psyche': 'Eros and Psyche', 'Eros and Psyche': 'Eros and Psyche'
    };

    const results = matched.map(student => {
      const sid = student.student_id;
      const portalResults = [];

      portals.forEach(portal => {
        const assignmentMythGod = portalToAssignmentName[portal.myth_name] || portal.myth_name;
        const quizAssignment = query(
          "SELECT assignment_id, max_points FROM assignments_ref WHERE section = 'classical' AND assignment_type = 'quiz' AND myth_god = ?",
          [assignmentMythGod]
        )[0];

        // Get ALL attempts for this student+portal
        const attempts = query(
          'SELECT score, total_questions, percentage, passed, attempted_at FROM myth_quiz_attempts WHERE student_id = ? AND portal_id = ? ORDER BY attempted_at DESC',
          [sid, portal.portal_id]
        );
        if (attempts.length === 0) return; // never attempted

        const bestAttempt = attempts.reduce((best, a) => (!best || a.percentage > best.percentage) ? a : best, null);
        const anyPassed = attempts.some(a => a.passed === 1);

        // Check existing grade
        const existingGrade = quizAssignment ? query(
          'SELECT record_id, points_earned FROM grade_records WHERE student_id = ? AND assignment_id = ?',
          [sid, quizAssignment.assignment_id]
        )[0] : null;

        let action = 'none';
        let gradePoints = null;

        if (quizAssignment && !existingGrade && bestAttempt) {
          // No grade exists — compute from best attempt
          gradePoints = Math.round((bestAttempt.score / bestAttempt.total_questions) * quizAssignment.max_points);
          // Only insert if best attempt scored 80%+ OR any attempt was marked passed
          if (bestAttempt.percentage >= 80 || anyPassed) {
            action = 'INSERT_GRADE';
            if (!isDryRun) {
              run('INSERT INTO grade_records (student_id, assignment_id, points_earned, points_possible) VALUES (?, ?, ?, ?)',
                [sid, quizAssignment.assignment_id, gradePoints, quizAssignment.max_points]);
            }
          } else {
            action = 'BEST_SCORE_BELOW_80';
          }
        } else if (existingGrade) {
          action = 'GRADE_EXISTS';
          gradePoints = existingGrade.points_earned;
        } else if (!quizAssignment) {
          action = 'NO_ASSIGNMENT_REF';
        }

        portalResults.push({
          portal: portal.myth_name,
          portal_id: portal.portal_id,
          assignment_myth_god: assignmentMythGod,
          attempts: attempts.length,
          best_percentage: bestAttempt?.percentage,
          best_score: bestAttempt ? `${bestAttempt.score}/${bestAttempt.total_questions}` : null,
          any_marked_passed: anyPassed,
          grade_status: action,
          grade_points: gradePoints,
          assignment_max: quizAssignment?.max_points
        });
      });

      // Also check daedalus_game_results for Icarus specifically
      let daedalusAttempts = [];
      try {
        daedalusAttempts = query(
          'SELECT first_attempt_correct, total_questions, completed, alliance_points_awarded FROM daedalus_game_results WHERE student_id = ? ORDER BY rowid DESC',
          [sid]
        );
      } catch(e) { /* table might not exist */ }

      return {
        name: student.name,
        student_id: sid,
        class_period: student.class_period,
        portals: portalResults,
        daedalus_game_attempts: daedalusAttempts.length > 0 ? daedalusAttempts : 'none'
      };
    });

    if (!isDryRun) saveDatabase();
    res.json({ 
      mode: isDryRun ? 'DRY_RUN (use POST to execute)' : 'EXECUTED', 
      students: results 
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack });
  }
});

// Repair endpoint: Vaughn quiz, Ethan building refund, Blake fate refund
// GET  = dry run (shows what WOULD happen, no DB writes)
// POST = execute (writes to DB)
app.get('/api/admin/repair-student-issues', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
  try {
    const report = {};

    // ── 1. VAUGHN: Already fixed — quiz record exists ────────────────────────
    const vaughn = query("SELECT student_id, name, class_period FROM students WHERE name LIKE '%Vaughn%' AND (is_ghost = 0 OR is_ghost IS NULL) LIMIT 1")[0];
    if (!vaughn) {
      report.vaughn = { error: 'Student not found' };
    } else {
      const existing = query('SELECT attempt_id, score, total_questions, percentage, passed, attempted_at FROM myth_quiz_attempts WHERE student_id = ? AND portal_id = 5', [vaughn.student_id]);
      report.vaughn = {
        name: vaughn.name,
        action: existing.length > 0 ? 'SKIP — quiz record already exists, no action needed' : 'WARNING — no record found',
        existing_record: existing[0] || null
      };
    }

    // ── 2. ETHAN: Building purchases on 2026-03-31 18:00–20:00 UTC (1–3 PM CDT) ──
    const ethan = query("SELECT student_id, name, class_period, alliance_id FROM students WHERE name LIKE '%Ethan%' AND (is_ghost = 0 OR is_ghost IS NULL) LIMIT 1")[0];
    if (!ethan) {
      report.ethan = { error: 'Student not found' };
    } else {
      const transactions = query(
        `SELECT transaction_id, amount, category, reason, timestamp
         FROM point_transactions
         WHERE alliance_id = ? AND category = 'Building Purchase'
         AND timestamp >= '2026-03-31 18:00:00' AND timestamp <= '2026-03-31 20:00:00'
         ORDER BY timestamp DESC`,
        [ethan.alliance_id]
      );
      const allPurchases = query(
        `SELECT transaction_id, amount, reason, timestamp FROM point_transactions
         WHERE alliance_id = ? AND category = 'Building Purchase' ORDER BY timestamp DESC LIMIT 20`,
        [ethan.alliance_id]
      );
      const allianceNow = query('SELECT total_points FROM alliances WHERE alliance_id = ?', [ethan.alliance_id])[0];
      const totalLost = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      report.ethan = {
        name: ethan.name,
        period: ethan.class_period,
        alliance_id: ethan.alliance_id,
        alliance_points_now: allianceNow ? allianceNow.total_points : 'unknown',
        window_searched: '2026-03-31 18:00–20:00 UTC (1–3 PM CDT)',
        transactions_in_window: transactions,
        total_to_refund: totalLost,
        action: transactions.length > 0
          ? `WILL REFUND: +${totalLost} pts to alliance ${ethan.alliance_id} (${transactions.length} transaction(s))`
          : 'No transactions in window — see all_recent_purchases for context',
        all_recent_purchases_last20: allPurchases
      };
    }

    // ── 3. BLAKE: Show all fate/battle transactions last 14 days to locate the loss ──
    const blake = query("SELECT student_id, name, class_period, alliance_id FROM students WHERE name LIKE '%Blake%' AND (is_ghost = 0 OR is_ghost IS NULL) LIMIT 1")[0];
    if (!blake) {
      report.blake = { error: 'Student not found' };
    } else {
      const allFateTxns = query(
        `SELECT transaction_id, amount, category, reason, timestamp
         FROM point_transactions
         WHERE alliance_id = ? AND category IN ('fate','battle')
         AND timestamp >= datetime('now', '-14 days')
         ORDER BY timestamp DESC`,
        [blake.alliance_id]
      );
      const negativeTxns = allFateTxns.filter(t => t.amount < 0);
      const allianceNow = query('SELECT total_points FROM alliances WHERE alliance_id = ?', [blake.alliance_id])[0];
      report.blake = {
        name: blake.name,
        period: blake.class_period,
        alliance_id: blake.alliance_id,
        alliance_points_now: allianceNow ? allianceNow.total_points : 'unknown',
        window: 'Last 14 days — all fate/battle transactions',
        all_fate_battle_txns: allFateTxns,
        negative_txns_only: negativeTxns,
        action: 'REVIEW: identify the transaction to refund, then confirm with David before executing'
      };
    }

    report.dry_run = true;
    report.instructions = 'Review above. If correct, POST to /api/admin/repair-student-issues to execute.';
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/repair-student-issues', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
  try {
    const results = {};

    // ── IDEMPOTENCY GUARD: check if repair already ran ────────────────────────
    const alreadyRan = query(
      "SELECT COUNT(*) as cnt FROM point_transactions WHERE category = 'admin_repair' AND reason LIKE '%ghost multiplier bug%' AND timestamp >= datetime('now', '-1 day')",
      []
    )[0].cnt;
    if (alreadyRan > 0) {
      return res.status(409).json({
        error: 'Repair already executed in the last 24 hours — aborting to prevent double application.',
        existing_repair_count: alreadyRan,
        instructions: 'If you need to re-run, check the transaction log first.'
      });
    }

    // ── 1. VAUGHN: Skip — already fixed ──────────────────────────────────────
    results.vaughn = { skipped: true, reason: 'Quiz record already exists — no action taken' };

    // ── 2. ETHAN: Refund building purchases 2026-03-31 18:00–20:00 UTC ───────
    const ethan = query("SELECT student_id, name, alliance_id FROM students WHERE name LIKE '%Ethan%' AND (is_ghost = 0 OR is_ghost IS NULL) LIMIT 1")[0];
    if (!ethan) {
      results.ethan = { error: 'Student not found — no changes made' };
    } else {
      const transactions = query(
        `SELECT transaction_id, amount FROM point_transactions
         WHERE alliance_id = ? AND category = 'Building Purchase'
         AND timestamp >= '2026-03-31 18:00:00' AND timestamp <= '2026-03-31 20:00:00'`,
        [ethan.alliance_id]
      );
      if (transactions.length === 0) {
        results.ethan = { skipped: true, reason: 'No building purchases found in window 2026-03-31 18:00–20:00 UTC' };
      } else {
        const totalRefund = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
        run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', [totalRefund, ethan.alliance_id]);
        run(`INSERT INTO point_transactions (alliance_id, student_id, amount, category, reason) VALUES (?, ?, ?, 'admin_repair', ?)`,
          [ethan.alliance_id, ethan.student_id, totalRefund, `Admin repair: refund ${totalRefund} pts for building purchases on 2026-03-31 (ghost multiplier bug)`]);
        results.ethan = { success: true, refunded: totalRefund, transactions_count: transactions.length };
      }
    }

    // ── 3. BLAKE: Refund negative fate/battle from 2026-03-30 ────────────────
    const blake = query("SELECT student_id, name, alliance_id FROM students WHERE name LIKE '%Blake%' AND (is_ghost = 0 OR is_ghost IS NULL) LIMIT 1")[0];
    if (!blake) {
      results.blake = { error: 'Student not found — no changes made' };
    } else {
      const transactions = query(
        `SELECT transaction_id, amount FROM point_transactions
         WHERE alliance_id = ? AND category IN ('fate','battle') AND amount < 0
         AND date(timestamp) = '2026-03-30'`,
        [blake.alliance_id]
      );
      if (transactions.length === 0) {
        results.blake = { skipped: true, reason: 'No negative fate/battle transactions found on 2026-03-30' };
      } else {
        const totalRefund = transactions.reduce((sum, t) => sum + Math.abs(t.amount), 0);
        run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', [totalRefund, blake.alliance_id]);
        run(`INSERT INTO point_transactions (alliance_id, student_id, amount, category, reason) VALUES (?, ?, ?, 'admin_repair', ?)`,
          [blake.alliance_id, blake.student_id, totalRefund, `Admin repair: refund ${totalRefund} pts for negative fate/battle on 2026-03-30 (ghost multiplier bug)`]);
        results.blake = { success: true, refunded: totalRefund, transactions_count: transactions.length };
      }
    }

    saveDatabase();
    results.dry_run = false;
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// HEALTH CHECK
// ====================

app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    database: dbReady ? 'ready' : 'initializing' 
  });
});

// Diagnostic: Check Classical bonus assignments in database
// ==================== TRADE SYSTEM ENDPOINTS ====================
// Revised design: No shared pool. Students buy directly into personal inventory.
// Spending cap based on individual contribution to alliance.

const TRADE_RESOURCES = ['olive', 'grape', 'iron', 'grain'];
const TRADE_RESOURCE_LABELS = { olive: '🫒 Olive Oil', grape: '🍇 Grapes', iron: '⚒️ Iron', grain: '🌾 Grain' };
const RESOURCE_BUY_RATE = 10; // 1 alliance point = 10 resource units
const DEFAULT_RESOURCE_THRESHOLD = 150; // configurable per period

// Helper: ensure student_resources row exists
function ensureStudentResources(student_id) {
  const existing = query('SELECT student_id FROM student_resources WHERE student_id = ?', [student_id])[0];
  if (!existing) {
    run('INSERT INTO student_resources (student_id, olive, grape, iron, grain) VALUES (?, 0, 0, 0, 0)', [student_id]);
  }
}

// Helper: get a student's personal contribution to their alliance
function getStudentContribution(student_id) {
  const result = query(
    "SELECT COALESCE(SUM(amount), 0) as total FROM point_transactions WHERE student_id = ? AND amount > 0",
    [student_id]
  )[0];
  return result ? result.total : 0;
}

// Helper: get how much a student has already spent on resources
function getStudentResourceSpending(student_id) {
  const result = query(
    "SELECT COALESCE(SUM(points_spent), 0) as total FROM resource_buys WHERE student_id = ?",
    [student_id]
  )[0];
  return result ? result.total : 0;
}

// Helper: get configured threshold for a period (default 500)
function getResourceThreshold(period) {
  const tw = query('SELECT resource_threshold FROM trade_window WHERE period = ?', [period])[0];
  return (tw && tw.resource_threshold) ? tw.resource_threshold : DEFAULT_RESOURCE_THRESHOLD;
}

// Helper: Calculate market values for a period
function getMarketValues(period) {
  const alliances = query('SELECT alliance_id FROM alliances WHERE class_period = ? AND is_disbanded = 0', [period]);
  if (alliances.length === 0) return { olive: 10, grape: 10, iron: 10, grain: 10 };
  
  const allianceIds = alliances.map(a => a.alliance_id);
  const placeholders = allianceIds.map(() => '?').join(',');
  
  // Total in personal inventories for this period
  const personal = query(`SELECT SUM(sr.olive) as po, SUM(sr.grape) as pg, SUM(sr.iron) as pi, SUM(sr.grain) as pgr
    FROM student_resources sr JOIN students s ON sr.student_id = s.student_id
    WHERE s.alliance_id IN (${placeholders})`, allianceIds)[0];
  
  const totalHeld = {
    olive: personal?.po || 0,
    grape: personal?.pg || 0,
    iron: personal?.pi || 0,
    grain: personal?.pgr || 0
  };
  
  const totalAll = totalHeld.olive + totalHeld.grape + totalHeld.iron + totalHeld.grain;
  if (totalAll === 0) return { olive: 10, grape: 10, iron: 10, grain: 10 };
  
  const avg = totalAll / 4;
  const values = {};
  TRADE_RESOURCES.forEach(r => {
    const held = totalHeld[r];
    if (avg === 0) { values[r] = 10; return; }
    const ratio = held / avg;
    values[r] = Math.round(Math.max(5, Math.min(15, 10 / ratio)) * 10) / 10;
  });
  
  return values;
}

// --- Teacher: Assign native resources to alliances ---
app.post('/api/trade/assign-resources', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  try {
    const { period } = req.body;
    if (!period) return res.status(400).json({ error: 'Period required' });
    
    const alliances = query('SELECT alliance_id, alliance_name FROM alliances WHERE class_period = ? AND is_disbanded = 0', [period]);
    if (alliances.length === 0) return res.status(400).json({ error: 'No alliances found for this period' });
    
    const shuffled = [...TRADE_RESOURCES].sort(() => Math.random() - 0.5);
    const assignments = [];
    
    alliances.forEach((a, i) => {
      const resource = shuffled[i % shuffled.length];
      const existing = query('SELECT alliance_id FROM alliance_resources WHERE alliance_id = ?', [a.alliance_id])[0];
      if (existing) {
        run('UPDATE alliance_resources SET native_resource = ? WHERE alliance_id = ?', [resource, a.alliance_id]);
      } else {
        run('INSERT INTO alliance_resources (alliance_id, native_resource) VALUES (?, ?)', [a.alliance_id, resource]);
      }
      assignments.push({ alliance_id: a.alliance_id, alliance_name: a.alliance_name, native_resource: resource });
    });
    
    // Ensure trade window row exists
    const tw = query('SELECT period FROM trade_window WHERE period = ?', [period])[0];
    if (!tw) run('INSERT INTO trade_window (period, is_open) VALUES (?, 0)', [period]);
    
    // Ensure student_resources for all students in these alliances
    const studentIds = query('SELECT student_id FROM students WHERE alliance_id IN (' + alliances.map(() => '?').join(',') + ')', alliances.map(a => a.alliance_id));
    studentIds.forEach(s => ensureStudentResources(s.student_id));
    
    saveDatabase();
    res.json({ success: true, assignments, message: `Assigned resources to ${assignments.length} alliances in ${period} period` });
  } catch (err) {
    console.error('Assign resources error:', err);
    res.status(500).json({ error: 'Failed to assign resources' });
  }
});

// --- Teacher: Reassign a specific alliance's resource ---
app.post('/api/trade/reassign/:allianceId', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  try {
    const alliance_id = parseInt(req.params.allianceId);
    const { resource } = req.body;
    if (!TRADE_RESOURCES.includes(resource)) return res.status(400).json({ error: 'Invalid resource type' });
    
    const existing = query('SELECT alliance_id FROM alliance_resources WHERE alliance_id = ?', [alliance_id])[0];
    if (existing) {
      run('UPDATE alliance_resources SET native_resource = ? WHERE alliance_id = ?', [resource, alliance_id]);
    } else {
      run('INSERT INTO alliance_resources (alliance_id, native_resource) VALUES (?, ?)', [alliance_id, resource]);
    }
    
    saveDatabase();
    const alliance = query('SELECT alliance_name FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    res.json({ success: true, alliance_name: alliance?.alliance_name, native_resource: resource });
  } catch (err) {
    console.error('Reassign resource error:', err);
    res.status(500).json({ error: 'Failed to reassign resource' });
  }
});

// --- Teacher: Get resource assignments for all periods ---
app.get('/api/trade/assignments', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  try {
    const data = query(`
      SELECT a.alliance_id, a.alliance_name, a.class_period, a.total_points, a.buildings_owned,
             ar.native_resource
      FROM alliances a
      LEFT JOIN alliance_resources ar ON a.alliance_id = ar.alliance_id
      WHERE a.is_disbanded = 0
      ORDER BY a.class_period, a.alliance_name
    `);
    
    // Pull buildings from building_activations as authoritative source
    const activations = query(`
      SELECT alliance_id, building_name, COUNT(*) as count
      FROM building_activations
      GROUP BY alliance_id, building_name
    `);
    
    // Build a map of alliance_id -> [building names]
    const buildingsByAlliance = {};
    activations.forEach(ba => {
      if (!buildingsByAlliance[ba.alliance_id]) buildingsByAlliance[ba.alliance_id] = [];
      for (let i = 0; i < ba.count; i++) {
        buildingsByAlliance[ba.alliance_id].push(ba.building_name);
      }
    });
    
    // Attach to each alliance (prefer activations table over JSON column)
    data.forEach(a => {
      a.buildings_from_activations = buildingsByAlliance[a.alliance_id] || [];
    });
    
    const windows = query('SELECT * FROM trade_window');
    
    res.json({ alliances: data, trade_windows: windows });
  } catch (err) {
    console.error('Get assignments error:', err);
    res.status(500).json({ error: 'Failed to get assignments' });
  }
});

// --- Teacher: Open/Close trade window ---
app.post('/api/trade/window/:action', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  try {
    const { action } = req.params;
    const { period } = req.body;
    if (!period) return res.status(400).json({ error: 'Period required' });
    if (action !== 'open' && action !== 'close') return res.status(400).json({ error: 'Action must be open or close' });
    
    const existing = query('SELECT period FROM trade_window WHERE period = ?', [period])[0];
    if (existing) {
      if (action === 'open') {
        run('UPDATE trade_window SET is_open = 1, opened_at = CURRENT_TIMESTAMP, opened_by = ? WHERE period = ?', [req.user.id, period]);
      } else {
        run('UPDATE trade_window SET is_open = 0, closed_at = CURRENT_TIMESTAMP WHERE period = ?', [period]);
      }
    } else {
      run('INSERT INTO trade_window (period, is_open, opened_at, opened_by) VALUES (?, ?, CURRENT_TIMESTAMP, ?)', 
        [period, action === 'open' ? 1 : 0, req.user.id]);
    }
    
    saveDatabase();
    res.json({ success: true, period, is_open: action === 'open' });
  } catch (err) {
    console.error('Trade window error:', err);
    res.status(500).json({ error: 'Failed to update trade window' });
  }
});

// --- Teacher: Set resource threshold for a period ---
app.post('/api/trade/set-threshold', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  try {
    const { period, threshold } = req.body;
    if (!period || !threshold || threshold < 1) return res.status(400).json({ error: 'Valid period and threshold required' });
    
    const existing = query('SELECT period FROM trade_window WHERE period = ?', [period])[0];
    if (existing) {
      run('UPDATE trade_window SET resource_threshold = ? WHERE period = ?', [threshold, period]);
    } else {
      run('INSERT INTO trade_window (period, is_open, resource_threshold) VALUES (?, 0, ?)', [period, threshold]);
    }
    
    saveDatabase();
    res.json({ success: true, period, threshold });
  } catch (err) {
    console.error('Set threshold error:', err);
    res.status(500).json({ error: 'Failed to set threshold' });
  }
});

// --- Student: Get my trade data (inventory, spending cap, market) ---
app.get('/api/trade/my-data', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const student = query('SELECT student_id, name, class_period, alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    if (!student.alliance_id) return res.status(400).json({ error: 'You must be in an alliance' });
    
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [student.alliance_id])[0];
    const allianceRes = query('SELECT * FROM alliance_resources WHERE alliance_id = ?', [student.alliance_id])[0];
    if (!allianceRes) return res.json({ error: 'Trade system not yet set up for your alliance', not_assigned: true });
    
    // Personal inventory
    ensureStudentResources(student_id);
    const myResources = query('SELECT * FROM student_resources WHERE student_id = ?', [student_id])[0];
    
    // Spending cap
    const contribution = getStudentContribution(student_id);
    const alreadySpent = getStudentResourceSpending(student_id);
    const remainingCap = Math.max(0, contribution - alreadySpent);
    
    // Teammates
    const teammates = query(`
      SELECT s.student_id, s.name, sr.olive, sr.grape, sr.iron, sr.grain
      FROM students s
      LEFT JOIN student_resources sr ON s.student_id = sr.student_id
      WHERE s.alliance_id = ? AND s.student_id != ?
    `, [student.alliance_id, student_id]);
    
    // Trade window
    const window = query('SELECT * FROM trade_window WHERE period = ?', [student.class_period])[0];
    const threshold = getResourceThreshold(student.class_period);
    
    // Transport Ship check
    const ownedBuildings = JSON.parse(alliance.buildings_owned || '[]');
    const hasTransportShip = ownedBuildings.includes('Transport Ship');
    
    // Pending trades
    const pendingTrades = query(`
      SELECT t.*, 
             si.name as initiator_name, sp.name as partner_name
      FROM trades t
      JOIN students si ON t.initiator_id = si.student_id
      JOIN students sp ON t.partner_id = sp.student_id
      WHERE (t.initiator_id = ? OR t.partner_id = ?) AND t.status IN ('pending', 'flagged')
      ORDER BY t.created_at DESC
    `, [student_id, student_id]);
    
    // Market supply pool
    let marketSupply = { olive: 0, grape: 0, iron: 0, grain: 0 };
    try {
      const supplyRows = query('SELECT resource, amount FROM market_supply WHERE period = ?', [student.class_period]);
      supplyRows.forEach(s => { marketSupply[s.resource] = s.amount; });
    } catch(e) { /* table may not exist yet */ }
    
    // Recently completed trades (last 5 min) for celebration
    let recentCompleted = [];
    try {
      recentCompleted = query(`
        SELECT t.trade_id, t.give_resource, t.give_amount, t.receive_resource, t.receive_amount,
               t.initiator_id, t.partner_id,
               si.name as initiator_name, sp.name as partner_name
        FROM trades t
        JOIN students si ON t.initiator_id = si.student_id
        JOIN students sp ON t.partner_id = sp.student_id
        WHERE (t.initiator_id = ? OR t.partner_id = ?) AND t.status = 'completed'
          AND t.completed_at >= datetime('now', '-5 minutes')
        ORDER BY t.completed_at DESC
      `, [student_id, student_id]);
    } catch(e) { /* non-critical */ }
    
    res.json({
      student_id,
      class_period: student.class_period,
      alliance_id: student.alliance_id,
      alliance_name: alliance.alliance_name,
      alliance_points: alliance.total_points,
      native_resource: allianceRes.native_resource,
      my_resources: {
        olive: myResources.olive,
        grape: myResources.grape,
        iron: myResources.iron,
        grain: myResources.grain
      },
      spending: {
        contribution,
        already_spent: alreadySpent,
        remaining_cap: remainingCap,
        max_units: remainingCap * RESOURCE_BUY_RATE
      },
      teammates,
      trade_window_open: window ? window.is_open === 1 : false,
      has_transport_ship: hasTransportShip,
      resource_threshold: threshold,
      pending_trades: pendingTrades,
      recent_completed: recentCompleted,
      market_supply: marketSupply
    });
  } catch (err) {
    console.error('Trade my-data error:', err);
    res.status(500).json({ error: 'Failed to load trade data' });
  }
});

// --- Student: Buy native resource (direct to personal inventory) ---
app.post('/api/trade/buy', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { points_to_spend } = req.body;
    
    if (!points_to_spend || points_to_spend < 1) return res.status(400).json({ error: 'Must spend at least 1 point' });
    
    const student = query('SELECT alliance_id, class_period FROM students WHERE student_id = ?', [student_id])[0];
    if (!student?.alliance_id) return res.status(400).json({ error: 'Not in an alliance' });
    
    // Check trade window is open
    const tradeWindow = query('SELECT is_open FROM trade_window WHERE period = ?', [student.class_period])[0];
    if (!tradeWindow || tradeWindow.is_open !== 1) {
      return res.status(400).json({ error: 'The market is currently closed. Wait for Mr. Sebek to open trading.' });
    }
    
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [student.alliance_id])[0];
    if (alliance.total_points < points_to_spend) {
      return res.status(400).json({ error: `Alliance only has ${alliance.total_points} points` });
    }
    
    const allianceRes = query('SELECT native_resource FROM alliance_resources WHERE alliance_id = ?', [student.alliance_id])[0];
    if (!allianceRes) return res.status(400).json({ error: 'Trade system not set up for your alliance' });
    
    // Check spending cap
    const contribution = getStudentContribution(student_id);
    const alreadySpent = getStudentResourceSpending(student_id);
    const remainingCap = Math.max(0, contribution - alreadySpent);
    
    if (points_to_spend > remainingCap) {
      return res.status(400).json({ 
        error: `Spending cap: you've contributed ${contribution} pts and already spent ${alreadySpent} on resources. You can spend up to ${remainingCap} more.`
      });
    }
    
    const units = points_to_spend * RESOURCE_BUY_RATE;
    const resource = allianceRes.native_resource;
    
    // Deduct alliance points
    run('UPDATE alliances SET total_points = total_points - ? WHERE alliance_id = ?', [points_to_spend, student.alliance_id]);
    
    // Add to personal inventory
    ensureStudentResources(student_id);
    run(`UPDATE student_resources SET ${resource} = ${resource} + ? WHERE student_id = ?`, [units, student_id]);
    
    // Log the purchase
    run(`INSERT INTO resource_buys (student_id, alliance_id, resource_type, amount, points_spent)
         VALUES (?, ?, ?, ?, ?)`,
      [student_id, student.alliance_id, resource, units, points_to_spend]);
    
    // Log transaction
    run(`INSERT INTO point_transactions (alliance_id, student_id, amount, category, reason)
         VALUES (?, ?, ?, 'resource_purchase', ?)`,
      [student.alliance_id, student_id, -points_to_spend, `Bought ${units} ${TRADE_RESOURCE_LABELS[resource]} for ${points_to_spend} pts`]);
    
    saveDatabase();
    res.json({ 
      success: true, 
      resource,
      units,
      points_spent: points_to_spend,
      remaining_cap: remainingCap - points_to_spend,
      message: `Bought ${units} ${TRADE_RESOURCE_LABELS[resource]} for ${points_to_spend} alliance points`
    });
  } catch (err) {
    console.error('Buy resource error:', err);
    res.status(500).json({ error: 'Failed to buy resource' });
  }
});

// --- Student: Sell resources back (10 units = 1 pt, minus 10% fee) ---
app.post('/api/trade/sell', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { resource, amount } = req.body;
    
    if (!resource || !amount || amount < 1) return res.status(400).json({ error: 'Invalid resource or amount' });
    if (!['olive', 'grape', 'iron', 'grain'].includes(resource)) return res.status(400).json({ error: 'Invalid resource type' });
    
    const student = query('SELECT alliance_id, class_period FROM students WHERE student_id = ?', [student_id])[0];
    if (!student?.alliance_id) return res.status(400).json({ error: 'Not in an alliance' });
    
    const tradeWindow = query('SELECT is_open FROM trade_window WHERE period = ?', [student.class_period])[0];
    if (!tradeWindow || tradeWindow.is_open !== 1) {
      return res.status(400).json({ error: 'Market is currently closed' });
    }
    
    ensureStudentResources(student_id);
    const resources = query('SELECT * FROM student_resources WHERE student_id = ?', [student_id])[0];
    if (!resources || (resources[resource] || 0) < amount) {
      return res.status(400).json({ error: `You only have ${resources ? resources[resource] || 0 : 0} units of that resource` });
    }
    
    const grossPts = Math.floor(amount / 10);
    if (grossPts < 1) return res.status(400).json({ error: 'Must sell at least 10 units' });
    const fee = Math.ceil(grossPts * 0.10);
    const netPts = grossPts - fee;
    if (netPts < 1) return res.status(400).json({ error: 'Sale too small — fee exceeds value' });
    
    run(`UPDATE student_resources SET ${resource} = ${resource} - ? WHERE student_id = ?`, [amount, student_id]);
    run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', [netPts, student.alliance_id]);
    
    run(`INSERT INTO point_transactions (alliance_id, student_id, amount, category, reason)
         VALUES (?, ?, ?, 'resource_sale', ?)`,
      [student.alliance_id, student_id, netPts, `Sold ${amount} ${TRADE_RESOURCE_LABELS[resource] || resource} for ${netPts} pts (${fee} pt fee) — by ${req.user.name}`]);
    
    saveDatabase();
    res.json({
      success: true,
      message: `Sold ${amount} ${TRADE_RESOURCE_LABELS[resource] || resource}! ${netPts} points returned to alliance (${fee} pt market fee).`,
      net_points: netPts,
      fee
    });
  } catch (err) {
    console.error('Sell resource error:', err);
    res.status(500).json({ error: 'Failed to sell resource' });
  }
});

// --- Student: Get market data for their period ---
app.get('/api/trade/market', authenticateToken, (req, res) => {
  try {
    const student = query('SELECT class_period, alliance_id FROM students WHERE student_id = ?', [req.user.id])[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    
    const values = getMarketValues(student.class_period);
    const window = query('SELECT * FROM trade_window WHERE period = ?', [student.class_period])[0];
    const threshold = getResourceThreshold(student.class_period);
    
    // Tradeable partners (same period, different alliance, with resources assigned + their inventories)
    // Only include partners whose alliance has built a Transport Ship
    const partners = query(`
      SELECT s.student_id, s.name, a.alliance_name, ar.native_resource,
             COALESCE(sr.olive, 0) as olive, COALESCE(sr.grape, 0) as grape,
             COALESCE(sr.iron, 0) as iron, COALESCE(sr.grain, 0) as grain
      FROM students s
      JOIN alliances a ON s.alliance_id = a.alliance_id
      JOIN alliance_resources ar ON a.alliance_id = ar.alliance_id
      LEFT JOIN student_resources sr ON s.student_id = sr.student_id
      WHERE s.class_period = ? AND s.alliance_id != ? AND a.is_disbanded = 0
        AND a.buildings_owned LIKE '%Transport Ship%'
      ORDER BY a.alliance_name, s.name
    `, [student.class_period, student.alliance_id]);
    
    // Recent completed trades (last 20)
    const recentTrades = query(`
      SELECT t.*, si.name as initiator_name, sp.name as partner_name,
             ai.alliance_name as initiator_alliance, ap.alliance_name as partner_alliance
      FROM trades t
      JOIN students si ON t.initiator_id = si.student_id
      JOIN students sp ON t.partner_id = sp.student_id
      JOIN alliances ai ON si.alliance_id = ai.alliance_id
      JOIN alliances ap ON sp.alliance_id = ap.alliance_id
      WHERE t.period = ? AND t.status IN ('completed', 'approved')
      ORDER BY t.completed_at DESC LIMIT 20
    `, [student.class_period]);
    
    // Market supply pool
    let marketSupply = { olive: 0, grape: 0, iron: 0, grain: 0 };
    try {
      const supplyRows = query('SELECT resource, amount FROM market_supply WHERE period = ?', [student.class_period]);
      supplyRows.forEach(s => { marketSupply[s.resource] = s.amount; });
    } catch(e) {}
    
    res.json({
      market_values: values,
      trade_window_open: window ? window.is_open === 1 : false,
      resource_threshold: threshold,
      partners,
      recent_trades: recentTrades,
      market_supply: marketSupply
    });
  } catch (err) {
    console.error('Market data error:', err);
    res.status(500).json({ error: 'Failed to load market data' });
  }
});

// --- Student: Propose a trade ---
app.post('/api/trade/propose', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { partner_id, give_resource, give_amount, receive_resource, receive_amount } = req.body;
    
    if (!partner_id || !give_resource || !give_amount || !receive_resource || !receive_amount) {
      return res.status(400).json({ error: 'All trade fields required' });
    }
    if (!TRADE_RESOURCES.includes(give_resource) || !TRADE_RESOURCES.includes(receive_resource)) {
      return res.status(400).json({ error: 'Invalid resource type' });
    }
    if (give_amount < 1 || receive_amount < 1) return res.status(400).json({ error: 'Amounts must be positive' });
    if (give_resource === receive_resource) return res.status(400).json({ error: 'Cannot trade same resource' });
    if (partner_id === student_id) return res.status(400).json({ error: 'Cannot trade with yourself' });
    
    const initiator = query('SELECT student_id, class_period, alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    const partner = query('SELECT student_id, class_period, alliance_id FROM students WHERE student_id = ?', [partner_id])[0];
    if (!initiator || !partner) return res.status(404).json({ error: 'Student not found' });
    if (initiator.class_period !== partner.class_period) return res.status(400).json({ error: 'Must be in the same period' });
    if (initiator.alliance_id === partner.alliance_id) return res.status(400).json({ error: 'Cannot trade within your own alliance' });
    
    // Check trade window
    const window = query('SELECT is_open FROM trade_window WHERE period = ?', [initiator.class_period])[0];
    if (!window || window.is_open !== 1) return res.status(400).json({ error: 'Trade window is closed' });
    
    // Check Transport Ship
    const alliance = query('SELECT buildings_owned FROM alliances WHERE alliance_id = ?', [initiator.alliance_id])[0];
    const owned = JSON.parse(alliance?.buildings_owned || '[]');
    if (!owned.includes('Transport Ship')) return res.status(400).json({ error: 'Your alliance needs a Transport Ship to trade' });
    
    // Check initiator has enough
    ensureStudentResources(student_id);
    const myRes = query('SELECT * FROM student_resources WHERE student_id = ?', [student_id])[0];
    if (myRes[give_resource] < give_amount) {
      return res.status(400).json({ error: `You only have ${myRes[give_resource]} ${TRADE_RESOURCE_LABELS[give_resource]}` });
    }
    
    // Auto-flag 3:1 ratio
    const ratio = Math.max(give_amount / receive_amount, receive_amount / give_amount);
    const flagged = ratio > 3 ? 1 : 0;
    const status = flagged ? 'flagged' : 'pending';
    
    run(`INSERT INTO trades (period, initiator_id, partner_id, give_resource, give_amount, receive_resource, receive_amount, status, flagged, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [initiator.class_period, student_id, partner_id, give_resource, give_amount, receive_resource, receive_amount, status, flagged]);
    
    const tradeId = query('SELECT last_insert_rowid() as id')[0].id;
    saveDatabase();
    
    if (flagged) {
      res.json({ success: true, trade_id: tradeId, status: 'flagged', message: 'Trade flagged for teacher review (ratio exceeds 3:1)' });
    } else {
      res.json({ success: true, trade_id: tradeId, status: 'pending', message: 'Trade proposed! Waiting for partner to confirm.' });
    }
  } catch (err) {
    console.error('Propose trade error:', err);
    res.status(500).json({ error: 'Failed to propose trade' });
  }
});

// --- Student: Confirm a trade ---
app.post('/api/trade/confirm/:tradeId', authenticateToken, (req, res) => {
  try {
    const trade_id = parseInt(req.params.tradeId);
    const student_id = req.user.id;
    
    const trade = query("SELECT * FROM trades WHERE trade_id = ? AND status = 'pending'", [trade_id])[0];
    if (!trade) return res.status(404).json({ error: 'Trade not found or not pending' });
    if (trade.partner_id !== student_id) return res.status(403).json({ error: 'Only the trade partner can confirm' });
    
    // Verify partner has enough
    ensureStudentResources(student_id);
    const partnerRes = query('SELECT * FROM student_resources WHERE student_id = ?', [student_id])[0];
    if (partnerRes[trade.receive_resource] < trade.receive_amount) {
      return res.status(400).json({ error: `You only have ${partnerRes[trade.receive_resource]} ${TRADE_RESOURCE_LABELS[trade.receive_resource]}` });
    }
    
    // Re-verify initiator
    const initiatorRes = query('SELECT * FROM student_resources WHERE student_id = ?', [trade.initiator_id])[0];
    if (initiatorRes[trade.give_resource] < trade.give_amount) {
      run("UPDATE trades SET status = 'rejected' WHERE trade_id = ?", [trade_id]);
      saveDatabase();
      return res.status(400).json({ error: 'Initiator no longer has enough resources. Trade cancelled.' });
    }
    
    // Execute trade
    run(`UPDATE student_resources SET ${trade.give_resource} = ${trade.give_resource} - ? WHERE student_id = ?`, [trade.give_amount, trade.initiator_id]);
    run(`UPDATE student_resources SET ${trade.give_resource} = ${trade.give_resource} + ? WHERE student_id = ?`, [trade.give_amount, trade.partner_id]);
    run(`UPDATE student_resources SET ${trade.receive_resource} = ${trade.receive_resource} - ? WHERE student_id = ?`, [trade.receive_amount, trade.partner_id]);
    run(`UPDATE student_resources SET ${trade.receive_resource} = ${trade.receive_resource} + ? WHERE student_id = ?`, [trade.receive_amount, trade.initiator_id]);
    
    run("UPDATE trades SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE trade_id = ?", [trade_id]);
    saveDatabase();
    res.json({ success: true, message: 'Trade completed!' });
  } catch (err) {
    console.error('Confirm trade error:', err);
    res.status(500).json({ error: 'Failed to confirm trade' });
  }
});

// --- Student: Reject a trade ---
app.post('/api/trade/reject/:tradeId', authenticateToken, (req, res) => {
  try {
    const trade_id = parseInt(req.params.tradeId);
    const student_id = req.user.id;
    
    const trade = query("SELECT * FROM trades WHERE trade_id = ? AND status = 'pending'", [trade_id])[0];
    if (!trade) return res.status(404).json({ error: 'Trade not found or not pending' });
    if (trade.partner_id !== student_id && trade.initiator_id !== student_id) {
      return res.status(403).json({ error: 'Not involved in this trade' });
    }
    
    run("UPDATE trades SET status = 'rejected' WHERE trade_id = ?", [trade_id]);
    saveDatabase();
    res.json({ success: true, message: 'Trade rejected' });
  } catch (err) {
    console.error('Reject trade error:', err);
    res.status(500).json({ error: 'Failed to reject trade' });
  }
});

// --- Teacher: Get flagged trades ---
app.get('/api/trade/flagged', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  try {
    const flagged = query(`
      SELECT t.*, si.name as initiator_name, sp.name as partner_name,
             si.class_period,
             ai.alliance_name as initiator_alliance, ap.alliance_name as partner_alliance
      FROM trades t
      JOIN students si ON t.initiator_id = si.student_id
      JOIN students sp ON t.partner_id = sp.student_id
      JOIN alliances ai ON si.alliance_id = ai.alliance_id
      JOIN alliances ap ON sp.alliance_id = ap.alliance_id
      WHERE t.status = 'flagged'
      ORDER BY t.created_at DESC
    `);
    res.json({ flagged });
  } catch (err) {
    console.error('Flagged trades error:', err);
    res.status(500).json({ error: 'Failed to get flagged trades' });
  }
});

// --- Teacher: Approve a flagged trade ---
app.post('/api/trade/flagged/:tradeId/approve', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  try {
    const trade_id = parseInt(req.params.tradeId);
    const trade = query("SELECT * FROM trades WHERE trade_id = ? AND status = 'flagged'", [trade_id])[0];
    if (!trade) return res.status(404).json({ error: 'Flagged trade not found' });
    
    // Teacher approval moves the trade to 'pending' so the partner can accept/decline/counter
    // This prevents forcing students into trades they don't want
    run("UPDATE trades SET status = 'pending', flagged = 0 WHERE trade_id = ?", [trade_id]);
    saveDatabase();
    
    const initiator = query('SELECT name FROM students WHERE student_id = ?', [trade.initiator_id])[0];
    const partner = query('SELECT name FROM students WHERE student_id = ?', [trade.partner_id])[0];
    res.json({ success: true, message: `Trade approved for negotiation. ${partner?.name || 'Partner'} can now accept, counter, or decline.` });
  } catch (err) {
    console.error('Approve flagged error:', err);
    res.status(500).json({ error: 'Failed to approve trade' });
  }
});

// --- Teacher: Reject a flagged trade ---
app.post('/api/trade/flagged/:tradeId/reject', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  try {
    const trade_id = parseInt(req.params.tradeId);
    const trade = query("SELECT * FROM trades WHERE trade_id = ? AND status = 'flagged'", [trade_id])[0];
    if (!trade) return res.status(404).json({ error: 'Flagged trade not found' });
    
    run("UPDATE trades SET status = 'rejected' WHERE trade_id = ?", [trade_id]);
    saveDatabase();
    res.json({ success: true, message: 'Flagged trade rejected' });
  } catch (err) {
    console.error('Reject flagged error:', err);
    res.status(500).json({ error: 'Failed to reject trade' });
  }
});

// --- Teacher: Get trade overview for a period ---
app.get('/api/trade/overview/:period', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  try {
    const period = req.params.period;
    const values = getMarketValues(period);
    const window = query('SELECT * FROM trade_window WHERE period = ?', [period])[0];
    const threshold = getResourceThreshold(period);
    
    const allianceSummaries = query(`
      SELECT a.alliance_id, a.alliance_name, a.total_points,
             ar.native_resource
      FROM alliances a
      JOIN alliance_resources ar ON a.alliance_id = ar.alliance_id
      WHERE a.class_period = ? AND a.is_disbanded = 0
      ORDER BY a.alliance_name
    `, [period]);
    
    const studentInventories = query(`
      SELECT s.student_id, s.name, s.alliance_id, a.alliance_name,
             sr.olive, sr.grape, sr.iron, sr.grain
      FROM students s
      JOIN alliances a ON s.alliance_id = a.alliance_id
      LEFT JOIN student_resources sr ON s.student_id = sr.student_id
      WHERE s.class_period = ? AND a.is_disbanded = 0
      ORDER BY a.alliance_name, s.name
    `, [period]);
    
    const tradeCounts = query(`
      SELECT COUNT(*) as total,
             SUM(CASE WHEN status = 'completed' OR status = 'approved' THEN 1 ELSE 0 END) as completed,
             SUM(CASE WHEN status = 'flagged' THEN 1 ELSE 0 END) as flagged,
             SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
      FROM trades WHERE period = ?
    `, [period])[0];
    
    // Market supply pool
    let marketSupply = { olive: 0, grape: 0, iron: 0, grain: 0 };
    try {
      const supplyRows = query('SELECT resource, amount FROM market_supply WHERE period = ?', [period]);
      supplyRows.forEach(s => { marketSupply[s.resource] = s.amount; });
    } catch(e) {}
    
    // Identify missing resources (no alliance produces them)
    const periodResources = query(`SELECT ar.native_resource FROM alliance_resources ar 
      JOIN alliances a ON ar.alliance_id = a.alliance_id 
      WHERE a.class_period = ? AND a.is_disbanded = 0`, [period]);
    const producedResources = [...new Set(periodResources.map(r => r.native_resource))];
    const missingResources = TRADE_RESOURCES.filter(r => !producedResources.includes(r));
    
    // Auction data — wrapped safely
    let activeAuctions = [];
    let recentAuctions = [];
    try {
      if (typeof resolveExpiredAuctions === 'function') resolveExpiredAuctions(period);
      activeAuctions = query(`
        SELECT ma.*, COUNT(mb.bid_id) as bid_count, MAX(mb.ratio) as best_ratio
        FROM market_auctions ma
        LEFT JOIN market_bids mb ON ma.auction_id = mb.auction_id
        WHERE ma.period = ? AND ma.status = 'active'
        GROUP BY ma.auction_id
      `, [period]);
      recentAuctions = query(`
        SELECT ma.*, COUNT(mb.bid_id) as bid_count,
               mt.student_id as winner_id, s.name as winner_name,
               mt.student_gave_resource, mt.student_gave_amount,
               mt.student_received_resource, mt.student_received_amount
        FROM market_auctions ma
        LEFT JOIN market_bids mb ON ma.auction_id = mb.auction_id
        LEFT JOIN market_trades mt ON ma.auction_id = mt.auction_id
        LEFT JOIN students s ON mt.student_id = s.student_id
        WHERE ma.period = ? AND ma.status IN ('completed','expired')
        GROUP BY ma.auction_id ORDER BY ma.resolved_at DESC LIMIT 10
      `, [period]);
    } catch (auctionErr) {
      console.error('Auction query error (non-fatal):', auctionErr.message);
    }
    
    res.json({
      period,
      market_values: values,
      trade_window: window || { is_open: 0 },
      resource_threshold: threshold,
      alliances: allianceSummaries,
      students: studentInventories,
      trade_counts: tradeCounts,
      market_supply: marketSupply,
      missing_resources: missingResources,
      active_auctions: activeAuctions,
      recent_auctions: recentAuctions
    });
  } catch (err) {
    console.error('Trade overview error:', err);
    res.status(500).json({ error: 'Failed to get trade overview' });
  }
});

// ==================== SHARED RESOURCE MARKET — AUCTION SYSTEM ====================

app.get('/api/trade/supply/:period', authenticateToken, (req, res) => {
  try {
    const period = req.params.period;
    const supply = query('SELECT resource, amount FROM market_supply WHERE period = ?', [period]);
    const result = { olive: 0, grape: 0, iron: 0, grain: 0 };
    supply.forEach(s => { result[s.resource] = s.amount; });
    res.json({ period, supply: result });
  } catch (err) {
    console.error('Get supply error:', err);
    res.status(500).json({ error: 'Failed to get market supply' });
  }
});

// --- Teacher: Inject resources into period market supply pool ---
app.post('/api/trade/inject-supply', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  try {
    const { period, resource, amount } = req.body;
    if (!period || !resource || !amount) return res.status(400).json({ error: 'Period, resource, and amount required' });
    if (!TRADE_RESOURCES.includes(resource)) return res.status(400).json({ error: 'Invalid resource type' });
    if (amount < 1 || amount > 9999) return res.status(400).json({ error: 'Amount must be 1-9999' });
    
    const existing = query('SELECT amount FROM market_supply WHERE period = ? AND resource = ?', [period, resource])[0];
    if (existing) {
      run('UPDATE market_supply SET amount = amount + ? WHERE period = ? AND resource = ?', [amount, period, resource]);
    } else {
      run('INSERT INTO market_supply (period, resource, amount) VALUES (?, ?, ?)', [period, resource, amount]);
    }
    
    const newAmount = query('SELECT amount FROM market_supply WHERE period = ? AND resource = ?', [period, resource])[0];
    saveDatabase();
    res.json({ success: true, message: `Added ${amount} ${TRADE_RESOURCE_LABELS[resource]} to ${period} period market`, new_total: newAmount.amount });
  } catch (err) {
    console.error('Inject supply error:', err);
    res.status(500).json({ error: 'Failed to inject supply' });
  }
});

// --- Student: Buy from market supply pool ---
// ==================== SHARED RESOURCE MARKET — AUCTION SYSTEM ====================
// Flow: Teacher stocks supply → Student places bid → 60s auction window → Best ratio wins
// Ratio = offer_amount / request_amount (higher = better deal for market = wins)
// 5% minimum improvement over current best bid. Snipe protection resets to 30s.

const AUCTION_DURATION_MS = 60000;  // 60 seconds
const SNIPE_WINDOW_MS = 30000;      // last 30 seconds triggers extension
const SNIPE_RESET_MS = 30000;       // reset to 30 seconds on snipe
const MIN_BID_IMPROVEMENT = 0.05;   // 5% minimum ratio improvement
const MAX_RESOURCES_PER_SIDE = 130; // max per trade side
const MIN_RATIO = 1.0;             // 1:1 floor

// Auto-resolve any expired auctions for a period
function resolveExpiredAuctions(period) {
  try {
  const now = new Date().toISOString();
  const expired = query(
    "SELECT * FROM market_auctions WHERE period = ? AND status = 'active' AND ends_at <= ?",
    [period, now]
  );
  
  expired.forEach(auction => {
    // Find best bid (highest ratio)
    const bestBid = query(
      'SELECT mb.*, s.name as student_name FROM market_bids mb JOIN students s ON mb.student_id = s.student_id WHERE mb.auction_id = ? ORDER BY mb.ratio DESC, mb.created_at ASC LIMIT 1',
      [auction.auction_id]
    )[0];
    
    if (!bestBid) {
      // No bids — auction expires with no winner
      run("UPDATE market_auctions SET status = 'expired', resolved_at = ? WHERE auction_id = ?",
        [now, auction.auction_id]);
      return;
    }
    
    // Check student still has the resources they bid
    ensureStudentResources(bestBid.student_id);
    const studentRes = query('SELECT * FROM student_resources WHERE student_id = ?', [bestBid.student_id])[0];
    if (!studentRes || (studentRes[bestBid.offer_resource] || 0) < bestBid.offer_amount) {
      // Winner can't cover their bid — expire auction
      run("UPDATE market_auctions SET status = 'expired', resolved_at = ? WHERE auction_id = ?",
        [now, auction.auction_id]);
      return;
    }
    
    // Check market supply still has enough
    const supply = query('SELECT amount FROM market_supply WHERE period = ? AND resource = ?',
      [period, auction.resource])[0];
    if (!supply || supply.amount < bestBid.request_amount) {
      run("UPDATE market_auctions SET status = 'expired', resolved_at = ? WHERE auction_id = ?",
        [now, auction.auction_id]);
      return;
    }
    
    // Execute trade: deduct student's offer, give market resource, deduct supply
    run(`UPDATE student_resources SET ${bestBid.offer_resource} = ${bestBid.offer_resource} - ? WHERE student_id = ?`,
      [bestBid.offer_amount, bestBid.student_id]);
    run(`UPDATE student_resources SET ${auction.resource} = ${auction.resource} + ? WHERE student_id = ?`,
      [bestBid.request_amount, bestBid.student_id]);
    run('UPDATE market_supply SET amount = amount - ? WHERE period = ? AND resource = ?',
      [bestBid.request_amount, period, auction.resource]);
    
    // Record the trade
    run(`INSERT INTO market_trades (auction_id, student_id, student_gave_resource, student_gave_amount, student_received_resource, student_received_amount, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [auction.auction_id, bestBid.student_id, bestBid.offer_resource, bestBid.offer_amount, auction.resource, bestBid.request_amount, now]);
    
    // Mark auction resolved
    run("UPDATE market_auctions SET status = 'completed', resolved_at = ?, winner_bid_id = ? WHERE auction_id = ?",
      [now, bestBid.bid_id, auction.auction_id]);
    
    saveDatabase();
    console.log(`🏪 Auction ${auction.auction_id} resolved: ${bestBid.student_name} won ${bestBid.request_amount} ${auction.resource} for ${bestBid.offer_amount} ${bestBid.offer_resource}`);
  });
  } catch (err) {
    console.error('resolveExpiredAuctions error (non-fatal):', err.message);
  }
}

// --- Get active + recent auctions for a period ---
app.get('/api/trade/market/auctions/:period', authenticateToken, (req, res) => {
  try {
    const period = req.params.period;
    
    // Auto-resolve any expired auctions first
    resolveExpiredAuctions(period);
    
    // Get active auctions with bid counts and best ratio
    const active = query(`
      SELECT ma.*, 
             COUNT(mb.bid_id) as bid_count,
             MAX(mb.ratio) as best_ratio
      FROM market_auctions ma
      LEFT JOIN market_bids mb ON ma.auction_id = mb.auction_id
      WHERE ma.period = ? AND ma.status = 'active'
      GROUP BY ma.auction_id
      ORDER BY ma.ends_at ASC
    `, [period]);
    
    // Get recent completed/expired auctions (last 20)
    const recent = query(`
      SELECT ma.*, 
             COUNT(mb.bid_id) as bid_count,
             MAX(mb.ratio) as best_ratio,
             mt.student_id as winner_id, s.name as winner_name,
             mt.student_gave_resource, mt.student_gave_amount,
             mt.student_received_resource, mt.student_received_amount
      FROM market_auctions ma
      LEFT JOIN market_bids mb ON ma.auction_id = mb.auction_id
      LEFT JOIN market_trades mt ON ma.auction_id = mt.auction_id
      LEFT JOIN students s ON mt.student_id = s.student_id
      WHERE ma.period = ? AND ma.status IN ('completed', 'expired')
      GROUP BY ma.auction_id
      ORDER BY ma.resolved_at DESC LIMIT 20
    `, [period]);
    
    // Get supply levels
    const supplyRows = query('SELECT resource, amount FROM market_supply WHERE period = ?', [period]);
    const supply = { olive: 0, grape: 0, iron: 0, grain: 0 };
    supplyRows.forEach(s => { supply[s.resource] = s.amount; });
    
    res.json({ active, recent, supply });
  } catch (err) {
    console.error('Get auctions error:', err);
    res.status(500).json({ error: 'Failed to get auctions' });
  }
});

// --- Student: Place a bid on the market ---
app.post('/api/trade/market/bid', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { resource_wanted, request_amount, offer_resource, offer_amount } = req.body;
    
    // Validate inputs
    if (!resource_wanted || !offer_resource || !request_amount || !offer_amount) {
      return res.status(400).json({ error: 'All bid fields required' });
    }
    if (!TRADE_RESOURCES.includes(resource_wanted) || !TRADE_RESOURCES.includes(offer_resource)) {
      return res.status(400).json({ error: 'Invalid resource type' });
    }
    if (resource_wanted === offer_resource) {
      return res.status(400).json({ error: 'Cannot offer the same resource you want' });
    }
    if (request_amount < 1 || offer_amount < 1) return res.status(400).json({ error: 'Amounts must be positive' });
    if (request_amount > MAX_RESOURCES_PER_SIDE || offer_amount > MAX_RESOURCES_PER_SIDE) {
      return res.status(400).json({ error: `Maximum ${MAX_RESOURCES_PER_SIDE} resources per side` });
    }
    
    // Ratio check (1:1 minimum floor)
    const ratio = offer_amount / request_amount;
    if (ratio < MIN_RATIO) {
      return res.status(400).json({ error: 'You must offer at least as much as you are requesting (1:1 minimum)' });
    }
    
    const student = query('SELECT alliance_id, class_period FROM students WHERE student_id = ?', [student_id])[0];
    if (!student?.alliance_id) return res.status(400).json({ error: 'Not in an alliance' });
    
    const period = student.class_period;
    
    // Check trade window is open
    const tradeWindow = query('SELECT is_open FROM trade_window WHERE period = ?', [period])[0];
    if (!tradeWindow || tradeWindow.is_open !== 1) {
      return res.status(400).json({ error: 'The market is currently closed' });
    }
    
    // Check Transport Ship
    const alliance = query('SELECT buildings_owned FROM alliances WHERE alliance_id = ?', [student.alliance_id])[0];
    const owned = JSON.parse(alliance?.buildings_owned || '[]');
    if (!owned.includes('Transport Ship')) {
      return res.status(400).json({ error: 'Your alliance needs a Transport Ship to use the market' });
    }
    
    // Check student has enough of their offer resource
    ensureStudentResources(student_id);
    const myRes = query('SELECT * FROM student_resources WHERE student_id = ?', [student_id])[0];
    if ((myRes[offer_resource] || 0) < offer_amount) {
      return res.status(400).json({ error: `You only have ${myRes[offer_resource] || 0} ${TRADE_RESOURCE_LABELS[offer_resource]}` });
    }
    
    // Auto-resolve expired auctions first
    resolveExpiredAuctions(period);
    
    // Check supply has enough for this request
    const supply = query('SELECT amount FROM market_supply WHERE period = ? AND resource = ?', [period, resource_wanted])[0];
    if (!supply || supply.amount < request_amount) {
      const avail = supply ? supply.amount : 0;
      return res.status(400).json({ error: `Only ${avail} ${TRADE_RESOURCE_LABELS[resource_wanted]} available in market` });
    }
    
    // Find or create active auction for this resource in this period
    let auction = query(
      "SELECT * FROM market_auctions WHERE period = ? AND resource = ? AND status = 'active'",
      [period, resource_wanted]
    )[0];
    
    const now = new Date();
    
    if (!auction) {
      // Create new auction — 60 second window
      const endsAt = new Date(now.getTime() + AUCTION_DURATION_MS).toISOString();
      run(`INSERT INTO market_auctions (period, resource, amount, status, started_at, ends_at)
           VALUES (?, ?, ?, 'active', ?, ?)`,
        [period, resource_wanted, request_amount, now.toISOString(), endsAt]);
      const auctionId = query('SELECT last_insert_rowid() as id')[0].id;
      auction = query('SELECT * FROM market_auctions WHERE auction_id = ?', [auctionId])[0];
    } else {
      // Auction exists — check 5% improvement requirement
      const bestBid = query(
        'SELECT MAX(ratio) as best_ratio FROM market_bids WHERE auction_id = ?',
        [auction.auction_id]
      )[0];
      
      if (bestBid && bestBid.best_ratio) {
        const requiredRatio = bestBid.best_ratio * (1 + MIN_BID_IMPROVEMENT);
        if (ratio < requiredRatio) {
          return res.status(400).json({ 
            error: `Your offer ratio (${ratio.toFixed(2)}) must beat the current best (${bestBid.best_ratio.toFixed(2)}) by at least 5%. Need ${requiredRatio.toFixed(2)} or higher.`
          });
        }
      }
      
      // Snipe protection: if within last 30 seconds, extend timer
      const endsAt = new Date(auction.ends_at);
      const timeLeft = endsAt.getTime() - now.getTime();
      if (timeLeft < SNIPE_WINDOW_MS && timeLeft > 0) {
        const newEndsAt = new Date(now.getTime() + SNIPE_RESET_MS).toISOString();
        run('UPDATE market_auctions SET ends_at = ? WHERE auction_id = ?', [newEndsAt, auction.auction_id]);
        auction.ends_at = newEndsAt;
      }
    }
    
    // Insert the bid
    run(`INSERT INTO market_bids (auction_id, student_id, offer_resource, offer_amount, request_amount, ratio, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [auction.auction_id, student_id, offer_resource, offer_amount, request_amount, ratio, now.toISOString()]);
    
    saveDatabase();
    
    const endsAt = new Date(auction.ends_at);
    const secsLeft = Math.max(0, Math.ceil((endsAt.getTime() - Date.now()) / 1000));
    
    res.json({
      success: true,
      auction_id: auction.auction_id,
      your_ratio: ratio,
      seconds_remaining: secsLeft,
      message: `Bid placed! Offering ${offer_amount} ${TRADE_RESOURCE_LABELS[offer_resource]} for ${request_amount} ${TRADE_RESOURCE_LABELS[resource_wanted]}. Ratio: ${ratio.toFixed(2)}. ${secsLeft}s remaining.`
    });
  } catch (err) {
    console.error('Market bid error:', err);
    res.status(500).json({ error: 'Failed to place bid' });
  }
});

// --- Teacher: Diagnose market auction state for a period ---
app.get('/api/trade/market/diagnose/:period', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher' && req.user.role !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  try {
    const period = req.params.period;

    // First: check actual table schemas
    let bidsCols = [], auctionsCols = [], tradesCols = [], supplyCols = [];
    try { bidsCols = query("PRAGMA table_info(market_bids)").map(c => c.name); } catch(e) { bidsCols = ['TABLE_MISSING']; }
    try { auctionsCols = query("PRAGMA table_info(market_auctions)").map(c => c.name); } catch(e) { auctionsCols = ['TABLE_MISSING']; }
    try { tradesCols = query("PRAGMA table_info(market_trades)").map(c => c.name); } catch(e) { tradesCols = ['TABLE_MISSING']; }
    try { supplyCols = query("PRAGMA table_info(market_supply)").map(c => c.name); } catch(e) { supplyCols = ['TABLE_MISSING']; }

    // Check for schema mismatch
    const expectedBidsCols = ['bid_id','auction_id','student_id','offer_resource','offer_amount','request_amount','ratio','created_at'];
    const bidsMismatch = !expectedBidsCols.every(c => bidsCols.includes(c));

    let supply = [], tradeWindow = [];
    try { supply = query('SELECT * FROM market_supply WHERE period = ?', [period]); } catch(e) {}
    try { tradeWindow = query('SELECT * FROM trade_window WHERE period = ?', [period]); } catch(e) {}

    // Only query auctions/bids if schema is correct
    let allAuctions = [], allBids = [], recentTrades = [];
    if (!bidsMismatch) {
      try { allAuctions = query('SELECT * FROM market_auctions WHERE period = ? ORDER BY auction_id DESC LIMIT 50', [period]); } catch(e) {}
      try { allBids = query('SELECT mb.*, s.name as student_name FROM market_bids mb JOIN students s ON mb.student_id = s.student_id WHERE mb.auction_id IN (SELECT auction_id FROM market_auctions WHERE period = ?) ORDER BY mb.bid_id DESC LIMIT 100', [period]); } catch(e) {}
      try { recentTrades = query('SELECT mt.*, s.name as winner_name FROM market_trades mt JOIN students s ON mt.student_id = s.student_id WHERE mt.auction_id IN (SELECT auction_id FROM market_auctions WHERE period = ?) ORDER BY mt.completed_at DESC LIMIT 20', [period]); } catch(e) {}
    }

    res.json({
      period,
      schema_check: {
        market_bids_columns: bidsCols,
        market_auctions_columns: auctionsCols,
        market_trades_columns: tradesCols,
        market_supply_columns: supplyCols,
        bids_schema_correct: !bidsMismatch,
        expected_bids_cols: expectedBidsCols
      },
      supply,
      trade_window: tradeWindow,
      all_auctions: allAuctions,
      all_bids: allBids,
      recent_trades: recentTrades
    });
  } catch (err) {
    console.error('Market diagnose error:', err);
    res.status(500).json({ error: 'Diagnose failed: ' + err.message });
  }
});

// --- Student: Get my bids on active auctions ---
app.get('/api/trade/market/my-bids', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const bids = query(`
      SELECT mb.*, ma.resource, ma.status as auction_status, ma.ends_at
      FROM market_bids mb
      JOIN market_auctions ma ON mb.auction_id = ma.auction_id
      WHERE mb.student_id = ? AND ma.status = 'active'
      ORDER BY mb.created_at DESC
    `, [student_id]);
    res.json({ bids });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get bids' });
  }
});


// Start server
// --- Admin: Diagnose and repair buildings_owned from building_activations ---
// ================================================================
// ONE-TIME MIGRATION: Fix quiz grades to best score across all students
// POST /api/admin/fix-quiz-best-scores?dry_run=true  (preview)
// POST /api/admin/fix-quiz-best-scores               (apply fixes)
// ================================================================
app.post('/api/admin/fix-quiz-best-scores', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  try {
    const dryRun = req.query.dry_run === 'true';
    const report = [];
    let fixCount = 0;

    // ── Portal myth_name → assignments_ref myth_god mapping ──
    const mythGodMap = {
      'Pandora':          'Pandora',
      'Phaethon':         'Phaethon',
      'Orpheus & Eurydice': 'Orpheus',
      'Echo & Narcissus': 'Echo and Narcissus',
      'Icarus & Daedalus': 'Icarus',
      'Eros & Psyche':    'Eros and Psyche',
      'Constellations':   'Constellations'
    };

    const portals = query('SELECT portal_id, myth_name FROM myth_portals ORDER BY portal_id');
    const students = query('SELECT student_id, name FROM students');

    students.forEach(student => {
      portals.forEach(portal => {
        const mythGod = mythGodMap[portal.myth_name] || portal.myth_name;

        // Find the quiz assignment record for this myth
        const quizAssignment = query(
          "SELECT assignment_id, max_points FROM assignments_ref WHERE section = 'classical' AND assignment_type = 'quiz' AND myth_god = ?",
          [mythGod]
        )[0];
        if (!quizAssignment) return;

        // Get the student's best passing attempt percentage for this portal
        const bestAttempt = query(
          `SELECT MAX(percentage) as best_pct, MAX(score) as best_score, MAX(total_questions) as total_q
           FROM myth_quiz_attempts
           WHERE student_id = ? AND portal_id = ? AND passed = 1`,
          [student.student_id, portal.portal_id]
        )[0];

        if (!bestAttempt || bestAttempt.best_pct === null) return; // never passed

        const bestPointsEarned = Math.round((bestAttempt.best_score / bestAttempt.total_q) * quizAssignment.max_points);

        // Check existing grade record
        const existingGrade = query(
          'SELECT record_id, points_earned FROM grade_records WHERE student_id = ? AND assignment_id = ?',
          [student.student_id, quizAssignment.assignment_id]
        )[0];

        if (!existingGrade) {
          // No grade recorded at all despite a passing attempt — insert it
          report.push({
            student: student.name,
            myth: portal.myth_name,
            action: 'INSERT',
            old_points: null,
            new_points: bestPointsEarned,
            max_points: quizAssignment.max_points
          });
          if (!dryRun) {
            run(
              'INSERT INTO grade_records (student_id, assignment_id, points_earned, points_possible) VALUES (?, ?, ?, ?)',
              [student.student_id, quizAssignment.assignment_id, bestPointsEarned, quizAssignment.max_points]
            );
          }
          fixCount++;
        } else if (bestPointsEarned > existingGrade.points_earned) {
          // Grade exists but best attempt is higher — update it
          report.push({
            student: student.name,
            myth: portal.myth_name,
            action: 'UPDATE',
            old_points: existingGrade.points_earned,
            new_points: bestPointsEarned,
            max_points: quizAssignment.max_points
          });
          if (!dryRun) {
            run(
              'UPDATE grade_records SET points_earned = ? WHERE record_id = ?',
              [bestPointsEarned, existingGrade.record_id]
            );
          }
          fixCount++;
        }
      });
    });

    // ── Fix passed=0 in myth_quiz_attempts for Daedalus (portal 5) ──
    // Students who completed the game but whose attempts were all recorded as passed=0
    // (due to first-attempt scoring < 80%) should have passed=1 if they ever completed the game
    let passFixes = 0;
    const passFixReport = [];

    // Portal 5: Daedalus — any student with a completed daedalus_game_results entry
    const daedalusCompletions = query(
      'SELECT DISTINCT student_id FROM daedalus_game_results WHERE completed = 1'
    );
    daedalusCompletions.forEach(row => {
      const hasPassed = query(
        'SELECT 1 FROM myth_quiz_attempts WHERE student_id = ? AND portal_id = 5 AND passed = 1 LIMIT 1',
        [row.student_id]
      )[0];
      if (!hasPassed) {
        const student = students.find(s => s.student_id === row.student_id);
        passFixReport.push({ student: student ? student.name : row.student_id, portal: 'Icarus & Daedalus', action: 'SET passed=1' });
        if (!dryRun) {
          // Insert a passed=1 record so the side quest unlock check finds it
          run(
            `INSERT INTO myth_quiz_attempts (student_id, portal_id, score, total_questions, percentage, passed, attempted_at)
             SELECT student_id, portal_id, score, total_questions, MAX(percentage), 1, CURRENT_TIMESTAMP
             FROM myth_quiz_attempts WHERE student_id = ? AND portal_id = 5
             GROUP BY student_id`,
            [row.student_id]
          );
        }
        passFixes++;
      }
    });

    // Portal 6: Psyche — same logic
    const psycheCompletions = query(
      'SELECT DISTINCT student_id FROM psyche_game_results WHERE completed_at IS NOT NULL'
    );
    psycheCompletions.forEach(row => {
      const hasPassed = query(
        'SELECT 1 FROM myth_quiz_attempts WHERE student_id = ? AND portal_id = 6 AND passed = 1 LIMIT 1',
        [row.student_id]
      )[0];
      if (!hasPassed) {
        const student = students.find(s => s.student_id === row.student_id);
        passFixReport.push({ student: student ? student.name : row.student_id, portal: 'Eros & Psyche', action: 'SET passed=1' });
        if (!dryRun) {
          run(
            `INSERT INTO myth_quiz_attempts (student_id, portal_id, score, total_questions, percentage, passed, attempted_at)
             SELECT student_id, portal_id, score, total_questions, MAX(percentage), 1, CURRENT_TIMESTAMP
             FROM myth_quiz_attempts WHERE student_id = ? AND portal_id = 6
             GROUP BY student_id`,
            [row.student_id]
          );
        }
        passFixes++;
      }
    });

    if (!dryRun && (fixCount > 0 || passFixes > 0)) saveDatabase();

    res.json({
      dry_run: dryRun,
      grade_fixes: fixCount,
      pass_fixes: passFixes,
      message: dryRun
        ? `Dry run: ${fixCount} grade record(s) and ${passFixes} quiz pass flag(s) would be updated.`
        : `Migration complete. ${fixCount} grade record(s) and ${passFixes} quiz pass flag(s) updated.`,
      grade_details: report,
      pass_details: passFixReport
    });

  } catch (err) {
    console.error('fix-quiz-best-scores error:', err);
    res.status(500).json({ error: 'Migration failed', details: err.message });
  }
});

app.get('/api/admin/repair-buildings', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  try {
    const dryRun = req.query.fix !== 'true';
    
    // Get all alliances
    const alliances = query('SELECT alliance_id, alliance_name, buildings_owned FROM alliances WHERE is_disbanded = 0');
    
    // Get all building activations
    const activations = query('SELECT alliance_id, building_name FROM building_activations ORDER BY alliance_id, activation_id');
    
    // Build expected buildings_owned from activations
    const expectedByAlliance = {};
    activations.forEach(ba => {
      if (!expectedByAlliance[ba.alliance_id]) expectedByAlliance[ba.alliance_id] = [];
      expectedByAlliance[ba.alliance_id].push(ba.building_name);
    });
    
    const report = [];
    let repaired = 0;
    
    alliances.forEach(a => {
      const currentOwned = JSON.parse(a.buildings_owned || '[]');
      const expected = expectedByAlliance[a.alliance_id] || [];
      const mismatch = JSON.stringify(currentOwned.sort()) !== JSON.stringify([...expected].sort());
      
      if (mismatch || expected.length > 0) {
        const entry = {
          alliance: a.alliance_name,
          current_buildings_owned: currentOwned,
          activations_show: expected,
          mismatch
        };
        
        if (mismatch && !dryRun) {
          run('UPDATE alliances SET buildings_owned = ? WHERE alliance_id = ?', 
            [JSON.stringify(expected), a.alliance_id]);
          entry.repaired = true;
          repaired++;
        }
        
        report.push(entry);
      }
    });
    
    if (!dryRun) saveDatabase();
    
    res.json({
      mode: dryRun ? 'DRY RUN - add ?fix=true to repair' : 'REPAIRED',
      total_alliances: alliances.length,
      total_activations: activations.length,
      repaired,
      report
    });
  } catch (err) {
    console.error('Repair buildings error:', err);
    res.status(500).json({ error: 'Failed to run repair' });
  }
});

// ==================== HALL OF HONOR BADGE SYSTEM ====================

// Badge scanner — checks all criteria for a student, returns unclaimed qualified badges
function scanForBadges(studentId) {
  const newBadges = [];
  
  try {
    // Get all badge definitions
    const allBadges = query('SELECT * FROM badges_ref WHERE is_active = 1');
    
    // Get already-earned badge IDs
    const earned = new Set(
      query('SELECT badge_id FROM student_badges WHERE student_id = ?', [studentId])
        .map(b => b.badge_id)
    );
    
    // Get student data
    const student = query(`
      SELECT s.*, a.buildings_owned, a.current_age, a.alliance_id, a.reverse_cards,
             a.total_points, a.side_quest_rewards
      FROM students s 
      LEFT JOIN alliances a ON s.alliance_id = a.alliance_id 
      WHERE s.student_id = ?
    `, [studentId])[0];
    if (!student) return [];
    
    // Get achievement progress
    const progress = query('SELECT * FROM student_achievement_progress WHERE student_id = ?', [studentId])[0] || {};
    
    // Get battle stats
    const battleStats = query('SELECT * FROM arena_battle_stats WHERE student_id = ?', [studentId])[0] || {};
    
    // Get side quest completions
    const sideQuests = query(`
      SELECT sq.quest_name, sqc.status 
      FROM side_quest_completions sqc
      JOIN side_quests_ref sq ON sqc.quest_id = sq.quest_id
      WHERE sqc.student_id = ? AND sqc.status = 'approved'
    `, [studentId]);
    const completedQuests = new Set(sideQuests.map(sq => sq.quest_name));
    
    // Get trade count (trades use initiator_id/partner_id referencing students)
    const tradeCount = query(`
      SELECT COUNT(*) as count FROM trades 
      WHERE (initiator_id = ? OR partner_id = ?) AND status = 'completed'
    `, [studentId, studentId])[0]?.count || 0;
    
    // Parse buildings
    let buildings = [];
    try { buildings = JSON.parse(student.buildings_owned || '[]'); } catch(e) {}
    
    for (const badge of allBadges) {
      if (earned.has(badge.badge_id)) continue;
      
      // Skip heroic age badges
      if (badge.age_available === 'heroic') continue;
      
      let qualified = false;
      
      switch (badge.unlock_type) {
        case 'god_bonus': {
          const godName = badge.unlock_value;
          // Must have bonus_seen AND scored 70%+ on the bonus assignment
          if (progress[`pantheon_${godName}_bonus_seen`] === 1) {
            // Look up grade for this god's bonus assignment
            const godNameCap = godName.charAt(0).toUpperCase() + godName.slice(1);
            const gradeCheck = query(`
              SELECT gr.points_earned, gr.points_possible 
              FROM grade_records gr
              JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
              WHERE gr.student_id = ? 
                AND ar.section = 'bonus' 
                AND ar.is_bonus = 1
                AND LOWER(ar.myth_god) = ?
              ORDER BY gr.points_earned DESC LIMIT 1
            `, [studentId, godName])[0];
            
            if (gradeCheck && gradeCheck.points_possible > 0) {
              const pct = gradeCheck.points_earned / gradeCheck.points_possible;
              qualified = pct >= 0.70;
            } else {
              // No grade record found — check if teacher manually marked (Apollo/Artemis)
              // bonus_seen alone counts for gods without in-game bonus assignments
              const hasAssignment = query(`
                SELECT COUNT(*) as count FROM assignments_ref 
                WHERE section = 'bonus' AND is_bonus = 1 AND LOWER(myth_god) = ?
              `, [godName])[0]?.count || 0;
              
              if (hasAssignment === 0) {
                // No bonus assignment exists for this god (e.g. Apollo, Artemis)
                // bonus_seen was set manually by teacher — trust it
                qualified = true;
              }
              // else: assignment exists but no grade recorded yet — not qualified
            }
          }
          break;
        }
        
        case 'god_unlock_count': {
          const required = parseInt(badge.unlock_value);
          const pantheonGods = ['zeus', 'hera', 'poseidon', 'athena', 'apollo', 'artemis', 'aphrodite', 'ares', 'hephaestus', 'hermes', 'demeter', 'prometheus', 'hades'];
          const unlocked = pantheonGods.filter(g => progress[`pantheon_${g}_unlocked`] === 1).length;
          qualified = unlocked >= required;
          break;
        }
        
        case 'map_uploaded': {
          const hasMap = query('SELECT map_image FROM students WHERE student_id = ? AND map_image IS NOT NULL', [studentId])[0];
          qualified = !!hasMap;
          break;
        }
        
        case 'membean_points': {
          const required = parseInt(badge.unlock_value);
          // Membean goes through teacher award flow — stored in point_transactions, not grade_records
          const membeanResult = query(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM point_transactions
            WHERE student_id = ? AND category = 'membean' AND amount > 0
          `, [studentId])[0];
          qualified = (membeanResult?.total || 0) >= required;
          break;
        }
        
        case 'building_count': {
          if (badge.unlock_value === 'all_archaic') {
            // Need: Town Center, Library, House (x1 min), Wooden Wall, Stone Wall, Dock, Granary, Storehouse, Fishing Boat
            const requiredBuildings = ['Town Center', 'Library', 'House', 'Wooden Wall', 'Stone Wall', 'Dock', 'Granary', 'Storehouse', 'Fishing Boat'];
            qualified = requiredBuildings.every(b => buildings.includes(b));
          }
          break;
        }
        
        case 'side_quest_count': {
          if (badge.unlock_value === 'archaic_all') {
            // The Ring of Many (Hephaestus), Panacea's Remedy (Artemis), The Three Seeds (Demeter)
            const archQuests = ['The Ring of Many', "Panacea's Remedy", 'The Three Seeds'];
            qualified = archQuests.every(q => completedQuests.has(q));
          }
          break;
        }
        
        case 'battle_wins': {
          const required = parseInt(badge.unlock_value);
          qualified = (battleStats.wins || 0) >= required;
          break;
        }
        
        case 'battle_streak': {
          const required = parseInt(badge.unlock_value);
          qualified = (battleStats.best_streak || 0) >= required;
          break;
        }
        
        case 'battle_sudden_death': {
          // Check if student has won any battle that went to sudden death (round 6+)
          const sdWin = query(`
            SELECT b.battle_id FROM arena_battles b
            JOIN arena_battle_rounds r ON b.battle_id = r.battle_id
            WHERE b.winner_id = ? AND r.round_number >= 6
            LIMIT 1
          `, [studentId])[0];
          qualified = !!sdWin;
          break;
        }
        
        case 'battle_comeback': {
          // Check if student ever won after being down 0-2
          const wonBattles = query(`
            SELECT battle_id FROM arena_battles 
            WHERE winner_id = ? AND status = 'completed'
          `, [studentId]);
          for (const battle of wonBattles) {
            const rounds = query(
              'SELECT round_winner_id FROM arena_battle_rounds WHERE battle_id = ? ORDER BY round_number',
              [battle.battle_id]
            );
            let myScore = 0, oppScore = 0, wasDown2 = false;
            for (const round of rounds) {
              if (round.round_winner_id === studentId) myScore++;
              else if (round.round_winner_id) oppScore++;
              if (oppScore - myScore >= 2) wasDown2 = true;
            }
            if (wasDown2) { qualified = true; break; }
          }
          break;
        }
        
        case 'trade_completed': {
          const required = parseInt(badge.unlock_value);
          qualified = tradeCount >= required;
          break;
        }
        
        case 'first_to_classical': {
          // Check if this student was the first in their period to enter Classical
          if (student.classical_entered) {
            const earlier = query(`
              SELECT COUNT(*) as count FROM students 
              WHERE class_period = ? AND classical_entered = 1 
              AND student_id != ? AND student_id < ?
            `, [student.class_period, studentId, studentId]);
            // Simple check: if they entered classical, check if anyone entered before them
            const firstCheck = query(`
              SELECT s.student_id FROM students s
              WHERE s.class_period = ? AND s.classical_entered = 1
              ORDER BY s.student_id ASC LIMIT 1
            `, [student.class_period])[0];
            qualified = firstCheck && firstCheck.student_id === studentId;
          }
          break;
        }
        
        case 'reverse_card_used': {
          // Awarded automatically in /api/student/use-reverse-card — skip auto-scan
          break;
        }
        
        case 'citizenship_points': {
          // Award when teacher has given any citizenship points to this student
          const citizenResult = query(`
            SELECT COALESCE(SUM(amount), 0) as total
            FROM point_transactions
            WHERE student_id = ? AND category = 'citizenship' AND amount > 0
          `, [studentId])[0];
          qualified = (citizenResult?.total || 0) > 0;
          break;
        }
        
        case 'manual': {
          // Teacher awards — skip auto-scan
          break;
        }
        
        case 'all_badges': {
          // Legend badge — check if all other active non-heroic badges earned
          const totalActive = query(`
            SELECT COUNT(*) as count FROM badges_ref 
            WHERE is_active = 1 AND age_available != 'heroic' AND badge_id != 'special_legend'
          `)[0]?.count || 0;
          const totalEarned = earned.size;
          qualified = totalEarned >= totalActive;
          break;
        }
        
        case 'myth_score_85': {
          // unlock_value is the canonical myth name (e.g. 'Orpheus', 'Echo and Narcissus')
          // Use alias arrays to match all name variants stored in assignments_ref
          const mythScoreAliases = {
            'Pandora':           ['Pandora', 'Pandora (Box)'],
            'Phaethon':          ['Phaethon'],
            'Orpheus':           ['Orpheus', 'Orpheus & Eurydice', 'Orpheus and Eurydice'],
            'Echo and Narcissus':['Echo and Narcissus', 'Echo & Narcissus'],
            'Icarus':            ['Icarus', 'Icarus & Daedalus', 'Icarus and Daedalus'],
            'Eros and Psyche':   ['Eros and Psyche', 'Eros & Psyche'],
            'Constellations':    ['Constellations']
          };
          const mythGod = badge.unlock_value;
          const aliases = mythScoreAliases[mythGod] || [mythGod];
          const placeholders = aliases.map(() => '?').join(',');
          try {
            const scoreResult = query(`
              SELECT
                SUM(gr.points_earned)   AS total_earned,
                SUM(gr.points_possible) AS total_possible
              FROM grade_records gr
              JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
              WHERE gr.student_id = ?
                AND ar.myth_god IN (${placeholders})
                AND ar.age = 'Classical'
                AND ar.assignment_type IN ('comp_conn', 'quiz', 'creative', 'cer', 'word_cloud', 'mural')
            `, [studentId, ...aliases])[0];

            if (scoreResult && scoreResult.total_possible > 0) {
              const pct = scoreResult.total_earned / scoreResult.total_possible;
              qualified = pct >= 0.85;
            }
          } catch (mythErr) {
            console.log(`myth_score_85 check error for ${mythGod}:`, mythErr.message);
          }
          break;
        }

        case 'heroic_content': {
          // Not yet available
          break;
        }
      }
      
      if (qualified) {
        newBadges.push(badge);
      }
    }
  } catch (err) {
    console.error('Badge scan error:', err);
  }
  
  return newBadges;
}

// GET /api/student/badges — Get all badges + earned status + unclaimed queue
app.get('/api/student/badges', authenticateToken, (req, res) => {
  try {
    const studentId = req.user.id;
    
    // Scan for new badges and auto-award them (unclaimed)
    const newBadges = scanForBadges(studentId);
    for (const badge of newBadges) {
      try {
        run(`INSERT OR IGNORE INTO student_badges (student_id, badge_id, ring_level, claimed, awarded_by) 
             VALUES (?, ?, 0, 0, 'system')`, [studentId, badge.badge_id]);
        console.log(`🏅 Badge qualified: ${badge.badge_name} for student ${studentId}`);
      } catch (e) { /* already exists */ }
    }
    
    // Check ring upgrades for ring badges
    checkRingUpgrades(studentId);
    
    // Get all badge definitions
    const allBadges = query('SELECT * FROM badges_ref WHERE is_active = 1 ORDER BY row_number, col_number');
    
    // Get student's earned badges
    const earnedBadges = query('SELECT * FROM student_badges WHERE student_id = ?', [studentId]);
    const earnedMap = {};
    earnedBadges.forEach(b => { earnedMap[b.badge_id] = b; });
    
    // Get unclaimed badges (earned but not yet claimed by clicking)
    const unclaimed = earnedBadges.filter(b => !b.claimed);
    
    // Build response
    const badges = allBadges.map(b => ({
      ...b,
      earned: !!earnedMap[b.badge_id],
      claimed: earnedMap[b.badge_id]?.claimed === 1,
      ring_level: earnedMap[b.badge_id]?.ring_level || 0,
      earned_at: earnedMap[b.badge_id]?.earned_at || null,
      awarded_by: earnedMap[b.badge_id]?.awarded_by || null
    }));
    
    // Tier calculation
    const earnedCount = earnedBadges.length;
    let tier = 'none';
    if (earnedCount >= 35) tier = 'legendary';
    else if (earnedCount >= 28) tier = 'gold';
    else if (earnedCount >= 24) tier = 'silver';
    else if (earnedCount >= 20) tier = 'bronze';
    
    res.json({
      badges,
      total_earned: earnedCount,
      total_claimed: earnedBadges.filter(b => b.claimed).length,
      unclaimed_count: unclaimed.length,
      unclaimed_badges: unclaimed.map(u => {
        const def = allBadges.find(b => b.badge_id === u.badge_id);
        return {
          badge_id: u.badge_id,
          badge_name: def?.badge_name,
          description: def?.description,
          icon: def?.icon,
          category: def?.category,
          awarded_by: u.awarded_by
        };
      }),
      tier,
      next_tier: tier === 'none' ? 'bronze' : tier === 'bronze' ? 'silver' : tier === 'silver' ? 'gold' : tier === 'gold' ? 'legendary' : null,
      badges_to_next: tier === 'none' ? 20 - earnedCount : tier === 'bronze' ? 24 - earnedCount : tier === 'silver' ? 28 - earnedCount : tier === 'gold' ? 35 - earnedCount : 0
    });
  } catch (err) {
    console.error('Get badges error:', err);
    res.status(500).json({ error: 'Failed to get badges' });
  }
});

// POST /api/student/claim-badge — Student claims (clicks) a badge to see celebration
app.post('/api/student/claim-badge', authenticateToken, (req, res) => {
  try {
    const studentId = req.user.id;
    const { badge_id } = req.body;
    
    if (!badge_id) return res.status(400).json({ error: 'badge_id required' });
    
    // Verify badge exists and is earned but unclaimed
    const badge = query(
      'SELECT * FROM student_badges WHERE student_id = ? AND badge_id = ? AND claimed = 0',
      [studentId, badge_id]
    )[0];
    
    if (!badge) {
      return res.status(400).json({ error: 'Badge not found or already claimed' });
    }
    
    run('UPDATE student_badges SET claimed = 1, claimed_at = CURRENT_TIMESTAMP WHERE student_id = ? AND badge_id = ?',
      [studentId, badge_id]);
    
    // Get badge definition for response
    const def = query('SELECT * FROM badges_ref WHERE badge_id = ?', [badge_id])[0];
    
    console.log(`🏅 Badge claimed: ${def?.badge_name} by student ${studentId}`);
    
    res.json({ 
      success: true, 
      badge: {
        badge_id: def.badge_id,
        badge_name: def.badge_name,
        description: def.description,
        icon: def.icon,
        category: def.category,
        ring_level: badge.ring_level
      }
    });
  } catch (err) {
    console.error('Claim badge error:', err);
    res.status(500).json({ error: 'Failed to claim badge' });
  }
});

// POST /api/teacher/award-badge — Teacher manually awards Citizen badge
app.post('/api/teacher/award-badge', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
    
    const { student_id, badge_id } = req.body;
    if (!student_id || !badge_id) return res.status(400).json({ error: 'student_id and badge_id required' });
    
    // Verify badge exists
    const badge = query('SELECT * FROM badges_ref WHERE badge_id = ?', [badge_id])[0];
    if (!badge) return res.status(404).json({ error: 'Badge not found' });
    
    // Award it (unclaimed — student will see it flash)
    try {
      run(`INSERT INTO student_badges (student_id, badge_id, ring_level, claimed, awarded_by)
           VALUES (?, ?, 0, 0, 'teacher')`, [student_id, badge_id]);
    } catch (e) {
      return res.status(400).json({ error: 'Badge already awarded to this student' });
    }
    
    const studentName = query('SELECT name FROM students WHERE student_id = ?', [student_id])[0]?.name;
    console.log(`🏅 Teacher awarded ${badge.badge_name} to ${studentName} (${student_id})`);
    
    saveDatabase();
    res.json({ success: true, message: `${badge.badge_name} awarded to ${studentName}` });
  } catch (err) {
    console.error('Award badge error:', err);
    res.status(500).json({ error: 'Failed to award badge' });
  }
});

// POST /api/teacher/mark-bonus-complete — Manually mark a god bonus as complete for a student
app.post('/api/teacher/mark-bonus-complete', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
    
    const { student_id, god } = req.body;
    if (!student_id || !god) return res.status(400).json({ error: 'student_id and god required' });
    
    const validGods = ['zeus', 'hera', 'poseidon', 'athena', 'apollo', 'artemis', 'aphrodite', 'ares', 'hephaestus', 'hermes', 'demeter', 'prometheus', 'hades'];
    const godLower = god.toLowerCase();
    if (!validGods.includes(godLower)) return res.status(400).json({ error: 'Invalid god name' });
    
    // Set bonus_seen = 1 for this student
    run(`UPDATE student_achievement_progress 
         SET pantheon_${godLower}_bonus_seen = 1
         WHERE student_id = ?`, [student_id]);
    
    const studentName = query('SELECT name FROM students WHERE student_id = ?', [student_id])[0]?.name;
    console.log(`🏅 Teacher marked ${god} bonus complete for ${studentName} (${student_id})`);
    
    saveDatabase();
    res.json({ success: true, message: `${god} bonus marked complete for ${studentName}` });
  } catch (err) {
    console.error('Mark bonus complete error:', err);
    res.status(500).json({ error: 'Failed to mark bonus complete' });
  }
});

// POST /api/teacher/award-fate-breaker — Award Fate Breaker to all alliance members
app.post('/api/teacher/award-fate-breaker', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
    
    const { alliance_id } = req.body;
    if (!alliance_id) return res.status(400).json({ error: 'alliance_id required' });
    
    const members = query('SELECT student_id, name FROM students WHERE alliance_id = ?', [alliance_id]);
    let awarded = 0;
    
    for (const member of members) {
      try {
        run(`INSERT OR IGNORE INTO student_badges (student_id, badge_id, ring_level, claimed, awarded_by)
             VALUES (?, 'honor_fate_breaker', 0, 0, 'system')`, [member.student_id]);
        awarded++;
        console.log(`🔄 Fate Breaker badge → ${member.name}`);
      } catch (e) { /* already has it */ }
    }
    
    saveDatabase();
    res.json({ success: true, awarded, total_members: members.length });
  } catch (err) {
    console.error('Award fate breaker error:', err);
    res.status(500).json({ error: 'Failed to award Fate Breaker' });
  }
});

// Ring upgrade checker for ring badges
function checkRingUpgrades(studentId) {
  try {
    const student = query(`
      SELECT s.*, a.buildings_owned, a.alliance_id 
      FROM students s LEFT JOIN alliances a ON s.alliance_id = a.alliance_id 
      WHERE s.student_id = ?
    `, [studentId])[0];
    if (!student) return;
    
    // Trader ring upgrades: bronze at 3, gold at 5
    const traderBadge = query('SELECT * FROM student_badges WHERE student_id = ? AND badge_id = ?', [studentId, 'class_trader'])[0];
    if (traderBadge) {
      const tradeCount = query(`
        SELECT COUNT(*) as count FROM trades 
        WHERE (initiator_id = ? OR partner_id = ?) AND status = 'completed'
      `, [studentId, studentId])[0]?.count || 0;
      
      let newRing = 0;
      if (tradeCount >= 5) newRing = 2;
      else if (tradeCount >= 3) newRing = 1;
      
      if (newRing > traderBadge.ring_level) {
        run('UPDATE student_badges SET ring_level = ? WHERE student_id = ? AND badge_id = ?',
          [newRing, studentId, 'class_trader']);
        console.log(`💍 Trader ring upgrade → level ${newRing} for student ${studentId}`);
      }
    }
    
    // Developer and Adventurer ring upgrades would go here when Classical/Heroic building lists are finalized
    
  } catch (err) {
    console.error('Ring upgrade check error:', err);
  }
}

// Admin endpoint: retroactively scan all students for badges
app.post('/api/admin/scan-all-badges', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
    
    const students = query('SELECT student_id, name FROM students');
    let totalAwarded = 0;
    const results = [];
    
    for (const student of students) {
      const newBadges = scanForBadges(student.student_id);
      for (const badge of newBadges) {
        try {
          run(`INSERT OR IGNORE INTO student_badges (student_id, badge_id, ring_level, claimed, awarded_by)
               VALUES (?, ?, 0, 0, 'system')`, [student.student_id, badge.badge_id]);
          totalAwarded++;
          results.push(`${student.name}: ${badge.badge_name}`);
        } catch (e) { /* already exists */ }
      }
    }
    
    saveDatabase();
    console.log(`🏅 Retroactive badge scan complete: ${totalAwarded} badges awarded`);
    res.json({ success: true, total_awarded: totalAwarded, details: results });
  } catch (err) {
    console.error('Scan all badges error:', err);
    res.status(500).json({ error: 'Failed to scan badges' });
  }
});

// GET version for easy browser testing
app.get('/api/admin/scan-all-badges', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
    
    const students = query('SELECT student_id, name FROM students');
    let totalAwarded = 0;
    const results = [];
    
    for (const student of students) {
      const newBadges = scanForBadges(student.student_id);
      for (const badge of newBadges) {
        try {
          run(`INSERT OR IGNORE INTO student_badges (student_id, badge_id, ring_level, claimed, awarded_by)
               VALUES (?, ?, 0, 0, 'system')`, [student.student_id, badge.badge_id]);
          totalAwarded++;
          results.push(`${student.name}: ${badge.badge_name}`);
        } catch (e) { /* already exists */ }
      }
    }
    
    saveDatabase();
    res.json({ success: true, total_awarded: totalAwarded, details: results });
  } catch (err) {
    res.status(500).json({ error: 'Failed to scan badges' });
  }
});

// Debug: Check what a specific student qualifies for
app.get('/api/admin/debug-badges/:studentId', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
    
    const studentId = parseInt(req.params.studentId);
    const student = query('SELECT * FROM students WHERE student_id = ?', [studentId])[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });
    
    const progress = query('SELECT * FROM student_achievement_progress WHERE student_id = ?', [studentId])[0] || {};
    const battleStats = query('SELECT * FROM arena_battle_stats WHERE student_id = ?', [studentId])[0] || {};
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [student.alliance_id])[0] || {};
    const hasMap = query('SELECT student_id FROM students WHERE student_id = ? AND map_image IS NOT NULL', [studentId])[0];
    
    const sideQuests = query(`
      SELECT sq.quest_name, sqc.status 
      FROM side_quest_completions sqc
      JOIN side_quests_ref sq ON sqc.quest_id = sq.quest_id
      WHERE sqc.student_id = ? AND sqc.status = 'approved'
    `, [studentId]);
    
    // God bonus status with grades
    const gods = ['zeus', 'hera', 'poseidon', 'athena', 'apollo', 'artemis', 'aphrodite', 'ares', 'hephaestus', 'hermes', 'demeter', 'prometheus', 'hades'];
    const godBonuses = {};
    const godUnlocks = {};
    gods.forEach(g => {
      const bonusSeen = progress[`pantheon_${g}_bonus_seen`] === 1;
      // Check grade
      const grade = query(`
        SELECT gr.points_earned, gr.points_possible 
        FROM grade_records gr
        JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
        WHERE gr.student_id = ? AND ar.section = 'bonus' AND ar.is_bonus = 1 AND LOWER(ar.myth_god) = ?
        ORDER BY gr.points_earned DESC LIMIT 1
      `, [studentId, g])[0];
      const pct = grade ? Math.round((grade.points_earned / grade.points_possible) * 100) : null;
      godBonuses[g] = { bonus_seen: bonusSeen, grade_pct: pct, meets_70: pct !== null ? pct >= 70 : 'no_grade' };
      godUnlocks[g] = progress[`pantheon_${g}_unlocked`] === 1;
    });
    
    let buildings = [];
    try { buildings = JSON.parse(alliance.buildings_owned || '[]'); } catch(e) {}
    
    const newBadges = scanForBadges(studentId);
    const earnedBadges = query('SELECT badge_id FROM student_badges WHERE student_id = ?', [studentId]);
    
    res.json({
      student: student.name,
      student_id: studentId,
      alliance: alliance.alliance_name,
      has_map: !!hasMap,
      buildings,
      god_bonuses: godBonuses,
      god_unlocks: godUnlocks,
      gods_unlocked_count: Object.values(godUnlocks).filter(v => v).length,
      battle_stats: { wins: battleStats.wins || 0, best_streak: battleStats.best_streak || 0, total: battleStats.total_battles || 0 },
      side_quests_completed: sideQuests.map(sq => sq.quest_name),
      classical_entered: !!student.classical_entered,
      already_earned: earnedBadges.map(b => b.badge_id),
      newly_qualified: newBadges.map(b => ({ badge_id: b.badge_id, name: b.badge_name }))
    });
  } catch (err) {
    console.error('Debug badges error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// DIAGNOSTIC: Alliance breakup analysis — shows what a student/alliance
// has completed across all systems to identify what needs repair after
// an improper alliance dissolution.
// GET /api/admin/diagnose-alliance?alliance_id=X  (or student_id=X)
// ================================================================
app.get('/api/admin/diagnose-alliance', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  try {
    const { alliance_id, student_id } = req.query;
    
    let targetAllianceId;
    let targetStudent;
    
    if (student_id) {
      targetStudent = query('SELECT s.*, a.alliance_name, a.current_age as alliance_age, a.buildings_owned, a.side_quest_rewards, a.civilization_map_complete, a.reverse_cards, a.total_points FROM students s LEFT JOIN alliances a ON s.alliance_id = a.alliance_id WHERE s.student_id = ?', [student_id])[0];
      if (!targetStudent) return res.status(404).json({ error: 'Student not found' });
      targetAllianceId = targetStudent.alliance_id;
    } else if (alliance_id) {
      targetAllianceId = parseInt(alliance_id);
    } else {
      return res.status(400).json({ error: 'Provide alliance_id or student_id' });
    }
    
    // Get alliance info
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [targetAllianceId])[0];
    if (!alliance) return res.status(404).json({ error: 'Alliance not found' });
    
    // Get all members (including ghosts)
    const members = query('SELECT student_id, name, is_ghost, scout_status, map_image, classical_entered FROM students WHERE alliance_id = ?', [targetAllianceId]);
    const nonGhostMembers = members.filter(m => !m.is_ghost);
    const nonGhostIds = nonGhostMembers.map(m => m.student_id);
    
    // 1. Buildings owned (from alliance JSON)
    const buildingsOwned = JSON.parse(alliance.buildings_owned || '[]');
    
    // 2. Building activations (from DB records)
    const buildingActivations = query('SELECT building_name, building_instance FROM building_activations WHERE alliance_id = ?', [targetAllianceId]);
    
    // 3. God assignments for this alliance
    const godAssignments = query('SELECT god_name, completed_at FROM god_assignments WHERE alliance_id = ?', [targetAllianceId]);
    
    // 4. Alliance technologies
    let allianceTechs = [];
    try {
      allianceTechs = query('SELECT tech_name, source_quest_id, unlocked_at FROM alliance_technologies WHERE alliance_id = ?', [targetAllianceId]);
    } catch(e) {}
    
    // 5. Side quest completions for each member
    const sideQuestCompletions = {};
    nonGhostMembers.forEach(m => {
      sideQuestCompletions[m.name] = query(`
        SELECT sqc.*, sqr.quest_name, sqr.god_associated, sqr.reward_name
        FROM side_quest_completions sqc
        JOIN side_quests_ref sqr ON sqc.quest_id = sqr.quest_id
        WHERE sqc.student_id = ?
      `, [m.student_id]);
    });
    
    // 6. Grade records — bonus assignments completed by each member
    const bonusGrades = {};
    nonGhostMembers.forEach(m => {
      bonusGrades[m.name] = query(`
        SELECT ar.myth_god, ar.display_name, ar.section, gr.points_earned
        FROM grade_records gr
        JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
        WHERE gr.student_id = ? AND ar.section = 'bonus' AND gr.points_earned > 0
      `, [m.student_id]);
    });
    
    // 7. All grade records for non-ghost members (for comprehensive view)
    const allGrades = {};
    nonGhostMembers.forEach(m => {
      allGrades[m.name] = query(`
        SELECT ar.myth_god, ar.display_name, ar.section, gr.points_earned
        FROM grade_records gr
        JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
        WHERE gr.student_id = ? AND gr.points_earned > 0
        ORDER BY ar.myth_god, ar.section
      `, [m.student_id]);
    });
    
    // 8. Side quest rewards on alliance
    const sideQuestRewards = JSON.parse(alliance.side_quest_rewards || '[]');
    
    // 9. Age readiness check
    const readiness = calculateAgeReadiness(alliance);
    
    // 10. Age gate status for this period
    let ageGate = null;
    try {
      ageGate = query('SELECT * FROM age_gates WHERE class_period = ?', [alliance.class_period])[0];
    } catch(e) {}
    
    // 11. Building requirements check — which buildings can/can't be purchased
    const buildingReqSummary = {};
    const allBuildings = query('SELECT building_name, god_associated, requires_god_assignment, age_available FROM buildings_ref');
    allBuildings.forEach(b => {
      if (!b.requires_god_assignment && b.building_name !== 'Town Center' && b.building_name !== 'Granary') return;
      
      let met = false;
      let detail = '';
      
      if (b.building_name === 'Town Center') {
        // Needs Prometheus + Zeus grades from any member
        for (const m of nonGhostMembers) {
          const prom = query("SELECT COUNT(*) as cnt FROM grade_records gr JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id WHERE gr.student_id = ? AND ar.myth_god = 'Prometheus' AND gr.points_earned > 0", [m.student_id])[0];
          const zeus = query("SELECT COUNT(*) as cnt FROM grade_records gr JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id WHERE gr.student_id = ? AND ar.myth_god = 'Zeus' AND gr.points_earned > 0", [m.student_id])[0];
          if (prom.cnt > 0 && zeus.cnt > 0) { met = true; detail = `${m.name} has both`; break; }
        }
        if (!met) detail = 'No member has both Prometheus + Zeus grades';
      } else if (b.building_name === 'Granary') {
        met = allianceTechs.some(t => t.tech_name === 'Granary');
        detail = met ? 'Demeter Side Quest completed' : 'Needs Demeter Side Quest (alliance_technologies)';
      } else if (b.requires_god_assignment && b.god_associated) {
        // Needs ALL non-ghost members to complete the bonus
        const completedCount = nonGhostIds.length > 0 ? query(`
          SELECT COUNT(DISTINCT gr.student_id) as cnt
          FROM grade_records gr JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
          WHERE gr.student_id IN (${nonGhostIds.join(',')}) AND ar.section = 'bonus' AND ar.myth_god = ? AND gr.points_earned > 0
        `, [b.god_associated])[0].cnt : 0;
        met = completedCount >= nonGhostMembers.length;
        detail = `${completedCount}/${nonGhostMembers.length} non-ghost members completed ${b.god_associated} bonus`;
      }
      
      buildingReqSummary[b.building_name] = { requirement_met: met, detail, god: b.god_associated, age: b.age_available };
    });
    
    res.json({
      alliance: {
        alliance_id: alliance.alliance_id,
        alliance_name: alliance.alliance_name,
        class_period: alliance.class_period,
        current_age: alliance.current_age,
        total_points: alliance.total_points,
        buildings_owned: buildingsOwned,
        building_activations: buildingActivations,
        side_quest_rewards: sideQuestRewards,
        civilization_map_complete: alliance.civilization_map_complete,
        reverse_cards: alliance.reverse_cards
      },
      members: members.map(m => ({
        student_id: m.student_id,
        name: m.name,
        is_ghost: m.is_ghost,
        scout_status: m.scout_status,
        has_map: !!m.map_image,
        classical_entered: m.classical_entered
      })),
      non_ghost_count: nonGhostMembers.length,
      god_assignments: godAssignments,
      alliance_technologies: allianceTechs,
      side_quest_completions: sideQuestCompletions,
      bonus_grades_by_member: bonusGrades,
      all_grades_by_member: allGrades,
      building_requirement_status: buildingReqSummary,
      age_readiness: readiness,
      age_gate: ageGate
    });
  } catch (err) {
    console.error('Diagnose alliance error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ================================================================
// REPAIR: Fix alliance after improper dissolution
// POST /api/admin/repair-alliance
// Grants buildings, techs, god assignments, and age based on 
// what non-ghost members have individually completed.
// ================================================================
app.post('/api/admin/repair-alliance', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
  try {
    const { alliance_id, dry_run } = req.body;
    if (!alliance_id) return res.status(400).json({ error: 'alliance_id required' });
    
    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    if (!alliance) return res.status(404).json({ error: 'Alliance not found' });
    
    const isDryRun = dry_run === true;
    const report = [];
    
    // Get non-ghost members
    const members = query('SELECT student_id, name FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)', [alliance_id]);
    const memberIds = members.map(m => m.student_id);
    const memberCount = members.length;
    
    if (memberCount === 0) return res.status(400).json({ error: 'Alliance has no non-ghost members' });
    
    report.push(`Alliance: ${alliance.alliance_name} (ID: ${alliance_id}), ${memberCount} non-ghost members`);
    
    const currentBuildings = JSON.parse(alliance.buildings_owned || '[]');
    let newBuildings = [...currentBuildings];
    
    // --- 1. Check bonus grades and grant god_assignments + buildings ---
    const godBuildingMap = {
      'Athena': 'Library',
      'Ares': 'Wooden Wall', 
      'Poseidon': 'Dock',
      'Hades': null  // Hades bonus doesn't unlock a building
    };
    
    // Check which bonuses ALL non-ghost members have completed
    const bonusGods = query(`
      SELECT ar.myth_god, COUNT(DISTINCT gr.student_id) as cnt
      FROM grade_records gr
      JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
      WHERE gr.student_id IN (${memberIds.join(',')}) AND ar.section = 'bonus' AND gr.points_earned > 0
      GROUP BY ar.myth_god
    `);
    
    bonusGods.forEach(bg => {
      if (bg.cnt >= memberCount) {
        // Grant god_assignment if not exists
        const existing = query('SELECT assignment_id FROM god_assignments WHERE alliance_id = ? AND god_name = ?', [alliance_id, bg.myth_god]);
        if (existing.length === 0) {
          if (!isDryRun) run('INSERT INTO god_assignments (alliance_id, god_name) VALUES (?, ?)', [alliance_id, bg.myth_god]);
          report.push(`+ God assignment: ${bg.myth_god}`);
        }
        
        // Grant associated building if not owned
        const building = godBuildingMap[bg.myth_god];
        if (building && !newBuildings.includes(building)) {
          newBuildings.push(building);
          report.push(`+ Building: ${building} (from ${bg.myth_god} bonus)`);
        }
      }
    });
    
    // Check Town Center (Prometheus + Zeus grades from any member)
    let hasTownCenter = newBuildings.includes('Town Center');
    if (!hasTownCenter) {
      for (const m of members) {
        const prom = query("SELECT COUNT(*) as cnt FROM grade_records gr JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id WHERE gr.student_id = ? AND ar.myth_god = 'Prometheus' AND gr.points_earned > 0", [m.student_id])[0];
        const zeus = query("SELECT COUNT(*) as cnt FROM grade_records gr JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id WHERE gr.student_id = ? AND ar.myth_god = 'Zeus' AND gr.points_earned > 0", [m.student_id])[0];
        if (prom.cnt > 0 && zeus.cnt > 0) {
          newBuildings.push('Town Center');
          report.push(`+ Building: Town Center (${m.name} has Prometheus + Zeus)`);
          hasTownCenter = true;
          break;
        }
      }
    }
    
    // Always ensure House if they need it for advancement and don't have one
    if (!newBuildings.includes('House')) {
      newBuildings.push('House');
      report.push('+ Building: House (required for advancement)');
    }
    
    // Always ensure Fishing Ship if they don't have one (no special prereq)
    if (!newBuildings.includes('Fishing Ship')) {
      newBuildings.push('Fishing Ship');
      report.push('+ Building: Fishing Ship (required for advancement)');
    }
    
    // --- 2. Check side quest completions and grant alliance_technologies ---
    const questTechMap = {
      'The Ring of Many': { tech: 'Pickaxe', quest_id_hint: 1 },
      'Panacea\'s Remedy': { tech: 'Handaxe', quest_id_hint: 2 },
      'The Three Seeds': { tech: 'Granary', quest_id_hint: 3 },
      'Hearth of Hestia': { tech: 'Sacred Flame', quest_id_hint: 4 }
    };
    
    // Get all approved side quests for any member in this alliance
    const approvedQuests = query(`
      SELECT sqr.quest_name, sqr.quest_id, sqr.reward_name,
             COUNT(DISTINCT sqc.student_id) as approved_count
      FROM side_quest_completions sqc
      JOIN side_quests_ref sqr ON sqc.quest_id = sqr.quest_id
      WHERE sqc.student_id IN (${memberIds.join(',')}) AND sqc.status = 'approved'
      GROUP BY sqr.quest_id
    `);
    
    const currentRewards = JSON.parse(alliance.side_quest_rewards || '[]');
    let newRewards = [...currentRewards];
    
    approvedQuests.forEach(q => {
      if (q.approved_count >= memberCount) {
        // All non-ghost members completed — grant tech
        const mapping = questTechMap[q.quest_name];
        if (mapping) {
          const existingTech = query('SELECT tech_id FROM alliance_technologies WHERE alliance_id = ? AND tech_name = ?', [alliance_id, mapping.tech]);
          if (existingTech.length === 0) {
            if (!isDryRun) run('INSERT INTO alliance_technologies (alliance_id, tech_name, source_quest_id) VALUES (?, ?, ?)', [alliance_id, mapping.tech, q.quest_id]);
            report.push(`+ Technology: ${mapping.tech} (from ${q.quest_name})`);
          }
          
          // Grant Granary building if it's the Demeter quest
          if (mapping.tech === 'Granary' && !newBuildings.includes('Granary')) {
            newBuildings.push('Granary');
            report.push('+ Building: Granary (from Demeter Side Quest)');
          }
          
          // Add to side_quest_rewards
          if (!newRewards.includes(q.quest_id)) {
            newRewards.push(q.quest_id);
            report.push(`+ Side quest reward: quest_id ${q.quest_id} (${q.quest_name})`);
          }
        }
      }
    });
    
    // --- 3. Update buildings_owned ---
    if (JSON.stringify(newBuildings.sort()) !== JSON.stringify(currentBuildings.sort())) {
      if (!isDryRun) run('UPDATE alliances SET buildings_owned = ? WHERE alliance_id = ?', [JSON.stringify(newBuildings), alliance_id]);
      report.push(`Buildings updated: [${currentBuildings.join(', ')}] → [${newBuildings.join(', ')}]`);
    }
    
    // --- 4. Update side_quest_rewards ---
    if (JSON.stringify(newRewards.sort()) !== JSON.stringify(currentRewards.sort())) {
      if (!isDryRun) run('UPDATE alliances SET side_quest_rewards = ? WHERE alliance_id = ?', [JSON.stringify(newRewards), alliance_id]);
      report.push(`Side quest rewards updated: ${JSON.stringify(currentRewards)} → ${JSON.stringify(newRewards)}`);
    }
    
    // --- 5. Set civilization_map_complete if all members have maps ---
    if (!alliance.civilization_map_complete) {
      const mapsCount = query('SELECT COUNT(*) as cnt FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL) AND map_image IS NOT NULL', [alliance_id])[0].cnt;
      if (mapsCount >= memberCount) {
        if (!isDryRun) run('UPDATE alliances SET civilization_map_complete = 1 WHERE alliance_id = ?', [alliance_id]);
        report.push('+ Map complete: set to 1');
      }
    }
    
    // --- 6. Create building_activations records for any new buildings ---
    newBuildings.forEach(bName => {
      const existing = query('SELECT activation_id FROM building_activations WHERE alliance_id = ? AND building_name = ?', [alliance_id, bName]);
      if (existing.length === 0) {
        if (!isDryRun) run('INSERT INTO building_activations (alliance_id, building_name, building_instance) VALUES (?, ?, 1)', [alliance_id, bName]);
        report.push(`+ Building activation: ${bName}`);
      }
    });
    
    // --- 7. Check age advancement ---
    // Recalculate after all changes
    if (!isDryRun) {
      const updatedAlliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
      const readiness = calculateAgeReadiness(updatedAlliance);
      
      if (readiness.isReady && updatedAlliance.current_age === 'Archaic') {
        // Check if Classical gate is open
        const ageGate = query('SELECT classical_unlocked FROM age_gates WHERE class_period = ?', [updatedAlliance.class_period])[0];
        if (ageGate && ageGate.classical_unlocked === 1) {
          run('UPDATE alliances SET current_age = ? WHERE alliance_id = ?', ['Classical', alliance_id]);
          report.push('🎉 AUTO-ADVANCED to Classical Age!');
        } else {
          report.push('⚠ Ready for Classical but gate is not open');
        }
      } else if (!readiness.isReady) {
        report.push(`⚠ Not yet ready: buildings ${readiness.ownedRequired.length}/${readiness.requiredBuildings.length}, points ${readiness.pointsHave}/${readiness.pointsThreshold}, map ${readiness.mapComplete}`);
      }
    }
    
    if (!isDryRun) saveDatabase();
    
    res.json({
      success: true,
      dry_run: isDryRun,
      alliance_name: alliance.alliance_name,
      report
    });
  } catch (err) {
    console.error('Repair alliance error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// VOYAGE LOG ENDPOINTS — Jason & the Argonauts Viewing Guide
// ============================================================

// POST /api/voyage-log/submit
// Called from jason_voyage_log_v9.html when student completes the log
// No JWT auth — standalone HTML outside the main student login
app.post('/api/voyage-log/submit', (req, res) => {
  try {
    const {
      student_name, class_period, alliance_name,
      crew_code, rank_tier, total_score,
      stop_scores, medea_response
    } = req.body;

    if (!student_name || !class_period) {
      return res.status(400).json({ error: 'student_name and class_period required' });
    }

    // Upsert — if student already submitted, update their record
    const existing = query(
      'SELECT completion_id FROM voyage_log_completions WHERE student_name = ? AND class_period = ?',
      [student_name, class_period]
    );

    if (existing.length > 0) {
      run(
        `UPDATE voyage_log_completions SET
          alliance_name=?, crew_code=?, rank_tier=?, total_score=?,
          stop_scores=?, medea_response=?, completed_at=CURRENT_TIMESTAMP
         WHERE student_name=? AND class_period=?`,
        [
          alliance_name || null, crew_code || null, rank_tier || null,
          total_score || 0, JSON.stringify(stop_scores || {}),
          medea_response || null, student_name, class_period
        ]
      );
    } else {
      run(
        `INSERT INTO voyage_log_completions
          (student_name, class_period, alliance_name, crew_code, rank_tier, total_score, stop_scores, medea_response)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          student_name, class_period, alliance_name || null,
          crew_code || null, rank_tier || null, total_score || 0,
          JSON.stringify(stop_scores || {}), medea_response || null
        ]
      );
    }

    // Also update the matching student record if found (links voyage log to main game)
    const tierRewards = {
      OAR: { drachma: 0,   lore: 0, hera: 10, guide: 0 },
      NAV: { drachma: 25,  lore: 1, hera: 10, guide: 0 },
      FM:  { drachma: 50,  lore: 2, hera: 12, guide: 1 },
      ARG: { drachma: 75,  lore: 3, hera: 15, guide: 1 },
      HOA: { drachma: 100, lore: 5, hera: 15, guide: 1 }
    };
    const tier = (rank_tier || 'OAR').toUpperCase();
    const rewards = tierRewards[tier] || tierRewards.OAR;

    const students = query(
      'SELECT student_id FROM students WHERE name = ? AND class_period = ?',
      [student_name, class_period]
    );

    if (students.length > 0) {
      const currentDrachma = query('SELECT drachma FROM students WHERE student_id = ?', [students[0].student_id]);
      const existingDrachma = (currentDrachma.length > 0 && currentDrachma[0].drachma) ? currentDrachma[0].drachma : 0;
      run(
        `UPDATE students SET
          voyage_log_completed=1, voyage_crew_code=?, voyage_rank_tier=?,
          voyage_lore_bonus=?, voyage_drachma_bonus=?,
          voyage_hera_start=?, voyage_guide_unlocked=?,
          drachma=?
         WHERE student_id=?`,
        [
          crew_code || null, tier,
          rewards.lore, rewards.drachma,
          rewards.hera, rewards.guide,
          existingDrachma + rewards.drachma,
          students[0].student_id
        ]
      );
      console.log(`⚓ Voyage rewards: +${rewards.drachma} drachma → student_id ${students[0].student_id}`);
    }

    saveDatabase();
    console.log(`⚓ Voyage log submitted: ${student_name} (${class_period}) — ${rank_tier} — ${total_score} pts`);
    res.json({ success: true, crew_code, rank_tier, rewards });

  } catch (err) {
    console.error('Voyage log submit error:', err);
    res.status(500).json({ error: 'Failed to save voyage log' });
  }
});

// GET /api/voyage-log/status/:period
// Teacher dashboard — see all completions for a period
app.get('/api/voyage-log/status/:period', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
    const { period } = req.params;

    const completions = query(
      `SELECT student_name, alliance_name, crew_code, rank_tier,
              total_score, completed_at, override_by_teacher
       FROM voyage_log_completions
       WHERE class_period = ?
       ORDER BY total_score DESC`,
      [period]
    );

    // Count students in this period for completion percentage
    let studentCount = 0;
    try {
      const totalStudents = query(
        'SELECT COUNT(*) as cnt FROM students WHERE class_period = ? AND is_ghost = 0',
        [period]
      );
      studentCount = (totalStudents[0] && totalStudents[0].cnt) || 0;
    } catch (countErr) {
      // is_ghost column may not exist — try without it
      try {
        const totalStudents = query(
          'SELECT COUNT(*) as cnt FROM students WHERE class_period = ?',
          [period]
        );
        studentCount = (totalStudents[0] && totalStudents[0].cnt) || 0;
      } catch (e) {
        studentCount = 0;
      }
    }

    res.json({
      period,
      completions,
      total_students: studentCount,
      completed_count: completions.length
    });

  } catch (err) {
    console.error('Voyage log status error:', err);
    res.status(500).json({ error: 'Failed to load voyage log status' });
  }
});

// POST /api/teacher/voyage-log-override
// Teacher manually sets a crew code for absent/lost-code students
app.post('/api/teacher/voyage-log-override', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
    const { student_name, class_period, rank_tier } = req.body;

    if (!student_name || !class_period || !rank_tier) {
      return res.status(400).json({ error: 'student_name, class_period, rank_tier required' });
    }

    const validTiers = ['OAR','NAV','FM','ARG','HOA'];
    if (!validTiers.includes(rank_tier.toUpperCase())) {
      return res.status(400).json({ error: 'rank_tier must be OAR, NAV, FM, ARG, or HOA' });
    }

    const tier = rank_tier.toUpperCase();
    // Generate a deterministic override code
    const hash = String(Math.floor(Math.random() * 900) + 100);
    const crew_code = tier + '-' + hash;

    // Upsert into completions
    const existing = query(
      'SELECT completion_id FROM voyage_log_completions WHERE student_name=? AND class_period=?',
      [student_name, class_period]
    );

    if (existing.length > 0) {
      run(
        `UPDATE voyage_log_completions SET
          crew_code=?, rank_tier=?, override_by_teacher=1, completed_at=CURRENT_TIMESTAMP
         WHERE student_name=? AND class_period=?`,
        [crew_code, tier, student_name, class_period]
      );
    } else {
      run(
        `INSERT INTO voyage_log_completions
          (student_name, class_period, crew_code, rank_tier, total_score, override_by_teacher)
         VALUES (?, ?, ?, ?, 0, 1)`,
        [student_name, class_period, crew_code, tier]
      );
    }

    // Update student record
    const tierRewards = {
      OAR: { drachma: 0,   lore: 0, hera: 10, guide: 0 },
      NAV: { drachma: 25,  lore: 1, hera: 10, guide: 0 },
      FM:  { drachma: 50,  lore: 2, hera: 12, guide: 1 },
      ARG: { drachma: 75,  lore: 3, hera: 15, guide: 1 },
      HOA: { drachma: 100, lore: 5, hera: 15, guide: 1 }
    };
    const rewards = tierRewards[tier];

    const students = query(
      'SELECT student_id FROM students WHERE name=? AND class_period=?',
      [student_name, class_period]
    );

    if (students.length > 0) {
      run(
        `UPDATE students SET
          voyage_log_completed=1, voyage_crew_code=?, voyage_rank_tier=?,
          voyage_lore_bonus=?, voyage_drachma_bonus=?,
          voyage_hera_start=?, voyage_guide_unlocked=?
         WHERE student_id=?`,
        [crew_code, tier, rewards.lore, rewards.drachma,
         rewards.hera, rewards.guide, students[0].student_id]
      );
    }

    saveDatabase();
    console.log(`⚓ Voyage log override: ${student_name} (${class_period}) set to ${tier} — code: ${crew_code}`);
    res.json({ success: true, crew_code, rank_tier: tier, rewards });

  } catch (err) {
    console.error('Voyage log override error:', err);
    res.status(500).json({ error: 'Failed to set override' });
  }
});

// ══════════════════════════════════════════════════════════
// VOYAGE LOG — SAVE/LOAD PROGRESS (resume across sessions)
// ══════════════════════════════════════════════════════════

// POST /api/voyage-log/save-progress — no JWT (standalone page)
app.post('/api/voyage-log/save-progress', (req, res) => {
  try {
    const { student_name, class_period, student_id, state } = req.body;
    if (!student_name || !class_period || !state) {
      return res.status(400).json({ error: 'student_name, class_period, and state required' });
    }

    const stateJson = JSON.stringify(state);
    const sid = student_id ? parseInt(student_id) : null;
    const existing = query(
      'SELECT student_name FROM voyage_log_progress WHERE student_name = ? AND class_period = ?',
      [student_name, class_period]
    );

    if (existing.length > 0) {
      if (sid !== null) {
        run(
          'UPDATE voyage_log_progress SET state_json = ?, student_id = ?, updated_at = CURRENT_TIMESTAMP WHERE student_name = ? AND class_period = ?',
          [stateJson, sid, student_name, class_period]
        );
      } else {
        run(
          'UPDATE voyage_log_progress SET state_json = ?, updated_at = CURRENT_TIMESTAMP WHERE student_name = ? AND class_period = ?',
          [stateJson, student_name, class_period]
        );
      }
    } else {
      run(
        'INSERT INTO voyage_log_progress (student_name, class_period, student_id, state_json) VALUES (?, ?, ?, ?)',
        [student_name, class_period, sid, stateJson]
      );
    }

    saveDatabase();
    res.json({ success: true });
  } catch (err) {
    console.error('Voyage log save-progress error:', err);
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

// GET /api/voyage-log/load-progress/:name/:period — no JWT (standalone page)
app.get('/api/voyage-log/load-progress/:name/:period', (req, res) => {
  try {
    const { name, period } = req.params;
    const rows = query(
      'SELECT state_json, updated_at FROM voyage_log_progress WHERE student_name = ? AND class_period = ?',
      [name, period]
    );

    if (rows.length > 0) {
      res.json({
        found: true,
        state: JSON.parse(rows[0].state_json),
        updated_at: rows[0].updated_at
      });
    } else {
      res.json({ found: false });
    }
  } catch (err) {
    console.error('Voyage log load-progress error:', err);
    res.json({ found: false });
  }
});

// ══════════════════════════════════════════════════════════
// VOYAGE LOG — CASCADING DROPDOWN LOGIN
// ══════════════════════════════════════════════════════════

// GET /api/voyage-log/period-alliances/:period — list alliances with non-ghost students
app.get('/api/voyage-log/period-alliances/:period', (req, res) => {
  try {
    const period = req.params.period;
    const alliances = query(`
      SELECT DISTINCT a.alliance_id, a.alliance_name
      FROM alliances a
      JOIN students s ON s.alliance_id = a.alliance_id
      WHERE s.class_period = ? AND (s.is_ghost = 0 OR s.is_ghost IS NULL)
        AND a.is_disbanded = 0
      ORDER BY a.alliance_name
    `, [period]);

    const independents = query(`
      SELECT student_id FROM students
      WHERE class_period = ? AND (alliance_id IS NULL) AND (is_ghost = 0 OR is_ghost IS NULL)
    `, [period]);

    if (independents.length > 0) {
      alliances.push({ alliance_id: 'independent', alliance_name: 'Independent' });
    }

    res.json({ alliances });
  } catch (err) {
    console.error('Voyage log period-alliances error:', err);
    res.json({ alliances: [], error: err.message });
  }
});

// GET /api/voyage-log/alliance-students/:period/:alliance_id — list non-ghost students
app.get('/api/voyage-log/alliance-students/:period/:alliance_id', (req, res) => {
  try {
    const { period, alliance_id } = req.params;
    let students;
    if (alliance_id === 'independent') {
      students = query(`
        SELECT student_id, name FROM students
        WHERE class_period = ? AND (alliance_id IS NULL) AND (is_ghost = 0 OR is_ghost IS NULL)
        ORDER BY name
      `, [period]);
    } else {
      students = query(`
        SELECT student_id, name FROM students
        WHERE class_period = ? AND alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)
        ORDER BY name
      `, [period, parseInt(alliance_id)]);
    }
    res.json({ students });
  } catch (err) {
    console.error('Voyage log alliance-students error:', err);
    res.json({ students: [], error: err.message });
  }
});

// GET /api/voyage-log/load-progress-by-id/:student_id — load by student_id (bulletproof)
// Falls back to name+period lookup for legacy saves and backfills student_id for next time.
app.get('/api/voyage-log/load-progress-by-id/:student_id', (req, res) => {
  try {
    const sid = parseInt(req.params.student_id);
    // Try student_id-based lookup first
    let rows = query(
      'SELECT state_json, updated_at FROM voyage_log_progress WHERE student_id = ?',
      [sid]
    );
    if (rows.length > 0) {
      return res.json({ found: true, state: JSON.parse(rows[0].state_json), updated_at: rows[0].updated_at });
    }
    // Fallback: name+period lookup (legacy saves from free-text login era)
    const stu = query('SELECT name, class_period FROM students WHERE student_id = ?', [sid]);
    if (stu.length > 0) {
      rows = query(
        'SELECT state_json, updated_at FROM voyage_log_progress WHERE student_name = ? AND class_period = ?',
        [stu[0].name, stu[0].class_period]
      );
      if (rows.length > 0) {
        // Migrate: backfill student_id for future lookups
        try {
          run('UPDATE voyage_log_progress SET student_id = ? WHERE student_name = ? AND class_period = ?',
            [sid, stu[0].name, stu[0].class_period]);
          saveDatabase();
        } catch(e) { /* backfill is best-effort, don't block the response */ }
        return res.json({ found: true, state: JSON.parse(rows[0].state_json), updated_at: rows[0].updated_at });
      }
    }
    res.json({ found: false });
  } catch (err) {
    console.error('Voyage log load-progress-by-id error:', err);
    res.json({ found: false });
  }
});

// ══════════════════════════════════════════════════════════
// VOYAGE LOG — PER-PERIOD UNLOCK CONTROL
// ══════════════════════════════════════════════════════════

// GET /api/voyage-log/unlocks/:period — no auth (voyage log is standalone)
// Returns which stop is unlocked for this period
app.get('/api/voyage-log/unlocks/:period', (req, res) => {
  try {
    const { period } = req.params;
    const rows = query(
      'SELECT unlocked_up_to FROM voyage_log_unlocks WHERE class_period = ?',
      [period]
    );
    const unlocked = (rows.length > 0 && rows[0].unlocked_up_to !== null)
      ? rows[0].unlocked_up_to : -1;
    res.json({ period, unlocked_up_to: unlocked });
  } catch (err) {
    // Table may not exist yet — return -1
    res.json({ period: req.params.period, unlocked_up_to: -1 });
  }
});

// POST /api/teacher/voyage-log-unlock — teacher sets unlock level for a period
app.post('/api/teacher/voyage-log-unlock', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
    const { class_period, unlock_up_to } = req.body;

    if (!class_period || unlock_up_to === undefined) {
      return res.status(400).json({ error: 'class_period and unlock_up_to required' });
    }

    // Upsert the unlock level
    const existing = query(
      'SELECT class_period FROM voyage_log_unlocks WHERE class_period = ?',
      [class_period]
    );
    if (existing.length > 0) {
      run('UPDATE voyage_log_unlocks SET unlocked_up_to = ? WHERE class_period = ?',
        [unlock_up_to, class_period]);
    } else {
      run('INSERT INTO voyage_log_unlocks (class_period, unlocked_up_to) VALUES (?, ?)',
        [class_period, unlock_up_to]);
    }

    saveDatabase();
    console.log(`⚓ Voyage unlock: ${class_period} → stop ${unlock_up_to}`);
    res.json({ success: true, class_period, unlocked_up_to: unlock_up_to });

  } catch (err) {
    console.error('Voyage log unlock error:', err);
    res.status(500).json({ error: 'Failed to set unlock' });
  }
});

// GET /api/teacher/voyage-log-unlock-status — returns all periods' unlock state
// No auth required — this is read-only display state
app.get('/api/teacher/voyage-log-unlock-status', (req, res) => {
  try {
    const rows = query('SELECT class_period, unlocked_up_to FROM voyage_log_unlocks ORDER BY class_period');
    res.json({ unlocks: rows });
  } catch (err) {
    res.json({ unlocks: [] });
  }
});

// ============================================================
// HEROIC AGE — CHAPTER PROGRESS ENDPOINTS (V99)
// ============================================================

// Helper: award a heroic badge by badge_id if it exists in badges_ref
function awardHeroicBadge(student_id, badge_id) {
  try {
    const badge = query('SELECT badge_id FROM badges_ref WHERE badge_id = ?', [badge_id])[0];
    if (!badge) return false;
    run(
      `INSERT OR IGNORE INTO student_badges (student_id, badge_id, ring_level, claimed, awarded_by)
       VALUES (?, ?, 1, 0, 'system')`,
      [student_id, badge_id]
    );
    return true;
  } catch(e) {
    console.error('awardHeroicBadge error:', e.message);
    return false;
  }
}

// GET /api/heroic/my-state — Student loads their own chapter 1 progress
app.get('/api/heroic/my-state', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'student') return res.status(403).json({ error: 'Students only' });
    const student_id = req.user.id;

    const progress = query(
      'SELECT * FROM heroic_progress WHERE student_id = ? AND chapter = 1',
      [student_id]
    )[0];

    const choices = query(
      'SELECT choice_key, choice_value, text_response, timestamp FROM heroic_choices WHERE student_id = ? AND chapter = 1 ORDER BY timestamp ASC',
      [student_id]
    );

    // Check voyage log gate
    const student = query(
      'SELECT voyage_log_completed, selected_avatar, drachma FROM students WHERE student_id = ?',
      [student_id]
    )[0];

    res.json({
      voyage_log_completed: student ? (student.voyage_log_completed || 0) : 0,
      selected_avatar: student ? (student.selected_avatar || null) : null,
      drachma: student ? (student.drachma || 0) : 0,
      progress: progress || null,
      choices: choices || []
    });
  } catch(err) {
    console.error('heroic/my-state error:', err);
    res.status(500).json({ error: 'Failed to load heroic state' });
  }
});

// POST /api/heroic/checkpoint — Save waypoint progress (student)
app.post('/api/heroic/checkpoint', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'student') return res.status(403).json({ error: 'Students only' });
    const student_id = req.user.id;
    const { chapter, waypoint, state_json, honor_score, drachma_balance, equipment_tier } = req.body;

    if (!chapter || !waypoint || state_json === undefined) {
      return res.status(400).json({ error: 'chapter, waypoint, and state_json required' });
    }

    // Idempotency guard — do not overwrite a locked (completed) chapter
    const existing = query(
      'SELECT progress_id, locked FROM heroic_progress WHERE student_id = ? AND chapter = ?',
      [student_id, chapter]
    )[0];

    if (existing && existing.locked) {
      return res.status(409).json({ error: 'Chapter is locked — already completed' });
    }

    if (existing) {
      run(
        `UPDATE heroic_progress SET
           waypoint = ?, state_json = ?, honor_score = ?, drachma_balance = ?,
           equipment_tier = ?, updated_at = CURRENT_TIMESTAMP
         WHERE student_id = ? AND chapter = ?`,
        [
          waypoint,
          typeof state_json === 'string' ? state_json : JSON.stringify(state_json),
          honor_score || 0, drachma_balance || 0, equipment_tier || 1,
          student_id, chapter
        ]
      );
    } else {
      run(
        `INSERT INTO heroic_progress
           (student_id, chapter, waypoint, state_json, honor_score, drachma_balance, equipment_tier)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          student_id, chapter, waypoint,
          typeof state_json === 'string' ? state_json : JSON.stringify(state_json),
          honor_score || 0, drachma_balance || 0, equipment_tier || 1
        ]
      );
    }

    res.json({ success: true, waypoint, chapter });
  } catch(err) {
    console.error('heroic/checkpoint error:', err);
    res.status(500).json({ error: 'Failed to save checkpoint' });
  }
});

// POST /api/heroic/choice — Record a CYOA decision (student)
app.post('/api/heroic/choice', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'student') return res.status(403).json({ error: 'Students only' });
    const student_id = req.user.id;
    const { chapter, choice_key, choice_value, text_response } = req.body;

    if (!chapter || !choice_key || choice_value === undefined) {
      return res.status(400).json({ error: 'chapter, choice_key, and choice_value required' });
    }

    // Idempotency — do not re-record if chapter is locked
    const locked = query(
      'SELECT locked FROM heroic_progress WHERE student_id = ? AND chapter = ?',
      [student_id, chapter]
    )[0];
    if (locked && locked.locked) {
      return res.status(409).json({ error: 'Chapter is locked — choices cannot be changed' });
    }

    run(
      `INSERT INTO heroic_choices (student_id, chapter, choice_key, choice_value, text_response)
       VALUES (?, ?, ?, ?, ?)`,
      [student_id, chapter, choice_key, String(choice_value), text_response || null]
    );

    res.json({ success: true, choice_key, choice_value });
  } catch(err) {
    console.error('heroic/choice error:', err);
    res.status(500).json({ error: 'Failed to record choice' });
  }
});

// POST /api/heroic/complete — Lock chapter, award badges (student)
app.post('/api/heroic/complete', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'student') return res.status(403).json({ error: 'Students only' });
    const student_id = req.user.id;
    const { chapter, final_state, honor_score, drachma_balance, equipment_tier } = req.body;

    if (!chapter) return res.status(400).json({ error: 'chapter required' });

    // Idempotency — already completed
    const existing = query(
      'SELECT progress_id, locked FROM heroic_progress WHERE student_id = ? AND chapter = ?',
      [student_id, chapter]
    )[0];

    if (existing && existing.locked) {
      return res.json({ success: true, already_complete: true, badges_awarded: [] });
    }

    const finalStateStr = typeof final_state === 'string' ? final_state : JSON.stringify(final_state || {});

    if (existing) {
      run(
        `UPDATE heroic_progress SET
           waypoint = 'COMPLETE', state_json = ?, honor_score = ?, drachma_balance = ?,
           equipment_tier = ?, completed = 1, completed_at = CURRENT_TIMESTAMP,
           locked = 1, updated_at = CURRENT_TIMESTAMP
         WHERE student_id = ? AND chapter = ?`,
        [finalStateStr, honor_score || 0, drachma_balance || 0, equipment_tier || 1, student_id, chapter]
      );
    } else {
      run(
        `INSERT INTO heroic_progress
           (student_id, chapter, waypoint, state_json, honor_score, drachma_balance,
            equipment_tier, completed, completed_at, locked)
         VALUES (?, ?, 'COMPLETE', ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, 1)`,
        [student_id, chapter, finalStateStr, honor_score || 0, drachma_balance || 0, equipment_tier || 1]
      );
    }

    // Award badges based on chapter 1 outcomes
    const badges_awarded = [];
    if (chapter === 1) {
      // The Argonaut — chapter completion
      if (awardHeroicBadge(student_id, 'heroic_argonaut')) badges_awarded.push('heroic_argonaut');

      // Captain's Oath — Honor ≥ 10
      if ((honor_score || 0) >= 10) {
        if (awardHeroicBadge(student_id, 'heroic_captains_oath')) badges_awarded.push('heroic_captains_oath');
      }

      // The Negotiator — Cunning 12+ path used at Betrayal Fork
      const negotiatorChoice = query(
        `SELECT choice_value FROM heroic_choices
         WHERE student_id = ? AND chapter = 1 AND choice_key = 'betrayal_fork'`,
        [student_id]
      )[0];
      if (negotiatorChoice && negotiatorChoice.choice_value === 'negotiate') {
        if (awardHeroicBadge(student_id, 'heroic_negotiator')) badges_awarded.push('heroic_negotiator');
      }

      // Golden Fleece — no checkpoint rollbacks (tracked in state_json)
      try {
        const state = JSON.parse(finalStateStr);
        if (state.checkpoint_rollbacks === 0) {
          if (awardHeroicBadge(student_id, 'heroic_golden_fleece')) badges_awarded.push('heroic_golden_fleece');
        }
      } catch(e) {}
    }

    console.log(`✅ Chapter ${chapter} completed by student ${student_id} — badges: ${badges_awarded.join(', ') || 'none'}`);
    res.json({ success: true, badges_awarded, honor_score: honor_score || 0 });
  } catch(err) {
    console.error('heroic/complete error:', err);
    res.status(500).json({ error: 'Failed to complete chapter' });
  }
});

// GET /api/heroic/alliance-avatars — Teammate avatar passive bonuses (student)
app.get('/api/heroic/alliance-avatars', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'student') return res.status(403).json({ error: 'Students only' });
    const student_id = req.user.id;

    const self = query(
      'SELECT alliance_id FROM students WHERE student_id = ?',
      [student_id]
    )[0];

    if (!self || !self.alliance_id) {
      return res.json({ teammates: [], passives: {} });
    }

    // Get alliance members excluding self and ghosts
    const teammates = query(
      `SELECT student_id, name, selected_avatar
       FROM students
       WHERE alliance_id = ? AND student_id != ?
         AND (is_ghost = 0 OR is_ghost IS NULL)`,
      [self.alliance_id, student_id]
    );

    // Build passive bonus map — each unique avatar type contributes once
    const seenAvatarTypes = new Set();
    const passives = {};

    const AVATAR_PASSIVES = {
      seeker:   { key: 'free_path_exploration',   label: '+1 free path exploration' },
      fallen:   { key: 'starting_drachma_pct',    label: '+5% starting Drachma' },
      devoted:  { key: 'crew_loyalty_buffer',      label: '+1 crew loyalty buffer' },
      mirror:   { key: 'npc_dialogue_hint',        label: '1 NPC dialogue hint per chapter' },
      builder:  { key: 'equipment_durability',     label: 'Starting equipment +1 durability' },
      tested:   { key: 'honor_start_bonus',        label: '+2 Honor at chapter start' },
      eternal:  { key: 'first_oracle_free',        label: 'First Oracle visit free' }
    };

    teammates.forEach(t => {
      if (!t.selected_avatar) return;
      const avatarType = t.selected_avatar.split('_')[0].toLowerCase(); // e.g. 'fallen' from 'fallen_male_dark'
      if (seenAvatarTypes.has(avatarType)) return; // no stacking
      seenAvatarTypes.add(avatarType);
      const passive = AVATAR_PASSIVES[avatarType];
      if (passive) passives[passive.key] = passive.label;
    });

    res.json({
      teammates: teammates.map(t => ({
        name: t.name,
        avatar: t.selected_avatar,
        avatar_type: t.selected_avatar ? t.selected_avatar.split('_')[0].toLowerCase() : null
      })),
      passives
    });
  } catch(err) {
    console.error('heroic/alliance-avatars error:', err);
    res.status(500).json({ error: 'Failed to load alliance avatars' });
  }
});

// GET /api/heroic/state/:studentId — Teacher views a student's progress
app.get('/api/heroic/state/:studentId', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
    const student_id = parseInt(req.params.studentId);
    if (!student_id) return res.status(400).json({ error: 'Invalid student ID' });

    const student = query(
      `SELECT student_id, name, class_period, alliance_id, selected_avatar,
              voyage_log_completed, drachma, voyage_rank_tier
       FROM students WHERE student_id = ?`,
      [student_id]
    )[0];
    if (!student) return res.status(404).json({ error: 'Student not found' });

    const progress = query(
      'SELECT * FROM heroic_progress WHERE student_id = ? AND chapter = 1',
      [student_id]
    )[0];

    const choices = query(
      'SELECT choice_key, choice_value, text_response, timestamp FROM heroic_choices WHERE student_id = ? AND chapter = 1 ORDER BY timestamp ASC',
      [student_id]
    );

    res.json({ student, progress: progress || null, choices: choices || [] });
  } catch(err) {
    console.error('heroic/state teacher error:', err);
    res.status(500).json({ error: 'Failed to load student heroic state' });
  }
});

// GET /api/teacher/heroic-chapter-progress — Period overview for teacher gradebook
app.get('/api/teacher/heroic-chapter-progress', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teachers only' });
    const { period } = req.query;

    let studentQuery = `
      SELECT s.student_id, s.name, s.class_period, s.selected_avatar,
             s.voyage_log_completed, s.drachma, s.voyage_rank_tier,
             hp.waypoint, hp.honor_score, hp.drachma_balance,
             hp.equipment_tier, hp.completed, hp.completed_at, hp.locked
      FROM students s
      LEFT JOIN heroic_progress hp ON s.student_id = hp.student_id AND hp.chapter = 1
      WHERE s.current_age = 'heroic'
        AND (s.is_ghost = 0 OR s.is_ghost IS NULL)
    `;
    const params = [];
    if (period && period !== 'all') {
      studentQuery += ' AND s.class_period = ?';
      params.push(period);
    }
    studentQuery += ' ORDER BY s.class_period, s.name';

    const students = query(studentQuery, params);

    // For each completed student, pull their Medea choice
    const completedIds = students.filter(s => s.completed).map(s => s.student_id);
    const medea_choices = {};
    if (completedIds.length > 0) {
      const placeholders = completedIds.map(() => '?').join(',');
      const choices = query(
        `SELECT student_id, choice_value FROM heroic_choices
         WHERE chapter = 1 AND choice_key = 'betrayal_fork'
           AND student_id IN (${placeholders})`,
        completedIds
      );
      choices.forEach(c => { medea_choices[c.student_id] = c.choice_value; });
    }

    const rows = students.map(s => ({
      student_id: s.student_id,
      name: s.name,
      class_period: s.class_period,
      selected_avatar: s.selected_avatar,
      voyage_log_completed: s.voyage_log_completed || 0,
      waypoint: s.waypoint || null,
      honor_score: s.honor_score || null,
      drachma_remaining: s.drachma_balance || null,
      equipment_tier: s.equipment_tier || null,
      completed: s.completed || 0,
      completed_at: s.completed_at || null,
      medea_choice: medea_choices[s.student_id] || null
    }));

    // Summary stats per period
    const periods = {};
    rows.forEach(r => {
      if (!periods[r.class_period]) {
        periods[r.class_period] = { total: 0, voyage_done: 0, started: 0, completed: 0 };
      }
      periods[r.class_period].total++;
      if (r.voyage_log_completed) periods[r.class_period].voyage_done++;
      if (r.waypoint) periods[r.class_period].started++;
      if (r.completed) periods[r.class_period].completed++;
    });

    res.json({ students: rows, summary: periods });
  } catch(err) {
    console.error('heroic-chapter-progress error:', err);
    res.status(500).json({ error: 'Failed to load heroic chapter progress' });
  }
});

// ============================================================
// END HEROIC AGE CHAPTER ENDPOINTS
// ============================================================

// ============================================================
// REVENGE OF THE GODS — /api/olympus/*
// ============================================================

const ROUND_1_PATHS = [
  { idx:0, label:'Climb the Mountain', god:'Artemis',   attack:365, hook:'Army of enchanted forest animals overwhelm you',    safe:false },
  { idx:1, label:'Hide in the Forest',  god:'Athena',    attack:295, hook:'Magic blanket trap — escape before transformation', safe:false },
  { idx:2, label:'Sail Across the Sea', god:'Apollo',    attack:325, hook:'Seagulls screech a divine alarm',                   safe:false },
  { idx:3, label:'Walk Through Desert', god:'Zeus',      attack:400, hook:'Aerokinesis sandstorm buries your alliance',         safe:false },
  { idx:4, label:'Attack Head On',      god:'Aphrodite', attack:405, hook:'Hearts and flowers disarm you',                     safe:false },
  { idx:5, label:'Make an Alliance',    god:null,        attack:0,   hook:'You were out of town. Advance without combat.',     safe:true  }
];

const ROUND_2_PATHS = [
  { idx:0, label:'Build Spears and Swords', god:'Hades',   attack:550, hook:'The dead rise to reclaim the weapons you forged',      safe:false },
  { idx:1, label:'Hide in Cover of Night',  god:'Hades',   attack:570, hook:'Darkness becomes a tomb — Hades traps you in shadow',  safe:false },
  { idx:2, label:'Dig a Tunnel',            god:'Demeter', attack:510, hook:'The earth shifts and swallows your passage whole',      safe:false },
  { idx:3, label:'Seek a Cyclops',          god:'Cyclops', attack:600, hook:'One eye. One club. Zero mercy.',                        safe:false },
  { idx:4, label:'Hide Among the Injured',  god:'Ares',    attack:520, hook:'Ares sees through your disguise and strikes harder',    safe:false },
  { idx:5, label:'Capture Fire',            god:null,      attack:0,   hook:'You steal Prometheus\'s flame. Advance without combat.',safe:true  }
];

const ROUND_3_PATHS = [
  { idx:0, label:'Build a Catapult',       god:'Hephaestus', attack:700, hook:'Your own siege engine turns against you',                   safe:false },
  { idx:1, label:'Steal Medea\'s Potion',  god:'Zeus',       attack:690, hook:'Zeus strikes you down for betraying his protected guest',    safe:false },
  { idx:2, label:'Take Hephaestus\'s Forge',god:'Poseidon',  attack:680, hook:'The sea god floods the forge — and you with it',            safe:false },
  { idx:3, label:'Follow Orpheus',         god:'Hades',      attack:710, hook:'You look back. Everything is lost.',                         safe:false },
  { idx:4, label:'Find Medusa\'s Head',    god:'Ares',       attack:710, hook:'Ares intercepts you. The head turns you to stone.',          safe:false },
  { idx:5, label:'Make a Sacrifice',       god:null,         attack:0,   hook:'The gods accept your offering. Advance without combat.',     safe:true  }
];

const ROUND_4_PATHS = [
  { idx:0, label:'Bring Back the Minotaur',god:'Colchis Army', attack:800, hook:'The Colchis army arrives to defend their monster',         safe:false },
  { idx:1, label:'Visit the Oracle',       god:'Apollo',       attack:810, hook:'Apollo punishes you for misusing the prophecy',             safe:false },
  { idx:2, label:'Return Fire to the Gods',god:'Fire',         attack:880, hook:'The flames answer to no one — least of all you',           safe:false },
  { idx:3, label:'Trap the Gods',          god:'Nymphs',       attack:830, hook:'The nymphs free the gods, who punish you personally',       safe:false },
  { idx:4, label:'Create a Disguise',      god:'Apollo',       attack:810, hook:'Apollo sees through every disguise — it\'s literally his power', safe:false },
  { idx:5, label:'Ally With the Titans',   god:null,           attack:0,   hook:'Ancient enemies become unexpected allies. Advance without combat.', safe:true }
];

const ROUND_5_PATHS = [
  { idx:0, label:'Night of the Living Dead', god:'Multiple', attack:1000, hook:'Every fallen hero you ever faced rises at once',               safe:false },
  { idx:1, label:'Travel to End of Rainbow', god:'Iris',     attack:1100, hook:'Iris dissolves your path into color — you fall endlessly',     safe:false },
  { idx:2, label:'Phaethon For a Day',        god:'Zeus',     attack:1200, hook:'You lose control of the sun chariot. Zeus finishes the job.',  safe:false },
  { idx:3, label:'Make a Wish',               god:'Hecate',   attack:1400, hook:'Hecate grants your wish — then inverts it',                    safe:false },
  { idx:4, label:'Capture Echo',              god:'Nemesis',  attack:1400, hook:'Nemesis reflects your every blow back at double strength',     safe:false },
  { idx:5, label:'It Was All Just a Dream',   god:'Hypnos',   attack:1600, hook:'You wake up — at the bottom of the mountain. Start over.',    safe:false }
];

// Lookup by round number — used by paths endpoint and commit-path
const ROUND_PATHS = {
  1: ROUND_1_PATHS,
  2: ROUND_2_PATHS,
  3: ROUND_3_PATHS,
  4: ROUND_4_PATHS,
  5: ROUND_5_PATHS
};

// ── helpers ──────────────────────────────────────────────────────────────────

function getAllianceForStudent(studentId) {
  const rows = query(
    `SELECT a.alliance_id, a.alliance_name AS name, a.total_points, a.class_period
     FROM alliances a
     JOIN students s ON s.alliance_id = a.alliance_id
     WHERE s.student_id = ?`,
    [studentId]
  );
  return rows[0] || null;
}

function getOlympusState(allianceId) {
  const rows = query('SELECT * FROM olympus_race_state WHERE alliance_id = ?', [allianceId]);
  return rows[0] || null;
}

function getMajority(allianceId, round, voteType) {
  // Returns { winner, count, total } or null if no majority
  // Uses present_members from race state if set (absent student handling),
  // otherwise falls back to all non-ghost members.
  const state = getOlympusState(allianceId);
  let total;
  if (state && state.present_members) {
    const presentIds = JSON.parse(state.present_members);
    total = presentIds.length || 1;
  } else {
    const members = query(
      `SELECT COUNT(*) as cnt FROM students s
       WHERE s.alliance_id = ? AND (s.is_ghost = 0 OR s.is_ghost IS NULL)`,
      [allianceId]
    );
    total = members[0] ? members[0].cnt : 1;
  }
  const votes = query(
    `SELECT vote_value, COUNT(*) as cnt FROM olympus_votes
     WHERE alliance_id = ? AND round_number = ? AND vote_type = ?
     GROUP BY vote_value ORDER BY cnt DESC`,
    [allianceId, round, voteType]
  );
  if (!votes.length) return null;
  const needed = Math.floor(total / 2) + 1;
  if (votes[0].cnt >= needed) return { winner: votes[0].vote_value, count: votes[0].cnt, total };
  // Tie-break: if all members voted and no majority, pick leader vote
  const totalVotes = votes.reduce((s, v) => s + v.cnt, 0);
  if (totalVotes >= total) return { winner: votes[0].vote_value, count: votes[0].cnt, total, tiebreak: true };
  return null;
}

// ── GET /api/olympus/state ────────────────────────────────────────────────────
app.get('/api/olympus/state', authenticateToken, (req, res) => {
  try {
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    const state = getOlympusState(alliance.alliance_id);
    res.json({ alliance, state });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/olympus/start ───────────────────────────────────────────────────
app.post('/api/olympus/start', authenticateToken, (req, res) => {
  try {
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    const existing = getOlympusState(alliance.alliance_id);
    if (existing) return res.json({ state: existing, created: false });
    run(
      `INSERT INTO olympus_race_state (alliance_id, period, current_round, current_phase)
       VALUES (?, ?, 0, 'opening')`,
      [alliance.alliance_id, alliance.class_period]
    );
    const state = getOlympusState(alliance.alliance_id);
    res.json({ state, created: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/olympus/scoreboard/:period ──────────────────────────────────────
app.get('/api/olympus/scoreboard/:period', authenticateToken, (req, res) => {
  try {
    const { period } = req.params;
    const alliances = query(
      `SELECT a.alliance_id, a.alliance_name AS name, a.total_points,
              COALESCE(o.current_round, 0) as current_round,
              COALESCE(o.current_phase, 'not_started') as current_phase,
              COALESCE(o.ghost_runner_mode, 0) as ghost_runner_mode
       FROM alliances a
       LEFT JOIN olympus_race_state o ON o.alliance_id = a.alliance_id
       WHERE a.class_period = ?
       ORDER BY COALESCE(o.current_round,0) DESC, a.total_points DESC`,
      [period]
    );
    res.json({ period, alliances });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/olympus/medea-vote ──────────────────────────────────────────────
app.post('/api/olympus/medea-vote', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { choice } = req.body; // 'accept' | 'refuse'
    if (!['accept','refuse'].includes(choice)) return res.status(400).json({ error: 'Invalid choice' });
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    run(
      `INSERT INTO olympus_votes (alliance_id, student_id, round_number, vote_type, vote_value)
       VALUES (?,?,0,'medea',?)
       ON CONFLICT(alliance_id, student_id, round_number, vote_type) DO UPDATE SET vote_value=excluded.vote_value`,
      [alliance.alliance_id, req.user.id, choice]
    );
    const tally = query(
      `SELECT vote_value, COUNT(*) as cnt FROM olympus_votes
       WHERE alliance_id = ? AND round_number = 0 AND vote_type = 'medea'
       GROUP BY vote_value`,
      [alliance.alliance_id]
    );
    const majority = getMajority(alliance.alliance_id, 0, 'medea');
    res.json({ tally, majority });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/olympus/medea-commit ────────────────────────────────────────────
app.post('/api/olympus/medea-commit', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') return res.status(403).json({ error: 'Forbidden' });
  try {
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    const majority = getMajority(alliance.alliance_id, 0, 'medea');
    if (!majority) return res.status(400).json({ error: 'No majority yet' });
    const state = getOlympusState(alliance.alliance_id);
    if (!state) return res.status(400).json({ error: 'Race not started' });
    if (state.current_phase !== 'opening' && state.current_phase !== 'medea_moment') {
      return res.status(400).json({ error: 'Medea moment already resolved' });
    }
    // Record each voter's choice in olympus_medea_choices
    const votes = query(
      `SELECT student_id FROM olympus_votes
       WHERE alliance_id = ? AND round_number = 0 AND vote_type = 'medea'`,
      [alliance.alliance_id]
    );
    for (const v of votes) {
      run(
        `INSERT OR IGNORE INTO olympus_medea_choices
         (student_id, alliance_id, period, version, choice)
         VALUES (?,?,?,?,?)`,
        [v.student_id, alliance.alliance_id, state.period, state.version, majority.winner]
      );
    }
    run(
      `UPDATE olympus_race_state SET current_round=1, current_phase='path_choice'
       WHERE alliance_id=?`,
      [alliance.alliance_id]
    );
    res.json({ committed: true, choice: majority.winner });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/olympus/paths/:round ─────────────────────────────────────────────
app.get('/api/olympus/paths/:round', authenticateToken, (req, res) => {
  try {
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    const state = getOlympusState(alliance.alliance_id);
    if (!state) return res.status(400).json({ error: 'Race not started' });
    const round = parseInt(req.params.round);
    const locks = query(
      `SELECT path_index, alliance_id, alliance_name FROM olympus_path_locks
       WHERE period=? AND version=? AND round_number=?`,
      [state.period, state.version, round]
    );
    const lockMap = {};
    locks.forEach(l => { lockMap[l.path_index] = { alliance_id: l.alliance_id, alliance_name: l.alliance_name }; });
    const pathDefs = ROUND_PATHS[round] || [];
    const paths = pathDefs.map(p => ({
      ...p,
      locked: !!lockMap[p.idx],
      locked_by: lockMap[p.idx] || null,
      is_safe: p.safe  // never reveal which is safe via this flag in prod — kept for teacher diagnostic only
    }));
    // Include this alliance's current votes
    const myVotes = query(
      `SELECT vote_value FROM olympus_votes
       WHERE alliance_id=? AND round_number=? AND vote_type='path'`,
      [alliance.alliance_id, round]
    );
    res.json({ paths, my_vote: myVotes[0] ? myVotes[0].vote_value : null });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/olympus/vote-path ───────────────────────────────────────────────
app.post('/api/olympus/vote-path', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { path_index } = req.body;
    if (path_index === undefined) return res.status(400).json({ error: 'path_index required' });
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    const state = getOlympusState(alliance.alliance_id);
    if (!state) return res.status(400).json({ error: 'Race not started' });
    run(
      `INSERT INTO olympus_votes (alliance_id, student_id, round_number, vote_type, vote_value)
       VALUES (?,?,?,'path',?)
       ON CONFLICT(alliance_id, student_id, round_number, vote_type) DO UPDATE SET vote_value=excluded.vote_value`,
      [alliance.alliance_id, req.user.id, state.current_round, String(path_index)]
    );
    const tally = query(
      `SELECT vote_value, COUNT(*) as cnt FROM olympus_votes
       WHERE alliance_id=? AND round_number=? AND vote_type='path'
       GROUP BY vote_value`,
      [alliance.alliance_id, state.current_round]
    );
    const majority = getMajority(alliance.alliance_id, state.current_round, 'path');
    res.json({ tally, majority });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/olympus/commit-path ─────────────────────────────────────────────
app.post('/api/olympus/commit-path', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') return res.status(403).json({ error: 'Forbidden' });
  try {
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    const state = getOlympusState(alliance.alliance_id);
    if (!state) return res.status(400).json({ error: 'Race not started' });
    const majority = getMajority(alliance.alliance_id, state.current_round, 'path');
    if (!majority) return res.status(400).json({ error: 'No majority yet' });
    const pathIdx = parseInt(majority.winner);
    const roundPaths = ROUND_PATHS[state.current_round] || [];
    const pathDef = roundPaths[pathIdx];
    if (!pathDef) return res.status(400).json({ error: 'Invalid path' });
    // Attempt to claim the lock (UNIQUE constraint prevents double-claim)
    try {
      run(
        `INSERT INTO olympus_path_locks (period, version, round_number, path_index, alliance_id, alliance_name)
         VALUES (?,?,?,?,?,?)`,
        [state.period, state.version, state.current_round, pathIdx, alliance.alliance_id, alliance.name]
      );
    } catch(lockErr) {
      // Another alliance claimed this path first
      const claimer = query(
        `SELECT alliance_name FROM olympus_path_locks
         WHERE period=? AND version=? AND round_number=? AND path_index=?`,
        [state.period, state.version, state.current_round, pathIdx]
      );
      return res.status(409).json({
        error: 'Path already claimed',
        claimed_by: claimer[0] ? claimer[0].alliance_name : 'Another alliance'
      });
    }
    // Advance to combat phase
    run(
      `UPDATE olympus_race_state SET current_phase='combat' WHERE alliance_id=?`,
      [alliance.alliance_id]
    );
    res.json({ committed: true, path: pathDef });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/olympus/combat-ready ───────────────────────────────────────────
// Marks a student as ready to roll. When all present members are ready,
// combat is resolved once and the result stored on olympus_race_state.
// Returns { waiting: true, ready_count, needed } while waiting,
// or { resolved: true, ...combatResult } when all are ready.
app.post('/api/olympus/combat-ready', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') return res.status(403).json({ error: 'Forbidden' });
  try {
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    const state = getOlympusState(alliance.alliance_id);

    // If combat is already resolved (phase moved on), return stored result
    if (state && state.current_phase !== 'combat') {
      if (state.combat_result) {
        return res.json(Object.assign({ resolved: true }, JSON.parse(state.combat_result)));
      }
      return res.json({ resolved: true, already_advanced: true });
    }

    if (!state || state.current_phase !== 'combat') {
      return res.status(400).json({ error: 'Not in combat phase' });
    }

    // Record this student as ready
    const readyFlags = state.combat_ready_flags ? JSON.parse(state.combat_ready_flags) : [];
    if (!readyFlags.includes(req.user.id)) {
      readyFlags.push(req.user.id);
      run(
        `UPDATE olympus_race_state SET combat_ready_flags=? WHERE alliance_id=?`,
        [JSON.stringify(readyFlags), alliance.alliance_id]
      );
    }

    // Determine how many present members we need
    const presentIds = state.present_members ? JSON.parse(state.present_members) : null;
    let needed;
    if (presentIds) {
      needed = presentIds.length;
    } else {
      const memberRows = query(
        `SELECT COUNT(*) as cnt FROM students
         WHERE alliance_id=? AND (is_ghost=0 OR is_ghost IS NULL)`,
        [alliance.alliance_id]
      );
      needed = memberRows[0] ? memberRows[0].cnt : 1;
    }

    const readyCount = readyFlags.length;

    // Not everyone ready yet — return waiting state
    if (readyCount < needed) {
      return res.json({ waiting: true, ready_count: readyCount, needed });
    }

    // ── All present members ready — resolve combat now ────────────────────────
    // Re-fetch state to guard against race condition where another request
    // already resolved combat between our ready-flag write and this check.
    const freshState = getOlympusState(alliance.alliance_id);
    if (freshState.current_phase !== 'combat') {
      if (freshState.combat_result) {
        return res.json(Object.assign({ resolved: true }, JSON.parse(freshState.combat_result)));
      }
      return res.json({ resolved: true, already_advanced: true });
    }

    // Find the committed path for this round
    const lock = query(
      `SELECT path_index FROM olympus_path_locks
       WHERE alliance_id=? AND round_number=?`,
      [alliance.alliance_id, freshState.current_round]
    );
    if (!lock.length) return res.status(400).json({ error: 'No committed path found' });

    const roundPaths = ROUND_PATHS[freshState.current_round] || ROUND_1_PATHS;
    const path = roundPaths[lock[0].path_index];
    const pointsBefore = alliance.total_points;
    let deducted = 0;
    let phoenixTriggered = 0;
    let hadesTriggered = 0;
    let nextPhase = 'puzzle';

    if (!path.safe) {
      deducted = Math.min(path.attack, pointsBefore);
      let newTotal = pointsBefore - deducted;
      if (newTotal === 0) {
        if (!freshState.phoenix_feather_used) {
          newTotal = 1;
          deducted = pointsBefore - 1;
          phoenixTriggered = 1;
          run(`UPDATE olympus_race_state SET phoenix_feather_used=1 WHERE alliance_id=?`,
            [alliance.alliance_id]);
        } else {
          hadesTriggered = 1;
          nextPhase = 'hades_waiting';
          run(
            `UPDATE olympus_race_state SET hades_visits=hades_visits+1, current_phase='hades_waiting'
             WHERE alliance_id=?`,
            [alliance.alliance_id]
          );
        }
      }
      run(`UPDATE alliances SET total_points=? WHERE alliance_id=?`,
        [newTotal, alliance.alliance_id]);
    }

    // Log combat
    const finalTotal = !path.safe
      ? (query(`SELECT total_points FROM alliances WHERE alliance_id=?`,
          [alliance.alliance_id])[0] || {}).total_points
      : pointsBefore;

    run(
      `INSERT INTO olympus_combat_log
       (alliance_id, round_number, god_name, attack_value, points_before,
        points_deducted, points_after, phoenix_triggered, hades_triggered)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [alliance.alliance_id, freshState.current_round, path.god || 'None',
       path.attack, pointsBefore, deducted, finalTotal,
       phoenixTriggered, hadesTriggered]
    );

    // Build result object — stored on state so late-arriving members can fetch it
    const combatResult = {
      path,
      safe_path:        path.safe || false,
      points_before:    pointsBefore,
      points_deducted:  deducted,
      points_after:     finalTotal,
      phoenix_triggered: phoenixTriggered,
      hades_triggered:   hadesTriggered,
      next_phase:        nextPhase
    };

    // Advance phase and store result, clear ready flags
    if (!hadesTriggered) {
      run(
        `UPDATE olympus_race_state
         SET current_phase='puzzle', combat_result=?, combat_ready_flags=NULL
         WHERE alliance_id=?`,
        [JSON.stringify(combatResult), alliance.alliance_id]
      );
    } else {
      run(
        `UPDATE olympus_race_state
         SET combat_result=?, combat_ready_flags=NULL
         WHERE alliance_id=?`,
        [JSON.stringify(combatResult), alliance.alliance_id]
      );
    }

    res.json(Object.assign({ resolved: true }, combatResult));
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/olympus/combat-result ───────────────────────────────────────────
// Polling endpoint for students waiting for combat to resolve.
// Returns { pending: true } if combat not yet resolved,
// or { resolved: true, ...combatResult } when done.
app.get('/api/olympus/combat-result', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') return res.status(403).json({ error: 'Forbidden' });
  try {
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    const state = getOlympusState(alliance.alliance_id);
    if (!state) return res.status(400).json({ error: 'Race not started' });

    if (state.current_phase === 'combat' && !state.combat_result) {
      // Still waiting — include ready count for display
      const readyFlags = state.combat_ready_flags ? JSON.parse(state.combat_ready_flags) : [];
      const presentIds = state.present_members ? JSON.parse(state.present_members) : null;
      let needed;
      if (presentIds) {
        needed = presentIds.length;
      } else {
        const memberRows = query(
          `SELECT COUNT(*) as cnt FROM students
           WHERE alliance_id=? AND (is_ghost=0 OR is_ghost IS NULL)`,
          [alliance.alliance_id]
        );
        needed = memberRows[0] ? memberRows[0].cnt : 1;
      }
      return res.json({ pending: true, ready_count: readyFlags.length, needed });
    }

    if (state.combat_result) {
      return res.json(Object.assign({ resolved: true }, JSON.parse(state.combat_result)));
    }

    // Phase has moved on without a stored result (shouldn't happen, but handle gracefully)
    return res.json({ resolved: true, already_advanced: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/olympus/combat-resolve (retired) ────────────────────────────────
// Replaced by combat-ready + combat-result. Kept to surface a clear error
// if any stale client calls this endpoint.
app.post('/api/olympus/combat-resolve', authenticateToken, (req, res) => {
  res.status(410).json({
    error: 'combat-resolve is retired. Use POST /api/olympus/combat-ready instead.'
  });
});



// ── Puzzle Room constants ─────────────────────────────────────────────────────
const PUZZLE_DATA = {
  1: {
    correctGateAnswer: 'pandora',
    correctCipherAnswer: 'box',
    secretWord: 'BOX',
    gateHint: 'She was the first woman, created by the gods and given a jar — or box — she was told never to open.',
    cipherHint: 'The answer starts with the letter B'
  },
  2: {
    correctGateAnswer: 'phaethon',
    correctCipherAnswer: 'chariot',
    secretWord: 'CHARIOT',
    gateHint: 'He was the son of Apollo who begged to drive the sun chariot — and lost control.',
    cipherHint: 'The cipher key: A=1, B=2, C=3... decode each number as a letter'
  },
  3: {
    correctGateAnswer: 'perseus',
    correctCipherAnswer: 'pegasus',
    secretWord: 'PEGASUS',
    gateHint: 'He used a mirrored shield to defeat a monster whose gaze turned men to stone.',
    cipherHint: 'Three letters decoded for you: P _ G _ S U S'
  },
  4: {
    correctGateAnswer: 'ariadne',
    correctCipherAnswer: 'labyrinth',
    secretWord: 'LABYRINTH',
    gateHint: 'She was the daughter of King Minos who gave the hero a ball of thread to navigate the labyrinth.',
    cipherHint: 'The Braille key is shown — use it to decode each dot pattern'
  }
};

// Levenshtein distance for fuzzy matching
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

// ── POST /api/olympus/gate-check ──────────────────────────────────────────────
app.post('/api/olympus/gate-check', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') return res.status(403).json({ error: 'Forbidden' });
  try {
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    const state = getOlympusState(alliance.alliance_id);
    if (!state || state.current_phase !== 'puzzle') return res.status(400).json({ error: 'Not in puzzle phase' });

    const round = state.current_round;
    const puzzle = PUZZLE_DATA[round];
    if (!puzzle) return res.status(400).json({ error: 'No puzzle for this round' });

    const answer = (req.body.answer || '').trim().toLowerCase();

    // Track attempts
    const attemptRow = query(
      `SELECT attempts FROM olympus_gate_attempts WHERE alliance_id=? AND round_number=?`,
      [alliance.alliance_id, round]
    );
    let attempts = attemptRow.length > 0 ? attemptRow[0].attempts : 0;
    attempts++;
    run(
      `INSERT INTO olympus_gate_attempts (alliance_id, round_number, attempts)
       VALUES (?, ?, 1)
       ON CONFLICT(alliance_id, round_number) DO UPDATE SET attempts=attempts+1`,
      [alliance.alliance_id, round]
    );

    const correct = puzzle.correctGateAnswer;
    const dist = levenshtein(answer, correct);

    if (dist === 0) {
      return res.json({ result: 'correct' });
    } else if (dist <= 2 && answer.length >= correct.length - 2) {
      return res.json({ result: 'close', attempts });
    } else {
      // After 3 wrong attempts, flag that hint is available for purchase
      return res.json({ result: 'wrong', attempts, hintAvailable: attempts >= 3 });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/olympus/hint-purchase ──────────────────────────────────────────
app.post('/api/olympus/hint-purchase', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') return res.status(403).json({ error: 'Forbidden' });
  try {
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    const state = getOlympusState(alliance.alliance_id);
    if (!state || state.current_phase !== 'puzzle') return res.status(400).json({ error: 'Not in puzzle phase' });

    const round = state.current_round;
    const { hint_type } = req.body; // 'gate' or 'cipher'
    if (!['gate', 'cipher'].includes(hint_type)) return res.status(400).json({ error: 'Invalid hint_type' });

    const puzzle = PUZZLE_DATA[round];
    if (!puzzle) return res.status(400).json({ error: 'No puzzle for this round' });

    // Check if already purchased (alliance-wide)
    const existing = query(
      `SELECT hint_id FROM olympus_hints WHERE alliance_id=? AND round_number=? AND hint_type=?`,
      [alliance.alliance_id, round, hint_type]
    );
    if (existing.length > 0) {
      // Already purchased — return hint text for free (they already paid)
      const hintText = hint_type === 'gate' ? puzzle.gateHint : puzzle.cipherHint;
      return res.json({ success: true, already_purchased: true, hint: hintText });
    }

    // Check Drachma on the purchasing student
    const studentRow = query(`SELECT drachma FROM students WHERE student_id=?`, [req.user.id]);
    if (!studentRow.length) return res.status(400).json({ error: 'Student not found' });
    const currentDrachma = studentRow[0].drachma || 0;
    const HINT_COST = 120;

    if (currentDrachma < HINT_COST) {
      return res.status(400).json({ error: 'Not enough Drachma', have: currentDrachma, need: HINT_COST });
    }

    // Deduct Drachma from the purchasing student
    run(`UPDATE students SET drachma = drachma - ? WHERE student_id=?`, [HINT_COST, req.user.id]);

    // Record purchase (alliance-wide so teammates see it too)
    run(
      `INSERT INTO olympus_hints (alliance_id, round_number, hint_type, drachma_cost)
       VALUES (?, ?, ?, ?)`,
      [alliance.alliance_id, round, hint_type, HINT_COST]
    );

    saveDatabase();

    const hintText = hint_type === 'gate' ? puzzle.gateHint : puzzle.cipherHint;
    res.json({ success: true, hint: hintText, drachma_spent: HINT_COST, drachma_remaining: currentDrachma - HINT_COST });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/olympus/hint-status ──────────────────────────────────────────────
app.get('/api/olympus/hint-status', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') return res.status(403).json({ error: 'Forbidden' });
  try {
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    const state = getOlympusState(alliance.alliance_id);
    if (!state) return res.status(400).json({ error: 'No race state' });

    const round = state.current_round;
    const puzzle = PUZZLE_DATA[round];
    const studentRow = query(`SELECT drachma FROM students WHERE student_id=?`, [req.user.id]);
    const drachma = studentRow.length ? (studentRow[0].drachma || 0) : 0;

    const purchased = query(
      `SELECT hint_type FROM olympus_hints WHERE alliance_id=? AND round_number=?`,
      [alliance.alliance_id, round]
    );
    const purchasedTypes = purchased.map(r => r.hint_type);

    const attemptRow = query(
      `SELECT attempts FROM olympus_gate_attempts WHERE alliance_id=? AND round_number=?`,
      [alliance.alliance_id, round]
    );
    const attempts = attemptRow.length ? attemptRow[0].attempts : 0;

    const result = { drachma, attempts, hints: {} };
    ['gate', 'cipher'].forEach(type => {
      const bought = purchasedTypes.includes(type);
      result.hints[type] = {
        purchased: bought,
        text: bought && puzzle ? (type === 'gate' ? puzzle.gateHint : puzzle.cipherHint) : null
      };
    });
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/olympus/puzzle-submit ──────────────────────────────────────────
app.post('/api/olympus/puzzle-submit', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') return res.status(403).json({ error: 'Forbidden' });
  try {
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    const state = getOlympusState(alliance.alliance_id);
    if (!state || state.current_phase !== 'puzzle') return res.status(400).json({ error: 'Not in puzzle phase' });

    const round = state.current_round;
    const puzzle = PUZZLE_DATA[round];
    if (!puzzle) return res.status(400).json({ error: 'No puzzle defined for round ' + round });

    const answer = (req.body.answer || '').trim().toLowerCase();
    const correct = puzzle.correctCipherAnswer;
    const dist = levenshtein(answer, correct);

    if (dist === 0) {
      // Correct — store secret word and advance phase
      const words = JSON.parse(state.secret_words || '[]');
      if (!words.includes(puzzle.secretWord)) words.push(puzzle.secretWord);
      run(
        `UPDATE olympus_race_state SET secret_words=?, current_phase='god_test' WHERE alliance_id=?`,
        [JSON.stringify(words), alliance.alliance_id]
      );
      saveDatabase();
      return res.json({ accepted: true, secret_word: puzzle.secretWord, words });
    } else if (dist <= 2 && answer.length >= correct.length - 2) {
      return res.json({ accepted: false, result: 'close' });
    } else {
      return res.json({ accepted: false, result: 'wrong' });
    }
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/olympus/godtest-submit ─────────────────────────────────────────
app.post('/api/olympus/godtest-submit', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') return res.status(403).json({ error: 'Forbidden' });
  try {
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    const state = getOlympusState(alliance.alliance_id);
    if (!state || state.current_phase !== 'god_test') return res.status(400).json({ error: 'Not in god_test phase' });
    const results = JSON.parse(state.god_test_results || '{}');
    const godOrder = ['Hermes','Hephaestus','Athena','Zeus','Hera'];
    const godName = godOrder[state.current_round - 1] || 'Unknown';
    results[godName] = { passed: true, round: state.current_round };
    const nextRound = state.current_round + 1;
    const nextPhase = nextRound > 5 ? 'summit' : 'path_choice';
    run(
      `UPDATE olympus_race_state SET god_test_results=?, current_round=?, current_phase=?
       WHERE alliance_id=?`,
      [JSON.stringify(results), nextRound, nextPhase, alliance.alliance_id]
    );
    res.json({ passed: true, god: godName, next_round: nextRound, next_phase: nextPhase });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/olympus/godtest-answer ─────────────────────────────────────────
// Records an individual student's answer to a Hermes gauntlet comprehension question.
// Non-blocking: the student always advances regardless of correctness.
// answer_value: string the student typed/selected
// question_idx: 0-based index of the question within this round's god test
app.post('/api/olympus/godtest-answer', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { question_idx, answer_value, correct_answer } = req.body;
    if (question_idx === undefined || !answer_value || !correct_answer) {
      return res.status(400).json({ error: 'question_idx, answer_value, and correct_answer required' });
    }
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    const state = getOlympusState(alliance.alliance_id);
    if (!state || state.current_phase !== 'god_test') {
      return res.status(400).json({ error: 'Not in god_test phase' });
    }
    // Normalise both sides: lowercase, trim, collapse whitespace
    const normalise = s => s.toLowerCase().trim().replace(/\s+/g, ' ');
    const is_correct = normalise(answer_value) === normalise(correct_answer) ? 1 : 0;
    run(
      `INSERT INTO olympus_godtest_answers
         (alliance_id, student_id, round_number, question_idx, answer_value, is_correct)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(alliance_id, student_id, round_number, question_idx)
         DO UPDATE SET answer_value=excluded.answer_value, is_correct=excluded.is_correct`,
      [alliance.alliance_id, req.user.id, state.current_round, question_idx, answer_value, is_correct]
    );
    res.json({ recorded: true, is_correct: !!is_correct });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/olympus/godtest-vote-fork ───────────────────────────────────────
// Cast a vote for one of the fork options during a god test path-choice moment.
// fork_idx: which fork in the test (0-based, Hermes has 3)
// vote_value: integer index of the chosen option
app.post('/api/olympus/godtest-vote-fork', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { fork_idx, vote_value } = req.body;
    if (fork_idx === undefined || vote_value === undefined) {
      return res.status(400).json({ error: 'fork_idx and vote_value required' });
    }
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    const state = getOlympusState(alliance.alliance_id);
    if (!state || state.current_phase !== 'god_test') {
      return res.status(400).json({ error: 'Not in god_test phase' });
    }
    run(
      `INSERT INTO olympus_godtest_votes
         (alliance_id, student_id, round_number, fork_idx, vote_value)
       VALUES (?,?,?,?,?)
       ON CONFLICT(alliance_id, student_id, round_number, fork_idx)
         DO UPDATE SET vote_value=excluded.vote_value`,
      [alliance.alliance_id, req.user.id, state.current_round, fork_idx, vote_value]
    );
    const tally = query(
      `SELECT vote_value, COUNT(*) as cnt
       FROM olympus_godtest_votes
       WHERE alliance_id=? AND round_number=? AND fork_idx=?
       GROUP BY vote_value ORDER BY cnt DESC`,
      [alliance.alliance_id, state.current_round, fork_idx]
    );
    const majority = getMajority_godtest(alliance.alliance_id, state.current_round, fork_idx);
    res.json({ tally, majority });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/olympus/godtest-commit-fork ─────────────────────────────────────
// Commits the majority fork vote and locks it against other alliances.
// Returns { committed, path_value, locked_by } or 409 if already locked.
app.post('/api/olympus/godtest-commit-fork', authenticateToken, (req, res) => {
  if (req.user.type !== 'student') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { fork_idx } = req.body;
    if (fork_idx === undefined) return res.status(400).json({ error: 'fork_idx required' });
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    const state = getOlympusState(alliance.alliance_id);
    if (!state || state.current_phase !== 'god_test') {
      return res.status(400).json({ error: 'Not in god_test phase' });
    }
    const majority = getMajority_godtest(alliance.alliance_id, state.current_round, fork_idx);
    if (!majority) return res.status(400).json({ error: 'No majority yet' });
    const pathValue = parseInt(majority.winner);
    // Attempt to claim the lock — UNIQUE constraint prevents race conditions
    try {
      run(
        `INSERT INTO olympus_godtest_locks
           (period, version, round_number, fork_idx, path_value, alliance_id, alliance_name)
         VALUES (?,?,?,?,?,?,?)`,
        [state.period, state.version, state.current_round, fork_idx, pathValue,
         alliance.alliance_id, alliance.name]
      );
    } catch(lockErr) {
      const claimer = query(
        `SELECT alliance_name FROM olympus_godtest_locks
         WHERE period=? AND version=? AND round_number=? AND fork_idx=? AND path_value=?`,
        [state.period, state.version, state.current_round, fork_idx, pathValue]
      );
      return res.status(409).json({
        error: 'Path already claimed',
        claimed_by: claimer[0] ? claimer[0].alliance_name : 'Another alliance'
      });
    }
    res.json({ committed: true, path_value: pathValue });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/olympus/godtest-fork-status ──────────────────────────────────────
// Returns locked paths for a specific round and fork so the client can
// grey out unavailable options before the student votes.
app.get('/api/olympus/godtest-fork-status', authenticateToken, (req, res) => {
  try {
    const alliance = getAllianceForStudent(req.user.id);
    if (!alliance) return res.status(400).json({ error: 'Not in an alliance' });
    const state = getOlympusState(alliance.alliance_id);
    if (!state) return res.status(400).json({ error: 'Race not started' });
    const { fork_idx } = req.query;
    if (fork_idx === undefined) return res.status(400).json({ error: 'fork_idx required' });
    const locks = query(
      `SELECT path_value, alliance_id, alliance_name FROM olympus_godtest_locks
       WHERE period=? AND version=? AND round_number=? AND fork_idx=?`,
      [state.period, state.version, state.current_round, parseInt(fork_idx)]
    );
    // What has THIS alliance already locked for this fork?
    const ownLock = locks.find(l => l.alliance_id === alliance.alliance_id);
    res.json({ locks, own_lock: ownLock || null });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── helper: getMajority for god test fork votes ───────────────────────────────
function getMajority_godtest(allianceId, round, forkIdx) {
  // Uses present_members from race state if set, else all non-ghost members.
  const state = getOlympusState(allianceId);
  let total;
  if (state && state.present_members) {
    const presentIds = JSON.parse(state.present_members);
    total = presentIds.length || 1;
  } else {
    const members = query(
      `SELECT COUNT(*) as cnt FROM students
       WHERE alliance_id=? AND (is_ghost=0 OR is_ghost IS NULL)`,
      [allianceId]
    );
    total = members[0] ? members[0].cnt : 1;
  }
  const votes = query(
    `SELECT vote_value, COUNT(*) as cnt FROM olympus_godtest_votes
     WHERE alliance_id=? AND round_number=? AND fork_idx=?
     GROUP BY vote_value ORDER BY cnt DESC`,
    [allianceId, round, forkIdx]
  );
  if (!votes.length) return null;
  const needed = Math.floor(total / 2) + 1;
  if (votes[0].cnt >= needed) {
    return { winner: votes[0].vote_value, count: votes[0].cnt, total };
  }
  // Tie-break: all members voted, pick plurality
  const totalVotes = votes.reduce((s, v) => s + v.cnt, 0);
  if (totalVotes >= total) {
    return { winner: votes[0].vote_value, count: votes[0].cnt, total, tiebreak: true };
  }
  return null;
}

// ── GET /api/olympus/teacher/diagnostic ──────────────────────────────────────
app.get('/api/olympus/teacher/diagnostic', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher access required' });
  try {
    const { period } = req.query;
    if (!period) return res.status(400).json({ error: 'period query param required' });
    const alliances = query(
      `SELECT a.alliance_id, a.alliance_name AS name, a.total_points,
              COUNT(s.student_id) as member_count
       FROM alliances a
       LEFT JOIN students s ON s.alliance_id = a.alliance_id
                            AND (s.is_ghost = 0 OR s.is_ghost IS NULL)
       WHERE a.class_period = ?
       GROUP BY a.alliance_id, a.alliance_name, a.total_points`,
      [period]
    );
    const result = alliances.map(al => {
      const members = query(
        `SELECT student_id, name, is_ghost
         FROM students
         WHERE alliance_id = ?`,
        [al.alliance_id]
      );
      const ghosts = members.filter(m => m.is_ghost);
      return Object.assign({}, al, { members: members, ghost_count: ghosts.length });
    });
    res.json({ period, alliances: result });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/olympus/teacher/monitor ─────────────────────────────────────────
app.get('/api/olympus/teacher/monitor', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher access required' });
  try {
    const periods = ['1st','2nd','3rd','4th', TEST_PERIOD];
    const result = {};
    for (const p of periods) {
      const alliances = query(
        `SELECT a.alliance_id, a.alliance_name AS name, a.total_points,
                COALESCE(o.current_round,0) as current_round,
                COALESCE(o.current_phase,'not_started') as current_phase,
                o.phoenix_feather_used, o.hades_visits, o.ghost_runner_mode,
                o.secret_words, o.interrupt_active, o.present_members
         FROM alliances a
         LEFT JOIN olympus_race_state o ON o.alliance_id=a.alliance_id
         WHERE a.class_period=?
         ORDER BY COALESCE(o.current_round,0) DESC, a.total_points DESC`,
        [p]
      );
      // Attach member list to each alliance for attendance UI
      result[p] = alliances.map(a => {
        const members = query(
          `SELECT student_id, name, is_ghost FROM students
           WHERE alliance_id=? AND (is_ghost=0 OR is_ghost IS NULL)
           ORDER BY name`,
          [a.alliance_id]
        );
        const presentIds = a.present_members ? JSON.parse(a.present_members) : null;
        return Object.assign({}, a, {
          members: members,
          present_members: presentIds
        });
      });
    }
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/olympus/teacher/set-present ────────────────────────────────────
// Sets which students are present for an alliance's session.
// present_student_ids: array of student_id integers who are present today.
// Passing an empty array or null resets to "use all members" (full headcount).
app.post('/api/olympus/teacher/set-present', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher access required' });
  try {
    const { alliance_id, present_student_ids } = req.body;
    if (!alliance_id) return res.status(400).json({ error: 'alliance_id required' });

    // Validate all provided IDs actually belong to this alliance
    if (present_student_ids && present_student_ids.length > 0) {
      const members = query(
        `SELECT student_id FROM students
         WHERE alliance_id=? AND (is_ghost=0 OR is_ghost IS NULL)`,
        [alliance_id]
      );
      const validIds = new Set(members.map(m => m.student_id));
      const invalid = present_student_ids.filter(id => !validIds.has(id));
      if (invalid.length) {
        return res.status(400).json({ error: `Invalid student IDs for this alliance: ${invalid.join(', ')}` });
      }
    }

    const presentJson = (present_student_ids && present_student_ids.length > 0)
      ? JSON.stringify(present_student_ids)
      : null;

    // Update if race state exists, otherwise store for when race starts
    const state = getOlympusState(alliance_id);
    if (state) {
      run(
        `UPDATE olympus_race_state SET present_members=? WHERE alliance_id=?`,
        [presentJson, alliance_id]
      );
    } else {
      // Race not started yet — store a pending present_members via a pre-insert
      // Teacher will call start-race after setting attendance, which inserts the row.
      // We use a separate lightweight table approach: store in a temp column after start.
      // For now: inform teacher that race must be started first, or start it implicitly.
      return res.status(400).json({
        error: 'Race not started for this alliance yet. Start the race first, then set attendance.'
      });
    }

    res.json({
      updated: true,
      alliance_id,
      present_count: present_student_ids ? present_student_ids.length : null,
      note: present_student_ids && present_student_ids.length
        ? `Majority will be calculated from ${present_student_ids.length} present member(s).`
        : 'Attendance reset — using full member count.'
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/olympus/teacher/start-race ─────────────────────────────────────
app.post('/api/olympus/teacher/start-race', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher access required' });
  try {
    const { period } = req.body;
    if (!period) return res.status(400).json({ error: 'period required' });
    const alliances = query(`SELECT alliance_id, class_period FROM alliances WHERE class_period=?`, [period]);
    let created = 0;
    for (const a of alliances) {
      const existing = getOlympusState(a.alliance_id);
      if (!existing) {
        run(
          `INSERT INTO olympus_race_state (alliance_id, period, current_round, current_phase)
           VALUES (?,?,0,'opening')`,
          [a.alliance_id, period]
        );
        created++;
      }
    }
    res.json({ period, alliances_initialized: created, total_alliances: alliances.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/olympus/teacher/reset-race ─────────────────────────────────────
app.post('/api/olympus/teacher/reset-race', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher access required' });
  try {
    const { period, confirm_period } = req.body;
    if (!period) return res.status(400).json({ error: 'period required' });
    if (confirm_period !== period) return res.status(400).json({ error: 'confirm_period must match period' });
    if (period !== TEST_PERIOD) {
      return res.status(403).json({ error: 'Reset only allowed for Test Period via this endpoint' });
    }
    const alliances = query(`SELECT alliance_id FROM alliances WHERE class_period=?`, [period]);
    const ids = alliances.map(a => a.alliance_id);
    for (const id of ids) {
      run(`DELETE FROM olympus_race_state WHERE alliance_id=?`, [id]);
      run(`DELETE FROM olympus_votes WHERE alliance_id=?`, [id]);
      run(`DELETE FROM olympus_combat_log WHERE alliance_id=?`, [id]);
      run(`DELETE FROM olympus_medea_choices WHERE alliance_id=?`, [id]);
      run(`DELETE FROM olympus_hints WHERE alliance_id=?`, [id]);
      run(`DELETE FROM olympus_gate_attempts WHERE alliance_id=?`, [id]);
      run(`DELETE FROM olympus_godtest_answers WHERE alliance_id=?`, [id]);
      run(`DELETE FROM olympus_godtest_votes WHERE alliance_id=?`, [id]);
      // Clear per-session columns on race state
      run(`UPDATE olympus_race_state SET combat_ready_flags=NULL, combat_result=NULL WHERE alliance_id=?`, [id]);
      run(`DELETE FROM olympus_path_locks WHERE period=?`, [period]);
      run(`DELETE FROM olympus_godtest_locks WHERE period=?`, [period]);
    }
    res.json({ reset: true, period, alliances_cleared: ids.length });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/olympus/teacher/debug-votes ─────────────────────────────────────
app.get('/api/olympus/teacher/debug-votes', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher access required' });
  try {
    const { period } = req.query;
    if (!period) return res.status(400).json({ error: 'period required' });
    const alliances = query(`SELECT alliance_id, alliance_name FROM alliances WHERE class_period=?`, [period]);
    const result = alliances.map(a => {
      const votes = query(
        `SELECT student_id, round_number, vote_type, vote_value FROM olympus_votes WHERE alliance_id=?`,
        [a.alliance_id]
      );
      const members = query(
        `SELECT student_id, name, is_ghost FROM students WHERE alliance_id=? AND (is_ghost=0 OR is_ghost IS NULL)`,
        [a.alliance_id]
      );
      const majority = getMajority(a.alliance_id, 0, 'medea');
      return {
        alliance_id: a.alliance_id,
        name: a.alliance_name,
        real_member_count: members.length,
        members,
        votes,
        getMajority_result: majority
      };
    });
    res.json(result);
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// END REVENGE OF THE GODS
// ============================================================

// ============================================================
// TEACHER: FORCE-PASS QUIZ FOR A STUDENT
// ============================================================
app.post('/api/teacher/force-pass-quiz', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Forbidden' });

  const { student_name, class_period, portal_id, score, total_questions } = req.body;
  if (!student_name || !class_period || !portal_id) {
    return res.status(400).json({ error: 'student_name, class_period, and portal_id required' });
  }

  try {
    // Find the student
    const students = query(
      `SELECT student_id, name, class_period FROM students
       WHERE LOWER(name) LIKE LOWER(?) AND class_period = ? AND (is_ghost = 0 OR is_ghost IS NULL)`,
      [`%${student_name}%`, class_period]
    );
    if (!students.length) return res.status(404).json({ error: `No student matching "${student_name}" in period ${class_period}` });
    const student = students[0];
    const sid = student.student_id;

    const forcedScore = score || 15;
    const forcedTotal = total_questions || 17;
    const percentage = Math.round((forcedScore / forcedTotal) * 100);

    // Check for existing passing attempt
    const existingPass = query(
      'SELECT attempt_id FROM myth_quiz_attempts WHERE student_id = ? AND portal_id = ? AND passed = 1',
      [sid, portal_id]
    )[0];

    if (!existingPass) {
      run(
        `INSERT INTO myth_quiz_attempts (student_id, portal_id, score, total_questions, percentage, passed, attempted_at)
         VALUES (?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP)`,
        [sid, portal_id, forcedScore, forcedTotal, percentage]
      );
    }

    // Find the quiz assignment in assignments_ref for this portal
    const PORTAL_TO_MYTH = {
      1: 'Pandora', 2: 'Phaethon', 3: 'Orpheus',
      4: 'Echo and Narcissus', 5: 'Icarus', 6: 'Eros and Psyche', 7: 'Constellations'
    };
    const mythGod = PORTAL_TO_MYTH[parseInt(portal_id)];
    let gradeInserted = false;

    if (mythGod) {
      const mythAliases = mythGod === 'Icarus'
        ? ["'Icarus'", "'Icarus & Daedalus'", "'Icarus and Daedalus'"]
        : [`'${mythGod}'`];
      const quizAssignment = query(
        `SELECT assignment_id, max_points FROM assignments_ref
         WHERE section = 'classical' AND assignment_type = 'quiz' AND myth_god IN (${mythAliases.join(',')})
         LIMIT 1`
      )[0];

      if (quizAssignment) {
        const pointsEarned = Math.round((forcedScore / forcedTotal) * quizAssignment.max_points);
        const existingGrade = query(
          'SELECT record_id FROM grade_records WHERE student_id = ? AND assignment_id = ?',
          [sid, quizAssignment.assignment_id]
        )[0];

        if (!existingGrade) {
          run(
            `INSERT INTO grade_records (student_id, assignment_id, points_earned, points_possible)
             VALUES (?, ?, ?, ?)`,
            [sid, quizAssignment.assignment_id, pointsEarned, quizAssignment.max_points]
          );
          gradeInserted = true;
        } else {
          run('UPDATE grade_records SET points_earned = ? WHERE record_id = ?',
            [pointsEarned, existingGrade.record_id]);
          gradeInserted = true;
        }
      }
    }

    saveDatabase();
    console.log(`[FORCE-PASS] ${student.name} (id:${sid}) portal ${portal_id} — ${forcedScore}/${forcedTotal} (${percentage}%) grade_inserted:${gradeInserted}`);

    res.json({
      success: true,
      student_name: student.name,
      student_id: sid,
      portal_id,
      score: `${forcedScore}/${forcedTotal}`,
      percentage: `${percentage}%`,
      already_had_pass: !!existingPass,
      grade_record_updated: gradeInserted
    });
  } catch (e) {
    console.error('[FORCE-PASS] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// EMERGENCY SPAM CLEANUP ENDPOINTS
// ============================================================

// Step 1: Diagnose — read-only, shows what WOULD be deleted
app.get('/api/teacher/spam-diagnose', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Forbidden' });

  const { student_name, target_date, spam_pattern } = req.query;
  if (!student_name || !target_date) return res.status(400).json({ error: 'student_name and target_date required' });

  try {
    // Inspect actual schema so we never guess column names
    const schemaRows = query(`PRAGMA table_info(point_submissions)`, []);
    const columnNames = schemaRows.map(r => r.name);
    const pkCol = columnNames.includes('submission_id') ? 'submission_id' : columnNames.includes('id') ? 'id' : columnNames[0];
    const notesCol = columnNames.includes('notes') ? 'notes' : columnNames.includes('description') ? 'description' : null;
    const tsCol = columnNames.includes('submitted_at') ? 'submitted_at' : columnNames.includes('created_at') ? 'created_at' : columnNames.includes('timestamp') ? 'timestamp' : null;

    const studentRows = query(
      `SELECT student_id, name, class_period FROM students WHERE LOWER(name) LIKE LOWER(?) AND (is_ghost = 0 OR is_ghost IS NULL)`,
      [`%${student_name}%`]
    );
    if (!studentRows.length) return res.json({ spam_count: 0, safe_count: 0, student_name: null, preview: [], debug_columns: columnNames });

    const student = studentRows[0];
    const sid = student.student_id;

    const allToday = tsCol
      ? query(`SELECT * FROM point_submissions WHERE student_id = ? AND DATE(${tsCol}) = DATE(?) ORDER BY ${tsCol} DESC`, [sid, target_date])
      : query(`SELECT * FROM point_submissions WHERE student_id = ?`, [sid]);

    const patternLower = (spam_pattern || '').toLowerCase();
    const noteVal = (r) => (notesCol ? (r[notesCol] || '') : '');

    const spam = allToday.filter(r => !patternLower || noteVal(r).toLowerCase().includes(patternLower));
    const safe = allToday.filter(r => patternLower && !noteVal(r).toLowerCase().includes(patternLower));

    res.json({
      student_id: sid,
      student_name: student.name,
      period: student.class_period,
      target_date,
      spam_count: spam.length,
      safe_count: safe.length,
      debug_columns: columnNames,
      preview: spam.slice(0, 10).map(r => ({
        id: r[pkCol],
        category: r.category || '',
        notes: noteVal(r),
        submitted_at: tsCol ? r[tsCol] : ''
      }))
    });
  } catch (e) {
    console.error('[SPAM-DIAGNOSE] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Step 2: Delete — permanently removes spam submissions
app.post('/api/teacher/spam-delete', authenticateToken, (req, res) => {
  if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Forbidden' });

  const { student_name, target_date, spam_pattern } = req.body;
  if (!student_name || !target_date) return res.status(400).json({ error: 'student_name and target_date required' });

  try {
    const studentRows = query(
      `SELECT student_id, name FROM students WHERE LOWER(name) LIKE LOWER(?) AND (is_ghost = 0 OR is_ghost IS NULL)`,
      [`%${student_name}%`]
    );
    if (!studentRows.length) return res.json({ deleted_count: 0, safe_count: 0 });

    const sid = studentRows[0].student_id;
    const patternLower = (spam_pattern || '').toLowerCase();

    const allToday = query(
      `SELECT submission_id, description FROM point_submissions WHERE student_id = ? AND DATE(submitted_at) = DATE(?)`,
      [sid, target_date]
    );

    const spamIds = allToday
      .filter(r => !patternLower || (r.description || '').toLowerCase().includes(patternLower))
      .map(r => r.submission_id);

    const safeCount = allToday.length - spamIds.length;

    if (spamIds.length > 0) {
      const chunkSize = 100;
      for (let i = 0; i < spamIds.length; i += chunkSize) {
        const chunk = spamIds.slice(i, i + chunkSize);
        const placeholders = chunk.map(() => '?').join(',');
        run(`DELETE FROM point_submissions WHERE submission_id IN (${placeholders})`, chunk);
      }
      saveDatabase();
    }

    console.log(`[SPAM-CLEANUP] Deleted ${spamIds.length} spam submissions from ${studentRows[0].name} (id:${sid}) on ${target_date}`);
    res.json({ deleted_count: spamIds.length, safe_count: safeCount });
  } catch (e) {
    console.error('[SPAM-DELETE] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ============================================================
// END EMERGENCY SPAM CLEANUP
// ============================================================

app.listen(PORT, () => {
  console.log(`\n🏛️  ODYSSEY TO OLYMPUS SERVER RUNNING 🏛️`);
  console.log(`\n📍 Server: http://localhost:${PORT}`);
  console.log(`\n✅ Phase 2: FATE WHEEL & BATTLES`);
  console.log(`   - Fate Wheel: 20 Archaic Age Fates`);
  console.log(`   - Battle Arena: God Powers System`);
  console.log(`   - My Contributions: Personal tracking`);
  console.log(`   - Red/Orange/Gold theme for fates\n`);
  
  // Run cleanup after server starts (database is ready)
  setTimeout(cleanupStuckBattles, 1000);
  
  // Run retroactive badge scan 5 seconds after startup
  setTimeout(() => {
    try {
      console.log('🏅 Running retroactive badge scan...');
      const students = query('SELECT student_id, name FROM students');
      let totalAwarded = 0;
      const results = [];
      
      for (const student of students) {
        const newBadges = scanForBadges(student.student_id);
        for (const badge of newBadges) {
          try {
            run(`INSERT OR IGNORE INTO student_badges (student_id, badge_id, ring_level, claimed, awarded_by)
                 VALUES (?, ?, 0, 0, 'system')`, [student.student_id, badge.badge_id]);
            totalAwarded++;
            results.push(`${student.name}: ${badge.badge_name}`);
          } catch (e) { /* already exists */ }
        }
      }
      
      if (totalAwarded > 0) {
        saveDatabase();
        console.log(`🏅 Retroactive badge scan complete: ${totalAwarded} badges awarded`);
        results.forEach(r => console.log(`  🏅 ${r}`));
      } else {
        console.log('🏅 Retroactive badge scan: no new badges to award');
      }
    } catch (err) {
      console.error('Retroactive badge scan error:', err);
    }
  }, 5000);
});

// ====================
// ADMIN: Diagnose student point history for alliance transfers
// ====================
app.get('/api/admin/student-point-history', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
    const { names } = req.query; // comma-separated student names
    if (!names) return res.status(400).json({ error: 'Provide ?names=Blake,Ethan,Lukas' });

    const nameList = names.split(',').map(n => n.trim());
    const results = [];

    nameList.forEach(name => {
      const students = query('SELECT student_id, name, alliance_id, class_period, is_ghost FROM students WHERE name LIKE ?', [`%${name}%`]);
      
      students.forEach(student => {
        let currentAlliance = null;
        if (student.alliance_id) {
          currentAlliance = query('SELECT alliance_id, alliance_name, total_points FROM alliances WHERE alliance_id = ?', [student.alliance_id])[0];
        }

        // Contribution history (populated at disband time)
        const contributions = query(
          'SELECT * FROM student_contributions WHERE student_id = ? ORDER BY contribution_date DESC',
          [student.student_id]
        );

        // Point transactions attributed to this student
        const studentTransactions = query(
          'SELECT transaction_id, alliance_id, amount, category, reason, timestamp FROM point_transactions WHERE student_id = ? ORDER BY timestamp DESC LIMIT 50',
          [student.student_id]
        );

        // Alliance-level summaries for all alliances this student has been in
        const allianceIds = [...new Set([
          ...(student.alliance_id ? [student.alliance_id] : []),
          ...contributions.map(c => c.alliance_id)
        ])];

        const allianceTransactionSummaries = allianceIds.map(aid => {
          const allianceInfo = query('SELECT alliance_id, alliance_name, total_points, is_disbanded FROM alliances WHERE alliance_id = ?', [aid])[0];
          const total = query('SELECT SUM(amount) as total FROM point_transactions WHERE alliance_id = ?', [aid])[0];
          return {
            alliance_id: aid,
            alliance_name: allianceInfo ? allianceInfo.alliance_name : 'Unknown',
            is_disbanded: allianceInfo ? allianceInfo.is_disbanded : null,
            current_total_points: allianceInfo ? allianceInfo.total_points : null,
            transaction_sum: total ? total.total : 0
          };
        });

        results.push({
          student_id: student.student_id,
          name: student.name,
          class_period: student.class_period,
          current_alliance_id: student.alliance_id,
          currentAlliance,
          contributions,
          recentStudentTransactions: studentTransactions,
          allianceTransactionSummaries
        });
      });
    });

    res.json({ results });
  } catch (err) {
    console.error('Student point history error:', err);
    res.status(500).json({ error: 'Failed to query student history' });
  }
});

// ADMIN: Restore points to an alliance (one-time migration, supports dry_run)
app.post('/api/admin/restore-alliance-points', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
    const { alliance_id, amount, reason, dry_run } = req.body;
    if (!alliance_id || amount === undefined) return res.status(400).json({ error: 'alliance_id and amount required' });

    const alliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    if (!alliance) return res.status(404).json({ error: 'Alliance not found' });

    if (dry_run) {
      return res.json({
        dry_run: true,
        alliance_name: alliance.alliance_name,
        current_points: alliance.total_points,
        would_add: amount,
        new_total: alliance.total_points + amount
      });
    }

    run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', [amount, alliance_id]);
    run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) VALUES (?, ?, 'admin', ?, ?)`,
        [alliance_id, amount, reason || `Admin point restoration: ${amount} pts`, req.user.id]);
    saveDatabase();

    const updated = query('SELECT total_points FROM alliances WHERE alliance_id = ?', [alliance_id])[0];
    console.log(`🔧 Admin restored ${amount} pts to alliance ${alliance_id} (${alliance.alliance_name}): ${alliance.total_points} → ${updated.total_points}`);
    
    res.json({
      success: true,
      alliance_name: alliance.alliance_name,
      previous_points: alliance.total_points,
      added: amount,
      new_total: updated.total_points
    });
  } catch (err) {
    console.error('Restore points error:', err);
    res.status(500).json({ error: 'Failed to restore points' });
  }
});

// ============================================================
// HERCULES 12 LABORS — ENDPOINTS
// Parallel to voyage-log (Jason) but separate tables
// Tables created inside initDatabase().then() block at top of file
// ============================================================

// GET /api/hercules-log/period-alliances/:period — list alliances with non-ghost students in a period
app.get('/api/hercules-log/period-alliances/:period', (req, res) => {
  try {
    const period = req.params.period;
    // Get alliances that have at least one non-ghost student in this period
    const alliances = query(`
      SELECT DISTINCT a.alliance_id, a.alliance_name
      FROM alliances a
      JOIN students s ON s.alliance_id = a.alliance_id
      WHERE s.class_period = ? AND (s.is_ghost = 0 OR s.is_ghost IS NULL)
        AND a.is_disbanded = 0
      ORDER BY a.alliance_name
    `, [period]);

    // Check for students without an alliance (independent)
    const independents = query(`
      SELECT student_id FROM students
      WHERE class_period = ? AND (alliance_id IS NULL) AND (is_ghost = 0 OR is_ghost IS NULL)
    `, [period]);

    if (independents.length > 0) {
      alliances.push({ alliance_id: 'independent', alliance_name: 'Independent' });
    }

    res.json({ alliances });
  } catch (err) {
    console.error('Hercules period-alliances error:', err);
    res.json({ alliances: [], error: err.message });
  }
});

// GET /api/hercules-log/alliance-students/:period/:alliance_id — list non-ghost students in an alliance+period
app.get('/api/hercules-log/alliance-students/:period/:alliance_id', (req, res) => {
  try {
    const { period, alliance_id } = req.params;
    let students;
    if (alliance_id === 'independent') {
      students = query(`
        SELECT student_id, name FROM students
        WHERE class_period = ? AND (alliance_id IS NULL) AND (is_ghost = 0 OR is_ghost IS NULL)
        ORDER BY name
      `, [period]);
    } else {
      students = query(`
        SELECT student_id, name FROM students
        WHERE class_period = ? AND alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)
        ORDER BY name
      `, [period, parseInt(alliance_id)]);
    }
    res.json({ students });
  } catch (err) {
    console.error('Hercules alliance-students error:', err);
    res.json({ students: [], error: err.message });
  }
});

// GET /api/hercules-log/load-progress-by-id/:student_id — load by student_id (bulletproof)
app.get('/api/hercules-log/load-progress-by-id/:student_id', (req, res) => {
  try {
    const sid = parseInt(req.params.student_id);
    // First try student_id-based lookup
    let rows = query(
      'SELECT state_json, updated_at FROM hercules_log_progress WHERE student_id = ?',
      [sid]
    );
    if (rows.length > 0) {
      return res.json({ found: true, state: JSON.parse(rows[0].state_json), updated_at: rows[0].updated_at });
    }
    // Fallback: try name+period lookup (for students who saved before the student_id migration)
    const stu = query('SELECT name, class_period FROM students WHERE student_id = ?', [sid]);
    if (stu.length > 0) {
      rows = query(
        'SELECT state_json, updated_at FROM hercules_log_progress WHERE student_name = ? AND class_period = ?',
        [stu[0].name, stu[0].class_period]
      );
      if (rows.length > 0) {
        // Migrate: add student_id to the row for future lookups
        try { run('ALTER TABLE hercules_log_progress ADD COLUMN student_id INTEGER', []); } catch(e) {}
        run('UPDATE hercules_log_progress SET student_id = ? WHERE student_name = ? AND class_period = ?',
          [sid, stu[0].name, stu[0].class_period]);
        saveDatabase();
        return res.json({ found: true, state: JSON.parse(rows[0].state_json), updated_at: rows[0].updated_at });
      }
    }
    res.json({ found: false });
  } catch (err) {
    console.error('Hercules load-progress-by-id error:', err);
    res.json({ found: false });
  }
});

// POST /api/hercules-log/submit — no JWT (standalone HTML)
app.post('/api/hercules-log/submit', (req, res) => {
  try {
    const {
      student_name, class_period, alliance_name,
      hero_code, rank_tier, total_score,
      stop_scores, written_answers
    } = req.body;

    if (!student_name || !class_period) {
      return res.status(400).json({ error: 'student_name and class_period required' });
    }

    const existing = query(
      'SELECT completion_id FROM hercules_log_completions WHERE student_name = ? AND class_period = ?',
      [student_name, class_period]
    );

    if (existing.length > 0) {
      run(
        `UPDATE hercules_log_completions SET
          alliance_name=?, hero_code=?, rank_tier=?, total_score=?,
          stop_scores=?, written_answers=?, completed_at=CURRENT_TIMESTAMP
         WHERE student_name=? AND class_period=?`,
        [
          alliance_name || null, hero_code || null, rank_tier || null,
          total_score || 0, JSON.stringify(stop_scores || {}),
          JSON.stringify(written_answers || {}), student_name, class_period
        ]
      );
    } else {
      run(
        `INSERT INTO hercules_log_completions
          (student_name, class_period, alliance_name, hero_code, rank_tier, total_score, stop_scores, written_answers)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          student_name, class_period, alliance_name || null,
          hero_code || null, rank_tier || null, total_score || 0,
          JSON.stringify(stop_scores || {}), JSON.stringify(written_answers || {})
        ]
      );
    }

    saveDatabase();
    console.log(`🦁 Hercules log submitted: ${student_name} (${class_period}) — ${rank_tier} — ${total_score} pts`);

    // ── Bridge rewards to student account ──
    try {
      const hercDrachma = { INI: 0, LAB: 15, BSL: 30, CHP: 50, HOO: 75 };
      const tier = (rank_tier || 'INI').toUpperCase();
      const drachmaReward = hercDrachma[tier] || 0;

      const sid = student_id ? parseInt(student_id) : null;
      let studentRow;
      if (sid) {
        studentRow = query('SELECT student_id, drachma FROM students WHERE student_id = ?', [sid]);
      }
      if ((!studentRow || studentRow.length === 0) && student_name && class_period) {
        studentRow = query('SELECT student_id, drachma FROM students WHERE name = ? AND class_period = ?', [student_name, class_period]);
      }
      if (studentRow && studentRow.length > 0) {
        const currentDrachma = studentRow[0].drachma || 0;
        run(
          'UPDATE students SET drachma = ?, hercules_log_completed = 1, hercules_hero_code = ?, hercules_rank_tier = ? WHERE student_id = ?',
          [currentDrachma + drachmaReward, hero_code || null, tier, studentRow[0].student_id]
        );
        saveDatabase();
        console.log(`🦁 Hercules rewards: +${drachmaReward} drachma → student_id ${studentRow[0].student_id}`);
      }
    } catch (bridgeErr) {
      console.error('🦁 Hercules reward bridge error (non-fatal):', bridgeErr.message);
    }

    res.json({ success: true, hero_code, rank_tier });

  } catch (err) {
    console.error('Hercules log submit error:', err);
    res.status(500).json({ error: 'Failed to save hercules log' });
  }
});

// POST /api/hercules-log/save-progress — no JWT (standalone page)
app.post('/api/hercules-log/save-progress', (req, res) => {
  try {
    const { student_name, class_period, student_id, state } = req.body;
    if (!student_name || !class_period || !state) {
      return res.status(400).json({ error: 'student_name, class_period, and state required' });
    }

    // Ensure student_id column exists
    try { run('ALTER TABLE hercules_log_progress ADD COLUMN student_id INTEGER', []); } catch(e) {}

    const stateJson = JSON.stringify(state);
    const sid = student_id ? parseInt(student_id) : null;

    // Try student_id lookup first, then fall back to name+period
    let existing;
    if (sid) {
      existing = query(
        'SELECT student_name FROM hercules_log_progress WHERE student_id = ?',
        [sid]
      );
    }
    if (!existing || existing.length === 0) {
      existing = query(
        'SELECT student_name FROM hercules_log_progress WHERE student_name = ? AND class_period = ?',
        [student_name, class_period]
      );
    }

    if (existing.length > 0) {
      if (sid) {
        run(
          'UPDATE hercules_log_progress SET state_json = ?, student_id = ?, updated_at = CURRENT_TIMESTAMP WHERE student_name = ? AND class_period = ?',
          [stateJson, sid, student_name, class_period]
        );
      } else {
        run(
          'UPDATE hercules_log_progress SET state_json = ?, updated_at = CURRENT_TIMESTAMP WHERE student_name = ? AND class_period = ?',
          [stateJson, student_name, class_period]
        );
      }
    } else {
      run(
        'INSERT INTO hercules_log_progress (student_name, class_period, student_id, state_json) VALUES (?, ?, ?, ?)',
        [student_name, class_period, sid, stateJson]
      );
    }

    saveDatabase();
    res.json({ success: true });
  } catch (err) {
    console.error('Hercules log save-progress error:', err);
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

// GET /api/hercules-log/load-progress/:name/:period — no JWT
app.get('/api/hercules-log/load-progress/:name/:period', (req, res) => {
  try {
    const { name, period } = req.params;
    const rows = query(
      'SELECT state_json, updated_at FROM hercules_log_progress WHERE student_name = ? AND class_period = ?',
      [name, period]
    );

    if (rows.length > 0) {
      res.json({
        found: true,
        state: JSON.parse(rows[0].state_json),
        updated_at: rows[0].updated_at
      });
    } else {
      res.json({ found: false });
    }
  } catch (err) {
    console.error('Hercules log load-progress error:', err);
    res.json({ found: false });
  }
});

// GET /api/hercules-log/unlocks/:period — no auth (standalone)
app.get('/api/hercules-log/unlocks/:period', (req, res) => {
  try {
    const { period } = req.params;
    const rows = query(
      'SELECT unlocked_up_to FROM hercules_log_unlocks WHERE class_period = ?',
      [period]
    );
    const unlocked = (rows.length > 0 && rows[0].unlocked_up_to !== null)
      ? rows[0].unlocked_up_to : -1;
    res.json({ period, unlocked_up_to: unlocked });
  } catch (err) {
    res.json({ period: req.params.period, unlocked_up_to: -1 });
  }
});

// POST /api/hercules-log/unlock — from teacher modal in hercules page OR from teacher.html
// No JWT required when called from standalone hercules page; JWT required from teacher.html
app.post('/api/hercules-log/unlock', (req, res) => {
  try {
    const { period, unlock_up_to } = req.body;

    if (!period || unlock_up_to === undefined) {
      return res.status(400).json({ error: 'period and unlock_up_to required' });
    }

    const existing = query(
      'SELECT class_period FROM hercules_log_unlocks WHERE class_period = ?',
      [period]
    );
    if (existing.length > 0) {
      run('UPDATE hercules_log_unlocks SET unlocked_up_to = ? WHERE class_period = ?',
        [unlock_up_to, period]);
    } else {
      run('INSERT INTO hercules_log_unlocks (class_period, unlocked_up_to) VALUES (?, ?)',
        [period, unlock_up_to]);
    }

    saveDatabase();
    console.log(`🦁 Hercules unlock: ${period} → labor ${unlock_up_to}`);
    res.json({ success: true, period, unlocked_up_to: unlock_up_to });

  } catch (err) {
    console.error('Hercules log unlock error:', err);
    res.status(500).json({ error: 'Failed to set unlock' });
  }
});

// POST /api/teacher/hercules-log-unlock — teacher JWT version
app.post('/api/teacher/hercules-log-unlock', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
    const { class_period, unlock_up_to } = req.body;

    if (!class_period || unlock_up_to === undefined) {
      return res.status(400).json({ error: 'class_period and unlock_up_to required' });
    }

    const existing = query(
      'SELECT class_period FROM hercules_log_unlocks WHERE class_period = ?',
      [class_period]
    );
    if (existing.length > 0) {
      run('UPDATE hercules_log_unlocks SET unlocked_up_to = ? WHERE class_period = ?',
        [unlock_up_to, class_period]);
    } else {
      run('INSERT INTO hercules_log_unlocks (class_period, unlocked_up_to) VALUES (?, ?)',
        [class_period, unlock_up_to]);
    }

    saveDatabase();
    console.log(`🦁 Hercules unlock (teacher): ${class_period} → labor ${unlock_up_to}`);
    res.json({ success: true, class_period, unlocked_up_to: unlock_up_to });

  } catch (err) {
    console.error('Hercules log unlock error:', err);
    res.status(500).json({ error: 'Failed to set unlock' });
  }
});

// GET /api/teacher/hercules-log-unlock-status — returns all periods' unlock state
app.get('/api/teacher/hercules-log-unlock-status', (req, res) => {
  try {
    const rows = query('SELECT class_period, unlocked_up_to FROM hercules_log_unlocks ORDER BY class_period');
    res.json({ unlocks: rows });
  } catch (err) {
    res.json({ unlocks: [] });
  }
});

// GET /api/hercules-log/status/:period — teacher dashboard completions
app.get('/api/hercules-log/status/:period', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
    const { period } = req.params;

    const completions = query(
      `SELECT student_name, alliance_name, hero_code, rank_tier,
              total_score, completed_at
       FROM hercules_log_completions
       WHERE class_period = ?
       ORDER BY total_score DESC`,
      [period]
    );

    let studentCount = 0;
    try {
      const totalStudents = query(
        'SELECT COUNT(*) as cnt FROM students WHERE class_period = ? AND (is_ghost = 0 OR is_ghost IS NULL)',
        [period]
      );
      studentCount = (totalStudents[0] && totalStudents[0].cnt) || 0;
    } catch (countErr) {
      const totalStudents = query(
        'SELECT COUNT(*) as cnt FROM students WHERE class_period = ?',
        [period]
      );
      studentCount = (totalStudents[0] && totalStudents[0].cnt) || 0;
    }

    res.json({
      completions,
      total_students: studentCount,
      completed_count: completions.length
    });
  } catch (err) {
    console.error('Hercules log status error:', err);
    res.status(500).json({ error: 'Failed to load hercules status' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// THESEUS — THE ROAD TO THE LABYRINTH (Viewing Guide Endpoints)
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/theseus-log/period-alliances/:period — list alliances with non-ghost students
app.get('/api/theseus-log/period-alliances/:period', (req, res) => {
  try {
    const period = req.params.period;
    const alliances = query(`
      SELECT DISTINCT a.alliance_id, a.alliance_name
      FROM alliances a
      JOIN students s ON s.alliance_id = a.alliance_id
      WHERE s.class_period = ? AND (s.is_ghost = 0 OR s.is_ghost IS NULL)
        AND a.is_disbanded = 0
      ORDER BY a.alliance_name
    `, [period]);

    const independents = query(`
      SELECT student_id FROM students
      WHERE class_period = ? AND (alliance_id IS NULL) AND (is_ghost = 0 OR is_ghost IS NULL)
    `, [period]);

    if (independents.length > 0) {
      alliances.push({ alliance_id: 'independent', alliance_name: 'Independent' });
    }

    res.json({ alliances });
  } catch (err) {
    console.error('Theseus period-alliances error:', err);
    res.json({ alliances: [], error: err.message });
  }
});

// GET /api/theseus-log/alliance-students/:period/:alliance_id — list non-ghost students
app.get('/api/theseus-log/alliance-students/:period/:alliance_id', (req, res) => {
  try {
    const { period, alliance_id } = req.params;
    let students;
    if (alliance_id === 'independent') {
      students = query(`
        SELECT student_id, name FROM students
        WHERE class_period = ? AND (alliance_id IS NULL) AND (is_ghost = 0 OR is_ghost IS NULL)
        ORDER BY name
      `, [period]);
    } else {
      students = query(`
        SELECT student_id, name FROM students
        WHERE class_period = ? AND alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)
        ORDER BY name
      `, [period, parseInt(alliance_id)]);
    }
    res.json({ students });
  } catch (err) {
    console.error('Theseus alliance-students error:', err);
    res.json({ students: [], error: err.message });
  }
});

// GET /api/theseus-log/load-progress-by-id/:student_id — load by student_id (bulletproof)
app.get('/api/theseus-log/load-progress-by-id/:student_id', (req, res) => {
  try {
    const sid = parseInt(req.params.student_id);
    // Try student_id-based lookup first
    let rows = query(
      'SELECT state_json, updated_at FROM theseus_log_progress WHERE student_id = ?',
      [sid]
    );
    if (rows.length > 0) {
      return res.json({ found: true, state: JSON.parse(rows[0].state_json), updated_at: rows[0].updated_at });
    }
    // Fallback: name+period lookup
    const stu = query('SELECT name, class_period FROM students WHERE student_id = ?', [sid]);
    if (stu.length > 0) {
      rows = query(
        'SELECT state_json, updated_at FROM theseus_log_progress WHERE student_name = ? AND class_period = ?',
        [stu[0].name, stu[0].class_period]
      );
      if (rows.length > 0) {
        // Migrate: add student_id for future lookups
        run('UPDATE theseus_log_progress SET student_id = ? WHERE student_name = ? AND class_period = ?',
          [sid, stu[0].name, stu[0].class_period]);
        saveDatabase();
        return res.json({ found: true, state: JSON.parse(rows[0].state_json), updated_at: rows[0].updated_at });
      }
    }
    res.json({ found: false });
  } catch (err) {
    console.error('Theseus load-progress-by-id error:', err);
    res.json({ found: false });
  }
});

// POST /api/theseus-log/save-progress — no JWT (standalone page)
app.post('/api/theseus-log/save-progress', (req, res) => {
  try {
    const { student_name, class_period, student_id, state } = req.body;
    if (!student_name || !class_period || !state) {
      return res.status(400).json({ error: 'student_name, class_period, and state required' });
    }

    const stateJson = JSON.stringify(state);
    const sid = student_id ? parseInt(student_id) : null;

    // Try student_id lookup first, then fall back to name+period
    let existing;
    if (sid) {
      existing = query(
        'SELECT student_name FROM theseus_log_progress WHERE student_id = ?',
        [sid]
      );
    }
    if (!existing || existing.length === 0) {
      existing = query(
        'SELECT student_name FROM theseus_log_progress WHERE student_name = ? AND class_period = ?',
        [student_name, class_period]
      );
    }

    if (existing.length > 0) {
      if (sid) {
        run(
          'UPDATE theseus_log_progress SET state_json = ?, student_id = ?, updated_at = CURRENT_TIMESTAMP WHERE student_name = ? AND class_period = ?',
          [stateJson, sid, student_name, class_period]
        );
      } else {
        run(
          'UPDATE theseus_log_progress SET state_json = ?, updated_at = CURRENT_TIMESTAMP WHERE student_name = ? AND class_period = ?',
          [stateJson, student_name, class_period]
        );
      }
    } else {
      run(
        'INSERT INTO theseus_log_progress (student_name, class_period, student_id, state_json) VALUES (?, ?, ?, ?)',
        [student_name, class_period, sid, stateJson]
      );
    }

    saveDatabase();
    res.json({ success: true });
  } catch (err) {
    console.error('Theseus log save-progress error:', err);
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

// GET /api/theseus-log/load-progress/:name/:period — no JWT (legacy fallback)
app.get('/api/theseus-log/load-progress/:name/:period', (req, res) => {
  try {
    const { name, period } = req.params;
    const rows = query(
      'SELECT state_json, updated_at FROM theseus_log_progress WHERE student_name = ? AND class_period = ?',
      [name, period]
    );
    if (rows.length > 0) {
      res.json({ found: true, state: JSON.parse(rows[0].state_json), updated_at: rows[0].updated_at });
    } else {
      res.json({ found: false });
    }
  } catch (err) {
    console.error('Theseus log load-progress error:', err);
    res.json({ found: false });
  }
});

// GET /api/theseus-log/unlocks/:period — no auth (standalone)
app.get('/api/theseus-log/unlocks/:period', (req, res) => {
  try {
    const { period } = req.params;
    const rows = query(
      'SELECT unlocked_up_to FROM theseus_log_unlocks WHERE class_period = ?',
      [period]
    );
    const unlocked = (rows.length > 0 && rows[0].unlocked_up_to !== null)
      ? rows[0].unlocked_up_to : -1;
    res.json({ period, unlocked_up_to: unlocked });
  } catch (err) {
    res.json({ period: req.params.period, unlocked_up_to: -1 });
  }
});

// POST /api/theseus-log/unlock — from teacher modal in theseus page
app.post('/api/theseus-log/unlock', (req, res) => {
  try {
    const { period, unlock_up_to } = req.body;

    if (!period || unlock_up_to === undefined) {
      return res.status(400).json({ error: 'period and unlock_up_to required' });
    }

    const existing = query(
      'SELECT class_period FROM theseus_log_unlocks WHERE class_period = ?',
      [period]
    );
    if (existing.length > 0) {
      run('UPDATE theseus_log_unlocks SET unlocked_up_to = ? WHERE class_period = ?',
        [unlock_up_to, period]);
    } else {
      run('INSERT INTO theseus_log_unlocks (class_period, unlocked_up_to) VALUES (?, ?)',
        [period, unlock_up_to]);
    }

    saveDatabase();
    console.log(`🗡️ Theseus unlock: ${period} → stop ${unlock_up_to}`);
    res.json({ success: true, period, unlocked_up_to: unlock_up_to });

  } catch (err) {
    console.error('Theseus log unlock error:', err);
    res.status(500).json({ error: 'Failed to set unlock' });
  }
});

// POST /api/teacher/theseus-log-unlock — teacher JWT version
app.post('/api/teacher/theseus-log-unlock', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
    const { class_period, unlock_up_to } = req.body;

    if (!class_period || unlock_up_to === undefined) {
      return res.status(400).json({ error: 'class_period and unlock_up_to required' });
    }

    const existing = query(
      'SELECT class_period FROM theseus_log_unlocks WHERE class_period = ?',
      [class_period]
    );
    if (existing.length > 0) {
      run('UPDATE theseus_log_unlocks SET unlocked_up_to = ? WHERE class_period = ?',
        [unlock_up_to, class_period]);
    } else {
      run('INSERT INTO theseus_log_unlocks (class_period, unlocked_up_to) VALUES (?, ?)',
        [class_period, unlock_up_to]);
    }

    saveDatabase();
    console.log(`🗡️ Theseus unlock (teacher): ${class_period} → stop ${unlock_up_to}`);
    res.json({ success: true, class_period, unlocked_up_to: unlock_up_to });

  } catch (err) {
    console.error('Theseus log unlock error:', err);
    res.status(500).json({ error: 'Failed to set unlock' });
  }
});

// GET /api/teacher/theseus-log-unlock-status — returns all periods' unlock state
app.get('/api/teacher/theseus-log-unlock-status', (req, res) => {
  try {
    const rows = query('SELECT class_period, unlocked_up_to FROM theseus_log_unlocks ORDER BY class_period');
    res.json({ unlocks: rows });
  } catch (err) {
    res.json({ unlocks: [] });
  }
});

// POST /api/theseus-log/submit — no JWT (standalone HTML)
app.post('/api/theseus-log/submit', (req, res) => {
  try {
    const {
      student_name, class_period, student_id, alliance_name,
      hero_code, rank_tier, total_score,
      stop_scores, written_answers
    } = req.body;

    if (!student_name || !class_period) {
      return res.status(400).json({ error: 'student_name and class_period required' });
    }

    const existing = query(
      'SELECT completion_id FROM theseus_log_completions WHERE student_name = ? AND class_period = ?',
      [student_name, class_period]
    );

    if (existing.length > 0) {
      run(
        `UPDATE theseus_log_completions SET
          alliance_name=?, hero_code=?, rank_tier=?, total_score=?,
          stop_scores=?, written_answers=?, completed_at=CURRENT_TIMESTAMP
         WHERE student_name=? AND class_period=?`,
        [
          alliance_name || null, hero_code || null, rank_tier || null,
          total_score || 0, JSON.stringify(stop_scores || {}),
          JSON.stringify(written_answers || {}), student_name, class_period
        ]
      );
    } else {
      run(
        `INSERT INTO theseus_log_completions
          (student_name, class_period, alliance_name, hero_code, rank_tier, total_score, stop_scores, written_answers)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          student_name, class_period, alliance_name || null,
          hero_code || null, rank_tier || null, total_score || 0,
          JSON.stringify(stop_scores || {}), JSON.stringify(written_answers || {})
        ]
      );
    }

    saveDatabase();
    console.log(`🗡️ Theseus log submitted: ${student_name} (${class_period}) — ${rank_tier} — ${total_score} pts`);

    // ── Bridge rewards to student account ──
    try {
      const thsDrachma = { STR: 0, TRV: 15, CTZ: 30, CHP: 50, HOA: 75 };
      const tier = (rank_tier || 'STR').toUpperCase();
      const drachmaReward = thsDrachma[tier] || 0;

      const sid = student_id ? parseInt(student_id) : null;
      let studentRow;
      if (sid) {
        studentRow = query('SELECT student_id, drachma FROM students WHERE student_id = ?', [sid]);
      }
      if ((!studentRow || studentRow.length === 0) && student_name && class_period) {
        studentRow = query('SELECT student_id, drachma FROM students WHERE name = ? AND class_period = ?', [student_name, class_period]);
      }
      if (studentRow && studentRow.length > 0) {
        const currentDrachma = studentRow[0].drachma || 0;
        run(
          'UPDATE students SET drachma = ?, theseus_log_completed = 1, theseus_hero_code = ?, theseus_rank_tier = ? WHERE student_id = ?',
          [currentDrachma + drachmaReward, hero_code || null, tier, studentRow[0].student_id]
        );
        saveDatabase();
        console.log(`🗡️ Theseus rewards: +${drachmaReward} drachma → student_id ${studentRow[0].student_id}`);
      }
    } catch (bridgeErr) {
      console.error('🗡️ Theseus reward bridge error (non-fatal):', bridgeErr.message);
    }

    res.json({ success: true, hero_code, rank_tier });

  } catch (err) {
    console.error('Theseus log submit error:', err);
    res.status(500).json({ error: 'Failed to save theseus log' });
  }
});

// GET /api/theseus-log/status/:period — teacher dashboard completions
app.get('/api/theseus-log/status/:period', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
    const { period } = req.params;

    const completions = query(
      `SELECT student_name, alliance_name, hero_code, rank_tier,
              total_score, completed_at
       FROM theseus_log_completions
       WHERE class_period = ?
       ORDER BY total_score DESC`,
      [period]
    );

    let studentCount = 0;
    try {
      const totalStudents = query(
        'SELECT COUNT(*) as cnt FROM students WHERE class_period = ? AND (is_ghost = 0 OR is_ghost IS NULL)',
        [period]
      );
      studentCount = (totalStudents[0] && totalStudents[0].cnt) || 0;
    } catch (countErr) {
      const totalStudents = query(
        'SELECT COUNT(*) as cnt FROM students WHERE class_period = ?',
        [period]
      );
      studentCount = (totalStudents[0] && totalStudents[0].cnt) || 0;
    }

    res.json({
      completions,
      total_students: studentCount,
      completed_count: completions.length
    });
  } catch (err) {
    console.error('Theseus log status error:', err);
    res.status(500).json({ error: 'Failed to load theseus status' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PERSEUS VIEWING GUIDE — "The Flight of Destiny"
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/perseus-log/period-alliances/:period — list alliances with non-ghost students
app.get('/api/perseus-log/period-alliances/:period', (req, res) => {
  try {
    const period = req.params.period;
    const alliances = query(`
      SELECT DISTINCT a.alliance_id, a.alliance_name
      FROM alliances a
      JOIN students s ON s.alliance_id = a.alliance_id
      WHERE s.class_period = ? AND (s.is_ghost = 0 OR s.is_ghost IS NULL)
        AND a.is_disbanded = 0
      ORDER BY a.alliance_name
    `, [period]);

    const independents = query(`
      SELECT student_id FROM students
      WHERE class_period = ? AND (alliance_id IS NULL) AND (is_ghost = 0 OR is_ghost IS NULL)
    `, [period]);

    if (independents.length > 0) {
      alliances.push({ alliance_id: 'independent', alliance_name: 'Independent' });
    }

    res.json({ alliances });
  } catch (err) {
    console.error('Perseus period-alliances error:', err);
    res.json({ alliances: [], error: err.message });
  }
});

// GET /api/perseus-log/alliance-students/:period/:alliance_id — list non-ghost students
app.get('/api/perseus-log/alliance-students/:period/:alliance_id', (req, res) => {
  try {
    const { period, alliance_id } = req.params;
    let students;
    if (alliance_id === 'independent') {
      students = query(`
        SELECT student_id, name FROM students
        WHERE class_period = ? AND (alliance_id IS NULL) AND (is_ghost = 0 OR is_ghost IS NULL)
        ORDER BY name
      `, [period]);
    } else {
      students = query(`
        SELECT student_id, name FROM students
        WHERE class_period = ? AND alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL)
        ORDER BY name
      `, [period, parseInt(alliance_id)]);
    }
    res.json({ students });
  } catch (err) {
    console.error('Perseus alliance-students error:', err);
    res.json({ students: [], error: err.message });
  }
});

// GET /api/perseus-log/load-progress-by-id/:student_id — load by student_id
app.get('/api/perseus-log/load-progress-by-id/:student_id', (req, res) => {
  try {
    const sid = parseInt(req.params.student_id);
    let rows = query(
      'SELECT state_json, updated_at FROM perseus_log_progress WHERE student_id = ?',
      [sid]
    );
    if (rows.length > 0) {
      return res.json({ found: true, state: JSON.parse(rows[0].state_json), updated_at: rows[0].updated_at });
    }
    // Fallback: name+period lookup
    const stu = query('SELECT name, class_period FROM students WHERE student_id = ?', [sid]);
    if (stu.length > 0) {
      rows = query(
        'SELECT state_json, updated_at FROM perseus_log_progress WHERE student_name = ? AND class_period = ?',
        [stu[0].name, stu[0].class_period]
      );
      if (rows.length > 0) {
        run('UPDATE perseus_log_progress SET student_id = ? WHERE student_name = ? AND class_period = ?',
          [sid, stu[0].name, stu[0].class_period]);
        saveDatabase();
        return res.json({ found: true, state: JSON.parse(rows[0].state_json), updated_at: rows[0].updated_at });
      }
    }
    res.json({ found: false });
  } catch (err) {
    console.error('Perseus load-progress-by-id error:', err);
    res.json({ found: false });
  }
});

// POST /api/perseus-log/save-progress — no JWT (standalone page)
app.post('/api/perseus-log/save-progress', (req, res) => {
  try {
    const { student_name, class_period, student_id, state } = req.body;
    if (!student_name || !class_period || !state) {
      return res.status(400).json({ error: 'student_name, class_period, and state required' });
    }

    const stateJson = JSON.stringify(state);
    const sid = student_id ? parseInt(student_id) : null;

    let existing;
    if (sid) {
      existing = query(
        'SELECT student_name FROM perseus_log_progress WHERE student_id = ?',
        [sid]
      );
    }
    if (!existing || existing.length === 0) {
      existing = query(
        'SELECT student_name FROM perseus_log_progress WHERE student_name = ? AND class_period = ?',
        [student_name, class_period]
      );
    }

    if (existing.length > 0) {
      if (sid) {
        run(
          'UPDATE perseus_log_progress SET state_json = ?, student_id = ?, updated_at = CURRENT_TIMESTAMP WHERE student_name = ? AND class_period = ?',
          [stateJson, sid, student_name, class_period]
        );
      } else {
        run(
          'UPDATE perseus_log_progress SET state_json = ?, updated_at = CURRENT_TIMESTAMP WHERE student_name = ? AND class_period = ?',
          [stateJson, student_name, class_period]
        );
      }
    } else {
      run(
        'INSERT INTO perseus_log_progress (student_name, class_period, student_id, state_json) VALUES (?, ?, ?, ?)',
        [student_name, class_period, sid, stateJson]
      );
    }

    saveDatabase();
    res.json({ success: true });
  } catch (err) {
    console.error('Perseus log save-progress error:', err);
    res.status(500).json({ error: 'Failed to save progress' });
  }
});

// GET /api/perseus-log/load-progress/:name/:period — no JWT (legacy fallback)
app.get('/api/perseus-log/load-progress/:name/:period', (req, res) => {
  try {
    const { name, period } = req.params;
    const rows = query(
      'SELECT state_json, updated_at FROM perseus_log_progress WHERE student_name = ? AND class_period = ?',
      [name, period]
    );
    if (rows.length > 0) {
      res.json({ found: true, state: JSON.parse(rows[0].state_json), updated_at: rows[0].updated_at });
    } else {
      res.json({ found: false });
    }
  } catch (err) {
    console.error('Perseus log load-progress error:', err);
    res.json({ found: false });
  }
});

// GET /api/perseus-log/unlocks/:period — no auth (standalone)
app.get('/api/perseus-log/unlocks/:period', (req, res) => {
  try {
    const { period } = req.params;
    const rows = query(
      'SELECT unlocked_up_to FROM perseus_log_unlocks WHERE class_period = ?',
      [period]
    );
    const unlocked = (rows.length > 0 && rows[0].unlocked_up_to !== null)
      ? rows[0].unlocked_up_to : -1;
    res.json({ period, unlocked_up_to: unlocked });
  } catch (err) {
    res.json({ period: req.params.period, unlocked_up_to: -1 });
  }
});

// POST /api/perseus-log/unlock — from teacher modal in perseus page
app.post('/api/perseus-log/unlock', (req, res) => {
  try {
    const { period, unlock_up_to } = req.body;

    if (!period || unlock_up_to === undefined) {
      return res.status(400).json({ error: 'period and unlock_up_to required' });
    }

    const existing = query(
      'SELECT class_period FROM perseus_log_unlocks WHERE class_period = ?',
      [period]
    );
    if (existing.length > 0) {
      run('UPDATE perseus_log_unlocks SET unlocked_up_to = ? WHERE class_period = ?',
        [unlock_up_to, period]);
    } else {
      run('INSERT INTO perseus_log_unlocks (class_period, unlocked_up_to) VALUES (?, ?)',
        [period, unlock_up_to]);
    }

    saveDatabase();
    console.log(`🪽 Perseus unlock: ${period} → stop ${unlock_up_to}`);
    res.json({ success: true, period, unlocked_up_to: unlock_up_to });

  } catch (err) {
    console.error('Perseus log unlock error:', err);
    res.status(500).json({ error: 'Failed to set unlock' });
  }
});

// POST /api/teacher/perseus-log-unlock — teacher JWT version
app.post('/api/teacher/perseus-log-unlock', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
    const { class_period, unlock_up_to } = req.body;

    if (!class_period || unlock_up_to === undefined) {
      return res.status(400).json({ error: 'class_period and unlock_up_to required' });
    }

    const existing = query(
      'SELECT class_period FROM perseus_log_unlocks WHERE class_period = ?',
      [class_period]
    );
    if (existing.length > 0) {
      run('UPDATE perseus_log_unlocks SET unlocked_up_to = ? WHERE class_period = ?',
        [unlock_up_to, class_period]);
    } else {
      run('INSERT INTO perseus_log_unlocks (class_period, unlocked_up_to) VALUES (?, ?)',
        [class_period, unlock_up_to]);
    }

    saveDatabase();
    console.log(`🪽 Perseus unlock (teacher): ${class_period} → stop ${unlock_up_to}`);
    res.json({ success: true, class_period, unlocked_up_to: unlock_up_to });

  } catch (err) {
    console.error('Perseus log unlock error:', err);
    res.status(500).json({ error: 'Failed to set unlock' });
  }
});

// GET /api/teacher/perseus-log-unlock-status — returns all periods' unlock state
app.get('/api/teacher/perseus-log-unlock-status', (req, res) => {
  try {
    const rows = query('SELECT class_period, unlocked_up_to FROM perseus_log_unlocks ORDER BY class_period');
    res.json({ unlocks: rows });
  } catch (err) {
    res.json({ unlocks: [] });
  }
});

// POST /api/perseus-log/submit — no JWT (standalone HTML)
app.post('/api/perseus-log/submit', (req, res) => {
  try {
    const {
      student_name, class_period, student_id, alliance_name,
      hero_code, rank_tier, total_score,
      stop_scores, written_answers
    } = req.body;

    if (!student_name || !class_period) {
      return res.status(400).json({ error: 'student_name and class_period required' });
    }

    const existing = query(
      'SELECT completion_id FROM perseus_log_completions WHERE student_name = ? AND class_period = ?',
      [student_name, class_period]
    );

    if (existing.length > 0) {
      run(
        `UPDATE perseus_log_completions SET
          alliance_name=?, hero_code=?, rank_tier=?, total_score=?,
          stop_scores=?, written_answers=?, completed_at=CURRENT_TIMESTAMP
         WHERE student_name=? AND class_period=?`,
        [
          alliance_name || null, hero_code || null, rank_tier || null,
          total_score || 0, JSON.stringify(stop_scores || {}),
          JSON.stringify(written_answers || {}), student_name, class_period
        ]
      );
    } else {
      run(
        `INSERT INTO perseus_log_completions
          (student_name, class_period, alliance_name, hero_code, rank_tier, total_score, stop_scores, written_answers)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          student_name, class_period, alliance_name || null,
          hero_code || null, rank_tier || null, total_score || 0,
          JSON.stringify(stop_scores || {}), JSON.stringify(written_answers || {})
        ]
      );
    }

    saveDatabase();
    console.log(`🪽 Perseus log submitted: ${student_name} (${class_period}) — ${rank_tier} — ${total_score} pts`);

    // ── Bridge rewards to student account ──
    try {
      const prsDrachma = { CAS: 0, WAN: 15, SEE: 30, SLA: 50, HOP: 75 };
      const tier = (rank_tier || 'CAS').toUpperCase();
      const drachmaReward = prsDrachma[tier] || 0;

      const sid = student_id ? parseInt(student_id) : null;
      let studentRow;
      if (sid) {
        studentRow = query('SELECT student_id, drachma FROM students WHERE student_id = ?', [sid]);
      }
      if ((!studentRow || studentRow.length === 0) && student_name && class_period) {
        studentRow = query('SELECT student_id, drachma FROM students WHERE name = ? AND class_period = ?', [student_name, class_period]);
      }
      if (studentRow && studentRow.length > 0) {
        const currentDrachma = studentRow[0].drachma || 0;
        run(
          'UPDATE students SET drachma = ?, perseus_log_completed = 1, perseus_hero_code = ?, perseus_rank_tier = ? WHERE student_id = ?',
          [currentDrachma + drachmaReward, hero_code || null, tier, studentRow[0].student_id]
        );
        saveDatabase();
        console.log(`🪽 Perseus rewards: +${drachmaReward} drachma → student_id ${studentRow[0].student_id}`);
      }
    } catch (bridgeErr) {
      console.error('🪽 Perseus reward bridge error (non-fatal):', bridgeErr.message);
    }

    res.json({ success: true, hero_code, rank_tier });

  } catch (err) {
    console.error('Perseus log submit error:', err);
    res.status(500).json({ error: 'Failed to save perseus log' });
  }
});

// GET /api/perseus-log/status/:period — teacher dashboard completions
app.get('/api/perseus-log/status/:period', authenticateToken, (req, res) => {
  try {
    if (req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher only' });
    const { period } = req.params;

    const completions = query(
      `SELECT student_name, alliance_name, hero_code, rank_tier,
              total_score, completed_at
       FROM perseus_log_completions
       WHERE class_period = ?
       ORDER BY total_score DESC`,
      [period]
    );

    let studentCount = 0;
    try {
      const totalStudents = query(
        'SELECT COUNT(*) as cnt FROM students WHERE class_period = ? AND (is_ghost = 0 OR is_ghost IS NULL)',
        [period]
      );
      studentCount = (totalStudents[0] && totalStudents[0].cnt) || 0;
    } catch (countErr) {
      const totalStudents = query(
        'SELECT COUNT(*) as cnt FROM students WHERE class_period = ?',
        [period]
      );
      studentCount = (totalStudents[0] && totalStudents[0].cnt) || 0;
    }

    res.json({
      completions,
      total_students: studentCount,
      completed_count: completions.length
    });
  } catch (err) {
    console.error('Perseus log status error:', err);
    res.status(500).json({ error: 'Failed to load perseus status' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ATHENA AI — STATUS CHECK (diagnostic)
// ═══════════════════════════════════════════════════════════════════════════
app.get('/api/athena-status', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return res.json({
      configured: false,
      mode: 'local_regex',
      message: 'No ANTHROPIC_API_KEY set. Athena is using local regex fallback grading.'
    });
  }

  // Key exists — try a minimal API call to verify it works
  try {
    const testRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Say OK' }]
      })
    });

    if (testRes.ok) {
      return res.json({
        configured: true,
        mode: 'anthropic_ai',
        message: 'Athena AI grading is ACTIVE. Anthropic API key is valid and working.',
        model: 'claude-sonnet-4-20250514'
      });
    } else {
      const errData = await testRes.json().catch(() => ({}));
      return res.json({
        configured: true,
        mode: 'fallback',
        message: 'ANTHROPIC_API_KEY is set but API returned an error. Falling back to local regex.',
        status: testRes.status,
        error: errData.error?.message || 'Unknown error'
      });
    }
  } catch (err) {
    return res.json({
      configured: true,
      mode: 'fallback',
      message: 'ANTHROPIC_API_KEY is set but API is unreachable. Falling back to local regex.',
      error: err.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SHARED ATHENA AI GRADING ENDPOINT
// Used by Jason, Hercules, Theseus, and future viewing guides
// Uses Anthropic API when ANTHROPIC_API_KEY is set; falls back to local regex
// ═══════════════════════════════════════════════════════════════════════════
async function athenaGradeHandler(req, res) {
  try {
    const { student_name, question, answer, min_words, max_pts, is_revision, stop_title, stop_brief } = req.body;

    if (!answer || !question) {
      return res.status(400).json({ error: 'question and answer required' });
    }

    const words = answer.trim().split(/\s+/).filter(w => w.length > 0).length;
    const apiKey = process.env.ANTHROPIC_API_KEY;

    // ── Try Anthropic API if key is set ──────────────────────────
    if (apiKey) {
      try {
        const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 400,
            system: `You are Athena, goddess of wisdom, grading a 6th-grade student's short answer about Greek mythology. You are wise, warm, and direct. You speak to the student by name.

Your job: grade the student's response on a 1-3 star scale and give brief, specific feedback.

RUBRIC:
★★★ (3 stars = full points): Student names specific evidence from the story, states a clear claim/position, and explains their reasoning with connective language (because, therefore, this shows). Response meets minimum word count.
★★ (2 stars = 70% points): Student has some evidence OR some reasoning but is missing one key element. Tell them exactly what is missing.
★☆ (1 star = 30% points): Response is too vague, too short, or lacks evidence and reasoning. Tell them specifically what to add.

IMPORTANT RULES:
- Address the student by their first name
- Keep feedback to 2-3 sentences maximum
- Be specific about what they did well and what's missing
- Never be harsh — be encouraging but honest
- If this is a revision, acknowledge the improvement

Respond in EXACTLY this JSON format with no other text:
{"stars": 3, "feedback": "Your feedback here, {name}."}`,
            messages: [{
              role: 'user',
              content: `STUDENT NAME: ${student_name}
QUESTION: ${question}
CONTEXT: ${stop_title} — ${stop_brief}
MINIMUM WORDS: ${min_words}
ACTUAL WORD COUNT: ${words}
IS REVISION: ${is_revision ? 'yes' : 'no'}

STUDENT'S ANSWER:
${answer}`
            }]
          })
        });

        if (apiRes.ok) {
          const apiData = await apiRes.json();
          const text = apiData.content && apiData.content[0] && apiData.content[0].text;
          if (text) {
            // Parse JSON from Claude's response
            const cleaned = text.replace(/```json|```/g, '').trim();
            const parsed = JSON.parse(cleaned);
            const stars = Math.max(1, Math.min(3, parsed.stars || 1));
            const ptsMap = { 3: max_pts, 2: Math.round(max_pts * 0.7), 1: Math.round(max_pts * 0.3) };
            return res.json({
              success: true,
              stars,
              pts: ptsMap[stars],
              feedback: parsed.feedback || 'Athena has reviewed your answer.'
            });
          }
        }
        // If API call failed, fall through to local fallback
        console.warn('🗡️ Athena API returned non-ok, falling back to local grading');
      } catch (apiErr) {
        console.warn('🗡️ Athena API error, falling back to local grading:', apiErr.message);
      }
    }

    // ── Local regex fallback (no API key or API failed) ──────────
    const storyWords = /theseus|aegeus|medea|minotaur|labyrinth|ariadne|daedalus|minos|crete|athens|sword|sandals|rock|poison|sails|thread|tribute|hercules|heracles|jason|iolaus|atlas|fleece|hydra|pelias|perseus|medusa|gorgon|acrisius|danae|polydectes|pegasus|graeae|nymphs|shield|reflection|oracle|prophecy|discus|chest|sea|invisible|helmet/i;
    const claimWords = /because|therefore|this shows|i think|i believe|clearly|however|which means|this proves|the reason|reveals|tells us|suggests|demonstrates/i;
    const reasonWords = /because|therefore|which means|this means|this shows|as a result|this suggests|this proves|this tells us|we can see|even though|although|not only|but also/i;

    const hasEvidence = storyWords.test(answer);
    const hasClaim = claimWords.test(answer);
    const hasReasoning = reasonWords.test(answer);
    const longEnough = words >= min_words;
    const veryLong = words >= min_words * 1.5;

    let score = 0;
    if (longEnough) score += 2;
    if (veryLong) score += 1;
    if (hasEvidence) score += 3;
    if (hasClaim) score += 2;
    if (hasReasoning) score += 2;

    const pts = Math.min(max_pts, Math.max(Math.round(max_pts * 0.3), Math.round(score * max_pts / 10)));
    const stars = pts >= max_pts * 0.9 ? 3 : pts >= max_pts * 0.6 ? 2 : 1;

    const missing = [];
    if (!hasEvidence) missing.push('name a specific character or moment from the story');
    if (!hasClaim) missing.push("state your position clearly (use words like 'because' or 'this shows')");
    if (!hasReasoning) missing.push('explain WHY, not just WHAT happened');
    if (!longEnough) missing.push(`write more — aim for at least ${min_words} words`);

    const missingStr = missing.length > 0 ? ' To improve: ' + missing.join('. ') + '.' : '';
    const revNote = is_revision ? 'Your revision strengthens what was already taking shape. ' : '';

    let feedback;
    if (stars === 3) {
      feedback = `${revNote}You have done what a true thinker does, ${student_name}: named your evidence, stated a clear position, and followed your reasoning to its end. The gods take note of those who think deeply.`;
    } else if (stars === 2) {
      feedback = `${revNote}You see part of the answer, ${student_name}.${missingStr} A hero does not stop when the goal is in sight — push the argument all the way to the finish.`;
    } else {
      feedback = `${revNote}A beginning, ${student_name} — but Athena requires more.${missingStr} A warrior carries a sword. A thinker carries a complete argument. Return to this and build one.`;
    }

    res.json({ success: true, stars, pts, feedback });

  } catch (err) {
    console.error('Athena grade error:', err);
    res.status(500).json({ success: false, error: 'Grading failed' });
  }
}
// Register on all viewing guide routes
app.post('/api/athena-grade', athenaGradeHandler);
app.post('/api/theseus-log/athena-grade', athenaGradeHandler);
app.post('/api/hercules-log/athena-grade', athenaGradeHandler);
app.post('/api/perseus-log/athena-grade', athenaGradeHandler);
app.post('/api/voyage-log/athena-grade', athenaGradeHandler);

// ══════════════════════════════════════════════════════════════════════════
// TEACHER RESET / REWIND — Heroic chapters (Jason, Hercules, Theseus, Perseus)
// ══════════════════════════════════════════════════════════════════════════
// All endpoints JWT-authenticated and require req.user.type === 'teacher'.
// Factory generates the three reset endpoints + the "students with progress"
// listing endpoint for one game, keeping behavior consistent across chapters.
//
// gameKey:       URL slug, e.g. 'voyage-log' | 'hercules-log' | 'theseus-log' | 'perseus-log'
// progressTable: e.g. 'voyage_log_progress'
// completionsTable: e.g. 'voyage_log_completions'
// totalStops:    expected number of stops for rewind-validity check
// studentFields: optional array of column names on the students table to clear
//                  (e.g. ['hercules_log_completed','hercules_hero_code','hercules_rank_tier'])
// ──────────────────────────────────────────────────────────────────────────
function registerHeroicResetEndpoints(gameKey, progressTable, completionsTable, totalStops, studentFields){
  const logLabel = gameKey.replace(/-log$/, '').replace(/^./, c => c.toUpperCase());

  // Helper: clear any completion-linked fields on the students table so the
  // student's main dashboard no longer shows them as completed.
  function clearStudentCompletionFields(studentIds){
    if(!studentFields || studentFields.length === 0 || !studentIds || studentIds.length === 0) return;
    const setClause = studentFields.map(f => {
      if(f.endsWith('_completed')) return `${f} = 0`;
      return `${f} = NULL`;
    }).join(', ');
    studentIds.forEach(sid => {
      try { run(`UPDATE students SET ${setClause} WHERE student_id = ?`, [sid]); } catch(e) {}
    });
  }

  // ── GET /api/teacher/<game>-students-with-progress/:period ────────────────
  // Returns the list of non-ghost students in this period along with their
  // saved progress summary (currentStop, completedCount) and whether they've
  // submitted a completion row. Drives the reset UI's student picker.
  app.get(`/api/teacher/${gameKey}-students-with-progress/:period`, authenticateToken, (req, res) => {
    if(req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher access required' });
    try {
      const period = req.params.period;
      const students = query(`
        SELECT s.student_id, s.name, a.alliance_name
        FROM students s
        LEFT JOIN alliances a ON a.alliance_id = s.alliance_id
        WHERE s.class_period = ? AND (s.is_ghost = 0 OR s.is_ghost IS NULL)
        ORDER BY s.name
      `, [period]);

      const out = students.map(s => {
        // Progress — prefer student_id, fall back to name+period
        let progRows = query(`SELECT state_json FROM ${progressTable} WHERE student_id = ?`, [s.student_id]);
        if(progRows.length === 0){
          progRows = query(`SELECT state_json FROM ${progressTable} WHERE student_name = ? AND class_period = ?`, [s.name, period]);
        }
        let currentStop = -1, completedCount = 0;
        if(progRows.length > 0){
          try {
            const st = JSON.parse(progRows[0].state_json);
            currentStop = (typeof st.currentStop === 'number') ? st.currentStop : -1;
            completedCount = Object.keys(st.completed || {}).filter(k => st.completed[k]).length;
          } catch(e) {}
        }
        // Completion
        const compRows = query(`SELECT completion_id FROM ${completionsTable} WHERE student_name = ? AND class_period = ?`, [s.name, period]);
        return {
          student_id: s.student_id,
          name: s.name,
          alliance_name: s.alliance_name || 'Independent',
          has_progress: progRows.length > 0,
          current_stop: currentStop,
          completed_count: completedCount,
          has_completion: compRows.length > 0
        };
      });
      res.json({ students: out });
    } catch (err) {
      console.error(`${logLabel} students-with-progress error:`, err);
      res.status(500).json({ error: 'Failed to load students' });
    }
  });

  // ── POST /api/teacher/<game>-reset-student ────────────────────────────────
  // Full reset for one student. Wipes both progress and completion rows.
  // Body: { student_id, class_period }  (class_period needed for name-based fallback)
  app.post(`/api/teacher/${gameKey}-reset-student`, authenticateToken, (req, res) => {
    if(req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher access required' });
    try {
      const { student_id, class_period } = req.body;
      const sid = parseInt(student_id);
      if(!sid || !class_period) return res.status(400).json({ error: 'student_id and class_period required' });

      const stu = query('SELECT name FROM students WHERE student_id = ?', [sid]);
      if(stu.length === 0) return res.status(404).json({ error: 'Student not found' });
      const name = stu[0].name;

      // Wipe progress (both id-matched and name+period-matched rows, in case of dupes)
      run(`DELETE FROM ${progressTable} WHERE student_id = ?`, [sid]);
      run(`DELETE FROM ${progressTable} WHERE student_name = ? AND class_period = ?`, [name, class_period]);
      // Wipe completion
      run(`DELETE FROM ${completionsTable} WHERE student_name = ? AND class_period = ?`, [name, class_period]);
      // Clear completion flags on the students table
      clearStudentCompletionFields([sid]);

      saveDatabase();
      res.json({ success: true, student_id: sid, name });
    } catch (err) {
      console.error(`${logLabel} reset-student error:`, err);
      res.status(500).json({ error: 'Reset failed' });
    }
  });

  // ── POST /api/teacher/<game>-rewind-student ───────────────────────────────
  // Rewind one student to stop N. Loads their state JSON, truncates
  // completed/scores/feedback/etc. past stop N, sets currentStop = N,
  // writes it back. Also deletes any completion row (they are now incomplete).
  // Body: { student_id, class_period, rewind_to_stop }
  app.post(`/api/teacher/${gameKey}-rewind-student`, authenticateToken, (req, res) => {
    if(req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher access required' });
    try {
      const { student_id, class_period, rewind_to_stop } = req.body;
      const sid = parseInt(student_id);
      const targetStop = parseInt(rewind_to_stop);
      if(!sid || !class_period || isNaN(targetStop)){
        return res.status(400).json({ error: 'student_id, class_period, and rewind_to_stop required' });
      }
      if(targetStop < 0 || targetStop >= totalStops){
        return res.status(400).json({ error: `rewind_to_stop must be 0..${totalStops - 1}` });
      }

      const stu = query('SELECT name FROM students WHERE student_id = ?', [sid]);
      if(stu.length === 0) return res.status(404).json({ error: 'Student not found' });
      const name = stu[0].name;

      // Find the progress row (id first, then name+period)
      let progRows = query(`SELECT state_json FROM ${progressTable} WHERE student_id = ?`, [sid]);
      if(progRows.length === 0){
        progRows = query(`SELECT state_json FROM ${progressTable} WHERE student_name = ? AND class_period = ?`, [name, class_period]);
      }
      if(progRows.length === 0){
        return res.status(404).json({ error: 'No saved progress to rewind' });
      }

      let st;
      try { st = JSON.parse(progRows[0].state_json); }
      catch(e){ return res.status(500).json({ error: 'Saved state is corrupt' }); }

      // Truncate any per-stop map keyed by numeric index, keeping only keys < targetStop
      const mapKeys = ['completed','scores','feedback','reviseUsed','writtenText',
                       'predAnswers','dragAnswers','mcAnswers','dragSorts'];
      mapKeys.forEach(k => {
        if(st[k] && typeof st[k] === 'object'){
          Object.keys(st[k]).forEach(key => {
            const n = parseInt(key);
            if(!isNaN(n) && n >= targetStop){
              delete st[k][key];
            }
          });
        }
      });
      // Recompute totalScore from remaining scores
      if(st.scores && typeof st.scores === 'object'){
        st.totalScore = Object.values(st.scores).reduce((a, b) => a + (parseInt(b) || 0), 0);
      } else {
        st.totalScore = 0;
      }
      // Set currentStop to the rewind target
      st.currentStop = targetStop;

      // Save back (ensure student_id is set for future id-based lookups)
      const stateJson = JSON.stringify(st);
      const existsById = query(`SELECT student_name FROM ${progressTable} WHERE student_id = ?`, [sid]);
      if(existsById.length > 0){
        run(`UPDATE ${progressTable} SET state_json = ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ?`,
          [stateJson, sid]);
      } else {
        run(`UPDATE ${progressTable} SET state_json = ?, student_id = ?, updated_at = CURRENT_TIMESTAMP WHERE student_name = ? AND class_period = ?`,
          [stateJson, sid, name, class_period]);
      }
      // Drop any completion row — they're incomplete again
      run(`DELETE FROM ${completionsTable} WHERE student_name = ? AND class_period = ?`, [name, class_period]);
      // Clear completion flags on students table
      clearStudentCompletionFields([sid]);

      saveDatabase();
      res.json({ success: true, student_id: sid, name, rewound_to: targetStop });
    } catch (err) {
      console.error(`${logLabel} rewind-student error:`, err);
      res.status(500).json({ error: 'Rewind failed' });
    }
  });

  // ── POST /api/teacher/<game>-reset-period ─────────────────────────────────
  // Bulk wipe of all progress + completions for the period. Destructive.
  // Body: { class_period, confirm_period }  — confirm_period must match class_period exactly
  app.post(`/api/teacher/${gameKey}-reset-period`, authenticateToken, (req, res) => {
    if(req.user.type !== 'teacher') return res.status(403).json({ error: 'Teacher access required' });
    try {
      const { class_period, confirm_period } = req.body;
      if(!class_period) return res.status(400).json({ error: 'class_period required' });
      if(confirm_period !== class_period){
        return res.status(400).json({ error: 'confirm_period must match class_period (safety check)' });
      }

      // Find all non-ghost students in this period so we can clear their completion flags
      const students = query(`
        SELECT student_id, name FROM students
        WHERE class_period = ? AND (is_ghost = 0 OR is_ghost IS NULL)
      `, [class_period]);
      const studentIds = students.map(s => s.student_id);

      // Count first so we can report impact
      const progCount = query(`SELECT COUNT(*) as c FROM ${progressTable} WHERE class_period = ?`, [class_period]);
      const compCount = query(`SELECT COUNT(*) as c FROM ${completionsTable} WHERE class_period = ?`, [class_period]);
      const progN = (progCount[0] && progCount[0].c) || 0;
      const compN = (compCount[0] && compCount[0].c) || 0;

      run(`DELETE FROM ${progressTable} WHERE class_period = ?`, [class_period]);
      run(`DELETE FROM ${completionsTable} WHERE class_period = ?`, [class_period]);
      clearStudentCompletionFields(studentIds);

      saveDatabase();
      res.json({
        success: true,
        class_period,
        progress_rows_deleted: progN,
        completion_rows_deleted: compN,
        students_affected: studentIds.length
      });
    } catch (err) {
      console.error(`${logLabel} reset-period error:`, err);
      res.status(500).json({ error: 'Period reset failed' });
    }
  });
}

// Register for all four Heroic-chapter games
registerHeroicResetEndpoints('voyage-log',    'voyage_log_progress',    'voyage_log_completions',    10, []);
registerHeroicResetEndpoints('hercules-log',  'hercules_log_progress',  'hercules_log_completions',  8,  ['hercules_log_completed','hercules_hero_code','hercules_rank_tier']);
registerHeroicResetEndpoints('theseus-log',   'theseus_log_progress',   'theseus_log_completions',   8,  ['theseus_log_completed','theseus_hero_code','theseus_rank_tier']);
registerHeroicResetEndpoints('perseus-log',   'perseus_log_progress',   'perseus_log_completions',   8,  ['perseus_log_completed','perseus_hero_code','perseus_rank_tier']);
