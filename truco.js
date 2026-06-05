// ═══════════════════════════════════════
// TRUCO — Backend WebSocket + Lógica
// ═══════════════════════════════════════
const { getDB } = require('./database');
const { v4: uuidv4 } = require('uuid');

// ── BARALHO ──────────────────────────────
const NAIPE = ['♠','♥','♦','♣'];
const VALOR  = ['4','5','6','7','Q','J','K','A','2','3'];

// Força paulista: 3,2,A,K,J,Q,7♥,7♦,6,5,4 — depois manilha sobe
// Manilha: carta seguinte ao "vira"
// Ordem de naipes manilha: ♣ > ♥ > ♦ > ♠
const ORDEM_BASE = ['4','5','6','7','Q','J','K','A','2','3'];
const NAIPE_MANILHA_ORDEM = ['♠','♦','♥','♣']; // ♣ é maior

function novoBararalho() {
  const d = [];
  for (const n of NAIPE) for (const v of VALOR) d.push({ v, n });
  return d.sort(() => Math.random() - 0.5);
}

function calcForce(card, vira) {
  // Manilhas
  const idxVira = ORDEM_BASE.indexOf(vira.v);
  const manilhaVal = ORDEM_BASE[(idxVira + 1) % ORDEM_BASE.length];
  if (card.v === manilhaVal) {
    return 100 + NAIPE_MANILHA_ORDEM.indexOf(card.n); // 100-103
  }
  return ORDEM_BASE.indexOf(card.v); // 0-9
}

// ── ESTADO DAS PARTIDAS ──────────────────
const rooms   = new Map(); // roomId → GameState
const queue   = [];        // jogadores aguardando
const clients = new Map(); // userId → ws

function createGame(p1, p2) {
  const id   = uuidv4();
  const deck = novoBararalho();
  const vira = deck.pop();
  const state = {
    id, vira,
    players: [
      { id: p1.id, name: p1.name, avatar: p1.avatar, hand: deck.splice(0,3), score: 0, accepted: false },
      { id: p2.id, name: p2.name, avatar: p2.avatar, hand: deck.splice(0,3), score: 0, accepted: false },
    ],
    round: 1, // mão atual (1-12)
    ronda: 1, // rodada dentro da mão (1-3)
    table: [null, null], // cartas jogadas nesta rodada
    rondas: [], // [{winner:idx},...] resultados das rodadas
    truco: null, // null | {by:idx, value:3|6|9|12, answered:false}
    turn: 0, // índice do jogador da vez
    phase: 'playing', // playing|truco_pending|ended
    startedAt: Date.now(),
  };
  rooms.set(id, state);
  return state;
}

function sendTo(userId, msg) {
  const ws = clients.get(userId);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast(state, msg) {
  state.players.forEach(p => sendTo(p.id, msg));
}

function stateFor(state, playerIdx) {
  // Enviar estado sem as cartas do oponente
  const opp = 1 - playerIdx;
  return {
    type: 'state',
    gameId: state.id,
    vira: state.vira,
    me: {
      idx: playerIdx,
      ...state.players[playerIdx],
    },
    opponent: {
      idx: opp,
      id: state.players[opp].id,
      name: state.players[opp].name,
      avatar: state.players[opp].avatar,
      score: state.players[opp].score,
      cards: state.players[opp].hand.length, // só a quantidade
    },
    table: state.table,
    rondas: state.rondas,
    round: state.round,
    ronda: state.ronda,
    turn: state.turn,
    phase: state.phase,
    truco: state.truco,
  };
}

function pushState(state) {
  state.players.forEach((p, i) => sendTo(p.id, stateFor(state, i)));
}

function endRonda(state) {
  const [c0, c1] = state.table;
  let winner = -1; // -1 = empate
  if (c0 && c1) {
    const f0 = calcForce(c0, state.vira);
    const f1 = calcForce(c1, state.vira);
    if (f0 > f1) winner = 0;
    else if (f1 > f0) winner = 1;
  } else if (c0 && !c1) winner = 0;
  else if (c1 && !c0) winner = 1;

  state.rondas.push({ winner });
  state.table = [null, null];
  state.ronda++;

  // Verificar quem ganhou a mão
  const wins = [0, 0];
  for (const r of state.rondas) { if (r.winner >= 0) wins[r.winner]++; }
  const trucoVal = state.truco?.value || 1;

  let handWinner = -1;
  if (wins[0] >= 2) handWinner = 0;
  else if (wins[1] >= 2) handWinner = 1;
  else if (state.ronda > 3) {
    // 3 rodadas sem vencedor — empate ou primeira rodada decide
    const firstWin = state.rondas[0]?.winner;
    handWinner = firstWin >= 0 ? firstWin : 0;
  }

  if (handWinner >= 0) {
    state.players[handWinner].score += trucoVal;
    state.rondas = [];
    state.ronda  = 1;
    state.truco  = null;
    state.round++;

    // Verificar fim do jogo
    if (state.players[handWinner].score >= 12) {
      state.phase = 'ended';
      state.winner = handWinner;
      saveResult(state);
      broadcast(state, { type: 'gameover', winner: handWinner, scores: state.players.map(p=>({id:p.id,score:p.score})) });
      rooms.delete(state.id);
      return;
    }

    // Nova mão — redistribuir cartas
    const deck = novoBararalho();
    state.vira = deck.pop();
    state.players[0].hand = deck.splice(0,3);
    state.players[1].hand = deck.splice(0,3);
    state.table = [null,null];
    // Primeiro a jogar alterna
    state.turn = handWinner;
  } else {
    // Próxima rodada — quem ganhou a última joga primeiro
    const lastWin = state.rondas[state.rondas.length-1]?.winner;
    if (lastWin >= 0) state.turn = lastWin;
  }

  pushState(state);
}

async function saveResult(state) {
  try {
    const db = getDB();
    for (const p of state.players) {
      const existing = await db.prepare('SELECT best_score FROM truco_scores WHERE user_id=$1').get(p.id);
      if (!existing) {
        await db.prepare('INSERT INTO truco_scores(id,user_id,wins,losses,points) VALUES($1,$2,$3,$4,$5)')
          .run(uuidv4(), p.id, p.id===state.players[state.winner]?.id?1:0, p.id===state.players[state.winner]?.id?0:1, p.score);
      } else {
        const won = p.id === state.players[state.winner]?.id;
        await db.prepare('UPDATE truco_scores SET wins=wins+$1,losses=losses+$2,points=points+$3 WHERE user_id=$4')
          .run(won?1:0, won?0:1, p.score, p.id);
      }
    }
  } catch(e) { console.error('truco save:', e.message); }
}

// ── HANDLER DE MENSAGENS ─────────────────
function handleMessage(userId, msg, state) {
  const idx = state.players.findIndex(p => p.id === userId);
  if (idx < 0) return;

  if (msg.type === 'play_card') {
    if (state.phase !== 'playing') return;
    if (state.turn !== idx) { sendTo(userId, {type:'error',msg:'Não é sua vez'}); return; }
    const ci = state.players[idx].hand.findIndex(c => c.v===msg.card.v && c.n===msg.card.n);
    if (ci < 0) return;
    const [card] = state.players[idx].hand.splice(ci,1);
    state.table[idx] = card;
    // Se ambos jogaram, resolver rodada
    if (state.table[0] && state.table[1]) {
      pushState(state);
      setTimeout(() => endRonda(state), 800);
    } else {
      state.turn = 1 - idx;
      pushState(state);
    }
  }

  if (msg.type === 'truco') {
    if (state.phase !== 'playing') return;
    const vals = [3,6,9,12];
    const cur  = state.truco?.value || 1;
    const next = vals.find(v => v > cur);
    if (!next) return;
    state.phase = 'truco_pending';
    state.truco = { by: idx, value: next, answered: false };
    broadcast(state, { type:'truco_call', by:idx, value:next, name:state.players[idx].name });
    pushState(state);
  }

  if (msg.type === 'truco_accept') {
    if (state.phase !== 'truco_pending') return;
    if (state.truco.by === idx) return; // não pode aceitar próprio truco
    state.truco.answered = true;
    state.phase = 'playing';
    broadcast(state, { type:'truco_answer', accepted:true, value:state.truco.value });
    pushState(state);
  }

  if (msg.type === 'truco_reject') {
    if (state.phase !== 'truco_pending') return;
    if (state.truco.by === idx) return;
    const prev = state.truco.value === 3 ? 1 : state.truco.value === 6 ? 3 : state.truco.value === 9 ? 6 : 9;
    // Quem rejeitou perde os pontos desta mão
    const winner = state.truco.by;
    state.players[winner].score += prev;
    broadcast(state, { type:'truco_answer', accepted:false, value:prev });
    state.truco = null; state.phase = 'playing';
    state.rondas = []; state.ronda = 1;
    state.round++;
    if (state.players[winner].score >= 12) {
      state.phase = 'ended'; state.winner = winner;
      saveResult(state);
      broadcast(state, { type:'gameover', winner, scores: state.players.map(p=>({id:p.id,score:p.score})) });
      rooms.delete(state.id); return;
    }
    const deck = novoBararalho(); state.vira = deck.pop();
    state.players[0].hand = deck.splice(0,3); state.players[1].hand = deck.splice(0,3);
    state.table = [null,null]; state.turn = 1-idx;
    pushState(state);
  }

  if (msg.type === 'run') {
    // Correr (ir embora)
    const winner = 1 - idx;
    state.phase = 'ended'; state.winner = winner;
    saveResult(state);
    broadcast(state, { type:'gameover', winner, scores: state.players.map(p=>({id:p.id,score:p.score})), reason:'run' });
    rooms.delete(state.id);
  }

  if (msg.type === 'chat') {
    broadcast(state, { type:'chat', from:idx, name:state.players[idx].name, text:msg.text });
  }

  if (msg.type === 'reaction') {
    broadcast(state, { type:'reaction', from:idx, emoji:msg.emoji });
  }
}

function setupTrucoWS(wss) {
  wss.on('connection', (ws, req) => {
    // Autenticar via query param token
    const url  = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const userId = url.searchParams.get('userId');
    const userName = url.searchParams.get('name') || 'Jogador';
    const userAvatar = url.searchParams.get('avatar') || '';

    if (!userId) { ws.close(); return; }
    clients.set(userId, ws);

    // Verificar se usuário já estava em partida
    for (const [rid, state] of rooms) {
      if (state.players.some(p => p.id === userId)) {
        const idx = state.players.findIndex(p => p.id === userId);
        sendTo(userId, stateFor(state, idx));
        break;
      }
    }

    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'join_queue') {
          // Remover de filas anteriores
          const qi = queue.findIndex(q => q.id === userId);
          if (qi >= 0) queue.splice(qi, 1);
          queue.push({ id: userId, name: userName, avatar: userAvatar, ws });
          sendTo(userId, { type:'queued', position: queue.length });

          // Se 2 na fila, criar partida
          if (queue.length >= 2) {
            const p1 = queue.shift();
            const p2 = queue.shift();
            const state = createGame(p1, p2);
            sendTo(p1.id, { type:'matched', gameId: state.id });
            sendTo(p2.id, { type:'matched', gameId: state.id });
            setTimeout(() => pushState(state), 200);
          }
          return;
        }

        if (msg.type === 'leave_queue') {
          const qi = queue.findIndex(q => q.id === userId);
          if (qi >= 0) queue.splice(qi, 1);
          sendTo(userId, { type:'queue_left' });
          return;
        }

        // Ação de jogo
        const gameId = msg.gameId;
        if (!gameId) return;
        const state = rooms.get(gameId);
        if (!state) return;
        handleMessage(userId, msg, state);
      } catch(e) {}
    });

    ws.on('close', () => {
      clients.delete(userId);
      const qi = queue.findIndex(q => q.id === userId);
      if (qi >= 0) queue.splice(qi, 1);
    });
  });
}

module.exports = { setupTrucoWS };
