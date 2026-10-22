// ═══════════════════════════════════════════════════════════════
// MODO POCKET (servidor)
// Lançamento enxuto: só Dailys + Daily Mandou + Perfil/amigos.
// Notificações de funções ocultas ficam CONGELADAS: não são criadas,
// não geram push e não aparecem no sino (nada é apagado do banco).
// Para religar tudo: POCKET_MODE=0 no Railway.
// ═══════════════════════════════════════════════════════════════
const POCKET_MODE = process.env.POCKET_MODE !== '0';

// único tipos de notificação (sino + push) que existem no modo pocket
const POCKET_NOTIF_TYPES = [
  'friend_request', 'friend_accepted',
  'reaction', 'post_reaction', 'comment', 'post_comment',
  'mention', 'pedro_mention', 'testimonial', 'testimonial_received',
  'daily_received',
];

function allowsNotif(type) { return !POCKET_MODE || POCKET_NOTIF_TYPES.includes(type); }

module.exports = { POCKET_MODE, POCKET_NOTIF_TYPES, allowsNotif };
