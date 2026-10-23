### Task 1: Package skeleton and configuration

**Files:** Create `package.json`, `src/config.js`. Test: `test/config.test.js`.

**Interfaces:**
- Consumes: nothing.
- Produces: `loadConfig({ env, file }) -> Config`, which throws `ConfigError` with a `.field` property; `DEFAULT_CAPS`; `ConfigError`.
- `DEFAULT_CAPS` is exactly: `{ minSpacingMs: 2000, dailyTotal: 200, likes: { perHour: 10, perDay: 50 }, follows: { perDay: 20 }, unfollows: { perDay: 20 }, ownerDms: { perDay: 50 }, privateReplies: { perCommentDays: 7 }, autoReplies: { perConversationHours: 24, perDay: 100 }, publishing: { perDayLocal: 10 }, hashtags: { perWeek: 30, windowDays: 7 }, usageThrottlePercent: 80, usageBusyMs: 60000 }`.
- The config is `{ owner: { igUserId, accountType }, graph: { version: 'v26.0', instagramBase, facebookBase }, routes: { unofficial: { enabled: false, acknowledged: false, adapterByFeature: {} }, likes: { loginProduct: 'instagram' } }, caps: DEFAULT_CAPS, retentionDays: 30, dataDir: './data', poll: { intervalMs: 60000, maxThreadsPerTick: 20, spacingMs: 600 }, webhook: { enabled: false, path: '/webhooks/instagram' }, http: { host: '127.0.0.1', port: 8788, allowedHosts: ['127.0.0.1', 'localhost'] }, autoReply: { enabled: false, rules: [] } }`.
- Merge order: defaults, then the JSON file, then the environment.

**Tests (write first):**
- `defaults match the caps and retention in Global Constraints`: `cfg.caps.minSpacingMs === 2000`, `cfg.caps.hashtags.perWeek === 30`, `cfg.retentionDays === 30`.
- `owner.accountType must be business, creator or personal`: `'brand'` throws `ConfigError` with `field === 'owner.accountType'`.
- `owner.igUserId is required`: a missing value throws with `field === 'owner.igUserId'`.
- `environment overrides the file for graph version`: `IG_GRAPH_VERSION='v27.0'` gives `cfg.graph.version === 'v27.0'`.
- `auto-replies, webhooks and unofficial routes are off by default`.
- `http binds 127.0.0.1 by default and likes use instagram login by default`.

- [ ] **Step 1: Write the tests above.** Use a temporary JSON file for `file`.
- [ ] **Step 2: Run `node --test test/config.test.js`.** Expected: FAIL, module not found.
- [ ] **Step 3: Write `package.json` and `src/config.js`.** The package has no dependencies yet. The config validates `owner.accountType` against the three values.
- [ ] **Step 4: Run `node --test test/config.test.js`.** Expected: all pass.

