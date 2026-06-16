// ─── PAINT WARS COOP — WebSocket Server ──────────────────────────────────────
// WSS independente com noServer:true — sem conflito com Truco

const MAX_PER_ROOM = 10;
const rooms = new Map(); // roomId → Map<playerId, playerData>

function getOrCreateRoom() {
  for (const [id, room] of rooms) {
    if (room.size < MAX_PER_ROOM) return id;
  }
  const id = 'room_' + Date.now() + '_' + Math.random().toString(36).slice(2,6);
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

    ws.on('message', (raw) => {
      let msg; try { msg = JSON.parse(raw); } catch { return; }

      if (msg.type === 'join') {
        pid = 'p_' + Date.now() + '_' + Math.random().toString(36).slice(2,5);
        rid = getOrCreateRoom();
        const room = rooms.get(rid);
        const player = { id:pid, ws, username:(msg.username||'Jogador').slice(0,20), x:0, y:1.7, z:30, yaw:0 };
        room.set(pid, player);
        ws.send(JSON.stringify({ type:'joined', playerId:pid, roomId:rid, roomCount:room.size, players:roomPlayers(rid,pid) }));
        broadcast(rid, { type:'player_joined', player:{id:pid,username:player.username,x:0,y:1.7,z:30,yaw:0}, roomCount:room.size }, pid);
        console.log(`[Coop] ${player.username} → ${rid} (${room.size}/${MAX_PER_ROOM})`);
      }

      else if (msg.type === 'move' && pid && rid) {
        const room = rooms.get(rid);
        const p = room?.get(pid);
        if (!p) return;
        p.x = msg.x??p.x; p.y = msg.y??p.y; p.z = msg.z??p.z; p.yaw = msg.yaw??p.yaw;
        broadcast(rid, { type:'player_moved', id:pid, x:p.x, y:p.y, z:p.z, yaw:p.yaw }, pid);
      }

      else if (msg.type === 'ping') ws.send('{"type":"pong"}');
    });

    ws.on('close', () => {
      if (!pid || !rid) return;
      const room = rooms.get(rid);
      if (!room) return;
      const p = room.get(pid);
      room.delete(pid);
      broadcast(rid, { type:'player_left', id:pid, roomCount:room.size });
      console.log(`[Coop] ${p?.username||pid} saiu de ${rid} (${room.size}/${MAX_PER_ROOM})`);
      if (room.size === 0) { rooms.delete(rid); console.log(`[Coop] ${rid} removida`); }
    });

    ws.on('error', e => console.warn('[Coop]', e.message));
  });
  console.log('[Coop] pronto');
}

module.exports = { setupCoopWS };
