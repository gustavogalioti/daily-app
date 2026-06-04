const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('./database');
const { authMiddleware } = require('./authmiddleware');
const { createPhotoUpload, getUploadedUrl } = require('./cloudinary');

const router = express.Router();

// Função central: verificar e conceder conquistas
async function checkAndGrant(db, userId, type) {
  try {
    const achievements = await db.prepare("SELECT * FROM achievements WHERE requirement_type=$1").all(type);
    for (const ach of achievements) {
      const already = await db.prepare('SELECT id FROM user_achievements WHERE user_id=$1 AND achievement_id=$2').get(userId, ach.id);
      if (already) continue;
      let count = 0;
      switch(type) {
        case 'friends':
          count = parseInt((await db.prepare(`
            SELECT COUNT(*) as c FROM friendships
            WHERE (requester_id=$1 OR addressee_id=$1) AND status='accepted'
          `).get(userId))?.c || 0); break;
        case 'posts':
          count = parseInt((await db.prepare('SELECT COUNT(*) as c FROM posts WHERE user_id=$1').get(userId))?.c || 0); break;
        case 'photos':
          count = parseInt((await db.prepare("SELECT COUNT(*) as c FROM posts WHERE user_id=$1 AND type='photo'").get(userId))?.c || 0); break;
        case 'daily_mandou':
          count = parseInt((await db.prepare("SELECT COUNT(*) as c FROM posts WHERE user_id=$1 AND tab='daily_mandou'").get(userId))?.c || 0); break;
        case 'communities':
          count = parseInt((await db.prepare('SELECT COUNT(*) as c FROM community_members WHERE user_id=$1').get(userId))?.c || 0); break;
        case 'community_created':
          count = parseInt((await db.prepare('SELECT COUNT(*) as c FROM communities WHERE owner_id=$1').get(userId))?.c || 0); break;
        case 'testimonial_given':
          count = parseInt((await db.prepare('SELECT COUNT(*) as c FROM testimonials WHERE author_id=$1').get(userId))?.c || 0); break;
        case 'testimonial_received':
          count = parseInt((await db.prepare('SELECT COUNT(*) as c FROM testimonials WHERE target_id=$1').get(userId))?.c || 0); break;
        case 'reactions_received':
          count = parseInt((await db.prepare('SELECT COUNT(*) as c FROM reactions WHERE post_id IN (SELECT id FROM posts WHERE user_id=$1)').get(userId))?.c || 0); break;
        case 'login': count = 1; break;
        case 'avatar':
          const u = await db.prepare('SELECT avatar_url FROM users WHERE id=$1').get(userId);
          count = u?.avatar_url ? 1 : 0; break;
        case 'profile_complete':
          const up = await db.prepare('SELECT avatar_url, bio FROM users WHERE id=$1').get(userId);
          count = (up?.avatar_url && up?.bio && up.bio.length > 5) ? 1 : 0; break;
        case 'night_owl':
          const hour = new Date().getHours();
          count = (hour >= 2 && hour < 4) ? 1 : 0; break;
      }
      if (count >= ach.requirement_value) {
        await db.prepare('INSERT INTO user_achievements (id,user_id,achievement_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING')
          .run(uuidv4(), userId, ach.id);
        await db.prepare('UPDATE users SET points=points+$1 WHERE id=$2').run(ach.points, userId);
      }
    }
  } catch(e) { console.error('Achievement check error:', e.message); }
}

// GET /api/achievements — todos os achievements
router.get('/', async (req, res) => {
  try {
    const db = getDB();
    const achievements = await db.prepare('SELECT * FROM achievements ORDER BY category, points ASC').all();
    res.json({ achievements });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/achievements/me — minhas conquistas
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const earned = await db.prepare(`
      SELECT a.*, ua.earned_at FROM user_achievements ua
      JOIN achievements a ON a.id=ua.achievement_id
      WHERE ua.user_id=$1 ORDER BY ua.earned_at DESC
    `).all(req.user.id);
    const all = await db.prepare('SELECT * FROM achievements WHERE active IS NOT FALSE ORDER BY category, points ASC').all();
    const earnedIds = new Set(earned.map(e => e.id));
    const locked = all.filter(a => !earnedIds.has(a.id));
    res.json({ earned, locked, total_earned: earned.length, total: all.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/achievements/user/:username
router.get('/user/:username', async (req, res) => {
  try {
    const db = getDB();
    const username = req.params.username.replace(/^@/,'').toLowerCase();
    const user = await db.prepare('SELECT id FROM users WHERE username=$1').get(username);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado' });
    const earned = await db.prepare(`
      SELECT a.*, ua.earned_at FROM user_achievements ua
      JOIN achievements a ON a.id=ua.achievement_id
      WHERE ua.user_id=$1 ORDER BY ua.earned_at DESC
    `).all(user.id);
    res.json({ earned });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/achievements/badges/me — badges em destaque
router.get('/badges/me', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const badges = await db.prepare(`
      SELECT fb.slot, a.* FROM featured_badges fb
      JOIN achievements a ON a.id=fb.achievement_id
      WHERE fb.user_id=$1 ORDER BY fb.slot ASC
    `).all(req.user.id);
    res.json({ badges });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/achievements/badges — definir badges em destaque (até 5)
router.put('/badges', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const { badge_ids } = req.body; // array de até 5 achievement_ids
    if (!Array.isArray(badge_ids) || badge_ids.length > 5)
      return res.status(400).json({ error: 'Máximo 5 badges' });
    await db.prepare('DELETE FROM featured_badges WHERE user_id=$1').run(req.user.id);
    for (let i = 0; i < badge_ids.length; i++) {
      const earned = await db.prepare('SELECT id FROM user_achievements WHERE user_id=$1 AND achievement_id=$2').get(req.user.id, badge_ids[i]);
      if (earned) {
        await db.prepare('INSERT INTO featured_badges (user_id,achievement_id,slot) VALUES ($1,$2,$3) ON CONFLICT(user_id,slot) DO UPDATE SET achievement_id=$2')
          .run(req.user.id, badge_ids[i], i + 1);
      }
    }
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// POST /api/achievements — criar conquista (admin)
router.post('/', authMiddleware, (req, res, next) => {
  createPhotoUpload().single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const db = getDB();
      const u = await db.prepare('SELECT is_admin FROM users WHERE id=$1').get(req.user.id);
      if (!u?.is_admin) return res.status(403).json({ error: 'Apenas admins podem criar conquistas' });
      const { name, description, icon, points, category, trigger_type } = req.body;
      if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
      let image_url = null;
      if (req.file) image_url = getUploadedUrl(req, req.file);
      const id = uuidv4();
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') + '-' + Date.now();
      await db.prepare(`INSERT INTO achievements (id,slug,name,description,icon,image_url,points,category,trigger_type,requirement_type,requirement_value,active)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true)`)
        .run(id, slug, name.trim(), description||'', icon||'🏆', image_url, parseInt(points)||100, category||'geral', trigger_type||'manual', trigger_type||'manual', 1);
      const ach = await db.prepare('SELECT * FROM achievements WHERE id=$1').get(id);
      res.status(201).json({ achievement: ach });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
});

// PUT /api/achievements/:id — editar conquista (admin)
router.put('/:id', authMiddleware, (req, res, next) => {
  createPhotoUpload().single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    try {
      const db = getDB();
      const u = await db.prepare('SELECT is_admin FROM users WHERE id=$1').get(req.user.id);
      if (!u?.is_admin) return res.status(403).json({ error: 'Apenas admins podem editar conquistas' });
      const { name, description, icon, points, category } = req.body;
      let image_url = undefined;
      if (req.file) image_url = getUploadedUrl(req, req.file);
      const sets = [];
      const vals = [];
      let i = 1;
      if (name) { sets.push(`name=$${i++}`); vals.push(name); }
      if (description !== undefined) { sets.push(`description=$${i++}`); vals.push(description); }
      if (icon) { sets.push(`icon=$${i++}`); vals.push(icon); }
      if (points) { sets.push(`points=$${i++}`); vals.push(parseInt(points)); }
      if (category) { sets.push(`category=$${i++}`); vals.push(category); }
      if (image_url) { sets.push(`image_url=$${i++}`); vals.push(image_url); }
      if (sets.length) {
        vals.push(req.params.id);
        await db.prepare(`UPDATE achievements SET ${sets.join(',')} WHERE id=$${i}`).run(...vals);
      }
      const ach = await db.prepare('SELECT * FROM achievements WHERE id=$1').get(req.params.id);
      res.json({ achievement: ach });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });
});

// DELETE /api/achievements/:id — desativar conquista (admin)
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const db = getDB();
    const u = await db.prepare('SELECT is_admin FROM users WHERE id=$1').get(req.user.id);
    if (!u?.is_admin) return res.status(403).json({ error: 'Apenas admins podem apagar conquistas' });
    await db.prepare('UPDATE achievements SET active=false WHERE id=$1').run(req.params.id);
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// GET /api/achievements/ranking
router.get('/ranking', async (req, res) => {
  try {
    const db = getDB();
    const users = await db.prepare(`
      SELECT u.id, u.name, u.username, u.avatar_url, u.points,
             COUNT(ua.id) as achievements_count
      FROM users u
      LEFT JOIN user_achievements ua ON ua.user_id=u.id
      WHERE u.id NOT IN ('pedro-official-daily', 'system-daily')
      GROUP BY u.id ORDER BY u.points DESC, achievements_count DESC LIMIT 50
    `).all();
    res.json({ users });
  } catch(e) { res.status(500).json({ error: e.message }); }
});


// Seed novas conquistas
async function seedNewAchievements(db) {
  const toAdd = [
    {slug:'esquema_piramide',name:'Esquema de Pirâmide',desc:'Indique a rede para um amigo e ele abrir conta',icon:'🔺',points:400,cat:'social',trigger:'invite',req_type:'count',req_val:1},
    {slug:'bicho_estimacao',name:'Eu e meu amigão',desc:'Poste uma foto com seu bicho de estimação',icon:'🐾',points:80,cat:'photo',trigger:'photo_tag',req_type:'tag',req_val:'bicho'},
    {slug:'melancia',name:'Querendo chamar atenção',desc:'Poste uma foto segurando uma melancia',icon:'🍉',points:100,cat:'photo',trigger:'photo_tag',req_type:'tag',req_val:'melancia'},
    {slug:'no_trampo',name:'No trampo',desc:'Poste uma foto no seu trabalho',icon:'💼',points:60,cat:'photo',trigger:'photo_tag',req_type:'tag',req_val:'trabalho'},
    {slug:'falsiane',name:'Falsiane',desc:'Poste uma selfie dando um sorriso falso',icon:'😁',points:70,cat:'photo',trigger:'photo_tag',req_type:'tag',req_val:'selfie'},
    {slug:'parças',name:'Com os parças',desc:'Poste uma foto com seu grupo de amigos',icon:'👯',points:90,cat:'social',trigger:'photo_tag',req_type:'tag',req_val:'amigos'},
    {slug:'disney',name:'Vivendo na Disney',desc:'Poste uma foto fantasiado',icon:'🏰',points:120,cat:'photo',trigger:'photo_tag',req_type:'tag',req_val:'fantasia'},
    {slug:'sextou',name:'Sextou!',desc:'Poste uma foto da sua sexta à noite (sex 18h-23h59)',icon:'🎉',points:100,cat:'time',trigger:'photo_time',req_type:'weekday',req_val:'5_18_23'},
    {slug:'segundou',name:'Segundou',desc:'Poste uma foto da semana começando (seg 5h-9h)',icon:'🌅',points:80,cat:'time',trigger:'photo_time',req_type:'weekday',req_val:'1_5_9'},
    {slug:'esg',name:'Orgulho do ESG',desc:'Poste uma foto abraçando uma árvore',icon:'🌳',points:80,cat:'photo',trigger:'photo_tag',req_type:'tag',req_val:'arvore'},
    {slug:'queda_livre',name:'Queda Livre',desc:'Poste uma foto pulando de paraquedas',icon:'🪂',points:200,cat:'photo',trigger:'photo_tag',req_type:'tag',req_val:'paraquedas'},
    {slug:'bucefalo',name:'Meu Bucéfalo',desc:'Poste uma foto com um cavalo (pergunte ao @pedro quem é Bucéfalo!)',icon:'🐴',points:150,cat:'photo',trigger:'photo_tag',req_type:'tag',req_val:'cavalo'},
    {slug:'cara_joelho',name:'Cara de Joelho',desc:'Poste uma foto com um bebê',icon:'👶',points:90,cat:'photo',trigger:'photo_tag',req_type:'tag',req_val:'bebe'},
    {slug:'caixa',name:'Eu e o Caixa',desc:'Poste uma foto com o caixa de um estabelecimento',icon:'🏪',points:80,cat:'photo',trigger:'photo_tag',req_type:'tag',req_val:'caixa'},
    {slug:'tia_plantas',name:'Tia das Plantas',desc:'Poste uma foto igual sua tia das plantas',icon:'🪴',points:70,cat:'photo',trigger:'photo_tag',req_type:'tag',req_val:'plantas'},
    {slug:'lenda_fluvial',name:'Lenda Fluvial',desc:'Poste uma foto num rio',icon:'🏞️',points:100,cat:'photo',trigger:'photo_tag',req_type:'tag',req_val:'rio'},
    {slug:'gabriel_medina',name:'Eu meio Gabriel Medina',desc:'Poste uma foto no mar',icon:'🏄',points:120,cat:'photo',trigger:'photo_tag',req_type:'tag',req_val:'mar'},
    {slug:'eye_tiger',name:'Eye of the Tiger',desc:'Poste uma foto com um tigre',icon:'🐯',points:200,cat:'photo',trigger:'photo_tag',req_type:'tag',req_val:'tigre'},
    {slug:'la_ferrari',name:'La Ferrari!! 🤌',desc:'Poste uma foto com uma Ferrari',icon:'🏎️',points:300,cat:'photo',trigger:'photo_tag',req_type:'tag',req_val:'ferrari'},
    {slug:'uno_escada',name:'Carro de Corrida',desc:'Poste uma foto com um Uno com escada em cima',icon:'🚗',points:250,cat:'photo',trigger:'photo_tag',req_type:'tag',req_val:'uno'},
    {slug:'srta_belo',name:'Srta. Belo',desc:'Poste uma foto enquadrando uma maçã na sua cara',icon:'🍎',points:100,cat:'photo',trigger:'photo_tag',req_type:'tag',req_val:'maca'},
  ];
  const {v4:uuidv4}=require('uuid');
  for(const a of toAdd){
    try{
      const ex=await db.prepare('SELECT id FROM achievements WHERE slug=$1').get(a.slug);
      if(!ex){
        await db.prepare('INSERT INTO achievements(id,slug,name,description,icon,points,category,trigger_type,requirement_type,requirement_value,active) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1)')
          .run(uuidv4(),a.slug,a.name,a.desc,a.icon,a.points,a.cat,a.trigger,a.req_type,a.req_val);
      }
    }catch(e){}
  }
}

module.exports = router;
module.exports.seedNewAchievements = seedNewAchievements;
module.exports.checkAndGrant = checkAndGrant;
