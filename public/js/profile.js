// profile.js — social-only profile view.
//
// The full build's profile was largely a game screen (chips, inventory,
// equipped badges/titles, TCG cards, daily challenges, showcase). None of those
// events exist on this build, so this is the social subset: identity, avatar
// picker, account age, message counts, key management and navigation.
//
// Same component name and props as the full build (ProfileView({ onTabChange }))
// so chat.js and landing.js mount it unchanged.

function ProfileView(props) {
  var onTabChange = props && props.onTabChange;
  var ctx = useSocket();
  var [profile, setProfile] = useState(null);
  var [portraits, setPortraits] = useState([]);
  var [showAvatarPicker, setShowAvatarPicker] = useState(false);
  var [keyCopied, setKeyCopied] = useState(false);
  var isMobile = useIsMobile();

  useEffect(function() {
    if (!ctx.socket) return;
    ctx.socket.emit('profile_get', {});

    function onProfile(data) { setProfile(data); }
    function onPortraits(data) { setPortraits((data && data.portraits) || []); }
    function onAvatarUpdated(data) {
      setProfile(function(prev) {
        return prev ? Object.assign({}, prev, { avatar: data.avatar, avatarId: data.avatarId }) : prev;
      });
      setShowAvatarPicker(false);
    }

    ctx.socket.on('profile_data', onProfile);
    ctx.socket.on('portraits_list', onPortraits);
    ctx.socket.on('avatar_updated', onAvatarUpdated);
    return function() {
      ctx.socket.off('profile_data', onProfile);
      ctx.socket.off('portraits_list', onPortraits);
      ctx.socket.off('avatar_updated', onAvatarUpdated);
    };
  }, [ctx.socket]);

  var panelStyle = {
    flex: 1, display: 'flex', flexDirection: 'column', background: '#1c1c1e',
    overflow: 'auto', padding: isMobile ? '16px' : '24px'
  };

  if (!profile) {
    return React.createElement('div', { style: panelStyle },
      React.createElement('div', { style: { color: '#949ba4', fontSize: '14px' } }, 'Loading profile...')
    );
  }

  var stats = profile.stats || {};

  function accountAge() {
    if (!profile.createdAt) return 'Guest';
    var days = Math.floor((Date.now() - profile.createdAt) / 86400000);
    if (days < 1) return 'Member since today';
    if (days === 1) return 'Member for 1 day';
    return 'Member for ' + days + ' days';
  }

  var NAV = [
    { icon: '👥', label: 'Friends', desc: 'Manage friends, requests, and blocked users', tab: 'friends', color: '#2ecc71' },
    { icon: '🔒', label: 'Direct Messages', desc: 'Encrypted private messages', tab: 'dms', color: '#5865f2' },
    { icon: '💬', label: 'Cords', desc: 'Short posts that expire', tab: 'cords', color: '#f0b232' },
    { icon: '⚠️', label: 'Report User', desc: 'Report abuse or violations', tab: 'report', color: '#ed4245' },
    { icon: '🐛', label: 'Report Bug', desc: 'Report bugs, glitches, or issues', tab: 'bugreport', color: '#5865f2' },
    { icon: '💡', label: 'Feature Request', desc: 'Suggest a new feature or improvement', tab: 'featurerequest', color: '#57f287' }
  ];

  return React.createElement('div', { style: panelStyle },

    // ---- Identity card -------------------------------------------------
    React.createElement('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px',
        background: '#1a1a2e', borderRadius: '12px', padding: '18px',
        border: '1px solid rgba(255,255,255,0.06)'
      }
    },
      React.createElement('div', {
        style: {
          width: '72px', height: '72px', borderRadius: '50%', overflow: 'hidden',
          background: profile.color || '#f0b232', display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: '28px', fontWeight: 800, color: '#fff',
          flexShrink: 0, cursor: profile.isOwn ? 'pointer' : 'default'
        },
        title: profile.isOwn ? 'Click to change avatar' : '',
        onClick: function() {
          if (!profile.isOwn) return;
          setShowAvatarPicker(function(v) { return !v; });
          if (ctx.socket) ctx.socket.emit('portraits_get');
        }
      },
        profile.avatar
          ? React.createElement('img', { src: profile.avatar, style: { width: '100%', height: '100%', objectFit: 'cover' } })
          : (profile.username || '?')[0].toUpperCase()
      ),
      React.createElement('div', { style: { minWidth: 0 } },
        React.createElement('div', {
          style: { fontSize: '20px', fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: '6px' }
        },
          profile.username || 'Anonymous',
          profile.tag ? React.createElement('span', { style: { fontSize: '13px', color: '#949ba4', fontWeight: 500 } }, '#' + profile.tag) : null,
          profile.isOwn && !profile.temp ? React.createElement('span', { style: { fontSize: '14px', color: '#f0b232' }, title: 'Verified account' }, '🔑') : null
        ),
        React.createElement('div', { style: { fontSize: '12px', color: '#949ba4', marginTop: '4px' } }, accountAge())
      )
    ),

    // ---- Avatar picker -------------------------------------------------
    showAvatarPicker && profile.isOwn ? React.createElement('div', {
      style: {
        display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '20px',
        background: '#1a1a2e', borderRadius: '12px', padding: '14px',
        border: '1px solid rgba(255,255,255,0.06)'
      }
    },
      portraits.length === 0
        ? React.createElement('div', { style: { color: '#949ba4', fontSize: '13px' } }, 'No portraits available.')
        : portraits.map(function(p) {
            return React.createElement('img', {
              key: p.id,
              src: p.img,
              title: p.name,
              style: {
                width: '52px', height: '52px', borderRadius: '50%', objectFit: 'cover', cursor: 'pointer',
                border: profile.avatarId === p.id ? '3px solid #f0b232' : '2px solid #4e5058'
              },
              onClick: function() { if (ctx.socket) ctx.socket.emit('avatar_set', { portraitId: p.id }); }
            });
          })
    ) : null,

    // ---- Stats ---------------------------------------------------------
    React.createElement('div', {
      style: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '20px' }
    },
      [
        { label: 'Messages', value: (stats.messagesPosted || 0).toLocaleString(), color: '#3498db' },
        { label: 'Cords', value: (stats.cordsPosted || 0).toLocaleString(), color: '#f0b232' }
      ].map(function(s) {
        return React.createElement('div', {
          key: s.label,
          style: {
            background: '#1a1a2e', borderRadius: '10px', padding: '14px 18px',
            flex: '1 1 100px', minWidth: '100px', textAlign: 'center',
            border: '1px solid rgba(255,255,255,0.06)'
          }
        },
          React.createElement('div', { style: { fontSize: '22px', fontWeight: 800, color: s.color } }, s.value),
          React.createElement('div', {
            style: { fontSize: '11px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px', marginTop: '4px' }
          }, s.label)
        );
      })
    ),

    // ---- Account key ---------------------------------------------------
    profile.isOwn && ctx.accountKey ? React.createElement('div', {
      style: {
        background: '#1a1a2e', borderRadius: '12px', padding: '14px', marginBottom: '20px',
        border: '1px solid rgba(255,255,255,0.06)'
      }
    },
      React.createElement('div', { style: { fontSize: '12px', color: '#949ba4', marginBottom: '6px' } },
        'Your account key. Keep it safe: it is the only way back into this account.'),
      React.createElement('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } },
        React.createElement('code', {
          style: {
            flex: 1, background: '#111', padding: '8px 10px', borderRadius: '6px',
            color: '#f0b232', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis'
          }
        }, ctx.accountKey),
        React.createElement('button', {
          style: {
            padding: '8px 14px', background: keyCopied ? '#2d5a2d' : '#4e5058', border: 'none',
            borderRadius: '6px', color: '#fff', fontSize: '12px', fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit'
          },
          onClick: function() {
            if (navigator.clipboard) navigator.clipboard.writeText(ctx.accountKey);
            setKeyCopied(true);
            setTimeout(function() { setKeyCopied(false); }, 1500);
          }
        }, keyCopied ? 'Copied' : 'Copy')
      )
    ) : null,

    // ---- Navigation ----------------------------------------------------
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
      NAV.map(function(item) {
        return React.createElement('div', {
          key: item.tab,
          style: {
            display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer',
            background: '#1a1a2e', borderRadius: '10px', padding: '12px 14px',
            border: '1px solid rgba(255,255,255,0.06)'
          },
          onClick: function() { if (onTabChange) onTabChange(item.tab); }
        },
          React.createElement('div', { style: { fontSize: '20px' } }, item.icon),
          React.createElement('div', { style: { minWidth: 0 } },
            React.createElement('div', { style: { fontSize: '14px', fontWeight: 600, color: item.color } }, item.label),
            React.createElement('div', { style: { fontSize: '11px', color: '#949ba4' } }, item.desc)
          )
        );
      })
    )
  );
}
