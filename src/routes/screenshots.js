const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const db = require('../models/database');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads/screenshots';

// Ensure upload dir exists
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userDir = path.join(UPLOAD_DIR, req.user.id);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (req, file, cb) => cb(null, `${Date.now()}-${uuidv4().slice(0,8)}${path.extname(file.originalname) || '.jpg'}`)
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

// POST /upload — multipart file upload
router.post('/upload', authenticate, upload.single('screenshot'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const id = uuidv4();
    const { deviceId, domain, title, url, category, timestamp, date } = req.body;

    await db.prepare(`INSERT INTO screenshots (id, user_id, device_id, filename, domain, title, url, category, timestamp, date, file_size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, req.user.id, deviceId || 'unknown', req.file.filename, domain || 'unknown', title || '', url || '', category || 'Other',
        timestamp || new Date().toISOString(), date || new Date().toISOString().slice(0, 10), req.file.size);

    res.status(201).json({ message: 'Screenshot uploaded', screenshot: { id, filename: req.file.filename } });
  } catch (err) { console.error('Upload error:', err); res.status(500).json({ error: 'Internal server error' }); }
});

// POST /upload-base64 — base64 data URL upload (for browser extensions)
router.post('/upload-base64', authenticate, async (req, res) => {
  try {
    const { deviceId, dataUrl, domain, title, url, category, timestamp, date } = req.body;
    if (!dataUrl) return res.status(400).json({ error: 'dataUrl required' });

    const matches = dataUrl.match(/^data:image\/(\w+);base64,(.+)$/);
    if (!matches) return res.status(400).json({ error: 'Invalid data URL' });

    const ext = matches[1] === 'jpeg' ? 'jpg' : matches[1];
    const buffer = Buffer.from(matches[2], 'base64');
    const filename = `${Date.now()}-${uuidv4().slice(0,8)}.${ext}`;
    const userDir = path.join(UPLOAD_DIR, req.user.id);
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, filename), buffer);

    const id = uuidv4();
    await db.prepare(`INSERT INTO screenshots (id, user_id, device_id, filename, domain, title, url, category, timestamp, date, file_size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, req.user.id, deviceId || 'unknown', filename, domain || 'unknown', title || '', url || '', category || 'Other',
        timestamp || new Date().toISOString(), date || new Date().toISOString().slice(0, 10), buffer.length);

    // Enforce per-user limit (200)
    const count = await db.prepare('SELECT COUNT(*) as c FROM screenshots WHERE user_id = ?').get(req.user.id);
    if (parseInt(count.c) > 200) {
      const oldest = await db.prepare('SELECT id, filename FROM screenshots WHERE user_id = ? ORDER BY created_at ASC LIMIT ?')
        .all(req.user.id, parseInt(count.c) - 200);
      for (const ss of oldest) {
        const fp = path.join(userDir, ss.filename);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
        await db.prepare('DELETE FROM screenshots WHERE id = ?').run(ss.id);
      }
    }

    res.status(201).json({ message: 'Screenshot uploaded', screenshot: { id, filename } });
  } catch (err) { console.error('Base64 upload error:', err); res.status(500).json({ error: 'Internal server error' }); }
});

// GET / — list screenshots
router.get('/', authenticate, async (req, res) => {
  const { date, deviceId, limit } = req.query;
  let sql = 'SELECT id, device_id, domain, title, url, category, timestamp, date, file_size, created_at FROM screenshots WHERE user_id = ?';
  const params = [req.user.id];

  if (date) { sql += ' AND date = ?'; params.push(date); }
  if (deviceId) { sql += ' AND device_id = ?'; params.push(deviceId); }
  sql += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(Math.min(parseInt(limit) || 50, 200));

  const screenshots = await db.prepare(sql).all(...params);
  res.json({ screenshots });
});

// GET /image/:id — serve screenshot file
router.get('/image/:id', authenticate, async (req, res) => {
  const ss = await db.prepare('SELECT * FROM screenshots WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!ss) return res.status(404).json({ error: 'Screenshot not found' });
  const fp = path.join(UPLOAD_DIR, req.user.id, ss.filename);
  if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(path.resolve(fp));
});

// DELETE /:id
router.delete('/:id', authenticate, async (req, res) => {
  const ss = await db.prepare('SELECT * FROM screenshots WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!ss) return res.status(404).json({ error: 'Screenshot not found' });
  const fp = path.join(UPLOAD_DIR, req.user.id, ss.filename);
  if (fs.existsSync(fp)) fs.unlinkSync(fp);
  await db.prepare('DELETE FROM screenshots WHERE id = ?').run(req.params.id);
  res.json({ message: 'Screenshot deleted' });
});

module.exports = router;
