// Loads the service configuration. Merge order: defaults, then the JSON file, then the environment.

import { readFileSync } from 'node:fs';
import { isPlainObject } from './util/object.js';

export class ConfigError extends Error {
  constructor(field, message) {
    super(`${field} ${message}`);
    this.name = 'ConfigError';
    this.field = field;
  }
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

export const DEFAULT_CAPS = deepFreeze({
  minSpacingMs: 2000,
  dailyTotal: 200,
  likes: { perHour: 10, perDay: 50 },
  follows: { perDay: 20 },
  unfollows: { perDay: 20 },
  ownerDms: { perDay: 50 },
  autoReplies: { perConversationHours: 24, perDay: 100 },
  publishing: { perDayLocal: 10 },
  hashtags: { perWeek: 30, windowDays: 7 },
  // The lookups of other accounts, each capped per day (see the owner decisions, O-4).
  businessDiscovery: { perDay: 50 },
  mentionedMedia: { perDay: 50 },
  usageThrottlePercent: 80,
  usageBusyMs: 60000,
});

const ACCOUNT_TYPES = ['business', 'creator', 'personal'];

// Environment variables that override the merged file values. An empty value is ignored.
const ENV_OVERRIDES = {
  IG_GRAPH_VERSION: 'graph.version',
  IG_APP_ID: 'app.id',
};

function defaults() {
  return {
    owner: { igUserId: null, accountType: null },
    app: { id: null },
    graph: {
      version: 'v26.0',
      instagramBase: 'https://graph.instagram.com',
      facebookBase: 'https://graph.facebook.com',
    },
    routes: {
      // adapterByFeature: the unofficial features go to the sidecar by default. The route is still gated by enabled and acknowledged, and a
      // config value that names another adapter for a feature wins over this default (the config merge is per key).
      // python: the command that starts the sidecar. IG_PYTHON, when set, takes precedence over it.
      unofficial: {
        enabled: false,
        acknowledged: false,
        adapterByFeature: { follow: 'sidecar', unfollow: 'sidecar', profileEdit: 'sidecar' },
        python: 'python',
      },
      likes: { loginProduct: 'instagram' },
    },
    caps: structuredClone(DEFAULT_CAPS),
    retentionDays: 30,
    dataDir: './data',
    // The folder of files that a publish may name (relative to the project root), and the owner's public base URL (O-13).
    // allowedHosts: the host names that a direct publishing URL may be probed on. null means the default: the host of publicBaseUrl.
    media: { dir: './media', publicBaseUrl: null, allowedHosts: null },
    // Image stories are off until the live spike confirms the image story path (spec line 135).
    story: { images: false },
    poll: { intervalMs: 60000, maxThreadsPerTick: 20, spacingMs: 600 },
    webhook: { enabled: false, path: '/webhooks/instagram' },
    // allowRemote: false by default. It must be true before serve binds a non-loopback host, and before status sends the token to one.
    // The HTTP API is plain HTTP, so on a non-loopback host the token travels in clear text on that network.
    http: { host: '127.0.0.1', port: 8788, allowedHosts: ['127.0.0.1', 'localhost'], allowRemote: false },
    autoReply: { enabled: false, rules: [] },
  };
}

// Returns a new object. Plain objects merge key by key; any other value replaces the base value.
function merge(base, over) {
  const out = { ...base };
  for (const [key, value] of Object.entries(over)) {
    // Assigning __proto__ would change the prototype of the result, so a file cannot set it.
    if (key === '__proto__') continue;
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? merge(base[key], value) : value;
  }
  return out;
}

function readJsonFile(file) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    throw new ConfigError('file', `could not be read (${err.code ?? 'error'})`);
  }
  // A UTF-8 byte-order mark is not part of the JSON text, so it is removed before parsing (A-34). Any other text is parsed as
  // it is, so a file that is not JSON still gives the clear error.
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ConfigError('file', 'is not valid JSON');
  }
  if (!isPlainObject(parsed)) throw new ConfigError('file', 'must contain a JSON object');
  return parsed;
}

// Builds a partial config from the environment, for example { graph: { version: 'v27.0' } }.
function envLayer(env) {
  let layer = {};
  for (const [name, path] of Object.entries(ENV_OVERRIDES)) {
    const raw = env[name];
    if (typeof raw !== 'string' || raw.trim() === '') continue;
    const partial = path.split('.').reduceRight((inner, key) => ({ [key]: inner }), raw.trim());
    layer = merge(layer, partial);
  }
  return layer;
}

// Checks the owner section, and returns the owner id with its surrounding white space removed. The id must be digits only,
// so a padded or non-numeric id fails at load, not at serve start.
function validateOwner(config) {
  const owner = isPlainObject(config.owner) ? config.owner : {};
  const { igUserId, accountType } = owner;
  const missing =
    igUserId === undefined ||
    igUserId === null ||
    (typeof igUserId === 'string' && igUserId.trim() === '');
  if (missing) throw new ConfigError('owner.igUserId', 'is required');
  // A JSON number can lose precision for a long id, so the id must be a quoted string.
  if (typeof igUserId !== 'string') {
    throw new ConfigError('owner.igUserId', 'must be a string; quote it in the JSON file');
  }
  const id = igUserId.trim();
  if (!/^\d+$/.test(id)) throw new ConfigError('owner.igUserId', 'must hold only digits');
  if (!ACCOUNT_TYPES.includes(accountType)) {
    throw new ConfigError('owner.accountType', 'must be business, creator or personal');
  }
  return id;
}

// A key named __proto__ in the config file is refused, not dropped, so a setting never goes missing without a message.
function refuseProtoKeys(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => refuseProtoKeys(item, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    const field = path === '' ? key : `${path}.${key}`;
    if (key === '__proto__') throw new ConfigError(field, 'is not allowed in the config file');
    refuseProtoKeys(value[key], field);
  }
}

// The public base URL of the owner's host, which serves the media files (O-13). It must be https, with no query string, no
// fragment, no credentials and no white space, so that the URL built from it is exact. Its trailing slashes are removed. A
// null value is no base URL: only a direct URL can then be published.
function checkPublicBaseUrl(value) {
  if (value === null) return null;
  const fail = () => {
    throw new ConfigError(
      'media.publicBaseUrl',
      'must be an https URL with no query string and no fragment, such as https://media.example.com/owner',
    );
  };
  if (typeof value !== 'string' || value === '' || /\s/.test(value)) fail();
  if (value.includes('?') || value.includes('#')) fail();
  const base = value.replace(/\/+$/, '');
  const probe = `${base}/`;
  let url;
  try {
    url = new URL(probe);
  } catch {
    fail();
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.search !== '' || url.hash !== '') {
    fail();
  }
  // A host or path that the URL parser changes (for example by encoding a character) is refused, not silently rewritten.
  if (url.href.toLowerCase() !== probe.toLowerCase()) fail();
  return base;
}

// A host name: lowercase letters, digits and hyphens in labels separated by dots. No scheme, path, port or white space.
const HOST_NAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

// The hosts that a direct publishing URL may be probed on (P6 review M-2). null is the default: the host of publicBaseUrl, or
// none when that is not set. A list is taken in lowercase; anything that is not a host name is refused with the field named.
function checkAllowedHosts(value, publicBaseUrl) {
  const field = 'media.allowedHosts';
  if (value === null) return publicBaseUrl === null ? [] : [new URL(publicBaseUrl).hostname.toLowerCase()];
  if (!Array.isArray(value)) throw new ConfigError(field, 'must be a list of host names, such as ["cdn.example.com"]');
  return value.map((host) => {
    const name = typeof host === 'string' ? host.toLowerCase() : '';
    if (!HOST_NAME.test(name)) {
      throw new ConfigError(field, 'must hold host names only: letters, digits, hyphens and dots, with no scheme, path or port');
    }
    return name;
  });
}

// Each section must hold the types that the service reads, so a value of another type is refused at load, with its field
// named. A flag must be a real boolean: the string "false" would otherwise turn a feature on. The poll settings and the
// allowed hosts are checked in full by the modules that read them.
function checkSections(config) {
  const fail = (field, what) => {
    throw new ConfigError(field, `must be ${what}`);
  };
  const section = (field, value) => {
    if (!isPlainObject(value)) fail(field, 'an object');
    return value;
  };
  const text = (field, value) => {
    if (typeof value !== 'string' || value.trim() === '') fail(field, 'a non-empty string');
  };
  const flag = (field, value) => {
    if (typeof value !== 'boolean') fail(field, 'true or false');
  };
  const whole = (field, value, min, max = Number.MAX_SAFE_INTEGER) => {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail(field, `a whole number from ${min} to ${max}`);
  };

  const app = section('app', config.app);
  if (app.id !== null) text('app.id', app.id);

  const graph = section('graph', config.graph);
  text('graph.version', graph.version);
  text('graph.instagramBase', graph.instagramBase);
  text('graph.facebookBase', graph.facebookBase);

  const routes = section('routes', config.routes);
  const unofficial = section('routes.unofficial', routes.unofficial);
  flag('routes.unofficial.enabled', unofficial.enabled);
  flag('routes.unofficial.acknowledged', unofficial.acknowledged);
  text('routes.unofficial.python', unofficial.python);
  const adapters = section('routes.unofficial.adapterByFeature', unofficial.adapterByFeature);
  for (const [feature, name] of Object.entries(adapters)) text(`routes.unofficial.adapterByFeature.${feature}`, name);
  const likes = section('routes.likes', routes.likes);
  if (!['instagram', 'facebook'].includes(likes.loginProduct)) fail('routes.likes.loginProduct', 'instagram or facebook');

  whole('retentionDays', config.retentionDays, 1);
  text('dataDir', config.dataDir);
  const media = section('media', config.media);
  text('media.dir', media.dir);
  const publicBaseUrl = checkPublicBaseUrl(media.publicBaseUrl);
  config.media = { ...media, publicBaseUrl, allowedHosts: checkAllowedHosts(media.allowedHosts, publicBaseUrl) };
  const story = section('story', config.story);
  flag('story.images', story.images);
  section('poll', config.poll);

  const webhook = section('webhook', config.webhook);
  flag('webhook.enabled', webhook.enabled);
  text('webhook.path', webhook.path);
  if (!webhook.path.startsWith('/')) fail('webhook.path', 'a path that starts with /');

  const http = section('http', config.http);
  text('http.host', http.host);
  whole('http.port', http.port, 1, 65535);
  if (!Array.isArray(http.allowedHosts)) fail('http.allowedHosts', 'a list of host names');
  flag('http.allowRemote', http.allowRemote);

  const autoReply = section('autoReply', config.autoReply);
  flag('autoReply.enabled', autoReply.enabled);
  if (!Array.isArray(autoReply.rules)) fail('autoReply.rules', 'a list');
}

// Checks the merged caps against DEFAULT_CAPS. Keys must be known caps, nested caps must stay
// objects, and every leaf must be a whole number >= 0 (the usage throttle is 1 to 100). The field
// names the offending path.
function validateCaps(caps, shape, path) {
  if (!isPlainObject(caps)) throw new ConfigError(path, 'must be an object');
  for (const key of Object.keys(caps)) {
    const field = `${path}.${key}`;
    if (!Object.hasOwn(shape, key)) throw new ConfigError(field, 'is not a known cap');
    if (isPlainObject(shape[key])) {
      validateCaps(caps[key], shape[key], field);
    } else if (field === 'caps.usageThrottlePercent') {
      // A percentage above 100 is never reached, so the usage throttle would never trigger.
      if (!Number.isInteger(caps[key]) || caps[key] < 1 || caps[key] > 100) {
        throw new ConfigError(field, 'must be a whole number from 1 to 100');
      }
    } else if (!Number.isInteger(caps[key]) || caps[key] < 0) {
      throw new ConfigError(field, 'must be a whole number >= 0');
    }
  }
}

export function loadConfig({ env = process.env, file } = {}) {
  let config = defaults();
  if (file !== undefined && file !== null) {
    const raw = readJsonFile(file);
    refuseProtoKeys(raw, '');
    config = merge(config, raw);
  }
  config = merge(config, envLayer(env));
  const igUserId = validateOwner(config);
  config.owner = { ...config.owner, igUserId };
  checkSections(config);
  validateCaps(config.caps, DEFAULT_CAPS, 'caps');
  return config;
}
