const express = require('express');
const { getDB } = require('./database');
const { createAvatarUpload, getUploadedUrl } = require('./cloudinary');
const { authMiddleware } = require('./authmiddleware');

const router = express.Router();

router.put('/me', authMiddleware, (req, res) => {
  const db = getDB();
  const { name, bio, occupation, country, state, city } = req.body;
  db.prepare("UPDATE users SET name=COALESCE(?,name), bio=COALESCE(?,bio), occupation=COALESCE(?,occupation), country=COALESCE(?,country), state=COALESCE(?,state), city=COALESCE(?,city), updated_at=datetime('now') WHERE id=?")
    .run(name||null, bio!==undefined?bio:null, occupation||null, country||null, state||null, city||null, req.user.id);
  const user = db.prepare('SELECT id,name,username,email,bio,avatar_url,occupation,country,state,city,created_at FROM users WHERE id=?').get(req.user.id);
  res.json({ user });
});

router.post('/me/avatar', authMiddleware, (req, res, next) => {
  createAvatarUpload(req.user.id).single('avatar')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Imagem obrigatória' });
    try {
      const avatar_url = getUploadedUrl(req, req.file);
      getDB().prepare("UPDATE users SET avatar_url=?, updated_at=datetime('now') WHERE id=?").run(avatar_url, req.user.id);
      res.json({ avatar_url });
    } catch(e) { next(e); }
  });
});

router.get('/:username', (req, res) => {
  const db = getDB();
  const username = req.params.username.replace(/^@/,'').toLowerCase();
  const user = db.prepare('SELECT id,name,username,bio,avatar_url,occupation,country,state,city,created_at FROM users WHERE username=?').get(username);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  const posts       = (db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id=?').get(user.id)||{c:0}).c;
  const photos      = (db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id=? AND type="photo"').get(user.id)||{c:0}).c;
  const texts       = (db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id=? AND type="text"').get(user.id)||{c:0}).c;
  const reactions   = (db.prepare('SELECT COUNT(*) as c FROM reactions WHERE post_id IN (SELECT id FROM posts WHERE user_id=?)').get(user.id)||{c:0}).c;
  const active_days = (db.prepare("SELECT COUNT(DISTINCT date(created_at)) as c FROM posts WHERE user_id=?").get(user.id)||{c:0}).c;
  res.json({ user: { ...user, stats: { posts, photos, texts, reactions, active_days } } });
});

router.get('/:username/posts', (req, res) => {
  const db = getDB();
  const username = req.params.username.replace(/^@/,'').toLowerCase();
  const user = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  const { date, limit=50 } = req.query;
  let sql = 'SELECT * FROM posts WHERE user_id=?'; const p = [user.id];
  if (date) { sql += ' AND date(created_at)=?'; p.push(date); }
  sql += ' ORDER BY created_at ASC LIMIT ?'; p.push(parseInt(limit));
  res.json({ posts: db.prepare(sql).all(...p) });
});

module.exports = router;
