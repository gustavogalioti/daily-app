// notifications.js — Web Push + Email
const webpush = require('web-push');
const { sendNotificationEmail } = require('./email');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || 'BCito7LQz_iSr4p65v8qgmz0ANLxmV4t2-jRQxH9sGdiBQgW0qcWJV8Uc4eEgNZhHLh_9hpApsbcvBltFHkUB4I';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'EULDmzCK6usSoeBcIkRlMuf-XmC4F-D1gbuFSVpxxnM';
const SITE_URL      = process.env.SITE_URL || 'http://localhost:3000';

webpush.setVapidDetails(`mailto:admin@daily.app`, VAPID_PUBLIC, VAPID_PRIVATE);

async function sendPushToAll(db, notificationId) {
  const subs = await db.prepare('SELECT ps.subscription, u.email, u.name FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id').all();
  console.log(`   📣 Enviando push para ${subs.length} usuários`);

  const payload = JSON.stringify({
    title: '📷 Hora da foto!',
    body: 'Você tem 3 minutos para postar sua foto agora!',
    url: SITE_URL + '/?notif=' + notificationId,
    icon: '/icon-192.png'
  });

  const results = { push: 0, email: 0, errors: 0 };

  for (const sub of subs) {
    // Push
    try {
      const subscription = typeof sub.subscription === 'string'
        ? JSON.parse(sub.subscription)
        : sub.subscription;
      await webpush.sendNotification(subscription, payload);
      results.push++;
    } catch(e) {
      results.errors++;
      // Remove subscription inválida
      if (e.statusCode === 410) {
        try { await db.prepare('DELETE FROM push_subscriptions WHERE user_id=(SELECT user_id FROM push_subscriptions WHERE subscription=$1 LIMIT 1)').run(JSON.stringify(sub.subscription)); } catch(_) {}
      }
    }

    // Email
    try {
      await sendNotificationEmail({ to: sub.email, name: sub.name, notificationId, siteUrl: SITE_URL });
      results.email++;
    } catch(e) { /* email não configurado ainda */ }
  }

  console.log(`   ✅ Push: ${results.push} | Email: ${results.email} | Erros: ${results.errors}`);
  return results;
}

module.exports = { sendPushToAll, VAPID_PUBLIC };
