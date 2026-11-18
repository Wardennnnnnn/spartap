'use strict';
const {randomBytes, createHash} = require('node:crypto');
const domain = require('./domain');
const hash = value => createHash('sha256').update(value).digest('hex');
module.exports = function mountScanner({app, store, auth, io}) {
  const memory = new Map();
  const cookieOptions = {httpOnly: true, sameSite: 'strict', secure: process.env.COOKIE_SECURE === '1', path: '/', maxAge: 365 * 86400000};
  async function save(userId, row) {
    if (store.pool) {
      if (!row) await store.pool.execute('DELETE FROM scanner_devices WHERE userId = ?', [userId]);
      else await store.pool.execute('INSERT INTO scanner_devices (userId, tokenHash, csrf) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE tokenHash=VALUES(tokenHash), csrf=VALUES(csrf)', [userId, row.tokenHash, row.csrf]);
    } else if (row) memory.set(userId, row); else memory.delete(userId);
  }
  async function device(req) {
    const token = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('spartap_scanner='))?.slice(16);
    domain.need(token && /^[a-f0-9]{64}$/.test(token), 'Register this browser after signing in.', 401);
    let row;
    if (store.pool) {
      const [rows] = await store.pool.execute('SELECT userId, csrf FROM scanner_devices WHERE tokenHash = ?', [hash(token)]);
      row = rows[0];
    } else for (const [userId, value] of memory) if (value.tokenHash === hash(token)) row = {...value, userId};
    const user = row && await store.findUser('id', row.userId);
    domain.need(user?.active, 'Scanner registration is missing or revoked.', 401);
    return {user, csrf: row.csrf};
  }
  const route = (method, path, fn) => app[method](path, async (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    try { await fn(req, res); } catch (error) { next(error); }
  });
  route('post', '/api/scanner/register', async (req, res) => {
    const {user, session} = await auth.authenticate(req);
    domain.need(auth.originOK(req) && req.headers['x-csrf-token'] === session.csrf, 'Session verification failed.', 403);
    const token = randomBytes(32).toString('hex'), csrf = randomBytes(24).toString('hex');
    await save(user.id, {tokenHash: hash(token), csrf});
    res.cookie('spartap_scanner', token, cookieOptions).json({ok: true});
  });
  route('post', '/api/scanner/revoke', async (req, res) => {
    const {user, session} = await auth.authenticate(req);
    domain.need(auth.originOK(req) && req.headers['x-csrf-token'] === session.csrf, 'Session verification failed.', 403);
    const target = req.body.userId || user.id;
    domain.need(target === user.id || user.role === 'admin', 'Administrator required.', 403);
    await save(target, null);
    res.json({ok: true});
  });
  route('get', '/api/scanner', async (req, res) => {
    const {user, csrf} = await device(req);
    const db = await store.read(['events']);
    res.json({name: user.name, csrf, event: db.events.find(e => e.status === 'active') || null});
  });
  route('post', '/api/scanner/checkin', async (req, res) => {
    const {user, csrf} = await device(req);
    domain.need(auth.originOK(req) && req.headers['x-csrf-token'] === csrf, 'Scanner verification failed.', 403);
    domain.need(['qr', 'nfc'].includes(req.body.method), 'Scan a QR or NFC credential.');
    const result = await store.transact(async db => {
      const current = db.users.find(u => u.id === user.id && u.active);
      domain.need(current, 'Account inactive.', 401);
      const event = db.events.find(e => e.id === req.body.eventId && e.status === 'active');
      domain.need(event, 'No active evacuation. Refresh the scanner.', 409);
      return domain.checkin(db, current, {...req.body, capturedAt: domain.now()});
    });
    io.emit('invalidate', {at: domain.now()});
    res.json(result);
  });
};
