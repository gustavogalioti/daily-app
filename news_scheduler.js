// Scheduler de NEWS — chamado pelo server.js a cada intervalo
const { createNews, pedroTexts, pickRandom } = require('./news');

let schedulerState = {
  lastFirstPostDate: null,
  lastMostActiveDate: null,
  lastWelcomeDate: null,
  lastHallDate: null,
};

async function runNewsSchedulers(db) {
  const now = new Date();
  // Horário Brasil (UTC-3)
  const brNow = new Date(now.getTime() - 3 * 60 * 60 * 1000);
  const brHour = brNow.getUTCHours();
  const brDate = brNow.toISOString().split('T')[0];

  // ── 1. Primeiro post do dia (roda às 00:05 BRT) ────────────────────────────
  if (brHour === 0 && schedulerState.lastFirstPostDate !== brDate) {
    schedulerState.lastFirstPostDate = brDate;
    try {
      const row = await db.prepare(`
        SELECT p.id, p.user_id, u.username, u.name
        FROM posts p JOIN users u ON u.id=p.user_id
        WHERE DATE(p.created_at AT TIME ZONE 'America/Sao_Paulo') = $1
        ORDER BY p.created_at ASC LIMIT 1
      `).get(brDate);
      if (row) {
        await createNews(db, {
          category: 'first_post',
          title: `🌅 Primeiro post do dia`,
          body: `O primeiro post de hoje foi publicado por @${row.username}.`,
          pedro_comment: pickRandom(pedroTexts.first_post),
          user_ids: [row.user_id],
        });
      }
    } catch(e) { console.error('news scheduler first_post:', e.message); }
  }

  // ── 2. Boas-vindas novos usuários (todos os dias às 19h BRT) ──────────────
  if (brHour === 19 && schedulerState.lastWelcomeDate !== brDate) {
    schedulerState.lastWelcomeDate = brDate;
    try {
      const rows = await db.prepare(`
        SELECT id, username FROM users
        WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo') = $1
        ORDER BY created_at ASC
      `).all(brDate);
      if (rows.length > 0) {
        const mentions = rows.map(u => `@${u.username}`).join(' ');
        await createNews(db, {
          category: 'welcome_new_users',
          title: `👋 Novos moradores da DAILY`,
          body: `Hoje damos as boas-vindas a: ${mentions}\nSejam bem-vindos à comunidade!`,
          pedro_comment: pickRandom(pedroTexts.welcome_new_users),
          user_ids: rows.map(u => u.id),
        });
      }
    } catch(e) { console.error('news scheduler welcome:', e.message); }
  }

  // ── 3. Usuário mais ativo (às 23h BRT) ────────────────────────────────────
  if (brHour === 23 && schedulerState.lastMostActiveDate !== brDate) {
    schedulerState.lastMostActiveDate = brDate;
    try {
      const row = await db.prepare(`
        SELECT p.user_id, u.username, u.name, COUNT(*) AS total
        FROM posts p JOIN users u ON u.id=p.user_id
        WHERE DATE(p.created_at AT TIME ZONE 'America/Sao_Paulo') = $1
        GROUP BY p.user_id, u.username, u.name
        ORDER BY total DESC LIMIT 1
      `).get(brDate);
      if (row && row.total >= 3) {
        await createNews(db, {
          category: 'most_active',
          title: `🏅 Criador do dia`,
          body: `@${row.username} realizou ${row.total} publicações hoje.\nFoi a pessoa mais ativa da DAILY!`,
          pedro_comment: pickRandom(pedroTexts.most_active),
          user_ids: [row.user_id],
        });
      }
    } catch(e) { console.error('news scheduler most_active:', e.message); }
  }

  // ── 4. Hall da Fama (às 23:30 BRT — roda quando minuto é 30 e hora 23) ────
  if (brHour === 23 && new Date().getMinutes() >= 30 && schedulerState.lastHallDate !== brDate) {
    schedulerState.lastHallDate = brDate;
    try {
      // Mais posts
      const mostPosts = await db.prepare(`
        SELECT u.username, COUNT(*) n FROM posts p JOIN users u ON u.id=p.user_id
        WHERE DATE(p.created_at AT TIME ZONE 'America/Sao_Paulo')=$1
        GROUP BY u.username ORDER BY n DESC LIMIT 1
      `).get(brDate);
      // Mais curtidas
      const mostLikes = await db.prepare(`
        SELECT u.username, COUNT(*) n FROM reactions r
        JOIN posts p ON p.id=r.post_id JOIN users u ON u.id=p.user_id
        WHERE DATE(r.created_at AT TIME ZONE 'America/Sao_Paulo')=$1
        GROUP BY u.username ORDER BY n DESC LIMIT 1
      `).get(brDate);
      // Mais comentários recebidos
      const mostComments = await db.prepare(`
        SELECT u.username, COUNT(*) n FROM comments c
        JOIN posts p ON p.id=c.post_id JOIN users u ON u.id=p.user_id
        WHERE DATE(c.created_at AT TIME ZONE 'America/Sao_Paulo')=$1
        GROUP BY u.username ORDER BY n DESC LIMIT 1
      `).get(brDate);
      // Melhor do Cat Runner no dia
      const bestGame = await db.prepare(`
        SELECT u.username, MAX(cs.score) s FROM catrunner_scores cs JOIN users u ON u.id=cs.user_id
        WHERE DATE(cs.created_at AT TIME ZONE 'America/Sao_Paulo')=$1
        GROUP BY u.username ORDER BY s DESC LIMIT 1
      `).get(brDate).catch(() => null);

      let lines = [`⭐ HALL DA FAMA DO DIA — ${brDate}`];
      if (mostPosts) lines.push(`📝 Maior quantidade de posts: @${mostPosts.username}`);
      if (mostLikes) lines.push(`❤️ Mais curtidas recebidas: @${mostLikes.username}`);
      if (mostComments) lines.push(`💬 Mais comentários recebidos: @${mostComments.username}`);
      if (bestGame) lines.push(`🎮 Melhor jogador do dia: @${bestGame.username}`);

      if (lines.length > 1) {
        await createNews(db, {
          category: 'hall_of_fame',
          title: `⭐ Hall da Fama do Dia`,
          body: lines.join('\n'),
          pedro_comment: pickRandom(pedroTexts.hall_of_fame),
        });
      }
    } catch(e) { console.error('news scheduler hall:', e.message); }
  }
}

// ── Trigger por eventos (chamado de outros módulos) ───────────────────────────

async function notifyRecordBroken(db, { game, newLeader, oldLeader, score }) {
  try {
    const u = await db.prepare(`SELECT id, username FROM users WHERE username=$1`).get(newLeader);
    await createNews(db, {
      category: 'record_broken',
      title: `🏆 Novo recorde no ${game}`,
      body: `@${newLeader} ultrapassou @${oldLeader} e assumiu a liderança.\nNovo recorde: ${score.toLocaleString('pt-BR')} pontos.`,
      pedro_comment: pickRandom(pedroTexts.record_broken),
      user_ids: u ? [u.id] : [],
      is_flash: true,
      expires_hours: 48,
    });
  } catch(e) { console.error('notifyRecordBroken:', e.message); }
}

async function notifyRankMoved(db, { username, user_id, oldPos, newPos, rankName }) {
  try {
    await createNews(db, {
      category: 'rank_moved',
      title: `📈 Movimento no ranking`,
      body: `@${username} subiu da posição #${oldPos} para #${newPos} no ${rankName}.`,
      pedro_comment: pickRandom(pedroTexts.rank_moved),
      user_ids: [user_id],
      is_flash: true,
      expires_hours: 24,
    });
  } catch(e) { console.error('notifyRankMoved:', e.message); }
}

async function notifyAchievementMilestone(db, { username, user_id, points }) {
  try {
    await createNews(db, {
      category: 'achievement_milestone',
      title: `🎉 Marco de conquistas`,
      body: `@${username} alcançou ${points.toLocaleString('pt-BR')} pontos de conquista!`,
      pedro_comment: pickRandom(pedroTexts.achievement_milestone),
      user_ids: [user_id],
    });
  } catch(e) { console.error('notifyAchievementMilestone:', e.message); }
}

async function notifyAnniversary(db, { username, user_id, days }) {
  const labels = { 10:'10 dias',30:'1 mês',90:'3 meses',180:'6 meses',365:'1 ano',730:'2 anos',1095:'3 anos',1825:'5 anos' };
  const label = labels[days] || `${days} dias`;
  try {
    await createNews(db, {
      category: 'anniversary',
      title: `🎈 Marco de permanência`,
      body: `@${username} completou ${label} na DAILY.\nObrigado por fazer parte da nossa história!`,
      pedro_comment: pickRandom(pedroTexts.anniversary),
      user_ids: [user_id],
    });
  } catch(e) { console.error('notifyAnniversary:', e.message); }
}

async function notifyNewFriendship(db, { user1, user2, user1_id, user2_id }) {
  try {
    await createNews(db, {
      category: 'new_friendship',
      title: `🤝 Nova conexão`,
      body: `@${user1} e @${user2} agora fazem parte da mesma rede de amigos.`,
      pedro_comment: pickRandom(pedroTexts.new_friendship),
      user_ids: [user1_id, user2_id],
      is_flash: true,
      expires_hours: 24,
    });
  } catch(e) { console.error('notifyNewFriendship:', e.message); }
}

async function notifyFlash(db, { title, body, user_ids = [] }) {
  try {
    await createNews(db, {
      category: 'flash',
      title: `⚡ Flash News: ${title}`,
      body,
      pedro_comment: pickRandom(pedroTexts.flash),
      user_ids,
      is_flash: true,
      expires_hours: 24,
    });
  } catch(e) { console.error('notifyFlash:', e.message); }
}

module.exports = {
  runNewsSchedulers,
  notifyRecordBroken,
  notifyRankMoved,
  notifyAchievementMilestone,
  notifyAnniversary,
  notifyNewFriendship,
  notifyFlash,
};
