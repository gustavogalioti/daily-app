/**
 * DAILY — Aniversariantes
 * Scheduler 6h + API para aba de aniversariantes na NEWS
 */
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware, optionalAuth } = require('./authmiddleware');

// ─── TABELAS ─────────────────────────────────────────────────────────────────
async function initBirthdayTables() {
  const db = getDB();
  await db.prepare(`CREATE TABLE IF NOT EXISTS birthday_photos (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    image_url TEXT NOT NULL,
    caption TEXT,
    birth_date TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS birthday_wishes (
    id TEXT PRIMARY KEY,
    to_user_id TEXT NOT NULL,
    from_user_id TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).run();

  // Marcar quando Pedro já postou para não repetir no dia
  await db.prepare(`CREATE TABLE IF NOT EXISTS birthday_pedro_posts (
    id TEXT PRIMARY KEY,
    date_str TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).run();
}

initBirthdayTables().catch(e => console.error('[Birthdays] Init:', e.message));

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function todayMMDD() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}-${dd}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ─── GET /api/birthdays/today — aniversariantes do dia ───────────────────────
router.get('/today', async (req, res) => {
  try {
    const db   = getDB();
    const mmdd = todayMMDD();
    // birth_date salvo como YYYY-MM-DD ou DD/MM/YYYY
    const users = await db.prepare(`
      SELECT id, name, username, avatar_url, birth_date
      FROM users
      WHERE birth_date IS NOT NULL
        AND (
          SUBSTRING(birth_date, 6, 5) = $1    -- YYYY-MM-DD → pega MM-DD
          OR SUBSTRING(birth_date, 1, 5) = $2  -- MM-DD-YYYY
        )
      ORDER BY name ASC
    `).all(mmdd, mmdd);
    res.json({ users, date: todayStr(), mmdd });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── GET /api/birthdays/photos — fotos dos aniversariantes de hoje ───────────
router.get('/photos', async (req, res) => {
  try {
    const db   = getDB();
    const mmdd = todayMMDD();
    const photos = await db.prepare(`
      SELECT bp.*, u.name AS author_name, u.username AS author_username, u.avatar_url AS author_avatar
      FROM birthday_photos bp
      JOIN users u ON u.id = bp.user_id
      WHERE bp.birth_date = $1
      ORDER BY bp.created_at DESC
    `).all(mmdd);
    res.json({ photos });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── POST /api/birthdays/photos — aniversariante posta foto ──────────────────
router.post('/photos', authMiddleware, async (req, res) => {
  try {
    const db   = getDB();
    const mmdd = todayMMDD();
    // Verificar se é aniversariante hoje
    const user = await db.prepare('SELECT birth_date FROM users WHERE id=$1').get(req.user.id);
    const bd   = user?.birth_date || '';
    const isBirthday = bd.includes(mmdd) || bd.slice(5, 10) === mmdd;
    if (!isBirthday) return res.status(403).json({ error: 'Apenas aniversariantes podem postar aqui hoje!' });

    const { image_url, caption } = req.body;
    if (!image_url) return res.status(400).json({ error: 'Imagem obrigatória' });

    const id = uuidv4();
    await db.prepare(`
      INSERT INTO birthday_photos (id, user_id, image_url, caption, birth_date)
      VALUES ($1,$2,$3,$4,$5)
    `).run(id, req.user.id, image_url, caption || '', mmdd);
    res.json({ ok: true, id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── GET /api/birthdays/wishes/:userId — parabéns para um usuário ────────────
router.get('/wishes/:userId', async (req, res) => {
  try {
    const db = getDB();
    const wishes = await db.prepare(`
      SELECT bw.*, u.name AS from_name, u.username AS from_username, u.avatar_url AS from_avatar
      FROM birthday_wishes bw
      JOIN users u ON u.id = bw.from_user_id
      WHERE bw.to_user_id = $1
        AND DATE(bw.created_at) = CURRENT_DATE
      ORDER BY bw.created_at DESC
    `).all(req.params.userId);
    res.json({ wishes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── POST /api/birthdays/wishes — deseja parabéns ────────────────────────────
router.post('/wishes', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { to_user_id, message } = req.body;
    if (!to_user_id || !message?.trim()) return res.status(400).json({ error: 'Dados inválidos' });

    // Anti-spam: 1 mensagem por par por dia
    const existing = await db.prepare(`
      SELECT id FROM birthday_wishes
      WHERE to_user_id=$1 AND from_user_id=$2 AND DATE(created_at)=CURRENT_DATE
    `).get(to_user_id, req.user.id);
    if (existing) {
      // Atualizar mensagem existente
      await db.prepare('UPDATE birthday_wishes SET message=$1 WHERE id=$2').run(message.trim(), existing.id);
    } else {
      await db.prepare(`
        INSERT INTO birthday_wishes (id, to_user_id, from_user_id, message) VALUES ($1,$2,$3,$4)
      `).run(uuidv4(), to_user_id, req.user.id, message.trim());
    }

    // Notificação in-app para o aniversariante
    try {
      const from = await db.prepare('SELECT name FROM users WHERE id=$1').get(req.user.id);
      await db.prepare(`
        INSERT INTO user_notifications (id,user_id,type,title,body,url,actor_id,created_at)
        VALUES ($1,$2,'birthday_wish',$3,$4,$5,$6,NOW())
      `).run(
        uuidv4(), to_user_id,
        '🎂 Parabéns!',
        `${from?.name || 'Alguém'} te desejou feliz aniversário! 🎉`,
        '/?tab=news',
        req.user.id
      );
    } catch(e) {}

    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── GET /api/birthdays/chat — chat de parabéns geral do dia ─────────────────
router.get('/chat', async (req, res) => {
  try {
    const db = getDB();
    const msgs = await db.prepare(`
      SELECT bw.id, bw.message, bw.created_at,
             uf.name AS from_name, uf.username AS from_username, uf.avatar_url AS from_avatar,
             ut.name AS to_name, ut.username AS to_username
      FROM birthday_wishes bw
      JOIN users uf ON uf.id = bw.from_user_id
      JOIN users ut ON ut.id = bw.to_user_id
      WHERE DATE(bw.created_at) = CURRENT_DATE
      ORDER BY bw.created_at DESC
      LIMIT 100
    `).all();
    res.json({ messages: msgs });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── SCHEDULER: Pedro anuncia aniversariantes às 6h ──────────────────────────
async function runBirthdayScheduler(db) {
  try {
    const today = todayStr();
    const mmdd  = todayMMDD();

    // Verificar se já rodou hoje
    const already = await db.prepare('SELECT id FROM birthday_pedro_posts WHERE date_str=$1').get(today);
    if (already) return;

    const { v4: uuidv4 } = require('uuid');
    const { sendPushToUser } = require('./notif_service');

    // Buscar aniversariantes
    const bdays = await db.prepare(`
      SELECT id, name, username, avatar_url FROM users
      WHERE birth_date IS NOT NULL
        AND (SUBSTRING(birth_date,6,5)=$1 OR SUBSTRING(birth_date,1,5)=$1)
    `).all(mmdd);

    if (!bdays.length) {
      // Marcar que rodou mesmo sem aniversariantes
      await db.prepare('INSERT INTO birthday_pedro_posts (id,date_str) VALUES ($1,$2) ON CONFLICT DO NOTHING').run(uuidv4(), today);
      return;
    }

    const mentions = bdays.map(u => `@${u.username}`).join(', ');
    const plural   = bdays.length > 1;
    const msgBody  = plural
      ? `🎂 Hoje é dia de celebrar! ${mentions} ${plural ? 'estão' : 'está'} fazendo aniversário! Corre lá dar os parabéns! 🎉🥳`
      : `🎂 Feliz aniversário, ${mentions}! Que seu dia seja especial! 🎉🥳`;

    // Post do Pedro no feed (NEWS)
    await db.prepare(`
      INSERT INTO news (id, title, body, category, source, image_url, created_at)
      VALUES ($1,$2,$3,'birthday','Pedro Daily','/pedro.jpg',NOW())
    `).run(uuidv4(), `🎂 Aniversariantes do dia!`, msgBody);

    // Notificar cada aniversariante
    for (const u of bdays) {
      // In-app
      await db.prepare(`
        INSERT INTO user_notifications (id,user_id,type,title,body,url,actor_id,created_at)
        VALUES ($1,$2,'birthday_self',$3,$4,$5,$6,NOW())
      `).run(
        uuidv4(), u.id,
        '🎂 Feliz Aniversário!',
        'Pedro e toda a DAILY desejam um feliz aniversário! 🎉',
        '/?tab=news',
        u.id
      ).catch(() => {});

      // Push
      sendPushToUser(db, u.id, {
        title: '🎂 Feliz Aniversário!',
        body: 'Pedro e toda a comunidade DAILY celebram com você hoje! 🎉',
        url: '/?tab=news',
        tag: 'birthday',
      }).catch(() => {});

      // Notificar amigos do aniversariante
      const friends = await db.prepare(`
        SELECT CASE WHEN f.user_id=$1 THEN f.friend_id ELSE f.user_id END AS fid
        FROM friends f
        WHERE (f.user_id=$1 OR f.friend_id=$1) AND f.status='accepted'
      `).all(u.id);

      for (const fr of friends) {
        sendPushToUser(db, fr.fid, {
          title: `🎂 ${u.name} está fazendo aniversário!`,
          body: 'Vá lá desejar parabéns na aba Aniversariantes! 🎉',
          url: '/?tab=news',
          tag: `birthday-friend-${u.id}`,
        }).catch(() => {});

        await db.prepare(`
          INSERT INTO user_notifications (id,user_id,type,title,body,url,actor_id,created_at)
          VALUES ($1,$2,'birthday_friend',$3,$4,$5,$6,NOW())
        `).run(
          uuidv4(), fr.fid,
          `🎂 ${u.name} faz aniversário hoje!`,
          'Clique para desejar parabéns na aba Aniversariantes.',
          '/?tab=news',
          u.id
        ).catch(() => {});
      }
    }

    // Marcar como executado
    await db.prepare('INSERT INTO birthday_pedro_posts (id,date_str) VALUES ($1,$2) ON CONFLICT DO NOTHING').run(uuidv4(), today);
    console.log(`[Birthdays] Anunciados ${bdays.length} aniversariantes.`);
  } catch(e) {
    console.error('[Birthdays] Scheduler error:', e.message);
  }
}

module.exports = { router, runBirthdayScheduler };
