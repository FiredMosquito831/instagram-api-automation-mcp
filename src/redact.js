// Removes secrets from values before they reach a log, an audit line, an error or a tool result.
// Keys that look like secrets have their values replaced. Credential-like text inside strings is masked:
// key=value, key: value and key%3Dvalue pairs, quoted values, Bearer and Authorization credentials, and JSON members
// with secret-like names. A value registered with registerSecret is masked wherever it appears, in strings and in keys.

// errors.js imports redact from this module, and this module imports IgError from errors.js. Neither module
// calls the other while it is loading, so the cycle is safe.
import { IgError } from './errors.js';

// Words that mark a secret. A key counts when any part of it is one of these, so access_token and owner_token
// both match.
const SECRET_WORDS =
  'token|secret|password|passwd|api_key|apikey|authorization|sessionid|session_id|cookie|x-api-key';
// Object keys that mark a secret.
const SECRET_KEY = new RegExp(SECRET_WORDS, 'i');
// Asserts that the run of word characters ahead contains a secret word. A key is then matched as the whole run, so
// a key of any length is found, and the search takes time in proportion to the length of the run.
const SECRET_RUN = String.raw`(?=[\w.-]*(?:${SECRET_WORDS}))`;

const MARKER = '[redacted]';
// A registered secret must be at least this long, so that masking it cannot corrupt ordinary words.
const MIN_SECRET_LENGTH = 8;
// Exact values to mask wherever they appear, and their encodeURIComponent forms.
const registered = new Set();

// The lookaheads stop a match at a value that is already masked, so redacting a redacted string changes nothing.
// A Bearer credential. It is masked only when it is a token-shaped run (review M-1): at least 20 token characters, with a digit,
// a lower-case letter and an upper-case letter. So the word bearer in ordinary prose is not masked. An Authorization header is
// masked whatever its value, by AUTHORIZATION below. The case of the letters matters here, so this pattern has no i flag.
const BEARER =
  /(?<![A-Za-z])(?:[Bb]earer|BEARER)\s+(?!\[redacted\])(?=[A-Za-z0-9._~+\/=-]*\d)(?=[A-Za-z0-9._~+\/=-]*[a-z])(?=[A-Za-z0-9._~+\/=-]*[A-Z])[A-Za-z0-9._~+\/=-]{20,}(?![A-Za-z0-9._~+\/=-])/g;
// The credential in an Authorization header, after an optional scheme word such as Basic or Token. The scheme
// word is kept, so the header stays readable.
const AUTHORIZATION =
  /(\bauthorization\s*[:=]\s*)(?:([a-z][\w.-]*)\s+)?(?!\[redacted\])(?!(?:bearer|basic)\s)([^\s"'&,;<>)\]}]+)/gi;
// A secret key, then =, : or %3D, then its value, as in a URL query, a form body or a header line. The key is the
// whole run of word characters, and the lookbehind starts a match at the start of that run. Only secret keys match, so
// other text is never consumed. The value is one of the following, and the quotes of a quoted value are kept.
// - A double-quoted value ends at its first unescaped quote. A quote directly after an escaped quote continues the
//   value when a word character follows it and that word is neither a JSON key nor followed by a separator. So an
//   escaped member inside a quoted value is masked whole, and a later key=value pair gets its own match.
// - A single-quoted value ends at its closing quote, or at the end of the text when it has none.
// - An unquoted value does not start with an escaped quote, and it stops before a backslash that opens an escaped member
//   such as \"name\":. That member is left to ESCAPED_JSON_MEMBER, which masks it only when its name is secret-named.
const KEY_VALUE = new RegExp(
  String.raw`(?<![\w.-])${SECRET_RUN}([\w.-]+)(\s*(?:[:=]|%3D)\s*)(?:"(?:[^"\\]|\\[\s\S]|(?<=\\")"(?![\w.-]*\s*(?:[:=]|%3D)|[\w.-]*"\s*:)(?=\w))*\\?(?:"|$)|"(?:[^"\\]|\\[\s\S])*\\?(?:"|$)|'(?:[^'\\]|\\[\s\S])*\\?(?:'|$)|(?!\[redacted\])(?!(?:bearer|basic)\s)(?!\\")(?:[^\s&"'<>,;)\]}\\]|\\(?!"[\w.-]+\\"\s*:))+)`,
  'gi',
);
// A secret member of a JSON object, such as "access_token": "abc". The closing quote is not consumed, so it can open the next
// member. A value that holds an escaped quote closes only at a quote that is not followed by a word character.
const JSON_MEMBER = new RegExp(
  String.raw`"${SECRET_RUN}([\w.-]+)"(\s*:\s*)"(?:(?:[^"\\]|\\(?!"))*(?=")|(?:[^"\\]|\\.)*(?="(?!\w)))`,
  'gi',
);
// The same kind of member when the JSON is itself inside a string, so its quotes are escaped. The value runs up to
// the quote that closes the string, a quote followed by } , ] or the end of the text, so nested escapes are covered.
// The closing check runs only at the start of a run of backslashes, so a long run is scanned once.
const ESCAPED_JSON_MEMBER = new RegExp(
  String.raw`\\"${SECRET_RUN}([\w.-]+)\\"(\s*:\s*)\\"[\s\S]*?(?:(?<!\\)(?=\\*"\s*(?:[},\]]|$))|$)`,
  'gi',
);
// A secret-named member that follows a secret key and a separator, as in sessionid:"password":"value \"}. Its value holds an
// escaped quote, so the key and the value are both masked here, before KEY_VALUE can read the member key as a value. The
// value runs over a quote that is followed by a word character unless that quote starts a JSON key, and it ends at a quote
// that is not followed by a word character, at a JSON key, or at the end of the text. The closing quote is kept in the text,
// unchanged.
const KEYED_MEMBER_AFTER_SECRET = new RegExp(
  String.raw`(?<![\w.-])(${SECRET_RUN}[\w.-]+)(\s*(?:[:=]|%3D)\s*)"${SECRET_RUN}[\w.-]+"(\s*:\s*)"(?=(?:[^"\\]|\\[\s\S])*?\\")(?:[^"\\]|\\[\s\S]|"(?=\w)(?![\w.-]*"\s*:))*(?:(")(?!\w)|(?="[\w.-]*"\s*:)|$)`,
  'gi',
);
// A double-quoted secret value that holds an escaped secret member, as in cookie="\"token\":\"a "value" word\"". It runs to
// the end of the escaped string (the close check of ESCAPED_JSON_MEMBER), so an unescaped quote inside it does not end it.
// The closing quote stays in the text.
const QUOTED_ESCAPED_VALUE = new RegExp(
  String.raw`(?<![\w.-])${SECRET_RUN}([\w.-]+)(\s*(?:[:=]|%3D)\s*)"(?=(?:[^"\\]|\\[\s\S])*?\\"${SECRET_RUN}[\w.-]+\\"\s*:)[\s\S]*?(?:(?<!\\)(?=\\*"\s*(?:[},\]]|$))|$)`,
  'gi',
);
// The single-quoted form of QUOTED_ESCAPED_VALUE, as in cookie='\"token\":\"a 'value' word\"'. The masked value gets its own
// closing quote, as KEY_VALUE gives a single-quoted value.
const QUOTED_ESCAPED_SINGLE = new RegExp(
  String.raw`(?<![\w.-])${SECRET_RUN}([\w.-]+)(\s*(?:[:=]|%3D)\s*)'(?=(?:[^'\\]|\\[\s\S])*?\\"${SECRET_RUN}[\w.-]+\\"\s*:)[\s\S]*?(?:(?<!\\)(?=\\*"\s*(?:[},\]]|$))|$)`,
  'gi',
);
// A secret-named JSON member whose value holds an escaped quote and has no closing quote, as in "password":"value \"}. The
// value runs over quotes that are followed by a word character and ends at any other quote, or at the end of the text. Both
// the key and the value are masked, and a closing quote, if there is one, stays in the text.
const JSON_ESCAPED_OPEN = new RegExp(
  String.raw`"${SECRET_RUN}([\w.-]+)"(\s*:\s*)"(?=(?:[^"\\]|\\[\s\S])*?\\")(?:[^"\\]|\\[\s\S]|"(?=\w))*`,
  'gi',
);
// An escaped quote that opens a bare secret value, as in password=\"value\". The separator is =, : or %3D with no space
// before it. An escaped member such as \"name\": is left to ESCAPED_JSON_MEMBER. The value runs to the end of the escaped string.
const BARE_ESCAPED_VALUE = new RegExp(
  String.raw`(?<![\w.-])${SECRET_RUN}([\w.-]+)([:=]|%3D)(?!\\"[\w.-]+\\"\s*:)\\"[\s\S]*?(?:(?<!\\)(?=\\*"\s*(?:[},\]]|$))|$)`,
  'gi',
);

// The first JSON pass masks a secret-named member only when it is well formed. Its value must not hold a nested key and
// separator: a secret-named key, a separator, then a double quote that is not followed by , ] } or the end of the text (a
// double quote followed by one of those closes the member). A plain value, with no escaped quote, closes at its first quote.
// A value that holds an escaped quote closes only at a quote that is not followed by a word character, since such a quote
// may open the next key. Both checks are lookaheads, so a rejected member consumes nothing.
const JSON_MEMBER_FIRST = new RegExp(
  String.raw`"${SECRET_RUN}([\w.-]+)"(\s*:\s*)"(?!(?:[^"\\]|\\.)*?(?<![\w.-])[\w.-]*(?:${SECRET_WORDS})[\w.-]*\s*(?:[:=]|%3D)\s*(?:"(?!\s*[,\]]|\s*}\s*(?:[,\]}]|$)|\s*$)))(?:(?:[^"\\]|\\(?!"))*(?=")|(?:[^"\\]|\\.)*(?="(?!\w)))`,
  'gi',
);

// A token of a known shape, masked wherever it stands alone (O-2). The prefixes are the Instagram tokens IGAA and IGQV and
// the Facebook token EAA, which EAAB begins with. The pattern finds the leftmost candidate, then the whole run of token
// characters after its prefix. A candidate may follow a character that is not a letter or a digit (so an underscore or a
// hyphen counts as a boundary), a backslash escape such as \n, or a percent-encoded control or space such as %0A. The run
// must have at least 20 characters after the prefix and must end at a character that is not a token character (review M-2
// and M-3). The pattern has no lookahead and no nested quantifier, so one pass over the text is linear (review M-R1-1). The mix
// check, a digit, a lower-case letter and an upper-case letter in the run, is made by tokenShaped below. If the leftmost
// candidate fails it, every later candidate in the same run fails too, because each one's run is a suffix of that run, so the
// scan goes on after the run. A prefix glued to a letter or digit inside a longer word is not a candidate (a documented limit).
const TOKEN_SHAPE = /(?:(?<![A-Za-z0-9])|(?<=\\[nrtbf])|(?<=%(?:0[AaDd]|09|20)))(?:IGAA|IGQV|EAA)[A-Za-z0-9_-]{20,}(?![A-Za-z0-9_-])/g;

// Whether a candidate from TOKEN_SHAPE has the shape of a token: its run after the prefix has a digit, a lower-case letter and an
// upper-case letter. The prefix is IGAA or IGQV (four characters) or EAA (three characters).
function tokenShaped(candidate) {
  const run = candidate.slice(candidate.startsWith('EAA') ? 3 : 4);
  return /\d/.test(run) && /[a-z]/.test(run) && /[A-Z]/.test(run);
}

// Masks the secrets in one string. Each pattern needs a secret name, a credential scheme or a registered value,
// so other text is left as it is.
function maskText(text) {
  let out = text;
  // Longer values go first, so that a registered value which contains a shorter one is masked whole.
  for (const secret of [...registered].sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join(MARKER);
  }
  return out
    .replace(BEARER, `Bearer ${MARKER}`)
    .replace(AUTHORIZATION, (match, label, scheme) => `${label}${scheme ? `${scheme} ` : ''}${MARKER}`)
    // The rules up to KEY_VALUE run first, so that KEY_VALUE does not take a member's key as a value, and so that an
    // escaped value is masked before KEY_VALUE cuts it short. The first JSON pass is only for well-formed members.
    .replace(JSON_MEMBER_FIRST, (match, key, separator) => `"${key}"${separator}"${MARKER}`)
    .replace(KEYED_MEMBER_AFTER_SECRET, (match, key, separator, memberSeparator, closeQuote) => `${key}${separator}"${MARKER}"${memberSeparator}"${MARKER}${closeQuote ?? ''}`)
    .replace(QUOTED_ESCAPED_VALUE, (match, key, separator) => `${key}${separator}"${MARKER}`)
    .replace(QUOTED_ESCAPED_SINGLE, (match, key, separator) => `${key}${separator}'${MARKER}'`)
    .replace(BARE_ESCAPED_VALUE, (match, key, separator) => `${key}${separator}\\"${MARKER}`)
    .replace(KEY_VALUE, (match, key, separator) => {
      // A quoted value keeps its quotes, so the masked text is still a value of the same kind.
      const value = match.slice(key.length + separator.length);
      const quote = value.startsWith('"') || value.startsWith("'") ? value[0] : '';
      return `${key}${separator}${quote}${MARKER}${quote}`;
    })
    // Second JSON pass: masks the members that the first pass left open, and the members whose value is left open. It runs
    // before the escaped rule, so that an escaped member inside a plain member is masked with its enclosing member.
    .replace(JSON_MEMBER, (match, key, separator) => `"${key}"${separator}"${MARKER}`)
    .replace(JSON_ESCAPED_OPEN, (match, key, separator) => `"${MARKER}"${separator}"${MARKER}`)
    .replace(ESCAPED_JSON_MEMBER, (match, key, separator) => `\\"${key}\\"${separator}\\"${MARKER}`)
    // The token-shape rule runs last, so it masks only the tokens that no key or quote rule above has masked (O-2).
    .replace(TOKEN_SHAPE, (candidate) => (tokenShaped(candidate) ? MARKER : candidate));
}

function setOwn(target, key, value) {
  // defineProperty keeps a key such as __proto__ as an own property, instead of changing the prototype.
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

// Copies a value with its secrets masked. ancestors holds the objects on the current path, so a cycle
// becomes a marker and the copy can be serialised with JSON.stringify.
function copy(value, ancestors) {
  if (typeof value === 'string') return maskText(value);
  if (value === null || typeof value !== 'object') return value;
  // Binary data is replaced whole, so none of its bytes can reach an output.
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return '[binary]';
  if (value instanceof Date) return new Date(value.getTime());
  if (ancestors.has(value)) return '[circular]';

  ancestors.add(value);
  try {
    if (Array.isArray(value)) return value.map((item) => copy(item, ancestors));
    const out = {};
    if (value instanceof Error) {
      out.name = copy(value.name, ancestors);
      out.message = copy(value.message, ancestors);
      if (typeof value.stack === 'string') out.stack = maskText(value.stack);
    }
    for (const [key, item] of Object.entries(value)) {
      // The key is masked as text, so a registered value or a key=value pair inside a key cannot pass through.
      // The secret-name test uses the raw key, so a secret-named key still masks its value.
      setOwn(out, maskText(key), SECRET_KEY.test(key) ? MARKER : copy(item, ancestors));
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}

// Returns a deep copy of value with its secrets masked. The input is not changed.
export function redact(value) {
  return copy(value, new Set());
}

// Registers an exact value, such as a token loaded from the environment or the keyring. Every output then masks
// it, whether or not a key name sits beside it. Its encodeURIComponent form is masked too.
export function registerSecret(value) {
  if (typeof value !== 'string' || value.length < MIN_SECRET_LENGTH || value.trim() === '') {
    throw new IgError(
      'VALIDATION',
      `a registered secret must be a non-blank string of at least ${MIN_SECRET_LENGTH} characters`,
    );
  }
  // Every form is made before anything is added, so a value that cannot be encoded (a lone surrogate) is refused and is never
  // left in the registry. The forms are the raw value, its URL-encoded form (encodeURIComponent) and its JSON-escaped form
  // (O-2), so a value is masked in a JSON string, in a URL and in plain text.
  let encoded;
  try {
    encoded = encodeURIComponent(value);
  } catch {
    throw new IgError('VALIDATION', 'a registered secret must be text that can be encoded, with no lone surrogate');
  }
  const forms = [...new Set([value, encoded, JSON.stringify(value).slice(1, -1)])];
  // A form inside the marker would be masked inside it, and the text would grow on each pass.
  if (forms.some((form) => MARKER.includes(form))) {
    throw new IgError('VALIDATION', 'a registered secret cannot be part of the redaction marker');
  }
  for (const form of forms) registered.add(form);
}

// Replaces each registered value in the text with the marker. Only exact registered values are replaced, by split and
// join. No pattern is matched, so text with no registered value is returned unchanged.
export function maskRegistered(text) {
  if (typeof text !== 'string') throw new TypeError('maskRegistered needs a string');
  let out = text;
  // Longer values go first, so that a registered value which contains a shorter one is masked whole.
  for (const secret of [...registered].sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join(MARKER);
  }
  return out;
}
