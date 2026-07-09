/**
 * DAILY — Timeline Memories
 * Memórias adicionadas manualmente pelo usuário na Linha do Tempo
 */
const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');

async function initTimelineTables() {
  const db = getDB();
  await db.prepare(`CREATE TABLE IF NOT EXISTS timeline_memories (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    memory_date DATE NOT NULL,
    time_of_day TEXT DEFAULT '12:00:00',
    image_url TEXT,
    caption TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).run();
}
initTimelineTables().catch(e => console.error('[Timeline] Init:', e.message));

// GET /api/timeline/memories — memórias do usuário logado
router.get('/memories', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const memories = await db.prepare(`
      SELECT * FROM timeline_memories
      WHERE user_id = $1
      ORDER BY memory_date DESC, time_of_day ASC
    `).all(req.user.id);
    res.json({ memories });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/timeline/memories — adicionar memória
router.post('/memories', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { memory_date, image_url, caption, time_of_day } = req.body;
    if (!memory_date) return res.status(400).json({ error: 'Data obrigatória' });
    if (!image_url && !caption?.trim()) return res.status(400).json({ error: 'Adicione uma foto ou texto' });

    const id = uuidv4();
    await db.prepare(`
      INSERT INTO timeline_memories (id, user_id, memory_date, time_of_day, image_url, caption)
      VALUES ($1, $2, $3, $4, $5, $6)
    `).run(id, req.user.id, memory_date, time_of_day || '12:00:00', image_url || null, caption?.trim() || null);

    res.json({ ok: true, id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/timeline/memories/:id — remover memória
router.delete('/memories/:id', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    await db.prepare('DELETE FROM timeline_memories WHERE id=$1 AND user_id=$2').run(req.params.id, req.user.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
