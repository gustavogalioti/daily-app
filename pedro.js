const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware, optionalAuth } = require('./authmiddleware');
const brain = require('./pedro_brain');

const router = express.Router();

async function adminOnly(req, res, next) {
  const db = getDB();
  const user = await db.prepare('SELECT is_admin FROM users WHERE id=$1').get(req.user.id);
  if (!user?.is_admin) return res.status(403).json({ error: 'Acesso restrito a administradores' });
  next();
}

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
    "Imprimindo mentalmente pra guardar no álbum de memórias felinas! 📸🐾",
    "Fui mostrar pra todos os pombos da janela. Ficaram impressionados! 🐦😹",
    "Aprovado! Assinado com uma patada carinhosa 🐾🧡",
    "Corri pela casa duas vezes de alegria. Foi involuntário. 😂",
    "Zoomies de entusiasmo!! 🏃🏃🐱",
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
  politics: [
    "Política? To fora!! Pego meu catnip e vou embora! 🐱🌿",
    "Política? Prefiro ficar em cima do roteador. Tô fora! 😹",
    "Política? Não, obrigado! Vou lamber minha patinha e fingir que não li 🐾",
    "Política?? *sai correndo e some debaixo da cama* 🐱💨",
    "Esse assunto me dá urticária! Vou tomar meu catnip com paz 🌿😸",
  ],
  question_text: [
    "Boa pergunta! Eu tentaria responder mas me distraí com uma borboleta 🦋🐱",
    "Hmm, pensei muito sobre isso. Resultado: tirei uma soneca 😴🐱",
    "Que dilema profundo! Estou aqui pensando com a patinha no queixo 🤔🐾",
    "Perguntinha boa! Deixa eu consultar minha bola de pelo como oráculo 😂",
    "Analisei com a profundidade de quem passou 16h dormindo hoje 💤🐱",
  ],
  location: [
    "Que lugar incrível! Teria ido mas gatos não gostam de sair de casa 😅🐾",
    "Uau! Fiquei aqui na janela tomando sol enquanto você vai pra lugares incríveis 🌞😹",
    "Check-in feito! Certifico a aventura com a patinha! ✅🐾",
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
  // Política — prioridade máxima
  const politica = ['polít','eleição','eleicao','presidente','partido','voto','governo','congresso','senado','deputado','lula','bolsonaro','prefeito','governador','esquerda','direita'];
  if (politica.some(p => lower.includes(p))) return 'politics';
  // Outros tipos
  if (lower.includes('selfie') || lower.includes('eu ') || lower.includes('me ')) return 'selfie';
  if (lower.includes('almoço') || lower.includes('almoco') || lower.includes('jantar') || lower.includes('comendo') || lower.includes('comi') || lower.includes('prato') || lower.includes('pizza') || lower.includes('hamburguer') || lower.includes('restaurante') || lower.includes('lanche')) return 'food';
  if (lower.includes('bom dia') || lower.includes('boa manhã') || lower.includes('acordei')) return 'morning';
  if (lower.includes('boa noite') || lower.includes('dormindo') || lower.includes('dormir')) return 'night';
  if (lower.includes('?')) return 'question_text';
  return 'text';
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

// ============ CHAT DIRETO COM O PEDRO ============

async function loadActiveIntents(db) {
  const intents = await db.prepare('SELECT * FROM pedro_intents WHERE active=1').all();
  const keywords = await db.prepare('SELECT * FROM pedro_keywords').all();
  return intents.map(intent => ({
    ...intent,
    keywords: keywords.filter(k => k.intent_id === intent.id).map(k => k.keyword)
  }));
}

// POST /api/pedro/chat  { message }
router.post('/chat', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { message } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: 'Mensagem vazia' });

    const intents = await loadActiveIntents(db);
    const matched = brain.matchIntent(message, intents);

    if (!matched) {
      await db.prepare('INSERT INTO pedro_unmatched_log (id,user_id,message) VALUES ($1,$2,$3)')
        .run(uuidv4(), req.user.id, message.trim());
      const fallback = intents.find(i => i.name === 'fallback');
      const responses = fallback ? await db.prepare('SELECT content FROM pedro_responses WHERE intent_id=$1 AND active=1').all(fallback.id) : [];
      const reply = brain.pickRandom(responses.map(r => r.content)) || 'Hmm, ainda não sei sobre isso! 🐱';
      return res.json({ reply, intent: 'fallback' });
    }

    if (matched.is_external) {
      let reply;
      if (matched.external_type === 'weather') reply = await brain.getWeatherReply(message);
      else if (matched.external_type === 'wikipedia') reply = await brain.getWikipediaReply(message);
      else if (matched.external_type === 'news') reply = await brain.getNewsReply(message);
      else if (matched.external_type === 'user_stats') {
        const u = await db.prepare('SELECT points FROM users WHERE id=$1').get(req.user.id);
        reply = `Você tem ${u?.points || 0} pontos até agora! Bora subir mais no ranking? 🐾🏆`;
      } else {
        reply = 'Essa informação ainda não tá pronta aqui, mas em breve! 🐱';
      }
      return res.json({ reply, intent: matched.name });
    }

    const responses = await db.prepare('SELECT content FROM pedro_responses WHERE intent_id=$1 AND active=1').all(matched.id);
    const reply = brain.pickRandom(responses.map(r => r.content)) || 'Miau! 🐱';
    res.json({ reply, intent: matched.name });
  } catch (e) {
    console.error('pedro chat:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ============ PAINEL ADM — GERENCIAR O CÉREBRO DO PEDRO ============

// GET /api/pedro/admin/intents — lista com contagem de keywords/respostas
router.get('/admin/intents', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const intents = await db.prepare('SELECT * FROM pedro_intents ORDER BY category').all();
  const kwCounts = await db.prepare('SELECT intent_id, COUNT(*) as c FROM pedro_keywords GROUP BY intent_id').all();
  const rspCounts = await db.prepare('SELECT intent_id, COUNT(*) as c FROM pedro_responses GROUP BY intent_id').all();
  const result = intents.map(i => ({
    ...i,
    keyword_count: parseInt(kwCounts.find(k => k.intent_id === i.id)?.c || 0),
    response_count: parseInt(rspCounts.find(r => r.intent_id === i.id)?.c || 0),
  }));
  res.json({ intents: result });
});

// POST /api/pedro/admin/intents — criar novo intent
router.post('/admin/intents', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const { name, category, is_external, external_type } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'name e category são obrigatórios' });
  const id = uuidv4();
  await db.prepare('INSERT INTO pedro_intents (id,name,category,is_external,external_type,active) VALUES ($1,$2,$3,$4,$5,1)')
    .run(id, name.trim().toLowerCase().replace(/\s+/g, '_'), category, is_external ? 1 : 0, external_type || null);
  res.json({ ok: true, id });
});

// PUT /api/pedro/admin/intents/:id
router.put('/admin/intents/:id', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const { category, active, is_external, external_type } = req.body;
  await db.prepare('UPDATE pedro_intents SET category=COALESCE($1,category), active=COALESCE($2,active), is_external=COALESCE($3,is_external), external_type=COALESCE($4,external_type) WHERE id=$5')
    .run(category || null, active != null ? parseInt(active) : null, is_external != null ? parseInt(is_external) : null, external_type || null, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/pedro/admin/intents/:id — apaga intent + keywords + respostas
router.delete('/admin/intents/:id', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  await db.prepare('DELETE FROM pedro_keywords WHERE intent_id=$1').run(req.params.id);
  await db.prepare('DELETE FROM pedro_responses WHERE intent_id=$1').run(req.params.id);
  await db.prepare('DELETE FROM pedro_intents WHERE id=$1').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/pedro/admin/intents/:id/keywords — adiciona palavra-chave
router.post('/admin/intents/:id/keywords', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const { keyword } = req.body;
  if (!keyword || !keyword.trim()) return res.status(400).json({ error: 'keyword obrigatória' });
  const id = uuidv4();
  await db.prepare('INSERT INTO pedro_keywords (id,intent_id,keyword) VALUES ($1,$2,$3)')
    .run(id, req.params.id, brain.normalize(keyword));
  res.json({ ok: true, id });
});

// GET /api/pedro/admin/intents/:id/keywords
router.get('/admin/intents/:id/keywords', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const keywords = await db.prepare('SELECT * FROM pedro_keywords WHERE intent_id=$1 ORDER BY keyword').all(req.params.id);
  res.json({ keywords });
});

// DELETE /api/pedro/admin/keywords/:id
router.delete('/admin/keywords/:id', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  await db.prepare('DELETE FROM pedro_keywords WHERE id=$1').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/pedro/admin/intents/:id/responses
router.get('/admin/intents/:id/responses', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const responses = await db.prepare('SELECT * FROM pedro_responses WHERE intent_id=$1 ORDER BY created_at').all(req.params.id);
  res.json({ responses });
});

// POST /api/pedro/admin/intents/:id/responses — adiciona resposta
router.post('/admin/intents/:id/responses', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const { content } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ error: 'content obrigatório' });
  const id = uuidv4();
  await db.prepare('INSERT INTO pedro_responses (id,intent_id,content,active) VALUES ($1,$2,$3,1)')
    .run(id, req.params.id, content.trim());
  res.json({ ok: true, id });
});

// PUT /api/pedro/admin/responses/:id
router.put('/admin/responses/:id', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const { content, active } = req.body;
  await db.prepare('UPDATE pedro_responses SET content=COALESCE($1,content), active=COALESCE($2,active) WHERE id=$3')
    .run(content || null, active != null ? parseInt(active) : null, req.params.id);
  res.json({ ok: true });
});

// DELETE /api/pedro/admin/responses/:id
router.delete('/admin/responses/:id', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  await db.prepare('DELETE FROM pedro_responses WHERE id=$1').run(req.params.id);
  res.json({ ok: true });
});

// GET /api/pedro/admin/unmatched — perguntas que caíram no fallback (o que falta cadastrar)
router.get('/admin/unmatched', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const logs = await db.prepare('SELECT * FROM pedro_unmatched_log ORDER BY created_at DESC LIMIT 100').all();
  res.json({ logs });
});

// DELETE /api/pedro/admin/unmatched/:id — remove um item já tratado
router.delete('/admin/unmatched/:id', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  await db.prepare('DELETE FROM pedro_unmatched_log WHERE id=$1').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
module.exports.getPedroComment = getPedroComment;
module.exports.detectPostType = detectPostType;
