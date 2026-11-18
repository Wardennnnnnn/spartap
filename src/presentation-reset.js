'use strict';
const {randomUUID}=require('node:crypto');
const D=require('./domain');
const tables=['attendance','participants','checkins','submissions','classes','events','audit'];
module.exports=({app,store,auth,io})=>{
 app.post('/api/presentation/reset',async(req,res,next)=>{
  res.set('Cache-Control','no-store');
  try{
   const {user,session}=await auth.authenticate(req);D.admin(user);
   D.need(auth.originOK(req) && req.headers['x-csrf-token']===session.csrf,'Session verification failed.',403);
   D.need(req.body.confirm==='RESET PRESENTATION','Confirm the presentation reset.');
   const backupId=randomUUID(), createdAt=D.now();
   let counts;
   if(store.pool){
    await store.pool.query('CREATE TABLE IF NOT EXISTS presentation_backups (id VARCHAR(191) PRIMARY KEY, createdAt VARCHAR(40) NOT NULL, data JSON NOT NULL) ENGINE=InnoDB');
    // Initialize the school-auth table through its repository before acquiring locks.
    await app.locals.schoolAuthRepository(()=>null);
    const conn=await store.pool.getConnection();
    try{
     await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');await conn.beginTransaction();
     await conn.query('SELECT id FROM app_lock WHERE id=1 FOR UPDATE');
     const [authRows]=await conn.query('SELECT data FROM school_auth_state WHERE id=1 FOR UPDATE');
     const [devices]=await conn.query('SELECT * FROM scanner_devices FOR UPDATE');
     const school=typeof authRows[0].data==='string'?JSON.parse(authRows[0].data):authRows[0].data;
     const backup={school,devices,history:{}};
     for(const table of tables){const [rows]=await conn.query(`SELECT * FROM \`${table}\``);backup.history[table]=rows;}
     counts={...Object.fromEntries(tables.map(t=>[t,backup.history[t].length])),devices:devices.length,emails:Object.keys(school.links).length};
     await conn.execute('INSERT INTO presentation_backups (id,createdAt,data) VALUES (?,?,?)',[backupId,createdAt,JSON.stringify(backup)]);
     // Child records are removed before parents; accounts and student directory are retained.
     for(const table of ['submissions','checkins','participants','attendance','classes','events','audit'])await conn.query(`DELETE FROM \`${table}\``);
     await conn.query('DELETE FROM scanner_devices');
     await conn.execute('UPDATE school_auth_state SET data=? WHERE id=1',[JSON.stringify({links:{},pending:{},limits:{},flows:{}})]);
     await conn.commit();
    }catch(error){await conn.rollback();throw error;}finally{conn.release();}
   }else{
    const school=await app.locals.schoolAuthRepository(s=>structuredClone(s));
    const devices=await app.locals.scannerAccess.list();
    const history=await store.read(tables);
    const backup={id:backupId,createdAt,school,devices,history};
    store.presentationBackups ||= [];store.presentationBackups.push(backup);
    counts={...Object.fromEntries(tables.map(t=>[t,history[t].length])),devices:devices.length,emails:Object.keys(school.links).length};
    await store.transact(db=>{for(const table of tables)db[table]=[];});
    await app.locals.schoolAuthRepository(s=>{s.links={};s.pending={};s.limits={};s.flows={};});
    app.locals.scannerAccess.clear();
   }
   io.emit('invalidate',{at:D.now()});
   res.json({ok:true,backupId,counts});
  }catch(error){next(error);}
 });
};
