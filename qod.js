const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDB();
  const question = db.prepare('SELECT * FROM question_of_day WHERE active=1 ORDER BY created_at DESC LIMIT 1').get();
  if (!question) return res.json({ question: null, responses: [] });
  const responses = db.prepare('SELECT r.*,u.name,u.username,u.avatar_url FROM qod_responses r JOIN users u ON u.id=r.user_id WHERE r.question_id=? ORDER BY r.created_at ASC').all(question.id);
  const response_count = (db.prepare('SELECT COUNT(*) as c FROM qod_responses WHERE question_id=?').get(question.id)||{c:0}).c;
  res.json({ question: { ...question, response_count }, responses });
});

router.post('/respond', authMiddleware, (req, res) => {
  const db = getDB();
  const { content } = req.body;
  if (!content?.trim()) return res.status(400).json({ error: 'Resposta vazia' });
  const question = db.prepare('SELECT id FROM question_of_day WHERE active=1 ORDER BY created_at DESC LIMIT 1').get();
  if (!question) return res.status(404).json({ error: 'Nenhuma pergunta ativa' });
  const id = uuidv4();
  db.prepare('INSERT INTO qod_responses (id,question_id,user_id,content) VALUES (?,?,?,?)').run(id, question.id, req.user.id, content.trim());
  const response = db.prepare('SELECT r.*,u.name,u.username,u.avatar_url FROM qod_responses r JOIN users u ON u.id=r.user_id WHERE r.id=?').get(id);
  res.status(201).json({ response });
});

router.post('/react/:rid', authMiddleware, (req, res) => {
  const db = getDB();
  const { emoji } = req.body;
  const ex = db.prepare('SELECT id FROM reactions WHERE post_id=? AND user_id=? AND emoji=?').get(req.params.rid, req.user.id, emoji);
  if (ex) { db.prepare('DELETE FROM reactions WHERE post_id=? AND user_id=? AND emoji=?').run(req.params.rid, req.user.id, emoji); return res.json({ action:'removed' }); }
  db.prepare('INSERT INTO reactions (id,post_id,user_id,emoji) VALUES (?,?,?,?)').run(uuidv4(), req.params.rid, req.user.id, emoji);
  const reactions = db.prepare('SELECT emoji, COUNT(*) as count FROM reactions WHERE post_id=? GROUP BY emoji').all(req.params.rid);
  res.json({ action:'added', reactions });
});

router.post('/question', authMiddleware, (req, res) => {
  const db = getDB();
  const { question } = req.body;
  if (!question?.trim()) return res.status(400).json({ error: 'Pergunta obrigatória' });
  db.prepare('UPDATE question_of_day SET active=0').run();
  const id = uuidv4();
  db.prepare('INSERT INTO question_of_day (id,question) VALUES (?,?)').run(id, question.trim());
  res.status(201).json({ question: { id, question: question.trim(), active:1 } });
});

module.exports = router;
