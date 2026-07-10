// Teste standalone do dailydebate_ws.js — não depende do resto do daily-app
// (sem banco de dados, sem express). Sobe um WebSocketServer isolado igual
// ao que server.js vai fazer, e simula 3 jogadores jogando uma partida
// inteira via mensagens raw.

const http = require('http');
const { WebSocketServer } = require('ws');
const WebSocket = require('ws');
const assert = require('assert');
const { setupDailyDebateWS } = require('./dailydebate_ws');

const httpServer = http.createServer();
const wss = new WebSocketServer({ noServer: true });
setupDailyDebateWS(wss);
httpServer.on('upgrade', (req, socket, head) => {
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

// Tracker persistente: escuta TODAS as mensagens desde a conexão, guarda a
// última de cada tipo. Evita perder mensagens emitidas entre uma ação e o
// listener específico ser registrado depois.
class Tracker {
  constructor(ws) {
    this.latest = {};
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw);
      this.latest[msg.type] = msg;
    });
  }
}

function waitUntil(getCurrent, predicate, timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const current = getCurrent();
      if (predicate(current)) return resolve(current);
      if (Date.now() - start > timeoutMs) return reject(new Error('waitUntil timeout'));
      setTimeout(tick, 20);
    };
    tick();
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
}

async function main() {
  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;

  const names = ['Ana', 'Bruno', 'Carla'];
  const userIds = ['u-ana', 'u-bruno', 'u-carla'];
  const sockets = userIds.map((id, i) => new WebSocket(`ws://localhost:${port}?userId=${id}&name=${names[i]}`));
  const trackers = sockets.map((s) => new Tracker(s));

  await Promise.all(sockets.map((s) => new Promise((resolve) => s.on('open', resolve))));
  console.log('✅ 3 clients conectados');

  send(sockets[0], { type: 'create_room', name: 'Ana', prepDurationMs: 1000, presentationDurationMs: 300 });
  const created = await waitUntil(() => trackers[0].latest.room_created, (v) => !!v);
  const code = created.code;
  console.log(`✅ sala criada: ${code}`);

  for (let i = 1; i < sockets.length; i++) {
    send(sockets[i], { type: 'join_room', code });
  }
  await waitUntil(() => trackers[0].latest.lobby, (v) => v && v.players.length === 3);
  console.log('✅ Bruno e Carla entraram na sala');

  send(sockets[0], { type: 'start_match', code });

  for (let round = 1; round <= 3; round++) {
    const state = await waitUntil(
      () => trackers[0].latest.round_state,
      (v) => v && v.status === 'preparacao' && v.roundNumber === round
    );
    const presenterId = state.presenterId;
    console.log(`✅ rodada ${round}: apresentador=${presenterId}, tema="${state.challenge.themeText}"`);

    for (let i = 0; i < sockets.length; i++) {
      if (userIds[i] === presenterId) continue;
      send(sockets[i], { type: 'submit_opinion', code, text: `opinião ${names[i]}` });
    }

    await waitUntil(
      () => trackers[0].latest.round_state,
      (v) => v && v.status === 'votacao' && v.roundNumber === round
    );
    console.log(`✅ rodada ${round}: avançou automaticamente até votação`);

    for (let i = 0; i < sockets.length; i++) {
      if (userIds[i] === presenterId) continue;
      send(sockets[i], { type: 'submit_vote', code, score: 4 });
    }

    const resultMsg = await waitUntil(
      () => trackers[0].latest.round_result,
      (v) => v && v.result && v.result.averageScore !== undefined,
      8000
    );
    // limpa pra próxima rodada não confundir resultado velho com novo
    assert.strictEqual(resultMsg.result.averageScore, 4);
    console.log(`✅ rodada ${round}: resultado = ${resultMsg.result.averageScore}`);
    trackers[0].latest.round_result = null;

    if (round < 3) {
      send(sockets[0], { type: 'next_round', code });
    }
  }

  const matchEnded = await waitUntil(() => trackers[0].latest.match_ended, (v) => !!v);
  assert.strictEqual(matchEnded.scoreboard.length, 3);
  console.log('✅ match_ended recebido:', matchEnded.scoreboard.map((s) => `${s.name}=${s.total}`));

  sockets.forEach((s) => s.close());
  httpServer.close();
  console.log('✅ TESTE STANDALONE DO dailydebate_ws.js PASSOU');
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ FALHOU:', e);
  process.exit(1);
});
