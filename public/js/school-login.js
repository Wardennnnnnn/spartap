'use strict';
const $=id=>document.getElementById(id);
let challenge, email, purpose='login';
$('purpose').value=new URLSearchParams(location.search).get('reset')==='1'?'reset':'login';
function mode(){
 purpose=$('purpose').value; challenge=null; $('code-form').hidden=true;
 $('password-fields').hidden=purpose!=='reset';
 $('password').required=$('confirm-password').required=purpose==='reset';
 $('verify').textContent=purpose==='reset'?'Verify and reset password':'Verify and sign in';
}
$('purpose').onchange=mode;mode();
async function api(path,body) {
 const r=await fetch('/api/auth/'+path,{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 const data=await r.json();if(!r.ok)throw Error(data.error);return data;
}
api('options').then(options=>{
 $('google').hidden=!options.google;
 $('google-note').textContent=options.google?'':'Google sign-in is not available yet.';
 $('send').disabled=!options.otp;
 $('email').placeholder='name@'+options.domain;
 $('status').textContent=options.otp?'Email codes expire in 10 minutes. You have five attempts.':'Email sign-in is not available yet. Use username and password.';
}).catch(error=>$('status').textContent=error.message);
$('email-form').onsubmit=async event=>{
 event.preventDefault();$('send').disabled=true;
 try {
  email=$('email').value.trim().toLowerCase();
  const data=await api('otp/request',{email,purpose});challenge=data.challenge;
  $('status').textContent=data.message;$('code-form').hidden=false;$('code').value='';$('code').focus();
 }catch(error){$('status').textContent=error.message;}
 finally{$('send').disabled=false;}
};
$('code-form').onsubmit=async event=>{
 event.preventDefault();const button=event.submitter;button.disabled=true;
 try{
  if(purpose==='reset' && $('password').value!==$('confirm-password').value)throw Error('Passwords do not match.');
  const result=await api('otp/verify',{email,challenge,purpose,code:$('code').value,...(purpose==='reset'?{password:$('password').value}:{})});
  if(purpose==='reset'){ $('status').textContent=result.message; $('code-form').hidden=true; $('password').value=$('confirm-password').value=''; }
  else location.assign('/');
 }
 catch(error){$('status').textContent=error.message;}
 finally{button.disabled=false;}
};
