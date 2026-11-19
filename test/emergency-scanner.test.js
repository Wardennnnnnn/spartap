'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function setup({registered=true,signedIn=true}={}){
 const nodes=new Map(),calls=[];let timer,starts=0,stops=0,scan;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{hidden:false,disabled:false,textContent:''});return nodes.get(id);};
 const state={registered,signedIn,event:{id:'event-1',name:'Drill',area:'Assembly'},network:false};
 const context={document:{getElementById:node},window:{},setInterval:fn=>{timer=fn;},crypto:{randomUUID:()=> 'test-scan-submission'},
  fetch:async(path,options)=>{
   calls.push({path,options});if(state.network)throw Error('Offline');
   let status=200,data;
   if(path==='/api/scanner'){if(!state.registered){status=401;data={error:'Register this browser after signing in.'};}else data={userId:'u1',name:'Representative',csrf:'device-csrf',event:state.event};}
   else if(path==='/api/session')data={user:state.signedIn?{id:'u1',name:'Representative'}:null,csrf:'session-csrf'};
   else if(path==='/api/scanner/checkin')data={name:'Student',status:'confirmed'};
   else if(path==='/api/scanner/revoke'){state.registered=false;data={ok:true};}
   return {ok:status===200,status,json:async()=>data};
  },Html5Qrcode:class{async start(camera,config,callback){starts++;scan=callback;}async stop(){stops++;}clear(){}}
 };
 vm.runInNewContext(fs.readFileSync('public/js/emergency-scanner.js','utf8'),context);await tick();
 return {state,node,calls,refresh:()=>timer(),scan:value=>scan(value),starts:()=>starts,stops:()=>stops};
}
test('registered signed-out phone scans without login and stops when event changes',async()=>{
 const f=await setup({signedIn:false});assert.equal(f.node('start').hidden,false);
 await f.node('start').onclick();assert.equal(f.starts(),1);
 await f.node('start').onclick();assert.equal(f.starts(),1);
 await f.scan('student-qr');assert.match(f.node('result').textContent,/Arrival recorded/);
 f.state.event={id:'event-2',name:'New drill',area:'New area'};await f.refresh();assert.equal(f.stops(),1);assert.equal(f.node('start').hidden,false);
 const before=f.calls.filter(c=>c.path.endsWith('/checkin')).length;await f.scan('old-camera-qr');assert.equal(f.calls.filter(c=>c.path.endsWith('/checkin')).length,before);
});
test('registered account can revoke; network failures do not become missing registration',async()=>{
 const f=await setup();assert.equal(f.node('revoke').hidden,false);assert.equal(f.node('register').hidden,true);
 f.state.network=true;await f.refresh();assert.match(f.node('status').textContent,/Reconnect/);assert.equal(f.node('register').hidden,true);
 f.state.network=false;await f.refresh();await f.node('revoke').onclick();assert.equal(f.node('register').hidden,false);assert.equal(f.node('start').hidden,true);
});
test('guest cannot register and no event means no camera',async()=>{
 const f=await setup({registered:false,signedIn:false});assert.equal(f.node('register').hidden,true);assert.equal(f.node('sign-in').hidden,false);
 f.state.registered=true;f.state.event=null;await f.refresh();assert.equal(f.node('start').hidden,true);assert.equal(f.starts(),0);
});
