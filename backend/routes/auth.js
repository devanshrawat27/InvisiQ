/**
 * Auth Routes — /api/v1/auth/*
 * --------------------------------
 * JWT-based authentication for admin panel.
 *
 * Endpoints:
 *   POST /auth/login         — Login with username/password, returns JWT
 *   GET  /auth/me            — Get current user info from JWT
 *   GET  /auth/credentials   — List default credentials (dev/demo only)
 *   POST /auth/register      — Super admin creates a new admin account
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');

const { db } = require('../firebase/init');
const { signToken, verifyJWT } = require('../middleware/jwtAuth');
const { getDefaultAdminsHashed } = require('../data/default_admins');
const { loginLimiter } = require('../middleware/rateLimit');

/**
 * Seed default admins into Firebase RTDB if they don't exist.
 * Called on server startup.
 */
async function seedDefaultAdmins() {
  try {
    const adminsRef = db.ref('admins');
    const snap = await adminsRef.get();

    if (snap.exists()) {
      const existing = snap.val();
      const count = Object.keys(existing).length;
      console.log(`✅ Admin accounts found: ${count} admin(s)`);
      return;
    }

    // Seed defaults
    const defaults = getDefaultAdminsHashed();
    const adminsObj = {};
    for (const admin of defaults) {
      adminsObj[admin.username] = admin;
    }
    await adminsRef.set(adminsObj);
    console.log(`✅ Seeded ${defaults.length} default admin accounts`);
    console.warn('⚠️  Default admin accounts use well-known passwords. CHANGE THEM before going live:');
    console.warn('    superadmin/Super@123 · fee_admin/Fee@123 · admission_admin/Admission@123 · exam_admin/Exam@123 · admin_cell/Admin@123');
  } catch (err) {
    console.error('❌ Failed to seed admins:', err.message);
  }
}

/**
 * POST /auth/login
 * Authenticate with username + password, returns JWT token.
 */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Fetch admin from RTDB
    const adminRef = db.ref(`admins/${username.toLowerCase().trim()}`);
    const snap = await adminRef.get();

    if (!snap.exists()) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    const admin = snap.val();

    // Compare password
    const isMatch = await bcrypt.compare(password, admin.password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Generate JWT
    const token = signToken(admin);

    // Update last login
    await adminRef.update({ last_login: Date.now() });

    console.log(`🔐 Login: ${admin.displayName} (${admin.role})`);

    return res.json({
      token,
      user: {
        username: admin.username,
        displayName: admin.displayName,
        role: admin.role,
        cells: admin.cells,
      },
    });
  } catch (err) {
    console.error('❌ Login error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /auth/me
 * Returns the current user info from JWT token.
 */
router.get('/me', verifyJWT, (req, res) => {
  return res.json({
    user: {
      username: req.user.username,
      displayName: req.user.displayName,
      role: req.user.role,
      cells: req.user.cells,
    },
  });
});

/**
 * POST /auth/register
 * Super admin creates a new cell admin account.
 * Requires: username, password, displayName, cells[]
 */
router.post('/register', verifyJWT, async (req, res) => {
  try {
    // Only super_admin can create new admins
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({ error: 'Only super admins can create new admin accounts' });
    }

    const { username, password, displayName, cells, role } = req.body;

    if (!username || !password || !displayName || !cells) {
      return res.status(400).json({ error: 'username, password, displayName, and cells are required' });
    }

    const cleanUsername = username.toLowerCase().trim();

    // Check if username already exists
    const existingRef = db.ref(`admins/${cleanUsername}`);
    const existing = await existingRef.get();
    if (existing.exists()) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Save admin
    const adminData = {
      username: cleanUsername,
      password: hashedPassword,
      displayName,
      role: role || 'cell_admin',
      cells: Array.isArray(cells) ? cells : [cells],
      created_at: Date.now(),
      created_by: req.user.username,
    };

    await existingRef.set(adminData);

    console.log(`👤 New admin created: ${displayName} (${adminData.role}) by ${req.user.username}`);

    return res.json({
      success: true,
      admin: {
        username: adminData.username,
        displayName: adminData.displayName,
        role: adminData.role,
        cells: adminData.cells,
      },
    });
  } catch (err) {
    console.error('❌ Register error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = { router, seedDefaultAdmins };
