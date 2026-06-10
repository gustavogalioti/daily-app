const webpush = require('web-push');
const { sendNotificationEmail } = require('./email');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || 'BCito7LQz_iSr4p65v8qgmz0ANLxmV4t2-jRQxH9sGdiBQgW0qcWJV8Uc4eEgNZhHLh_9hpApsbcvBltFHkUB4I';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'EULDmzCK6usSoeBcIkRlMuf-XmC4F-D1gbuFSVpxxnM';
const SITE_URL      = process.env.SITE_URL || 'http://localhost:3000';

webpush.setVapidDetails(`mailto:admin@daily.app`, VAPID_PUBLIC, VAPID_PRIVATE);

// ─── PUSH PARA UM USUÁRIO ESPECÍFICO ────────────────────────────────────────
async function sendPushToUser(db, userId, { title, body, url, icon }) {
  try {
    const subs = await db.prepare(
      'SELECT subscription FROM push_subscriptions WHERE user_id=$1'
    ).all(userId);
    if (!subs.length) return;
    const payload = JSON.stringify({
      title: title || '🔔 DAILY',
      body:  body  || '',
      url:   url   || SITE_URL,
      icon:  icon  || '/icon-192.png'
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

// ─── PUSH PARA TODOS (Daily Mandou) ─────────────────────────────────────────
async function sendPushToAll(db, notificationId) {
  const subs     = await db.prepare('SELECT ps.subscription, ps.user_id, u.email, u.name FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id').all();
  const allUsers = await db.prepare('SELECT email, name FROM users').all();

  console.log(`   📣 Push para ${subs.length} | Email para ${allUsers.length} usuários`);

  const payload = JSON.stringify({
    title: '⚡ Hora do DAILY!',
    body:  'Você tem 1 minuto para postar sua foto agora!',
    url:   SITE_URL + '/?notif=' + notificationId,
    icon:  '/icon-192.png'
  });

  const results = { push: 0, email: 0, errors: 0 };

  for (const sub of subs) {
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
