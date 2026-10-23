#!/usr/bin/env node
// The ig command. It parses the command line and calls src/cli.js, where every rule is. Stdout carries normal output, except
// for ig mcp, whose stdout carries only the protocol. Errors go to stderr and set the exit code to 1.

import { createInterface } from 'node:readline/promises';
import { Command } from 'commander';
import { loadConfig } from '../src/config.js';
import { IgError } from '../src/errors.js';
import { createAudit } from '../src/audit.js';
import { createSecrets } from '../src/secrets.js';
import { createState } from '../src/state.js';
import { redact } from '../src/redact.js';
import { sidecarCommand } from '../src/unofficial-session.js';
import { createSidecarAdapter } from '../src/unofficial/sidecar.js';
import {
  PROJECT_ROOT,
  REDIRECT_PORT,
  SECRET_NAMES,
  createLineSource,
  filesFor,
  readHiddenValue,
  readPipedValue,
  readServeLock,
  resolveConfigFile,
  resolveDataDir,
  runAuthFacebook,
  runAuthLogin,
  runAuthSet,
  runMcp,
  runRoutesAck,
  runRoutesClearOneReplyFlag,
  runRoutesLoginUnofficial,
  runServe,
  runStatus,
} from '../src/cli.js';

const say = (text) => process.stdout.write(`${redact(text)}\n`);
const sayErr = (text) => process.stderr.write(`${redact(text)}\n`);

const program = new Command();
program
  .name('ig')
  .description('Owner-only Instagram automation: setup commands, the service, the MCP client and status.')
  .option('--config <file>', 'config file (default: IG_CONFIG, then config.json in the project root)');

// The config is loaded inside each command, so --help and the other commands never read it by accident.
function loadConfigFromOptions() {
  return loadConfig({ file: resolveConfigFile({ option: program.opts().config }) });
}

// Runs one command. A failure prints its message, redacted, to stderr and sets the exit code.
async function attempt(action) {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sayErr(`ig: ${message}`);
    process.exitCode = 1;
  }
}

// A value for a secret: a hidden prompt on a terminal, or the first line of stdin when stdin is not a terminal.
async function readSecretValue(name) {
  if (process.stdin.isTTY) return readHiddenValue(`Value for ${name} (input hidden): `);
  return readPipedValue(process.stdin);
}

// The prompts of routes login-unofficial. On a terminal the username is shown, and the password and any code are hidden. Without a
// terminal, the lines of stdin are read in order: the username, the password, then the code when Instagram asks for one.
function unofficialLoginPrompts() {
  if (process.stdin.isTTY) {
    return {
      username: () => readVisibleLine('Instagram username: '),
      password: () => readHiddenValue('Instagram password (input hidden): '),
      verificationCode: () => readHiddenValue('Two-factor code (input hidden): '),
    };
  }
  const lines = createLineSource(process.stdin);
  return { username: () => lines.next(), password: () => lines.next(), verificationCode: () => lines.next() };
}

// One visible line from the terminal. The interface is closed at once, so the hidden prompts that follow read the terminal directly.
async function readVisibleLine(prompt) {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

function parsePort(text) {
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new IgError('CONFIG', '--port must be a whole number from 1 to 65535');
  }
  return port;
}

const auth = program.command('auth').description('store secrets, and log in to Instagram or Facebook');

auth
  .command('set')
  .argument('<name>', `one of: ${SECRET_NAMES.join(', ')}`)
  .description('store a secret in the OS keyring; the value is read from a hidden prompt, or from stdin')
  .action((name) =>
    attempt(() => runAuthSet({ name, readValue: readSecretValue, secrets: createSecrets(), out: say })),
  );

auth
  .command('login')
  .option('--port <port>', 'the loopback port for the redirect', String(REDIRECT_PORT))
  .description('log in to Instagram Login on 127.0.0.1 and store the owner token')
  .action((options) =>
    attempt(async () => {
      const config = loadConfigFromOptions();
      const files = filesFor(resolveDataDir(config.dataDir));
      const state = await createState({ file: files.state });
      const audit = createAudit({ file: files.audit, now: () => Date.now() });
      await runAuthLogin({
        config,
        secrets: createSecrets(),
        state,
        audit,
        port: parsePort(options.port),
        out: say,
      });
    }),
  );

auth
  .command('facebook')
  .option('--port <port>', 'the loopback port for the approval redirect', String(REDIRECT_PORT))
  .description(
    'log in to Facebook Login for Business: the approval comes back to a loopback page on 127.0.0.1, and the owner Page must be linked',
  )
  .action((options) =>
    attempt(async () => {
      const config = loadConfigFromOptions();
      const files = filesFor(resolveDataDir(config.dataDir));
      const state = await createState({ file: files.state });
      const audit = createAudit({ file: files.audit, now: () => Date.now() });
      await runAuthFacebook({
        config,
        secrets: createSecrets(),
        state,
        audit,
        port: parsePort(options.port),
        out: say,
      });
    }),
  );

program
  .command('serve')
  .description('run the HTTP API on the configured host and port, the poller and the hourly token checks')
  .action(() =>
    attempt(async () => {
      const config = loadConfigFromOptions();
      await runServe({
        config,
        secrets: createSecrets(),
        dataDir: resolveDataDir(config.dataDir),
        out: say,
        err: sayErr,
      });
    }),
  );

program
  .command('mcp')
  .description('serve the MCP tools over stdio, forwarding each call to ig serve; logs go to stderr')
  .action(() =>
    attempt(async () => {
      await runMcp({ config: loadConfigFromOptions(), secrets: createSecrets() });
    }),
  );

program
  .command('status')
  .description('print ig_status from the running service, or a local summary when it is not running')
  .action(() =>
    attempt(async () => {
      const config = loadConfigFromOptions();
      const outcome = await runStatus({
        config,
        dataDir: resolveDataDir(config.dataDir),
        secrets: createSecrets(),
        out: say,
        err: sayErr,
      });
      // A refusal (a non-loopback host without http.allowRemote) is an error, so it exits 1. Every other outcome, including
      // the service not running, is a normal result and exits 0.
      if (outcome === 'refused_remote') process.exitCode = 1;
    }),
  );

const routes = program.command('routes').description('settings for the unofficial routes, and the one-reply flag');

routes
  .command('ack-unofficial')
  .option('--confirm', 'store the acknowledgement; without it, only the warning is printed')
  .description('acknowledge the unofficial routes warning, which is needed before they can be enabled')
  .action((options) =>
    attempt(async () => {
      const config = loadConfigFromOptions();
      const files = filesFor(resolveDataDir(config.dataDir));
      const state = await createState({ file: files.state });
      await runRoutesAck({
        confirm: options.confirm === true,
        state,
        out: say,
        serveLock: () => readServeLock(resolveDataDir(config.dataDir)),
      });
    }),
  );

routes
  .command('clear-one-reply-flag')
  .option('--confirm', 'clear the flag; without it, the flag, its reason and the damaged line count are printed and nothing changes')
  .description(
    'clear the one-reply flag, which refuses private replies after an unreadable or damaged audit file (the owner\'s confirmed way out)',
  )
  .action((options) =>
    attempt(async () => {
      const config = loadConfigFromOptions();
      const files = filesFor(resolveDataDir(config.dataDir));
      await runRoutesClearOneReplyFlag({
        confirm: options.confirm === true,
        stateFile: files.state,
        auditFile: files.audit,
        out: say,
        serveLock: () => readServeLock(resolveDataDir(config.dataDir)),
      });
    }),
  );

routes
  .command('login-unofficial')
  .description('log in to the unofficial route with the owner username and password, through the sidecar; the acknowledgement comes first')
  .action(() =>
    attempt(async () => {
      const config = loadConfigFromOptions();
      const dataDir = resolveDataDir(config.dataDir);
      const files = filesFor(dataDir);
      const state = await createState({ file: files.state });
      const audit = createAudit({ file: files.audit, now: () => Date.now() });
      const { command, args } = sidecarCommand({ config, env: process.env, root: PROJECT_ROOT });
      const adapter = createSidecarAdapter({ command, args });
      try {
        await runRoutesLoginUnofficial({
          config,
          secrets: createSecrets(),
          state,
          audit,
          dataDir,
          prompts: unofficialLoginPrompts(),
          adapter,
          out: say,
          serveLock: () => readServeLock(dataDir),
        });
      } finally {
        await adapter.close();
      }
    }),
  );

await program.parseAsync(process.argv);
