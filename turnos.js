/**
 * turnos.js — Sistema de Turnos do Daily
 * Pedro como membro ativo da rede social
 */
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware, optionalAuth } = require('./authmiddleware');

const router = express.Router();

// ─── Definição dos Turnos (config-driven, extensível) ────────────────────────
const TURNOS = [
  {
    id: 'madrugadores',
    emoji: '🌅',
    nome: 'Turma das 5AM',
    hora_inicio: 5,
    hora_fim: 6,
    conquista_id: 'antes_do_sol',
    badge: '🌅',
    mensagem_pedro: (username, count) =>
      `Bom dia, @${username}! Caiu da cama? 😼\n\nA Turma das 5AM já está reunida — ${count > 0 ? `${count} ${count===1?'pessoa já chegou':'pessoas já chegaram'}` : 'você pode ser o primeiro!'}.\n\nPoste uma foto no Global e entre para a turma. Poste até às 6h para desbloquear a conquista "Antes do Sol" 🏆`,
    descricao: 'Para os madrugadores que começam o dia antes do sol',
  },
  {
    id: 'manha',
    emoji: '☕',
    nome: 'Começando o Dia',
    hora_inicio: 7,
    hora_fim: 9,
    conquista_id: null,
    badge: '☕',
    mensagem_pedro: (username, count) =>
      `Bom dia, @${username}! ☕\n\nA Turma das 5AM já começou faz tempo 👀\n\nMas e você? Como está começando sua manhã? ${count > 0 ? `${count} ${count===1?'pessoa já compartilhou':'pessoas já compartilharam'} o começo do dia.` : ''}\n\nPoste uma foto no Global e entre para a turma de hoje.`,
    descricao: 'A turma da manhã que começa o dia compartilhando',
  },
  {
    id: 'almoco',
    emoji: '🍽️',
    nome: 'Hora do Almoço',
    hora_inicio: 11,
    hora_fim: 14,
    conquista_id: null,
    badge: '🍽️',
    mensagem_pedro: (username, count) =>
      `@${username}, pausa estratégica? 😼\n\n${count > 0 ? `${count} ${count===1?'pessoa já mostrou':'pessoas já mostraram'} o almoço no Global.` : 'Mostre para o Global o que está rolando no seu almoço.'}\n\nVale comida, trabalho, estudos ou qualquer momento do seu dia.`,
    descricao: 'A pausa do almoço compartilhada com a comunidade',
  },
  {
    id: 'tarde',
    emoji: '🌇',
    nome: 'Fim de Tarde',
    hora_inicio: 17,
    hora_fim: 19,
    conquista_id: null,
    badge: '🌇',
    mensagem_pedro: (username, count) =>
      `Sobreviveu ao dia? 😼\n\n@${username}, mostre para o Global como foi sua tarde. ${count > 0 ? `${count} ${count===1?'pessoa já postou':'pessoas já postaram'}.` : ''}\n\nQuero ver o que aconteceu até aqui.`,
    descricao: 'A turma que encerra o dia no Daily',
  },
  {
    id: 'corujas',
    emoji: '🌙',
    nome: 'Corujas',
    hora_inicio: 22,
    hora_fim: 1,
    conquista_id: null,
    badge: '🌙',
    mensagem_pedro: (username, count) =>
      `Ainda acordado, @${username}? 👀\n\nA turma das Corujas está reunida. ${count > 0 ? `${count} ${count===1?'coruja já apareceu':'corujas já apareceram'}.` : ''}\n\nPoste uma foto mostrando como está terminando seu dia.`,
    descricao: 'Os notívagos que habitam o Daily depois das 22h',
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getTurnoAtivo() {
  const now = new Date();
  // Usar horário de Brasília (UTC-3)
  const hora = (now.getUTCHours() - 3 + 24) % 24;
  for (const t of TURNOS) {
    if (t.hora_fim > t.hora_inicio) {
      if (hora >= t.hora_inicio && hora < t.hora_fim) return t;
    } else {
      // turno que cruza meia-noite (corujas: 22-01)
      if (hora >= t.hora_inicio || hora < t.hora_fim) return t;
    }
  }
  return null;
}

function getTurnoByHora(hora) {
  for (const t of TURNOS) {
    if (t.hora_fim > t.hora_inicio) {
      if (hora >= t.hora_inicio && hora < t.hora_fim) return t;
    } else {
      if (hora >= t.hora_inicio || hora < t.hora_fim) return t;
    }
  }
  return null;
}

function hojeStr() {
  const d = new Date();
  // Brasília UTC-3
  d.setHours(d.getUTCHours() - 3);
  return d.toISOString().slice(0, 10);
}

// ─── Inicialização das tabelas ────────────────────────────────────────────────
async function initTurnosDB() {
  const db = getDB();
  // Participações nos turnos
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS turno_participacoes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      turno_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      data DATE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, turno_id, data)
    )`).run();
  } catch(e) {}

  // Analytics de visualizações do card do Pedro
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS turno_analytics (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      turno_id TEXT NOT NULL,
      evento TEXT NOT NULL,
      data DATE NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`).run();
  } catch(e) {}

  // Streaks de participação
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS turno_streaks (
      user_id TEXT PRIMARY KEY,
      streak_atual INTEGER DEFAULT 0,
      streak_max INTEGER DEFAULT 0,
      ultima_participacao DATE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`).run();
  } catch(e) {}

  // Posts sintéticos do Pedro nos turnos (resumo diário)
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS pedro_turno_posts (
      id TEXT PRIMARY KEY,
      turno_id TEXT,
      tipo TEXT NOT NULL,
      conteudo TEXT NOT NULL,
      data DATE NOT NULL,
      visualizacoes INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`).run();
  } catch(e) {}
}

// ─── Rotas ───────────────────────────────────────────────────────────────────

// GET /api/turnos/ativo — turno atual + card do Pedro personalizado
router.get('/ativo', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const turno = getTurnoAtivo();
    if (!turno) return res.json({ turno: null, card: null });

    const hoje = hojeStr();
    // Contar participantes do turno hoje
    const countRow = await db.prepare(
      'SELECT COUNT(*) as c FROM turno_participacoes WHERE turno_id=$1 AND data=$2'
    ).get(turno.id, hoje);
    const count = parseInt(countRow?.c || 0);

    // Verificar se usuário já participou
    let jaParticipou = false;
    if (req.user?.id) {
      const p = await db.prepare(
        'SELECT id FROM turno_participacoes WHERE user_id=$1 AND turno_id=$2 AND data=$3'
      ).get(req.user.id, turno.id, hoje);
      jaParticipou = !!p;

      // Registrar visualização
      await db.prepare(
        'INSERT INTO turno_analytics (id,user_id,turno_id,evento,data) VALUES ($1,$2,$3,$4,$5)'
      ).run(uuidv4(), req.user.id, turno.id, 'visualizou', hoje).catch(() => {});
    }

    const username = req.user?.username || 'você';
    const mensagem = turno.mensagem_pedro(username, count);

    // Hora atual em Brasília para calcular minutos restantes
    const agora = new Date();
    const horaAtual = (agora.getUTCHours() - 3 + 24) % 24;
    const minAtual = agora.getUTCMinutes();
    let minutosRestantes = null;
    if (turno.hora_fim > turno.hora_inicio) {
      minutosRestantes = (turno.hora_fim - horaAtual - 1) * 60 + (60 - minAtual);
    } else if (horaAtual >= turno.hora_inicio) {
      minutosRestantes = (24 - horaAtual + turno.hora_fim - 1) * 60 + (60 - minAtual);
    } else {
      minutosRestantes = (turno.hora_fim - horaAtual - 1) * 60 + (60 - minAtual);
    }

    res.json({
      turno: {
        ...turno,
        participantes_hoje: count,
        ja_participou: jaParticipou,
        minutos_restantes: Math.max(0, minutosRestantes),
      },
      card: {
        mensagem,
        count,
        ja_participou: jaParticipou,
      }
    });
  } catch(e) {
    console.error('turnos/ativo:', e);
    res.json({ turno: null, card: null });
  }
});

// POST /api/turnos/participar — registrar participação após post
router.post('/participar', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { post_id } = req.body;
    if (!post_id) return res.status(400).json({ error: 'post_id obrigatório' });

    const turno = getTurnoAtivo();
    if (!turno) return res.json({ ok: false, msg: 'Nenhum turno ativo agora' });

    const hoje = hojeStr();
    const uid = req.user.id;

    // Inserir participação (ignora duplicata)
    try {
      await db.prepare(
        'INSERT INTO turno_participacoes (id,user_id,turno_id,post_id,data) VALUES ($1,$2,$3,$4,$5)'
      ).run(uuidv4(), uid, turno.id, post_id, hoje);
    } catch(e) {
      // UNIQUE constraint: já participou hoje
      return res.json({ ok: true, ja_era: true, turno });
    }

    // Atualizar streak
    await _updateStreak(db, uid, hoje);

    // Registrar analytics
    await db.prepare(
      'INSERT INTO turno_analytics (id,user_id,turno_id,evento,data) VALUES ($1,$2,$3,$4,$5)'
    ).run(uuidv4(), uid, turno.id, 'postou', hoje).catch(() => {});

    // Contar participantes após a nova entrada
    const countRow = await db.prepare(
      'SELECT COUNT(*) as c FROM turno_participacoes WHERE turno_id=$1 AND data=$2'
    ).get(turno.id, hoje);
    const posicao = parseInt(countRow?.c || 1);

    res.json({
      ok: true,
      turno,
      posicao,
      badge: turno.badge,
      mensagem_confirmacao: `Você é o participante nº ${posicao} da ${turno.nome} hoje! ${turno.emoji}`,
    });
  } catch(e) {
    console.error('turnos/participar:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/turnos/resumo-hoje — resumo do dia atual
router.get('/resumo-hoje', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const hoje = hojeStr();
    const resumo = [];
    for (const t of TURNOS) {
      const row = await db.prepare(
        'SELECT COUNT(*) as c FROM turno_participacoes WHERE turno_id=$1 AND data=$2'
      ).get(t.id, hoje);
      resumo.push({ ...t, count: parseInt(row?.c || 0) });
    }
    const total = resumo.reduce((s, t) => s + t.count, 0);
    res.json({ resumo, total, data: hoje });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/turnos/minha-participacao — histórico do usuário
router.get('/minha-participacao', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const uid = req.user.id;
    const hoje = hojeStr();

    const participacoes = await db.prepare(
      'SELECT turno_id, data FROM turno_participacoes WHERE user_id=$1 ORDER BY data DESC LIMIT 30'
    ).all(uid);

    const streak = await db.prepare(
      'SELECT streak_atual, streak_max, ultima_participacao FROM turno_streaks WHERE user_id=$1'
    ).get(uid);

    const turnosHoje = participacoes.filter(p => p.data === hoje).map(p => p.turno_id);

    res.json({
      participacoes,
      streak_atual: streak?.streak_atual || 0,
      streak_max: streak?.streak_max || 0,
      turnos_hoje: turnosHoje,
    });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/turnos/analytics — registrar clique no card
router.post('/analytics', optionalAuth, async (req, res) => {
  try {
    const db = getDB();
    const { turno_id, evento } = req.body;
    if (!turno_id || !evento) return res.json({ ok: true });
    await db.prepare(
      'INSERT INTO turno_analytics (id,user_id,turno_id,evento,data) VALUES ($1,$2,$3,$4,$5)'
    ).run(uuidv4(), req.user?.id || null, turno_id, evento, hojeStr()).catch(() => {});
    res.json({ ok: true });
  } catch(e) {
    res.json({ ok: true });
  }
});

// GET /api/turnos/lista — todos os turnos (para UI)
router.get('/lista', (req, res) => {
  res.json({ turnos: TURNOS });
});

// ─── Helper interno: atualizar streak ────────────────────────────────────────
async function _updateStreak(db, userId, hoje) {
  try {
    const st = await db.prepare(
      'SELECT streak_atual, streak_max, ultima_participacao FROM turno_streaks WHERE user_id=$1'
    ).get(userId);

    if (!st) {
      await db.prepare(
        'INSERT INTO turno_streaks (user_id,streak_atual,streak_max,ultima_participacao) VALUES ($1,1,1,$2)'
      ).run(userId, hoje);
      return;
    }

    const ontem = new Date(hoje);
    ontem.setDate(ontem.getDate() - 1);
    const ontemStr = ontem.toISOString().slice(0, 10);

    let novoStreak = 1;
    if (st.ultima_participacao === ontemStr) {
      novoStreak = (st.streak_atual || 0) + 1;
    } else if (st.ultima_participacao === hoje) {
      return; // Já atualizou hoje
    }

    const novoMax = Math.max(novoStreak, st.streak_max || 0);
    await db.prepare(
      'UPDATE turno_streaks SET streak_atual=$1, streak_max=$2, ultima_participacao=$3, updated_at=NOW() WHERE user_id=$4'
    ).run(novoStreak, novoMax, hoje, userId);
  } catch(e) {
    console.error('_updateStreak:', e);
  }
}

// ─── Resumo diário automático (chamado pelo news_scheduler ou cron) ───────────
async function gerarResumoDiario() {
  try {
    const db = getDB();
    const hoje = hojeStr();

    const resumo = [];
    let total = 0;
    for (const t of TURNOS) {
      const row = await db.prepare(
        'SELECT COUNT(*) as c FROM turno_participacoes WHERE turno_id=$1 AND data=$2'
      ).get(t.id, hoje);
      const count = parseInt(row?.c || 0);
      resumo.push({ ...t, count });
      total += count;
    }

    if (total === 0) return;

    const linhas = resumo.filter(t => t.count > 0)
      .map(t => `${t.emoji} ${t.count} ${t.count === 1 ? 'pessoa' : 'pessoas'} na ${t.nome}`);

    const conteudo = `Resumo do dia no Daily 😼\n\nHoje tivemos:\n\n${linhas.join('\n')}\n\nObrigado por mais um dia no Daily! 🧡\n\nTotal: ${total} participações.`;

    // Salvar como post sintético
    const existente = await db.prepare(
      'SELECT id FROM pedro_turno_posts WHERE tipo=$1 AND data=$2'
    ).get('resumo_diario', hoje);

    if (!existente) {
      await db.prepare(
        'INSERT INTO pedro_turno_posts (id,turno_id,tipo,conteudo,data) VALUES ($1,$2,$3,$4,$5)'
      ).run(uuidv4(), null, 'resumo_diario', conteudo, hoje);
    }

    return { conteudo, total };
  } catch(e) {
    console.error('gerarResumoDiario:', e);
  }
}

// Tabelas inicializadas pelo server.js após initDB()

module.exports = router;
module.exports.getTurnoAtivo = getTurnoAtivo;
module.exports.gerarResumoDiario = gerarResumoDiario;
module.exports.initTurnosDB = initTurnosDB;
module.exports.TURNOS = TURNOS;
