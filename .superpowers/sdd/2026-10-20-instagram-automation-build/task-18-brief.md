### Task 18: Verification and owner notes

**Files:** Create `README.md`. Update the status line in `docs/superpowers/specs/2026-10-20-instagram-cli-design.md`.

- [ ] **Step 1: Run `npm test`.** Expected: `# fail 0`.
- [ ] **Step 2: Run `node bin/ig.js --help`.** Expected: the commands are listed.
- [ ] **Step 3: Run the Python checks from Task 12.** Expected: exit 0 and `rate_limited`. If Python is not installed, record that they did not run.
- [ ] **Step 4: Write `README.md`.** Cover: setup (the `IG_<NAME>` variables and the config file); the safety model (caps, busy results, confirmation, the stop state, the owner check); the tool list; the poller as the inbound route, and how the webhook receiver can be served later behind a reverse proxy the owner runs; the device-identity rule (the unofficial clients send their default identity, and the project adds none); the app secret deviation from Meta's wording; the chosen MCP SDK and the chosen instagrapi version with its LICENSE; the Meta app in Development mode; and the publish-input decision.
- [ ] **Step 5: Add a section listing every fact still unverified** against live Instagram. Take the list from the spec's Open items and from the reports' open questions.
- [ ] **Step 6: Update the spec status** to "built; live phase pending".
- [ ] **Step 7: Report** the test counts and anything that did not run.
