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
    res.json({ token, user: { id:user.id, name:user.name, username:user.username, email:user.email, bio:user.bio, avatar_url:user.avatar_url, occupation:user.occupation, country:user.country, state:user.state, city:user.city, created_at:user.created_at, is_admin:user.is_admin, points:user.points } });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erro interno' }); }
});

router.get('/me', authMiddleware, async (req, res) => {
  const user = await getDB().prepare('SELECT id,name,username,email,bio,avatar_url,occupation,country,state,city,created_at,is_admin,points FROM users WHERE id=$1').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json({ user });
});

module.exports = router;
