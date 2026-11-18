'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {MemoryStore}=require('../src/store');
const D=require('../src/domain');
const {verifyPassword}=require('../src/security');
const {mountSchoolAuth}=require('../src/school-auth');
const {request}=require('./helpers/request');
function setup() {
 const store=new MemoryStore(D.baseDb({demo:true,password:'SafeTapDemo123!'}));
 const user=store.db.users.find(u=>u.role==='admin'), app=express(), sent=[];
 app.use(express.json());
 const auth=mountSchoolAuth({app,store,config:{SCHOOL_EMAIL_DOMAIN:'g.batstate-u.edu.ph',RESEND_API_KEY:'test',EMAIL_FROM:'test@example.com',GOOGLE_CLIENT_ID:'test',GOOGLE_CLIENT_SECRET:'test',PUBLIC_APP_URL:'https://spartap.example'},
  authenticate:async req=>{D.need(req.headers['x-admin']==='yes','Sign in.',401);return {user,session:{csrf:'test-csrf'}};},
  originOK:req=>!req.headers.origin || req.headers.origin==='https://spartap.example',
  issueSession:async(req,res,u,redirect)=>redirect?res.redirect('/'):res.json({userId:u.id}),
  sendEmail:async(email,code)=>sent.push({email,code}),
  verifyGoogle:async(code,flow)=>({email:'staff@g.batstate-u.edu.ph',sub:code,hd:'g.batstate-u.edu.ph',email_verified:true,nonce:flow.nonce})});
 app.use((error,req,res,next)=>res.status(error.status||500).json({error:error.message}));
 const req=async(path,body,headers={})=>{const r=await request(app,{path:'/api/auth/'+path,method:body?'POST':'GET',headers,body});return {...r,data:r.body.startsWith('{')?JSON.parse(r.body):null};};
 const link=()=>req('links',{email:'staff@g.batstate-u.edu.ph',userId:user.id},{'x-admin':'yes','x-csrf-token':'test-csrf'});
 return {store,user,sent,repo:auth.repo,req,link};
}
test('admin approval, OTP single use, resend, limits, purpose separation and password reset',async()=>{
 const {store,user,sent,repo,req,link}=setup();
 assert.equal((await req('links')).status,401);
 assert.equal((await req('links',{email:'staff@g.batstate-u.edu.ph',userId:user.id},{'x-admin':'yes'})).status,403);
 assert.equal((await link()).status,200);
 assert.equal((await req('otp/request',{email:'any@gmail.com'})).status,400);
 assert.equal((await req('otp/request',{email:'outsider@g.batstate-u.edu.ph'})).status,200);
 assert.equal(sent.length,0);
 await repo(s=>{s.limits={};});
 const first=await req('otp/request',{email:'staff@g.batstate-u.edu.ph'});
 assert.equal(first.status,200);assert.equal(sent.length,1);
 assert.equal((await req('otp/request',{email:'staff@g.batstate-u.edu.ph'})).status,429);
 const payload={email:sent[0].email,code:sent[0].code,challenge:first.data.challenge};
 assert.equal((await req('otp/verify',{...payload,purpose:'reset',password:'NewPassword123!'})).status,401);
 assert.equal((await req('otp/verify',payload)).status,200);
 assert.equal((await req('otp/verify',payload)).status,401);
 await repo(s=>{s.limits={};});
 const reset=await req('otp/request',{email:payload.email,purpose:'reset'});
 const token='a'.repeat(64);await store.sessions.set(token,{userId:user.id,expires:Date.now()+60000});
 const result=await req('otp/verify',{email:payload.email,purpose:'reset',code:sent.at(-1).code,challenge:reset.data.challenge,password:'NewPassword123!'});
 assert.equal(result.status,200);
 assert.ok(verifyPassword('NewPassword123!',(await store.findUser('id',user.id)).passwordHash));
 assert.equal(await store.sessions.get(token),undefined);
});
test('OTP locks after five guesses, expires and is invalidated by removal or resend',async()=>{
 const {req,link,repo,sent,user}=setup();await link();
 const send=()=>req('otp/request',{email:'staff@g.batstate-u.edu.ph'});
 let r=await send(),old=sent.at(-1).code;
 for(let i=0;i<5;i++)assert.equal((await req('otp/verify',{email:sent[0].email,code:'wrong',challenge:r.data.challenge})).status,401);
 assert.equal((await req('otp/verify',{email:sent[0].email,code:old,challenge:r.data.challenge})).status,401);
 await repo(s=>{s.limits={};});r=await send();
 await repo(s=>{s.pending['login:staff@g.batstate-u.edu.ph'].expires=0;});
 assert.equal((await req('otp/verify',{email:sent[0].email,code:sent.at(-1).code,challenge:r.data.challenge})).status,401);
 await repo(s=>{s.limits={};});r=await send();const challenge=r.data.challenge;
 await repo(s=>{s.limits={};});await send();
 assert.equal((await req('otp/verify',{email:sent[0].email,code:sent.at(-1).code,challenge})).status,401);
 await req('links',{email:sent[0].email,userId:user.id,remove:true},{'x-admin':'yes','x-csrf-token':'test-csrf'});
 assert.equal((await req('otp/verify',{email:sent[0].email,code:sent.at(-1).code,challenge:r.data.challenge})).status,401);
});
test('Google requires browser-bound state, approved email and stable subject; callback is single use',async()=>{
 const {req,link}=setup();await link();
 const start=await req('google/start');assert.equal(start.status,302);
 const url=new URL(start.headers.location),state=url.searchParams.get('state');
 assert.equal(url.searchParams.get('hd'),'g.batstate-u.edu.ph');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 const cookie=[start.headers['set-cookie']].flat()[0].split(';')[0];
 assert.equal((await req(`google/callback?state=${state}&code=subject`)).status,403);
 assert.equal((await req(`google/callback?state=${state}&code=subject`,undefined,{cookie})).status,302);
 assert.equal((await req(`google/callback?state=${state}&code=subject`,undefined,{cookie})).status,401);
 const second=await req('google/start'),secondUrl=new URL(second.headers.location),secondCookie=[second.headers['set-cookie']].flat()[0].split(';')[0];
 assert.equal((await req(`google/callback?state=${secondUrl.searchParams.get('state')}&code=different-subject`,undefined,{cookie:secondCookie})).status,403);
});
