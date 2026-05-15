const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const question = await db.prepare('SELECT * FROM question_of_day WHERE active=1 ORDER BY created_at DESC LIMIT 1').get();
    if (!question) return res.json({ question: null, responses: [] });
    const responses = await db.prepare('SELECT r.*,u.name,u.username,u.avatar_url FROM qod_responses r JOIN users u ON u.id=r.user_id WHERE r.question_id=$1 ORDER BY r.created_at ASC').all(question.id);
    const cRow = await db.prepare('SELECT COUNT(*) as c FROM qod_responses WHERE question_id=$1').get(question.id);
    const response_count = parseInt(cRow?.c || 0);
    res.json({ question: { ...question, response_count }, responses });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/respond', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: 'Resposta vazia' });
    const question = await db.prepare('SELECT id FROM question_of_day WHERE active=1 ORDER BY created_at DESC LIMIT 1').get();
    if (!question) return res.status(404).json({ error: 'Nenhuma pergunta ativa' });
    const id = uuidv4();
    await db.prepare('INSERT INTO qod_responses (id,question_id,user_id,content) VALUES ($1,$2,$3,$4)').run(id, question.id, req.user.id, content.trim());
    const response = await db.prepare('SELECT r.*,u.name,u.username,u.avatar_url FROM qod_responses r JOIN users u ON u.id=r.user_id WHERE r.id=$1').get(id);
    res.status(201).json({ response });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/react/:rid', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { emoji } = req.body;
    const ex = await db.prepare('SELECT id FROM reactions WHERE post_id=$1 AND user_id=$2 AND emoji=$3').get(req.params.rid, req.user.id, emoji);
    if (ex) {
      await db.prepare('DELETE FROM reactions WHERE post_id=$1 AND user_id=$2 AND emoji=$3').run(req.params.rid, req.user.id, emoji);
      return res.json({ action:'removed' });
    }
    await db.prepare('INSERT INTO reactions (id,post_id,user_id,emoji) VALUES ($1,$2,$3,$4)').run(uuidv4(), req.params.rid, req.user.id, emoji);
    const reactions = await db.prepare('SELECT emoji, COUNT(*) as count FROM reactions WHERE post_id=$1 GROUP BY emoji').all(req.params.rid);
    res.json({ action:'added', reactions });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.post('/question', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { question } = req.body;
    if (!question?.trim()) return res.status(400).json({ error: 'Pergunta obrigatória' });
    await db.prepare('UPDATE question_of_day SET active=0').run();
    const id = uuidv4();
    await db.prepare('INSERT INTO question_of_day (id,question) VALUES ($1,$2)').run(id, question.trim());
    res.status(201).json({ question: { id, question: question.trim(), active:1 } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
