# Homestead Finder — Vision

## The Problem

Finding affordable rural land for homesteading is a fragmented, manual process. Deals are scattered across:
- 3,000+ county treasurer websites (tax sales)
- Auction platforms (GovEase, Bid4Assets, PublicSurplus)
- Commercial listing sites (LandWatch, Lands of America)
- State land offices (BLM, DNR, GLO)
- Federal surplus programs

Each source has a different website, format, schedule, and process. The best deals — tax-defaulted properties selling for pennies on the dollar — are buried in county government PDFs and courthouse bulletin boards. By the time most people find them, the auction is over.

## The Solution

Homestead Finder automatically scrapes all of these sources, scores each property as a homesteading deal (0-100), and presents them on a single dashboard with map, filters, and email notifications.

**One dashboard. Every source. Daily updates.**

## Who Is This For

- People actively looking for affordable rural land to homestead
- Real estate investors focused on tax sale and distressed property deals
- Anyone who wants to monitor land prices across multiple states without manually checking dozens of websites

## What Makes a Good Homesteading Deal

The scoring engine weights five factors:

| Factor | Weight | Why |
|--------|--------|-----|
| Price (per acre vs. regional median, or absolute for tax sales) | 40% | The most objective measure of deal quality |
| Property features (water, road access, electric, timber) | 30% | Water is non-negotiable for homesteading |
| Days on market | 20% | Longer = more leverage for buyers |
| Source type | 10% | Tax sales and auctions have higher deal potential |

## Target Geography

11 states selected for affordable rural land, public land access, and homesteading viability:

| Region | States | Why |
|--------|--------|-----|
| Mountain West | MT, ID, WY, CO | Cheap land, low population density, public land adjacent |
| Southwest | NM | Large state land office, affordable desert/ranch land |
| Pacific Northwest | OR, WA | Timber land, rain, growing season |
| South | TX, TN | Owner-friendly laws, low taxes, large lot sizes |
| Midwest | MN | Tax-forfeited land program, lake/timber country |
| Northeast | ME | Largest unorganized territory east of Mississippi, cheap rural land |

## Core Principles

1. **Government sources first** — tax sales, state land, and surplus are 100% legal to scrape, have the best deals, and don't fight back with Cloudflare
2. **Cost-conscious** — target $1-4/month operating cost. Free strategies before paid ones. Cache everything.
3. **Self-healing** — when a website changes, the AI learns new selectors instead of breaking silently
4. **Transparent** — every API call logged, every dollar tracked, every scraping decision auditable

## What This Is Not

- Not a real estate marketplace (we don't list properties for sale, we aggregate)
- Not a legal advisor (we flag risks but don't provide legal counsel)
- Not a Zillow competitor (we focus on distressed/government sales, not MLS)
