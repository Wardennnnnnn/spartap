'use strict';
const $ = id => document.getElementById(id);
if ($('theme')) $('theme').onclick = () => window.SafeTapTheme?.toggle();
let access = null, session = null, reader = null, cameraTask = null;
let checking = false, managing = false, busy = false, last = '', lastAt = 0;
let generation = 0, confirmed = false;
async function api(path, body, csrf) {
  const response = await fetch(path, {cache: 'no-store', ...(body ? {method: 'POST', headers: {'Content-Type': 'application/json', 'X-CSRF-Token': csrf}, body: JSON.stringify(body)} : {})});
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error(data.error), {status: response.status});
  return data;
}
function controls() {
  const running = Boolean(reader || cameraTask);
  $('start').hidden = !access?.event || !confirmed || running;
  $('start').disabled = checking || managing;
  $('stop').hidden = !running;
  $('stop').disabled = Boolean(cameraTask);
  $('setup').hidden = Boolean(access) && !session?.user;
  $('sign-in').hidden = Boolean(session?.user);
  $('register').hidden = !session?.user || access?.userId === session.user.id;
  $('register').disabled = managing || checking;
  $('revoke').hidden = !session?.user || access?.userId !== session.user.id;
  $('revoke').disabled = managing || checking;
  $('setup-note').textContent = access
    ? session?.user && access.userId !== session.user.id
      ? `This browser is registered to ${access.name}. Registering it to ${session.user.name} will replace this browser’s scanner access.`
      : session?.user ? 'Registered to your account. Revoke this scanner if you no longer want this browser to record arrivals.' : 'This browser is registered. Sign in to manage its registration.'
    : session?.user
      ? `Signed in as ${session.user.name}. Register this browser once before using it as an emergency scanner.`
      : 'Sign in once to register this browser. Registered browsers can scan without signing in during an active evacuation.';
}
async function stop() {
  generation++;
  const pending = cameraTask;
  if (pending) await pending.catch(() => {});
  const current = reader; reader = null;
  if (current) {
    try { await current.stop(); } catch {}
    try { current.clear(); } catch {}
  }
  controls();
}
async function refresh() {
  if (checking) return;
  checking = true; controls();
  try {
    // Scanner access remains independent of the normal account login session.
    const next = await api('/api/scanner');
    const changed = access?.event?.id !== next.event?.id;
    access = next; confirmed = true;
    if (changed) { await stop(); last = ''; lastAt = 0; $('result').textContent = ''; }
    $('status').textContent = `Registered to ${access.name}`;
    $('event').textContent = access.event ? `${access.event.name} · ${access.event.area}` : 'No active evacuation. Scanning becomes available when an event starts.';
    if (!access.event && reader) await stop();
  } catch (error) {
    confirmed = false;
    if (error.status === 401 || error.status === 403) {
      access = null; await stop(); $('status').textContent = error.message; $('event').textContent = '';
    } else {
      await stop();
      $('status').textContent = 'Cannot verify scanner status. Reconnect to continue; you do not need to register again.';
    }
  }
  try { session = await api('/api/session'); } catch { /* A network failure does not revoke registration. */ }
  checking = false; controls();
}
async function manage(action) {
  if (managing) return;
  managing = true; controls();
  try {
    session = await api('/api/session');
    if (!session.user) throw Error('Sign in first, then return to Scanner setup.');
    await stop();
    await api(`/api/scanner/${action}`, {}, session.csrf);
    await refresh();
  } catch (error) { $('status').textContent = error.message; }
  finally { managing = false; controls(); }
}
$('register').onclick = () => manage('register');
$('revoke').onclick = () => manage('revoke');
$('stop').onclick = async () => { await stop(); controls(); };
$('start').onclick = async () => {
  if (reader || cameraTask || checking || managing) return;
  await refresh();
  if (!access?.event || !confirmed || reader || cameraTask) return;
  const eventId = access.event.id, csrf = access.csrf, captureGeneration = ++generation;
  const current = new Html5Qrcode('camera');
  reader = current;
  const task = current.start({facingMode: 'environment'}, {fps: 8, qrbox: {width: 220, height: 220}}, async credential => {
    if (busy || !confirmed || generation !== captureGeneration || access?.event?.id !== eventId || credential === last && Date.now() - lastAt < 4000) return;
    busy = true; $('result').textContent = 'Saving arrival…';
    try {
      const result = await api('/api/scanner/checkin', {eventId, method: 'qr', credential, submissionId: crypto.randomUUID()}, csrf);
      if (generation === captureGeneration) {
        last = credential; lastAt = Date.now();
        $('result').textContent = `${result.name}: ${result.status === 'duplicate' ? 'Already recorded' : 'Arrival recorded'}`;
      }
    } catch (error) {
      if (generation === captureGeneration) $('result').textContent = `Not confirmed: ${error.message}. Retry after checking your connection.`;
    } finally { busy = false; }
  }, () => {});
  cameraTask = task; controls();
  try { await task; }
  catch (error) {
    if (reader === current) { reader = null; try { current.clear(); } catch {} }
    $('result').textContent = `Camera could not start: ${error.message}. Allow camera access, then try again.`;
  } finally { if (cameraTask === task) cameraTask = null; controls(); }
};
refresh();
setInterval(refresh, 10000);
