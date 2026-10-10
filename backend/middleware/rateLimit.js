/**
 * Rate Limiting Middleware
 * -------------------------
 * Limits are configurable via env so production can tune them. Note: many
 * students on one campus share a single NAT IP, so read limits are generous.
 */

const rateLimit = require('express-rate-limit');

const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : d);

// Brute-force protection for admin login (per IP)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: num(process.env.LOGIN_RATE_MAX, 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    message: 'Too many login attempts. Please try again in 15 minutes.',
  },
});

// Join endpoint (per IP — generous, because a whole campus may share one IP).
// Duplicate-phone fraud checks already block the most common abuse.
const joinLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: num(process.env.JOIN_RATE_MAX, 500),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    message: 'Too many join attempts from this network. Please try again later.',
  },
});

// General API limiter — high by default since clients poll status/position.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: num(process.env.API_RATE_MAX, 20000),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    message: 'Rate limit exceeded. Please slow down.',
  },
});

module.exports = { loginLimiter, joinLimiter, apiLimiter };
