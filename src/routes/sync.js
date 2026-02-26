const express = require('express');
const db = require('../models/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

// POST /push — device pushes usage data
router.post('/push', authenticate, async (req, res) => {
  try {
    const { deviceId, usageData, activityEvents } = req.body;
    if (!deviceId) return res.status(400).json({ error: 'deviceId required' });

    const device = await db.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?').get(deviceId, req.user.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });

    let usageCount = 0;
    let eventCount = 0;

    // Upsert usage records
    if (usageData && typeof usageData === 'object') {
      for (const [date, domains] of Object.entries(usageData)) {
        for (const [domain, data] of Object.entries(domains)) {
          await db.prepare(`
            INSERT INTO usage_records (user_id, device_id, domain, title, category, date, total_seconds, visits, first_visit, last_visit)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (user_id, device_id, domain, date) DO UPDATE SET
              total_seconds = GREATEST(usage_records.total_seconds, EXCLUDED.total_seconds),
              visits = GREATEST(usage_records.visits, EXCLUDED.visits),
              title = COALESCE(EXCLUDED.title, usage_records.title),
              category = COALESCE(EXCLUDED.category, usage_records.category),
              first_visit = LEAST(usage_records.first_visit, EXCLUDED.first_visit),
              last_visit = GREATEST(usage_records.last_visit, EXCLUDED.last_visit),
              synced_at = NOW()
          `).run(
            req.user.id, deviceId, domain,
            data.title || domain, data.category || 'Other', date,
            data.totalSeconds || 0, data.visits || 0,
            data.firstVisit ? new Date(data.firstVisit).toISOString() : null,
            data.lastVisit ? new Date(data.lastVisit).toISOString() : null
          );
          usageCount++;
        }
      }
    }

    // Insert activity events
    if (activityEvents && Array.isArray(activityEvents)) {
      for (const ev of activityEvents.slice(-200)) {
        await db.prepare('INSERT INTO activity_events (user_id, device_id, state, timestamp, date) VALUES (?, ?, ?, ?, ?)')
          .run(req.user.id, deviceId, ev.state, ev.timestamp, ev.date);
        eventCount++;
      }
    }

    // Update device last sync
    await db.prepare('UPDATE devices SET last_sync_at = NOW() WHERE id = ?').run(deviceId);

    // Log sync
    await db.prepare('INSERT INTO sync_log (user_id, device_id, sync_type, records_synced) VALUES (?, ?, ?, ?)')
      .run(req.user.id, deviceId, 'push', usageCount);

    res.json({ message: 'Sync complete', synced: { usageRecords: usageCount, activityEvents: eventCount } });
  } catch (err) { console.error('Sync push error:', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /pull — pull aggregated data across all devices
router.get('/pull', authenticate, async (req, res) => {
  try {
    const date = req.query.date;
    let records;

    if (date) {
      records = await db.prepare(`
        SELECT domain, title, category, date, SUM(total_seconds) as total_seconds, SUM(visits) as visits,
          MIN(first_visit) as first_visit, MAX(last_visit) as last_visit
        FROM usage_records WHERE user_id = ? AND date = ?
        GROUP BY domain, title, category, date ORDER BY total_seconds DESC
      `).all(req.user.id, date);
    } else {
      const since = req.query.since || new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      records = await db.prepare(`
        SELECT domain, title, category, date, SUM(total_seconds) as total_seconds, SUM(visits) as visits,
          MIN(first_visit) as first_visit, MAX(last_visit) as last_visit
        FROM usage_records WHERE user_id = ? AND date >= ?
        GROUP BY domain, title, category, date ORDER BY date DESC, total_seconds DESC
      `).all(req.user.id, since);
    }

    res.json({ records });
  } catch (err) { console.error('Sync pull error:', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET /full — full sync for date range
router.get('/full', authenticate, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days) || 7, 90);
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

    const records = await db.prepare(`
      SELECT domain, title, category, date, device_id, total_seconds, visits, first_visit, last_visit
      FROM usage_records WHERE user_id = ? AND date >= ?
      ORDER BY date DESC, total_seconds DESC
    `).all(req.user.id, since);

    res.json({ records, days });
  } catch (err) { console.error('Full sync error:', err); res.status(500).json({ error: 'Internal server error' }); }
});

module.exports = router;
