const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { createPhotoUpload, getUploadedUrl } = require('./cloudinary');
const { authMiddleware, optionalAuth } = require('./authmiddleware');
const { checkAndGrant } = require('./achievements');
const { createNotification } = require('./notif_helper');
const { getPedroComment } = require('./pedro');

const router = express.Router();

async function enrich(p, userId) {
  const db = getDB();
  const reactions = await db.prepare('SELECT emoji, COUNT(*) as count, MAX(CASE WHEN user_id=$1 THEN 1 ELSE 0 END) as reacted FROM reactions WHERE post_id=$2 GROUP BY emoji').all(userId||'', p.id);
  const cRow = await db.prepare('SELECT COUNT(*) as c FROM comments WHERE post_id=$1').get(p.id);
  const comment_count = parseInt(cRow?.c || 0);
  const pedro = await db.prepare('SELECT content FROM pedro_comments WHERE post_id=$1').get(p.id);
  let author = null;
  if (!p.is_anonymous) {
    author = await db.prepare('SELECT id,name,username,avatar_url FROM users WHERE id=$1').get(p.user_id);
  }
  // Badge de turno
  let turno_badge = null;
  try {
    const { TURNOS } = require('./turnos');
    if (p.created_at) {
      const postDate = new Date(p.created_at);
      const hora = (postDate.getUTCHours() - 3 + 24) % 24;
      for (const t of TURNOS) {
        if (t.hora_fim > t.hora_inicio) {
          if (hora >= t.hora_inicio && hora < t.hora_fim) { turno_badge = t.badge; break; }
        } else {
          if (hora >= t.hora_inicio || hora < t.hora_fim) { turno_badge = t.badge; break; }
        }
      }
    }
  } catch(e) {}
  return { ...p, author: author || { name:'Usuário anônimo', username:'anonimo', avatar_url:'' }, reactions, comment_count, pedro_comment: pedro?.content || null, turno_badge };
}

// Pedro comenta automaticamente (async, não bloqueia)
async function pedroAutoComment(postId, type) {
  try {
    const db = getDB();
    const existing = await db.prepare('SELECT id FROM pedro_comments WHERE post_id=$1').get(postId);
    if (existing) return;
    // Delay aleatório (1-5s) para parecer natural
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 4000));
    const content = getPedroComment(type);
    const pedroId = uuidv4();
    await db.prepare('INSERT INTO pedro_comments (id,post_id,content) VALUES ($1,$2,$3)').run(pedroId, postId, content);
    // Também inserir como comentário normal para aparecer no modal
    try {
      const PEDRO_ID = 'pedro-official-daily';
      await db.prepare('INSERT INTO comments (id,post_id,user_id,content) VALUES ($1,$2,$3,$4)')
        .run(uuidv4(), postId, PEDRO_ID, content);
    } catch(e) { console.error('pedro comment error:', e.message); }
  } catch(e) {}
}

// GET /api/posts — feed global ou por tab
router.get('/', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const { tab, user_id, date, limit=50, offset=0, exclude_tab, type: ptype, is_anonymous } = req.query;
    let sql = 'SELECT * FROM posts WHERE 1=1'; const p = []; let i = 0;
    if (tab)         { sql += ` AND tab=$${++i}`;              p.push(tab); }
    if (exclude_tab) { sql += ` AND tab != $${++i}`;           p.push(exclude_tab); }
    if (user_id)     { sql += ` AND user_id=$${++i}`;          p.push(user_id); }
    if (ptype)       { sql += ` AND type=$${++i}`;             p.push(ptype); }
    if (is_anonymous){ sql += ` AND is_anonymous=$${++i}`;     p.push(parseInt(is_anonymous)); }
    if (date)    { sql += ` AND DATE(created_at)=$${++i}`; p.push(date); }
    sql += ` ORDER BY created_at DESC LIMIT $${++i} OFFSET $${++i}`;
    p.push(parseInt(limit), parseInt(offset));
    const posts = await db.prepare(sql).all(...p);
    const enriched = await Promise.all(posts.map(x => enrich(x, req.user?.id)));
    res.json({ posts: enriched });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// GET /api/posts/highlights
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

// POST /api/posts — post de texto (ágora/discussão)

// GET /api/posts/regional — posts da mesma área geográfica
router.get('/regional', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const { lat, lng, radius=30 } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'lat/lng obrigatórios' });
    const R = 6371;
    const dLat = parseFloat(radius)/111;
    const dLng = parseFloat(radius)/(111 * Math.cos(parseFloat(lat)*Math.PI/180));
    const minLat = parseFloat(lat)-dLat, maxLat = parseFloat(lat)+dLat;
    const minLng = parseFloat(lng)-dLng, maxLng = parseFloat(lng)+dLng;
    const posts = await db.prepare(`
      SELECT p.*, u.name as author_name, u.username as author_username,
             u.avatar_url as author_avatar, u.id as author_id,
             (SELECT COUNT(*) FROM comments WHERE post_id=p.id) as comment_count
      FROM posts p JOIN users u ON u.id=p.user_id
      WHERE p.tab='regional'
        AND p.lat BETWEEN $1 AND $2
        AND p.lng BETWEEN $3 AND $4
      ORDER BY p.created_at DESC LIMIT 50
    `).all(minLat, maxLat, minLng, maxLng);
    // Formatar author e reactions
    const formatted = posts.map(p => ({
      ...p,
      author: { id:p.author_id, name:p.author_name, username:p.author_username, avatar_url:p.author_avatar },
      reactions: p.reactions ? (typeof p.reactions==='string'?JSON.parse(p.reactions):p.reactions) : {},
      my_reaction: null
    }));
    res.json({ posts: formatted });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { content, tab='agora', caption, is_anonymous=0, lat, lng, type='text', poll_options } = req.body;
    if (!content && !caption) return res.status(400).json({ error: 'Conteúdo obrigatório' });
    const id = uuidv4();
    const validTabs = ['global','agora','timeline','daily_mandou','regional'];
    const t = validTabs.includes(tab) ? tab : 'agora';
    const postType = ['text','poll'].includes(type) ? type : 'text';
    await db.prepare('INSERT INTO posts (id,user_id,type,content,tab,caption,is_anonymous,lat,lng) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)')
      .run(id, req.user.id, postType, content||caption, t, caption||null, is_anonymous?1:0, lat||null, lng||null);
    await checkAndGrant(db, req.user.id, 'posts');
    pedroAutoComment(id, 'text');
    const post = await db.prepare('SELECT * FROM posts WHERE id=$1').get(id);
    res.status(201).json({ post: await enrich(post, req.user.id) });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// POST /api/posts/photo
router.post('/photo', authMiddleware, (req, res, next) => {
  createPhotoUpload().single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Foto obrigatória' });
    try {
      const db = getDB();
      const { caption='', tab='global', notification_id, lat, lng } = req.body;

      // Daily Mandou: verifica notificação ativa
      if ((tab === 'daily_mandou' || tab === 'geral') && tab !== 'regional') {
        const notif = await db.prepare("SELECT * FROM notifications WHERE active=1 AND expires_at > NOW() ORDER BY sent_at DESC LIMIT 1").get();
        if (!notif) return res.status(403).json({ error: 'Nenhuma notificação ativa. Aguarde o Daily Mandou!' });
      }

      const image_url = getUploadedUrl(req, req.file);
      const id = uuidv4();
      const finalTab = tab === 'geral' ? 'daily_mandou' : (tab || 'global');
      const activeNotif = await db.prepare("SELECT id FROM notifications WHERE active=1 ORDER BY sent_at DESC LIMIT 1").get();

      await db.prepare('INSERT INTO posts (id,user_id,type,image_url,caption,tab,notification_id,lat,lng) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)')
        .run(id, req.user.id, 'photo', image_url, caption, finalTab, activeNotif?.id || null, lat||null, lng||null);

      // Pontos e conquistas
      if (finalTab === 'daily_mandou') {
        await db.prepare('UPDATE users SET points=points+100 WHERE id=$1').run(req.user.id);
        await checkAndGrant(db, req.user.id, 'daily_mandou');
      } else {
        await db.prepare('UPDATE users SET points=points+1 WHERE id=$1').run(req.user.id);
      }
      await checkAndGrant(db, req.user.id, 'photos');
      await checkAndGrant(db, req.user.id, 'posts');

      // Lobo solitário
      const h = new Date().getHours();
      if (h >= 2 && h < 4) await checkAndGrant(db, req.user.id, 'night_owl');

      pedroAutoComment(id, finalTab === 'daily_mandou' ? 'daily_mandou' : 'photo');

      const post = await db.prepare('SELECT * FROM posts WHERE id=$1').get(id);
      res.status(201).json({ post: await enrich(post, req.user.id) });
    } catch(e) { next(e); }
  });
});

// POST /api/posts/:id/react
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
    // Verifica conquista de reações recebidas (para o dono do post)
    const post = await db.prepare('SELECT user_id FROM posts WHERE id=$1').get(req.params.id);
    if (post) {
      await checkAndGrant(db, post.user_id, 'reactions_received');
      // Notificar dono do post
      const reactor = await db.prepare('SELECT name FROM users WHERE id=$1').get(req.user.id);
      await createNotification(db, {
        userId: post.user_id, fromUserId: req.user.id,
        type: 'reaction',
        title: `${reactor.name} reagiu ao seu post ${emoji}`,
        body: post.caption || post.content || '',
        data: { post_id: post.id, emoji }
      });
    }
    res.json({ action:'added', emoji, reactions });
  } catch(e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// GET /api/posts/:id/comments
router.get('/:id/comments', async (req, res) => {
  try {
    const db = getDB();
    const comments = await db.prepare('SELECT c.*,u.name,u.username,u.avatar_url FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=$1 ORDER BY c.created_at ASC').all(req.params.id);
    const safe = comments.map(c => c.is_anonymous ? {...c, name:'Usuário anônimo', username:'anonimo', avatar_url:''} : c);
    res.json({ comments: safe });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/posts/:id/comments
router.post('/:id/comments', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { content, parent_id, is_anonymous=0 } = req.body;
    if (!content) return res.status(400).json({ error: 'Comentário vazio' });
    const id = uuidv4();
    await db.prepare('INSERT INTO comments (id,post_id,user_id,parent_id,content,is_anonymous) VALUES ($1,$2,$3,$4,$5,$6)')
      .run(id, req.params.id, req.user.id, parent_id||null, content, is_anonymous?1:0);
    const comment = await db.prepare('SELECT c.*,u.name,u.username,u.avatar_url FROM comments c JOIN users u ON u.id=c.user_id WHERE c.id=$1').get(id);
    const safe = is_anonymous ? {...comment, name:'Usuário anônimo', username:'anonimo', avatar_url:''} : comment;
    // Notificar dono do post
    const postRow = await db.prepare('SELECT * FROM posts WHERE id=$1').get(req.params.id);
    if (postRow && !is_anonymous) {
      const commenter = await db.prepare('SELECT name FROM users WHERE id=$1').get(req.user.id);
      await createNotification(db, {
        userId: postRow.user_id, fromUserId: req.user.id,
        type: 'comment',
        title: `${commenter.name} comentou no seu post`,
        body: content.substring(0, 80),
        data: { post_id: postRow.id }
      });
    }
    res.status(201).json({ comment: safe });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
