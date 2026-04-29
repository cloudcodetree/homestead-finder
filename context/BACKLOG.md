# Feature Backlog — Homestead Finder

> Priorities: P0 = must do now, P1 = next sprint, P2 = eventually, P3 = nice-to-have
> Update this file when items are completed or new ideas arise.
> Reference `context/DECISIONS.md` before implementing P1/P2 items.

---

## Product Vision (captured 2026-04-24 — the real ROI roadmap)

These are the features that transform the app from "better Zillow" into
"buy-side homestead research desk." Each entry includes the underlying
user need and the thinnest shippable v1.

- [ ] **Personalized home page** — when the user signs in, landing on
  the app shows 6-12 listings ranked by their personal model instead
  of the global feed. Thinnest v1: dedicated `/home` route that reuses
  `sortBy=recommended` + top-12 only, auto-hidden if no saves yet.
  Eventually: AI-generated "3 listings you should see today" with a
  one-sentence reason each.

- [ ] **User preference model / persona capture** — today's
  `user_ranking_weights` learns only from save/hide events; bootstrap
  problem for new users. v1: an onboarding sheet asking
  {budget, min acres, must-have features, move-in vs build, states,
  willing-travel-radius}. Persists to a new `user_preferences` table;
  blends into the ranking model as a prior until enough event data
  accrues to take over. Schema should be additive — preferences are
  durable settings, not events.

- [ ] **Projects — Claude-Code-style workspace organization.** Today's
  saved_searches are orphan filter snapshots. Promote them to a full
  "project workspace" pattern modeled on how Claude Code organizes
  chats in projects — projects are renameable, items move between
  projects, files sit inside projects.

  **Data model:**
  * `projects` (id, user_id, name, description, status, sort_order,
    created_at, updated_at) — top-level container
  * `project_items` (project_id, item_type, item_id, sort_order,
    pinned_at, notes) — polymorphic join; `item_type` in
    ('saved_search', 'listing', 'note', 'file'). One item → zero-or-
    one project (moving = update parent_id). Orphan items live in an
    implicit "Inbox" project.
  * `project_files` (id, project_id, user_id, filename, size_bytes,
    content_type, storage_path, extracted_text, text_hash,
    created_at) — uploads via Supabase Storage (free tier 1GB).
    Accepted types: PDF (pdfplumber → extracted_text), DOCX (python-
    docx), spreadsheets (pandas/openpyxl → text CSV representation),
    plain text, markdown, images (alt-text from Claude Vision stored
    as extracted_text so images ALSO become queryable context).
    Every upload runs a synchronous extraction pass so AI queries
    within the project can pull file contents as context.
  * `project_file_chunks` (file_id, chunk_text, chunk_index, embedding)
    — v2 only. When a project's total text exceeds ~50K tokens we
    switch from "shove everything into context" to "retrieve relevant
    chunks via pgvector similarity." Lazy — build this only when
    projects start hitting limits.
  * `project_notes` (id, project_id, body_md, created_at, updated_at)
    — project-level freeform markdown. Rich-text editor optional; v1
    is a textarea.

  **Operations:**
  * Create / rename / archive / delete project
  * Drag-drop items between projects (or select-and-move menu)
  * Pin a listing to a project (distinct from save — saves are "like",
    pins are "working on")
  * Upload a file (10MB cap / file, configurable)
  * Project status: `scouting / shortlisted / offered / closed /
    archived`
  * Project-scoped "run this search" → applies filters + opens list
  * **Files as AI context** — any AskClaude query made INSIDE a
    project automatically includes that project's file contents as
    context. Examples:
    - Upload a PDF inspection report, ask "what's the red flag here
      and which of my saved listings avoid that issue?"
    - Upload a spreadsheet of your own budget, ask "which listings
      fit my annual carry limit?"
    - Upload a seller's offer-sheet PDF, ask "compare this to the
      typical owner-finance terms in the county."
    - Upload a reference photo, ask "find listings with a similar
      view" (this overlaps with vision #14 image-search but stays
      scoped to the active project).
    Feels like Claude Code projects: drop files in, chat answers
    use them. Same token-budget escalation (whole-file context →
    RAG chunks once per-project text grows large).

  **UI:**
  * Left sidebar: collapsible project tree (or a projects picker in
    the top nav)
  * `/projects` index page with status columns (kanban-lite)
  * `/project/{id}` page with tabs: Searches / Listings / Notes /
    Files / **Vision Board** / Timeline
  * **Vision Board tab** — Pinterest-style moodboard layout mixing
    the project's reference-image uploads (from #14) with thumbnails
    of pinned listings. Drag to rearrange, draw an arrow from one
    image to another to annotate "this cabin's roof + this view."
    Export as a PDF / share link when the project is shortlisted so
    the user can send it to a partner / inspector. Masonry grid
    (react-masonry-css, ~2KB) or CSS columns — no new heavy deps.
  * Drag handles on every item card; drop targets on every project
    row
  * Saved-search apply button opens the project's filtered view in
    one click

  **Why it matters:** turns the app into a pipeline tool
  (scouting → offer → closed) rather than a search tool. Once a user
  has even ONE active project, switching cost skyrockets — this is
  the stickiest feature of the whole vision list.

- [ ] **User-tweakable AI prompts** — surface the enrichment + curation
  prompts as editable text in a settings panel. User can add their own
  criteria ("I care strongly about spring water and south-facing slope").
  The tweak gets appended to the system prompt when the user runs
  enrichment for themselves. Opens up power-user personalization without
  requiring code changes. Keep base vocabulary enums locked (output
  sanitization still clamps to them).

- [ ] **Draw-boundary map search** — Leaflet + leaflet-draw. User
  draws a polygon on the map; we filter listings whose lat/lng falls
  inside. Deal-breaker for buyers targeting specific watersheds, school
  districts, or commute zones. Dependency: leaflet-draw (~15KB gz).

- [ ] **Climate + threat scoring** — move beyond the FirstStreet
  external link to an integrated score. Pull from: NOAA SSP climate
  projections (30-year temperature + precipitation shifts), FEMA flood
  maps (already have), USDA drought outlook, wildfire WHP index, EPA
  AirNow historical PM2.5. Compose into a "Climate Risk" pill on the
  card (green/yellow/red) with a breakdown panel on the detail. Use
  existing `geoEnrichment.flood` as the template shape.

- [ ] **Emergency services proximity** — drive-time to the nearest:
  * Hospital (HHS/HRSA national hospitals geojson, free)
  * Trauma center by level (ACS Verified Trauma Centers public CSV)
  * Fire station (OSM Overpass `amenity=fire_station` — we already
    hit Overpass)
  * Sheriff / police (OSM `amenity=police`)
  * 911 PSAP location (NENA registry — state-level free CSVs)
  For a homestead buyer, "78 min to Level II trauma center" is
  often a hard go/no-go line. Surface as a stoplight pill on the
  card (green < 30 min, amber 30-60, red > 60).

- [ ] **Internet / broadband availability** — FCC Broadband Map API
  (`broadbandmap.fcc.gov/api`, free, no key) returns per-provider
  down/up speeds + technology (fiber / cable / DSL / fixed-wireless
  / satellite) at an exact lat/lng. Detail-page panel shows all
  available providers; card surfaces max-wired-down-speed as a
  "Best internet: 100Mbps fiber (Windstream)" chip. Missing provider
  coverage is a silent deal-breaker for remote-workers.

- [ ] **Community / demographic context** — blend several free
  sources into a "community score":
  * Census ACS 5-year block-group (age distribution, median
    income, housing tenure) via Census API (free key)
  * NCES school locator (public school within N miles, student-
    teacher ratio, graduation rate) — free CSV
  * OSM `amenity=place_of_worship`, `amenity=community_centre`,
    `amenity=library`
  * USDA farmers markets + CSAs directory (public API)
  Combine into: "Nearest school: 12 min · 3 churches + library
  within 10 mi · farmers market weekly · median age 47." Paints
  the "is there a there there" picture homesteaders ask about.

- [ ] **5-point rating per listing — preference-tuning signal.**
  Distinct from save (bookmark) and hide (banish). Save = "I want to
  come back to this." Hide = "don't show me similar." Rating = "tune
  the model without committing to action." Needed because real
  preferences don't line up cleanly with binary save-or-hide — a user
  can LOVE a listing that's out of budget, or DISLIKE one without
  wanting it banished.

  **Scale: 5-point labeled (recommended v1):**
  * 🔥 Love (+1.0 weight)
  * 👍 Like (+0.5)
  * 😐 Meh (0.0) — default / cleared
  * 👎 Dislike (-0.5)
  * 🚫 Hate (-1.0)
  Labeled beats a slider because users struggle with false precision
  ("is this a 7 or an 8?"). Netflix famously abandoned 5-stars after
  finding users clustered on 3/4/5 and the bottom half went unused —
  the labels here prevent that by making each point MEAN something
  distinct. Alternative considered: -5..+5 slider (too much false
  precision); 1-10 (decision fatigue); binary thumbs (less signal).

  **Data model — new table `listing_ratings`:**
  * (user_id, listing_id, rating smallint, created_at, updated_at)
  * rating in {-2, -1, 0, 1, 2} mapping to Hate / Dislike / Meh /
    Like / Love. Smallint keeps storage compact + extensible if we
    ever add 7-point.
  * PK on (user_id, listing_id), upsert on change
  * RLS mirror of saved_listings

  **Feeds `rank_fit.py` with weighted training:**
  * Rating weights above multiply the training-sample weight in the
    logistic regression. scipy's sample_weight param is already in
    the call path; just needs wiring.
  * Sharpens the model an order of magnitude faster than binary
    save/hide — two weeks of engaged use could produce 10× the
    signal density.

  **UI:**
  * Detail modal: horizontal reaction-bar row between Save and
    Not-interested: 🚫 👎 😐 👍 🔥. Single click = set rating.
    Clicking the current rating clears it back to Meh.
  * PropertyCard: condensed to a single star-ish icon that opens a
    mini reaction popover on tap. Default (Meh) hidden; any non-zero
    rating shows a colored indicator (red for negative, green for
    positive) with the icon.
  * Tinder mode: velocity-based — fast up-swipe = Love, slow up-swipe
    = Like; fast down = Hate, slow down = Dislike. Tap-hold center
    = Meh (explicitly rate neutral). Right still = save, left still
    = hide (action commits on top of rating). Four signals, four
    directions, plus magnitude from swipe velocity.
  * Account menu: "My reactions" → filtered views by rating bucket
    (all Loves, all Likes, all Dislikes, etc.). Parallels existing
    Saved / Hidden views.

- [ ] **Tinder-mode swipe UX** — full-screen card stack with swipe
  right = save (like), swipe left = hide (not interested). Instant,
  dopamine-rewarding, thumb-friendly on mobile. Beyond being fun, it's
  the single fastest way to generate training data for the
  personalization model (`rank_fit.py` + `user_ranking_weights` we
  already shipped) — each swipe is a clean +/- signal at ~10× the
  density of browse-and-click.

  **Ergonomics:**
  * Swipe right → save (same as the ▢ button on the card)
  * Swipe left → hide (same as the 👁 eye-off)
  * Swipe up → open detail without leaving the stack
  * Tap → open detail
  * Undo button (single-step) for accidental swipes
  * Progress indicator: "23 / 100 reviewed"
  * Keyboard shortcuts on desktop: ← → ↑ for the three actions

  **Where it lives:**
  * View-mode tab alongside List / Map / Picks / Deals: "Swipe"
  * Also surfaces as a "review your saves" project action — batch
    through listings matching a saved search
  * New-user onboarding shows a 10-card swipe to bootstrap the
    ranking model before they hit the main feed

  **Library:** framer-motion is heavy for a single feature; prefer
  a lean card-swipe lib like `react-tinder-card` (~6KB gz) or
  hand-rolled using CSS transforms + pointer events. No drag-to-
  reorder dependencies — this is one-card-at-a-time.

  **Data flow:** swipes batch-insert to the same `saved_listings` /
  `hidden_listings` tables we already have, plus emit a
  `user_events: 'swipe'` row (see behavioral-analytics item above)
  for the training loop.

- [ ] **Image-driven search** — user uploads a reference image and
  the app finds similar listings. Three example flows:
  * "I saw this cabin on Instagram, find similar properties" → match
    on architectural style + landscape + amenities visible
  * "I love how this town looks" → match on proximity-to-towns-with-
    similar-vibe (smaller, forested, historic, etc.)
  * "Here's my dream view" → match on terrain + elevation + tree
    cover implied by the photo

  **Architecture (v1 — pragmatic, uses existing stack):**
  * Frontend: attach-image button in the search bar + AskClaude bar
  * Upload: Supabase Storage temp bucket with 24h lifecycle rule —
    zero retention of user visual data beyond the active session
  * Analysis: `claude -p --image` (Max subscription, already wired
    via ADR-012) with a structured prompt asking for
    {architectural_style, landscape_type, amenities_visible, vibe,
    implied_aiTags from our controlled vocab, natural_language_query}
  * Ranking: the returned aiTags + natural_language_query drive the
    existing AskClaude re-rank path; we already do corpus-wide
    relevance scoring there.

  **v2 (scale path):** CLIP embeddings for all listing images
  (computed once, stored in pgvector on Supabase). User upload →
  embed → cosine similarity → ranked results. Enables "more like
  this" browse mode without an LLM round-trip every time. ~$0.10 one-
  time to embed the current ~2500 listing images via Replicate or
  self-hosted CLIP. Dependency: pgvector extension (free in Supabase).

  **Privacy + trust:** user-uploaded images are private (Supabase RLS
  scoped to user_id), not indexed, auto-deleted. Explicit "don't use
  my image to improve the model" toggle even though we're not doing
  that currently — setting the expectation prevents future drift.

- [ ] **General text search + filter combo** — dedicated search bar
  next to the filter sidebar, substring match across title +
  description + county + features + improvements. Currently the only
  free-text path is AskClaude (localhost-only + requires query_server
  running), so users searching for "cabin near Beaver Lake" have no
  good UI. Two-phase build:

  **v1 (client-side, ~2h)**: input in the header with a magnifying-
  glass icon. Debounce 200ms. Filter the already-loaded
  `properties` array via lowercase-substring match on the concatenated
  fields. Case-insensitive, multi-word = AND. Instant results, zero
  backend.

  **v2 (Supabase, ~half day)**: push a subset of fields to a
  `listings_search` Supabase table with `to_tsvector` index. Frontend
  queries via RPC. Enables multi-word phrase search, stemming,
  OR/NOT operators, relevance ranking. Also enables the analytics
  layer (item above) to capture search queries server-side.

- [ ] **Behavioral analytics + adaptive UI** — three stacked pieces:

  **a. Event capture (the foundation).** New Supabase table
  `user_events (user_id, event_type text, payload jsonb, created_at)`.
  RLS: user sees only their own rows; aggregation queries use the
  service role. Events we care about:
  * `search_prompt` — every AskClaude NL query + its filter context
  * `filter_change` — which filters toggled, from what to what
  * `sort_change` — which sort mode selected
  * `save`, `hide`, `unhide`, `view_detail`, `external_click`
  * `view_mode` (list / map / picks / deals)
  * `saved_search_create` — the filter snapshot + name
  Payload is explicitly-listed fields only — never raw listing text,
  never user email/IP. Events expire after 365d (cron-based purge).

  **b. Aggregated insights.** Materialized view or nightly rollup
  writing to a `global_trends` table:
  * Top 20 NL query terms (stemmed / deduped) by frequency
  * Most-toggled filter dimensions + their typical values (e.g.
    "maxPricePerAcre: 80% of users cap at $10k")
  * Popular sort modes
  * Average session → saved-listing conversion rate
  * Per-source engagement (which sources do users actually click
    through to)
  * Per-county click-through density (which counties are hot)
  Drives TWO things: (1) an "insights" dashboard for us so we know
  what to build next; (2) inputs for adaptive UI below.

  **c. Adaptive UI — both per-user and global.**
  * Per-user: user's default sort remembers their last choice (we
    partially do this via filter state, but it resets on navigation).
    Default `improvementTier` biases toward their usage pattern.
    Ask-Claude autocomplete suggests their last 5 queries.
  * Global: when a new user lands with no personal signal, defaults
    bias toward what the cohort uses. If 60% of users cap at
    $10k/ac, that's the slider's default. New-user home-page surfaces
    "Popular searches" — the top-N saved-search templates across the
    user base.
  * Never be aggressive — every adaptive default has an obvious "not
    what I want" escape hatch. Adaptation must be explainable
    ("most users in your state filter to X; we're showing that by
    default").

  **Privacy constraints (design baseline):** zero third-party
  analytics SDKs (no GA, Mixpanel, Amplitude — they'd all share data
  with their own business ops and expose us to ToS surprises).
  Everything runs in Supabase, same RLS architecture as saved_listings.
  User can request "forget me" via account menu → wipes user_events +
  saved_* rows. Respects Do-Not-Track header by disabling aggregation
  writes for that session (still store user-scoped events so the
  user's own personalization works).

- [ ] **County voting patterns** — surface the political lean of the
  county where each listing sits. Relocation is as much a cultural
  decision as a financial one; buyers on both sides of the spectrum
  want to underwrite this explicitly before moving. Free data sources:
  * MIT Election Data & Science Lab — county-level presidential
    results 2000-2024 (maintained CSV, free)
  * Tony McGovern's `us-presidential-election-county-results` repo
    (alternative, same shape)
  * Harvard Dataverse mirrors for trend analysis
  * Census FIPS county codes for the join to our existing
    `location.county` + `location.state`
  Surface as: "Dem/Rep lean (last election) · 5-yr trend arrow ·
  turnout %." Detail panel can show the last 4 cycles as a mini
  chart. Framed factually (margin + trend) not editorially.

- [ ] **Property-as-stock analytics** — for each listing, compute +
  display the technical signals an investor would use:
  * Price trend over time (our daily scrape history provides this;
    need to start storing per-ID price snapshots)
  * Days-on-market percentile vs county
  * $/ac relative to county 12-mo rolling median (we have medians; add
    rolling)
  * "Similar parcels sold for X in the last 24 months" (county
    assessor API integration)
  * Velocity indicator — is this market heating up or cooling?
  New page: `/p/{id}/analytics` with charts. Uses Recharts (already
  likely a transitive dep).

---

## P0 — Immediate (Get to Working State)

- [ ] **Verify frontend builds** — `cd frontend && npm install && npm run build`
- [ ] **Verify Python tests pass** — `cd scraper && pytest tests/ -v`
- [ ] **Enable GitHub Pages** — Repo Settings → Pages → Source: GitHub Actions
- [ ] **Test scraper dry-run** — `python main.py --dry-run --source=landwatch --states=MT`
- [ ] **Generate package-lock.json** — Required for `npm ci` in CI

---

## P1 — Next Session

- [ ] **Port LandWatch markdown-parser approach to lands_of_america.py**
  - Same Cloudflare block, same Firecrawl fallback path available
  - Capture a sample Firecrawl markdown, identify listing-link pattern
  - Clone `parse_markdown_listings` + state URL slug logic
  - Add fixture-based tests

- [ ] **Run first production enrichment pass**
  - Non-dry-run scrape to populate `data/listings.json` with real LandWatch data
  - `python -m scraper.enrich` locally (burns ~30s per listing on Haiku)
  - Commit enriched `listings.json`
  - `python -m scraper.curate` for the first Top Picks
  - Commit `data/curated.json`

- [ ] **Server-side URL validation in scraper**
  - Add `scraper/utils/validator.py` — HTTP HEAD requests against listing URLs
  - Write `validated`, `validatedAt`, `status` fields back to each listing in `listings.json`
  - Mark new listings as `status: "unverified"` by default
  - Re-validate existing listings periodically (e.g., every 7 days)
  - See ADR-007 for architecture rationale

- [ ] **Geocoding for listings without lat/lng**
  - Use Nominatim (free OpenStreetMap geocoder)
  - Add `scraper/utils/geocoder.py`
  - Call in `BaseScraper.to_property()` when lat/lng is None
  - Cache results to avoid rate limits

- [ ] **Verify and fix scraper selectors**
  - LandWatch CSS selectors may have changed
  - Lands of America selectors may have changed
  - Test with: `python main.py --dry-run --source=landwatch --states=MT --max-pages=1`

- [ ] **Expand county tax sale coverage**
  - Add 10+ counties to `county_tax.py`
  - Focus on MT, ID, WY, TX initially
  - Document each county's URL and format

- [ ] **Fix GitHub Actions push step**
  - The `ad-hoc/push@v1` action in `scrape.yml` is a placeholder
  - Replace with `git push` directly or use proper action

- [ ] **Frontend: Deal score histogram**
  - Add a small sparkline/histogram above the filter panel
  - Shows score distribution of current results

---

## P2 — Future Features

- [ ] **Saved searches / watchlists**
  - Let user pin/star listings
  - Store in localStorage

- [ ] **Price history tracking**
  - Detect when a listing drops in price
  - Show price history on PropertyDetail
  - Store by listing ID across dated snapshots

- [ ] **Comparable sales**
  - Show recent land sales in the same county
  - Source: county assessor records (FOIA/public data)

- [ ] **Supabase migration**
  - When listings.json > 5MB or 500+ listings
  - See ADR-001 for migration trigger

- [ ] **Mobile PWA**
  - Add `manifest.json` and service worker
  - Enable offline viewing of last-loaded listings

- [ ] **Street view / satellite preview**
  - Link to Google Maps satellite view for each listing
  - No API key needed for simple links

- [ ] **Soil quality overlay**
  - USDA Web Soil Survey has public API
  - Show soil type on map hover

- [ ] **Flood zone overlay**
  - FEMA flood maps are public
  - Flag listings in flood zones

- [ ] **Distance from nearest town**
  - Calculate straight-line distance from listing to nearest town > 5k population
  - Add as a filter option

- [ ] **Multi-user support / sharing**
  - Share a filtered view via URL parameters
  - Encode filter state in URL hash

---

## P3 — Nice to Have

- [ ] Bulk export to CSV/spreadsheet
- [ ] Telegram bot notifications (alternative to email)
- [ ] Browser extension to detect land deals while browsing
- [ ] Integration with county GIS parcel maps
- [ ] AI-generated listing summary/red-flags
- [ ] Water rights database lookup (state-specific)
- [ ] Dark mode
- [ ] Filter by validation status (show only Verified, hide Expired)

---

## P2 — Images Phase 2: Detail-page Carousel

- [ ] **Per-listing gallery on PropertyDetail**
  - Phase 1 (shipped 2026-04-22): primary thumbnail via `PropertyThumbnail`
    component. LandWatch URLs synthesized from PID; HomesteadCrossing +
    OzarkLand scraped from cards directly. Direct hotlink → weserv
    fallback → placeholder.
  - Phase 2 scope: a swipeable 5-15 image carousel on the modal/page
    instead of a single hero image.
  - Requires: capturing the full gallery, which lives on per-listing
    detail pages (not search cards). Today `detail_fetcher.py` uses
    Firecrawl for LandWatch detail pages — but Firecrawl quota is
    expensive at 1490 listings/month. Rewrite against Playwright so
    it's free; ran ad-hoc once a week instead of daily.
  - HomesteadCrossing detail pages already render the gallery
    server-side (Rent Manager) — can extract via plain curl_cffi.
  - OzarkLand detail pages are WP, also server-rendered.
  - Frontend component: use a small carousel library (Swiper.js is
    the obvious choice) or ~50 lines of custom code; no need for a
    heavy dep.
  - Files touched: `scraper/detail_fetcher.py` (rework), new
    `scraper/sources/<source>_detail.py` per source, and a
    `<PropertyCarousel>` React component replacing the hero
    `PropertyThumbnail` call in `PropertyDetail.tsx`.

---

## P2 — OCR for scanned tax-sale PDFs

- [ ] **Wire OCR pipeline for MO Collector PDFs**
  - The 2025 Texas County MO Land Tax Sale PDF (the one already in
    tax_sale_registry.py) is fully image-scanned — pdfplumber
    returns zero text. Most MO Collectors publish scans.
  - Options:
    1. System tesseract + pdf2image/pypdfium2 (free, offline, ~10 min setup)
    2. Claude vision via `claude -p --image` (uses Max quota; easy
       one-listing-per-page prompt; high accuracy on typed text)
  - Blocks real MO tax-sale data until mid-July when 2026 lists
    publish. Currently missing ~50-80 Texas County parcels + similar
    from Reynolds + Douglas whenever their lists drop.
  - Files: scraper/sources/tax_sale_parser.py (`_missouri_collector_pdf`
    currently a scaffold)

---

## Deferred Sources (investigated, rejected — don't re-investigate)

Data collected 2026-04-22/23 during Ozark-pilot source expansion.
Keep this list so we don't burn time re-probing channels that were
already ruled out. Reconsider only if the underlying site structure
or MO/AR inventory density changes materially.

- **FSBO.com** — 6 MO + AR land listings across entire site (per
  sitemap.xml); Next.js SPA, no API; Playwright required. Cost-benefit
  is <10 relevant listings for a stateful scraper.
- **US Marshals asset sales** — 0 MO + 1 AR (suburban house) active
  nationwide at time of probe. Historical rate <1 MO/AR rural land
  listing/year. Channel is usmarshals.gov + bid4assets + CWS, all
  Cloudflare-gated SPAs. Email digest is the right integration, not
  scraping.
- **FSA Resales (USDA farm surplus)** — no centralized feed. Program
  now operates via per-state-office press releases; state office
  pages (`fsa.usda.gov/state-offices/{missouri,arkansas}`) have
  zero inventory-property links. Scraping requires ad-hoc state-by-
  state crawling with unpredictable schema. Defer until/unless USDA
  restores a national inventory database.
- **Facebook Marketplace** — login wall + aggressive anti-bot;
  scraping violates TOS. No API for land category.
- **PACER bankruptcy records** — paid access ($0.10/page), no
  structured real-estate-only feed. Rural land in bankruptcy estate
  is a single-digit fraction of filings. Not worth the dev cost.
- **LandFlip.com / Land And Farm / Land.com / farmandranch.com / landsearch.com**
  — all 403 on plain HTTP (Cloudflare). Inventory overlaps LandWatch
  heavily (Land.com family). Not worth Playwright cost.

---

## Tech Debt

- [ ] **Click-through cap for free signups (paid = unlimited)**
  - Captured 2026-04-29 alongside the three-tier access model
    (anonymous / free signup / paid). The current stopgap treats
    every signed-in user as effectively paid (`useSubscription`
    returns `paid: true` for any logged-in user) and only gates
    anonymous access via `useAccessTier` — outbound source URLs +
    external research links hide behind a "Sign up free" CTA.
  - Once billing ships, the free tier should cap click-throughs at
    e.g. 5/day. Each click on an outbound source URL or external
    research link logs a row to a `click_log` table; a counter is
    queried per detail-page load so the UI can show "3 of 5 left
    today" and gate further clicks at the cap.
  - Implementation sketch:
    - Supabase: `click_log(user_id, listing_id, kind, clicked_at)`
      with RLS limiting to own rows + an index on
      `(user_id, clicked_at)` for the daily-window query.
    - `frontend/src/hooks/useClickCredits.ts` — exposes
      `{ remaining, capUsed, hardCap, registerClick(kind, listingId) }`.
    - `useAccessTier` returns a third tier: `signed_in_capped` once
      `paid !== true && capUsed >= hardCap`. PropertyDetail and
      ResearchPanel switch to "Upgrade for unlimited" CTAs in that
      state instead of the "Sign up free" CTA shown to anonymous.
  - Files: `frontend/src/hooks/useAccessTier.ts`,
    `frontend/src/hooks/useSubscription.ts`,
    `supabase/migrations/00XX_click_log.sql` (new),
    `frontend/src/components/PropertyDetail.tsx`,
    `frontend/src/components/ResearchPanel.tsx`.

- [ ] **Tier listings before enrichment — skip duds, lazy-enrich on demand**
  - Captured 2026-04-28. Today every listing gets the full pass: AI
    enrichment, geo lookup (5 gov calls), voting tag, image refresh,
    InvestmentScore. We pay the cost — wall clock + Claude tokens —
    on listings that may never be viewed (price too high, acreage too
    small, broken county text, no features).
  - Triage idea: a fast pre-pass marks each listing with
    `enrichmentTier: full | basic | skip` based on cheap signals
    (price band, acres, $/ac vs corpus median, source, has-images,
    has-county). Only `full` listings run the expensive passes. `basic`
    gets voting + score only. `skip` gets a thumbnail-only row.
  - Lazy backfill: pairs naturally with the **Click-to-enrich** entry
    above — when a user opens a `basic`/`skip` listing's detail page,
    we run the missing passes on demand. Zero ongoing cost for
    listings nobody looks at.
  - Tier definitions (initial guess; tune from save/hide signal):
    - `full`: ≥1 acre AND price < $1M AND has structured location
      AND has at least one image OR a strong feature flag
    - `basic`: has structured location AND price > 0
    - `skip`: missing both
  - Files touched: new `scraper/enrichment_tier.py`,
    `scraper/enrich.py` + `scraper/enrich_geo.py` honor the tier flag.
  - Don't start until InvestmentScore Phase 2 + visual breakdown UI
    are landed (this entry's purpose is to capture the inspiration).

- [ ] **Click-to-enrich — user-triggered enrichment as monetization surface**
  - Captured 2026-04-28 ("i don't want to loose the inspiration"). Idea:
    let users click a button on any listing (or paste a URL of a new
    listing they found) to run enrichment on-demand instead of having
    every listing pre-enriched on our dime.
  - Cost breakdown (per listing):
    - Forward-geocode (Census): $0, <1s
    - Geo enrichment (soil/flood/elev/watershed/proximity): $0, 3-8s
    - Voting + InvestmentScore + image refresh: $0, <1s each
    - AI enrichment (Haiku tags/fit/red flags): ~$0.0015 via Anthropic
      API, $0 via local Claude Max (CLI). 5-10s.
  - Total: a tenth of a cent in API mode, ~10-15s wall-clock.
  - Two-tier UX:
    - **Free / on-demand**: "Enrich" button → geo + voting + score
      only (no AI). Free to operate; we absorb.
    - **Premium / "Deep enrichment"**: extends with AI enrichment.
      $0.0015 we eat from the subscription, or pass through at
      $0.05/listing if we want a margin.
  - Architecture: a Supabase Edge Function (`enrich-listing`) holds
    the Anthropic API key server-side; free tier doesn't need a key.
    Synchronous response (10-15s) is fine for the UX — show a spinner.
  - Why this is interesting beyond cost reduction: it turns the
    listing detail page into a self-service surface. Power users
    paste URLs from sources we don't scrape, get full enrichment
    instantly. Acts like an acquisition funnel.
  - Don't start until InvestmentScore Phase 2 + the visual breakdown
    UI are landed.

- [ ] **Replace hand-curated tables marked `TODO(ai-enrich)` with live / learned data**
  - Scoring + macro modules ship with several hand-curated constants
    that will go stale or are coarser than they should be. Each is
    flagged with a `TODO(ai-enrich):` comment for grep discoverability:
    `grep -rn "TODO(ai-enrich)" scraper/`
  - Current entries (2026-04-28):
    - `STATE_PROPERTY_TAX_RATE` in `scraper/macro_data.py` — Tax
      Foundation 2024 estimates, state-level. County variance is
      large (TX counties 1.4–2.6%); county-level pull would be a real
      improvement.
    - `STATE_UNEMPLOYMENT_RATE` in `scraper/macro_data.py` — fallback
      when BLS LAUS county flat-file 403s. **Unemployment moves
      fast** — recessions shift state rates 5pp+ in months. Refresh
      annually at minimum or solve the BLS WAF block to get live
      county-level data (the helper code is intact and ready).
    - `_PHASE1_WEIGHTS` / `_PHASE2_WEIGHTS` in
      `scraper/investment_score.py` — gut-feel composite weights.
      Two upgrade paths: per-user reorderable weights (see the
      `feedback_visualize_data` memory rule), or learned weights via
      `rank_fit`-style training against save/hide/rating signal.
    - `_RED_FLAG_PENALTIES` in `scraper/investment_score.py` — ad-hoc
      severity points per flag. Better calibration: Claude pass over
      a sample of saved-vs-hidden listings paired with their flags
      would infer which flags actually predict user rejection.
  - Convention: any future hand-curated table that can be displaced
    by a live source or a learned fit should carry the same
    `TODO(ai-enrich):` marker so this list stays grep-able.

- [ ] **Recover the 1,424 listings still without coords (placeholder addresses)**
  - As of 2026-04-28 the corpus has 2,426 listings; only 1,002 have
    lat/lng. The remaining 1,424 (mostly LandWatch + United Country)
    have addresses with placeholder street numbers like `000 Old Dolph
    Road`, `TBD Big Barren Creek RD`, or just a road name — Census's
    TIGER street-range geocoder (free, what `forward_geo.py` uses) can't
    match those. The ZIP-only fallback also failed because Census's
    batch endpoint requires a non-empty street.
  - Without coords these listings are locked out of the geo-enrichment
    cascade (soil / flood / elevation / watershed / proximity) — that's
    why "fully enriched" is 894/2,426 (37%) instead of ~95%.
  - Options to evaluate (rough cost / payoff):
    - **City-centroid fallback via a third-party** (Nominatim
      self-hosted, Pelias, or a paid tier of Mapbox/Google) — would
      lift coverage to ~95% but introduces a paid dep or a self-hosted
      service. ~half-day to wire up.
    - **Parcel-detail page scraping** — LandWatch's detail page renders
      a map widget with the actual coords in JSON state. We already do
      `landwatch_images.py`-style page fetches; adding a coord-extract
      pass is the same shape. Lifts coverage for the LandWatch ~946
      rows specifically. ~half-day.
    - **City-name geocoding via a small bundled GeoNames JSON** — use
      the `<city>, <state>` pair (which we already have from the
      address parser) to look up city-centroid coords offline. Coarse
      but free, no runtime dep. ~2 hrs.
  - Files: [scraper/enrichment/](scraper/enrichment/),
    [/tmp/forward_geo.py](/tmp/forward_geo.py) one-shot script kept
    locally; promote to `scraper/forward_geo.py` if we resume this work.
  - Non-urgent — current 41% coords / 37% fully-enriched coverage is
    enough to power the AI Analysis + Market Context panels for the
    listings users are most likely to engage with (the ones with real
    addresses tend to be richer listings overall).

- [ ] **Tune Overpass (OpenStreetMap) rate-limit handling in proximity enrichment**
  - Current behavior: 176-listing backfill at `concurrency=2` still 429s on
    a meaningful fraction of `lookup_proximity` calls. The code handles
    failures gracefully (treats missing data as unknown, not zero) so
    soil/flood/elevation/watershed still reach 100% coverage, but proximity
    (nearest-town distance + named water features) ends up missing on
    roughly 20-30% of rows.
  - Options to evaluate:
    - Raise the internal sleep in `lookup_proximity` from 1.2s → 2.5s
      between the town + water queries (same wall clock at concurrency=2,
      fewer 429s)
    - Drop default concurrency to 1 in `enrich_geo` (doubles wall clock
      from ~9min → ~18min for 176 listings but zero 429s)
    - Add exponential-backoff retry on 429 inside `_post_overpass` (costs
      a bit of latency per retry, recovers most missing rows)
    - Self-host an Overpass instance (unlimited queries but needs 50GB+
      OSM pbf + a VPS — only worth it past ~5k listings)
  - Files: [scraper/enrichment/proximity.py](scraper/enrichment/proximity.py),
    [scraper/enrich_geo.py](scraper/enrich_geo.py)
  - Non-urgent — partial proximity coverage is still useful for the
    homestead-fit score, and the gap is in the nice-to-have layer rather
    than the gating layer (soil/flood).

---

## Completed

- [x] **LandWatch Firecrawl+markdown parser** — restored real data flow, 125 MT listings verified in CI (2026-04-20)
- [x] **AI enrichment pipeline** — `scraper/enrich.py` with 28 aiTags / 14 redFlags / fit score / summary, idempotent, local Max (2026-04-20)
- [x] **AI curation** — `scraper/curate.py` produces `data/curated.json` with ranked picks + reasoning (2026-04-20)
- [x] **Top Picks dashboard view** — new view-mode showing curated picks with headlines + reasons (2026-04-20)
- [x] **Natural-language query proxy** — localhost-only `scraper/query_server.py` + "Ask Claude" bar that auto-hides in production (2026-04-20)
- [x] **ADR-012** — local-Max for AI, CI for parsing (2026-04-20)
- [x] Project scaffolding (2024-01-15)
- [x] Frontend: Dashboard, Map, List, Filters, PropertyDetail, Notifications (2024-01-15)
- [x] Scraper: Base class, 7 sources, scoring engine, notifier (2024-01-15)
- [x] GitHub Actions: scrape cron, Pages deploy, test CI (2024-01-15)
- [x] Claude Code config: CLAUDE.md, skills, agents, commands, hooks (2024-01-15)
- [x] Rolling context system (this file + ROLLING_CONTEXT.md + DECISIONS.md) (2024-01-15)
- [x] DevContainer for Codespaces (2024-01-15)
- [x] Listing validation system — `validated`, `validatedAt`, `status` fields on Property type (2026-04-06)
- [x] Validation status badges (Verified / Unverified / Expired) on PropertyCard and PropertyDetail (2026-04-06)
- [x] URL display on PropertyDetail — clickable link, copy button, tooltip (2026-04-06)
- [x] `validateListingUrl` utility stub in `frontend/src/utils/validation.ts` (2026-04-06)
- [x] Sample listings marked `status: "unverified"` (2026-04-06)
- [x] Collapsible desktop filter sidebar with smooth CSS transition (2026-04-06)
- [x] Mobile filter drawer (slide-from-left, backdrop, floating FAB button) (2026-04-06)
- [x] Sort-by dropdown in list view (6 sort options) (2026-04-06)
