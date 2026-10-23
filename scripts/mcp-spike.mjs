// Protocol spike for the MCP thin client. Run with: node scripts/mcp-spike.mjs
//
// The parent starts this same file as a child with --child. The child runs startStdio with a fake forward and the real
// TOOLS, over its own stdin and stdout. Two children are run, because a connection is pinned to one protocol era by its
// first message:
//   1. The 2025 handshake: initialize (asking for 2026-07-28), then tools/list. The SDK answers 2025-11-25.
//   2. The 2026-07-28 revision: server/discover, then tools/list, each carrying the 2026-07-28 envelope in _meta.
// Pass means: the revision 2026-07-28 is advertised and served, the tool count equals TOOLS.length, and stdout holds only
// protocol frames in both runs. No network and no socket are used. bin/ig.js does not exist yet, so the spike against the
// real entry point is re-run when bin/ig.js is built (Task 17).

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { startStdio } from '../src/mcp.js';
import { TOOLS } from '../src/tools.js';

const REVISION = '2026-07-28';
const SELF = fileURLToPath(import.meta.url);
const WAIT_MS = 5000;
const ENVELOPE = { 'io.modelcontextprotocol/protocolVersion': REVISION, 'io.modelcontextprotocol/clientCapabilities': {} };

if (process.argv[2] === '--child') {
  // The child serves the stdio transport until its stdin closes. A fake forward is used, so no request is made.
  await startStdio({ forward: async (name) => ({ result: { fake: true, name } }), tools: TOOLS });
} else {
  await runSpike();
}

// Starts one child, sends the requests in order, and waits for a reply to each id. Every stdout line is parsed: a line
// that is not a JSON-RPC 2.0 frame is recorded as a non-protocol line.
async function runChild(requests) {
  const child = spawn(process.execPath, [SELF, '--child'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  const frames = [];
  const nonFrames = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    try {
      const parsed = JSON.parse(line);
      if (parsed !== null && typeof parsed === 'object' && parsed.jsonrpc === '2.0') frames.push(parsed);
      else nonFrames.push(line);
    } catch {
      nonFrames.push(line);
    }
  });

  const replyTo = (id) => frames.find((frame) => frame.id === id);
  const waitForReply = async (id) => {
    const started = Date.now();
    while (replyTo(id) === undefined) {
      if (Date.now() - started > WAIT_MS) throw new Error(`no reply to request ${id} within ${WAIT_MS} ms`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return replyTo(id);
  };

  let failure = null;
  const replies = {};
  try {
    for (const request of requests) {
      child.stdin.write(`${JSON.stringify(request)}\n`);
      if (request.id !== undefined) replies[request.id] = await waitForReply(request.id);
    }
  } catch (error) {
    failure = error.message;
  } finally {
    child.stdin.end();
  }
  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.kill();
      resolve('killed');
    }, WAIT_MS);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
  return { replies, frames, nonFrames, exitCode, stderr: stderr.trim(), failure };
}

async function runSpike() {
  // Run 1: the 2025 handshake, as the brief's literal step. The SDK answers with its 2025 version.
  const legacy = await runChild([
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: REVISION, capabilities: {}, clientInfo: { name: 'mcp-spike', version: '0.0.0' } },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  ]);

  // Run 2: the 2026-07-28 revision. server/discover advertises the revision, and each request carries the envelope.
  const modern = await runChild([
    { jsonrpc: '2.0', id: 1, method: 'server/discover', params: { _meta: ENVELOPE } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: { _meta: ENVELOPE } },
  ]);

  const advertised = modern.replies[1]?.result?.supportedVersions ?? [];
  const modernCount = modern.replies[2]?.result?.tools?.length;
  const legacyVersion = legacy.replies[1]?.result?.protocolVersion;
  const legacyCount = legacy.replies[2]?.result?.tools?.length;

  console.error(`2025 handshake (initialize asked for ${REVISION}) negotiated: ${legacyVersion ?? 'none'}`);
  console.error(`2025 handshake tools listed: ${legacyCount ?? 'none'} (TOOLS.length ${TOOLS.length})`);
  console.error(`${REVISION} advertised by server/discover: ${advertised.join(', ') || 'none'}`);
  console.error(`${REVISION} tools listed: ${modernCount ?? 'none'} (TOOLS.length ${TOOLS.length})`);
  console.error(`stdout frames: legacy ${legacy.frames.length}, ${REVISION} ${modern.frames.length}`);
  console.error(`non-protocol stdout lines: legacy ${legacy.nonFrames.length}, ${REVISION} ${modern.nonFrames.length}`);
  console.error(`child exit codes: legacy ${legacy.exitCode}, ${REVISION} ${modern.exitCode}`);
  for (const run of [legacy, modern]) {
    if (run.stderr !== '') console.error(`child stderr: ${run.stderr}`);
    if (run.failure) console.error(`failure: ${run.failure}`);
  }

  const checks = {
    [`${REVISION} is advertised and served`]: advertised.includes(REVISION) && modern.replies[2]?.error === undefined,
    [`${REVISION} tool count equals TOOLS.length`]: modernCount === TOOLS.length,
    'stdout holds only protocol frames (both runs)': legacy.nonFrames.length === 0 && modern.nonFrames.length === 0,
    'both children exited cleanly': legacy.exitCode === 0 && modern.exitCode === 0 && !legacy.failure && !modern.failure,
  };
  for (const [label, ok] of Object.entries(checks)) console.error(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
  console.error(`note: initialize does not select ${REVISION} in this SDK; it negotiated ${legacyVersion ?? 'none'} (the 2025 handshake).`);
  process.exitCode = Object.values(checks).every(Boolean) ? 0 : 1;
}
