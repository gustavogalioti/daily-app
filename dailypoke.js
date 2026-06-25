const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');
const { uploadBase64Image } = require('./cloudinary');
const { NotificationService } = require('./notif_service');

const router = express.Router();

// GET /api/dailypoke/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const poke = await db.prepare('SELECT * FROM dailypokes WHERE user_id=$1').get(req.user.id);
    res.json({ config: poke?.config || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/dailypoke/save
router.post('/save', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { config, avatar_url } = req.body;
    if (!config) return res.status(400).json({ error: 'config obrigatorio' });
    try { await db.prepare('ALTER TABLE dailypokes ADD COLUMN IF NOT EXISTS avatar_url TEXT').run(); } catch(e){}
    const existing = await db.prepare('SELECT id FROM dailypokes WHERE user_id=$1').get(req.user.id);
    if (existing) {
      await db.prepare('UPDATE dailypokes SET config=$1, avatar_url=$2, updated_at=NOW() WHERE user_id=$3')
        .run(JSON.stringify(config), avatar_url || null, req.user.id);
    } else {
      await db.prepare('INSERT INTO dailypokes (id,user_id,config,avatar_url) VALUES ($1,$2,$3,$4)')
        .run(uuidv4(), req.user.id, JSON.stringify(config), avatar_url || null);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/dailypoke/friends — pokes dos amigos
router.get('/friends', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const pokes = await db.prepare(`
      SELECT dp.config, u.id as user_id, u.name, u.username, u.avatar_url
      FROM dailypokes dp JOIN users u ON u.id=dp.user_id
      JOIN friendships f ON (
        (f.requester_id=dp.user_id AND f.addressee_id=$1) OR
        (f.addressee_id=dp.user_id AND f.requester_id=$1)
      ) AND f.status='accepted'
      WHERE dp.user_id != $1
    `).all(req.user.id);
    res.json({ pokes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/dailypoke/send — mandar poke
router.post('/send', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { to_user_id, action = 'wave', scene } = req.body;
    if (!to_user_id) return res.status(400).json({ error: 'to_user_id obrigatório' });
    const finalAction = scene || action;
    const id = uuidv4();
    await db.prepare('INSERT INTO dailypoke_actions (id,from_user_id,to_user_id,action) VALUES ($1,$2,$3,$4)')
      .run(id, req.user.id, to_user_id, finalAction);
    const sender = await db.prepare('SELECT name FROM users WHERE id=$1').get(req.user.id);
    const sceneText = scene ? ` quer fazer uma cena com você: ${scene}` : ' te mandou um poke! 👋';
    try {
      await NotificationService.sendDailyPoke(db, {
        toUserId: to_user_id,
        fromUser: { id: req.user.id, name: sender?.name || 'Alguém' },
        scene: scene || null
      });
    } catch(notifErr) { console.error('poke notif erro:', notifErr.message); }
    res.status(201).json({ ok: true });
  } catch(e) { console.error('poke send erro:', e.message); res.status(500).json({ error: e.message }); }
});

// GET /api/dailypoke/received — pokes recebidos
router.get('/received', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const pokes = await db.prepare(`
      SELECT pa.*, u.name as from_name, u.username as from_username, dp.config as from_config
      FROM dailypoke_actions pa
      JOIN users u ON u.id=pa.from_user_id
      LEFT JOIN dailypokes dp ON dp.user_id=pa.from_user_id
      WHERE pa.to_user_id=$1
      ORDER BY pa.created_at DESC LIMIT 20
    `).all(req.user.id);
    // Renomear from_user_id para from_id
    const result = pokes.map(p => ({...p, from_id: p.from_user_id}));
    res.json({ pokes: result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// GET pokes enviados
router.get('/sent', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const pokes = await db.prepare(`
      SELECT pa.*, u.name as to_name, u.username as to_username, dp.config as to_config
      FROM dailypoke_actions pa
      JOIN users u ON u.id = pa.to_user_id
      LEFT JOIN dailypokes dp ON dp.user_id = pa.to_user_id
      WHERE pa.from_user_id = $1
      ORDER BY pa.created_at DESC LIMIT 20
    `).all(req.user.id);
    res.json({ pokes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/dailypoke/user/:id — ver poke de outro usuário
// GET todos os pokes (para o DailyVERSE)
router.get('/all', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const pokes = await db.prepare(`
      SELECT dp.config, dp.avatar_url, u.id as user_id, u.username, u.name, u.avatar_url as user_avatar
      FROM dailypokes dp JOIN users u ON u.id = dp.user_id
      WHERE dp.config IS NOT NULL
      ORDER BY dp.updated_at DESC LIMIT 80
    `).all();
    res.json({ pokes });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/user/:id', async (req, res) => {
  try {
    const db = getDB();
    const poke = await db.prepare('SELECT * FROM dailypokes WHERE user_id=$1').get(req.params.id);
    res.json({ config: poke?.config || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/dailypoke/upload-avatar — sobe PNG do avatar no Cloudinary
router.post('/upload-avatar', authMiddleware, async (req, res) => {
  try {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'image obrigatorio' });
    const url = await uploadBase64Image(image, 'dailypoke_avatars');
    res.json({ url });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
