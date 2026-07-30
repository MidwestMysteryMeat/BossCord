// socket.js
// Socket.IO event handler for Bossecord.
// Thin router: requires modules, creates shared state, wires handler files.

const crypto = require('crypto');
const state = require('./state');
const accounts = require('./accounts');
const cords = require('./cords');
const filter = require('./filter');
const ratelimit = require('./ratelimit');
const pow = require('./pow');
const portraits = require('./portraits');

// Handler modules
const { checkEventRate, sanitizeText, validateUrl } = require('./handlers/helpers');
const roomsHandler = require('./handlers/rooms');
const chatHandler = require('./handlers/chat');
const channelsHandler = require('./handlers/channels');
const voiceHandler = require('./handlers/voice');
const accountsHandler = require('./handlers/accounts');
const profileHandler = require('./handlers/profile');
const cordsEventsHandler = require('./handlers/cords-events');
const moderationHandler = require('./handlers/moderation');
const friendsHandler = require('./handlers/friends');
const dmsHandler = require('./handlers/dms');
const videoRouletteHandler = require('./handlers/video-roulette');
const updateWarningHandler = require('./handlers/update-warning');
const disconnectHandler = require('./handlers/disconnect');
let reportHandler; try { reportHandler = require('./handlers/report'); } catch(e) {}
let bugReportHandler; try { bugReportHandler = require('./handlers/bugreport'); } catch(e) {}
let featureRequestHandler; try { featureRequestHandler = require('./handlers/featurerequest'); } catch(e) {}

// Moderator account keys — loaded from MODERATOR_KEYS env var (comma-separated)
// Falls back to empty set if not configured
const MODERATORS = new Set(
  (process.env.MODERATOR_KEYS || '').split(',').map(k => k.trim()).filter(Boolean)
);

function isModerator(socketId) {
  const key = socketAccountMap.get(socketId);
  return key && MODERATORS.has(key);
}

// Enrich serialized room data with mod flags on members
function enrichRoom(serialized) {
  if (serialized && serialized.members) {
    for (var i = 0; i < serialized.members.length; i++) {
      if (isModerator(serialized.members[i].id)) serialized.members[i].isMod = true;
    }
  }
  return serialized;
}

// Track account keys linked to sockets: Map<socketId, accountKey>
const socketAccountMap = new Map();

// Session tokens: issued after full auth (PoW + PIN) on default namespace.
// Namespace connections (/games, /market) must present a valid session token
// instead of a raw accountKey. This prevents stolen keys from bypassing PIN/PoW.
// Map<token, { accountKey, socketId, ip, createdAt }>
const sessionTokens = new Map();

// Periodic session token cleanup (remove tokens older than 24 hours)
setInterval(function() {
  var now = Date.now();
  var maxAge = 24 * 60 * 60 * 1000;
  for (var _ref of sessionTokens) {
    var _token = _ref[0], _data = _ref[1];
    if (now - _data.createdAt > maxAge) {
      sessionTokens.delete(_token);
    }
  }
}, 60 * 60 * 1000); // Every hour

// Concurrent connection tracking: Map<ip, Set<socketId>>
const MAX_CONCURRENT_PER_IP = 10;
const ipConnections = new Map();

// Cord view dedup: Map<"cordId:socketId", timestamp> — 5-minute cooldown
const CORD_VIEW_DEDUP_MS = 5 * 60 * 1000;
const cordViewDedup = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, ts] of cordViewDedup) {
    if (now - ts > CORD_VIEW_DEDUP_MS) cordViewDedup.delete(key);
  }
}, 60 * 1000);

// ---------------------------------------------------------------------------
// Internal helpers (reference module-level state, stay in socket.js)
// ---------------------------------------------------------------------------

function findChannelByName(room, name) {
  const lowerName = name.toLowerCase();
  for (const [, channel] of room.channels) {
    if (channel.name.toLowerCase() === lowerName) {
      return channel;
    }
  }
  return null;
}

/**
 * Wire up all Socket.IO event handlers.
 * @param {import('socket.io').Server} io
 */
function setupSocket(io) {
  // Pass moderator keys to cords module for public cord tagging
  cords.setModeratorKeys(MODERATORS);

  // Cleanup expired accounts every 6 hours
  setInterval(function() {
    accounts.cleanupExpiredAccounts();
  }, 6 * 60 * 60 * 1000);
  // Run once on startup (delayed 30s to not block boot)
  setTimeout(function() { accounts.cleanupExpiredAccounts(); }, 30000);

  // Run background re-encryption once on startup (delayed 60s)
  setTimeout(function() { accounts.reencryptAccounts(); }, 60000);

  // Broadcast server stats to all clients every 30 seconds
  setInterval(function() {
    io.emit('server_stats', {
      online: state.users.size,
      members: accounts.getMemberCount(),
    });
  }, 30000);

  io.on('connection', async (socket) => {
    // Store client IP for rate limiting (ephemeral, 6h TTL, memory only)
    socket._clientIp = ratelimit.getIp(socket);
    const clientIp = socket._clientIp || socket.id;

    // Track global connection count
    ratelimit.incrementConnections();

    // Reject banned IPs immediately
    if (ratelimit.isBanned(clientIp)) {
      ratelimit.decrementConnections();
      socket.emit('error', { message: 'You have been temporarily banned. Try again later.' });
      socket.disconnect(true);
      return;
    }

    // Connection rate limit: max 10 connections per IP per hour
    if (!ratelimit.check(clientIp, 'connect', 30, 3600000)) {
      ratelimit.decrementConnections();
      socket.emit('error', { message: 'Too many connections. Try again later.' });
      socket.disconnect(true);
      return;
    }

    // Concurrent connection cap: max 3 simultaneous sockets per IP
    const existingConns = ipConnections.get(clientIp);
    if (existingConns && existingConns.size >= MAX_CONCURRENT_PER_IP) {
      ratelimit.decrementConnections();
      socket.emit('error', { message: 'Too many simultaneous connections.' });
      socket.disconnect(true);
      return;
    }
    // Track this connection
    if (!ipConnections.has(clientIp)) ipConnections.set(clientIp, new Set());
    ipConnections.get(clientIp).add(socket.id);

    // Helper to remove this socket from concurrent connection tracking
    function _removeFromIpTracking() {
      const cs = ipConnections.get(clientIp);
      if (cs) { cs.delete(socket.id); if (cs.size === 0) ipConnections.delete(clientIp); }
    }

    // Proof-of-Work verification: client must solve a hash puzzle to connect
    const powChallenge = socket.handshake.auth && socket.handshake.auth.powChallenge;
    const powNonce = socket.handshake.auth && socket.handshake.auth.powNonce;
    const powResult = pow.verify(powChallenge, powNonce);
    if (!powResult.valid) {
      ratelimit.decrementConnections();
      _removeFromIpTracking();
      socket.emit('error', { message: 'Connection requires proof-of-work. ' + (powResult.error || '') });
      socket.disconnect(true);
      return;
    }

    // ------------------------------------------------------------------
    // Connection: create anonymous identity (with optional account key)
    // ------------------------------------------------------------------
    const customName = socket.handshake.auth && socket.handshake.auth.name
      ? socket.handshake.auth.name
      : null;
    const accountKey = socket.handshake.auth && socket.handshake.auth.accountKey
      ? socket.handshake.auth.accountKey
      : null;

    // Reject invalid account keys immediately (must be 12+ alphanumeric chars)
    if (accountKey && (accountKey.length < 12 || !/^[a-zA-Z0-9]+$/.test(accountKey))) {
      ratelimit.decrementConnections();
      _removeFromIpTracking();
      socket.emit('error', { message: 'Invalid account key. Keys must be 12+ alphanumeric characters.' });
      socket.disconnect(true);
      return;
    }

    let linkedAccount = null;
    if (accountKey) {
      // Brute force protection: max 5 failed key attempts per IP per 15 minutes
      linkedAccount = accounts.loadAccount(accountKey);
      if (!linkedAccount) {
        if (!ratelimit.check(clientIp, 'auth_fail', 5, 900000)) {
          ratelimit.decrementConnections();
          _removeFromIpTracking();
          socket.emit('error', { message: 'Too many failed login attempts. Try again in 15 minutes.' });
          socket.disconnect(true);
          return;
        }
      }

      // PIN verification: ALL permanent accounts require a PIN
      if (linkedAccount && !linkedAccount.temp) {
        var authPin = socket.handshake.auth && socket.handshake.auth.pin;

        if (linkedAccount.pinHash) {
          // Account has PIN set — verify it (async scrypt to avoid blocking event loop)
          if (!authPin || !(await accounts.verifyPin(authPin, linkedAccount.pinHash))) {
            if (!ratelimit.check(clientIp, 'auth_fail', 5, 900000)) {
              ratelimit.decrementConnections();
              _removeFromIpTracking();
              socket.emit('error', { message: 'Too many failed login attempts. Try again in 15 minutes.' });
              socket.disconnect(true);
              return;
            }
            ratelimit.decrementConnections();
            _removeFromIpTracking();
            socket.emit('pin_required', { message: 'PIN required for this account' });
            socket.disconnect(true);
            return;
          }
        } else {
          // Account has NO PIN — require one to be set during login
          if (!authPin || typeof authPin !== 'string' || authPin.length < 4 || authPin.length > 8 || !/^[a-zA-Z0-9]+$/.test(authPin)) {
            ratelimit.decrementConnections();
            _removeFromIpTracking();
            socket.emit('pin_setup_required', { message: 'This account needs a PIN. Enter a 4-character PIN to secure it.' });
            socket.disconnect(true);
            return;
          }
          // Set the PIN for this legacy account (async scrypt)
          await accounts.setPinForAccount(linkedAccount.key, authPin);
          console.log('[auth] ' + linkedAccount.username + ' set PIN during login (legacy account)');
        }
      }
    }

    // Enforce one session per account key — block the new attempt
    if (linkedAccount && accountKey) {
      for (const [existingSocketId, existingKey] of socketAccountMap) {
        if (existingKey === accountKey && existingSocketId !== socket.id) {
          const existingSocket = io.sockets.sockets.get(existingSocketId);
          if (existingSocket && existingSocket.connected) {
            ratelimit.decrementConnections();
            _removeFromIpTracking();
            socket.emit('error', { message: 'This key is already in use in another session.' });
            socket.disconnect(true);
            return;
          }
          // Stale entry — clean it up and allow login
          socketAccountMap.delete(existingSocketId);
          break;
        }
      }
    }

    const user = state.createUser(
      socket.id,
      linkedAccount ? linkedAccount.username : customName
    );

    // If account found, override color/tag/avatar and link it
    if (linkedAccount) {
      user.color = linkedAccount.color;
      user.avatar = linkedAccount.avatar || null;
      user.tag = state.generateTag(accountKey);
      socketAccountMap.set(socket.id, accountKey);
      linkedAccount.lastSeen = Date.now();
      accounts.saveAccount(linkedAccount);
    }

    // Auto-create temporary account for anonymous users
    if (!linkedAccount) {
      const tempAccount = accounts.createTempAccount(user.name, user.color);
      if (tempAccount) {
        socketAccountMap.set(socket.id, tempAccount.key);
        linkedAccount = tempAccount;
      }
      // Assign a random character portrait image for anonymous users
      if (portraits.PROFILE_PORTRAITS && portraits.PROFILE_PORTRAITS.length > 0) {
        var randomPortrait = portraits.PROFILE_PORTRAITS[Math.floor(Math.random() * portraits.PROFILE_PORTRAITS.length)];
        user.avatar = randomPortrait.img || null;
        // Also save to the temp account so profile_get returns it
        if (linkedAccount && user.avatar) {
          linkedAccount.avatar = user.avatar;
          linkedAccount.avatarId = randomPortrait.id || null;
          accounts.saveAccount(linkedAccount);
        }
      }
    }

    console.log(`[connect] ${user.name} (${socket.id})${linkedAccount ? (linkedAccount.temp ? ' [TEMP]' : ' [ACCOUNT]') : ''}`);

    // Issue a session token for namespace auth (/games, /market)
    // This token proves the user passed full auth (PoW + PIN) on the default namespace.
    const sessionToken = crypto.randomBytes(24).toString('hex');
    sessionTokens.set(sessionToken, {
      accountKey: socketAccountMap.get(socket.id) || null,
      socketId: socket.id,
      ip: clientIp,
      createdAt: Date.now(),
    });

    // Send the user their identity
    socket.emit('identity', {
      id: user.id,
      name: user.name,
      color: user.color,
      tag: user.tag,
      avatar: user.avatar || null,
      joinedAt: user.joinedAt,
      sessionToken: sessionToken,
      account: linkedAccount ? {
        key: undefined, // Security: don't echo account key back over wire
        temp: !!linkedAccount.temp,
        stats: linkedAccount.stats,
        createdAt: linkedAccount.createdAt,
        slurFilter: !!linkedAccount.slurFilter,
        avatar: linkedAccount.avatar || null,
        avatarId: linkedAccount.avatarId || null,
        tosAccepted: !!(linkedAccount.metadata && linkedAccount.metadata.tosAccepted),
      } : null,
      isMod: isModerator(socket.id),
      publicRooms: state.getPublicRooms(),
    });

    // Send server stats
    socket.emit('server_stats', {
      online: state.users.size,
      members: accounts.getMemberCount(),
    });

    // If account has slur filter enabled, send the pattern
    if (linkedAccount && linkedAccount.slurFilter) {
      socket.emit('slur_filter_updated', { enabled: true, pattern: filter.getFilterPattern() });
    }

    // Prompt legacy accounts (no PIN) to set one
    if (linkedAccount && !linkedAccount.temp && !linkedAccount.pinHash) {
      socket.emit('pin_setup_required', { message: 'Please set a 4-digit PIN to secure your account' });
    }

    // Notify friends this user came online
    if (linkedAccount && !linkedAccount.temp) {
      var friendsData = accounts.getFriendsData(linkedAccount.key);
      if (friendsData && friendsData.friends.length > 0) {
        for (var fi = 0; fi < friendsData.friends.length; fi++) {
          var fk = friendsData.friends[fi].key;
          for (var [sid, skey] of socketAccountMap) {
            if (skey === fk) {
              var fs = io.sockets.sockets.get(sid);
              if (fs) fs.emit('friend_status_changed', { key: linkedAccount.key, online: true });
            }
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // Build deps object for handler modules
    // ------------------------------------------------------------------

    const deps = {
      user: user,
      socketAccountMap: socketAccountMap,
      ipConnections: ipConnections,
      accounts: accounts,
      state: state,
      cords: cords,
      filter: filter,
      ratelimit: ratelimit,
      pow: pow,
      checkEventRate: checkEventRate,
      sanitizeText: sanitizeText,
      validateUrl: validateUrl,
      isModerator: isModerator,
      enrichRoom: enrichRoom,
      findChannelByName: findChannelByName,
      MODERATORS: MODERATORS,
      cordViewDedup: cordViewDedup,
      CORD_VIEW_DEDUP_MS: CORD_VIEW_DEDUP_MS,
      _removeFromIpTracking: _removeFromIpTracking,
      sessionTokens: sessionTokens,
    };

    // ------------------------------------------------------------------
    // Register all handler modules
    // ------------------------------------------------------------------
    roomsHandler.init(io, socket, deps);
    chatHandler.init(io, socket, deps);
    channelsHandler.init(io, socket, deps);
    voiceHandler.init(io, socket, deps);
    accountsHandler.init(io, socket, deps);
    profileHandler.init(io, socket, deps);
    cordsEventsHandler.init(io, socket, deps);
    moderationHandler.init(io, socket, deps);
    updateWarningHandler.init(io, socket, deps);
    videoRouletteHandler.init(io, socket, deps);
    friendsHandler.init(io, socket, deps);
    dmsHandler.init(io, socket, deps);
    disconnectHandler.init(io, socket, deps);
    if (reportHandler) reportHandler.init(io, socket, deps);
    if (bugReportHandler) bugReportHandler.init(io, socket, deps);
    if (featureRequestHandler) featureRequestHandler.init(io, socket, deps);

    // TOS acceptance
    socket.on('tos_accept', function() {
      var accKey = socketAccountMap.get(socket.id);
      if (!accKey) return;
      var acc = accounts.loadAccount(accKey);
      if (!acc || acc.temp) return;
      if (!acc.metadata) acc.metadata = {};
      acc.metadata.tosAccepted = true;
      acc.metadata.tosDate = Date.now();
      accounts.saveAccount(acc);
    });
  });
}

module.exports = { setupSocket, socketAccountMap, MODERATORS, sessionTokens };

