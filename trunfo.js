const express = require('express');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');
require('./cloudinary'); // garante que cloudinary.config() já rodou
const cloudinary = require('cloudinary').v2;

async function uploadCardImage(dataUrl, folder){
  const result = await cloudinary.uploader.upload(dataUrl, {
    folder,
    quality: 'auto',
    fetch_format: 'auto',
    transformation: [{ width: 900, height: 1200, crop: 'limit' }],
  });
  return result.secure_url;
}

const router = express.Router();

// ────────────────────────────────────────────────────────────────
// Metadados fixos das coleções (nome, ícone, atributos)
// ────────────────────────────────────────────────────────────────
const COLLECTIONS_META = {
  animais: {
    label: '🐾 Animais',
    attrs: [
      { key:'a1', icon:'💪', label:'Força' },
      { key:'a2', icon:'⚡', label:'Velocidade' },
      { key:'a3', icon:'🧠', label:'Inteligência' },
      { key:'a4', icon:'❤️', label:'Resistência' },
      { key:'a5', icon:'🦷', label:'Mordida' },
      { key:'a6', icon:'⚖️', label:'Peso' },
    ],
  },
  carros: {
    label: '🚗 Carros',
    attrs: [
      { key:'a1', icon:'🏁', label:'Vel. Máxima' },
      { key:'a2', icon:'⚡', label:'Aceleração' },
      { key:'a3', icon:'🔥', label:'Potência' },
      { key:'a4', icon:'💰', label:'Valor' },
      { key:'a5', icon:'⭐', label:'Exclusividade' },
      { key:'a6', icon:'❤️', label:'Popularidade' },
    ],
  },
  paises: {
    label: '🌎 Países',
    attrs: [
      { key:'a1', icon:'👥', label:'População' },
      { key:'a2', icon:'💰', label:'PIB' },
      { key:'a3', icon:'📏', label:'Território' },
      { key:'a4', icon:'🌎', label:'Influência' },
      { key:'a5', icon:'🎓', label:'Educação' },
      { key:'a6', icon:'🪖', label:'Poder Militar' },
    ],
  },
  filmes: {
    label: '🎬 Filmes',
    attrs: [
      { key:'a1', icon:'💵', label:'Bilheteria' },
      { key:'a2', icon:'⭐', label:'Nota Crítica' },
      { key:'a3', icon:'❤️', label:'Popularidade' },
      { key:'a4', icon:'🌎', label:'Impacto Cultural' },
      { key:'a5', icon:'🏆', label:'Prêmios' },
      { key:'a6', icon:'⏱️', label:'Duração' },
    ],
  },
  bichos: {
    label: '🐕 Bichos Domésticos',
    attrs: [
      { key:'a1', icon:'🥰', label:'Fofura' },
      { key:'a2', icon:'⚡', label:'Energia' },
      { key:'a3', icon:'🎓', label:'Inteligência' },
      { key:'a4', icon:'🤝', label:'Fidelidade' },
      { key:'a5', icon:'🦵', label:'Independência' },
      { key:'a6', icon:'❤️', label:'Popularidade' },
    ],
  },
};

// ────────────────────────────────────────────────────────────────
// Seed inicial das cartas (nome, slug, raridade, stats).
// image_url começa preenchida só pra Animais (fotos já sobem no
// Cloudinary manualmente); as demais ficam null até o admin subir
// pela tela de administração.
// ────────────────────────────────────────────────────────────────
const CLOUDINARY_CLOUD = process.env.CLOUDINARY_CLOUD_NAME || '';
function animaisUrl(slug){
  return CLOUDINARY_CLOUD ? `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/upload/trunfo/animais/${slug}` : null;
}

const SEED = {
  animais: [
    ['formiga','FORMIGA','incomum',10,20,15,90,5,1],
    ['camaleao','CAMALEÃO','raro',15,10,55,30,10,5],
    ['aguia','ÁGUIA','raro',40,85,60,45,55,20],
    ['lobo','LOBO','epico',55,60,70,60,65,35],
    ['golfinho','GOLFINHO','epico',50,70,90,55,40,45],
    ['falcaoperegrino','FALCÃO-PEREGRINO','lendario',45,99,65,50,50,15],
    ['rinoceronte','RINOCERONTE','lendario',88,40,35,85,60,92],
    ['ursopardo','URSO PARDO','mitico',90,55,60,88,80,85],
    ['gorila','GORILA','mitico',95,45,85,80,75,78],
    ['guepardo','GUEPARDO','cosmico',60,98,55,40,45,25],
    ['crocodilo','CROCODILO','cosmico',92,30,45,90,99,88],
    ['leao','LEÃO','cosmico',93,68,65,82,88,75],
    ['tubaraobranco','TUBARÃO-BRANCO','cosmico',85,60,50,85,95,90],
    ['baleiaazul','BALEIA-AZUL','noturno',99,35,70,95,20,99],
  ],
  carros: [
    ['fiat-uno','FIAT UNO','incomum',15,10,12,5,3,60],
    ['vw-gol','VOLKSWAGEN GOL','incomum',20,15,18,8,4,70],
    ['chevrolet-onix','CHEVROLET ONIX','incomum',25,20,22,12,5,65],
    ['fiat-palio','FIAT PALIO','incomum',18,14,16,6,3,55],
    ['renault-kwid','RENAULT KWID','incomum',16,12,14,5,4,45],
    ['hyundai-hb20','HYUNDAI HB20','incomum',22,18,20,10,5,58],
    ['vw-fox','VOLKSWAGEN FOX','incomum',21,16,19,9,4,50],
    ['toyota-corolla','TOYOTA COROLLA','raro',35,30,32,22,15,75],
    ['honda-civic','HONDA CIVIC','raro',38,33,35,24,18,72],
    ['vw-golf-gti','VW GOLF GTI','raro',45,48,50,30,25,60],
    ['ford-mustang-v6','FORD MUSTANG V6','raro',42,40,45,28,30,68],
    ['jeep-compass','JEEP COMPASS','raro',32,28,34,32,22,55],
    ['toyota-hilux','TOYOTA HILUX','raro',30,26,40,35,20,62],
    ['bmw-m3','BMW M3','epico',60,65,68,55,45,58],
    ['audi-rs3','AUDI RS3','epico',58,68,65,52,42,50],
    ['porsche-718-cayman','PORSCHE 718 CAYMAN','epico',62,63,60,58,55,48],
    ['camaro-ss','CHEVROLET CAMARO SS','epico',63,66,70,50,48,62],
    ['challenger-srt','DODGE CHALLENGER SRT','epico',61,64,72,48,46,55],
    ['nissan-gtr','NISSAN GT-R','lendario',78,82,80,65,65,60],
    ['porsche-911-turbo','PORSCHE 911 TURBO','lendario',80,85,82,70,68,58],
    ['huracan','LAMBORGHINI HURACÁN','lendario',85,88,85,78,80,65],
    ['ferrari-488','FERRARI 488','lendario',86,89,86,80,82,64],
    ['f8-tributo','FERRARI F8 TRIBUTO','mitico',90,92,90,88,88,62],
    ['aventador','LAMBORGHINI AVENTADOR','mitico',91,90,92,90,90,68],
    ['mclaren-720s','MCLAREN 720S','mitico',93,94,91,89,87,55],
    ['bugatti-chiron','BUGATTI CHIRON','cosmico',99,97,99,98,97,50],
    ['koenigsegg-jesko','KOENIGSEGG JESKO','cosmico',98,98,97,96,96,40],
    ['ferrari-f40','FERRARI F40','noturno',87,83,78,95,99,70],
  ],
  paises: [
    ['uruguai','URUGUAI','incomum',8,15,12,10,55,8],
    ['paraguai','PARAGUAI','incomum',10,10,15,8,40,7],
    ['bolivia','BOLÍVIA','incomum',12,9,25,8,38,9],
    ['costa-rica','COSTA RICA','incomum',6,12,5,12,60,2],
    ['islandia','ISLÂNDIA','incomum',1,10,8,10,70,1],
    ['luxemburgo','LUXEMBURGO','incomum',1,25,1,15,65,1],
    ['nova-zelandia','NOVA ZELÂNDIA','incomum',5,18,18,18,68,10],
    ['portugal','PORTUGAL','raro',11,22,8,25,62,15],
    ['grecia','GRÉCIA','raro',11,20,9,28,60,18],
    ['chile','CHILE','raro',20,28,30,22,58,20],
    ['colombia','COLÔMBIA','raro',52,30,35,25,50,25],
    ['austria','ÁUSTRIA','raro',9,35,8,30,70,12],
    ['belgica','BÉLGICA','raro',12,38,3,40,68,14],
    ['argentina','ARGENTINA','epico',46,42,55,40,60,35],
    ['mexico','MÉXICO','epico',99,45,60,45,48,38],
    ['espanha','ESPANHA','epico',47,50,40,50,65,40],
    ['holanda','HOLANDA','epico',17,48,5,48,72,30],
    ['suica','SUÍÇA','epico',9,55,6,45,78,25],
    ['brasil','BRASIL','lendario',99,55,95,55,45,50],
    ['canada','CANADÁ','lendario',39,60,92,55,75,45],
    ['italia','ITÁLIA','lendario',59,58,30,58,62,42],
    ['coreia-do-sul','COREIA DO SUL','lendario',52,62,10,60,85,65],
    ['alemanha','ALEMANHA','mitico',84,75,35,78,80,58],
    ['reino-unido','REINO UNIDO','mitico',68,72,24,82,78,68],
    ['franca','FRANÇA','mitico',68,70,55,80,76,70],
    ['japao','JAPÃO','cosmico',99,80,38,82,88,60],
    ['india','ÍNDIA','cosmico',99,78,88,78,55,75],
    ['estados-unidos','ESTADOS UNIDOS','noturno',90,99,90,99,82,99],
  ],
  filmes: [
    ['kick-ass','KICK-ASS','incomum',20,55,45,30,5,40],
    ['scott-pilgrim','SCOTT PILGRIM','incomum',15,65,50,40,5,38],
    ['zombieland','ZOMBIELAND','incomum',22,60,48,32,3,35],
    ['attack-the-block','ATTACK THE BLOCK','incomum',10,58,30,25,2,33],
    ['cabin-in-the-woods','THE CABIN IN THE WOODS','incomum',18,62,35,35,4,34],
    ['tucker-dale','TUCKER & DALE VS EVIL','incomum',8,55,25,20,1,32],
    ['free-guy','FREE GUY','incomum',30,58,55,28,3,45],
    ['jumanji','JUMANJI','raro',45,60,65,45,8,50],
    ['os-incriveis','OS INCRÍVEIS','raro',50,78,68,55,20,48],
    ['shrek','SHREK','raro',48,75,72,60,22,42],
    ['aranhaverso','HOMEM-ARANHA: NO ARANHAVERSO','raro',42,88,70,62,35,46],
    ['la-la-land','LA LA LAND','raro',40,82,60,50,40,44],
    ['divertida-mente','DIVERTIDA MENTE','raro',46,85,68,58,25,40],
    ['ultron','VINGADORES: ERA DE ULTRON','epico',65,65,75,60,15,62],
    ['interestelar','INTERESTELAR','epico',58,82,72,68,30,75],
    ['coringa','CORINGA','epico',62,78,78,70,45,55],
    ['john-wick','JOHN WICK','epico',50,70,70,55,10,48],
    ['duna','DUNA','epico',60,80,68,62,40,70],
    ['poderoso-chefao','O PODEROSO CHEFÃO','lendario',55,98,80,92,60,80],
    ['pulp-fiction','PULP FICTION','lendario',50,96,82,90,55,68],
    ['matrix','MATRIX','lendario',65,88,85,88,50,58],
    ['star-wars-iv','STAR WARS: UMA NOVA ESPERANÇA','lendario',70,90,90,95,45,52],
    ['senhor-aneis-rei','SENHOR DOS ANÉIS: O RETORNO DO REI','mitico',85,93,88,90,90,95],
    ['ultimato','VINGADORES: ULTIMATO','mitico',99,85,95,85,30,90],
    ['titanic','TITANIC','mitico',92,88,92,88,75,88],
    ['avatar','AVATAR','cosmico',98,80,90,82,55,85],
    ['guerra-infinita','VINGADORES: GUERRA INFINITA','cosmico',95,84,93,84,25,82],
    ['cidadao-kane','CIDADÃO KANE','noturno',15,99,35,99,65,50],
  ],
  bichos: [
    ['hamster','HAMSTER','incomum',70,50,30,20,60,55],
    ['peixe-dourado','PEIXE-DOURADO','incomum',40,20,15,5,90,45],
    ['tartaruga','TARTARUGA-DE-ORELHA-VERMELHA','incomum',35,10,25,15,85,30],
    ['coelho-anao','COELHO-ANÃO','incomum',80,45,35,30,55,60],
    ['periquito','PERIQUITO','incomum',60,55,40,35,50,50],
    ['porquinho-india','PORQUINHO-DA-ÍNDIA','incomum',75,40,32,40,45,52],
    ['canario','CANÁRIO','incomum',55,50,30,20,60,40],
    ['gato-vira-lata','GATO VIRA-LATA (SRD)','raro',65,45,60,55,80,68],
    ['cachorro-vira-lata','CACHORRO VIRA-LATA (SRD)','raro',70,60,55,75,50,72],
    ['calopsita','CALOPSITA','raro',62,55,45,45,45,55],
    ['chinchila','CHINCHILA','raro',68,48,40,30,65,45],
    ['furao','FURÃO','raro',60,75,55,50,55,42],
    ['gato-persa','GATO PERSA','raro',78,25,45,40,75,65],
    ['bulldog-frances','BULLDOG FRANCÊS','epico',85,40,50,70,35,85],
    ['golden-retriever','GOLDEN RETRIEVER','epico',82,75,78,90,25,88],
    ['gato-siames','GATO SIAMÊS','epico',72,55,70,55,60,60],
    ['papagaio','PAPAGAIO-VERDADEIRO','epico',65,60,85,60,40,58],
    ['husky-siberiano','HUSKY SIBERIANO','epico',80,90,68,65,55,78],
    ['pastor-alemao','PASTOR-ALEMÃO','lendario',70,80,90,92,35,82],
    ['maine-coon','GATO MAINE COON','lendario',85,50,65,55,65,75],
    ['poodle','POODLE','lendario',78,65,88,75,40,70],
    ['border-collie','BORDER COLLIE','lendario',75,92,95,85,30,72],
    ['labrador','LABRADOR','mitico',88,82,82,90,25,92],
    ['bulldog-ingles','BULLDOG INGLÊS','mitico',90,35,55,78,30,80],
    ['gato-sphynx','GATO SPHYNX','mitico',60,55,70,60,70,68],
    ['corgi','CORGI','cosmico',96,70,75,82,35,90],
    ['shih-tzu','SHIH TZU','cosmico',92,45,55,80,30,85],
    ['vira-lata-caramelo','VIRA-LATA CARAMELO','noturno',99,70,75,99,50,99],
  ],
};

// ────────────────────────────────────────────────────────────────
// Init / seed do banco
// ────────────────────────────────────────────────────────────────
async function initTrunfoDB(){
  const db = getDB();
  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS trunfo_cards (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        collection TEXT NOT NULL,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        rarity TEXT NOT NULL,
        stats JSONB NOT NULL,
        image_url TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(collection, slug)
      )
    `).run();
  } catch(e){ console.error('trunfo_cards CREATE TABLE erro:', e.message); }

  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS trunfo_players (
        user_id TEXT PRIMARY KEY,
        coins INTEGER NOT NULL DEFAULT 500,
        fragments INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `).run();
  } catch(e){ console.error('trunfo_players CREATE TABLE erro:', e.message); }

  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS trunfo_player_cards (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        quantity INTEGER NOT NULL DEFAULT 1,
        acquired_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, card_id)
      )
    `).run();
  } catch(e){ console.error('trunfo_player_cards CREATE TABLE erro:', e.message); }

  try {
    await db.prepare(`
      CREATE TABLE IF NOT EXISTS trunfo_decks (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT 'Meu Deck',
        card_ids JSONB NOT NULL DEFAULT '[]',
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, collection)
      )
    `).run();
  } catch(e){ console.error('trunfo_decks CREATE TABLE erro:', e.message); }

  for (const [collection, cards] of Object.entries(SEED)) {
    for (const [slug, name, rarity, ...vals] of cards) {
      const attrs = COLLECTIONS_META[collection].attrs;
      const stats = {};
      attrs.forEach((a,i)=>{ stats[a.key] = vals[i]; });
      const imageUrl = collection === 'animais' ? animaisUrl(slug) : null;
      try {
        await db.prepare(`
          INSERT INTO trunfo_cards (collection, slug, name, rarity, stats, image_url)
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (collection, slug) DO NOTHING
        `).run(collection, slug, name, rarity, JSON.stringify(stats), imageUrl);
      } catch(e){ console.error('trunfo seed erro', collection, slug, e.message); }
    }
  }
}

// ────────────────────────────────────────────────────────────────
// Admin gate (mesmo padrão do admin.js)
// ────────────────────────────────────────────────────────────────
async function adminOnly(req, res, next){
  const db = getDB();
  const user = await db.prepare('SELECT is_admin FROM users WHERE id=$1').get(req.user.id);
  if (!user?.is_admin) return res.status(403).json({ error: 'Acesso restrito a administradores' });
  next();
}

// GET /api/trunfo/collections
router.get('/collections', async (req, res) => {
  const db = getDB();
  const out = [];
  for (const [key, meta] of Object.entries(COLLECTIONS_META)) {
    const row = await db.prepare('SELECT COUNT(*) as c, COUNT(image_url) as withphoto FROM trunfo_cards WHERE collection=$1').get(key);
    out.push({ key, label: meta.label, attrs: meta.attrs, cardCount: parseInt(row?.c||0), withPhoto: parseInt(row?.withphoto||0) });
  }
  res.json({ collections: out });
});

// GET /api/trunfo/cards?collection=animais
router.get('/cards', async (req, res) => {
  const { collection } = req.query;
  if (!collection || !COLLECTIONS_META[collection]) return res.status(400).json({ error: 'Coleção inválida' });
  const db = getDB();
  const cards = await db.prepare('SELECT id, slug, name, rarity, stats, image_url FROM trunfo_cards WHERE collection=$1 ORDER BY name ASC').all(collection);
  res.json({ collection, attrs: COLLECTIONS_META[collection].attrs, cards });
});

// POST /api/trunfo/cards/:id/photo  (admin) — recebe imagem já cortada em base64
router.post('/cards/:id/photo', authMiddleware, adminOnly, async (req, res) => {
  const db = getDB();
  const { image } = req.body;
  if (!image) return res.status(400).json({ error: 'Imagem não enviada' });

  const card = await db.prepare('SELECT * FROM trunfo_cards WHERE id=$1').get(req.params.id);
  if (!card) return res.status(404).json({ error: 'Carta não encontrada' });

  try {
    const url = await uploadCardImage(image, `trunfo/${card.collection}`);
    await db.prepare('UPDATE trunfo_cards SET image_url=$1, updated_at=NOW() WHERE id=$2').run(url, card.id);
    res.json({ ok: true, image_url: url });
  } catch(e) {
    console.error('trunfo upload erro:', e.message);
    res.status(500).json({ error: 'Falha no upload da imagem' });
  }
});

// ────────────────────────────────────────────────────────────────
// Jogador — perfil, moedas/fragmentos, coleção
// ────────────────────────────────────────────────────────────────
const STARTER_COINS = 500;

async function ensurePlayer(userId){
  const db = getDB();
  let player = await db.prepare('SELECT * FROM trunfo_players WHERE user_id=$1').get(userId);
  if (player) return player;

  await db.prepare(`
    INSERT INTO trunfo_players (user_id, coins, fragments) VALUES ($1,$2,0)
    ON CONFLICT (user_id) DO NOTHING
  `).run(userId, STARTER_COINS);

  // Kit inicial: as 4 cartas de raridade mais baixa disponíveis em cada coleção
  // (adaptável — não assume quantas Incomuns/Raras cada coleção tem)
  for (const collection of Object.keys(COLLECTIONS_META)) {
    const starterCards = await db.prepare(`
      SELECT id FROM trunfo_cards WHERE collection=$1
      ORDER BY CASE rarity
        WHEN 'incomum' THEN 1 WHEN 'raro' THEN 2 WHEN 'epico' THEN 3
        WHEN 'lendario' THEN 4 WHEN 'mitico' THEN 5 WHEN 'cosmico' THEN 6 ELSE 7 END,
        random()
      LIMIT 4
    `).all(collection);
    for (const c of starterCards) {
      try {
        await db.prepare(`
          INSERT INTO trunfo_player_cards (user_id, card_id, quantity) VALUES ($1,$2,1)
          ON CONFLICT (user_id, card_id) DO NOTHING
        `).run(userId, c.id);
      } catch(e){ console.error('starter kit erro:', e.message); }
    }
  }

  player = await db.prepare('SELECT * FROM trunfo_players WHERE user_id=$1').get(userId);
  return player;
}

// GET /api/trunfo/me — saldo do jogador (cria registro + kit inicial na primeira vez)
router.get('/me', authMiddleware, async (req, res) => {
  const player = await ensurePlayer(req.user.id);
  res.json({ coins: player.coins, fragments: player.fragments });
});

// GET /api/trunfo/me/collection?collection=animais — cartas que o jogador possui
router.get('/me/collection', authMiddleware, async (req, res) => {
  const { collection } = req.query;
  if (!collection || !COLLECTIONS_META[collection]) return res.status(400).json({ error: 'Coleção inválida' });
  await ensurePlayer(req.user.id);

  const db = getDB();
  const allCards = await db.prepare(
    'SELECT id, slug, name, rarity, stats, image_url FROM trunfo_cards WHERE collection=$1 ORDER BY name ASC'
  ).all(collection);
  const owned = await db.prepare(
    `SELECT card_id, quantity FROM trunfo_player_cards
     WHERE user_id=$1 AND card_id IN (SELECT id FROM trunfo_cards WHERE collection=$2)`
  ).all(req.user.id, collection);
  const ownedMap = {};
  owned.forEach(o => { ownedMap[o.card_id] = o.quantity; });

  const cards = allCards.map(c => ({ ...c, owned: !!ownedMap[c.id], quantity: ownedMap[c.id] || 0 }));
  res.json({ collection, attrs: COLLECTIONS_META[collection].attrs, cards });
});

// ────────────────────────────────────────────────────────────────
// Loja — abertura de pacotes
// ────────────────────────────────────────────────────────────────
const RARITY_ORDER = ['incomum','raro','epico','lendario','mitico','cosmico','noturno'];
const RARITY_WEIGHTS = { incomum:35, raro:28, epico:18, lendario:10, mitico:5, cosmico:3, noturno:1 };
const FRAGMENT_VALUE = { incomum:5, raro:10, epico:20, lendario:40, mitico:80, cosmico:150, noturno:300 };
const PACKS = {
  bronze:  { cost:100, count:3 },
  dourado: { cost:300, count:5, guaranteeMin:'lendario' },
};

function rollRarity(guaranteeMin){
  let pool = Object.entries(RARITY_WEIGHTS);
  if (guaranteeMin) {
    const minIdx = RARITY_ORDER.indexOf(guaranteeMin);
    pool = pool.filter(([r]) => RARITY_ORDER.indexOf(r) >= minIdx);
  }
  const total = pool.reduce((s,[,w]) => s+w, 0);
  let roll = Math.random() * total;
  for (const [r,w] of pool) { if (roll < w) return r; roll -= w; }
  return pool[0][0];
}

// POST /api/trunfo/packs/open  { type: 'bronze'|'dourado', collection: 'animais' }
router.post('/packs/open', authMiddleware, async (req, res) => {
  const { type, collection } = req.body;
  const pack = PACKS[type];
  if (!pack) return res.status(400).json({ error: 'Tipo de pacote inválido' });
  if (!COLLECTIONS_META[collection]) return res.status(400).json({ error: 'Coleção inválida' });

  const db = getDB();
  const player = await ensurePlayer(req.user.id);
  if (player.coins < pack.cost) return res.status(400).json({ error: 'Moedas insuficientes' });

  await db.prepare('UPDATE trunfo_players SET coins=coins-$1, updated_at=NOW() WHERE user_id=$2').run(pack.cost, req.user.id);

  const pulls = [];
  let fragGained = 0;
  for (let i = 0; i < pack.count; i++) {
    const guarantee = (pack.guaranteeMin && i === 0) ? pack.guaranteeMin : null;
    const rarity = rollRarity(guarantee);
    const candidates = await db.prepare('SELECT * FROM trunfo_cards WHERE collection=$1 AND rarity=$2').all(collection, rarity);
    if (!candidates.length) continue;
    const card = candidates[Math.floor(Math.random() * candidates.length)];

    const owned = await db.prepare('SELECT quantity FROM trunfo_player_cards WHERE user_id=$1 AND card_id=$2').get(req.user.id, card.id);
    if (owned) {
      const frag = FRAGMENT_VALUE[card.rarity] || 0;
      fragGained += frag;
      await db.prepare('UPDATE trunfo_player_cards SET quantity=quantity+1 WHERE user_id=$1 AND card_id=$2').run(req.user.id, card.id);
      pulls.push({ id:card.id, name:card.name, rarity:card.rarity, image_url:card.image_url, isDup:true, fragGained:frag });
    } else {
      await db.prepare('INSERT INTO trunfo_player_cards (user_id, card_id, quantity) VALUES ($1,$2,1)').run(req.user.id, card.id);
      pulls.push({ id:card.id, name:card.name, rarity:card.rarity, image_url:card.image_url, isDup:false });
    }
  }

  if (fragGained > 0) {
    await db.prepare('UPDATE trunfo_players SET fragments=fragments+$1, updated_at=NOW() WHERE user_id=$2').run(fragGained, req.user.id);
  }

  const updated = await db.prepare('SELECT coins, fragments FROM trunfo_players WHERE user_id=$1').get(req.user.id);
  res.json({ pulls, coins: updated.coins, fragments: updated.fragments });
});

// ────────────────────────────────────────────────────────────────
// Deck Builder — salvar/ler o deck do jogador por coleção
// ────────────────────────────────────────────────────────────────
const DECK_MAX = 10;

// GET /api/trunfo/me/deck?collection=animais
router.get('/me/deck', authMiddleware, async (req, res) => {
  const { collection } = req.query;
  if (!COLLECTIONS_META[collection]) return res.status(400).json({ error: 'Coleção inválida' });
  await ensurePlayer(req.user.id);

  const db = getDB();
  const deck = await db.prepare('SELECT name, card_ids FROM trunfo_decks WHERE user_id=$1 AND collection=$2').get(req.user.id, collection);
  res.json({ collection, name: deck?.name || 'Meu Deck', cardIds: deck?.card_ids || [] });
});

// PUT /api/trunfo/me/deck  { collection, name, cardIds }
router.put('/me/deck', authMiddleware, async (req, res) => {
  const { collection, name, cardIds } = req.body;
  if (!COLLECTIONS_META[collection]) return res.status(400).json({ error: 'Coleção inválida' });
  if (!Array.isArray(cardIds)) return res.status(400).json({ error: 'cardIds precisa ser uma lista' });

  const uniqueIds = [...new Set(cardIds)];
  if (uniqueIds.length > DECK_MAX) return res.status(400).json({ error: `Deck limitado a ${DECK_MAX} cartas` });

  const db = getDB();
  if (uniqueIds.length > 0) {
    const owned = await db.prepare(
      `SELECT card_id FROM trunfo_player_cards WHERE user_id=$1 AND card_id = ANY($2::text[])`
    ).all(req.user.id, uniqueIds);
    const ownedSet = new Set(owned.map(o => o.card_id));
    const notOwned = uniqueIds.filter(id => !ownedSet.has(id));
    if (notOwned.length) return res.status(400).json({ error: 'Você não possui todas essas cartas', notOwned });
  }

  await db.prepare(`
    INSERT INTO trunfo_decks (user_id, collection, name, card_ids)
    VALUES ($1,$2,$3,$4)
    ON CONFLICT (user_id, collection) DO UPDATE SET name=$3, card_ids=$4, updated_at=NOW()
  `).run(req.user.id, collection, name || 'Meu Deck', JSON.stringify(uniqueIds));

  res.json({ collection, name: name || 'Meu Deck', cardIds: uniqueIds });
});

// GET /api/trunfo/me/deck/cards?collection=animais — cartas completas do deck salvo (pra jogar sozinho contra o Pedro)
router.get('/me/deck/cards', authMiddleware, async (req, res) => {
  const { collection } = req.query;
  if (!COLLECTIONS_META[collection]) return res.status(400).json({ error: 'Coleção inválida' });
  await ensurePlayer(req.user.id);

  const db = getDB();
  const deck = await db.prepare('SELECT card_ids FROM trunfo_decks WHERE user_id=$1 AND collection=$2').get(req.user.id, collection);
  const cardIds = deck?.card_ids || [];
  if (!cardIds.length) return res.json({ collection, attrs: COLLECTIONS_META[collection].attrs, cards: [] });

  const cards = await db.prepare(`SELECT id, slug, name, rarity, stats, image_url FROM trunfo_cards WHERE id = ANY($1::text[])`).all(cardIds);
  res.json({ collection, attrs: COLLECTIONS_META[collection].attrs, cards });
});

// POST /api/trunfo/practice/finish  { won: true|false } — recompensa modesta do modo solo (vs Pedro)
router.post('/practice/finish', authMiddleware, async (req, res) => {
  const db = getDB();
  await ensurePlayer(req.user.id);
  const reward = req.body.won ? 40 : 15;
  await db.prepare('UPDATE trunfo_players SET coins=coins+$1, updated_at=NOW() WHERE user_id=$2').run(reward, req.user.id);
  const updated = await db.prepare('SELECT coins, fragments FROM trunfo_players WHERE user_id=$1').get(req.user.id);
  res.json({ reward, coins: updated.coins, fragments: updated.fragments });
});

module.exports = { router, initTrunfoDB, ensurePlayer };
