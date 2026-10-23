# Node CLI stack for a REST-API command-line package (npm, Windows-first)

Research date: 2026-10-20. Local toolchain: Node v24.6.0, npm 11.14.1 (`node -v`, `npm -v`).

Method notes: versions and dates come from `npm view` on the npm registry. "Published" is the publish time of the latest version. `time.modified` is the packument's last-change time; it can move without a release, so it is not a release date. Library behavior comes from Context7 excerpts of each library's docs and README. WebFetch results are summaries produced by a model, so phrases taken from those pages are paraphrases unless stated otherwise.

**Recommended stack at a glance**
- CLI framework: commander 15.0.0 (ESM, Node >=22.12.0)
- Module format: ESM (`"type": "module"`)
- HTTP: Node's built-in fetch (undici-based) plus a small retry/backoff helper you own; undici 8.12.3 is optional
- Credentials: environment variable first; `@napi-rs/keyring` 2.1.2 for a saved login; no plaintext token file by default; do not use keytar (archived)
- Tests: node:test with `t.mock.method(globalThis, 'fetch', ...)`; vitest 5.0.5 as the alternative
- Node: engines `>=22.12.0`; CI on 22, 24, and 26 (26 becomes LTS on 2026-10-28)
- Webhook receiver for local tests: node:http
- Packaging: scoped package name, `bin` map with a shebang file, `files` allowlist, `publishConfig.access: "public"`, `npm link` for local testing

**Verified registry data (read 2026-10-20)**

| Package | Latest | Published (UTC) | time.modified | Module type | engines.node | Notes | Source |
|---|---|---|---|---|---|---|---|
| commander | 15.0.0 | 2026-05-29 | 2026-09-02 | module | >=22.12.0 | not deprecated | [npm](https://www.npmjs.com/package/commander) |
| yargs | 18.2.0 | 2026-09-20 | 2026-09-20 | module | ^20.19.0 or ^22.12.0 or >=23 | exports map has an import condition | [npm](https://www.npmjs.com/package/yargs) |
| citty | 0.2.2 | 2026-04-01 | 2026-08-20 | module | none declared | 0.x version | [npm](https://www.npmjs.com/package/citty) |
| cac | 7.1.0 | 2026-10-11 | 2026-10-11 | module | >=20.19.0 | not deprecated | [npm](https://www.npmjs.com/package/cac) |
| @oclif/core | 5.1.9 | 2026-10-19 | 2026-10-19 | no type field | >=22.0.0 | not deprecated | [npm](https://www.npmjs.com/package/@oclif/core) |
| oclif | 6.0.10 | 2026-10-18 | 2026-10-18 | no type field | >=22.0.0 | not deprecated | [npm](https://www.npmjs.com/package/oclif) |
| undici | 8.12.3 | 2026-10-19 | 2026-10-19 | no type field | >=22.19.0 | not deprecated | [npm](https://www.npmjs.com/package/undici) |
| vitest | 5.0.5 | 2026-10-15 | 2026-10-19 | module | ^22.12.0 or ^24.0.0 or >=26.0.0 | not deprecated | [npm](https://www.npmjs.com/package/vitest) |
| fastify | 5.12.7 | 2026-10-13 | 2026-10-13 | commonjs | none declared | not deprecated | [npm](https://www.npmjs.com/package/fastify) |
| express | 5.3.0 | 2026-10-09 | 2026-10-09 | no type field | >=18 | not deprecated | [npm](https://www.npmjs.com/package/express) |
| p-retry | 8.0.1 | 2026-09-01 | 2026-09-01 | module | >=22 | not deprecated | [npm](https://www.npmjs.com/package/p-retry) |
| @napi-rs/keyring | 2.1.2 | 2026-10-19 | 2026-10-19 | no type field | >=10 | prebuilt native binaries; not deprecated | [npm](https://www.npmjs.com/package/@napi-rs/keyring) |
| keytar | 7.9.0 | 2022-02-17 | 2025-07-30 | no type field | none declared | not deprecated per npm, but its GitHub repo is archived (last push 2022-12-12) | [npm](https://www.npmjs.com/package/keytar), [GitHub API](https://api.github.com/repos/atom/node-keytar) |

---

## 1. CLI framework

### Takeaway
Use commander 15.0.0. It declares ESM and a Node floor of >=22.12.0, and its docs show nested subcommands, `addCommand()` for splitting commands across modules, and `parseAsync()` for async action handlers. Runner-up: citty 0.2.2 if you want lazy-loaded command modules and fewer dependencies, accepting a pre-1.0 API. yargs is a viable but larger API. cac's documented examples are flat. oclif is a plugin-and-packaging framework and is heavy for one maintainer and one API.

### Cited Findings
- commander 15.0.0: `type` is module; engines >=22.12.0; published 2026-05-29 — [npm](https://www.npmjs.com/package/commander)
- Subcommands are defined with `.command()` or `.addCommand()`, and "Subcommands may be nested" — [commander README](https://github.com/tj/commander.js/blob/master/Readme.md)
- Use `.parseAsync()` instead of `.parse()` if any action handler is async — [commander README](https://github.com/tj/commander.js/blob/master/Readme.md)
- `.command()` copies inherited settings from the parent at creation; `.addCommand()` does not, and `copyInheritedSettings()` exists for that — [commander README](https://github.com/tj/commander.js/blob/master/Readme.md)
- yargs 18.2.0: `type` is module; exports map has an import condition; engines `^20.19.0 || ^22.12.0 || >=23`; published 2026-09-20 — [npm](https://www.npmjs.com/package/yargs)
- yargs nests commands with `.commandDir()`; a parent module `remote <command>` loads child modules from `remote_cmds/` — [yargs advanced docs](https://github.com/yargs/yargs/blob/main/docs/advanced.md)
- citty 0.2.2: `type` is module; no engines field; published 2026-04-01 — [npm](https://www.npmjs.com/package/citty)
- citty sub-commands are set with `subCommands`, "can be nested recursively", and "Use lazy imports for large CLIs" — [citty README](https://github.com/unjs/citty/blob/main/README.md)
- citty exposes `runMain` and `resolveSubCommand` — [citty API: command](https://github.com/unjs/citty/blob/main/_autodocs/api-reference/command.md), [citty API: main](https://github.com/unjs/citty/blob/main/_autodocs/api-reference/main.md)
- cac 7.1.0: `type` is module; engines >=20.19.0; published 2026-10-11 — [npm](https://www.npmjs.com/package/cac)
- cac's documented commands are top-level commands with arguments and options, such as `deploy [path]` and `bar <a> <b> [...rest]` — [cac sub-command reference](https://github.com/cacjs/cac/blob/main/skills/cac/references/sub-command.md)
- oclif nests commands by placing command files in subdirectories ("topics") — [oclif topics docs](https://oclif.io/docs/topics)
- @oclif/core 5.1.9 (published 2026-10-19) and oclif 6.0.10 (published 2026-10-18) both require Node >=22.0.0 and have no `type` field — [@oclif/core](https://www.npmjs.com/package/@oclif/core), [oclif](https://www.npmjs.com/package/oclif)

### Inferences
- commander is the lowest-risk pick on the brief's criteria: ESM, a declared Node floor, a 15.x major released in May 2026, and an explicit API. It has the thinnest abstraction of the candidates, which suits one maintainer.
- citty is the closest alternative. Its 0.x version signals that its API may still change (semver convention for 0.x; inference).
- cac's examples show only flat commands, so it is weaker for two-level command groups such as `media list`. This is inferred from the examples, not from an explicit statement that cac cannot nest.
- oclif's generator, topics, and plugin model add weight that a single-API tool does not need.

### Gaps
- Adoption and download counts were not checked, so no "most used" claim is made.
- citty's "zero dependencies" claim comes from the Context7 library summary and was not checked against its package.json.
- cac's nested-command support is not confirmed either way beyond its examples.
- oclif's module type is inferred as CommonJS from the missing `type` field.
- commander's nested example file (`nestedCommands.js`) was referenced but not read.

---

## 2. Module format

### Takeaway
Use ESM with `"type": "module"`. The recommended CLI library (commander 15) declares `type: module`, as do citty, cac, yargs, vitest, and p-retry. oclif, undici, express, and @napi-rs/keyring have no `type` field, so their interop with an ESM package needs care. Note the @napi-rs/keyring README itself uses an ESM import.

### Cited Findings
- npm's package.json docs say the `type` field "defines how Node.js should interpret .js files" and that npm does not use it — [npm package.json docs](https://docs.npmjs.com/cli/v11/configuring-npm/package-json) (WebFetch summary)
- Registry `type` values: module for commander, yargs, citty, cac, vitest, p-retry; no type field for @oclif/core, oclif, undici, express, @napi-rs/keyring, keytar; commonjs for fastify — [npm registry, see the table above](https://www.npmjs.com/package/commander)
- @napi-rs/keyring's README uses `import { Entry } from '@napi-rs/keyring'` — [npm README](https://www.npmjs.com/package/@napi-rs/keyring)

### Inferences
- With `"type": "module"`, the package's own `.js` files are ESM, so the code can use `import`/`export`, top-level `await`, and `import.meta`. A CLI consumed through `bin` has no CommonJS consumers to support.
- A missing `type` field means CommonJS, which is Node's default. This is inference; Node's module docs were not fetched.

### Gaps
- Node's ESM documentation was not fetched.
- Importing CommonJS-only dependencies from this ESM package was not tested.

---

## 3. HTTP client and retry/backoff

### Takeaway
Use Node's built-in `fetch` with a small retry helper that you own: retry 429 and 5xx responses, honor `Retry-After`, back off exponentially with jitter, and retry POST only when the target API documents the call as safe to repeat. Add undici 8.12.3 only if you want its retry interceptor; that raises the Node floor to >=22.19.0.

### Cited Findings
- Node 24 docs: the global `fetch` "is based on undici"; `process.versions.undici` reports the bundled version; `setGlobalDispatcher()` from undici "will affect both undici and Node.js" — [Node.js globals docs](https://nodejs.org/docs/latest-v24.x/api/globals.json)
- undici implements the WHATWG Fetch Standard, providing `fetch()` and related classes — [undici Fetch docs](https://github.com/nodejs/undici/blob/main/docs/docs/api/Fetch.md)
- undici 8.12.3 (published 2026-10-19) requires Node >=22.19.0 — [npm](https://www.npmjs.com/package/undici)
- `interceptors.retry()` retries failed requests; its example uses `statusCodes: [429, 502, 503, 504]` — [undici Interceptors docs](https://github.com/nodejs/undici/blob/main/docs/docs/api/Interceptors.md)
- RetryAgent defaults: `maxRetries` 5; `minTimeout` 500 ms; `maxTimeout` 30000 ms; `timeoutFactor` 2; `retryAfter` true (the delay is inferred from the `Retry-After` header when present); `methods` GET, HEAD, OPTIONS, PUT, DELETE, TRACE (POST is not included); `statusCodes` 500, 502, 503, 504, 429 — [undici RetryAgent docs](https://github.com/nodejs/undici/blob/main/docs/docs/api/RetryAgent.md)
- p-retry 8.0.1 (published 2026-09-01) is ESM and requires Node >=22; its API was not checked — [npm](https://www.npmjs.com/package/p-retry)

### Inferences
- A hand-written helper keeps the dependency count at zero and can follow the target API's own rate-limit headers, which generic defaults may not match.
- POST is outside undici's default retry methods, so a non-idempotent POST would be retried only with an explicit opt-in. Your helper should make the same distinction.
- Combining undici's RetryAgent with Node's fetch through `setGlobalDispatcher()` should work, given the Node docs quoted above. This combination was not tested.

### Gaps
- The target API's rate-limit headers and quotas were not in scope. The helper's thresholds should follow that API's documentation.
- Other HTTP clients (ky, got, axios) were not compared.
- Node's stability label for `fetch` was not confirmed by the fetched excerpt, which covered only the Headers class.

---

## 4. Credential storage

### Takeaway
Read the token from an environment variable first; it works in CI and persists nothing. For a saved interactive login, use `@napi-rs/keyring` 2.1.2, which wraps the OS credential store. Do not keep the token in a plain file by default. On Windows, file mode bits do not restrict other users, so a 0600 file is not a private file.

### Cited Findings
- @napi-rs/keyring 2.1.2 (published 2026-10-19): engines >=10; MIT; description "Node.js binding" of keyring-rs via napi.rs — [npm](https://www.npmjs.com/package/@napi-rs/keyring), [repository](https://github.com/Brooooooklyn/keyring-node)
- API: `new Entry(service, name)`, `setPassword()`, `getPassword()`, `deletePassword()` — [README](https://www.npmjs.com/package/@napi-rs/keyring)
- On Linux the binding tries Secret Service first and falls back to kernel keyutils; keyutils is "completely in-memory and will not persist across reboots"; a store can be pinned with `{ linux: { store: 'secret-service' } }` — [README](https://www.npmjs.com/package/@napi-rs/keyring)
- Prebuilt `.node` binaries are shipped in per-platform packages — [README](https://www.npmjs.com/package/@napi-rs/keyring)
- keyring-rs maps Windows to Windows Credential Manager, macOS to Keychain Services, and *nix to Secret Service — [keyring-rs v1 API docs](https://github.com/open-source-cooperative/keyring-rs/blob/main/_autodocs/api-reference/v1.md)
- keytar 7.9.0 was last published 2022-02-17; its GitHub repository is archived (`archived: true`, last push 2022-12-12) — [npm](https://www.npmjs.com/package/keytar), [GitHub API](https://api.github.com/repos/atom/node-keytar)
- Node fs docs: "on Windows only the write permission can be changed, and the distinction among the permissions of group, owner, or others is not implemented"; only `S_IRUSR` and `S_IWUSR` exist on Windows — [Node.js fs docs](https://nodejs.org/docs/latest-v24.x/api/fs.json)
- Node fs docs: the `mode` option of `fs.writeFile` "only affects newly created files" — [Node.js fs docs](https://nodejs.org/docs/latest-v24.x/api/fs.json)

### Inferences
- A token file on Windows gets its protection from NTFS ACLs, not from mode bits. Files under the user profile usually inherit ACLs that restrict access to the user; this is inferred from general Windows behavior and was not verified in this pass.
- On Windows, @napi-rs/keyring should use Credential Manager, because it wraps keyring-rs, whose Windows backend is Credential Manager. The README documents only Linux backend selection, so this is inferred.
- The native binary adds an install-time risk on unsupported platforms (inference).
- Suggested fallback chain: environment variable, then keychain, and fail with a clear message if neither is present.

### Gaps
- Windows default ACLs for the user profile were not verified; check on a real machine with `icacls`.
- @napi-rs/keyring's Windows behavior was not tested and is not documented in its README.
- Migrating or deleting stored credentials was not researched.
- Using environment variables first is a design choice, not a sourced finding.

---

## 5. Testing: node:test vs vitest

### Takeaway
Use node:test. It needs no dev dependency, and `t.mock.method(globalThis, 'fetch', impl)` is restored automatically when the test ends. Use vitest 5.0.5 if you want its watch mode and tooling. Vitest's engines are `^22.12.0 || ^24.0.0 || >=26.0.0`, so it skips Node 23 and 25.

### Cited Findings
- node:test: `t.mock.method(object, methodName[, implementation][, options])`; the TestContext spy "ensures automatic restoration of mocked functionality after the test finishes" — [Node.js test docs](https://nodejs.org/docs/latest-v24.x/api/test.json)
- vitest 5.0.5 (published 2026-10-15): `type` is module; engines `^22.12.0 || ^24.0.0 || >=26.0.0` — [npm](https://www.npmjs.com/package/vitest)
- `vi.stubGlobal(name, value)` redefines a global on `globalThis`; restore with `vi.unstubAllGlobals()` or the `unstubGlobals` config option — [Vitest globals guide](https://github.com/vitest-dev/vitest/blob/main/docs/guide/mocking/globals.md), [vi API](https://github.com/vitest-dev/vitest/blob/main/docs/api/vi.md)
- `mockRestore()` restores spied methods — [Vitest mock API](https://github.com/vitest-dev/vitest/blob/main/docs/api/mock.md)

node:test pattern (from the documented `t.mock.method` API):
```js
import { test } from 'node:test';
test('retries a 429 response', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 429 }));
  // call the client under test here
});
```

vitest pattern (from the documented `vi.stubGlobal` and `vi.unstubAllGlobals` APIs):
```js
import { afterEach, vi } from 'vitest';
afterEach(() => vi.unstubAllGlobals());
vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
```

### Inferences
- node:test avoids a second toolchain for a JavaScript-only CLI. vitest pays off with coverage, watch mode, and a larger suite.
- Both patterns work only if the client calls `globalThis.fetch` at call time, not a reference captured at import time. This is an inference from how both mocking APIs replace globals; it is a design constraint for the client module.

### Gaps
- No speed or maintenance comparison between the two runners beyond the registry metadata.
- Coverage tooling was not researched.

---

## 6. Node version and engines

### Takeaway
As of 2026-10-20, Node 24 is the newest LTS line that has started, and its Maintenance LTS date is today. Node 26 becomes LTS on 2026-10-28. Declare `"engines": { "node": ">=22.12.0" }`. That floor matches commander 15, the highest minimum among the runtime libraries recommended here, and it keeps Node 22 in scope until its end-of-life on 2027-04-30. Test in CI on 22, 24, and 26.

### Cited Findings
- Release schedule (Node.js Release WG, `schedule.json`):
  - v20: end 2026-04-30 (already past)
  - v22: LTS 2024-10-29; Maintenance 2025-10-21; end 2027-04-30
  - v24: LTS 2025-10-28; Maintenance 2026-10-20; end 2028-04-30 (codename Krypton)
  - v26: LTS 2026-10-28; Maintenance 2027-10-20; end 2029-04-30
  - v27: alpha 2026-10-28; start 2027-04-22
  — [Node.js release schedule](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json)
- Engines of candidate libraries: commander >=22.12.0; vitest `^22.12.0 || ^24.0.0 || >=26.0.0`; undici >=22.19.0; yargs `^20.19.0 || ^22.12.0 || >=23`; cac >=20.19.0; p-retry >=22; express >=18 — [npm registry, see the table above](https://www.npmjs.com/package/commander)

### Inferences
- A floor of >=22.12.0 covers Node 22 (maintenance until 2027-04-30), 24, and 26. Raise it to >=24 after 2027-04-30, when Node 22 reaches end-of-life.
- Choose >=22.19.0 if you adopt undici's RetryAgent.
- `engines` is advisory unless the install environment enforces it. This is inference; npm's docs on engines were not fetched.

### Gaps
- nodejs.org's own release page was not fetched separately. The source used is the schedule file in the nodejs/Release repository.
- How nodejs.org labels Node 24 on 2026-10-20 (Active or Maintenance LTS) was not verified.

---

## 7. Webhook receiver for local testing

### Takeaway
Use node:http. A local test receiver needs one route, a body read, and a JSON response, and the built-in server handles that with no dependency. Use express 5.3.0 only if you need routing or middleware. Fastify was not evaluated in depth.

### Cited Findings
- Node http docs: `http.createServer((req, res) => ...)` with `server.listen(port)` — [Node.js http docs](https://nodejs.org/docs/latest-v24.x/api/http.json)
- Reading a request body: call `req.setEncoding('utf8')`, collect chunks on `'data'`, parse on `'end'`, and respond 400 when the JSON is invalid — [Node.js stream docs](https://nodejs.org/docs/latest-v24.x/api/stream.json)
- express 5.3.0 (published 2026-10-09): engines >=18; no `type` field — [npm](https://www.npmjs.com/package/express)
- fastify 5.12.7 (published 2026-10-13): `type` is commonjs; no engines field in registry metadata — [npm](https://www.npmjs.com/package/fastify)

### Inferences
- node:http keeps the test tooling dependency-free. For a receiver that checks one signature header and logs the payload, a framework adds little.
- fastify's commonjs type means an ESM project would import it through interop (inference). That is one more reason to skip it here.

### Gaps
- fastify's documentation and its Node requirement were not checked.
- Provider-specific webhook signature verification was not researched.
- Exposing a local receiver to the internet (tunneling) was not researched.

---

## 8. Packaging: bin, npm link, scoped names, files

### Takeaway
Use a scoped name, a `bin` map pointing to a file that starts with `#!/usr/bin/env node`, a `files` allowlist, `"publishConfig": { "access": "public" }` for a public scoped package, and `"type": "module"`. For local testing, run `npm link` in the package folder and `npm link @your-scope/your-cli` in a test project, or `npm link ../your-cli` to do both at once.

Suggested manifest (placeholders in place of real names):
```json
{
  "name": "@your-scope/your-cli",
  "type": "module",
  "bin": { "your-cli": "./bin/your-cli.js" },
  "files": ["bin/", "src/", "README.md", "LICENSE"],
  "engines": { "node": ">=22.12.0" },
  "publishConfig": { "access": "public" }
}
```

### Cited Findings
- Name: scoped names are allowed; the 214-character cap includes the scope; new packages cannot use uppercase letters — [npm package.json docs](https://docs.npmjs.com/cli/v11/configuring-npm/package-json) (WebFetch summary)
- `bin` is a map of command name to file, or a plain string for one executable named after the package; a global install symlinks it on Unix and creates a `.cmd` file on Windows; referenced files should start with `#!/usr/bin/env node` — [npm package.json docs](https://docs.npmjs.com/cli/v11/configuring-npm/package-json) (WebFetch summary)
- `files` is an inclusion list with gitignore-style patterns; `package.json`, the README, the LICENSE, the `main` file, and `bin` files are always included; `.git`, `.npmrc`, `node_modules`, and lockfiles cannot be re-included; a root `.npmignore` does not override `files` — [npm package.json docs](https://docs.npmjs.com/cli/v11/configuring-npm/package-json) (WebFetch summary)
- `publishConfig` can set `access`; the page describes it as helping keep a scoped module private by default — [npm package.json docs](https://docs.npmjs.com/cli/v11/configuring-npm/package-json) (WebFetch summary)
- `npm link` with no arguments in a package folder creates a global symlink to it; `npm link <package-name>` in another project links it in; `npm link ../<dir>` does both; the global step links the package's bins into the global prefix's `bin` — [npm link docs](https://docs.npmjs.com/cli/v11/commands/npm-link) (WebFetch summary)
- Scoped names must include the scope in the link command, for example `npm link @myorg/privatepackage` — [npm link docs](https://docs.npmjs.com/cli/v11/commands/npm-link) (WebFetch summary)
- Linked dependencies are not saved to `package.json` unless `--save` is passed — [npm link docs](https://docs.npmjs.com/cli/v11/commands/npm-link) (WebFetch summary)
- The `bin-links` setting (default true) controls executable links; on Windows npm uses `.cmd` shims instead of symlinks — [npm link docs](https://docs.npmjs.com/cli/v11/commands/npm-link) (WebFetch summary)

### Inferences
- An explicit `files` list keeps tests, fixtures, and local config out of the tarball. Confirm the result with `npm pack --dry-run` before publishing (not run in this pass).
- Because npm creates a `.cmd` shim on Windows, the command should run from PowerShell and cmd after `npm link` or a global install (inference from the shim behavior).

### Gaps
- The npm link page does not describe how to remove a link; `npm unlink` was not verified.
- Publish-time requirements (two-factor authentication, provenance) were not researched.

---

## Gaps across the whole note
- Context7 was used for commander, yargs, citty, cac, oclif, undici, vitest, Node.js, and keyring-rs. `@napi-rs/keyring` has no Context7 entry of its own; the keyring-rs Rust docs were used for platform mapping, and the npm README for the binding's API.
- WebFetch summaries are paraphrases. Quoted phrases from npm docs and the npm link page should be checked against the originals before publication.
- Fastify's docs, other HTTP clients, adoption and download statistics, and Windows default ACLs were not verified.
