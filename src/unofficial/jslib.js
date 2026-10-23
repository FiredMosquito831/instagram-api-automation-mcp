// The JavaScript unofficial library adapter. No JavaScript library is in use, so every call is refused.
// The instagrapi sidecar is the unofficial route. Each method returns a rejected Promise.

import { IgError } from '../errors.js';

const REFUSAL = 'no JavaScript unofficial library is in use; the instagrapi sidecar is the unofficial route';

function refuse() {
  return Promise.reject(new IgError('NOT_SUPPORTED', REFUSAL));
}

/**
 * @returns {import('./adapter.js').UnofficialAdapter}
 */
export function createJsLibAdapter() {
  return {
    login: refuse,
    restoreSession: refuse,
    follow: refuse,
    unfollow: refuse,
    profileEdit: refuse,
    status: refuse,
    close: refuse,
  };
}
