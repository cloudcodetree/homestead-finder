# Source Registry

Structured catalog of government property sale sources across all target states.

## Structure

```
source_registry/
├── registry.json          ← master index of all platforms + state portals
├── states/
│   ├── MT.json            ← Montana sources (state + county)
│   ├── ID.json            ← Idaho
│   └── ...
└── README.md              ← this file
```

## Entry Schema

Each source entry in a state file:

```json
{
  "id": "MT-yellowstone-tax-deed",
  "state": "MT",
  "county": "Yellowstone",
  "type": "tax_deed_sale",
  "url": "https://example.com/tax-sale",
  "platform": "realauction",
  "format": "html_table",
  "frequency": "annual",
  "typical_month": "August",
  "last_verified": "2026-04-05",
  "status": "active",
  "robots_txt_ok": true,
  "notes": ""
}
```

## Types

- `tax_deed_sale` — county sells the property for unpaid taxes
- `tax_lien_sale` — county sells a lien certificate (not the property)
- `tax_forfeiture` — property forfeits to state, then sold
- `state_land_sale` — state DNR/land office selling trust land
- `state_surplus` — state disposing of unneeded property
- `sheriff_sale` — court-ordered foreclosure sale
- `bankruptcy_auction` — federal court liquidation

## Platforms

- `govease` — govease.com
- `bid4assets` — bid4assets.com
- `realauction` — realauction.com / *.realtaxdeed.com
- `grantstreet` — grantstreet.com / LienHub / DeedAuction
- `publicsurplus` — publicsurplus.com
- `mnbid` — mnbid.mn.gov
- `govdeals` — govdeals.com
- `civicsource` — civicsource.com
- `county_website` — custom county site
- `state_website` — state portal
- `none` — in-person only, no online listing

## Maintenance

Run `python main.py --validate-sources` to check all URLs are still live.
Registry should be audited monthly.
