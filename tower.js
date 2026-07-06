const express = require('express');
const router = express.Router();
const { getDB } = require('./database');
const authMiddleware = require('./authmiddleware');
const { v4: uuidv4 } = require('uuid');

// POST /api/tower/score — salva ou atualiza melhor score do usuário
router.post('/score', authMiddleware, async (req, res) => {
  try {
    const { floor, kills, coins, game = 'daily_tower' } = req.body;
    if (!floor || floor < 1) return res.status(400).json({ error: 'floor inválido' });
    const db = getDB();
    // Só atualiza se for melhor que o atual
    const existing = await db.prepare('SELECT floor_reached FROM tower_scores WHERE user_id=$1 AND game=$2').get(req.user.id, game);
    if (existing && existing.floor_reached >= floor) {
      return res.json({ saved: false, best: existing.floor_reached });
    }
    await db.prepare(`
      INSERT INTO tower_scores (id, user_id, game, floor_reached, kills, coins)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (user_id, game) DO UPDATE SET floor_reached=$4, kills=$5, coins=$6, created_at=NOW()
    `).run(uuidv4(), req.user.id, game, floor, kills || 0, coins || 0);
    res.json({ saved: true, best: floor });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/tower/ranking?game=daily_tower&type=global — ranking dos melhores scores
router.get('/ranking', authMiddleware, async (req, res) => {
  try {
    const { game = 'daily_tower', type = 'global' } = req.query;
    const db = getDB();
    const rows = await db.prepare(`
      SELECT ts.floor_reached, ts.kills, ts.coins, ts.created_at,
             u.id as user_id, u.name, u.username, u.avatar_url, u.city
      FROM tower_scores ts
      JOIN users u ON u.id = ts.user_id
      WHERE ts.game = $1
      ORDER BY ts.floor_reached DESC
      LIMIT 50
    `).all(game);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/tower/my-score?game=daily_tower — score do usuário logado
router.get('/my-score', authMiddleware, async (req, res) => {
  try {
    const { game = 'daily_tower' } = req.query;
    const db = getDB();
    const score = await db.prepare('SELECT * FROM tower_scores WHERE user_id=$1 AND game=$2').get(req.user.id, game);
    res.json(score || { floor_reached: 0, kills: 0, coins: 0 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
