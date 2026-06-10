const { NotificationService } = require('./notif_service');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware, optionalAuth } = require('./authmiddleware');
const { checkAndGrant } = require('./achievements');
const { createPhotoUpload, getUploadedUrl } = require('./cloudinary');

const router = express.Router();

// GET /api/communities
router.get('/', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const { type, country, state, city, neighborhood, search, limit=40, offset=0, exclude_type, mine, sort } = req.query;
    const p = [];
    const conditions = ['1=1'];

    // mine=1: só comunidades onde o usuário logado é membro
    if (mine === '1' && req.user) {
      conditions.push(`c.id IN (SELECT community_id FROM community_members WHERE user_id=$${p.push(req.user.id)})`);
    }

    if (type)         { conditions.push(`c.type=$${p.push(type)}`); }
    else if (exclude_type) { conditions.push(`c.type != $${p.push(exclude_type)}`); }
    if (country)      { conditions.push(`c.country=$${p.push(country)}`); }
    if (state)        { conditions.push(`c.state=$${p.push(state)}`); }
    if (city)         { conditions.push(`c.city ILIKE $${p.push('%'+city+'%')}`); }
    if (neighborhood) { conditions.push(`c.neighborhood=$${p.push(neighborhood)}`); }
    if (search) {
      const si = p.push('%'+search+'%');
      conditions.push(`(c.name ILIKE $${si} OR c.description ILIKE $${si})`);
    }

    const orderBy = sort === 'members' ? 'member_count DESC' : 'member_count DESC, c.created_at DESC';
    const limitIdx = p.push(parseInt(limit));
    const offsetIdx = p.push(parseInt(offset));

    const sql = `SELECT c.*, u.name as owner_name, u.username as owner_username,
      (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id=c.id) as member_count
      FROM communities c JOIN users u ON u.id=c.owner_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY ${orderBy} LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

    const communities = await db.prepare(sql).all(...p);

    // Marcar quais o usuário já é membro
    if (req.user) {
      const myComms = await db.prepare('SELECT community_id FROM community_members WHERE user_id=$1').all(req.user.id);
      const mySet = new Set(myComms.map(m => m.community_id));
      communities.forEach(c => c.is_member = mySet.has(c.id));
    }

    res.json({ communities });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/communities/mine
router.get('/mine', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const communities = await db.prepare(`
      SELECT c.*, cm.role,
        (SELECT COUNT(*) FROM community_members cm2 WHERE cm2.community_id=c.id) as member_count
      FROM community_members cm JOIN communities c ON c.id=cm.community_id
      WHERE cm.user_id=$1 ORDER BY cm.joined_at DESC
    `).all(req.user.id);
    res.json({ communities });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/communities/:id — detalhes completos da comunidade
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const c = await db.prepare(`
      SELECT c.*, u.name as owner_name, u.username as owner_username, u.avatar_url as owner_avatar,
        (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id=c.id) as member_count
      FROM communities c JOIN users u ON u.id=c.owner_id WHERE c.id=$1
    `).get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Comunidade não encontrada' });

    const members = await db.prepare(`
      SELECT u.id, u.name, u.username, u.avatar_url, cm.role, cm.joined_at
      FROM community_members cm JOIN users u ON u.id=cm.user_id
      WHERE cm.community_id=$1 ORDER BY cm.role DESC, cm.joined_at ASC LIMIT 30
    `).all(req.params.id);

    let is_member = false, my_role = null;
    if (req.user) {
      const m = await db.prepare('SELECT role FROM community_members WHERE community_id=$1 AND user_id=$2').get(req.params.id, req.user.id);
      is_member = !!m; my_role = m?.role;
    }
    res.json({ community: c, members, is_member, my_role });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/communities
router.post('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { name, description, type='interest', category='geral', country, state, city, neighborhood, is_open=1 } = req.body;
    if (!name || name.trim().length < 3) return res.status(400).json({ error: 'Nome muito curto (mínimo 3 caracteres)' });
    const id = uuidv4();
    await db.prepare(`INSERT INTO communities (id,name,description,type,category,country,state,city,neighborhood,is_open,owner_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`)
      .run(id, name.trim(), description||'', type, category, country||null, state||null, city||null, neighborhood||null, is_open?1:0, req.user.id);
    await db.prepare('INSERT INTO community_members (id,community_id,user_id,role) VALUES ($1,$2,$3,$4)')
      .run(uuidv4(), id, req.user.id, 'owner');
    await checkAndGrant(db, req.user.id, 'community_created');
    await checkAndGrant(db, req.user.id, 'communities');
    const comm = await db.prepare('SELECT * FROM communities WHERE id=$1').get(id);
    res.status(201).json({ community: comm });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/communities/:id/join
router.post('/:id/join', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const c = await db.prepare('SELECT * FROM communities WHERE id=$1').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Comunidade não encontrada' });
    const existing = await db.prepare('SELECT id FROM community_members WHERE community_id=$1 AND user_id=$2').get(req.params.id, req.user.id);
    if (existing) return res.status(409).json({ error: 'Você já é membro desta comunidade' });
    await db.prepare('INSERT INTO community_members (id,community_id,user_id,role) VALUES ($1,$2,$3,$4)')
      .run(uuidv4(), req.params.id, req.user.id, 'member');
    await checkAndGrant(db, req.user.id, 'communities');
    res.json({ ok: true, message: 'Entrou na comunidade!' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/communities/:id/leave
router.delete('/:id/leave', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    await db.prepare('DELETE FROM community_members WHERE community_id=$1 AND user_id=$2 AND role != $3').run(req.params.id, req.user.id, 'owner');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── POSTS DA COMUNIDADE ───
// GET /api/communities/:id/posts
router.get('/:id/posts', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const { limit=50, offset=0 } = req.query;
    const posts = await db.prepare(`
      SELECT cp.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar,
        (SELECT COUNT(*) FROM community_post_reactions WHERE post_id=cp.id) as reaction_count,
        (SELECT COUNT(*) FROM community_post_comments WHERE post_id=cp.id) as comment_count
      FROM community_posts cp JOIN users u ON u.id=cp.user_id
      WHERE cp.community_id=$1 ORDER BY cp.created_at DESC LIMIT $2 OFFSET $3
    `).all(req.params.id, parseInt(limit), parseInt(offset));

    // Enrich reactions
    for (const p of posts) {
      p.reactions = await db.prepare(
        'SELECT emoji, COUNT(*) as count FROM community_post_reactions WHERE post_id=$1 GROUP BY emoji'
      ).all(p.id);
    }
    res.json({ posts });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/communities/:id/posts — texto
router.post('/:id/posts', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const member = await db.prepare('SELECT id FROM community_members WHERE community_id=$1 AND user_id=$2').get(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ error: 'Você precisa ser membro para postar' });
    const { content, post_type='text' } = req.body;
    if (!content || content.trim().length < 1) return res.status(400).json({ error: 'Conteúdo vazio' });
    const id = uuidv4();
    await db.prepare('INSERT INTO community_posts (id,community_id,user_id,content,post_type) VALUES ($1,$2,$3,$4,$5)')
      .run(id, req.params.id, req.user.id, content.trim(), post_type);
    const post = await db.prepare(`
      SELECT cp.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar
      FROM community_posts cp JOIN users u ON u.id=cp.user_id WHERE cp.id=$1
    `).get(id);
    res.status(201).json({ post });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/communities/:id/posts/photo
router.post('/:id/posts/photo', authMiddleware, (req, res, next) => {
  createPhotoUpload().single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Foto obrigatória' });
    try {
      const db = getDB();
      const member = await db.prepare('SELECT id FROM community_members WHERE community_id=$1 AND user_id=$2').get(req.params.id, req.user.id);
      if (!member) return res.status(403).json({ error: 'Você precisa ser membro para postar' });
      const image_url = getUploadedUrl(req, req.file);
      const { caption='' } = req.body;
      const id = uuidv4();
      await db.prepare('INSERT INTO community_posts (id,community_id,user_id,content,image_url,post_type) VALUES ($1,$2,$3,$4,$5,$6)')
        .run(id, req.params.id, req.user.id, caption||'', image_url, 'photo');
      const post = await db.prepare(`
        SELECT cp.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar
        FROM community_posts cp JOIN users u ON u.id=cp.user_id WHERE cp.id=$1
      `).get(id);
      res.status(201).json({ post });
    } catch(e) { next(e); }
  });
});

// POST /api/communities/:id/posts/poll — enquete
router.post('/:id/posts/poll', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const member = await db.prepare('SELECT id FROM community_members WHERE community_id=$1 AND user_id=$2').get(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ error: 'Você precisa ser membro para postar' });
    const { question, options } = req.body;
    if (!question || !options || options.length < 2) return res.status(400).json({ error: 'Enquete precisa de pergunta e pelo menos 2 opções' });
    const id = uuidv4();
    const pollData = JSON.stringify({ question, options: options.map(o => ({ text: o, votes: 0, voter_ids: [] })) });
    await db.prepare('INSERT INTO community_posts (id,community_id,user_id,content,post_type,poll_data) VALUES ($1,$2,$3,$4,$5,$6)')
      .run(id, req.params.id, req.user.id, question, 'poll', pollData);
    const post = await db.prepare(`
      SELECT cp.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar
      FROM community_posts cp JOIN users u ON u.id=cp.user_id WHERE cp.id=$1
    `).get(id);
    res.status(201).json({ post });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/communities/:id/posts/:postId/vote
router.post('/:id/posts/:postId/vote', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const post = await db.prepare('SELECT * FROM community_posts WHERE id=$1 AND post_type=$2').get(req.params.postId, 'poll');
    if (!post) return res.status(404).json({ error: 'Enquete não encontrada' });
    const poll = typeof post.poll_data === 'string' ? JSON.parse(post.poll_data) : post.poll_data;
    const { option_index } = req.body;
    // Verifica se já votou
    const alreadyVoted = poll.options.some(o => o.voter_ids?.includes(req.user.id));
    if (alreadyVoted) return res.status(409).json({ error: 'Você já votou nesta enquete' });
    if (option_index < 0 || option_index >= poll.options.length) return res.status(400).json({ error: 'Opção inválida' });
    poll.options[option_index].votes = (poll.options[option_index].votes || 0) + 1;
    poll.options[option_index].voter_ids = poll.options[option_index].voter_ids || [];
    poll.options[option_index].voter_ids.push(req.user.id);
    await db.prepare('UPDATE community_posts SET poll_data=$1 WHERE id=$2').run(JSON.stringify(poll), req.params.postId);
    res.json({ poll });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/communities/:id/posts/:postId/react
router.post('/:id/posts/:postId/react', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { emoji } = req.body;
    const ex = await db.prepare('SELECT id FROM community_post_reactions WHERE post_id=$1 AND user_id=$2 AND emoji=$3').get(req.params.postId, req.user.id, emoji);
    if (ex) {
      await db.prepare('DELETE FROM community_post_reactions WHERE post_id=$1 AND user_id=$2 AND emoji=$3').run(req.params.postId, req.user.id, emoji);
      return res.json({ action: 'removed' });
    }
    await db.prepare('INSERT INTO community_post_reactions (id,post_id,user_id,emoji) VALUES ($1,$2,$3,$4)').run(uuidv4(), req.params.postId, req.user.id, emoji);
    const reactions = await db.prepare('SELECT emoji, COUNT(*) as count FROM community_post_reactions WHERE post_id=$1 GROUP BY emoji').all(req.params.postId);
    res.json({ action: 'added', reactions });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/communities/:id/posts/:postId/comments
router.get('/:id/posts/:postId/comments', async (req, res) => {
  try {
    const db = getDB();
    const comments = await db.prepare(`
      SELECT cc.*, u.name, u.username, u.avatar_url
      FROM community_post_comments cc JOIN users u ON u.id=cc.user_id
      WHERE cc.post_id=$1 ORDER BY cc.created_at ASC
    `).all(req.params.postId);
    res.json({ comments });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/communities/:id/posts/:postId/comments
router.post('/:id/posts/:postId/comments', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Comentário vazio' });
    const id = uuidv4();
    await db.prepare('INSERT INTO community_post_comments (id,post_id,community_id,user_id,content) VALUES ($1,$2,$3,$4,$5)')
      .run(id, req.params.postId, req.params.id, req.user.id, content);
    const comment = await db.prepare(`
      SELECT cc.*, u.name, u.username, u.avatar_url
      FROM community_post_comments cc JOIN users u ON u.id=cc.user_id WHERE cc.id=$1
    `).get(id);
    res.status(201).json({ comment });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// DELETE /api/communities/:id/posts/:postId
router.delete('/:id/posts/:postId', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const post = await db.prepare('SELECT * FROM community_posts WHERE id=$1').get(req.params.postId);
    if (!post) return res.status(404).json({ error: 'Post não encontrado' });
    // Só dono do post ou dono/mod da comunidade pode apagar
    const member = await db.prepare("SELECT role FROM community_members WHERE community_id=$1 AND user_id=$2").get(req.params.id, req.user.id);
    if (post.user_id !== req.user.id && !['owner','moderator'].includes(member?.role)) {
      return res.status(403).json({ error: 'Sem permissão' });
    }
    await db.prepare('DELETE FROM community_post_reactions WHERE post_id=$1').run(req.params.postId);
    await db.prepare('DELETE FROM community_post_comments WHERE post_id=$1').run(req.params.postId);
    await db.prepare('DELETE FROM community_posts WHERE id=$1').run(req.params.postId);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// PUT /api/communities/:id — editar comunidade (só dono)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const member = await db.prepare("SELECT role FROM community_members WHERE community_id=$1 AND user_id=$2").get(req.params.id, req.user.id);
    if (member?.role !== 'owner') return res.status(403).json({ error: 'Apenas o dono pode editar a comunidade' });
    const { name, description, is_open, image_url } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
    if (image_url) {
      await db.prepare('UPDATE communities SET name=$1, description=$2, is_open=$3, image_url=$4 WHERE id=$5')
        .run(name, description||'', is_open ? 1 : 0, image_url, req.params.id);
    } else {
      await db.prepare('UPDATE communities SET name=$1, description=$2, is_open=$3 WHERE id=$4')
        .run(name, description||'', is_open ? 1 : 0, req.params.id);
    }
    const updated = await db.prepare('SELECT * FROM communities WHERE id=$1').get(req.params.id);
    res.json({ community: updated });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/communities/:id/photo — upload foto da comunidade (só dono)
router.post('/:id/photo', authMiddleware, (req, res, next) => {
  createPhotoUpload().single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const db = getDB();
      const member = await db.prepare("SELECT role FROM community_members WHERE community_id=$1 AND user_id=$2").get(req.params.id, req.user.id);
      if (member?.role !== 'owner') return res.status(403).json({ error: 'Apenas o dono pode editar' });
      if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' });
      const image_url = getUploadedUrl(req, req.file);
      await db.prepare('UPDATE communities SET image_url=$1 WHERE id=$2').run(image_url, req.params.id);
      res.json({ image_url });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
});

module.exports = router;
