/**
 * DAILY — NotificationService
 * Serviço central de notificações. TODOS os pushes passam por aqui.
 */
const webpush = require('web-push');
const { v4: uuidv4 } = require('uuid');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || 'BCito7LQz_iSr4p65v8qgmz0ANLxmV4t2-jRQxH9sGdiBQgW0qcWJV8Uc4eEgNZhHLh_9hpApsbcvBltFHkUB4I';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'EULDmzCK6usSoeBcIkRlMuf-XmC4F-D1gbuFSVpxxnM';
const SITE_URL      = process.env.SITE_URL || 'https://web-production-da5a8.up.railway.app';

webpush.setVapidDetails('mailto:admin@daily.app', VAPID_PUBLIC, VAPID_PRIVATE);

// Só enviar para subscrições do domínio oficial
const OFFICIAL_DOMAINS = ['yourdaily.com.br', 'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'notify.windows.com', 'push.apple.com'];
function isOfficialEndpoint(subscription) {
  if (!subscription || !subscription.endpoint) return false;
  // FCM/Mozilla/Windows/Apple são válidos (gerados pelo browser, não pelo domínio)
  // Bloquear apenas endpoints do Railway
  return !subscription.endpoint.includes('railway.app') && !subscription.endpoint.includes('web-production');
}

// ─── ANTI-SPAM: janela de consolidação por usuário+tipo ───────────────────────
const spamWindow = new Map(); // key: `${userId}:${type}` → timestamp

function isSpam(userId, type, windowMs = 30 * 60 * 1000) {
  const key = `${userId}:${type}`;
  const last = spamWindow.get(key) || 0;
  if (Date.now() - last < windowMs) return true;
  spamWindow.set(key, Date.now());
  return false;
}

// ─── ENVIAR PUSH PARA DISPOSITIVOS DE UM USUÁRIO ─────────────────────────────
async function sendPushToUser(db, userId, { title, body, url, icon, tag }) {
  try {
    const subs = await db.prepare(
      'SELECT id, subscription FROM push_subscriptions WHERE user_id=$1'
    ).all(userId);
    if (!subs.length) return 0;

    const payload = JSON.stringify({
      title: title || '🔔 DAILY',
      body:  body  || '',
      url:   url   || SITE_URL,
      icon:  icon  || '/icon-192.png',
      tag:   tag   || 'daily-notif',
    });

    let sent = 0;
    for (const sub of subs) {
      try {
        const subscription = typeof sub.subscription === 'string'
          ? JSON.parse(sub.subscription) : sub.subscription;
        if (!isOfficialEndpoint(subscription)) continue;
        await webpush.sendNotification(subscription, payload);
        sent++;
      } catch(e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          // Subscription expirada — remover
          await db.prepare('DELETE FROM push_subscriptions WHERE id=$1').run(sub.id).catch(()=>{});
        }
      }
    }
    return sent;
  } catch(e) {
    console.error('[NotifService] sendPushToUser erro:', e.message);
    return 0;
  }
}

// ─── VERIFICAR PREFERÊNCIA DO USUÁRIO ────────────────────────────────────────
async function userWants(db, userId, prefKey) {
  try {
    const pref = await db.prepare(
      'SELECT value FROM notif_prefs WHERE user_id=$1 AND pref_key=$2'
    ).get(userId, prefKey);
    if (!pref) return true; // padrão: ativado
    return pref.value === '1' || pref.value === 'true';
  } catch(e) { return true; }
}

// ─── SALVAR NOTIFICAÇÃO NO SINO E ENVIAR PUSH ────────────────────────────────
async function notify(db, { userId, fromUserId, type, title, body, url, tag, prefKey, spamWindowMs, data }) {
  if (!userId || userId === fromUserId) return;

  // Verificar preferência
  if (prefKey && !(await userWants(db, userId, prefKey))) return;

  // Anti-spam
  if (spamWindowMs && isSpam(userId, type, spamWindowMs)) return;

  // Salvar no sino (user_notifications)
  const notifId = uuidv4();
  try {
    await db.prepare(
      'INSERT INTO user_notifications (id,user_id,from_user_id,type,title,body,data,read) VALUES ($1,$2,$3,$4,$5,$6,$7,0)'
    ).run(notifId, userId, fromUserId || null, type, title, body || '', JSON.stringify({ url: url || SITE_URL, ...(data || {}) }));
  } catch(e) { console.error('[NotifService] insert notif erro:', e.message); }

  // Enviar push (tag única por notificação — não sobrescreve a anterior na bandeja do celular)
  await sendPushToUser(db, userId, { title, body, url, tag: `${tag || type}-${notifId}` });
}

// ─── MÉTODOS ESPECÍFICOS ──────────────────────────────────────────────────────

const NotificationService = {

  // 1. Solicitação de amizade
  async sendFriendRequest(db, { toUserId, fromUser, friendshipId }) {
    await notify(db, {
      userId: toUserId, fromUserId: fromUser.id,
      type: 'friend_request',
      title: `🤝 Nova solicitação de amizade`,
      body: `${fromUser.name} quer ser seu amigo.`,
      url: `${SITE_URL}/?tab=friends`,
      tag: 'friend_request',
      prefKey: 'notif_friend_request',
      data: { friendship_id: friendshipId },
    });
  },

  // 2. Amizade aceita
  async sendFriendAccepted(db, { toUserId, fromUser }) {
    await notify(db, {
      userId: toUserId, fromUserId: fromUser.id,
      type: 'friend_accepted',
      title: `🎉 Amizade aceita`,
      body: `${fromUser.name} aceitou sua solicitação de amizade.`,
      url: `${SITE_URL}/?tab=friends`,
      tag: 'friend_accepted',
      prefKey: 'notif_friend_request',
    });
  },

  // 3. Convite para comunidade
  async sendCommunityInvite(db, { toUserId, fromUser, communityName, communityId }) {
    await notify(db, {
      userId: toUserId, fromUserId: fromUser.id,
      type: 'community_invite',
      title: `🏘️ Convite para comunidade`,
      body: `Você foi convidado para participar de ${communityName}.`,
      url: `${SITE_URL}/?tab=communities&id=${communityId}`,
      tag: 'community_invite',
      prefKey: 'notif_community_invite',
    });
  },

  // 4. Convite para evento
  async sendEventInvite(db, { toUserId, fromUser, eventName, eventId }) {
    await notify(db, {
      userId: toUserId, fromUserId: fromUser.id,
      type: 'event_invite',
      title: `📅 Convite para evento`,
      body: `Você foi convidado para o evento ${eventName}.`,
      url: `${SITE_URL}/?tab=events&id=${eventId}`,
      tag: 'event_invite',
      prefKey: 'notif_event_invite',
      data: { event_id: eventId },
    });
  },

  // 5. Menção
  async sendMention(db, { toUserId, fromUser, postId }) {
    await notify(db, {
      userId: toUserId, fromUserId: fromUser.id,
      type: 'mention',
      title: `💬 Você foi mencionado`,
      body: `${fromUser.name} mencionou você em um comentário.`,
      url: `${SITE_URL}/?post=${postId}`,
      tag: 'mention',
      prefKey: 'notif_mention',
    });
  },

  // 6. DailyPoke
  async sendDailyPoke(db, { toUserId, fromUser, scene }) {
    const sceneText = scene ? ` com cena: ${scene}` : '';
    await notify(db, {
      userId: toUserId, fromUserId: fromUser.id,
      type: 'poke',
      title: `🎭 Você recebeu um DailyPoke!`,
      body: `${fromUser.name} enviou um DailyPoke para você${sceneText}.`,
      url: `${SITE_URL}/?tab=jogos`,
      tag: 'dailypoke',
      prefKey: 'notif_dailypoke',
    });
  },

  // 7. Reações no post (agrupado, anti-spam 30min)
  async sendPostReaction(db, { toUserId, fromUser, postId, reactionCount }) {
    const body = reactionCount > 1
      ? `Seu post recebeu ${reactionCount} reações.`
      : `${fromUser.name} reagiu ao seu post.`;
    await notify(db, {
      userId: toUserId, fromUserId: fromUser.id,
      type: 'post_reaction',
      title: `❤️ Seu post está recebendo atenção`,
      body,
      url: `${SITE_URL}/?post=${postId}`,
      tag: `reaction_${postId}`,
      prefKey: 'notif_post_reaction',
      spamWindowMs: 30 * 60 * 1000,
    });
  },

  // 8. Comentário no post (anti-spam 15min)
  async sendPostComment(db, { toUserId, fromUser, postId }) {
    await notify(db, {
      userId: toUserId, fromUserId: fromUser.id,
      type: 'post_comment',
      title: `💬 Novo comentário`,
      body: `${fromUser.name} comentou sua publicação.`,
      url: `${SITE_URL}/?post=${postId}`,
      tag: `comment_${postId}`,
      prefKey: 'notif_post_comment',
      spamWindowMs: 15 * 60 * 1000,
    });
  },

  // 9. Pedro menciona usuário em evento
  async sendPedroMention(db, { toUserId, eventTitle, eventId, message }) {
    await notify(db, {
      userId: toUserId, fromUserId: 'pedro-official-daily',
      type: 'pedro_mention',
      title: `🐱 Pedro te marcou em "${eventTitle}"`,
      body: message,
      url: `${SITE_URL}/?tab=events&id=${eventId}`,
      tag: 'pedro_mention',
    });
  },

  // 10. Daily Mandou — push para todos
  async sendDailyMandou(db, notificationId) {
    const subs = await db.prepare('SELECT id, user_id, subscription FROM push_subscriptions').all();
    const payload = JSON.stringify({
      title: '⚡ Hora do DAILY!',
      body: 'Você tem 1 minuto para postar sua foto agora!',
      url: SITE_URL + '/?notif=' + notificationId,
      icon: '/icon-192.png',
      tag: 'daily-mandou',
    });
    let sent = 0, errors = 0;
    for (const sub of subs) {
      try {
        const subscription = typeof sub.subscription === 'string'
          ? JSON.parse(sub.subscription) : sub.subscription;
        if (!isOfficialEndpoint(subscription)) continue;
        await webpush.sendNotification(subscription, payload);
        sent++;
      } catch(e) {
        errors++;
        if (e.statusCode === 410 || e.statusCode === 404) {
          await db.prepare('DELETE FROM push_subscriptions WHERE id=$1').run(sub.id).catch(()=>{});
        }
      }
    }
    console.log(`[NotifService] Daily Mandou: ${sent} enviados, ${errors} erros`);
    return { sent, errors };
  },

  // 11. Daily Pergunta — push para todos
  async sendDailyQuestion(db, { period }) {
    const messages = {
      morning: { title: '☀️ Bom dia!', body: 'A nova Daily Pergunta já está disponível.' },
      lunch:   { title: '🍽️ Daily Pergunta', body: 'Nova pergunta liberada. Venha responder!' },
      afternoon: { title: '🌤️ Boa tarde!', body: 'Hora de responder a Daily Pergunta da tarde.' },
      night:   { title: '🌙 Boa noite!', body: 'A última Daily Pergunta do dia já está disponível.' },
    };
    const msg = messages[period] || messages.morning;
    const subs = await db.prepare('SELECT id, user_id, subscription FROM push_subscriptions').all();
    const payload = JSON.stringify({ ...msg, url: SITE_URL, icon: '/icon-192.png', tag: 'daily-question' });
    let sent = 0;
    for (const sub of subs) {
      try {
        const subscription = typeof sub.subscription === 'string'
          ? JSON.parse(sub.subscription) : sub.subscription;
        if (!isOfficialEndpoint(subscription)) continue;
        // Verificar preferência
        const wants = await userWants(db, sub.user_id, 'notif_daily_question');
        if (!wants) continue;
        await webpush.sendNotification(subscription, payload);
        sent++;
      } catch(e) {
        if (e.statusCode === 410 || e.statusCode === 404) {
          await db.prepare('DELETE FROM push_subscriptions WHERE id=$1').run(sub.id).catch(()=>{});
        }
      }
    }
    console.log(`[NotifService] Daily Pergunta (${period}): ${sent} enviados`);
    return { sent };
  },

  // Compatibilidade com código antigo
  sendPushToUser,
};

module.exports = { NotificationService, sendPushToUser, VAPID_PUBLIC };
