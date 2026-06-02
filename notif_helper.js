const { v4: uuidv4 } = require('uuid');

async function createNotification(db, { userId, fromUserId, type, title, body, data }) {
  if (!userId) return;
  if (userId === fromUserId) return; // Nunca notificar a si mesmo
  try {
    const id = uuidv4();
    await db.prepare(
      'INSERT INTO user_notifications (id,user_id,from_user_id,type,title,body,data,read) VALUES ($1,$2,$3,$4,$5,$6,$7,0)'
    ).run(id, userId, fromUserId || null, type, title, body || '', JSON.stringify(data || {}));
    return id;
  } catch(e) {
    console.error('createNotification erro:', e.message);
  }
}

module.exports = { createNotification };
