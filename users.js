const express = require('express');
const { getDB } = require('./database');
const { createAvatarUpload, getUploadedUrl } = require('./cloudinary');
const { authMiddleware, optionalAuth } = require('./authmiddleware');
const { checkAndGrant } = require('./achievements');

const router = express.Router();

// GET /api/users/search?q=...
router.get('/search', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ users: [] });
    const clean = q.replace(/^@/,'').toLowerCase();
    const users = await db.prepare(`
      SELECT id,name,username,avatar_url,bio,occupation,city,state
      FROM users WHERE username ILIKE $1 OR name ILIKE $2
      ORDER BY name ASC LIMIT 20
    `).all(`%${clean}%`, `%${q}%`);
    res.json({ users });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/users/me
router.put('/me', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { name, bio, occupation, country, state, city, neighborhood,
            professional_title, professional_url, professional_desc } = req.body;
    await db.prepare(`UPDATE users SET
      name=COALESCE($1,name), bio=COALESCE($2,bio), occupation=COALESCE($3,occupation),
      country=COALESCE($4,country), state=COALESCE($5,state), city=COALESCE($6,city),
      neighborhood=COALESCE($7,neighborhood),
      professional_title=COALESCE($8,professional_title),
      professional_url=COALESCE($9,professional_url),
      professional_desc=COALESCE($10,professional_desc),
      updated_at=NOW() WHERE id=$11`)
      .run(name||null, bio!==undefined?bio:null, occupation||null,
           country||null, state||null, city||null, neighborhood||null,
           professional_title||null, professional_url||null, professional_desc||null,
           req.user.id);
    await checkAndGrant(db, req.user.id, 'profile_complete');
    const user = await db.prepare('SELECT id,name,username,email,bio,avatar_url,occupation,country,state,city,neighborhood,professional_title,professional_url,professional_desc,points,created_at FROM users WHERE id=$1').get(req.user.id);
    res.json({ user });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/users/me/avatar
router.post('/me/avatar', authMiddleware, (req, res, next) => {
  createAvatarUpload(req.user.id).single('avatar')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Imagem obrigatória' });
    try {
      const avatar_url = getUploadedUrl(req, req.file);
      await getDB().prepare("UPDATE users SET avatar_url=$1, updated_at=NOW() WHERE id=$2").run(avatar_url, req.user.id);
      await checkAndGrant(getDB(), req.user.id, 'avatar');
      await checkAndGrant(getDB(), req.user.id, 'profile_complete');
      res.json({ avatar_url });
    } catch(e) { next(e); }
  });
});

// GET /api/users/:username
router.get('/:username', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const username = req.params.username.replace(/^@/,'').toLowerCase();
    const user = await db.prepare(`SELECT id,name,username,bio,avatar_url,occupation,
      country,state,city,neighborhood,professional_title,professional_url,professional_desc,
      points,created_at FROM users WHERE username=$1`).get(username);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });

    const posts       = parseInt((await db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id=$1').get(user.id))?.c || 0);
    const photos      = parseInt((await db.prepare("SELECT COUNT(*) as c FROM posts WHERE user_id=$1 AND type='photo'").get(user.id))?.c || 0);
    const reactions   = parseInt((await db.prepare('SELECT COUNT(*) as c FROM reactions WHERE post_id IN (SELECT id FROM posts WHERE user_id=$1)').get(user.id))?.c || 0);
    const active_days = parseInt((await db.prepare("SELECT COUNT(DISTINCT DATE(created_at)) as c FROM posts WHERE user_id=$1").get(user.id))?.c || 0);
    const friends_count = parseInt((await db.prepare("SELECT COUNT(*) as c FROM friendships WHERE (requester_id=$1 OR addressee_id=$1) AND status='accepted'").get(user.id))?.c || 0);
    const daily_mandou = parseInt((await db.prepare("SELECT COUNT(*) as c FROM posts WHERE user_id=$1 AND tab='daily_mandou'").get(user.id))?.c || 0);

    // Badges em destaque
    const featured_badges = await db.prepare(`
      SELECT fb.slot, a.* FROM featured_badges fb
      JOIN achievements a ON a.id=fb.achievement_id
      WHERE fb.user_id=$1 ORDER BY fb.slot ASC
    `).all(user.id);

    // Amizade com quem está vendo
    let friendship_status = 'none';
    if (req.user && req.user.id !== user.id) {
      const f = await db.prepare("SELECT status, requester_id FROM friendships WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)").get(req.user.id, user.id);
      if (f) friendship_status = f.status === 'accepted' ? 'friends' : (f.requester_id === req.user.id ? 'pending_sent' : 'pending_received');
    }

    res.json({ user: { ...user, stats: { posts, photos, reactions, active_days, friends_count, daily_mandou }, featured_badges, friendship_status } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/users/:username/posts
router.get('/:username/posts', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const username = req.params.username.replace(/^@/,'').toLowerCase();
    const user = await db.prepare('SELECT id FROM users WHERE username=$1').get(username);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    const { date, limit=100 } = req.query;
    let sql = 'SELECT * FROM posts WHERE user_id=$1'; const p = [user.id]; let i = 1;
    if (date) { sql += ` AND DATE(created_at)=$${++i}`; p.push(date); }
    sql += ` ORDER BY created_at ASC LIMIT $${++i}`; p.push(parseInt(limit));
    const posts = await db.prepare(sql).all(...p);
    res.json({ posts });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
