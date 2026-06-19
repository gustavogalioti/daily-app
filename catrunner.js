const express=require('express');
const {getDB}=require('./database');
const {authMiddleware}=require('./authmiddleware');
const {createNotification}=require('./notif_helper');
const {v4:uuidv4}=require('uuid');
const router=express.Router();
router.get('/score', authMiddleware, async(req,res)=>{
  try{
    const db=getDB();
    const row=await db.prepare('SELECT best_score FROM catrunner_scores WHERE user_id=$1').get(req.user.id);
    res.json({best:row?.best_score||0});
  }catch(e){res.status(500).json({error:e.message});}
});

// POST /api/catrunner/score — salvar pontuação
router.post('/score', authMiddleware, async(req,res)=>{
  try{
    const db=getDB();
    const {score}=req.body;
    if(!score||score<0) return res.json({ok:true});
    const existing=await db.prepare('SELECT best_score FROM catrunner_scores WHERE user_id=$1').get(req.user.id);
    const myOldBest = existing?.best_score || 0;
    let isNewBest = false;
    if(!existing){
      await db.prepare('INSERT INTO catrunner_scores(id,user_id,best_score) VALUES($1,$2,$3)').run(uuidv4(),req.user.id,score);
      isNewBest = true;
    } else if(score>existing.best_score){
      await db.prepare('UPDATE catrunner_scores SET best_score=$1,updated_at=NOW() WHERE user_id=$2').run(score,req.user.id);
      isNewBest = true;
    }
    // Se assumiu a liderança geral, notifica quem foi ultrapassado
    if (isNewBest) {
      try {
        const topBefore = await db.prepare(
          `SELECT user_id, best_score FROM catrunner_scores WHERE user_id != $1 ORDER BY best_score DESC LIMIT 1`
        ).get(req.user.id);
        if (topBefore && topBefore.best_score < score && topBefore.best_score > myOldBest) {
          const me = await db.prepare('SELECT name FROM users WHERE id=$1').get(req.user.id);
          await createNotification(db, {
            userId: topBefore.user_id, fromUserId: req.user.id,
            type: 'game_rank_lost',
            title: `${me?.name||'Alguém'} tomou sua liderança no Cat Runner! 😿`,
            body: `Novo recorde: ${score} pontos. Jogue agora e recupere o topo!`,
            data: { game: 'catrunner' }
          });
        }
      } catch(e2) { console.error('[catrunner rank notif]', e2.message); }
    }
    res.json({ok:true,new_best:isNewBest});
  }catch(e){res.status(500).json({error:e.message});}
});

// GET /api/catrunner/ranking
router.get('/ranking', async(req,res)=>{
  try{
    const db=getDB();
    const ranking=await db.prepare(`SELECT cs.user_id,cs.best_score,u.name,u.username,u.avatar_url
      FROM catrunner_scores cs JOIN users u ON u.id=cs.user_id
      ORDER BY cs.best_score DESC LIMIT 50`).all();
    res.json({ranking});
  }catch(e){res.status(500).json({error:e.message});}
});

// POST /api/catrunner/challenge — desafiar amigo
router.post('/challenge', authMiddleware, async(req,res)=>{
  try{
    const db=getDB();
    const {to_user_id}=req.body;
    const sender=await db.prepare('SELECT name FROM users WHERE id=$1').get(req.user.id);
    const myBest=await db.prepare('SELECT best_score FROM catrunner_scores WHERE user_id=$1').get(req.user.id);
    await createNotification(db,{
      userId:to_user_id, fromUserId:req.user.id,
      type:'game_challenge',
      title:`${sender.name} te desafiou no Cat Runner! 🎮`,
      body:`Bata o recorde de ${myBest?.best_score||0} pontos!`,
      data:{game:'catrunner',challenger_id:req.user.id,challenger_score:myBest?.best_score||0}
    });
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});

module.exports=router;
