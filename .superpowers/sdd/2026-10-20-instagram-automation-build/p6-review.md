# P6 review: media publishing from media.dir (O-13)

Scope: the P6 publishing code at p6-head. The live files (media.js, config.js, service.js, tools.js and the nine P6 files) are byte-identical to `snap/p6-head`, which the diff was taken from. The review is read-only: no project file was edited, git was not run, and the suite was not re-run (the report's 1146 is not verified here). A Windows probe ran `fs.realpath` on existing project paths only.

Round verdict: findings remaining (Minor only).
New findings: Critical 0, Important 0, Minor 9.

---

## Verdicts on the brief's checks (a) to (l)

| Check | Verdict | Where | Note |
|---|---|---|---|
| (a) path checks before any read; containment on real paths | ADDRESSED | media.js:182-197 (syntax, pure), 214-233 (realpath of media.dir and file, containment) | Mixed separators split at media.js:188. Encoded `%2e%2e` is a literal name, and the URL encodes it again (media.js:206), so the host sees a literal name too. A sibling such as `media-evil` fails `relative()` (test endpoints-media.test.js:737-744). A symlink to outside is refused (test :727-735). Probe: `media.js.`, `media.js `, `..  ` and `...  ` segments do not resolve (ENOENT), and letter case is canonicalized. The containment check on the canonical path is the backstop. Limit: path-based, see M-4. |
| (b) extension by kind; image story needs story.images; video story .mp4 or .mov | ADDRESSED for files | media.js:193-194 and 234-236 (the real file's extension, so a link named .jpg to a .mp4 is refused), 25 (video extensions), 397-410 (storyKindOf), 444-447 (story branch) | A .jpg story with the flag off becomes a video kind and is refused by name before any read (media.js:193; tests endpoints-media.test.js:1021-1030, service.test.js:2355-2362). Direct URLs have no extension check, as for image and reel before P6; the gate is the HEAD Content-Type (media.js:306-312, 372). See M-8. |
| (c) size limits from the stat before the hash | ADDRESSED | media.js:23-26 (8 MiB, 100 MiB), 239 (stat), 243-247 (regular, non-empty, limit), 248 (hash) | The size check runs before sha256File. Boundary test at endpoints-media.test.js:754-787. Gap: no test asserts an oversize file is never opened, see M-6. |
| (d) URL = publicBaseUrl + encoded segments; no query, no token; https, no query or fragment; trailing slash removed | ADDRESSED | media.js:205-207; config.js:159-183 (https at 177, no credentials at 177, no `?` or `#` at 168, trailing slashes removed at 169, round-trip check at 181); config.js:225-227 (checkSections) | The default null survives a user file that omits the key (merge, config.js:78-86). |
| (e) HEAD: 2xx; type image/* or video/*; Content-Length equal when present; 405/501 fall back to a one-byte GET with the same checks; other failure refuses; no container request before | ADDRESSED, with two notes | media.js:293 (405, 501 only), 297-303 (send failure refuses), 305-312 (type; a missing type is '' and refuses), 316-321 (digits and equal to size), 335-359 (ranged GET), 365-375 (HEAD). Ordering: service.js:1235-1238 (resolveMedia before requireQuota, the first Graph request) | Ranged GET: type checked (341); 206 needs `bytes 0-0/<total>` with total equal to size (343-348); 200 needs Content-Length equal to size, or refuses when absent and size known (350-355); other statuses refuse (338-340). Notes: a HEAD 2xx with no Content-Length is accepted with no size check (spec-allowed, the report's known limit 4). A 403 to HEAD is not a fallback status, so a host that refuses HEAD by policy is refused (M-3). |
| (f) GET fallback: no token; one byte; redirects | ADDRESSED | media.js:298-299 (`redirect: 'error'`, so no redirect is followed to any host), 336 (headers `{ Range }` only), 324-330 and 357 (body cancelled, never read) | It is stricter than "one byte": no byte is read. Test endpoints-media.test.js:904-918 asserts the headers and `redirect: 'error'`; :921-936 asserts the body is cancelled. |
| (g) chunked digest; audit carries digest, kind, outcome; no caption; no path beyond the relative name | ADDRESSED | media.js:253 (1 MiB), 258-290 (chunked read, one buffer); service.js:670-673 (`file <name> sha256 <hex>`, null for URL-only publishes), 130-134 (errorDetail: kind and Graph code only), 769 (ok line), 755-761 (error line); audit.js:179 (JSON.stringify, so a newline in a name cannot split a line) | Tests service.test.js:2260-2315 (AUD2, AUD3, AUD4). |
| (h) no token in any URL the code builds; HEAD and GET use only the configured URL | ADDRESSED | media.js:205-207, 366 (HEAD headers `{}`), 336 (GET headers `{ Range }`) | Tests service.test.js:2169-2177 (P6-9), endpoints-media.test.js:789-798, :904-918. |
| (i) missing publicBaseUrl with a file is CONFIG, before any read | ADDRESSED | media.js:172-177 (requireBase), 419 (carousel files), 458 (single source), 216 (before realpath at 220); service.js:1227 (checkPublish before any read) | Tests service.test.js:2084-2090 (P6-2), endpoints-media.test.js:894-900. |
| (j) direct url input also gets HEAD | ADDRESSED | service.js:643 (single), 655-662 (carousel items through the same sourceUrl) | Test service.test.js:2162-2167 (P6-8). |
| (k) order: checks before the first Graph request; owner, caps and usage gates not bypassed | ADDRESSED | service.js:1227 (checkPublish), 693-694 (stop, route), 700-701 (client; preview returns here, so no file read and no request), 706-711 (early caps and usage hold), 712-714 (preflight: resolveMedia, then requireQuota), 721-729 (authoritative stop, caps, usage), 730 (caps.record), 738 (perform) | Compared with p5b-head: the same order, with no owner check in either. P6 adds resolveMedia (HEAD checks) before requireQuota, which is still before any count and any write. Tests P6-4, P6-5 and P6-13 assert no count and no container request. |
| (l) fail-open paths | No fail-open found | media.js:297-303 (send failure refuses), 308-310 (missing type refuses), 243-247 (size before the hash), 230-233 (outside refused) | Limits that are not fail-opens: a HEAD 2xx with no Content-Length (spec), path-based containment (M-4), and a host file that may differ from the hashed file (the report's known limit 3). |

---

## Findings

No Critical or Important finding.

**M-1 (Minor) media.js:306-311.** The refusal message echoes the Content-Type of the remote answer, with no length limit. On a direct URL that answer comes from a host the caller chose, and the message is returned to the calling agent, so it is a channel for injected text. Fix: report a fixed word, or a truncated value limited to a short token set (for example `[a-z0-9/.+-]`, at most 40 characters), or no value.

**M-2 (Minor; outside the brief's checklist) media.js:365-375, 297-303; service.js:643.** A direct URL now makes the owner's machine send a HEAD and, on 405 or 501, a Range GET to any https host the caller names. Before P6 only Graph fetched it. There is no address guard (loopback, private, link-local). Reach is limited: Node's fetch checks the certificate against its default trust store, so a target needs a publicly trusted certificate unless the process uses a system or extra CA option. The status and Content-Type echo (M-1) make it an oracle. Rated Minor for those reasons. The controller may want an address guard: resolve the host and refuse loopback, RFC 1918, link-local, multicast and unique-local addresses, and check the connected address to cover DNS rebinding.

**M-3 (Minor; behaviour change) media.js:293, 365-371.** A direct URL signed for GET only (a presigned object-store link is one example; not tested live) answers HEAD with 403 and is now refused. Before P6 Graph fetched such URLs. It is fail-closed and follows the brief, but it removes a working input. Fix: document it in the README (P7), so the owner hosts files under media.publicBaseUrl or uses a URL that answers HEAD.

**M-4 (Minor) media.js:226, 239, 248.** The containment check is on path strings, and the open happens later. A writer with access to media.dir could swap a component for a symlink, or a FIFO, between realpath or stat and open. Hard links are not detected (stat `nlink` is not checked, and no test covers it). The effect is limited: the local bytes are only hashed and sized, and Graph fetches from the owner's host, so this gives a wrong digest or size, or a stalled open, not a content leak. Fix: open first, then `fstat` the handle, refuse `nlink !== 1`, and compare the handle's identity with the checked path.

**M-5 (Minor) media.js:205-207 against 226 and 249; service.js:641.** The URL is built from the spelling the caller gave, while the digest and size describe the canonical file. The probe showed realpath canonicalizes letter case, so `SRC/Graph` and `src/graph` name the same file here. A case-sensitive host would refuse the URL (fail closed), and a case-insensitive one serves the same file. Trailing-dot and trailing-space spellings do not resolve at all. The practical mismatch is small. Fix: build the URL from `relative(rootReal, real)` so the URL, digest and size describe the same file.

**M-6 (Minor; tests) endpoints-media.test.js:754-787 and service.test.js:2213-2222; endpoints-media.test.js:841-849.** No test asserts that an oversize file is never opened or hashed. Moving the hash ahead of the size check would still pass. The redirect test throws a TypeError rather than returning a real 3xx, so no test covers a 3xx answer to HEAD or to the fallback GET. Fix: assert that `fs.calls` has no `open` or `read` for an oversize file, and add HEAD and fallback tests for 301 and 302.

**M-7 (Minor; decision to confirm) media.js:397-410, 524-538; service.js:616-619.** Spec line 135 says "Build only if the spike confirms it" for an image story, and plan line 205 says "The image story path is not built until the spike confirms it." Round 2 built the image path behind `story.images` (default false). The brief requires that flag, so the code follows the brief, but it conflicts with the spec and plan. Nothing ships enabled. The controller should confirm the decision and record it in the decisions file.

**M-8 (Minor; wording) tools.js:337; media.js:446 with 306-312.** The tool description says ".mp4 or .mov for a reel or story", which is wrong when `story.images` is on (a .jpg or .png story is then accepted). A direct .jpg story with the flag off is refused by its HEAD Content-Type, and the message does not mention `story.images`. Fix: word the description ("for a story: .mp4 or .mov, or .jpg or .png when story.images is true"), and name the flag in the refusal for an image-looking story.

**M-9 (Minor; audit) service.js:1227 and 712-717.** A refused publish (bad path, traversal attempt, missing base, HEAD refusal, quota) writes no audit line, because checkPublish and the preflight throw before the audit point. This matches the other pre-count refusals in the service, but a refused traversal attempt is recorded nowhere. Controller decision: whether refused file paths should be audited, with the relative name only and no digest.

---

## Other checks from the brief and the owner decision

- O-13: no upload route in `src/` (checked). The URL is built from `media.publicBaseUrl`. The HEAD check runs before any publish. Path traversal is refused.
- Global constraints: no token in a URL, a log, an audit line or a tool result (checked in the code paths above; the only remote text that reaches a result is M-1).
- No test makes a network call: every service-level publish test goes through `setup`, which injects `mediaFetch` (service.test.js:235-250). The tools test uses a fake service (tools.test.js:430-446).
- Gate order against p5b-head: checkPublish before runOutbound, no owner check, and the quota read in the preflight, all unchanged. P6 adds the file and HEAD checks ahead of the quota read.

## Not verified

- No live HTTP. The HEAD and fallback behaviour against a real host, the presigned-URL case (M-3), and Node's `redirect: 'error'` on a real 3xx were not run.
- The Windows probe covered `realpath` on existing project paths only. Hard links (M-4) were not tested.
- The suite was not re-run, so the 1146 count and the reverse-mutation results in the report are taken as claims.
