const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { createPhotoUpload, getUploadedUrl } = require('./cloudinary');
const { authMiddleware, optionalAuth } = require('./authmiddleware');

const router = express.Router();

async function enrich(p, userId) {
  const db = getDB();
  const reactions = await db.prepare('SELECT emoji, COUNT(*) as count, MAX(CASE WHEN user_id=$1 THEN 1 ELSE 0 END) as reacted FROM reactions WHERE post_id=$2 GROUP BY emoji').all(userId||'', p.id);
  const cRow = await db.prepare('SELECT COUNT(*) as c FROM comments WHERE post_id=$1').get(p.id);
  const comment_count = parseInt(cRow?.c || 0);
  const author = await db.prepare('SELECT id,name,username,avatar_url FROM users WHERE id=$1').get(p.user_id);
  return { ...p, author, reactions, comment_count };
}

router.get('/', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const { tab, user_id, date, limit=50, offset=0 } = req.query;
    let sql = 'SELECT * FROM posts WHERE 1=1'; const p = [];
    let i = 0;
    if (tab)     { sql += ` AND tab=$${++i}`;              p.push(tab); }
    if (user_id) { sql += ` AND user_id=$${++i}`;         p.push(user_id); }
    if (date)    { sql += ` AND DATE(created_at)=$${++i}`; p.push(date); }
    sql += ` ORDER BY created_at DESC LIMIT $${++i} OFFSET $${++i}`;
    p.push(parseInt(limit), parseInt(offset));
    const posts = await db.prepare(sql).all(...p);
    const enriched = await Promise.all(posts.map(x => enrich(x, req.user?.id)));
    res.json({ posts: enriched });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

router.get('/agora', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const now  = new Date();
    const hour = String(now.getHours()).padStart(2,'0');
    const date = now.toISOString().slice(0,10);
    const posts = await db.prepare("SELECT * FROM posts WHERE TO_CHAR(created_at,'HH24')=$1 AND DATE(created_at)=$2 ORDER BY created_at DESC LIMIT 100").all(hour, date);
    const enriched = await Promise.all(posts.map(x => enrich(x, req.user?.id)));
    res.json({ hour: now.getHours(), posts: enriched });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

router.get('/highlights', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const { filter='todos' } = req.query;
    const today   = new Date().toISOString().slice(0,10);
    const weekAgo = new Date(Date.now()-7*24*3600*1000).toISOString().slice(0,10);
    let sql = 'SELECT p.*, COUNT(r.id) as reaction_count FROM posts p LEFT JOIN reactions r ON r.post_id=p.id WHERE 1=1';
    const p = []; let i = 0;
    if (filter==='fotos')  sql += ` AND p.type='photo'`;
    if (filter==='textos') sql += ` AND p.type='text'`;
    if (filter==='hoje')   { sql += ` AND DATE(p.created_at)=$${++i}`; p.push(today); }
    if (filter==='semana') { sql += ` AND DATE(p.created_at)>=$${++i}`; p.push(weekAgo); }
    sql += ` GROUP BY p.id ORDER BY reaction_count DESC, p.created_at DESC LIMIT 50`;
    const posts = await db.prepare(sql).all(...p);
    const enriched = await Promise.all(posts.map(x => enrich(x, req.user?.id)));
    res.json({ posts: enriched });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { content, tab='timeline', caption } = req.body;
    if (!content && !caption) return res.status(400).json({ error: 'Conteúdo obrigatório' });
    const id = uuidv4();
    const t  = ['timeline','discuss','agora'].includes(tab) ? tab : 'timeline';
    await db.prepare('INSERT INTO posts (id,user_id,type,content,tab,caption) VALUES ($1,$2,$3,$4,$5,$6)').run(id, req.user.id, 'text', content||caption, t, caption||null);
    const post = await db.prepare('SELECT * FROM posts WHERE id=$1').get(id);
    res.status(201).json({ post: await enrich(post, req.user.id) });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
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
      await db.prepare('INSERT INTO posts (id,user_id,type,image_url,caption,tab) VALUES ($1,$2,$3,$4,$5,$6)').run(id, req.user.id, 'photo', image_url, caption, tab);
      const post = await db.prepare('SELECT * FROM posts WHERE id=$1').get(id);
      res.status(201).json({ post: await enrich(post, req.user.id) });
    } catch(e) { next(e); }
  });
});

router.post('/:id/react', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ error: 'Emoji obrigatório' });
    const ex = await db.prepare('SELECT id FROM reactions WHERE post_id=$1 AND user_id=$2 AND emoji=$3').get(req.params.id, req.user.id, emoji);
    if (ex) {
      await db.prepare('DELETE FROM reactions WHERE post_id=$1 AND user_id=$2 AND emoji=$3').run(req.params.id, req.user.id, emoji);
      return res.json({ action:'removed', emoji });
    }
    await db.prepare('INSERT INTO reactions (id,post_id,user_id,emoji) VALUES ($1,$2,$3,$4)').run(uuidv4(), req.params.id, req.user.id, emoji);
    const reactions = await db.prepare('SELECT emoji, COUNT(*) as count FROM reactions WHERE post_id=$1 GROUP BY emoji').all(req.params.id);
    res.json({ action:'added', emoji, reactions });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

router.get('/:id/comments', async (req, res) => {
  try {
    const comments = await getDB().prepare('SELECT c.*,u.name,u.username,u.avatar_url FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=$1 ORDER BY c.created_at ASC').all(req.params.id);
    res.json({ comments });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/comments', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { content, parent_id } = req.body;
    if (!content) return res.status(400).json({ error: 'Comentário vazio' });
    const id = uuidv4();
    await db.prepare('INSERT INTO comments (id,post_id,user_id,parent_id,content) VALUES ($1,$2,$3,$4,$5)').run(id, req.params.id, req.user.id, parent_id||null, content);
    const comment = await db.prepare('SELECT c.*,u.name,u.username,u.avatar_url FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=$1').get(id);
    res.status(201).json({ comment });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
