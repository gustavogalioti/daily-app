const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { sendWelcomeEmail } = require('./email');
const { authMiddleware } = require('./authmiddleware');

const router = express.Router();
const SECRET = () => process.env.JWT_SECRET || 'daily_secret_key';

// Lista de admins iniciais (por email) — configura via env
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

router.post('/register', async (req, res) => {
  try {
    const db = getDB();
    const { name, username, email, password, birth_date, country, state, city, occupation } = req.body;
    if (!name || !username || !email || !password)
      return res.status(400).json({ error: 'Campos obrigatórios: nome, usuário, email, senha' });
    const uname = username.replace(/^@/, '').toLowerCase().trim();
    const mail  = email.toLowerCase().trim();
    if (await db.prepare('SELECT id FROM users WHERE username=$1').get(uname))
      return res.status(409).json({ error: 'Nome de usuário já está em uso' });
    if (await db.prepare('SELECT id FROM users WHERE email=$1').get(mail))
      return res.status(409).json({ error: 'E-mail já cadastrado' });
    const hashed = await bcrypt.hash(password, 12);
    const id = uuidv4();
    const isAdmin = ADMIN_EMAILS.includes(mail) ? 1 : 0;
    await db.prepare('INSERT INTO users (id,name,username,email,password,birth_date,country,state,city,occupation,is_admin) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)')
      .run(id, name.trim(), uname, mail, hashed, birth_date||null, country||null, state||null, city||null, occupation||null, isAdmin);
    sendWelcomeEmail({ to: mail, name: name.trim(), username: uname }).catch(e => console.error('Email:', e.message));
    // Amizade automática com Pedro
    try {
      const PEDRO_ID = 'pedro-official-daily';
      const pedro = await db.prepare('SELECT id FROM users WHERE id=$1').get(PEDRO_ID);
      if (pedro) {
        await db.prepare('INSERT INTO friendships (id,requester_id,addressee_id,status,message) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING')
          .run(require('uuid').v4(), PEDRO_ID, id, 'accepted', 'Bem-vindo(a) ao Daily! Sou o Pedro, seu primeiro amigo aqui! 🐱🧡');
      }
    } catch(e) { console.error('Pedro friendship:', e.message); }
    const token = jwt.sign({ id, username: uname, name: name.trim() }, SECRET(), { expiresIn: '30d' });
    res.status(201).json({ token, user: { id, name: name.trim(), username: uname, email: mail, bio:'', avatar_url:'', is_admin: isAdmin, points: 0 } });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erro interno ao criar conta' }); }
});

router.post('/login', async (req, res) => {
  try {
    const db = getDB();
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ error: 'Login e senha obrigatórios' });
    const clean = login.replace(/^@/, '').toLowerCase().trim();
    const user  = await db.prepare('SELECT * FROM users WHERE email=$1 OR username=$2').get(clean, clean);
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });
    if (!await bcrypt.compare(password, user.password)) return res.status(401).json({ error: 'Senha incorreta' });
    const token = jwt.sign({ id: user.id, username: user.username, name: user.name }, SECRET(), { expiresIn: '30d' });
    res.json({ token, user: { id:user.id, name:user.name, username:user.username, email:user.email, bio:user.bio, avatar_url:user.avatar_url, occupation:user.occupation, country:user.country, state:user.state, city:user.city, created_at:user.created_at, is_admin:user.is_admin, is_moderator:user.is_moderator||0, points:user.points } });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erro interno' }); }
});

router.get('/me', authMiddleware, async (req, res) => {
  const user = await getDB().prepare('SELECT id,name,username,email,bio,avatar_url,occupation,country,state,city,created_at,is_admin,is_moderator,points FROM users WHERE id=$1').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json({ user });
});

// ─── ESQUECI MINHA SENHA ──────────────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const db = getDB();
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'E-mail obrigatório' });

    const user = await db.prepare('SELECT id,name,email FROM users WHERE email=$1').get(email.toLowerCase().trim());
    // Sempre responder OK (não revelar se email existe)
    if (!user) return res.json({ ok: true });

    // Criar token de reset (válido 1h)
    const token     = uuidv4().replace(/-/g,'') + uuidv4().replace(/-/g,'');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    // Criar tabela se não existir
    await db.prepare(`CREATE TABLE IF NOT EXISTS password_resets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`).run().catch(() => {});

    // Invalidar tokens anteriores do mesmo usuário
    await db.prepare('UPDATE password_resets SET used=TRUE WHERE user_id=$1').run(user.id).catch(() => {});

    // Salvar novo token
    await db.prepare('INSERT INTO password_resets (id,user_id,token,expires_at) VALUES ($1,$2,$3,$4)')
      .run(uuidv4(), user.id, token, expiresAt);

    // Enviar email
    const siteUrl   = process.env.SITE_URL || 'https://www.yourdaily.com.br';
    const resetLink = `${siteUrl}/?reset_token=${token}`;
    const { sendPasswordResetEmail } = require('./email');
    await sendPasswordResetEmail({ to: user.email, name: user.name, resetLink });

    res.json({ ok: true });
  } catch(e) {
    console.error('[Auth] forgot-password:', e.message);
    res.status(500).json({ error: 'Erro ao enviar e-mail. Tente novamente.' });
  }
});

// ─── REDEFINIR SENHA ──────────────────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const db = getDB();
    const { token, password } = req.body;
    if (!token || !password) return res.status(400).json({ error: 'Dados inválidos' });
    if (password.length < 6)  return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres' });

    // Buscar token válido
    const reset = await db.prepare(`
      SELECT pr.*, u.id AS uid FROM password_resets pr
      JOIN users u ON u.id = pr.user_id
      WHERE pr.token=$1 AND pr.used=FALSE AND pr.expires_at > NOW()
    `).get(token);

    if (!reset) return res.status(400).json({ error: 'Link inválido ou expirado. Solicite um novo.' });

    // Atualizar senha
    const hashed = await bcrypt.hash(password, 12);
    await db.prepare('UPDATE users SET password=$1 WHERE id=$2').run(hashed, reset.user_id);

    // Invalidar token
    await db.prepare('UPDATE password_resets SET used=TRUE WHERE id=$1').run(reset.id);

    res.json({ ok: true });
  } catch(e) {
    console.error('[Auth] reset-password:', e.message);
    res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
});

module.exports = router;
