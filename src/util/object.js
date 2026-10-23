// Value checks shared by the modules. isPlainObject is the one rule for a plain object: not null, not an array, and with
// Object.prototype or no prototype. A Date, a Map, a class instance or an array is not one. This is the stricter of the
// copies that existed (src/tools.js); JSON, config and object literals pass exactly as before.

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

// The state needs get, set and save. Anything else is refused.
export function isState(value) {
  if (value === null || typeof value !== 'object') return false;
  return ['get', 'set', 'save'].every((name) => typeof value[name] === 'function');
}
