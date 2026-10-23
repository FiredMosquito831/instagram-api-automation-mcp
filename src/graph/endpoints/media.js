// Media reads and the publishing flow. Every write is a plain client call with no retryPost. A retried publish could
// publish twice, so a failed write is reported to the caller and is never repeated here. The client retries reads only.

import { IgError } from '../../errors.js';
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { nextCursorOf, readAllPages, withCursor } from '../paging.js';
import { optionsOf } from './common.js';
import { checkId, orNull, responseConfirmed, responseId, responseObject } from './common.js';
import { defaultSleep, MAX_TIMER_MS } from '../../util/clock.js';

const MEDIA_FIELDS = 'id,caption,media_type,media_url,permalink,timestamp,like_count,comments_count';
// The default page is the largest that the endpoint allows (P3 fix round, ruling 2). Old value (removed): 25.
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;
const POLL_MS = 5000;
const MAX_POLLS = 60;
const MIN_CAROUSEL_ITEMS = 2;
const MAX_CAROUSEL_ITEMS = 10;
// The files that a publish may name, by media kind: the extensions, the largest size in bytes (8 MiB for an image, 100 MiB
// for a video), and the Content-Type that the URL of such a file must answer with (image/* or video/*). O-13.
export const MEDIA_LIMITS = Object.freeze({
  image: Object.freeze({ extensions: Object.freeze(['jpg', 'jpeg', 'png']), maxBytes: 8 * 1024 * 1024, type: 'image/' }),
  video: Object.freeze({ extensions: Object.freeze(['mp4', 'mov']), maxBytes: 100 * 1024 * 1024, type: 'video/' }),
});
// The HEAD check of a publishing URL waits this long at most.
const HEAD_TIMEOUT_MS = 15000;
// The keys of a carousel item, by source. A URL item has imageUrl or videoUrl; a file item has imageFile or videoFile.
const URL_ITEM_KEYS = Object.freeze({ imageUrl: 'image', videoUrl: 'video' });
const FILE_ITEM_KEYS = Object.freeze({ imageFile: 'image', videoFile: 'video' });

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

// Graph fetches the media from this URL, so only an https URL is accepted.
function checkUrl(value, name) {
  let url = null;
  if (typeof value === 'string') {
    try {
      url = new URL(value);
    } catch {
      url = null;
    }
  }
  if (url === null || url.protocol !== 'https:') {
    throw new IgError('VALIDATION', `${name} must be an https URL`);
  }
  return value;
}

function checkCaption(value) {
  if (value !== undefined && typeof value !== 'string') {
    throw new IgError('VALIDATION', 'caption must be a string when it is given');
  }
  return value;
}

function checkPolling(pollMs, maxPolls) {
  if (!Number.isInteger(pollMs) || pollMs < 0 || pollMs > MAX_TIMER_MS) {
    throw new IgError('VALIDATION', 'pollMs must be a whole number of milliseconds from 0 to 2147483647');
  }
  if (!Number.isInteger(maxPolls) || maxPolls < 1) {
    throw new IgError('VALIDATION', 'maxPolls must be a whole number of at least 1');
  }
}

// One media object. The id is required. A field that Graph omits, such as a withheld media_url, is null.
function normaliseMedia(raw) {
  const media = responseObject(raw, 'media');
  return {
    id: responseId(media, 'media'),
    caption: orNull(media.caption),
    mediaType: orNull(media.media_type),
    mediaUrl: orNull(media.media_url),
    permalink: orNull(media.permalink),
    timestamp: orNull(media.timestamp),
    likeCount: orNull(media.like_count),
    commentsCount: orNull(media.comments_count),
  };
}

// The owner's media, read page by page from the cursor after (when given), in pages of limit. Paging follows paging.next
// only (see paging.js), up to maxPages pages and maxItems items. The result is { items, truncated, reason, nextAfter }:
// nextAfter is the cursor of the page not read, when the read stopped between pages.
export async function mediaList(client, options) {
  const { limit = DEFAULT_LIMIT, after, maxPages, maxItems } = optionsOf(options, 'mediaList');
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new IgError('VALIDATION', `limit must be a whole number from 1 to ${MAX_LIMIT}`);
  }
  if (after !== undefined && (typeof after !== 'string' || after === '')) {
    throw new IgError('VALIDATION', 'after must be a non-empty cursor string when it is given');
  }
  const base = { fields: MEDIA_FIELDS, limit };
  return readAllPages({
    fetchPage: async (cursor) => {
      const { data } = await client.get('me/media', withCursor(base, cursor ?? after));
      const body = responseObject(data, 'media list');
      if (!Array.isArray(body.data)) throw new IgError('API_ERROR', 'Graph API media list response has no data array');
      return { items: body.data.map(normaliseMedia), nextAfter: nextCursorOf(body, 'media list') };
    },
    keyOf: (media) => media.id,
    maxPages,
    maxItems,
  });
}

export async function mediaGet(client, options) {
  const { mediaId } = optionsOf(options, 'mediaGet');
  checkId(mediaId, 'mediaId');
  const { data } = await client.get(mediaId, { fields: MEDIA_FIELDS });
  return normaliseMedia(data);
}

// The owner's publishing quota: quotaUsage posts against quotaTotal. Both must be whole counts. A missing quota is
// refused, because the service's publish gate would otherwise compare against undefined and let the publish through.
export async function contentPublishingLimit(client, options) {
  const { igUserId, since } = optionsOf(options, 'contentPublishingLimit');
  checkId(igUserId, 'igUserId');
  if (!Number.isSafeInteger(since) || since < 0) {
    throw new IgError('VALIDATION', 'since must be a Unix time in whole seconds');
  }
  const { data } = await client.get(`${igUserId}/content_publishing_limit`, { since });
  const rows = responseObject(data, 'content publishing limit').data;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new IgError('API_ERROR', 'Graph API content publishing limit response has no row');
  }
  const row = responseObject(rows[0], 'content publishing limit row');
  const quotaTotal = row.config?.quota_total;
  const quotaUsage = row.quota_usage;
  if (!isCount(quotaTotal) || !isCount(quotaUsage)) {
    throw new IgError('API_ERROR', 'Graph API content publishing limit has no usable quota');
  }
  return { quotaTotal, quotaUsage };
}

// The last step of every publish: media_publish with the id of a finished container.
async function publishContainer(client, igUserId, creationId) {
  const { data } = await client.post(`${igUserId}/media_publish`, { form: { creation_id: creationId } });
  return { id: responseId(data, 'media_publish') };
}

// Polls a container's status until it is FINISHED. ERROR, EXPIRED, an unknown status, or running out of polls fails.
async function waitUntilFinished(client, containerId, { sleep, pollMs, maxPolls }) {
  for (let poll = 1; ; poll += 1) {
    const { data } = await client.get(containerId, { fields: 'status_code' });
    const status = responseObject(data, 'container status').status_code;
    if (status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') {
      throw new IgError('API_ERROR', `media container ${containerId} ended with status ${status}`);
    }
    if (status !== 'IN_PROGRESS') {
      throw new IgError('API_ERROR', `media container ${containerId} has an unknown status`);
    }
    if (poll >= maxPolls) {
      throw new IgError('API_ERROR', `media container ${containerId} was not FINISHED after ${maxPolls} polls`);
    }
    await sleep(pollMs);
  }
}

const invalidFile = (message) => new IgError('VALIDATION', message);
const extensionOf = (name) => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
};
const kindLimits = (mediaKind) => {
  if (!Object.hasOwn(MEDIA_LIMITS, mediaKind)) throw new TypeError(`unknown media kind: ${String(mediaKind)}`);
  return MEDIA_LIMITS[mediaKind];
};

// A file publish needs the owner's public base URL. Without it the file is refused before any read (CONFIG, P6-2).
function requireBase(publicBaseUrl) {
  if (typeof publicBaseUrl !== 'string' || publicBaseUrl === '') {
    throw new IgError('CONFIG', 'media.publicBaseUrl is not set, so a file cannot be published; set it in the config file');
  }
}

// The syntax of a file path under media.dir. It reads nothing. The path is relative, with no drive letter, no colon, no
// leading slash or backslash, no NUL character, and no empty or .. segment, and it ends in an extension of its kind.
// It returns the segments, which become the URL path.
export function parseMediaPath(value, mediaKind) {
  const limits = kindLimits(mediaKind);
  if (typeof value !== 'string' || value.trim() === '') throw invalidFile('file must be a non-empty path under media.dir');
  if (value.includes('\0')) throw invalidFile('file must not contain a NUL character');
  if (/^[\\/]/.test(value)) throw invalidFile('file must be relative: it must not start with a slash or a backslash');
  if (value.includes(':')) throw invalidFile('file must not contain a colon, which would be a drive letter or a stream name');
  const segments = value.split(/[\\/]/);
  if (segments.some((segment) => segment === '')) throw invalidFile('file must not contain an empty segment');
  // A . segment names the directory it is in, so it is harmless: the real path is what is checked (P6 review M-5). A .. is refused.
  if (segments.some((segment) => segment === '..')) throw invalidFile('file must not contain a .. segment');
  if (!limits.extensions.includes(extensionOf(segments[segments.length - 1]))) {
    throw invalidFile(`file must end in ${limits.extensions.map((ext) => `.${ext}`).join(', ')} for this kind`);
  }
  return segments;
}

// media.dir as an absolute path. A relative value is resolved against the project root, as dataDir is.
export function resolveMediaDir(dir, root) {
  return isAbsolute(dir) ? resolve(dir) : resolve(root, dir);
}

// The URL that the owner's host serves for a file: the base URL, then each segment percent-encoded. It has no query string.
export function mediaFileUrl(publicBaseUrl, segments) {
  return `${publicBaseUrl.replace(/\/+$/, '')}/${segments.map((segment) => encodeURIComponent(segment)).join('/')}`;
}

// Checks a file under media.dir and gives its URL, its size and the SHA-256 of its contents. The syntax is checked first,
// before any read. Then the real path of the file must lie inside the real path of media.dir, so a symlink that points
// outside is refused. The real file must have an extension of its kind, be a regular file that is not empty, and be within
// the size limit. fs is injected as { realpath, stat, open } (node:fs/promises). The content is read in chunks, to hash it
// for the audit line of the publish (sha256File). It is not kept, and it is not sent anywhere.
export async function resolveMediaFile({ fs, mediaDir, file, mediaKind, publicBaseUrl }) {
  const segments = parseMediaPath(file, mediaKind);
  requireBase(publicBaseUrl);
  const limits = kindLimits(mediaKind);
  let rootReal;
  try {
    rootReal = await fs.realpath(mediaDir);
  } catch {
    throw new IgError('CONFIG', 'media.dir could not be read');
  }
  let real;
  try {
    real = await fs.realpath(join(mediaDir, ...segments));
  } catch {
    throw invalidFile('the file was not found under media.dir');
  }
  const inside = relative(rootReal, real);
  if (inside === '' || isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) {
    throw invalidFile('the file resolves outside media.dir, so it is refused');
  }
  if (!limits.extensions.includes(extensionOf(basename(real)))) {
    throw invalidFile('the file it resolves to does not have an extension of this kind');
  }
  let info;
  try {
    info = await fs.stat(real);
  } catch {
    throw invalidFile('the file could not be read');
  }
  if (!info.isFile()) throw invalidFile('the path is not a regular file');
  if (!Number.isSafeInteger(info.size) || info.size < 1) throw invalidFile('the file is empty');
  if (info.size > limits.maxBytes) {
    throw invalidFile(`the file is ${info.size} bytes; the limit for this kind is ${limits.maxBytes} bytes`);
  }
  // The file is opened once, after the path checks, and its size and digest come from that descriptor (P6 review M-4). The URL
  // is built from the canonical path under media.dir (M-5), so the URL, the digest and the size describe one file.
  const opened = await sha256File({ fs, path: real, expected: info });
  return { url: mediaFileUrl(publicBaseUrl, inside.split(/[\\/]/)), size: opened.size, sha256: opened.sha256 };
}

// The bytes that the digest reads at a time. A file is never held in memory in full: at most one chunk is.
const HASH_CHUNK_BYTES = 1024 * 1024;
// The open flags: read only, and non-blocking where the platform has the flag, so that a FIFO swapped in cannot block the open.
const READ_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NONBLOCK ?? 0);

// The SHA-256 of a file, from one open descriptor. The file is opened once, after the path checks. The descriptor is then
// stat-ed, and its device, inode, link count and size must be those that the path stat gave at check time (expected): a
// different file, a second name, a file that is not regular, or a changed size is refused. The bytes are read in chunks of
// chunkBytes, and their count must equal the descriptor's size, or the file is refused as changed. Reading stops as soon as
// more bytes arrive than that size. Returns { size, sha256 }, both taken from the descriptor (P6 review M-4).
export async function sha256File({ fs, path, expected, chunkBytes = HASH_CHUNK_BYTES }) {
  let handle;
  try {
    handle = await fs.open(path, READ_FLAGS);
  } catch {
    throw invalidFile('the file could not be read');
  }
  try {
    let opened;
    try {
      opened = await handle.stat();
    } catch {
      throw invalidFile('the file could not be read');
    }
    if (opened.isFile() !== true) throw invalidFile('the file is not a regular file at the open, so it is refused');
    if (opened.dev !== expected.dev || opened.ino !== expected.ino) {
      throw invalidFile('the file was replaced between the check and the open, so it is refused');
    }
    if (opened.nlink !== 1) throw invalidFile('the file has more than one name, so it is refused');
    if (opened.size !== expected.size) throw invalidFile('the file changed size between the check and the open, so it is refused');
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(chunkBytes);
    let position = 0;
    for (;;) {
      let bytesRead;
      try {
        ({ bytesRead } = await handle.read(buffer, 0, chunkBytes, position));
      } catch {
        throw invalidFile('the file could not be read');
      }
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
      if (position > opened.size) break;
    }
    if (position !== opened.size) throw invalidFile('the file changed while it was read, so it is refused');
    return { size: opened.size, sha256: hash.digest('hex') };
  } finally {
    try {
      await handle.close();
    } catch {
      // The digest does not depend on the close, so a failed close changes nothing here.
    }
  }
}

// The HEAD answers that allow the fallback to a one-byte GET: a host that refuses HEAD with 403, 405 or 501 (M-3). No other
// status does.
const HEAD_REFUSED = new Set([403, 405, 501]);

// Remote text that a refusal message may echo (a Content-Type, a Content-Length): control characters are removed, and only the
// first 64 characters are kept, so a host cannot put a long or hostile text into a message (P6 review M-1).
export function safeEcho(value) {
  return Array.from(String(value).replace(/[\u0000-\u001f\u007f-\u009f]/g, '')).slice(0, 64).join('');
}

// One request of the URL check, with the timeout, no redirect and the given headers, and never a token. A failure to send
// it refuses the publish.
async function sendCheck(fetchImpl, url, method, headers) {
  try {
    return await fetchImpl(url, { method, redirect: 'error', headers, signal: AbortSignal.timeout(HEAD_TIMEOUT_MS) });
  } catch (err) {
    throw invalidFile(`the media URL could not be checked (${typeof err?.name === 'string' ? err.name : 'error'})`);
  }
}

// The Content-Type of an answer must be image/* or video/* for the kind.
function checkContentType(res, mediaKind) {
  const limits = kindLimits(mediaKind);
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!contentType.startsWith(limits.type)) {
    const shown = safeEcho(contentType);
    throw invalidFile(`the media URL has Content-Type ${shown === '' ? 'none' : shown}, but a ${mediaKind} needs ${limits.type}*`);
  }
}

// A Content-Length must be a whole number, and must equal the file size when the size is known (size is null for a direct
// URL, whose size is not known).
function checkLength(length, size) {
  if (!/^\d+$/.test(length)) throw invalidFile('the media URL sent a Content-Length that is not a whole number');
  if (size !== null && Number(length) !== size) {
    throw invalidFile(`the media URL reports ${safeEcho(length)} bytes, but the file is ${size} bytes`);
  }
}

// The body of an answer is not wanted: it is cancelled at once, so only the headers were received.
async function discardBody(res) {
  try {
    await res.body?.cancel();
  } catch {
    // The body is discarded either way; a cancel that fails changes nothing here.
  }
}

// The fallback, after HEAD was refused with 405 or 501: a GET for the first byte only (Range: bytes=0-0). A 206 names the
// file size in its Content-Range, and its Content-Length is the one byte. A 200, where the host ignored the range, names
// the size in its Content-Length. The same type check applies. Any other status refuses.
async function checkRangedGet({ fetchImpl, url, mediaKind, size }) {
  const res = await sendCheck(fetchImpl, url, 'GET', { Range: 'bytes=0-0' });
  try {
    if (res.status !== 206 && res.status !== 200) {
      throw invalidFile(`the media URL answered the one-byte GET with ${res.status}, not 206 or 200`);
    }
    checkContentType(res, mediaKind);
    if (res.status === 206) {
      const match = /^bytes 0-0\/(\d+)$/.exec(res.headers.get('content-range') ?? '');
      if (match === null) throw invalidFile('the one-byte GET has no Content-Range that names the file size');
      if (size !== null && Number(match[1]) !== size) {
        throw invalidFile(`the media URL reports ${safeEcho(match[1])} bytes, but the file is ${size} bytes`);
      }
      return;
    }
    const length = res.headers.get('content-length');
    if (length === null) {
      if (size !== null) throw invalidFile('the one-byte GET sent no Content-Length, so the file size cannot be checked');
      return;
    }
    checkLength(length, size);
  } finally {
    await discardBody(res);
  }
}

// Checks a publishing URL with a HEAD request to the owner's host, before any container request. The answer must be 2xx,
// its Content-Type must be image/* or video/* for the kind, and a Content-Length, when present, must be a whole number that
// equals the file size. If the host refuses HEAD with 405 or 501, the check falls back to a one-byte GET (checkRangedGet).
// The requests carry no token and follow no redirect. They read the owner's host, not Graph, so they count toward no cap.
export async function checkMediaUrl({ fetchImpl, url, mediaKind, size = null }) {
  const head = await sendCheck(fetchImpl, url, 'HEAD', {});
  if (HEAD_REFUSED.has(head.status)) {
    await checkRangedGet({ fetchImpl, url, mediaKind, size });
    return;
  }
  if (head.status < 200 || head.status > 299) throw invalidFile(`the media URL answered HEAD with ${head.status}, not 2xx`);
  checkContentType(head, mediaKind);
  const length = head.headers.get('content-length');
  if (length !== null) checkLength(length, size);
}

// One carousel item, from a list of URLs (source 'urls': imageUrl or videoUrl) or of files (source 'files': imageFile or
// videoFile). It has exactly one of its two keys and no other key. Returns { key, mediaKind, value }.
export function parseCarouselItem(item, index, source) {
  const keys = source === 'files' ? FILE_ITEM_KEYS : URL_ITEM_KEYS;
  const names = Object.keys(keys).join(' or ');
  const name = `items[${index}]`;
  if (item === null || typeof item !== 'object' || Array.isArray(item)) throw invalidFile(`${name} must be an object`);
  if (Object.keys(item).some((key) => !Object.hasOwn(keys, key))) throw invalidFile(`${name} has a key that is not ${names}`);
  const present = Object.keys(keys).filter((key) => item[key] !== undefined);
  if (present.length !== 1) throw invalidFile(`${name} needs exactly one of ${names}`);
  const [key] = present;
  return { key, mediaKind: keys[key], value: item[key] };
}

// The checks that a publish makes before any read or request: the source, the caption, the polling values, each direct
// URL's https scheme, each file's syntax and kind, and the public base URL that a file needs. A check that needs the file
// system runs later, in resolveMediaFile. The service runs these before it counts the action, so a publish with a bad
// input spends no count (P2-I1). A single-media publish takes one source, url or file. A carousel takes urls or files.
// The media kind of a story: a video, or an image when story.images is on and the name ends in an image extension. The name is
// the file's name, or the last segment of a URL's path. Without the flag every story is a video (spec line 135).
export function storyKindOf({ file, url, storyImages = false }) {
  if (storyImages !== true) return 'video';
  return MEDIA_LIMITS.image.extensions.includes(extensionOf(storyName({ file, url }))) ? 'image' : 'video';
}

// The name that decides a story's kind: the file's name, or the last segment of a URL's path.
function storyName({ file, url }) {
  if (file !== undefined) return String(file).split(/[\\/]/).pop();
  try {
    return new URL(url).pathname.split('/').pop();
  } catch {
    return '';
  }
}

// A direct publishing URL: https (checkUrl), and on a host that is on media.allowedHosts (P6 review M-2). A host that is not on
// the list is refused before any request is made, and the refusal does not repeat the host.
function checkDirectUrl(url, field, allowedHosts) {
  checkUrl(url, field);
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = '';
  }
  if (!allowedHosts.includes(host)) throw invalidFile('the media host is not on media.allowedHosts, so the URL is not probed');
  return url;
}

export function checkPublish({ kind, url, file, urls, files, caption, publicBaseUrl, storyImages = false, allowedHosts = [] } = {}) {
  if (kind === 'carousel') {
    if (url !== undefined || file !== undefined) throw invalidFile('a carousel takes urls or files, not url or file');
    if ((urls === undefined) === (files === undefined)) throw invalidFile('a carousel needs exactly one of urls or files');
    checkCaption(caption);
    checkPolling(POLL_MS, MAX_POLLS);
    const source = files === undefined ? 'urls' : 'files';
    if (source === 'files') requireBase(publicBaseUrl);
    const list = source === 'files' ? files : urls;
    if (!Array.isArray(list) || list.length < MIN_CAROUSEL_ITEMS || list.length > MAX_CAROUSEL_ITEMS) {
      throw invalidFile(`items must be a list of ${MIN_CAROUSEL_ITEMS} to ${MAX_CAROUSEL_ITEMS} media`);
    }
    list.forEach((item, index) => {
      const child = parseCarouselItem(item, index, source);
      if (source === 'urls') checkDirectUrl(child.value, `items[${index}].${child.key}`, allowedHosts);
      else parseMediaPath(child.value, child.mediaKind);
    });
    return;
  }
  if (urls !== undefined || files !== undefined) throw invalidFile('urls and files are for a carousel only');
  if ((url === undefined) === (file === undefined)) throw invalidFile('exactly one of url or file is needed');
  if (kind === 'image') {
    checkSource({ url, file, publicBaseUrl, allowedHosts, field: 'imageUrl', mediaKind: 'image' });
    checkCaption(caption);
    return;
  }
  if (kind === 'reel') {
    checkSource({ url, file, publicBaseUrl, allowedHosts, field: 'videoUrl', mediaKind: 'video' });
    checkCaption(caption);
    checkPolling(POLL_MS, MAX_POLLS);
    return;
  }
  if (kind === 'story') {
    const storyKind = storyKindOf({ file, url, storyImages });
    // An image-looking story is refused by name while story.images is off, and the refusal says why (P6 review M-8).
    if (storyKind === 'video' && MEDIA_LIMITS.image.extensions.includes(extensionOf(storyName({ file, url })))) {
      throw invalidFile('an image story needs story.images to be true; a story is a video (.mp4 or .mov) until then');
    }
    checkSource({ url, file, publicBaseUrl, allowedHosts, field: storyKind === 'image' ? 'imageUrl' : 'videoUrl', mediaKind: storyKind });
    return;
  }
  throw invalidFile('kind must be image, reel, carousel or story');
}

// One source of a single-media publish: a direct URL, checked as https, or a file, checked as a path of its kind.
function checkSource({ url, file, publicBaseUrl, allowedHosts, field, mediaKind }) {
  if (file === undefined) {
    checkDirectUrl(url, field, allowedHosts);
    return;
  }
  requireBase(publicBaseUrl);
  parseMediaPath(file, mediaKind);
}

export async function publishImage(client, options) {
  const { igUserId, imageUrl, caption } = optionsOf(options, 'publishImage');
  checkId(igUserId, 'igUserId');
  checkUrl(imageUrl, 'imageUrl');
  checkCaption(caption);
  const container = await client.post(`${igUserId}/media`, { form: { image_url: imageUrl, caption } });
  return publishContainer(client, igUserId, responseId(container.data, 'media container'));
}

export async function publishReel(client, options) {
  const { igUserId, videoUrl, caption, sleep = defaultSleep, pollMs = POLL_MS, maxPolls = MAX_POLLS } = optionsOf(
    options,
    'publishReel',
  );
  checkId(igUserId, 'igUserId');
  checkUrl(videoUrl, 'videoUrl');
  checkCaption(caption);
  checkPolling(pollMs, maxPolls);
  const container = await client.post(`${igUserId}/media`, {
    form: { media_type: 'REELS', video_url: videoUrl, caption },
  });
  const containerId = responseId(container.data, 'media container');
  await waitUntilFinished(client, containerId, { sleep, pollMs, maxPolls });
  return publishContainer(client, igUserId, containerId);
}

// One carousel child of publishCarousel: an item with exactly one of imageUrl or videoUrl, checked, and the form field it
// becomes. A child made from files is turned into a URL by the service before it gets here.
function checkChild(item, index) {
  const { key, value } = parseCarouselItem(item, index, 'urls');
  const url = checkUrl(value, `items[${index}].${key}`);
  return key === 'imageUrl' ? { image_url: url } : { video_url: url };
}

// A carousel of 2 to 10 items: one child container per item, then the parent with their ids, then media_publish. Every
// child is polled to FINISHED before the next step, so the parent never references a child that did not finish.
export async function publishCarousel(client, options) {
  const { igUserId, items, caption, sleep = defaultSleep, pollMs = POLL_MS, maxPolls = MAX_POLLS } = optionsOf(
    options,
    'publishCarousel',
  );
  checkId(igUserId, 'igUserId');
  checkCaption(caption);
  checkPolling(pollMs, maxPolls);
  if (!Array.isArray(items) || items.length < MIN_CAROUSEL_ITEMS || items.length > MAX_CAROUSEL_ITEMS) {
    throw new IgError('VALIDATION', `items must be a list of ${MIN_CAROUSEL_ITEMS} to ${MAX_CAROUSEL_ITEMS} media`);
  }
  // Every item is checked before the first request, so a bad item never leaves a half-built carousel behind.
  const children = Array.from(items, (item, index) => checkChild(item, index));
  const childIds = [];
  for (const fields of children) {
    const created = await client.post(`${igUserId}/media`, { form: { is_carousel_item: true, ...fields } });
    const childId = responseId(created.data, 'carousel item');
    await waitUntilFinished(client, childId, { sleep, pollMs, maxPolls });
    childIds.push(childId);
  }
  const parent = await client.post(`${igUserId}/media`, {
    form: { media_type: 'CAROUSEL', children: childIds.join(','), caption },
  });
  return publishContainer(client, igUserId, responseId(parent.data, 'carousel container'));
}

// A story, video or image: exactly one of videoUrl or imageUrl. Both use the STORIES container; an image story is posted only
// when story.images is on (its path is not confirmed by the spike yet, spec line 135). A feed image is not a story, so the
// publishImage path is never used for a story.
export async function publishStory(client, options) {
  const { igUserId, videoUrl, imageUrl, sleep = defaultSleep } = optionsOf(options, 'publishStory');
  checkId(igUserId, 'igUserId');
  if ((videoUrl === undefined) === (imageUrl === undefined)) {
    throw new IgError('VALIDATION', 'a story needs exactly one of videoUrl or imageUrl');
  }
  const source = videoUrl === undefined ? { image_url: checkUrl(imageUrl, 'imageUrl') } : { video_url: checkUrl(videoUrl, 'videoUrl') };
  const container = await client.post(`${igUserId}/media`, { form: { media_type: 'STORIES', ...source } });
  const containerId = responseId(container.data, 'story container');
  await waitUntilFinished(client, containerId, { sleep, pollMs: POLL_MS, maxPolls: MAX_POLLS });
  return publishContainer(client, igUserId, containerId);
}

// Deletes one media object with DELETE, as the plan's interface names. The plan leaves the method open (DELETE or POST),
// and the live phase confirms it. This is Facebook Login only, and the service checks the route. A deletion is reported
// only when Graph answers { success: true }. An empty 2xx body is API_ERROR, the same rule as every other write, so an
// unconfirmed deletion is an unknown outcome and never a success.
export async function mediaDelete(client, options) {
  const { mediaId } = optionsOf(options, 'mediaDelete');
  checkId(mediaId, 'mediaId');
  const { data } = await client.del(mediaId);
  responseConfirmed(data, 'media deletion');
  return { id: mediaId, deleted: true };
}

// The media that mentions the owner, looked up by the mentioning media id.
export async function mentionedMedia(client, options) {
  const { igUserId, mediaId } = optionsOf(options, 'mentionedMedia');
  checkId(igUserId, 'igUserId');
  checkId(mediaId, 'mediaId');
  const { data } = await client.get(`${igUserId}/mentioned_media`, { media_id: mediaId, fields: MEDIA_FIELDS });
  return normaliseMedia(data);
}
