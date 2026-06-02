const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');
const { createPhotoUpload, getUploadedUrl } = require('./cloudinary');
const { createNotification } = require('./notif_helper');

const router = express.Router();

// GET /api/agenda — listar agendas do usuário (criadas + convidado)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const mine = await db.prepare(`
      SELECT a.*, u.name as creator_name, u.username as creator_username, u.avatar_url as creator_avatar,
        (SELECT COUNT(*) FROM agenda_members WHERE agenda_id=a.id AND status='accepted') as member_count,
        (SELECT COUNT(*) FROM agenda_posts WHERE agenda_id=a.id) as post_count
      FROM agendas a JOIN users u ON u.id=a.owner_id
      WHERE a.owner_id=$1 ORDER BY a.event_date ASC
    `).all(req.user.id);

    const invited = await db.prepare(`
      SELECT a.*, u.name as creator_name, u.username as creator_username, u.avatar_url as creator_avatar,
        am.status as my_status,
        (SELECT COUNT(*) FROM agenda_members WHERE agenda_id=a.id AND status='accepted') as member_count
      FROM agendas a JOIN users u ON u.id=a.owner_id
      JOIN agenda_members am ON am.agenda_id=a.id AND am.user_id=$1
      WHERE a.owner_id != $1 ORDER BY a.event_date ASC
    `).all(req.user.id);

    res.json({ mine, invited });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/agenda/:id
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const agenda = await db.prepare(`
      SELECT a.*, u.name as creator_name, u.username as creator_username, u.avatar_url as creator_avatar
      FROM agendas a JOIN users u ON u.id=a.owner_id WHERE a.id=$1
    `).get(req.params.id);
    if (!agenda) return res.status(404).json({ error: 'Agenda não encontrada' });

    const isMember = agenda.owner_id === req.user.id;
    const member = await db.prepare("SELECT * FROM agenda_members WHERE agenda_id=$1 AND user_id=$2").get(req.params.id, req.user.id);
    if (!isMember && !member) return res.status(403).json({ error: 'Acesso negado' });

    const members = await db.prepare(`
      SELECT am.*, u.name, u.username, u.avatar_url
      FROM agenda_members am JOIN users u ON u.id=am.user_id
      WHERE am.agenda_id=$1 ORDER BY am.created_at ASC
    `).all(req.params.id);

    const posts = await db.prepare(`
      SELECT ap.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar
      FROM agenda_posts ap JOIN users u ON u.id=ap.user_id
      WHERE ap.agenda_id=$1 ORDER BY ap.created_at DESC LIMIT 50
    `).all(req.params.id);

    for (const p of posts) {
      p.reactions = await db.prepare('SELECT emoji, COUNT(*) as count FROM agenda_post_reactions WHERE post_id=$1 GROUP BY emoji').all(p.id);
      if (p.poll_data && typeof p.poll_data === 'string') p.poll_data = JSON.parse(p.poll_data);
    }

    res.json({ agenda, members, posts, is_owner: agenda.owner_id === req.user.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/agenda — criar agenda
router.post('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { title, description, event_date } = req.body;
    if (!title) return res.status(400).json({ error: 'Título obrigatório' });
    if (!event_date) return res.status(400).json({ error: 'Data obrigatória' });
    const id = uuidv4();
    await db.prepare('INSERT INTO agendas (id,title,description,event_date,owner_id) VALUES ($1,$2,$3,$4,$5)')
      .run(id, title.trim(), description||'', event_date, req.user.id);
    const agenda = await db.prepare('SELECT * FROM agendas WHERE id=$1').get(id);
    res.status(201).json({ agenda });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/agenda/:id/invite — convidar usuário
router.post('/:id/invite', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const agenda = await db.prepare('SELECT * FROM agendas WHERE id=$1').get(req.params.id);
    if (!agenda) return res.status(404).json({ error: 'Não encontrado' });
    if (agenda.owner_id !== req.user.id) return res.status(403).json({ error: 'Só o dono pode convidar' });
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id obrigatório' });
    const existing = await db.prepare('SELECT id FROM agenda_members WHERE agenda_id=$1 AND user_id=$2').get(req.params.id, user_id);
    if (existing) return res.status(409).json({ error: 'Usuário já convidado' });
    await db.prepare('INSERT INTO agenda_members (id,agenda_id,user_id,status) VALUES ($1,$2,$3,$4)')
      .run(uuidv4(), req.params.id, user_id, 'pending');
    const inviter = await db.prepare('SELECT name FROM users WHERE id=$1').get(req.user.id);
    await createNotification(db, {
      userId: user_id, fromUserId: req.user.id,
      type: 'agenda_invite',
      title: `${inviter.name} te convidou para um evento`,
      body: agenda.title,
      data: { agenda_id: req.params.id }
    });
    res.status(201).json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/agenda/:id/respond
router.put('/:id/respond', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { status } = req.body;
    await db.prepare("UPDATE agenda_members SET status=$1 WHERE agenda_id=$2 AND user_id=$3").run(status, req.params.id, req.user.id);
    // Se aceitou, adicionar como membro confirmado
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/agenda/:id/posts — texto/enquete
router.post('/:id/posts', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const agenda = await db.prepare('SELECT owner_id FROM agendas WHERE id=$1').get(req.params.id);
    const member = await db.prepare("SELECT id FROM agenda_members WHERE agenda_id=$1 AND user_id=$2 AND status='accepted'").get(req.params.id, req.user.id);
    if (!member && agenda?.owner_id !== req.user.id) return res.status(403).json({ error: 'Só participantes confirmados podem postar' });
    const { content, post_type='text', poll_data } = req.body;
    if (!content) return res.status(400).json({ error: 'Conteúdo vazio' });
    const id = uuidv4();
    await db.prepare('INSERT INTO agenda_posts (id,agenda_id,user_id,content,post_type,poll_data) VALUES ($1,$2,$3,$4,$5,$6)')
      .run(id, req.params.id, req.user.id, content, post_type, poll_data ? JSON.stringify(poll_data) : null);
    const post = await db.prepare(`SELECT ap.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar FROM agenda_posts ap JOIN users u ON u.id=ap.user_id WHERE ap.id=$1`).get(id);
    res.status(201).json({ post });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/agenda/:id/posts/photo
router.post('/:id/posts/photo', authMiddleware, (req, res) => {
  createPhotoUpload().single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Foto obrigatória' });
    try {
      const db = getDB();
      const agenda = await db.prepare('SELECT owner_id FROM agendas WHERE id=$1').get(req.params.id);
      const member = await db.prepare("SELECT id FROM agenda_members WHERE agenda_id=$1 AND user_id=$2 AND status='accepted'").get(req.params.id, req.user.id);
      if (!member && agenda?.owner_id !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });
      const image_url = getUploadedUrl(req, req.file);
      const id = uuidv4();
      await db.prepare('INSERT INTO agenda_posts (id,agenda_id,user_id,content,image_url,post_type) VALUES ($1,$2,$3,$4,$5,$6)')
        .run(id, req.params.id, req.user.id, req.body.caption||'', image_url, 'photo');
      const post = await db.prepare(`SELECT ap.*, u.name as author_name, u.avatar_url as author_avatar FROM agenda_posts ap JOIN users u ON u.id=ap.user_id WHERE ap.id=$1`).get(id);
      res.status(201).json({ post });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
});

// POST /api/agenda/:id/posts/:postId/react
router.post('/:id/posts/:postId/react', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { emoji } = req.body;
    const existing = await db.prepare('SELECT id FROM agenda_post_reactions WHERE post_id=$1 AND user_id=$2 AND emoji=$3').get(req.params.postId, req.user.id, emoji);
    if (existing) {
      await db.prepare('DELETE FROM agenda_post_reactions WHERE id=$1').run(existing.id);
    } else {
      await db.prepare('INSERT INTO agenda_post_reactions (id,post_id,user_id,emoji) VALUES ($1,$2,$3,$4)').run(uuidv4(), req.params.postId, req.user.id, emoji);
    }
    const reactions = await db.prepare('SELECT emoji, COUNT(*) as count FROM agenda_post_reactions WHERE post_id=$1 GROUP BY emoji').all(req.params.postId);
    res.json({ reactions });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/agenda/:id/posts/:postId/vote
router.post('/:id/posts/:postId/vote', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { option_index } = req.body;
    const post = await db.prepare('SELECT * FROM agenda_posts WHERE id=$1').get(req.params.postId);
    if (!post || post.post_type !== 'poll') return res.status(400).json({ error: 'Não é enquete' });
    const pd = typeof post.poll_data === 'string' ? JSON.parse(post.poll_data) : post.poll_data;
    const alreadyVoted = pd.options.some(o => o.voter_ids?.includes(req.user.id));
    if (alreadyVoted) return res.status(400).json({ error: 'Já votou' });
    pd.options[option_index].votes = (pd.options[option_index].votes || 0) + 1;
    pd.options[option_index].voter_ids = [...(pd.options[option_index].voter_ids || []), req.user.id];
    await db.prepare('UPDATE agenda_posts SET poll_data=$1 WHERE id=$2').run(JSON.stringify(pd), req.params.postId);
    res.json({ poll_data: pd });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
