const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');
const { createPhotoUpload, getUploadedUrl } = require('./cloudinary');

const router = express.Router();

// Função central: verificar e conceder conquistas
async function checkAndGrant(db, userId, type) {
  try {
    const achievements = await db.prepare("SELECT * FROM achievements WHERE requirement_type=$1").all(type);
    for (const ach of achievements) {
      const already = await db.prepare('SELECT id FROM user_achievements WHERE user_id=$1 AND achievement_id=$2').get(userId, ach.id);
      if (already) continue;
      let count = 0;
      switch(type) {
        case 'friends':
          count = parseInt((await db.prepare(`
            SELECT COUNT(*) as c FROM friendships
            WHERE (requester_id=$1 OR addressee_id=$1) AND status='accepted'
          `).get(userId))?.c || 0); break;
        case 'posts':
          count = parseInt((await db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id=$1').get(userId))?.c || 0); break;
        case 'photos':
          count = parseInt((await db.prepare("SELECT COUNT(*) as c FROM posts WHERE user_id=$1 AND type='photo'").get(userId))?.c || 0); break;
        case 'daily_mandou':
          count = parseInt((await db.prepare("SELECT COUNT(*) as c FROM posts WHERE user_id=$1 AND tab='daily_mandou'").get(userId))?.c || 0); break;
        case 'communities':
          count = parseInt((await db.prepare('SELECT COUNT(*) as c FROM community_members WHERE user_id=$1').get(userId))?.c || 0); break;
        case 'community_created':
          count = parseInt((await db.prepare('SELECT COUNT(*) as c FROM communities WHERE owner_id=$1').get(userId))?.c || 0); break;
        case 'testimonial_given':
          count = parseInt((await db.prepare('SELECT COUNT(*) as c FROM testimonials WHERE author_id=$1').get(userId))?.c || 0); break;
        case 'testimonial_received':
          count = parseInt((await db.prepare('SELECT COUNT(*) as c FROM testimonials WHERE target_id=$1').get(userId))?.c || 0); break;
        case 'reactions_received':
          count = parseInt((await db.prepare('SELECT COUNT(*) as c FROM reactions WHERE post_id IN (SELECT id FROM posts WHERE user_id=$1)').get(userId))?.c || 0); break;
        case 'login': count = 1; break;
        case 'avatar':
          const u = await db.prepare('SELECT avatar_url FROM users WHERE id=$1').get(userId);
          count = u?.avatar_url ? 1 : 0; break;
        case 'profile_complete':
          const up = await db.prepare('SELECT avatar_url, bio FROM users WHERE id=$1').get(userId);
          count = (up?.avatar_url && up?.bio && up.bio.length > 5) ? 1 : 0; break;
        case 'night_owl':
          const hour = new Date().getHours();
          count = (hour >= 2 && hour < 4) ? 1 : 0; break;
      }
      if (count >= ach.requirement_value) {
        await db.prepare('INSERT INTO user_achievements (id,user_id,achievement_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING')
          .run(uuidv4(), userId, ach.id);
        await db.prepare('UPDATE users SET points=points+$1 WHERE id=$2').run(ach.points, userId);
      }
    }
  } catch(e) { console.error('Achievement check error:', e.message); }
}

// GET /api/achievements — todos os achievements
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const achievements = await db.prepare('SELECT * FROM achievements ORDER BY category, points ASC').all();
    res.json({ achievements });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/achievements/me — minhas conquistas
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const earned = await db.prepare(`
      SELECT a.*, ua.earned_at FROM user_achievements ua
      JOIN achievements a ON a.id=ua.achievement_id
      WHERE ua.user_id=$1 ORDER BY ua.earned_at DESC
    `).all(req.user.id);
    const all = await db.prepare('SELECT * FROM achievements WHERE active IS NOT FALSE ORDER BY category, points ASC').all();
    const earnedIds = new Set(earned.map(e => e.id));
    const locked = all.filter(a => !earnedIds.has(a.id));
    res.json({ earned, locked, total_earned: earned.length, total: all.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/achievements/user/:username
router.get('/user/:username', async (req, res) => {
  try {
    const db = getDB();
    const username = req.params.username.replace(/^@/,'').toLowerCase();
    const user = await db.prepare('SELECT id FROM users WHERE username=$1').get(username);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    const earned = await db.prepare(`
      SELECT a.*, ua.earned_at FROM user_achievements ua
      JOIN achievements a ON a.id=ua.achievement_id
      WHERE ua.user_id=$1 ORDER BY ua.earned_at DESC
    `).all(user.id);
    res.json({ earned });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/achievements/badges/me — badges em destaque
router.get('/badges/me', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const badges = await db.prepare(`
      SELECT fb.slot, a.* FROM featured_badges fb
      JOIN achievements a ON a.id=fb.achievement_id
      WHERE fb.user_id=$1 ORDER BY fb.slot ASC
    `).all(req.user.id);
    res.json({ badges });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/achievements/badges — definir badges em destaque (até 5)
router.put('/badges', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { badge_ids } = req.body; // array de até 5 achievement_ids
    if (!Array.isArray(badge_ids) || badge_ids.length > 5)
      return res.status(400).json({ error: 'Máximo 5 badges' });
    await db.prepare('DELETE FROM featured_badges WHERE user_id=$1').run(req.user.id);
    for (let i = 0; i < badge_ids.length; i++) {
      const earned = await db.prepare('SELECT id FROM user_achievements WHERE user_id=$1 AND achievement_id=$2').get(req.user.id, badge_ids[i]);
      if (earned) {
        await db.prepare('INSERT INTO featured_badges (user_id,achievement_id,slot) VALUES ($1,$2,$3) ON CONFLICT(user_id,slot) DO UPDATE SET achievement_id=$2')
          .run(req.user.id, badge_ids[i], i + 1);
      }
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/achievements — criar conquista (admin)
router.post('/', authMiddleware, (req, res, next) => {
  createPhotoUpload().single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const db = getDB();
      const u = await db.prepare('SELECT is_admin FROM users WHERE id=$1').get(req.user.id);
      if (!u?.is_admin) return res.status(403).json({ error: 'Apenas admins podem criar conquistas' });
      const { name, description, icon, points, category, trigger_type } = req.body;
      if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
      let image_url = null;
      if (req.file) image_url = await getUploadedUrl(req.file);
      const id = uuidv4();
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') + '-' + Date.now();
      await db.prepare(`INSERT INTO achievements (id,slug,name,description,icon,image_url,points,category,trigger_type,requirement_type,requirement_value,active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)`)
        .run(id, slug, name.trim(), description||'', icon||'🏆', image_url, parseInt(points)||100, category||'geral', trigger_type||'manual', trigger_type||'manual', 1);
      const ach = await db.prepare('SELECT * FROM achievements WHERE id=$1').get(id);
      res.status(201).json({ achievement: ach });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
});

// PUT /api/achievements/:id — editar conquista (admin)
router.put('/:id', authMiddleware, (req, res, next) => {
  createPhotoUpload().single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const db = getDB();
      const u = await db.prepare('SELECT is_admin FROM users WHERE id=$1').get(req.user.id);
      if (!u?.is_admin) return res.status(403).json({ error: 'Apenas admins podem editar conquistas' });
      const { name, description, icon, points, category } = req.body;
      let image_url = undefined;
      if (req.file) image_url = await getUploadedUrl(req.file);
      const sets = [];
      const vals = [];
      let i = 1;
      if (name) { sets.push(`name=$${i++}`); vals.push(name); }
      if (description !== undefined) { sets.push(`description=$${i++}`); vals.push(description); }
      if (icon) { sets.push(`icon=$${i++}`); vals.push(icon); }
      if (points) { sets.push(`points=$${i++}`); vals.push(parseInt(points)); }
      if (category) { sets.push(`category=$${i++}`); vals.push(category); }
      if (image_url) { sets.push(`image_url=$${i++}`); vals.push(image_url); }
      if (sets.length) {
        vals.push(req.params.id);
        await db.prepare(`UPDATE achievements SET ${sets.join(',')} WHERE id=$${i}`).run(...vals);
      }
      const ach = await db.prepare('SELECT * FROM achievements WHERE id=$1').get(req.params.id);
      res.json({ achievement: ach });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
});

// DELETE /api/achievements/:id — desativar conquista (admin)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const u = await db.prepare('SELECT is_admin FROM users WHERE id=$1').get(req.user.id);
    if (!u?.is_admin) return res.status(403).json({ error: 'Apenas admins podem apagar conquistas' });
    await db.prepare('UPDATE achievements SET active=false WHERE id=$1').run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/achievements/ranking
router.get('/ranking', async (req, res) => {
  try {
    const db = getDB();
    const users = await db.prepare(`
      SELECT u.id, u.name, u.username, u.avatar_url, u.points,
             COUNT(ua.id) as achievements_count
      FROM users u
      LEFT JOIN user_achievements ua ON ua.user_id=u.id
      GROUP BY u.id ORDER BY u.points DESC, achievements_count DESC LIMIT 50
    `).all();
    res.json({ users });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
module.exports.checkAndGrant = checkAndGrant;
