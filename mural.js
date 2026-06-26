/**
 * DAILY — Mural de Lembretes
 * POST-its por evento com reações e comentários
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');
const { sendPushToUser } = require('./notif_service');

// ─── TABELAS ─────────────────────────────────────────────────────────────────
async function initMuralTables() {
  const db = getDB();
  await db.prepare(`CREATE TABLE IF NOT EXISTS mural_postits (
    id TEXT PRIMARY KEY,
    agenda_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    color TEXT DEFAULT '#fef08a',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS mural_reactions (
    id TEXT PRIMARY KEY,
    postit_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    emoji TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(postit_id, user_id)
  )`).run();

  await db.prepare(`CREATE TABLE IF NOT EXISTS mural_comments (
    id TEXT PRIMARY KEY,
    postit_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).run();
}

initMuralTables().catch(e => console.error('[Mural] Init error:', e.message));

// ─── LISTAR POST-ITS DO EVENTO ────────────────────────────────────────────────
router.get('/:agendaId', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const postits = await db.prepare(`
      SELECT mp.id, mp.text, mp.color, mp.created_at,
             u.name AS author_name, u.avatar_url AS author_avatar,
             (SELECT COUNT(*) FROM mural_comments mc WHERE mc.postit_id = mp.id) AS reaction_count
      FROM mural_postits mp
      JOIN users u ON u.id = mp.user_id
      WHERE mp.agenda_id = $1
      ORDER BY mp.created_at DESC
    `).all(req.params.agendaId);
    res.json({ postits });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── CRIAR POST-IT ────────────────────────────────────────────────────────────
router.post('/:agendaId', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { text, color } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Texto obrigatório' });

    const id = uuidv4();
    await db.prepare(`
      INSERT INTO mural_postits (id, agenda_id, user_id, text, color)
      VALUES ($1, $2, $3, $4, $5)
    `).run(id, req.params.agendaId, req.user.id, text.trim(), color || '#fef08a');

    // Notificar membros do evento
    try {
      const members = await db.prepare(`
        SELECT DISTINCT am.user_id FROM agenda_members am
        WHERE am.agenda_id = $1 AND am.user_id != $2 AND am.status = 'accepted'
      `).all(req.params.agendaId, req.user.id);

      const agenda = await db.prepare('SELECT title FROM agendas WHERE id=$1').get(req.params.agendaId);
      const author = await db.prepare('SELECT name FROM users WHERE id=$1').get(req.user.id);

      for (const m of members) {
        // Notificação in-app
        await db.prepare(`
          INSERT INTO user_notifications (id, user_id, type, title, body, url, actor_id, created_at)
          VALUES ($1,$2,'mural_postit',$3,$4,$5,$6,NOW())
        `).run(
          uuidv4(), m.user_id,
          '📌 Novo lembrete no mural',
          `${author?.name || 'Alguém'} adicionou um post-it em "${agenda?.title || 'evento'}"`,
          `/?tab=eventos`,
          req.user.id
        ).catch(() => {});

        // Push
        sendPushToUser(db, m.user_id, {
          title: '📌 Novo lembrete no mural!',
          body: `${author?.name || 'Alguém'} adicionou um post-it em "${agenda?.title || 'evento'}"`,
          url: '/?tab=eventos',
          tag: 'mural-postit',
        }).catch(() => {});
      }
    } catch(e) { console.error('[Mural] Notif error:', e.message); }

    res.json({ ok: true, id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── VER POST-IT INDIVIDUAL (com reações e comentários) ──────────────────────
router.get('/postit/:postitId', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const postit = await db.prepare(`
      SELECT mp.*, u.name AS author_name, u.avatar_url AS author_avatar
      FROM mural_postits mp JOIN users u ON u.id = mp.user_id
      WHERE mp.id = $1
    `).get(req.params.postitId);
    if (!postit) return res.status(404).json({ error: 'Post-it não encontrado' });

    const reactRows = await db.prepare(`
      SELECT emoji, COUNT(*) as cnt FROM mural_reactions WHERE postit_id=$1 GROUP BY emoji
    `).all(req.params.postitId);
    const reactions = {};
    reactRows.forEach(r => { reactions[r.emoji] = parseInt(r.cnt); });

    const userReact = await db.prepare(`
      SELECT emoji FROM mural_reactions WHERE postit_id=$1 AND user_id=$2
    `).get(req.params.postitId, req.user.id);

    const comments = await db.prepare(`
      SELECT mc.*, u.name AS author_name, u.avatar_url AS author_avatar
      FROM mural_comments mc JOIN users u ON u.id = mc.user_id
      WHERE mc.postit_id = $1
      ORDER BY mc.created_at ASC
    `).all(req.params.postitId);

    res.json({
      postit: { ...postit, reactions, user_reaction: userReact?.emoji || null },
      comments,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── REAGIR AO POST-IT ────────────────────────────────────────────────────────
router.post('/postit/:postitId/react', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { emoji } = req.body;
    const existing = await db.prepare(`
      SELECT id, emoji FROM mural_reactions WHERE postit_id=$1 AND user_id=$2
    `).get(req.params.postitId, req.user.id);

    if (existing) {
      if (existing.emoji === emoji) {
        // Toggle off
        await db.prepare('DELETE FROM mural_reactions WHERE id=$1').run(existing.id);
      } else {
        // Trocar emoji
        await db.prepare('UPDATE mural_reactions SET emoji=$1 WHERE id=$2').run(emoji, existing.id);
      }
    } else {
      await db.prepare(`
        INSERT INTO mural_reactions (id, postit_id, user_id, emoji) VALUES ($1,$2,$3,$4)
      `).run(uuidv4(), req.params.postitId, req.user.id, emoji);
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ─── COMENTAR NO POST-IT ──────────────────────────────────────────────────────
router.post('/postit/:postitId/comment', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { text } = req.body;
    if (!text?.trim()) return res.status(400).json({ error: 'Texto obrigatório' });

    const id = uuidv4();
    await db.prepare(`
      INSERT INTO mural_comments (id, postit_id, user_id, text) VALUES ($1,$2,$3,$4)
    `).run(id, req.params.postitId, req.user.id, text.trim());

    // Notificar autor do post-it
    const postit = await db.prepare(`
      SELECT mp.user_id, mp.text, u.name AS commenter_name
      FROM mural_postits mp, users u
      WHERE mp.id=$1 AND u.id=$2
    `).get(req.params.postitId, req.user.id);

    if (postit && postit.user_id !== req.user.id) {
      await db.prepare(`
        INSERT INTO user_notifications (id, user_id, type, title, body, url, actor_id, created_at)
        VALUES ($1,$2,'mural_comment',$3,$4,$5,$6,NOW())
      `).run(
        uuidv4(), postit.user_id,
        '💬 Comentaram no seu post-it',
        `${postit.commenter_name} comentou: "${text.trim().slice(0,50)}"`,
        '/?tab=eventos',
        req.user.id
      ).catch(() => {});

      sendPushToUser(db, postit.user_id, {
        title: '💬 Novo comentário no seu post-it!',
        body: `${postit.commenter_name}: "${text.trim().slice(0,60)}"`,
        url: '/?tab=eventos',
        tag: 'mural-comment',
      }).catch(() => {});
    }

    res.json({ ok: true, id });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
