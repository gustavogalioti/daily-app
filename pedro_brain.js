// Lógica de reconhecimento de intenção do Pedro IA + conectores externos.
// Sem dependência de nenhum modelo de linguagem — tudo baseado em palavras-chave
// cadastradas no banco (pedro_intents/pedro_keywords/pedro_responses) + fuzzy matching
// como rede de segurança para erros de digitação não previstos.

function normalize(text) {
  return (text || '')
    .toString()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove acentos
    .replace(/[^a-z0-9\s]/g, ' ') // remove pontuação/emoji
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const al = a.length, bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const dp = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) dp[j] = j;
  for (let i = 1; i <= al; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= bl; j++) {
      const temp = dp[j];
      dp[j] = Math.min(
        dp[j] + 1,        // deleção
        dp[j - 1] + 1,    // inserção
        prev + (a[i - 1] === b[j - 1] ? 0 : 1) // substituição
      );
      prev = temp;
    }
  }
  return dp[bl];
}

// Tolerância proporcional ao tamanho da palavra: palavras curtas toleram menos erro.
function fuzzyThreshold(len) {
  if (len <= 3) return 0;   // "oi", "vc" — precisa ser exato ou já estar na lista de variações
  if (len <= 6) return 1;
  return 2;
}

function wordsMatch(inputWord, keywordWord) {
  if (inputWord === keywordWord) return true;
  const threshold = fuzzyThreshold(keywordWord.length);
  if (threshold === 0) return false;
  // Evita comparar palavras de tamanho muito diferente (economiza processamento e falsos positivos)
  if (Math.abs(inputWord.length - keywordWord.length) > threshold) return false;
  return levenshtein(inputWord, keywordWord) <= threshold;
}

// intentsWithKeywords: [{ id, name, category, is_external, external_type, keywords: [kw,...] }]
// Retorna o intent com melhor match, ou null (cai no fallback).
function matchIntent(message, intentsWithKeywords) {
  const normMsg = normalize(message);
  if (!normMsg) return null;
  const msgWords = normMsg.split(' ');

  let best = null;
  let bestScore = 0;

  for (const intent of intentsWithKeywords) {
    if (intent.name === 'fallback') continue;
    for (const kw of intent.keywords) {
      const normKw = normalize(kw);
      if (!normKw) continue;
      // Frase inteira (palavra-chave com múltiplas palavras) — checa substring direta primeiro
      if (normKw.includes(' ')) {
        if (normMsg.includes(normKw)) {
          const score = normKw.length * 2; // frases completas pesam mais
          if (score > bestScore) { bestScore = score; best = intent; }
        }
        continue;
      }
      // Palavra única — checa exata ou fuzzy contra cada palavra da mensagem
      for (const w of msgWords) {
        if (wordsMatch(w, normKw)) {
          const score = normKw.length;
          if (score > bestScore) { bestScore = score; best = intent; }
        }
      }
    }
  }
  return best;
}

function pickRandom(arr) {
  if (!arr || !arr.length) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------- Conectores externos ----------
// Todos usam fetch nativo do Node 18+. Nenhum exige chave de API, exceto notícias
// (opcional — funciona sem, avisando que ainda não foi configurado).

async function getWeatherReply(message) {
  try {
    // Tenta extrair um nome de cidade após "em"/"de" (ex: "vai chover em Jundiaí")
    const m = normalize(message).match(/(?:em|de|no|na)\s+([a-z\s]+)$/);
    const city = m ? m[1].trim() : null;

    if (!city) {
      return 'Me fala o nome da cidade que eu confiro o tempo pra você! Tipo "vai chover em Jundiaí" 🐾🌦️';
    }

    const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=pt`);
    const geoData = await geoRes.json();
    const place = geoData?.results?.[0];
    if (!place) return `Não achei essa cidade aqui no mapa felino 🐱🗺️ Confere o nome?`;

    const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,precipitation,weather_code&timezone=auto`);
    const wData = await wRes.json();
    const cur = wData?.current;
    if (!cur) return 'Consultei as nuvens mas elas não quiseram falar comigo agora 😹 tenta de novo?';

    const temp = Math.round(cur.temperature_2m);
    const chuva = cur.precipitation > 0 ? `e tem chuva rolando (${cur.precipitation}mm) ☔` : 'sem chuva no momento ☀️';
    return `Em ${place.name} agora tá ${temp}°C, ${chuva} 🐾🌤️`;
  } catch (e) {
    console.error('getWeatherReply:', e.message);
    return 'Tentei checar o tempo mas escorreguei numa nuvem 😹 tenta de novo daqui a pouco?';
  }
}

async function getWikipediaReply(message) {
  try {
    const query = message.replace(/^(quem foi|quem era|quem e|oq e|o q e|oque e|significa|quer dizer|quer dize)\s*/i, '').trim() || message;
    const searchRes = await fetch(`https://pt.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&srlimit=1`, {
      headers: { 'User-Agent': 'DailyApp-PedroIA/1.0' }
    });
    const searchData = await searchRes.json();
    const hit = searchData?.query?.search?.[0];
    if (!hit) return 'Procurei nos meus livros felinos mas não achei nada sobre isso 🐱📚';

    const title = hit.title;
    const sumRes = await fetch(`https://pt.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, {
      headers: { 'User-Agent': 'DailyApp-PedroIA/1.0' }
    });
    const sumData = await sumRes.json();
    const extract = sumData?.extract;
    if (!extract) return `Achei "${title}" mas não consegui puxar o resumo agora 🐾`;

    const short = extract.length > 400 ? extract.slice(0, 400).trim() + '…' : extract;
    return `${short}\n\n🔗 Fonte: Wikipédia — ${sumData?.content_urls?.desktop?.page || title}`;
  } catch (e) {
    console.error('getWikipediaReply:', e.message);
    return 'Fui pesquisar mas me distraí com um passarinho no meio do caminho 🐦😹 tenta de novo?';
  }
}

async function getNewsReply(message) {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    return 'Ainda não me deram acesso às notícias do mundo lá fora 🐾📰 (o Gustavo precisa configurar isso ainda!)';
  }
  try {
    const query = message.replace(/^(noticia|noticias|noticiaa|aconteceu|oq aconteceu|o q rolou|ultimas|ultimas noticias)\s*(sobre|de)?\s*/i, '').trim();
    const url = query
      ? `https://gnews.io/api/v4/search?q=${encodeURIComponent(query)}&lang=pt&max=1&token=${apiKey}`
      : `https://gnews.io/api/v4/top-headlines?lang=pt&country=br&max=1&token=${apiKey}`;
    const res = await fetch(url);
    const data = await res.json();
    const article = data?.articles?.[0];
    if (!article) return 'Não achei nada novo agora — tá tudo calmo por aí 🐱';
    return `📰 ${article.title}\n${article.description || ''}\n🔗 ${article.url}`;
  } catch (e) {
    console.error('getNewsReply:', e.message);
    return 'Tentei buscar as notícias mas o jornal escorregou da minha pata 😹';
  }
}

module.exports = {
  normalize,
  levenshtein,
  matchIntent,
  pickRandom,
  getWeatherReply,
  getWikipediaReply,
  getNewsReply,
};
