const express = require('express');
const router = express.Router();
const { pool } = require('./database');
const { requireAuth } = require('./authmiddleware');

// Criar migration das tabelas
async function initFeedTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS feed_posts (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS feed_reactions (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      post_id TEXT NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      reaction TEXT NOT NULL,
      UNIQUE(post_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS feed_comments (
      id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      post_id TEXT NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}
initFeedTables().catch(console.error);

// Publicar post no feed
router.post('/post', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Conteúdo obrigatório' });
    const { rows } = await pool.query(
      `INSERT INTO feed_posts (user_id, content) VALUES ($1, $2) RETURNING *`,
      [req.user.id, content.trim()]
    );
    res.json({ post: rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Meus posts
router.get('/myposts', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT fp.*,
        u.name as author_name, u.username as author_username, u.avatar_url as author_avatar,
        (SELECT COUNT(*) FROM feed_comments fc WHERE fc.post_id = fp.id) as comments_count,
        (SELECT COUNT(*) FROM feed_reactions fr WHERE fr.post_id = fp.id AND fr.reaction='amei') as r_amei,
        (SELECT COUNT(*) FROM feed_reactions fr WHERE fr.post_id = fp.id AND fr.reaction='curti') as r_curti,
        (SELECT COUNT(*) FROM feed_reactions fr WHERE fr.post_id = fp.id AND fr.reaction='disney') as r_disney,
        (SELECT COUNT(*) FROM feed_reactions fr WHERE fr.post_id = fp.id AND fr.reaction='naocurti') as r_naocurti
      FROM feed_posts fp
      JOIN users u ON u.id = fp.user_id
      WHERE fp.user_id = $1
      ORDER BY fp.created_at DESC
      LIMIT 50
    `, [req.user.id]);
    res.json({ posts: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Feed dos amigos
router.get('/friends', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT fp.*,
        u.name as author_name, u.username as author_username, u.avatar_url as author_avatar,
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
      ORDER BY fp.created_at DESC
      LIMIT 100
    `, [req.user.id]);
    res.json({ posts: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Detalhe de um post + comentários
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const { rows: postRows } = await pool.query(`
      SELECT fp.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar
      FROM feed_posts fp JOIN users u ON u.id = fp.user_id WHERE fp.id = $1
    `, [req.params.id]);
    if (!postRows.length) return res.status(404).json({ error: 'Post não encontrado' });
    const { rows: comments } = await pool.query(`
      SELECT fc.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar
      FROM feed_comments fc JOIN users u ON u.id = fc.user_id
      WHERE fc.post_id = $1 ORDER BY fc.created_at ASC
    `, [req.params.id]);
    res.json({ post: postRows[0], comments });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Reagir
router.post('/:id/react', requireAuth, async (req, res) => {
  try {
    const { reaction } = req.body;
    const valid = ['amei','curti','disney','naocurti'];
    if (!valid.includes(reaction)) return res.status(400).json({ error: 'Reação inválida' });
    // Toggle
    const { rows: existing } = await pool.query(
      `SELECT id, reaction FROM feed_reactions WHERE post_id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (existing.length && existing[0].reaction === reaction) {
      await pool.query(`DELETE FROM feed_reactions WHERE post_id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    } else {
      await pool.query(
        `INSERT INTO feed_reactions (post_id, user_id, reaction) VALUES ($1,$2,$3)
         ON CONFLICT (post_id, user_id) DO UPDATE SET reaction=$3`,
        [req.params.id, req.user.id, reaction]
      );
    }
    const { rows } = await pool.query(`
      SELECT
        SUM(CASE WHEN reaction='amei' THEN 1 ELSE 0 END) as amei,
        SUM(CASE WHEN reaction='curti' THEN 1 ELSE 0 END) as curti,
        SUM(CASE WHEN reaction='disney' THEN 1 ELSE 0 END) as disney,
        SUM(CASE WHEN reaction='naocurti' THEN 1 ELSE 0 END) as naocurti
      FROM feed_reactions WHERE post_id=$1
    `, [req.params.id]);
    res.json({ counts: rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Comentar
router.post('/:id/comment', requireAuth, async (req, res) => {
  try {
    const { content } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: 'Conteúdo obrigatório' });
    const { rows } = await pool.query(
      `INSERT INTO feed_comments (post_id, user_id, content) VALUES ($1,$2,$3) RETURNING *`,
      [req.params.id, req.user.id, content.trim()]
    );
    res.json({ comment: rows[0] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
