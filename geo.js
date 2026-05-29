const express = require('express');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');

const router = express.Router();

// PUT /api/geo/location — atualiza localização do usuário
router.put('/location', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { lat, lng } = req.body;
    if (!lat || !lng) return res.status(400).json({ error: 'lat e lng obrigatórios' });
    await db.prepare(`
      INSERT INTO user_locations (user_id, lat, lng, updated_at)
      VALUES ($1,$2,$3,NOW())
      ON CONFLICT(user_id) DO UPDATE SET lat=$2, lng=$3, updated_at=NOW(), is_active=1
    `).run(req.user.id, parseFloat(lat), parseFloat(lng));
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/geo/location — desativa localização
router.delete('/location', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    await db.prepare('UPDATE user_locations SET is_active=0 WHERE user_id=$1').run(req.user.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/geo/nearby?lat=&lng=&radius= — usuários próximos
router.get('/nearby', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { lat, lng, radius=5 } = req.query; // radius em km
    if (!lat || !lng) return res.status(400).json({ error: 'lat e lng obrigatórios' });
    // Haversine approximation via bounding box first, then filter
    const latR = parseFloat(radius) / 111.0;
    const lngR = parseFloat(radius) / (111.0 * Math.cos(parseFloat(lat) * Math.PI / 180));
    const minLat = parseFloat(lat) - latR;
    const maxLat = parseFloat(lat) + latR;
    const minLng = parseFloat(lng) - lngR;
    const maxLng = parseFloat(lng) + lngR;

    const users = await db.prepare(`
      SELECT u.id, u.name, u.username, u.avatar_url, u.points,
             ul.lat, ul.lng, ul.updated_at as location_updated
      FROM user_locations ul JOIN users u ON u.id=ul.user_id
      WHERE ul.is_active=1
        AND ul.user_id != $1
        AND ul.lat BETWEEN $2 AND $3
        AND ul.lng BETWEEN $4 AND $5
        AND ul.updated_at > NOW() - INTERVAL '2 hours'
      ORDER BY ul.updated_at DESC LIMIT 50
    `).all(req.user.id, minLat, maxLat, minLng, maxLng);

    // Calcular distância real
    const withDist = users.map(u => {
      const R = 6371;
      const dLat = (u.lat - parseFloat(lat)) * Math.PI / 180;
      const dLng = (u.lng - parseFloat(lng)) * Math.PI / 180;
      const a = Math.sin(dLat/2)**2 + Math.cos(parseFloat(lat)*Math.PI/180) * Math.cos(u.lat*Math.PI/180) * Math.sin(dLng/2)**2;
      const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
      return { ...u, distance_km: Math.round(dist * 10) / 10 };
    }).filter(u => u.distance_km <= parseFloat(radius));

    res.json({ users: withDist, count: withDist.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/geo/my-location
router.get('/my-location', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const loc = await db.prepare('SELECT * FROM user_locations WHERE user_id=$1').get(req.user.id);
    res.json({ location: loc || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/geo/chat — mensagens do chat por proximidade
router.get('/chat', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { lat, lng, radius=5 } = req.query;
    const area_key = `${Math.round(parseFloat(lat)*10)/10}_${Math.round(parseFloat(lng)*10)/10}`;
    const messages = await db.prepare(`
      SELECT gc.*, u.name, u.username, u.avatar_url
      FROM geo_chat gc JOIN users u ON u.id=gc.user_id
      WHERE gc.area_key=$1 AND gc.created_at > NOW() - INTERVAL '24 hours'
      ORDER BY gc.created_at ASC LIMIT 100
    `).all(area_key);
    res.json({ messages, area_key });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/geo/chat
router.post('/chat', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { lat, lng, content } = req.body;
    if (!content || !lat || !lng) return res.status(400).json({ error: 'content, lat e lng obrigatórios' });
    const area_key = `${Math.round(parseFloat(lat)*10)/10}_${Math.round(parseFloat(lng)*10)/10}`;
    const { v4: uuidv4 } = require('uuid');
    const id = uuidv4();
    await db.prepare('INSERT INTO geo_chat (id,user_id,area_key,content,lat,lng) VALUES ($1,$2,$3,$4,$5,$6)')
      .run(id, req.user.id, area_key, content.trim(), parseFloat(lat), parseFloat(lng));
    const msg = await db.prepare(`
      SELECT gc.*, u.name, u.username, u.avatar_url
      FROM geo_chat gc JOIN users u ON u.id=gc.user_id WHERE gc.id=$1
    `).get(id);
    res.status(201).json({ message: msg });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
