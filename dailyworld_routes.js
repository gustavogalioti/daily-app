const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');

const router = express.Router();

// Ensure table exists
async function ensureTable() {
  try {
    const db = getDB();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS dailyworld_saves (
        id TEXT PRIMARY KEY,
        user_id TEXT UNIQUE NOT NULL,
        room_id TEXT,
        placed_data TEXT,
        poke_pos TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `).run();
  } catch(e) { console.error('dailyworld table:', e.message); }
}
ensureTable();

// GET /api/dailyworld/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const save = await db.prepare('SELECT * FROM dailyworld_saves WHERE user_id=$1').get(req.user.id);
    if(!save) return res.json({ save: null });
    res.json({
      save: {
        roomId: save.room_id,
        placed: JSON.parse(save.placed_data || '[]'),
        pokePos: JSON.parse(save.poke_pos || 'null'),
      }
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/dailyworld/save
router.post('/save', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { roomId, placed, pokePos } = req.body;
    const existing = await db.prepare('SELECT id FROM dailyworld_saves WHERE user_id=$1').get(req.user.id);
    if(existing) {
      await db.prepare('UPDATE dailyworld_saves SET room_id=$1, placed_data=$2, poke_pos=$3, updated_at=NOW() WHERE user_id=$4')
        .run(roomId, JSON.stringify(placed||[]), JSON.stringify(pokePos||null), req.user.id);
    } else {
      await db.prepare('INSERT INTO dailyworld_saves (id,user_id,room_id,placed_data,poke_pos) VALUES ($1,$2,$3,$4,$5)')
        .run(uuidv4(), req.user.id, roomId, JSON.stringify(placed||[]), JSON.stringify(pokePos||null));
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
