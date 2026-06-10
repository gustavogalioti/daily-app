// quiz.js — DAILY Quiz Arena backend
const express = require('express');
const router  = express.Router();
const { getDB } = require('./database');
const { authMiddleware: requireAuth, optionalAuth } = require('./authmiddleware');
const { v4: uuidv4 } = require('uuid');

// ─── BANCO DE PERGUNTAS (seed interno) ───────────────────────────────────────
const QUESTION_BANK = [
  // História
  { category:'historia', q:'Em que ano o Brasil declarou independência de Portugal?', opts:['1808','1822','1889','1840'], correct:1 },
  { category:'historia', q:'Quem proclamou a República do Brasil?', opts:['Dom Pedro II','Getúlio Vargas','Marechal Deodoro da Fonseca','Tiradentes'], correct:2 },
  { category:'historia', q:'Em que ano terminou a Segunda Guerra Mundial?', opts:['1943','1944','1945','1946'], correct:2 },
  { category:'historia', q:'Qual país lançou as primeiras bombas atômicas em combate?', opts:['URSS','Alemanha','Reino Unido','Estados Unidos'], correct:3 },
  { category:'historia', q:'Tiradentes foi executado em que século?', opts:['XVII','XVIII','XIX','XVI'], correct:1 },
  { category:'historia', q:'Quem foi o primeiro presidente do Brasil?', opts:['Floriano Peixoto','Deodoro da Fonseca','Campos Sales','Prudente de Morais'], correct:1 },
  { category:'historia', q:'A abolição da escravatura no Brasil ocorreu em:', opts:['1880','1884','1888','1890'], correct:2 },
  { category:'historia', q:'Qual foi o apelido dado à crise econômica iniciada em 1929?', opts:['Grande Recessão','Colapso de Wall Street','Grande Depressão','Crash do Ouro'], correct:2 },
  // Geografia
  { category:'geografia', q:'Qual é o maior país do mundo em área territorial?', opts:['China','Canadá','EUA','Rússia'], correct:3 },
  { category:'geografia', q:'Qual é o rio mais longo do mundo?', opts:['Amazonas','Nilo','Yangtzé','Mississippi'], correct:1 },
  { category:'geografia', q:'Qual é a capital da Austrália?', opts:['Sydney','Melbourne','Brisbane','Canberra'], correct:3 },
  { category:'geografia', q:'Em qual continente fica o Egito?', opts:['Ásia','Europa','África','Oceania'], correct:2 },
  { category:'geografia', q:'Quantos estados tem o Brasil?', opts:['24','25','26','27'], correct:3 },
  { category:'geografia', q:'Qual é o ponto mais alto do Brasil?', opts:['Pico da Neblina','Serra da Mantiqueira','Pico 31 de Março','Pedra da Mina'], correct:0 },
  { category:'geografia', q:'O Deserto do Saara fica em qual continente?', opts:['Ásia','África','América do Sul','Oceania'], correct:1 },
  { category:'geografia', q:'Qual país tem mais fronteiras terrestres?', opts:['Brasil','Rússia','China','Alemanha'], correct:2 },
  // Ciências
  { category:'ciencias', q:'Qual é o elemento químico mais abundante no universo?', opts:['Oxigênio','Hélio','Carbono','Hidrogênio'], correct:3 },
  { category:'ciencias', q:'Quantos ossos tem o corpo humano adulto?', opts:['196','206','216','226'], correct:1 },
  { category:'ciencias', q:'Qual é o planeta mais próximo do Sol?', opts:['Vênus','Terra','Mercúrio','Marte'], correct:2 },
  { category:'ciencias', q:'A fórmula da água é:', opts:['H3O','OH2','HO','H2O'], correct:3 },
  { category:'ciencias', q:'Qual animal tem o maior coração proporcionalmente?', opts:['Elefante','Baleia-azul','Girafa','Gato'], correct:1 },
  { category:'ciencias', q:'DNA significa:', opts:['Ácido Desoxirribonucleico','Ácido Dinitroamínico','Dupla Nucleotídica Ativa','Ácido Dinucleico'], correct:0 },
  { category:'ciencias', q:'Quantos cromossomos tem o ser humano?', opts:['23','44','46','48'], correct:2 },
  // Cultura Pop
  { category:'cultura_pop', q:'Qual é a franquia de filmes mais lucrativa de todos os tempos?', opts:['Harry Potter','Star Wars','Marvel Cinematic Universe','James Bond'], correct:2 },
  { category:'cultura_pop', q:'Quem criou o personagem Mickey Mouse?', opts:['Walt Disney','Roy Disney','Ub Iwerks','Chuck Jones'], correct:2 },
  { category:'cultura_pop', q:'Qual banda britânica vendeu mais discos na história?', opts:['Rolling Stones','Led Zeppelin','The Beatles','Queen'], correct:2 },
  { category:'cultura_pop', q:'O jogo Minecraft foi criado por:', opts:['Notch (Markus Persson)','Gabe Newell','Todd Howard','Shigeru Miyamoto'], correct:0 },
  { category:'cultura_pop', q:'Qual personagem disse "Que a força esteja com você"?', opts:['Luke Skywalker','Darth Vader','Obi-Wan Kenobi','Yoda'], correct:2 },
  { category:'cultura_pop', q:'Quantas temporadas tem a série Breaking Bad?', opts:['3','4','5','6'], correct:2 },
  // Esportes
  { category:'esportes', q:'Quantas Copas do Mundo o Brasil conquistou?', opts:['4','5','6','3'], correct:1 },
  { category:'esportes', q:'Em que país foi realizada a Copa do Mundo de 2018?', opts:['Alemanha','Rússia','Brasil','Catar'], correct:1 },
  { category:'esportes', q:'Qual esporte é praticado no Wimbledon?', opts:['Golfe','Cricket','Tênis','Polo'], correct:2 },
  { category:'esportes', q:'Quem detém o recorde de mais gols em uma Copa do Mundo?', opts:['Pelé','Ronaldo','Miroslav Klose','Just Fontaine'], correct:2 },
  { category:'esportes', q:'Qual time ganhou mais títulos da NBA?', opts:['LA Lakers','Chicago Bulls','Boston Celtics','Golden State Warriors'], correct:2 },
  { category:'esportes', q:'A maratona tem quantos km?', opts:['40','41','42,195','43'], correct:2 },
  // Cinema
  { category:'cinema', q:'Qual filme ganhou mais Oscars na história?', opts:['Titanic','Ben-Hur','O Senhor dos Anéis: O Retorno do Rei','Gandhi'], correct:2 },
  { category:'cinema', q:'Quem dirigiu o filme "Pulp Fiction"?', opts:['Martin Scorsese','Steven Spielberg','Quentin Tarantino','Francis Ford Coppola'], correct:2 },
  { category:'cinema', q:'Qual ator interpretou o Coringa no filme de 2019?', opts:['Jared Leto','Heath Ledger','Joaquin Phoenix','Jack Nicholson'], correct:2 },
  { category:'cinema', q:'O filme "Parasita" que ganhou o Oscar de Melhor Filme é de qual país?', opts:['Japão','China','Coreia do Sul','Tailândia'], correct:2 },
  // Tecnologia
  { category:'tecnologia', q:'Quem cofundou a Apple com Steve Jobs?', opts:['Bill Gates','Steve Wozniak','Elon Musk','Paul Allen'], correct:1 },
  { category:'tecnologia', q:'O que significa "HTTP"?', opts:['Hyper Text Transfer Protocol','High Tech Transfer Platform','Hyper Typed Transfer Page','Hub Text Tool Protocol'], correct:0 },
  { category:'tecnologia', q:'Qual linguagem de programação é mais usada no mundo?', opts:['Java','C++','Python','JavaScript'], correct:3 },
  { category:'tecnologia', q:'Em que ano o Instagram foi lançado?', opts:['2009','2010','2011','2012'], correct:1 },
  { category:'tecnologia', q:'O criador do Linux se chama:', opts:['Linus Torvalds','Richard Stallman','Dennis Ritchie','Ken Thompson'], correct:0 },
  // Geral
  { category:'geral', q:'Qual é o instrumento musical de cordas mais antigo?', opts:['Guitarra','Harpa','Violino','Lira'], correct:1 },
  { category:'geral', q:'Quantos países fazem parte da ONU?', opts:['173','193','203','213'], correct:1 },
  { category:'geral', q:'Qual é o livro mais vendido da história?', opts:['O Senhor dos Anéis','Quijote','A Bíblia','Harry Potter'], correct:2 },
  { category:'geral', q:'Qual é o país mais populoso do mundo?', opts:['Índia','China','EUA','Indonésia'], correct:0 },
  { category:'geral', q:'Em que continente fica o Monte Everest?', opts:['África','Europa','Ásia','América'], correct:2 },
  // Futebol (para modo 1x1)
  { category:'futebol', q:'Quantos jogadores tem um time de futebol em campo?', opts:['10','11','12','9'], correct:1 },
  { category:'futebol', q:'Qual clube tem mais títulos da Copa Libertadores?', opts:['Flamengo','Boca Juniors','Estudiantes','Independiente'], correct:3 },
  { category:'futebol', q:'Quem marcou a "Mão de Deus" na Copa de 1986?', opts:['Pelé','Ronaldo','Maradona','Zico'], correct:2 },
  { category:'futebol', q:'Em que ano o Brasil ganhou sua primeira Copa do Mundo?', opts:['1950','1954','1958','1962'], correct:2 },
  { category:'futebol', q:'Qual estádio tem maior capacidade no Brasil?', opts:['Maracanã','Mineirão','Morumbi','Castelão'], correct:0 },
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getQuestions(category, count) {
  const pool = category === 'aleatorio'
    ? QUESTION_BANK
    : QUESTION_BANK.filter(q => q.category === category);
  return shuffle(pool).slice(0, count).map((q, i) => ({
    id: i,
    category: q.category,
    question: q.q,
    options: q.opts,
    correct: q.correct,
  }));
}

// ─── ROTA: PERFIL DO QUIZ ─────────────────────────────────────────────────────
router.get('/profile/me', requireAuth, async (req, res) => {
  const db = getDB();
  const { rows } = await db.query(
    `SELECT * FROM quiz_profiles WHERE user_id=$1`, [req.user.id]
  );
  if (!rows.length) {
    // criar perfil se não existir
    const city = (await db.query(`SELECT city FROM users WHERE id=$1`,[req.user.id])).rows[0]?.city || null;
    await db.query(
      `INSERT INTO quiz_profiles (user_id, city) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [req.user.id, city]
    );
    return res.json((await db.query(`SELECT * FROM quiz_profiles WHERE user_id=$1`,[req.user.id])).rows[0]);
  }
  res.json(rows[0]);
});

// ─── ROTA: RANKING GLOBAL ─────────────────────────────────────────────────────
router.get('/ranking', optionalAuth, async (req, res) => {
  const db = getDB();
  const { rows } = await db.query(`
    SELECT qp.*, u.name, u.username, u.avatar
    FROM quiz_profiles qp
    JOIN users u ON u.id = qp.user_id
    ORDER BY qp.xp_total DESC
    LIMIT 50
  `);
  res.json(rows);
});

// ─── ROTA: RANKING DE CIDADES ─────────────────────────────────────────────────
router.get('/cities-ranking', optionalAuth, async (req, res) => {
  const db = getDB();
  const { rows } = await db.query(`
    SELECT
      city,
      SUM(season_points) AS total_pts,
      COUNT(*) AS members,
      CASE WHEN COUNT(*) > 0 THEN SUM(season_points)::float / COUNT(*) ELSE 0 END AS efficiency
    FROM quiz_profiles
    WHERE city IS NOT NULL AND season_points > 0
    GROUP BY city
    ORDER BY efficiency DESC
    LIMIT 20
  `);
  res.json(rows);
});

// ─── ROTA: QUIZ DIÁRIO ────────────────────────────────────────────────────────
router.get('/daily', requireAuth, async (req, res) => {
  const db = getDB();
  const today = new Date().toISOString().split('T')[0];
  const { rows } = await db.query(
    `SELECT * FROM quiz_daily_attempts WHERE user_id=$1 AND attempt_date=$2`,
    [req.user.id, today]
  );
  if (rows.length) return res.json({ done: true, score: rows[0].score, xp: rows[0].xp_earned });
  const questions = getQuestions('aleatorio', 10);
  res.json({ done: false, questions });
});

router.post('/daily/submit', requireAuth, async (req, res) => {
  const db = getDB();
  const { answers } = req.body; // [{questionId, answer}]
  const today = new Date().toISOString().split('T')[0];

  const already = await db.query(
    `SELECT id FROM quiz_daily_attempts WHERE user_id=$1 AND attempt_date=$2`,
    [req.user.id, today]
  );
  if (already.rows.length) return res.status(400).json({ error: 'Quiz diário já respondido hoje.' });

  const questions = getQuestions('aleatorio', 10);
  // reconstruir (seed fixo por data — simplificado: usamos as mesmas da sessão)
  // Para produção: gerar seed por data. Aqui validamos no trust mas calculamos
  let correct = 0;
  // Como as perguntas vêm do servidor, vamos pegar do body
  const { questions: sentQs } = req.body;
  if (sentQs) {
    sentQs.forEach((q, i) => {
      if (answers[i] !== undefined && answers[i] === q.correct) correct++;
    });
  }
  let xp = correct;
  if (correct === 10) xp += 10;
  else if (correct === 9) xp += 5;

  // streak
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const prevStreak = await db.query(
    `SELECT * FROM quiz_daily_attempts WHERE user_id=$1 AND attempt_date=$2`,
    [req.user.id, yesterday]
  );
  const profile = (await db.query(`SELECT * FROM quiz_profiles WHERE user_id=$1`,[req.user.id])).rows[0];
  let streak = prevStreak.rows.length ? (profile?.daily_streak || 0) + 1 : 1;
  if (streak === 7)  xp += 30;
  else if (streak === 30) xp += 100;
  else if (streak > 1) xp += 5;

  await db.query(
    `INSERT INTO quiz_daily_attempts (user_id, attempt_date, score, xp_earned) VALUES ($1,$2,$3,$4)`,
    [req.user.id, today, correct, xp]
  );

  // upsert profile
  await db.query(`
    INSERT INTO quiz_profiles (user_id, xp_total, season_points, daily_streak, best_streak, city)
    VALUES ($1,$2,$2,$3,$3,(SELECT city FROM users WHERE id=$1))
    ON CONFLICT (user_id) DO UPDATE SET
      xp_total = quiz_profiles.xp_total + $2,
      season_points = quiz_profiles.season_points + $2,
      daily_streak = $3,
      best_streak = GREATEST(quiz_profiles.best_streak, $3),
      city = COALESCE(quiz_profiles.city, (SELECT city FROM users WHERE id=$1)),
      last_daily = CURRENT_DATE
  `, [req.user.id, xp, streak]);

  await checkLeague(req.user.id, db);
  res.json({ correct, total: 10, xp, streak });
});

// ─── ROTA: BATALHA 1X1 ────────────────────────────────────────────────────────
router.post('/battle/create', requireAuth, async (req, res) => {
  const db = getDB();
  const { opponent_id, category, question_count } = req.body;
  const qcount = Math.min(parseInt(question_count) || 10, 20);
  const questions = getQuestions(category || 'aleatorio', qcount);
  const id = uuidv4();
  await db.query(`
    INSERT INTO quiz_battles (id, challenger_id, opponent_id, category, question_count, questions, status)
    VALUES ($1,$2,$3,$4,$5,$6,'pending')
  `, [id, req.user.id, opponent_id, category, qcount, JSON.stringify(questions)]);

  // notificação
  try {
    await db.query(`
      INSERT INTO user_notifications (id, user_id, type, actor_id, message, link)
      VALUES ($1,$2,'quiz_challenge',$3,'desafiou você para uma batalha no Quiz Arena!',$4)
    `, [uuidv4(), opponent_id, req.user.id, `/battle/${id}`]);
  } catch(e) {}

  res.json({ id, questions });
});

router.get('/battle/:id', requireAuth, async (req, res) => {
  const db = getDB();
  const { rows } = await db.query(`
    SELECT qb.*,
      u1.name as challenger_name, u1.username as challenger_username, u1.avatar as challenger_avatar,
      u2.name as opponent_name, u2.username as opponent_username, u2.avatar as opponent_avatar
    FROM quiz_battles qb
    JOIN users u1 ON u1.id = qb.challenger_id
    LEFT JOIN users u2 ON u2.id = qb.opponent_id
    WHERE qb.id=$1
  `, [req.params.id]);
  if (!rows.length) return res.status(404).json({ error: 'Batalha não encontrada' });
  const b = rows[0];
  b.questions = JSON.parse(b.questions);
  res.json(b);
});

router.post('/battle/:id/submit', requireAuth, async (req, res) => {
  const db = getDB();
  const { score, time_ms } = req.body;
  const battle = (await db.query(`SELECT * FROM quiz_battles WHERE id=$1`,[req.params.id])).rows[0];
  if (!battle) return res.status(404).json({ error: 'Batalha não encontrada' });

  const isChallenger = battle.challenger_id === req.user.id;
  const field = isChallenger ? 'challenger_score' : 'opponent_score';
  const timeField = isChallenger ? 'challenger_time_ms' : 'opponent_time_ms';

  await db.query(
    `UPDATE quiz_battles SET ${field}=$1, ${timeField}=$2, status=
     CASE WHEN challenger_score IS NOT NULL AND opponent_score IS NOT NULL THEN 'finished'
          WHEN $3 THEN 'challenger_done' ELSE 'opponent_done' END
     WHERE id=$4`,
    [score, time_ms, isChallenger, req.params.id]
  );

  const updated = (await db.query(`SELECT * FROM quiz_battles WHERE id=$1`,[req.params.id])).rows[0];

  if (updated.status === 'finished') {
    // determinar vencedor
    let winner_id = null;
    const cs = updated.challenger_score, os = updated.opponent_score;
    const ct = updated.challenger_time_ms, ot = updated.opponent_time_ms;
    if (cs > os) winner_id = updated.challenger_id;
    else if (os > cs) winner_id = updated.opponent_id;
    else if (ct < ot) winner_id = updated.challenger_id; // empate: menor tempo vence
    else winner_id = updated.opponent_id;

    await db.query(`UPDATE quiz_battles SET winner_id=$1 WHERE id=$2`,[winner_id, req.params.id]);

    // XP
    const loser_id = winner_id === updated.challenger_id ? updated.opponent_id : updated.challenger_id;
    await addXP(winner_id, 15, db);
    await addXP(loser_id, 3, db);

    // stats
    await db.query(`UPDATE quiz_profiles SET wins=wins+1 WHERE user_id=$1`,[winner_id]);
    await db.query(`UPDATE quiz_profiles SET losses=losses+1 WHERE user_id=$1`,[loser_id]);

    // notificação ao vencedor
    try {
      const winnerName = (await db.query(`SELECT name FROM users WHERE id=$1`,[winner_id])).rows[0]?.name;
      const loserName  = (await db.query(`SELECT name FROM users WHERE id=$1`,[loser_id])).rows[0]?.name;
      await db.query(`INSERT INTO user_notifications (id,user_id,type,actor_id,message) VALUES ($1,$2,'quiz_result',$3,$4)`,
        [uuidv4(), loser_id, winner_id, `${winnerName} venceu a batalha ${cs}x${os} no Quiz Arena!`]);
    } catch(e) {}
  }

  res.json({ ok: true, status: updated.status });
});

// ─── ROTA: MEUS DESAFIOS ──────────────────────────────────────────────────────
router.get('/battles', requireAuth, async (req, res) => {
  const db = getDB();
  const { rows } = await db.query(`
    SELECT qb.*,
      u1.name as challenger_name, u1.username as challenger_username, u1.avatar as challenger_avatar,
      u2.name as opponent_name, u2.username as opponent_username, u2.avatar as opponent_avatar
    FROM quiz_battles qb
    JOIN users u1 ON u1.id = qb.challenger_id
    LEFT JOIN users u2 ON u2.id = qb.opponent_id
    WHERE qb.challenger_id=$1 OR qb.opponent_id=$1
    ORDER BY qb.created_at DESC
    LIMIT 20
  `, [req.user.id]);
  res.json(rows.map(b => { try { b.questions = JSON.parse(b.questions); } catch(e){} return b; }));
});

// ─── ROTA: XP BET ─────────────────────────────────────────────────────────────
router.post('/bet/create', requireAuth, async (req, res) => {
  const db = getDB();
  const { opponent_id, bet_amount, category } = req.body;
  const valid = [50, 100, 250, 500];
  if (!valid.includes(parseInt(bet_amount))) return res.status(400).json({ error: 'Valor de aposta inválido' });

  const profile = (await db.query(`SELECT xp_total FROM quiz_profiles WHERE user_id=$1`,[req.user.id])).rows[0];
  if (!profile || profile.xp_total < bet_amount) return res.status(400).json({ error: 'XP insuficiente' });

  // bloquear XP
  await db.query(`UPDATE quiz_profiles SET xp_total=xp_total-$1 WHERE user_id=$2`,[bet_amount, req.user.id]);

  const questions = getQuestions(category || 'aleatorio', 10);
  const id = uuidv4();
  await db.query(`
    INSERT INTO quiz_battles (id, challenger_id, opponent_id, category, question_count, questions, status, is_bet, bet_amount)
    VALUES ($1,$2,$3,$4,10,$5,'pending',true,$6)
  `, [id, req.user.id, opponent_id, category || 'aleatorio', JSON.stringify(questions), bet_amount]);

  res.json({ id, questions, bet_amount });
});

// ─── ROTA: BATTLE ROYALE ──────────────────────────────────────────────────────
const royaleRooms = new Map(); // em memória por simplicidade

router.post('/royale/join', requireAuth, async (req, res) => {
  const db = getDB();
  // pegar sala aberta ou criar
  let room = [...royaleRooms.values()].find(r => r.status === 'waiting' && r.players.length < 100);
  if (!room) {
    const roomId = uuidv4();
    room = {
      id: roomId,
      status: 'waiting',
      players: [],
      questions: getQuestions('aleatorio', 20),
      currentQuestion: 0,
      eliminated: [],
      startTime: null,
    };
    royaleRooms.set(roomId, room);
  }

  const already = room.players.find(p => p.id === req.user.id);
  if (!already) {
    room.players.push({ id: req.user.id, name: req.user.name, username: req.user.username, avatar: req.user.avatar, alive: true, score: 0 });
  }

  // auto-start com >=2 jogadores após 30s
  if (room.players.length >= 2 && !room.startTime) {
    room.startTime = Date.now() + 30000;
    setTimeout(() => { if (room.status === 'waiting') room.status = 'playing'; }, 30000);
  }

  res.json({ roomId: room.id, players: room.players.length, status: room.status, startTime: room.startTime });
});

router.get('/royale/:roomId/state', requireAuth, (req, res) => {
  const room = royaleRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Sala não encontrada' });
  const qIdx = room.currentQuestion;
  const q = room.questions[qIdx] ? { ...room.questions[qIdx] } : null;
  res.json({
    status: room.status,
    players: room.players.length,
    alive: room.players.filter(p => p.alive).length,
    eliminated: room.eliminated.length,
    question: q ? { id: q.id, question: q.question, options: q.options } : null,
    questionIndex: qIdx,
    total: room.questions.length,
    startTime: room.startTime,
  });
});

router.post('/royale/:roomId/answer', requireAuth, async (req, res) => {
  const db = getDB();
  const room = royaleRooms.get(req.params.roomId);
  if (!room || room.status !== 'playing') return res.status(400).json({ error: 'Sala inativa' });

  const { answer } = req.body;
  const player = room.players.find(p => p.id === req.user.id);
  if (!player || !player.alive) return res.status(400).json({ error: 'Eliminado' });

  const q = room.questions[room.currentQuestion];
  if (!q) return res.json({ alive: player.alive, correct: false });

  const correct = answer === q.correct;
  if (correct) {
    player.score++;
  } else {
    player.alive = false;
    room.eliminated.push({ ...player, eliminatedAt: room.currentQuestion });
  }

  // avançar pergunta quando todos responderam ou eliminados
  const alive = room.players.filter(p => p.alive);
  if (alive.length <= 1) {
    room.status = 'finished';
    // XP prêmios
    if (alive.length === 1) {
      await addXP(alive[0].id, 250, db);
      await db.query(`UPDATE quiz_profiles SET wins=wins+1 WHERE user_id=$1`,[alive[0].id]);
    }
    setTimeout(() => royaleRooms.delete(room.id), 300000); // limpar em 5min
  }

  res.json({ alive: player.alive, correct, surviving: alive.length });
});

// ─── ROTA: CHAT DA SALA ────────────────────────────────────────────────────────
const roomChats = new Map();

router.post('/chat/:roomId', requireAuth, async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: 'Mensagem vazia' });
  if (!roomChats.has(req.params.roomId)) roomChats.set(req.params.roomId, []);
  const msgs = roomChats.get(req.params.roomId);
  const msg = {
    id: uuidv4(),
    user_id: req.user.id,
    name: req.user.name,
    username: req.user.username,
    avatar: req.user.avatar,
    message: message.trim().slice(0, 200),
    created_at: new Date().toISOString(),
  };
  msgs.push(msg);
  if (msgs.length > 100) msgs.splice(0, msgs.length - 100);
  res.json(msg);
});

router.get('/chat/:roomId', requireAuth, (req, res) => {
  const msgs = roomChats.get(req.params.roomId) || [];
  const since = req.query.since;
  const filtered = since ? msgs.filter(m => m.created_at > since) : msgs.slice(-30);
  res.json(filtered);
});

// ─── HELPERS INTERNOS ─────────────────────────────────────────────────────────
async function addXP(userId, xp, db) {
  await db.query(`
    INSERT INTO quiz_profiles (user_id, xp_total, season_points)
    VALUES ($1,$2,$2)
    ON CONFLICT (user_id) DO UPDATE SET
      xp_total = quiz_profiles.xp_total + $2,
      season_points = quiz_profiles.season_points + $2
  `, [userId, xp]);
  await checkLeague(userId, db);
}

async function checkLeague(userId, db) {
  const { rows } = await db.query(`SELECT season_points, league FROM quiz_profiles WHERE user_id=$1`,[userId]);
  if (!rows.length) return;
  const pts = rows[0].season_points;
  const leagues = ['Bronze III','Bronze II','Bronze I','Prata III','Prata II','Prata I',
    'Ouro III','Ouro II','Ouro I','Platina III','Platina II','Platina I',
    'Diamante III','Diamante II','Diamante I','Mestre','Lenda'];
  const thresholds = [0,100,250,500,900,1400,2000,2700,3500,4500,5700,7100,8700,10500,12500,15000,20000];
  let league = 'Bronze III';
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (pts >= thresholds[i]) { league = leagues[i]; break; }
  }
  if (league !== rows[0].league) {
    await db.query(`UPDATE quiz_profiles SET league=$1, best_league=$2 WHERE user_id=$3`,
      [league, league, userId]);
  }
}

module.exports = router;
