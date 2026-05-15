// database.js — PostgreSQL (produção) ou SQLite (desenvolvimento local)
const USE_PG = !!process.env.DATABASE_URL;

let wrapper;

// ══════════════════════════════════
// POSTGRESQL
// ══════════════════════════════════
async function initPG() {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes('railway.internal')
      ? false  // interno Railway não precisa de SSL
      : { rejectUnauthorized: false }
  });

  // Testa conexão
  await pool.query('SELECT 1');
  console.log('   🐘 PostgreSQL conectado');

  // Schema
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, birth_date TEXT,
      country TEXT, state TEXT, city TEXT, occupation TEXT,
      bio TEXT DEFAULT '', avatar_url TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      content TEXT, image_url TEXT, caption TEXT,
      tab TEXT NOT NULL DEFAULT 'timeline',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL,
      emoji TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(post_id, user_id, emoji)
    );
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL,
      parent_id TEXT, content TEXT NOT NULL,
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

  // Seed pergunta do dia
  const { rows } = await pool.query("SELECT id FROM question_of_day WHERE active=1 LIMIT 1");
  if (!rows.length) {
    const { v4: uuidv4 } = require('uuid');
    await pool.query(
      'INSERT INTO question_of_day (id, question) VALUES ($1, $2)',
      [uuidv4(), 'Se você pudesse reviver qualquer dia da sua vida exatamente como foi, qual seria e por quê?']
    );
  }

  // Wrapper síncrono-like usando async/await por dentro
  // Todas as funções retornam promises
  wrapper = {
    prepare: (sql) => ({
      run: async (...params) => {
        // Converte ? para $1, $2...
        const pgSql = toPg(sql);
        const res = await pool.query(pgSql, params);
        return { changes: res.rowCount };
      },
      get: async (...params) => {
        const pgSql = toPg(sql);
        const res = await pool.query(pgSql, params);
        return res.rows[0];
      },
      all: async (...params) => {
        const pgSql = toPg(sql);
        const res = await pool.query(pgSql, params);
        return res.rows;
      }
    }),
    run: async (sql, params=[]) => {
      await pool.query(toPg(sql), params);
    },
    pool
  };

  return wrapper;
}

// Converte SQLite (?) para PostgreSQL ($1, $2...)
function toPg(sql) {
  let i = 0;
  // Converte ? para $N
  sql = sql.replace(/\?/g, () => `$${++i}`);
  // Converte datetime('now') para NOW()
  sql = sql.replace(/datetime\('now'\)/g, 'NOW()');
  // Converte date(created_at) para DATE(created_at)
  sql = sql.replace(/date\(created_at\)/g, 'DATE(created_at)');
  // Converte strftime('%H',created_at) para TO_CHAR(created_at,'HH24')
  sql = sql.replace(/strftime\('%H',created_at\)/g, "TO_CHAR(created_at,'HH24')");
  // Converte strftime('%H', para TO_CHAR(
  sql = sql.replace(/strftime\('%H', /g, "TO_CHAR(");
  // COALESCE com datetime
  return sql;
}

// ══════════════════════════════════
// SQLITE (fallback local)
// ══════════════════════════════════
async function initSQLite() {
  const initSqlJs = require('sql.js');
  const fs   = require('fs');
  const path = require('path');
  const DB_PATH = path.resolve(process.env.DB_PATH || './daily.db');

  let db;
  let saveTimer;

  function flush() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); }
      catch(e) { console.error('DB flush error:', e.message); }
    }, 200);
  }

  const SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  const tables = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, birth_date TEXT, country TEXT, state TEXT, city TEXT, occupation TEXT, bio TEXT DEFAULT '', avatar_url TEXT DEFAULT '', created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL, content TEXT, image_url TEXT, caption TEXT, tab TEXT NOT NULL DEFAULT 'timeline', created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS reactions (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')), UNIQUE(post_id, user_id, emoji))`,
    `CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL, parent_id TEXT, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS question_of_day (id TEXT PRIMARY KEY, question TEXT NOT NULL, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS qod_responses (id TEXT PRIMARY KEY, question_id TEXT NOT NULL, user_id TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')))`
  ];
  tables.forEach(sql => { try { db.run(sql); } catch(e) {} });

  const { v4: uuidv4 } = require('uuid');
  const sq = db.prepare('SELECT id FROM question_of_day WHERE active=1 LIMIT 1');
  sq.step(); const hasQ = sq.getAsObject(); sq.free();
  if (!hasQ.id) {
    db.run('INSERT INTO question_of_day (id, question) VALUES (?, ?)',
      [uuidv4(), 'Se você pudesse reviver qualquer dia da sua vida exatamente como foi, qual seria e por quê?']);
  }
  flush();
  console.log(`   💾 SQLite: ${DB_PATH}`);

  wrapper = {
    prepare: (sql) => ({
      run: (...p) => { db.run(sql, p); flush(); return { changes: db.getRowsModified() }; },
      get: (...p) => { const s=db.prepare(sql); s.bind(p); const r=s.step()?s.getAsObject():undefined; s.free(); return r; },
      all: (...p) => { const s=db.prepare(sql); s.bind(p); const r=[]; while(s.step()) r.push(s.getAsObject()); s.free(); return r; }
    }),
    run: (sql, p=[]) => { db.run(sql, p); flush(); }
  };
  return wrapper;
}

// ══════════════════════════════════
// INIT
// ══════════════════════════════════
async function initDB() {
  if (USE_PG) {
    return await initPG();
  } else {
    return await initSQLite();
  }
}

function getDB() { return wrapper; }

module.exports = { initDB, getDB };
