# P1 review: auth flow (O-7 long-lived exchange, O-8 Facebook fragment bridge)

Reviewed: `review-p1.diff` (task-17-fix2-head to p1-head) and the live files it covers. Read in full: `src/oauth.js`, the auth parts of `src/cli.js` (lines 1-400, plus `startServe` and `runStatus`), `test/oauth.test.js`, and the auth tests in `test/cli.test.js`. Nothing was edited, the suite was not re-run, and no socket was opened.

The diff also holds changes from the final fix round (F-21 serve lock, the usage holder, the F-1 `createGuard` audit file, the webhook owner). Those are checked here only where the lock, the owner check and the ack command are concerned.

## Round verdict

**Findings remaining. Not PASS.**

New findings in this round: Critical 0, Important 2, Minor 10.

Must be fixed before PASS: I-1 (the owner's ruling 4 is not implemented) and I-2 (the login does not hold the serve lock while it waits).

## Checks

### O-7: long-lived exchange

- C1. Short-lived exchange is a POST; code and client secret are in the form body; URL has no query. ADDRESSED. `src/oauth.js:22` (constant URL), `:311-317` (form: client_id, client_secret, grant_type, redirect_uri, code), `:321-327` (POST, `redirect: 'error'`). Test `test/oauth.test.js:167-187` asserts no `?` in the URL and the code and secret in the body.
- C2. Long-lived exchange is a POST. ADDRESSED. `src/oauth.js:378-384`.
- C3. Short-lived token is only in `Authorization: Bearer`. ADDRESSED. `src/oauth.js:380`. The form at `:374` holds only `grant_type` and `client_secret`. Test `test/oauth.test.js:231`, `:235`.
- C4. `grant_type` and `client_secret` are in the form body. ADDRESSED. `src/oauth.js:374`. Test `test/oauth.test.js:233-234`.
- C5. Long-lived URL has no query string and no token. ADDRESSED. `src/oauth.js:23` is the constant `https://graph.instagram.com/access_token`. Test `test/oauth.test.js:226-229` asserts the empty search and that neither token nor secret is in the URL.
- C6. Tokens are registered before use. ADDRESSED. Short-lived token: `src/oauth.js:347`. Long-lived: `src/oauth.js:406`, and again `src/cli.js:305` on the injected path. Client secret: `src/secrets.js:104` registers on read, before `src/cli.js:279` uses it.

### O-8: Facebook fragment bridge

- C7. Authorize request uses `response_type=token` and carries only client_id, redirect_uri, response_type, scope, state. ADDRESSED. `src/oauth.js:168-177`. Test `test/oauth.test.js:323-331`.
- C8. Bridge page holds no token and no secret. ADDRESSED. `src/oauth.js:97-110` (status text and the script only). Test `test/oauth.test.js:333-349`.
- C9. Script reads the fragment and POSTs `access_token` and `state` as a form body to 127.0.0.1 only. ADDRESSED. Reads at `src/oauth.js:66-69`; body at `:77`; target `location.origin + '/facebook-token'` at `:78`. The origin is loopback because the server answers only Host `127.0.0.1:<port>` (`:460`) and only loopback peers (`:459`).
- C10. Page clears the fragment before posting. ADDRESSED. Read at `src/oauth.js:66-69`, `history.replaceState` at `:72`, `fetch` at `:78`.
- C11. Server accepts only that POST. ADDRESSED. `src/oauth.js:464-493`: GET on the bridge path returns the page (`:465-476`); other paths 404 (`:478-481`); non-POST on the token path 405 (`:482-485`); wrong content type 415 (`:490-493`).
- C12. Only with the expected state. NOT ADDRESSED. The comparison is correct (`src/oauth.js:500`, constant time), but the mismatch branch ends the login (`:501-504`). See I-1.
- C13. Only on loopback. ADDRESSED. Bind `src/oauth.js:560` (`LOOPBACK`). Peer check `:459` (127.0.0.1 and ::ffff:127.0.0.1). Host check `:460`. Test `test/oauth.test.js:387-400`.
- C14. Body size limit. ADDRESSED. `src/oauth.js:45` (4096 bytes), `:416-426` (readLimited), `:494-498` (413). Test `test/oauth.test.js:374-385`. See M-1 on whether the 413 reaches a real client.
- C15. A mismatched state keeps the login WAITING and stores nothing (F-19). NOT ADDRESSED. `src/oauth.js:501` sets `received = true` and `:503` calls `onResult(AUTH_EXPIRED)`, which ends the login (`:548`). Test `test/oauth.test.js:363-372` and `:469-483` assert the wrong behaviour. Nothing is stored (`src/cli.js:379` runs only after the Page check). See I-1.
- C16. Other refusals keep the login waiting (remote peer, Host, type, size, second approval). ADDRESSED. They reply without calling `onResult`: `src/oauth.js:460-463`, `:490-493`, `:494-498`, `:486-489`.
- C17. An approval that carries `error` ends the login with CONFIG. ADDRESSED (design). `src/oauth.js:506-512`. Test `test/oauth.test.js:413-420`.

### Secrets

- C18. No token or client secret in a URL. ADDRESSED. The URLs are constants (`src/oauth.js:22-23`, `:31`). The Bearer header is used on the exchanges and on the Page check (`src/graph/client.js:203`). The graph client refuses a token in a query or form (`src/graph/client.js:58`).
- C19. Not in a log, an audit line, an error or a returned object. ADDRESSED, with notes. `src/oauth.js` has no output call. `src/cli.js:63-64` logs only through `redact`. Every error message is built from a kind, an HTTP status, an error name or fixed text (`src/oauth.js:124`, `:129`, `:294`, `:330`, `:333`, `:340`, `:345`, `:387`, `:390`, `:396`, `:400`, `:404`, `:502`, `:515-517`). `refusedDetail` (`src/oauth.js:353-360`) keeps only a short word. `src/oauth.js:509` echoes the approval's `error` value, truncated to 64 characters; that is a provider error code, not a secret. `IgError` redacts message and details at construction (`src/errors.js:30`). The audit lines (`src/cli.js:330`, `:380`) carry no token.
- C20. Tokens registered with `registerSecret` on receipt, before use. ADDRESSED. `src/oauth.js:122-132` (`registerToken`, which refuses when registration fails), called at `:347`, `:406`, `:515`; also `src/cli.js:305`, `:356`.

### Failure

- C21. A failed exchange at any step stores nothing and names the step. ADDRESSED. `atStep` (`src/cli.js:238-246`). Steps at `src/cli.js:290-304` and `:355-369`. Storage happens only at `src/cli.js:311` and `:379`, after every step. The owner mismatch (`src/cli.js:295-297`) and the expiry check (`:302-304`) stop before storage without a step name, and say that nothing was stored.
- C22. Owner token and record are stored only after both exchanges and the owner check. ADDRESSED. `src/cli.js:295-318`.
- C23. Rollback when the record save fails. ADDRESSED, with M-3. `src/cli.js:311-329`. Test `test/cli.test.js:337-360`.

### Tests

- C24. No test listens. ADDRESSED. Every listen or server creation in `test/` is injected or stubbed:
  - `test/cli.test.js`: every `runAuthLogin` call (lines 283, 316, 342, 365, 370, 381, 409, 439, 468, 671) passes `listen`. Every `runAuthFacebook` call (500, 529, 548, 569, 582, 889) passes `receiveToken`. The lock test at 671 is also refused before `listen` (`src/cli.js:282`).
  - `test/oauth.test.js:455-492` and `:532-537`: fake `createServer` whose `listen()` is a no-op.
  - `test/http.test.js:349` (stubbed `listen`), `:829-843` (`Server.prototype.listen` replaced by a recorder, restored in `t.after`).
- C25. The retired test that listened on 8790 is gone. ADDRESSED. No `runAuthFacebook` call omits `receiveToken`. The "refuses before any browser step" test is absent (see the comment at `test/cli.test.js:494`). The ports 8788 and 8790 appear only as URL strings and config values (`test/cli.test.js:289-291`, `:514`, `:519`, `:650`, `:954`; `test/oauth.test.js:27`, `:291`, `:294`, `:317`).
- C26. No test spawns a network call. ADDRESSED. The only spawn is `node bin/ig.js --help` (`test/cli.test.js:122`).

### Unchanged behaviour

- C27. Owner check. ADDRESSED. `verifyOwnerAccount` (`src/cli.js:155-165`), `verifyOwner` (`:591-594`), `startServe` (`:625`). Tests `test/cli.test.js:823-883`.
- C28. Ack command. ADDRESSED. `runRoutesAck` (`src/cli.js:387-403`). Tests `test/cli.test.js:596-615`, and the lock refusal at `:665-694`.
- C29. Lock. ADDRESSED for serve (`readServeLock` `src/cli.js:183-195`, `acquireServeLock` `:199-213`, `startServe` `:620-642`; tests `test/cli.test.js:665-744`). NOT ADDRESSED for the login window: the login checks the lock and never takes it. See I-2.

### Fail-open paths

- C30. An exchange stores a token after a failed step. None found. ADDRESSED.
- C31. A state that is not checked. None found. The Instagram callback filters a wrong state before `onCallback` (`src/oauth.js:235-243`), and `parseRedirect` checks it again (`:206`). The bridge checks it at `:500`, but see I-1 for the mismatch path.
- C32. A page that accepts a POST from a non-loopback peer. None found. The bridge checks the peer and the Host (`src/oauth.js:459-460`). The Instagram callback is bound to loopback and has no method or Host check; see M-2.

## Findings

### I-1 (Important): a mismatched state ends the Facebook login

- Where: `src/oauth.js:500-504` (set `received`, then `onResult(AUTH_EXPIRED)`), `:548` (the timer and the finish path end the login on that result).
- Ruling: `progress.md` line 414, item 4, is REVERSED: a bad-state request keeps the login waiting (the F-19 rule). The implementer's report (P1 section, "Concerns for the owner") confirms the code does the opposite.
- Impact: any local process or page that reaches `127.0.0.1:8790` during the approval wait can end the login. The `received` flag is also set, so the real approval is then refused with 409 (`:486-489`). Nothing is stored, so this is availability, not fail-open.
- Fix: on a state mismatch, reply 403 without setting `received` and without calling `onResult`. Then change `test/oauth.test.js:363-372` and `:469-483`, which assert the wrong behaviour, to assert that the login is still waiting, and add a test that a mismatched POST followed by a matching one is accepted.

### I-2 (Important): the login does not hold the serve lock during its wait

- Where: `src/cli.js:282` checks the lock once, before the browser step. Nothing takes it in `runAuthLogin`. `acquireServeLock` runs only in `startServe` (`src/cli.js:620`).
- Impact: an `ig serve` started during the approval wait (up to five minutes, `src/oauth.js:47`) is not refused. The login then calls `state.save()` (`src/cli.js:318`, `src/state.js:153-161`) with the image it loaded at start (`bin/ig.js:88`). That overwrites what the running serve saved in the meantime, which can drop a persisted stop (the STOP key that `src/guard.js` persists) or the token record. A dropped stop comes back only if the process restarts without a save, which is a fail-open.
- The report (P1 section) says the lock "does not depend on a network answer, so it has no probe residual". That is not accurate: the residual is the same as the probe's, a serve started after the check is not seen.
- Fix: take the lock when the login starts (`acquireServeLock(dataDir)`) and release it in a `finally`. The tests that inject `serveLock` remain valid. Add a test that the lock file exists while the approval is pending and is gone after the login ends.

### Minor findings

- M-1 (`src/oauth.js:416-426`, `:494-498`). `readLimited` returns early from `for await`. Node destroys a request when such a loop exits early, so the 413 may not reach the client on a real server. The fake requests in the tests cannot show this. The limit itself holds. Live check; if it is confirmed, read the body to the limit and discard it, or reply 413 before reading.
- M-2 (`src/oauth.js:458-493`, `:219-251`). The bridge POST has no `Origin` or `Sec-Fetch-Site` check, so a cross-site form POST reaches the handler. Whether the browser sends it depends on its private-network rules (live check). After I-1 is fixed only a matching state is accepted, so the impact is small. The Instagram callback accepts any method. Both are bound to loopback. Suggested: reject a request whose `Origin` is present and not the loopback origin, and whose `Sec-Fetch-Site` is not `same-origin`; on the callback, accept GET only.
- M-3 (`src/cli.js:250-257`, `:311-329`). The rollback removes the owner token entry. On a re-login, that entry held the previous, working token, and it is not restored. A failed re-login therefore leaves no owner token, and the next `ig serve` refuses (`src/cli.js:534`). Fail-closed, but it destroys the working token. Suggested: read the old value first and restore it on rollback.
- M-4 (`src/cli.js:330`, `:380`). The audit line is written after the keyring write. If it throws, the login reports an error although the token is stored, and no message says so. Suggested: say so, or write the audit line before the store.
- M-5 (`src/cli.js:199-213`). Stale-lock takeover checks, then removes, then creates. Two starts that both see a stale lock can both take it: one removes the other's new lock. Narrow, but it is the one case the lock exists to prevent. Suggested: rename the stale lock to a unique name before the exclusive create, or re-read after the removal.
- M-6 (`bin/ig.js:119-123`, `src/cli.js:504-507`, against `src/cli.js:620`). The lock is taken in `startServe`, after `buildServe`. `createGuard` can save a STATE_LOST stop (`src/guard.js:182-183`, `persist` at `:169`) during `buildServe`, before the lock check. A second `ig serve` can therefore write the state before it is refused. Edge case. Suggested: take the lock at the top of `ig serve`, before `buildServe`.
- M-7 (`bin/ig.js:103`, `:101-109`). The help text says "(not approved yet: refuses)", which is no longer true. `auth facebook` has no `--port` option, while `auth login` has one (`bin/ig.js:82`). `runAuthFacebook` always uses `REDIRECT_PORT` (`src/cli.js:344`). Fix the text, and add `--port` if the redirect is meant to be configurable.
- M-8 (`src/cli.js:316`). The token record's `scopes` are the scopes requested, not the scopes Meta granted. Suggested: record the granted scopes if the exchange returns them, or name the field as requested.
- M-9 (`src/oauth.js:328`, `:385`). Both token exchanges read the response with `res.text()` and no size limit. The Page check goes through the graph client (`src/cli.js:368`). A very large response would be read in full. Suggested: a size cap, as on the bridge.
- M-10 (`src/cli.js:379`). The `facebook_token` is stored as returned by the approval. No expiry is recorded and no refresh path exists. The implementer lists its lifetime as unconfirmed (report, open item 7). Live check; the record of its expiry should be decided before P2 relies on it.

## Claims in the implementer's report, checked

- A wrong-state POST ends the login with AUTH_EXPIRED: confirmed (I-1).
- The retired test that listened on 8790 is gone: confirmed (C25).
- The lock "has no probe residual": not accurate (I-2).
- `buildAuthorizeUrl` and `parseRedirect` are unchanged in behaviour: confirmed. The shared checks moved into `checkAuthorizeInputs` (`src/oauth.js:140-151`) with the same conditions.
- The long-lived URL has no query and the tests assert it: confirmed (C5).
- The owner check, the ack command and the lock tests still exist and cover their behaviour: confirmed (C27 to C29).
- Suite 786/786: not re-run, as instructed.

## Not verified here

- Meta accepts the long-lived POST and the Instagram authorize host (live checks, O-7 and report item 2).
- `response_type=token` is allowed, the redirect URI is accepted, and the bridge page's script and CSP run in a real browser (live checks, O-8).
- The 413 path on a real HTTP server (M-1).
- The Facebook token's lifetime (M-10).
