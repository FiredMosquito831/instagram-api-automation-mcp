// Constant-time comparison of two texts. Both are hashed first, so the time taken does not depend on where they differ,
// and their lengths do not matter.

import { createHash, timingSafeEqual } from 'node:crypto';

export function sameText(a, b) {
  const left = createHash('sha256').update(a).digest();
  const right = createHash('sha256').update(b).digest();
  return timingSafeEqual(left, right);
}
