# Homestead Finder — Legal & Compliance

## Disclaimer

This is not legal advice. Consult an attorney for your specific situation.

## Scraping Legal Landscape

### Key Case Law

**hiQ Labs v. LinkedIn (9th Circuit, 2022)** — scraping publicly available data does not violate the Computer Fraud and Abuse Act (CFAA). The data must be visible to anyone with a browser (no login required).

**Van Buren v. United States (Supreme Court, 2021)** — CFAA only applies when someone accesses a computer without authorization. Accessing publicly available websites is not unauthorized access.

### What This Means for Us

All our target data is publicly available:
- Government tax sale listings are public records
- Auction platform listings are visible without login
- We don't bypass authentication or paywalls

## Source-by-Source Risk Assessment

### Government Sources (Zero Risk)
These are public records, often legally required to be published.

| Source | Risk | Basis |
|--------|------|-------|
| County tax sale listings | None | Public records by law |
| State land offices (BLM, DNR, GLO) | None | Government public data |
| State surplus property | None | Public procurement records |
| Federal surplus (GSA) | None | Government public data |

### Auction Platforms (Low Risk)
These publish listings publicly to attract bidders.

| Source | Risk | robots.txt | Notes |
|--------|------|-----------|-------|
| GovEase | Very low | Permissive | Public listings, no login needed |
| PublicSurplus | Very low | Permissive | County surplus auctions |
| Grant Street | Very low | Permissive (`Allow: /`) | Tax lien/deed auctions |
| MNBid | None | Gov site | State of Minnesota |
| Bid4Assets | Low | Cloudflare | Public listings, ToS may restrict |
| RealAuction | Low | Cloudflare | Public listings, ToS may restrict |

### Commercial Listing Sites (Medium Risk)
These actively fight scrapers.

| Source | Risk | Status | Notes |
|--------|------|--------|-------|
| LandWatch | Medium | Disabled (403'd) | CoStar Group owns it, aggressive about enforcement |
| Lands of America | Medium | Disabled (403'd) | Same parent company as LandWatch |
| Zillow | Higher | Disabled | Has sued scrapers. We keep it disabled. |
| Realtor.com | Higher | Disabled | News Corp (aggressive). We keep it disabled. |

## Our Compliance Rules

### 1. Always Check robots.txt
Before scraping any new source, check its robots.txt and obey it.

**Implementation:** Source registry includes `robots_txt_ok` field for each platform.

### 2. Rate Limit Aggressively
All scrapers wait 2-3 seconds between requests with random jitter.

**Implementation:** `BaseScraper.sleep()` with configurable `RATE_LIMIT_SECONDS`.

### 3. Don't Copy Descriptions
Store facts (price, acreage, location, parcel number) — these are not copyrightable. Truncate descriptions to 500 chars max. Don't republish full listing text.

### 4. Attribute Sources
Every listing links back to the original source URL. The `source` field and `url` field are always populated.

### 5. Don't Monetize Their Data Directly
This is a personal deal-finding tool, not a competing listing site. We aggregate and score, not republish.

### 6. Government Sources First
Our strategy prioritizes government data (tax sales, state land, surplus) over commercial sites. This is both legally safer and where the best deals are.

### 7. Keep Aggressive Scrapers Disabled
Zillow and Realtor.com are disabled by default in `config.ENABLED_SOURCES`. Do not enable without explicit decision and legal review.

### 8. Respond to Cease & Desist
If any source sends a C&D or asks us to stop, we stop immediately for that source. No arguing.

## Terms of Service Considerations

Most websites prohibit scraping in their ToS. Key points:

- **ToS violations are contract issues**, not criminal. The remedy is typically an injunction (they ask you to stop) or account termination (you don't have an account).
- **Cloudflare's bot protection is not an access control** under CFAA. It's a technical anti-abuse measure, not a login/authentication gate.
- **ToS are harder to enforce against anonymous scrapers** running from cloud IPs. We're not logging in, not creating accounts, not identifying ourselves.

## Practical Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| IP ban | All scraping from GitHub Actions / Codespace IPs, not personal |
| C&D letter | Honor immediately, disable that source |
| Rate limiting | 2-3 second delays with jitter, max 5 pages per source |
| Copyright claim | Store facts only, truncate descriptions, link to original |
| Data privacy | Tax sales are public records, but redact owner names from display |
| VPN/employer exposure | Never run scrapers on personal/corporate network |

## Data Privacy

Tax sale listings include owner names (they're public records). We should:
- Store owner names in the raw data (useful for research)
- Consider not displaying owner names on the frontend dashboard
- Never use owner data for marketing or contact purposes

## Resources

- [EFF: Web Scraping Legal Guide](https://www.eff.org/issues/coders/reverse-engineering-faq)
- [hiQ v. LinkedIn (9th Cir. 2022)](https://casetext.com/case/hiq-labs-inc-v-linkedin-corp-4)
- [Van Buren v. United States (2021)](https://www.supremecourt.gov/opinions/20pdf/19-783_k53l.pdf)
- [CFAA Overview](https://www.law.cornell.edu/uscode/text/18/1030)
