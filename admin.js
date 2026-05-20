// admin.js — rotas do painel administrativo
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');
const { sendPushToAll } = require('./notifications');

const router = express.Router();

// Middleware: só admins
async function adminOnly(req, res, next) {
  const db = getDB();
  const user = await db.prepare('SELECT is_admin FROM users WHERE id=$1').get(req.user.id);
  if (!user?.is_admin) return res.status(403).json({ error: 'Acesso restrito a administradores' });
  next();
}

// GET /api/admin/stats
router.get('/stats', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const total = parseInt((await db.prepare('SELECT COUNT(*) as c FROM users').get())?.c || 0);
  const posts  = parseInt((await db.prepare('SELECT COUNT(*) as c FROM posts').get())?.c || 0);
  const today  = new Date().toISOString().slice(0,10);
  const todayPosts = parseInt((await db.prepare('SELECT COUNT(*) as c FROM posts WHERE DATE(created_at)=$1').get(today))?.c || 0);
  res.json({ total_users: total, total_posts: posts, today_posts: todayPosts });
});

// GET /api/admin/users
router.get('/users', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const users = await db.prepare('SELECT id,name,username,email,is_admin,points,created_at FROM users ORDER BY created_at DESC').all();
  res.json({ users });
});

// POST /api/admin/notify — dispara notificação de foto
router.post('/notify', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  // Desativa notificações anteriores
  await db.prepare('UPDATE notifications SET active=0').run();

  const id = uuidv4();
  const expiresAt = new Date(Date.now() + 3 * 60 * 1000); // 3 minutos
  await db.prepare('INSERT INTO notifications (id,sent_by,expires_at,active) VALUES ($1,$2,$3,1)')
    .run(id, req.user.id, expiresAt.toISOString());

  // Envia push + email em background
  sendPushToAll(db, id).catch(e => console.error('Push error:', e.message));

  res.json({ notification_id: id, expires_at: expiresAt.toISOString(), message: 'Notificação enviada!' });
});

// GET /api/admin/notification/active — checa se há notificação ativa
router.get('/notification/active', async (req, res) => {
  const db = getDB();
  const notif = await db.prepare("SELECT * FROM notifications WHERE active=1 AND expires_at > NOW() ORDER BY sent_at DESC LIMIT 1").get();
  if (!notif) return res.json({ active: false });
  const now = Date.now();
  const expires = new Date(notif.expires_at).getTime();
  res.json({ active: true, notification_id: notif.id, expires_at: notif.expires_at, ms_remaining: Math.max(0, expires - now) });
});

// PUT /api/admin/users/:id/toggle-admin
router.put('/users/:id/toggle-admin', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const user = await db.prepare('SELECT is_admin FROM users WHERE id=$1').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  const newVal = user.is_admin ? 0 : 1;
  await db.prepare('UPDATE users SET is_admin=$1 WHERE id=$2').run(newVal, req.params.id);
  res.json({ is_admin: newVal });
});

// POST /api/admin/push-subscribe — salva subscription do usuário
router.post('/push-subscribe', authMiddleware, async (req, res) => {
  const db = getDB();
  const { subscription } = req.body;
  if (!subscription) return res.status(400).json({ error: 'Subscription obrigatória' });
  const id = uuidv4();
  const subStr = JSON.stringify(subscription);
  // Upsert
  try {
    await db.prepare('INSERT INTO push_subscriptions (id,user_id,subscription) VALUES ($1,$2,$3)').run(id, req.user.id, subStr);
  } catch(e) {
    await db.prepare('UPDATE push_subscriptions SET subscription=$1 WHERE user_id=$2').run(subStr, req.user.id);
  }
  res.json({ ok: true });
});

module.exports = router;

// GET /api/admin/ranking — público, lista usuários por pontos
router.get('/ranking', async (req, res) => {
  const db = getDB();
  const users = await db.prepare('SELECT id,name,username,avatar_url,points FROM users ORDER BY points DESC, created_at ASC').all();
  res.json({ users });
});
