// ═══════════════════════════════════════════════════════════════
// DAILYS — fotos efêmeras entre amigos (estilo Snapchat clássico)
//   • o remetente manda uma foto (com texto escrito nela) para amigos
//   • o destinatário abre UMA vez e tem DURATION segundos para ver
//   • cada segundo realmente visto vira 1 ponto para quem enviou
//   • depois de visto (ou 24h sem abrir) a imagem é APAGADA do Cloudinary
//     — o banco guarda só números (poucos bytes por Daily)
// ═══════════════════════════════════════════════════════════════
const express = require('express');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');
const { createNotification } = require('./notif_helper');
const { USE_CLOUDINARY } = require('./cloudinary');

const cloudinary = USE_CLOUDINARY ? require('cloudinary').v2 : null;
const router = express.Router();

const DAILY_DURATION_SEC = 20;       // tempo que o amigo tem para ver
const PENDING_TTL_HOURS  = 24;       // Daily não aberto expira depois disso
const MAX_RECIPIENTS     = 100;
const MAX_PER_HOUR       = 40;       // anti-spam por remetente
const KEEP_ROWS_DAYS     = 30;       // linhas (sem imagem) são limpas depois disso

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

// ───────────────────────── banco ─────────────────────────
async function initDailysDB() {
  const pool = getDB().pool;
  const run = async (sql) => { try { await pool.query(sql); } catch (e) { console.error('[dailys] init:', e.message); } };
  await run(`CREATE TABLE IF NOT EXISTS dailys (
    id TEXT PRIMARY KEY,
    sender_id TEXT NOT NULL,
    image_url TEXT DEFAULT '',
    image_ref TEXT DEFAULT '',
    duration_sec INTEGER NOT NULL DEFAULT ${DAILY_DURATION_SEC},
    created_at TIMESTAMPTZ DEFAULT NOW(),
    image_deleted_at TIMESTAMPTZ
  )`);
  await run(`CREATE TABLE IF NOT EXISTS daily_recipients (
    daily_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    opened_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    seconds_viewed INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (daily_id, user_id)
  )`);
  await run(`CREATE TABLE IF NOT EXISTS daily_stats (
    user_id TEXT PRIMARY KEY,
    dailys_sent INTEGER NOT NULL DEFAULT 0,
    seconds_viewed INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await run(`CREATE INDEX IF NOT EXISTS idx_daily_rcp_user ON daily_recipients(user_id, status)`);
  await run(`CREATE INDEX IF NOT EXISTS idx_dailys_sender ON dailys(sender_id, created_at)`);

  if (!global.__dailysCleanupTimer) {
    global.__dailysCleanupTimer = setInterval(runCleanup, 60 * 1000);
    setTimeout(runCleanup, 5000);
  }
  console.log('  ✓ dailys DB inicializado');
}

// ───────────────────────── imagem ─────────────────────────
async function storeImage(buffer) {
  const id = uuidv4();
  if (USE_CLOUDINARY) {
    return await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: 'daily/dailys',
          public_id: id,
          resource_type: 'image',
          transformation: [{ width: 1080, height: 1920, crop: 'limit', quality: 'auto' }],
        },
        (err, result) => err ? reject(err) : resolve({ url: result.secure_url, ref: result.public_id })
      );
      stream.end(buffer);
    });
  }
  const dir = path.join(__dirname, 'uploads', 'dailys');
  fs.mkdirSync(dir, { recursive: true });
  const filename = `${id}.jpg`;
  fs.writeFileSync(path.join(dir, filename), buffer);
  return { url: `/uploads/dailys/${filename}`, ref: `local:${filename}` };
}

async function destroyImage(ref) {
  if (!ref) return;
  try {
    if (ref.startsWith('local:')) {
      const f = path.join(__dirname, 'uploads', 'dailys', ref.slice(6));
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } else if (USE_CLOUDINARY) {
      await cloudinary.uploader.destroy(ref, { invalidate: true });
    }
  } catch (e) { console.error('[dailys] destroyImage:', e.message); }
}

// Apaga a imagem quando ninguém mais pode ver (todos abriram e fecharam, ou expirou)
async function sweepImages(onlyDailyId) {
  const db = getDB();
  const rows = await db.prepare(`
    SELECT d.id, d.image_ref FROM dailys d
    WHERE d.image_deleted_at IS NULL
      ${onlyDailyId ? 'AND d.id = $1' : ''}
      AND NOT EXISTS (
        SELECT 1 FROM daily_recipients r
        WHERE r.daily_id = d.id
          AND (r.status = 'sent' OR (r.status = 'opened' AND r.closed_at IS NULL))
      )
    LIMIT 50
  `).all(...(onlyDailyId ? [onlyDailyId] : []));
  for (const d of rows) {
    await destroyImage(d.image_ref);
    await db.prepare("UPDATE dailys SET image_deleted_at = NOW(), image_url = '', image_ref = '' WHERE id = $1").run(d.id);
  }
}

async function addViewToStats(senderId, seconds) {
  await getDB().prepare(`
    INSERT INTO daily_stats (user_id, dailys_sent, seconds_viewed, views, updated_at)
    VALUES ($1, 0, $2, 1, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      seconds_viewed = daily_stats.seconds_viewed + EXCLUDED.seconds_viewed,
      views = daily_stats.views + 1,
      updated_at = NOW()
  `).run(senderId, seconds);
}

// ───────────────────────── limpeza periódica ─────────────────────────
async function runCleanup() {
  try {
    const db = getDB();
    // 1. Dailys não abertos em 24h → expirados
    const exp = await db.prepare(`
      UPDATE daily_recipients SET status = 'expired'
      WHERE status = 'sent'
        AND daily_id IN (SELECT id FROM dailys WHERE created_at < NOW() - INTERVAL '${PENDING_TTL_HOURS} hours')
    `).run();
    // 2. Abertos mas nunca fechados (app fechou/caiu): conta a visualização, sem pontos
    const stale = await db.prepare(`
      UPDATE daily_recipients r SET closed_at = NOW(), seconds_viewed = 0
      FROM dailys d
      WHERE d.id = r.daily_id AND r.status = 'opened' AND r.closed_at IS NULL
        AND r.opened_at < NOW() - ((d.duration_sec + 30) * INTERVAL '1 second')
      RETURNING d.sender_id
    `).all();
    for (const s of stale) await addViewToStats(s.sender_id, 0);
    // 3. Apaga imagens que ninguém mais pode ver
    await sweepImages();
    // 4. Limpa linhas antigas (a imagem já foi apagada; só sobram contadores)
    await db.prepare(`
      DELETE FROM daily_recipients WHERE daily_id IN (
        SELECT id FROM dailys WHERE created_at < NOW() - INTERVAL '${KEEP_ROWS_DAYS} days' AND image_deleted_at IS NOT NULL)
    `).run();
    await db.prepare(`DELETE FROM dailys WHERE created_at < NOW() - INTERVAL '${KEEP_ROWS_DAYS} days' AND image_deleted_at IS NOT NULL`).run();
    if ((exp?.changes || 0) + stale.length > 0) console.log(`[dailys] limpeza: ${exp?.changes || 0} expirados, ${stale.length} sem fechamento`);
  } catch (e) { console.error('[dailys] cleanup erro:', e.message); }
}

// ───────────────────────── helpers ─────────────────────────
const PEDRO_ID = 'pedro-official-daily'; // bot mascote: nunca abre Daily, não entra como destinatário

async function friendIds(userId) {
  const rows = await getDB().prepare(`
    SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END AS fid
    FROM friendships
    WHERE status = 'accepted' AND (requester_id = $1 OR addressee_id = $1)
  `).all(userId);
  return [...new Set(rows.map(r => r.fid))].filter(id => id !== PEDRO_ID);
}

// ───────────────────────── rotas ─────────────────────────

// POST /api/dailys — enviar um Daily (multipart: photo + recipients[JSON])
router.post('/', authMiddleware, upload.single('photo'), async (req, res) => {
  try {
    const db = getDB();
    if (!req.file) return res.status(400).json({ error: 'Foto obrigatória' });
    if (!/^image\//.test(req.file.mimetype)) return res.status(400).json({ error: 'Arquivo precisa ser imagem' });

    let wanted = [];
    try { wanted = JSON.parse(req.body.recipients || '[]'); } catch { wanted = []; }
    if (!Array.isArray(wanted)) wanted = [];
    wanted = [...new Set(wanted.map(String))].filter(id => id !== req.user.id).slice(0, MAX_RECIPIENTS);
    if (!wanted.length) return res.status(400).json({ error: 'Escolha pelo menos um amigo' });

    const friends = new Set(await friendIds(req.user.id));
    const recipients = wanted.filter(id => friends.has(id));
    if (!recipients.length) return res.status(400).json({ error: 'Só é possível mandar para amigos' });

    const recent = await db.prepare(
      "SELECT COUNT(*) AS c FROM dailys WHERE sender_id = $1 AND created_at > NOW() - INTERVAL '1 hour'"
    ).get(req.user.id);
    if (parseInt(recent?.c || 0) >= MAX_PER_HOUR) return res.status(429).json({ error: 'Muitos Dailys em pouco tempo. Respire e tente daqui a pouco.' });

    const img = await storeImage(req.file.buffer);
    const id = uuidv4();
    await db.prepare('INSERT INTO dailys (id, sender_id, image_url, image_ref, duration_sec) VALUES ($1,$2,$3,$4,$5)')
      .run(id, req.user.id, img.url, img.ref, DAILY_DURATION_SEC);
    for (const uid of recipients) {
      await db.prepare('INSERT INTO daily_recipients (daily_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING').run(id, uid);
    }
    await db.prepare(`
      INSERT INTO daily_stats (user_id, dailys_sent, updated_at) VALUES ($1, 1, NOW())
      ON CONFLICT (user_id) DO UPDATE SET dailys_sent = daily_stats.dailys_sent + 1, updated_at = NOW()
    `).run(req.user.id);

    res.json({ ok: true, id, recipients: recipients.length });

    // Notificações (não bloqueiam a resposta)
    (async () => {
      try {
        const sender = await db.prepare('SELECT name FROM users WHERE id = $1').get(req.user.id);
        for (const uid of recipients) {
          await createNotification(db, {
            userId: uid, fromUserId: req.user.id, type: 'daily_received',
            title: `${sender?.name || 'Alguém'} mandou um Daily 📸`,
            body: `Toque para ver — você terá ${DAILY_DURATION_SEC}s e ele some.`,
            data: { daily_id: id, push_url: (process.env.SITE_URL || '') + '/?tab=dailys' },
          }).catch(e => console.error('[dailys] notif:', e.message));
        }
      } catch (e) { console.error('[dailys] notificar:', e.message); }
    })();
  } catch (e) {
    console.error('[dailys] enviar:', e.message);
    res.status(500).json({ error: 'Não foi possível enviar o Daily' });
  }
});

// GET /api/dailys/inbox — Dailys recebidos ainda não abertos
router.get('/inbox', authMiddleware, async (req, res) => {
  try {
    const dailys = await getDB().prepare(`
      SELECT d.id, d.duration_sec, d.created_at,
             u.id AS sender_id, u.name, u.username, u.avatar_url
      FROM daily_recipients r
      JOIN dailys d ON d.id = r.daily_id
      JOIN users u ON u.id = d.sender_id
      WHERE r.user_id = $1 AND r.status = 'sent'
        AND d.created_at > NOW() - INTERVAL '${PENDING_TTL_HOURS} hours'
        AND d.image_deleted_at IS NULL
      ORDER BY d.created_at DESC LIMIT 100
    `).all(req.user.id);
    res.json({ dailys });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/dailys/sent — o que eu mandei (últimos 7 dias) e como foi visto
router.get('/sent', authMiddleware, async (req, res) => {
  try {
    const rows = await getDB().prepare(`
      SELECT d.id, d.created_at, d.duration_sec,
             u.id AS user_id, u.name, u.username, u.avatar_url,
             r.status, r.seconds_viewed, r.closed_at
      FROM dailys d
      JOIN daily_recipients r ON r.daily_id = d.id
      JOIN users u ON u.id = r.user_id
      WHERE d.sender_id = $1 AND d.created_at > NOW() - INTERVAL '7 days'
      ORDER BY d.created_at DESC LIMIT 400
    `).all(req.user.id);
    const map = new Map();
    for (const r of rows) {
      if (!map.has(r.id)) map.set(r.id, { id: r.id, created_at: r.created_at, duration_sec: r.duration_sec, recipients: [] });
      map.get(r.id).recipients.push({
        user_id: r.user_id, name: r.name, username: r.username, avatar_url: r.avatar_url,
        status: r.status, seconds_viewed: r.seconds_viewed, closed: !!r.closed_at,
      });
    }
    res.json({ dailys: [...map.values()] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/dailys/stats/:userId — contadores (use "me" para o próprio)
router.get('/stats/:userId', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const uid = req.params.userId === 'me' ? req.user.id : req.params.userId;
    const s = await db.prepare('SELECT dailys_sent, seconds_viewed, views FROM daily_stats WHERE user_id = $1').get(uid)
      || { dailys_sent: 0, seconds_viewed: 0, views: 0 };
    let rank = null;
    if (s.seconds_viewed > 0) {
      const r = await db.prepare('SELECT COUNT(*) AS c FROM daily_stats WHERE seconds_viewed > $1').get(s.seconds_viewed);
      rank = parseInt(r?.c || 0) + 1;
    }
    res.json({ dailys_sent: s.dailys_sent, seconds_viewed: s.seconds_viewed, views: s.views, rank });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/dailys/ranking?period=week|all&scope=all|friends
router.get('/ranking', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const period = req.query.period === 'all' ? 'all' : 'week';
    let ids = null;
    if (req.query.scope === 'friends') ids = [...await friendIds(req.user.id), req.user.id];

    let rows;
    if (period === 'all') {
      rows = await db.prepare(`
        SELECT s.user_id, s.seconds_viewed, s.dailys_sent, u.name, u.username, u.avatar_url
        FROM daily_stats s JOIN users u ON u.id = s.user_id
        WHERE s.seconds_viewed > 0 ${ids ? 'AND s.user_id = ANY($1::text[])' : ''}
        ORDER BY s.seconds_viewed DESC LIMIT 50
      `).all(...(ids ? [ids] : []));
    } else {
      rows = await db.prepare(`
        SELECT d.sender_id AS user_id, SUM(r.seconds_viewed)::int AS seconds_viewed,
               COUNT(DISTINCT d.id)::int AS dailys_sent, u.name, u.username, u.avatar_url
        FROM daily_recipients r
        JOIN dailys d ON d.id = r.daily_id
        JOIN users u ON u.id = d.sender_id
        WHERE r.closed_at > NOW() - INTERVAL '7 days' AND r.seconds_viewed > 0
          ${ids ? 'AND d.sender_id = ANY($1::text[])' : ''}
        GROUP BY d.sender_id, u.name, u.username, u.avatar_url
        ORDER BY seconds_viewed DESC LIMIT 50
      `).all(...(ids ? [ids] : []));
    }
    res.json({ period, ranking: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/dailys/:id/open — abre UMA vez; devolve a imagem e inicia o relógio
router.post('/:id/open', authMiddleware, async (req, res) => {
  try {
    const row = await getDB().prepare(`
      UPDATE daily_recipients r SET status = 'opened', opened_at = NOW()
      FROM dailys d
      WHERE r.daily_id = $1 AND r.user_id = $2 AND r.status = 'sent'
        AND d.id = r.daily_id AND d.image_deleted_at IS NULL
        AND d.created_at > NOW() - INTERVAL '${PENDING_TTL_HOURS} hours'
      RETURNING d.image_url, d.duration_sec, d.sender_id
    `).get(req.params.id, req.user.id);
    if (!row) return res.status(410).json({ error: 'Esse Daily já foi visto ou expirou' });
    const sender = await getDB().prepare('SELECT id, name, username, avatar_url FROM users WHERE id = $1').get(row.sender_id);
    res.json({ image_url: row.image_url, duration_sec: row.duration_sec, sender });
  } catch (e) { console.error('[dailys] open:', e.message); res.status(500).json({ error: e.message }); }
});

// POST /api/dailys/:id/close { seconds } — fecha e pontua quem enviou
router.post('/:id/close', authMiddleware, async (req, res) => {
  try {
    let secs = parseInt(req.body?.seconds, 10);
    if (!Number.isFinite(secs) || secs < 0) secs = 0;
    secs = Math.min(secs, 120);
    const row = await getDB().prepare(`
      UPDATE daily_recipients r SET closed_at = NOW(),
        seconds_viewed = GREATEST(0, LEAST($3::int, d.duration_sec,
          CEIL(EXTRACT(EPOCH FROM (NOW() - r.opened_at)))::int + 1))
      FROM dailys d
      WHERE r.daily_id = $1 AND r.user_id = $2 AND r.status = 'opened' AND r.closed_at IS NULL
        AND d.id = r.daily_id
      RETURNING r.seconds_viewed, d.sender_id, d.id AS daily_id
    `).get(req.params.id, req.user.id, secs);
    if (!row) return res.json({ ok: true, seconds: 0 });
    await addViewToStats(row.sender_id, row.seconds_viewed);
    sweepImages(row.daily_id).catch(e => console.error('[dailys] sweep:', e.message));
    res.json({ ok: true, seconds: row.seconds_viewed });
  } catch (e) { console.error('[dailys] close:', e.message); res.status(500).json({ error: e.message }); }
});

module.exports = { router, initDailysDB, runCleanup };
