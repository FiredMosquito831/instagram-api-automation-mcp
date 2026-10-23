import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  commentsList,
  commentReply,
  commentHide,
  commentDelete,
  commentParentMedia,
  commentTimestamp,
  ownedMediaIds,
} from '../src/graph/endpoints/comments.js';
import { businessDiscovery, hashtagSearch } from '../src/graph/endpoints/discovery.js';
import { like, unlike } from '../src/graph/endpoints/likes.js';

const IG_USER = '17841400000000001';
const MEDIA = '17900000000000001';
const OTHER_MEDIA = '17900000000000002';
const COMMENT = '17870913679156914';
const REPLY = '17873440459141021';
const COMMENTS_FIELDS = 'id,text,timestamp,username,hidden';

// A fake client. It answers each call from a queue, in order, and records every call. An Error in the queue is thrown.
// Each answer has the shape of the real client: { data, usage }. The recorded options are the third argument of post,
// so a write that passed retryPost would show up in the test.
function fakeClient(queue) {
  const calls = [];
  const pending = [...queue];
  const answer = (method, path, record) => {
    calls.push({ method, path, ...record });
    if (pending.length === 0) throw new Error(`unexpected ${method} ${path}`);
    const next = pending.shift();
    if (next instanceof Error) throw next;
    return { data: next, usage: null };
  };
  return {
    calls,
    get: async (path, query) => answer('GET', path, { query }),
    post: async (path, body, options) => answer('POST', path, { body, options }),
    del: async (path, query) => answer('DELETE', path, { query }),
  };
}

test('commentsList requests the comment fields and normalises each row', async () => {
  const client = fakeClient([
    {
      data: [
        { id: REPLY, text: 'nice', timestamp: '2026-10-20T10:00:00+0000', username: 'fan', hidden: false },
        { id: COMMENT, text: 'hi' },
      ],
    },
  ]);
  const result = await commentsList(client, { mediaId: MEDIA });
  assert.equal(client.calls[0].method, 'GET');
  assert.equal(client.calls[0].path, `${MEDIA}/comments`);
  // Changed in the P3 fix round (ruling 2): the default page is 100. Old assertion (removed): limit 25.
  assert.deepEqual(client.calls[0].query, { fields: COMMENTS_FIELDS, limit: 100 });
  // Changed in the P3 round: the result also carries truncated, reason and nextAfter. Old assertion (removed):
  //   assert.deepEqual(result, { items: [...] });
  assert.deepEqual(result, {
    items: [
      { id: REPLY, text: 'nice', timestamp: '2026-10-20T10:00:00+0000', username: 'fan', hidden: false },
      { id: COMMENT, text: 'hi', timestamp: null, username: null, hidden: null },
    ],
    truncated: false,
    reason: null,
    nextAfter: null,
  });
});

test('commentsList refuses a bad media id or limit before any request', async () => {
  const client = fakeClient([]);
  await assert.rejects(commentsList(client, { mediaId: 17900000000000001 }), { kind: 'VALIDATION' });
  await assert.rejects(commentsList(client, { mediaId: MEDIA, limit: 0 }), { kind: 'VALIDATION' });
  await assert.rejects(commentsList(client, { mediaId: MEDIA, limit: 101 }), { kind: 'VALIDATION' });
  await assert.rejects(commentsList(client, { mediaId: MEDIA, limit: '5' }), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
});

test('commentsList refuses a comment row without an id', async () => {
  const client = fakeClient([{ data: [{ text: 'no id here' }] }]);
  await assert.rejects(commentsList(client, { mediaId: MEDIA }), { kind: 'API_ERROR' });
});

test('commentReply posts message to the replies edge', async () => {
  const client = fakeClient([{ id: REPLY }]);
  const result = await commentReply(client, { commentId: COMMENT, text: 'Thanks!' });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].method, 'POST');
  assert.equal(client.calls[0].path, `${COMMENT}/replies`);
  assert.deepEqual(client.calls[0].body, { form: { message: 'Thanks!' } });
  assert.equal(client.calls[0].options, undefined, 'a write never passes retryPost');
  assert.deepEqual(result, { id: REPLY });
});

test('commentReply refuses blank text and a bad comment id before any request', async () => {
  const client = fakeClient([]);
  await assert.rejects(commentReply(client, { commentId: COMMENT, text: '   ' }), { kind: 'VALIDATION' });
  await assert.rejects(commentReply(client, { commentId: COMMENT, text: 42 }), { kind: 'VALIDATION' });
  await assert.rejects(commentReply(client, { commentId: 'abc', text: 'hi' }), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
});

test('commentReply refuses a response without a reply id', async () => {
  const client = fakeClient([{ success: true }]);
  await assert.rejects(commentReply(client, { commentId: COMMENT, text: 'hi' }), { kind: 'API_ERROR' });
});

test("commentHide sends hide as the string 'true'", async () => {
  const client = fakeClient([{ success: true }]);
  const result = await commentHide(client, { commentId: COMMENT, hide: true });
  assert.equal(client.calls[0].method, 'POST');
  assert.equal(client.calls[0].path, COMMENT);
  assert.deepEqual(client.calls[0].body, { form: { hide: 'true' } });
  assert.equal(client.calls[0].options, undefined, 'a write never passes retryPost');
  assert.deepEqual(result, { id: COMMENT, hidden: true });
});

test("commentHide sends hide as the string 'false' when showing a comment", async () => {
  const client = fakeClient([{ success: true }]);
  const result = await commentHide(client, { commentId: COMMENT, hide: false });
  assert.deepEqual(client.calls[0].body, { form: { hide: 'false' } });
  assert.deepEqual(result, { id: COMMENT, hidden: false });
});

test('commentHide refuses a hide value that is not a boolean', async () => {
  const client = fakeClient([]);
  for (const hide of ['false', 'true', 0, 1, undefined, null]) {
    await assert.rejects(commentHide(client, { commentId: COMMENT, hide }), { kind: 'VALIDATION' });
  }
  assert.equal(client.calls.length, 0);
});

test('commentHide refuses a response that does not confirm success', async () => {
  const client = fakeClient([{ id: COMMENT }]);
  await assert.rejects(commentHide(client, { commentId: COMMENT, hide: true }), { kind: 'API_ERROR' });
});

test('commentDelete sends DELETE to the comment id', async () => {
  const client = fakeClient([{ success: true }]);
  const result = await commentDelete(client, { commentId: COMMENT });
  assert.equal(client.calls[0].method, 'DELETE');
  assert.equal(client.calls[0].path, COMMENT);
  assert.deepEqual(result, { id: COMMENT, deleted: true });
});

test('commentDelete refuses a response that does not confirm success', async () => {
  const client = fakeClient([null]);
  await assert.rejects(commentDelete(client, { commentId: COMMENT }), { kind: 'API_ERROR' });
});

test('commentParentMedia requests media{id}', async () => {
  const client = fakeClient([{ id: COMMENT, media: { id: MEDIA } }]);
  const parent = await commentParentMedia(client, { commentId: COMMENT });
  assert.equal(client.calls[0].method, 'GET');
  assert.equal(client.calls[0].path, COMMENT);
  assert.deepEqual(client.calls[0].query, { fields: 'media{id}' });
  assert.equal(parent, MEDIA);
});

test('commentParentMedia refuses a response without a parent media id', async () => {
  const client = fakeClient([{ id: COMMENT }, { id: COMMENT, media: {} }]);
  await assert.rejects(commentParentMedia(client, { commentId: COMMENT }), { kind: 'API_ERROR' });
  await assert.rejects(commentParentMedia(client, { commentId: COMMENT }), { kind: 'API_ERROR' });
});

test('commentTimestamp reads the timestamp field of the comment and returns it as text', async () => {
  const client = fakeClient([{ id: COMMENT, timestamp: '2026-10-15T10:00:00+0000' }]);
  const timestamp = await commentTimestamp(client, { commentId: COMMENT });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].method, 'GET');
  assert.equal(client.calls[0].path, COMMENT);
  assert.deepEqual(client.calls[0].query, { fields: 'timestamp' });
  assert.equal(timestamp, '2026-10-15T10:00:00+0000');
});

test('commentTimestamp throws API_ERROR for a missing, blank or non-text timestamp', async () => {
  const client = fakeClient([{ id: COMMENT }, { id: COMMENT, timestamp: '   ' }, { id: COMMENT, timestamp: 1765000000 }]);
  await assert.rejects(commentTimestamp(client, { commentId: COMMENT }), { kind: 'API_ERROR' });
  await assert.rejects(commentTimestamp(client, { commentId: COMMENT }), { kind: 'API_ERROR' });
  await assert.rejects(commentTimestamp(client, { commentId: COMMENT }), { kind: 'API_ERROR' });
  assert.equal(client.calls.length, 3);
});

test('commentTimestamp refuses a bad comment id before any request', async () => {
  const client = fakeClient([]);
  await assert.rejects(commentTimestamp(client, { commentId: 'not-digits' }), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
});

// Changed in the P3 round (real paging, A-15): ownedMediaIds returns { ids, truncated, reason } instead of a bare Set. Old
// assertions (removed): `const ids = await ownedMediaIds(client)` with ids as the Set, and `ids.size` and `ids.has(...)`.
test('ownedMediaIds returns a Set of ids, in an object with truncated and reason', async () => {
  const client = fakeClient([{ data: [{ id: MEDIA }, { id: OTHER_MEDIA }] }]);
  const owned = await ownedMediaIds(client);
  assert.equal(client.calls[0].method, 'GET');
  assert.equal(client.calls[0].path, 'me/media');
  assert.deepEqual(client.calls[0].query, { fields: 'id', limit: 100 });
  assert.ok(owned.ids instanceof Set);
  assert.equal(owned.ids.size, 2);
  assert.ok(owned.ids.has(MEDIA));
  assert.ok(owned.ids.has(OTHER_MEDIA));
  assert.deepEqual([owned.truncated, owned.reason], [false, null]);
});

test('ownedMediaIds returns an empty Set when the owner has no media', async () => {
  const client = fakeClient([{ data: [] }]);
  const owned = await ownedMediaIds(client, { limit: 10 });
  assert.equal(client.calls[0].query.limit, 10);
  assert.equal(owned.ids.size, 0);
});

test('ownedMediaIds refuses a limit out of range and a row without an id', async () => {
  const client = fakeClient([{ data: [{ id: MEDIA }, { caption: 'no id' }] }]);
  await assert.rejects(ownedMediaIds(client, { limit: 0 }), { kind: 'VALIDATION' });
  await assert.rejects(ownedMediaIds(client, { limit: 101 }), { kind: 'VALIDATION' });
  await assert.rejects(ownedMediaIds(client, { limit: '100' }), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
  await assert.rejects(ownedMediaIds(client), { kind: 'API_ERROR' });
});

test('like posts media_id to the likes edge', async () => {
  const client = fakeClient([{ success: true }]);
  const result = await like(client, { igUserId: IG_USER, targetId: MEDIA, kind: 'media' });
  assert.equal(client.calls[0].method, 'POST');
  assert.equal(client.calls[0].path, `${IG_USER}/likes`);
  assert.deepEqual(client.calls[0].body, { form: { media_id: MEDIA } });
  assert.equal(client.calls[0].options, undefined, 'a write never passes retryPost');
  assert.deepEqual(result, { targetId: MEDIA, kind: 'media', liked: true });
});

test('like posts comment_id to the likes edge for comments', async () => {
  const client = fakeClient([{ success: true }]);
  const result = await like(client, { igUserId: IG_USER, targetId: COMMENT, kind: 'comment' });
  assert.deepEqual(client.calls[0].body, { form: { comment_id: COMMENT } });
  assert.deepEqual(result, { targetId: COMMENT, kind: 'comment', liked: true });
});

test('like refuses an unknown kind and a response without success', async () => {
  const client = fakeClient([{ id: MEDIA }]);
  await assert.rejects(like(client, { igUserId: IG_USER, targetId: MEDIA, kind: 'story' }), { kind: 'VALIDATION' });
  await assert.rejects(like(client, { igUserId: IG_USER, targetId: MEDIA, kind: undefined }), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
  await assert.rejects(like(client, { igUserId: IG_USER, targetId: MEDIA, kind: 'media' }), { kind: 'API_ERROR' });
});

test('unlike sends DELETE with comment_id for comments', async () => {
  const client = fakeClient([{ success: true }]);
  const result = await unlike(client, { igUserId: IG_USER, targetId: COMMENT, kind: 'comment' });
  assert.equal(client.calls[0].method, 'DELETE');
  assert.equal(client.calls[0].path, `${IG_USER}/likes`);
  assert.deepEqual(client.calls[0].query, { comment_id: COMMENT });
  assert.deepEqual(result, { targetId: COMMENT, kind: 'comment', liked: false });
});

test('unlike sends DELETE with media_id for media', async () => {
  const client = fakeClient([{ success: true }]);
  await unlike(client, { igUserId: IG_USER, targetId: MEDIA, kind: 'media' });
  assert.equal(client.calls[0].method, 'DELETE');
  assert.deepEqual(client.calls[0].query, { media_id: MEDIA });
});

test('unlike refuses an unknown kind and a response without success', async () => {
  const client = fakeClient([null]);
  await assert.rejects(unlike(client, { igUserId: IG_USER, targetId: MEDIA, kind: 'reel' }), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
  await assert.rejects(unlike(client, { igUserId: IG_USER, targetId: MEDIA, kind: 'media' }), { kind: 'API_ERROR' });
});

test('businessDiscovery builds the business_discovery field expression', async () => {
  const profile = { followers_count: 120, media_count: 42 };
  const client = fakeClient([{ business_discovery: profile }]);
  const result = await businessDiscovery(client, {
    igUserId: IG_USER,
    username: 'some.brand_1',
    fields: 'followers_count,media_count',
  });
  assert.equal(client.calls[0].method, 'GET');
  assert.equal(client.calls[0].path, IG_USER);
  assert.deepEqual(client.calls[0].query, {
    fields: 'business_discovery.username(some.brand_1){followers_count,media_count}',
  });
  // Changed in the P3 round: the result also carries truncated and reason. Old assertion (removed):
  //   assert.deepEqual(result, { ...profile, missingFields: [] });
  assert.deepEqual(result, { ...profile, missingFields: [], truncated: false, reason: null });
});

test('businessDiscovery refuses a username or fields value that could change the expression', async () => {
  const client = fakeClient([]);
  for (const username of ['', 'a)b', 'a{b}', 'a,b', 'x'.repeat(31), 'with space']) {
    await assert.rejects(businessDiscovery(client, { igUserId: IG_USER, username, fields: 'media_count' }), {
      kind: 'VALIDATION',
    });
  }
  for (const fields of ['', 'media_count){id}', 'media{id}', 'followers_count,', 'Followers']) {
    await assert.rejects(businessDiscovery(client, { igUserId: IG_USER, username: 'brand', fields }), {
      kind: 'VALIDATION',
    });
  }
  assert.equal(client.calls.length, 0);
});

test('businessDiscovery refuses a response without business_discovery', async () => {
  const client = fakeClient([{ id: IG_USER }]);
  await assert.rejects(businessDiscovery(client, { igUserId: IG_USER, username: 'brand', fields: 'media_count' }), {
    kind: 'API_ERROR',
  });
});

test('hashtagSearch sends user_id and q and returns the hashtag id', async () => {
  const client = fakeClient([{ data: [{ id: '17843857450040591' }] }]);
  const result = await hashtagSearch(client, { igUserId: IG_USER, q: 'bluebottle' });
  assert.equal(client.calls[0].method, 'GET');
  assert.equal(client.calls[0].path, 'ig_hashtag_search');
  assert.deepEqual(client.calls[0].query, { user_id: IG_USER, q: 'bluebottle' });
  assert.deepEqual(result, { hashtagId: '17843857450040591' });
});

test('hashtagSearch also accepts the single-id response shape', async () => {
  const client = fakeClient([{ id: '17873440459141021' }]);
  const result = await hashtagSearch(client, { igUserId: IG_USER, q: 'coke' });
  assert.deepEqual(result, { hashtagId: '17873440459141021' });
});

test('hashtagSearch refuses a q with a leading # or a space, and a bad user id', async () => {
  const client = fakeClient([]);
  await assert.rejects(hashtagSearch(client, { igUserId: IG_USER, q: '#coke' }), { kind: 'VALIDATION' });
  await assert.rejects(hashtagSearch(client, { igUserId: IG_USER, q: 'two words' }), { kind: 'VALIDATION' });
  await assert.rejects(hashtagSearch(client, { igUserId: IG_USER, q: '' }), { kind: 'VALIDATION' });
  await assert.rejects(hashtagSearch(client, { igUserId: 17841400000000001, q: 'coke' }), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
});

test('hashtagSearch refuses an empty or ambiguous result, since a missing id is not a success', async () => {
  const client = fakeClient([{ data: [] }, { data: [{ id: '1' }, { id: '2' }] }, {}]);
  await assert.rejects(hashtagSearch(client, { igUserId: IG_USER, q: 'coke' }), { kind: 'API_ERROR' });
  await assert.rejects(hashtagSearch(client, { igUserId: IG_USER, q: 'coke' }), { kind: 'API_ERROR' });
  await assert.rejects(hashtagSearch(client, { igUserId: IG_USER, q: 'coke' }), { kind: 'API_ERROR' });
});

// ---------- P2 (2026-10-22) ----------

test('A-17 businessDiscovery lists each requested field the response lacks, and does not throw', async () => {
  const client = fakeClient([{ business_discovery: { followers_count: 120 } }]);
  const result = await businessDiscovery(client, { igUserId: IG_USER, username: 'some_brand', fields: 'followers_count,media_count' });
  // Changed in the P3 round: the result also carries truncated and reason. Old assertion (removed):
  //   assert.deepEqual(result, { followers_count: 120, missingFields: ['media_count'] });
  assert.deepEqual(result, { followers_count: 120, missingFields: ['media_count'], truncated: false, reason: null });
});

test('A-13 the social endpoints refuse a null options argument with VALIDATION, and make no request', async () => {
  const client = fakeClient([]);
  await assert.rejects(commentsList(client, null), { kind: 'VALIDATION' });
  await assert.rejects(commentReply(client, null), { kind: 'VALIDATION' });
  await assert.rejects(commentParentMedia(client, null), { kind: 'VALIDATION' });
  await assert.rejects(ownedMediaIds(client, null), { kind: 'VALIDATION' });
  await assert.rejects(like(client, null), { kind: 'VALIDATION' });
  await assert.rejects(businessDiscovery(client, null), { kind: 'VALIDATION' });
  await assert.rejects(hashtagSearch(client, null), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
});

// ---------- P3 (2026-10-22) ----------

const THIRD_COMMENT = '17870913679156915';
const MORE_PAGES = 'more pages exist beyond the page limit';
const MORE_ITEMS = 'more items exist beyond the item limit';

test('P3 A-15 commentsList follows paging.next with its cursor, and never requests the next link', async () => {
  const next = 'https://graph.instagram.com/v26.0/17900000000000001/comments?access_token=SECRET&after=c2';
  const client = fakeClient([
    { data: [{ id: COMMENT, text: 'one' }], paging: { cursors: { after: 'c2' }, next } },
    { data: [{ id: REPLY, text: 'two' }] },
  ]);
  const result = await commentsList(client, { mediaId: MEDIA, limit: 1 });
  assert.deepEqual(client.calls.map((call) => call.query), [
    { fields: COMMENTS_FIELDS, limit: 1 },
    { fields: COMMENTS_FIELDS, limit: 1, after: 'c2' },
  ]);
  assert.deepEqual(result.items.map((comment) => comment.id), [COMMENT, REPLY]);
  assert.deepEqual([result.truncated, result.reason, result.nextAfter], [false, null, null]);
  assert.equal(JSON.stringify(client.calls).includes('SECRET'), false);
});

test('P3 A-15 a short comments page with a next link is truncated, and a full page with no next is not', async () => {
  const short = await commentsList(
    fakeClient([{ data: [{ id: COMMENT }], paging: { cursors: { after: 'c2' }, next: 'https://x' } }]),
    { mediaId: MEDIA, limit: 3, maxPages: 1 },
  );
  assert.deepEqual([short.truncated, short.reason, short.nextAfter], [true, MORE_PAGES, 'c2']);
  const full = await commentsList(
    fakeClient([{ data: [{ id: COMMENT }, { id: REPLY }, { id: THIRD_COMMENT }] }]),
    { mediaId: MEDIA, limit: 3, maxPages: 1 },
  );
  assert.deepEqual([full.truncated, full.reason, full.nextAfter], [false, null, null]);
});

test('P3 A-15 commentsList stops at maxItems and reports truncated when comments remain beyond it', async () => {
  const client = fakeClient([{ data: [{ id: COMMENT }, { id: REPLY }, { id: THIRD_COMMENT }] }]);
  const result = await commentsList(client, { mediaId: MEDIA, maxItems: 2 });
  assert.deepEqual(result.items.map((comment) => comment.id), [COMMENT, REPLY]);
  assert.deepEqual([result.truncated, result.reason], [true, MORE_ITEMS]);
  assert.equal(client.calls.length, 1);
});

test('P3 A-15 ownedMediaIds reads each page up to maxPages, and reports truncated when more media exist', async () => {
  const client = fakeClient([
    { data: [{ id: MEDIA }], paging: { cursors: { after: 'm2' }, next: 'https://graph.instagram.com/v26.0/me/media?access_token=SECRET&after=m2' } },
    { data: [{ id: OTHER_MEDIA }], paging: { cursors: { after: 'm3' }, next: 'https://graph.instagram.com/v26.0/me/media?access_token=SECRET&after=m3' } },
    { data: [{ id: THIRD_COMMENT }] },
  ]);
  const owned = await ownedMediaIds(client, { limit: 1, maxPages: 2 });
  assert.equal(client.calls.length, 2, 'no third page is requested');
  assert.deepEqual(client.calls.map((call) => call.query.after), [undefined, 'm2']);
  assert.deepEqual([...owned.ids], [MEDIA, OTHER_MEDIA]);
  assert.deepEqual([owned.truncated, owned.reason], [true, MORE_PAGES]);
  // Added in the P3 review round (M-5). Old assertion: none; the next links were 'https://x', with no token to check for.
  assert.equal(JSON.stringify(client.calls).includes('SECRET'), false, 'the next link is never requested');
  assert.equal(JSON.stringify(client.calls).includes('access_token'), false, 'no request names a token');
});

// M-1 (P3 review): a top-level paging key is removed from the result, as a nested one is, so its next link is not returned.
// Old behaviour (removed): the top-level paging object was returned, with its next link and token.
test('M-1 a business object with a top-level paging.next carrying the token returns without the paging key, and no token text appears', async () => {
  const client = fakeClient([
    {
      business_discovery: {
        followers_count: 120,
        paging: { cursors: { after: 'b2' }, next: 'https://graph.facebook.com/v26.0/x?access_token=SECRET' },
      },
    },
  ]);
  const result = await businessDiscovery(client, { igUserId: IG_USER, username: 'some.brand', fields: 'followers_count' });
  assert.deepEqual(result, { followers_count: 120, missingFields: [], truncated: false, reason: null });
  const text = JSON.stringify(result);
  assert.equal(text.includes('paging'), false, 'the paging key is not returned');
  assert.equal(text.includes('SECRET'), false, 'no token text appears');
  assert.equal(text.includes('access_token'), false, 'no token parameter appears');
});

test('P3 a nested edge with paging is returned without its next link, and sets truncated', async () => {
  const profile = {
    followers_count: 120,
    media: {
      data: [{ id: MEDIA }],
      paging: { cursors: { after: 'b2' }, next: 'https://graph.facebook.com/v26.0/x?access_token=SECRET' },
    },
  };
  const client = fakeClient([{ business_discovery: profile }]);
  const result = await businessDiscovery(client, {
    igUserId: IG_USER,
    username: 'some.brand',
    fields: 'followers_count,media',
  });
  assert.deepEqual(result, {
    followers_count: 120,
    media: { data: [{ id: MEDIA }] },
    missingFields: [],
    truncated: true,
    reason: 'more business discovery items exist beyond the first page',
  });
  assert.equal(JSON.stringify(result).includes('SECRET'), false, 'the next link is not returned');
});

// ---------- A-11 (2026-10-23): DELETE options ----------

test('unlike and commentDelete refuse a null options argument with VALIDATION, and make no request', async () => {
  const client = fakeClient([]);
  await assert.rejects(unlike(client, null), { kind: 'VALIDATION' });
  await assert.rejects(commentDelete(client, null), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
});

// The fake del above records the path and the query only. This one records every argument, so a third argument (a retry
// option, for example) would show up here.
test('a DELETE is made with its path and query only, and no third argument', async () => {
  const sent = [];
  const client = {
    del: async (...args) => {
      sent.push(args);
      return { data: { success: true }, usage: null };
    },
  };
  await unlike(client, { igUserId: IG_USER, targetId: COMMENT, kind: 'comment' });
  await commentDelete(client, { commentId: COMMENT });
  assert.deepEqual(sent, [[`${IG_USER}/likes`, { comment_id: COMMENT }], [COMMENT]]);
});
