const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');
const { checkAndGrant } = require('./achievements');

const router = express.Router();

// GET /api/testimonials/:username — depoimentos de um usuário
router.get('/:username', async (req, res) => {
  try {
    const db = getDB();
    const username = req.params.username.replace(/^@/,'').toLowerCase();
    const target = await db.prepare('SELECT id FROM users WHERE username=$1').get(username);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    const testimonials = await db.prepare(`
      SELECT t.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar
      FROM testimonials t JOIN users u ON u.id=t.author_id
      WHERE t.target_id=$1 ORDER BY t.created_at DESC
    `).all(target.id);
    res.json({ testimonials });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/testimonials/:username — escrever depoimento
router.post('/:username', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const username = req.params.username.replace(/^@/,'').toLowerCase();
    const target = await db.prepare('SELECT id FROM users WHERE username=$1').get(username);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado' });
    if (target.id === req.user.id) return res.status(400).json({ error: 'Você não pode escrever depoimento para si mesmo' });
    const { content } = req.body;
    if (!content || content.trim().length < 10)
      return res.status(400).json({ error: 'Depoimento muito curto (mínimo 10 caracteres)' });
    const id = uuidv4();
    await db.prepare('INSERT INTO testimonials (id,author_id,target_id,content) VALUES ($1,$2,$3,$4)')
      .run(id, req.user.id, target.id, content.trim());
    // Conquistas
    await checkAndGrant(db, req.user.id, 'testimonial_given');
    await checkAndGrant(db, target.id, 'testimonial_received');
    const t = await db.prepare(`
      SELECT t.*, u.name as author_name, u.username as author_username, u.avatar_url as author_avatar
      FROM testimonials t JOIN users u ON u.id=t.author_id WHERE t.id=$1
    `).get(id);
    res.status(201).json({ testimonial: t });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/testimonials/:id
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const t = await db.prepare('SELECT * FROM testimonials WHERE id=$1').get(req.params.id);
    if (!t) return res.status(404).json({ error: 'Depoimento não encontrado' });
    if (t.author_id !== req.user.id && t.target_id !== req.user.id)
      return res.status(403).json({ error: 'Sem permissão' });
    await db.prepare('DELETE FROM testimonials WHERE id=$1').run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
