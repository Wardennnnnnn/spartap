'use strict';
const $ = id => document.getElementById(id);
if ($('theme')) $('theme').onclick = () => window.SafeTapTheme?.toggle();
let access, reader, busy = false, last = '', lastAt = 0;
async function api(path, body, csrf) {
  const response = await fetch(path, {cache: 'no-store', ...(body ? {method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf}, body: JSON.stringify(body)} : {})});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error);
  return data;
}
async function stop() {
  if (reader) { const current = reader; reader = null; await current.stop().catch(() => {}); current.clear(); }
  $('stop').hidden = true;
}
async function refresh() {
  try {
    access = await api('/api/scanner');
    $('status').textContent = `Registered to ${access.name}`;
    $('setup').hidden = true;
    $('event').textContent = access.event ? `${access.event.name} · ${access.event.area}` : 'No active evacuation. This page checks automatically.';
    $('start').hidden = !access.event || !!reader;
    if (!access.event) await stop();
  } catch (error) {
    access = null;
    await stop();
    $('status').textContent = error.message;
    $('setup').hidden = false;
    $('start').hidden = true;
  }
}
async function manage(action) {
  try {
    const session = await api('/api/session');
    if (!session.user) throw new Error('Sign in first, then return to this page.');
    await api(`/api/scanner/${action}`, {}, session.csrf);
    await refresh();
  } catch (error) { $('status').textContent = error.message; }
}
$('register').onclick = () => manage('register');
$('revoke').onclick = () => manage('revoke');
$('stop').onclick = async () => { await stop(); await refresh(); };
$('start').onclick = async () => {
  try {
    await refresh();
    if (!access?.event) return;
    reader = new Html5Qrcode('camera');
    await reader.start({facingMode: 'environment'}, {fps: 8, qrbox: {width: 220, height: 220}}, async credential => {
      if (busy || !access?.event || credential === last && Date.now() - lastAt < 4000) return;
      busy = true;
      $('result').textContent = 'Saving arrival…';
      try {
        const result = await api('/api/scanner/checkin', {eventId: access.event.id, method: 'qr', credential, submissionId: crypto.randomUUID()}, access.csrf);
        last = credential; lastAt = Date.now();
        $('result').textContent = `${result.name}: ${result.status === 'duplicate' ? 'Already recorded' : 'Arrival recorded'}`;
      } catch (error) { $('result').textContent = `Not saved: ${error.message}`; }
      finally { busy = false; }
    }, () => {});
    $('start').hidden = true; $('stop').hidden = false;
  } catch (error) { $('result').textContent = error.message; await stop(); }
};
refresh();
setInterval(refresh, 10000);
