const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');

const router = express.Router();

// Comentários do Pedro por categoria de post
const PEDRO_COMMENTS = {
  photo: [
    "Que foto incrível! Pedro aprova com as patinhas! 🐾",
    "Olha isso! Pedro ficou tão animado que derrubou a tigela de ração! 😹",
    "MEOW! Pedro sente que você está arrasando hoje! 🧡",
    "Pedro viu essa foto e saiu correndo pela casa de alegria! 🏃‍♂️",
    "Que momento lindo! Pedro ronrona de emoção! 😻",
    "Pedro foi lá e cheirou a tela, achou ótimo! 😂",
    "Ei! Pedro quer aparecer na próxima foto! 🐱",
    "Pedro deu uma mijada de felicidade de tanto gostar! (ops, errei) 😅🧡",
    "Isso sim é conteúdo de qualidade! Pedro certifica! ✅🐾",
    "Pedro pausou o banho de sol pra comentar isso. Valor total! 🌞",
  ],
  text: [
    "Pedro leu e concordou balançando a cabeça. Ou balançou porque viu um passarinho... 🐦",
    "Que reflexão profunda! Pedro ficou pensativo (raro pra um gato) 🤔🧡",
    "Pedro foi lá mostrou pra dona. Ela chorou. Obrigado por isso! 💛",
    "Isso que é falar a verdade! Pedro ronrona em sinal de aprovação! 😸",
    "Pedro leu três vezes. E mordeu a tela uma vez. É o jeito dele de curtir! 😹",
    "Hmm... Pedro discorda, mas faz isso com amor! 🐾❤️",
    "Pedro tá aqui na janela olhando a rua E pensando no que você escreveu. 🪟",
    "Isso tocou o coração do Pedro! (que fica escondido atrás do estômago cheio) 😂",
  ],
  daily_mandou: [
    "CAÇOU A NOTIFICAÇÃO! Pedro ficou orgulhoso demais! 🏆🐾",
    "1 minuto? Pedro precisou de menos pra derrubar o copo da mesa! Parabéns! 🥛",
    "UHUUUL! Pedro comemorou com uma cambalhota no tapete! 🎉",
    "Rapidez de gato! Ah, espera... Pedro entendeu o elogio! 😹",
    "Você é um herói do Daily! Pedro atesta com a patinha! 🐾✅",
  ],
  morning: [
    "Bom dia!! Pedro acabou de acordar também e já quer saber tudo da sua vida! ☀️🐾",
    "Pedro: 'Bom dia' dito com um ronronar especial! 🌅😸",
  ],
  night: [
    "Lá vai o Lobo Solitário! Pedro também tá acordado às 3am (normal pra gato) 🌙",
    "Alguém precisa dormir... mas Pedro tá aqui pra fazer companhia! 🦉",
  ],
  question: [
    "Pedro registrou sua resposta com a patinha! Muito bem! 🐾",
    "Que resposta sincera! Pedro aprecia honestidade (quando não é sobre esconder o gato) 😂",
    "Pedro analisou e concorda com sua perspectiva! 🧡",
  ],
};

function getPedroComment(type) {
  const pool = PEDRO_COMMENTS[type] || PEDRO_COMMENTS.photo;
  return pool[Math.floor(Math.random() * pool.length)];
}

// POST /api/pedro/comment — Pedro comenta automaticamente em um post
router.post('/comment', async (req, res) => {
  try {
    const db = getDB();
    const { post_id, post_type = 'photo' } = req.body;
    if (!post_id) return res.status(400).json({ error: 'post_id obrigatório' });
    const existing = await db.prepare('SELECT id FROM pedro_comments WHERE post_id=$1').get(post_id);
    if (existing) return res.json({ already: true });
    const content = getPedroComment(post_type);
    await db.prepare('INSERT INTO pedro_comments (id,post_id,content) VALUES ($1,$2,$3)')
      .run(uuidv4(), post_id, content);
    res.json({ comment: content });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/pedro/comment/:postId
router.get('/comment/:postId', async (req, res) => {
  try {
    const db = getDB();
    const c = await db.prepare('SELECT * FROM pedro_comments WHERE post_id=$1').get(req.params.postId);
    res.json({ comment: c || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/pedro/message — mensagem aleatória do Pedro
router.get('/message', async (req, res) => {
  const { context = 'photo' } = req.query;
  res.json({ message: getPedroComment(context) });
});

module.exports = router;
module.exports.getPedroComment = getPedroComment;
