// handlers/profile.js
// Socket handlers: profile_get, portraits_get, avatar_set
//
// On the social-only build these three listeners live here. They previously sat
// in handlers/inventory.js alongside the loot/TCG events; the profile picture
// and the profile card itself are social features, so they were kept and the
// game-economy fields (chips, inventory, equipped items, cards, showcase) were
// dropped from the payloads.

const portraits = require('../portraits');

module.exports = {
  init(io, socket, deps) {
    var { user, socketAccountMap, accounts, checkEventRate } = deps;

    // ------------------------------------------------------------------
    // Profile: get (own profile, or another user's public profile)
    // ------------------------------------------------------------------
    socket.on('profile_get', (data) => {
      try {
        if (!checkEventRate(socket, 'profile_get', 30, 60000)) return;
        var myKey = socketAccountMap.get(socket.id);
        const targetKey = (data && data.key) || myKey;

        if (!targetKey) {
          // Anonymous user — basic profile from the in-memory user object
          socket.emit('profile_data', {
            username: user.name || 'Anonymous',
            color: user.color || '#dcddde',
            tag: user.tag || '',
            stats: {},
            avatar: user.avatar || null,
            avatarId: null,
            createdAt: null,
            temp: true,
            isOwn: !(data && data.key),
          });
          return;
        }

        const acc = accounts.loadAccount(targetKey);
        if (!acc) { socket.emit('profile_data', null); return; }

        var isOwnProfile = !data || !data.key || data.key === myKey;

        // Other users' profiles: public fields only
        if (!isOwnProfile) {
          socket.emit('profile_data', {
            username: acc.username,
            color: acc.color,
            name: acc.name || acc.username || 'Anonymous',
            tag: acc.tag,
            stats: { messagesPosted: (acc.stats || {}).messagesPosted || 0 },
            avatar: acc.avatar || null,
            avatarId: acc.avatarId || null,
            createdAt: acc.createdAt || null,
            isOwn: false,
          });
          return;
        }

        socket.emit('profile_data', {
          username: acc.username,
          color: acc.color,
          tag: acc.tag,
          stats: acc.stats || {},
          avatar: acc.avatar || null,
          avatarId: acc.avatarId || null,
          createdAt: acc.createdAt || null,
          temp: !!acc.temp,
          slurFilter: !!acc.slurFilter,
          isOwn: true,
        });
      } catch (err) {
        console.error('[profile_get] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Profile portraits: get available list
    // ------------------------------------------------------------------
    socket.on('portraits_get', () => {
      try {
        if (!checkEventRate(socket, 'portraits_get', 10, 60000)) return;
        socket.emit('portraits_list', { portraits: portraits.PROFILE_PORTRAITS });
      } catch (err) {
        console.error('[portraits_get] Error:', err.message);
      }
    });

    // ------------------------------------------------------------------
    // Profile avatar: set
    // ------------------------------------------------------------------
    socket.on('avatar_set', (data) => {
      try {
        if (!data || typeof data.portraitId !== 'string') return;
        const key = socketAccountMap.get(socket.id);
        if (!key) { socket.emit('error', { message: 'Need an account to set avatar' }); return; }
        if (!checkEventRate(socket, 'avatar_set', 5, 60000)) return; // max 5/min
        const portrait = portraits.PROFILE_PORTRAITS.find(p => p.id === data.portraitId);
        if (!portrait) { socket.emit('error', { message: 'Invalid portrait' }); return; }
        const acc = accounts.loadAccount(key);
        if (!acc) return;
        acc.avatar = portrait.img;
        acc.avatarId = portrait.id;
        accounts.saveAccount(acc);
        user.avatar = portrait.img;
        socket.emit('avatar_updated', { avatar: portrait.img, avatarId: portrait.id });
      } catch (err) {
        console.error('[avatar_set] Error:', err.message);
      }
    });
  },
};
