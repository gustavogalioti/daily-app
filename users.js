const express = require('express');
const { getDB } = require('./database');
const { createAvatarUpload, getUploadedUrl } = require('./cloudinary');
const { authMiddleware } = require('./authmiddleware');

const router = express.Router();

router.put('/me', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { name, bio, occupation, country, state, city } = req.body;
    await db.prepare("UPDATE users SET name=COALESCE($1,name), bio=COALESCE($2,bio), occupation=COALESCE($3,occupation), country=COALESCE($4,country), state=COALESCE($5,state), city=COALESCE($6,city), updated_at=NOW() WHERE id=$7")
      .run(name||null, bio!==undefined?bio:null, occupation||null, country||null, state||null, city||null, req.user.id);
    const user = await db.prepare('SELECT id,name,username,email,bio,avatar_url,occupation,country,state,city,created_at FROM users WHERE id=$1').get(req.user.id);
    res.json({ user });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/me/avatar', authMiddleware, (req, res, next) => {
  createAvatarUpload(req.user.id).single('avatar')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Imagem obrigatória' });
    try {
      const avatar_url = getUploadedUrl(req, req.file);
      await getDB().prepare("UPDATE users SET avatar_url=$1, updated_at=NOW() WHERE id=$2").run(avatar_url, req.user.id);
      res.json({ avatar_url });
    } catch(e) { next(e); }
  });
});

router.get('/:username', async (req, res) => {
  try {
    const db = getDB();
    const username = req.params.username.replace(/^@/,'').toLowerCase();
    const user = await db.prepare('SELECT id,name,username,bio,avatar_url,occupation,country,state,city,created_at FROM users WHERE username=$1').get(username);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    const posts       = parseInt((await db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id=$1').get(user.id))?.c || 0);
    const photos      = parseInt((await db.prepare("SELECT COUNT(*) as c FROM posts WHERE user_id=$1 AND type='photo'").get(user.id))?.c || 0);
    const texts       = parseInt((await db.prepare("SELECT COUNT(*) as c FROM posts WHERE user_id=$1 AND type='text'").get(user.id))?.c || 0);
    const reactions   = parseInt((await db.prepare('SELECT COUNT(*) as c FROM reactions WHERE post_id IN (SELECT id FROM posts WHERE user_id=$1)').get(user.id))?.c || 0);
    const active_days = parseInt((await db.prepare("SELECT COUNT(DISTINCT DATE(created_at)) as c FROM posts WHERE user_id=$1").get(user.id))?.c || 0);
    res.json({ user: { ...user, stats: { posts, photos, texts, reactions, active_days } } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/:username/posts', async (req, res) => {
  try {
    const db = getDB();
    const username = req.params.username.replace(/^@/,'').toLowerCase();
    const user = await db.prepare('SELECT id FROM users WHERE username=$1').get(username);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    const { date, limit=50 } = req.query;
    let sql = 'SELECT * FROM posts WHERE user_id=$1'; const p = [user.id]; let i = 1;
    if (date) { sql += ` AND DATE(created_at)=$${++i}`; p.push(date); }
    sql += ` ORDER BY created_at ASC LIMIT $${++i}`; p.push(parseInt(limit));
    res.json({ posts: await db.prepare(sql).all(...p) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
