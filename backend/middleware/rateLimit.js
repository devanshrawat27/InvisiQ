/**
 * Rate Limiting Middleware
 * -------------------------
 * Protects /join from abuse: 10 joins/hour per IP.
 * Uses express-rate-limit.
 */

const rateLimit = require('express-rate-limit');

// Rate limiter for join endpoint — 10 joins per hour per IP
const joinLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    message: 'You have exceeded the join limit. Please try again later.',
    retry_after_minutes: 60,
  },
});

// General API rate limiter — 100 requests per 15 min
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many requests',
    message: 'Rate limit exceeded. Please slow down.',
  },
});

module.exports = { joinLimiter, apiLimiter };
