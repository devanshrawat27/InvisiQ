/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         INVISIBLE QUEUE SYSTEM — Express + Socket.io Server     ║
 * ║                                                                  ║
 * ║  AI-First Virtual Queue Engine for Indian College Offices        ║
 * ║  Gemini API · Firebase · Socket.io · 5 AI Monitors              ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');

// ─── Core Modules ────────────────────────────────────────────────────────────
const { initSocketHandlers } = require('./socket/socketHandlers');
const { startAllMonitorLoops, startMonitorLoop } = require('./jobs/monitorLoop');
const { initNightlyBriefing } = require('./jobs/nightlyBriefing');
const { apiLimiter } = require('./middleware/rateLimit');

// ─── Routes ──────────────────────────────────────────────────────────────────
const queueRoutes = require('./routes/queue');
const adminRoutes = require('./routes/admin');
const { router: authRoutes, seedDefaultAdmins } = require('./routes/auth');

// ─── App Setup ───────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

// ─── Behind a reverse proxy (Render/Vercel/etc.) ──────────────────────────────
app.set('trust proxy', 1);

// ─── Security Headers ─────────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy: false, // API only — no HTML is served
}));

// ─── Compression ──────────────────────────────────────────────────────────────
app.use(compression());

// ─── CORS Configuration ─────────────────────────────────────────────────────
const allowedOrigins = CORS_ORIGIN.split(',').map(s => s.trim()).filter(Boolean);
const isProd = process.env.NODE_ENV === 'production';
app.use(cors({
  origin(origin, callback) {
    // Allow same-origin/non-browser requests (no Origin header)
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    // In development, allow any localhost port (Vite may pick 5173/5174/…)
    if (!isProd && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

// ─── Body Parsing ────────────────────────────────────────────────────────────
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

// ─── Rate Limiting (general) ────────────────────────────────────────────────
app.use('/api/', apiLimiter);

// ─── Socket.io Setup ────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Make io accessible to route handlers via req.app.get('io')
app.set('io', io);

// Initialize Socket.io event handlers
initSocketHandlers(io);

// ─── API Routes ──────────────────────────────────────────────────────────────
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/queue', queueRoutes);
app.use('/api/v1/admin', adminRoutes);

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Invisible Queue System',
    version: '1.0.0',
    mock_mode: process.env.MOCK_MODE === 'true',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// ─── Root ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'Invisible Queue System API',
    version: '1.0.0',
    description: 'AI-First Virtual Queue Engine for Indian College Offices',
    endpoints: {
      health: '/api/health',
      queue_status: 'GET /api/v1/queue/:id/status',
      queue_join: 'POST /api/v1/queue/:id/join',
      queue_position: 'GET /api/v1/queue/:id/position/:userId',
      queue_users: 'GET /api/v1/queue/:id/users (admin)',
      queue_skip: 'POST /api/v1/queue/:id/skip/:userId (admin)',
      admin_attended: 'POST /api/v1/admin/queue/:id/attended/:userId',
      admin_removed: 'POST /api/v1/admin/queue/:id/removed/:userId',
      admin_done: 'POST /api/v1/admin/queue/:id/done/:userId',
      admin_next: 'POST /api/v1/admin/queue/:id/next (internal)',
      admin_briefing: 'GET /api/v1/admin/queue/:id/briefing',
      admin_briefing_trigger: 'POST /api/v1/admin/briefing/trigger',
      admin_create_queue: 'POST /api/v1/admin/queue/create',
      admin_pause: 'POST /api/v1/admin/queue/:id/pause',
      admin_resume: 'POST /api/v1/admin/queue/:id/resume',
      queue_requirements: 'GET /api/v1/queue/:id/requirements',
      admin_requirements: 'POST /api/v1/admin/queue/:id/requirements',
      admin_analytics: 'GET /api/v1/admin/queue/:id/analytics',
      admin_counters: 'POST /api/v1/admin/queue/:id/counters',
    },
  });
});

// ─── 404 Handler ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`,
  });
});

// ─── Error Handler ───────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  if (err && typeof err.message === 'string' && err.message.startsWith('CORS')) {
    return res.status(403).json({ error: 'Forbidden', message: 'Origin not allowed' });
  }
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
  });
});

// ─── Start Server ────────────────────────────────────────────────────────────
server.listen(PORT, async () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║        🚀 INVISIBLE QUEUE SYSTEM — RUNNING!             ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Port:       ${PORT}                                       ║`);
  console.log(`║  CORS:       ${CORS_ORIGIN.slice(0, 40).padEnd(40)}  ║`);
  console.log(`║  Mock Mode:  ${(process.env.MOCK_MODE === 'true' ? 'ON ✅' : 'OFF').padEnd(40)} ║`);
  console.log(`║  Node:       ${process.version.padEnd(40)} ║`);
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  AI Monitors: Ghost Buster · Urgency Engine ·           ║');
  console.log('║               Congestion Oracle · Fraud Scanner ·       ║');
  console.log('║               Counter Compass · Auto-Advance            ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  // Seed default admin accounts
  try {
    await seedDefaultAdmins();
  } catch (err) {
    console.error('⚠️  Admin seeding failed:', err.message);
  }

  // Start background jobs
  try {
    await startAllMonitorLoops(io);
    initNightlyBriefing();
  } catch (err) {
    console.error('⚠️  Background jobs failed to start:', err.message);
  }
});

// ─── Graceful Shutdown ───────────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
});

module.exports = { app, server, io };
