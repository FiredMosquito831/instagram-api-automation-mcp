#!/usr/bin/env node
// The local CI gate. It runs on this machine the checks that a hosted CI would run.
//
//   npm run ci                 check and report; exit 1 when a required check fails
//   npm run ci -- --record     also append a line to orchestration/ci/history.md
//   npm run ci -- --release    strict: clean working tree, a CHANGELOG section for the version,
//                              the second Node version configured and passing; then records
//
// The second Node version is read from .ci-local.json (not tracked; see .ci-local.example.json).
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flags = new Set(process.argv.slice(2));
const strict = flags.has('--release');
const record = flags.has('--record') || strict;
const TEST_TIMEOUT_MS = 10 * 60 * 1000;

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const checks = [];

// status: 'pass' | 'fail' | 'not run'. A required check that is not run counts as a failure.
function check(name, status, detail, required = true) {
  checks.push({ name, status, detail, required });
}

function git(args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function nodeVersionOf(binary) {
  const out = spawnSync(binary, ['--version'], { encoding: 'utf8' });
  return out.status === 0 ? out.stdout.trim() : 'unknown';
}

// Reads the TAP summary lines that node --test prints with --test-reporter=tap.
function countsFrom(output) {
  const counts = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const m = output.match(new RegExp(`^# ${key} (\\d+)`, 'm'));
    counts[key] = m ? Number(m[1]) : null;
  }
  return counts;
}

function runSuite(binary) {
  const testDir = join(root, 'test');
  const files = readdirSync(testDir)
    .filter((f) => f.endsWith('.test.js'))
    .map((f) => join('test', f));
  const started = Date.now();
  const out = spawnSync(binary, ['--test', '--test-reporter=tap', ...files], {
    cwd: root,
    encoding: 'utf8',
    timeout: TEST_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  const text = `${out.stdout ?? ''}\n${out.stderr ?? ''}`;
  const c = countsFrom(text);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = out.status === 0 && c.fail === 0 && c.cancelled === 0 && c.tests !== null && c.tests > 0;
  return {
    ok,
    version: nodeVersionOf(binary),
    counts: c,
    seconds,
    summary: `${c.pass ?? '?'}/${c.tests ?? '?'} pass, ${c.fail ?? '?'} fail, ${c.cancelled ?? '?'} cancelled, ${c.skipped ?? '?'} skipped, exit ${out.status} in ${seconds}s`,
  };
}

// 1. The Node version floor from package.json (engines.node: ">=22.12.0").
{
  const [maj, min] = process.versions.node.split('.').map(Number);
  const ok = maj > 22 || (maj === 22 && min >= 12);
  check('Node version is at least 22.12.0', ok ? 'pass' : 'fail', `running ${process.version}`);
}

// 2. The working tree is clean. Strict for a release; reported otherwise.
{
  const dirty = git(['status', '--porcelain']).trim();
  const n = dirty ? dirty.split('\n').length : 0;
  check('working tree is clean', n === 0 ? 'pass' : 'fail', n === 0 ? 'clean' : `${n} changed path(s)`, strict);
}

// 3. The CHANGELOG has a section for the version in package.json.
{
  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
  const escaped = pkg.version.replace(/\./g, '\\.');
  const found = new RegExp(`^## ${escaped}\\b`, 'm').test(changelog);
  check(`CHANGELOG has a section for ${pkg.version}`, found ? 'pass' : 'fail', found ? 'found' : 'missing', true);
}

// 4. The full suite on the Node that runs this script.
const current = runSuite(process.execPath);
check(`test suite on ${current.version}`, current.ok ? 'pass' : 'fail', current.summary);

// 5. The full suite on the second Node version, when one is configured.
const configPath = join(root, '.ci-local.json');
let config = {};
let configOk = true;
if (existsSync(configPath)) {
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    configOk = false;
    check('local CI config (.ci-local.json) is valid JSON', 'fail', `cannot be parsed (${err.name})`, true);
  }
}
if (configOk && existsSync(configPath)) check('local CI config (.ci-local.json) is valid JSON', 'pass', 'parsed');
let second = null;
if (config.nodeAlt && existsSync(config.nodeAlt)) {
  second = runSuite(config.nodeAlt);
  check(`test suite on ${second.version}`, second.ok ? 'pass' : 'fail', second.summary, strict);
} else {
  check('test suite on the second Node', 'not run', 'nodeAlt is not set in .ci-local.json', strict);
}

// 6. The Python sidecar check, when Python is on PATH.
{
  const py = spawnSync('python', ['-B', '-c', "import sidecar.ig_sidecar as s; print(s.map_exception_kind('ClientThrottledError'))"], {
    cwd: root,
    encoding: 'utf8',
  });
  if (py.error || py.status === null) {
    check('Python sidecar check', 'not run', 'python is not on PATH', false);
  } else {
    const got = (py.stdout || '').trim();
    check('Python sidecar check', got === 'rate_limited' ? 'pass' : 'fail', `prints "${got}" (expected rate_limited)`, false);
  }
}

// 7. No token-shaped string in the shipped code, docs and manual. Test fixtures are excluded.
{
  const scope = ['src', 'bin', 'sidecar', 'scripts', 'docs', 'orchestration', 'README.md', 'CHANGELOG.md', 'CLAUDE.md'];
  const files = git(['ls-files', '--', ...scope]).split('\n').filter(Boolean);
  const pattern = /(IGAA|IGQV|EAA)[A-Za-z0-9_-]{30,}/;
  const hits = [];
  for (const rel of files) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    let text;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    if (pattern.test(text)) hits.push(rel);
  }
  check('no token-shaped string in shipped files', hits.length === 0 ? 'pass' : 'fail', hits.length === 0 ? `${files.length} files scanned` : hits.join(', '));
}

// Report.
const rows = checks.map((c) => {
  // A check that is not required is shown as WARN when it fails, so it does not read as a gate failure.
  const mark = c.status === 'pass' ? 'PASS' : c.status === 'fail' ? (c.required ? 'FAIL' : 'WARN') : 'NOT RUN';
  return `${mark.padEnd(8)} ${c.name} — ${c.detail}`;
});
console.log(`\nLocal CI for ${pkg.name} ${pkg.version}\n`);
for (const r of rows) console.log(r);

const failed = checks.filter((c) => c.required && c.status !== 'pass');
const overall = failed.length === 0 ? 'PASS' : 'FAIL';
console.log(`\nOverall: ${overall}${failed.length ? ` (${failed.map((c) => c.name).join('; ')})` : ''}`);

let sha = 'unknown';
try {
  sha = git(['rev-parse', '--short', 'HEAD']).trim();
} catch {
  // not a repository
}

if (record) {
  const dir = join(root, 'orchestration', 'ci');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'history.md');
  if (!existsSync(file)) {
    writeFileSync(file, '# Local CI history\n\nOne line per recorded run. Written by `npm run ci -- --record` (or `--release`).\n\n', 'utf8');
  }
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
  const line = `- ${stamp} · ${pkg.version} · ${sha} · ${overall} · ${current.version}: ${current.summary}` +
    (second ? ` · ${second.version}: ${second.summary}` : ' · second Node not run');
  appendFileSync(file, line + '\n', 'utf8');
  console.log(`\nRecorded in orchestration/ci/history.md`);
}

process.exit(failed.length === 0 ? 0 : 1);
