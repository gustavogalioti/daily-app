// quiz.js — DAILY Quiz Arena (PostgreSQL via wrapper)
const express = require('express');
const router  = express.Router();
const { getDB } = require('./database');
const { authMiddleware: requireAuth, optionalAuth } = require('./authmiddleware');
const { v4: uuidv4 } = require('uuid');

// ─── BANCO DE PERGUNTAS (importado de quiz_questions.js) ────────────────────
const { QUESTION_BANK } = require('./quiz_questions');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getQuestions(category, count) {
  const pool = (!category || category === 'aleatorio')
    ? QUESTION_BANK
    : QUESTION_BANK.filter(q => q.category === category);
  const src = pool.length ? pool : QUESTION_BANK;
  return shuffle(src).slice(0, count).map((q, i) => ({
    id: i, category: q.category, question: q.q, options: q.opts, correct: q.correct,
  }));
}

// ─── LIGAS ────────────────────────────────────────────────────────────────────
const LEAGUES = ['Bronze III','Bronze II','Bronze I','Prata III','Prata II','Prata I',
  'Ouro III','Ouro II','Ouro I','Platina III','Platina II','Platina I',
  'Diamante III','Diamante II','Diamante I','Mestre','Lenda'];
const THRESHOLDS = [0,100,250,500,900,1400,2000,2700,3500,4500,5700,7100,8700,10500,12500,15000,20000];

function xpToLeague(pts) {
  let league = 'Bronze III';
  for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
    if (pts >= THRESHOLDS[i]) { league = LEAGUES[i]; break; }
  }
  return league;
}

// ─── HELPER: upsert perfil ────────────────────────────────────────────────────
async function upsertProfile(userId, db) {
  // Tenta buscar — se não existir, cria
  let p = await db.prepare(`SELECT * FROM quiz_profiles WHERE user_id=?`).get(userId);
  if (!p) {
    let city = null;
    try { const u = await db.prepare(`SELECT city FROM users WHERE id=?`).get(userId); city = u?.city || null; } catch(e){}
    await db.prepare(`INSERT INTO quiz_profiles (user_id, city) VALUES (?,?) ON CONFLICT (user_id) DO NOTHING`).run(userId, city);
    p = await db.prepare(`SELECT * FROM quiz_profiles WHERE user_id=?`).get(userId);
  }
  return p || { user_id: userId, xp_total: 0, season_points: 0, league: 'Bronze III', wins: 0, losses: 0, daily_streak: 0, best_streak: 0 };
}

async function addXP(userId, xp, db) {
  try {
    const p = await upsertProfile(userId, db);
    const newXp = (p.xp_total || 0) + xp;
    const newSeason = (p.season_points || 0) + xp;
    const league = xpToLeague(newSeason);
    await db.prepare(`UPDATE quiz_profiles SET xp_total=?, season_points=?, league=? WHERE user_id=?`)
      .run(newXp, newSeason, league, userId);
  } catch(e) { console.error('addXP:', e.message); }
}

// ─── ROTA: PERFIL ─────────────────────────────────────────────────────────────
router.get('/profile/me', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const profile = await upsertProfile(req.user.id, db);
    res.json(profile);
  } catch(e) { console.error('/profile/me:', e.message); res.status(500).json({ error: e.message }); }
});

// ─── ROTA: RANKING GLOBAL ─────────────────────────────────────────────────────
router.get('/ranking', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const rows = await db.prepare(`
      SELECT qp.*, u.name, u.username, u.avatar_url as avatar
      FROM quiz_profiles qp JOIN users u ON u.id=qp.user_id
      ORDER BY qp.xp_total DESC LIMIT 50
    `).all();
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── ROTA: RANKING CIDADES ────────────────────────────────────────────────────
router.get('/cities-ranking', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const rows = await db.prepare(`
      SELECT
        -- Exibe a grafia mais comum (a que mais aparece) para aquela cidade normalizada
        (ARRAY_AGG(city ORDER BY season_points DESC))[1] AS city,
        SUM(season_points) AS total_pts,
        COUNT(*) AS members,
        CAST(SUM(season_points) AS FLOAT) / COUNT(*) AS efficiency
      FROM quiz_profiles
      WHERE city IS NOT NULL AND TRIM(city) != '' AND season_points > 0
      GROUP BY LOWER(TRIM(city))
      ORDER BY efficiency DESC LIMIT 20
    `).all();
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── ROTA: QUIZ DIÁRIO — GET ──────────────────────────────────────────────────
router.get('/daily', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const today = new Date().toISOString().split('T')[0];
    const attempt = await db.prepare(
      `SELECT * FROM quiz_daily_attempts WHERE user_id=? AND attempt_date=CAST(? AS DATE)`
    ).get(req.user.id, today);
    if (attempt) return res.json({ done: true, score: attempt.score, xp: attempt.xp_earned });
    const questions = getQuestions('aleatorio', 10);
    res.json({ done: false, questions });
  } catch(e) { console.error('/daily GET:', e.message); res.status(500).json({ error: e.message }); }
});

// ─── ROTA: QUIZ DIÁRIO — POST SUBMIT ─────────────────────────────────────────
router.post('/daily/submit', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const today = new Date().toISOString().split('T')[0];

    // checar duplicata
    const already = await db.prepare(
      `SELECT id FROM quiz_daily_attempts WHERE user_id=? AND attempt_date=CAST(? AS DATE)`
    ).get(req.user.id, today);
    if (already) return res.status(400).json({ error: 'Quiz diário já respondido hoje.' });

    // calcular acertos
    const { answers, questions: sentQs } = req.body;
    let correct = 0;
    if (Array.isArray(sentQs) && Array.isArray(answers)) {
      sentQs.forEach((q, i) => {
        if (answers[i] !== undefined && answers[i] !== -1 && Number(answers[i]) === Number(q.correct)) correct++;
      });
    }

    // calcular XP
    let xp = correct;
    if (correct === 10) xp += 10;
    else if (correct === 9) xp += 5;

    // streak
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const prevDay = await db.prepare(
      `SELECT id FROM quiz_daily_attempts WHERE user_id=? AND attempt_date=CAST(? AS DATE)`
    ).get(req.user.id, yesterday);
    const profile = await upsertProfile(req.user.id, db);
    let streak = prevDay ? (profile.daily_streak || 0) + 1 : 1;
    if (streak === 7) xp += 30;
    else if (streak >= 30) xp += 100;
    else if (streak > 1) xp += 5;

    // salvar attempt — id SERIAL (não passar id)
    await db.prepare(
      `INSERT INTO quiz_daily_attempts (user_id, attempt_date, score, xp_earned) VALUES (?,CAST(? AS DATE),?,?)`
    ).run(req.user.id, today, correct, xp);

    // update streak
    await db.prepare(`
      UPDATE quiz_profiles
      SET daily_streak=?, best_streak=CASE WHEN best_streak>? THEN best_streak ELSE ? END, last_daily=CAST(? AS DATE)
      WHERE user_id=?
    `).run(streak, streak, streak, today, req.user.id);

    // add XP
    await addXP(req.user.id, xp, db);

    res.json({ correct, total: 10, xp, streak });
  } catch(e) { console.error('/daily/submit ERROR:', e.message); res.status(500).json({ error: e.message }); }
});

// ─── ROTA: CRIAR BATALHA ──────────────────────────────────────────────────────
router.post('/battle/create', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const { opponent_id, category, question_count } = req.body;
    const qcount = Math.min(parseInt(question_count) || 10, 20);
    const questions = getQuestions(category, qcount);
    const id = uuidv4();
    await db.prepare(`
      INSERT INTO quiz_battles (id,challenger_id,opponent_id,category,question_count,questions,status)
      VALUES (?,?,?,?,?,?,'pending')
    `).run(id, req.user.id, opponent_id || null, category || 'aleatorio', qcount, JSON.stringify(questions));

    if (opponent_id) {
      try {
        await db.prepare(`INSERT INTO user_notifications (id,user_id,type,actor_id,message) VALUES (?,?,'quiz_challenge',?,?) ON CONFLICT DO NOTHING`)
          .run(uuidv4(), opponent_id, req.user.id, 'te desafiou para uma batalha no Quiz Arena! 🧠');
      } catch(e2) {}
    }
    res.json({ id, questions });
  } catch(e) { console.error('/battle/create:', e.message); res.status(500).json({ error: e.message }); }
});

// ─── ROTA: BUSCAR BATALHA ─────────────────────────────────────────────────────
router.get('/battle/:id', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const b = await db.prepare(`SELECT * FROM quiz_battles WHERE id=?`).get(req.params.id);
    if (!b) return res.status(404).json({ error: 'Batalha não encontrada' });
    try { b.questions = JSON.parse(b.questions); } catch(e) { b.questions = []; }
    res.json(b);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── ROTA: SUBMETER BATALHA ───────────────────────────────────────────────────
router.post('/battle/:id/submit', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const { score, time_ms } = req.body;
    const battle = await db.prepare(`SELECT * FROM quiz_battles WHERE id=?`).get(req.params.id);
    if (!battle) return res.status(404).json({ error: 'Batalha não encontrada' });

    const isChallenger = battle.challenger_id === req.user.id;
    if (isChallenger) {
      await db.prepare(`UPDATE quiz_battles SET challenger_score=?,challenger_time_ms=? WHERE id=?`).run(score, time_ms, req.params.id);
    } else {
      await db.prepare(`UPDATE quiz_battles SET opponent_score=?,opponent_time_ms=? WHERE id=?`).run(score, time_ms, req.params.id);
    }

    const updated = await db.prepare(`SELECT * FROM quiz_battles WHERE id=?`).get(req.params.id);
    const cs = updated.challenger_score;
    const os = updated.opponent_score;
    const bothDone = cs !== null && cs !== undefined && os !== null && os !== undefined;

    if (bothDone && !updated.winner_id) {
      const ct = updated.challenger_time_ms, ot = updated.opponent_time_ms;
      let winner_id;
      if (Number(cs) > Number(os)) winner_id = updated.challenger_id;
      else if (Number(os) > Number(cs)) winner_id = updated.opponent_id;
      else if (Number(ct) < Number(ot)) winner_id = updated.challenger_id;
      else winner_id = updated.opponent_id;

      const loser_id = winner_id === updated.challenger_id ? updated.opponent_id : updated.challenger_id;
      await db.prepare(`UPDATE quiz_battles SET winner_id=?,status='finished' WHERE id=?`).run(winner_id, req.params.id);
      await db.prepare(`UPDATE quiz_profiles SET wins=wins+1 WHERE user_id=?`).run(winner_id);
      if (loser_id) await db.prepare(`UPDATE quiz_profiles SET losses=losses+1 WHERE user_id=?`).run(loser_id);

      const xpWin = updated.is_bet ? Number(updated.bet_amount) * 2 : 15;
      await addXP(winner_id, xpWin, db);
      if (loser_id) await addXP(loser_id, updated.is_bet ? 0 : 3, db);

      if (loser_id) {
        try {
          const winnerRow = await db.prepare(`SELECT name FROM users WHERE id=?`).get(winner_id);
          await db.prepare(`INSERT INTO user_notifications (id,user_id,type,actor_id,message) VALUES (?,?,'quiz_result',?,?) ON CONFLICT DO NOTHING`)
            .run(uuidv4(), loser_id, winner_id, `${winnerRow?.name} venceu a batalha ${cs}x${os} no Quiz Arena!`);
        } catch(e2) {}
      }
    }

    res.json({ ok: true, status: bothDone ? 'finished' : 'waiting' });
  } catch(e) { console.error('/battle/submit:', e.message); res.status(500).json({ error: e.message }); }
});

// ─── ROTA: MINHAS BATALHAS ────────────────────────────────────────────────────
router.get('/battles', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const rows = await db.prepare(`
      SELECT qb.*,
        u1.name as challenger_name, u1.username as challenger_username,
        u2.name as opponent_name, u2.username as opponent_username
      FROM quiz_battles qb
      JOIN users u1 ON u1.id=qb.challenger_id
      LEFT JOIN users u2 ON u2.id=qb.opponent_id
      WHERE qb.challenger_id=? OR qb.opponent_id=?
      ORDER BY qb.created_at DESC LIMIT 20
    `).all(req.user.id, req.user.id);
    res.json(rows.map(b => { try { b.questions = JSON.parse(b.questions); } catch(e){} return b; }));
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── ROTA: XP BET ────────────────────────────────────────────────────────────
router.post('/bet/create', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const { opponent_id, bet_amount, category } = req.body;
    const amount = parseInt(bet_amount);
    if (![50,100,250,500].includes(amount)) return res.status(400).json({ error: 'Valor inválido' });
    const profile = await upsertProfile(req.user.id, db);
    if ((profile.xp_total || 0) < amount) return res.status(400).json({ error: 'XP insuficiente' });

    await db.prepare(`UPDATE quiz_profiles SET xp_total=xp_total-? WHERE user_id=?`).run(amount, req.user.id);
    const questions = getQuestions(category || 'aleatorio', 10);
    const id = uuidv4();
    await db.prepare(`
      INSERT INTO quiz_battles (id,challenger_id,opponent_id,category,question_count,questions,status,is_bet,bet_amount)
      VALUES (?,?,?,?,10,?,'pending',true,?)
    `).run(id, req.user.id, opponent_id || null, category || 'aleatorio', JSON.stringify(questions), amount);

    if (opponent_id) {
      try {
        await db.prepare(`INSERT INTO user_notifications (id,user_id,type,actor_id,message) VALUES (?,?,'quiz_bet',?,?) ON CONFLICT DO NOTHING`)
          .run(uuidv4(), opponent_id, req.user.id, `te desafiou para uma aposta de ${amount} XP! 💰`);
      } catch(e2) {}
    }
    res.json({ id, questions, bet_amount: amount });
  } catch(e) { console.error('/bet/create:', e.message); res.status(500).json({ error: e.message }); }
});

// ─── ARENA ROYALE (em memória) ────────────────────────────────────────────────
const royaleRooms = new Map();

router.post('/royale/join', requireAuth, async (req, res) => {
  try {
    let room = [...royaleRooms.values()].find(r => r.status === 'waiting' && r.players.length < 100);
    if (!room) {
      const roomId = uuidv4();
      room = { id: roomId, status: 'waiting', players: [], questions: getQuestions('aleatorio', 20), currentQuestion: 0, startTime: null };
      royaleRooms.set(roomId, room);
    }
    if (!room.players.find(p => p.id === req.user.id)) {
      room.players.push({ id: req.user.id, name: req.user.name, username: req.user.username, alive: true, score: 0 });
    }
    if (room.players.length >= 2 && !room.startTime) {
      room.startTime = Date.now() + 20000;
      setTimeout(() => { if (room.status === 'waiting') room.status = 'playing'; }, 20000);
    }
    res.json({ roomId: room.id, players: room.players.length, status: room.status, startTime: room.startTime });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/royale/:roomId/state', requireAuth, (req, res) => {
  const room = royaleRooms.get(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'Sala não encontrada' });
  const q = room.questions[room.currentQuestion];
  res.json({
    status: room.status, players: room.players.length,
    alive: room.players.filter(p => p.alive).length,
    question: q ? { id: room.currentQuestion, question: q.question, options: q.options } : null,
    questionIndex: room.currentQuestion, startTime: room.startTime,
  });
});

router.post('/royale/:roomId/answer', requireAuth, async (req, res) => {
  try {
    const db = getDB();
    const room = royaleRooms.get(req.params.roomId);
    if (!room || room.status !== 'playing') return res.status(400).json({ error: 'Sala inativa' });
    const { answer } = req.body;
    const player = room.players.find(p => p.id === req.user.id);
    if (!player || !player.alive) return res.json({ alive: false, correct: false, surviving: room.players.filter(p=>p.alive).length });
    const q = room.questions[room.currentQuestion];
    const correct = q && Number(answer) === Number(q.correct);
    if (correct) player.score++;
    else player.alive = false;
    player._answered = room.currentQuestion;

    const alive = room.players.filter(p => p.alive);
    if (alive.length <= 1) {
      room.status = 'finished';
      if (alive.length === 1) { try { await addXP(alive[0].id, 250, db); } catch(e2){} }
      setTimeout(() => royaleRooms.delete(room.id), 300000);
    } else {
      const allAnswered = room.players.every(p => !p.alive || p._answered === room.currentQuestion);
      if (allAnswered) setTimeout(() => { room.currentQuestion++; }, 2000);
    }
    res.json({ alive: player.alive, correct, surviving: alive.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── CHAT ─────────────────────────────────────────────────────────────────────
const roomChats = new Map();

router.post('/chat/:roomId', requireAuth, (req, res) => {
  try {
    const { message } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Vazio' });
    if (!roomChats.has(req.params.roomId)) roomChats.set(req.params.roomId, []);
    const msgs = roomChats.get(req.params.roomId);
    const msg = { id: uuidv4(), user_id: req.user.id, name: req.user.name, username: req.user.username,
      message: message.trim().slice(0,200), created_at: new Date().toISOString() };
    msgs.push(msg);
    if (msgs.length > 100) msgs.splice(0, msgs.length - 100);
    res.json(msg);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/chat/:roomId', requireAuth, (req, res) => {
  const msgs = roomChats.get(req.params.roomId) || [];
  const since = req.query.since;
  res.json(since ? msgs.filter(m => m.created_at > since) : msgs.slice(-30));
});

module.exports = router;
