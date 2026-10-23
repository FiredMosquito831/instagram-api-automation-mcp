// Loaded into a child process with --import by the status tests. It replaces fetch in that process only, so the status
// command makes no network call. Each call is reported on stderr with its URL, and whether it carries an Authorization
// header. The token itself is never written. The answer is a status result.
globalThis.fetch = async (url, init) => {
  const sent = init?.headers?.Authorization !== undefined ? 'yes' : 'no';
  process.stderr.write(`FETCH ${url} authorization=${sent}\n`);
  return new Response(JSON.stringify({ result: { accountType: 'business' } }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
