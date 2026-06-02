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

    CREATE TABLE IF NOT EXISTS user_notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      from_user_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      data JSONB DEFAULT '{}',
      read INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS community_invites (
      id TEXT PRIMARY KEY,
      community_id TEXT NOT NULL,
      inviter_id TEXT NOT NULL,
      invitee_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE,
      subscription JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY, requester_id TEXT NOT NULL, addressee_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', message TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(requester_id, addressee_id)
    );
    CREATE TABLE IF NOT EXISTS testimonials (
      id TEXT PRIMARY KEY, author_id TEXT NOT NULL, target_id TEXT NOT NULL,
      content TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS communities (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
      image_url TEXT DEFAULT '', type TEXT NOT NULL DEFAULT 'interest',
      category TEXT DEFAULT 'geral',
      country TEXT, state TEXT, city TEXT, neighborhood TEXT,
      is_open INTEGER DEFAULT 1, owner_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS community_members (
      id TEXT PRIMARY KEY, community_id TEXT NOT NULL, user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member', joined_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(community_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS community_posts (
      id TEXT PRIMARY KEY, community_id TEXT NOT NULL, user_id TEXT NOT NULL,
      content TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      description TEXT NOT NULL, category TEXT NOT NULL DEFAULT 'geral',
      points INTEGER NOT NULL DEFAULT 50, icon TEXT DEFAULT '🏆',
      requirement_type TEXT NOT NULL, requirement_value INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_achievements (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, achievement_id TEXT NOT NULL,
      earned_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_id, achievement_id)
    );
    CREATE TABLE IF NOT EXISTS featured_badges (
      user_id TEXT NOT NULL, achievement_id TEXT NOT NULL, slot INTEGER NOT NULL,
      PRIMARY KEY(user_id, slot)
    );
    CREATE TABLE IF NOT EXISTS daily_questions (
      id TEXT PRIMARY KEY, period TEXT NOT NULL, question TEXT NOT NULL,
      active INTEGER DEFAULT 1, available_from TIME, available_to TIME,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS daily_question_responses (
      id TEXT PRIMARY KEY, question_id TEXT NOT NULL, user_id TEXT NOT NULL,
      content TEXT NOT NULL, response_date DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(question_id, user_id, response_date)
    );

    CREATE TABLE IF NOT EXISTS map_points (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
      lat DOUBLE PRECISION NOT NULL, lng DOUBLE PRECISION NOT NULL,
      points INTEGER NOT NULL DEFAULT 100,
      checkin_radius INTEGER NOT NULL DEFAULT 100,
      route_id TEXT, icon TEXT DEFAULT '🏆', category TEXT DEFAULT 'geral',
      created_by TEXT NOT NULL, active INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS map_routes (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
      city TEXT, state TEXT, country TEXT DEFAULT 'BR',
      icon TEXT DEFAULT '🗺️', category TEXT DEFAULT 'cultura',
      created_by TEXT NOT NULL, active INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_checkins (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, point_id TEXT NOT NULL,
      image_url TEXT, distance_m INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, point_id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT,
      location TEXT, event_date TIMESTAMPTZ NOT NULL,
      event_end_date TIMESTAMPTZ, owner_id TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS event_members (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      decline_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(event_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS event_posts (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, user_id TEXT NOT NULL,
      content TEXT NOT NULL, image_url TEXT,
      post_type TEXT DEFAULT 'text', poll_data JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS event_post_reactions (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL,
      emoji TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(post_id, user_id, emoji)
    );
    CREATE TABLE IF NOT EXISTS event_post_comments (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, event_id TEXT NOT NULL,
      user_id TEXT NOT NULL, content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS pedro_comments (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS community_post_reactions (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, user_id TEXT NOT NULL,
      emoji TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(post_id, user_id, emoji)
    );
    CREATE TABLE IF NOT EXISTS community_post_comments (
      id TEXT PRIMARY KEY, post_id TEXT NOT NULL, community_id TEXT NOT NULL,
      user_id TEXT NOT NULL, content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_locations (
      user_id TEXT PRIMARY KEY, lat DOUBLE PRECISION NOT NULL,
      lng DOUBLE PRECISION NOT NULL, is_active INTEGER DEFAULT 1,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS geo_chat (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, area_key TEXT NOT NULL,
      content TEXT NOT NULL, lat DOUBLE PRECISION, lng DOUBLE PRECISION,
      created_at TIMESTAMPTZ DEFAULT NOW()
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
    `ALTER TABLE communities ADD COLUMN IF NOT EXISTS neighborhood TEXT`,
    `ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS post_type TEXT DEFAULT 'text'`,
    `ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS image_url TEXT`,
    `ALTER TABLE community_posts ADD COLUMN IF NOT EXISTS poll_data JSONB`,
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS is_moderator INTEGER DEFAULT 0`,
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS event_end_date TIMESTAMPTZ`,
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS location TEXT`,
    `ALTER TABLE event_members ADD COLUMN IF NOT EXISTS decline_reason TEXT`,
    `ALTER TABLE events ADD COLUMN IF NOT EXISTS cover_url TEXT`,
  ];
  for (const m of migrations) { try { await pool.query(m); } catch(e) { /* migration já existe */ } }
  // Criar índices para notificações (não bloqueante)
  // Garantir tabela user_notifications (segurança extra)
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS user_notifications (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, from_user_id TEXT,
      type TEXT NOT NULL, title TEXT NOT NULL, body TEXT,
      data JSONB DEFAULT '{}', read INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
  } catch(_) {}
  try { await pool.query('CREATE INDEX IF NOT EXISTS idx_user_notif_user ON user_notifications(user_id, read, created_at DESC)'); } catch(_) {}
  try { await pool.query('CREATE INDEX IF NOT EXISTS idx_comm_invites ON community_invites(invitee_id, status)'); } catch(_) {}

  try { await seedAchievements(pool); } catch(e) { console.error('seedAchievements:', e.message); }
  try { await seedDailyQuestions(pool); } catch(e) { console.error('seedDailyQuestions:', e.message); }
  try { await seedRegionalCommunities(pool); } catch(e) { console.error('seedRegionalCommunities:', e.message); }
  try { await seedPedro(pool); } catch(e) { console.error('seedPedro:', e.message); }
  try { await seedPedroCommunity(pool); } catch(e) { console.error('seedPedroCommunity:', e.message); }

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


async function seedPedro(pool) {
  const { v4: uuidv4 } = require('uuid');
  const PEDRO_ID = 'pedro-official-daily';
  // Verifica se Pedro já existe
  const { rows } = await pool.query('SELECT id FROM users WHERE id=$1', [PEDRO_ID]);
  if (rows.length) {
    // Atualizar foto e bio mesmo se já existe
    await pool.query('UPDATE users SET avatar_url=$1, bio=$2 WHERE id=$3',
      ['https://raw.githubusercontent.com/gustavogalioti/daily-app/main/pedro.jpg',
       'Oi! Eu sou o Pedro 🐱 O gato laranja oficial do Daily. Estou aqui pra animar a rede, comentar seus posts e nunca te deixar sozinho. Fui criado em homenagem ao Pedro real, que partiu mas nunca foi esquecido. 🧡',
       PEDRO_ID]);
    return;
  }
  // Criar conta do Pedro
  const bcrypt = require('bcryptjs');
  const hashed = await bcrypt.hash('pedro-daily-gato-laranja-2026', 8);
  await pool.query(`
    INSERT INTO users (id,name,username,email,password,bio,avatar_url,is_admin,points,occupation)
    VALUES ($1,$2,$3,$4,$5,$6,$7,0,9999,$8)
    ON CONFLICT(id) DO NOTHING
  `, [
    PEDRO_ID,
    'Pedro',
    'pedro',
    'pedro@daily.app',
    hashed,
    'Oi! Eu sou o Pedro 🐱 O gato laranja oficial do Daily. Estou aqui pra animar a rede, comentar seus posts e nunca deixar você sozinho. Fui criado em homenagem ao Pedro real, que partiu mas nunca foi esquecido. 🧡',
    'https://raw.githubusercontent.com/gustavogalioti/daily-app/main/pedro.jpg',
    'Mascote oficial do Daily'
  ]);
  // Tornar todos usuários existentes amigos do Pedro
  const { rows: allUsers } = await pool.query("SELECT id FROM users WHERE id != $1 AND id != 'system-daily'", [PEDRO_ID]);
  for (const u of allUsers) {
    await pool.query(
      'INSERT INTO friendships (id,requester_id,addressee_id,status,message) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING',
      [uuidv4(), PEDRO_ID, u.id, 'accepted', 'Oi! Sou o Pedro, seu amigo felino! 🐱🧡']
    );
  }
  console.log('   🐱 Pedro criado e amizades feitas!');
}

async function seedRegionalCommunities(pool) {
  const { rows } = await pool.query("SELECT id FROM communities WHERE type='regional' LIMIT 1");
  if (rows.length) return;
  const { v4: uuidv4 } = require('uuid');
  const { BRASIL_DATA } = require('./seed_communities');
  const SYSTEM_USER = 'system-daily';

  // Garante usuário sistema
  await pool.query(`INSERT INTO users (id,name,username,email,password,is_admin,bio) VALUES ($1,$2,$3,$4,$5,1,$6)
    ON CONFLICT(id) DO NOTHING`,
    [SYSTEM_USER,'Daily (Sistema)','daily','sistema@daily.app','system',
     'Conta oficial do DAILY. Moderadora das comunidades regionais.']);

  const entries = [];
  // País
  entries.push({ id: uuidv4(), name: '🇧🇷 Brasil', description: 'Comunidade oficial de todos os usuários do Brasil no DAILY.', type: 'regional', country: 'BR', state: null, city: null });

  for (const estado of BRASIL_DATA.estados) {
    entries.push({ id: uuidv4(), name: `📍 ${estado.nome}`, description: `Comunidade oficial do estado de ${estado.nome}.`, type: 'regional', country: 'BR', state: estado.uf, city: null });
    for (const cidade of estado.cidades) {
      entries.push({ id: uuidv4(), name: `🏙️ ${cidade}`, description: `Comunidade oficial da cidade de ${cidade} - ${estado.uf}.`, type: 'regional', country: 'BR', state: estado.uf, city: cidade });
    }
  }

  for (const e of entries) {
    await pool.query(
      `INSERT INTO communities (id,name,description,type,country,state,city,is_open,owner_id) VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8) ON CONFLICT DO NOTHING`,
      [e.id, e.name, e.description, e.type, e.country, e.state || null, e.city || null, SYSTEM_USER]
    );
  }
  console.log(`   🏘️  ${entries.length} comunidades regionais criadas`);
}

async function seedAchievements(pool) {
  const { rows } = await pool.query('SELECT id FROM achievements LIMIT 1');
  if (rows.length) {
    // Atualizar foto e bio mesmo se já existe
    await pool.query('UPDATE users SET avatar_url=$1, bio=$2 WHERE id=$3',
      ['https://raw.githubusercontent.com/gustavogalioti/daily-app/main/pedro.jpg',
       'Oi! Eu sou o Pedro 🐱 O gato laranja oficial do Daily. Estou aqui pra animar a rede, comentar seus posts e nunca te deixar sozinho. Fui criado em homenagem ao Pedro real, que partiu mas nunca foi esquecido. 🧡',
       PEDRO_ID]);
    return;
  }
  const { v4: uuidv4 } = require('uuid');
  const list = [
    { slug:'first_login',name:'Primeiro passo',desc:'Fez login pela primeira vez',cat:'cadastro',pts:10,icon:'👋',type:'login',val:1},
    { slug:'complete_profile',name:'Identidade formada',desc:'Completou o perfil com foto e bio',cat:'cadastro',pts:50,icon:'✨',type:'profile_complete',val:1},
    { slug:'first_avatar',name:'Rosto no mapa',desc:'Adicionou uma foto de perfil',cat:'cadastro',pts:20,icon:'🖼️',type:'avatar',val:1},
    { slug:'first_friend',name:'Primeira conexão',desc:'Fez seu primeiro amigo',cat:'amigos',pts:30,icon:'🤝',type:'friends',val:1},
    { slug:'friends_10',name:'Roda de amigos',desc:'Conquistou 10 amigos',cat:'amigos',pts:100,icon:'👥',type:'friends',val:10},
    { slug:'friends_50',name:'Alma popular',desc:'Conquistou 50 amigos',cat:'amigos',pts:300,icon:'🌟',type:'friends',val:50},
    { slug:'friends_100',name:'Dono do jogo',desc:'100 amigos! Lendário.',cat:'amigos',pts:500,icon:'👑',type:'friends',val:100},
    { slug:'first_post',name:'Voz ativa',desc:'Fez seu primeiro post',cat:'posts',pts:20,icon:'📝',type:'posts',val:1},
    { slug:'posts_10',name:'Contador de histórias',desc:'10 posts publicados',cat:'posts',pts:100,icon:'📖',type:'posts',val:10},
    { slug:'posts_50',name:'Cronista do cotidiano',desc:'50 posts publicados',cat:'posts',pts:300,icon:'🗞️',type:'posts',val:50},
    { slug:'first_photo',name:'Olho vivo',desc:'Postou sua primeira foto',cat:'fotos',pts:30,icon:'📸',type:'photos',val:1},
    { slug:'photos_10',name:'Fotógrafo amador',desc:'10 fotos postadas',cat:'fotos',pts:150,icon:'📷',type:'photos',val:10},
    { slug:'photos_50',name:'Fotógrafo profissional',desc:'50 fotos postadas',cat:'fotos',pts:400,icon:'🎞️',type:'photos',val:50},
    { slug:'first_daily',name:'No tempo certo',desc:'Respondeu ao Daily Mandou pela primeira vez',cat:'daily',pts:100,icon:'⚡',type:'daily_mandou',val:1},
    { slug:'daily_5',name:'Sempre ligado',desc:'Respondeu 5 vezes ao Daily Mandou',cat:'daily',pts:300,icon:'🔥',type:'daily_mandou',val:5},
    { slug:'daily_10',name:'Reflexo afiado',desc:'Respondeu 10 vezes ao Daily Mandou',cat:'daily',pts:500,icon:'⚡🔥',type:'daily_mandou',val:10},
    { slug:'daily_20',name:'Lendário do Daily',desc:'20 vezes no Daily Mandou. Incrível!',cat:'daily',pts:1000,icon:'🏅',type:'daily_mandou',val:20},
    { slug:'first_community',name:'Pertencimento',desc:'Entrou em sua primeira comunidade',cat:'comunidades',pts:30,icon:'🏘️',type:'communities',val:1},
    { slug:'communities_5',name:'Cidadão do mundo',desc:'Membro de 5 comunidades',cat:'comunidades',pts:150,icon:'🌍',type:'communities',val:5},
    { slug:'created_community',name:'Fundador',desc:'Criou uma comunidade',cat:'comunidades',pts:200,icon:'🏗️',type:'community_created',val:1},
    { slug:'lobo_solitario',name:'Lobo solitário',desc:'Postou uma foto às 3 da manhã',cat:'especial',pts:200,icon:'🌙',type:'night_owl',val:1},
    { slug:'depoimento_dado',name:'Palavras que ficam',desc:'Escreveu um depoimento para alguém',cat:'social',pts:50,icon:'💬',type:'testimonial_given',val:1},
    { slug:'depoimento_recebido',name:'Querido por todos',desc:'Recebeu seu primeiro depoimento',cat:'social',pts:80,icon:'💖',type:'testimonial_received',val:1},
    { slug:'reactions_100',name:'Post viral',desc:'Seus posts receberam 100 reações',cat:'engajamento',pts:300,icon:'🚀',type:'reactions_received',val:100},
  ];
  for (const a of list) {
    await pool.query(
      'INSERT INTO achievements (id,slug,name,description,category,points,icon,requirement_type,requirement_value) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(slug) DO NOTHING',
      [uuidv4(),a.slug,a.name,a.desc,a.cat,a.pts,a.icon,a.type,a.val]
    );
  }
  console.log('   🏆 Conquistas criadas');
}

async function seedDailyQuestions(pool) {
  const { rows } = await pool.query('SELECT id FROM daily_questions LIMIT 1');
  if (rows.length) {
    // Atualizar foto e bio mesmo se já existe
    await pool.query('UPDATE users SET avatar_url=$1, bio=$2 WHERE id=$3',
      ['https://raw.githubusercontent.com/gustavogalioti/daily-app/main/pedro.jpg',
       'Oi! Eu sou o Pedro 🐱 O gato laranja oficial do Daily. Estou aqui pra animar a rede, comentar seus posts e nunca te deixar sozinho. Fui criado em homenagem ao Pedro real, que partiu mas nunca foi esquecido. 🧡',
       PEDRO_ID]);
    return;
  }
  const { v4: uuidv4 } = require('uuid');
  const qs = [
    { period:'manha', question:'Como está seu humor hoje? Por quê?', from:'05:00', to:'11:00' },
    { period:'almoco', question:'Já almoçou? O que comeu? Conta pra gente!', from:'11:01', to:'14:00' },
    { period:'tarde', question:'Tomou água hoje?', from:'14:01', to:'18:00' },
    { period:'noite', question:'Como foi seu dia? Bom, médio ou ruim?', from:'18:01', to:'23:59' },
  ];
  for (const q of qs) {
    await pool.query(
      'INSERT INTO daily_questions (id,period,question,active,available_from,available_to) VALUES ($1,$2,$3,1,$4,$5)',
      [uuidv4(),q.period,q.question,q.from,q.to]
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

async function seedPedroCommunity(pool) {
  const { v4: uuidv4 } = require('uuid');
  const { rows } = await pool.query("SELECT id FROM communities WHERE name='Eu amo o Pedro Daily' LIMIT 1");
  if (rows.length) return;
  const SYSTEM = 'system-daily';
  const commId = 'comm-pedro-daily-oficial';
  await pool.query(`INSERT INTO communities (id,name,description,type,is_open,owner_id,created_at)
    VALUES ($1,$2,$3,'interest',true,$4,NOW()) ON CONFLICT(id) DO NOTHING`,
    [commId, 'Eu amo o Pedro Daily', 'Comunidade oficial dos fãs do Pedro, o gato laranja mascote do Daily! 🐱🧡', SYSTEM]);
  await pool.query(`INSERT INTO community_members (id,community_id,user_id,role) VALUES ($1,$2,$3,'member') ON CONFLICT DO NOTHING`,
    [uuidv4(), commId, SYSTEM]);
  console.log('   🐱 Comunidade do Pedro criada!');
}

module.exports = { initDB, getDB };
