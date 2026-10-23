# LIVE-PHASE.md — the plan for the checks that need a real Instagram account

**Status: PLANNED, NOT RUN.** Nothing in this file has been executed. Nothing contacts Instagram until the owner gives the go, supplies the account, and states the budget below.

Purpose: confirm, against a real test account, the items the build could only check in code or in the platform's documentation. Every item below is listed in the README under "Live-phase checks", and each one can fail. A failure is recorded as a finding, not hidden.

## 0. Prerequisites (the owner provides or decides each one)
1. **Explicit go** for the live phase, in one line.
2. **A second Instagram account** (a test account, not the owner's main account), with a Business or Creator type. The owner says which type.
3. **A Meta app in Development mode**, with the test account added as a tester, and the Instagram product configured. The owner confirms the app ID and that the redirect URI `http://127.0.0.1:8790/callback` is registered (and `http://127.0.0.1:8790/facebook-callback` for the Facebook check).
4. **A call budget**, stated in calls. The proposal is in section 3; the owner can change it. The retry ladder can multiply a call (a GET retries up to three times with 1, 2 and 4 second waits), so the budget counts requests actually sent.
5. **Consent per write.** Any write (a publish, a like, a reply, a DM) needs its own yes, given in the conversation at that moment. A standing yes does not cover a write.
6. **A scratch data directory** (not the owner's), set through the config's data-directory key, so the live run's state, events and audit never mix with anything real.
7. **Secrets for the test account only.** The test account's token enters through `ig auth set owner_token` (hidden prompt). Nothing is written to a file, and no owner value is used.

## 1. Rules that apply to every phase
- Phases run in the order below. A phase starts only when the previous one has passed or been consciously skipped.
- **Abort at once** on CHECKPOINT, ACTION_BLOCKED, RATE_LIMITED, a challenge, or any AUTH_EXPIRED. Do not retry. Record the kind and the time, and stop the run. The stop holds until the owner clears it.
- On any unexpected 4xx from a read, stop after that one call and record it.
- Every output is redacted. Tokens, the client secret and message text never appear in a log, a file or the terminal transcript kept in the repository.
- No writes outside the scratch data directory, except the requested Graph call itself.

## 2. The checks, in order

| Phase | Check | Calls (budget) | What it proves | Failure means |
| --- | --- | --- | --- | --- |
| 0 | `ig status` and a local config read | 0 | the local service starts; the stop state is clear | a local defect, fix before any call |
| 1 | Owner-account check: `GET /me?fields=id` | 1 | the owner-check endpoint and its response shape (README live item) | the owner check refuses to start serve; check the endpoint path and version |
| 2 | Profile and media read: `profileGet`, `mediaList` (limit 5) | 2 | the read paths return real data; the page shape | a shape mismatch: record the response shape without its values |
| 3 | Insights: `insightsAccount`, `insightsMedia` on one owned media | 2 | the metrics allowlist is accepted (`facebook_views` is unverified and is not requested) | an unsupported metric: record the name and the error |
| 4 | Comments on one owned media: `commentsList`, then `commentTimestamp` | 2 | comment paging and the comment timestamp field | a missing timestamp: the 7-day private-reply check refuses (fail closed) |
| 5 | Direct messages: `dmConversations`, then `dmMessages` on one conversation | 2 | the conversation list and the messages edge form (`fields`, `limit`, `after`) | the edge form is wrong: record the error; paging falls back to a visible limit |
| 6 | Long-lived token exchange as a POST (decision O-7) | 1 | that Meta accepts the POST form with the token in the header | a refusal: the failure is loud; the owner decides between the GET form (token in a URL, not allowed) and another route |
| 7 | Facebook bridge in a real browser (decision O-8), optional | 1 exchange | the fragment bridge reads the token and posts it back | a browser or redirect problem: record the page's behaviour |
| 8 | One publish from the owner's public host (decision O-13), **consent per publish** | 3 (container, poll, publish) | the HEAD check, the container, the publish and the digest in the audit line | a host refusal of HEAD: the one-byte Range fallback applies; record which answer came back |
| 9 | One like and one unlike on a named target, **consent per write** | 2 | the like login product (`routes.likes.loginProduct`) and the usage reading after a start | a refusal: record the code; the likes route stays off |
| 10 | Webhook verification (GET challenge), optional, needs a public HTTPS endpoint | 1 | the signature scheme and the challenge | not run unless the owner provides the endpoint |
| 11 | Unofficial sidecar: restore, one follow, one unfollow of a named target, **consent** and the owner's acceptance of the restriction risk | 3 | the instagrapi 3.1.0 login, restore and follow, and the error mapping | an account restriction: stop; the unofficial route stays off |

**Total proposed budget: about 20 calls, plus the write calls each consented per write.** The owner can cut any phase.

## 3. What is recorded, and where
- One results file per run in `orchestration/live/`, with the date, the Node version, the commit, each phase's status, its call count, and its error kinds. No values, no tokens, no message text.
- Each unverified README item moves to "verified" only with the phase that verified it.
- Anything that fails is listed as a finding with its exact kind and its phase.

## 4. What the live phase does not prove
- The account's standing with Instagram beyond the test run.
- Behaviour under load, or over days.
- The owner's real account. That needs its own plan and its own consent.

## 5. Sign-off
- The owner's go: approved in principle, 2026-10-23 ("i approve all"). Each write still needs its own consent at the time.
- The test account (type, handle to be given privately, never committed): not yet given.
- The call budget approved: about 20 read calls, 2026-10-23, plus each consented write.
- Phases approved: all, 2026-10-23, with two conditions: each write (phases 8, 9 and 11) needs its own consent at the time, and phase 11 needs an explicit restriction-risk acceptance, which is not yet given.
