const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');
const { sendPushToAll } = require('./notifications');

const router = express.Router();

async function adminOnly(req, res, next) {
  const db = getDB();
  const user = await db.prepare('SELECT is_admin, is_moderator FROM users WHERE id=$1').get(req.user.id);
  if (!user?.is_admin) return res.status(403).json({ error: 'Acesso restrito a administradores' });
  next();
}

async function modOrAdmin(req, res, next) {
  const db = getDB();
  const user = await db.prepare('SELECT is_admin, is_moderator FROM users WHERE id=$1').get(req.user.id);
  if (!user?.is_admin && !user?.is_moderator) return res.status(403).json({ error: 'Acesso restrito a administradores e moderadores' });
  next();
}

// GET /api/admin/stats
router.get('/stats', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const total    = parseInt((await db.prepare('SELECT COUNT(*) as c FROM users WHERE id != $1').get('system-daily'))?.c || 0);
  const posts    = parseInt((await db.prepare('SELECT COUNT(*) as c FROM posts').get())?.c || 0);
  const today    = new Date().toISOString().slice(0,10);
  const todayPosts = parseInt((await db.prepare('SELECT COUNT(*) as c FROM posts WHERE DATE(created_at)=$1').get(today))?.c || 0);
  const friends  = parseInt((await db.prepare("SELECT COUNT(*) as c FROM friendships WHERE status='accepted'").get())?.c || 0);
  const communities = parseInt((await db.prepare("SELECT COUNT(*) as c FROM communities WHERE type != 'regional'").get())?.c || 0);
  res.json({ total_users: total, total_posts: posts, today_posts: todayPosts, total_friends: friends, total_communities: communities });
});

// GET /api/admin/users
router.get('/users', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const users = await db.prepare("SELECT id,name,username,email,is_admin,is_moderator,points,city,state,created_at FROM users WHERE id != $1 ORDER BY created_at DESC").all('system-daily');
  res.json({ users });
});

// PUT /api/admin/users/:id
router.put('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const { name, email, is_admin } = req.body;
  await db.prepare('UPDATE users SET name=COALESCE($1,name), email=COALESCE($2,email), is_admin=COALESCE($3,is_admin), updated_at=NOW() WHERE id=$4')
    .run(name||null, email||null, is_admin!=null?parseInt(is_admin):null, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/admin/users/:id
router.delete('/users/:id', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  await db.prepare('DELETE FROM users WHERE id=$1').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/admin/notify
router.post('/notify', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  await db.prepare('UPDATE notifications SET active=0').run();
  const id = uuidv4();
  const expiresAt = new Date(Date.now() + 1 * 60 * 1000);
  await db.prepare('INSERT INTO notifications (id,sent_by,expires_at,active) VALUES ($1,$2,$3,1)')
    .run(id, req.user.id, expiresAt.toISOString());
  sendPushToAll(db, id).catch(e => console.error('Push error:', e.message));
  res.json({ notification_id: id, expires_at: expiresAt.toISOString(), message: 'Notificação enviada!' });
});

// GET /api/admin/notification/active
router.get('/notification/active', async (req, res) => {
  const db = getDB();
  const notif = await db.prepare("SELECT * FROM notifications WHERE active=1 AND expires_at > NOW() ORDER BY sent_at DESC LIMIT 1").get();
  if (!notif) return res.json({ active: false });
  const ms_remaining = Math.max(0, new Date(notif.expires_at).getTime() - Date.now());
  res.json({ active: true, notification_id: notif.id, expires_at: notif.expires_at, ms_remaining });
});

// PUT /api/admin/users/:id/reset-password — admin define uma nova senha manualmente
router.put('/users/:id/reset-password', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getDB();
    const { password } = req.body;
    if (!password || password.length < 6)
      return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres' });
    const user = await db.prepare('SELECT id FROM users WHERE id=$1').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    const hashed = await bcrypt.hash(password, 12);
    await db.prepare('UPDATE users SET password=$1 WHERE id=$2').run(hashed, req.params.id);
    // Invalida qualquer link de "esqueci minha senha" pendente para esse usuário
    await db.prepare('UPDATE password_resets SET used=TRUE WHERE user_id=$1').run(req.params.id).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    console.error('[Admin] reset-password:', e.message);
    res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
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

// POST /api/admin/push-subscribe
router.post('/push-subscribe', authMiddleware, async (req, res) => {
  const db = getDB();
  const { subscription } = req.body;
  if (!subscription) return res.status(400).json({ error: 'Subscription obrigatória' });
  const subStr = JSON.stringify(subscription);
  const deviceKey = subscription.endpoint ? subscription.endpoint.slice(-40) : uuidv4();

  // Remover subscrições antigas de domínios não-oficiais (railway, etc)
  try {
    const all = await db.prepare('SELECT id, subscription FROM push_subscriptions WHERE user_id=$1').all(req.user.id);
    for (const row of all) {
      try {
        const s = JSON.parse(row.subscription);
        if (s.endpoint && !s.endpoint.includes('yourdaily.com.br')) {
          await db.prepare('DELETE FROM push_subscriptions WHERE id=$1').run(row.id);
        }
      } catch(e) {}
    }
  } catch(e) {}

  try {
    await db.prepare(
      'INSERT INTO push_subscriptions (id,user_id,subscription,device_key) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id,device_key) DO UPDATE SET subscription=$3'
    ).run(uuidv4(), req.user.id, subStr, deviceKey);
  } catch(e) {
    try {
      await db.prepare('INSERT INTO push_subscriptions (id,user_id,subscription,device_key) VALUES ($1,$2,$3,$4)').run(uuidv4(), req.user.id, subStr, deviceKey);
    } catch(e2) {
      await db.prepare('UPDATE push_subscriptions SET subscription=$1 WHERE user_id=$2 AND device_key=$3').run(subStr, req.user.id, deviceKey);
    }
  }
  res.json({ ok: true });
});

// POST /api/admin/push-unsubscribe
router.post('/push-unsubscribe', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    await db.prepare('DELETE FROM push_subscriptions WHERE user_id=$1').run(req.user.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/admin/users/:id/toggle-moderator
router.put('/users/:id/toggle-moderator', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const user = await db.prepare('SELECT is_moderator, is_admin FROM users WHERE id=$1').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  if (user.is_admin) return res.status(400).json({ error: 'Usuários ADM não podem ser rebaixados a MOD por aqui' });
  const newVal = user.is_moderator ? 0 : 1;
  await db.prepare('UPDATE users SET is_moderator=$1 WHERE id=$2').run(newVal, req.params.id);
  res.json({ is_moderator: newVal });
});

// GET /api/admin/ranking
router.get('/ranking', async (req, res) => {
  const db = getDB();
  const users = await db.prepare("SELECT id,name,username,avatar_url,points FROM users WHERE id != $1 ORDER BY points DESC, created_at ASC").all('system-daily');
  res.json({ users });
});

// DELETE /api/admin/posts/all — limpar todos os posts
router.delete('/posts/all', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  await db.prepare('DELETE FROM reactions').run();
  await db.prepare('DELETE FROM comments').run();
  await db.prepare('DELETE FROM pedro_comments').run();
  await db.prepare('DELETE FROM posts').run();
  await db.prepare('UPDATE users SET points=0 WHERE id != $1').run('system-daily');
  res.json({ ok: true, message: 'Todos os posts foram apagados.' });
});

// GET /api/admin/daily-questions — listar e editar perguntas
router.get('/daily-questions', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const questions = await db.prepare('SELECT * FROM daily_questions ORDER BY period ASC').all();
  res.json({ questions });
});

router.put('/daily-questions/:id', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const { question } = req.body;
  await db.prepare('UPDATE daily_questions SET question=$1 WHERE id=$2').run(question, req.params.id);
  res.json({ ok: true });
});


// POST /api/admin/pedro-friendship — forçar amizade do Pedro com todos
router.post('/pedro-friendship', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const PEDRO_ID = 'pedro-official-daily';
  const pedro = await db.prepare('SELECT id FROM users WHERE id=$1').get(PEDRO_ID);
  if (!pedro) return res.status(404).json({ error: 'Pedro não encontrado. Faça restart do servidor.' });
  const users = await db.prepare("SELECT id FROM users WHERE id != $1 AND id != 'system-daily'").all(PEDRO_ID);
  let count = 0;
  for (const u of users) {
    try {
      await db.prepare('INSERT INTO friendships (id,requester_id,addressee_id,status,message) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING')
        .run(uuidv4(), PEDRO_ID, u.id, 'accepted', 'Oi! Sou o Pedro, seu amigo felino oficial! 🐱🧡');
      count++;
    } catch(e) {}
  }
  res.json({ ok: true, friendships_created: count });
});


// GET /api/admin/agora-banner — buscar mensagem atual
router.get('/agora-banner', async (req, res) => {
  try {
    const db = getDB();
    const banner = await db.prepare("SELECT * FROM agora_banners WHERE active=1 ORDER BY created_at DESC LIMIT 1").get();
    res.json({ banner: banner || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/admin/agora-banner — publicar mensagem
router.post('/agora-banner', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getDB();
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Mensagem obrigatória' });
    // Desativar banner anterior
    await db.prepare("UPDATE agora_banners SET active=0").run();
    // Criar novo
    const { v4: uuidv4 } = require('uuid');
    const author = await db.prepare('SELECT name FROM users WHERE id=$1').get(req.user.id);
    await db.prepare('INSERT INTO agora_banners (id,message,author,active) VALUES ($1,$2,$3,1)')
      .run(uuidv4(), message.trim(), author?.name || 'ADM');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/admin/agora-banner — remover mensagem
router.delete('/agora-banner', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getDB();
    await db.prepare("UPDATE agora_banners SET active=0").run();
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// POST /api/admin/reset-pending-friendships
router.post('/reset-pending-friendships', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getDB();
    const result = await db.prepare("DELETE FROM friendships WHERE status='pending'").run();
    res.json({ ok: true, deleted: result.rowCount || 0 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// POST /api/admin/seed-achievements — inserir conquistas novas
router.post('/seed-achievements', authMiddleware, adminOnly, async (req, res) => {
  try {
    const db = getDB();
    const { v4: uuidv4 } = require('uuid');
    const achs = [
      ['esquema_piramide','Esquema de Pirâmide','Indique a rede para um amigo e ele abrir conta','🔺',400,'social','invite','count','1'],
      ['bicho_estimacao','Eu e meu amigão','Poste uma foto com seu bicho de estimação','🐾',80,'photo','photo_tag','tag','bicho'],
      ['melancia','Querendo chamar atenção','Poste uma foto segurando uma melancia','🍉',100,'photo','photo_tag','tag','melancia'],
      ['no_trampo','No trampo','Poste uma foto no seu trabalho','💼',60,'photo','photo_tag','tag','trabalho'],
      ['falsiane','Falsiane','Poste uma selfie dando um sorriso falso','😁',70,'photo','photo_tag','tag','selfie'],
      ['parcas','Com os parças','Poste uma foto com seu grupo de amigos','👯',90,'social','photo_tag','tag','amigos'],
      ['disney','Vivendo na Disney','Poste uma foto fantasiado','🏰',120,'photo','photo_tag','tag','fantasia'],
      ['sextou','Sextou!','Poste uma foto da sua sexta à noite (sex 18h-23h59)','🎉',100,'time','photo_time','weekday','5_18_23'],
      ['segundou','Segundou','Poste uma foto da semana começando (seg 5h-9h)','🌅',80,'time','photo_time','weekday','1_5_9'],
      ['esg','Orgulho do ESG','Poste uma foto abraçando uma árvore','🌳',80,'photo','photo_tag','tag','arvore'],
      ['queda_livre','Queda Livre','Poste uma foto pulando de paraquedas','🪂',200,'photo','photo_tag','tag','paraquedas'],
      ['bucefalo','Meu Bucéfalo','Poste uma foto com um cavalo (pergunte ao @pedro quem é Bucéfalo!)','🐴',150,'photo','photo_tag','tag','cavalo'],
      ['cara_joelho','Cara de Joelho','Poste uma foto com um bebê','👶',90,'photo','photo_tag','tag','bebe'],
      ['caixa','Eu e o Caixa','Poste uma foto com o caixa de um estabelecimento','🏪',80,'photo','photo_tag','tag','caixa'],
      ['tia_plantas','Tia das Plantas','Poste uma foto igual sua tia das plantas','🪴',70,'photo','photo_tag','tag','plantas'],
      ['lenda_fluvial','Lenda Fluvial','Poste uma foto num rio','🏞️',100,'photo','photo_tag','tag','rio'],
      ['gabriel_medina','Eu meio Gabriel Medina','Poste uma foto no mar','🏄',120,'photo','photo_tag','tag','mar'],
      ['eye_tiger','Eye of the Tiger','Poste uma foto com um tigre','🐯',200,'photo','photo_tag','tag','tigre'],
      ['la_ferrari','La Ferrari!! 🤌','Poste uma foto com uma Ferrari','🏎️',300,'photo','photo_tag','tag','ferrari'],
      ['uno_escada','Carro de Corrida','Poste uma foto com um Uno com escada em cima','🚗',250,'photo','photo_tag','tag','uno'],
      ['srta_belo','Srta. Belo','Poste uma foto enquadrando uma maçã na sua cara','🍎',100,'photo','photo_tag','tag','maca'],
    ];
    let added = 0;
    for (const [slug,name,desc,icon,pts,cat,trig,rtype,rval] of achs) {
      const ex = await db.prepare('SELECT id FROM achievements WHERE slug=$1').get(slug);
      if (!ex) {
        await db.prepare('INSERT INTO achievements(id,slug,name,description,icon,points,category,trigger_type,requirement_type,requirement_value,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)')
          .run(uuidv4(),slug,name,desc,icon,pts,cat,trig,rtype,rval);
        added++;
      }
    }
    res.json({ ok: true, added });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
