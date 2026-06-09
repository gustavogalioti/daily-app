const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');
const { createPhotoUpload, getUploadedUrl } = require('./cloudinary');
const { createNotification } = require('./notif_helper');

const router = express.Router();

// ═══ PEDRO IA — EVENTOS ═══
const PEDRO_EVENT_PHRASES = {
  post_text: [
    "Li e fiquei pensativo 🤔🧡 Evento bom começa com boa conversa!",
    "Anotei mentalmente! Minha memória é de 3 segundos mas valeu! 😹",
    "Que post! Estou ronronando de entusiasmo pelo evento! 😻",
    "Boa! Continua animado porque esse evento vai ser incrível! 🎉🐾",
    "Vi isso aqui da janela e aprovei com a patinha! ✅🐱",
  ],
  post_photo: [
    "Que foto! Esse evento tá prometendo demais! 📸🧡",
    "Fui lá e cheirei a tela — aprovado! O evento vai ser top! 😂🐾",
    "Foto no evento! Queria ter ido mas gatos não saem muito 😅🐱",
    "Isso sim é conteúdo de qualidade! O evento tá arrasando! 🏆🐾",
  ],
  hype_member: [
    "Ei {name}! 👋 Tá animado pro evento? Eu tô que não caibo na pele! 🎉🐱",
    "{name}! Você vai aparecer? O evento tá promeeeetendo! 🥳🐾",
    "Oi {name}! 🧡 Lembra do evento! Vai ser incrível, prometo com a patinha! 🐾",
    "{name}! Prepara o look porque esse evento vai ser ÉPICO! 😸🎊",
    "Ei {name}! 🐱 Não falta não! Já reservei seu lugarzinho (mentira, mas vai lá!) 😂",
  ],
  event_soon: [
    "O evento tá chegando! Estou me preparando com um belo cochilo preventivo 😴🐱",
    "Faltam poucos dias! Já tô ensaiando minha entrada triunfal felina! 😸🎉",
    "Contagem regressiva iniciada! Quem tá animado dá um 🐾 aqui!",
    "Ei galera! O evento tá pertinho! Prepara o coração porque vai ser demais! 🧡🎊",
  ],
};

function getPedroEventPhrase(type, name='') {
  const pool = PEDRO_EVENT_PHRASES[type] || PEDRO_EVENT_PHRASES.post_text;
  const msg = pool[Math.floor(Math.random() * pool.length)];
  return msg.replace('{name}', name);
}

async function pedroCommentOnEventPost(postId, eventId, postType='text') {
  try {
    const db = getDB();
    // Verificar se Pedro já comentou nesse post
    const existing = await db.prepare(
      'SELECT id FROM event_post_comments WHERE post_id=$1 AND user_id=$2'
    ).get(postId, 'pedro-official-daily');
    if (existing) return;
    const phrase = getPedroEventPhrase(postType === 'photo' ? 'post_photo' : 'post_text');
    await db.prepare(
      'INSERT INTO event_post_comments (id,post_id,event_id,user_id,content) VALUES ($1,$2,$3,$4,$5)'
    ).run(uuidv4(), postId, eventId, 'pedro-official-daily', phrase);
  } catch(e) { /* silencioso */ }
}

async function pedroHypeMembers(eventId) {
  try {
    const db = getDB();
    // Pegar até 2 membros confirmados aleatórios (exceto o Pedro)
    const members = await db.prepare(`
      SELECT u.id, u.name FROM event_members em
      JOIN users u ON u.id = em.user_id
      WHERE em.event_id=$1 AND em.status='accepted' AND em.user_id != $2
      ORDER BY RANDOM() LIMIT 2
    `).all(eventId, 'pedro-official-daily');
    if (!members.length) return;
    // Pegar o post mais recente do evento para comentar
    const post = await db.prepare(
      'SELECT id FROM event_posts WHERE event_id=$1 ORDER BY created_at DESC LIMIT 1'
    ).get(eventId);
    if (!post) return;
    for (const m of members) {
      const phrase = getPedroEventPhrase('hype_member', m.name.split(' ')[0]);
      await db.prepare(
        'INSERT INTO event_post_comments (id,post_id,event_id,user_id,content) VALUES ($1,$2,$3,$4,$5)'
      ).run(uuidv4(), post.id, eventId, 'pedro-official-daily', phrase);
    }
  } catch(e) { /* silencioso */ }
}


// GET /api/events — listar eventos do usuário
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const events = await db.prepare(`
      SELECT e.*, u.name as creator_name,
        em.status as my_status,
        (SELECT COUNT(*) FROM event_members WHERE event_id=e.id AND status='accepted') as confirmed_count
      FROM events e
      JOIN users u ON u.id=e.owner_id
      LEFT JOIN event_members em ON em.event_id=e.id AND em.user_id=$1
      WHERE e.owner_id=$1 OR em.user_id=$1
      ORDER BY e.event_date ASC
    `).all(req.user.id);
    res.json({ events });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/events/invites/pending
router.get('/invites/pending', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const invites = await db.prepare(`
      SELECT e.*, em.status, u.name as creator_name
      FROM events e
      JOIN event_members em ON em.event_id=e.id
      JOIN users u ON u.id=e.owner_id
      WHERE em.user_id=$1 AND em.status='pending'
      ORDER BY e.event_date ASC
    `).all(req.user.id);
    res.json({ invites });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/events/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const event = await db.prepare(`
      SELECT e.*, u.name as creator_name, u.username as creator_username, u.avatar_url as creator_avatar,
        em2.status as my_status
      FROM events e JOIN users u ON u.id=e.owner_id
      LEFT JOIN event_members em2 ON em2.event_id=e.id AND em2.user_id=$2
      WHERE e.id=$1
    `).get(req.params.id, req.user.id);
    if (!event) return res.status(404).json({ error: 'Evento não encontrado' });

    const isMember = event.owner_id === req.user.id || event.my_status;
    if (!isMember) return res.status(403).json({ error: 'Você não foi convidado para este evento' });

    const members = await db.prepare(`
      SELECT em.*, u.name, u.username, u.avatar_url
      FROM event_members em JOIN users u ON u.id=em.user_id
      WHERE em.event_id=$1 ORDER BY em.status ASC, em.created_at ASC
    `).all(req.params.id);

    const posts = await db.prepare(`
      SELECT ep.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar,
        (SELECT COUNT(*) FROM event_post_comments WHERE post_id=ep.id) as comment_count
      FROM event_posts ep JOIN users u ON u.id=ep.user_id
      WHERE ep.event_id=$1 ORDER BY ep.created_at DESC LIMIT 50
    `).all(req.params.id);

    for (const p of posts) {
      p.reactions = await db.prepare(
        'SELECT emoji, COUNT(*) as count FROM event_post_reactions WHERE post_id=$1 GROUP BY emoji'
      ).all(p.id);
      const pc = await db.prepare('SELECT content FROM pedro_comments WHERE post_id=$1').get(p.id);
      p.pedro_comment = pc?.content || null;
    }

    res.json({ event, members, posts, is_owner: event.owner_id === req.user.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/events — criar evento
router.post('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { title, description, location, event_date, event_end_date } = req.body;
    if (!title || !event_date) return res.status(400).json({ error: 'Título e data obrigatórios' });
    const id = uuidv4();
    await db.prepare(`INSERT INTO events (id,title,description,location,event_date,event_end_date,owner_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`)
      .run(id, title.trim(), description||'', location||'', event_date, event_end_date||null, req.user.id);
    // Dono entra automaticamente
    await db.prepare('INSERT INTO event_members (id,event_id,user_id,status) VALUES ($1,$2,$3,$4)')
      .run(uuidv4(), id, req.user.id, 'accepted');
    const event = await db.prepare('SELECT * FROM events WHERE id=$1').get(id);
    res.status(201).json({ event });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/events/:id/cover — foto de capa
router.post('/:id/cover', authMiddleware, (req, res, next) => {
  createPhotoUpload().single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const db = getDB();
      const event = await db.prepare('SELECT * FROM events WHERE id=$1').get(req.params.id);
      if (!event) return res.status(404).json({ error: 'Evento não encontrado' });
      if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });
      if (!req.file) return res.status(400).json({ error: 'Foto obrigatória' });
      const cover_url = getUploadedUrl(req, req.file);
      await db.prepare('UPDATE events SET cover_url=$1 WHERE id=$2').run(cover_url, req.params.id);
      res.json({ cover_url });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
});

// POST /api/events/:id/invite — convidar usuário
router.post('/:id/invite', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const event = await db.prepare('SELECT * FROM events WHERE id=$1').get(req.params.id);
    if (!event) return res.status(404).json({ error: 'Evento não encontrado' });
    if (event.owner_id !== req.user.id) return res.status(403).json({ error: 'Só o criador pode convidar' });
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id obrigatório' });
    const existing = await db.prepare('SELECT id FROM event_members WHERE event_id=$1 AND user_id=$2').get(req.params.id, user_id);
    if (existing) return res.status(409).json({ error: 'Usuário já convidado' });
    await db.prepare('INSERT INTO event_members (id,event_id,user_id,status) VALUES ($1,$2,$3,$4)')
      .run(uuidv4(), req.params.id, user_id, 'pending');
    // Notificação
    const inviter = await db.prepare('SELECT name FROM users WHERE id=$1').get(req.user.id);
    await createNotification(db, {
      userId: user_id, fromUserId: req.user.id,
      type: 'event_invite',
      title: `${inviter.name} te convidou para um evento`,
      body: event.title,
      data: { event_id: req.params.id }
    });
    res.status(201).json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/events/:id/respond — aceitar ou recusar
router.put('/:id/respond', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { status, reason } = req.body;
    if (!['accepted','declined'].includes(status)) return res.status(400).json({ error: 'Status inválido' });
    const member = await db.prepare('SELECT * FROM event_members WHERE event_id=$1 AND user_id=$2').get(req.params.id, req.user.id);
    if (!member) return res.status(404).json({ error: 'Convite não encontrado' });
    await db.prepare('UPDATE event_members SET status=$1, decline_reason=$2 WHERE event_id=$3 AND user_id=$4')
      .run(status, reason||null, req.params.id, req.user.id);
    res.json({ ok: true, status });
    // Pedro anima a galera quando alguém confirma presença
    if (status === 'accepted') setTimeout(() => pedroHypeMembers(req.params.id), 3000);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/events/:id/posts — postar texto/enquete
router.post('/:id/posts', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const member = await db.prepare("SELECT * FROM event_members WHERE event_id=$1 AND user_id=$2 AND status='accepted'").get(req.params.id, req.user.id);
    const event = await db.prepare('SELECT owner_id FROM events WHERE id=$1').get(req.params.id);
    if (!member && event?.owner_id !== req.user.id) return res.status(403).json({ error: 'Só participantes confirmados podem postar' });
    const { content, post_type='text', poll_data } = req.body;
    if (!content) return res.status(400).json({ error: 'Conteúdo vazio' });
    const id = uuidv4();
    await db.prepare('INSERT INTO event_posts (id,event_id,user_id,content,post_type,poll_data) VALUES ($1,$2,$3,$4,$5,$6)')
      .run(id, req.params.id, req.user.id, content, post_type, poll_data ? JSON.stringify(poll_data) : null);
    const post = await db.prepare(`
      SELECT ep.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar
      FROM event_posts ep JOIN users u ON u.id=ep.user_id WHERE ep.id=$1
    `).get(id);
    // Pedro comenta em pedro_comments (tabela garantida)
    try {
      const phrases = ["Li e fiquei pensativo 🤔🧡 Evento bom começa com boa conversa!","Que post! Estou ronronando de entusiasmo pelo evento! 😻🎉","Boa! Esse evento vai ser incrível! 🎉🐾","Vi isso aqui da janela e aprovei com a patinha! ✅🐱"];
      const phrase = phrases[Math.floor(Math.random() * phrases.length)];
      await db.prepare('INSERT INTO pedro_comments (id,post_id,content) VALUES ($1,$2,$3) ON CONFLICT(post_id) DO NOTHING')
        .run(uuidv4(), id, phrase);
    } catch(pedroErr) { console.error('Pedro evento texto:', pedroErr.message); }
    res.status(201).json({ post });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/events/:id/posts/photo
router.post('/:id/posts/photo', authMiddleware, (req, res, next) => {
  createPhotoUpload().single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Foto obrigatória' });
    try {
      const db = getDB();
      const member = await db.prepare("SELECT * FROM event_members WHERE event_id=$1 AND user_id=$2 AND status='accepted'").get(req.params.id, req.user.id);
      const event = await db.prepare('SELECT owner_id FROM events WHERE id=$1').get(req.params.id);
      if (!member && event?.owner_id !== req.user.id) return res.status(403).json({ error: 'Só participantes confirmados podem postar' });
      const image_url = getUploadedUrl(req, req.file);
      const id = uuidv4();
      await db.prepare('INSERT INTO event_posts (id,event_id,user_id,content,image_url,post_type) VALUES ($1,$2,$3,$4,$5,$6)')
        .run(id, req.params.id, req.user.id, req.body.caption||'', image_url, 'photo');
      const post = await db.prepare(`
        SELECT ep.*, u.name as author_name, u.avatar_url as author_avatar
        FROM event_posts ep JOIN users u ON u.id=ep.user_id WHERE ep.id=$1
      `).get(id);
      // Pedro comenta em pedro_comments (tabela garantida)
      try {
        const phrases = ["Que foto! Esse evento tá prometendo demais! 📸🧡","Fui lá e cheirei a tela — aprovado! O evento vai ser top! 😂🐾","Isso sim é conteúdo! O evento tá arrasando! 🏆🐾"];
        const phrase = phrases[Math.floor(Math.random() * phrases.length)];
        await db.prepare('INSERT INTO pedro_comments (id,post_id,content) VALUES ($1,$2,$3) ON CONFLICT(post_id) DO NOTHING')
          .run(uuidv4(), id, phrase);
      } catch(pedroErr) { console.error('Pedro evento foto:', pedroErr.message); }
      res.status(201).json({ post });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
});

// POST /api/events/:id/posts/:postId/react
router.post('/:id/posts/:postId/react', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { emoji } = req.body;
    const existing = await db.prepare('SELECT id FROM event_post_reactions WHERE post_id=$1 AND user_id=$2 AND emoji=$3').get(req.params.postId, req.user.id, emoji);
    if (existing) {
      await db.prepare('DELETE FROM event_post_reactions WHERE id=$1').run(existing.id);
    } else {
      await db.prepare('INSERT INTO event_post_reactions (id,post_id,user_id,emoji) VALUES ($1,$2,$3,$4)').run(uuidv4(), req.params.postId, req.user.id, emoji);
    }
    const reactions = await db.prepare('SELECT emoji, COUNT(*) as count FROM event_post_reactions WHERE post_id=$1 GROUP BY emoji').all(req.params.postId);
    res.json({ reactions });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/events/:id/posts/:postId/vote
router.post('/:id/posts/:postId/vote', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { option_index } = req.body;
    const post = await db.prepare('SELECT * FROM event_posts WHERE id=$1').get(req.params.postId);
    if (!post || post.post_type !== 'poll') return res.status(400).json({ error: 'Não é uma enquete' });
    const pd = typeof post.poll_data === 'string' ? JSON.parse(post.poll_data) : post.poll_data;
    const alreadyVoted = pd.options.some(o => o.voter_ids?.includes(req.user.id));
    if (alreadyVoted) return res.status(400).json({ error: 'Já votou' });
    pd.options[option_index].votes = (pd.options[option_index].votes || 0) + 1;
    pd.options[option_index].voter_ids = [...(pd.options[option_index].voter_ids || []), req.user.id];
    await db.prepare('UPDATE event_posts SET poll_data=$1 WHERE id=$2').run(JSON.stringify(pd), req.params.postId);
    res.json({ poll_data: pd });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
