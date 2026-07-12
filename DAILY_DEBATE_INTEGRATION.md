# Daily Debate — integração no DAILY (aba Jogos)

Jogo de improviso/argumentação multiplayer. Repositório de desenvolvimento
(com testes, design doc completo, e as outras camadas do stack):
https://github.com/gustavogalioti/daily-debate

## O que foi adicionado aqui

| Arquivo/pasta | O que é |
|---|---|
| `dailydebate_ws.js` | Servidor WebSocket do jogo — segue exatamente o padrão de `trunfo_ws.js` (ws puro, mensagens `{type,...}`, roteadas por `userId`) |
| `dailydebate_ws.test.js` | Teste standalone (sem DB, sem express) — roda com `node dailydebate_ws.test.js` |
| `daily-debate-lib/game-engine/` | Pacote vendorizado (JS já compilado) — máquina de estados da rodada |
| `daily-debate-lib/content/` | Pacote vendorizado (JS já compilado) — categorias/temas/modos + sorteio |
| `daily-debate/` | Build estático do frontend (React/Vite), servido em `/daily-debate/` |

## Como funciona

1. `server.js` registra `wssDailyDebate` e a rota de upgrade `/ws/daily-debate`,
   igual ao Truco/Coop/Trunfo.
2. A aba JOGOS ganhou um botão "🎤 Daily Debate" que mostra um `<iframe>`
   apontando pra `/daily-debate/?userId=...&name=...` — a identidade vem da
   conta REAL do usuário logado (`currentUser.id`/`currentUser.name`), sem
   pedir nome de novo dentro do jogo.
3. O frontend React roda no iframe e fala com `/ws/daily-debate` via
   WebSocket puro (não Socket.IO) — o app original usa Socket.IO, mas pra
   essa integração ele foi buildado com `VITE_TRANSPORT=ws`, que troca o
   transporte por baixo (`packages/web/src/lib/rawWsSocket.ts` no repo de
   desenvolvimento) sem mudar nenhuma tela.

## Se precisar atualizar o jogo (nova versão do game-engine/content/web)

No repo `daily-debate` (não aqui):

```bash
npm run build --workspace=@daily-debate/game-engine
npm run build --workspace=@daily-debate/content
```

Copie os `dist/` + `package.json` pra `daily-debate-lib/game-engine` e
`daily-debate-lib/content` aqui (substituindo). Depois:

```bash
cd packages/web
VITE_TRANSPORT=ws VITE_SERVER_URL=/ws/daily-debate npx vite build --base=/daily-debate/
```

Copie o `dist/` resultante pra `daily-debate/` aqui (substituindo).

## Testado

- `node dailydebate_ws.test.js` — partida completa de 3 rodadas, isolado.
- Contra o `server.js` real deste repo (Postgres local de teste): registro
  de usuário real via `/api/auth/register`, `/daily-debate/` servindo o
  HTML/JS certos, partida completa via `/ws/daily-debate` com os `userId`
  reais do Postgres. Tudo passou.
- **Não testado**: fluxo completo dentro do navegador de verdade (clicar no
  botão da aba Jogos, abrir o iframe, jogar). A lógica de rede foi validada
  ponta a ponta fora do navegador; vale um teste manual rápido depois do
  deploy.
