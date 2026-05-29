const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware, optionalAuth } = require('./authmiddleware');

const router = express.Router();

// Pega período atual
function getCurrentPeriod() {
  const h = new Date().getHours();
  if (h >= 5  && h < 11) return 'manha';
  if (h >= 11 && h < 14) return 'almoco';
  if (h >= 14 && h < 18) return 'tarde';
  return 'noite';
}

// GET /api/daily-questions/current — pergunta atual
router.get('/current', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const period = getCurrentPeriod();
    const q = await db.prepare("SELECT * FROM daily_questions WHERE period=$1 AND active=1 LIMIT 1").get(period);
    if (!q) return res.json({ question: null, period });
    const today = new Date().toISOString().slice(0,10);
    const total = parseInt((await db.prepare('SELECT COUNT(*) as c FROM daily_question_responses WHERE question_id=$1 AND response_date=$2').get(q.id, today))?.c || 0);
    let my_response = null;
    if (req.user) {
      my_response = await db.prepare('SELECT * FROM daily_question_responses WHERE question_id=$1 AND user_id=$2 AND response_date=$3').get(q.id, req.user.id, today);
    }
    // Gera word cloud data
    const responses = await db.prepare('SELECT content FROM daily_question_responses WHERE question_id=$1 AND response_date=$2').all(q.id, today);
    const wordCloud = buildWordCloud(responses.map(r => r.content));
    res.json({ question: q, period, total_responses: total, my_response, word_cloud: wordCloud });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/daily-questions/respond
router.post('/respond', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const period = getCurrentPeriod();
    const q = await db.prepare("SELECT * FROM daily_questions WHERE period=$1 AND active=1 LIMIT 1").get(period);
    if (!q) return res.status(404).json({ error: 'Nenhuma pergunta ativa agora' });
    const today = new Date().toISOString().slice(0,10);
    const existing = await db.prepare('SELECT id FROM daily_question_responses WHERE question_id=$1 AND user_id=$2 AND response_date=$3').get(q.id, req.user.id, today);
    if (existing) return res.status(409).json({ error: 'Você já respondeu essa pergunta hoje' });
    const { content } = req.body;
    if (!content || content.trim().length < 1) return res.status(400).json({ error: 'Resposta vazia' });
    const id = uuidv4();
    await db.prepare('INSERT INTO daily_question_responses (id,question_id,user_id,content,response_date) VALUES ($1,$2,$3,$4,$5)')
      .run(id, q.id, req.user.id, content.trim(), today);
    res.status(201).json({ ok: true, message: 'Resposta registrada!' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/daily-questions/all — histórico de respostas do dia
router.get('/all', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const today = new Date().toISOString().slice(0,10);
    const periods = ['manha','almoco','tarde','noite'];
    const result = [];
    for (const period of periods) {
      const q = await db.prepare("SELECT * FROM daily_questions WHERE period=$1 AND active=1 LIMIT 1").get(period);
      if (!q) continue;
      const responses = await db.prepare(`
        SELECT dqr.content, dqr.created_at, u.name, u.username, u.avatar_url
        FROM daily_question_responses dqr JOIN users u ON u.id=dqr.user_id
        WHERE dqr.question_id=$1 AND dqr.response_date=$2 ORDER BY dqr.created_at DESC LIMIT 100
      `).all(q.id, today);
      const wordCloud = buildWordCloud(responses.map(r => r.content));
      result.push({ period, question: q, responses, word_cloud: wordCloud });
    }
    res.json({ periods: result });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: PUT /api/daily-questions/:id
router.put('/:id', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const user = await db.prepare('SELECT is_admin FROM users WHERE id=$1').get(req.user.id);
    if (!user?.is_admin) return res.status(403).json({ error: 'Sem permissão' });
    const { question } = req.body;
    await db.prepare('UPDATE daily_questions SET question=$1 WHERE id=$2').run(question, req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

function buildWordCloud(texts) {
  const stopwords = new Set(['de','da','do','das','dos','e','a','o','as','os','em','no','na','nos','nas','um','uma','uns','umas','que','com','por','para','mais','mas','não','sim','me','te','se','é','foi','ser','estar','já','como','quando','muito','bem','hoje','dia','meu','minha','seu','sua']);
  const counts = {};
  for (const text of texts) {
    const words = text.toLowerCase().replace(/[^\w\sáàâãéêíóôõúç]/g,'').split(/\s+/);
    for (const w of words) {
      if (w.length > 2 && !stopwords.has(w)) counts[w] = (counts[w] || 0) + 1;
    }
  }
  return Object.entries(counts).sort((a,b) => b[1]-a[1]).slice(0,40).map(([word,count]) => ({ word, count }));
}

module.exports = router;
