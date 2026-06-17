const express  = require('express');
const router   = express.Router();
const { v4: uuidv4 } = require('uuid');
const db       = require('./database');
const authMiddleware = require('./authmiddleware');

// Cria tabela se não existir
(async () => {
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS crossing_scores (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        best_score INTEGER NOT NULL DEFAULT 0,
        best_phase  INTEGER NOT NULL DEFAULT 1,
        updated_at  TIMESTAMPTZ DEFAULT NOW()
      )
    `).run();
  } catch(e) { console.error('crossing_scores table error:', e.message); }
})();

// GET /api/crossing/score — meu recorde
router.get('/score', authMiddleware, async(req,res) => {
  try {
    const row = await db.prepare(
      'SELECT best_score, best_phase FROM crossing_scores WHERE user_id=$1'
    ).get(req.user.id);
    res.json({ best: row?.best_score || 0, phase: row?.best_phase || 1 });
  } catch(e) { res.json({ best: 0, phase: 1 }); }
});

// POST /api/crossing/score — salvar pontuação
router.post('/score', authMiddleware, async(req,res) => {
  try {
    const { score, phase } = req.body;
    if (!score || score < 0) return res.json({ ok: true });
    const existing = await db.prepare(
      'SELECT best_score FROM crossing_scores WHERE user_id=$1'
    ).get(req.user.id);
    if (!existing) {
      await db.prepare(
        'INSERT INTO crossing_scores(id,user_id,best_score,best_phase) VALUES($1,$2,$3,$4)'
      ).run(uuidv4(), req.user.id, score, phase || 1);
    } else if (score > existing.best_score) {
      await db.prepare(
        'UPDATE crossing_scores SET best_score=$1, best_phase=$2, updated_at=NOW() WHERE user_id=$3'
      ).run(score, phase || 1, req.user.id);
    }
    res.json({ ok: true, new_best: score > (existing?.best_score || 0) });
  } catch(e) { console.error(e); res.json({ ok: false }); }
});

// GET /api/crossing/ranking
router.get('/ranking', async(req,res) => {
  try {
    const ranking = await db.prepare(`
      SELECT cs.user_id, cs.best_score, cs.best_phase,
             u.name, u.username, u.avatar_url
      FROM crossing_scores cs
      JOIN users u ON u.id = cs.user_id
      ORDER BY cs.best_score DESC
    `).all();
    res.json({ ranking });
  } catch(e) { console.error(e); res.json({ ranking: [] }); }
});

// POST /api/crossing/challenge — desafiar amigo
router.post('/challenge', authMiddleware, async(req,res) => {
  try {
    const { to_user_id } = req.body;
    const target = await db.prepare(
      'SELECT id FROM users WHERE id=$1 OR username=$1'
    ).get(to_user_id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });

    const sender = await db.prepare('SELECT name FROM users WHERE id=$1').get(req.user.id);
    const myBest = await db.prepare(
      'SELECT best_score FROM crossing_scores WHERE user_id=$1'
    ).get(req.user.id);

    await db.prepare(
      `INSERT INTO notifications(id,user_id,type,title,body,data)
       VALUES($1,$2,$3,$4,$5,$6)`
    ).run(
      uuidv4(), target.id, 'game_challenge',
      `${sender?.name || 'Alguém'} te desafiou no Crossing Trail!`,
      `Bata o recorde de ${myBest?.best_score || 0} pontos!`,
      JSON.stringify({ game:'crossing', challenger_id: req.user.id, challenger_score: myBest?.best_score || 0 })
    );
    res.json({ ok: true });
  } catch(e) { console.error(e); res.status(500).json({ error: 'Erro ao enviar desafio' }); }
});

// GET /api/crossing/search?q=termo — buscar usuários para desafio
router.get('/search', authMiddleware, async(req,res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ users: [] });
    const term = '%' + q.replace('@','') + '%';
    const users = await db.prepare(
      `SELECT id, name, username, avatar_url
       FROM users
       WHERE (name ILIKE $1 OR username ILIKE $1)
         AND id != $2
       LIMIT 10`
    ).all(term, req.user.id);
    res.json({ users });
  } catch(e) { console.error(e); res.json({ users: [] }); }
});

module.exports = router;
