// ─── PAINT WARS — WebSocket Server ───────────────────────────────────────────
// Modo Livre: sala única ilimitada por modo
// Modo Coop: salas de até 10 jogadores
// Mensagens: join, move, paint, ping

const MAX_COOP = 10;
const rooms = new Map(); // roomId → Map<playerId, playerData>

// Modo Livre: sala única global (sem limite)
const FREE_ROOM = 'free_room_global';
rooms.set(FREE_ROOM, new Map());

// ─── TEAM DEATHMATCH — LOBBY (Fase 1) ────────────────────────────────────────
// Estrutura 100% isolada da estrutura `rooms` usada por Livre/Coop acima.
// Não compartilha Map, não reaproveita getCoopRoom/broadcast/roomPlayers.
const MAX_TDM = 10;          // 10 jogadores por sala (5x5)
const MIN_TDM_TO_START = 6;  // mínimo 6 (3x3) para liberar o início da partida
const tdmRooms = new Map();  // roomId → { players: Map<pid,{id,username,team,ws}>, started:boolean }

function getTdmRoom() {
  for (const [id, room] of tdmRooms) {
    if (!room.started && room.players.size < MAX_TDM) return id;
  }
  const id = 'tdm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  tdmRooms.set(id, { players: new Map(), started: false });
  return id;
}

function tdmAssignTeam(room) {
  let blue = 0, red = 0;
  for (const p of room.players.values()) { if (p.team === 'blue') blue++; else red++; }
  return blue <= red ? 'blue' : 'red';
}

function tdmRoster(room) {
  return [...room.players.values()].map(p => ({ id: p.id, username: p.username, team: p.team }));
}

function tdmBroadcast(room, data) {
  const msg = JSON.stringify(data);
  for (const p of room.players.values()) {
    if (p.ws.readyState === 1) p.ws.send(msg);
  }
}

function getCoopRoom() {
  for (const [id, room] of rooms) {
    if (id === FREE_ROOM) continue; // não usa sala livre para coop
    if (room.size < MAX_COOP) return id;
  }
  const id = 'coop_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
  rooms.set(id, new Map());
  return id;
}

function broadcast(roomId, data, excludeId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg = JSON.stringify(data);
  for (const [pid, p] of room) {
    if (pid !== excludeId && p.ws.readyState === 1) p.ws.send(msg);
  }
}

function roomPlayers(roomId, excludeId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return [...room.values()]
    .filter(p => p.id !== excludeId)
    .map(p => ({ id:p.id, username:p.username, x:p.x, y:p.y, z:p.z, yaw:p.yaw }));
}

function setupCoopWS(wss) {
  wss.on('connection', (ws) => {
    let pid = null, rid = null;
    let tdmPid = null, tdmRid = null; // estado isolado da sala TDM (Fase 1)

    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }

      // ── TDM JOIN (Fase 1) — isolado, retorna antes de tocar no fluxo abaixo ─
      if (msg.type === 'join' && msg.mode === 'tdm') {
        tdmPid = 'tp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
        tdmRid = getTdmRoom();
        const troom = tdmRooms.get(tdmRid);
        const team = tdmAssignTeam(troom);
        const player = { id: tdmPid, ws, username: (msg.username || 'Jogador').slice(0, 20), team };
        troom.players.set(tdmPid, player);
        ws.send(JSON.stringify({ type: 'tdm_joined', playerId: tdmPid, roomId: tdmRid, roster: tdmRoster(troom) }));
        tdmBroadcast(troom, { type: 'tdm_lobby_update', roster: tdmRoster(troom) });
        console.log(`[WS-TDM] ${player.username} → ${tdmRid} (time ${team}) [${troom.players.size}/${MAX_TDM}]`);
        return;
      }

      // ── TDM CHAT DO LOBBY (Fase 1) — isolado ────────────────────────────────
      if (msg.type === 'chat' && msg.scope === 'tdm_lobby' && tdmRid) {
        const troom = tdmRooms.get(tdmRid);
        if (troom) {
          const p = troom.players.get(tdmPid);
          const text = String(msg.text || '').slice(0, 140).trim();
          if (p && text) {
            tdmBroadcast(troom, { type: 'tdm_chat', id: tdmPid, username: p.username, team: p.team, text });
          }
        }
        return;
      }

      // ── TDM START REQUEST (Fase 2) — isolado ────────────────────────────────
      // Qualquer jogador da sala pode disparar, desde que tenha o mínimo (6).
      // Idempotente: se a sala já começou, ignora pedidos repetidos.
      if (msg.type === 'tdm_start_request' && tdmRid) {
        const troom = tdmRooms.get(tdmRid);
        if (troom && !troom.started && troom.players.size >= MIN_TDM_TO_START) {
          troom.started = true;
          const countdown = 5;
          tdmBroadcast(troom, { type: 'tdm_match_starting', countdown, roster: tdmRoster(troom) });
          console.log(`[WS-TDM] ${tdmRid} iniciando partida (${troom.players.size} jogadores)`);
        }
        return;
      }

      // ── JOIN (Modo Livre / Modo Coop) — código original, inalterado ────────
      if (msg.type === 'join') {
        pid = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2,5);
        // mode:'free' → sala global ilimitada; mode:'coop' → sala de até 10
        rid = msg.mode === 'free' ? FREE_ROOM : getCoopRoom();
        const room = rooms.get(rid);
        const player = {
          id: pid, ws,
          username: (msg.username || 'Jogador').slice(0, 20),
          x: 0, y: 1.7, z: 30, yaw: 0,
        };
        room.set(pid, player);
        const limit = rid === FREE_ROOM ? '∞' : MAX_COOP;
        ws.send(JSON.stringify({
          type: 'joined', playerId: pid, roomId: rid,
          roomCount: room.size, limit,
          players: roomPlayers(rid, pid),
        }));
        broadcast(rid, {
          type: 'player_joined',
          player: { id:pid, username:player.username, x:0, y:1.7, z:30, yaw:0 },
          roomCount: room.size, limit,
        }, pid);
        console.log(`[WS] ${player.username} → ${rid} (${room.size}/${limit})`);
      }

      // ── MOVE ──────────────────────────────────────────────────────────────
      else if (msg.type === 'move' && pid && rid) {
        const p = rooms.get(rid)?.get(pid);
        if (!p) return;
        p.x = msg.x??p.x; p.y = msg.y??p.y; p.z = msg.z??p.z; p.yaw = msg.yaw??p.yaw;
        broadcast(rid, { type:'player_moved', id:pid, x:p.x, y:p.y, z:p.z, yaw:p.yaw }, pid);
      }

      // ── PAINT — sincroniza pintura na parede ──────────────────────────────
      else if (msg.type === 'paint' && pid && rid) {
        // Apenas retransmite para os outros — validação mínima
        if (typeof msg.px === 'number' && typeof msg.py === 'number') {
          broadcast(rid, {
            type: 'paint', id: pid,
            px: msg.px, py: msg.py,
            size: msg.size || 8,
            color: msg.color || '#ff0000',
            tool: msg.tool || 'spray',
          }, pid);
        }
      }

      // ── PING ──────────────────────────────────────────────────────────────
      else if (msg.type === 'ping') ws.send('{"type":"pong"}');
    });

    ws.on('close', () => {
      // ── TDM CLEANUP (Fase 1) — isolado, não interfere no fluxo abaixo ──────
      if (tdmRid) {
        const troom = tdmRooms.get(tdmRid);
        if (troom) {
          const p = troom.players.get(tdmPid);
          troom.players.delete(tdmPid);
          if (troom.players.size === 0) {
            tdmRooms.delete(tdmRid);
            console.log(`[WS-TDM] ${tdmRid} removida`);
          } else if (!troom.started) {
            tdmBroadcast(troom, { type: 'tdm_lobby_update', roster: tdmRoster(troom) });
          }
          console.log(`[WS-TDM] ${p?.username || tdmPid} saiu do lobby (${troom.players.size}/${MAX_TDM})`);
        }
      }

      if (!pid || !rid) return;
      const room = rooms.get(rid);
      if (!room) return;
      const p = room.get(pid);
      room.delete(pid);
      // Nunca deletar a sala livre
      if (rid !== FREE_ROOM && room.size === 0) {
        rooms.delete(rid);
        console.log(`[WS] ${rid} removida`);
      }
      broadcast(rid, { type:'player_left', id:pid, roomCount:room.size });
      console.log(`[WS] ${p?.username||pid} saiu de ${rid} (${room.size})`);
    });

    ws.on('error', e => console.warn('[WS]', e.message));
  });
  console.log('[WS] Coop+Free pronto');
}

module.exports = { setupCoopWS };
