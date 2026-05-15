const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../database');
const { createPhotoUpload, getUploadedUrl } = require('../cloudinary');
const { authMiddleware, optionalAuth } = require('../authmiddleware');

const router = express.Router();

function enrich(p, userId) {
  const db = getDB();
  const reactions = db.prepare('SELECT emoji, COUNT(*) as count, MAX(CASE WHEN user_id=? THEN 1 ELSE 0 END) as reacted FROM reactions WHERE post_id=? GROUP BY emoji').all(userId||'', p.id);
  const comment_count = (db.prepare('SELECT COUNT(*) as c FROM comments WHERE post_id=?').get(p.id)||{c:0}).c;
  const author = db.prepare('SELECT id,name,username,avatar_url FROM users WHERE id=?').get(p.user_id);
  return { ...p, author, reactions, comment_count };
}

router.get('/', optionalAuth, (req, res) => {
  const db = getDB();
  const { tab, user_id, date, limit=50, offset=0 } = req.query;
  let sql = 'SELECT * FROM posts WHERE 1=1'; const p = [];
  if (tab)     { sql += ' AND tab=?';              p.push(tab); }
  if (user_id) { sql += ' AND user_id=?';          p.push(user_id); }
  if (date)    { sql += ' AND date(created_at)=?'; p.push(date); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'; p.push(parseInt(limit), parseInt(offset));
  res.json({ posts: db.prepare(sql).all(...p).map(x => enrich(x, req.user?.id)) });
});

router.get('/agora', optionalAuth, (req, res) => {
  const db = getDB();
  const now = new Date();
  const hour = String(now.getHours()).padStart(2,'0');
  const date = now.toISOString().slice(0,10);
  const posts = db.prepare("SELECT * FROM posts WHERE strftime('%H',created_at)=? AND date(created_at)=? ORDER BY created_at DESC LIMIT 100").all(hour, date);
  res.json({ hour: now.getHours(), posts: posts.map(x => enrich(x, req.user?.id)) });
});

router.get('/highlights', optionalAuth, (req, res) => {
  const db = getDB();
  const { filter='todos' } = req.query;
  const today   = new Date().toISOString().slice(0,10);
  const weekAgo = new Date(Date.now()-7*24*3600*1000).toISOString().slice(0,10);
  let sql = 'SELECT p.*, COUNT(r.id) as reaction_count FROM posts p LEFT JOIN reactions r ON r.post_id=p.id WHERE 1=1';
  const p = [];
  if (filter==='fotos')  sql += ' AND p.type="photo"';
  if (filter==='textos') sql += ' AND p.type="text"';
  if (filter==='hoje')   { sql += ' AND date(p.created_at)=?'; p.push(today); }
  if (filter==='semana') { sql += ' AND date(p.created_at)>=?'; p.push(weekAgo); }
  sql += ' GROUP BY p.id ORDER BY reaction_count DESC, p.created_at DESC LIMIT 50';
  res.json({ posts: db.prepare(sql).all(...p).map(x => enrich(x, req.user?.id)) });
});

router.post('/', authMiddleware, (req, res) => {
  const db = getDB();
  const { content, tab='timeline', caption } = req.body;
  if (!content && !caption) return res.status(400).json({ error: 'Conteúdo obrigatório' });
  const id = uuidv4();
  const t  = ['timeline','discuss','agora'].includes(tab) ? tab : 'timeline';
  db.prepare('INSERT INTO posts (id,user_id,type,content,tab,caption) VALUES (?,?,?,?,?,?)').run(id, req.user.id, 'text', content||caption, t, caption||null);
  res.status(201).json({ post: enrich(db.prepare('SELECT * FROM posts WHERE id=?').get(id), req.user.id) });
});

router.post('/photo', authMiddleware, (req, res, next) => {
  createPhotoUpload().single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Foto obrigatória' });
    try {
      const db = getDB();
      const { caption='', tab='timeline' } = req.body;
      const image_url = getUploadedUrl(req, req.file);
      const id = uuidv4();
      db.prepare('INSERT INTO posts (id,user_id,type,image_url,caption,tab) VALUES (?,?,?,?,?,?)').run(id, req.user.id, 'photo', image_url, caption, tab);
      res.status(201).json({ post: enrich(db.prepare('SELECT * FROM posts WHERE id=?').get(id), req.user.id) });
    } catch(e) { next(e); }
  });
});

router.post('/:id/react', authMiddleware, (req, res) => {
  const db = getDB();
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'Emoji obrigatório' });
  const ex = db.prepare('SELECT id FROM reactions WHERE post_id=? AND user_id=? AND emoji=?').get(req.params.id, req.user.id, emoji);
  if (ex) { db.prepare('DELETE FROM reactions WHERE post_id=? AND user_id=? AND emoji=?').run(req.params.id, req.user.id, emoji); return res.json({ action:'removed', emoji }); }
  db.prepare('INSERT INTO reactions (id,post_id,user_id,emoji) VALUES (?,?,?,?)').run(uuidv4(), req.params.id, req.user.id, emoji);
  const reactions = db.prepare('SELECT emoji, COUNT(*) as count FROM reactions WHERE post_id=? GROUP BY emoji').all(req.params.id);
  res.json({ action:'added', emoji, reactions });
});

router.get('/:id/comments', (req, res) => {
  const comments = getDB().prepare('SELECT c.*,u.name,u.username,u.avatar_url FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=? ORDER BY c.created_at ASC').all(req.params.id);
  res.json({ comments });
});

router.post('/:id/comments', authMiddleware, (req, res) => {
  const db = getDB();
  const { content, parent_id } = req.body;
  if (!content) return res.status(400).json({ error: 'Comentário vazio' });
  const id = uuidv4();
  db.prepare('INSERT INTO comments (id,post_id,user_id,parent_id,content) VALUES (?,?,?,?,?)').run(id, req.params.id, req.user.id, parent_id||null, content);
  const comment = db.prepare('SELECT c.*,u.name,u.username,u.avatar_url FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=?').get(id);
  res.status(201).json({ comment });
});

module.exports = router;
