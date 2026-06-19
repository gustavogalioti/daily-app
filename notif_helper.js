const { v4: uuidv4 } = require('uuid');

// sendPushToUser é carregado lazy para evitar dependência circular
let _sendPush = null;
function getPush() {
  if (!_sendPush) {
    try { _sendPush = require('./notifications').sendPushToUser; } catch(e) {}
  }
  return _sendPush;
}

async function createNotification(db, { userId, fromUserId, type, title, body, data }) {
  if (!userId || userId === fromUserId) return;
  const id = uuidv4();
  await db.prepare(
    'INSERT INTO user_notifications (id,user_id,from_user_id,type,title,body,data,read) VALUES ($1,$2,$3,$4,$5,$6,$7,0)'
  ).run(id, userId, fromUserId || null, type, title, body || '', JSON.stringify(data || {}));

  // Disparar push para o destinatário
  try {
    const push = getPush();
    if (push) {
      const iconMap = {
        friend_request: '🤝',
        friend_accepted: '🎉',
        post_reaction: '❤️',
        post_comment: '💬',
        community_invite: '🏘️',
        event_invite: '📅',
      };
      const icon = iconMap[type] || '🔔';
      await push(db, userId, {
        title: `${icon} ${title}`,
        body: body || '',
        url: process.env.SITE_URL || 'https://web-production-da5a8.up.railway.app',
        icon: '/icon-192.png',
        tag: `${type}-${id}`
      });
    }
  } catch(e) {
    console.error('[push] notif_helper erro:', e.message);
  }

  return id;
}

module.exports = { createNotification };
