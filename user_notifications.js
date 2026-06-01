const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');

const { createNotification } = require('./notif_helper');

const router = express.Router();

// GET /api/user-notifications — listar notificações do usuário
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const notifs = await db.prepare(`
      SELECT n.*, u.name as from_name, u.username as from_username, u.avatar_url as from_avatar
      FROM user_notifications n
      LEFT JOIN users u ON u.id = n.from_user_id
      WHERE n.user_id = $1
      ORDER BY n.created_at DESC LIMIT 50
    `).all(req.user.id);
    const unread = notifs.filter(n => !n.read).length;
    res.json({ notifications: notifs, unread });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/user-notifications/read-all — marcar todas como lidas
router.put('/read-all', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    await db.prepare('UPDATE user_notifications SET read=1 WHERE user_id=$1').run(req.user.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/user-notifications/:id/read
router.put('/:id/read', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    await db.prepare('UPDATE user_notifications SET read=1 WHERE id=$1 AND user_id=$2').run(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── CONVITES DE COMUNIDADE ──

// POST /api/user-notifications/community-invite — convidar usuário
router.post('/community-invite', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { community_id, invitee_id } = req.body;
    if (!community_id || !invitee_id) return res.status(400).json({ error: 'Dados incompletos' });

    // Verificar se quem convida é membro
    const member = await db.prepare('SELECT role FROM community_members WHERE community_id=$1 AND user_id=$2').get(community_id, req.user.id);
    if (!member) return res.status(403).json({ error: 'Você não é membro desta comunidade' });

    // Verificar se já é membro
    const alreadyMember = await db.prepare('SELECT id FROM community_members WHERE community_id=$1 AND user_id=$2').get(community_id, invitee_id);
    if (alreadyMember) return res.status(400).json({ error: 'Usuário já é membro' });

    // Verificar convite pendente
    const existing = await db.prepare("SELECT id FROM community_invites WHERE community_id=$1 AND invitee_id=$2 AND status='pending'").get(community_id, invitee_id);
    if (existing) return res.status(400).json({ error: 'Convite já enviado' });

    // Criar convite
    const inviteId = uuidv4();
    await db.prepare('INSERT INTO community_invites (id,community_id,inviter_id,invitee_id,status) VALUES ($1,$2,$3,$4,$5)')
      .run(inviteId, community_id, req.user.id, invitee_id, 'pending');

    // Buscar dados para notificação
    const community = await db.prepare('SELECT name FROM communities WHERE id=$1').get(community_id);
    const inviter = await db.prepare('SELECT name FROM users WHERE id=$1').get(req.user.id);

    // Criar notificação para o convidado
    await createNotification(db, {
      userId: invitee_id,
      fromUserId: req.user.id,
      type: 'community_invite',
      title: `${inviter.name} te convidou para uma comunidade`,
      body: `Entrar em "${community.name}"?`,
      data: { community_id, community_name: community.name, invite_id: inviteId }
    });

    res.status(201).json({ ok: true, message: 'Convite enviado!' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/user-notifications/community-invite/:id/accept
router.post('/community-invite/:id/accept', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const invite = await db.prepare('SELECT * FROM community_invites WHERE id=$1 AND invitee_id=$2').get(req.params.id, req.user.id);
    if (!invite) return res.status(404).json({ error: 'Convite não encontrado' });
    if (invite.status !== 'pending') return res.status(400).json({ error: 'Convite já respondido' });

    // Entrar na comunidade
    await db.prepare('INSERT INTO community_members (id,community_id,user_id,role) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING')
      .run(uuidv4(), invite.community_id, req.user.id, 'member');
    await db.prepare("UPDATE community_invites SET status='accepted' WHERE id=$1").run(req.params.id);

    // Marcar notificação como lida
    await db.prepare("UPDATE user_notifications SET read=1 WHERE user_id=$1 AND data->>'invite_id'=$2").run(req.user.id, req.params.id);

    // Notificar quem convidou
    const community = await db.prepare('SELECT name FROM communities WHERE id=$1').get(invite.community_id);
    const joiner = await db.prepare('SELECT name FROM users WHERE id=$1').get(req.user.id);
    await createNotification(db, {
      userId: invite.inviter_id,
      fromUserId: req.user.id,
      type: 'community_invite_accepted',
      title: `${joiner.name} aceitou seu convite!`,
      body: `Agora faz parte de "${community.name}" 🎉`,
      data: { community_id: invite.community_id }
    });

    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/user-notifications/community-invite/:id/decline
router.post('/community-invite/:id/decline', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const invite = await db.prepare('SELECT * FROM community_invites WHERE id=$1 AND invitee_id=$2').get(req.params.id, req.user.id);
    if (!invite) return res.status(404).json({ error: 'Convite não encontrado' });
    await db.prepare("UPDATE community_invites SET status='declined' WHERE id=$1").run(req.params.id);
    await db.prepare("UPDATE user_notifications SET read=1 WHERE user_id=$1 AND data->>'invite_id'=$2").run(req.user.id, req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
