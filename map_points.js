const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware, optionalAuth } = require('./authmiddleware');
const { createPhotoUpload, getUploadedUrl } = require('./cloudinary');

const router = express.Router();

// Verifica se usuário é ADM ou MOD
async function canManageMap(db, userId) {
  const u = await db.prepare('SELECT is_admin, is_moderator FROM users WHERE id=$1').get(userId);
  return u && (u.is_admin || u.is_moderator);
}

async function canManagePoint(db, userId, pointId) {
  const u = await db.prepare('SELECT is_admin, is_moderator FROM users WHERE id=$1').get(userId);
  if (u && (u.is_admin || u.is_moderator)) return true;
  const p = await db.prepare('SELECT created_by FROM map_points WHERE id=$1').get(pointId);
  return p && p.created_by === userId;
}

// Distância em metros entre dois pontos
function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── MAP POINTS ───

// GET /api/map-points — todos os pontos (público)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const { route_id } = req.query;
    let sql = `SELECT mp.*, u.name as creator_name,
      (SELECT COUNT(*) FROM user_checkins WHERE point_id=mp.id) as checkin_count
      FROM map_points mp JOIN users u ON u.id=mp.created_by WHERE mp.active=true`;
    const p = [];
    if (route_id) { sql += ` AND mp.route_id=$1`; p.push(route_id); }
    sql += ` ORDER BY mp.created_at DESC`;
    const points = await db.prepare(sql).all(...p);
    // Para usuário logado, marcar quais já fez check-in
    if (req.user) {
      const checkins = await db.prepare('SELECT point_id FROM user_checkins WHERE user_id=$1').all(req.user.id);
      const done = new Set(checkins.map(c => c.point_id));
      points.forEach(p => p.checked_in = done.has(p.id));
    }
    res.json({ points });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/map-points — criar ponto (ADM/MOD)
router.post('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    if (!await canManageMap(db, req.user.id)) return res.status(403).json({ error: 'Sem permissão' });
    const { title, description, lat, lng, points=100, checkin_radius=100, route_id, icon='🏆', category='geral' } = req.body;
    if (!title || !lat || !lng) return res.status(400).json({ error: 'título, lat e lng obrigatórios' });
    const id = uuidv4();
    await db.prepare(`INSERT INTO map_points (id,title,description,lat,lng,points,checkin_radius,route_id,icon,category,created_by,active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)`)
      .run(id, title.trim(), description||'', parseFloat(lat), parseFloat(lng), parseInt(points), parseInt(checkin_radius), route_id||null, icon, category, req.user.id);
    const point = await db.prepare('SELECT * FROM map_points WHERE id=$1').get(id);
    res.status(201).json({ point });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/map-points/routes
router.get('/routes/all', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const routes = await db.prepare(`
      SELECT mr.*, u.name as creator_name,
        (SELECT COUNT(*) FROM map_points WHERE route_id=mr.id AND active=true) as points_count
      FROM map_routes mr JOIN users u ON u.id=mr.created_by
      WHERE mr.active=true ORDER BY mr.created_at DESC
    `).all();
    if (req.user) {
      for (const r of routes) {
        const total = parseInt(r.points_count);
        const done = parseInt((await db.prepare(`
          SELECT COUNT(*) as c FROM user_checkins uc
          JOIN map_points mp ON mp.id=uc.point_id
          WHERE mp.route_id=$1 AND uc.user_id=$2
        `).get(r.id, req.user.id))?.c || 0);
        r.user_progress = { done, total };
      }
    }
    res.json({ routes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/map-points/routes — criar roteiro (ADM/MOD)
router.post('/routes', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    if (!await canManageMap(db, req.user.id)) return res.status(403).json({ error: 'Sem permissão' });
    const { title, description, city, state, country='BR', icon='🗺️', category='cultura' } = req.body;
    if (!title) return res.status(400).json({ error: 'Título obrigatório' });
    const id = uuidv4();
    await db.prepare(`INSERT INTO map_routes (id,title,description,city,state,country,icon,category,created_by,active)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)`)
      .run(id, title.trim(), description||'', city||'', state||'', country, icon, category, req.user.id);
    res.status(201).json({ route: await db.prepare('SELECT * FROM map_routes WHERE id=$1').get(id) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/map-points/:id — editar ponto (ADM/MOD)
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    if (!await canManagePoint(db, req.user.id, req.params.id)) return res.status(403).json({ error: 'Sem permissão' });
    const { title, description, points, checkin_radius, icon, category, active } = req.body;
    await db.prepare(`UPDATE map_points SET
      title=COALESCE($1,title), description=COALESCE($2,description),
      points=COALESCE($3,points), checkin_radius=COALESCE($4,checkin_radius),
      icon=COALESCE($5,icon), category=COALESCE($6,category),
      active=COALESCE($7,active) WHERE id=$8`)
      .run(title||null, description||null, points?parseInt(points):null, checkin_radius?parseInt(checkin_radius):null,
           icon||null, category||null, active!=null?parseInt(active):null, req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/map-points/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    if (!await canManagePoint(db, req.user.id, req.params.id)) return res.status(403).json({ error: 'Sem permissão' });
    await db.prepare('UPDATE map_points SET active=false WHERE id=$1').run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/map-points/:id/checkin — check-in com foto
router.post('/:id/checkin', authMiddleware, (req, res, next) => {
  createPhotoUpload().single('photo')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const db = getDB();
      const point = await db.prepare('SELECT * FROM map_points WHERE id=$1 AND active=true').get(req.params.id);
      if (!point) return res.status(404).json({ error: 'Ponto não encontrado' });

      // Verifica se já fez check-in
      const already = await db.prepare('SELECT id FROM user_checkins WHERE user_id=$1 AND point_id=$2').get(req.user.id, req.params.id);
      if (already) return res.status(409).json({ error: 'Você já fez check-in neste local!' });

      // Valida geolocalização
      const { user_lat, user_lng } = req.body;
      if (!user_lat || !user_lng) return res.status(400).json({ error: 'Localização obrigatória para check-in' });
      const dist = distanceMeters(parseFloat(user_lat), parseFloat(user_lng), point.lat, point.lng);
      if (dist > point.checkin_radius) {
        return res.status(403).json({
          error: `Você está longe demais! Precisa estar a ${point.checkin_radius}m do local. Distância atual: ${Math.round(dist)}m.`,
          distance: Math.round(dist), required: point.checkin_radius
        });
      }

      // Salva foto se enviada
      let image_url = null;
      if (req.file) {
        image_url = getUploadedUrl(req, req.file);
        // Também cria post global com a foto
        const postId = uuidv4();
        await db.prepare(`INSERT INTO posts (id,user_id,type,image_url,caption,tab)
          VALUES ($1,$2,'photo',$3,$4,'global')`)
          .run(postId, req.user.id, image_url, `📍 Check-in em: ${point.title}`);
      }

      // Registra check-in
      const id = uuidv4();
      await db.prepare('INSERT INTO user_checkins (id,user_id,point_id,image_url,distance_m) VALUES ($1,$2,$3,$4,$5)')
        .run(id, req.user.id, req.params.id, image_url, Math.round(dist));

      // Adiciona pontos ao usuário
      await db.prepare('UPDATE users SET points=points+$1 WHERE id=$2').run(point.points, req.user.id);

      // Cria conquista dinâmica para este ponto se não existir
      const achSlug = `checkin_${req.params.id}`;
      let ach = await db.prepare('SELECT id FROM achievements WHERE slug=$1').get(achSlug);
      if (!ach) {
        const achId = uuidv4();
        await db.prepare(`INSERT INTO achievements (id,slug,name,description,category,points,icon,requirement_type,requirement_value)
          VALUES ($1,$2,$3,$4,'local',$5,$6,'checkin',1) ON CONFLICT(slug) DO NOTHING`)
          .run(achId, achSlug, `Check-in: ${point.title}`, point.description||`Visitou ${point.title}`, point.points, point.icon||'🏆');
        ach = { id: achId };
      } else {
        ach = await db.prepare('SELECT id FROM achievements WHERE slug=$1').get(achSlug);
      }
      // Concede a conquista
      await db.prepare('INSERT INTO user_achievements (id,user_id,achievement_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING')
        .run(uuidv4(), req.user.id, ach.id);

      res.status(201).json({
        ok: true,
        message: `Check-in realizado! +${point.points} pontos 🎉`,
        points_earned: point.points,
        distance_m: Math.round(dist)
      });
    } catch(e) { next(e); }
  });
});

// GET /api/map-points/:id/checkins — quem já fez check-in
router.get('/:id/checkins', async (req, res) => {
  try {
    const db = getDB();
    const checkins = await db.prepare(`
      SELECT uc.*, u.name, u.username, u.avatar_url
      FROM user_checkins uc JOIN users u ON u.id=uc.user_id
      WHERE uc.point_id=$1 ORDER BY uc.created_at DESC LIMIT 20
    `).all(req.params.id);
    res.json({ checkins });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── ROUTES (Roteiros) ───



module.exports = router;
