const express = require('express');
const router = express.Router();
const { getDB } = require('./database');
const { optionalAuth, requireAuth } = require('./authmiddleware');

// ── Gera textos variados para Pedro ──────────────────────────────────────────
const pedroTexts = {
  record_broken: [
    "Uma nova marca foi estabelecida. Quanto tempo ela irá durar? 🐱",
    "Impressionante! O topo do ranking mudou de dono. Será que fica? 😼",
    "Os grandes feitos merecem ser lembrados. Parabéns ao novo líder! 🏆",
    "O ranking nunca mente — e hoje ele fala um novo nome. 📊",
  ],
  rank_moved: [
    "As posições mudam, as histórias continuam. Isso é DAILY! 😸",
    "Um passo à frente hoje pode virar a liderança de amanhã. 🐾",
    "Quem sobe no ranking escreve seu nome na história da plataforma. ✍️",
  ],
  achievement_milestone: [
    "Cada ponto conquistado conta uma história de dedicação. 🌟",
    "Os maiores percursos começam com os primeiros passos. Continue! 🚀",
    "Conquista registrada. A próxima está mais próxima do que parece. 🎯",
  ],
  anniversary: [
    "O tempo passa, mas as memórias ficam. Obrigado por fazer parte da DAILY! 🧡",
    "Cada dia aqui é parte da nossa história coletiva. Fico feliz por você! 😻",
    "Presença registrada, amizade construída. Bem-vindo ao clube dos veteranos! 🏅",
  ],
  first_post: [
    "Quem acorda cedo tem o dia todo pela frente — e o reconhecimento também! ☀️",
    "O primeiro post do dia abre as portas da DAILY para todos. 🌅",
    "Primeiro a chegar, primeiro a contar. Que o dia seja incrível! 🐱",
  ],
  most_active: [
    "A atividade de hoje foi além do esperado. Inspire outros a fazerem o mesmo! 🔥",
    "Quantidade com qualidade: isso é difícil. E hoje alguém conseguiu. 👏",
    "A DAILY vive de pessoas assim. Obrigado pela energia! 🧡",
  ],
  welcome_new_users: [
    "Cada novo rosto enriquece nossa comunidade. Sejam bem-vindos! 🎉",
    "Novos moradores chegaram à DAILY. Quanto mais, melhor! 🏡",
    "A comunidade cresce, as histórias se multiplicam. Bem-vindos! 🌱",
  ],
  hall_of_fame: [
    "O dia acabou, e os destaques ficaram para a história. Parabéns a todos! 🌟",
    "Cada categoria teve seu campeão hoje. E amanhã? 🏆",
    "O Hall da Fama registra quem fez a diferença. Será você amanhã? 😼",
  ],
  new_friendship: [
    "Conexões reais nascem de interesses comuns. Boa amizade! 🤝",
    "A rede de amigos cresce, e a DAILY fica mais rica. 🧡",
    "Dois perfis, uma conexão. Que venham muitas histórias juntos! 😸",
  ],
  flash: [
    "Os momentos raros merecem destaque especial! ⚡",
    "Isso não acontece todo dia — por isso merece destaque! 🌟",
    "Flash News: quando algo especial acontece, a DAILY registra! 📰",
  ],
};

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Criar notícia (interno) ───────────────────────────────────────────────────
async function createNews(db, {
  category, title, body, pedro_comment = null,
  user_ids = [], is_flash = false, expires_hours = null
}) {
  const { v4: uuidv4 } = require('uuid');
  const id = uuidv4();
  const expiresAt = expires_hours
    ? `NOW() + INTERVAL '${expires_hours} hours'`
    : 'NULL';

  await db.prepare(`
    INSERT INTO news (id, category, title, body, pedro_comment, is_flash, expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,${expires_hours ? `NOW() + INTERVAL '${expires_hours} hours'` : 'NULL'})
  `).run(id, category, title, body, pedro_comment, is_flash);

  // vincular usuários mencionados
  for (const uid of user_ids) {
    await db.prepare(`INSERT INTO news_users (news_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`)
      .run(id, uid);
  }
  return id;
}

// ── Rotas públicas ─────────────────────────────────────────────────────────────

// GET /api/news — feed paginado
router.get('/', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const filter = req.query.filter || 'all'; // all | flash | records | social

    let whereExtra = `AND (n.expires_at IS NULL OR n.expires_at > NOW())`;
    if (filter === 'flash') whereExtra += ` AND n.is_flash = true`;
    else if (filter === 'records') whereExtra += ` AND n.category IN ('record_broken','rank_moved')`;
    else if (filter === 'social') whereExtra += ` AND n.category IN ('new_friendship','welcome_new_users','anniversary','hall_of_fame')`;

    const rows = await db.prepare(`
      SELECT n.*,
        COALESCE(r.likes,0) AS likes,
        COALESCE(c.comments,0) AS comments,
        (SELECT json_agg(json_build_object('id',u.id,'name',u.name,'username',u.username,'avatar',u.avatar_url))
         FROM news_users nu JOIN users u ON u.id=nu.user_id WHERE nu.news_id=n.id) AS mentioned_users
      FROM news n
      LEFT JOIN (SELECT news_id, COUNT(*) likes FROM news_reactions WHERE reaction='like' GROUP BY news_id) r ON r.news_id=n.id
      LEFT JOIN (SELECT news_id, COUNT(*) comments FROM news_comments GROUP BY news_id) c ON c.news_id=n.id
      WHERE 1=1 ${whereExtra}
      ORDER BY n.created_at DESC
      LIMIT $1 OFFSET $2
    `).all(limit, offset);

    // Se usuário logado, adicionar suas reações
    let myReactions = {};
    if (req.user) {
      const reacts = await db.prepare(
        `SELECT news_id, reaction FROM news_reactions WHERE user_id=$1`
      ).all(req.user.id);
      reacts.forEach(r => myReactions[r.news_id] = r.reaction);
    }

    res.json({ news: rows.map(n => ({ ...n, my_reaction: myReactions[n.id] || null })) });
  } catch(e) {
    console.error('news GET:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/news/:id/comments
router.get('/:id/comments', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const rows = await db.prepare(`
      SELECT nc.*, u.name, u.username, u.avatar_url
      FROM news_comments nc JOIN users u ON u.id=nc.user_id
      WHERE nc.news_id=$1 ORDER BY nc.created_at ASC
    `).all(req.params.id);
    res.json({ comments: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/news/:id/comment
router.post('/:id/comment', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Texto obrigatório' });
    const { v4: uuidv4 } = require('uuid');
    await db.prepare(
      `INSERT INTO news_comments (id,news_id,user_id,text) VALUES($1,$2,$3,$4)`
    ).run(uuidv4(), req.params.id, req.user.id, text.trim());
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/news/:id/react
router.post('/:id/react', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const { reaction } = req.body; // 'like' | null
    const existing = await db.prepare(
      `SELECT id FROM news_reactions WHERE news_id=$1 AND user_id=$2`
    ).get(req.params.id, req.user.id);

    if (!reaction) {
      await db.prepare(`DELETE FROM news_reactions WHERE news_id=$1 AND user_id=$2`)
        .run(req.params.id, req.user.id);
    } else if (existing) {
      await db.prepare(`UPDATE news_reactions SET reaction=$1 WHERE news_id=$2 AND user_id=$3`)
        .run(reaction, req.params.id, req.user.id);
    } else {
      const { v4: uuidv4 } = require('uuid');
      await db.prepare(`INSERT INTO news_reactions(id,news_id,user_id,reaction) VALUES($1,$2,$3,$4)`)
        .run(uuidv4(), req.params.id, req.user.id, reaction);
    }

    const count = await db.prepare(
      `SELECT COUNT(*) AS n FROM news_reactions WHERE news_id=$1 AND reaction='like'`
    ).get(req.params.id);
    res.json({ likes: parseInt(count?.n || 0) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Exports para uso interno (schedulers) ─────────────────────────────────────
module.exports = router;
module.exports.createNews = createNews;
module.exports.pedroTexts = pedroTexts;
module.exports.pickRandom = pickRandom;
