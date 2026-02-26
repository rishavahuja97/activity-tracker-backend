// ============================================================
// Database — PostgreSQL via node-pg
// Provides a wrapper with .prepare().get/all/run API
// ============================================================

const { Pool } = require('pg');

// Railway may use different variable names
const dbUrl = process.env.DATABASE_URL 
  || process.env.DATABASE_PUBLIC_URL 
  || process.env.POSTGRES_URL
  || process.env.POSTGRES_PRISMA_URL;

console.log('🔍 ENV vars available:', Object.keys(process.env).filter(k => k.includes('DATABASE') || k.includes('POSTGRES') || k.includes('PG')).join(', ') || 'NONE FOUND');
console.log('🔗 Using DB URL:', dbUrl ? dbUrl.replace(/\/\/.*@/, '//***@') : '❌ NOT SET');

if (!dbUrl) {
  console.error('❌ No DATABASE_URL found! Set it in Railway Variables tab.');
  console.error('Available env vars:', Object.keys(process.env).sort().join(', '));
  process.exit(1);
}

const pool = new Pool({
  connectionString: dbUrl,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// ---- Init: Create tables ----
const initPromise = (async () => {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        display_name TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_name TEXT NOT NULL,
        device_type TEXT NOT NULL,
        last_sync_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS usage_records (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        domain TEXT NOT NULL,
        title TEXT,
        category TEXT DEFAULT 'Other',
        date TEXT NOT NULL,
        total_seconds INTEGER DEFAULT 0,
        visits INTEGER DEFAULT 0,
        first_visit TEXT,
        last_visit TEXT,
        synced_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, device_id, domain, date)
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS screenshots (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        filename TEXT NOT NULL,
        thumbnail_filename TEXT,
        domain TEXT,
        title TEXT,
        url TEXT,
        category TEXT DEFAULT 'Other',
        timestamp TEXT NOT NULL,
        date TEXT NOT NULL,
        file_size INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS activity_events (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        state TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        date TEXT NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sync_log (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL,
        sync_type TEXT NOT NULL,
        records_synced INTEGER DEFAULT 0,
        synced_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_usage_user_date ON usage_records(user_id, date)',
      'CREATE INDEX IF NOT EXISTS idx_usage_device ON usage_records(device_id, date)',
      'CREATE INDEX IF NOT EXISTS idx_ss_user_date ON screenshots(user_id, date)',
      'CREATE INDEX IF NOT EXISTS idx_events_user_date ON activity_events(user_id, date)',
      'CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id)',
    ];
    for (const sql of indexes) {
      await client.query(sql);
    }

    console.log('✅ PostgreSQL database initialized');
  } finally {
    client.release();
  }
})();

// ============================================================
// Wrapper — provides .prepare(sql).get/all/run(...params) API
// Converts ? placeholders to $1, $2, ... for PostgreSQL
// ============================================================

function convertPlaceholders(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const db = {
  prepare(sql) {
    const pgSql = convertPlaceholders(sql);

    return {
      async run(...params) {
        const res = await pool.query(pgSql, params);
        return { changes: res.rowCount };
      },

      async get(...params) {
        const res = await pool.query(pgSql, params);
        return res.rows[0] || undefined;
      },

      async all(...params) {
        const res = await pool.query(pgSql, params);
        return res.rows;
      }
    };
  },

  async exec(sql) {
    await pool.query(sql);
  },

  transaction(fn) {
    return async (...args) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        // Pass a scoped db for the transaction
        const txDb = {
          prepare(sql) {
            const pgSql = convertPlaceholders(sql);
            return {
              async run(...params) {
                const res = await client.query(pgSql, params);
                return { changes: res.rowCount };
              }
            };
          }
        };
        await fn(txDb, ...args);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    };
  },

  // Raw query helper
  async query(sql, params) {
    return pool.query(sql, params);
  },

  ready: initPromise,
  pool
};

module.exports = db;
