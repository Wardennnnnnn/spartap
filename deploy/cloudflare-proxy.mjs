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
    return fetch(upstream);
  }
};
