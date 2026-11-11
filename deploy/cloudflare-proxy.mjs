const PUBLIC_HOST = 'spartap.terincorp.com';
const RENDER_HOST = 'spartap-rde4.onrender.com';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.hostname !== PUBLIC_HOST) return new Response('Not found', {status: 404});
    if (url.protocol !== 'https:') {
      url.protocol = 'https:';
      return Response.redirect(url.toString(), 308);
    }
    url.hostname = RENDER_HOST;
    const upstream = new Request(url.toString(), request);
    upstream.headers.delete('host');
    // Avoid negotiating compression across two independent WebSocket hops.
    upstream.headers.delete('sec-websocket-extensions');
    upstream.headers.set('x-forwarded-proto', 'https');
    const clientIp = request.headers.get('cf-connecting-ip');
    if (clientIp) upstream.headers.set('x-forwarded-for', clientIp);
    else upstream.headers.delete('x-forwarded-for');
    // Validate browser origin before translating it for the Render origin.
    const origin = request.headers.get('origin');
    if (origin && origin !== `https://${PUBLIC_HOST}`) {
      return new Response('Invalid request origin.', {status: 403});
    }
    if (origin) upstream.headers.set('origin', `https://${RENDER_HOST}`);
    upstream.headers.set('x-forwarded-host', RENDER_HOST);
    // Only the app shell is safe to replay. Never retry API calls, submissions,
    // or upgrades: a failed response does not prove a write was not committed.
    const isShell = request.method === 'GET' && !request.headers.has('upgrade') &&
      (url.pathname === '/' || url.pathname === '/index.html');
    if (!isShell) return fetch(upstream);

    const deadline = Date.now() + 65_000;
    for (let attempt = 0; attempt < 12; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.min(10_000, deadline - Date.now()));
      let response;
      try {
        response = await fetch(new Request(upstream, {signal: controller.signal}));
      } catch {
        response = new Response('SparTap is temporarily unavailable. Please try again shortly.', {
          status: 503, headers: {'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'no-store', 'retry-after': '5'}
        });
      } finally {
        clearTimeout(timeout);
      }
      if (![502, 503, 504].includes(response.status)) return response;
      const remaining = deadline - Date.now();
      if (attempt === 11 || remaining <= 5_000) {
        console.warn(JSON.stringify({event: 'origin_unavailable', status: response.status, attempts: attempt + 1}));
        return response;
      }
      // Release each failed body before opening another upstream connection.
      await response.body?.cancel();
      await new Promise(resolve => setTimeout(resolve, 5_000));
    }
  }
};
