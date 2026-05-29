const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware, optionalAuth } = require('./authmiddleware');
const { checkAndGrant } = require('./achievements');

const router = express.Router();

// GET /api/communities — listar comunidades
router.get('/', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const { type, country, state, city, neighborhood, search, limit=30, offset=0 } = req.query;
    let sql = `SELECT c.*, u.name as owner_name, u.username as owner_username,
      (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id=c.id) as member_count
      FROM communities c JOIN users u ON u.id=c.owner_id WHERE 1=1`;
    const p = []; let i = 0;
    if (type)         { sql += ` AND c.type=$${++i}`; p.push(type); }
    if (country)      { sql += ` AND c.country=$${++i}`; p.push(country); }
    if (state)        { sql += ` AND c.state=$${++i}`; p.push(state); }
    if (city)         { sql += ` AND c.city=$${++i}`; p.push(city); }
    if (neighborhood) { sql += ` AND c.neighborhood=$${++i}`; p.push(neighborhood); }
    if (search)       { sql += ` AND (c.name ILIKE $${++i} OR c.description ILIKE $${++i})`; p.push(`%${search}%`); p.push(`%${search}%`); i++; }
    sql += ` ORDER BY member_count DESC, c.created_at DESC LIMIT $${++i} OFFSET $${++i}`;
    p.push(parseInt(limit), parseInt(offset));
    const communities = await db.prepare(sql).all(...p);
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

// GET /api/communities/:id
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const c = await db.prepare(`
      SELECT c.*, u.name as owner_name, u.username as owner_username,
        (SELECT COUNT(*) FROM community_members cm WHERE cm.community_id=c.id) as member_count
      FROM communities c JOIN users u ON u.id=c.owner_id WHERE c.id=$1
    `).get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Comunidade não encontrada' });
    const members = await db.prepare(`
      SELECT u.id, u.name, u.username, u.avatar_url, cm.role, cm.joined_at
      FROM community_members cm JOIN users u ON u.id=cm.user_id
      WHERE cm.community_id=$1 ORDER BY cm.role DESC, cm.joined_at ASC LIMIT 20
    `).all(req.params.id);
    let is_member = false, my_role = null;
    if (req.user) {
      const m = await db.prepare('SELECT role FROM community_members WHERE community_id=$1 AND user_id=$2').get(req.params.id, req.user.id);
      is_member = !!m; my_role = m?.role;
    }
    res.json({ community: c, members, is_member, my_role });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/communities — criar comunidade
router.post('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { name, description, type='interest', category='geral', country, state, city, neighborhood, is_open=1 } = req.body;
    if (!name || name.trim().length < 3) return res.status(400).json({ error: 'Nome muito curto' });
    const id = uuidv4();
    await db.prepare(`INSERT INTO communities (id,name,description,type,category,country,state,city,neighborhood,is_open,owner_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`)
      .run(id, name.trim(), description||'', type, category, country||null, state||null, city||null, neighborhood||null, is_open?1:0, req.user.id);
    // Auto-join como owner/moderator
    await db.prepare('INSERT INTO community_members (id,community_id,user_id,role) VALUES ($1,$2,$3,$4)')
      .run(uuidv4(), id, req.user.id, 'owner');
    await checkAndGrant(db, req.user.id, 'community_created');
    await checkAndGrant(db, req.user.id, 'communities');
    const c = await db.prepare('SELECT * FROM communities WHERE id=$1').get(id);
    res.status(201).json({ community: c });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/communities/:id/join
router.post('/:id/join', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const c = await db.prepare('SELECT * FROM communities WHERE id=$1').get(req.params.id);
    if (!c) return res.status(404).json({ error: 'Comunidade não encontrada' });
    const existing = await db.prepare('SELECT id FROM community_members WHERE community_id=$1 AND user_id=$2').get(req.params.id, req.user.id);
    if (existing) return res.status(409).json({ error: 'Você já é membro' });
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
    await db.prepare('DELETE FROM community_members WHERE community_id=$1 AND user_id=$2').run(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/communities/:id/posts
router.get('/:id/posts', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const posts = await db.prepare(`
      SELECT cp.*, u.name, u.username, u.avatar_url FROM community_posts cp
      JOIN users u ON u.id=cp.user_id WHERE cp.community_id=$1 ORDER BY cp.created_at DESC LIMIT 50
    `).all(req.params.id);
    res.json({ posts });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/communities/:id/posts
router.post('/:id/posts', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const member = await db.prepare('SELECT id FROM community_members WHERE community_id=$1 AND user_id=$2').get(req.params.id, req.user.id);
    if (!member) return res.status(403).json({ error: 'Você precisa ser membro para postar' });
    const { content } = req.body;
    if (!content || content.trim().length < 2) return res.status(400).json({ error: 'Conteúdo vazio' });
    const id = uuidv4();
    await db.prepare('INSERT INTO community_posts (id,community_id,user_id,content) VALUES ($1,$2,$3,$4)')
      .run(id, req.params.id, req.user.id, content.trim());
    const post = await db.prepare(`
      SELECT cp.*, u.name, u.username, u.avatar_url FROM community_posts cp
      JOIN users u ON u.id=cp.user_id WHERE cp.id=$1
    `).get(id);
    res.status(201).json({ post });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
