const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { sendWelcomeEmail } = require('./email');
const { authMiddleware } = require('./authmiddleware');

const router = express.Router();
const SECRET = () => process.env.JWT_SECRET || 'daily_secret_key';

router.post('/register', async (req, res) => {
  try {
    const db = getDB();
    const { name, username, email, password, birth_date, country, state, city, occupation } = req.body;
    if (!name || !username || !email || !password)
      return res.status(400).json({ error: 'Campos obrigatórios: nome, usuário, email, senha' });
    const uname = username.replace(/^@/, '').toLowerCase().trim();
    const mail  = email.toLowerCase().trim();
    if (db.prepare('SELECT id FROM users WHERE username=?').get(uname))
      return res.status(409).json({ error: 'Nome de usuário já está em uso' });
    if (db.prepare('SELECT id FROM users WHERE email=?').get(mail))
      return res.status(409).json({ error: 'E-mail já cadastrado' });
    const hashed = await bcrypt.hash(password, 12);
    const id = uuidv4();
    db.prepare('INSERT INTO users (id,name,username,email,password,birth_date,country,state,city,occupation) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .run(id, name.trim(), uname, mail, hashed, birth_date||null, country||null, state||null, city||null, occupation||null);
    sendWelcomeEmail({ to: mail, name: name.trim(), username: uname }).catch(e => console.error('Email:', e.message));
    const token = jwt.sign({ id, username: uname, name: name.trim() }, SECRET(), { expiresIn: '30d' });
    res.status(201).json({ token, user: { id, name: name.trim(), username: uname, email: mail, bio:'', avatar_url:'' } });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erro interno ao criar conta' }); }
});

router.post('/login', async (req, res) => {
  try {
    const db = getDB();
    const { login, password } = req.body;
    if (!login || !password) return res.status(400).json({ error: 'Login e senha obrigatórios' });
    const clean = login.replace(/^@/, '').toLowerCase().trim();
    const user  = db.prepare('SELECT * FROM users WHERE email=? OR username=?').get(clean, clean);
    if (!user) return res.status(401).json({ error: 'Usuário não encontrado' });
    if (!await bcrypt.compare(password, user.password)) return res.status(401).json({ error: 'Senha incorreta' });
    const token = jwt.sign({ id: user.id, username: user.username, name: user.name }, SECRET(), { expiresIn: '30d' });
    res.json({ token, user: { id:user.id, name:user.name, username:user.username, email:user.email, bio:user.bio, avatar_url:user.avatar_url, occupation:user.occupation, country:user.country, state:user.state, city:user.city, created_at:user.created_at } });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erro interno' }); }
});

router.get('/me', authMiddleware, (req, res) => {
  const user = getDB().prepare('SELECT id,name,username,email,bio,avatar_url,occupation,country,state,city,created_at FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
  res.json({ user });
});

module.exports = router;
