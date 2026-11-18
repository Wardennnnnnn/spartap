'use strict';
const {randomBytes, randomInt, createHash} = require('node:crypto');
const {OAuth2Client} = require('google-auth-library');
const D = require('./domain');
const {hashPassword, verifyPassword} = require('./security');
const digest = value => createHash('sha256').update(value).digest('hex');
const migration = `CREATE TABLE IF NOT EXISTS school_auth_state (id INT PRIMARY KEY, data JSON NOT NULL) ENGINE=InnoDB`;
function createRepository(store) {
 let memory = {links:{}, pending:{}, limits:{}, flows:{}};
 let tail = Promise.resolve(), ready;
 return fn => {
  const job = tail.then(async () => {
   if (!store.pool) return fn(memory);
   ready ||= store.pool.query(migration).then(() => store.pool.query("INSERT IGNORE INTO school_auth_state (id,data) VALUES (1, ?)", [JSON.stringify(memory)]));
   await ready;
   const conn = await store.pool.getConnection();
   try {
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const [rows] = await conn.query('SELECT data FROM school_auth_state WHERE id=1 FOR UPDATE');
    const state = typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data;
    const result = await fn(state);
    await conn.execute('UPDATE school_auth_state SET data=? WHERE id=1', [JSON.stringify(state)]);
    await conn.commit(); return result;
   } catch (error) { await conn.rollback(); throw error; }
   finally { conn.release(); }
  });
  tail = job.catch(() => {}); return job;
 };
}
function mountSchoolAuth({app, store, authenticate, originOK, issueSession, config = process.env, sendEmail, verifyGoogle}) {
 const repo = createRepository(store);
 const domain = config.SCHOOL_EMAIL_DOMAIN || 'g.batstate-u.edu.ph';
 const otpEnabled = Boolean(config.RESEND_API_KEY && config.EMAIL_FROM);
 const senderAddress = config.EMAIL_FROM?.match(/<([^<>]+)>/)?.[1] || config.EMAIL_FROM;
 const googleEnabled = Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.PUBLIC_APP_URL);
 const normalize = value => {
  const email = String(value || '').trim().toLowerCase();
  D.need(email.length <= 191 && /^[^\s@]+@[^\s@]+$/.test(email) && email.split('@')[1] === domain, 'Use your school email.');
  return email;
 };
 const cookie = req => String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('spartap_oauth='))?.slice(14);
 const cookieOptions = {httpOnly:true, secure:config.COOKIE_SECURE === '1', sameSite:'lax', path:'/api/auth/google', maxAge:600000};
 const route = (method, path, fn) => app[method](path, async (req,res,next) => {
  res.set('Cache-Control','no-store');
  try { if (method === 'post') D.need(originOK(req), 'Invalid request origin.',403); await fn(req,res); }
  catch(error) { next(error); }
 });
 async function admin(req) {
  const {user,session} = await authenticate(req); D.admin(user);
  if (req.method !== 'GET') D.need(req.headers['x-csrf-token'] === session.csrf, 'Session verification failed.',403);
  return user;
 }
 async function approved(email) {
  const link = await repo(s => s.links[email] && {...s.links[email]});
  const user = link && await store.findUser('id',link.userId);
  D.need(user?.active, 'This school email has no approved active SparTap account.',403);
  return {user,link};
 }
 route('get','/api/auth/options',async (req,res) => res.json({domain,otp:otpEnabled,google:googleEnabled}));
 route('get','/api/auth/links',async (req,res) => {
  await admin(req);
  const db = await store.read(['users']);
  const links = await repo(s => Object.entries(s.links).map(([email,v])=>({email,userId:v.userId})));
  res.json({links,users:db.users.map(u=>({id:u.id,name:u.name,username:u.username,active:u.active}))});
 });
 route('post','/api/auth/links',async (req,res) => {
  await admin(req); const email=normalize(req.body.email), user=await store.findUser('id',req.body.userId);
  D.need(user, 'Account not found.',404);
  await repo(s => {
   if(req.body.remove === true) { D.need(s.links[email]?.userId===user.id,'Email mapping does not match.'); delete s.links[email]; }
   else {
    D.need(!s.links[email] || s.links[email].userId===user.id,'Email is linked to another account.',409);
    D.need(!Object.entries(s.links).some(([e,v])=>e!==email && v.userId===user.id),'Remove the existing email first.',409);
    s.links[email]={userId:user.id,googleSub:s.links[email]?.googleSub || null};
   }
   delete s.pending['login:'+email]; delete s.pending['reset:'+email];
  });
  res.json({ok:true});
 });
 route('post','/api/auth/otp/request',async (req,res) => {
  D.need(otpEnabled,'Email OTP is not configured yet.',503);
  const email=normalize(req.body.email), now=Date.now(), day=new Date(now).toISOString().slice(0,10);
  const purpose=req.body.purpose === 'reset' ? 'reset' : 'login', pendingKey=purpose+':'+email;
  const code=String(randomInt(1000000)).padStart(6,'0'), challenge=randomBytes(32).toString('hex');
  const eligible=await repo(s=>{
   for(const [key,v] of Object.entries(s.pending)) if(v.expires<=now) delete s.pending[key];
   for(const [key,v] of Object.entries(s.limits)) if(v.day!==day) delete s.limits[key];
   const keys=['email:'+email,'ip:'+req.ip];
   for(const key of keys) { const v=s.limits[key]; D.need(!v || now-v.last>=60000 && v.count<(key.startsWith('ip:')?30:5),'Please wait 60 seconds. Daily send limit may apply.',429); }
   for(const key of keys) { const v=s.limits[key];s.limits[key]={day,last:now,count:(v?.count||0)+1}; }
   delete s.pending[pendingKey];
   if(!s.links[email]) return false;
   s.pending[pendingKey]={hash:hashPassword(code),challenge:digest(challenge),userId:s.links[email].userId,expires:now+600000,attempts:0};return true;
  });
  if(eligible) {
   try {
    if(sendEmail) await sendEmail(email,code);
    else {
     const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${config.RESEND_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({from:`SparTap <${senderAddress}>`,to:[email],subject:purpose==='reset'?'SparTap password reset code':'SparTap sign-in code',text:`Your SparTap ${purpose==='reset'?'password reset':'sign-in'} code is ${code}.\nExpires in 10 minutes. Do not share this code. If you did not request it, ignore this email.`}),signal:AbortSignal.timeout(15000)});
     D.need(response.ok,'Email delivery failed. Request a new code later.',502);
    }
   } catch(error) { await repo(s=>{if(s.pending[pendingKey]?.challenge===digest(challenge)) delete s.pending[pendingKey];});throw new D.Fault('Email delivery failed. Request a new code later.',502); }
  }
  res.json({challenge,message:'If your email is approved, a code has been sent. Check your inbox and spam.'});
 });
 route('post','/api/auth/otp/verify',async (req,res)=>{
  D.need(otpEnabled,'Email OTP is not configured yet.',503);
  const email=normalize(req.body.email), purpose=req.body.purpose === 'reset' ? 'reset' : 'login', pendingKey=purpose+':'+email;
  if(purpose==='reset') D.need(typeof req.body.password==='string' && req.body.password.length>=12 && req.body.password.length<=128,'Use a password of 12–128 characters.');
  const userId=await repo(s=>{
   const p=s.pending[pendingKey];
   if(!p || p.expires<=Date.now() || p.attempts>=5 || p.challenge!==digest(String(req.body.challenge||''))) return null;
   p.attempts++;
   if(!/^\d{6}$/.test(req.body.code) || !verifyPassword(req.body.code,p.hash)) return null;
   delete s.pending[pendingKey];
   return s.links[email]?.userId===p.userId?p.userId:null;
  });
  D.need(userId,'Invalid, expired, or locked code. Request a new code.',401);
  const user=await store.findUser('id',userId);D.need(user?.active,'Account inactive.',403);
  if(purpose==='reset') {
   await store.transact(db=>{const target=db.users.find(u=>u.id===userId && u.active);D.need(target,'Account inactive.',403);target.passwordHash=hashPassword(req.body.password);D.audit(db,target,'password.reset','School email verification');});
   await store.sessions.deleteUser(userId);
   return res.json({ok:true,message:'Password updated. Sign in with your new password.'});
  }
  await issueSession(req,res,user);
 });
 const redirectUri = googleEnabled ? `${config.PUBLIC_APP_URL.replace(/\/$/,'')}/api/auth/google/callback` : '';
 const google = new OAuth2Client(config.GOOGLE_CLIENT_ID,config.GOOGLE_CLIENT_SECRET,redirectUri);
 route('get','/api/auth/google/start',async (req,res)=>{
  D.need(googleEnabled,'Google sign-in is not configured yet.',503);
  const state=randomBytes(32).toString('hex'), nonce=randomBytes(32).toString('hex'), verifier=randomBytes(32).toString('hex');
  await repo(s=>{for(const [k,v] of Object.entries(s.flows)) if(v.expires<Date.now()) delete s.flows[k];s.flows[digest(state)]={nonce,verifier,expires:Date.now()+600000};});
  res.cookie('spartap_oauth',state,cookieOptions);
  res.redirect(google.generateAuthUrl({scope:['openid','email'],state,nonce,hd:domain,prompt:'select_account',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}));
 });
 route('get','/api/auth/google/callback',async (req,res)=>{
  D.need(googleEnabled,'Google sign-in is not configured yet.',503);
  const state=String(req.query.state||'');
  D.need(/^[a-f0-9]{64}$/.test(state) && cookie(req)===state,'Google sign-in verification failed. Try again.',403);
  const flow=await repo(s=>{const f=s.flows[digest(state)];delete s.flows[digest(state)];return f;});
  res.clearCookie('spartap_oauth',cookieOptions);
  D.need(flow && flow.expires>Date.now() && typeof req.query.code==='string','Google sign-in expired or was canceled.',401);
  let payload;
  try {
   if(verifyGoogle) payload=await verifyGoogle(req.query.code,flow);
   else {const {tokens}=await google.getToken({code:req.query.code,codeVerifier:flow.verifier});const ticket=await google.verifyIdToken({idToken:tokens.id_token,audience:config.GOOGLE_CLIENT_ID});payload=ticket.getPayload();}
  } catch {throw new D.Fault('Google could not verify this sign-in. Try again.',401);}
  D.need(payload?.email_verified===true && payload.hd===domain && payload.nonce===flow.nonce && typeof payload.sub==='string','Use your verified school Google account.',403);
  const email=normalize(payload.email), {user}=await approved(email);
  await repo(s=>{const link=s.links[email];D.need(link?.userId===user.id && (!link.googleSub || link.googleSub===payload.sub),'Google account does not match the approved account.',403);link.googleSub=payload.sub;});
  await issueSession(req,res,user,true);
 });
 return {repo};
}
module.exports={mountSchoolAuth,createRepository};
