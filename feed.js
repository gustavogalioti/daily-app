const express = require('express');
const router = express.Router();
const { getDB } = require('./database');
const { authMiddleware: requireAuth } = require('./authmiddleware');
const { v4: uuidv4 } = require('uuid');

// Publicar post no feed
router.post('/post', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Conteúdo obrigatório' });
    const db = getDB();
    const id = uuidv4();
    await db.prepare(`INSERT INTO feed_posts (id, user_id, content) VALUES ($1, $2, $3)`)
      .run(id, req.user.id, content.trim());
    res.json({ ok: true, id });
  } catch(e) { console.error('feed/post:', e.message); res.status(500).json({ error: e.message }); }
});

// Meus posts
router.get('/myposts', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const posts = await db.prepare(`
      SELECT fp.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar,
        (SELECT COUNT(*) FROM feed_comments fc WHERE fc.post_id = fp.id) as comments_count,
        (SELECT COUNT(*) FROM feed_reactions fr WHERE fr.post_id = fp.id AND fr.reaction='amei') as r_amei,
        (SELECT COUNT(*) FROM feed_reactions fr WHERE fr.post_id = fp.id AND fr.reaction='curti') as r_curti,
        (SELECT COUNT(*) FROM feed_reactions fr WHERE fr.post_id = fp.id AND fr.reaction='disney') as r_disney,
        (SELECT COUNT(*) FROM feed_reactions fr WHERE fr.post_id = fp.id AND fr.reaction='naocurti') as r_naocurti
      FROM feed_posts fp
      JOIN users u ON u.id = fp.user_id
      WHERE fp.user_id = $1
      ORDER BY fp.created_at DESC LIMIT 50
    `).all(req.user.id);
    res.json({ posts });
  } catch(e) { console.error('feed/myposts:', e.message); res.status(500).json({ error: e.message }); }
});

// Feed dos amigos
router.get('/friends', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const posts = await db.prepare(`
      SELECT fp.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar,
        (SELECT COUNT(*) FROM feed_comments fc WHERE fc.post_id = fp.id) as comments_count,
        (SELECT COUNT(*) FROM feed_reactions fr WHERE fr.post_id = fp.id AND fr.reaction='amei') as r_amei,
        (SELECT COUNT(*) FROM feed_reactions fr WHERE fr.post_id = fp.id AND fr.reaction='curti') as r_curti,
        (SELECT COUNT(*) FROM feed_reactions fr WHERE fr.post_id = fp.id AND fr.reaction='disney') as r_disney,
        (SELECT COUNT(*) FROM feed_reactions fr WHERE fr.post_id = fp.id AND fr.reaction='naocurti') as r_naocurti
      FROM feed_posts fp
      JOIN users u ON u.id = fp.user_id
      WHERE fp.user_id IN (
        SELECT CASE WHEN requester_id = $1 THEN addressee_id ELSE requester_id END
        FROM friendships WHERE (requester_id = $1 OR addressee_id = $1) AND status = 'accepted'
      ) OR fp.user_id = $1
      ORDER BY fp.created_at DESC LIMIT 100
    `).all(req.user.id);
    res.json({ posts });
  } catch(e) { console.error('feed/friends:', e.message); res.status(500).json({ error: e.message }); }
});

// Detalhe de um post + comentários
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const post = await db.prepare(`
      SELECT fp.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar
      FROM feed_posts fp JOIN users u ON u.id = fp.user_id WHERE fp.id = $1
    `).get(req.params.id);
    if (!post) return res.status(404).json({ error: 'Post não encontrado' });
    const comments = await db.prepare(`
      SELECT fc.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar
      FROM feed_comments fc JOIN users u ON u.id = fc.user_id
      WHERE fc.post_id = $1 ORDER BY fc.created_at ASC
    `).all(req.params.id);
    res.json({ post, comments });
  } catch(e) { console.error('feed/:id:', e.message); res.status(500).json({ error: e.message }); }
});

// Reagir
router.post('/:id/react', requireAuth, async (req, res) => {
  try {
    const { reaction } = req.body;
    const valid = ['amei','curti','disney','naocurti'];
    if (!valid.includes(reaction)) return res.status(400).json({ error: 'Reação inválida' });
    const db = getDB();
    const existing = await db.prepare(
      `SELECT id, reaction FROM feed_reactions WHERE post_id=$1 AND user_id=$2`
    ).get(req.params.id, req.user.id);
    if (existing && existing.reaction === reaction) {
      await db.prepare(`DELETE FROM feed_reactions WHERE post_id=$1 AND user_id=$2`)
        .run(req.params.id, req.user.id);
    } else if (existing) {
      await db.prepare(`UPDATE feed_reactions SET reaction=$1 WHERE post_id=$2 AND user_id=$3`)
        .run(reaction, req.params.id, req.user.id);
    } else {
      await db.prepare(`INSERT INTO feed_reactions (id, post_id, user_id, reaction) VALUES ($1,$2,$3,$4)`)
        .run(uuidv4(), req.params.id, req.user.id, reaction);
    }
    const counts = {};
    for (const r of valid) {
      const row = await db.prepare(
        `SELECT COUNT(*) as count FROM feed_reactions WHERE post_id=$1 AND reaction=$2`
      ).get(req.params.id, r);
      counts[r] = parseInt(row?.count || 0);
    }
    res.json({ counts });
  } catch(e) { console.error('feed/react:', e.message); res.status(500).json({ error: e.message }); }
});

// Comentar
router.post('/:id/comment', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Conteúdo obrigatório' });
    const db = getDB();
    const id = uuidv4();
    await db.prepare(`INSERT INTO feed_comments (id, post_id, user_id, content) VALUES ($1,$2,$3,$4)`)
      .run(id, req.params.id, req.user.id, content.trim());
    res.json({ ok: true });
  } catch(e) { console.error('feed/comment:', e.message); res.status(500).json({ error: e.message }); }
});

module.exports = router;
