const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');

const router = express.Router();

const PEDRO = {
  photo: [
    "Que foto incrível! Adorei de patas! 🐾",
    "Fiquei tão animado que derrubei minha tigela de ração! 😹",
    "Sinto que você está arrasando hoje! 🧡",
    "Vi essa foto e saí correndo pela casa de alegria! 🏃",
    "Que momento lindo! Estou ronronando de emoção! 😻",
    "Fui lá e cheirei a tela — aprovado! 😂",
    "Ei! Quero aparecer na próxima foto! 🐱",
    "Isso sim é conteúdo de qualidade! Certifico com a patinha! ✅🐾",
    "Pausei meu banho de sol pra comentar isso. Valeu cada segundo! 🌞",
    "Essa foto merece prêmio! Estou impressionado 🏆",
    "Mostrei pra dona. Ela quase chorou de tanto gostar! 😭🧡",
    "Me afeta tanto quanto catnip! 😸",
  ],
  text: [
    "Li e concordei balançando a cabeça 🤔🧡",
    "Que reflexão profunda! Fiquei pensativo — raro pra mim 🐱",
    "Mostrei pra dona. Ela concordou! 💛",
    "Isso que é falar a verdade! Ronronando em sinal de aprovação! 😸",
    "Li três vezes. E mordi a tela uma vez. É meu jeito de curtir! 😹",
    "Tô aqui na janela olhando a rua E pensando no que você escreveu 🪟",
    "Isso tocou meu coração! Que fica escondido atrás do estômago cheio 😂",
    "Hmm, discordo mas faço isso com amor! 🐾❤️",
    "*amasso a cama, sento, olho pra você, ronrono aprovando* 😻",
    "Verdade! Teria dito isso também, se soubesse falar 🐱",
    "Post favorito do meu dia! E olha que vi muita coisa 👀",
  ],
  daily_mandou: [
    "CAÇOU A NOTIFICAÇÃO! Fiquei orgulhoso demais! 🏆🐾",
    "1 minuto? Precisei de menos pra derrubar o copo da mesa! 🥛",
    "UHUUUL! Comemorei com uma cambalhota no tapete! 🎉",
    "Rapidez de gato! Entendi o elogio! 😹",
    "Você é um herói do Daily! Atestor com a patinha! 🐾✅",
    "Acordei sobressaltado com tanta velocidade! Impressionante! ⚡",
    "Nem eu reajo tão rápido quando ouço o barulho da comida caindo! 🍗",
  ],
  poll: [
    "Quero votar mas não tenho polegar! Que injustiça! 😹",
    "Boa enquete! Fiquei indeciso entre as opções... como todo gato 🤔🐱",
    "Ia votar mas me distraí com um passarinho na janela 🐦",
    "Que dilema! Resolvi dormir enquanto penso 😴🐱",
    "Enquetes são minha especialidade! Mentira, é dormir 😂",
    "Votaria mas prefiro ficar em cima do teclado atrapalhando 🐱💻",
  ],
  event_created: [
    "EVENTO! Já estou me arrumando pra ir! Onde é? 🎉🐱",
    "Que notícia boa! Vou enfeitar o evento com presença felina! 😸",
    "Evento criado! Já anotei na agenda (que nunca sigo) 📅🐱",
    "Oba! Festa! Prometo não derrubar nada... provavelmente 🙈",
    "Estou ANIMADÍSSIMO! Já treinando minhas habilidades sociais felinas! 🐾🎊",
  ],
  event_invite: [
    "Convite enviado! Torço pra aceitarem, senão choro 😿",
    "Vamos ver quem vai! Torcendo muito! 🐾💛",
    "Convite a caminho! Dei um ronronar de boa sorte! 😸",
  ],
  checkin: [
    "Check-in feito! Teria ido junto mas gatos não gostam de sair 😅🐾",
    "Que aventura! Fiquei com inveja dessa foto linda! 📸🐱",
    "Conquistou esse ponto! Certifico com as patinhas! ✅🏆",
    "Você foi até lá? Fiquei aqui tomando banho de sol. Cada um com sua conquista 😂🌞",
  ],
  morning: [
    "Bom dia!! Acabei de acordar E já quero saber tudo da sua vida! ☀️🐾",
    "Bom dia com um ronronar especial! 🌅😸",
    "Dia novo, eu novo! Na verdade sou o mesmo eu mas animado 😂",
  ],
  night: [
    "Lá vai o Lobo Solitário! Também tô acordado às 3am — normal pra mim 🌙",
    "Alguém precisa dormir... mas tô aqui pra fazer companhia! 🦉",
    "Às 3am estou no topo da geladeira fazendo barulho. Somos irmãos noturnos! 🌙😹",
  ],
  question: [
    "Registrei sua resposta com a patinha! Muito bem! 🐾",
    "Que resposta sincera! Aprecio honestidade 😂",
    "Analisei e concordo com sua perspectiva! 🧡",
    "Boa resposta! Teria dito a mesma coisa 🐱",
  ],
  selfie: [
    "Que selfie! Fiquei com ciúmes da câmera de frente 📸😹",
    "LINDA! Tentaria tirar selfie mas não alcanço o botão 😂🐾",
    "Selfie aprovadíssima! Certifico com as patinhas! 🏆🐱",
  ],
  food: [
    "Isso parece delicioso! Babei aqui do outro lado 🤤🐱",
    "Comida! Ativando o modo pedinte 🐾👀",
    "Que prato lindo! Quero provar... qualquer coisa com atum serve? 😸",
    "Aprecio muito uma boa refeição. Principalmente se for a minha 😂🐱",
  ],
};

function getPedroComment(type) {
  const pool = PEDRO[type] || PEDRO.text;
  return pool[Math.floor(Math.random() * pool.length)];
}

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
