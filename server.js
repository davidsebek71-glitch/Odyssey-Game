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
      const ghostPointsEach = realMembers.length > 0 ? Math.round(alliance.total_points / realMembers.length) : 0;
      alliance.ghost_bonus = ghostPointsEach * ghostMembers.length;
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
        a.created_at,
        COUNT(s.student_id) as member_count,
        GROUP_CONCAT(s.name, ', ') as member_names
      FROM alliances a
      LEFT JOIN students s ON a.alliance_id = s.alliance_id
      WHERE a.is_disbanded = 0
      GROUP BY a.alliance_id
      ORDER BY a.class_period, a.total_points DESC
    `);
    
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
        SELECT student_id, name, technologies_unlocked, is_ghost
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
      const ghostPointsEach = livingCount > 0 ? Math.round(student.alliance_points / livingCount) : 0;
      
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
      const ghostPointsEach = counts.living > 0 ? Math.round(alliance.total_points / counts.living) : 0;
      const ghostBonus = ghostPointsEach * counts.ghost;
      
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
    
    // Validate points - reject anything over 100
    if (!points_claimed || points_claimed < 1) {
      return res.status(400).json({ error: 'Points must be at least 1' });
    }
    if (points_claimed > 100) {
      return res.status(400).json({ error: 'Maximum submission is 100 points. Contact your teacher if you need to submit more.' });
    }
    
    // Get student's alliance
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    
    if (!student || !student.alliance_id) {
      return res.status(400).json({ error: 'You must be in an alliance to submit points' });
    }
    
    // Create submission with max_points, myth_god, and section
    run(`INSERT INTO point_submissions (student_id, alliance_id, points_claimed, max_points, category, myth_god, section, description, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`, 
        [student_id, student.alliance_id, points_claimed, max_points || null, category, myth_god || null, section || null, description]);
    
    res.json({ success: true, message: 'Points submitted for teacher approval!' });
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
          completed: section1Completed.map(r => ({ display_name: r.display_name, myth_god: r.myth_god, points_earned: r.points_earned, points_possible: r.points_possible, assignment_type: r.assignment_type })),
          missing: section1Missing
        },
        section2: {
          earned: section2Earned, max: section2Max,
          percentage: section2Max > 0 ? Math.round((section2Earned / section2Max) * 100) : 0,
          completed: section2Completed.map(r => ({ display_name: r.display_name, myth_god: r.myth_god, points_earned: r.points_earned, points_possible: r.points_possible, assignment_type: r.assignment_type })),
          missing: section2Missing
        },
        bonus: {
          earned: bonusEarned, max: bonusMax,
          percentage: bonusMax > 0 ? Math.round((bonusEarned / bonusMax) * 100) : 0,
          completed: bonusCompleted.map(r => ({ display_name: r.display_name, myth_god: r.myth_god, points_earned: r.points_earned, points_possible: r.points_possible }))
        }
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
            points_earned: r.points_earned, points_possible: r.points_possible,
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
            points_earned: r.points_earned, points_possible: r.points_possible,
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
          points_earned: r.points_earned, points_possible: r.points_possible
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
          completed: bonusRecords.map(r => ({ display_name: r.display_name, myth_god: r.myth_god, points_earned: r.points_earned, points_possible: r.points_possible })),
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
      allMythCompletions = query('SELECT student_id, portal_id, teacher_approved FROM student_myth_completion WHERE teacher_approved = 1');
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
          
          // Reading guide points (comp_conn for this myth in classical section)
          const guidePoints = studentRecords
            .filter(r => r.assignment_type === 'comp_conn' && r.section === 'classical' && aliases.some(a => r.myth_god === a))
            .reduce((sum, r) => sum + r.points_earned, 0);
          
          // Quiz points (10 if passed)
          const quizPassed = studentQuizzes.some(q => q.portal_id === portalId);
          const quizPoints = quizPassed ? 10 : 0;
          
          // Portal assignment points (15 if approved)
          const completion = studentCompletions.find(c => c.portal_id === portalId);
          const portalPoints = completion ? 15 : 0;
          
          const earned = Math.min(guidePoints, 12) + quizPoints + portalPoints;
          classicalMyths[mythName] = { earned, guide: Math.min(guidePoints, 12), quiz: quizPoints, portal: portalPoints };
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
    
    // Check if old alliance is now empty and delete it
    if (oldAllianceId && (classChanged || allianceChanged)) {
      const remainingMembers = query('SELECT COUNT(*) as count FROM students WHERE alliance_id = ?', [oldAllianceId])[0];
      if (remainingMembers.count === 0) {
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
    
    // Get student's alliance
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    
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
      points_removed: points_to_remove
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
  'Oracle': '/buildings/oracle.png'
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
      // Ghost-specific checks
      if (realMemberCount >= 4) {
        return res.status(400).json({ error: 'Your alliance already has 4+ real members' });
      }
      if (ghostMemberCount >= 2) {
        return res.status(400).json({ error: 'Your alliance already has 2 ghost members (max 2)' });
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
      
      if (realMemberCount < 4 && ghostMemberCount < 2) {
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
    
    // Get buildings available for current age (Archaic shows Archaic, Classical shows both)
    const allBuildings = query(`
      SELECT 
        b.*,
        pb.building_name as prerequisite_name
      FROM buildings_ref b
      LEFT JOIN buildings_ref pb ON b.prerequisite_building_id = pb.building_id
      WHERE b.age_available = ? OR (? = 'Classical' AND b.age_available = 'Archaic')
      ORDER BY b.age_available, b.building_id
    `, [currentAge, currentAge]);
    
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
    if (building.age_available !== currentAge && !(currentAge === 'Classical' && building.age_available === 'Archaic')) {
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
      const allianceMembers = query('SELECT student_id FROM students WHERE alliance_id = ?', [alliance_id]);
      if (allianceMembers.length === 0) {
        return res.status(400).json({ error: 'No alliance members found' });
      }
      for (const member of allianceMembers) {
        const sid = member.student_id;
        // 1. Reading Guide: comp_conn graded for Orpheus & Eurydice myth in classical section
        const hasReadingGuide = query(
          `SELECT 1 FROM grade_records 
           WHERE student_id = ? AND assignment_type = 'comp_conn' 
           AND myth_god = 'Orpheus & Eurydice' AND section = 'classical' AND points_earned > 0 LIMIT 1`,
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
    
    res.json({ 
      success: true, 
      message: `Purchased ${building.building_name} for ${effectiveCost} points${hasPickaxe ? ' (10% discount!)' : ''}`,
      new_balance: alliance.total_points - effectiveCost,
      buildings_owned: ownedBuildings
    });
  } catch (err) {
    console.error('Purchase building error:', err);
    res.status(500).json({ error: 'Failed to purchase building' });
  }
});

// Teacher: Get eligible alliances for a god bonus (all members must have 80%+ on that god's bonus assignment)
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
    
    const threshold = Math.ceil(bonusAssignment.max_points * 0.8);
    
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
      
      // Count members who scored 80%+ on this god's bonus
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
      threshold: `${threshold}/${bonusAssignment.max_points} (80%)`,
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
    // Classical → Heroic requirements: all Archaic buildings PLUS Classical buildings
    requiredBuildings = ['Town Center', 'Library', 'House', 'Dock', 'Fishing Ship', 'Wooden Wall', 'Transport Ship', 'Armory', 'Theater', 'Agora', 'Oracle'];
    pointsThreshold = memberCount === 1 ? 200 : memberCount === 2 ? 400 : memberCount === 3 ? 600 : 800;
  } else {
    // Archaic → Classical requirements
    requiredBuildings = ['Town Center', 'Library', 'House', 'Dock', 'Fishing Ship', 'Wooden Wall'];
    pointsThreshold = memberCount === 1 ? 100 : memberCount === 2 ? 200 : memberCount === 3 ? 300 : 400;
  }
  
  const ownedRequired = requiredBuildings.filter(b => ownedBuildings.includes(b));
  
  // Map check: count how many non-ghost members have uploaded maps
  const membersWithMap = query(
    'SELECT COUNT(*) as count FROM students WHERE alliance_id = ? AND (is_ghost = 0 OR is_ghost IS NULL) AND map_image IS NOT NULL AND map_image != ""',
    [alliance.alliance_id]
  )[0].count;
  const allMapsComplete = membersWithMap >= memberCount && memberCount > 0;
  
  // Update alliance map status if it changed
  if (allMapsComplete && !alliance.civilization_map_complete) {
    run('UPDATE alliances SET civilization_map_complete = 1 WHERE alliance_id = ?', [alliance.alliance_id]);
  } else if (!allMapsComplete && alliance.civilization_map_complete) {
    run('UPDATE alliances SET civilization_map_complete = 0 WHERE alliance_id = ?', [alliance.alliance_id]);
  }
  
  // Calculate progress
  const buildingsProgress = (ownedRequired.length / requiredBuildings.length) * 100;
  const pointsProgress = Math.min(100, (alliance.total_points / pointsThreshold) * 100);
  const mapProgress = allMapsComplete ? 100 : (memberCount > 0 ? (membersWithMap / memberCount) * 100 : 0);
  
  // Overall progress (weighted: buildings 45%, points 35%, maps 20%)
  const overallProgress = (buildingsProgress * 0.45 + pointsProgress * 0.35 + mapProgress * 0.20);
  
  const isReady = ownedRequired.length === requiredBuildings.length &&
                  alliance.total_points >= pointsThreshold &&
                  allMapsComplete;
  
  return {
    currentAge,
    memberCount,
    pointsThreshold,
    pointsHave: alliance.total_points,
    pointsMet: alliance.total_points >= pointsThreshold,
    requiredBuildings,
    ownedRequired,
    buildingsMet: ownedRequired.length === requiredBuildings.length,
    mapComplete: allMapsComplete,
    mapsSubmitted: membersWithMap,
    mapsRequired: memberCount,
    riteComplete: alliance.rite_of_passage_complete === 1,
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
    
    // Get all available buildings for current age
    const buildings = query(`
      SELECT * FROM buildings_ref 
      WHERE age_available = ?
      ORDER BY cost_points ASC
    `, [alliance.current_age]);
    
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
    
    if (fate.fate_type === 'steal_choice') {
      // STEAL-CHOICE: rolledValue is PER ALLIANCE
      // Positive = spinner steals FROM each other alliance
      // Negative = spinner gives TO each other alliance
      const perAlliance = rolledValue;
      
      // Get all other alliances in the same period
      const allPeriodAlliances = query(`
        SELECT DISTINCT a.alliance_id, a.alliance_name, a.total_points
        FROM alliances a 
        JOIN students s ON s.alliance_id = a.alliance_id 
        WHERE s.class_period = (SELECT class_period FROM students WHERE alliance_id = ? LIMIT 1)
          AND a.alliance_id != ? AND a.is_disbanded = 0
      `, [alliance_id, alliance_id]);
      
      const numAlliances = allPeriodAlliances.length;
      const totalForSpinner = perAlliance * numAlliances;
      
      // Apply total to spinning alliance
      run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
          [totalForSpinner, alliance_id]);
      run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) 
           VALUES (?, ?, ?, ?, ?)`, 
          [alliance_id, totalForSpinner, 'fate', 
           `Fate: ${fate.fate_name} (${choice.risk_level} ${success ? 'success' : 'failure'} — ${perAlliance > 0 ? 'stole' : 'gave'} ${Math.abs(perAlliance)} per alliance × ${numAlliances})`, teacher_id]);
      
      // Apply inverse to each other alliance
      allPeriodAlliances.forEach(other => {
        const otherChange = -perAlliance; // inverse: if spinner steals +8, others lose 8
        run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
            [otherChange, other.alliance_id]);
        run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) 
             VALUES (?, ?, ?, ?, ?)`, 
            [other.alliance_id, otherChange, 'fate', 
             `Fate: ${fate.fate_name} (${otherChange > 0 ? 'gained from' : 'lost to'} ${alliance.alliance_name})`, teacher_id]);
      });
      
      pointsChange = totalForSpinner;
      stealDetails = {
        perAlliance,
        alliancesAffected: numAlliances,
        totalChange: totalForSpinner,
        affectedAlliances: allPeriodAlliances.map(a => ({
          name: a.alliance_name,
          pointsChange: -perAlliance
        }))
      };
    } else {
      // REGULAR CHOICE: apply flat points to this alliance only
      run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
          [pointsChange, alliance_id]);
      run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) 
           VALUES (?, ?, ?, ?, ?)`, 
          [alliance_id, pointsChange, 'fate', `Fate: ${fate.fate_name} (${choice.risk_level} choice - ${success ? 'success' : 'failure'})`, teacher_id]);
    }
    
    // Log the fate outcome
    run(`INSERT INTO fate_outcomes (alliance_id, fate_id, outcome_type, choice_made, points_awarded) 
         VALUES (?, ?, ?, ?, ?)`, 
        [alliance_id, fate_id, success ? 'success' : 'failure', choice.risk_level, pointsChange]);
    
    // Log the fate spin
    run(`INSERT INTO fate_spins (alliance_id, fate_id, fate_name, result_type, points_change, teacher_id) 
         VALUES (?, ?, ?, ?, ?, ?)`, 
        [alliance_id, fate_id, fate.fate_name, 'choice', pointsChange, teacher_id]);
    
    // Get updated alliance
    const updatedAlliance = query('SELECT * FROM alliances WHERE alliance_id = ?', [alliance_id])[0];

    res.json({
      success,
      pointsChange,
      choice,
      fate,
      updatedAlliance,
      roll: (roll * 100).toFixed(1),
      stealDetails
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
    saveDatabase();
    
    console.log(`🔄 Alliance ${student.alliance_id} used a Reverse Card`);
    res.json({ success: true, remainingCards: alliance.reverse_cards - 1 });
  } catch (err) {
    console.error('Use reverse card error:', err);
    res.status(500).json({ error: 'Failed to use Reverse Card' });
  }
});

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
    
    // Process fate based on type
    if (fate.fate_type === 'simple_points') {
      // Simple point addition/subtraction
      const pointsChange = fate.point_effect || 0;
      run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
          [pointsChange, alliance_id]);
      
      run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) 
           VALUES (?, ?, ?, ?, ?)`, 
          [alliance_id, pointsChange, 'fate', `Fate: ${fate.fate_name}`, teacher_id]);
      
      result.pointsChange = pointsChange;
    } 
    else if (fate.fate_type === 'interactive') {
      // Steals from or gives to other alliances
      const allAlliances = query('SELECT alliance_id, total_points FROM alliances WHERE alliance_id != ?', [alliance_id]);
      const transferAmount = fate.transfer_amount || 0;
      
      if (fate.steals_from_others) {
        // This alliance gains from each other alliance
        const totalGain = transferAmount * allAlliances.length;
        run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
            [totalGain, alliance_id]);
        
        allAlliances.forEach(other => {
          run('UPDATE alliances SET total_points = total_points - ? WHERE alliance_id = ?', 
              [transferAmount, other.alliance_id]);
          run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) 
               VALUES (?, ?, ?, ?, ?)`, 
              [other.alliance_id, -transferAmount, 'fate', `Fate: ${fate.fate_name} (stolen by ${alliance.alliance_name})`, teacher_id]);
        });
        
        run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) 
             VALUES (?, ?, ?, ?, ?)`, 
            [alliance_id, totalGain, 'fate', `Fate: ${fate.fate_name} (stole from each alliance)`, teacher_id]);
        
        result.pointsChange = totalGain;
      } 
      else if (fate.gives_to_others) {
        // This alliance loses to each other alliance
        const totalLoss = transferAmount * allAlliances.length;
        run('UPDATE alliances SET total_points = total_points - ? WHERE alliance_id = ?', 
            [totalLoss, alliance_id]);
        
        allAlliances.forEach(other => {
          run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
              [transferAmount, other.alliance_id]);
          run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) 
               VALUES (?, ?, ?, ?, ?)`, 
              [other.alliance_id, transferAmount, 'fate', `Fate: ${fate.fate_name} (gift from ${alliance.alliance_name})`, teacher_id]);
        });
        
        run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) 
             VALUES (?, ?, ?, ?, ?)`, 
            [alliance_id, -totalLoss, 'fate', `Fate: ${fate.fate_name} (gave to each alliance)`, teacher_id]);
        
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
    
    // Apply technology bonuses (multiplicative)
    const members = query('SELECT student_id, technologies_unlocked FROM students WHERE alliance_id = ?', [alliance_id]);
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
    const pointsChange = victory ? fate.battle_win_points : fate.battle_lose_points;
    
    // Apply points
    run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', 
        [pointsChange, alliance_id]);
    
    // Log transaction
    const battleResult = victory ? 'Victory' : 'Defeat';
    run(`INSERT INTO point_transactions (alliance_id, amount, category, reason, teacher_id) 
         VALUES (?, ?, ?, ?, ?)`, 
        [alliance_id, pointsChange, 'battle', `Battle ${battleResult}: ${fate_name}`, teacher_id]);
    
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
    
    // Get all bonus grade records with 80% threshold check
    const allBonusRecords = query(`
      SELECT gr.student_id, gr.assignment_id, gr.points_earned, ar.max_points
      FROM grade_records gr
      JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
      WHERE ar.section = 'bonus' AND gr.points_earned > 0
    `);
    
    // Build a lookup: { student_id: { assignment_id: true } } - only if 80%+ threshold met
    const bonusLookup = {};
    allBonusRecords.forEach(r => {
      if (!bonusLookup[r.student_id]) bonusLookup[r.student_id] = {};
      const threshold = Math.ceil(r.max_points * 0.8);
      bonusLookup[r.student_id][r.assignment_id] = r.points_earned >= threshold;
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
    baseEffect: 2, // seconds early
    bonusEffect: 3,
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
        my_god_deployed: isChallenger ? currentRound.challenger_god_deployed : currentRound.defender_god_deployed,
        opponent_god_deployed: isChallenger ? currentRound.defender_god_deployed : currentRound.challenger_god_deployed,
        my_deploy_ready: myDeployReady === 1,
        opponent_deploy_ready: opponentDeployReady === 1,
        both_deployed: (currentRound.challenger_deploy_ready === 1 && currentRound.defender_deploy_ready === 1),
        // Sudden death ready states
        my_sd_ready: isChallenger ? currentRound.challenger_question_ready === 1 : currentRound.defender_question_ready === 1,
        opponent_sd_ready: isChallenger ? currentRound.defender_question_ready === 1 : currentRound.challenger_question_ready === 1
      };
      
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
      // Both ready - transition to question phase with 3-second sync delay
      // Extra second helps account for polling interval differences between clients
      const questionDisplayTime = new Date(Date.now() + 3000).toISOString();
      const phaseEndsAt = new Date(Date.now() + 3000 + BATTLE_TIMING.QUESTION_PHASE).toISOString();
      
      run(`UPDATE arena_battle_rounds 
           SET phase = 'question', question_display_time = ?, phase_ends_at = ?
           WHERE round_id = ?`,
        [questionDisplayTime, phaseEndsAt, currentRound.round_id]);
      
      console.log(`⚡ SUDDEN DEATH - Both ready! Question reveals at ${questionDisplayTime}`);
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
      allianceAge: isScout && allianceAge === 'Archaic' ? student.scout_status : allianceAge,
      canAccess,
      classicalEntered: student.classical_entered === 1,
      isScout: isScout || false
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
      SELECT gr.*, ar.assignment_type, ar.myth_god, ar.section, ar.age
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

    // Build enriched portal data
    const enrichedPortals = portals.map(portal => {
      // Check reading guide completion (comp_conn for this myth in classical section)
      const hasReadingGuide = gradeRecords.some(g => 
        g.assignment_type === 'comp_conn' && 
        g.myth_god === portal.myth_name && 
        g.section === 'classical' &&
        g.points_earned > 0
      );
      
      // Check quiz passed (from myth_quiz_attempts, 80%+ to pass)
      const quizResult = quizAttempts.find(q => q.portal_id === portal.portal_id);
      const quizPassed = quizResult ? 1 : 0;
      
      // Check creative work (legacy: word_cloud or mural for this myth)
      const hasCreative = gradeRecords.some(g => 
        (g.assignment_type === 'word_cloud' || g.assignment_type === 'mural') && 
        g.myth_god === portal.myth_name && 
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
        g.myth_god === portal.myth_name && 
        g.section === 'classical'
      );
      const guideEarned = guideGrade ? guideGrade.points_earned : (hasReadingGuide ? 12 : 0);
      const guidePossible = guideGrade ? guideGrade.points_possible : 12;
      
      // Virtue ready to claim: quiz passed + assignment approved (but not yet claimed)
      const virtueReady = quizPassed && (assignmentApproved || hasCreative) && !virtueClaimed ? 1 : 0;
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
    
    // Check that teacher has approved
    const completion = query('SELECT * FROM student_myth_completion WHERE student_id = ? AND portal_id = ?', [student_id, portal_id]);
    if (!completion.length || !completion[0].teacher_approved) {
      return res.status(400).json({ error: 'Assignment not yet approved' });
    }
    if (completion[0].virtue_claimed) {
      return res.status(400).json({ error: 'Virtue already claimed' });
    }
    
    // Mark virtue as claimed
    run('UPDATE student_myth_completion SET virtue_claimed = 1, virtue_claimed_at = CURRENT_TIMESTAMP WHERE student_id = ? AND portal_id = ?', [student_id, portal_id]);
    
    // Get virtue data for the reveal
    const portal = query('SELECT * FROM myth_portals WHERE portal_id = ?', [portal_id])[0];
    
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
    
    // Get all quiz passes for this period
    const quizPasses = query(`SELECT mqa.student_id, mqa.portal_id FROM myth_quiz_attempts mqa 
      JOIN students s ON mqa.student_id = s.student_id WHERE s.class_period = ? AND mqa.passed = 1`, [period]);
    
    // Get all myth completions for this period
    const completions = query(`SELECT smc.* FROM student_myth_completion smc 
      JOIN students s ON smc.student_id = s.student_id WHERE s.class_period = ?`, [period]);
    
    const studentData = students.map(s => {
      const mythProgress = portals.map(p => {
        const quizPassed = quizPasses.some(qp => qp.student_id === s.student_id && qp.portal_id === p.portal_id);
        const completion = completions.find(c => c.student_id === s.student_id && c.portal_id === p.portal_id);
        return {
          portal_id: p.portal_id,
          myth_name: p.myth_name,
          quiz_passed: quizPassed,
          assignment_path: completion ? completion.assignment_path : null,
          teacher_approved: completion ? completion.teacher_approved === 1 : false,
          virtue_claimed: completion ? completion.virtue_claimed === 1 : false
        };
      });
      return { ...s, myths: mythProgress };
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
    const questions = query('SELECT * FROM myth_quiz_questions WHERE portal_id = ? AND is_active = 1', [portalId]);
    
    if (questions.length === 0) {
      return res.json({ questions: [], message: 'No quiz questions available for this myth yet. Quiz is submitted via Google Classroom.' });
    }
    
    // Shuffle questions (Fisher-Yates)
    for (let i = questions.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [questions[i], questions[j]] = [questions[j], questions[i]];
    }
    
    // Send questions with named option fields for client rendering
    const safeQuestions = questions.map(q => ({
      question_id: q.question_id,
      question_text: q.question_text,
      option_a: q.option_a || q.answer_a,
      option_b: q.option_b || q.answer_b,
      option_c: q.option_c || q.answer_c,
      option_d: q.option_d || q.answer_d,
      correct_answer: q.correct_answer
    }));
    
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
    
    const questions = query('SELECT * FROM myth_quiz_questions WHERE portal_id = ? AND is_active = 1', [portal_id]);
    if (questions.length === 0) return res.status(400).json({ error: 'No questions for this portal' });
    
    // Grade the quiz - answers can be array of {question_id, selected_answer} or object keyed by question_id
    let correct = 0;
    const answerMap = {};
    if (Array.isArray(answers)) {
      answers.forEach(a => { answerMap[a.question_id] = a.selected_answer ? a.selected_answer.toLowerCase() : ''; });
    } else {
      Object.keys(answers).forEach(k => { answerMap[k] = answers[k] ? answers[k].toLowerCase() : ''; });
    }
    
    const results = questions.map(q => {
      const studentAnswer = answerMap[q.question_id] || '';
      const isCorrect = studentAnswer === q.correct_answer;
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
          const quizAssignment = query(
            "SELECT assignment_id, max_points FROM assignments_ref WHERE section = 'classical' AND assignment_type = 'quiz' AND myth_god = ?",
            [portal.myth_name]
          )[0];
          
          if (quizAssignment) {
            // Check if grade record already exists
            const existingGrade = query(
              'SELECT record_id FROM grade_records WHERE student_id = ? AND assignment_id = ?',
              [req.user.id, quizAssignment.assignment_id]
            )[0];
            
            if (!existingGrade) {
              const pointsEarned = Math.round((correct / questions.length) * quizAssignment.max_points);
              run(`INSERT INTO grade_records (student_id, assignment_id, points_earned, points_possible)
                   VALUES (?, ?, ?, ?)`,
                [req.user.id, quizAssignment.assignment_id, pointsEarned, quizAssignment.max_points]);
              console.log(`✅ Quiz grade recorded: ${portal.myth_name} - ${pointsEarned}/${quizAssignment.max_points}`);
            }
          }
        }
      } catch (gradeErr) {
        console.error('Quiz grade recording error:', gradeErr.message);
      }
    }
    
    saveDatabase();
    
    res.json({ score, correct, total: questions.length, passed, results });
  } catch (err) {
    console.error('Submit quiz error:', err);
    res.status(500).json({ error: 'Failed to submit quiz' });
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
        virtue_earned: baselineAssignments.some(a => a.assignment_type === 'comp_conn' && completedIds.has(a.assignment_id)) &&
                       (baselineAssignments.some(a => a.assignment_type === 'word_cloud' && completedIds.has(a.assignment_id)) ||
                        pixtonAssignment.some(a => completedIds.has(a.assignment_id)))
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
    return getRandomQuestion(excludeIds);
  }
  
  // Get myths unlocked for this period (portals activated by teacher)
  const unlockedPortals = query(
    'SELECT mp.portal_id, mp.myth_name FROM myth_portal_status mps JOIN myth_portals mp ON mps.portal_id = mp.portal_id WHERE mps.class_period = ? AND mps.activated = 1',
    [challenger.class_period]
  );
  
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
      }
    }
  }
  
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
const DEFAULT_RESOURCE_THRESHOLD = 500; // configurable per period

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

// Helper: Record a market snapshot for sparkline history
function recordMarketSnapshot(period, eventType) {
  try {
    const values = getMarketValues(period);
    TRADE_RESOURCES.forEach(r => {
      run(`INSERT INTO market_history (period, resource, market_value, event_type) VALUES (?, ?, ?, ?)`,
        [period, r, values[r], eventType]);
    });
  } catch (err) {
    console.log('Market snapshot note:', err.message);
  }
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
    
    // Record market snapshot on window open/close
    recordMarketSnapshot(period, action === 'open' ? 'window_open' : 'window_close');
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
      WHERE (t.initiator_id = ? OR t.partner_id = ?) AND t.status = 'pending'
      ORDER BY t.created_at DESC
    `, [student_id, student_id]);
    
    res.json({
      student_id,
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
      pending_trades: pendingTrades
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
    recordMarketSnapshot(student.class_period, 'buy');
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
    
    res.json({
      market_values: values,
      trade_window_open: window ? window.is_open === 1 : false,
      resource_threshold: threshold,
      partners,
      recent_trades: recentTrades
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
    
    // Block if pending trade already exists between these two (either direction)
    const existingTrade = query(`
      SELECT trade_id FROM trades 
      WHERE status = 'pending' 
        AND ((initiator_id = ? AND partner_id = ?) OR (initiator_id = ? AND partner_id = ?))
    `, [student_id, partner_id, partner_id, student_id])[0];
    if (existingTrade) {
      return res.status(400).json({ error: 'You already have a pending trade with this player. Accept, counter, or decline it first.' });
    }
    
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
    recordMarketSnapshot(trade.period, 'trade');
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

// --- Student: Lightweight pending trades poll (minimal data) ---
app.get('/api/trade/pending-only', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const pendingTrades = query(`
      SELECT t.trade_id, t.initiator_id, t.partner_id, 
             t.give_resource, t.give_amount, t.receive_resource, t.receive_amount,
             t.flagged, t.created_at,
             si.name as initiator_name, sp.name as partner_name
      FROM trades t
      JOIN students si ON t.initiator_id = si.student_id
      JOIN students sp ON t.partner_id = sp.student_id
      WHERE (t.initiator_id = ? OR t.partner_id = ?) AND t.status = 'pending'
      ORDER BY t.created_at DESC
    `, [student_id, student_id]);
    res.json({ pending_trades: pendingTrades, student_id });
  } catch (err) {
    res.status(500).json({ error: 'Failed' });
  }
});

// --- Student: Counter-offer a trade (cancel original + propose new) ---
app.post('/api/trade/counter/:tradeId', authenticateToken, (req, res) => {
  try {
    const trade_id = parseInt(req.params.tradeId);
    const student_id = req.user.id;
    const { give_resource, give_amount, receive_resource, receive_amount } = req.body;
    
    if (!give_resource || !give_amount || !receive_resource || !receive_amount) {
      return res.status(400).json({ error: 'All trade fields required' });
    }
    if (give_resource === receive_resource) return res.status(400).json({ error: 'Cannot trade same resource' });
    
    // Get original trade
    const original = query("SELECT * FROM trades WHERE trade_id = ? AND status = 'pending'", [trade_id])[0];
    if (!original) return res.status(404).json({ error: 'Original trade not found or no longer pending' });
    if (original.partner_id !== student_id) return res.status(403).json({ error: 'Only the trade partner can counter-offer' });
    
    // Cancel the original
    run("UPDATE trades SET status = 'countered' WHERE trade_id = ?", [trade_id]);
    
    // Check trade window
    const window = query('SELECT is_open FROM trade_window WHERE period = ?', [original.period])[0];
    if (!window || window.is_open !== 1) return res.status(400).json({ error: 'Trade window is closed' });
    
    // Check Transport Ship
    const student = query('SELECT alliance_id FROM students WHERE student_id = ?', [student_id])[0];
    const alliance = query('SELECT buildings_owned FROM alliances WHERE alliance_id = ?', [student.alliance_id])[0];
    const owned = JSON.parse(alliance?.buildings_owned || '[]');
    if (!owned.includes('Transport Ship')) return res.status(400).json({ error: 'Your alliance needs a Transport Ship to trade' });
    
    // Check student has enough of what they're offering
    ensureStudentResources(student_id);
    const myRes = query('SELECT * FROM student_resources WHERE student_id = ?', [student_id])[0];
    if (myRes[give_resource] < give_amount) {
      return res.status(400).json({ error: `You only have ${myRes[give_resource]} ${TRADE_RESOURCE_LABELS[give_resource]}` });
    }
    
    // Auto-flag 3:1 ratio
    const ratio = Math.max(give_amount / receive_amount, receive_amount / give_amount);
    const flagged = ratio > 3 ? 1 : 0;
    const status = flagged ? 'flagged' : 'pending';
    
    // Create counter-offer (roles are reversed — the partner becomes the initiator)
    run(`INSERT INTO trades (period, initiator_id, partner_id, give_resource, give_amount, receive_resource, receive_amount, status, flagged, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [original.period, student_id, original.initiator_id, give_resource, give_amount, receive_resource, receive_amount, status, flagged]);
    
    const newTradeId = query('SELECT last_insert_rowid() as id')[0].id;
    saveDatabase();
    
    res.json({ success: true, trade_id: newTradeId, status, message: flagged ? 'Counter-offer flagged for teacher review' : 'Counter-offer sent!' });
  } catch (err) {
    console.error('Counter trade error:', err);
    res.status(500).json({ error: 'Failed to counter trade' });
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
    
    const initiatorRes = query('SELECT * FROM student_resources WHERE student_id = ?', [trade.initiator_id])[0];
    const partnerRes = query('SELECT * FROM student_resources WHERE student_id = ?', [trade.partner_id])[0];
    
    if (!initiatorRes || initiatorRes[trade.give_resource] < trade.give_amount) {
      run("UPDATE trades SET status = 'rejected' WHERE trade_id = ?", [trade_id]);
      saveDatabase();
      return res.status(400).json({ error: 'Initiator no longer has enough resources' });
    }
    if (!partnerRes || partnerRes[trade.receive_resource] < trade.receive_amount) {
      run("UPDATE trades SET status = 'rejected' WHERE trade_id = ?", [trade_id]);
      saveDatabase();
      return res.status(400).json({ error: 'Partner no longer has enough resources' });
    }
    
    run(`UPDATE student_resources SET ${trade.give_resource} = ${trade.give_resource} - ? WHERE student_id = ?`, [trade.give_amount, trade.initiator_id]);
    run(`UPDATE student_resources SET ${trade.give_resource} = ${trade.give_resource} + ? WHERE student_id = ?`, [trade.give_amount, trade.partner_id]);
    run(`UPDATE student_resources SET ${trade.receive_resource} = ${trade.receive_resource} - ? WHERE student_id = ?`, [trade.receive_amount, trade.partner_id]);
    run(`UPDATE student_resources SET ${trade.receive_resource} = ${trade.receive_resource} + ? WHERE student_id = ?`, [trade.receive_amount, trade.initiator_id]);
    
    run("UPDATE trades SET status = 'approved', completed_at = CURRENT_TIMESTAMP WHERE trade_id = ?", [trade_id]);
    saveDatabase();
    res.json({ success: true, message: 'Flagged trade approved and executed' });
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
    
    res.json({
      period,
      market_values: values,
      trade_window: window || { is_open: 0 },
      resource_threshold: threshold,
      alliances: allianceSummaries,
      students: studentInventories,
      trade_counts: tradeCounts
    });
  } catch (err) {
    console.error('Trade overview error:', err);
    res.status(500).json({ error: 'Failed to get trade overview' });
  }
});

// --- Student: Sell resources at Merchant's Dock ---
app.post('/api/trade/sell', authenticateToken, (req, res) => {
  try {
    const student_id = req.user.id;
    const { resource, amount } = req.body;
    
    if (!resource || !TRADE_RESOURCES.includes(resource)) return res.status(400).json({ error: 'Invalid resource' });
    if (!amount || amount < 10 || amount % 10 !== 0) return res.status(400).json({ error: 'Amount must be a multiple of 10 (minimum 10)' });
    
    const student = query('SELECT alliance_id, class_period FROM students WHERE student_id = ?', [student_id])[0];
    if (!student?.alliance_id) return res.status(400).json({ error: 'Not in an alliance' });
    
    // Check trade window is open
    const tradeWindow = query('SELECT is_open FROM trade_window WHERE period = ?', [student.class_period])[0];
    if (!tradeWindow || tradeWindow.is_open !== 1) {
      return res.status(400).json({ error: 'The market is currently closed.' });
    }
    
    // Check Transport Ship prerequisite
    const alliance = query('SELECT buildings_owned FROM alliances WHERE alliance_id = ?', [student.alliance_id])[0];
    const buildings = JSON.parse(alliance?.buildings_owned || '[]');
    if (!buildings.includes('Transport Ship')) {
      return res.status(400).json({ error: 'Your alliance needs a Transport Ship to sell at the Merchant\'s Dock.' });
    }
    
    // Check student has enough of the resource
    ensureStudentResources(student_id);
    const inventory = query('SELECT * FROM student_resources WHERE student_id = ?', [student_id])[0];
    if (!inventory || (inventory[resource] || 0) < amount) {
      return res.status(400).json({ error: `You only have ${inventory?.[resource] || 0} ${TRADE_RESOURCE_LABELS[resource]}` });
    }
    
    // Calculate sell value: (units / 10) × market_value × 0.90
    const values = getMarketValues(student.class_period);
    const marketValue = values[resource];
    const grossPoints = (amount / 10) * marketValue;
    const fee = Math.round(grossPoints * 0.10);
    const netPoints = Math.round(grossPoints - fee);
    
    if (netPoints < 1) return res.status(400).json({ error: 'Sale amount too small to earn any points after the 10% dock fee.' });
    
    // Deduct from personal inventory
    run(`UPDATE student_resources SET ${resource} = ${resource} - ? WHERE student_id = ?`, [amount, student_id]);
    
    // Add points to alliance
    run('UPDATE alliances SET total_points = total_points + ? WHERE alliance_id = ?', [netPoints, student.alliance_id]);
    
    // Log the sellback
    run(`INSERT INTO resource_sellbacks (student_id, alliance_id, resource_type, amount, market_value, points_earned)
         VALUES (?, ?, ?, ?, ?, ?)`,
      [student_id, student.alliance_id, resource, amount, marketValue, netPoints]);
    
    // Log transaction
    run(`INSERT INTO point_transactions (alliance_id, student_id, amount, category, reason)
         VALUES (?, ?, ?, 'resource_sell', ?)`,
      [student.alliance_id, student_id, netPoints, 
       `Sold ${amount} ${TRADE_RESOURCE_LABELS[resource]} at market value ${marketValue} (${netPoints} pts after 10% dock fee)`]);
    
    saveDatabase();
    recordMarketSnapshot(student.class_period, 'sell');
    saveDatabase();
    
    res.json({
      success: true,
      resource,
      amount,
      market_value: marketValue,
      gross_points: Math.round(grossPoints),
      fee,
      net_points: netPoints,
      message: `Sold ${amount} ${TRADE_RESOURCE_LABELS[resource]} for ${netPoints} alliance points (${fee} pt dock fee)`
    });
  } catch (err) {
    console.error('Sell resource error:', err);
    res.status(500).json({ error: 'Failed to sell resource' });
  }
});

// --- Student: Get market price history for sparkline charts ---
app.get('/api/trade/market-history', authenticateToken, (req, res) => {
  try {
    const student = query('SELECT class_period FROM students WHERE student_id = ?', [req.user.id])[0];
    if (!student) return res.status(400).json({ error: 'Student not found' });
    
    // Get last 10 snapshots per resource (each snapshot = 1 event with all 4 resources)
    // Group by recorded_at to get distinct time points, then take last 10
    const timepoints = query(`
      SELECT DISTINCT recorded_at FROM market_history 
      WHERE period = ? ORDER BY recorded_at DESC LIMIT 10
    `, [student.class_period]);
    
    if (timepoints.length === 0) return res.json({ history: {} });
    
    const oldest = timepoints[timepoints.length - 1].recorded_at;
    
    const rows = query(`
      SELECT resource, market_value, event_type, recorded_at 
      FROM market_history 
      WHERE period = ? AND recorded_at >= ?
      ORDER BY recorded_at ASC
    `, [student.class_period, oldest]);
    
    // Group by resource for easy sparkline rendering
    const history = {};
    TRADE_RESOURCES.forEach(r => { history[r] = []; });
    
    rows.forEach(row => {
      if (history[row.resource]) {
        history[row.resource].push({
          value: row.market_value,
          event: row.event_type,
          time: row.recorded_at
        });
      }
    });
    
    res.json({ history });
  } catch (err) {
    console.error('Market history error:', err);
    res.status(500).json({ error: 'Failed to get market history' });
  }
});

// Start server
// --- Admin: Diagnose and repair buildings_owned from building_activations ---
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
          // Check membean points from grade_records
          const membeanResult = query(`
            SELECT SUM(points_earned) as total FROM grade_records gr
            JOIN assignments_ref ar ON gr.assignment_id = ar.assignment_id
            WHERE gr.student_id = ? AND ar.assignment_type = 'reading_pages'
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
          // This is awarded by the Fate system when a reverse card is used — skip auto-scan
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
