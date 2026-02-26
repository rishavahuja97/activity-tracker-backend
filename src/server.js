require('dotenv').config({ override: false });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const db = require('./models/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy (required for Render, Railway, etc.)
app.set('trust proxy', 1);

// ---- Middleware ----
app.use(helmet());
app.use(morgan('dev'));
app.use(cors({
  origin: (origin, cb) => cb(null, true), // Allow all for dev; restrict in production
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests, try again later' }
});
app.use('/api/', limiter);

// Sync gets higher limit
const syncLimiter = rateLimit({ windowMs: 900000, max: 300, standardHeaders: true, legacyHeaders: false });
app.use('/api/sync/', syncLimiter);

// ---- Routes ----
app.use('/api/auth', require('./routes/auth'));
app.use('/api/devices', require('./routes/devices'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/screenshots', require('./routes/screenshots'));
app.use('/api/analytics', require('./routes/analytics'));

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const result = await db.prepare('SELECT COUNT(*) as count FROM users').get();
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString(), users: parseInt(result?.count) || 0 });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// API docs
app.get('/api', (req, res) => {
  res.json({
    name: 'Activity Tracker API',
    version: '2.0.0',
    database: 'PostgreSQL',
    endpoints: {
      auth: ['POST /register', 'POST /login', 'GET /profile', 'PUT /profile', 'PUT /password', 'DELETE /account'],
      devices: ['POST /', 'GET /', 'PUT /:id', 'DELETE /:id'],
      sync: ['POST /push', 'GET /pull', 'GET /full'],
      screenshots: ['POST /upload', 'POST /upload-base64', 'GET /', 'GET /image/:id', 'DELETE /:id'],
      analytics: ['GET /daily', 'GET /weekly', 'GET /trends', 'GET /top-domains', 'GET /export']
    }
  });
});

// 404
app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ---- Start ----
db.ready.then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Activity Tracker API running on port ${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/api/health`);
    console.log(`🔗 DB: ${process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/\/\/.*@/, '//***@') : 'NOT SET'}`);
  });
}).catch(err => {
  console.error('❌ Database init failed:', err);
  process.exit(1);
});
