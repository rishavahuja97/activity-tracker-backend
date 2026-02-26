const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();

router.post('/', authenticate, async (req, res) => {
  try {
    const { deviceName, deviceType } = req.body;
    if (!deviceName) return res.status(400).json({ error: 'Device name required' });
    const id = uuidv4();
    const type = deviceType || 'other';
    await db.prepare('INSERT INTO devices (id, user_id, device_name, device_type) VALUES (?, ?, ?, ?)')
      .run(id, req.user.id, deviceName, type);
    res.status(201).json({ message: 'Device registered', device: { id, deviceName, deviceType: type } });
  } catch (err) { console.error('Device register error:', err); res.status(500).json({ error: 'Internal server error' }); }
});

router.get('/', authenticate, async (req, res) => {
  const devices = await db.prepare(`
    SELECT d.*, 
      (SELECT COUNT(*) FROM usage_records WHERE device_id = d.id) as usage_count,
      (SELECT COUNT(*) FROM screenshots WHERE device_id = d.id) as screenshot_count
    FROM devices d WHERE d.user_id = ? ORDER BY d.created_at DESC
  `).all(req.user.id);
  res.json({ devices });
});

router.put('/:id', authenticate, async (req, res) => {
  const device = await db.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  await db.prepare('UPDATE devices SET device_name = ? WHERE id = ?').run(req.body.deviceName, req.params.id);
  res.json({ message: 'Device updated' });
});

router.delete('/:id', authenticate, async (req, res) => {
  const device = await db.prepare('SELECT * FROM devices WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!device) return res.status(404).json({ error: 'Device not found' });
  await db.prepare('DELETE FROM devices WHERE id = ?').run(req.params.id);
  res.json({ message: 'Device removed' });
});

module.exports = router;
