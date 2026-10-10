/**
 * JWT Authentication Middleware
 * --------------------------------
 * Verifies JWT tokens for admin endpoints.
 * Supports role-based access control:
 *   - super_admin: Can view all cells, analytics, add admins.
 *   - cell_admin:  Can manage only assigned cells.
 *
 * JWT tokens are issued by /auth/login. Firebase ID tokens (Google sign-in)
 * are also accepted, but ONLY when they are linked to an existing admin
 * account (via `firebase_uid` or a matching username) — an unlinked identity
 * is rejected. There is no demo/bypass token.
 */

const jwt = require('jsonwebtoken');

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('❌ FATAL: JWT_SECRET must be set when NODE_ENV=production.');
    process.exit(1);
  }
  JWT_SECRET = 'dev-only-insecure-secret-do-not-use-in-production';
  console.warn('⚠️  JWT_SECRET not set — using an insecure development default.');
}

/**
 * Build a normalized user object from an admin/JWT record.
 */
function normalizeUser(record) {
  return {
    uid: record.uid || record.username,
    username: record.username,
    displayName: record.displayName,
    role: record.role,
    cells: Array.isArray(record.cells) ? record.cells : [],
  };
}

/**
 * Verify JWT token from Authorization header.
 * Attaches decoded user to req.user with role + cells info.
 */
async function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header.',
    });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized', message: 'Empty bearer token.' });
  }

  // ─── 1. Verify as a JWT issued by /auth/login ────────────────
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = normalizeUser(decoded);
    return next();
  } catch (_) {
    // Not a valid JWT — fall through to Firebase ID token verification.
  }

  // ─── 2. Verify as a Firebase ID token (Google sign-in) ───────
  try {
    const { auth, db } = require('../firebase/init');
    const decoded = await auth.verifyIdToken(token);
    const email = (decoded.email || '').toLowerCase();

    let admin = null;

    // Look up by linked firebase_uid first
    if (decoded.uid) {
      const byUid = await db.ref('admins').orderByChild('firebase_uid').equalTo(decoded.uid).get();
      if (byUid.exists()) {
        admin = Object.values(byUid.val())[0];
      }
    }

    // Fallback: match by username derived from the email local-part
    if (!admin && email) {
      const byName = await db.ref(`admins/${email.split('@')[0]}`).get();
      if (byName.exists()) admin = byName.val();
    }

    if (!admin) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'No admin account is linked to this identity.',
      });
    }

    admin.uid = decoded.uid;
    req.user = normalizeUser(admin);
    return next();
  } catch (err) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid or expired token.',
    });
  }
}

/**
 * Check if user has access to a specific cell/queue.
 * Super admins have access to everything.
 * Cell admins only have access to their assigned cells.
 */
function checkCellAccess(req, res, next) {
  const queueId = req.params.id;
  const user = req.user;

  if (!user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Super admin has access to all
  if (user.role === 'super_admin' || (user.cells && user.cells.includes('*'))) {
    return next();
  }

  // Cell admin — check if they have access to this queue
  if (user.cells && user.cells.includes(queueId)) {
    return next();
  }

  return res.status(403).json({
    error: 'Access Denied',
    message: `You don't have access to ${queueId}. Your assigned cells: ${(user.cells || []).join(', ') || 'none'}`,
  });
}

/**
 * Generate a JWT token for a user.
 */
function signToken(user) {
  return jwt.sign(
    {
      uid: user.username,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      cells: user.cells,
    },
    JWT_SECRET,
    { expiresIn: '24h' }
  );
}

module.exports = { verifyJWT, checkCellAccess, signToken, JWT_SECRET };
