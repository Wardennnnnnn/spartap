'use strict';
globalThis.SafeTapRegistrations = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function view() {
    return `<div class="page-heading"><div><h1>Registrations</h1><p>Manage school emails, scanner access, and the student directory.</p></div></div><div id="registrations-root"><div class="notice info" role="status">Loading registrations…</div></div>`;
  }
  async function mount(state) {
    const root = document.getElementById('registrations-root');
    if (!root || state.user?.role !== 'admin') return;
    let busy = false;
    async function api(path, body) {
      const response = await fetch('/api/' + path, {cache:'no-store', ...(body ? {method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':state.csrf},body:JSON.stringify(body)} : {})});
      const result = await response.json(); if (!response.ok) throw Error(result.error); return result;
    }
    const notice = (message, error = false) => {
      const node = root.querySelector('#registration-status');
      if (node) {node.textContent = message; node.className = `notice ${error ? 'danger' : 'info'}`;}
    };
    try {
      const [accounts, scans] = await Promise.all([api('auth/links'), api('scanner/devices')]);
      if (!root.isConnected) return;
      const users = accounts.users, links = new Map(accounts.links.map(v => [v.userId,v.email])), devices = new Map(scans.devices.map(v => [v.userId,v]));
      const students = state.data.students || [];
      root.innerHTML = `<div class="metrics registration-totals"><article class="metric"><div class="metric-top">Registered scanners</div><strong>${devices.size}</strong></article><article class="metric"><div class="metric-top">Linked school emails</div><strong>${links.size}</strong></article><article class="metric"><div class="metric-top">Registered students</div><strong>${students.length}</strong></article></div>
      <p class="notice info" id="registration-status" role="status" aria-live="polite">One school email and one registered scanner browser per account.</p>
      <section class="card"><div class="card-header"><h2>Link a school email</h2></div><div class="card-body"><form id="registration-link"><div class="form-grid"><label class="field">SparTap account<select name="userId" required>${users.map(u=>`<option value="${esc(u.id)}">${esc(u.name)} (${esc(u.username)})${u.active?'':' · disabled'}</option>`).join('')}</select></label><label class="field">School email<input name="email" type="email" required maxlength="191" autocomplete="off" placeholder="name@g.batstate-u.edu.ph"></label></div><button class="btn primary" type="submit">Link school email</button></form></div></section>
      <section class="card"><div class="card-header"><h2>Accounts & scanner devices</h2></div><div class="table-wrap"><table><thead><tr><th>Account</th><th>School email</th><th>Scanner browser</th><th>Actions</th></tr></thead><tbody>${users.map(u=>`<tr><td><strong>${esc(u.name)}</strong><small>${esc(u.username)} · ${u.active?'Active':'Disabled'}</small></td><td>${links.has(u.id)?esc(links.get(u.id)):'<span class="muted">Not linked</span>'}</td><td><span class="badge ${devices.has(u.id)?'green':''}">${devices.has(u.id)?'Registered':'Not registered'}</span></td><td><div class="actions">${links.has(u.id)?`<button class="btn small" data-reg-remove="${esc(u.id)}">Remove email</button>`:''}${devices.has(u.id)?`<button class="btn small" data-reg-revoke="${esc(u.id)}">Revoke scanner</button>`:''}</div></td></tr>`).join('')}</tbody></table></div></section>
      <section class="card"><div class="card-header"><h2>Registered students</h2></div><div class="filter-row"><label class="field registration-search">Find a student<input id="registration-search" type="search" placeholder="Name or student number" autocomplete="off"></label><span class="muted" id="registration-count">${students.length} students</span></div><div class="table-wrap"><table><thead><tr><th>Student</th><th>Student number</th><th>Block</th><th>Status</th></tr></thead><tbody id="registration-students"></tbody></table></div></section>
      <section class="card"><div class="card-header"><h2>Presentation reset</h2></div><div class="card-body"><p>Clear attendance and evacuation history, linked school emails, and registered scanners. Keep accounts, students, blocks, and rooms. A server-side backup is saved first.</p><form id="presentation-reset"><label class="field">Type RESET PRESENTATION to confirm<input name="confirm" required autocomplete="off" pattern="RESET PRESENTATION" placeholder="RESET PRESENTATION"></label><button class="btn danger" type="submit">Back up & reset presentation data</button></form><p class="muted">After reset, link school emails and register scanner browsers again. Clear old offline scan queues on presentation phones.</p></div></section>`;
      function studentRows(query = '') {
        const found = students.filter(s => `${s.name} ${s.studentNumber}`.toLowerCase().includes(query.toLowerCase()));
        root.querySelector('#registration-count').textContent = `${found.length} of ${students.length} students`;
        root.querySelector('#registration-students').innerHTML = found.map(s=>{
          const block=state.data.blocks.find(b=>b.id===s.blockId);
          return `<tr><td><strong>${esc(s.name)}</strong></td><td>${esc(s.studentNumber)}</td><td>${esc(block ? `${block.program} ${block.code}` : '—')}</td><td>${s.active?'Active':'Disabled'}</td></tr>`;
        }).join('') || '<tr><td colspan="4">No students found.</td></tr>';
      }
      studentRows();root.querySelector('#registration-search').oninput=e=>studentRows(e.target.value);
      async function mutate(path, body, button) {
        if (busy) return; busy=true;button.disabled=true;
        try {const result=await api(path,body);await mount(state);if(result.backupId){const status=document.getElementById('registration-status');if(status)status.textContent=`Reset completed. Backup reference: ${result.backupId}. Accounts and students were retained.`;}}
        catch(error){notice(error.message,true);}finally{busy=false;button.disabled=false;}
      }
      root.querySelector('#registration-link').onsubmit=e=>{e.preventDefault();mutate('auth/links',Object.fromEntries(new FormData(e.target)),e.submitter);};
      root.querySelector('#presentation-reset').onsubmit=e=>{e.preventDefault();mutate('presentation/reset',Object.fromEntries(new FormData(e.target)),e.submitter);};
      root.querySelectorAll('[data-reg-remove]').forEach(button=>button.onclick=()=>mutate('auth/links',{userId:button.dataset.regRemove,email:links.get(button.dataset.regRemove),remove:true},button));
      root.querySelectorAll('[data-reg-revoke]').forEach(button=>button.onclick=()=>mutate('scanner/revoke',{userId:button.dataset.regRevoke},button));
    } catch(error) {root.innerHTML=`<div class="notice danger" role="alert">${esc(error.message)}</div>`;}
  }
  return {view,mount};
})();
