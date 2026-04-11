/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║         INVISIBLE QUEUE SYSTEM — Express + Socket.io Server     ║
 * ║                                                                  ║
 * ║  AI-First Virtual Queue Engine for Indian College Offices        ║
 * ║  Claude API · Firebase · Socket.io · 5 AI Monitors              ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

// ─── Core Modules ────────────────────────────────────────────────────────────
const { initSocketHandlers } = require('./socket/socketHandlers');
const { startAllMonitorLoops, startMonitorLoop } = require('./jobs/monitorLoop');
const { initNightlyBriefing } = require('./jobs/nightlyBriefing');
const { apiLimiter } = require('./middleware/rateLimit');

// ─── Routes ──────────────────────────────────────────────────────────────────
const queueRoutes = require('./routes/queue');
const adminRoutes = require('./routes/admin');

// ─── App Setup ───────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:5173';

// ─── CORS Configuration ─────────────────────────────────────────────────────
app.use(cors({
  origin: CORS_ORIGIN.split(',').map(s => s.trim()),
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
}));

// ─── Body Parsing ────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─── Rate Limiting (general) ────────────────────────────────────────────────
app.use('/api/', apiLimiter);

// ─── Socket.io Setup ────────────────────────────────────────────────────────
const io = new Server(server, {
  cors: {
    origin: CORS_ORIGIN.split(',').map(s => s.trim()),
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
      queue_status: '/api/v1/queue/:id/status',
      queue_join: 'POST /api/v1/queue/:id/join',
      queue_users: '/api/v1/queue/:id/users',
      admin_attended: 'POST /api/v1/admin/queue/:id/attended/:userId',
      admin_removed: 'POST /api/v1/admin/queue/:id/removed/:userId',
      admin_done: 'POST /api/v1/admin/queue/:id/done/:userId',
      admin_briefing: '/api/v1/admin/queue/:id/briefing',
      admin_create_queue: 'POST /api/v1/admin/queue/create',
      admin_seed: 'POST /api/v1/admin/queue/:id/seed',
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
