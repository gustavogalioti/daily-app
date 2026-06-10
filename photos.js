const express = require('express');
const router = express.Router();
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');
const { createPhotoUpload, getUploadedUrl } = require('./cloudinary');
const { v4: uuidv4 } = require('uuid');

// GET álbuns de eventos que o usuário participou
router.get('/event-albums', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    // Agendas que o usuário é dono ou membro confirmado
    const agendas = await db.prepare(`
      SELECT DISTINCT a.id, a.title, a.album_title, a.event_date
      FROM agendas a
      LEFT JOIN agenda_members am ON am.agenda_id = a.id AND am.user_id = $1 AND am.status = 'accepted'
      WHERE a.owner_id = $1 OR am.user_id = $1
      ORDER BY a.event_date DESC
    `).all(req.user.id);

    const albums = [];
    for (const ag of agendas) {
      const photos = await db.prepare(`
        SELECT image_url FROM agenda_posts
        WHERE agenda_id=$1 AND post_type='photo' AND image_url IS NOT NULL
        ORDER BY created_at DESC LIMIT 4
      `).all(ag.id);
      const total = await db.prepare(
        `SELECT COUNT(*) as c FROM agenda_posts WHERE agenda_id=$1 AND post_type='photo' AND image_url IS NOT NULL`
      ).get(ag.id);
      if (parseInt(total?.c || 0) > 0) {
        albums.push({
          agenda_id: ag.id,
          title: ag.album_title || ag.title,
          photo_count: parseInt(total.c),
          photos: photos.map(p => p.image_url)
        });
      }
    }
    res.json({ albums });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET fotos com o usuário (marcadas)
router.get('/tagged', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const photos = await db.prepare(`
      SELECT tp.*, u.name as author_name, u.avatar_url as author_avatar
      FROM tagged_photos tp
      JOIN users u ON u.id = tp.uploader_id
      WHERE tp.tagged_user_id = $1
      ORDER BY tp.created_at DESC LIMIT 100
    `).all(req.user.id);
    res.json({ photos });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST adicionar foto com usuário (só amigos)
router.post('/tagged', authMiddleware, createPhotoUpload().single('photo'), async (req, res) => {
  try {
    const db = getDB();
    const { tagged_user } = req.body;
    if (!tagged_user) return res.status(400).json({ error: 'tagged_user obrigatório' });

    // Buscar usuário marcado
    const targetUser = await db.prepare('SELECT id FROM users WHERE username=$1').get(tagged_user);
    if (!targetUser) return res.status(404).json({ error: 'Usuário não encontrado' });

    // Verificar amizade
    const friendship = await db.prepare(`
      SELECT id FROM friendships
      WHERE ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))
      AND status='accepted'
    `).get(req.user.id, targetUser.id);
    if (!friendship && targetUser.id !== req.user.id) {
      return res.status(403).json({ error: 'Só amigos podem adicionar fotos' });
    }

    const image_url = getUploadedUrl(req, req.file);
    await db.prepare(
      'INSERT INTO tagged_photos (id,tagged_user_id,uploader_id,image_url) VALUES ($1,$2,$3,$4)'
    ).run(uuidv4(), targetUser.id, req.user.id, image_url);

    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
