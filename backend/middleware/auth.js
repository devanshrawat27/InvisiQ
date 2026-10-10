/**
 * Authentication Middleware
 * -------------------------
 * Now uses JWT-based auth with role-based access control.
 * Backward compatible with:
 *   - hackathon-bypass-token (demo mode)
 *   - Firebase ID tokens (Google sign-in)
 *   - JWT tokens from /auth/login
 */

const { verifyJWT, checkCellAccess } = require('./jwtAuth');

/**
 * Middleware: verifyToken
 * Delegates to JWT verification (which also handles Firebase fallback).
 */
async function verifyToken(req, res, next) {
  return verifyJWT(req, res, next);
}

/**
 * Middleware: requireAdmin
 * Verifies JWT token — any authenticated user with a valid token is treated as admin.
 */
async function requireAdmin(req, res, next) {
  return verifyJWT(req, res, next);
}

/**
 * Middleware: requireCellAccess
 * Verifies JWT AND checks if user has access to the specific queue/cell in the URL.
 */
function requireCellAccess(req, res, next) {
  verifyJWT(req, res, () => {
    checkCellAccess(req, res, next);
  });
}

module.exports = { verifyToken, requireAdmin, requireCellAccess };
