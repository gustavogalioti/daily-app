const { v4: uuidv4 } = require('uuid');

async function createNotification(db, { userId, fromUserId, type, title, body, data }) {
  if (!userId || userId === fromUserId) return;
  const id = uuidv4();
  const dataStr = JSON.stringify(data || {});
  await db.prepare(
    `INSERT INTO user_notifications (id,user_id,from_user_id,type,title,body,data,read)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,0)`
  ).run(id, userId, fromUserId || null, type, title, body || '', dataStr);
  return id;
}

module.exports = { createNotification };
