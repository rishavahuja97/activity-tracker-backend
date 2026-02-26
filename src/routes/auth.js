const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

router.post('/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, 12);
    await db.prepare('INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)')
      .run(userId, email.toLowerCase().trim(), passwordHash, displayName || email.split('@')[0]);

    const token = jwt.sign({ userId, email: email.toLowerCase().trim() }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    res.status(201).json({ message: 'Account created', token, user: { id: userId, email: email.toLowerCase().trim(), displayName: displayName || email.split('@')[0] } });
  } catch (err) { console.error('Register error:', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
    await db.prepare('UPDATE users SET updated_at = NOW() WHERE id = ?').run(user.id);

    res.json({ message: 'Login successful', token, user: { id: user.id, email: user.email, displayName: user.display_name } });
  } catch (err) { console.error('Login error:', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/profile', authenticate, async (req, res) => {
  const user = await db.prepare('SELECT id, email, display_name, created_at FROM users WHERE id = ?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const devices = await db.prepare('SELECT id, device_name, device_type, last_sync_at, created_at FROM devices WHERE user_id = ?').all(req.user.id);
  const stats = await db.prepare('SELECT COUNT(DISTINCT date) as total_days, COUNT(DISTINCT domain) as total_domains, COALESCE(SUM(total_seconds),0) as total_seconds, COALESCE(SUM(visits),0) as total_visits FROM usage_records WHERE user_id = ?').get(req.user.id);
  const ssCount = await db.prepare('SELECT COUNT(*) as count FROM screenshots WHERE user_id = ?').get(req.user.id);

  res.json({
    user: { id: user.id, email: user.email, displayName: user.display_name, createdAt: user.created_at },
    devices,
    stats: { totalDays: parseInt(stats?.total_days)||0, totalDomains: parseInt(stats?.total_domains)||0, totalSeconds: parseInt(stats?.total_seconds)||0, totalVisits: parseInt(stats?.total_visits)||0, totalScreenshots: parseInt(ssCount?.count)||0 }
  });
});

router.put('/profile', authenticate, async (req, res) => {
  await db.prepare('UPDATE users SET display_name = ?, updated_at = NOW() WHERE id = ?').run(req.body.displayName, req.user.id);
  res.json({ message: 'Profile updated' });
});

router.put('/password', authenticate, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
  const user = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!await bcrypt.compare(currentPassword, user.password_hash)) return res.status(401).json({ error: 'Current password incorrect' });
  await db.prepare('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?').run(await bcrypt.hash(newPassword, 12), req.user.id);
  res.json({ message: 'Password updated' });
});

router.delete('/account', authenticate, async (req, res) => {
  const user = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!await bcrypt.compare(req.body.password, user.password_hash)) return res.status(401).json({ error: 'Incorrect password' });
  await db.prepare('DELETE FROM users WHERE id = ?').run(req.user.id);
  res.json({ message: 'Account deleted' });
});

module.exports = router;
