require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const path    = require('path');
const http    = require('http');
let WebSocketServer;
try { WebSocketServer = require('ws').WebSocketServer; } catch(e) { console.warn('ws não instalado, Truco offline'); }
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
  // Seed novas conquistas
  try {
    const { seedNewAchievements } = require('./achievements');
    const { getDB } = require('./database');
    await seedNewAchievements(getDB());
    console.log('  ✓ conquistas seeded');
  } catch(e) { console.error('seed ach:', e.message); }

  const routeFiles = [
    ['/api/auth', './auth'], ['/api/posts', './posts'], ['/api/users', './users'],
    ['/api/admin', './admin'], ['/api/friends', './friends'],
    ['/api/testimonials', './testimonials'], ['/api/communities', './communities'],
    ['/api/user-notifications', './user_notifications'],
    ['/api/agenda', './agenda'],
    ['/api/dailypoke', './dailypoke'],
    ['/api/catrunner', './catrunner'],
    ['/api/truco', './truco_api'],
    ['/api/agora-chat', './agora_chat'],
    ['/api/achievements', './achievements'], ['/api/pedro', './pedro'],
    ['/api/daily-questions', './daily_questions'], ['/api/geo', './geo'],
    ['/api/map-points', './map_points'], ['/api/events', './events'],
    ['/api/feed', './feed'],
    ['/api/photos', './photos'],
    ['/api/notif-prefs', './notif_prefs'],
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


  // ── Scheduler: notificação do Daily Pergunta por período ──────────────────
  const { sendPushToAll } = require('./notifications');

  function getBrazilHour() {
    const now = new Date();
    return new Date(now.getTime() - 3*60*60*1000).getUTCHours();
  }

  let lastQuestionPeriod = null;

  async function checkDailyQuestionPush() {
    try {
      const db = getDB();
      const h = getBrazilHour();
      // Períodos: manhã 6h, almoço 12h, tarde 15h, noite 20h
      let period = null;
      if      (h === 6)  period = 'manha';
      else if (h === 12) period = 'almoco';
      else if (h === 15) period = 'tarde';
      else if (h === 20) period = 'noite';
      if (!period || period === lastQuestionPeriod) return;
      const q = await db.prepare("SELECT * FROM daily_questions WHERE period=$1 AND active=1 LIMIT 1").get(period);
      if (!q) return;
      lastQuestionPeriod = period;
      const periodNames = { manha:'☀️ Bom dia!', almoco:'🍽️ Hora do almoço!', tarde:'☕ Boa tarde!', noite:'🌙 Boa noite!' };
      // Inserir notificação global temporária
      const { v4: uuidv4 } = require('uuid');
      const notifId = uuidv4();
      await db.prepare("INSERT INTO notifications(id,message,active,sent_at,expires_at) VALUES($1,$2,1,NOW(),NOW()+INTERVAL '1 hour')")
        .run(notifId, `${periodNames[period]} Pergunta do Dia: ${q.question}`);
      await sendPushToAll(db, notifId);
      console.log(`📬 Daily Pergunta enviada: ${period} — ${q.question}`);
    } catch(e) { console.error('daily question push error:', e.message); }
  }

  // Verificar a cada 5 minutos
  setInterval(checkDailyQuestionPush, 5 * 60 * 1000);
  checkDailyQuestionPush(); // verificar imediatamente

    const PORT = process.env.PORT || 3000;
  const httpServer = http.createServer(app);
  // WebSocket para Truco (opcional)
  try {
    if (WebSocketServer) {
      const { setupTrucoWS } = require('./truco');
      const wss = new WebSocketServer({ server: httpServer, path: '/ws/truco' });
      setupTrucoWS(wss);
      console.log('  ✓ Truco WebSocket ativo');
    }
  } catch(e) { console.warn('Truco WS erro:', e.message); }
  httpServer.listen(PORT, '0.0.0.0', () => console.log(`\n🗓️  DAILY v3 rodando em http://localhost:${PORT}\n`));
  } catch(err) {
    console.error('FATAL ao iniciar:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
