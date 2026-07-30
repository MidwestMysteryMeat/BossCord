import globals from "globals";

// Correctness-only static analysis. Formatting and legacy style are deliberately
// out of scope so a clean exit means "no known runtime hazard", not "reformatted".
const correctness = {
  "no-undef": "error",
  "no-dupe-keys": "error",
  "no-dupe-args": "error",
  "no-dupe-class-members": "error",
  "no-duplicate-case": "error",
  "no-unsafe-negation": "error",
  "no-self-compare": "error",
  "no-unreachable": "error",
  "no-unreachable-loop": "error",
  "no-cond-assign": ["error", "except-parens"],
  "no-constant-condition": ["error", { checkLoops: "allExceptWhileTrue" }],
  "no-constant-binary-expression": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
  "no-fallthrough": "error",
  "no-sparse-arrays": "error",
  "no-compare-neg-zero": "error",
  "no-async-promise-executor": "error",
  "no-func-assign": "error",
  "no-import-assign": "error",
  "no-obj-calls": "error",
  "no-setter-return": "error",
  "no-unsafe-finally": "error",
  "no-unsafe-optional-chaining": "error",

  // Intentional legacy style debt, not evidence of a defect.
  "no-unused-vars": "off",
  "no-empty": "off",
};

// index.html loads these classic scripts into one shared global environment.
// Lazy game modules are added to that same environment by script-loader.js.
const appGlobals = Object.fromEntries(`
  AboutTab App AuctionHouseView BOSSCORD_TOS BossBrawlGame BossCordCrypto
  BossCordNotifs BossEffects BossOrbsGame BossParticles BossScriptLoader
  BossSounds BottomTabBar BugReportView
  CHESS_COLORS CHESS_FILES CHESS_PIECE_NAMES CHESS_PIECE_UNICODE CHESS_RANKS
  CHESS_TIME_CONTROLS CLICKER_UPGRADES CardGamesView ChannelSidebar ChatArea
  ChatLayout ChessButton ChessGameView ClickerIdleView CoinFlipView
  ConnectionBanner CordsTab CreateChannelModal DMView DailyChallengesSection
  EMOJI_CATEGORIES EXTERNAL_GAMES EmojiPicker FallbackImg FeatureRequestView
  FriendsPanel GameLauncher GameLoadingSpinner GamesTab GifPicker HR_BET_AMOUNTS
  HR_COLORS HR_DUST_FRAME_COUNTER HR_MOOD_COLORS HR_RACE_DURATION
  HR_RACE_FINISH_SOUND_PLAYED HR_RACE_START_SOUND_PLAYED HR_WEATHER_ICONS
  HorseRacingView KeyboardShortcutsHelp LIERO_AIM_LEN LIERO_HP_BAR_H
  LIERO_HP_BAR_W LIERO_KILL_FEED_DURATION LIERO_KILL_FEED_MAX LIERO_MAP_H
  LIERO_MAP_W LIERO_PLAYER_H LIERO_PLAYER_W LIERO_PROJECTILE_COLORS LIERO_STYLES
  LIERO_TERRAIN_COLORS LIERO_TICK_RATE LandingPage LazyGameWrapper LeaderboardTab
  LieroButton LootboxView MAX_CLIENT_MESSAGES MemberList POOL_BALL_COLORS
  POOL_BALL_RADIUS POOL_COLORS POOL_MAX_PULL_PIXELS POOL_MAX_SHOT_POWER
  POOL_POCKETS POOL_POCKET_RADIUS POOL_RAIL_THICKNESS POOL_TABLE_H POOL_TABLE_W
  PlinkoView PoolButton PoolGameView ProfileView QuickSwitcher REACTION_EMOJI_LIST
  REACTION_EMOJI_MAP ROOM_CATEGORIES ReportView RoomList RoomSettingsModal
  RouletteView SLOT_SYMBOLS ScratchCardView SkeletonCircle SkeletonRow
  SlotMachineView SocketContext SocketProvider SoundToggle StockMarketView
  TCGBattleView TCGCollectionView TCGPackView TopTabBar UpdateWarningBanner
  UserActionMenu VideoCallView VideoGrid VoiceManager WipeWarningBanner
  _globalVoiceManager _powWorkerCode _renderBadge appendMessage blockDrop
  blockPaste chessFormatTime chessSquareName chessTimeControlInfo clickerCalcStats
  clickerFormatNum clickerUpgradeCost clickerUpgradeValue cordTimeAgo
  cordTimeUntilExpiry createContext fetchAndSolvePoW formatFileSize formatTime
  formatTimeAgo formatTimeUntil isGifUrl renderCordContent renderMarkdown root
  solvePoW useCallback useContext useEffect useIsMobile useMemo useRef useSocket
  useState
`.trim().split(/\s+/).map((name) => [name, "readonly"]));

export default [
  {
    ignores: [
      "node_modules/**",
      "data/**",
      "dist/**",
      "public/**/*.min.js",
    ],
  },
  {
    files: ["*.js", "handlers/**/*.js", "tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: globals.node,
    },
    rules: correctness,
  },
  {
    files: ["public/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...appGlobals,
        React: "readonly",
        ReactDOM: "readonly",
        io: "readonly",
      },
    },
    rules: correctness,
  },
  {
    files: ["public/games/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ...globals.browser,
        BABYLON: "readonly",
        BossCordGame: "readonly",
        Phaser: "readonly",
      },
    },
    rules: correctness,
  },
];
