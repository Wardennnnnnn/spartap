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
    upstream.headers.set('x-forwarded-host', PUBLIC_HOST);
    upstream.headers.set('x-forwarded-proto', 'https');
    const clientIp = request.headers.get('cf-connecting-ip');
    if (clientIp) upstream.headers.set('x-forwarded-for', clientIp);
    else upstream.headers.delete('x-forwarded-for');
    // Return the upstream response directly to preserve cookies, streaming,
    // and WebSocket upgrades. Do not cache authenticated API responses.
    return fetch(upstream, {redirect: 'manual', cf: {cacheTtl: 0}});
  }
};
