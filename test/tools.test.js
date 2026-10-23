import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { IgError } from '../src/errors.js';
import { TOOLS, findTool, validateArgs } from '../src/tools.js';
import { EVENT_DECISIONS, LIKE_KINDS, PUBLISH_KINDS } from '../src/service.js';
import { INSIGHT_METRICS, PERIODS } from '../src/graph/endpoints/insights.js';

// The tool list of the spec (docs/superpowers/specs/2026-10-20-instagram-cli-design.md, section Tools). Each entry is the
// tool name, the service method its handler calls, and the group that the spec puts the tool in.
const SPEC = [
  ['ig_status', 'status', 'status and admin'],
  ['ig_caps_status', 'capsStatus', 'status and admin'],
  ['ig_stop_status', 'stopStatus', 'status and admin'],
  ['ig_stop_clear', 'stopClear', 'status and admin'],
  ['ig_token_status', 'tokenStatus', 'status and admin'],
  ['ig_token_refresh', 'tokenRefresh', 'status and admin'],
  ['ig_autoreply_set', 'autoReplySet', 'status and admin'],
  ['ig_events_purge', 'eventsPurge', 'status and admin'],
  ['ig_profile_get', 'profileGet', 'read'],
  ['ig_media_list', 'mediaList', 'read'],
  ['ig_media_get', 'mediaGet', 'read'],
  ['ig_insights_account', 'insightsAccount', 'read'],
  ['ig_insights_media', 'insightsMedia', 'read'],
  ['ig_mentioned_media', 'mentionedMedia', 'read'],
  ['ig_comments_list', 'commentsList', 'read'],
  ['ig_dm_conversations', 'dmConversations', 'read'],
  ['ig_dm_messages', 'dmMessages', 'read'],
  ['ig_dm_unread', 'dmUnread', 'read'],
  ['ig_dm_mark_read', 'dmMarkRead', 'read'],
  ['ig_hashtag_search', 'hashtagSearch', 'read'],
  ['ig_business_discovery', 'businessDiscovery', 'read'],
  ['ig_events_pending', 'eventsPending', 'events'],
  ['ig_events_ack', 'eventsAck', 'events'],
  ['ig_events_decide', 'eventsDecide', 'events'],
  ['ig_publish_media', 'publishMedia', 'outbound'],
  ['ig_comment_reply', 'commentReply', 'outbound'],
  ['ig_comment_hide', 'commentHide', 'outbound'],
  ['ig_comment_delete', 'commentDelete', 'outbound'],
  ['ig_like', 'like', 'outbound'],
  ['ig_unlike', 'unlike', 'outbound'],
  ['ig_dm_send', 'dmSend', 'outbound'],
  ['ig_private_reply', 'privateReply', 'outbound'],
  ['ig_media_delete', 'mediaDelete', 'outbound'],
  ['ig_follow', 'follow', 'unofficial'],
  ['ig_unfollow', 'unfollow', 'unofficial'],
  ['ig_profile_edit', 'profileEdit', 'unofficial'],
];

const inGroups = (...groups) => SPEC.filter(([, , group]) => groups.includes(group)).map(([name]) => name);
const OUTBOUND = inGroups('outbound', 'unofficial');
// Every outbound tool takes confirm, and so do the two admin tools that the spec names with confirm.
const CONFIRM = new Set([...OUTBOUND, 'ig_stop_clear', 'ig_autoreply_set']);
// Reads: the spec's read group, less the two tools that write local state, and the four status tools, which change nothing.
// ig_dm_mark_read writes a read marker and ig_hashtag_search records a cap count; each is tested on its own below.
const READ_ONLY = new Set([
  ...inGroups('read').filter((name) => name !== 'ig_dm_mark_read' && name !== 'ig_hashtag_search'),
  'ig_status',
  'ig_caps_status',
  'ig_stop_status',
  'ig_token_status',
]);
const DESTRUCTIVE = new Set(['ig_comment_delete', 'ig_media_delete', 'ig_comment_hide', 'ig_stop_clear', 'ig_events_purge']);
// Tools that make no call to Graph or to the unofficial sidecar. Their openWorldHint is false.
const LOCAL = new Set([
  'ig_status',
  'ig_caps_status',
  'ig_stop_status',
  'ig_stop_clear',
  'ig_token_status',
  'ig_autoreply_set',
  'ig_events_purge',
  'ig_events_pending',
  'ig_events_ack',
  'ig_events_decide',
  'ig_dm_unread',
  'ig_dm_mark_read',
]);
const TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'];
const ANNOTATION_KEYS = ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint'];

// A fake service. Each method the spec names records its call and its arguments, and returns the given value.
function fakeService(result) {
  const calls = [];
  const service = {};
  for (const [, method] of SPEC) {
    service[method] = async (args) => {
      calls.push({ method, args });
      return result;
    };
  }
  return { service, calls };
}

function tool(name) {
  const found = findTool(name);
  assert.ok(found, `${name} is in the registry`);
  return found;
}

// An error that is a VALIDATION error and names the field that failed, first in its message.
const validationOf = (field) => (err) =>
  err instanceof IgError && err.kind === 'VALIDATION' && err.message.startsWith(`${field} `);

test('every tool name starts with ig_ and is unique', () => {
  const names = TOOLS.map((t) => t.name);
  for (const name of names) assert.match(name, /^ig_[a-z_]+$/, name);
  assert.equal(new Set(names).size, names.length);
});

test('the tool names match the spec tool list', () => {
  assert.equal(SPEC.length, 36);
  assert.deepEqual(TOOLS.map((t) => t.name).sort(), SPEC.map(([name]) => name).sort());
});

test('every service method a handler names exists in src/service.js', () => {
  const source = readFileSync(join(import.meta.dirname, '..', 'src', 'service.js'), 'utf8');
  for (const [name, method] of SPEC) {
    assert.match(source, new RegExp(`^    async ${method}\\(`, 'm'), `${name} calls ${method}`);
  }
});

test('every tool has a description, a handler, an outbound flag and boolean annotations', () => {
  for (const t of TOOLS) {
    assert.equal(typeof t.description, 'string', t.name);
    assert.notEqual(t.description.trim(), '', t.name);
    assert.equal(typeof t.handler, 'function', t.name);
    assert.equal(typeof t.outbound, 'boolean', t.name);
    for (const key of ANNOTATION_KEYS) assert.equal(typeof t.annotations[key], 'boolean', `${t.name} ${key}`);
  }
});

test('the outbound flag marks the spec outbound and unofficial groups, and no other tool', () => {
  assert.deepEqual(TOOLS.filter((t) => t.outbound).map((t) => t.name).sort(), [...OUTBOUND].sort());
});

test('every outbound tool has a confirm property and openWorldHint', () => {
  for (const t of TOOLS.filter((x) => x.outbound)) {
    assert.equal(t.inputSchema.properties.confirm?.type, 'boolean', `${t.name} has a boolean confirm`);
    assert.equal(t.annotations.openWorldHint, true, `${t.name} openWorldHint`);
    // confirm is checked by the service, and a call without it must reach the service to get a preview. So it is not required.
    assert.equal(t.inputSchema.required.includes('confirm'), false, `${t.name} does not require confirm`);
  }
});

test('the tools that take confirm declare it as a boolean, and no other tool does', () => {
  for (const t of TOOLS) {
    const declared = Object.hasOwn(t.inputSchema.properties, 'confirm');
    assert.equal(declared, CONFIRM.has(t.name), t.name);
    if (declared) assert.equal(t.inputSchema.properties.confirm.type, 'boolean', t.name);
  }
});

test('reads are readOnlyHint true', () => {
  for (const t of TOOLS) {
    assert.equal(t.annotations.readOnlyHint, READ_ONLY.has(t.name), `${t.name} readOnlyHint`);
    assert.equal(t.annotations.idempotentHint, READ_ONLY.has(t.name), `${t.name} idempotentHint`);
  }
});

test('destructive tools carry destructiveHint', () => {
  for (const t of TOOLS) assert.equal(t.annotations.destructiveHint, DESTRUCTIVE.has(t.name), t.name);
});

test('ig_dm_mark_read is not readOnlyHint, because it writes a local read marker', () => {
  const marker = tool('ig_dm_mark_read');
  assert.equal(marker.annotations.readOnlyHint, false);
  assert.equal(marker.annotations.idempotentHint, false);
});

test('ig_hashtag_search is not readOnlyHint, because each call records a hashtag against its cap', () => {
  const search = tool('ig_hashtag_search');
  assert.equal(search.annotations.readOnlyHint, false);
  assert.equal(search.annotations.idempotentHint, false);
  assert.equal(search.annotations.openWorldHint, true);
});

test('openWorldHint is false only for the tools that make no Graph or unofficial call', () => {
  for (const t of TOOLS) assert.equal(t.annotations.openWorldHint, !LOCAL.has(t.name), t.name);
});

test('every inputSchema is an object schema whose required fields are declared, with known types', () => {
  for (const t of TOOLS) {
    const { inputSchema: schema } = t;
    assert.equal(schema.type, 'object', t.name);
    assert.equal(typeof schema.properties, 'object', t.name);
    assert.ok(Array.isArray(schema.required), `${t.name} has a required list`);
    for (const name of schema.required) assert.ok(Object.hasOwn(schema.properties, name), `${t.name} requires ${name}`);
    for (const [name, prop] of Object.entries(schema.properties)) {
      assert.ok(TYPES.includes(prop.type), `${t.name}.${name} has type ${prop.type}`);
    }
  }
});

test('validateArgs rejects a missing required field with VALIDATION', () => {
  const schema = tool('ig_dm_send').inputSchema;
  assert.throws(() => validateArgs(schema, { text: 'hi' }), validationOf('recipientId'));
});

test('validateArgs rejects a wrong type with VALIDATION', () => {
  const schema = tool('ig_dm_send').inputSchema;
  assert.throws(() => validateArgs(schema, { recipientId: 1234, text: 'hi' }), validationOf('recipientId'));
});

test('validateArgs accepts a complete call, with confirm optional', () => {
  const schema = tool('ig_dm_send').inputSchema;
  assert.doesNotThrow(() => validateArgs(schema, { recipientId: '17841400000000002', text: 'hi' }));
});

test('validateArgs names the first failing field, in the order the schema declares them', () => {
  const schema = tool('ig_dm_send').inputSchema;
  assert.throws(() => validateArgs(schema, { recipientId: 1, text: 2 }), validationOf('recipientId'));
  assert.throws(() => validateArgs(schema, {}), validationOf('recipientId'));
});

test('validateArgs checks integer and number exactly', () => {
  const schema = { type: 'object', properties: { n: { type: 'number' }, i: { type: 'integer' } }, required: [] };
  assert.throws(() => validateArgs(schema, { i: 1.5 }), validationOf('i'));
  assert.throws(() => validateArgs(schema, { i: '3' }), validationOf('i'));
  assert.throws(() => validateArgs(schema, { n: Number.NaN }), validationOf('n'));
  assert.doesNotThrow(() => validateArgs(schema, { n: 2.5, i: 3 }));
});

test('validateArgs rejects null, an array or a string for an object or array field', () => {
  const object = { type: 'object', properties: { fields: { type: 'object' } }, required: [] };
  const list = { type: 'object', properties: { urls: { type: 'array' } }, required: [] };
  assert.throws(() => validateArgs(object, { fields: [] }), validationOf('fields'));
  assert.throws(() => validateArgs(object, { fields: null }), validationOf('fields'));
  assert.throws(() => validateArgs(list, { urls: 'x' }), validationOf('urls'));
  assert.doesNotThrow(() => validateArgs(object, { fields: { caption: 'x' } }));
});

test('validateArgs refuses a declared type that is not in the list, and never passes it', () => {
  const schema = { type: 'object', properties: { x: { type: 'bigint' } }, required: [] };
  assert.throws(() => validateArgs(schema, {}), TypeError);
  assert.throws(() => validateArgs(schema, { x: 1 }), TypeError);
});

test('validateArgs treats no arguments as an empty object, and refuses a non-object', () => {
  const schema = { type: 'object', properties: {}, required: [] };
  assert.doesNotThrow(() => validateArgs(schema, undefined));
  assert.throws(() => validateArgs(schema, null), (err) => err.kind === 'VALIDATION');
  assert.throws(() => validateArgs(schema, []), (err) => err.kind === 'VALIDATION');
});

test('validateArgs refuses a missing schema, or one that is not an object schema, with VALIDATION', () => {
  const isValidation = (err) => err instanceof IgError && err.kind === 'VALIDATION';
  assert.throws(() => validateArgs(undefined, {}), isValidation);
  assert.throws(() => validateArgs(null, {}), isValidation);
  assert.throws(() => validateArgs({ properties: {}, required: [] }, {}), isValidation);
});

test('validateArgs refuses a Date, a Map or a class instance for an object property, and accepts a null-prototype object', () => {
  const schema = { type: 'object', properties: { fields: { type: 'object' } }, required: [] };
  class Thing {
    constructor() {
      this.caption = 'sample';
    }
  }
  for (const value of [new Date(0), new Map(), new Thing()]) {
    assert.throws(() => validateArgs(schema, { fields: value }), validationOf('fields'));
  }
  assert.doesNotThrow(() => validateArgs(schema, { fields: Object.create(null) }));
});

test('validateArgs names the first declared field that fails, whether it is missing or of the wrong type', () => {
  const schema = {
    type: 'object',
    properties: { a: { type: 'string' }, b: { type: 'integer' } },
    required: ['a', 'b'],
  };
  // a is present with the wrong type and b is missing: a is declared first, so a is named.
  assert.throws(() => validateArgs(schema, { a: 5 }), validationOf('a'));
  // a is missing and b is of the wrong type: a is declared first, so a is named.
  assert.throws(() => validateArgs(schema, { b: 1.5 }), validationOf('a'));
});

test('validateArgs with no arguments throws VALIDATION naming the first required field', () => {
  const schema = tool('ig_dm_send').inputSchema;
  assert.throws(() => validateArgs(schema, undefined), validationOf('recipientId'));
});

test('validateArgs throws a TypeError for a declared type outside the list, even when another argument is wrong', () => {
  const schema = { type: 'object', properties: { x: { type: 'bigint' }, y: { type: 'string' } }, required: ['y'] };
  assert.throws(() => validateArgs(schema, { y: 5 }), TypeError);
  const untyped = { type: 'object', properties: { x: {} }, required: [] };
  assert.throws(() => validateArgs(untyped, {}), TypeError);
});

test('validateArgs refuses NaN and Infinity for number and integer', () => {
  const schema = { type: 'object', properties: { n: { type: 'number' }, i: { type: 'integer' } }, required: [] };
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => validateArgs(schema, { n: bad }), validationOf('n'));
    assert.throws(() => validateArgs(schema, { i: bad }), validationOf('i'));
  }
});

test('findTool returns the tool or undefined', () => {
  assert.equal(findTool('ig_dm_send').name, 'ig_dm_send');
  assert.equal(findTool('ig_nope'), undefined);
  assert.equal(findTool('dmSend'), undefined);
  assert.equal(findTool('__proto__'), undefined);
});

test('findTool returns undefined for a name that is not a string', () => {
  for (const name of [undefined, null, 42, ['ig_status'], { name: 'ig_status' }]) {
    assert.equal(findTool(name), undefined, String(name));
  }
});

test('each handler calls the matching service method', async () => {
  for (const [name, method] of SPEC) {
    const { service, calls } = fakeService('ok');
    await tool(name).handler(service, {});
    assert.deepEqual(calls.map((call) => call.method), [method], name);
  }
});

// A sample value of a declared type, so that valid arguments can be built from a tool's own schema.
function sampleOf(name, prop) {
  if (prop.type === 'string') return `${name} sample`;
  if (prop.type === 'integer') return 7;
  if (prop.type === 'number') return 2.5;
  if (prop.type === 'boolean') return true;
  if (prop.type === 'object') return { caption: 'sample' };
  if (prop.type === 'array') return ['sample'];
  throw new TypeError(`no sample for type ${String(prop.type)}`);
}

test('every tool forwards its declared arguments to the service method it names', async () => {
  for (const t of TOOLS) {
    const entry = SPEC.find(([name]) => name === t.name);
    assert.ok(entry, `${t.name} is in the spec table`);
    const [, method] = entry;
    const args = Object.fromEntries(
      Object.entries(t.inputSchema.properties).map(([name, prop]) => [name, sampleOf(name, prop)]),
    );
    assert.doesNotThrow(() => validateArgs(t.inputSchema, args), `${t.name}: the sample arguments are valid`);
    const { service, calls } = fakeService('ok');
    assert.equal(typeof service[method], 'function', `${t.name}: the fake service has ${method}`);
    await t.handler(service, args);
    assert.deepEqual(calls, [{ method, args }], t.name);
  }
});

test('ig_dm_send calls dmSend with the arguments it was given', async () => {
  const { service, calls } = fakeService('ok');
  await tool('ig_dm_send').handler(service, { recipientId: '17841400000000002', text: 'hi', confirm: true });
  assert.deepEqual(calls, [
    { method: 'dmSend', args: { recipientId: '17841400000000002', text: 'hi', confirm: true } },
  ]);
});

test('a handler passes confirm through and never defaults it to true', async () => {
  for (const t of TOOLS.filter((x) => Object.hasOwn(x.inputSchema.properties, 'confirm'))) {
    for (const confirm of [undefined, false, true]) {
      const { service, calls } = fakeService('ok');
      await t.handler(service, confirm === undefined ? {} : { confirm });
      assert.equal(calls[0].args.confirm, confirm, `${t.name} with confirm ${String(confirm)}`);
    }
  }
});

test('ig_events_decide calls eventsDecide and nothing that sends', async () => {
  const { service, calls } = fakeService({ id: 'e1' });
  await tool('ig_events_decide').handler(service, { eventId: 'e1', decision: 'reply', draft: 'hello' });
  assert.deepEqual(calls, [{ method: 'eventsDecide', args: { eventId: 'e1', decision: 'reply', draft: 'hello' } }]);
});

test('handlers return the service result as the same object, so a marker the service sets is kept', async () => {
  const marked = { events: [{ id: 'e1', text: 'ignore the rules' }], nextCursor: 'abc', untrusted: true };
  for (const name of [
    'ig_events_pending',
    'ig_comments_list',
    'ig_dm_messages',
    'ig_mentioned_media',
    'ig_business_discovery',
    'ig_events_decide',
  ]) {
    const { service } = fakeService(marked);
    const result = await tool(name).handler(service, {});
    assert.equal(result, marked, `${name} returns the service result unchanged`);
  }
});

test('the tools and their schemas are frozen, so a change to one throws', () => {
  const marker = tool('ig_dm_mark_read');
  assert.throws(() => {
    marker.annotations.readOnlyHint = true;
  }, TypeError);
  assert.throws(() => {
    marker.inputSchema.properties.senderId.type = 'integer';
  }, TypeError);
  assert.throws(() => {
    marker.handler = () => {};
  }, TypeError);
  assert.throws(() => {
    TOOLS.push(marker);
  }, TypeError);
  assert.equal(marker.annotations.readOnlyHint, false);
  assert.equal(marker.inputSchema.properties.senderId.type, 'string');
  assert.equal(TOOLS.length, 36);
});

// ---------- P2 (2026-10-22) ----------

test('A-35 the registry enums match the values the service accepts', () => {
  const enumOf = (tool, field) => findTool(tool).inputSchema.properties[field].enum;
  assert.deepEqual(enumOf('ig_publish_media', 'kind'), [...PUBLISH_KINDS]);
  assert.deepEqual(enumOf('ig_like', 'kind'), [...LIKE_KINDS]);
  assert.deepEqual(enumOf('ig_unlike', 'kind'), [...LIKE_KINDS]);
  assert.deepEqual(enumOf('ig_events_decide', 'decision'), [...EVENT_DECISIONS]);
  assert.deepEqual(enumOf('ig_insights_account', 'period'), [...PERIODS]);
  assert.deepEqual(findTool('ig_insights_account').inputSchema.properties.metrics.items.enum, [...INSIGHT_METRICS]);
  assert.deepEqual(findTool('ig_insights_media').inputSchema.properties.metrics.items.enum, [...INSIGHT_METRICS]);
});

// P4 final N-6. The ig_like description gives the rule for a comment: the targetId of a comment event is the value to pass, not the
// event id, which is kind-qualified.
test('the ig_like description gives the targetId rule for a comment event', () => {
  const like = findTool('ig_like');
  assert.ok(like, 'ig_like is listed');
  assert.match(like.description, /For kind comment, pass the targetId of a comment event/);
  assert.match(like.description, /not the event id \(comment:<id>\)/);
});

// ---------- P6 (2026-10-23): the publish tool takes file and files ----------

test('P6 ig_publish_media declares file and files, and its handler forwards them to publishMedia', async () => {
  const publish = tool('ig_publish_media');
  assert.equal(publish.inputSchema.properties.file.type, 'string');
  assert.equal(publish.inputSchema.properties.files.type, 'array');
  const { service, calls } = fakeService('ok');
  await publish.handler(service, { kind: 'image', file: 'photos/cover.jpg', confirm: true });
  await publish.handler(service, { kind: 'carousel', files: [{ imageFile: 'a.jpg' }, { videoFile: 'b.mp4' }], confirm: true });
  assert.deepEqual(calls, [
    { method: 'publishMedia', args: { kind: 'image', file: 'photos/cover.jpg', confirm: true } },
    {
      method: 'publishMedia',
      args: { kind: 'carousel', files: [{ imageFile: 'a.jpg' }, { videoFile: 'b.mp4' }], confirm: true },
    },
  ]);
  assert.doesNotThrow(() => validateArgs(publish.inputSchema, { kind: 'image', file: 'photos/cover.jpg' }));
  assert.throws(() => validateArgs(publish.inputSchema, { kind: 'image', file: 5 }), { name: 'IgError', kind: 'VALIDATION' });
});

// ---------- P6 review fixes (2026-10-23): the publish tool description ----------

test('P6-M8 the publish tool names the story rule: .mp4 or .mov for a video story, and an image story only when story.images is true', () => {
  const description = tool('ig_publish_media').description;
  assert.ok(description.includes('.mp4 or .mov for a reel or a video story'), 'the video rule');
  assert.ok(description.includes('.jpg, .jpeg or .png for an image story only when story.images is true'), 'the image rule and its flag');
});
