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
// index.html sem cache
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.sendFile(require('path').join(__dirname, 'index.html'));
});
app.get('/index.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.sendFile(require('path').join(__dirname, 'index.html'));
});

app.get('/dailyworldv2.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.sendFile(require('path').join(__dirname, 'dailyworldv2.html'));
});

app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/vapid-public-key', (req, res) => res.json({ key: VAPID_PUBLIC }));

process.on('uncaughtException', (err) => {
  console.error('CRASH:', err.message);
  console.error(err.stack);
  process.exit(1);
});


const dailyworldRoutes = require('./dailyworld_routes'); app.use('/api/dailyworld', dailyworldRoutes);(async () => {
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
    ['/api/quiz', './quiz'],
    ['/api/agora-chat', './agora_chat'],
    ['/api/achievements', './achievements'], ['/api/pedro', './pedro'],
    ['/api/daily-questions', './daily_questions'], ['/api/geo', './geo'],
    ['/api/map-points', './map_points'], ['/api/events', './events'],
    ['/api/feed', './feed'],
    ['/api/photos', './photos'],
    ['/api/notif-prefs', './notif_prefs'],
    ['/api/news', './news'],
    ['/api/turnos', './turnos'],
    ['/api/mural', './mural'],
    ['/api/birthdays', './birthdays'],
  ];
  for (const [path, file] of routeFiles) {
    try {
      const mod = require(file);
      // Suporte a módulos que exportam { router, ... }
      app.use(path, mod.router || mod);
      console.log('  ✓', path);
    }
    catch(e) { console.error('ROTA FALHOU', path, e.message); }
  }

  // Inicializar tabelas dos turnos após DB pronto
  try {
    const { initTurnosDB } = require('./turnos');
    await initTurnosDB();
    console.log('  ✓ turnos DB inicializado');
  } catch(e) { console.error('turnos DB erro:', e.message); }

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
  const { getDB } = require('./database');
  const SITE_URL = process.env.SITE_URL || 'https://web-production-da5a8.up.railway.app';

  function getBrazilHour() {
    const now = new Date();
    return new Date(now.getTime() - 3*60*60*1000).getUTCHours();
  }
  function getBrazilDateStr() {
    const now = new Date();
    return new Date(now.getTime() - 3*60*60*1000).toISOString().split('T')[0];
  }

  // Trava atômica no banco — garante que SÓ UM processo (e só uma vez) envia
  // cada notificação agendada, mesmo se o servidor reiniciar várias vezes
  // seguidas (deploys) ou se houver mais de uma instância rodando ao mesmo
  // tempo. Sem isso, cada reinício do processo zera as variáveis em memória
  // e reenvia tudo de novo — foi exatamente isso que causou o spam.
  async function claimSchedulerSlot(db, key) {
    try {
      const row = await db.prepare(
        "INSERT INTO scheduler_locks(key) VALUES($1) ON CONFLICT (key) DO NOTHING RETURNING key"
      ).get(key);
      return !!row; // true = ninguém tinha enviado ainda, pode prosseguir
    } catch(e) { console.error('claimSchedulerSlot erro:', e.message); return false; }
  }

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
      if (!period) return;
      const lockKey = `daily_question:${getBrazilDateStr()}:${period}`;
      if (!(await claimSchedulerSlot(db, lockKey))) return; // já enviado hoje
      const q = await db.prepare("SELECT * FROM daily_questions WHERE period=$1 AND active=1 LIMIT 1").get(period);
      if (!q) return;
      const periodNames = { manha:'☀️ Bom dia!', almoco:'🍽️ Hora do almoço!', tarde:'☕ Boa tarde!', noite:'🌙 Boa noite!' };
      const title = periodNames[period] || '🗓️ Nova Daily Pergunta';
      // notifId é só um identificador para o link/e-mail — NÃO grava na tabela
      // `notifications` (essa é exclusiva do banner/contador do Daily Mandou)
      const { v4: uuidv4 } = require('uuid');
      const notifId = uuidv4();
      await sendPushToAll(db, notifId, {
        title,
        body: q.question,
        url: SITE_URL + '/?tab=daily-pergunta',
        tag: 'daily-question',
      });
      console.log(`📬 Daily Pergunta enviada: ${period} — ${q.question}`);
    } catch(e) { console.error('daily question push error:', e.message); }
  }

  // Verificar a cada 5 minutos
  setInterval(checkDailyQuestionPush, 5 * 60 * 1000);
  checkDailyQuestionPush(); // verificar imediatamente

  // ── Scheduler: notificação do Quiz Arena à meia-noite ────────────────────
  async function checkQuizArenaPush() {
    try {
      const db = getDB();
      const h = getBrazilHour();
      if (h !== 0) return; // só à meia-noite (horário de Brasília)
      const lockKey = `quiz_arena:${getBrazilDateStr()}`;
      if (!(await claimSchedulerSlot(db, lockKey))) return; // já enviado hoje
      const { v4: uuidv4 } = require('uuid');
      const notifId = uuidv4();
      const msg = '🧠 O Quiz Diário do DAILY Quiz Arena está liberado! Jogue agora e represente sua cidade.';
      await sendPushToAll(db, notifId, {
        title: '🧠 Quiz Arena',
        body: msg,
        url: SITE_URL + '/?tab=jogos',
        tag: 'quiz-arena',
      });
      console.log('📬 Quiz Arena push enviado para todos os usuários');
    } catch(e) { console.error('quiz arena push error:', e.message); }
  }

  setInterval(checkQuizArenaPush, 5 * 60 * 1000);
  checkQuizArenaPush();

  // ── Scheduler: Turnos do Pedro — avisa quando um novo turno começa ───────
  async function checkTurnoPush() {
    try {
      const db = getDB();
      const { getTurnoAtivo } = require('./turnos');
      const turno = getTurnoAtivo();
      if (!turno) return;
      const lockKey = `turno:${getBrazilDateStr()}:${turno.id}`;
      if (!(await claimSchedulerSlot(db, lockKey))) return; // já enviado neste turno hoje
      const { v4: uuidv4 } = require('uuid');
      const notifId = uuidv4();
      const msg = `${turno.emoji} ${turno.nome} começou! ${turno.descricao}. Pedro está te esperando no Global 🐱`;
      await sendPushToAll(db, notifId, {
        title: `${turno.emoji} ${turno.nome}`,
        body: `${turno.descricao}. Poste uma foto e entre para a turma!`,
        url: SITE_URL + '/?tab=global',
        tag: 'turno-pedro',
      });
      console.log(`📬 Turno do Pedro enviado: ${turno.nome}`);
    } catch(e) { console.error('turno push error:', e.message); }
  }

  setInterval(checkTurnoPush, 5 * 60 * 1000);
  checkTurnoPush();

  // ── Scheduler: NEWS automático ────────────────────────────────────────────
  let newsScheduler;
  try {
    newsScheduler = require('./news_scheduler');
    const { getDB } = require('./database');
    setInterval(() => newsScheduler.runNewsSchedulers(getDB()), 5 * 60 * 1000);
    // Checar aniversários a cada hora
    async function checkAnniversaries() {
      try {
        const db = getDB();
        const milestones = [10,30,90,180,365,730,1095,1825];
        const users = await db.prepare(`SELECT id, username, created_at FROM users`).all();
        for (const u of users) {
          const days = Math.floor((Date.now() - new Date(u.created_at).getTime()) / (1000*60*60*24));
          if (milestones.includes(days)) {
            // Só publica uma vez por marco (verifica se já existe news)
            const existing = await db.prepare(
              `SELECT id FROM news WHERE category='anniversary' AND body LIKE $1 AND created_at > NOW() - INTERVAL '2 days'`
            ).get(`%@${u.username}%`);
            if (!existing) {
              await newsScheduler.notifyAnniversary(db, { username: u.username, user_id: u.id, days });
            }
          }
        }
      } catch(e) { console.error('news anniversary check:', e.message); }
    }
    setInterval(checkAnniversaries, 60 * 60 * 1000);
    console.log('  ✓ News scheduler ativo');

    // Scheduler aniversariantes: roda a cada hora, Pedro posta às 6h
    try {
      const { runBirthdayScheduler } = require('./birthdays');
      async function checkBirthdayScheduler() {
        const h = new Date().getHours();
        if (h === 6) await runBirthdayScheduler(getDB());
      }
      setInterval(checkBirthdayScheduler, 60 * 60 * 1000);
      // Rodar imediatamente também (caso servidor reinicie às 6h)
      checkBirthdayScheduler();
      console.log('  ✓ Birthday scheduler ativo');
    } catch(e) { console.error('birthday_scheduler:', e.message); }
  } catch(e) { console.error('news_scheduler:', e.message); }

    const PORT = process.env.PORT || 3000;
  const httpServer = http.createServer(app);
  // WebSocket — dois WSS independentes, cada um com seu próprio handleUpgrade
  // (compartilhar um único WSS fazia o Truco fechar conexões do Coop)
  try {
    if (WebSocketServer) {
      const wssTruco = new WebSocketServer({ noServer: true });
      const wssCoop  = new WebSocketServer({ noServer: true });

      try {
        const { setupTrucoWS } = require('./truco');
        setupTrucoWS(wssTruco);
        console.log('  ✓ Truco WS pronto');
      } catch(e) { console.warn('Truco WS erro:', e.message); }

      try {
        const { setupCoopWS } = require('./coop');
        setupCoopWS(wssCoop);
        console.log('  ✓ Coop WS pronto');
      } catch(e) { console.warn('Coop WS erro:', e.message); }

      httpServer.on('upgrade', (req, socket, head) => {
        const path = req.url.split('?')[0];
        if (path === '/ws/truco') {
          wssTruco.handleUpgrade(req, socket, head, ws => wssTruco.emit('connection', ws, req));
        } else if (path === '/ws/coop') {
          wssCoop.handleUpgrade(req, socket, head, ws => wssCoop.emit('connection', ws, req));
        } else {
          socket.destroy();
        }
      });

      console.log('  ✓ WebSocket ativo: /ws/truco + /ws/coop');
    }
  } catch(e) { console.warn('WS erro:', e.message); }
  httpServer.listen(PORT, '0.0.0.0', () => console.log(`\n🗓️  DAILY v3 rodando em http://localhost:${PORT}\n`));
  } catch(err) {
    console.error('FATAL ao iniciar:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
})();
