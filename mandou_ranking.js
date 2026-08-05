/**
 * DAILY — Ranking Daily Mandou
 * Conta posts do tipo daily_mandou por usuário (1 ponto = 1 post)
 */
const express = require('express');
const router  = express.Router();
const { getDB } = require('./database');

// GET /api/mandou-ranking?limit=50
router.get('/', async (req, res) => {
  try {
    const db    = getDB();
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const ranking = await db.prepare(`
      SELECT u.id, u.name, u.username, u.avatar_url,
             COUNT(p.id) AS mandou_count
      FROM posts p
      JOIN users u ON u.id = p.user_id
      WHERE p.tab = 'daily_mandou'
      GROUP BY u.id, u.name, u.username, u.avatar_url
      HAVING COUNT(p.id) > 0
      ORDER BY mandou_count DESC
      LIMIT $1
    `).all(limit);

    res.json({
      ranking: ranking.map(r => ({ ...r, mandou_count: parseInt(r.mandou_count) }))
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
