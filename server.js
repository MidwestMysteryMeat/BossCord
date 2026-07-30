// server.js — Main entry point for BossCord
// Optional accounts. No mandatory registration. Your key, your data.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Load env vars from /etc/bosscord/app.env (secrets stay out of source code)
try {
  var _envFile = process.env.BOSSCORD_ENV_FILE || '/etc/bosscord/app.env';
  if (fs.existsSync(_envFile)) {
    var _envLines = fs.readFileSync(_envFile, 'utf8').split('\n');
    for (var _ei = 0; _ei < _envLines.length; _ei++) {
      var _line = _envLines[_ei].trim();
      if (!_line || _line[0] === '#') continue;
      var _eq = _line.indexOf('=');
      if (_eq > 0) {
        var _k = _line.slice(0, _eq).trim();
        var _v = _line.slice(_eq + 1).trim();
        if (!process.env[_k]) process.env[_k] = _v;
      }
    }
  }
} catch (_envErr) {
  console.error('[server] Warning: Could not load env file:', _envErr.message);
}

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { setupSocket, socketAccountMap, sessionTokens } = require('./socket');
const accounts = require('./accounts');
const state = require('./state');
const cordsModule = require('./cords');
const ratelimit = require('./ratelimit');
const pow = require('./pow');

const compression = require('compression');

const app = express();
app.disable('x-powered-by');
// Trust only the first proxy (nginx on localhost) for X-Forwarded-For / X-Real-IP
app.set('trust proxy', 'loopback');
const server = createServer(app);

app.use(compression());
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: true, limit: '64kb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  // X-XSS-Protection removed — deprecated in modern browsers, CSP handles XSS prevention
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=self, microphone=self, display-capture=self, geolocation=(), payment=()');
  // Cross-origin isolation headers
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  // HSTS handled by nginx — no duplicate header
  // CSP — no unsafe-eval (Babel removed), no unsafe-inline for scripts (all external)
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://unpkg.com https://cdn.socket.io https://cdn.jsdelivr.net https://cdn.babylonjs.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://i.imgur.com https://*.imgur.com https://media.tenor.com https://*.tenor.com https://media.giphy.com https://*.giphy.com https://*.googleusercontent.com",
    "media-src 'self' blob:",
    "connect-src 'self' wss://bosscord.com wss://www.bosscord.com https://tenor.googleapis.com",
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests",
  ].join('; '));
  res.removeHeader('X-Powered-By');
  next();
});

// Request logging middleware — skip static assets, log slow/error responses
app.use((req, res, next) => {
  if (req.path.startsWith('/js/') || req.path.startsWith('/css/') || req.path.startsWith('/icons/') || req.path.startsWith('/styles')) {
    return next();
  }
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    if (res.statusCode >= 400 || ms > 2000) {
      console.log('[api] ' + req.method + ' ' + req.path + ' ' + res.statusCode + ' ' + ms + 'ms ip=' + (ratelimit.getIp(req) || '?'));
    }
  });
  next();
});

// Serve index.html with no-cache so the VERSION-busted module loader always loads fresh
app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/index.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve static frontend from /public (JS/CSS cached for 1h, busted by ?v=VERSION)
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: '1h',
  etag: true,
  lastModified: true
}));


// Socket.IO — strict origin enforcement
const ALLOWED_ORIGINS = [
  'https://bosscord.com',
  'https://www.bosscord.com',
];
if (process.env.NODE_ENV !== 'production') {
  ALLOWED_ORIGINS.push('http://localhost:3000');
}
const io = new Server(server, {
  path: '/socket.io/',
  transports: ['websocket', 'polling'],
  maxHttpBufferSize: 500000,
  pingInterval: 25000,
  pingTimeout: 30000,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 1 },
    threshold: 1024,
    serverMaxWindowBits: 10,
  },
  cors: {
    origin: function(origin, cb) {
      // Reject requests with no Origin header (non-browser or cross-origin abuse)
      if (!origin) return cb(new Error('Origin required'), false);
      if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
      return cb(new Error('Origin not allowed'), false);
    },
    credentials: true,
    methods: ['GET', 'POST'],
  },
  // Additional handshake-level origin check + global connection limit
  allowRequest: (req, cb) => {
    const origin = req.headers.origin;
    if (!origin || !ALLOWED_ORIGINS.includes(origin)) {
      return cb('Origin not allowed', false);
    }
    if (ratelimit.getConnectionCount() >= ratelimit.MAX_GLOBAL_CONNECTIONS) {
      return cb('Server full', false);
    }
    cb(null, true);
  },
});

setupSocket(io);


// CORS for REST API
app.use('/api', function(req, res, next) {
  var origin = req.headers.origin;
  var allowed = ['https://bosscord.com', 'https://www.bosscord.com'];
  if (origin && allowed.indexOf(origin) !== -1) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------------------------------------------------------------------------
// REST endpoints — Chat
// ---------------------------------------------------------------------------
app.get('/api/room/:code', (req, res) => {
  const code = req.params.code.trim().toUpperCase();
  const room = state.getRoomByCode(code);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  res.json({ name: room.name, code: room.code, memberCount: room.members.length });
});

app.get('/api/account/lookup/:key', (req, res) => {
  // Reject invalid keys immediately
  if (!req.params.key || req.params.key.length < 12 || !/^[a-zA-Z0-9]+$/.test(req.params.key)) {
    return res.status(400).json({ error: 'Invalid key format' });
  }
  const clientIp = ratelimit.getIp(req);
  // Strict rate limit: 3 lookups per minute per IP to prevent enumeration
  if (clientIp && !ratelimit.check(clientIp, 'account_lookup', 3, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  const profile = accounts.getPublicProfile(req.params.key);
  // Constant-time response: same delay and same status code regardless of result
  // Prevents timing-based and status-code-based key enumeration
  setTimeout(() => {
    if (!profile) return res.json({ username: null, color: null });
    res.json({ username: profile.username, color: profile.color });
  }, 50 + Math.random() * 50);
});

app.get('/api/rooms/public', (req, res) => {
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'api_rooms_public', 20, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  res.json({ rooms: state.getPublicRooms() });
});

app.get('/api/health', (req, res) => {
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'api_health', 10, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  res.json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    rooms: state.rooms.size,
    users: state.users.size,
  });
});

// ---------------------------------------------------------------------------
// REST endpoints — Cords
// ---------------------------------------------------------------------------
app.get('/api/cords', (req, res) => {
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'api_cords', 30, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  const page = parseInt(req.query.page) || 0;
  res.json(cordsModule.getFeed(page, 20));
});

app.get('/api/cords/config', (req, res) => {
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'api_cords_config', 10, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  res.json({
    maxLength: cordsModule.CORD_MAX_LENGTH,
    maxPerDay: cordsModule.MAX_CORDS_PER_DAY,
    ttlHours: Math.floor(cordsModule.CORD_TTL_MS / (60 * 60 * 1000)),
  });
});

// ---------------------------------------------------------------------------
// REST endpoints — Tenor GIF proxy (key stays server-side)
// ---------------------------------------------------------------------------
const TENOR_KEY = process.env.TENOR_KEY || '';

app.get('/api/tenor/search', async (req, res) => {
  if (!TENOR_KEY) return res.status(503).json({ error: 'GIF search not configured' });
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'api_tenor_search', 10, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  const query = req.query.q;
  if (!query || typeof query !== 'string') return res.status(400).json({ error: 'Missing query' });
  try {
    const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query.trim())}&key=${TENOR_KEY}&client_key=bosscord&limit=20&media_filter=tinygif,gif`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      return res.status(502).json({ error: 'Tenor returned ' + response.status });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Tenor search failed' });
  }
});

app.get('/api/tenor/featured', async (req, res) => {
  if (!TENOR_KEY) return res.status(503).json({ error: 'GIF search not configured' });
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'api_tenor_featured', 10, 60000)) {
    return res.status(429).json({ error: 'Too many requests' });
  }
  try {
    const url = `https://tenor.googleapis.com/v2/featured?key=${TENOR_KEY}&client_key=bosscord&limit=20&media_filter=tinygif,gif`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) {
      return res.status(502).json({ error: 'Tenor returned ' + response.status });
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Tenor featured failed' });
  }
});

// ---------------------------------------------------------------------------
// REST endpoints — Proof-of-Work challenge
// ---------------------------------------------------------------------------
app.get('/api/pow/challenge', (req, res) => {
  const type = req.query.type === 'account' ? 'account' : 'connect';
  // IP rate limit: max 30 challenge requests per hour per IP
  const clientIp = ratelimit.getIp(req);
  if (clientIp && !ratelimit.check(clientIp, 'pow_challenge', 60, 3600000, { skipViolation: true })) {
    return res.status(429).json({ error: 'Too many challenge requests. Try again later.' });
  }
  const challenge = pow.generateChallenge(type);
  res.json(challenge);
});

// ---------------------------------------------------------------------------
// REST endpoints — Admin (deploy tooling)
// ---------------------------------------------------------------------------

// Admin endpoint: trigger update warning for all connected clients (deploy use)
app.post('/api/admin/update-warning', (req, res) => {
  var adminSecret = process.env.ADMIN_DEPLOY_SECRET;
  if (!adminSecret) return res.status(503).json({ error: 'Not configured' });
  var auth = req.headers['authorization'] || '';
  var expected = 'Bearer ' + adminSecret;
  var authBuf = Buffer.from(auth, 'utf8');
  var expectedBuf = Buffer.from(expected, 'utf8');
  if (authBuf.length !== expectedBuf.length || !require('crypto').timingSafeEqual(authBuf, expectedBuf)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (req.body && req.body.clear) {
    io.emit('update_warning', { message: null, clear: true });
    console.log('[admin] Update warning cleared via API');
    return res.json({ success: true, action: 'cleared' });
  }
  var message = (req.body && typeof req.body.message === 'string')
    ? req.body.message.slice(0, 200)
    : 'Server update incoming. May be briefly unavailable.';
  var minutesLeft = (req.body && typeof req.body.minutesLeft === 'number')
    ? req.body.minutesLeft : null;
  io.emit('update_warning', { message: message, minutesLeft: minutesLeft });
  console.log('[admin] Update warning triggered via API: ' + message);
  res.json({ success: true, message: message });
});

// Block sensitive paths and common scanner probes
const BLOCKED_PATHS = [
  '/.env', '/.git/*', '/.htaccess', '/.htpasswd',
  '/wp-admin*', '/wp-login*', '/wp-content*', '/wp-includes*',
  // /.well-known/security.txt is now served as a static file
  '/server.js', '/package.json', '/package-lock.json', '/node_modules*',
  '/metrics', '/graphql', '/swagger', '/swagger-ui*', '/api-docs*',
  '/admin', '/admin/*', '/debug', '/debug/*',
  '/phpinfo*', '/phpmyadmin*', '/xmlrpc.php',
  '/actuator*', '/console', '/config*',
];
app.all(BLOCKED_PATHS, (req, res) => {
  console.log('[security] Blocked path probe: ' + req.path + ' ip=' + (ratelimit.getIp(req) || '?'));
  res.status(404).send('Not found');
});

// Catch-all for unmatched /api/* routes — return JSON 404, not SPA HTML
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// SPA catch-all for valid page routes only
app.get('*', (req, res) => {
  // Only serve SPA for clean paths (no file extensions except .html)
  if (req.path.includes('.') && !req.path.endsWith('.html')) {
    return res.status(404).send('Not found');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ---------------------------------------------------------------------------
// Daily wipe — everything dies at midnight UTC
// ---------------------------------------------------------------------------
function scheduleNextWipe() {
  const now = new Date();
  const nextMidnight = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0
  ));
  const msUntilMidnight = nextMidnight.getTime() - now.getTime();

  // 5-minute warning
  const ms5 = msUntilMidnight - 5 * 60 * 1000;
  if (ms5 > 0) {
    setTimeout(() => {
      io.emit('wipe_warning', { message: 'Server wipe in 5 minutes. All rooms and messages will be cleared.', minutesLeft: 5 });
    }, ms5);
  }

  // 1-minute warning
  const ms1 = msUntilMidnight - 60 * 1000;
  if (ms1 > 0) {
    setTimeout(() => {
      io.emit('wipe_warning', { message: 'Server wipe in 1 minute. Say your goodbyes.', minutesLeft: 1 });
    }, ms1);
  }

  // The wipe
  setTimeout(() => {
    // Archive reports before wipe
    try {
      var reportsFile = path.join(__dirname, 'reports', 'reports.jsonl');
      if (fs.existsSync(reportsFile)) {
        var content = fs.readFileSync(reportsFile, 'utf8').trim();
        if (content) {
          var dateStr = new Date().toISOString().split('T')[0];
          var archiveFile = path.join(__dirname, 'reports', 'reports-' + dateStr + '.jsonl');
          fs.writeFileSync(archiveFile, content + '\n', 'utf8');
          fs.writeFileSync(reportsFile, '', 'utf8');
          console.log('[wipe] Archived ' + content.split('\n').length + ' reports to ' + archiveFile);
        }
      }
    } catch (reportErr) {
      console.error('[wipe] Report archive error:', reportErr.message);
    }

    // Archive bug reports before wipe
    try {
      var bugsFile = path.join(__dirname, 'reports', 'bugs.jsonl');
      if (fs.existsSync(bugsFile)) {
        var bugContent = fs.readFileSync(bugsFile, 'utf8').trim();
        if (bugContent) {
          var bugDateStr = new Date().toISOString().split('T')[0];
          var bugArchiveFile = path.join(__dirname, 'reports', 'bugs-' + bugDateStr + '.jsonl');
          fs.writeFileSync(bugArchiveFile, bugContent + '\n', 'utf8');
          fs.writeFileSync(bugsFile, '', 'utf8');
          console.log('[wipe] Archived ' + bugContent.split('\n').length + ' bug reports to ' + bugArchiveFile);
        }
      }
    } catch (bugErr) {
      console.error('[wipe] Bug report archive error:', bugErr.message);
    }

    // Archive feature requests before wipe
    try {
      var featuresFile = path.join(__dirname, 'reports', 'features.jsonl');
      if (fs.existsSync(featuresFile)) {
        var featContent = fs.readFileSync(featuresFile, 'utf8').trim();
        if (featContent) {
          var featDateStr = new Date().toISOString().split('T')[0];
          var featArchiveFile = path.join(__dirname, 'reports', 'features-' + featDateStr + '.jsonl');
          fs.writeFileSync(featArchiveFile, featContent + '\n', 'utf8');
          fs.writeFileSync(featuresFile, '', 'utf8');
          console.log('[wipe] Archived ' + featContent.split('\n').length + ' feature requests to ' + featArchiveFile);
        }
      }
    } catch (featErr) {
      console.error('[wipe] Feature request archive error:', featErr.message);
    }

    for (const [, room] of state.rooms) {
      if (room.destroyTimer) clearTimeout(room.destroyTimer);
    }
    io.emit('server_wipe', { message: 'Daily wipe complete. All data erased.' });
    state.users.clear();
    state.rooms.clear();
    io.disconnectSockets(true);
    cordsModule.reset(); // Cords wipe, but accounts persist
    accounts.clearAllDMs(); // DMs wipe daily
    console.log('[wipe] Daily wipe executed.');

    // Re-create default public rooms after wipe
    state.initDefaultRooms();

    scheduleNextWipe();
  }, msUntilMidnight);

  const h = Math.floor(msUntilMidnight / 3600000);
  const m = Math.floor((msUntilMidnight % 3600000) / 60000);
  console.log(`[wipe] Next wipe in ${h}h ${m}m (midnight UTC)`);
}

// ---------------------------------------------------------------------------
// Graceful shutdown — flush pending account writes before exit
// ---------------------------------------------------------------------------
function gracefulShutdown(signal) {
  console.log('[server] ' + signal + ' received. Broadcasting update warning...');
  try {
    io.emit('update_warning', { message: 'Server restarting for an update. Back in a moment.', minutesLeft: 0 });
  } catch (e) { /* io may not be ready */ }
  setTimeout(function() {
    accounts.flushAll();
    server.close(function() {
      console.log('[server] Shut down gracefully.');
      process.exit(0);
    });
    setTimeout(function() {
      console.log('[server] Forcing exit.');
      process.exit(0);
    }, 5000);
  }, 1000);
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch unhandled promise rejections — log and continue (don't crash)
process.on('unhandledRejection', (reason) => {
  console.error('[server] Unhandled rejection:', reason instanceof Error ? reason.stack || reason.message : reason);
});

// Catch uncaught exceptions — log, flush accounts, then exit (state may be corrupt)
process.on('uncaughtException', (err) => {
  console.error('[server] Uncaught exception:', err.stack || err.message);
  try { accounts.flushAll(); } catch (_) {}
  // Let PM2 restart us — exit after a short delay so logs flush
  setTimeout(() => process.exit(1), 500);
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log('');
  console.log('==============================================');
  console.log(`  BossCord running on port ${PORT}`);
  console.log('  No accounts. No databases. No traces.');
  console.log('  Daily wipe at midnight UTC.');
  console.log('==============================================');
  console.log('');

  // Create default public rooms on startup
  state.initDefaultRooms();

  scheduleNextWipe();
});
