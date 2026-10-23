// The unofficial adapter shape, and the registry that maps a feature to an adapter.
// The project adds no device, fingerprint, proxy or challenge handling. Adapters send their default identity.

import { IgError } from '../errors.js';

/**
 * An unofficial adapter. Every method returns a Promise.
 *
 * @typedef {object} UnofficialAdapter
 * @property {(input: { username: string, password: string, verificationCode?: string }) => Promise<object>} login
 *   Logs in and resolves with the session settings. The caller stores them in the credential store only.
 * @property {(session: object) => Promise<object>} restoreSession
 *   Restores stored session settings and checks them with one read. Resolves with the current settings.
 * @property {(userId: string) => Promise<object>} follow
 * @property {(userId: string) => Promise<object>} unfollow
 * @property {(fields: object) => Promise<object>} profileEdit
 * @property {() => Promise<object>} status
 *   Reports local state, such as whether a session is loaded. It makes no request.
 * @property {() => Promise<void>} close
 */

/**
 * Builds a registry from named adapters and a map from feature to adapter name.
 *
 * @param {{ adapters?: Record<string, UnofficialAdapter>, byFeature?: Record<string, string> }} options
 * @returns {{ forFeature: (feature: string) => UnofficialAdapter }}
 *   forFeature throws NOT_SUPPORTED when the feature is not mapped, or when its adapter is not registered.
 */
export function createAdapterRegistry({ adapters = {}, byFeature = {} } = {}) {
  if (adapters === null || typeof adapters !== 'object' || byFeature === null || typeof byFeature !== 'object') {
    throw new TypeError('adapters and byFeature must be objects');
  }
  return {
    forFeature(feature) {
      const name = typeof feature === 'string' && Object.hasOwn(byFeature, feature) ? byFeature[feature] : undefined;
      if (typeof name !== 'string' || !Object.hasOwn(adapters, name) || !adapters[name]) {
        throw new IgError('NOT_SUPPORTED', `no unofficial adapter is mapped for feature ${String(feature)}`);
      }
      return adapters[name];
    },
  };
}
