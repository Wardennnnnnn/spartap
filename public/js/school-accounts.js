'use strict';
const $=id=>document.getElementById(id);
let csrf;
async function load(){
 const session=await (await fetch('/api/session',{cache:'no-store'})).json();
 if(session.user?.role!=='admin')throw Error('Sign in as an administrator to manage email accounts.');
 csrf=session.csrf;
 const r=await fetch('/api/auth/links',{cache:'no-store'}),data=await r.json();if(!r.ok)throw Error(data.error);
 $('user').replaceChildren(...data.users.map(u=>new Option(`${u.name} (${u.username})${u.active?'':' · disabled'}`,u.id)));
 $('links').replaceChildren();
 for(const link of data.links){
  const row=document.createElement('p'),label=document.createElement('span'),button=document.createElement('button');
  label.textContent=`${data.users.find(u=>u.id===link.userId)?.name||'Account'} — ${link.email} `;
  button.className='btn';button.textContent='Remove email';button.onclick=()=>save({...link,remove:true});row.append(label,button);$('links').append(row);
 }
 $('link-form').hidden=false;$('status').textContent=data.links.length?'Linked school emails':'No school emails linked yet.';
}
async function save(body){
 try{
  const r=await fetch('/api/auth/links',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:JSON.stringify(body)});
  const data=await r.json();if(!r.ok)throw Error(data.error);await load();
 }catch(error){$('status').textContent=error.message;}
}
$('link-form').onsubmit=async event=>{event.preventDefault();event.submitter.disabled=true;await save({email:$('email').value,userId:$('user').value});event.submitter.disabled=false;};
load().catch(error=>$('status').textContent=error.message);
