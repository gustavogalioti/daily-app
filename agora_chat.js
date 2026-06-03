const express=require('express');
const {getDB}=require('./database');
const {authMiddleware,optionalAuth}=require('./authmiddleware');
const {v4:uuidv4}=require('uuid');
const router=express.Router();

// GET messages
router.get('/messages', optionalAuth, async(req,res)=>{
  try{
    const db=getDB();
    const limit=parseInt(req.query.limit)||30;
    const after=req.query.after||null;
    let msgs;
    if(after){
      msgs=await db.prepare(`SELECT cm.*,u.name,u.username,u.avatar_url FROM agora_chat_messages cm
        JOIN users u ON u.id=cm.user_id WHERE cm.id>$1 ORDER BY cm.id ASC LIMIT 50`).all(after);
    } else {
      msgs=await db.prepare(`SELECT cm.*,u.name,u.username,u.avatar_url FROM agora_chat_messages cm
        JOIN users u ON u.id=cm.user_id ORDER BY cm.id DESC LIMIT $1`).all(limit);
      msgs.reverse();
    }
    res.json({messages:msgs});
  }catch(e){res.status(500).json({error:e.message});}
});

// POST send message
router.post('/send', authMiddleware, async(req,res)=>{
  try{
    const db=getDB();
    const {content}=req.body;
    if(!content?.trim()) return res.status(400).json({error:'Mensagem vazia'});
    const id=uuidv4();
    await db.prepare('INSERT INTO agora_chat_messages(id,user_id,content) VALUES($1,$2,$3)').run(id,req.user.id,content.trim());
    // Pedro responde aleatoriamente (20% chance)
    if(Math.random()<0.2){
      const pedro=await db.prepare("SELECT id FROM users WHERE username='pedro' LIMIT 1").get();
      if(pedro){
        const replies=[
          'Miaaau! 🐱','Interessante... deixa eu pensar enquanto tomo meu catnip ☕🌿',
          'Concordo totalmente! (ou não... sou um gato) 😸',
          'Isso me lembrou de uma vez que dormi 18 horas seguidas 😴',
          'Fui consultar minha bola de pelo como oráculo 🔮',
          'ZOOMIES DE ENTUSIASMO!!! 🏃💨','Vou fingir que entendi e balançar a cabeça... 🐾',
          'Registrado com a patinha! ✅🐾',`Reagi com ❤️ na sua mensagem internamente 😹`,
          'Isso é mais profundo que minha tigela de ração 🍜',
        ];
        const reply=replies[Math.floor(Math.random()*replies.length)];
        setTimeout(async()=>{
          try{ await db.prepare('INSERT INTO agora_chat_messages(id,user_id,content) VALUES($1,$2,$3)').run(uuidv4(),pedro.id,reply); }catch(e){}
        },1500+Math.random()*3000);
      }
    }
    res.status(201).json({ok:true,id});
  }catch(e){res.status(500).json({error:e.message});}
});

// POST presence
router.post('/presence', authMiddleware, async(req,res)=>{
  try{
    const db=getDB();
    const {online}=req.body;
    const exp=online?new Date(Date.now()+30000).toISOString():new Date(0).toISOString();
    await db.prepare('INSERT INTO agora_chat_presence(user_id,expires_at) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET expires_at=$2').run(req.user.id,exp);
    res.json({ok:true});
  }catch(e){res.json({ok:true});}
});

// GET online count
router.get('/online', async(req,res)=>{
  try{
    const db=getDB();
    const r=await db.prepare("SELECT COUNT(*) as c FROM agora_chat_presence WHERE expires_at>NOW()").get();
    res.json({count:parseInt(r?.c)||0});
  }catch(e){res.json({count:0});}
});

// GET/POST/DELETE adm-message
router.get('/adm-message', async(req,res)=>{
  try{
    const db=getDB();
    const r=await db.prepare("SELECT message FROM agora_chat_adm WHERE active=1 ORDER BY created_at DESC LIMIT 1").get();
    res.json({message:r?.message||null});
  }catch(e){res.json({message:null});}
});

router.post('/adm-message', authMiddleware, async(req,res)=>{
  try{
    const db=getDB();
    const {message}=req.body;
    await db.prepare("UPDATE agora_chat_adm SET active=0").run();
    await db.prepare("INSERT INTO agora_chat_adm(id,message,active) VALUES($1,$2,1)").run(uuidv4(),message);
    res.json({ok:true});
  }catch(e){res.status(500).json({error:e.message});}
});

router.delete('/adm-message', authMiddleware, async(req,res)=>{
  try{ const db=getDB(); await db.prepare("UPDATE agora_chat_adm SET active=0").run(); res.json({ok:true}); }catch(e){res.json({ok:true});}
});

module.exports=router;
