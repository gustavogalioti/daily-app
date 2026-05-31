require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { initDB } = require('./database');
const { VAPID_PUBLIC } = require('./notifications');

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
  require('./cloudinary');

  app.use('/api/auth',            require('./auth'));
  app.use('/api/posts',           require('./posts'));
  app.use('/api/users',           require('./users'));
  app.use('/api/admin',           require('./admin'));
  app.use('/api/friends',         require('./friends'));
  app.use('/api/testimonials',    require('./testimonials'));
  app.use('/api/communities',     require('./communities'));
  app.use('/api/achievements',    require('./achievements'));
  app.use('/api/pedro',           require('./pedro'));
  app.use('/api/daily-questions', require('./daily_questions'));
  app.use('/api/geo',            require('./geo'));
  app.use('/api/map-points',     require('./map_points'));
  app.use('/api/events',         require('./events'));

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
