# Hosted Instagram data and automation services compared with the owner's self-run design

Date: 2026-10-20.

Scope: hosted, third-party Instagram data and automation services and APIs, compared with the self-run design in [design spec](file:///D:/Projects2/InstagramApi/docs/superpowers/specs/2026-10-20-instagram-cli-design.md). Builds on the first round: [report](file:///D:/Projects2/InstagramApi/reports/Instagram%20CLI%20automation%20landscape.md) and [inventory](file:///D:/Projects2/InstagramApi/research_notes/Instagram%20CLI%20automation%20landscape/existing_tools_inventory.md).

Labels: **verified** means read from a repository file (GitHub tool) or a local project file. **fetch summary** means a WebFetch paraphrase of a public page; quotes need checking on the live page. **unverified** means a search snippet or a claim from a source that was not opened. First-round facts keep their first-round sources. Its WebFetch reads of Meta's terms count as fetch summaries here, although the first round tagged them verified (its conflict 25 says so).

Limits: 15 research calls (the researcher-brief cap). No service endpoint was called, no account was created, and no credential or personal data was sent. Not reached: the RapidAPI listings, Phantombuster's own pages, HasData's privacy policy and terms, Phyllo's privacy policy and terms, Apify's terms of use, and the live Instagram Terms of Use.

Bottom line: the owner's two rules leave no hosted service in this set that can run as a live component. Vendors that take a password, cookie or token fail the credential rule. Public-data scrapers, including both MCP servers, fail the scraping rule, because scraping other people's data is what they sell. The only usable complement is reference reading, such as HasData's MIT repository, plus the official route the design already uses. Several facts stay unverified, because the live Instagram Terms and some vendor policy pages were not reached.

### Table A: access and scope

| Service | Type and status | Surfaces covered | Public data only, or acts on accounts | Asks for Instagram password, cookies or tokens |
|---|---|---|---|---|
| HasData/instagram-mcp | Hosted remote MCP server over HasData's scraper API. MIT per README badge. Repo created 2026-08-21, 16 stars ([first round](file:///D:/Projects2/InstagramApi/research_notes/Instagram%20CLI%20automation%20landscape/existing_tools_inventory.md)). [README](https://github.com/HasData/instagram-mcp) (verified) | Public profile by handle; public post feed, 12 per call with paging; comments on a public post or reel. The README prose and badge say two tools, but its tool section names three: profile, posts and comments (verified) | Public data only. "It does not act as an account." No publishing or messaging (verified, [README](https://github.com/HasData/instagram-mcp)) | No Instagram credential. Needs a free HasData account and API key, sent as `x-api-key` (verified). Clients with OAuth can add the URL as a connector and sign in instead of keeping the key in a config file (verified) |
| storiesig-info/instagram-mcp | Hosted MCP server (Streamable HTTP) run by StoriesIG, a story viewer and downloader site that says it is "not affiliated with Instagram or Meta". No license detected (first round). [README](https://github.com/storiesig-info/instagram-mcp) (verified) | 12 tools: profile, account search, posts, one post, video download in every quality with "No watermark", comments, post likers, followers, following, live stories, one story, highlights (verified) | Public content only; "All tools are read-only" (verified). Its tools return other accounts' follower, following and liker lists, and their media (verified) | No Instagram login (verified). OAuth to StoriesIG: "a sign-in window opens the first time you connect". The README does not say what account that creates (verified) |
| Apify, apify/instagram-scraper | Hosted actor, pay per result. The page calls it an "unofficial Instagram API" and holds text addressed to AI agents, which was ignored. [Actor page](https://apify.com/apify/instagram-scraper) (fetch summary) | Posts including carousels, reels, comments (replies on paid plans only), posts tagging an account, profile details, hashtag stats, places and media links; keyword search. Follower and following lists are a separate actor (fetch summary) | Public data. "It does not access private content." It reads the logged-out page (fetch summary) | No Instagram username, password, cookie or session field on the page. Its MCP server uses Apify OAuth, or an Apify API token. Using it needs an Apify account (fetch summary) |
| RapidAPI Instagram listings (category) | API marketplace. Not evaluated: no listing was read, and the [RapidAPI search page](https://rapidapi.com/search/instagram) returned only "API Hub" (fetch summary) | Snippets only (unverified): a June 2024 tutorial built on an "Instagram Scraper 2023" RapidAPI API that fetches a user's posts and who liked a post ([Medium tutorial](https://apiharbor.medium.com/building-an-instagram-api-client-in-python-30b5ec3da35d), URL from the same search, match not confirmed). A PHP package needs a RapidAPI key ([Packagist](https://root.packagist.org/packages/angeljunior/instagram-scraper)) | Unknown. Snippets describe third-party scrapers (unverified) | Unknown. A RapidAPI key is likely (unverified) |
| Phyllo | Hosted creator-data API. Creators connect through Meta. Usage-based pricing with a free trial and API sandbox ([Phyllo](https://www.getphyllo.com/instagram-api)) (fetch summary) | Two routes (fetch summary). A Graph API route for Business or Creator accounts linked to a Facebook Page, with impressions, reach and audience demographics. An "IG Direct" route, described for non-professional accounts with more limited data. A Phyllo blog snippet says public profile data can be read without creator login (unverified); the product page does not say so | Reads connected creators' data. No write action on the page (fetch summary) | Yes, a token. The creator types the Instagram password into Meta's OAuth screen, which Meta hosts. "Phyllo receives the authorization token" and "manages all token refreshes automatically" (fetch summary). Whether Phyllo keeps credentials is not stated |
| Phantombuster | Hosted automation platform (search results only; unverified). Its help pages and terms were not read. Its [cookie policy](https://phantombuster.com/cookie-policy) appears in results | Instagram automations. A third-party listing describes an automated-liking workflow (unverified) | Acts on accounts, per snippets (unverified) | Session cookies, per snippets (unverified): a Connect button fills a session-cookie field, and the browser add-on can collect cookies of sites the user is signed into ([add-on page](https://addons.mozilla.org/addon/phantombuster/)). A third-party listing uses a CSV of session cookies and credentials for several services (unverified) |
| Baseline, not hosted: Meta Instagram Platform on the owner's own app | Official API, self-run in the design ([design spec](file:///D:/Projects2/InstagramApi/docs/superpowers/specs/2026-10-20-instagram-cli-design.md)) (verified, local design) | Publishing, comment moderation, mentions, insights, messaging inside 24 hours, likes from April 22, 2026, and no documented follow endpoint ([overview](https://developers.facebook.com/documentation/instagram-platform/overview)) (first round; fetch summary). Personal accounts are not served (design; first round) | Acts on the owner's account through the Graph API | The owner logs in to Meta once to authorize the owner's own app. The token stays in the OS credential store (verified, local design, decision H). No third party holds it |

### Table B: data, terms, pricing and reliability

| Service | Data handling and retention | Pricing model | Terms on automation and Meta's rules | Reliability signals |
|---|---|---|---|---|
| HasData | Live fetch per call, with no replay of a stored copy (verified). Results that carry data include "html and json links to the stored artifact of that exact call" (verified). The README gives no retention period for those artifacts or links. Privacy policy not read | Free: 1,000 credits a month, no card, about 100 calls. 10 credits per successful call. Paid from $59 a month for 200,000 credits; $2.95 per 1,000 calls on entry, $1.19 on Basic, $0.83 across Growth (verified, [README](https://github.com/HasData/instagram-mcp)). The [pricing page](https://hasdata.com/prices) it links was not read | "You are responsible for how you use the results, including compliance with Instagram's terms and with the law that applies to you" (verified). The README says the server's questions are "about a handle you do not own" (verified; the vendor's own words). Terms not read | Repo created 2026-08-21, 16 stars (first round). Tests run on every push and weekly in CI (verified). No changelog or status-page link in the README. Company age not checked |
| StoriesIG | Privacy policy, effective June 1, 2021, with no last-updated date (fetch summary, [policy](https://storiesig.info/en/privacy-policy/)). No retention periods; logs and cookies retention absent. Shared with affiliates, unnamed service providers, analytics partners, and ad partners (location, browser and cookie data). Non-personal data may go to "interested third parties". No mention of Instagram credentials or tokens (fetch summary) | Free trial: 50 requests, no card. Pro: 50,000 requests a month for $50. Ultra: 250,000 for $150. Mega: 1,000,000 for $250. "Hard limits, no surprise overage" (verified, [README](https://github.com/storiesig-info/instagram-mcp)) | Terms, effective June 1, 2021 (fetch summary, [terms](https://storiesig.info/en/terms-of-use/)). Bars "any automated or non-automated 'scraping' methods" to access the Service, and bots or spiders. Users must have "all necessary permissions to access and download third-party content". No reference to Instagram or Meta terms. "Your use of the Service is at your own risk." Liability cap $100 | Glama endpoint-health badge; listed on Smithery and the official MCP Registry (verified, README). Structured data gives a 2019 founding date for the company (fetch summary). No changelog or status page read |
| Apify | Privacy policy, last updated July 9, 2026 (fetch summary, [policy](https://docs.apify.com/legal/privacy-policy), reached by redirect from apify.com/privacy-policy). No retention period for run data, datasets, logs or account data. Personal data users manage on the platform falls under a processor exclusion, with the addendum not included. Actor creators "may receive or have access to Personal Data". Hashed contact details go to ad platforms (Google, LinkedIn, X, TikTok). Instagram and Meta not mentioned | Pay per result, per 1,000 results: Free $2.70; Starter $2.30; Scale $1.90; Business $1.50 (fetch summary). Compute-unit rate and subscription fees not shown | Actor page: "only collects data that is publicly available on Instagram" and "Only scrape data if you have a legitimate reason." No reference to Instagram's terms or Meta's rules on the page (fetch summary; a live check is needed to confirm the absence). Apify disclaims responsibility for its customers' privacy practices (fetch summary). Apify terms of use not read | Page shows 437,508 total users, 53,974 monthly users, a 100% run success rate and a 4.67 of 5 rating (fetch summary; vendor-displayed). Changelog is external, with no version or date on the page |
| RapidAPI listings | Not read | Not read | Not read. The dated items found are a 2021 RapidAPI blog post and a 2024 tutorial (search results; unverified) | Only old snippets (unverified). No 2026 listing data found |
| Phyllo | No retention, deletion or sharing statement on the page. It says IG Direct helps accounts "authenticate and share their data with your app" (fetch summary). Privacy policy and terms are linked in the footer, not read | "Usage-based pricing" and a free trial with API sandbox; no prices on the page (fetch summary) | No Meta compliance claim on the page; tokens "follow Meta's standard token lifecycle" (fetch summary) | A "SOC Compliant" footer link, not explained on the page (fetch summary). No changelog or status page read. Its IG Direct claim conflicts with the first round's reading (see Key question 1) |
| Phantombuster | Cookie policy exists (search result; not read). Data handling not read | A third-party listing says one automated-liking workflow needs a Growth plan (unverified) | Terms not read. A third-party listing claims lower ban risk for its workflow; not assessed (unverified) | Two Chrome Web Store reviews, unverified, describe a blocked account and a stretch when the extension stopped working. No status page checked |
| Baseline (Meta) | The owner's token sits in the OS credential store, with no third-party copy (verified, local design, decision H) | Not checked in this round | Platform Terms bar apps from "separately request or collect a Meta user's login credentials" and from reverse engineering (first round; fetch summary, [terms](https://developers.facebook.com/terms/)). Developer Policies bar bots "at very high frequencies" (first round; fetch summary, [policies](https://developers.facebook.com/devpolicy/)). Instagram Terms clause unverified (Key question 3) | Tokens last 60 days and have refresh rules (first round, verified). Expired tokens return error 190 (first round; fetch summary) |

### Other vendors found by search (snippets only, not evaluated)

- Scrapingdog: hosted scraper API with a 30-day trial and 1,000 free credits, no card (search summary, unverified). [Scrapingdog](https://www.scrapingdog.com/?p=23640)
- Influencers.club: claims coverage of more than 340 million Instagram creators (vendor claim in a search summary, unverified). [Influencers.club](https://influencers.club/instagram-api/)
- Later Influence: its help article says that as of March 2026 Instagram Login alone suffices for campaign applications and insights, while the marketplace API still uses Facebook Login (search summary, unverified). [Later help](https://help-influence.later.com/hc/en-us/articles/20462372546455)
- Apify actors apidojo/instagram-scraper and Instagram API Scraper: $0.50 per 1,000 posts, and $39 a month after a 30-day trial (search summaries, unverified). [apidojo actor](https://apify.com/apidojo/instagram-scraper?fpr=97nrp4); [Instagram API Scraper](https://www.apify.com/apify/instagram-api-scraper/changelog)
- HikerAPI: named in the instagrapi README (first round; not checked here). [instagrapi](https://github.com/subzeroid/instagrapi)
- Meta Creator Marketplace API: Facebook Login, with advanced access for discovery (search snippet; Meta's page not fetched). [Meta page](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-facebook-login/creator-marketplace)

## Key question 1: Which services need the owner's Instagram login, and what would the owner have to hand over?

### Takeaway
None of the hosted services read this round asks for the owner's Instagram password. HasData, StoriesIG and Apify need only a vendor key or vendor sign-in; Phyllo takes a Meta access token from the owner; Phantombuster is unresolved, and its snippets say session cookies.

### Cited Findings
- HasData needs no Instagram account; its only credential is a HasData API key sent as `x-api-key`. [README](https://github.com/HasData/instagram-mcp) (verified)
- StoriesIG: "no Instagram login", with OAuth to StoriesIG ("a sign-in window opens the first time you connect"). [README](https://github.com/storiesig-info/instagram-mcp) (verified)
- Apify: no Instagram login field on the actor page; its MCP server uses Apify OAuth or an Apify API token. [Actor page](https://apify.com/apify/instagram-scraper) (fetch summary)
- Phyllo: "The creator enters their Instagram username and password directly into Instagram's OAuth screen," which Meta hosts. "Phyllo receives the authorization token" and "manages all token refreshes automatically". [Phyllo](https://www.getphyllo.com/instagram-api) (fetch summary)
- Phantombuster: search summaries say a Connect button fills a session-cookie field, and the browser add-on can collect cookies of signed-in sites. [add-on page](https://addons.mozilla.org/addon/phantombuster/) (unverified)
- Self-run unofficial tools that take a password or session cookie, from the first round's repo-level reads: dilame reads `IG_USERNAME` and `IG_PASSWORD` from the environment ([dilame](https://github.com/dilame/instagram-private-api)); jlobos takes username and password ([jlobos](https://github.com/jlobos/instagram-web-api)); trypeggy keeps the password in `.env` ([trypeggy](https://github.com/trypeggy/instagram_dm_mcp)); official-Arvind accepts a session cookie or username and password, with 2FA ([official-Arvind](https://github.com/official-Arvind/instagram-mcp)). (first round; repo-level read)
- HasData's own comparison describes "engagement-analysis servers" that ask for `INSTAGRAM_USERNAME` and `INSTAGRAM_PASSWORD` in an env block. [README](https://github.com/HasData/instagram-mcp) (verified; the vendor's characterization, not checked)
- Baseline: the owner's own route needs the owner to log in to Meta once, to authorize the owner's own app. Instagram Login needs a professional (Business or Creator) account ([Overview](https://developers.facebook.com/documentation/instagram-platform/overview)) and an Instagram User token ([Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)) (first round; verified). The token stays in the OS credential store ([design spec](file:///D:/Projects2/InstagramApi/docs/superpowers/specs/2026-10-20-instagram-cli-design.md), decision H) (verified, local design).

### Inferences
- For Phyllo, the owner would hand over the Meta access token, not the password. The vendor then holds a usable credential for the owner's account until it is revoked or expires. That fails the owner's rule that credentials never go to a third party, since the design treats tokens as credentials (decision H). (judgment)
- A session cookie gives its holder the owner's logged-in session, so handing one over is in effect handing over the login. (judgment, from general knowledge; not sourced)
- The rule's reach is ambiguous. If "credentials" covers vendor API keys, HasData, StoriesIG and Apify also fail it. If it covers only Instagram credentials, all three pass that rule and fail the scraping rule instead (Key question 4). The owner should decide which reading applies. (judgment)

### Gaps
- RapidAPI listings: no listing was read, so their credential requirements are unknown.
- Phantombuster: no vendor page was read; the cookie requirement rests on search summaries.
- StoriesIG OAuth: the README does not say what account the sign-in creates. The privacy summary quotes "No account required" (fetch summary), which should be checked against the live sign-in screen without connecting an account.
- Phyllo's IG Direct route: Phyllo describes it for non-professional accounts (fetch summary). The design and the first round say the official API does not serve personal accounts (verified, local design; first round). This is unresolved; check Meta's Instagram Platform overview for personal accounts in the live phase.
- Phyllo's blog snippet says public profile data can be read without creator login (unverified). The product page does not say so (fetch summary).

## Key question 2: Which services only read public data, and what can they do for the owner without credentials?

### Takeaway
HasData, StoriesIG and Apify read public data only and take no action on accounts. Without credentials they return other people's public profiles, posts and comments (StoriesIG also lists followers, likers and stories, and downloads media), which the owner's rules exclude, and they cannot reach the owner's own non-public data at all.

### Cited Findings
- HasData profile tool: follower and following counts, bio, verified flag and the twelve most recent posts. Posts tool: 12 per call, paged with `nextPageToken`. Comments tool: comments with authors, likes and timestamps on a public post. [README](https://github.com/HasData/instagram-mcp) (verified)
- HasData, private accounts: the call "still returns its header, the follower and following counts and a `private: true` flag, but no biography and no posts". [README](https://github.com/HasData/instagram-mcp) (verified)
- StoriesIG: profile, account search, posts, one post, video download "in every available quality" with "No watermark", comments, post likers, followers, following, live stories, one story and highlights. "All tools are read-only and work with public content only." [README](https://github.com/storiesig-info/instagram-mcp) (verified)
- Apify: posts, reels, comments (replies on paid plans only), profile details, hashtag stats and places. "It does not access private content." Follower and following lists are in a separate actor. [Actor page](https://apify.com/apify/instagram-scraper) (fetch summary)
- The owner's own account data needs the owner's token even for reads. The profile read is official for Business and Creator accounts only ([IG User reference](https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user)) (first round; field list verified, fetch summary for the rest).
- The design's official lookups are limited: "Business discovery and hashtag search are single, on-demand lookups. No crawling, no lists." ([design spec](file:///D:/Projects2/InstagramApi/docs/superpowers/specs/2026-10-20-instagram-cli-design.md), decision O) (verified, local design)

### Inferences
- The hosted services add nothing to the owner's own account that the official route with the owner's token cannot already do. Their extra reach is other people's public data. (judgment)
- Business discovery is the official route to another professional's public profile, and the design allows it as a single lookup. A hosted public-profile lookup is the same kind of act by an unofficial route. That is the boundary the owner must decide (Key question 4). (judgment)

### Gaps
- No vendor data was tested. Freshness and accuracy claims, such as HasData's "live" statement, are vendor statements; no calls were allowed.
- RapidAPI and Phantombuster public-read surfaces are unverified.
- Other actors (apidojo and others) are known only from snippets.

## Key question 3: What do their terms say about scraping, automation and Meta's rules? What do their privacy policies say about retention and sharing?

### Takeaway
Meta's terms, as the first round read them, bar collecting users' login credentials and reverse engineering. The Instagram Terms clause on automated collection appears only in a search snippet, because the live page returned navigation text, so it stays unverified. Retention is weakly stated across the set: Apify gives no period for run data or logs, StoriesIG gives none, and HasData keeps a stored artifact per call with no period in its README.

### Cited Findings
- Instagram Terms, search snippet of [help.instagram.com](https://help.instagram.com/581066165581870): "You can't attempt to create accounts or access or collect information in unauthorized ways. This includes creating accounts or collecting information in an automated way without our express permission." (unverified; a WebFetch of the same page returned only "Help Center" text, so the live wording is not confirmed)
- Meta Platform Terms (first round): apps may not "separately request or collect a Meta user's login credentials", and may not reverse engineer "Platform or any aspect thereof" ([Meta Platform Terms](https://developers.facebook.com/terms/)) (first round; fetch summary)
- Meta Platform Terms (first round): apps may not maintain apps "to circumvent, or attempt to circumvent, our enforcement actions". (first round; fetch summary)
- Developer Policies (first round): bots "at very high frequencies", and "inauthentic behavior" in Instagram Messaging ([Developer Policies](https://developers.facebook.com/devpolicy/)) (first round; fetch summary)
- HasData: "You are responsible for how you use the results, including compliance with Instagram's terms and with the law that applies to you." [README](https://github.com/HasData/instagram-mcp) (verified)
- Apify actor page: "only collects data that is publicly available on Instagram"; "Only scrape data if you have a legitimate reason."; no reference to Instagram's terms or Meta's rules on the page. [Actor page](https://apify.com/apify/instagram-scraper) (fetch summary)
- Apify privacy policy: "We retain your Personal Data for no longer than necessary..." with no period for run data, datasets or logs. Actor creators "may receive or have access to Personal Data". The processing addendum is not included. [Privacy policy](https://docs.apify.com/legal/privacy-policy) (fetch summary; last updated July 9, 2026)
- StoriesIG terms bar "any automated or non-automated 'scraping' methods" and bots or spiders to access the Service, and do not mention Instagram or Meta terms. [Terms](https://storiesig.info/en/terms-of-use/) (fetch summary)
- StoriesIG privacy policy: no retention periods; sharing with affiliates, unnamed service providers, analytics partners and ad partners (location, browser and cookie data); no mention of Instagram credentials or tokens. [Privacy policy](https://storiesig.info/en/privacy-policy/) (fetch summary)
- HasData: stored artifacts are linked from results, and the README gives no retention period for them. [README](https://github.com/HasData/instagram-mcp) (verified)
- Phyllo: no retention, deletion or sharing statement on the page. The footer links to a privacy policy and terms, not read. [Phyllo](https://www.getphyllo.com/instagram-api) (fetch summary)

### Inferences
- A scraper that does not use Meta's APIs sits outside the Platform Terms. The Instagram Terms clause, if the snippet is accurate, would bind the owner as the user, not only the vendor. (judgment)
- Vendor terms do not protect the owner from Instagram's rules. StoriesIG disclaims affiliation with Instagram and Meta (verified, README). HasData and Apify place compliance on the user (verified; fetch summary).
- StoriesIG's terms restrict scraping of StoriesIG's own service, not Instagram. The service itself returns scraped Instagram data, so the restriction does not cover the vendor's core use. (judgment, from the README tool list and the terms summary)
- A vendor's claim of lower ban risk, such as the Phantombuster listing's, should be read against the circumvention clause above. (judgment; not assessed further)
- Retention is the weakest area across the set. No vendor here states a retention period for scraped output or logs (verified or fetch summary for each).

### Gaps
- The live Instagram Terms, including the automated-access clause, are not confirmed. The owner should read them in a browser and quote the clause.
- HasData's privacy policy and terms were not reached.
- Apify's terms of use and processor addendum were not read.
- RapidAPI platform terms were not read.
- Phyllo's privacy policy and terms were not read.
- Phantombuster's terms and cookie policy were not read.
- Meta's Community Standards spam and inauthentic-behavior pages (first round: titles only) were not re-read.

## Key question 4: Given the owner's rules, which services could complement the design, and for what? Which should be ruled out?

### Takeaway
No hosted service read this round passes both rules. The one usable complement is reference reading: HasData's MIT MCP repository, once its license and code are read, can inform MCP tool-contract tests and error shape, with no endpoint call and no vendor key. Rule out credential-taking vendors (Phyllo, and Phantombuster on the snippets) and hosted scrapers of other people's data (HasData's endpoint, StoriesIG, Apify actors, RapidAPI scraper listings).

### Cited Findings
- The owner's rules, from the research brief: the owner's credentials never go to a third party; no scraping of other people's data.
- Design anti-goals: "Scraping, or bulk download of, other people's data or media." and "Storing other people's credentials, sharing the owner's, or using fake-engagement services." ([design spec](file:///D:/Projects2/InstagramApi/docs/superpowers/specs/2026-10-20-instagram-cli-design.md)) (verified, local design)
- HasData's own description: "Every question it answers is about a handle you do not own." [README](https://github.com/HasData/instagram-mcp) (verified; the vendor's words)
- StoriesIG exposes follower lists, liker lists, stories and no-watermark video downloads of any public account. [README](https://github.com/storiesig-info/instagram-mcp) (verified). These match the design's named anti-goal of bulk download.
- The Apify actor is a scraper for public Instagram data sold at per-result prices. [Actor page](https://apify.com/apify/instagram-scraper) (fetch summary)
- HasData's MCP error pattern: "The MCP layer answers 200 and puts the failure inside the result, with `isError` set to `true`." [README](https://github.com/HasData/instagram-mcp) (verified). The design plans a fixed set of error kinds for the Graph client ([design spec](file:///D:/Projects2/InstagramApi/docs/superpowers/specs/2026-10-20-instagram-cli-design.md), Architecture) (verified, local design).
- HasData's repo: MIT per the README badge (verified). The LICENSE file was not read; first-round metadata also says MIT.
- Official-route references from the first round: [ig-agent-cli](https://github.com/PixelFred0/ig-agent-cli) and [instagram-graph-api-lib](https://github.com/TiagoGrosso/instagram-graph-api-lib). Metadata verified; code unread (first round).

### Inferences
- Complement candidates, reference only and no hosted calls:
  - HasData's MCP repository: a tool-contract test pattern and the in-result `isError` convention for the design's MCP error mapping. Read its LICENSE and code before any reuse, as design decision D requires.
  - ig-agent-cli and instagram-graph-api-lib: structure and request-layer references, as the first round recommended. Neither is hosted.
- Ruled out on the credential rule: Phyllo (the vendor holds the Meta token). Phantombuster (session-cookie input, per snippets). Any service that takes the owner's password or cookie.
- Ruled out on the scraping rule: HasData's hosted endpoint (its own comparison describes lookups of handles the owner does not own); StoriesIG (followers, likers, stories and downloads); the Apify instagram-scraper; RapidAPI scraper listings (judged by their names and snippets, not per listing).
- Boundary for the owner to decide: a single on-demand hosted lookup of a public profile. The design allows official Business Discovery lookups (decision O). A hosted lookup is a scraper call by another route, which the scraping rule seems to cover. (judgment)
- Hosted webhook tunnel: the first round found no tunnel tool, and says the endpoint needs a valid TLS certificate (first round). A third-party tunnel would carry webhook payloads, including message text, through a vendor. Tunnels were not researched this round. (judgment; gap)

### Gaps
- No hosted service was found that passes both rules on the evidence read.
- HasData's LICENSE and code were not read; MIT comes from the README badge only.
- Tunnels and webhook relays were not researched.
- The design's Business Discovery terms (Facebook Login scopes and Meta's permission rules) rest on the first round and were not re-verified here.

## Key question 5: A summary of the risk of sending credentials to each service.

### Takeaway
Risk rises with the credential. A password is the worst; a session cookie is effectively the login (judgment); a vendor-held Meta token lets the vendor act within granted scopes until it is revoked or expires; a vendor API key exposes billing and query history. Phyllo, and Phantombuster on snippets, would hand a live Instagram credential to a third party; HasData, StoriesIG and Apify need only vendor keys or vendor sign-ins.

### Cited Findings
- HasData: vendor API key only, shown as `x-api-key: HASDATA_API_KEY` in client config examples. Clients with OAuth can sign in without putting a key in a config file. [README](https://github.com/HasData/instagram-mcp) (verified). Retention of stored artifacts is not stated (verified, README).
- StoriesIG: OAuth sign-in to StoriesIG. The README names no Instagram credential. [README](https://github.com/storiesig-info/instagram-mcp) (verified). Privacy policy: no retention periods, and sharing with partners (fetch summary).
- Apify: Apify OAuth or an Apify API token. The page does not say what the token can reach beyond the Apify account (fetch summary). The privacy policy gives no retention period for datasets (fetch summary).
- Phyllo: the vendor receives the Meta token and manages refreshes. No retention or deletion statement is on the page (fetch summary).
- Phantombuster: session cookies, per snippets (unverified).
- RapidAPI listings: unknown; not evaluated.
- For comparison: self-run unofficial tools take a password or session cookie on the owner's own machine (first round, repo-level read; see Key question 1).
- Baseline: the owner's Meta token stays in the OS credential store. Long-lived tokens last 60 days ([Business Login](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login)) (first round; verified), and error 190 signals an expired token ([error handling](https://developers.facebook.com/docs/graph-api/guides/error-handling)) (first round; fetch summary).

### Inferences (risk ranking, judgment)
- Highest: an Instagram password. It gives full control of the account, and Meta's platform terms bar collecting it.
- High: a session cookie, which is the login itself; and a vendor-held Meta token (Phyllo), which the vendor can use until it is revoked.
- Medium: vendor API keys with a query history and stored artifacts (HasData); the StoriesIG OAuth grant; an Apify token. The main exposure is billing, the owner's query history, and retained output with no stated period.
- None of the services reads needs the owner's Instagram password. Two of them (Phyllo, and Phantombuster on snippets) fail the owner's credential rule outright.

### Gaps
- Vendor security practices were not checked: breach history, SOC reports and key-rotation options. The Phyllo "SOC Compliant" link is not explained on its page.
- Retention periods for HasData artifacts, Apify datasets, StoriesIG logs and Phyllo data are not stated in the pages read.
- Phantombuster's and RapidAPI listings' credential requirements remain unverified.
