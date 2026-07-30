# Assets needed

**This is the one repo in the set that genuinely needs media supplied.** BossCord is
deliberately art-stripped: the icon art comes from commercial packs licensed to the
project owner only, so `.gitignore` blanket-excludes `*.png *.jpg *.jpeg *.gif *.webp
*.mp3 *.ogg *.wav`. Of **277 media files on the owner's dev machine, only 3 are
git-tracked** — a fresh clone is missing 274 images (~15.0 MB).

**Nothing crashes.** Every consumer is a DOM `<img src>` or `express.static` lookup, so
missing art is a **cosmetic 404, never a boot failure**. See §7 for the audit.

**The app requires no audio assets and no font files at all** — sound is synthesized in
Web Audio, and emoji are Unicode. The entire gap is images.

See also `public/icons/ASSETS_PLACEHOLDER.md` for the licensing statement.

---

## What survives a clone (3 files, tracked)

| path/pattern | type | format | dimensions | used for | required/optional | fallback behavior |
|---|---|---|---|---|---|---|
| `public/favicon.ico` | favicon | ICO, multi-size RGBA (2 884 B) | 16×16 + 32×32 | `public/index.html:11` `<link rel="icon" sizes="any">` | present | — the only icon that survives, so browsers still show a tab favicon |
| `docs/screenshots/login.png` | doc screenshot | PNG RGB (286 319 B) | 1440×900 | README documentation | present | — not used by the app |
| `docs/screenshots/tos-gate.png` | doc screenshot | PNG RGB (67 292 B) | 1440×900 | README documentation | present | — not used by the app |

These survive via two carve-outs: `.gitignore:33` negates `!docs/screenshots/*.png`
("own screenshots are allowed — not licensed pack art"), and `.ico` was never in the
ignore list.

---

## 1. What a self-hoster must supply — `public/icons/` (274 files)

The directory tree exists in the clone; the files do not. Every path below is served by
`express.static(public/)` (`server.js:122`), so **drop-in replacements need only match
the filename and path** — no code change, no rebuild (there is no build step).

| path/pattern | type | format | dimensions | used for | required/optional | fallback behavior |
|---|---|---|---|---|---|---|
| `public/icons/cards/T_4ColorCards_Deck1_LowRes_{Spades,Hearts,Diamonds,Clubs}{2..10,J,Q,K,A}_Diffuse.PNG` | playing cards | PNG RGBA | **242×348** | blackjack/poker faces; path built by concatenation at `public/js/games-cards.js:270-277`, rendered `:283-296` | **required for card games** — 52 faces | broken-image icon; no `onerror` handler |
| `public/icons/cards/card_back.PNG` | playing card | PNG RGBA | 242×348 | face-down + unknown-suit fallback (`games-cards.js:271`, `:274`) | **required for card games** | broken-image icon |
| `public/icons/characters/{hm,hw,elf,gnome}_*.png` | avatar portraits | PNG RGBA | 256×256 | the 60 selectable profile portraits, catalog at `loot.js:664-760`, served `handlers/inventory.js:190` | **required** — see the avatar warning in §2 | initial-circle CSS fallback exists but is unreachable |
| `public/icons/items/*.PNG` | item icons | PNG RGBA | 256×256 | inventory, casino/lootbox/scratch art (`public/js/games-casino.js`, 49 refs) | required for those screens | broken-image icon |
| `public/icons/loot/*.PNG` | loot/currency icons | PNG RGBA | 256×256 | chests, bags, keys, coins; heaviest-referenced set — `LootCoin_06.PNG` is the **chips currency icon** used in profile, hub, and TCG chrome (×6 refs) | required | broken-image icon |
| `public/icons/weapons/*.PNG` | weapon icons | PNG RGBA | 256×256 | loot tables at `loot.js:192-226` | required | broken-image icon |
| `public/icons/books/Book_{1..25}.PNG` | book icons | PNG RGBA | 256×256 | loot tables at `loot.js:230-260` | required | broken-image icon |
| `public/icons/bosscord/icon-{16,32,48,64,128,192}.png`, `favicon.png` | app/PWA icons | PNG RGBA | 16, 32, 48, 64, 128, 192 square; `favicon.png` 32×32 | `index.html:12-15`, `public/manifest.json:11-13`, and **the desktop-notification icon at `public/js/notifications.js:47`** | recommended | tracked `favicon.ico` still covers the tab; PWA install prompt degrades |

File counts and totals as they exist on the owner's machine, for sizing a replacement
set:

| directory | count | dimensions | total bytes | per-file range |
|---|---|---|---|---|
| `public/icons/books/` | 25 | 256×256 RGBA | 1 700 001 | 50 074 – 87 132 |
| `public/icons/bosscord/` | 10 | mixed (16→330 px) | 261 536 | 800 – 89 557 |
| `public/icons/cards/` | 53 | **242×348** RGBA | 587 016 | 9 984 – 13 643 |
| `public/icons/characters/` | 60 | 256×256 RGBA | 5 940 847 | 78 244 – 119 302 |
| `public/icons/items/` | 54 | 256×256 RGBA | 3 551 646 | 27 707 – 121 697 |
| `public/icons/loot/` | 43 | 256×256 RGBA | 2 037 976 | 21 068 – 100 951 |
| `public/icons/weapons/` | 29 | 256×256 RGBA | 898 202 | 16 803 – 72 440 |

`cards/` at 242×348 is the only non-square set — real playing-card aspect. Everything
else is a 256×256 RGBA icon, so a substitute pack at that size drops in cleanly.

**The `cards/` set is complete and self-consistent** on the owner's machine (all 52
faces + `card_back.PNG` verified present), so it is the cleanest target for a
replacement deck. About 35 files on disk are referenced by no code at all (6 in
`bosscord/` including two 400–500 px design comps, 16 in `items/`, 13 in `loot/`) — you
do not need to replace those.

---

## 2. Two things that will bite you, in priority order

### (a) Every user's avatar is a broken image — fix this first

`socket.js:368-376` assigns a **random licensed portrait file to every anonymous user**:

```js
// Assign a random character portrait image for anonymous users
if (loot.PROFILE_PORTRAITS && loot.PROFILE_PORTRAITS.length > 0) {
  var randomPortrait = loot.PROFILE_PORTRAITS[Math.floor(Math.random() * loot.PROFILE_PORTRAITS.length)];
  user.avatar = randomPortrait.img || null;
```

Because `user.avatar` is therefore **always truthy**, the app's perfectly good graceful
fallback is **unreachable**. That fallback is a generated coloured circle with the
user's first initial — not a file, not a data URI, not an identicon:

- `public/js/chat.js:854-861` — own-user footer, 32 px circle on `ctx.user.color`
- `public/js/chat.js:2913-2921` — message rows, 40 px circle
- `public/js/chat.js:3332` — member list
- `public/js/chat.js:1939-1947` — voice placeholder
- `public/js/cords.js:338-345` — social feed

On a fresh clone, *every user in every room* renders a broken-image icon. **Deleting or
guarding the `socket.js:368` auto-assign makes avatars fully art-optional** — the CSS
initial-circle takes over and the app looks intentional with zero images supplied. That
is a one-line change and by far the highest-leverage fix for a self-hoster.

Note there is **no avatar upload** anywhere in the app — users pick from the fixed
60-portrait list (`loot.js:664`), and only the *path string* is persisted
(`handlers/inventory.js:209-210` sets `acc.avatar` / `acc.avatarId`).

### (b) There is no `onerror` handler anywhere in the client

Verified: zero `onerror` hits across `public/js/`. Every missing image renders the
browser's broken-image glyph rather than degrading. Adding a single `onError` on the
shared `<img>` render paths would convert the whole art gap from "looks broken" to
"looks minimal."

---

## 3. TCG card art — 84 paths that are missing on the owner's machine too

Worth stating plainly so nobody hunts for files that were never there: **all 84
distinct `img:` values in `tcg.js` resolve to nothing, even on the dev machine.**
`public/icons/characters/` contains only the 60 flat player portraits; the referenced
`Monsters/` subtree does not exist.

The TCG is **server-complete**; card art is referenced by filename in an `img` field on
each catalog row. Catalog starts at `tcg.js:42`, e.g. `tcg.js:44`:

```js
{ id: 'tcg_world_eater', name: 'World Eater', rarity: 'godly', type: 'Abomination', atk: 200, def: 120, hp: 250, img: '/icons/characters/Monsters/Devourer.PNG' },
```

Schema: `id`, `name`, `rarity`, `type`, `atk`, `def`, `hp`, **`img`**. Rarity table at
`tcg.js:7-19` (10 tiers, common → godly); type chart at `tcg.js:23-31`. The `img` value
is passed to the client verbatim at `tcg.js:319`, `:373`, `:495`, `:1168`, and
`handlers/inventory.js:146`.

| path/pattern | type | format | dimensions | used for | required/optional | fallback behavior |
|---|---|---|---|---|---|---|
| `public/icons/characters/Monsters/*.PNG` (50 refs) | TCG card art | PNG RGBA | 256×256 to match the other character art | monster cards | optional | `🐉` emoji **only if `img` is null** — otherwise broken image |
| `public/icons/characters/Monsters/Undead/*.PNG` (30 refs) | TCG card art | PNG RGBA | 256×256 | undead cards | optional | as above |
| `public/icons/characters/Monsters/Vampires/{Female,Male} Vampire/*.PNG` (2 each) | TCG card art | PNG RGBA | 256×256 | vampire cards | optional | as above |

The client *does* have a dragon-emoji fallback — `public/js/games-tcg.js:213`, `:559`,
`:947` render `card.img ? <img …> : <div style={{fontSize:'40px'}}>🐉</div>`. But it
**only fires when `img` is null/undefined**, and the server always populates it. So
today you get a broken image, not the dragon. **Either supply the art, or null out the
`img` fields in `tcg.js` to get the intended emoji cards for free.** The
active-battle card at `games-tcg.js:1022-1025` has no fallback branch at all.

Pack and key artwork is separate and *is* present on disk (`/icons/loot/Loot_*_bag.PNG`,
`Loot_*_key.PNG`, `LootCoin_06.PNG`), referenced at `games-tcg.js:206`, `:259`, `:284`,
`:305`, `:341`, `:346` and in the pack tables at `:12-17`, `:116-126`.

**The dormant client UI is a socket-wiring gap, not an asset gap.** Packs, collection,
and battle UI are wired and reachable (hub tiles at `public/js/games-hub.js:598`,
`:612`, `:626`). What's missing a client is the **trade + battle-challenge flow**
(`docs/GAP_ANALYSIS.md:56-66`): `tcg_trade_proposed/received/completed/declined/cancelled`,
`tcg_challenge_sent/received/declined`. Building it introduces **no new art
requirement** beyond the existing `img` field.

`stocks.js` similarly references 21 ticker-mascot paths absent on the dev machine
(`stocks.js:16-22` Greek gods, `:27-34` titans, `:33`/`:39` an absent `Animals/`
subdir, `:40` `resourcesandfood/`, `:44` `professions/`). All are `<img>` sites, all
cosmetic.

---

## 4. Mini-games need no sprites

18 games (hub IDs in `public/js/games-hub.js:476-740`). The canvas games are **100 %
primitives with zero image loads** — `getContext('2d')` at `games-casino.js:82`,
`games-horseracing.js:459`/`:749`, `games-liero.js:357`/`:388`/`:423`,
`games-orbs.js:162`, `games-pool.js:521`, `particles.js:17`.

There is exactly **one `drawImage` in the whole client**, and it blits an offscreen
canvas, not a file — `public/js/games-liero.js:476`. **Zero `new Image()`, zero
`createImageBitmap`, zero `loadImage`** anywhere in `public/js/` or `public/games/`.

Chess uses Unicode glyphs in the DOM (no canvas). Slots use Unicode emoji reels
(`handlers/game-slots.js:12-27`). The embedded engine demos are procedural too —
`public/games/phaser-demo/game.js:60-83` generates every sprite via `add.graphics()` +
`generateTexture()`; babylon-demo uses solid-colour meshes. **No asset files exist under
`public/games/` at all.**

The games that *do* use art all go through DOM `<img>`: card games (present), TCG
(§3), casino/lootbox/scratch (`games-casino.js`, present), stocks (§3), and
profile/hub currency icons (`profile.js:229`, `:482`, `:489`, `:789`;
`games-hub.js:341`, `:351`).

## 5. No audio assets — sound is synthesized

`public/js/sound-manager.js:1-4` states it: "Synthesized sounds (no external audio files
needed), zero dependencies." `AudioContext` at `:21`, oscillator helper `osc()` at
`:80-96`, white-noise buffer at `:54-64`, gesture-unlock at `:38-50`, sound table from
`:100`.

**Zero `new Audio(...)` and zero `.mp3`/`.ogg`/`.wav` references exist in the repo.**
The `*.ogg`/`*.wav`/`*.mp3` lines in `.gitignore` are vestigial — no audio file has ever
been in this tree. (The two `.play()` calls at `public/js/core.js:428`, `:446` are
WebRTC voice `<audio>` elements with `srcObject` media streams, not SFX.)

There is no bespoke message-ding file either. Desktop notifications use the OS chime via
`silent: false` (`public/js/notifications.js:44-49`) — but note that call also sets
`icon: '/icons/bosscord/icon-192.png'` (`:47`), the **only** asset dependency in the
entire audio/notification path.

## 6. No fonts, no emoji files, no stickers

- **Emoji: pure Unicode.** `EMOJI_CATEGORIES` at `public/js/chat.js:1540+` is inline
  `\uXXXX` escape arrays.
- **Reactions: whitelisted Unicode only.** `ALLOWED_REACTIONS` at
  `handlers/chat.js:5-11`, validated at `:129`, stored as message object keys
  (`:149-179`).
- **Stickers do not exist** — zero hits for `sticker` in the codebase.
- **No custom emoji upload** — there is no upload path at all
  (`docs/GAP_ANALYSIS.md:33`).
- **No font files.** Zero `.woff/.woff2/.ttf/.otf` in the repo, and
  `public/styles.css` contains **zero `url()`, zero `@font-face`, zero
  `background-image`** — there are no CSS-referenced media assets whatsoever.

---

## 7. Unguarded load sites: none. Zero crash-on-boot risk.

All four crash vectors checked and clear:

1. **No `fs.readFileSync` of an image.** Every `readFileSync`/`existsSync` in the tree
   targets JSON/JSONL/text/PEM (`accounts.js:21-22`, `:435`, `:479`, `:647-657`,
   `:1668`; `cords.js:24-35`; `loot.js:60-70`; `server.js:11-12`, `:896-931`;
   `handlers/{report,bugreport,featurerequest}.js:15`). Node never reads a media file
   from disk.
2. **No `require`/`import` of an image** — 0 hits. No bundler loader to break.
3. **No build step.** `package.json` scripts are only `start` and `test`; React comes
   from a UMD CDN via `React.createElement` (`README.md:37`: "no build step, no
   bundler"). No CI workflow — `.github/` holds only `FUNDING.yml`.
4. **Static serving is generic** — `server.js:122` `express.static(public/)` returns a
   plain 404. `res.sendFile` is used only for `index.html` (`server.js:112`, `:118`,
   `:862`).

**Classification: 100 % cosmetic 404.**

One boot-time read of a gitignored artifact exists but is **not media and is guarded** —
`handlers/report-forward.js:17-28` reads three TLS files inside `try/catch` ("Not
fatal — forwarding will just be skipped if certs aren't available"), guarded again at
`:36`. Result on a clone: one `console.warn` at boot, server runs.

---

## 8. Configuration, not assets

Do not go looking for files for any of these.

- **`TENOR_KEY`** — GIFs are fetched from Tenor **at runtime**; nothing is stored in the
  repo. Server-side proxy keeps the key private: `server.js:743`
  (`process.env.TENOR_KEY || ''`), `/api/tenor/search` at `:745-767`,
  `/api/tenor/featured` at `:769-789`, both rate-limited 10/min/IP with an 8 s timeout.
  **If the key is absent both endpoints return HTTP 503 immediately**
  (`server.js:746`, `:770`) and the client shows "Could not load GIFs" over an empty
  grid (`public/js/ui-common.js:373`, `:381-386`, `:392-397`). Graceful; chat is
  unaffected. GIF URLs stay remote (`media*.tenor.com`) and are allow-listed at
  `handlers/helpers.js:75-76`, `cords.js:133-134`, `public/js/core.js:1773`.
- **`ACCOUNT_SECRET`** — required (`README.md:37`).
- **`ADMIN_KEY`**, `.env` — optional `.env` loading is guarded at `server.js:11-12`.

### Edits a self-hoster on a different domain must make

- `index.html:25` (`og:image`) and `:32` (`twitter:image`) hardcode
  `https://bosscord.com/icons/bosscord/icon-192.png` — **link previews will show
  someone else's branding** until you change these.
- `server.js:80` CSP `connect-src` hardcodes `wss://bosscord.com` /
  `wss://www.bosscord.com`.
- `ALLOWED_ORIGINS` at `server.js:130-133` only adds `http://localhost:3000` when
  `NODE_ENV !== 'production'`.

### The app is CDN-free for art, but not for vendor JS and fonts

100 % of game/UI art is a local path served from `public/`. The external requests are:

| file:line | URL | type | SRI |
|---|---|---|---|
| `public/index.html:51` | `fonts.googleapis.com/css2?family=Inter…` | **Google Fonts (Inter)** | no |
| `public/index.html:61` | `unpkg.com/react@18.2.0/umd/react.production.min.js` | JS vendor | yes (sha384) |
| `public/index.html:62` | `unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js` | JS vendor | yes (sha384) |
| `public/index.html:63` | `cdn.socket.io/4.7.2/socket.io.min.js` | JS vendor | yes (sha384) |
| `public/games/phaser-demo/index.html` | `cdn.jsdelivr.net/npm/phaser@3.80.1/…` | JS vendor | no |
| `public/games/babylon-demo/index.html` | `cdn.babylonjs.com/babylon.js` | JS vendor | no |

**Optional, for a zero-third-party-request deployment:** vendor the Inter webfont
yourself. There is no local fallback file and no `@font-face`, so a blocked CDN degrades
to the stack at `public/styles.css:11`
(`'Inter','Noto Sans', Helvetica, Arial, sans-serif`) — i.e. Helvetica/Arial. Nothing
breaks.

| path/pattern | type | format | dimensions | used for | required/optional | fallback behavior |
|---|---|---|---|---|---|---|
| `public/fonts/Inter-*.woff2` | webfont | WOFF2 | 400/500/600/700 weights | replacing the Google Fonts request at `index.html:51` | optional | falls back to Helvetica/Arial via `styles.css:11` |
