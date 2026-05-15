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

class DBWrapper {
  prepare(sql) {
    return {
      run: (...p) => { db.run(sql, p); flush(); return { changes: db.getRowsModified() }; },
      get: (...p) => { const s=db.prepare(sql); s.bind(p); const r=s.step()?s.getAsObject():undefined; s.free(); return r; },
      all: (...p) => { const s=db.prepare(sql); s.bind(p); const r=[]; while(s.step()) r.push(s.getAsObject()); s.free(); return r; }
    };
  }
  run(sql, p=[]) { db.run(sql, p); flush(); }
}

const wrapper = new DBWrapper();

async function initDB() {
  const SQL = await initSqlJs();
  db = fs.existsSync(DB_PATH)
    ? new SQL.Database(fs.readFileSync(DB_PATH))
    : new SQL.Database();

  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE, password TEXT NOT NULL, birth_date TEXT,
      country TEXT, state TEXT, city TEXT, occupation TEXT,
      bio TEXT DEFAULT '', avatar_url TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      content TEXT, image_url TEXT, caption TEXT,
      tab TEXT NOT NULL DEFAULT 'timeline',
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS reactions (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL,
      emoji TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(post_id, user_id, emoji)
    )`,
    `CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL,
      parent_id TEXT, content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS question_of_day (
      id TEXT PRIMARY KEY, question TEXT NOT NULL, active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS qod_responses (
      id TEXT PRIMARY KEY, question_id TEXT NOT NULL, user_id TEXT NOT NULL,
      content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))
    )`
  ];

  tables.forEach(sql => { try { db.run(sql); } catch(e) {} });

  const { v4: uuidv4 } = require('uuid');
  const hasQ = wrapper.prepare('SELECT id FROM question_of_day WHERE active=1 LIMIT 1').get();
  if (!hasQ) {
    wrapper.prepare('INSERT INTO question_of_day (id, question) VALUES (?, ?)')
      .run(uuidv4(), 'Se você pudesse reviver qualquer dia da sua vida exatamente como foi, qual seria e por quê?');
  }

  flush();
  console.log(`   💾 Banco: ${DB_PATH}`);
  return wrapper;
}

module.exports = { initDB, getDB: () => wrapper };
