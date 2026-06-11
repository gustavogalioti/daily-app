const { createNews, pedroTexts, pickRandom } = require('./news');

const state = {
  lastFirstPost: null, lastMostActive: null,
  lastWelcome: null,   lastHall: null,
};

function brDate(now) {
  const d = new Date((now||Date.now()) - 3*60*60*1000);
  return d.toISOString().split('T')[0];
}
function brHour(now) {
  return new Date((now||Date.now()) - 3*60*60*1000).getUTCHours();
}

async function runNewsSchedulers(db) {
  const now   = Date.now();
  const hour  = brHour(now);
  const date  = brDate(now);
  const pool  = db.pool;

  // ── Primeiro post do dia (00h) ─────────────────────────────────────────────
  if (hour === 0 && state.lastFirstPost !== date) {
    state.lastFirstPost = date;
    try {
      const { rows } = await pool.query(`
        SELECT p.user_id, u.username FROM posts p JOIN users u ON u.id=p.user_id
        WHERE DATE(p.created_at AT TIME ZONE 'America/Sao_Paulo')=$1
        ORDER BY p.created_at ASC LIMIT 1`, [date]);
      if (rows[0]) {
        await createNews(db,{ category:'first_post',
          title:'🌅 Primeiro post do dia',
          body:`O primeiro post de hoje foi publicado por @${rows[0].username}.`,
          pedro_comment: pickRandom(pedroTexts.first_post),
          user_ids:[rows[0].user_id] });
      }
    } catch(e) { console.error('news first_post:', e.message); }
  }

  // ── Boas-vindas (19h) ──────────────────────────────────────────────────────
  if (hour === 19 && state.lastWelcome !== date) {
    state.lastWelcome = date;
    try {
      const { rows } = await pool.query(
        `SELECT id, username FROM users WHERE DATE(created_at AT TIME ZONE 'America/Sao_Paulo')=$1 ORDER BY created_at ASC`, [date]);
      if (rows.length > 0) {
        await createNews(db,{ category:'welcome_new_users',
          title:'👋 Novos moradores da DAILY',
          body:`Hoje damos as boas-vindas a: ${rows.map(u=>'@'+u.username).join(' ')}\nSejam bem-vindos!`,
          pedro_comment: pickRandom(pedroTexts.welcome_new_users),
          user_ids: rows.map(u=>u.id) });
      }
    } catch(e) { console.error('news welcome:', e.message); }
  }

  // ── Mais ativo (23h) ───────────────────────────────────────────────────────
  if (hour === 23 && state.lastMostActive !== date) {
    state.lastMostActive = date;
    try {
      const { rows } = await pool.query(`
        SELECT p.user_id, u.username, COUNT(*) n FROM posts p JOIN users u ON u.id=p.user_id
        WHERE DATE(p.created_at AT TIME ZONE 'America/Sao_Paulo')=$1
        GROUP BY p.user_id,u.username ORDER BY n DESC LIMIT 1`, [date]);
      if (rows[0] && rows[0].n >= 3) {
        await createNews(db,{ category:'most_active',
          title:'🏅 Criador do dia',
          body:`@${rows[0].username} realizou ${rows[0].n} publicações hoje.\nFoi a pessoa mais ativa da DAILY!`,
          pedro_comment: pickRandom(pedroTexts.most_active),
          user_ids:[rows[0].user_id] });
      }
    } catch(e) { console.error('news most_active:', e.message); }
  }

  // ── Hall da Fama (23h30+) ──────────────────────────────────────────────────
  if (hour === 23 && new Date().getMinutes() >= 30 && state.lastHall !== date) {
    state.lastHall = date;
    try {
      const q = async (sql,p) => { const r=await pool.query(sql,p); return r.rows[0]; };
      const mp = await q(`SELECT u.username,COUNT(*) n FROM posts p JOIN users u ON u.id=p.user_id WHERE DATE(p.created_at AT TIME ZONE 'America/Sao_Paulo')=$1 GROUP BY u.username ORDER BY n DESC LIMIT 1`,[date]);
      const ml = await q(`SELECT u.username,COUNT(*) n FROM reactions r JOIN posts p ON p.id=r.post_id JOIN users u ON u.id=p.user_id WHERE DATE(r.created_at AT TIME ZONE 'America/Sao_Paulo')=$1 GROUP BY u.username ORDER BY n DESC LIMIT 1`,[date]);
      const mc = await q(`SELECT u.username,COUNT(*) n FROM comments c JOIN posts p ON p.id=c.post_id JOIN users u ON u.id=p.user_id WHERE DATE(c.created_at AT TIME ZONE 'America/Sao_Paulo')=$1 GROUP BY u.username ORDER BY n DESC LIMIT 1`,[date]);
      let lines = [`⭐ HALL DA FAMA — ${date}`];
      if (mp) lines.push(`📝 Mais posts: @${mp.username}`);
      if (ml) lines.push(`❤️ Mais curtidas: @${ml.username}`);
      if (mc) lines.push(`💬 Mais comentários: @${mc.username}`);
      if (lines.length > 1) {
        await createNews(db,{ category:'hall_of_fame', title:'⭐ Hall da Fama do Dia',
          body: lines.join('\n'), pedro_comment: pickRandom(pedroTexts.hall_of_fame) });
      }
    } catch(e) { console.error('news hall:', e.message); }
  }
}

async function notifyRecordBroken(db, { game, newLeader, oldLeader, score }) {
  try {
    const { rows } = await db.pool.query(`SELECT id FROM users WHERE username=$1`,[newLeader]);
    await createNews(db,{ category:'record_broken', is_flash:true, expires_hours:48,
      title:`🏆 Novo recorde no ${game}`,
      body:`@${newLeader} ultrapassou @${oldLeader} e assumiu a liderança.\nNovo recorde: ${Number(score).toLocaleString('pt-BR')} pontos.`,
      pedro_comment: pickRandom(pedroTexts.record_broken),
      user_ids: rows[0] ? [rows[0].id] : [] });
  } catch(e) { console.error('notifyRecord:', e.message); }
}

async function notifyRankMoved(db, { username, user_id, oldPos, newPos, rankName }) {
  try {
    await createNews(db,{ category:'rank_moved', is_flash:true, expires_hours:24,
      title:`📈 Movimento no ranking`,
      body:`@${username} subiu da posição #${oldPos} para #${newPos} no ${rankName}.`,
      pedro_comment: pickRandom(pedroTexts.rank_moved), user_ids:[user_id] });
  } catch(e) { console.error('notifyRank:', e.message); }
}

async function notifyAchievementMilestone(db, { username, user_id, points }) {
  try {
    await createNews(db,{ category:'achievement_milestone',
      title:`🎉 Marco de conquistas`,
      body:`@${username} alcançou ${Number(points).toLocaleString('pt-BR')} pontos de conquista!`,
      pedro_comment: pickRandom(pedroTexts.achievement_milestone), user_ids:[user_id] });
  } catch(e) { console.error('notifyAch:', e.message); }
}

async function notifyAnniversary(db, { username, user_id, days }) {
  const lbl = {10:'10 dias',30:'1 mês',90:'3 meses',180:'6 meses',365:'1 ano',730:'2 anos',1095:'3 anos',1825:'5 anos'}[days]||`${days} dias`;
  try {
    await createNews(db,{ category:'anniversary',
      title:`🎈 Marco de permanência`,
      body:`@${username} completou ${lbl} na DAILY.\nObrigado por fazer parte da nossa história!`,
      pedro_comment: pickRandom(pedroTexts.anniversary), user_ids:[user_id] });
  } catch(e) { console.error('notifyAnniv:', e.message); }
}

async function notifyNewFriendship(db, { user1, user2, user1_id, user2_id }) {
  try {
    await createNews(db,{ category:'new_friendship', is_flash:true, expires_hours:24,
      title:`🤝 Nova conexão`,
      body:`@${user1} e @${user2} agora fazem parte da mesma rede de amigos.`,
      pedro_comment: pickRandom(pedroTexts.new_friendship), user_ids:[user1_id,user2_id] });
  } catch(e) { console.error('notifyFriend:', e.message); }
}

async function notifyFlash(db, { title, body, user_ids=[] }) {
  try {
    await createNews(db,{ category:'flash', is_flash:true, expires_hours:24,
      title:`⚡ Flash News: ${title}`, body,
      pedro_comment: pickRandom(pedroTexts.flash), user_ids });
  } catch(e) { console.error('notifyFlash:', e.message); }
}

module.exports = { runNewsSchedulers, notifyRecordBroken, notifyRankMoved, notifyAchievementMilestone, notifyAnniversary, notifyNewFriendship, notifyFlash };
