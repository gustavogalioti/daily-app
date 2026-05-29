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
      country TEXT, state TEXT, city TEXT, neighborhood TEXT, occupation TEXT,
      bio TEXT DEFAULT '', avatar_url TEXT DEFAULT '',
      professional_title TEXT DEFAULT '', professional_url TEXT DEFAULT '', professional_desc TEXT DEFAULT '',
      is_admin INTEGER DEFAULT 0, points INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, type TEXT NOT NULL,
      content TEXT, image_url TEXT, caption TEXT,
      tab TEXT NOT NULL DEFAULT 'global', is_anonymous INTEGER DEFAULT 0,
      notification_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
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
      subscription JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL,
      addressee_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(requester_id, addressee_id)
    );
    CREATE TABLE IF NOT EXISTS testimonials (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS communities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      image_url TEXT DEFAULT '',
      type TEXT NOT NULL DEFAULT 'interest',
      category TEXT DEFAULT 'geral',
      country TEXT, state TEXT, city TEXT, neighborhood TEXT,
      is_open INTEGER DEFAULT 1,
      owner_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS community_members (
      id TEXT PRIMARY KEY,
      community_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(community_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS community_posts (
      id TEXT PRIMARY KEY,
      community_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'geral',
      points INTEGER NOT NULL DEFAULT 50,
      icon TEXT DEFAULT '🏆',
      requirement_type TEXT NOT NULL,
      requirement_value INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_achievements (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      earned_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, achievement_id)
    );
    CREATE TABLE IF NOT EXISTS featured_badges (
      user_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      slot INTEGER NOT NULL,
      PRIMARY KEY(user_id, slot)
    );
    CREATE TABLE IF NOT EXISTS daily_questions (
      id TEXT PRIMARY KEY,
      period TEXT NOT NULL,
      question TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      available_from TIME,
      available_to TIME,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS daily_question_responses (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      response_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(question_id, user_id, response_date)
    );
    CREATE TABLE IF NOT EXISTS pedro_comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      location TEXT,
      event_date TIMESTAMPTZ,
      owner_id TEXT NOT NULL,
      image_url TEXT DEFAULT '',
      is_public INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS event_members (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT DEFAULT 'going',
      joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(event_id, user_id)
    );
  `);

  // Migrations
  const migrations = [
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS neighborhood TEXT`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS professional_title TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS professional_url TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS professional_desc TEXT DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin INTEGER DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_anonymous INTEGER DEFAULT 0`,
    `ALTER TABLE posts ADD COLUMN IF NOT EXISTS notification_id TEXT`,
    `ALTER TABLE posts ADD COLUMN IF NOT EXISTS tab TEXT NOT NULL DEFAULT 'global'`,
  ];
  for (const m of migrations) { try { await pool.query(m); } catch(e) {} }

  // Seed achievements
  await seedAchievements(pool);

  // Seed daily questions
  await seedDailyQuestions(pool);

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

async function seedAchievements(pool) {
  const { rows } = await pool.query('SELECT id FROM achievements LIMIT 1');
  if (rows.length) return;
  const { v4: uuidv4 } = require('uuid');
  const achievements = [
    // Cadastro
    { slug:'first_login', name:'Primeiro passo', description:'Fez login pela primeira vez', category:'cadastro', points:10, icon:'👋', type:'login', value:1 },
    { slug:'complete_profile', name:'Identidade formada', description:'Completou o perfil com foto e bio', category:'cadastro', points:50, icon:'✨', type:'profile_complete', value:1 },
    { slug:'first_avatar', name:'Rosto no mapa', description:'Adicionou uma foto de perfil', category:'cadastro', points:20, icon:'🖼️', type:'avatar', value:1 },
    // Amigos
    { slug:'first_friend', name:'Primeira conexão', description:'Fez seu primeiro amigo', category:'amigos', points:30, icon:'🤝', type:'friends', value:1 },
    { slug:'friends_10', name:'Roda de amigos', description:'Conquistou 10 amigos', category:'amigos', points:100, icon:'👥', type:'friends', value:10 },
    { slug:'friends_50', name:'Alma popular', description:'Conquistou 50 amigos', category:'amigos', points:300, icon:'🌟', type:'friends', value:50 },
    { slug:'friends_100', name:'Dono do jogo', description:'100 amigos! Lendário.', category:'amigos', points:500, icon:'👑', type:'friends', value:100 },
    // Posts
    { slug:'first_post', name:'Voz ativa', description:'Fez seu primeiro post', category:'posts', points:20, icon:'📝', type:'posts', value:1 },
    { slug:'posts_10', name:'Contador de histórias', description:'10 posts publicados', category:'posts', points:100, icon:'📖', type:'posts', value:10 },
    { slug:'posts_50', name:'Cronista do cotidiano', description:'50 posts publicados', category:'posts', points:300, icon:'🗞️', type:'posts', value:50 },
    { slug:'first_photo', name:'Olho vivo', description:'Postou sua primeira foto', category:'fotos', points:30, icon:'📸', type:'photos', value:1 },
    { slug:'photos_10', name:'Fotógrafo amador', description:'10 fotos postadas', category:'fotos', points:150, icon:'📷', type:'photos', value:10 },
    { slug:'photos_50', name:'Fotógrafo profissional', description:'50 fotos postadas', category:'fotos', points:400, icon:'🎞️', type:'photos', value:50 },
    // Daily Mandou
    { slug:'first_daily', name:'No tempo certo', description:'Respondeu ao Daily Mandou pela primeira vez', category:'daily', points:100, icon:'⚡', type:'daily_mandou', value:1 },
    { slug:'daily_5', name:'Sempre ligado', description:'Respondeu ao Daily Mandou 5 vezes', category:'daily', points:300, icon:'🔥', type:'daily_mandou', value:5 },
    { slug:'daily_10', name:'Reflexo afiado', description:'Respondeu ao Daily Mandou 10 vezes', category:'daily', points:500, icon:'⚡🔥', type:'daily_mandou', value:10 },
    { slug:'daily_20', name:'Lendário do Daily', description:'20 vezes no Daily Mandou. Incrível!', category:'daily', points:1000, icon:'🏅', type:'daily_mandou', value:20 },
    // Comunidades
    { slug:'first_community', name:'Pertencimento', description:'Entrou em sua primeira comunidade', category:'comunidades', points:30, icon:'🏘️', type:'communities', value:1 },
    { slug:'communities_5', name:'Cidadão do mundo', description:'Membro de 5 comunidades', category:'comunidades', points:150, icon:'🌍', type:'communities', value:5 },
    { slug:'created_community', name:'Fundador', description:'Criou uma comunidade', category:'comunidades', points:200, icon:'🏗️', type:'community_created', value:1 },
    // Conquistas especiais
    { slug:'lobo_solitario', name:'Lobo solitário', description:'Postou uma foto às 3 da manhã', category:'especial', points:200, icon:'🌙', type:'night_owl', value:1 },
    { slug:'depoimento_dado', name:'Palavras que ficam', description:'Escreveu um depoimento para alguém', category:'social', points:50, icon:'💬', type:'testimonial_given', value:1 },
    { slug:'depoimento_recebido', name:'Querido por todos', description:'Recebeu seu primeiro depoimento', category:'social', points:80, icon:'💖', type:'testimonial_received', value:1 },
    { slug:'reactions_100', name:'Post viral', description:'Seus posts receberam 100 reações', category:'engajamento', points:300, icon:'🚀', type:'reactions_received', value:100 },
  ];
  for (const a of achievements) {
    await pool.query(
      'INSERT INTO achievements (id,slug,name,description,category,points,icon,requirement_type,requirement_value) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(slug) DO NOTHING',
      [uuidv4(), a.slug, a.name, a.description, a.category, a.points, a.icon, a.type, a.value]
    );
  }
  console.log('   🏆 Conquistas criadas');
}

async function seedDailyQuestions(pool) {
  const { rows } = await pool.query('SELECT id FROM daily_questions LIMIT 1');
  if (rows.length) return;
  const { v4: uuidv4 } = require('uuid');
  const questions = [
    { period:'manha', question:'Como está seu humor hoje? Por quê?', from:'05:00', to:'11:00' },
    { period:'almoco', question:'Já almoçou? O que comeu? Posta uma foto do prato!', from:'11:01', to:'14:00' },
    { period:'tarde', question:'Tomou água hoje?', from:'14:01', to:'18:00' },
    { period:'noite', question:'Como foi seu dia? Bom, médio ou ruim?', from:'18:01', to:'23:59' },
  ];
  for (const q of questions) {
    await pool.query(
      'INSERT INTO daily_questions (id,period,question,active,available_from,available_to) VALUES ($1,$2,$3,1,$4,$5)',
      [uuidv4(), q.period, q.question, q.from, q.to]
    );
  }
  console.log('   ❓ Perguntas do dia criadas');
}

function toPg(sql) {
  let i = 0;
  sql = sql.replace(/\?/g, () => `$${++i}`);
  sql = sql.replace(/datetime\('now'\)/g, 'NOW()');
  sql = sql.replace(/date\(created_at\)/gi, 'DATE(created_at)');
  sql = sql.replace(/strftime\('%H',\s*created_at\)/gi, "TO_CHAR(created_at,'HH24')");
  return sql;
}

async function initDB() { return initPG(); }
function getDB() { return wrapper; }
module.exports = { initDB, getDB };
