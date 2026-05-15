require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const { initDB } = require('./database');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

(async () => {
  await initDB();
  require('./cloudinary');

  app.use('/api/auth',  require('./routes/auth'));
  app.use('/api/posts', require('./routes/posts'));
  app.use('/api/users', require('./routes/users'));
  app.use('/api/qod',   require('./routes/qod'));

  app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'DAILY', version: '1.0.0' }));

  app.get('*', (req, res) => {
    if (req.path.startsWith('/api')) return res.status(404).json({ error: 'Not found' });
    res.sendFile(path.join(__dirname, 'index.html'));
  });

  app.use((err, req, res, next) => {
    console.error(err.message);
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Arquivo muito grande (máx 10MB)' });
    res.status(500).json({ error: err.message || 'Erro interno' });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🗓️  DAILY rodando em http://localhost:${PORT}\n`);
  });
})();
