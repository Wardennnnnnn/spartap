'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');

test('Cloudflare proxy enforces public origin and preserves bodies, cookies and upgrades', async t => {
  const proxy = (await import('../deploy/cloudflare-proxy.mjs')).default;
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let forwarded;
  let response = new Response('ok', {headers: {'set-cookie': 'session=test; Secure; HttpOnly'}});
  globalThis.fetch = async request => { forwarded = request; return response; };
  assert.equal((await proxy.fetch(new Request('https://other.example/'))).status, 404);
  const redirect = await proxy.fetch(new Request('http://spartap.terincorp.com/path?a=1'));
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.get('location'), 'https://spartap.terincorp.com/path?a=1');
  assert.equal((await proxy.fetch(new Request('https://spartap.terincorp.com/api/login', {
    method: 'POST', headers: {origin: 'https://foreign.example'}
  }))).status, 403);
  assert.equal(forwarded, undefined);
  const result = await proxy.fetch(new Request('https://spartap.terincorp.com/api/login?a=1', {
    method: 'POST',
    headers: {origin: 'https://spartap.terincorp.com', cookie: 'session=test',
      'x-forwarded-host': 'spoof.example', 'x-forwarded-for': 'spoof', 'cf-connecting-ip': '192.0.2.50'},
    body: '{"test":true}'
  }));
  assert.equal(forwarded.url, 'https://spartap-rde4.onrender.com/api/login?a=1');
  assert.equal(forwarded.headers.get('origin'), 'https://spartap-rde4.onrender.com');
  assert.equal(forwarded.headers.get('x-forwarded-host'), 'spartap-rde4.onrender.com');
  assert.equal(forwarded.headers.get('x-forwarded-for'), '192.0.2.50');
  assert.equal(forwarded.headers.get('cookie'), 'session=test');
  assert.equal(await forwarded.text(), '{"test":true}');
  assert.match(result.headers.get('set-cookie'), /Secure; HttpOnly/);
  response = {status: 101, webSocket: {}};
  assert.equal(await proxy.fetch(new Request('https://spartap.terincorp.com/socket.io/?EIO=4&transport=websocket', {
    headers: {upgrade: 'websocket', origin: 'https://spartap.terincorp.com', 'sec-websocket-extensions': 'permessage-deflate'}
  })), response);
  assert.equal(forwarded.headers.get('sec-websocket-extensions'), null);
});

test('app shell recovers from gateway failures but never replays writes or upgrades', async t => {
  const proxy = (await import('../deploy/cloudflare-proxy.mjs')).default;
  const originalFetch = globalThis.fetch;
  const originalTimeout = globalThis.setTimeout;
  t.after(() => { globalThis.fetch = originalFetch; globalThis.setTimeout = originalTimeout; });
  globalThis.setTimeout = (callback, delay) => delay === 5000
    ? originalTimeout(callback, 0) : originalTimeout(callback, delay);
  let calls = 0;
  let discarded;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) {
      discarded = new Response('gateway', {status: 502});
      return discarded;
    }
    return new Response('SparTap', {headers: {'set-cookie': 'session=preserved'}});
  };
  const recovered = await proxy.fetch(new Request('https://spartap.terincorp.com/'));
  assert.equal(calls, 2);
  assert.equal(discarded.bodyUsed, true);
  assert.equal(await recovered.text(), 'SparTap');
  assert.equal(recovered.headers.get('set-cookie'), 'session=preserved');

  for (const request of [
    new Request('https://spartap.terincorp.com/api/login', {method: 'POST', body: '{}'}),
    new Request('https://spartap.terincorp.com/api/state'),
    new Request('https://spartap.terincorp.com/', {headers: {upgrade: 'websocket'}})
  ]) {
    calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('gateway', {status: 502}); };
    assert.equal((await proxy.fetch(request)).status, 502);
    assert.equal(calls, 1);
  }

  calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('connection failed'); };
  const unavailable = await proxy.fetch(new Request('https://spartap.terincorp.com/'));
  assert.equal(calls, 12);
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.headers.get('cache-control'), 'no-store');

  calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('forbidden', {status: 403}); };
  assert.equal((await proxy.fetch(new Request('https://spartap.terincorp.com/'))).status, 403);
  assert.equal(calls, 1);
});
