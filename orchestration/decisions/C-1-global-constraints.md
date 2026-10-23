# C-1 — proposed wording for global-constraints.md (for the owner's decision)

**Status: PROPOSED.** The file `.superpowers/sdd/2026-10-20-instagram-automation-build/global-constraints.md` is the owner's rule file. It is not changed until the owner chooses. Nothing here is applied.

## Why this is open
The build differs from the constraint file in three places. Each difference is a decision the owner made or a reading the build chose, and the file should say which.

| # | Where | The file says | The build does | Why it matters |
| --- | --- | --- | --- | --- |
| 1 | Line 14, the event cursor | "Event cursor: opaque. `ig_events_ack` refuses any cursor that has not been issued, and it never moves backwards." | After a state loss the cursors reset to zero with a notice, so acknowledged events are delivered again with the same ids. | This is the owner-decided exception (2026-10-22, O-3 and the recovery work). Without the exception written down, the file misdescribes the build. |
| 2 | Line 6, the lookups | Lookups are not mentioned. | Business discovery and mentioned-media lookups each have a 50-a-day bucket, counted apart from the outbound total. Hashtag search has its own weekly bucket. | The buckets are a new limit the owner decided (O-4). The file should list them with the other caps. |
| 3 | Line 6, the auto-reply scope | "one per conversation per 24 hours" (as the spec states it) | One reply per sender per 24 hours, and 100 a day. | In direct messages a conversation is one sender, so the two readings almost always agree. They differ for a group conversation. The owner chooses. |

## Proposed wording

**Line 6, caps (replace the auto-reply rule and add the lookups):**
- Auto-replies, only when enabled: at most one reply per **sender** in any 24 hours, and at most 100 in a day. Each reply is sent only inside the 24-hour messaging window and through the caps.
- Lookups of other accounts (business discovery, mentioned media): at most 50 a day each, counted in their own buckets, never in the outbound total. Hashtag search: its own weekly bucket.

**Line 14, the event cursor (add the exception):**
- Event cursor: opaque. `ig_events_ack` refuses any cursor that has not been issued, and it never moves backwards. **Exception, owner-decided:** after a state loss, the cursors reset to zero, the next delivery carries a notice, and every event keeps its id, so the consumer must dedupe by event id.

## The choices for the owner
- **A.** Approve both replacements as written, including "per sender" for auto-replies.
- **B.** Approve the cursor exception and the lookups, but keep auto-replies "per conversation", and change the code to match the spec.
- **C.** Keep the file as it is, and accept that it misdescribes the build.

**Recommendation: A.** The code already does per sender, and the difference from a per-conversation rule only matters for group conversations, which the build does not send to.

## After the decision
If the owner chooses A or B, the change is made to the constraint file, and the working notes (Part I.7 and Part X) record the date and the choice. If B, the code change is a separate PATCH release, with its own test.
