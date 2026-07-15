const webpush = require('web-push');
const { sendNotificationEmail } = require('./email');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || 'BCito7LQz_iSr4p65v8qgmz0ANLxmV4t2-jRQxH9sGdiBQgW0qcWJV8Uc4eEgNZhHLh_9hpApsbcvBltFHkUB4I';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'EULDmzCK6usSoeBcIkRlMuf-XmC4F-D1gbuFSVpxxnM';
const SITE_URL      = process.env.SITE_URL || 'http://localhost:3000';

webpush.setVapidDetails(`mailto:admin@daily.app`, VAPID_PUBLIC, VAPID_PRIVATE);

// ─── PUSH PARA UM USUÁRIO ESPECÍFICO ────────────────────────────────────────
async function sendPushToUser(db, userId, { title, body, url, icon, tag }) {
  try {
    const subs = await db.prepare(
      'SELECT subscription FROM push_subscriptions WHERE user_id=$1'
    ).all(userId);
    if (!subs.length) return;
    const payload = JSON.stringify({
      title: title || '🔔 DAILY',
      body:  body  || '',
      url:   url   || SITE_URL,
      icon:  icon  || '/icon-192.png',
      tag:   tag   || ('daily-notif-' + Date.now())
    });
    for (const sub of subs) {
      try {
        const subscription = typeof sub.subscription === 'string'
          ? JSON.parse(sub.subscription)
          : sub.subscription;
        await webpush.sendNotification(subscription, payload);
      } catch(e) {
        if (e.statusCode === 410) {
          await db.prepare('DELETE FROM push_subscriptions WHERE user_id=$1').run(userId).catch(()=>{});
        }
      }
    }
  } catch(e) {
    console.error('[push] sendPushToUser erro:', e.message);
  }
}

// ─── PUSH PARA TODOS (Daily Mandou, Daily Pergunta, Quiz, Turnos, etc) ──────
// `override` permite customizar título/corpo — sem ele, mantém o texto
// padrão do Daily Mandou (compatibilidade com chamadas antigas).
async function sendPushToAll(db, notificationId, override) {
  // Deduplica por user_id: pega só a subscrição mais recente de cada usuário.
  // Mesmo que haja linhas duplicadas no banco (bug histórico), o usuário
  // recebe no máximo 1 push por dispositivo cadastrado.
  const allSubs = await db.prepare(
    `SELECT DISTINCT ON (ps.user_id) ps.subscription, ps.user_id, u.email, u.name
     FROM push_subscriptions ps
     JOIN users u ON u.id = ps.user_id
     ORDER BY ps.user_id, ps.created_at DESC`
  ).all();
  const allUsers = await db.prepare('SELECT email, name FROM users').all();

  console.log(`   📣 Push para ${allSubs.length} usuários únicos | Email para ${allUsers.length} usuários`);

  const payload = JSON.stringify({
    title: (override && override.title) || '⚡ Hora do DAILY!',
    body:  (override && override.body)  || 'Você tem 1 minuto para postar sua foto agora!',
    url:   (override && override.url)   || (SITE_URL + '/?notif=' + notificationId),
    icon:  '/icon-192.png',
    tag:   (override && override.tag)   || undefined
  });

  const results = { push: 0, email: 0, errors: 0 };

  for (const sub of allSubs) {
    try {
      const subscription = typeof sub.subscription === 'string'
        ? JSON.parse(sub.subscription) : sub.subscription;
      await webpush.sendNotification(subscription, payload);
      results.push++;
    } catch(e) {
      results.errors++;
      if (e.statusCode === 410) {
        await db.prepare('DELETE FROM push_subscriptions WHERE user_id=$1').run(sub.user_id).catch(()=>{});
      }
    }
  }

  for (const user of allUsers) {
    try {
      await sendNotificationEmail({ to: user.email, name: user.name, notificationId, siteUrl: SITE_URL });
      results.email++;
    } catch(e) {
      console.error(`   ❌ Email erro (${user.email}):`, e.message);
    }
  }

  console.log(`   ✅ Push: ${results.push} | Email: ${results.email} | Erros: ${results.errors}`);
  return results;
}

// ─── PUSH PARA TODOS (Pergunta do Dia) ──────────────────────────────────────
async function sendPushQuestionOfDay(db, question) {
  const subs = await db.prepare('SELECT ps.subscription, ps.user_id FROM push_subscriptions ps').all();
  const payload = JSON.stringify({
    title: '❓ Nova pergunta do DAILY!',
    body:  question || 'Uma nova pergunta foi publicada. Venha responder!',
    url:   SITE_URL,
    icon:  '/icon-192.png'
  });
  let count = 0;
  for (const sub of subs) {
    try {
      const subscription = typeof sub.subscription === 'string'
        ? JSON.parse(sub.subscription) : sub.subscription;
      await webpush.sendNotification(subscription, payload);
      count++;
    } catch(e) {
      if (e.statusCode === 410) {
        await db.prepare('DELETE FROM push_subscriptions WHERE user_id=$1').run(sub.user_id).catch(()=>{});
      }
    }
  }
  console.log(`   ❓ Push pergunta do dia: ${count} enviados`);
}

module.exports = { sendPushToAll, sendPushToUser, sendPushQuestionOfDay, VAPID_PUBLIC };
// Re-export NotificationService para compatibilidade
try { const { NotificationService } = require('./notif_service'); module.exports.NotificationService = NotificationService; } catch(e) {}
