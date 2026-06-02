require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { initDB } = require('./database');
let VAPID_PUBLIC = '';
try {
  const notif = require('./notifications');
  VAPID_PUBLIC = notif.VAPID_PUBLIC || '';
} catch(e) { console.error('notifications.js erro:', e.message); }

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/vapid-public-key', (req, res) => res.json({ key: VAPID_PUBLIC }));

process.on('uncaughtException', (err) => {
  console.error('CRASH:', err.message);
  console.error(err.stack);
  process.exit(1);
});

(async () => {
  try {
    await initDB();
  try { require('./cloudinary'); } catch(e) { console.error('cloudinary:', e.message); }

  const routeFiles = [
    ['/api/auth', './auth'], ['/api/posts', './posts'], ['/api/users', './users'],
    ['/api/admin', './admin'], ['/api/friends', './friends'],
    ['/api/testimonials', './testimonials'], ['/api/communities', './communities'],
    ['/api/user-notifications', './user_notifications'],
    ['/api/agenda', './agenda'],
    ['/api/achievements', './achievements'], ['/api/pedro', './pedro'],
    ['/api/daily-questions', './daily_questions'], ['/api/geo', './geo'],
    ['/api/map-points', './map_points'], ['/api/events', './events'],
  ];
  for (const [path, file] of routeFiles) {
    try { app.use(path, require(file)); console.log('  ✓', path); }
    catch(e) { console.error('ROTA FALHOU', path, e.message); }
  }

  app.get('/api/health', (req, res) => res.json({ status:'ok', app:'DAILY', version:'3.0.0' }));
  app.get('/test', (req, res) => {
    res.sendFile(path.join(__dirname, 'test.html'));
  });

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error:'Not found' });
    res.sendFile(path.join(__dirname, 'index.html'));
  });
  app.use((err, req, res, next) => {
    console.error(err.message);
    if (err.code==='LIMIT_FILE_SIZE') return res.status(400).json({ error:'Arquivo muito grande (máx 10MB)' });
    res.status(500).json({ error: err.message||'Erro interno' });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => console.log(`\n🗓️  DAILY v3 rodando em http://localhost:${PORT}\n`));
  } catch(err) {
    console.error('FATAL ao iniciar:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
