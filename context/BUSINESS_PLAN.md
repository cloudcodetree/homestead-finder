# Homestead Finder — Business Plan & Order of Operations

> **Last updated:** 2026-04-24
> **Stance:** Bootstrapped, not raising — see "Strategy" below.
> **Source of truth** for business decisions. Update when assumptions change.

---

## Strategy — Bootstrap to Defensibility

**Decision:** bootstrap to revenue + real data moat before raising.
Not "maybe both" — **one path, committed**.

### Why not raise now
- Solo founder, zero users, no domain credentials, no traction. Tier-1
  VCs ignore; tier-2 take meetings but 4-6 months of pitching with
  ~85% pass rate; angels offer $300-800k at 15-30% dilution on a
  $2-3M post — brutal terms, 12-18 months of runway for giving up a
  fifth of the company.
- Raising is a 3-6 month full-time distraction. For a solo founder
  with a product but no users, that's 3-6 months of NOT shipping or
  acquiring users. Opportunity cost is higher than any cash a bad
  round would provide.
- Every month of bootstrap + revenue + engaged users compounds the
  valuation faster than time compounds dilution. A $4k MRR niche
  SaaS with 200 users and 65% retention pitches at ~10× the raw
  demo does today.

### The "Claude might ship this" fear, addressed
- **Anthropic and OpenAI are platform companies.** They sell tokens
  to developers. They do not build vertical consumer apps. Neither
  will launch a homestead-land search tool — it's not their business
  model.
- **Perplexity is a generalist search assistant**, not a vertical
  play. Same argument.
- **The real threat** is a rural-specialist realtor who learns
  enough code to ship — but that's true of every niche vertical, and
  a motivated solo dev will out-ship a 1-2-person side project nine
  times out of ten.
- **What actually kills this project** (in order): founder burnout
  before revenue (#1), feature sprawl across too many verticals (#2),
  trying to raise before evidence (#3). None of those are "Claude
  shipped something."

### Competitive window
Real, but narrower than it feels. Zillow/LandWatch move at public-
company speed; a solo dev can out-ship them on a specific niche for
12-18 months easily. That's our window; we don't need to rush
badly-built features to fill it.

---

## Phased Execution — The Order of Operations

### Phase 1 — Foundation MVP (Days 0–30)

**Goal:** ship a product worth charging $19/mo for.

Build only these three vision items; everything else waits:
- **#2 Preference capture** — onboarding sheet: {budget, min acres,
  must-have features, move-in vs build, states, willing travel
  radius}. Blends into `rank_fit` as a prior for cold-start users.
- **#3 Projects** — Claude-Code-style workspaces: rename, move
  items, files as AI context. The stickiness feature.
- **#16 5-point rating** — 🔥/👍/😐/👎/🚫. Richest training signal
  we can collect per interaction.

**Pricing at launch:**
- **Free tier:** up to 5 saved listings, no projects, no AI enrichment
- **Paid ($19/mo):** unlimited saves, unlimited projects, AI
  enrichment + Recommended sort, image upload + file context
- **Annual option:** $190/yr (save ~17%) — improves cash flow + retention

Landing page: ONE page, clear ICP ("Research the Ozark homestead
market in one tool"), pricing shown, Stripe link live from day 1.

**What gets killed in Phase 1:**
- All 13 other vision items (broadband, voting, climate risk, etc.)
- Multi-vertical expansion (cars, apartments) — zero discussion
- Full market research (deferred to Phase 3)
- The sold-comps / water rights / neighbor-flags backlog
- Phase 2/3 data-durability refactors (Phase 1 durability items only)

**Must ship alongside the MVP:**
- Phase 1 durability (preserve raw, schema version, observed/derived
  split) — non-negotiable. Without this, any business change later
  costs re-scraping.
- Blacklist-risk mitigation (split CI/local, canary, honest UA) —
  the moment paying users depend on the app, a LandWatch or
  Craigslist block becomes a real outage.

### Phase 2 — First Users (Days 30–90)

**Goal:** 20 paying users. That's $380 MRR. Tiny number, massive
milestone — proof a stranger will pay.

**Launch channels (no paid marketing):**
- `r/homestead` (460k members) — thoughtful long-form post telling
  the origin story, not a marketing pitch
- `r/offgrid` (300k)
- `r/RuralLifeStyle`
- "Moving to the Ozarks" Facebook group (~80k)
- Homesteading.com forum
- StrongTowns Discord (for the rural-relocation subculture)
- Personal Twitter/X if any audience exists
- Hacker News "Show HN" — unlikely to hit but worth one post

**What to measure:**
- Sign-ups per channel
- Free → paid conversion rate
- Time-to-first-save (engagement proxy)
- Day-7 retention
- User-requested features — log everything. This reshuffles the
  vision list.

**What to build:**
- 2-3 vision items that PAYING users explicitly request. Nothing
  else. Every shipped feature must answer a real paid-user request,
  not an imagined need.
- Bug fixes + onboarding polish only for free-tier users.

### Phase 3 — Data + Retention Flywheel (Days 90–365)

**Goal:** 100-200 paying users, $2-4k MRR, >60% retention.

**What becomes possible at this stage:**
- Geographic expansion: MO/AR → full Ozark region (southern IL/KY/
  TN) → Appalachia. Still one vertical.
- 4-6 more vision items based on accumulated user requests
- The personalization model (`rank_fit`) now has enough data to be
  genuinely useful — the "Recommended for you" sort becomes a sell
- Case studies, testimonials, retention numbers for the eventual
  raise pitch

**What stays off the table:**
- Multi-vertical abstraction (cars/apartments/etc.) — focus still
  wins. Vertical expansion only after $10k MRR in land.
- Fundraising meetings unless inbound from a known-credible investor

### Phase 4 — Optionality (Month 12+)

At this point three doors open:

**Door A — Keep bootstrapping.** At $10k MRR a solo dev can quit a
day job. At $30k MRR they hire a part-timer. Full ownership, lifestyle
business path.

**Door B — Raise Seed on real numbers.** Pitch: "$4k+ MRR, 200+
users, N-month retention, proprietary dataset of 15k+ rural
listings, engagement data, 65% retention." Seed rounds of $2-3M on
$10-15M post become realistic — same dilution as the angel round,
10× the valuation. Time this when growth is faster than you can
fund from revenue.

**Door C — Abstract to second vertical.** Cars is the natural
next — biggest TAM, similar scraping-tolerant data landscape, same
personalization story. Triggered by either: land plateau'd at
$15k+ MRR (pure growth thesis) OR a credible investor interested
in "platform" pitch (fundraising thesis).

---

## Monetization Mix

Listed in order of implementation priority. Each entry: revenue
model, realistic impact, implementation cost, risk.

1. **Subscription tiers (Phase 1)** — $19/mo or $190/yr. Paid for
   unlimited saves, projects, AI features. The core revenue line.
   Low implementation cost (Stripe + Supabase). No regulatory risk.
2. **Usage-metered AI (Phase 2)** — if Claude enrichment becomes
   expensive, move it from "included in $19" to "included up to N
   per month, pay-as-you-go beyond." Monthly reset to stay engaging
   (user idea). Easy to add via existing `ai_costs.json` tracking.
3. **Click-through referral fees (Phase 3)** — affiliate links when
   user contacts a realtor. Requires reaching out to a few regional
   realty firms; legal: standard MLS referral-fee structure, ~1%.
   Small revenue per click but no marginal cost.
4. **Custom-scraping surcharge (Phase 3)** — paying users can point
   us at a specific source we don't already scrape ("watch this
   local FSBO site for me"). $49/setup + ongoing monitoring. High
   willingness to pay for genuinely-motivated buyers.
5. **Premium report exports (Phase 3)** — one-off $19-49 for PDF
   "full underwriting packet" on a single listing (comps, climate
   risk, proximity, voting, all bundled). Good for
   non-subscribers too.
6. **Tailored ads (Phase 4, maybe never)** — sponsored listings,
   tasteful. Revenue per user is poor unless volume is huge; risk
   of damaging user trust is real. Defer until $10k+ MRR, and even
   then reconsider.
7. **Data API / B2B licensing (Phase 4)** — selling the curated
   dataset to other PropTech tools. Big potential but requires
   legal care on data-licensing chain. Consider only if dataset
   quality becomes a defensible moat.

---

## What NOT to Build (Kill List)

Explicit list of things we've decided against pursuing now:

- Multi-vertical expansion (cars / apartments / boats) until core
  vertical crosses $15k MRR
- AI model training (per `project_learning_roadmap.md`) — rely on
  Claude + LLM-in-the-loop, never fine-tune
- Third-party analytics SDKs (GA, Mixpanel, Amplitude) — privacy
  baseline is in-house-only
- Facebook Marketplace, PACER bankruptcy — ToS / legal risk
- Any paid API with per-request cost > $0.01 (Firecrawl staying,
  everything else no)
- Hiring until $10k MRR
- Custom frontend frameworks, state libraries, or design-systems —
  stay Vite + React + Tailwind + shadcn-ish until pain forces change
- "Native mobile app" — web-first, PWA if needed, skip App Store
  tax until real demand

---

## Success + Re-evaluation Triggers

### Signals we're on track
- 10 paying users by day 60
- 30 paying users by day 120
- Retention > 55% at month 3 of any cohort
- At least one user organically shares the app on social
- NPS conversations reveal consistent "I'd pay more for X" pattern

### Signals to revisit strategy
- **Zero paying users at day 60** → revisit positioning. Maybe the
  ICP isn't homesteaders; maybe it's a slightly different rural
  buyer (investors, hunters, retirees). Don't give up — pivot
  positioning first.
- **Growth faster than expected (>100 paying users at day 60)** →
  move to the Raise conversation earlier than planned. That's a
  good problem; take it.
- **A well-resourced competitor launches a near-clone** → don't
  panic. Differentiate on domain depth + data quality, not feature
  parity. The competitive-scan research agent output (2026-04-24)
  addresses this directly.
- **Claude/Anthropic release a general-purpose real-estate agent
  feature** → honestly, unlikely enough that we don't need a
  contingency until it's real news.

---

## Open Questions (to answer before Phase 1 ship)

These are things the founder should decide before day-1 launch:

- **Primary ICP phrasing** — "Ozark homesteaders" / "rural land
  researchers" / "self-sufficient relocators"? Each lands slightly
  different on /r/homestead vs /r/offgrid vs Facebook.
- **First launch subreddit** — pick ONE to measure signal cleanly.
  My guess: /r/homestead.
- **Founder's public identity** — pseudonymous or full-name? Full-
  name gives credibility + future fundraising optionality; pseudo
  keeps personal/professional firewalls. No wrong answer; pick once.
- **Annual vs monthly pricing at launch** — $19/mo only, or both?
  Offering both on day 1 boosts cash flow but complicates churn math.
  My recommendation: $19/mo only for first 30 days, add $190/yr at
  day 30 once you have a churn baseline.

---

## Competitive Findings (2026-04-24 scan)

### Incumbents

| Player | Buyer pricing | AI features last 12mo | Weak spot |
|---|---|---|---|
| LandWatch (CoStar) | Free | None | 2018-era UX, no personalization |
| Land.com network | Free | None | 3 overlapping sites, no cross-site alerts |
| LandHub | Free | None | Lowest traffic, broker-marketing tool |
| LandSearch | Free | None | Has off-grid filter (5,888 listings) but utilitarian UI |
| Whitetail Properties | Free | None | Brokerage, hunting bias, thin outside that |

**All five monetize sellers/agents.** Zero buyer-side subscription
exists. Zero have shipped buyer-facing LLM/AI features. The
buyer-intelligence layer is entirely unclaimed.

### Direct AI-clone risk — GREEN LIGHT

No near-clone exists. Closest adjacents: Acres.com + Prophetic
(enterprise developer tools for homebuilders, not consumers) and
homesteaders.app (planning tool, not listings).

YC W25 + S25 + F25 batches: ~60% AI, zero targeting homesteaders /
rural buyers / off-grid / Ozark. Real-estate AI focus is all
commercial/developer/transaction-automation.

### Plan adjustments driven by findings

**1. Sharpened positioning.** Lead pitch becomes: *"The first
buyer-intelligence tool in rural land. Every other land site is a
free, seller-funded listing dump. We're the research desk."*
Tagline candidates:
- "Research rural land the way you'd research a stock."
- "Buyer-side intelligence for homestead land."
- "The research tool land buyers never had."

**2. Pricing risk is real — stronger free tier, annual option earlier.**
Since buyers are trained to pay $0, free→paid conversion will be
harder than normal SaaS (no price anchor in the category). Adjusted
plan:
- Free tier stays generous enough to prove value: 5 saved listings,
  basic filters, the core deal-score view, read-only access to
  current curated top picks.
- Paywall gates the *differentiators*: AI enrichment, projects,
  personalization, file upload + context, image search, unlimited
  saves, full search history.
- **Offer $190/yr from day 1** (not day 30 as originally scoped).
  Higher friction annual is exactly the commitment-test we want
  while we're educating the market that paid land research is a
  thing.
- 7-day full-feature trial for new signups — gives the AI-powered
  surfaces a chance to prove their value before the paywall hits.

**3. Name collision — keep the name, sharpen the tagline + domain.**
"Homestead Finder" is close enough to `homesteaders.app` and YC's
"Homestead" to cause SEO confusion but different enough in shape
that a clear tagline + category keyword differentiate. Actions:
- Lock down `homesteadfinder.com` if available; otherwise a
  `.app` or `.land` variant. Avoid anything that subsumes
  "homesteaders.app" in Google autocomplete.
- Every piece of marketing copy pairs the name with "for land
  buyers" or "for rural buyers" — explicit category signal.
- Consider shorter brand evolution later (e.g. "Homestead"
  standalone is taken; something like "Parcel" or "Homestead
  Deal" as future rebrand options — not urgent).

**4. New re-evaluation trigger — quarterly Acres.com check.** If
Acres ships a consumer tier or acquires a homestead-focused
property, we differentiate on depth (curated Ozark/rural dataset)
rather than feature parity. This is a watch-item, not a panic
trigger.

**5. Seller-side monetization stays on the menu.** Every incumbent
captures value on the seller side; if buyer-side SaaS plateaus,
adding a "promoted listing" tier for realtors is a known-working
fallback model. Not a Phase 1 concern, but comforting to know
the capped-upside path is not actually capped.

### What the findings DID NOT change

- Bootstrap-to-defensibility stance — if anything, stronger. The
  less pressure the market is under, the better bootstrap works.
- Phase 1 MVP scope (#2 + #3 + #16 + durability + blacklist) —
  unchanged. These are the right features for the positioning.
- Kill list + monetization priority — unchanged.
- Phase 4 optionality — unchanged.

---

## Changelog

- **2026-04-24a** — initial plan drafted. Bootstrap-to-defensibility
  stance chosen over raise-now after weighing solo-founder/zero-user
  dynamics. Competitive scan queued (background). 16-item vision
  demoted from roadmap to menu; Phase 1 MVP scoped to #2/#3/#16
  only, plus Phase 1 durability + blacklist mitigation.
- **2026-04-24b** — competitive scan returned (green light on AI
  clone risk; incumbents all free-to-buyer, zero AI features).
  Plan adjusted: sharpened buyer-intelligence positioning, stronger
  free tier + earlier annual-pricing option to de-risk first-mover
  pricing, kept name with clearer tagline, added quarterly
  Acres.com watch trigger.
