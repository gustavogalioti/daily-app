// ═══════════════════════════════════════
// DAILY TRUNFO — Multiplayer WebSocket
// ═══════════════════════════════════════
const { getDB } = require('./database');
const { ensurePlayer } = require('./trunfo');

const TURN_DURATION_MS = 5000;
const REVEAL_PAUSE_MS = 3000;

const rooms = new Map();   // code -> room state
const clients = new Map(); // userId -> ws

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function sendTo(userId, msg) {
  const ws = clients.get(userId);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function bestAttrOf(card) {
  const keys = Object.keys(card.stats);
  let best = keys[0];
  keys.forEach(k => { if (card.stats[k] > card.stats[best]) best = k; });
  return best;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function lobbyPayload(room) {
  return {
    type: 'lobby',
    code: room.code,
    collection: room.collection,
    maxPlayers: room.maxPlayers,
    hostId: room.hostId,
    players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar })),
  };
}

function broadcastLobby(room) {
  room.players.forEach(p => sendTo(p.id, lobbyPayload(room)));
}

function stateForPlayer(room, userId) {
  const you = room.players.find(p => p.id === userId);
  const base = {
    type: 'state',
    code: room.code,
    collection: room.collection,
    phase: room.phase,
    leaderId: room.players[room.leaderIndex]?.id,
    turnStartedAt: room.turnStartedAt || null,
    turnDurationMs: TURN_DURATION_MS,
    players: room.players.map(p => ({ id: p.id, name: p.name, avatar: p.avatar, handCount: p.hand.length })),
    yourCard: you ? (you.hand[0] || null) : null,
    reveal: room.lastReveal || null,
    eliminated: room.eliminatedOrder || [],
  };
  return base;
}

function broadcastState(room) {
  room.players.forEach(p => sendTo(p.id, stateForPlayer(room, p.id)));
}

async function loadDeckCards(userId, collection) {
  const db = getDB();
  const deck = await db.prepare('SELECT card_ids FROM trunfo_decks WHERE user_id=$1 AND collection=$2').get(userId, collection);
  const cardIds = deck?.card_ids || [];
  if (!cardIds.length) return [];
  const cards = await db.prepare(
    `SELECT id, name, rarity, stats, image_url FROM trunfo_cards WHERE id = ANY($1::text[])`
  ).all(cardIds);
  return shuffle(cards);
}

async function startGame(room) {
  for (const p of room.players) {
    const hand = await loadDeckCards(p.id, room.collection);
    if (!hand.length) {
      room.players.forEach(pl => sendTo(pl.id, { type: 'error', msg: `${p.name} ainda não tem um deck montado para essa coleção.` }));
      return;
    }
    p.hand = hand;
  }
  room.phase = 'choosing';
  room.leaderIndex = 0;
  room.pot = [];
  room.eliminatedOrder = [];
  room.lastReveal = null;
  room.players.forEach(p => sendTo(p.id, { type: 'game_started', code: room.code }));
  startLeaderTurn(room);
}

function startLeaderTurn(room) {
  clearTimeout(room.timeoutHandle);
  room.turnStartedAt = Date.now();
  const leader = room.players[room.leaderIndex];
  room.timeoutHandle = setTimeout(() => {
    if (!room.players.includes(leader)) return; // segurança se algo mudou
    const attr = bestAttrOf(leader.hand[0]);
    resolveChoice(room, attr, true);
  }, TURN_DURATION_MS);
  broadcastState(room);
}

function resolveChoice(room, attr, wasAuto) {
  if (room.phase !== 'choosing') return;
  clearTimeout(room.timeoutHandle);
  room.phase = 'revealed';

  const values = room.players.map(p => ({ p, val: p.hand[0].stats[attr], card: p.hand[0] }));
  const maxVal = Math.max(...values.map(v => v.val));
  const winners = values.filter(v => v.val === maxVal);
  const tie = winners.length > 1;

  room.lastReveal = {
    attr,
    wasAuto,
    tie,
    results: values.map(v => ({ playerId: v.p.id, name: v.p.name, cardName: v.card.name, rarity: v.card.rarity, image_url: v.card.image_url, value: v.val })),
    winnerId: tie ? null : winners[0].p.id,
  };
  room.pendingWinners = winners;
  room.pendingTie = tie;

  broadcastState(room);
  setTimeout(() => advanceRound(room), REVEAL_PAUSE_MS);
}

async function advanceRound(room) {
  if (room.phase !== 'revealed') return;
  const roundCards = room.players.map(p => p.hand.shift());

  if (room.pendingTie) {
    room.pot.push(...roundCards);
  } else {
    const winner = room.pendingWinners[0].p;
    winner.hand.push(...room.pot, ...roundCards);
    room.pot = [];
    room.leaderIndex = room.players.indexOf(winner);
  }

  const leaderRef = room.players[room.leaderIndex];
  const stillIn = [];
  for (const p of room.players) {
    if (p.hand.length > 0) stillIn.push(p);
    else room.eliminatedOrder.push({ id: p.id, name: p.name });
  }
  room.players = stillIn;

  if (room.players.length <= 1) {
    await endGame(room);
    return;
  }

  const newIdx = room.players.indexOf(leaderRef);
  room.leaderIndex = newIdx >= 0 ? newIdx : 0;
  room.phase = 'choosing';
  room.lastReveal = null;
  startLeaderTurn(room);
}

async function endGame(room) {
  room.phase = 'ended';
  const winner = room.players[0];
  const ranking = [winner, ...[...room.eliminatedOrder].reverse()];

  try {
    const db = getDB();
    if (winner) {
      await ensurePlayer(winner.id);
      await db.prepare('UPDATE trunfo_players SET coins=coins+150, updated_at=NOW() WHERE user_id=$1').run(winner.id);
    }
    for (const el of room.eliminatedOrder) {
      await ensurePlayer(el.id);
      await db.prepare('UPDATE trunfo_players SET coins=coins+30, updated_at=NOW() WHERE user_id=$1').run(el.id);
    }
  } catch(e) { console.error('trunfo endGame reward erro:', e.message); }

  const payload = {
    type: 'gameover',
    code: room.code,
    winnerId: winner?.id || null,
    ranking: ranking.map((p, i) => ({ id: p.id, name: p.name, position: i + 1 })),
  };
  [...room.players, ...room.eliminatedOrder].forEach(p => sendTo(p.id, payload));
  rooms.delete(room.code);
}

function handleMessage(userId, userMeta, msg) {
  if (msg.type === 'create_room') {
    let code;
    do { code = genCode(); } while (rooms.has(code));
    const room = {
      code,
      collection: msg.collection,
      maxPlayers: Math.min(Math.max(msg.maxPlayers || 5, 2), 5),
      hostId: userId,
      players: [{ id: userId, name: userMeta.name, avatar: userMeta.avatar, hand: [] }],
      phase: 'lobby',
      leaderIndex: 0,
      pot: [],
      eliminatedOrder: [],
      lastReveal: null,
      timeoutHandle: null,
    };
    rooms.set(code, room);
    sendTo(userId, { type: 'room_created', code });
    broadcastLobby(room);
    return;
  }

  if (msg.type === 'join_room') {
    const room = rooms.get(msg.code);
    if (!room) { sendTo(userId, { type: 'error', msg: 'Sala não encontrada' }); return; }
    if (room.phase !== 'lobby') { sendTo(userId, { type: 'error', msg: 'Partida já começou' }); return; }
    if (room.players.length >= room.maxPlayers) { sendTo(userId, { type: 'error', msg: 'Sala cheia' }); return; }
    if (!room.players.some(p => p.id === userId)) {
      room.players.push({ id: userId, name: userMeta.name, avatar: userMeta.avatar, hand: [] });
    }
    broadcastLobby(room);
    return;
  }

  if (msg.type === 'start_game') {
    const room = rooms.get(msg.code);
    if (!room) return;
    if (room.hostId !== userId) { sendTo(userId, { type: 'error', msg: 'Só o dono da sala pode iniciar' }); return; }
    if (room.players.length < 2) { sendTo(userId, { type: 'error', msg: 'Precisa de pelo menos 2 jogadores' }); return; }
    startGame(room);
    return;
  }

  if (msg.type === 'choose_attr') {
    const room = rooms.get(msg.code);
    if (!room || room.phase !== 'choosing') return;
    const leader = room.players[room.leaderIndex];
    if (!leader || leader.id !== userId) return;
    resolveChoice(room, msg.attr, false);
    return;
  }

  if (msg.type === 'leave_room') {
    const room = rooms.get(msg.code);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== userId);
    if (room.players.length === 0) { clearTimeout(room.timeoutHandle); rooms.delete(room.code); }
    else broadcastLobby(room);
    return;
  }
}

function setupTrunfoWS(wss) {
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const userId = url.searchParams.get('userId');
    const name = url.searchParams.get('name') || 'Jogador';
    const avatar = url.searchParams.get('avatar') || '';
    if (!userId) { ws.close(); return; }

    clients.set(userId, ws);

    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        handleMessage(userId, { name, avatar }, msg);
      } catch(e) {}
    });

    ws.on('close', () => {
      clients.delete(userId);
    });
  });
}

module.exports = { setupTrunfoWS };
