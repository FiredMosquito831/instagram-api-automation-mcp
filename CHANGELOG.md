# Changelog

All notable changes to this project are recorded here. The project follows [Semantic Versioning](https://semver.org/). Each release is a version bump in `package.json`, a matching tag `vX.Y.Z`, and a GitHub release.

## 0.1.1

Packaging and gate. No change to the service's behaviour.

- The package is renamed from `instagram-automation` to `instagram-api-automation-mcp`, to match the repository. Nothing is published to npm.
- The stored-credential service name (`instagram-automation`, used by the keyring) and the MCP server's advertised name stay as they were. Changing either would orphan stored credentials or break client configurations.
- The local CI gate is `npm run ci` (`scripts/ci-local.mjs`). It runs the suite on Node 24.6.0, 22.12.0 (the engine minimum, verified exactly: 1217/1217) and 22.13.1, plus the sidecar check and a token-shape scan. `npm run ci -- --release` is the strict form.

## 0.1.0

First release. The package is private (`"private": true`) and is not published to npm.

### What is in the release
- The Instagram automation service: a CLI (`ig`), an HTTP API on loopback, and an MCP server over stdio.
- Official Graph API routes for profile, media publishing, comments, likes, direct messages, insights, hashtag search, business discovery and mentioned media, with the owner-only rules, the caps, the stop state and the confirmation rule.
- An inbound poller and a webhook receiver (off by default), with a durable event log and an acknowledge and decide flow.
- An optional unofficial route through a Python sidecar (instagrapi 3.1.0, pinned). It is off by default and needs an acknowledgement stored in state.
- Media publishing from the owner's own public HTTPS host, with path, symlink, extension, size and host checks.
- Redaction of secrets in every output path, the OS keyring for credentials, and an audit log that never records message text.

### Verification
- `npm test`: 1217 tests, passing on Node 24.6.0 and on Node 22.13.1, with no skipped or cancelled tests. The Python sidecar checks run when Python is present.
- No live Instagram call has been made. The live-phase checks are listed in the README under "Live-phase checks".

### Known limits
The README lists every known limit with its reason. The most important ones are: the live behaviour of the long-lived token exchange, the Facebook login bridge, the messages edge, the owner-check endpoint and the unofficial sidecar is unverified until a live test account is used.
