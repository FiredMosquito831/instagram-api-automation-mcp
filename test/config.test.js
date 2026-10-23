import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, DEFAULT_CAPS, loadConfig } from '../src/config.js';

const OWNER = { igUserId: '17841400000000000', accountType: 'business' };

const EXPECTED_CAPS = {
  minSpacingMs: 2000,
  dailyTotal: 200,
  likes: { perHour: 10, perDay: 50 },
  follows: { perDay: 20 },
  unfollows: { perDay: 20 },
  ownerDms: { perDay: 50 },
  autoReplies: { perConversationHours: 24, perDay: 100 },
  publishing: { perDayLocal: 10 },
  hashtags: { perWeek: 30, windowDays: 7 },
  businessDiscovery: { perDay: 50 },
  mentionedMedia: { perDay: 50 },
  usageThrottlePercent: 80,
  usageBusyMs: 60000,
};

// A temporary directory that is removed when the test ends.
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ig-config-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Writes contents to a temporary JSON file (objects are serialised) and loads the config from it.
function load(t, contents, env = {}) {
  const file = join(tempDir(t), 'config.json');
  writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return loadConfig({ env, file });
}

function isConfigError(field) {
  return (err) => err instanceof ConfigError && err.field === field;
}

test('defaults match the caps and retention in Global Constraints', (t) => {
  const cfg = load(t, { owner: OWNER });
  assert.equal(cfg.caps.minSpacingMs, 2000);
  assert.equal(cfg.caps.hashtags.perWeek, 30);
  assert.equal(cfg.retentionDays, 30);
});

test('owner.accountType must be business, creator or personal', (t) => {
  for (const accountType of ['business', 'creator', 'personal']) {
    assert.equal(load(t, { owner: { ...OWNER, accountType } }).owner.accountType, accountType);
  }
  assert.throws(
    () => load(t, { owner: { ...OWNER, accountType: 'brand' } }),
    isConfigError('owner.accountType'),
  );
});

test('owner.igUserId is required', (t) => {
  assert.throws(() => load(t, { owner: { accountType: 'business' } }), isConfigError('owner.igUserId'));
  assert.throws(
    () => load(t, { owner: { igUserId: '  ', accountType: 'business' } }),
    isConfigError('owner.igUserId'),
  );
});

test('owner.igUserId must be a string, not a JSON number', (t) => {
  assert.throws(
    () => load(t, { owner: { igUserId: 17841400000000000, accountType: 'business' } }),
    isConfigError('owner.igUserId'),
  );
});

test('environment overrides the file for graph version', (t) => {
  const cfg = load(t, { owner: OWNER, graph: { version: 'v26.0' } }, { IG_GRAPH_VERSION: 'v27.0' });
  assert.equal(cfg.graph.version, 'v27.0');
});

test('the file overrides the defaults and the environment overrides the file', (t) => {
  const cfg = load(
    t,
    { owner: OWNER, retentionDays: 45, caps: { minSpacingMs: 3000 }, graph: { version: 'v26.1' } },
    { IG_GRAPH_VERSION: 'v27.0' },
  );
  assert.equal(cfg.retentionDays, 45);
  assert.equal(cfg.caps.minSpacingMs, 3000);
  assert.equal(cfg.caps.dailyTotal, 200);
  assert.equal(cfg.graph.version, 'v27.0');
  assert.equal(cfg.graph.instagramBase, 'https://graph.instagram.com');
});

test('an empty environment value does not override the file', (t) => {
  const cfg = load(t, { owner: OWNER, graph: { version: 'v26.1' } }, { IG_GRAPH_VERSION: '' });
  assert.equal(cfg.graph.version, 'v26.1');
});

test('app.id comes from IG_APP_ID and is null when unset', (t) => {
  assert.equal(load(t, { owner: OWNER }).app.id, null);
  assert.equal(load(t, { owner: OWNER }, { IG_APP_ID: '1234567890' }).app.id, '1234567890');
});

test('auto-replies, webhooks and unofficial routes are off by default', (t) => {
  const cfg = load(t, { owner: OWNER });
  assert.equal(cfg.autoReply.enabled, false);
  assert.equal(cfg.webhook.enabled, false);
  assert.equal(cfg.routes.unofficial.enabled, false);
  assert.equal(cfg.routes.unofficial.acknowledged, false);
});

test('the unofficial features map to the sidecar by default, and a config value for a feature wins', (t) => {
  const defaults = load(t, { owner: OWNER });
  assert.deepStrictEqual(defaults.routes.unofficial.adapterByFeature, {
    follow: 'sidecar',
    unfollow: 'sidecar',
    profileEdit: 'sidecar',
  });
  const mapped = load(t, { owner: OWNER, routes: { unofficial: { adapterByFeature: { follow: 'jslib' } } } });
  assert.equal(mapped.routes.unofficial.adapterByFeature.follow, 'jslib', 'the config value wins for its feature');
  assert.equal(mapped.routes.unofficial.adapterByFeature.unfollow, 'sidecar', 'the other features keep the default');
});

test('http binds 127.0.0.1 by default and likes use instagram login by default', (t) => {
  const cfg = load(t, { owner: OWNER });
  assert.equal(cfg.http.host, '127.0.0.1');
  assert.equal(cfg.routes.likes.loginProduct, 'instagram');
});

test('DEFAULT_CAPS is exactly the caps in the brief', () => {
  assert.deepStrictEqual(DEFAULT_CAPS, EXPECTED_CAPS);
});

test('the default config has exactly the documented shape', (t) => {
  assert.deepStrictEqual(load(t, { owner: OWNER }), {
    owner: OWNER,
    app: { id: null },
    graph: {
      version: 'v26.0',
      instagramBase: 'https://graph.instagram.com',
      facebookBase: 'https://graph.facebook.com',
    },
    routes: {
      unofficial: {
        enabled: false,
        acknowledged: false,
        adapterByFeature: { follow: 'sidecar', unfollow: 'sidecar', profileEdit: 'sidecar' },
        python: 'python',
      },
      likes: { loginProduct: 'instagram' },
    },
    caps: EXPECTED_CAPS,
    retentionDays: 30,
    dataDir: './data',
    media: { dir: './media', publicBaseUrl: null, allowedHosts: [] },
    story: { images: false },
    poll: { intervalMs: 60000, maxThreadsPerTick: 20, spacingMs: 600 },
    webhook: { enabled: false, path: '/webhooks/instagram' },
    http: { host: '127.0.0.1', port: 8788, allowedHosts: ['127.0.0.1', 'localhost'], allowRemote: false },
    autoReply: { enabled: false, rules: [] },
  });
});

test('http.allowRemote is false by default, and a value that is not a real boolean is refused with the field named', (t) => {
  assert.equal(load(t, { owner: OWNER }).http.allowRemote, false);
  assert.equal(load(t, { owner: OWNER, http: { allowRemote: true } }).http.allowRemote, true);
  for (const value of ['true', 1, null]) {
    assert.throws(
      () => load(t, { owner: OWNER, http: { allowRemote: value } }),
      isConfigError('http.allowRemote'),
      JSON.stringify(value),
    );
  }
});

test('each load gets its own copy of the caps', (t) => {
  const first = load(t, { owner: OWNER });
  first.caps.minSpacingMs = 1;
  first.caps.hashtags.perWeek = 1;
  const second = load(t, { owner: OWNER });
  assert.equal(second.caps.minSpacingMs, 2000);
  assert.equal(second.caps.hashtags.perWeek, 30);
  assert.deepStrictEqual(DEFAULT_CAPS, EXPECTED_CAPS);
});

test('a missing file, invalid JSON or a non-object file is a ConfigError for field file', (t) => {
  const missing = join(tempDir(t), 'missing.json');
  assert.throws(() => loadConfig({ env: {}, file: missing }), isConfigError('file'));
  assert.throws(() => load(t, '{ not json'), isConfigError('file'));
  assert.throws(() => load(t, '[1, 2]'), isConfigError('file'));
});

// F-10 (Task 1 re-review Minor-1). A __proto__ key in the file is refused, with its field named. The merge still skips it, as a
// second guard, but an owner's setting is never dropped without a message.
test('a __proto__ key in the file is refused with its field named, not dropped (F-10)', (t) => {
  assert.throws(
    () => load(t, '{"owner": {"igUserId": "1", "accountType": "business", "__proto__": {"polluted": true}}}'),
    isConfigError('owner.__proto__'),
  );
  assert.throws(
    () => load(t, `{"owner": ${JSON.stringify(OWNER)}, "caps": {"__proto__": {"perDay": 1}}}`),
    isConfigError('caps.__proto__'),
  );
});

// F-8 (Task 1 M3). A flag must be a real boolean, so the string "false" cannot turn the webhook receiver on.
test('webhook.enabled must be a real boolean, so the string false is refused (F-8)', (t) => {
  assert.throws(() => load(t, { owner: OWNER, webhook: { enabled: 'false' } }), isConfigError('webhook.enabled'));
  assert.throws(() => load(t, { owner: OWNER, webhook: { enabled: 1 } }), isConfigError('webhook.enabled'));
  assert.equal(load(t, { owner: OWNER, webhook: { enabled: true } }).webhook.enabled, true);
});

// F-8. The other sections are type-checked too, and the field is named in the error.
test('the other config sections are type-checked, with the field named (F-8)', (t) => {
  assert.throws(() => load(t, { owner: OWNER, http: { port: '8788' } }), isConfigError('http.port'));
  assert.throws(() => load(t, { owner: OWNER, routes: { likes: { loginProduct: 'twitter' } } }), isConfigError('routes.likes.loginProduct'));
  assert.throws(() => load(t, { owner: OWNER, autoReply: { enabled: 'yes' } }), isConfigError('autoReply.enabled'));
  assert.throws(() => load(t, { owner: OWNER, retentionDays: 0 }), isConfigError('retentionDays'));
  assert.throws(() => load(t, { owner: OWNER, dataDir: '   ' }), isConfigError('dataDir'));
  assert.throws(() => load(t, { owner: OWNER, graph: { version: 26 } }), isConfigError('graph.version'));
});

// F-9 (Task 1 M2). The owner id must be digits once the surrounding white space is removed. It is refused at load, and a
// padded id is stored trimmed.
test('owner.igUserId must hold only digits after trimming, and a padded id is stored trimmed (F-9)', (t) => {
  for (const igUserId of ['1784x', '-17841400000000000', '17841400000000000.0', '1 7841400000000000']) {
    assert.throws(() => load(t, { owner: { igUserId, accountType: 'business' } }), isConfigError('owner.igUserId'), igUserId);
  }
  assert.equal(load(t, { owner: { igUserId: '  17841400000000000  ', accountType: 'business' } }).owner.igUserId, '17841400000000000');
});

test('caps.minSpacingMs: null is rejected', (t) => {
  assert.throws(
    () => load(t, { owner: OWNER, caps: { minSpacingMs: null } }),
    isConfigError('caps.minSpacingMs'),
  );
});

test('caps.dailyTotal: "abc" is rejected', (t) => {
  assert.throws(
    () => load(t, { owner: OWNER, caps: { dailyTotal: 'abc' } }),
    isConfigError('caps.dailyTotal'),
  );
});

test('caps.minSpacingMs: -1 is rejected', (t) => {
  assert.throws(
    () => load(t, { owner: OWNER, caps: { minSpacingMs: -1 } }),
    isConfigError('caps.minSpacingMs'),
  );
});

test('a misspelt cap key such as caps.minSpacingMS is rejected', (t) => {
  assert.throws(
    () => load(t, { owner: OWNER, caps: { minSpacingMS: 5000 } }),
    isConfigError('caps.minSpacingMS'),
  );
});

test('a nested cap must stay an object, so caps.likes: 5 is rejected', (t) => {
  assert.throws(() => load(t, { owner: OWNER, caps: { likes: 5 } }), isConfigError('caps.likes'));
});

test('cap keys must be own keys of the defaults, so caps.constructor is rejected', (t) => {
  assert.throws(
    () => load(t, { owner: OWNER, caps: { constructor: 5 } }),
    isConfigError('caps.constructor'),
  );
});

test('caps accept whole numbers >= 0, including 0', (t) => {
  const cfg = load(t, { owner: OWNER, caps: { minSpacingMs: 0, hashtags: { perWeek: 0 } } });
  assert.equal(cfg.caps.minSpacingMs, 0);
  assert.equal(cfg.caps.hashtags.perWeek, 0);
});

test('caps.usageThrottlePercent: 0 is rejected', (t) => {
  assert.throws(
    () => load(t, { owner: OWNER, caps: { usageThrottlePercent: 0 } }),
    isConfigError('caps.usageThrottlePercent'),
  );
});

test('caps.usageThrottlePercent: 101 is rejected', (t) => {
  assert.throws(
    () => load(t, { owner: OWNER, caps: { usageThrottlePercent: 101 } }),
    isConfigError('caps.usageThrottlePercent'),
  );
});

test('caps.usageThrottlePercent: 80 is accepted', (t) => {
  const cfg = load(t, { owner: OWNER, caps: { usageThrottlePercent: 80 } });
  assert.equal(cfg.caps.usageThrottlePercent, 80);
});

test('caps.usageThrottlePercent accepts the inclusive bounds 1 and 100', (t) => {
  for (const usageThrottlePercent of [1, 100]) {
    const cfg = load(t, { owner: OWNER, caps: { usageThrottlePercent } });
    assert.equal(cfg.caps.usageThrottlePercent, usageThrottlePercent);
  }
});

// F-7 (Task 13 M-3). privateReplies.perCommentDays was never read, and the window is fixed at 7 days, so it is not a cap: a
// file that sets it is refused, and an owner edit cannot silently do nothing.
test('caps.privateReplies is not a known cap, so a file that sets it is refused (F-7)', (t) => {
  assert.throws(() => load(t, { owner: OWNER, caps: { privateReplies: { perCommentDays: 7 } } }), isConfigError('caps.privateReplies'));
});

// A-34 (final review). A UTF-8 byte-order mark is not JSON, so it is stripped before the file is parsed. A file that is not
// JSON still gives the clear error, with or without the mark.
test('a config file with a UTF-8 byte-order mark loads', (t) => {
  const file = join(tempDir(t), 'config.json');
  writeFileSync(file, `﻿${JSON.stringify({ owner: OWNER })}`);
  assert.equal(loadConfig({ env: {}, file }).owner.igUserId, OWNER.igUserId);
});

test('a config file that is not JSON gives the clear error, with or without a byte-order mark', (t) => {
  for (const contents of ['{ not json', '﻿{ not json']) {
    assert.throws(
      () => load(t, contents),
      (err) => err instanceof ConfigError && err.field === 'file' && /is not valid JSON/.test(err.message),
    );
  }
});

// ---------- P6 (2026-10-23): the media folder and the public base URL ----------

test('P6 media.dir defaults to ./media, and media.publicBaseUrl defaults to null', (t) => {
  const cfg = load(t, { owner: OWNER });
  assert.equal(cfg.media.dir, './media');
  assert.equal(cfg.media.publicBaseUrl, null);
});

test('P6 media.publicBaseUrl must be https: an http URL is refused', (t) => {
  assert.throws(
    () => load(t, { owner: OWNER, media: { publicBaseUrl: 'http://media.example.com/owner' } }),
    isConfigError('media.publicBaseUrl'),
  );
});

test('P6 media.publicBaseUrl with a query string or a fragment is refused, even an empty one', (t) => {
  for (const value of [
    'https://media.example.com/owner?a=1',
    'https://media.example.com/owner?',
    'https://media.example.com/owner#top',
    'https://media.example.com/owner#',
  ]) {
    assert.throws(() => load(t, { owner: OWNER, media: { publicBaseUrl: value } }), isConfigError('media.publicBaseUrl'), value);
  }
});

test('P6 media.publicBaseUrl loses its trailing slashes at load', (t) => {
  const cases = [
    ['https://media.example.com/owner/', 'https://media.example.com/owner'],
    ['https://media.example.com/', 'https://media.example.com'],
    ['https://media.example.com/a//', 'https://media.example.com/a'],
    ['https://media.example.com/owner', 'https://media.example.com/owner'],
  ];
  for (const [value, expected] of cases) {
    assert.equal(load(t, { owner: OWNER, media: { publicBaseUrl: value } }).media.publicBaseUrl, expected, value);
  }
});

test('P6 media.publicBaseUrl refuses credentials, a space, an empty string, a path that is not absolute, and a non-string', (t) => {
  for (const value of ['https://user:pass@media.example.com/owner', 'https://media.example.com/my owner', '', '/owner', 42]) {
    assert.throws(
      () => load(t, { owner: OWNER, media: { publicBaseUrl: value } }),
      isConfigError('media.publicBaseUrl'),
      String(value),
    );
  }
});

test('P6 media.dir must be a non-empty string', (t) => {
  for (const value of ['', '   ', 42]) {
    assert.throws(() => load(t, { owner: OWNER, media: { dir: value } }), isConfigError('media.dir'), String(value));
  }
});

// ---------- P6 fix round (2026-10-23): story.images, off by default ----------

test('P6-ST story.images defaults to false, so only video stories are published', (t) => {
  assert.equal(load(t, { owner: OWNER }).story.images, false);
});

test('P6-ST story.images must be a real boolean, so the string "true", a number and null are refused', (t) => {
  for (const value of ['true', 1, null]) {
    assert.throws(() => load(t, { owner: OWNER, story: { images: value } }), isConfigError('story.images'), String(value));
  }
  assert.equal(load(t, { owner: OWNER, story: { images: true } }).story.images, true);
});

// ---------- P6 review fixes (2026-10-23): media.allowedHosts ----------

test('P6-R2 media.allowedHosts defaults to the host of publicBaseUrl, and to none when publicBaseUrl is not set', (t) => {
  assert.deepEqual(load(t, { owner: OWNER }).media.allowedHosts, []);
  assert.deepEqual(
    load(t, { owner: OWNER, media: { publicBaseUrl: 'https://Media.Example.com/owner' } }).media.allowedHosts,
    ['media.example.com'],
  );
  assert.deepEqual(
    load(t, { owner: OWNER, media: { publicBaseUrl: 'https://media.example.com/owner', allowedHosts: null } }).media.allowedHosts,
    ['media.example.com'],
    'null means the default',
  );
});

test('P6-R2 media.allowedHosts takes host names, lowercased, and refuses anything else with the field named', (t) => {
  assert.deepEqual(
    load(t, { owner: OWNER, media: { allowedHosts: ['CDN.Example.org', 'example.com'] } }).media.allowedHosts,
    ['cdn.example.org', 'example.com'],
  );
  assert.throws(() => load(t, { owner: OWNER, media: { allowedHosts: 'example.com' } }), isConfigError('media.allowedHosts'));
  for (const value of ['https://cdn.example.org', 'cdn.example.org/path', 'cdn.example.org:8443', '', 'bad host', 'cdn..example', 42]) {
    assert.throws(
      () => load(t, { owner: OWNER, media: { allowedHosts: [value] } }),
      isConfigError('media.allowedHosts'),
      JSON.stringify(value),
    );
  }
});
