const webpush = require('web-push');
const { sendNotificationEmail } = require('./email');

const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || 'BCito7LQz_iSr4p65v8qgmz0ANLxmV4t2-jRQxH9sGdiBQgW0qcWJV8Uc4eEgNZhHLh_9hpApsbcvBltFHkUB4I';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'EULDmzCK6usSoeBcIkRlMuf-XmC4F-D1gbuFSVpxxnM';
const SITE_URL      = process.env.SITE_URL || 'http://localhost:3000';

webpush.setVapidDetails(`mailto:admin@daily.app`, VAPID_PUBLIC, VAPID_PRIVATE);

async function sendPushToAll(db, notificationId) {
  // Push — só para quem tem subscription
  const subs = await db.prepare('SELECT ps.subscription, u.email, u.name FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id').all();
  // Email — para TODOS os usuários
  const allUsers = await db.prepare('SELECT email, name FROM users').all();

  console.log(`   📣 Push para ${subs.length} | Email para ${allUsers.length} usuários`);

  const payload = JSON.stringify({
    title: '📷 Hora da foto!',
    body: 'Você tem 1 minuto para postar sua foto agora!',
    url: SITE_URL + '/?notif=' + notificationId,
    icon: '/icon-192.png'
  });

  const results = { push: 0, email: 0, errors: 0 };

  // Envia push
  for (const sub of subs) {
    try {
      const subscription = typeof sub.subscription === 'string'
        ? JSON.parse(sub.subscription)
        : sub.subscription;
      await webpush.sendNotification(subscription, payload);
      results.push++;
    } catch(e) {
      results.errors++;
      if (e.statusCode === 410) {
        try { await db.prepare('DELETE FROM push_subscriptions WHERE user_id=(SELECT user_id FROM push_subscriptions ps JOIN users u ON u.id=ps.user_id WHERE u.email=$1 LIMIT 1)').run(sub.email); } catch(_) {}
      }
    }
  }

  // Envia email para todos
  for (const user of allUsers) {
    try {
      await sendNotificationEmail({ to: user.email, name: user.name, notificationId, siteUrl: SITE_URL });
      results.email++;
      console.log(`   ✉️  Email enviado: ${user.email}`);
    } catch(e) {
      console.error(`   ❌ Email erro (${user.email}):`, e.message);
    }
  }

  console.log(`   ✅ Push: ${results.push} | Email: ${results.email} | Erros: ${results.errors}`);
  return results;
}

module.exports = { sendPushToAll, VAPID_PUBLIC };
