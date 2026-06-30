const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware, optionalAuth } = require('./authmiddleware');

const router = express.Router();

// ─── TABLES ──────────────────────────────────────────────────────────────────
// dailyworld_saves: per-user save (their room choice, furniture, poke position)
// dailyworld_room_configs: GLOBAL admin-defined config per room (grid, levels,
//   stairs, default furniture catalog tweaks). Set by admin, read by everyone.
async function ensureTables() {
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
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS dailyworld_room_configs (
        room_id TEXT PRIMARY KEY,
        room_config TEXT,
        default_furniture TEXT,
        updated_by TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `).run();
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS dailyworld_furniture_configs (
        furniture_id TEXT PRIMARY KEY,
        scale REAL,
        offset_y REAL,
        offset_x REAL,
        updated_by TEXT,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `).run();
  } catch(e) { console.error('dailyworld tables:', e.message); }
}
ensureTables();

// ═══════════════════════════════════════════════════════════════════════════
// USER SAVE (their personal room/furniture/poke state)
// ═══════════════════════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL ROOM CONFIGS (admin-defined grid/levels/stairs per room)
// Read by EVERY user when entering a room. Written only by admins.
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/dailyworld/room-configs — public, no auth needed to read
// Returns: { studio: {roomConfig:{...}, defaultFurniture:[...]}, suite: {...}, ... }
router.get('/room-configs', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const rows = await db.prepare('SELECT * FROM dailyworld_room_configs').all();
    const out = {};
    (rows || []).forEach(r => {
      out[r.room_id] = {
        roomConfig: JSON.parse(r.room_config || 'null'),
        defaultFurniture: JSON.parse(r.default_furniture || '[]'),
      };
    });
    res.json({ configs: out });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/dailyworld/room-configs — admin only, upserts one room's config
router.post('/room-configs', authMiddleware, async (req, res) => {
  try {
    if(!req.user.is_admin) return res.status(403).json({ error: 'Apenas administradores podem editar a configuração global.' });
    const db = getDB();
    const { roomId, roomConfig, defaultFurniture } = req.body;
    if(!roomId) return res.status(400).json({ error: 'roomId obrigatório' });

    const existing = await db.prepare('SELECT room_id FROM dailyworld_room_configs WHERE room_id=$1').get(roomId);
    if(existing) {
      await db.prepare('UPDATE dailyworld_room_configs SET room_config=$1, default_furniture=$2, updated_by=$3, updated_at=NOW() WHERE room_id=$4')
        .run(JSON.stringify(roomConfig||null), JSON.stringify(defaultFurniture||[]), req.user.id, roomId);
    } else {
      await db.prepare('INSERT INTO dailyworld_room_configs (room_id,room_config,default_furniture,updated_by) VALUES ($1,$2,$3,$4)')
        .run(roomId, JSON.stringify(roomConfig||null), JSON.stringify(defaultFurniture||[]), req.user.id);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════════════════════════════════
// GLOBAL FURNITURE CONFIGS (admin-defined scale/offset per furniture catalog item)
// ═══════════════════════════════════════════════════════════════════════════

// GET /api/dailyworld/furniture-configs — public
router.get('/furniture-configs', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const rows = await db.prepare('SELECT * FROM dailyworld_furniture_configs').all();
    const out = {};
    (rows || []).forEach(r => {
      out[r.furniture_id] = { scale: r.scale, offsetY: r.offset_y, offsetX: r.offset_x };
    });
    res.json({ configs: out });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/dailyworld/furniture-configs — admin only
router.post('/furniture-configs', authMiddleware, async (req, res) => {
  try {
    if(!req.user.is_admin) return res.status(403).json({ error: 'Apenas administradores podem editar a configuração global.' });
    const db = getDB();
    const { furnitureId, scale, offsetY, offsetX } = req.body;
    if(!furnitureId) return res.status(400).json({ error: 'furnitureId obrigatório' });

    const existing = await db.prepare('SELECT furniture_id FROM dailyworld_furniture_configs WHERE furniture_id=$1').get(furnitureId);
    if(existing) {
      await db.prepare('UPDATE dailyworld_furniture_configs SET scale=$1, offset_y=$2, offset_x=$3, updated_by=$4, updated_at=NOW() WHERE furniture_id=$5')
        .run(scale, offsetY, offsetX, req.user.id, furnitureId);
    } else {
      await db.prepare('INSERT INTO dailyworld_furniture_configs (furniture_id,scale,offset_y,offset_x,updated_by) VALUES ($1,$2,$3,$4,$5)')
        .run(furnitureId, scale, offsetY, offsetX, req.user.id);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
