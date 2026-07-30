# BossCord — Gap Analysis vs. Discord / Chat-Platform Staples

_Originally 2026-07-02 for `main`. Revised 2026-07-29 for the `social-only`
branch, where the mini-game arcade and chip economy were removed. Basis: every
tracked JS file syntax-clean, `_test_social.js` passes 9/9, server smoke-boots
clean (encryption on, graceful TLS degradation). Arcade-specific gaps from the
original analysis are out of scope here and live on `main`._

## What BossCord already has (do not rebuild)

Ephemeral rooms + private servers with text/voice/video channels, PoW auth +
PIN + session tokens, encrypted account persistence with key rotation tooling,
daily UTC wipe, reactions (whitelisted emoji), pins (pin/unpin/get handlers),
typing indicators, DMs with client crypto, friends, profanity filter,
per-IP/socket rate limiting, moderation + report forwarding (mTLS), cords
social feed, PWA manifest, video roulette, and profile avatars (portrait
picker). No games, chips, inventory, or leaderboards on this branch.

---

## A. Chat-product gaps (verified absent)

### A1. Message editing & deletion — HIGH, users expect it everywhere
Zero edit handlers. Typo'd messages are permanent until the midnight wipe.
Edit-with-"(edited)"-marker + author-delete fit the ephemeral model fine.
**Hooks:** chat.js already owns the message lifecycle and broadcasts;
message IDs exist for reactions/pins, so targeting is already solved.

### A2. Image/file attachments — HIGH
No upload path at all (0 hits). Even ephemeral chats live on image sharing.
Ephemeral fits naturally: store to a tmpfs/quota'd dir, purge on daily wipe.
Rate-limit + size-cap via the existing ratelimit.js patterns; Tenor GIFs are
already integrated so the render path for media messages half-exists.

### A3. Replies / quoting — MEDIUM
No reply-to threading of any kind (thread hits are all worker-threads).
Full Discord threads contradict the ephemeral ethos, but lightweight
reply-with-preview (store `replyToId`, render quoted snippet) is cheap and
transforms busy public rooms.

### A4. Message search (in-channel) — LOW-MEDIUM
Only user search exists (for reports). In-memory state makes channel search
trivial — it's a filter over the existing message array, UI only.

### A5. Notifications — verify depth
Mentions/unread badges: partial signals exist (49 keyword hits, PWA manifest
present). Web Push for DMs/mentions while tabbed out is the retention lever;
service worker + push subscription is the missing piece to check.

Deliberately absent (fits product ethos — do NOT add): message history past
the wipe, webhooks/bots API, read receipts.

---

## B. Branch-specific: dangling events after the arcade removal

The arcade came out cleanly (no requires of removed modules, no game handlers
left, `_test_social.js` asserts both). Two loose ends remain, neither breaking:

- `accounts.js` still persists `chips`, `inventory`, `cards`, `stats.gamesPlayed`
  and friends on account records. Left deliberately so an account file stays
  loadable on either branch; nothing on this branch reads or writes them. If
  `social-only` ever becomes the trunk, that is dead weight to strip.
- Acks with no client listener predate the split and still want a sweep:
  `friend_requests_list`, `showcase_updated`. Surface or drop.

## C. Social gaps worth building here

- **Profile depth:** the profile is now identity + message counts. Bio/status
  text and a "member since" badge are cheap and make the social side feel less
  thin without reintroducing an economy.
- **Room discovery:** public rooms list is flat. Categories exist in the create
  form (`General/Gaming/Music/Art/Tech`) but there is no browse-by-category or
  activity sort.
- **Cords engagement:** likes and replies exist; no follow/subscribe, no "my
  cords" view. A per-user cord history (within the 48h TTL) is a small add.


## D. Engineering gaps

### D1. Thin test suite — still the biggest risk
One smoke script (`_test_social.js`, 9/9) covering the API surface, the
index.html script manifest, and the absence of removed game modules. That
catches a broken build, not broken behaviour. The paths that matter most here
are auth (PoW + PIN + session tokens), DM crypto, and the moderation gates.
Port the MMOLite pattern: jest + source-contract tests + an event-contracts
test so a client listener with no server emitter (or the reverse) fails CI.


### D2. No CI
Repo is now on GitHub — add a workflow running syntax check + tests on push.

### D3. Test file placement
`_test_social.js` sits at the repo root like `_test_timer.js` did on `main`
(that chess-timer script was removed here with the games). Move it to `tests/`
as the seed of the suite.

## Suggested sequencing

1. **D1 test seed + D2 CI** — nothing else is safe to move fast on without it
2. **A1 edit/delete + A3 replies** — core chat feel
3. **A2 attachments** (ephemeral-friendly design above)
4. **C social gaps** — profile depth, room discovery, cords history
5. **A5 push notifications → A4 search**

