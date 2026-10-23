import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, IgError, busyResult, mapGraphError } from '../src/errors.js';
import { maskRegistered, redact, registerSecret } from '../src/redact.js';

const RATE_LIMIT_CODES = [4, 17, 32, 613, 80002];

test('ERROR_KINDS lists the fifteen kinds from the brief, in order', () => {
  assert.deepStrictEqual(ERROR_KINDS, [
    'CONFIG',
    'VALIDATION',
    'OWNER_MISMATCH',
    'STOPPED',
    'CONFIRMATION_REQUIRED',
    'CAP_EXCEEDED',
    'ROUTE_DISABLED',
    'NOT_SUPPORTED',
    'WINDOW_CLOSED',
    'AUTH_EXPIRED',
    'RATE_LIMITED',
    'ACTION_BLOCKED',
    'CHECKPOINT',
    'API_ERROR',
    'UNOFFICIAL_ADAPTER_ERROR',
  ]);
});

test('code 190 maps to AUTH_EXPIRED', () => {
  assert.equal(
    mapGraphError({ status: 400, body: { error: { code: 190, message: 'expired' } } }).kind,
    'AUTH_EXPIRED',
  );
});

test('codes 4, 17, 32, 613, 80002 and status 429 map to RATE_LIMITED', () => {
  for (const code of RATE_LIMIT_CODES) {
    const err = mapGraphError({ status: 400, body: { error: { code, message: 'limit' } } });
    assert.equal(err.kind, 'RATE_LIMITED', `code ${code}`);
  }
  assert.equal(
    mapGraphError({ status: 429, body: { error: { code: 1, message: 'slow down' } } }).kind,
    'RATE_LIMITED',
  );
  assert.equal(mapGraphError({ status: 429 }).kind, 'RATE_LIMITED');
});

test('code 368 maps to ACTION_BLOCKED', () => {
  assert.equal(
    mapGraphError({ status: 400, body: { error: { code: 368, message: 'blocked' } } }).kind,
    'ACTION_BLOCKED',
  );
});

test('unknown errors map to API_ERROR', () => {
  assert.equal(
    mapGraphError({ status: 400, body: { error: { code: 100, message: 'Unsupported get request.' } } })
      .kind,
    'API_ERROR',
  );
  assert.equal(mapGraphError({ status: 500, body: 'not json' }).kind, 'API_ERROR');
});

test('feedback required and checkpoint messages map to their stop kinds', () => {
  assert.equal(
    mapGraphError({ status: 400, body: { error: { code: 1, message: 'Feedback required.' } } }).kind,
    'ACTION_BLOCKED',
  );
  assert.equal(
    mapGraphError({ status: 400, body: { error: { code: 1, message: 'Checkpoint required.' } } }).kind,
    'CHECKPOINT',
  );
});

test('challenge_required maps to CHECKPOINT', () => {
  assert.equal(
    mapGraphError({ status: 400, body: { error: { code: 1, message: 'challenge_required' } } }).kind,
    'CHECKPOINT',
  );
});

test('two-factor required maps to CHECKPOINT', () => {
  assert.equal(
    mapGraphError({ status: 400, body: { error: { code: 1, message: 'two-factor required' } } }).kind,
    'CHECKPOINT',
  );
});

test('a numeric string code is read as the same code, and error 190 wins over status 429', () => {
  assert.equal(
    mapGraphError({ status: 400, body: { error: { code: '190', message: 'x' } } }).kind,
    'AUTH_EXPIRED',
  );
  assert.equal(
    mapGraphError({ status: 429, body: { error: { code: 190, message: 'x' } } }).kind,
    'AUTH_EXPIRED',
  );
});

test('a code with surrounding spaces, such as " 190", gives AUTH_EXPIRED', () => {
  assert.equal(
    mapGraphError({ status: 400, body: { error: { code: ' 190', message: 'x' } } }).kind,
    'AUTH_EXPIRED',
  );
});

test('a status given as a string, such as "429", gives RATE_LIMITED', () => {
  assert.equal(mapGraphError({ status: '429' }).kind, 'RATE_LIMITED');
});

test('the message of a mapped error is redacted, and the details hold status, codes and the signal only', () => {
  const err = mapGraphError({
    status: 400,
    body: { error: { code: 100, message: 'bad access_token=abc123', error_subcode: 2207006 } },
  });
  assert.equal(err.message.includes('abc123'), false);
  assert.deepStrictEqual(err.details, { status: 400, code: 100, subcode: 2207006, signal: 'none' });
});

test('IgError carries kind, details and a redacted message', () => {
  const err = new IgError('VALIDATION', 'bad access_token=abc123', {
    field: 'text',
    access_token: 'abc123',
  });
  assert.ok(err instanceof Error);
  assert.equal(err.name, 'IgError');
  assert.equal(err.kind, 'VALIDATION');
  assert.equal(err.message, 'bad access_token=[redacted]');
  assert.deepStrictEqual(err.details, { field: 'text', access_token: '[redacted]' });
});

test('IgError rejects a kind that is not in ERROR_KINDS', () => {
  assert.throws(() => new IgError('NOT_A_KIND', 'x'), TypeError);
});

test('IgError turns a non-string message into text, and uses the kind when there is no message', () => {
  assert.equal(new IgError('API_ERROR', 42).message, '42');
  assert.equal(new IgError('API_ERROR').message, 'API_ERROR');
  assert.equal(new IgError('API_ERROR', null).message, 'API_ERROR');
});

test('IgError stores details: null as an empty object', () => {
  assert.deepStrictEqual(new IgError('CONFIG', 'x', null).details, {});
});

test('busyResult carries busy true and retryAfterMs', () => {
  assert.deepStrictEqual(busyResult({ reason: 'spacing', retryAfterMs: 1000 }), {
    busy: true,
    reason: 'spacing',
    retryAfterMs: 1000,
  });
});

test('busyResult rounds a fractional retryAfterMs up and takes a negative one as 0', () => {
  assert.equal(busyResult({ reason: 'x', retryAfterMs: 1.5 }).retryAfterMs, 2);
  assert.equal(busyResult({ reason: 'spacing', retryAfterMs: 1500.5 }).retryAfterMs, 1501);
  assert.equal(busyResult({ reason: 'x', retryAfterMs: -1 }).retryAfterMs, 0);
});

test('busyResult rejects an empty reason, and a retryAfterMs that is not a finite number', () => {
  assert.throws(() => busyResult({ reason: '', retryAfterMs: 1 }), TypeError);
  assert.throws(() => busyResult({ reason: 'x', retryAfterMs: NaN }), TypeError);
  assert.throws(() => busyResult({ reason: 'x', retryAfterMs: Infinity }), TypeError);
  assert.throws(() => busyResult({ reason: 'x', retryAfterMs: '5' }), TypeError);
  assert.throws(() => busyResult({ reason: 'x' }), TypeError);
});

test('redact removes tokens from keys and strings', () => {
  const out = redact({ access_token: 'abc', note: 'x access_token=abc&y=1' });
  assert.equal(JSON.stringify(out).includes('abc'), false);
  assert.deepStrictEqual(out, { access_token: '[redacted]', note: 'x access_token=[redacted]&y=1' });
});

test('redact returns a deep copy and leaves the input unchanged', () => {
  const input = { owner: { id: '1' }, items: [{ note: 'keep' }] };
  const out = redact(input);
  out.owner.id = '2';
  out.items[0].note = 'changed';
  assert.deepStrictEqual(input, { owner: { id: '1' }, items: [{ note: 'keep' }] });
});

test('redact masks Bearer values and string JSON members, and keeps other members', () => {
  assert.equal(redact('Authorization: Bearer EAAB123.xyz'), 'Authorization: Bearer [redacted]');
  assert.equal(
    redact('{"access_token": "EAAB123", "ok": "yes"}'),
    '{"access_token": "[redacted]", "ok": "yes"}',
  );
});

test('redact keeps ordinary values and handles cycles, errors and binary data', () => {
  const node = { name: 'ok', count: 2 };
  node.self = node;
  assert.deepStrictEqual(redact(node), { name: 'ok', count: 2, self: '[circular]' });
  assert.equal(
    redact(new Error('failed with access_token=abc')).message,
    'failed with access_token=[redacted]',
  );
  assert.deepStrictEqual(redact({ data: Buffer.from('access_token=abc') }), { data: '[binary]' });
});

test('redaction is idempotent: redacting a redacted string changes nothing', () => {
  const samples = [
    'x access_token=abc&y=1',
    'Authorization: Bearer EAAB123.xyz',
    'Authorization: Basic dXNlcjpwYXNzd29yZA==',
    '{"access_token": "EAAB123"}',
    '{\\"access_token\\":\\"EAAB123\\"}',
    'access_token="EAAB123456"',
    "token: 'EAAB123456'",
    'Authorization: "Basic dXNlcjpwYXNz"',
    "token%3D'\\api_key: \\",
  ];
  for (const sample of samples) {
    const once = redact(sample);
    assert.equal(redact(once), once, sample);
  }
});

test('owner token: <value> is masked when the separator is a colon', () => {
  assert.equal(redact('owner token: EAAB-colon-value'), 'owner token: [redacted]');
});

test('a percent-encoded equals sign, as in access_token%3D<value>, is masked', () => {
  assert.equal(
    redact('https://graph.example/me?access_token%3DEAAB-encoded-value&fields=id'),
    'https://graph.example/me?access_token%3D[redacted]&fields=id',
  );
});

test('Authorization: Basic <value> keeps the scheme and masks the credential', () => {
  assert.equal(redact('Authorization: Basic dXNlcjpwYXNzd29yZA=='), 'Authorization: Basic [redacted]');
});

test('a string holding escaped JSON has its secret member masked', () => {
  assert.equal(
    redact('{\\"access_token\\":\\"EAAB-escaped-value\\"}'),
    '{\\"access_token\\":\\"[redacted]\\"}',
  );
});

test('api_key and passwd are secret keys, and code is not', () => {
  assert.deepStrictEqual(redact({ api_key: 'k-value-1', passwd: 'p-value-1', code: 190 }), {
    api_key: '[redacted]',
    passwd: '[redacted]',
    code: 190,
  });
  assert.equal(redact('api_key=k-value-2&x=1'), 'api_key=[redacted]&x=1');
});

test('a registered secret is masked as a bare value in an error message', () => {
  registerSecret('EAAB-bare-value-1');
  assert.equal(
    mapGraphError({
      status: 400,
      body: { error: { code: 100, message: 'token EAAB-bare-value-1 is invalid' } },
    }).message,
    'token [redacted] is invalid',
  );
});

test('a registered secret after a space, as in token <value>, is masked', () => {
  registerSecret('EAAB-bare-value-2');
  assert.equal(redact('token EAAB-bare-value-2'), 'token [redacted]');
});

test('registerSecret refuses a short, blank or non-string value, or one inside the marker, with VALIDATION', () => {
  const refused = (err) => err instanceof IgError && err.kind === 'VALIDATION';
  for (const value of ['short', 'abcdefg', '        ', 42, 'redacted']) {
    assert.throws(() => registerSecret(value), refused, String(value));
  }
  assert.doesNotThrow(() => registerSecret('eightchr'));
});

test('the registry masks the encodeURIComponent form of a registered secret', () => {
  registerSecret('EAAB/encoded+value');
  assert.equal(redact('seen EAAB%2Fencoded%2Bvalue here'), 'seen [redacted] here');
  assert.equal(redact('seen EAAB/encoded+value here'), 'seen [redacted] here');
});

test('a nested escaped quote inside an escaped JSON secret is masked to the end of the value', () => {
  assert.equal(
    redact('{\\"access_token\\":\\"ab\\\\\\"cd\\"}'),
    '{\\"access_token\\":\\"[redacted]\\"}',
  );
});

test('a secret after a key that is not secret is still masked', () => {
  assert.equal(redact('x=https://g?access_token=abc'), 'x=https://g?access_token=[redacted]');
  assert.equal(
    redact('{"url": "https://g?access_token=abc"}'),
    '{"url": "https://g?access_token=[redacted]"}',
  );
});

test('a registered value used as an object key is masked', () => {
  registerSecret('Kx8mPq4Rs1');
  assert.deepStrictEqual(redact({ Kx8mPq4Rs1: 'v' }), { '[redacted]': 'v' });
  assert.deepStrictEqual(redact({ 'x Kx8mPq4Rs1': 1 }), { 'x [redacted]': 1 });
});

test('a key that holds access_token=<value> text is masked', () => {
  assert.deepStrictEqual(redact({ 'https://g?access_token=Qz9xWv7Lm2': '[redacted]' }), {
    'https://g?access_token=[redacted]': '[redacted]',
  });
});

test('a secret-named key still masks its value, whatever the key text holds', () => {
  assert.deepStrictEqual(redact({ 'owner access_token': 'plain-value', ok: 'fine' }), {
    'owner access_token': '[redacted]',
    ok: 'fine',
  });
});

test('a 160,000-character run of word characters or backslashes is redacted in under 500 ms', () => {
  const words = 'token'.repeat(32000);
  const wordStart = performance.now();
  assert.equal(redact(words), words);
  const wordMs = performance.now() - wordStart;
  assert.ok(wordMs < 500, `word run took ${wordMs.toFixed(1)} ms`);

  const slashes = '\\"access_token\\":\\"' + '\\'.repeat(160000);
  const slashStart = performance.now();
  assert.ok(redact(slashes).includes('[redacted]'));
  const slashMs = performance.now() - slashStart;
  assert.ok(slashMs < 500, `backslash run took ${slashMs.toFixed(1)} ms`);
});

test('a double-quoted value keeps its quotes and masks the value', () => {
  assert.equal(redact('access_token="EAAB123456"'), 'access_token="[redacted]"');
});

test('a single-quoted value keeps its quotes and masks the value', () => {
  assert.equal(redact("token: 'EAAB123456'"), "token: '[redacted]'");
});

test('a quoted Authorization header value is masked and keeps its quotes', () => {
  assert.equal(redact('Authorization: "Basic dXNlcjpwYXNz"'), 'Authorization: "[redacted]"');
});

test('a secret key in an object literal masks its quoted value', () => {
  assert.equal(redact('{access_token: "EAAB123456"}'), '{access_token: "[redacted]"}');
});

test('apikey, session_id and x-api-key are secret keys, and code is not', () => {
  assert.deepStrictEqual(redact({ apikey: 'k1', session_id: 'k2', 'x-api-key': 'k3', code: 190 }), {
    apikey: '[redacted]',
    session_id: '[redacted]',
    'x-api-key': '[redacted]',
    code: 190,
  });
  assert.equal(redact('session_id=abc&apikey=def'), 'session_id=[redacted]&apikey=[redacted]');
});

test('a JSON member after an outer token key masks its value, not the value of the outer key', () => {
  const out = redact('token:"token":"EAAB123456"');
  assert.equal(out.includes('EAAB123456'), false);
  assert.ok(out.includes('[redacted]'));
});

test('an escaped JSON member after apikey= masks the value after the key', () => {
  const out = redact('apikey=\\"api_key\\":\\"EAAB123456');
  assert.equal(out.includes('EAAB123456'), false);
  assert.ok(out.includes('[redacted]'));
});

test('an escaped JSON member inside a double-quoted cookie value masks its value', () => {
  const out = redact('cookie="\\"token\\":\\""EAAB123456');
  assert.equal(out.includes('EAAB123456'), false);
  assert.ok(out.includes('[redacted]'));
});

test('ordinary sentences that mention token and key are not masked', () => {
  const sentences = [
    'The token is valid for 60 minutes.',
    'Press any key to continue.',
    'Our api key rotation is due next week.',
  ];
  for (const sentence of sentences) assert.equal(redact(sentence), sentence);
});

test('a nested key=value pair inside a JSON member value is masked, whatever quote follows it', () => {
  const texts = [
    `x:"token":"session_id="EAAB123456 end`,
    `"token":"apikey="EAAB123456 end`,
    `"token":"session_id%3D"EAAB123456"`,
    `"token":"session_id=" EAAB123456`,
  ];
  for (const text of texts) {
    const out = redact(text);
    assert.equal(out.includes('EAAB123456'), false, text);
    assert.ok(out.includes('[redacted]'), text);
  }
});

test('a member whose value ends in a key and separator does not expose that key', () => {
  assert.equal(redact(`"token":"abc_token=" end`).includes('abc_token'), false);
});

test('a single-quoted nested pair inside a double-quoted JSON value does not hide the members after it', () => {
  const out = redact(`{"cookie": "api_key='EAAB123456 "token":"EAAB123456" end`);
  assert.equal(out.includes('EAAB123456'), false);
  assert.ok(out.includes('[redacted]'));
});

test('an empty JSON value does not take the opening quote of the next member', () => {
  const out = redact(`apikey="owner_token":""apikey":"EAAB123456&\\"apikey\\":\\"EAAB123456\\"" x`);
  assert.equal(out.includes('EAAB123456'), false);
  assert.ok(out.includes('[redacted]'));
});

test('an escaped member inside a plain member is masked with its enclosing member', () => {
  const out = redact(`[api_key="the end,"sessionid":"EAAB123456,\\"cookie\\":\\"EAAB123456,token="EAAB123456"" end`);
  assert.equal(out.includes('EAAB123456'), false);
  assert.ok(out.includes('[redacted]'));
});

test('a well-formed member whose value ends in a key and separator keeps the members after it', () => {
  assert.equal(redact(`{"access_token": "xyz_token=", "x": "y"}`), `{"access_token": "[redacted]", "x": "y"}`);
});

test('redaction of the nested-quote samples is idempotent', () => {
  const samples = [
    `x:"token":"session_id="EAAB123456 end`,
    `"token":"session_id%3D"EAAB123456"`,
    `"cookie": "api_key='EAAB123456 "token":"EAAB123456" end`,
    `apikey="owner_token":""apikey":"EAAB123456&\\"apikey\\":\\"EAAB123456\\"" x`,
    `[api_key="the end,"sessionid":"EAAB123456,\\"cookie\\":\\"EAAB123456,token="EAAB123456"" end`,
    `"authorization": "x&y=1 and "apikey":"EAAB123456 and \\"cookie\\":\\"EAAB123456\\" and password="EAAB123456"","`,
  ];
  for (const sample of samples) {
    const once = redact(sample);
    assert.equal(redact(once), once, sample);
  }
});

test('a key=value pair after an escaped quote inside a quoted value keeps its own match', () => {
  const out = redact(`session_id:"session_id: \\""api_key = "EAAB123456\\"}`);
  assert.equal(out.includes('EAAB123456'), false);
  assert.ok(out.includes('api_key = "[redacted]"'), out);
});

test('a closing quote followed by a word character does not end a JSON member early', () => {
  const out = redact(`apikey:"cookie":"\\"apikey\\":\\""EAAB123456`);
  assert.equal(out.includes('EAAB123456'), false);
  assert.ok(out.includes('[redacted]'));
});

// Round 5: members that hold quoted or escaped secrets, and ordinary text whose output must not change.
test('a secret member followed by a word character, as in token:"token":"<value>"ok, is masked', () => {
  assert.equal(redact('token:"token":"EAAB123456"ok'), 'token:"[redacted]":"[redacted]"ok');
});

test('a secret member whose value holds a quoted word masks the value and keeps the text after it', () => {
  assert.equal(
    redact('apikey="password":"EAAB123456 "quoted" word"; name: demo'),
    'apikey="[redacted]":"[redacted]"quoted" word"; name: demo',
  );
});

test('an escaped member whose value holds a quoted secret is masked to the end of the escaped string', () => {
  assert.equal(redact('cookie="\\"token\\":\\"a "EAAB123456" word"'), 'cookie="[redacted]"');
  assert.equal(redact('cookie="\\"access_token\\":\\"a "EAAB123456" word\\" "page": 2}'), 'cookie="[redacted]"');
});

test('an escaped secret member after key=value text is masked, and so is an escaped secret value', () => {
  assert.equal(
    redact('apikey=sessionid=a=b\\"session_id\\":\\"EAAB123456\\" end'),
    'apikey=[redacted]\\"session_id\\":\\"[redacted]',
  );
  assert.equal(redact('password=\\"EAAB123456\\"'), 'password=\\"[redacted]\\"');
});

test('a secret key whose quoted value is a secret member masks that member and its value', () => {
  assert.equal(
    redact('{sessionid="token":"EAAB123456 a=b api_key=\'EAAB123456\'"]'),
    '{sessionid="[redacted]":"[redacted]"]',
  );
});

test('a secret member with an escaped quote and no closing quote is masked with its key', () => {
  assert.equal(
    redact('x:sessionid:"password":"EAAB123456 sessionid%3DEAAB123456\\"}'),
    'x:sessionid:"[redacted]":"[redacted]',
  );
});

test('a single-quoted secret value that holds an escaped secret member is masked to the end of the escaped string', () => {
  assert.equal(
    redact(`'token=a=b and apikey='EAAB123456 and \\"session_id\\":\\"EAAB123456\\" and password='EAAB123456'"]`),
    `'token=[redacted] and apikey='[redacted]'"]`,
  );
});

// Over-masking, by design: the quoted value after a secret key is masked even when it is ordinary text. This is the fail-closed
// trade-off listed in the README known limits, and the test pins it so that a change to it is deliberate.
test('a secret key masks the quoted value after it, even when that value is ordinary text (fail-closed)', () => {
  assert.equal(
    redact('apikey="access_token": "Press any key", "note": "ordinary text"'),
    'apikey="[redacted]": "[redacted]", "note": "ordinary text"',
  );
});

// A non-secret escaped member ends the secret value at its own quote, so the ordinary text after it is kept.
test('a non-secret escaped member ends a secret value at its quote, and the text after it is kept', () => {
  assert.equal(
    redact('cookie="\\"status\\":\\"value\\"&"note": "ordinary text" x'),
    'cookie="[redacted]"note": "ordinary text" x',
  );
  assert.equal(redact('session_id=value\\"'), 'session_id=[redacted]"');
});

test('redaction of the round 5 samples is idempotent', () => {
  const samples = [
    'token:"token":"EAAB123456"ok',
    'apikey="password":"EAAB123456 "quoted" word"; name: demo',
    'cookie="\\"token\\":\\"a "EAAB123456" word"',
    'apikey=sessionid=a=b\\"session_id\\":\\"EAAB123456\\" end',
    '{sessionid="token":"EAAB123456 a=b api_key=\'EAAB123456\'"]',
    'x:sessionid:"password":"EAAB123456 sessionid%3DEAAB123456\\"}',
    'x:"secret": "abc sessionid=\\"EAAB123456\\" cookie=\'EAAB123456""',
    'msg cookie="cookie":"EAAB123456 and secret=EAAB123456\\"}',
    'x:api_key%3D"password":"EAAB123456 sessionid=\'EAAB123456\' password=EAAB123456\\"',
    `'token=a=b and apikey='EAAB123456 and \\"session_id\\":\\"EAAB123456\\" and password='EAAB123456'"]`,
  ];
  for (const sample of samples) {
    const once = redact(sample);
    assert.equal(redact(once), once, sample);
  }
});

test('a secret member whose value holds an escaped member, with no closing quote, leaves no secret and is stable', () => {
  const text = '{"password":"\\"token\\":\\"EAAB123456,"name":"demo"}';
  const once = redact(text);
  assert.equal(once.includes('EAAB123456'), false);
  assert.equal(redact(once), once);
});

// F-16 (Task 2 M-4). A stop phrase in Graph's user-facing fields maps to its stop kind, as a phrase in the message does. The field
// names are confirmed in the live phase.
test("a stop phrase in Graph's user-facing error fields maps to its stop kind (F-16)", () => {
  const withUserMsg = (error) => ({ status: 400, body: { error: { message: 'Something went wrong', ...error } } });
  assert.equal(mapGraphError(withUserMsg({ error_user_msg: 'Feedback required. Try again later.' })).kind, 'ACTION_BLOCKED');
  assert.equal(mapGraphError(withUserMsg({ error_user_title: 'Checkpoint required' })).kind, 'CHECKPOINT');
  assert.equal(mapGraphError(withUserMsg({ error_user_msg: 'Plain text.' })).kind, 'API_ERROR');
  assert.equal(mapGraphError({ status: 400, body: { error: { error_user_msg: 'Checkpoint required' } } }).message, 'Checkpoint required');
});

// F-29 (Task 5 m-1). A body that is not an object gives no code, so the error maps by its HTTP status alone. No real Graph body
// is non-object, and this test pins the status-only reading.
test('a non-object error body maps by HTTP status alone (F-29)', () => {
  assert.equal(mapGraphError({ status: 429, body: null }).kind, 'RATE_LIMITED');
  assert.equal(mapGraphError({ status: 429, body: 'a string body' }).kind, 'RATE_LIMITED');
  assert.equal(mapGraphError({ status: 400, body: null }).kind, 'API_ERROR');
  assert.equal(mapGraphError({ status: 400, body: 'code 190' }).kind, 'API_ERROR', 'the code in a string body is not read');
});

// F-30 (ledger Task 12). A value that cannot be encoded is refused before it is added, so the registry never holds it.
test('registerSecret refuses a value with a lone surrogate, before it is added to the registry (F-30)', () => {
  const lone = 'ghost-secret-\uD800-abcdef';
  assert.throws(() => registerSecret(lone), { kind: 'VALIDATION' });
  assert.equal(maskRegistered(`the text has ${lone} in it`), `the text has ${lone} in it`, 'the refused value is not registered');
});

test('a structured code wins over a conflicting checkpoint text: code 190 is AUTH_EXPIRED, by the code', () => {
  const err = mapGraphError({ status: 400, body: { error: { code: 190, message: 'checkpoint required' } } });
  assert.equal(err.kind, 'AUTH_EXPIRED');
  assert.equal(err.details.signal, 'code');
});

test('a structured code wins over a conflicting checkpoint text: code 368 is ACTION_BLOCKED, by the code', () => {
  const err = mapGraphError({ status: 400, body: { error: { code: 368, message: 'checkpoint required' } } });
  assert.equal(err.kind, 'ACTION_BLOCKED');
  assert.equal(err.details.signal, 'code');
});

test('a checkpoint text outranks a rate-limit code: code 4 and HTTP 429 with a checkpoint text are CHECKPOINT, by the text', () => {
  const byCode = mapGraphError({ status: 400, body: { error: { code: 4, message: 'checkpoint required' } } });
  assert.equal(byCode.kind, 'CHECKPOINT');
  assert.equal(byCode.details.signal, 'text');
  const byStatus = mapGraphError({ status: 429, body: { error: { code: 1, message: 'checkpoint required' } } });
  assert.equal(byStatus.kind, 'CHECKPOINT');
  assert.equal(byStatus.details.signal, 'text');
});

test('a block code outranks a rate-limit status: HTTP 429 with code 368 is ACTION_BLOCKED, by the code', () => {
  const err = mapGraphError({ status: 429, body: { error: { code: 368, message: 'blocked' } } });
  assert.equal(err.kind, 'ACTION_BLOCKED');
  assert.equal(err.details.signal, 'code');
});

test('a text-only CHECKPOINT still maps to CHECKPOINT, and records the text signal', () => {
  const err = mapGraphError({ status: 400, body: { error: { code: 1, message: 'checkpoint required' } } });
  assert.equal(err.kind, 'CHECKPOINT');
  assert.equal(err.details.signal, 'text');
});

test('a message with no signal maps to API_ERROR, and records no signal', () => {
  const err = mapGraphError({ status: 400, body: { error: { code: 100, message: 'Unsupported get request.' } } });
  assert.equal(err.kind, 'API_ERROR');
  assert.equal(err.details.signal, 'none');
});

test('the classification detail never carries the message text', () => {
  const err = mapGraphError({ status: 400, body: { error: { code: 1, message: 'checkpoint required for the owner' } } });
  assert.equal(err.kind, 'CHECKPOINT');
  assert.equal(JSON.stringify(err.details).includes('owner'), false);
  assert.equal(JSON.stringify(err.details).includes('checkpoint'), false);
});

test('a token in a JSON-escaped string is masked', () => {
  registerSecret('EAAB-json-q"uote-1');
  assert.equal(redact('{"note":"x EAAB-json-q\\"uote-1 y"}'), '{"note":"x [redacted] y"}');
});

test('a URL-encoded token is masked', () => {
  registerSecret('EAAB/url+tok-1');
  assert.equal(redact('seen EAAB%2Furl%2Btok-1 here'), 'seen [redacted] here');
});

test('a token-shaped string with an IGAA prefix is masked', () => {
  const token = 'IGAAQVabc123DEF456ghi789JKL012mno345PQR678';
  assert.equal(redact(`the value ${token} here`), 'the value [redacted] here');
});

test('an ordinary word is not masked by the token-shape rule', () => {
  const text = 'EAAB and IGAA are prefixes; EAAGLE, IGAAS and EAA-1 are not tokens';
  assert.equal(redact(text), text);
});

test('the exact-value registry still masks the raw form', () => {
  registerSecret('RawForm-plain-77');
  assert.equal(redact('raw RawForm-plain-77 here'), 'raw [redacted] here');
});

// Review round 1 (M-1). The word bearer in ordinary prose is not a credential. A Bearer value is masked only when it is a
// token-shaped run: at least 20 token characters, with a digit, a lower-case letter and an upper-case letter.
test('the word bearer in ordinary prose is not masked', () => {
  assert.equal(redact('the bearer of bad news'), 'the bearer of bad news');
});

test('a Bearer header with a token-shaped value is masked', () => {
  assert.equal(redact('Bearer EAABsbCS1iHgBOxyzQRSTUVWXYZabc12'), 'Bearer [redacted]');
});

// Review round 1 (M-2). An identifier that starts with a prefix is not a token: the run must be a whole token with a digit,
// a lower-case letter and an upper-case letter.
test('an uppercase identifier that starts with IGAA is not masked', () => {
  const text = 'set IGAAMAX_LIMIT and IGAA_ENABLE_LOGGING_FEATURE in the config';
  assert.equal(redact(text), text);
});

test('a hyphenated word that starts with EAA is not masked', () => {
  const text = 'the EAA-compliant-standard-document is attached';
  assert.equal(redact(text), text);
});

// Review round 1 (M-3). A token may follow a backslash escape such as \n, or a percent-encoded newline such as %0A. A prefix
// glued to a letter or digit inside a longer word is not a token start.
test('a token after a newline escape is masked', () => {
  assert.equal(redact('first\\nEAABsbCS1iHgBOxyzQRSTUVWXYZabc12'), 'first\\n[redacted]');
});

test('a token after a percent-encoded newline is masked', () => {
  assert.equal(redact('x%0AEAABsbCS1iHgBOxyzQRSTUVWXYZabc12'), 'x%0A[redacted]');
});

test('a prefix glued to a letter or digit inside a longer word is not masked, but a whole token is', () => {
  const glued = 'tokenEAABsbCS1iHgBOxyzQRSTUVWXYZabc12';
  assert.equal(redact(glued), glued);
  const afterDigit = 'ab9IGAAQVabc123DEF456ghi789JKL012mno345';
  assert.equal(redact(afterDigit), afterDigit);
  assert.equal(redact('EAABsbCS1iHgBOxyzQRSTUVWXYZabc12'), '[redacted]');
});

// Coordinator change (after review round 1). An underscore or a hyphen before a prefix is not a letter or a digit, so a
// token-shaped run that follows one of them is masked (both characters occur inside base64 tokens). The whole-token rule
// still applies, so an uppercase identifier that has no digit is not masked.
test('a real IGAA token directly after an underscore is masked', () => {
  assert.equal(redact('config_IGAAQVabc123DEF456ghi789JKL012mno345'), 'config_[redacted]');
});

test('a real IGAA token directly after a hyphen is masked', () => {
  assert.equal(redact('config-IGAAQVabc123DEF456ghi789JKL012mno345'), 'config-[redacted]');
});

test('an uppercase identifier such as IGAAMAX_LIMIT is not masked, after an underscore or a hyphen too', () => {
  const text = 'set x_IGAAMAX_LIMIT and y-IGAAMAX_LIMIT and IGAAMAX_LIMIT';
  assert.equal(redact(text), text);
});

// Review round 2 (M-R1-1). The token-shape match must be linear in the length of the text. Before this round a run of 100,000
// characters made of a prefix and separators took seconds, because each prefix rescanned the rest of the run. The bound is 1000
// ms, far above a linear pass (a few milliseconds), so the test does not depend on the speed of the machine.
const LINEAR_BOUND_MS = 1000;
test('a 100,000-character run of a prefix and separators, with no digit, is masked nothing and is linear (M-R1-1)', () => {
  const run = 'EAA-'.repeat(25000);
  const started = performance.now();
  const out = redact(run);
  const elapsed = performance.now() - started;
  assert.equal(out, run, 'no digit and no lower-case letter, so no run is token-shaped');
  assert.ok(elapsed < LINEAR_BOUND_MS, `took ${elapsed.toFixed(0)} ms, over the ${LINEAR_BOUND_MS} ms bound`);
});

test('a 100,000-character run of separators with a real token at its end masks only that token, and is linear (M-R1-1)', () => {
  const head = '-_'.repeat(50000);
  const started = performance.now();
  const out = redact(`${head}_IGAAQVabc123DEF456ghi789JKL012mno345`);
  const elapsed = performance.now() - started;
  assert.equal(out, `${head}_[redacted]`);
  assert.ok(elapsed < LINEAR_BOUND_MS, `took ${elapsed.toFixed(0)} ms, over the ${LINEAR_BOUND_MS} ms bound`);
});

// Review round 1 (M-4). The stops are ranked as the guard ranks them (STOP_RANK): the account stops and CHECKPOINT rank 3, and
// the rate limit ranks 2. So a checkpoint text outranks a rate-limit code. A code 190 with a checkpoint text stays AUTH_EXPIRED,
// by the earlier test "code 190 is AUTH_EXPIRED, by the code".
