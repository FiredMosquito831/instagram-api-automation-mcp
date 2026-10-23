// Fakes for the media publishing tests: a file system for media.dir, and the owner's host answering HEAD requests. Nothing
// here touches the disk or the network. A path under MEDIA_DIR is only a name that the fake file system knows about.

import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';

export const MEDIA_DIR = resolve(import.meta.dirname, 'no-such-media-dir');
export const OUTSIDE_DIR = resolve(import.meta.dirname, 'no-such-outside-dir');
export const MIB = 1024 * 1024;
export const inMedia = (...segments) => join(MEDIA_DIR, ...segments);

// A fake file system for media.dir, with every call recorded.
//   files:    path -> size in bytes (a regular file)
//   dirs:     paths of directories
//   links:    path under media.dir -> the real path it resolves to (realpath follows it)
//   contents: path -> bytes (a string or a Buffer); a file without contents reads as zeros of its size
//   identity: path -> { dev, ino, nlink } for stat; a file without one has a unique ino and nlink 1
//   swaps:    path -> what the open handle reports instead: { dev, ino, nlink, size, isFile }, to model a swap between the
//             check and the open
// open returns a handle whose read(buffer, offset, length, position) and close() and stat() work as node:fs/promises does.
export function fakeMediaFs({ files = {}, dirs = [], links = {}, contents = {}, identity = {}, swaps = {} } = {}) {
  const calls = [];
  const missing = () => Object.assign(new Error('no such file'), { code: 'ENOENT' });
  const inos = new Map();
  const inoOf = (path) => {
    if (!inos.has(path)) inos.set(path, 1000 + inos.size);
    return inos.get(path);
  };
  const identityOf = (path) => ({ dev: 1, ino: inoOf(path), nlink: 1, ...(identity[path] ?? {}) });
  return {
    calls,
    async realpath(path) {
      calls.push(['realpath', path]);
      if (path === MEDIA_DIR) return MEDIA_DIR;
      if (Object.hasOwn(links, path)) return links[path];
      if (Object.hasOwn(files, path) || dirs.includes(path)) return path;
      throw missing();
    },
    async stat(path) {
      calls.push(['stat', path]);
      if (dirs.includes(path)) return { isFile: () => false, size: 0, ...identityOf(path) };
      if (!Object.hasOwn(files, path)) throw missing();
      return { isFile: () => true, size: files[path], ...identityOf(path) };
    },
    // A chunked reader, as node:fs/promises open gives: read, stat and close on the handle. The bytes are the contents when
    // given, and zeros otherwise. Zeros are written into the caller's buffer per read, so a large file costs no memory here.
    async open(path, flags) {
      calls.push(['open', path, flags]);
      if (!Object.hasOwn(files, path)) throw missing();
      const bytes = Object.hasOwn(contents, path) ? Buffer.from(contents[path]) : null;
      const size = bytes === null ? files[path] : bytes.length;
      const swap = swaps[path] ?? {};
      const opened = { ...identityOf(path), size, ...swap, isFile: () => swap.isFile ?? true };
      return {
        async read(buffer, offset, length, position) {
          calls.push(['read', path, length]);
          const count = Math.max(0, Math.min(length, size - position));
          if (bytes === null) buffer.fill(0, offset, offset + count);
          else bytes.copy(buffer, offset, position, position + count);
          return { bytesRead: count, buffer };
        },
        async stat() {
          calls.push(['fstat', path]);
          return opened;
        },
        async close() {
          calls.push(['close', path]);
        },
      };
    },
  };
}

// The SHA-256 of bytes, in hex, as the audit line carries it.
export const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

// The owner's host by default: 200, a Content-Type from the extension, and no Content-Length.
export const defaultHead = (url) =>
  new Response(null, { status: 200, headers: { 'content-type': /\.(mp4|mov)$/i.test(url) ? 'video/mp4' : 'image/jpeg' } });

// A fake fetch for HEAD requests. answer(url, init) returns the Response; every request is recorded.
export function fakeHost(answer = defaultHead) {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push({ url, init });
    return answer(url, init);
  };
  return { requests, fetchImpl };
}
