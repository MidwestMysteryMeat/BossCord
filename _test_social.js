// _test_social.js — smoke test for the social-only build.
//
// Boots nothing itself: run the server first, then `node _test_social.js`.
// Checks that the API surface answers, that every script referenced by
// index.html actually exists (the main risk after removing the game bundles),
// and that no removed game module is still required anywhere.
//
//   ACCOUNT_SECRET=x PORT=3131 node server.js &
//   PORT=3131 node _test_social.js

const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1';

let pass = 0;
let fail = 0;

function ok(name) { pass++; console.log('  PASS  ' + name); }
function bad(name, detail) { fail++; console.log('  FAIL  ' + name + (detail ? ' -- ' + detail : '')); }

function get(urlPath) {
  return new Promise((resolve) => {
    const req = http.get({ host: HOST, port: PORT, path: urlPath, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', (e) => resolve({ status: 0, body: String(e.message) }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: 'timeout' }); });
  });
}

async function main() {
  console.log('social-only smoke test (port ' + PORT + ')');

  // --- API surface ---------------------------------------------------
  const health = await get('/api/health');
  health.status === 200 ? ok('GET /api/health') : bad('GET /api/health', 'status ' + health.status);

  const rooms = await get('/api/rooms/public');
  if (rooms.status === 200) {
    try {
      const parsed = JSON.parse(rooms.body);
      const list = parsed.rooms || parsed;
      Array.isArray(list) ? ok('GET /api/rooms/public returns a list')
                          : bad('GET /api/rooms/public', 'not a list');
    } catch (e) { bad('GET /api/rooms/public', 'unparseable JSON'); }
  } else {
    bad('GET /api/rooms/public', 'status ' + rooms.status);
  }

  const cords = await get('/api/cords');
  cords.status === 200 ? ok('GET /api/cords (social feed)') : bad('GET /api/cords', 'status ' + cords.status);

  const pow = await get('/api/pow/challenge');
  pow.status === 200 ? ok('GET /api/pow/challenge (auth)') : bad('GET /api/pow/challenge', 'status ' + pow.status);

  // --- index.html script manifest ------------------------------------
  const index = await get('/');
  if (index.status !== 200) {
    bad('GET /', 'status ' + index.status);
  } else {
    ok('GET / serves the app shell');
    const refs = [];
    const re = /<script src="(\/js\/[^"?]+)/g;
    let m;
    while ((m = re.exec(index.body)) !== null) refs.push(m[1]);
    refs.length > 0 ? ok('index.html references ' + refs.length + ' local scripts')
                    : bad('index.html', 'no local scripts found');
    for (const ref of refs) {
      const res = await get(ref);
      if (res.status !== 200) bad('script 200 ' + ref, 'status ' + res.status);
    }
    const missing = [];
    for (const ref of refs) {
      if (!fs.existsSync(path.join(__dirname, 'public', ref.replace(/^\//, '')))) missing.push(ref);
    }
    missing.length === 0 ? ok('every referenced script exists on disk')
                         : bad('missing scripts', missing.join(', '));
  }

  // --- no dangling requires of removed game modules -------------------
  const REMOVED = ['chess', 'pool', 'liero', 'tcg', 'loot', 'stocks', 'auction',
                   'coinflip', 'plinko', 'cardgames', 'horseracing', 'game',
                   'game-worker'];
  const serverFiles = ['server.js', 'socket.js']
    .concat(fs.readdirSync(path.join(__dirname, 'handlers')).map((f) => 'handlers/' + f));
  const dangling = [];
  for (const f of serverFiles) {
    const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
    for (const mod of REMOVED) {
      if (src.includes("require('./" + mod + "')") || src.includes("require('../" + mod + "')")) {
        dangling.push(f + ' -> ' + mod);
      }
    }
  }
  dangling.length === 0 ? ok('no requires of removed game modules')
                        : bad('dangling requires', dangling.join(', '));

  // --- game handlers really are gone ---------------------------------
  const leftover = fs.readdirSync(path.join(__dirname, 'handlers'))
    .filter((f) => f.startsWith('game-') || ['tcg.js', 'stocks.js', 'auction.js',
      'inventory.js', 'clicker.js', 'challenges.js', 'namespace-games.js',
      'namespace-market.js'].includes(f));
  leftover.length === 0 ? ok('no game handlers left in handlers/')
                        : bad('game handlers remain', leftover.join(', '));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
}

main();
