const express = require('express');
const router = express.Router();
const { getDB } = require('./database');
const { optionalAuth, requireAuth } = require('./authmiddleware');

// ── Textos variados do Pedro ──────────────────────────────────────────────────
const pedroTexts = {
  record_broken:        ["Uma nova marca foi estabelecida. Quanto tempo ela irá durar? 🐱","Impressionante! O topo do ranking mudou de dono. 😼","Os grandes feitos merecem ser lembrados! 🏆"],
  rank_moved:           ["As posições mudam, as histórias continuam. Isso é DAILY! 😸","Um passo à frente hoje pode virar a liderança de amanhã. 🐾"],
  achievement_milestone:["Cada ponto conquistado conta uma história de dedicação. 🌟","Os maiores percursos começam com os primeiros passos. 🚀"],
  anniversary:          ["O tempo passa, mas as memórias ficam. Obrigado por fazer parte da DAILY! 🧡","Presença registrada, amizade construída. 😻"],
  first_post:           ["Quem acorda cedo tem o dia todo pela frente! ☀️","O primeiro post do dia abre as portas da DAILY para todos. 🌅"],
  most_active:          ["A atividade de hoje foi além do esperado. Inspire outros! 🔥","A DAILY vive de pessoas assim. Obrigado pela energia! 🧡"],
  welcome_new_users:    ["Cada novo rosto enriquece nossa comunidade. Sejam bem-vindos! 🎉","A comunidade cresce, as histórias se multiplicam. 🌱"],
  hall_of_fame:         ["O dia acabou, e os destaques ficaram para a história. 🌟","O Hall da Fama registra quem fez a diferença. 🏆"],
  new_friendship:       ["Conexões reais nascem de interesses comuns. Boa amizade! 🤝","A rede de amigos cresce, e a DAILY fica mais rica. 🧡"],
  flash:                ["Os momentos raros merecem destaque especial! ⚡","Flash News: quando algo especial acontece, a DAILY registra! 📰"],
};
function pickRandom(arr) { return arr[Math.floor(Math.random()*arr.length)]; }

// ── Criar notícia (uso interno) ───────────────────────────────────────────────
async function createNews(db, { category, title, body, pedro_comment=null, user_ids=[], is_flash=false, expires_hours=null }) {
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  const expiresSQL = expires_hours ? `NOW() + INTERVAL '${parseInt(expires_hours)} hours'` : 'NULL';
  await db.pool.query(
    `INSERT INTO news (id,category,title,body,pedro_comment,is_flash,expires_at) VALUES ($1,$2,$3,$4,$5,$6,${expiresSQL})`,
    [id, category, title, body, pedro_comment, is_flash]
  );
  for (const uid of user_ids) {
    try {
      await db.pool.query(`INSERT INTO news_users(news_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING`, [id, uid]);
    } catch(e) {}
  }
  return id;
}

// ── GET /api/news ─────────────────────────────────────────────────────────────
router.get('/', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const page  = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;
    const filter = req.query.filter || 'all';

    let extra = `AND (n.expires_at IS NULL OR n.expires_at > NOW())`;
    if (filter === 'flash')   extra += ` AND n.is_flash = true`;
    if (filter === 'records') extra += ` AND n.category IN ('record_broken','rank_moved')`;
    if (filter === 'social')  extra += ` AND n.category IN ('new_friendship','welcome_new_users','anniversary','hall_of_fame','first_post','most_active')`;

    const { rows } = await db.pool.query(`
      SELECT
        n.*,
        COALESCE(r.likes,0)    AS likes,
        COALESCE(c.total,0)    AS comments
      FROM news n
      LEFT JOIN (SELECT news_id, COUNT(*) likes FROM news_reactions WHERE reaction='like' GROUP BY news_id) r ON r.news_id=n.id
      LEFT JOIN (SELECT news_id, COUNT(*) total FROM news_comments GROUP BY news_id) c ON c.news_id=n.id
      WHERE 1=1 ${extra}
      ORDER BY n.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    // usuários mencionados por notícia
    let newsIds = rows.map(r => r.id);
    let mentionMap = {};
    if (newsIds.length > 0) {
      const { rows: ments } = await db.pool.query(
        `SELECT nu.news_id, u.id, u.name, u.username, u.avatar_url
         FROM news_users nu JOIN users u ON u.id=nu.user_id
         WHERE nu.news_id = ANY($1)`, [newsIds]
      );
      ments.forEach(m => {
        if (!mentionMap[m.news_id]) mentionMap[m.news_id] = [];
        mentionMap[m.news_id].push({ id:m.id, name:m.name, username:m.username, avatar:m.avatar_url });
      });
    }

    // reações do usuário logado
    let myReactions = {};
    if (req.user && newsIds.length > 0) {
      const { rows: reacts } = await db.pool.query(
        `SELECT news_id, reaction FROM news_reactions WHERE user_id=$1 AND news_id=ANY($2)`,
        [req.user.id, newsIds]
      );
      reacts.forEach(r => myReactions[r.news_id] = r.reaction);
    }

    const news = rows.map(n => ({
      ...n,
      mentioned_users: mentionMap[n.id] || [],
      my_reaction: myReactions[n.id] || null,
    }));

    res.json({ news });
  } catch(e) {
    console.error('news GET error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/news/:id/comments ────────────────────────────────────────────────
router.get('/:id/comments', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const { rows } = await db.pool.query(
      `SELECT nc.*, u.name, u.username, u.avatar_url
       FROM news_comments nc JOIN users u ON u.id=nc.user_id
       WHERE nc.news_id=$1 ORDER BY nc.created_at ASC`,
      [req.params.id]
    );
    res.json({ comments: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/news/:id/comment ────────────────────────────────────────────────
router.post('/:id/comment', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Texto obrigatório' });
    const { v4: uuidv4 } = require('uuid');
    await db.pool.query(
      `INSERT INTO news_comments(id,news_id,user_id,text) VALUES($1,$2,$3,$4)`,
      [uuidv4(), req.params.id, req.user.id, text.trim()]
    );
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── POST /api/news/:id/react ──────────────────────────────────────────────────
router.post('/:id/react', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const { reaction } = req.body;
    if (!reaction) {
      await db.pool.query(`DELETE FROM news_reactions WHERE news_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    } else {
      await db.pool.query(
        `INSERT INTO news_reactions(id,news_id,user_id,reaction) VALUES($1,$2,$3,$4)
         ON CONFLICT(news_id,user_id) DO UPDATE SET reaction=EXCLUDED.reaction`,
        [require('uuid').v4(), req.params.id, req.user.id, reaction]
      );
    }
    const { rows } = await db.pool.query(
      `SELECT COUNT(*) AS n FROM news_reactions WHERE news_id=$1 AND reaction='like'`, [req.params.id]
    );
    res.json({ likes: parseInt(rows[0]?.n || 0) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.createNews   = createNews;
module.exports.pedroTexts   = pedroTexts;
module.exports.pickRandom   = pickRandom;
