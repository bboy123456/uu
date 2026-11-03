const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32);
const DATA_DIR = path.join(__dirname, '.data');
const DATA_FILE = path.join(DATA_DIR, 'visits.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const REDIS_KEY = 'loading-page:visits';

fs.mkdirSync(DATA_DIR, { recursive: true });
let visits = loadVisits();
let writeTimer = null;

function loadVisits() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(data) ? data : [];
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('读取访问数据失败:', error.message);
    return [];
  }
}

function saveSoon() {
  if (REDIS_URL && REDIS_TOKEN) return saveRemoteVisits();
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    const temp = `${DATA_FILE}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(visits, null, 2));
    fs.renameSync(temp, DATA_FILE);
  }, 200);
}

async function redis(command) {
  const response = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command)
  });
  if (!response.ok) throw new Error(`Redis 请求失败: ${response.status}`);
  const data = await response.json();
  return data.result;
}

async function loadRemoteVisits() {
  if (!REDIS_URL || !REDIS_TOKEN) return visits;
  const raw = await redis(['GET', REDIS_KEY]);
  if (!raw) return [];
  try {
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function saveRemoteVisits() {
  if (!REDIS_URL || !REDIS_TOKEN) return;
  await redis(['SET', REDIS_KEY, JSON.stringify(visits)]);
}

function send(res, status, body, type = 'application/json; charset=utf-8', headers = {}) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 64 * 1024) reject(new Error('请求内容过大'));
    });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch { reject(new Error('JSON 格式错误')); }
    });
    req.on('error', reject);
  });
}

function safeText(value, max = 160) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : req.socket.remoteAddress || '';
  return hash(`${SESSION_SECRET}:${ip}`);
}

function parseCookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(item => item.trim().split('=').map(decodeURIComponent)).filter(x => x.length === 2));
}

function isAdmin(req) {
  const token = parseCookies(req).admin_session;
  if (!token) return false;
  const [expires, signature] = token.split('.');
  if (!expires || !signature || Number(expires) < Date.now()) return false;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(expires).digest('base64url');
  const supplied = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && crypto.timingSafeEqual(supplied, wanted);
}

function serveFile(res, file, type) {
  fs.readFile(path.join(PUBLIC_DIR, file), (error, data) => {
    if (error) return send(res, 404, { error: 'Not found' });
    send(res, 200, data, type);
  });
}

function normalizedVisit(body, req) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    visitorId: safeText(body.visitorId, 64),
    deviceKey: safeText(body.deviceKey, 64),
    startedAt: now,
    lastSeenAt: now,
    durationSeconds: 0,
    status: 'online',
    browser: safeText(body.browser, 80),
    os: safeText(body.os, 80),
    deviceType: safeText(body.deviceType, 20),
    screen: safeText(body.screen, 32),
    viewport: safeText(body.viewport, 32),
    language: safeText(body.language, 32),
    timezone: safeText(body.timezone, 64),
    referrer: safeText(body.referrer, 300),
    ipHash: clientIp(req)
  };
}

function refreshStatuses() {
  const now = Date.now();
  for (const visit of visits) {
    if (visit.status === 'online' && now - Date.parse(visit.lastSeenAt) > 45000) visit.status = 'offline';
  }
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (req.method === 'GET' && url.pathname === '/') return serveFile(res, 'index.html', 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/app.js') return serveFile(res, 'app.js', 'text/javascript; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/admin') return serveFile(res, 'admin.html', 'text/html; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/admin.js') return serveFile(res, 'admin.js', 'text/javascript; charset=utf-8');

    if (req.method === 'POST' && url.pathname === '/api/visit/start') {
      visits = await loadRemoteVisits();
      const body = await readBody(req);
      if (!body.visitorId) return send(res, 400, { error: '缺少访客 ID' });
      const visit = normalizedVisit(body, req);
      visits.unshift(visit);
      if (visits.length > 10000) visits = visits.slice(0, 10000);
      await saveSoon();
      return send(res, 201, { visitId: visit.id });
    }

    if (req.method === 'POST' && /^\/api\/visit\/[\w-]+\/(heartbeat|end)$/.test(url.pathname)) {
      visits = await loadRemoteVisits();
      const [, , , id, action] = url.pathname.split('/');
      const body = await readBody(req);
      const visit = visits.find(item => item.id === id);
      if (!visit) return send(res, 404, { error: '记录不存在' });
      const elapsed = Math.max(0, Math.min(Number(body.durationSeconds) || 0, 7 * 24 * 3600));
      visit.durationSeconds = Math.max(visit.durationSeconds, Math.round(elapsed));
      visit.lastSeenAt = new Date().toISOString();
      visit.status = action === 'end' ? 'offline' : 'online';
      await saveSoon();
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/login') {
      const body = await readBody(req);
      const supplied = Buffer.from(String(body.password || ''));
      const expected = Buffer.from(ADMIN_PASSWORD);
      const valid = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
      if (!valid) return send(res, 401, { error: '密码错误' });
      const expires = String(Date.now() + 12 * 60 * 60 * 1000);
      const signature = crypto.createHmac('sha256', SESSION_SECRET).update(expires).digest('base64url');
      const token = `${expires}.${signature}`;
      const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
      return send(res, 200, { ok: true }, 'application/json; charset=utf-8', {
        'Set-Cookie': `admin_session=${token}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=43200`
      });
    }

    if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
      return send(res, 200, { ok: true }, 'application/json; charset=utf-8', {
        'Set-Cookie': 'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/admin/visits') {
      if (!isAdmin(req)) return send(res, 401, { error: '请先登录' });
      visits = await loadRemoteVisits();
      refreshStatuses();
      const unique = new Set(visits.map(v => v.visitorId)).size;
      const online = visits.filter(v => v.status === 'online').length;
      return send(res, 200, { visits, summary: { total: visits.length, unique, online } });
    }

    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return send(res, 400, { error: error.message || '请求失败' });
  }
}

if (require.main === module) {
  http.createServer(handler).listen(PORT, HOST, () => {
    console.log(`访问页: http://${HOST}:${PORT}/`);
    console.log(`管理后台: http://${HOST}:${PORT}/admin`);
    if (!process.env.ADMIN_PASSWORD) console.log(`本次启动的后台密码: ${ADMIN_PASSWORD}`);
  });
}

module.exports = handler;

process.on('SIGINT', () => {
  clearTimeout(writeTimer);
  fs.writeFileSync(DATA_FILE, JSON.stringify(visits, null, 2));
  process.exit(0);
});
