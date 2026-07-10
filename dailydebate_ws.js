// ═══════════════════════════════════════
// DAILY DEBATE — Multiplayer WebSocket
// ═══════════════════════════════════════
// Segue o mesmo padrão de trunfo_ws.js: ws puro, mensagens {type, ...},
// roteadas por userId (não por socket.io room). userId/name vêm da conta
// real do DAILY (query params na conexão, como no Trunfo).
//
// A lógica de regras do jogo (RoundEngine, drawChallenge) vem do pacote
// já testado em https://github.com/gustavogalioti/daily-debate — aqui só
// tem a "casca" de rede, adaptada pro protocolo ws deste app.

const { RoundEngine } = require('@daily-debate/game-engine');
const { drawChallenge } = require('@daily-debate/content');

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 10;

const rooms = new Map();   // code -> Room
const clients = new Map(); // userId -> ws

function genCode() {
  let code = '';
  for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

function sendTo(userId, msg) {
  const ws = clients.get(userId);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function sendError(userId, message, errorCode) {
  sendTo(userId, { type: 'error', message, errorCode: errorCode || 'ERROR' });
}

// ---------- Room: orquestra o lobby e as rodadas de UMA sala ----------

class Room {
  constructor(code, settings) {
    this.code = code;
    this.hostId = null;
    this.status = 'lobby'; // lobby | em_partida | finalizada
    this.isPublic = !!(settings && settings.isPublic);
    this.categoryIds = (settings && settings.categoryIds && settings.categoryIds.length > 0) ? settings.categoryIds : undefined;
    this.prepDurationMs = (settings && settings.prepDurationMs) || 60_000;
    this.presentationDurationMs = (settings && settings.presentationDurationMs) || 300_000;

    this.players = new Map(); // userId -> {id, name, connected}
    this.usedThemeIds = new Set();
    this.presenterOrder = [];
    this.presenterCursor = 0;

    this.roundNumber = 0;
    this.currentRound = null;
    this.roundAwaitingNext = false;
    this.scoreboard = new Map(); // userId -> [{roundNumber, averageScore}]
  }

  addPlayer(userId, name) {
    const existing = this.players.get(userId);
    if (existing) {
      existing.connected = true;
      existing.name = name || existing.name;
      return existing;
    }
    const player = { id: userId, name: name || 'Jogador', connected: true };
    this.players.set(userId, player);
    if (!this.hostId) this.hostId = userId;
    return player;
  }

  markDisconnected(userId) {
    const p = this.players.get(userId);
    if (p) p.connected = false;
  }

  getPlayers() {
    return Array.from(this.players.values());
  }

  isOpenForMatchmaking() {
    return this.isPublic && this.status === 'lobby' && this.players.size < MAX_PLAYERS;
  }

  canStartMatch() {
    return this.status === 'lobby' && this.players.size >= MIN_PLAYERS && this.players.size <= MAX_PLAYERS;
  }

  getLobbyState() {
    return {
      type: 'lobby',
      code: this.code,
      hostId: this.hostId,
      status: this.status,
      isPublic: this.isPublic,
      categoryIds: this.categoryIds || null,
      players: this.getPlayers().map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
    };
  }

  getPhaseDurations() {
    return { prepDurationMs: this.prepDurationMs, presentationDurationMs: this.presentationDurationMs };
  }

  startMatch(now) {
    if (!this.canStartMatch()) throw new Error('Sala não está pronta (mínimo 3 jogadores, status lobby)');
    this.status = 'em_partida';
    this.presenterOrder = shuffle(this.getPlayers().map((p) => p.id));
    this.presenterCursor = 0;
    this.startNextRound(now);
  }

  startNextRound(now) {
    if (this.presenterCursor >= this.presenterOrder.length) {
      this.presenterOrder = shuffle(this.getPlayers().map((p) => p.id));
      this.presenterCursor = 0;
    }
    const presenterId = this.presenterOrder[this.presenterCursor++];
    const challenge = drawChallenge(this.usedThemeIds, { categoryIds: this.categoryIds });

    this.roundNumber += 1;
    this.roundAwaitingNext = false;
    this.currentRound = new RoundEngine(
      {
        roundNumber: this.roundNumber,
        presenterId,
        players: this.getPlayers().map((p) => p.id),
        challenge,
        prepDurationMs: this.prepDurationMs,
        presentationDurationMs: this.presentationDurationMs,
      },
      now
    );
    // 'sorteio' é instantâneo no servidor — a pausa dramática fica por
    // conta do client, que já recebe o challenge completo.
    this.currentRound.startPreparation(now);
  }

  tick(now) {
    if (!this.currentRound) return false;
    const advanced = this.currentRound.checkTimeouts(now);
    if (advanced) {
      const anyView = this.currentRound.getPublicState(this.hostId || '');
      if (anyView.status === 'revelacao') this.currentRound.openVoting();
    }
    return advanced;
  }

  submitOpinion(userId, text, now) {
    if (!this.currentRound) throw new Error('Nenhuma rodada em andamento');
    this.currentRound.submitOpinion(userId, text, now);
  }

  submitVote(userId, score, now) {
    if (!this.currentRound) throw new Error('Nenhuma rodada em andamento');
    this.currentRound.submitVote(userId, score, now);

    if (this.currentRound.allVotesIn()) {
      const result = this.currentRound.finalizeRound();
      const presenterId = this.currentRound.getPublicState(userId).presenterId;
      const list = this.scoreboard.get(presenterId) || [];
      list.push({ roundNumber: this.roundNumber, averageScore: result.averageScore });
      this.scoreboard.set(presenterId, list);

      this.roundAwaitingNext = true;
      if (this.presenterCursor >= this.presenterOrder.length && this.roundNumber >= this.players.size) {
        this.status = 'finalizada';
      }
      return result;
    }
    return null;
  }

  getScoreboard() {
    return this.getPlayers()
      .map((p) => {
        const entries = this.scoreboard.get(p.id) || [];
        const total = entries.reduce((acc, e) => acc + e.averageScore, 0);
        return { playerId: p.id, name: p.name, rounds: entries, total: Math.round(total * 10) / 10 };
      })
      .sort((a, b) => b.total - a.total);
  }
}

function shuffle(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function findOpenPublicRoom() {
  let best = null;
  for (const room of rooms.values()) {
    if (!room.isOpenForMatchmaking()) continue;
    if (!best || room.getPlayers().length > best.getPlayers().length) best = room;
  }
  return best;
}

// ---------- broadcast helpers ----------

function broadcastLobby(room) {
  room.getPlayers().forEach((p) => sendTo(p.id, room.getLobbyState()));
}

function broadcastRoundState(room) {
  if (!room.currentRound) return;
  room.getPlayers().forEach((p) => {
    const state = room.currentRound.getPublicState(p.id);
    sendTo(p.id, Object.assign({ type: 'round_state' }, state, room.getPhaseDurations(), {
      roundAwaitingNext: room.roundAwaitingNext,
      roomStatus: room.status,
    }));
  });
}

// ---------- roteamento de mensagens ----------

function handleMessage(userId, userMeta, msg) {
  try {
    if (msg.type === 'create_room') {
      let code;
      do { code = genCode(); } while (rooms.has(code));
      const settings = {
        isPublic: !!msg.isPublic,
        categoryIds: msg.categoryIds,
        prepDurationMs: msg.prepDurationMs || (msg.fastMode ? 15_000 : undefined),
        presentationDurationMs: msg.presentationDurationMs || (msg.fastMode ? 15_000 : undefined),
      };
      const room = new Room(code, settings);
      room.addPlayer(userId, userMeta.name);
      rooms.set(code, room);
      sendTo(userId, { type: 'room_created', code, playerId: userId });
      broadcastLobby(room);
      return;
    }

    if (msg.type === 'join_room') {
      const room = rooms.get((msg.code || '').toUpperCase());
      if (!room) return sendError(userId, 'Sala não encontrada', 'ROOM_NOT_FOUND');
      if (room.status !== 'lobby') return sendError(userId, 'Partida já em andamento', 'ROOM_NOT_JOINABLE');
      if (room.players.size >= MAX_PLAYERS && !room.players.has(userId)) return sendError(userId, 'Sala cheia', 'ROOM_FULL');
      room.addPlayer(userId, userMeta.name);
      sendTo(userId, { type: 'room_joined', code: room.code, playerId: userId });
      broadcastLobby(room);
      return;
    }

    if (msg.type === 'quick_match') {
      let room = findOpenPublicRoom();
      let created = false;
      if (!room) {
        room = new Room(genCode(), { isPublic: true });
        rooms.set(room.code, room);
        created = true;
      }
      room.addPlayer(userId, userMeta.name);
      sendTo(userId, { type: 'room_joined', code: room.code, playerId: userId, created });
      broadcastLobby(room);
      return;
    }

    if (msg.type === 'start_match') {
      const room = rooms.get(msg.code);
      if (!room) return sendError(userId, 'Sala não encontrada', 'ROOM_NOT_FOUND');
      if (room.hostId !== userId) return sendError(userId, 'Só o host pode iniciar a partida', 'NOT_HOST');
      try {
        room.startMatch(Date.now());
      } catch (e) {
        return sendError(userId, e.message, 'CANNOT_START');
      }
      broadcastLobby(room);
      broadcastRoundState(room);
      return;
    }

    if (msg.type === 'submit_opinion') {
      const room = rooms.get(msg.code);
      if (!room) return sendError(userId, 'Sala não encontrada', 'ROOM_NOT_FOUND');
      try {
        room.submitOpinion(userId, msg.text || '', Date.now());
      } catch (e) {
        return sendError(userId, e.message, e.code || 'ERROR');
      }
      broadcastRoundState(room);
      return;
    }

    if (msg.type === 'submit_vote') {
      const room = rooms.get(msg.code);
      if (!room) return sendError(userId, 'Sala não encontrada', 'ROOM_NOT_FOUND');
      let result;
      try {
        result = room.submitVote(userId, msg.score, Date.now());
      } catch (e) {
        return sendError(userId, e.message, e.code || 'ERROR');
      }
      broadcastRoundState(room);
      if (result) {
        room.getPlayers().forEach((p) =>
          sendTo(p.id, { type: 'round_result', result, scoreboard: room.getScoreboard(), roomStatus: room.status })
        );
        if (room.status === 'finalizada') {
          room.getPlayers().forEach((p) => sendTo(p.id, { type: 'match_ended', scoreboard: room.getScoreboard() }));
        }
      }
      return;
    }

    if (msg.type === 'next_round') {
      const room = rooms.get(msg.code);
      if (!room) return sendError(userId, 'Sala não encontrada', 'ROOM_NOT_FOUND');
      if (room.hostId !== userId) return sendError(userId, 'Só o host avança a rodada', 'NOT_HOST');
      if (!room.roundAwaitingNext) return sendError(userId, 'Rodada atual ainda não terminou', 'ROUND_NOT_READY');
      if (room.status === 'finalizada') return sendError(userId, 'Partida já terminou', 'MATCH_ENDED');
      room.startNextRound(Date.now());
      broadcastRoundState(room);
      return;
    }

    if (msg.type === 'leave_room') {
      const room = rooms.get(msg.code);
      if (!room) return;
      room.markDisconnected(userId);
      broadcastLobby(room);
      return;
    }
  } catch (e) {
    console.error('[dailydebate_ws] erro ao processar mensagem:', e.message);
    sendError(userId, 'Erro interno', 'UNKNOWN_ERROR');
  }
}

// ---------- tick autoritativo (avança fases por timeout) ----------

let tickInterval = null;
function startTickLoop() {
  if (tickInterval) return;
  tickInterval = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if (room.tick(now)) broadcastRoundState(room);
    }
  }, 1000);
}

// ---------- setup ----------

function setupDailyDebateWS(wss) {
  startTickLoop();
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const userId = url.searchParams.get('userId');
    const name = url.searchParams.get('name') || 'Jogador';
    if (!userId) { ws.close(); return; }

    clients.set(userId, ws);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        handleMessage(userId, { name }, msg);
      } catch (e) { /* mensagem malformada, ignora */ }
    });

    ws.on('close', () => {
      if (clients.get(userId) === ws) clients.delete(userId);
      // avisa as salas onde esse jogador estava (sem torná-lo host órfão)
      for (const room of rooms.values()) {
        if (room.players.has(userId)) {
          room.markDisconnected(userId);
          broadcastLobby(room);
        }
      }
    });
  });
}

module.exports = { setupDailyDebateWS };
