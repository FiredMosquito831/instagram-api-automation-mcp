# Existing Instagram Automation Tools: Inventory (as of 2026-10-20)

Scope: MCP servers, CLIs, and JS/TS and other-language libraries for Instagram. Metadata comes from GitHub API, npm, PyPI, and MCP registry responses. No package was installed or executed. Stars are current counts; "created" is the repo creation date. Stargazer timelines were not pulled.

## Which Instagram MCP servers exist?

### Takeaway
Dozens of Instagram-related MCP repos and npm/PyPI packages were found, mostly with under 30 stars. Recently active official Graph API servers (Business/Creator accounts): AleemHaider/instagram-mcp, mikusnuz/meta-mcp, IvanBBaev/instagram-mcp, adelaidasofia/instagram-mcp. Many others use unofficial private APIs or browser sessions.

### Cited Findings
- Official Graph API (Business/Creator), MIT, Python, 6 stars, last commit 2026-05-29, release v0.1.1 (2026-05-14), 24 tools: [repo](https://github.com/AleemHaider/instagram-mcp), [PyPI](https://pypi.org/project/instagram-mcp/)
- Official Graph API, MIT, TypeScript, 30 stars, pushed 2026-10-19, 57 tools (Instagram Graph API plus Threads): [repo](https://github.com/mikusnuz/meta-mcp), [npm](https://www.npmjs.com/package/@mikusnuz/meta-mcp)
- Official Graph API, MIT, TypeScript, 4 stars, pushed 2026-10-15, 28 professional-account tools: [repo](https://github.com/IvanBBaev/instagram-mcp), [npm](https://www.npmjs.com/package/instagram-mcp-ai)
- Instagram Login (no Facebook Page), MIT, Python, 2 stars, pushed 2026-06-22: [repo](https://github.com/William-Gao/instagram-mcp)
- Read-only Graph API, MIT, TypeScript, 1 star, pushed 2026-10-14: [repo](https://github.com/alexfisenkov/meta-instagram-mcp)
- MIT, Python, 9 stars, pushed 2026-10-18. README calls it "Official", but nothing in the sources shows Meta affiliation: [repo](https://github.com/adelaidasofia/instagram-mcp)
- Unofficial, session cookie or username/password plus 2FA, 68+ tools, MIT, Python, 5 stars, created 2026-06-20: [repo](https://github.com/official-Arvind/instagram-mcp), [PyPI](https://pypi.org/project/instagram-mcp-server/)
- Unofficial, DMs only, MIT, Python, 186 stars, last commit 2025-08-13: [repo](https://github.com/trypeggy/instagram_dm_mcp)
- Hosted third-party data API, public data only, MIT, 16 stars, created 2026-08-21: [repo](https://github.com/HasData/instagram-mcp)
- Hosted, public content, no license detected: [repo](https://github.com/storiesig-info/instagram-mcp)
- Browser-session driven (logged-in Chrome extension): [npm](https://www.npmjs.com/package/@inssist/mcp); a glama listing reuses Chrome login state: [listing](https://glama.ai/mcp/servers/duhlink/instagram-server-next-mcp)
- Official MCP Registry search returned 13 names, all marked active. Includes app.hooksend/instagram (remote endpoint only; claims Meta official API for comment-triggered DMs) and co.civai.nova/instagram-web-agent (browser session via instagrapi): [registry](https://registry.modelcontextprotocol.io/v0/servers?search=instagram)
- Official modelcontextprotocol/servers README: no Instagram entries. wong2/awesome-mcp-servers lists trypeggy DM MCP and pipeboard-co/meta-ads-mcp (1316 stars, Meta Ads including Instagram; adjacent, not an Instagram content tool): [wong2 list](https://github.com/wong2/awesome-mcp-servers)
- Glama and mcp.so search snippets show several near-identical "ig-mcp" listings (e.g., [SompongGreco643](https://glama.ai/mcp/servers/SompongGreco643/ig-mcp), [husseinsahu](https://glama.ai/mcp/servers/husseinsahu/ig-mcp)). The summary says they share one file layout; not verified.
- Official Meta surfaces per the Context7 Instagram Platform docs: story publishing via POST /<IG_USER_ID>/media with media_type STORIES ([docs](https://developers.facebook.com/documentation/instagram-platform/content-publishing)); comments via GET /<IG_MEDIA_ID>/comments ([docs](https://developers.facebook.com/documentation/instagram-platform/comment-moderation)); insights ([docs](https://developers.facebook.com/documentation/instagram-platform/insights)); DMs via POST /<IG_ID>/messages on graph.instagram.com ([docs](https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api))

### Inferences
- Official MCP servers all require a Meta app, a Business or Creator account, and a token. Retrieved docs show no like or follow endpoints (absence not confirmed).

### Gaps
- Smithery was not reached. mcp.so and glama were checked only through search snippets, not their pages.
- Several repos' code and README were not read beyond the metadata above.

## Which CLI tools and npm packages exist? Which are deprecated or abandoned?

### Takeaway
Most Instagram npm and PyPI packages are stale (last publish 2015 to 2022). Actively maintained options: instagrapi and instaloader (Python), supreme-gg-gg/instagram-cli (TypeScript), and the official-API Graph API libraries.

### Cited Findings
- **Abandoned or deprecated:**
  - instagram-private-api (npm 1.46.1, MIT): last publish and last commit 2024-03-07; no GitHub release; 408 open issues; 6486 stars; 105,775 npm downloads last month. [npm](https://www.npmjs.com/package/instagram-private-api), [repo](https://github.com/dilame/instagram-private-api)
  - instagram-web-api (npm 2.2.2, MIT): last commit and release 2020-08-06; 1154 stars; 2,355 downloads last month. [repo](https://github.com/jlobos/instagram-web-api)
  - node-instagram (npm 4.3.0, MIT): archived; last commit 2020-04-03; README says the legacy Instagram API was disabled 2020-06-29. [repo](https://github.com/pradel/node-instagram)
  - instabot (PyPI 0.117.0, last 2020-03-28). The repo now resolves to ohld/igbot (Apache-2.0, 4887 stars, pushed 2026-01-28, no release). [PyPI](https://pypi.org/project/instabot/), [repo](https://github.com/ohld/igbot)
  - InstaPy (PyPI 0.6.16, 2022-01-19, GPLv3). The GitHub URL in its PyPI metadata returned 404. [PyPI](https://pypi.org/project/instapy/)
  - Instagram Basic Display API: secondary sources give a shutdown date of 2024-12-04 ([Zapier help](https://help.zapier.com/hc/en-us/articles/32429170578317-Instagram-app-deprecation-on-Dec-4-2024)). Meta's own page was not fetched.
- **Maintained, unofficial:**
  - instagrapi (PyPI 3.0.26, released 2026-10-17; 6985 stars; created 2020-07-30; pushed 2026-10-19; GitHub reports license NOASSERTION). README says Meta restricted its old support group, recommends official APIs where they cover the use case, and promotes HikerAPI. [repo](https://github.com/subzeroid/instagrapi), [PyPI](https://pypi.org/project/instagrapi/)
  - instaloader (PyPI 4.15.4, 2026-10-12; MIT; 13,620 stars; last commit 2026-10-14). Download-oriented. [repo](https://github.com/instaloader/instaloader), [PyPI](https://pypi.org/project/instaloader/)
  - supreme-gg-gg/instagram-cli (TypeScript, MIT, 2176 stars, pushed 2026-10-10). README calls it an "unofficial CLI and TUI client". npm name @i7m/instagram-cli 2.0.1 (2026-07-10). Auth method not verified. [repo](https://github.com/supreme-gg-gg/instagram-cli), [npm](https://www.npmjs.com/package/@i7m/instagram-cli)
  - paperfoot/clinstagram (Python, MIT, 14 stars, pushed 2026-04-17): README says it covers both Graph API and instagrapi backends. [repo](https://github.com/paperfoot/clinstagram)
- **Official Graph API libraries and CLIs:**
  - PixelFred0/ig-agent-cli (TypeScript, MIT, read-only, Instagram Login, pushed 2026-04-23; npm ig-agent 0.1.1). [repo](https://github.com/PixelFred0/ig-agent-cli)
  - TiagoGrosso/instagram-graph-api-lib (TypeScript, MIT, 95 stars, pushed 2025-11-24; npm instagram-graph-api 7.0.0, published 2024-08-08). [repo](https://github.com/TiagoGrosso/instagram-graph-api-lib), [npm](https://www.npmjs.com/package/instagram-graph-api)
  - crimeacs/meta-graph-cli (Python, MIT, 17 stars, created 2026-04-27): httpie-style client for Meta and Instagram Graph APIs. [repo](https://github.com/crimeacs/meta-graph-cli)
- **Official Meta SDKs (Marketing API, not an Instagram content client):** facebook-python-business-sdk (26.0.2, 2026-09-21) and facebook-nodejs-business-sdk (npm latest 24.0.1; GitHub v26.0.2). Both repo descriptions say "Marketing APIs". [repo](https://github.com/facebook/facebook-python-business-sdk), [repo](https://github.com/facebook/facebook-nodejs-business-sdk)

### Inferences
- No recently maintained unofficial JS library was found; the best-known ones are stale. Recent JS activity is in official-API wrappers.

### Gaps
- npm license and status were not checked for @i7m/instagram-cli, ig-agent, insta-dista-cli, ultra-igdl, or @ntnyq/instagram-downloader.
- instagram-cli's auth method and surfaces were not read.

## Which tools need username and password or session cookies, and which use OAuth tokens?

### Takeaway
Official tools use a Meta app and an OAuth-issued access token, typically long-lived (about 60 days). Unofficial tools log in with username and password, 2FA, session cookies, or saved session state.

### Cited Findings
- OAuth/token (official): AleemHaider mints a long-lived token via graph.facebook.com/oauth/access_token and uses Facebook Login. [repo](https://github.com/AleemHaider/instagram-mcp)
- Official endpoints: examples use graph.instagram.com (Instagram Login) and graph.facebook.com (Facebook Login). [docs](https://developers.facebook.com/documentation/instagram-platform/insights)
- Username and password: dilame reads IG_USERNAME and IG_PASSWORD from the environment and calls ig.account.login. [repo](https://github.com/dilame/instagram-private-api)
- Username and password: jlobos takes username and password and says credentials are held in memory. [repo](https://github.com/jlobos/instagram-web-api)
- Plaintext credentials in config: trypeggy puts INSTAGRAM_USERNAME and INSTAGRAM_PASSWORD in .env and also passes --password as an argument in a client config example. [repo](https://github.com/trypeggy/instagram_dm_mcp)
- Session cookie, username and password, 2FA, challenge handling, saved sessions: official-Arvind. [repo](https://github.com/official-Arvind/instagram-mcp)
- OAuth access token (legacy API, stale): node-instagram. [repo](https://github.com/pradel/node-instagram)
- Vendor API key (hosted services): HasData and similar listings in the MCP registry. [registry](https://registry.modelcontextprotocol.io/v0/servers?search=instagram)

### Inferences
- Credential handling differs sharply by tool class: OAuth for official tools, stored login material for unofficial ones.

### Gaps
- Storage format of instagrapi session files and of npm-library session state was not read.

## Red flags

### Takeaway
Several entries advertise like, follow, or DM automation. Some are unofficial DM bots with no linked repo. One stores a password in plaintext config. Several new 0-star unofficial projects and name collisions also need caution.

### Cited Findings
- Engagement automation advertised: [the-data-circle/instagram-bot](https://github.com/the-data-circle/instagram-bot) ("Scrape, like and follow with Instagrapi"); [Instagram-Outreach-Instantly](https://github.com/sujay3srivastava/Instagram-Outreach-Instantly) ("Instantly like outreach campaign"); [ohld/igbot](https://github.com/ohld/igbot) ("Get free followers with our auto like, auto follow")
- Unofficial DM bots, no linked repo: [@eryxenx/insta-chat](https://www.npmjs.com/package/@eryxenx/insta-chat) ("DM bots on personal accounts"); [@ig-harness/sdk](https://www.npmjs.com/package/@ig-harness/sdk) ("programmatic Instagram DM automation")
- New 0-star unofficial projects: [DavidCoder-agent/instagram-mcp-server](https://github.com/DavidCoder-agent/instagram-mcp-server) (created 2026-07-09, "reverse-engineered private API"); [syedalisaleem/instagram-mcp-free](https://github.com/syedalisaleem/instagram-mcp-free) (created 2026-10-17, "no PRO paywall")
- Plaintext password in config: trypeggy (see above)
- Risky safety language: official-Arvind's README calls session-cookie login "Recommended & Safest" and mentions avoiding login flags. [repo](https://github.com/official-Arvind/instagram-mcp)
- Name collisions: "instagram-mcp-server" exists on PyPI (official-Arvind, 2026-06-20) and npm (raveenb, 1.6.6). [PyPI](https://pypi.org/project/instagram-mcp-server/), [npm](https://www.npmjs.com/package/instagram-mcp-server)
- Duplicate packages: @mcpware/instagram-mcp and @mcpware/ig-mcp, same author, both say 23 tools. [npm](https://www.npmjs.com/package/@mcpware/instagram-mcp)
- No license detected: [arjun1194/insta-mcp](https://github.com/arjun1194/insta-mcp), [supercorp-ai/instagram-mcp](https://github.com/supercorp-ai/instagram-mcp), [storiesig-info/instagram-mcp](https://github.com/storiesig-info/instagram-mcp)
- Third-party site dependencies: xishandong/instagram-mcp uses imginn.com ([repo](https://github.com/xishandong/instagram-mcp)); [snapsave-media-downloader](https://www.npmjs.com/package/snapsave-media-downloader) relies on snapsave.app
- Star history: not checked. Example of a mismatch: n8n community nodes with 8 to 30 stars and 57k to 69k npm downloads per month ([npm](https://www.npmjs.com/package/@mookielianhd/n8n-nodes-instagram)); downloads may reflect n8n usage, not abuse.

### Inferences
- Highest risk: packages that automate likes, follows, or DMs on personal accounts, and packages with no source link.

### Gaps
- Meta's terms on automated access were not checked.
- Typosquatting was checked only by name collisions, not by publisher history.

## Best starting points for a JavaScript CLI

### Takeaway
Start from the official Graph API. Use PixelFred0/ig-agent-cli as a structure reference (TypeScript, MIT, read-only, Instagram Login) and TiagoGrosso/instagram-graph-api-lib as the request layer. Read supreme-gg-gg/instagram-cli's auth section before using its CLI/TUI design. The JS unofficial libraries (dilame, jlobos) are stale.

### Cited Findings
- Official path: ig-agent-cli (above); instagram-graph-api-lib (above); mikusnuz/meta-mcp and IvanBBaev/instagram-mcp as TypeScript endpoint-coverage references (above).
- Unofficial JS: dilame's library has the largest npm usage (105k downloads per month) but no commit since 2024-03-07. jlobos's library last changed in 2020.

### Inferences
- Building a thin TypeScript CLI on the official API is the most defensible option. Forking unofficial libraries adds account-level platform risk. instagrapi's own README advises official APIs where they cover the use case.

### Gaps
- No maintained unofficial JS library with recent commits was found in this pass.
- Likes and follows are absent from the retrieved Graph API docs; this is not confirmed as unsupported.
