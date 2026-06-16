// ─── PAINT WARS COOP — WebSocket Server ──────────────────────────────────────
// Nível 1: Presença multiplayer
// WSS compartilhado com Truco — filtra por ws._path === '/ws/coop'

const MAX_PLAYERS_PER_ROOM = 10;
const rooms = new Map(); // roomId → Map<playerId, playerData>

function getAvailableRoom() {
  for (const [roomId, players] of rooms) {
    if (players.size < MAX_PLAYERS_PER_ROOM) return roomId;
  }
  const newId = 'room_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
  rooms.set(newId, new Map());
  return newId;
}

function broadcastToRoom(roomId, data, excludeId = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const msg = JSON.stringify(data);
  for (const [pid, pdata] of room) {
    if (pid === excludeId) continue;
    if (pdata.ws && pdata.ws.readyState === 1) pdata.ws.send(msg);
  }
}

function getRoomPlayers(roomId, excludeId) {
  const room = rooms.get(roomId);
  if (!room) return [];
  return Array.from(room.values())
    .filter(p => p.id !== excludeId)
    .map(p => ({ id: p.id, username: p.username, color: p.color,
                 x: p.x, y: p.y, z: p.z, yaw: p.yaw }));
}

function setupCoopWS(wss) {
  wss.on('connection', (ws, req) => {
    // Só processa conexões do path /ws/coop
    if (ws._path !== '/ws/coop') return;

    let playerId = null;
    let roomId   = null;

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }

      switch (msg.type) {

        case 'join': {
          playerId = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
          roomId   = getAvailableRoom();
          const room = rooms.get(roomId);

          const player = {
            id: playerId, ws,
            username: (msg.username || 'Jogador').slice(0, 20),
            color:    msg.color || '#ff6b35',
            x: 0, y: 1.7, z: 30, yaw: 0,
          };
          room.set(playerId, player);

          ws.send(JSON.stringify({
            type: 'joined',
            playerId, roomId,
            roomCount: room.size,
            players: getRoomPlayers(roomId, playerId),
          }));

          broadcastToRoom(roomId, {
            type: 'player_joined',
            player: { id: playerId, username: player.username, color: player.color,
                      x: player.x, y: player.y, z: player.z, yaw: 0 },
            roomCount: room.size,
          }, playerId);

          console.log(`[Coop] ${player.username} → ${roomId} (${room.size}/${MAX_PLAYERS_PER_ROOM})`);
          break;
        }

        case 'move': {
          if (!playerId || !roomId) break;
          const room = rooms.get(roomId);
          if (!room) break;
          const player = room.get(playerId);
          if (!player) break;
          player.x   = msg.x   ?? player.x;
          player.y   = msg.y   ?? player.y;
          player.z   = msg.z   ?? player.z;
          player.yaw = msg.yaw ?? player.yaw;
          broadcastToRoom(roomId, {
            type: 'player_moved',
            id: playerId,
            x: player.x, y: player.y, z: player.z, yaw: player.yaw,
          }, playerId);
          break;
        }

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    });

    ws.on('close', () => {
      if (!playerId || !roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;
      const player = room.get(playerId);
      room.delete(playerId);
      broadcastToRoom(roomId, { type: 'player_left', id: playerId, roomCount: room.size });
      console.log(`[Coop] ${player?.username || playerId} saiu de ${roomId} (${room.size}/${MAX_PLAYERS_PER_ROOM})`);
      if (room.size === 0) { rooms.delete(roomId); console.log(`[Coop] Sala ${roomId} removida`); }
    });

    ws.on('error', (e) => console.warn('[Coop] WS erro:', e.message));
  });
}

module.exports = { setupCoopWS };
