const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');
const { checkAndGrant } = require('./achievements');

const router = express.Router();

// GET /api/friends — lista amigos aceitos
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const friends = await db.prepare(`
      SELECT u.id, u.name, u.username, u.avatar_url, u.bio, u.occupation, u.city, u.state,
             f.created_at as friends_since
      FROM friendships f
      JOIN users u ON (
        CASE WHEN f.requester_id=$1 THEN f.addressee_id ELSE f.requester_id END = u.id
      )
      WHERE (f.requester_id=$1 OR f.addressee_id=$1) AND f.status='accepted'
      ORDER BY u.name ASC
    `).all(req.user.id, req.user.id);
    res.json({ friends });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/friends/requests — solicitações pendentes recebidas
router.get('/requests', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const requests = await db.prepare(`
      SELECT f.id, f.message, f.created_at,
             u.id as user_id, u.name, u.username, u.avatar_url, u.bio
      FROM friendships f
      JOIN users u ON u.id = f.requester_id
      WHERE f.addressee_id=$1 AND f.status='pending'
      ORDER BY f.created_at DESC
    `).all(req.user.id);
    res.json({ requests });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/friends/sent — solicitações enviadas
router.get('/sent', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const sent = await db.prepare(`
      SELECT f.id, f.status, f.created_at,
             u.id as user_id, u.name, u.username, u.avatar_url
      FROM friendships f
      JOIN users u ON u.id = f.addressee_id
      WHERE f.requester_id=$1 AND f.status='pending'
      ORDER BY f.created_at DESC
    `).all(req.user.id);
    res.json({ sent });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/friends/status/:userId — status da amizade com um usuário
router.get('/status/:userId', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const f = await db.prepare(`
      SELECT * FROM friendships
      WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)
    `).get(req.user.id, req.params.userId);
    if (!f) return res.json({ status: 'none' });
    res.json({ status: f.status, friendship_id: f.id, is_requester: f.requester_id === req.user.id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/friends/request — enviar solicitação
router.post('/request', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { user_id, message } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id obrigatório' });
    if (user_id === req.user.id) return res.status(400).json({ error: 'Você não pode se adicionar' });
    if (!message || message.trim().length < 3)
      return res.status(400).json({ error: 'Escreva uma mensagem para enviar a solicitação' });
    const existing = await db.prepare(`
      SELECT id FROM friendships
      WHERE (requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1)
    `).get(req.user.id, user_id);
    if (existing) return res.status(409).json({ error: 'Solicitação já existe' });
    const id = uuidv4();
    const PEDRO_ID = 'pedro-official-daily';
    const isPedro = user_id === PEDRO_ID;
    // Pedro aceita automaticamente toda solicitação
    const status = isPedro ? 'accepted' : 'pending';
    await db.prepare('INSERT INTO friendships (id,requester_id,addressee_id,status,message) VALUES ($1,$2,$3,$4,$5)')
      .run(id, req.user.id, user_id, status, message.trim());
    // Também criar a amizade reversa para garantir
    if (isPedro) {
      await checkAndGrant(db, req.user.id, 'friends');
    }
    res.status(201).json({ friendship_id: id, message: isPedro ? 'Pedro aceitou sua amizade! 🐱🧡' : 'Solicitação enviada!' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/friends/request/:id/accept
router.put('/request/:id/accept', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const f = await db.prepare('SELECT * FROM friendships WHERE id=$1').get(req.params.id);
    if (!f) return res.status(404).json({ error: 'Solicitação não encontrada' });
    if (f.addressee_id !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });
    await db.prepare("UPDATE friendships SET status='accepted', updated_at=NOW() WHERE id=$1").run(req.params.id);
    // Verifica conquistas de amizade para os dois
    await checkAndGrant(db, req.user.id, 'friends');
    await checkAndGrant(db, f.requester_id, 'friends');
    res.json({ ok: true, message: 'Amizade aceita!' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/friends/request/:id/reject
router.put('/request/:id/reject', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const f = await db.prepare('SELECT * FROM friendships WHERE id=$1').get(req.params.id);
    if (!f) return res.status(404).json({ error: 'Solicitação não encontrada' });
    if (f.addressee_id !== req.user.id) return res.status(403).json({ error: 'Sem permissão' });
    await db.prepare("UPDATE friendships SET status='rejected', updated_at=NOW() WHERE id=$1").run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/friends/:userId — remover amigo
router.delete('/:userId', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    await db.prepare(`DELETE FROM friendships WHERE
      ((requester_id=$1 AND addressee_id=$2) OR (requester_id=$2 AND addressee_id=$1))
      AND status='accepted'`
    ).run(req.user.id, req.params.userId);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
