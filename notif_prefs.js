const express = require('express');
const router = express.Router();
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');
const { v4: uuidv4 } = require('uuid');

const DEFAULT_PREFS = {
  notif_friend_request: '1',
  notif_community_invite: '1',
  notif_event_invite: '1',
  notif_mention: '1',
  notif_daily_question: '1',
  notif_dailypoke: '1',
  notif_daily_mandou: '1',
  notif_post_reaction: '1',
  notif_post_comment: '1',
  notif_community_activity: '1',
};

// GET preferências do usuário
router.get('/', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const rows = await db.prepare('SELECT pref_key, value FROM notif_prefs WHERE user_id=$1').all(req.user.id);
    const prefs = { ...DEFAULT_PREFS };
    rows.forEach(r => { prefs[r.pref_key] = r.value; });
    res.json({ prefs });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT atualizar preferência
router.put('/:key', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { value } = req.body;
    const key = req.params.key;
    if (!DEFAULT_PREFS.hasOwnProperty(key)) return res.status(400).json({ error: 'Chave inválida' });
    await db.prepare(
      'INSERT INTO notif_prefs (id,user_id,pref_key,value) VALUES ($1,$2,$3,$4) ON CONFLICT (user_id,pref_key) DO UPDATE SET value=$4, updated_at=NOW()'
    ).run(uuidv4(), req.user.id, key, value ? '1' : '0');
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
