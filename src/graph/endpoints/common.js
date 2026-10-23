// Checks shared by the endpoint modules. A bad input is VALIDATION and is refused before any request. A response that
// lacks the shape an endpoint needs is API_ERROR, so a missing value never passes as a default.

import { IgError } from '../../errors.js';

const ID_PATTERN = /^\d+$/;

// A Graph id is a string of digits. A number is refused, not converted.
export function checkId(value, name) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) {
    throw new IgError('VALIDATION', `${name} must be a Graph id given as a string of digits`);
  }
  return value;
}

// The data of a response must be an object for an endpoint to read it.
export function responseObject(data, what) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new IgError('API_ERROR', `Graph API ${what} response is not an object`);
  }
  return data;
}

// The id that Graph returns for a created container or a published media.
export function responseId(data, what) {
  const id = responseObject(data, what).id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new IgError('API_ERROR', `Graph API ${what} response has no id`);
  }
  return id;
}

// A write that Graph confirms returns { success: true }. Any other body, including an empty one, is API_ERROR, so a
// write that Graph did not confirm is never reported as done.
export function responseConfirmed(data, what) {
  if (data === null || typeof data !== 'object' || Array.isArray(data) || data.success !== true) {
    throw new IgError('API_ERROR', `Graph API did not confirm the ${what}`);
  }
}

// A field that Graph omits is null in the normalised result.
export const orNull = (value) => (value === undefined ? null : value);

// The options argument of an endpoint function. undefined is an empty object, so a required field that is missing is then
// refused by its own check. Any other value that is not a plain object, including null, is VALIDATION, so it is never a
// TypeError from a destructuring of null.
export function optionsOf(value, name) {
  if (value === undefined) return {};
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new IgError('VALIDATION', `${name} takes an options object`);
  }
  return value;
}

// An id made only of dots (".", "..", "...") is a path segment that changes the request, so it is refused locally.
export function isDotsOnly(value) {
  return typeof value === 'string' && /^\.+$/.test(value);
}
