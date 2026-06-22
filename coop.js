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
  return [...room.players.values()].map(p => {
    const xpData = tdmXpRegistry.get(p.username) || { xp: 0 };
    return { id: p.id, username: p.username, team: p.team, xp: xpData.xp };
  });
}

// ─── TDM XP REGISTRY (Fase 5) ────────────────────────────────────────────────
// Registry em memória — persiste durante a sessão do servidor.
const tdmXpRegistry = new Map(); // username → { xp, kills, deaths, wins, losses }

function tdmGetXpData(username) {
  if (!tdmXpRegistry.has(username)) {
    tdmXpRegistry.set(username, { xp: 0, kills: 0, deaths: 0, wins: 0, losses: 0 });
  }
  return tdmXpRegistry.get(username);
}

// Espelha a tabela de thresholds do cliente para calcular level no servidor
const TDM_LEVEL_XP_SRV = [0,0,300,800,1600,2800,4500,6800,9800,13800,19000,26000,35000,47000,62000,80000,102000,128000,158000,193000,234000];
function tdmLevelFromXp(xp) {
  let level = 1;
  for (let i = TDM_LEVEL_XP_SRV.length - 1; i >= 1; i--) {
    if (xp >= TDM_LEVEL_XP_SRV[i]) { level = i; break; }
  }
  return Math.min(level, 50);
}

function tdmMatchXpEarned(kills, isWinner) {
  return (kills * 100) + (isWinner ? 300 : 50);
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
        // ── Rejoin (Fase 3 fix): se o player caiu durante countdown/jogo,
        //    tenta reconectar à MESMA sala em andamento usando roomId salvo.
        if (msg.roomId) {
          const existing = tdmRooms.get(msg.roomId);
          if (existing && existing.started && !existing.gameState?.finished) {
            tdmPid = 'tp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 5);
            tdmRid = msg.roomId;
            const team = msg.team || tdmAssignTeam(existing);
            const player = { id: tdmPid, ws, username: (msg.username || 'Jogador').slice(0, 20), team };
            existing.players.set(tdmPid, player);
            if (existing.gameState) {
              existing.gameState.playerHp[tdmPid] = { hp: 100, dead: false, team };
            }
            ws.send(JSON.stringify({
              type: 'tdm_rejoined',
              playerId: tdmPid, roomId: tdmRid, myTeam: team,
              roster: tdmRoster(existing),
              kills: existing.gameState?.kills || { blue: 0, red: 0 },
            }));
            console.log(`[WS-TDM] REJOIN: ${player.username} → ${tdmRid} (time ${team})`);
            return;
          }
        }
        // Join normal: nova entrada no lobby
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
          // Fase 3: inicializa estado da partida (HP de cada jogador, placar)
          troom.gameState = {
            kills: { blue: 0, red: 0 },
            WIN_KILLS: 30,
            finished: false,
            playerHp: {},
          };
          for (const p of troom.players.values()) {
            troom.gameState.playerHp[p.id] = { hp: 100, dead: false, team: p.team, kills: 0, deaths: 0 };
          }
          const countdown = 5;
          tdmBroadcast(troom, { type: 'tdm_match_starting', countdown, roster: tdmRoster(troom) });
          console.log(`[WS-TDM] ${tdmRid} iniciando partida (${troom.players.size} jogadores)`);
        }
        return;
      }

      // ── TDM POSITION SYNC (Fase 3) — relay isolado para todos da sala ─────────
      if (msg.type === 'tdm_position_sync' && tdmRid) {
        const troom = tdmRooms.get(tdmRid);
        if (!troom || !troom.started) return;
        const p = troom.players.get(tdmPid);
        if (!p) return;
        const out = JSON.stringify({
          type: 'tdm_position_sync', id: tdmPid,
          username: p.username, team: p.team,
          x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw,
        });
        for (const [pid, pl] of troom.players) {
          if (pid !== tdmPid && pl.ws.readyState === 1) pl.ws.send(out);
        }
        return;
      }

      // ── TDM HIT — processa dano, morte e respawn (Fase 3) ────────────────────
      if (msg.type === 'tdm_hit' && tdmRid) {
        const troom = tdmRooms.get(tdmRid);
        if (!troom || !troom.started || !troom.gameState || troom.gameState.finished) return;
        const gs = troom.gameState;
        const damage = Math.max(0, Math.min(100, Number(msg.damage) || 0));
        const targetHp = gs.playerHp[msg.targetId];
        const shooter = troom.players.get(tdmPid);
        const target  = troom.players.get(msg.targetId);
        if (!targetHp || targetHp.dead || !shooter || !target) return;
        if (shooter.team === target.team) return; // sem friendly fire
        targetHp.hp = Math.max(0, targetHp.hp - damage);
        if (targetHp.hp <= 0) {
          targetHp.dead = true; targetHp.hp = 0;
          // Fase 4: rastrear kills/deaths individuais
          targetHp.deaths = (targetHp.deaths || 0) + 1;
          const shooterHp = gs.playerHp[tdmPid];
          if (shooterHp) shooterHp.kills = (shooterHp.kills || 0) + 1;
          gs.kills[shooter.team]++;
          // Monta snapshot de scores individuais para o scoreboard do TAB
          const scores = {};
          for (const [id, ph] of Object.entries(gs.playerHp)) {
            scores[id] = { kills: ph.kills || 0, deaths: ph.deaths || 0 };
          }
          tdmBroadcast(troom, {
            type: 'tdm_player_died',
            deadId: msg.targetId, killerId: tdmPid,
            killerUsername: shooter.username, kills: gs.kills,
            scores, // Fase 4: scores individuais
          });
          if (gs.kills[shooter.team] >= gs.WIN_KILLS) {
            gs.finished = true;
            const winnerTeam = shooter.team;
            // Fase 5: calcular e distribuir XP para cada jogador
            for (const [pid2, pl2] of troom.players) {
              const hp2 = gs.playerHp[pid2];
              if (!hp2) continue;
              const isWinner = hp2.team === winnerTeam;
              const matchKills = hp2.kills || 0;
              const matchDeaths = hp2.deaths || 0;
              const xpEarned = tdmMatchXpEarned(matchKills, isWinner);
              const xpData = tdmGetXpData(pl2.username);
              const oldXp = xpData.xp;
              xpData.xp += xpEarned;
              xpData.kills += matchKills;
              xpData.deaths += matchDeaths;
              if (isWinner) xpData.wins++; else xpData.losses++;
              const oldLevel = tdmLevelFromXp(oldXp);
              const newLevel = tdmLevelFromXp(xpData.xp);
              if (pl2.ws.readyState === 1) {
                pl2.ws.send(JSON.stringify({
                  type: 'tdm_xp_earned',
                  xpEarned, totalXp: xpData.xp,
                  matchKills, matchDeaths,
                  isWinner, oldLevel, newLevel,
                  leveledUp: newLevel > oldLevel,
                }));
              }
            }
            tdmBroadcast(troom, { type: 'tdm_match_over', winner: winnerTeam, kills: gs.kills });
          } else {
            // Respawn automático após 3 s
            setTimeout(() => {
              if (!troom.players.has(msg.targetId)) return;
              targetHp.dead = false; targetHp.hp = 100;
              const pl = troom.players.get(msg.targetId);
              if (pl && pl.ws.readyState === 1)
                pl.ws.send(JSON.stringify({ type: 'tdm_respawn' }));
            }, 3000);
          }
        } else {
          if (target.ws.readyState === 1)
            target.ws.send(JSON.stringify({ type: 'tdm_took_damage', hp: targetHp.hp }));
        }
        return;
      }

      // ── TDM RANKING / XP QUERY (Fase 5) — isolado ──────────────────────────
      if (msg.type === 'tdm_get_ranking') {
        const sorted = [...tdmXpRegistry.entries()]
          .sort(([,a],[,b]) => b.xp - a.xp)
          .slice(0, 50)
          .map(([username, d], i) => ({
            rank: i + 1, username,
            xp: d.xp, level: tdmLevelFromXp(d.xp),
            kills: d.kills, deaths: d.deaths, wins: d.wins,
          }));
        ws.send(JSON.stringify({ type: 'tdm_ranking', ranking: sorted }));
        return;
      }

      if (msg.type === 'tdm_get_my_xp' && msg.username) {
        const d = tdmGetXpData(msg.username);
        ws.send(JSON.stringify({
          type: 'tdm_my_xp',
          xp: d.xp, level: tdmLevelFromXp(d.xp),
          kills: d.kills, deaths: d.deaths, wins: d.wins,
        }));
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
