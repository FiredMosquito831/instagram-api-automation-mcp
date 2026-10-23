import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileGet } from '../src/graph/endpoints/profile.js';
import {
  contentPublishingLimit,
  mediaDelete,
  mediaGet,
  mediaList,
  mentionedMedia,
  publishCarousel,
  publishImage,
  publishReel,
  publishStory,
} from '../src/graph/endpoints/media.js';
import { INSIGHT_METRICS, accountInsights, mediaInsights } from '../src/graph/endpoints/insights.js';
import {
  MEDIA_LIMITS,
  safeEcho,
  sha256File,
  checkMediaUrl,
  checkPublish,
  mediaFileUrl,
  parseCarouselItem,
  parseMediaPath,
  resolveMediaDir,
  resolveMediaFile,
} from '../src/graph/endpoints/media.js';
import { MEDIA_DIR, MIB, OUTSIDE_DIR, fakeHost, fakeMediaFs, inMedia, sha256Hex } from './fixtures/media-fakes.js';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

const IG_USER = '17841400000000001';
const MEDIA = '17900000000000001';
const CONTAINER = '18000000000000001';
const CHILD_ONE = '18000000000000011';
const CHILD_TWO = '18000000000000012';
const PUBLISHED = '18100000000000001';
const IMAGE_URL = 'https://cdn.example.com/photo.jpg';
const SECOND_IMAGE_URL = 'https://cdn.example.com/second.jpg';
const VIDEO_URL = 'https://cdn.example.com/clip.mp4';
const PROFILE_FIELDS = 'id,username,biography,website,followers_count,follows_count,media_count';
const MEDIA_FIELDS = 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count';

// A fake client. It answers each call from a queue, in order, and records every call. An Error in the queue is thrown.
// Each answer has the shape of the real client: { data, usage }.
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

// A fake sleep that records each requested delay and does not wait.
function fakeSleep() {
  const waits = [];
  return { sleep: async (ms) => { waits.push(ms); }, waits };
}

const route = (call) => `${call.method} ${call.path}`;

test('profileGet requests the fields listed in the interface', async () => {
  const client = fakeClient([
    {
      id: IG_USER,
      username: 'owner',
      biography: 'hello',
      website: 'https://example.com',
      followers_count: 120,
      follows_count: 80,
      media_count: 42,
    },
  ]);
  const profile = await profileGet(client);
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].method, 'GET');
  assert.equal(client.calls[0].path, 'me');
  assert.equal(client.calls[0].query.fields, PROFILE_FIELDS);
  assert.deepEqual(profile, {
    id: IG_USER,
    username: 'owner',
    biography: 'hello',
    website: 'https://example.com',
    followersCount: 120,
    followsCount: 80,
    mediaCount: 42,
  });
});

test('profileGet normalises an absent biography or website to null', async () => {
  const client = fakeClient([{ id: IG_USER, username: 'owner', followers_count: 1, follows_count: 2, media_count: 3 }]);
  const profile = await profileGet(client);
  assert.equal(profile.biography, null);
  assert.equal(profile.website, null);
});

test('mediaGet reads one media object with the media fields', async () => {
  const client = fakeClient([
    {
      id: MEDIA,
      caption: 'hello',
      media_type: 'IMAGE',
      media_url: IMAGE_URL,
      permalink: 'https://www.instagram.com/p/example/',
      timestamp: '2026-10-20T10:00:00+0000',
      like_count: 5,
      comments_count: 1,
    },
  ]);
  const media = await mediaGet(client, { mediaId: MEDIA });
  assert.equal(client.calls[0].path, MEDIA);
  assert.equal(client.calls[0].query.fields, MEDIA_FIELDS);
  assert.deepEqual(media, {
    id: MEDIA,
    caption: 'hello',
    mediaType: 'IMAGE',
    mediaUrl: IMAGE_URL,
    permalink: 'https://www.instagram.com/p/example/',
    timestamp: '2026-10-20T10:00:00+0000',
    likeCount: 5,
    commentsCount: 1,
  });
});

test('mediaList normalises a missing media_url to null', async () => {
  const client = fakeClient([
    {
      data: [
        { id: MEDIA, caption: 'no url', media_type: 'VIDEO', permalink: 'https://www.instagram.com/p/a/', timestamp: 't1', like_count: 1, comments_count: 0 },
        { id: '17900000000000002', media_url: IMAGE_URL, media_type: 'IMAGE', permalink: 'https://www.instagram.com/p/b/', timestamp: 't2', like_count: 2, comments_count: 3 },
      ],
    },
  ]);
  const page = await mediaList(client, {});
  assert.equal(client.calls[0].path, 'me/media');
  assert.equal(client.calls[0].query.fields, MEDIA_FIELDS);
  // Changed in the P3 fix round (ruling 2): the default page is 100. Old assertion (removed): limit 25.
  assert.equal(client.calls[0].query.limit, 100);
  assert.equal(client.calls[0].query.after, undefined);
  assert.equal(page.items[0].mediaUrl, null);
  assert.equal(page.items[1].mediaUrl, IMAGE_URL);
  assert.equal(page.items[1].likeCount, 2);
  assert.equal(page.nextAfter, null);
});

// Changed in the P3 round (A-15, real paging). The read follows paging.next with its cursor and never the next link.
// Old assertions (removed): the read stopped after one page, so the only request had after 'after-1', and page.nextAfter
// was 'after-2'.
test('mediaList passes limit and after, and follows the next page with its cursor', async () => {
  const next = 'https://graph.instagram.com/v26.0/me/media?after=after-2&access_token=SECRET';
  const client = fakeClient([
    { data: [{ id: MEDIA, media_type: 'IMAGE' }], paging: { cursors: { before: 'before-1', after: 'after-2' }, next } },
    { data: [{ id: '17900000000000002', media_type: 'IMAGE' }] },
  ]);
  const page = await mediaList(client, { limit: 10, after: 'after-1' });
  assert.deepEqual(client.calls.map((call) => call.query), [
    { fields: MEDIA_FIELDS, limit: 10, after: 'after-1' },
    { fields: MEDIA_FIELDS, limit: 10, after: 'after-2' },
  ]);
  assert.deepEqual(page.items.map((item) => item.id), [MEDIA, '17900000000000002']);
  assert.equal(page.truncated, false);
  assert.equal(page.reason, null);
  assert.equal(page.nextAfter, null);
  assert.equal(JSON.stringify(client.calls).includes('SECRET'), false, 'the next link is never requested');
});

test('mediaList refuses a page that has a next page but no cursor, rather than an empty success', async () => {
  const next = 'https://graph.instagram.com/v26.0/me/media?after=x';
  const bodies = [
    { data: [{ id: MEDIA }], paging: { next } },
    { data: [{ id: MEDIA }], paging: { cursors: { after: '' }, next } },
  ];
  for (const body of bodies) {
    const client = fakeClient([body]);
    await assert.rejects(mediaList(client, {}), { name: 'IgError', kind: 'API_ERROR' });
  }
});

test('mediaList refuses a limit outside 1 to 100, or a bad cursor, before any request', async () => {
  const client = fakeClient([]);
  for (const limit of [0, 101, 2.5, '25', -1, NaN]) {
    await assert.rejects(mediaList(client, { limit }), { name: 'IgError', kind: 'VALIDATION' }, `limit ${String(limit)}`);
  }
  for (const after of ['', 5]) {
    await assert.rejects(mediaList(client, { after }), { name: 'IgError', kind: 'VALIDATION' }, `after ${String(after)}`);
  }
  assert.equal(client.calls.length, 0);
});

test('mediaGet and mentionedMedia refuse an id that is not a string of digits', async () => {
  const client = fakeClient([]);
  await assert.rejects(mediaGet(client, { mediaId: 17900000000000001 }), { name: 'IgError', kind: 'VALIDATION' });
  await assert.rejects(mediaGet(client, { mediaId: 'me' }), { name: 'IgError', kind: 'VALIDATION' });
  await assert.rejects(mentionedMedia(client, { igUserId: 'me', mediaId: MEDIA }), { name: 'IgError', kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
});

test('contentPublishingLimit sends since and reads config.quota_total', async () => {
  const client = fakeClient([{ data: [{ config: { quota_total: 100 }, quota_usage: 7 }] }]);
  const since = 1792500000;
  const limit = await contentPublishingLimit(client, { igUserId: IG_USER, since });
  assert.equal(client.calls[0].method, 'GET');
  assert.equal(client.calls[0].path, `${IG_USER}/content_publishing_limit`);
  assert.equal(client.calls[0].query.since, since);
  assert.deepEqual(limit, { quotaTotal: 100, quotaUsage: 7 });
});

test('contentPublishingLimit refuses a response with no usable quota, rather than returning undefined', async () => {
  const bodies = [
    { data: [] },
    { data: [{ quota_usage: 1 }] },
    { data: [{ config: { quota_total: '100' }, quota_usage: 1 }] },
    { data: [{ config: { quota_total: 100 }, quota_usage: -1 }] },
    { data: [{ config: { quota_total: 100 } }] },
  ];
  for (const body of bodies) {
    const client = fakeClient([body]);
    await assert.rejects(contentPublishingLimit(client, { igUserId: IG_USER, since: 1 }), { name: 'IgError', kind: 'API_ERROR' });
  }
});

test('contentPublishingLimit refuses a since that is not a whole Unix time, before any request', async () => {
  const client = fakeClient([]);
  for (const since of ['1792500000', -1, 1.5, undefined]) {
    await assert.rejects(contentPublishingLimit(client, { igUserId: IG_USER, since }), { name: 'IgError', kind: 'VALIDATION' });
  }
  assert.equal(client.calls.length, 0);
});

test('publishImage creates a container, then publishes it with the creation id', async () => {
  const client = fakeClient([{ id: CONTAINER }, { id: PUBLISHED }]);
  const result = await publishImage(client, { igUserId: IG_USER, imageUrl: IMAGE_URL, caption: 'hello' });
  assert.deepEqual(result, { id: PUBLISHED });
  assert.deepEqual(client.calls.map(route), [`POST ${IG_USER}/media`, `POST ${IG_USER}/media_publish`]);
  assert.deepEqual(client.calls[0].body, { form: { image_url: IMAGE_URL, caption: 'hello' } });
  assert.deepEqual(client.calls[1].body, { form: { creation_id: CONTAINER } });
});

test('publishImage refuses a non-https image URL or a caption that is not a string, before any request', async () => {
  const client = fakeClient([]);
  await assert.rejects(publishImage(client, { igUserId: IG_USER, imageUrl: 'http://cdn.example.com/a.jpg' }), { kind: 'VALIDATION' });
  await assert.rejects(publishImage(client, { igUserId: IG_USER, imageUrl: IMAGE_URL, caption: 42 }), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
});

test('publishReel polls until FINISHED before publishing', async () => {
  const client = fakeClient([{ id: CONTAINER }, { status_code: 'IN_PROGRESS' }, { status_code: 'FINISHED' }, { id: PUBLISHED }]);
  const { sleep, waits } = fakeSleep();
  const result = await publishReel(client, { igUserId: IG_USER, videoUrl: VIDEO_URL, caption: 'reel', sleep, pollMs: 250 });
  assert.deepEqual(result, { id: PUBLISHED });
  assert.deepEqual(client.calls.map(route), [
    `POST ${IG_USER}/media`,
    `GET ${CONTAINER}`,
    `GET ${CONTAINER}`,
    `POST ${IG_USER}/media_publish`,
  ]);
  assert.deepEqual(client.calls[0].body, { form: { media_type: 'REELS', video_url: VIDEO_URL, caption: 'reel' } });
  assert.equal(client.calls[1].query.fields, 'status_code');
  assert.deepEqual(waits, [250]);
  assert.deepEqual(client.calls[3].body, { form: { creation_id: CONTAINER } });
});

test('publishReel fails on ERROR without publishing', async () => {
  const client = fakeClient([{ id: CONTAINER }, { status_code: 'ERROR' }]);
  await assert.rejects(
    publishReel(client, { igUserId: IG_USER, videoUrl: VIDEO_URL, caption: 'reel', sleep: fakeSleep().sleep }),
    { name: 'IgError', kind: 'API_ERROR' },
  );
  assert.equal(client.calls.length, 2);
  assert.equal(client.calls.some((call) => call.path === `${IG_USER}/media_publish`), false);
});

test('publishReel fails on EXPIRED or an unknown status, without publishing', async () => {
  for (const status of ['EXPIRED', 'PUBLISHED', undefined]) {
    const client = fakeClient([{ id: CONTAINER }, { status_code: status }]);
    await assert.rejects(
      publishReel(client, { igUserId: IG_USER, videoUrl: VIDEO_URL, caption: 'reel', sleep: fakeSleep().sleep }),
      { name: 'IgError', kind: 'API_ERROR' },
      String(status),
    );
    assert.equal(client.calls.some((call) => call.path === `${IG_USER}/media_publish`), false, String(status));
  }
});

test('publishReel gives up after maxPolls polls, without publishing', async () => {
  const client = fakeClient([
    { id: CONTAINER },
    { status_code: 'IN_PROGRESS' },
    { status_code: 'IN_PROGRESS' },
    { status_code: 'IN_PROGRESS' },
  ]);
  const { sleep, waits } = fakeSleep();
  await assert.rejects(
    publishReel(client, { igUserId: IG_USER, videoUrl: VIDEO_URL, caption: 'reel', sleep, pollMs: 10, maxPolls: 3 }),
    { name: 'IgError', kind: 'API_ERROR' },
  );
  assert.equal(client.calls.filter((call) => call.method === 'GET').length, 3);
  assert.deepEqual(waits, [10, 10]);
  assert.equal(client.calls.some((call) => call.path === `${IG_USER}/media_publish`), false);
});

test('publishReel refuses a bad poll setting before any request', async () => {
  const client = fakeClient([]);
  for (const options of [{ maxPolls: 0 }, { maxPolls: 1.5 }, { pollMs: -1 }, { pollMs: 2147483648 }]) {
    await assert.rejects(
      publishReel(client, { igUserId: IG_USER, videoUrl: VIDEO_URL, caption: 'reel', ...options }),
      { name: 'IgError', kind: 'VALIDATION' },
      JSON.stringify(options),
    );
  }
  assert.equal(client.calls.length, 0);
});

test('publishCarousel creates children before the parent and publishes last', async () => {
  const client = fakeClient([
    { id: CHILD_ONE },
    { status_code: 'FINISHED' },
    { id: CHILD_TWO },
    { status_code: 'FINISHED' },
    { id: CONTAINER },
    { id: PUBLISHED },
  ]);
  const result = await publishCarousel(client, {
    igUserId: IG_USER,
    items: [{ imageUrl: IMAGE_URL }, { imageUrl: SECOND_IMAGE_URL }],
    caption: 'album',
    sleep: fakeSleep().sleep,
  });
  assert.deepEqual(result, { id: PUBLISHED });
  assert.deepEqual(client.calls.map(route), [
    `POST ${IG_USER}/media`,
    `GET ${CHILD_ONE}`,
    `POST ${IG_USER}/media`,
    `GET ${CHILD_TWO}`,
    `POST ${IG_USER}/media`,
    `POST ${IG_USER}/media_publish`,
  ]);
  assert.deepEqual(client.calls[0].body, { form: { is_carousel_item: true, image_url: IMAGE_URL } });
  assert.deepEqual(client.calls[2].body, { form: { is_carousel_item: true, image_url: SECOND_IMAGE_URL } });
  assert.deepEqual(client.calls[4].body, {
    form: { media_type: 'CAROUSEL', children: `${CHILD_ONE},${CHILD_TWO}`, caption: 'album' },
  });
  assert.deepEqual(client.calls[5].body, { form: { creation_id: CONTAINER } });
});

test('publishCarousel waits for a video child to FINISH before the parent is created', async () => {
  const client = fakeClient([
    { id: CHILD_ONE },
    { status_code: 'FINISHED' },
    { id: CHILD_TWO },
    { status_code: 'FINISHED' },
    { id: CONTAINER },
    { id: PUBLISHED },
  ]);
  const { sleep, waits } = fakeSleep();
  await publishCarousel(client, {
    igUserId: IG_USER,
    items: [{ imageUrl: IMAGE_URL }, { videoUrl: VIDEO_URL }],
    caption: 'album',
    sleep,
  });
  assert.deepEqual(client.calls.map(route), [
    `POST ${IG_USER}/media`,
    `GET ${CHILD_ONE}`,
    `POST ${IG_USER}/media`,
    `GET ${CHILD_TWO}`,
    `POST ${IG_USER}/media`,
    `POST ${IG_USER}/media_publish`,
  ]);
  assert.deepEqual(client.calls[2].body, { form: { is_carousel_item: true, video_url: VIDEO_URL } });
  assert.deepEqual(waits, []);
});

test('publishCarousel stops before the parent when an image child returns ERROR', async () => {
  const client = fakeClient([{ id: CHILD_ONE }, { status_code: 'ERROR' }]);
  await assert.rejects(
    publishCarousel(client, {
      igUserId: IG_USER,
      items: [{ imageUrl: IMAGE_URL }, { imageUrl: SECOND_IMAGE_URL }],
      caption: 'album',
      sleep: fakeSleep().sleep,
    }),
    { name: 'IgError', kind: 'API_ERROR' },
  );
  assert.deepEqual(client.calls.map(route), [`POST ${IG_USER}/media`, `GET ${CHILD_ONE}`]);
});

test('publishCarousel polls with the given maxPolls, and fails when a child stays IN_PROGRESS', async () => {
  const client = fakeClient([{ id: CHILD_ONE }, { status_code: 'IN_PROGRESS' }]);
  const { sleep, waits } = fakeSleep();
  await assert.rejects(
    publishCarousel(client, {
      igUserId: IG_USER,
      items: [{ imageUrl: IMAGE_URL }, { imageUrl: SECOND_IMAGE_URL }],
      caption: 'album',
      sleep,
      pollMs: 10,
      maxPolls: 1,
    }),
    { name: 'IgError', kind: 'API_ERROR' },
  );
  assert.deepEqual(client.calls.map(route), [`POST ${IG_USER}/media`, `GET ${CHILD_ONE}`]);
  assert.deepEqual(waits, []);
});

test('publishCarousel refuses a one-item carousel with VALIDATION, before any request', async () => {
  const client = fakeClient([]);
  await assert.rejects(
    publishCarousel(client, {
      igUserId: IG_USER,
      items: [{ imageUrl: IMAGE_URL }],
      caption: 'solo',
      sleep: fakeSleep().sleep,
    }),
    { name: 'IgError', kind: 'VALIDATION' },
  );
  assert.equal(client.calls.length, 0);
});

test('publishCarousel refuses bad items before any request, so no half-built carousel is left', async () => {
  const client = fakeClient([]);
  const sleep = fakeSleep().sleep;
  const bad = [
    [],
    Array.from({ length: 11 }, () => ({ imageUrl: IMAGE_URL })),
    [{ imageUrl: IMAGE_URL }, { imageUrl: 'http://cdn.example.com/second.jpg' }],
    [{ imageUrl: IMAGE_URL }, { imageUrl: 'not a url' }],
    [{ imageUrl: IMAGE_URL, videoUrl: VIDEO_URL }],
    [{}],
    [{ imageUrl: IMAGE_URL, extra: 1 }],
    [{ imageUrl: IMAGE_URL }, undefined],
  ];
  for (const items of bad) {
    await assert.rejects(publishCarousel(client, { igUserId: IG_USER, items, caption: 'x', sleep }), {
      name: 'IgError',
      kind: 'VALIDATION',
    });
  }
  assert.equal(client.calls.length, 0);
});

test('publishStory uses media_type STORIES', async () => {
  const client = fakeClient([{ id: CONTAINER }, { status_code: 'FINISHED' }, { id: PUBLISHED }]);
  const result = await publishStory(client, { igUserId: IG_USER, videoUrl: VIDEO_URL, sleep: fakeSleep().sleep });
  assert.deepEqual(result, { id: PUBLISHED });
  assert.deepEqual(client.calls[0].body, { form: { media_type: 'STORIES', video_url: VIDEO_URL } });
  assert.deepEqual(client.calls.map(route), [`POST ${IG_USER}/media`, `GET ${CONTAINER}`, `POST ${IG_USER}/media_publish`]);
});

test('no write passes retryPost, so the client never retries a publish', async () => {
  const client = fakeClient([
    { id: CONTAINER },
    { id: PUBLISHED },
    { id: CONTAINER },
    { status_code: 'FINISHED' },
    { id: PUBLISHED },
    { id: CONTAINER },
    { status_code: 'FINISHED' },
    { id: PUBLISHED },
    { id: CHILD_ONE },
    { status_code: 'FINISHED' },
    { id: CHILD_TWO },
    { status_code: 'FINISHED' },
    { id: CONTAINER },
    { id: PUBLISHED },
  ]);
  const sleep = fakeSleep().sleep;
  await publishImage(client, { igUserId: IG_USER, imageUrl: IMAGE_URL, caption: 'a' });
  await publishReel(client, { igUserId: IG_USER, videoUrl: VIDEO_URL, caption: 'b', sleep });
  await publishStory(client, { igUserId: IG_USER, videoUrl: VIDEO_URL, sleep });
  await publishCarousel(client, { igUserId: IG_USER, items: [{ imageUrl: IMAGE_URL }, { imageUrl: SECOND_IMAGE_URL }], caption: 'c', sleep });
  const posts = client.calls.filter((call) => call.method === 'POST');
  assert.equal(posts.length, 10);
  for (const call of posts) {
    assert.equal(call.options?.retryPost, undefined, route(call));
  }
});

test('mediaDelete sends DELETE to the media id, reports the deletion, and refuses an empty body', async () => {
  const client = fakeClient([{ success: true }, null]);
  assert.deepEqual(await mediaDelete(client, { mediaId: MEDIA }), { id: MEDIA, deleted: true });
  // An empty 2xx body is not a confirmed deletion (A-14): it is API_ERROR, the same as every other write.
  await assert.rejects(mediaDelete(client, { mediaId: MEDIA }), { name: 'IgError', kind: 'API_ERROR' });
  assert.equal(client.calls[0].method, 'DELETE');
  assert.equal(client.calls[0].path, MEDIA);
});

test('mediaDelete refuses a response that does not confirm the deletion', async () => {
  const client = fakeClient([{ success: false }]);
  await assert.rejects(mediaDelete(client, { mediaId: MEDIA }), { name: 'IgError', kind: 'API_ERROR' });
});

test('mentionedMedia reads the mentioning media by media_id', async () => {
  const client = fakeClient([{ id: MEDIA, caption: '@owner hello', permalink: 'https://www.instagram.com/p/m/' }]);
  const media = await mentionedMedia(client, { igUserId: IG_USER, mediaId: MEDIA });
  assert.equal(client.calls[0].path, `${IG_USER}/mentioned_media`);
  assert.deepEqual(client.calls[0].query, { media_id: MEDIA, fields: MEDIA_FIELDS });
  assert.equal(media.id, MEDIA);
  assert.equal(media.caption, '@owner hello');
  assert.equal(media.mediaUrl, null);
});

test('mentionedMedia requests the fields that normaliseMedia reads', async () => {
  const client = fakeClient([{ id: MEDIA }]);
  await mentionedMedia(client, { igUserId: IG_USER, mediaId: MEDIA });
  assert.equal(client.calls[0].query.fields, MEDIA_FIELDS);
});

test('the insights allowlist leaves out impressions and the other deprecated or unverified metrics', () => {
  assert.equal(INSIGHT_METRICS.includes('impressions'), false);
  for (const name of ['plays', 'clips_replays_count', 'link_clicks', 'total_views', 'profile_views']) {
    assert.equal(INSIGHT_METRICS.includes(name), false, name);
  }
  assert.equal(INSIGHT_METRICS.includes('reach'), true);
});

test('accountInsights rejects impressions with VALIDATION', async () => {
  const client = fakeClient([]);
  await assert.rejects(accountInsights(client, { igUserId: IG_USER, metrics: ['reach', 'impressions'] }), {
    name: 'IgError',
    kind: 'VALIDATION',
  });
  assert.equal(client.calls.length, 0);
});

test('accountInsights and mediaInsights refuse a metric list that is not a clean allowlist subset, before any request', async () => {
  const client = fakeClient([]);
  const badMetricLists = [undefined, [], 'reach', ['reach,views'], ['reach', 'reach'], ['plays'], [42], ['reach', undefined]];
  for (const metrics of badMetricLists) {
    await assert.rejects(accountInsights(client, { igUserId: IG_USER, metrics }), { kind: 'VALIDATION' }, String(metrics));
    await assert.rejects(mediaInsights(client, { mediaId: MEDIA, metrics }), { kind: 'VALIDATION' }, String(metrics));
  }
  await assert.rejects(accountInsights(client, { igUserId: IG_USER, metrics: ['reach'], period: 'week' }), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
});

test('accountInsights sends the metrics comma-joined with the period, and normalises the values', async () => {
  const client = fakeClient([
    {
      data: [
        { name: 'reach', period: 'day', values: [{ value: 10, end_time: '2026-10-19T07:00:00+0000' }] },
        { name: 'follower_demographics', period: 'lifetime', values: [{ value: { CITY: { Berlin: 3 } } }] },
      ],
    },
  ]);
  const insights = await accountInsights(client, {
    igUserId: IG_USER,
    metrics: ['reach', 'follower_demographics'],
    period: 'lifetime',
  });
  assert.equal(client.calls[0].path, `${IG_USER}/insights`);
  assert.deepEqual(client.calls[0].query, { metric: 'reach,follower_demographics', period: 'lifetime' });
  assert.deepEqual(insights, {
    metrics: [
      { name: 'reach', period: 'day', values: [{ value: 10, endTime: '2026-10-19T07:00:00+0000' }] },
      { name: 'follower_demographics', period: 'lifetime', values: [{ value: { CITY: { Berlin: 3 } }, endTime: null }] },
    ],
  });
});

test('accountInsights defaults the period to day', async () => {
  const client = fakeClient([{ data: [] }]);
  const insights = await accountInsights(client, { igUserId: IG_USER, metrics: ['reach'] });
  assert.deepEqual(client.calls[0].query, { metric: 'reach', period: 'day' });
  assert.deepEqual(insights, { metrics: [] });
});

test('mediaInsights checks the same allowlist and sends metric without a period', async () => {
  const client = fakeClient([{ data: [{ name: 'saved', period: 'lifetime', values: [{ value: 3 }] }] }]);
  const insights = await mediaInsights(client, { mediaId: MEDIA, metrics: ['saved'] });
  assert.equal(client.calls[0].path, `${MEDIA}/insights`);
  assert.deepEqual(client.calls[0].query, { metric: 'saved' });
  assert.deepEqual(insights.metrics[0].values, [{ value: 3, endTime: null }]);
});

// ---------- P2 (2026-10-22) ----------

test('A-14 a DELETE with an empty 2xx body is API_ERROR, and a DELETE with success true is a success', async () => {
  const empty = fakeClient([null]);
  await assert.rejects(mediaDelete(empty, { mediaId: MEDIA }), { kind: 'API_ERROR' });
  const confirmed = fakeClient([{ success: true }]);
  assert.deepEqual(await mediaDelete(confirmed, { mediaId: MEDIA }), { id: MEDIA, deleted: true });
});

test('A-13 the endpoints refuse a null options argument with VALIDATION, and make no request', async () => {
  const client = fakeClient([]);
  await assert.rejects(mediaGet(client, null), { kind: 'VALIDATION' });
  await assert.rejects(mediaList(client, null), { kind: 'VALIDATION' });
  await assert.rejects(mediaDelete(client, null), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
});

// ---------- P3 (2026-10-22) ----------

const OTHER_MEDIA = '17900000000000002';
const THIRD_MEDIA = '17900000000000003';
const PAGE_REASON = 'more pages exist beyond the page limit';
const ITEM_REASON = 'more items exist beyond the item limit';

// Truncation follows paging.next, not the length of a page (A-15). A short page with a next link is truncated, and a full
// page with no next link is not.
test('P3 A-15 a short page with a paging.next is truncated, and a full page with no next is not', async () => {
  const short = await mediaList(
    fakeClient([{ data: [{ id: MEDIA }], paging: { cursors: { after: 'a1' }, next: 'https://x' } }]),
    { limit: 2, maxPages: 1 },
  );
  assert.deepEqual([short.truncated, short.reason, short.nextAfter], [true, PAGE_REASON, 'a1']);
  const full = await mediaList(fakeClient([{ data: [{ id: MEDIA }, { id: OTHER_MEDIA }] }]), { limit: 2, maxPages: 1 });
  assert.deepEqual([full.truncated, full.reason, full.nextAfter], [false, null, null]);
});

test('P3 A-15 mediaList stops at maxPages and reports truncated, with the cursor of the page that was not read', async () => {
  const client = fakeClient([
    { data: [{ id: MEDIA }], paging: { cursors: { after: 'a1' }, next: 'https://x' } },
    { data: [{ id: OTHER_MEDIA }], paging: { cursors: { after: 'a2' }, next: 'https://x' } },
    { data: [{ id: THIRD_MEDIA }] },
  ]);
  const page = await mediaList(client, { limit: 1, maxPages: 2 });
  assert.equal(client.calls.length, 2, 'no third page is requested');
  assert.deepEqual(page.items.map((item) => item.id), [MEDIA, OTHER_MEDIA]);
  assert.deepEqual([page.truncated, page.reason, page.nextAfter], [true, PAGE_REASON, 'a2']);
});

test('P3 A-15 mediaList stops at maxItems and reports truncated when items remain beyond it', async () => {
  const client = fakeClient([{ data: [{ id: MEDIA }, { id: OTHER_MEDIA }, { id: THIRD_MEDIA }] }]);
  const page = await mediaList(client, { maxItems: 2 });
  assert.deepEqual(page.items.map((item) => item.id), [MEDIA, OTHER_MEDIA]);
  assert.deepEqual([page.truncated, page.reason], [true, ITEM_REASON]);
  assert.equal(client.calls.length, 1);
});

// Changed in the P3 review round (M-2). Old assertions (removed): `mediaList(client, { maxItems: 10001 })` rejected with
// VALIDATION. The name said "refuses a maxPages or maxItems out of range". A maxItems above 1000 is now clamped to 1000.
test('P3 mediaList refuses a maxPages below 1 before any request, and clamps a maxItems above 1000 to 1000', async () => {
  const client = fakeClient([]);
  await assert.rejects(mediaList(client, { maxPages: 0 }), { kind: 'VALIDATION' });
  assert.equal(client.calls.length, 0);
  const many = fakeClient([{ data: Array.from({ length: 1005 }, (_, i) => ({ id: String(179000000000000 + i) })) }]);
  const page = await mediaList(many, { maxItems: 10001 });
  assert.equal(page.items.length, 1000);
  assert.deepEqual([page.truncated, page.reason], [true, ITEM_REASON]);
});

// ---------- P6 (2026-10-23): publishing from files, and the URL check before a publish ----------

const BASE = 'https://media.example.com/owner';
const ROOT = resolve(import.meta.dirname, '..');

test('P6 a file path must be relative, with no drive, colon, leading separator, empty, . or .. segment, before any read', async () => {
  const fs = fakeMediaFs();
  const bad = [
    '/etc/a.jpg',
    '\\\\server\\share\\a.jpg',
    '\\a.jpg',
    'C:/a.jpg',
    'C:\\a.jpg',
    'photos/../a.jpg',
    '../a.jpg',
    'photos//a.jpg',
    'photos/',
    'a/b.jpg:stream',
    'a\0.jpg',
    '',
    '   ',
  ];
  for (const file of bad) {
    await assert.rejects(
      resolveMediaFile({ fs, mediaDir: MEDIA_DIR, file, mediaKind: 'image', publicBaseUrl: BASE }),
      { name: 'IgError', kind: 'VALIDATION' },
      JSON.stringify(file),
    );
  }
  assert.deepEqual(fs.calls, [], 'no file was read');
});

test('P6 a file must end in an extension of its kind: .jpg, .jpeg or .png for an image, .mp4 or .mov for a video', () => {
  for (const file of ['a.gif', 'a.mp4', 'a', '.jpg', 'a.jpg.exe', 'a.jpg ']) {
    assert.throws(() => parseMediaPath(file, 'image'), { name: 'IgError', kind: 'VALIDATION' }, file);
  }
  for (const file of ['a.jpg', 'a.JPEG', 'a.png']) assert.deepEqual(parseMediaPath(file, 'image'), [file]);
  for (const file of ['a.jpg', 'a.mkv', 'a.webm']) {
    assert.throws(() => parseMediaPath(file, 'video'), { name: 'IgError', kind: 'VALIDATION' }, file);
  }
  for (const file of ['clip.mp4', 'clip.MOV']) assert.deepEqual(parseMediaPath(file, 'video'), [file]);
});

test('P6 the URL of a file is publicBaseUrl plus each percent-encoded segment, with no query string or fragment', () => {
  assert.equal(mediaFileUrl(BASE, ['cover.jpg']), `${BASE}/cover.jpg`);
  assert.equal(mediaFileUrl(BASE, ['my photos', 'cover #1?.jpg']), `${BASE}/my%20photos/cover%20%231%3F.jpg`);
});

test('P6 media.dir is resolved against the project root when it is relative, and kept when it is absolute', () => {
  assert.equal(resolveMediaDir('./media', ROOT), resolve(ROOT, 'media'));
  assert.equal(resolveMediaDir(MEDIA_DIR, ROOT), MEDIA_DIR);
});

test('P6 a file inside media.dir is accepted, with its URL and size; a backslash separator gives the same URL', async () => {
  const fs = fakeMediaFs({ files: { [inMedia('photos', 'cover.jpg')]: 2048 } });
  const forward = await resolveMediaFile({
    fs,
    mediaDir: MEDIA_DIR,
    file: 'photos/cover.jpg',
    mediaKind: 'image',
    publicBaseUrl: BASE,
  });
  assert.deepEqual(forward, { url: `${BASE}/photos/cover.jpg`, size: 2048, sha256: sha256Hex(Buffer.alloc(2048)) });
  const back = await resolveMediaFile({
    fs,
    mediaDir: MEDIA_DIR,
    file: 'photos\\cover.jpg',
    mediaKind: 'image',
    publicBaseUrl: BASE,
  });
  assert.deepEqual(back, forward);
});

test('P6 a symlink under media.dir that points outside it is refused, and its target is never read', async () => {
  const target = join(OUTSIDE_DIR, 'secret.jpg');
  const fs = fakeMediaFs({ files: { [target]: 1000 }, links: { [inMedia('link.jpg')]: target } });
  await assert.rejects(
    resolveMediaFile({ fs, mediaDir: MEDIA_DIR, file: 'link.jpg', mediaKind: 'image', publicBaseUrl: BASE }),
    { name: 'IgError', kind: 'VALIDATION' },
  );
  assert.equal(fs.calls.some(([op]) => op === 'stat'), false, 'the target was not stat-ed');
});

test('P6 a real path that only shares a name prefix with media.dir is refused (media-evil is not media)', async () => {
  const sibling = join(`${MEDIA_DIR}-evil`, 'a.jpg');
  const fs = fakeMediaFs({ files: { [sibling]: 1000 }, links: { [inMedia('a.jpg')]: sibling } });
  await assert.rejects(
    resolveMediaFile({ fs, mediaDir: MEDIA_DIR, file: 'a.jpg', mediaKind: 'image', publicBaseUrl: BASE }),
    { name: 'IgError', kind: 'VALIDATION' },
  );
});

test('P6 a symlink whose real file has an extension of the other kind is refused', async () => {
  const fs = fakeMediaFs({ files: { [inMedia('clip.mp4')]: 100 }, links: { [inMedia('a.jpg')]: inMedia('clip.mp4') } });
  await assert.rejects(
    resolveMediaFile({ fs, mediaDir: MEDIA_DIR, file: 'a.jpg', mediaKind: 'image', publicBaseUrl: BASE }),
    { name: 'IgError', kind: 'VALIDATION' },
  );
});

test('P6 a file that is missing, a directory, empty, or over the size limit is refused; the limits are 8 MiB and 100 MiB', async () => {
  const cases = [
    { name: 'missing', fs: fakeMediaFs(), file: 'nope.jpg', kind: 'image' },
    { name: 'a directory', fs: fakeMediaFs({ dirs: [inMedia('folder.jpg')] }), file: 'folder.jpg', kind: 'image' },
    { name: 'an empty file', fs: fakeMediaFs({ files: { [inMedia('empty.jpg')]: 0 } }), file: 'empty.jpg', kind: 'image' },
    { name: 'an image over 8 MiB', fs: fakeMediaFs({ files: { [inMedia('big.jpg')]: 8 * MIB + 1 } }), file: 'big.jpg', kind: 'image' },
    { name: 'a video over 100 MiB', fs: fakeMediaFs({ files: { [inMedia('big.mp4')]: 100 * MIB + 1 } }), file: 'big.mp4', kind: 'video' },
  ];
  for (const c of cases) {
    await assert.rejects(
      resolveMediaFile({ fs: c.fs, mediaDir: MEDIA_DIR, file: c.file, mediaKind: c.kind, publicBaseUrl: BASE }),
      { name: 'IgError', kind: 'VALIDATION' },
      c.name,
    );
  }
  const image = await resolveMediaFile({
    fs: fakeMediaFs({ files: { [inMedia('edge.jpg')]: 8 * MIB } }),
    mediaDir: MEDIA_DIR,
    file: 'edge.jpg',
    mediaKind: 'image',
    publicBaseUrl: BASE,
  });
  assert.equal(image.size, 8 * MIB, 'exactly 8 MiB is accepted');
  const video = await resolveMediaFile({
    fs: fakeMediaFs({ files: { [inMedia('edge.mov')]: 100 * MIB } }),
    mediaDir: MEDIA_DIR,
    file: 'edge.mov',
    mediaKind: 'video',
    publicBaseUrl: BASE,
  });
  assert.equal(video.size, 100 * MIB, 'exactly 100 MiB is accepted');
  assert.equal(MEDIA_LIMITS.image.maxBytes, 8 * MIB);
  assert.equal(MEDIA_LIMITS.video.maxBytes, 100 * MIB);
});

test('P6 the HEAD check refuses a 404, and sends no token and follows no redirect', async () => {
  const host = fakeHost(() => new Response(null, { status: 404 }));
  await assert.rejects(checkMediaUrl({ fetchImpl: host.fetchImpl, url: `${BASE}/a.jpg`, mediaKind: 'image' }), {
    name: 'IgError',
    kind: 'VALIDATION',
  });
  assert.equal(host.requests.length, 1);
  assert.equal(host.requests[0].init.method, 'HEAD');
  assert.equal(host.requests[0].init.redirect, 'error');
  assert.deepEqual(host.requests[0].init.headers, {});
});

test('P6 the HEAD check refuses a Content-Type that does not match the kind, and accepts a matching one with parameters', async () => {
  const cases = [
    ['image', 'video/mp4', false],
    ['image', 'text/html', false],
    ['image', null, false],
    ['video', 'image/jpeg', false],
    ['image', 'image/jpeg; charset=binary', true],
    ['video', 'video/quicktime', true],
  ];
  for (const [mediaKind, type, ok] of cases) {
    const headers = type === null ? {} : { 'content-type': type };
    const host = fakeHost(() => new Response(null, { status: 200, headers }));
    const run = checkMediaUrl({ fetchImpl: host.fetchImpl, url: `${BASE}/x`, mediaKind });
    if (ok) {
      await run;
    } else {
      await assert.rejects(run, { name: 'IgError', kind: 'VALIDATION' }, `${mediaKind} ${type}`);
    }
  }
});

test('P6 the HEAD check passes a Content-Length that equals the file size, and refuses one that differs or is not a whole number', async () => {
  const headWith = (length) =>
    fakeHost(() => new Response(null, { status: 200, headers: { 'content-type': 'image/jpeg', 'content-length': length } }));
  await checkMediaUrl({ fetchImpl: headWith('2048').fetchImpl, url: `${BASE}/a.jpg`, mediaKind: 'image', size: 2048 });
  for (const length of ['2049', 'abc', '-1', '2048.0']) {
    await assert.rejects(
      checkMediaUrl({ fetchImpl: headWith(length).fetchImpl, url: `${BASE}/a.jpg`, mediaKind: 'image', size: 2048 }),
      { name: 'IgError', kind: 'VALIDATION' },
      length,
    );
  }
  await assert.rejects(
    checkMediaUrl({ fetchImpl: headWith('abc').fetchImpl, url: `${BASE}/a.jpg`, mediaKind: 'image' }),
    { name: 'IgError', kind: 'VALIDATION' },
    'a direct URL still needs a whole-number Content-Length',
  );
  await checkMediaUrl({ fetchImpl: headWith('5').fetchImpl, url: `${BASE}/a.jpg`, mediaKind: 'image' });
});

test('P6 the HEAD check refuses a request that fails to send, such as a redirect that is not followed', async () => {
  const host = fakeHost(async () => {
    throw new TypeError('fetch failed');
  });
  await assert.rejects(checkMediaUrl({ fetchImpl: host.fetchImpl, url: `${BASE}/a.jpg`, mediaKind: 'image' }), {
    name: 'IgError',
    kind: 'VALIDATION',
  });
});

test('P6 a carousel item from files or from urls has exactly one of its two keys', () => {
  assert.deepEqual(parseCarouselItem({ imageFile: 'a.jpg' }, 0, 'files'), { key: 'imageFile', mediaKind: 'image', value: 'a.jpg' });
  assert.deepEqual(parseCarouselItem({ videoUrl: `${BASE}/b.mp4` }, 0, 'urls'), {
    key: 'videoUrl',
    mediaKind: 'video',
    value: `${BASE}/b.mp4`,
  });
  const refused = [
    [{ imageFile: 'a.jpg', videoFile: 'b.mp4' }, 'files'],
    [{}, 'files'],
    [{ imageUrl: `${BASE}/a.jpg` }, 'files'],
    [{ imageFile: 'a.jpg' }, 'urls'],
    [{ imageUrl: `${BASE}/a.jpg`, extra: 1 }, 'urls'],
    [null, 'urls'],
    [['a.jpg'], 'files'],
  ];
  for (const [item, source] of refused) {
    assert.throws(() => parseCarouselItem(item, 0, source), { name: 'IgError', kind: 'VALIDATION' }, JSON.stringify(item));
  }
});

test('P6 a publish takes exactly one of url or file, and a carousel exactly one of urls or files', () => {
  const base = { publicBaseUrl: BASE, caption: 'x', allowedHosts: ['media.example.com'] };
  const images = [{ imageUrl: `${BASE}/1.jpg` }, { imageUrl: `${BASE}/2.jpg` }];
  const files = [{ imageFile: 'a.jpg' }, { imageFile: 'b.jpg' }];
  const refused = [
    { kind: 'image' },
    { kind: 'image', url: `${BASE}/a.jpg`, file: 'a.jpg' },
    { kind: 'reel', url: `${BASE}/a.mp4`, file: 'clip.mp4' },
    { kind: 'story' },
    { kind: 'carousel' },
    { kind: 'carousel', urls: images, files },
    { kind: 'image', url: `${BASE}/a.jpg`, urls: images },
    { kind: 'carousel', url: `${BASE}/a.jpg`, files },
  ];
  for (const input of refused) {
    assert.throws(() => checkPublish({ ...base, ...input }), { name: 'IgError', kind: 'VALIDATION' }, JSON.stringify(input));
  }
  assert.doesNotThrow(() => checkPublish({ ...base, kind: 'image', file: 'a.jpg' }));
  assert.doesNotThrow(() => checkPublish({ ...base, kind: 'image', url: `${BASE}/a.jpg` }));
  assert.doesNotThrow(() => checkPublish({ ...base, kind: 'carousel', files }));
});

test('P6 a file publish with no publicBaseUrl is refused with CONFIG, before any read', () => {
  assert.throws(() => checkPublish({ kind: 'image', file: 'a.jpg', publicBaseUrl: null }), { name: 'IgError', kind: 'CONFIG' });
  assert.throws(
    () => checkPublish({ kind: 'carousel', files: [{ imageFile: 'a.jpg' }, { imageFile: 'b.jpg' }] }),
    { name: 'IgError', kind: 'CONFIG' },
  );
});

// ---------- P6 fix round (2026-10-23): the HEAD fallback, and the digest for the audit line ----------

test('P6-FB1 a host that answers 405 to HEAD and 206 to the one-byte GET passes when the type and the Content-Range total match', async () => {
  const host = fakeHost((url, init) =>
    init.method === 'HEAD'
      ? new Response(null, { status: 405 })
      : new Response(new Uint8Array(1), {
          status: 206,
          headers: { 'content-type': 'image/jpeg', 'content-range': 'bytes 0-0/2048', 'content-length': '1' },
        }),
  );
  await checkMediaUrl({ fetchImpl: host.fetchImpl, url: `${BASE}/a.jpg`, mediaKind: 'image', size: 2048 });
  assert.deepEqual(host.requests.map((request) => request.init.method), ['HEAD', 'GET']);
  const get = host.requests[1];
  assert.equal(get.url, `${BASE}/a.jpg`);
  assert.deepEqual(get.init.headers, { Range: 'bytes=0-0' }, 'the one-byte GET sends only the range, never a token');
  assert.equal(get.init.redirect, 'error');
});

test('P6-FB2 a 501 to HEAD also falls back; a 200 to the one-byte GET passes when its Content-Length matches, and its body is cancelled, not read', async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
  });
  const host = fakeHost((url, init) =>
    init.method === 'HEAD'
      ? new Response(null, { status: 501 })
      : new Response(body, { status: 200, headers: { 'content-type': 'video/mp4', 'content-length': '2048' } }),
  );
  await checkMediaUrl({ fetchImpl: host.fetchImpl, url: `${BASE}/clip.mp4`, mediaKind: 'video', size: 2048 });
  assert.deepEqual(host.requests.map((request) => request.init.method), ['HEAD', 'GET']);
  assert.equal(cancelled, true, 'the body was cancelled, so the file was not downloaded');
});

test('P6-FB3 after a 405 to HEAD, the one-byte GET refuses a different total, a different type, no Content-Range, a 200 with no Content-Length when the size is known, or another status', async () => {
  const cases = [
    { name: 'a different total', status: 206, headers: { 'content-type': 'image/jpeg', 'content-range': 'bytes 0-0/2049' } },
    { name: 'a different type', status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-0/2048' } },
    { name: 'no Content-Range', status: 206, headers: { 'content-type': 'image/jpeg' } },
    { name: 'a 200 with no Content-Length', status: 200, headers: { 'content-type': 'image/jpeg' } },
    { name: 'a 404', status: 404, headers: { 'content-type': 'image/jpeg' } },
  ];
  for (const c of cases) {
    const host = fakeHost((url, init) =>
      init.method === 'HEAD' ? new Response(null, { status: 405 }) : new Response(new Uint8Array(1), { status: c.status, headers: c.headers }),
    );
    await assert.rejects(
      checkMediaUrl({ fetchImpl: host.fetchImpl, url: `${BASE}/a.jpg`, mediaKind: 'image', size: 2048 }),
      { name: 'IgError', kind: 'VALIDATION' },
      c.name,
    );
    assert.deepEqual(host.requests.map((request) => request.init.method), ['HEAD', 'GET'], c.name);
  }
});

test('P6-FB4 a 405 to HEAD whose one-byte GET cannot be sent refuses', async () => {
  const host = fakeHost(async (url, init) => {
    if (init.method === 'HEAD') return new Response(null, { status: 405 });
    throw new TypeError('fetch failed');
  });
  await assert.rejects(
    checkMediaUrl({ fetchImpl: host.fetchImpl, url: `${BASE}/a.jpg`, mediaKind: 'image', size: 2048 }),
    { name: 'IgError', kind: 'VALIDATION' },
  );
});

test('P6-FB5 a 404 to HEAD refuses with no fallback: the one-byte GET is never sent', async () => {
  const host = fakeHost(() => new Response(null, { status: 404 }));
  await assert.rejects(
    checkMediaUrl({ fetchImpl: host.fetchImpl, url: `${BASE}/a.jpg`, mediaKind: 'image', size: 2048 }),
    { name: 'IgError', kind: 'VALIDATION' },
  );
  assert.deepEqual(host.requests.map((request) => request.init.method), ['HEAD']);
});

test('P6-FB6 for a direct URL, whose size is not known, a 206 with a Content-Range passes, and so does a 200 without a Content-Length', async () => {
  const ranged = fakeHost((url, init) =>
    init.method === 'HEAD'
      ? new Response(null, { status: 405 })
      : new Response(new Uint8Array(1), { status: 206, headers: { 'content-type': 'image/png', 'content-range': 'bytes 0-0/99' } }),
  );
  await checkMediaUrl({ fetchImpl: ranged.fetchImpl, url: `${BASE}/a.png`, mediaKind: 'image' });
  const whole = fakeHost((url, init) =>
    init.method === 'HEAD' ? new Response(null, { status: 405 }) : new Response(new Uint8Array(1), { status: 200, headers: { 'content-type': 'image/png' } }),
  );
  await checkMediaUrl({ fetchImpl: whole.fetchImpl, url: `${BASE}/a.png`, mediaKind: 'image' });
});

test('P6-AUD1 resolveMediaFile gives the SHA-256 of the file contents, and refuses a file whose contents differ in length from its size', async () => {
  const bytes = Buffer.from('hello');
  const fs = fakeMediaFs({ files: { [inMedia('a.jpg')]: 5 }, contents: { [inMedia('a.jpg')]: bytes } });
  const resolved = await resolveMediaFile({ fs, mediaDir: MEDIA_DIR, file: 'a.jpg', mediaKind: 'image', publicBaseUrl: BASE });
  assert.equal(resolved.sha256, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.match(resolved.sha256, /^[0-9a-f]{64}$/);
  assert.equal(resolved.sha256, sha256Hex(bytes));
  const changed = fakeMediaFs({ files: { [inMedia('b.jpg')]: 5 }, contents: { [inMedia('b.jpg')]: Buffer.from('hello!') } });
  await assert.rejects(
    resolveMediaFile({ fs: changed, mediaDir: MEDIA_DIR, file: 'b.jpg', mediaKind: 'image', publicBaseUrl: BASE }),
    { name: 'IgError', kind: 'VALIDATION' },
  );
});

// ---------- P6 fix round 2 (2026-10-23): image stories behind story.images, and a chunked digest ----------

test('P6-IS1 publishStory posts an image story as a STORIES container with image_url, and refuses a story with both or neither URL', async () => {
  const client = fakeClient([{ id: CONTAINER }, { status_code: 'FINISHED' }, { id: PUBLISHED }]);
  const result = await publishStory(client, { igUserId: IG_USER, imageUrl: IMAGE_URL, sleep: fakeSleep().sleep });
  assert.deepEqual(result, { id: PUBLISHED });
  assert.deepEqual(client.calls[0].body, { form: { media_type: 'STORIES', image_url: IMAGE_URL } });
  assert.deepEqual(client.calls.map(route), [`POST ${IG_USER}/media`, `GET ${CONTAINER}`, `POST ${IG_USER}/media_publish`]);
  await assert.rejects(
    publishStory(fakeClient([]), { igUserId: IG_USER, imageUrl: IMAGE_URL, videoUrl: VIDEO_URL }),
    { name: 'IgError', kind: 'VALIDATION' },
  );
  await assert.rejects(publishStory(fakeClient([]), { igUserId: IG_USER }), { name: 'IgError', kind: 'VALIDATION' });
});

test('P6-IS2 checkPublish takes a .jpg or .png story only when storyImages is true; a .mp4 story is taken either way', () => {
  const base = { kind: 'story', publicBaseUrl: BASE };
  assert.throws(() => checkPublish({ ...base, file: 'a.jpg' }), { name: 'IgError', kind: 'VALIDATION' });
  assert.throws(() => checkPublish({ ...base, file: 'a.png', storyImages: false }), { name: 'IgError', kind: 'VALIDATION' });
  assert.doesNotThrow(() => checkPublish({ ...base, file: 'a.jpg', storyImages: true }));
  assert.doesNotThrow(() => checkPublish({ ...base, file: 'a.png', storyImages: true }));
  assert.doesNotThrow(() => checkPublish({ ...base, file: 'a.mp4' }));
  assert.doesNotThrow(() => checkPublish({ ...base, file: 'a.mp4', storyImages: true }));
  assert.throws(() => checkPublish({ ...base, file: 'a.gif', storyImages: true }), { name: 'IgError', kind: 'VALIDATION' });
});

test('P6-CH1 the digest of a file read in several chunks equals the digest of the same bytes read in one chunk', async () => {
  const bytes = Buffer.from(Array.from({ length: 2621440 }, (_, i) => (i * 31) % 251));
  const path = inMedia('chunked.jpg');
  const chunked = fakeMediaFs({ files: { [path]: bytes.length }, contents: { [path]: bytes } });
  const whole = fakeMediaFs({ files: { [path]: bytes.length }, contents: { [path]: bytes } });
  const many = (await sha256File({ fs: chunked, path, expected: await chunked.stat(path), chunkBytes: 1000 })).sha256;
  const one = (await sha256File({ fs: whole, path, expected: await whole.stat(path), chunkBytes: bytes.length })).sha256;
  assert.equal(many, one);
  assert.equal(many, sha256Hex(bytes));
  const reads = chunked.calls.filter(([op]) => op === 'read').map(([, , length]) => length);
  assert.equal(reads.length, Math.ceil(bytes.length / 1000) + 1, 'the chunks, and one final read that returns nothing');
  assert.ok(reads.every((length) => length <= 1000), 'no read asks for more than a chunk');
});

test('P6-CH2 a 100 MiB file is hashed in chunks of at most 1 MiB, so it is never held in memory in full', async () => {
  const path = inMedia('edge.mov');
  const fs = fakeMediaFs({ files: { [path]: 100 * MIB } });
  const digest = (await sha256File({ fs, path, expected: await fs.stat(path) })).sha256;
  const reads = fs.calls.filter(([op]) => op === 'read').map(([, , length]) => length);
  assert.ok(reads.every((length) => length <= MIB), 'no read asks for more than 1 MiB');
  assert.equal(reads.length, 101, 'one hundred chunks and one final read that returns nothing');
  const reference = createHash('sha256');
  const zeros = Buffer.alloc(MIB);
  for (let i = 0; i < 100; i += 1) reference.update(zeros);
  assert.equal(digest, reference.digest('hex'));
});

// ---------- P6 review fixes (2026-10-23): echoed text, HEAD 403, the open descriptor, the canonical URL, oversize files ----------

test('P6-R1 safeEcho removes control characters and keeps at most 64 characters; a refusal echoes a long Content-Type no further', async () => {
  assert.equal(safeEcho('a\u0007b\u001b[31mc\u007f'), 'ab[31mc');
  assert.equal(safeEcho('y'.repeat(200)).length, 64);
  const host = fakeHost(() => new Response(null, { status: 200, headers: { 'content-type': `text/${'x'.repeat(200)}` } }));
  const error = await checkMediaUrl({ fetchImpl: host.fetchImpl, url: `${BASE}/a.jpg`, mediaKind: 'image' }).catch((err) => err);
  assert.equal(error.kind, 'VALIDATION');
  const shown = ('text/' + 'x'.repeat(200)).slice(0, 64);
  assert.ok(error.message.includes(shown), 'the first 64 characters of the type are echoed');
  assert.equal(error.message.includes('x'.repeat(60)), false, 'nothing past the 64th character is echoed');
});

test('P6-R2 checkPublish refuses a direct URL, or a carousel URL item, on a host that is not on allowedHosts, before any request', () => {
  const allowed = ['media.example.com'];
  assert.throws(
    () => checkPublish({ kind: 'image', url: 'https://other.example/a.jpg', publicBaseUrl: BASE, caption: 'x', allowedHosts: allowed }),
    { name: 'IgError', kind: 'VALIDATION' },
  );
  assert.throws(
    () => checkPublish({ kind: 'carousel', urls: [{ imageUrl: `${BASE}/1.jpg` }, { imageUrl: 'https://other.example/2.jpg' }], allowedHosts: allowed }),
    { name: 'IgError', kind: 'VALIDATION' },
  );
  assert.doesNotThrow(() => checkPublish({ kind: 'image', url: `${BASE}/a.jpg`, caption: 'x', allowedHosts: allowed }));
  assert.throws(() => checkPublish({ kind: 'image', url: `${BASE}/a.jpg`, caption: 'x' }), { name: 'IgError', kind: 'VALIDATION' }, 'no list means no host is allowed');
});

test('P6-R3 a 403 to HEAD falls back to the one-byte GET, and a 206 with a matching type and total passes', async () => {
  const host = fakeHost((url, init) =>
    init.method === 'HEAD'
      ? new Response(null, { status: 403 })
      : new Response(new Uint8Array(1), { status: 206, headers: { 'content-type': 'image/jpeg', 'content-range': 'bytes 0-0/2048' } }),
  );
  await checkMediaUrl({ fetchImpl: host.fetchImpl, url: `${BASE}/a.jpg`, mediaKind: 'image', size: 2048 });
  assert.deepEqual(host.requests.map((request) => request.init.method), ['HEAD', 'GET']);
  assert.deepEqual(host.requests[1].init.headers, { Range: 'bytes=0-0' });
  const refused = fakeHost((url, init) =>
    init.method === 'HEAD' ? new Response(null, { status: 403 }) : new Response(new Uint8Array(1), { status: 404 }),
  );
  await assert.rejects(checkMediaUrl({ fetchImpl: refused.fetchImpl, url: `${BASE}/a.jpg`, mediaKind: 'image' }), { name: 'IgError', kind: 'VALIDATION' });
});

test('P6-R4 a file swapped between the check and the open is refused: another inode, another size, a non-file, or a second name', async () => {
  const p = inMedia('cover.jpg');
  const cases = [
    { name: 'another inode', swaps: { [p]: { ino: 999999 } } },
    { name: 'another size', swaps: { [p]: { size: 2049 } } },
    { name: 'a non-file, such as a FIFO', swaps: { [p]: { isFile: false } } },
    { name: 'a second hard link', swaps: { [p]: { nlink: 2 } } },
  ];
  for (const c of cases) {
    const fs = fakeMediaFs({ files: { [p]: 2048 }, swaps: c.swaps });
    await assert.rejects(
      resolveMediaFile({ fs, mediaDir: MEDIA_DIR, file: 'cover.jpg', mediaKind: 'image', publicBaseUrl: BASE }),
      { name: 'IgError', kind: 'VALIDATION' },
      c.name,
    );
  }
});

test('P6-R4b the file is opened once, after the path checks, and its size and digest come from the open descriptor', async () => {
  const p = inMedia('cover.jpg');
  const fs = fakeMediaFs({ files: { [p]: 5 }, contents: { [p]: Buffer.from('hello') } });
  const resolved = await resolveMediaFile({ fs, mediaDir: MEDIA_DIR, file: 'cover.jpg', mediaKind: 'image', publicBaseUrl: BASE });
  const ops = fs.calls.map(([op]) => op);
  assert.equal(ops.filter((op) => op === 'open').length, 1, 'opened once');
  assert.ok(ops.indexOf('stat') < ops.indexOf('open'), 'the path is checked before the open');
  assert.ok(ops.indexOf('open') < ops.indexOf('fstat'), 'the descriptor is read after the open');
  assert.deepEqual(resolved, { url: `${BASE}/cover.jpg`, size: 5, sha256: sha256Hex(Buffer.from('hello')) });
});

test('P6-R5 a path spelled with another case, or with a . segment, that resolves to the same file gives the canonical URL and digest', async () => {
  const canonical = inMedia('photos', 'cover.jpg');
  const fs = fakeMediaFs({
    files: { [canonical]: 5 },
    contents: { [canonical]: Buffer.from('hello') },
    links: { [inMedia('PHOTOS', 'Cover.JPG')]: canonical },
  });
  const cased = await resolveMediaFile({ fs, mediaDir: MEDIA_DIR, file: 'PHOTOS/Cover.JPG', mediaKind: 'image', publicBaseUrl: BASE });
  assert.equal(cased.url, `${BASE}/photos/cover.jpg`);
  assert.equal(cased.sha256, sha256Hex(Buffer.from('hello')));
  const dotted = await resolveMediaFile({ fs, mediaDir: MEDIA_DIR, file: 'photos/./cover.jpg', mediaKind: 'image', publicBaseUrl: BASE });
  assert.equal(dotted.url, `${BASE}/photos/cover.jpg`);
  assert.equal(dotted.sha256, cased.sha256);
});

test('P6-R6 an oversize file is refused before it is opened: no open, no read and no descriptor stat', async () => {
  for (const [name, size, kind, mediaKind] of [
    ['big.jpg', 8 * MIB + 1, 'big.jpg', 'image'],
    ['big.mp4', 100 * MIB + 1, 'big.mp4', 'video'],
  ]) {
    const fs = fakeMediaFs({ files: { [inMedia(name)]: size } });
    await assert.rejects(
      resolveMediaFile({ fs, mediaDir: MEDIA_DIR, file: kind, mediaKind, publicBaseUrl: BASE }),
      { name: 'IgError', kind: 'VALIDATION' },
      name,
    );
    const ops = fs.calls.map(([op]) => op);
    assert.equal(ops.includes('open'), false, `${name} was never opened`);
    assert.equal(ops.includes('read'), false, `${name} was never read`);
    assert.equal(ops.includes('fstat'), false, `${name} was never stat-ed through a descriptor`);
  }
});

test('P6-R6b a 301 or 302 answer to HEAD refuses with no fallback, and a 302 to the one-byte GET refuses', async () => {
  for (const status of [301, 302]) {
    const host = fakeHost(() => new Response(null, { status }));
    await assert.rejects(checkMediaUrl({ fetchImpl: host.fetchImpl, url: `${BASE}/a.jpg`, mediaKind: 'image', size: 2048 }), {
      name: 'IgError',
      kind: 'VALIDATION',
    });
    assert.deepEqual(host.requests.map((request) => request.init.method), ['HEAD'], `HEAD ${status}: no fallback`);
  }
  const redirected = fakeHost((url, init) =>
    init.method === 'HEAD' ? new Response(null, { status: 405 }) : new Response(null, { status: 302 }),
  );
  await assert.rejects(checkMediaUrl({ fetchImpl: redirected.fetchImpl, url: `${BASE}/a.jpg`, mediaKind: 'image', size: 2048 }), {
    name: 'IgError',
    kind: 'VALIDATION',
  });
  assert.deepEqual(redirected.requests.map((request) => request.init.method), ['HEAD', 'GET']);
});
