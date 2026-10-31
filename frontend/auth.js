// Access control for the JouleLab website.
//  * HOST defaults to 127.0.0.1: only this computer can open the site.
//  * Set JOULELAB_PASSWORD to require a login. It is REQUIRED when HOST makes the site
//    reachable from other machines (e.g. HOST=0.0.0.0); the server refuses to start otherwise.
//  * The login cookie is HMAC-signed, HttpOnly and SameSite=Strict (blocks cross-site requests).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PASSWORD = process.env.JOULELAB_PASSWORD || '';
const SECRET = process.env.JOULELAB_SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const MAX_AGE_S = 12 * 3600;
const COOKIE = 'jl_session';
const isLoopbackHost = h => ['127.0.0.1', 'localhost', '::1'].includes(h);

const sign = v => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const sameText = (a, b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());

function readCookie(req) {
  const m = (req.headers.cookie || '').split(/;\s*/).find(c => c.startsWith(COOKIE + '='));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : '';
}
function loggedIn(req) {
  if (!PASSWORD) return true;
  const [exp, mac] = readCookie(req).split('.');
  return !!exp && !!mac && mac.length === 64 && sameText(mac, sign(exp)) && Number(exp) > Date.now() / 1000;
}

const failures = new Map(); // ip -> [count, firstAt]
function tooMany(ip) {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f[1] > 15 * 60e3) { failures.delete(ip); return false; }
  return f[0] >= 10;
}

function checkStartup(host) {
  if (!isLoopbackHost(host) && !PASSWORD) {
    console.error(`Refusing to listen on ${host} without a password: other computers could open JouleLab.\n` +
      'Set JOULELAB_PASSWORD=<something long>, or leave HOST unset to stay on this computer only.');
    process.exit(1);
  }
}

function install(app) {
  if (!PASSWORD) return;
  app.get('/login', (req, res) => res.render('login', { error: '' }));
  app.post('/login', require('express').urlencoded({ extended: false, limit: '4kb' }), (req, res) => {
    const ip = req.socket.remoteAddress || '?';
    if (tooMany(ip)) return res.status(429).render('login', { error: 'Too many attempts. Wait 15 minutes.' });
    if (!sameText(String((req.body || {}).password || ''), PASSWORD)) {
      const f = failures.get(ip) || [0, Date.now()]; f[0]++; failures.set(ip, f);
      return res.status(401).render('login', { error: 'Wrong password.' });
    }
    failures.delete(ip);
    const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE_S);
    res.setHeader('Set-Cookie', `${COOKIE}=${exp}.${sign(exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_S}` + (req.secure ? '; Secure' : ''));
    res.redirect('/');
  });
  app.get('/logout', (req, res) => { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; Max-Age=0`); res.redirect('/login'); });
  app.use((req, res, next) => {
    if (loggedIn(req) || req.path.startsWith('/css/')) return next();
    if (req.path.startsWith('/backend/')) return res.status(401).json({ detail: 'Log in first.' });
    res.redirect('/login');
  });
}

// The backend accepts proxied requests only with this key (backend/data/proxy.key, created by the backend).
let proxyKey = process.env.JOULELAB_PROXY_KEY || '';
function getProxyKey() {
  if (proxyKey) return proxyKey;
  const file = process.env.PROXY_KEY_FILE || path.join(__dirname, '..', 'backend', 'data', 'proxy.key');
  try { proxyKey = fs.readFileSync(file, 'utf8').trim(); } catch (e) { /* backend not started yet */ }
  return proxyKey;
}

module.exports = { install, loggedIn, checkStartup, getProxyKey, enabled: !!PASSWORD };
