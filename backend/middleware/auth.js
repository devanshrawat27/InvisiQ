/**
 * Authentication Middleware
 * -------------------------
 * Verifies Firebase ID tokens for admin-only endpoints.
 * In MOCK_MODE, accepts any Bearer token.
 *
 * Usage:
 *   router.post('/admin/endpoint', requireAdmin, handler);
 */

const { auth } = require('../firebase/init');

/**
 * Middleware: verifyToken
 * Extracts and verifies the Firebase ID token from Authorization header.
 * Attaches decoded user to req.user.
 */
async function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid Authorization header. Expected: Bearer <token>',
    });
  }

  const token = authHeader.split('Bearer ')[1];

  // ─── HACKATHON BYPASS ──────────────
  if (token === 'hackathon-bypass-token') {
    req.user = { uid: 'hackathon', name: 'Admin Demo' };
    return next();
  }
  // ───────────────────────────────────

  try {
    const decoded = await auth.verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    console.error('❌ Auth verification failed:', err.message);
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid or expired authentication token.',
    });
  }
}

/**
 * Middleware: requireAdmin
 * Verifies token AND checks that the user has admin role.
 * For the hackathon, any authenticated user is treated as admin.
 */
async function requireAdmin(req, res, next) {
  await verifyToken(req, res, () => {
    // For hackathon MVP: any authenticated user is admin
    // In production, check req.user.admin === true or a Firestore role lookup
    if (req.user) {
      next();
    } else {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required.',
      });
    }
  });
}

module.exports = { verifyToken, requireAdmin };
