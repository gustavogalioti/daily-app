const express = require('express');
const { getDB } = require('./database');
const router = express.Router();

router.get('/ranking', async (req,res) => {
  try {
    const db = getDB();
    const ranking = await db.prepare(`SELECT ts.*, u.name, u.username, u.avatar_url 
      FROM truco_scores ts JOIN users u ON u.id=ts.user_id 
      ORDER BY ts.wins DESC, ts.points DESC LIMIT 20`).all();
    res.json({ ranking });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
