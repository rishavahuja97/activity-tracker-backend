const express = require('express');
const db = require('../models/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// GET /daily — daily summary across all devices
router.get('/daily', authenticate, async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);

    const sites = await db.prepare(`
      SELECT domain, title, category, SUM(total_seconds) as total_seconds, SUM(visits) as visits
      FROM usage_records WHERE user_id = ? AND date = ?
      GROUP BY domain, title, category ORDER BY total_seconds DESC
    `).all(req.user.id, date);

    const totals = await db.prepare(`
      SELECT COALESCE(SUM(total_seconds),0) as total_seconds, COALESCE(SUM(visits),0) as total_visits, COUNT(DISTINCT domain) as total_domains
      FROM usage_records WHERE user_id = ? AND date = ?
    `).get(req.user.id, date);

    const categories = await db.prepare(`
      SELECT category, SUM(total_seconds) as total_seconds, SUM(visits) as total_visits, COUNT(DISTINCT domain) as sites
      FROM usage_records WHERE user_id = ? AND date = ?
      GROUP BY category ORDER BY total_seconds DESC
    `).all(req.user.id, date);

    const deviceBreakdown = await db.prepare(`
      SELECT d.device_name, d.device_type, SUM(ur.total_seconds) as total_seconds, SUM(ur.visits) as total_visits, COUNT(DISTINCT ur.domain) as domains
      FROM usage_records ur JOIN devices d ON ur.device_id = d.id
      WHERE ur.user_id = ? AND ur.date = ?
      GROUP BY d.device_name, d.device_type
    `).all(req.user.id, date);

    const ssCount = await db.prepare('SELECT COUNT(*) as count FROM screenshots WHERE user_id = ? AND date = ?').get(req.user.id, date);

    res.json({
      date, sites,
      totals: { totalSeconds: parseInt(totals?.total_seconds)||0, totalVisits: parseInt(totals?.total_visits)||0, totalDomains: parseInt(totals?.total_domains)||0 },
      categories, deviceBreakdown, screenshotCount: parseInt(ssCount?.count) || 0
    });
  } catch (err) { console.error('Daily analytics error:', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /weekly — last N weeks
router.get('/weekly', authenticate, async (req, res) => {
  try {
    const weeks = Math.min(parseInt(req.query.weeks) || 4, 12);
    const days = weeks * 7;
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const daily = await db.prepare(`
      SELECT date, SUM(total_seconds) as total_seconds, SUM(visits) as total_visits, COUNT(DISTINCT domain) as total_domains
      FROM usage_records WHERE user_id = ? AND date >= ?
      GROUP BY date ORDER BY date ASC
    `).all(req.user.id, since);

    const topSites = await db.prepare(`
      SELECT domain, title, category, SUM(total_seconds) as total_seconds, SUM(visits) as total_visits
      FROM usage_records WHERE user_id = ? AND date >= ?
      GROUP BY domain, title, category ORDER BY total_seconds DESC LIMIT 20
    `).all(req.user.id, since);

    const categories = await db.prepare(`
      SELECT category, SUM(total_seconds) as total_seconds, SUM(visits) as total_visits
      FROM usage_records WHERE user_id = ? AND date >= ?
      GROUP BY category ORDER BY total_seconds DESC
    `).all(req.user.id, since);

    res.json({ daily, topSites, categories, weeks, since });
  } catch (err) { console.error('Weekly analytics error:', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /trends — this week vs last week
router.get('/trends', authenticate, async (req, res) => {
  try {
    const now = new Date();
    const thisWeekStart = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
    const lastWeekStart = new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10);
    const today = now.toISOString().slice(0, 10);

    const thisWeek = await db.prepare(`
      SELECT COALESCE(SUM(total_seconds),0) as total_seconds, COALESCE(SUM(visits),0) as total_visits, COUNT(DISTINCT domain) as total_domains, COUNT(DISTINCT date) as active_days
      FROM usage_records WHERE user_id = ? AND date >= ?
    `).get(req.user.id, thisWeekStart);

    const lastWeek = await db.prepare(`
      SELECT COALESCE(SUM(total_seconds),0) as total_seconds, COALESCE(SUM(visits),0) as total_visits, COUNT(DISTINCT domain) as total_domains, COUNT(DISTINCT date) as active_days
      FROM usage_records WHERE user_id = ? AND date >= ? AND date < ?
    `).get(req.user.id, lastWeekStart, thisWeekStart);

    const thisCats = await db.prepare(`
      SELECT category, SUM(total_seconds) as total_seconds
      FROM usage_records WHERE user_id = ? AND date >= ?
      GROUP BY category ORDER BY total_seconds DESC
    `).all(req.user.id, thisWeekStart);

    const lastCats = await db.prepare(`
      SELECT category, SUM(total_seconds) as total_seconds
      FROM usage_records WHERE user_id = ? AND date >= ? AND date < ?
      GROUP BY category ORDER BY total_seconds DESC
    `).all(req.user.id, lastWeekStart, thisWeekStart);

    res.json({ thisWeek, lastWeek, thisWeekCategories: thisCats, lastWeekCategories: lastCats });
  } catch (err) { console.error('Trends error:', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /top-domains — top domains by time
router.get('/top-domains', authenticate, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.period) || 7, 90);
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const domains = await db.prepare(`
      SELECT domain, title, category, SUM(total_seconds) as total_seconds, SUM(visits) as total_visits, COUNT(DISTINCT date) as active_days
      FROM usage_records WHERE user_id = ? AND date >= ?
      GROUP BY domain, title, category ORDER BY total_seconds DESC LIMIT ?
    `).all(req.user.id, since, limit);

    res.json({ domains, period: days });
  } catch (err) { console.error('Top domains error:', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /export — export all data
router.get('/export', authenticate, async (req, res) => {
  const usage = await db.prepare('SELECT * FROM usage_records WHERE user_id = ? ORDER BY date DESC').all(req.user.id);
  const events = await db.prepare('SELECT * FROM activity_events WHERE user_id = ? ORDER BY timestamp DESC LIMIT 1000').all(req.user.id);
  const devices = await db.prepare('SELECT * FROM devices WHERE user_id = ?').all(req.user.id);
  const screenshots = await db.prepare('SELECT id, domain, title, url, category, timestamp, date FROM screenshots WHERE user_id = ? ORDER BY timestamp DESC').all(req.user.id);
  res.json({ exportedAt: new Date().toISOString(), usage, events, devices, screenshots });
});

module.exports = router;
