const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');
const { createPhotoUpload, getUploadedUrl } = require('./cloudinary');
const { getPedroComment } = require('./pedro');

const router = express.Router();

// ─── LISTAR EVENTOS DO USUÁRIO ───────────────────────────────────────────────
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const events = await db.prepare(`
      SELECT e.*, u.name as creator_name, u.username as creator_username,
        u.avatar_url as creator_avatar,
        (SELECT COUNT(*) FROM event_members em WHERE em.event_id=e.id AND em.status='accepted') as confirmed_count,
        em2.status as my_status
      FROM events e
      JOIN users u ON u.id=e.owner_id
      LEFT JOIN event_members em2 ON em2.event_id=e.id AND em2.user_id=$1
      WHERE e.owner_id=$1 OR em2.user_id=$1
      ORDER BY e.event_date ASC
    `).all(req.user.id);
    res.json({ events });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── CONVITES PENDENTES ──────────────────────────────────────────────────────
router.get('/invites/pending', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const invites = await db.prepare(`
      SELECT em.*, e.title, e.event_date, e.location,
             u.name as creator_name, u.avatar_url as creator_avatar
      FROM event_members em
      JOIN events e ON e.id=em.event_id
      JOIN users u ON u.id=e.owner_id
      WHERE em.user_id=$1 AND em.status='pending'
      ORDER BY em.created_at DESC
    `).all(req.user.id);
    res.json({ invites });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── CRIAR EVENTO ────────────────────────────────────────────────────────────
router.post('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { title, description, location, event_date, event_end_date } = req.body;
    if (!title) return res.status(400).json({ error: 'Título obrigatório' });
    if (!event_date) return res.status(400).json({ error: 'Data obrigatória' });
    const id = uuidv4();
    await db.prepare(
      `INSERT INTO events (id,title,description,location,event_date,event_end_date,owner_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`
    ).run(id, title.trim(), description||'', location||'', event_date, event_end_date||null, req.user.id);
    // Criador entra automaticamente como confirmado
    await db.prepare(
      `INSERT INTO event_members (id,event_id,user_id,status) VALUES ($1,$2,$3,'accepted')`
    ).run(uuidv4(), id, req.user.id);
    const event = await db.prepare('SELECT * FROM events WHERE id=$1').get(id);
    res.status(201).json({ event });
  } catch(e) {
    console.error('[POST /api/events]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── DETALHES DO EVENTO ──────────────────────────────────────────────────────
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const event = await db.prepare(`
      SELECT e.*, u.name as creator_name, u.username as creator_username,
             u.avatar_url as creator_avatar, em2.status as my_status
      FROM events e JOIN users u ON u.id=e.owner_id
      LEFT JOIN event_members em2 ON em2.event_id=e.id AND em2.user_id=$2
      WHERE e.id=$1
    `).get(req.params.id, req.user.id);
    if (!event) return res.status(404).json({ error: 'Evento não encontrado' });

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
    }

    res.json({ event, members, posts, is_owner: event.owner_id === req.user.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── CONVIDAR USUÁRIO ────────────────────────────────────────────────────────
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
    res.status(201).json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── RESPONDER CONVITE ───────────────────────────────────────────────────────
router.put('/:id/respond', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { status, reason } = req.body;
    if (!['accepted','declined'].includes(status)) return res.status(400).json({ error: 'Status inválido' });
    await db.prepare('UPDATE event_members SET status=$1, decline_reason=$2 WHERE event_id=$3 AND user_id=$4')
      .run(status, reason||null, req.params.id, req.user.id);
    res.json({ ok: true, status });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── FOTO DE CAPA ────────────────────────────────────────────────────────────
router.post('/:id/cover', authMiddleware, (req, res) => {
  createPhotoUpload().single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const db = getDB();
      if (!req.file) return res.status(400).json({ error: 'Foto obrigatória' });
      const cover_url = getUploadedUrl(req, req.file);
      await db.prepare('UPDATE events SET cover_url=$1 WHERE id=$2').run(cover_url, req.params.id);
      res.json({ cover_url });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
});

// ─── POSTS DO EVENTO ─────────────────────────────────────────────────────────
router.post('/:id/posts', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { content, post_type='text' } = req.body;
    if (!content) return res.status(400).json({ error: 'Conteúdo vazio' });
    const id = uuidv4();
    await db.prepare('INSERT INTO event_posts (id,event_id,user_id,content,post_type) VALUES ($1,$2,$3,$4,$5)')
      .run(id, req.params.id, req.user.id, content.trim(), post_type);
    const post = await db.prepare(`
      SELECT ep.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar
      FROM event_posts ep JOIN users u ON u.id=ep.user_id WHERE ep.id=$1
    `).get(id);
    res.status(201).json({ post });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/posts/photo', authMiddleware, (req, res) => {
  createPhotoUpload().single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const db = getDB();
      if (!req.file) return res.status(400).json({ error: 'Foto obrigatória' });
      const image_url = getUploadedUrl(req, req.file);
      const id = uuidv4();
      await db.prepare('INSERT INTO event_posts (id,event_id,user_id,content,image_url,post_type) VALUES ($1,$2,$3,$4,$5,$6)')
        .run(id, req.params.id, req.user.id, req.body.caption||'', image_url, 'photo');
      const post = await db.prepare(`
        SELECT ep.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar
        FROM event_posts ep JOIN users u ON u.id=ep.user_id WHERE ep.id=$1
      `).get(id);
      res.status(201).json({ post });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
});

router.post('/:id/posts/:postId/react', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { emoji } = req.body;
    const ex = await db.prepare('SELECT id FROM event_post_reactions WHERE post_id=$1 AND user_id=$2 AND emoji=$3').get(req.params.postId, req.user.id, emoji);
    if (ex) {
      await db.prepare('DELETE FROM event_post_reactions WHERE post_id=$1 AND user_id=$2 AND emoji=$3').run(req.params.postId, req.user.id, emoji);
    } else {
      await db.prepare('INSERT INTO event_post_reactions (id,post_id,user_id,emoji) VALUES ($1,$2,$3,$4)').run(uuidv4(), req.params.postId, req.user.id, emoji);
    }
    const reactions = await db.prepare('SELECT emoji, COUNT(*) as count FROM event_post_reactions WHERE post_id=$1 GROUP BY emoji').all(req.params.postId);
    res.json({ reactions });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/posts/:postId/comments', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const comments = await db.prepare(`
      SELECT cc.*, u.name, u.username, u.avatar_url
      FROM event_post_comments cc JOIN users u ON u.id=cc.user_id
      WHERE cc.post_id=$1 ORDER BY cc.created_at ASC
    `).all(req.params.postId);
    res.json({ comments });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/posts/:postId/comments', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Comentário vazio' });
    const id = uuidv4();
    await db.prepare('INSERT INTO event_post_comments (id,post_id,event_id,user_id,content) VALUES ($1,$2,$3,$4,$5)')
      .run(id, req.params.postId, req.params.id, req.user.id, content);
    const c = await db.prepare(`
      SELECT cc.*, u.name, u.username, u.avatar_url
      FROM event_post_comments cc JOIN users u ON u.id=cc.user_id WHERE cc.id=$1
    `).get(id);
    res.status(201).json({ comment: c });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
