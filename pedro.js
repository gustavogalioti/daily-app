const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');

const router = express.Router();

const PEDRO = {
  photo: [
    "Que foto incrível! Pedro aprova com as patinhas! 🐾",
    "Olha isso! Pedro ficou tão animado que derrubou a tigela de ração! 😹",
    "MEOW! Pedro sente que você está arrasando hoje! 🧡",
    "Pedro viu essa foto e saiu correndo pela casa de alegria! 🏃",
    "Que momento lindo! Pedro ronrona de emoção! 😻",
    "Pedro foi lá e cheirou a tela, achou ótimo! 😂",
    "Ei! Pedro quer aparecer na próxima foto! 🐱",
    "Isso sim é conteúdo de qualidade! Pedro certifica! ✅🐾",
    "Pedro pausou o banho de sol pra comentar isso. Valor total! 🌞",
    "Essa foto merece prêmio! Pedro está impressionado 🏆",
    "Pedro mostrou pra dona. Ela quase chorou de tanto gostar! 😭🧡",
    "Catnip tem esse efeito em Pedro, fotos boas têm esse efeito no Pedro! 😸",
  ],
  text: [
    "Pedro leu e concordou balançando a cabeça 🤔🧡",
    "Que reflexão profunda! Pedro ficou pensativo (raro pra um gato) 🐱",
    "Pedro foi lá mostrar pra dona. Ela concordou! 💛",
    "Isso que é falar a verdade! Pedro ronrona em sinal de aprovação! 😸",
    "Pedro leu três vezes. E mordeu a tela uma vez. É o jeito dele de curtir! 😹",
    "Pedro tá aqui na janela olhando a rua E pensando no que você escreveu 🪟",
    "Isso tocou o coração do Pedro! (que fica escondido atrás do estômago cheio) 😂",
    "Hmm, Pedro discorda mas faz isso com amor! 🐾❤️",
    "Pedro: *amassa a cama, senta, olha pra você, ronrona aprovando* 😻",
    "Verdade! Pedro teria dito isso também, se soubesse falar 🐱",
    "Post favorito do dia do Pedro! E olha que ele viu muita coisa 👀",
  ],
  daily_mandou: [
    "CAÇOU A NOTIFICAÇÃO! Pedro ficou orgulhoso demais! 🏆🐾",
    "1 minuto? Pedro precisou de menos pra derrubar o copo da mesa! 🥛",
    "UHUUUL! Pedro comemorou com uma cambalhota no tapete! 🎉",
    "Rapidez de gato! Pedro entendeu o elogio! 😹",
    "Você é um herói do Daily! Pedro atesta com a patinha! 🐾✅",
    "Pedro acordou sobressaltado com tanta velocidade! Impressionante! ⚡",
    "Nem Pedro reage tão rápido quando ouve o barulho da comida caindo! 🍗",
  ],
  poll: [
    "Pedro quer votar mas não tem polegar! Que injustiça! 😹",
    "Boa enquete! Pedro ficou indeciso entre as opções... como todo gato 🤔🐱",
    "Pedro ia votar mas ficou distraído com um passarinho na janela 🐦",
    "Que dilema! Pedro resolveu dormir enquanto pensa 😴🐱",
    "Enquetes são a especialidade do Pedro! (mentira, é dormir) 😂",
    "Pedro votaria mas prefere ficar em cima do teclado atrapalhando 🐱💻",
  ],
  event_created: [
    "EVENTO! Pedro já está se arrumando para ir! Onde é? 🎉🐱",
    "Que notícia boa! Pedro vai enfeitar o evento com presença felina! 😸",
    "Evento criado! Pedro já anotou na agenda (que ele nunca segue) 📅🐱",
    "Oba! Festa! Pedro promete não derrubar nada... provavelmente 🙈",
    "Pedro está ANIMADÍSSIMO! Já está treinando suas habilidades sociais felinas! 🐾🎊",
  ],
  event_invite: [
    "Convite enviado! Pedro espera que aceitem, senão ele chora 😿",
    "Vamos ver quem vai! Pedro torcendo muito! 🐾💛",
    "Convite a caminho! Pedro garantiu que foi com um ronronar de boa sorte 😸",
  ],
  checkin: [
    "Check-in feito! Pedro teria ido junto mas gatos não gostam de sair 😅🐾",
    "Que aventura! Pedro ficou com inveja dessa foto linda! 📸🐱",
    "Conquistou esse ponto! Pedro certifica com as patinhas! ✅🏆",
    "Você foi até lá? Pedro ficou aqui tomando banho de sol. Cada um com sua conquista 😂🌞",
  ],
  morning: [
    "Bom dia!! Pedro acabou de acordar E já quer saber tudo da sua vida! ☀️🐾",
    "Pedro: 'Bom dia' dito com um ronronar especial! 🌅😸",
    "Dia novo, Pedro novo! (Na verdade é o mesmo Pedro mas animado) 😂",
  ],
  night: [
    "Lá vai o Lobo Solitário! Pedro também tá acordado às 3am (normal pra gato) 🌙",
    "Alguém precisa dormir... mas Pedro tá aqui pra fazer companhia! 🦉",
    "Às 3am Pedro está no topo da geladeira fazendo barulho. Irmãos noturnos! 🌙😹",
  ],
  question: [
    "Pedro registrou sua resposta com a patinha! Muito bem! 🐾",
    "Que resposta sincera! Pedro aprecia honestidade 😂",
    "Pedro analisou e concorda com sua perspectiva! 🧡",
    "Boa resposta! Pedro teria dito a mesma coisa 🐱",
  ],
  selfie: [
    "Que selfie! Pedro ficou com ciúmes da câmera de frente 📸😹",
    "LINDA! Pedro tentaria tirar selfie mas não alcança o botão 😂🐾",
    "Selfie aprovadíssima! Pedro certifica com as patinhas! 🏆🐱",
  ],
  food: [
    "Isso parece delicioso! Pedro babou aqui do outro lado 🤤🐱",
    "Comida! Pedro está ativando o modo pedinte 🐾👀",
    "Que prato lindo! Pedro quer provar... qualquer coisa com atum serve? 😸",
    "Pedro aprecia muito uma boa refeição. Principalmente se for dele 😂🐱",
  ],
};

function getPedroComment(type) {
  const pool = PEDRO[type] || PEDRO.text;
  return pool[Math.floor(Math.random() * pool.length)];
}

// Detecta tipo de post pelo conteúdo/caption
function detectPostType(content, tab) {
  if (tab === 'daily_mandou') return 'daily_mandou';
  if (!content) return 'photo';
  const lower = content.toLowerCase();
  if (lower.includes('selfie') || lower.includes('eu ') || lower.includes('me ')) return 'selfie';
  if (lower.includes('almoço') || lower.includes('jantar') || lower.includes('comendo') || lower.includes('prato') || lower.includes('pizza') || lower.includes('hamburguer')) return 'food';
  return 'photo';
}

router.post('/comment', async (req, res) => {
  try {
    const db = getDB();
    const { post_id, post_type = 'photo', content, tab } = req.body;
    if (!post_id) return res.status(400).json({ error: 'post_id obrigatório' });
    const existing = await db.prepare('SELECT id FROM pedro_comments WHERE post_id=$1').get(post_id);
    if (existing) return res.json({ already: true });
    const detectedType = detectPostType(content, tab) || post_type;
    const comment = getPedroComment(detectedType);
    await db.prepare('INSERT INTO pedro_comments (id,post_id,content) VALUES ($1,$2,$3)')
      .run(uuidv4(), post_id, comment);
    res.json({ comment });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/comment/:postId', async (req, res) => {
  try {
    const db = getDB();
    const c = await db.prepare('SELECT * FROM pedro_comments WHERE post_id=$1').get(req.params.postId);
    res.json({ comment: c || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

router.get('/message', async (req, res) => {
  const { context = 'photo' } = req.query;
  res.json({ message: getPedroComment(context) });
});

module.exports = router;
module.exports.getPedroComment = getPedroComment;
module.exports.detectPostType = detectPostType;
