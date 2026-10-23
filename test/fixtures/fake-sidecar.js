// A stand-in for the Python sidecar, for test/sidecar.test.js only. It reads one JSON request per line on stdin
// and answers on stdout. argv[2] is the mode. A mode with an option is written "mode:option".
//   echo (the default)     answers each request with the result { method, params }
//   reverse                holds two requests and answers them in reverse order
//   silent                 never answers
//   garbage                answers each request with a line that is not JSON
//   exit                   ends the process on the first request, without answering
//   stderr:<line>          writes the line to stderr, then ends the process on the first request, without answering
//   once-then-exit         answers the first request as echo does, then ends the process on the second request
//   env                    answers with the result { names }, the IG_ variables in the child's environment
//   error:<kind>           fails every request with that kind
//   reply:<shape>          answers every request with one reply shape:
//                            none              ok true, no result
//                            string            ok true, result "text"
//                            null              ok true, result null
//                            object            ok true, result { method, params }
//                            error-no-object   ok false, no error object
//                            error-no-kind     ok false, an error object with no kind
//                            ok-not-boolean    ok "yes", result {}
//   session                login and restore_session succeed with a session object that holds a token, nested strings,
//                          and a token with a trailing newline. Every other request fails with a message that repeats
//                          the login token
//   surrogate              every request succeeds with a session string that holds a lone surrogate
import { createInterface } from 'node:readline';

const SESSION_TOKEN = 'SESSION-TOKEN-7f3a9c';
const RESTORE_TOKEN = 'RESTORE-TOKEN-0b2d4e';
const PADDED_TOKEN = 'PADDED-TOKEN-9d8c7b';

const spec = process.argv[2] ?? 'echo';
const colon = spec.indexOf(':');
const mode = colon === -1 ? spec : spec.slice(0, colon);
const option = colon === -1 ? '' : spec.slice(colon + 1);

let held = [];
let answered = false;

function replyShape(request) {
  switch (option) {
    case 'none':
      return { id: request.id, ok: true };
    case 'string':
      return { id: request.id, ok: true, result: 'text' };
    case 'null':
      return { id: request.id, ok: true, result: null };
    case 'object':
      return { id: request.id, ok: true, result: { method: request.method, params: request.params } };
    case 'error-no-object':
      return { id: request.id, ok: false };
    case 'error-no-kind':
      return { id: request.id, ok: false, error: { message: 'no kind here' } };
    case 'ok-not-boolean':
      return { id: request.id, ok: 'yes', result: {} };
    default:
      throw new Error(`unknown reply shape: ${option}`);
  }
}

function sessionObject(token) {
  return {
    sessionid: token,
    cookies: { ds: 'DS-VALUE-1234' },
    list: ['LIST-VALUE-5678'],
    short: 'ab',
    blank: '   ',
    padded: `${PADDED_TOKEN}\n`,
  };
}

function answer(request) {
  if (mode === 'error') {
    return { id: request.id, ok: false, error: { kind: option, message: 'refused by the fixture' } };
  }
  if (mode === 'surrogate') {
    return { id: request.id, ok: true, result: { sessionid: 'SURROGATE-\uD800-TOKEN-1122' } };
  }
  if (mode === 'reply') return replyShape(request);
  if (mode === 'env') {
    // Every variable the child can see, so that a test can check the environment it was given.
    const names = Object.keys(process.env);
    return { id: request.id, ok: true, result: { names } };
  }
  if (mode === 'session') {
    if (request.method === 'login') return { id: request.id, ok: true, result: sessionObject(SESSION_TOKEN) };
    if (request.method === 'restore_session') return { id: request.id, ok: true, result: sessionObject(RESTORE_TOKEN) };
    return {
      id: request.id,
      ok: false,
      error: { kind: 'api_error', message: `upstream echoed ${SESSION_TOKEN}` },
    };
  }
  return { id: request.id, ok: true, result: { method: request.method, params: request.params } };
}

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

createInterface({ input: process.stdin }).on('line', (line) => {
  if (mode === 'silent') return;
  if (mode === 'garbage') {
    process.stdout.write('this line is not json\n');
    return;
  }
  if (mode === 'exit') process.exit(3);
  if (mode === 'stderr') {
    // The line goes to stderr, and the process ends once the line has been written.
    process.stderr.write(`${option}\n`, () => process.exit(3));
    return;
  }
  const request = JSON.parse(line);
  if (mode === 'once-then-exit') {
    if (answered) process.exit(3);
    answered = true;
  }
  if (mode === 'reverse') {
    held.push(request);
    if (held.length === 2) {
      for (const pending of held.reverse()) write(answer(pending));
      held = [];
    }
    return;
  }
  write(answer(request));
});
