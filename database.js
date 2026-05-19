const USE_PG = !!process.env.DATABASE_URL;
let wrapper;

async function initPG() {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway.internal') ? false : { rejectUnauthorized: false }
  });
  await pool.query('SELECT 1');
  console.log('   🐘 PostgreSQL conectado');

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, birth_date TEXT,
      country TEXT, state TEXT, city TEXT, occupation TEXT,
      bio TEXT DEFAULT '', avatar_url TEXT DEFAULT '',
      is_admin INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      content TEXT, image_url TEXT, caption TEXT,
      tab TEXT NOT NULL DEFAULT 'geral', is_anonymous INTEGER DEFAULT 0,
      notification_id TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL,
      emoji TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(post_id, user_id, emoji)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL,
      parent_id TEXT, content TEXT NOT NULL, is_anonymous INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY, sent_by TEXT NOT NULL,
      sent_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE,
      subscription JSONB NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS question_of_day (
      id TEXT PRIMARY KEY, question TEXT NOT NULL, active INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS qod_responses (
      id TEXT PRIMARY KEY, question_id TEXT NOT NULL, user_id TEXT NOT NULL,
      content TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Migrations — add columns if not exist
  const migrations = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_anonymous INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN IF NOT EXISTS notification_id TEXT`,
  ];
  for (const m of migrations) { try { await pool.query(m); } catch(e) {} }

  // Seed QoD
  const { rows } = await pool.query("SELECT id FROM question_of_day WHERE active=1 LIMIT 1");
  if (!rows.length) {
    const { v4: uuidv4 } = require('uuid');
    await pool.query('INSERT INTO question_of_day (id,question) VALUES ($1,$2)',
      [uuidv4(), 'Se você pudesse reviver qualquer dia da sua vida exatamente como foi, qual seria e por quê?']);
  }

  wrapper = {
    prepare: (sql) => ({
      run:  async (...p) => { const r = await pool.query(toPg(sql), p); return { changes: r.rowCount }; },
      get:  async (...p) => { const r = await pool.query(toPg(sql), p); return r.rows[0]; },
      all:  async (...p) => { const r = await pool.query(toPg(sql), p); return r.rows; }
    }),
    run: async (sql, p=[]) => { await pool.query(toPg(sql), p); },
    pool
  };
  return wrapper;
}

function toPg(sql) {
  let i = 0;
  sql = sql.replace(/\?/g, () => `$${++i}`);
  sql = sql.replace(/datetime\('now'\)/g, 'NOW()');
  sql = sql.replace(/date\(created_at\)/gi, 'DATE(created_at)');
  sql = sql.replace(/strftime\('%H',\s*created_at\)/gi, "TO_CHAR(created_at,'HH24')");
  return sql;
}

async function initSQLite() {
  const initSqlJs = require('sql.js');
  const fs = require('fs'), path = require('path');
  const DB_PATH = path.resolve(process.env.DB_PATH || './daily.db');
  let db; let saveTimer;
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); } catch(e) {} }, 200);
  }
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH) ? new SQL.Database(fs.readFileSync(DB_PATH)) : new SQL.Database();
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, birth_date TEXT, country TEXT, state TEXT, city TEXT, occupation TEXT, bio TEXT DEFAULT '', avatar_url TEXT DEFAULT '', is_admin INTEGER DEFAULT 0, points INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, content TEXT, image_url TEXT, caption TEXT, tab TEXT NOT NULL DEFAULT 'geral', is_anonymous INTEGER DEFAULT 0, notification_id TEXT, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS reactions (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(post_id, user_id, emoji))`,
    `CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL, parent_id TEXT, content TEXT NOT NULL, is_anonymous INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, sent_by TEXT NOT NULL, sent_at TEXT DEFAULT (datetime('now')), expires_at TEXT NOT NULL, active INTEGER DEFAULT 1)`,
    `CREATE TABLE IF NOT EXISTS push_subscriptions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE, subscription TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS question_of_day (id TEXT PRIMARY KEY, question TEXT NOT NULL, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS qod_responses (id TEXT PRIMARY KEY, question_id TEXT NOT NULL, user_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`
  ];
  tables.forEach(sql => { try { db.run(sql); } catch(e) {} });
  flush(); console.log(`   💾 SQLite: ${DB_PATH}`);
  wrapper = {
    prepare: (sql) => ({
      run: (...p) => { db.run(sql,p); flush(); return {changes:db.getRowsModified()}; },
      get: (...p) => { const s=db.prepare(sql); s.bind(p); const r=s.step()?s.getAsObject():undefined; s.free(); return r; },
      all: (...p) => { const s=db.prepare(sql); s.bind(p); const r=[]; while(s.step()) r.push(s.getAsObject()); s.free(); return r; }
    }),
    run: (sql,p=[]) => { db.run(sql,p); flush(); }
  };
  return wrapper;
}

async function initDB() { return USE_PG ? initPG() : initSQLite(); }
function getDB() { return wrapper; }
module.exports = { initDB, getDB };
