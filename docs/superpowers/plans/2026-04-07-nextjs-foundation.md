# Next.js Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Next.js + Vercel site at `web/` that displays the same listings as the current Vite frontend, with server-rendered pages for SEO and the architecture ready for auth/billing in the next plan.

**Architecture:** Next.js 15 App Router in a new `web/` subdirectory alongside the existing `frontend/`. Data comes from the existing `data/listings.json` file imported at build time (no database yet — that's the next plan). Tailwind CSS v4, TypeScript strict, Vitest for tests. Deployed to Vercel with the repo's `web/` directory as the project root.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS v4, Vitest, Vercel

**Scope:** This plan covers Workstream 1A of Phase A from the [product vision spec](../specs/2026-04-07-product-vision-design.md). It does NOT include: Turso database (Workstream 1B), Clerk auth (1C), Stripe billing (1C), saved searches (1D), watchlist (1D), or removing the legacy frontend (1E).

**What "done" looks like:** You can visit a Vercel preview URL and see a working Next.js dashboard with filters, listing detail pages, and state landing pages — populated with the same data the current Vite site shows.

---

## File Structure

Files this plan creates (all under `web/`):

```
web/
├── package.json                          ← Next.js dependencies
├── tsconfig.json                         ← TypeScript strict config
├── next.config.ts                        ← Next.js config
├── postcss.config.mjs                    ← Tailwind v4 plugin
├── vitest.config.ts                      ← Vitest config
├── app/
│   ├── layout.tsx                        ← Root layout with nav
│   ├── page.tsx                          ← Landing page (/)
│   ├── globals.css                       ← Tailwind imports
│   ├── deals/
│   │   ├── page.tsx                      ← Browse page (/deals)
│   │   └── [id]/
│   │       └── page.tsx                  ← Detail page (/deals/[id])
│   └── states/
│       └── [state]/
│           └── page.tsx                  ← State page (/states/[state])
├── components/
│   ├── PropertyCard.tsx                  ← Ported from frontend (with ValidationBadge)
│   ├── PropertyDetail.tsx                ← Ported from frontend (detail page body)
│   ├── FilterPanel.tsx                   ← Ported from frontend (with hideHeader prop)
│   ├── ValidationBadge.tsx               ← Shared status badge
│   ├── UrlCopyButton.tsx                 ← Client-only URL copy button
│   ├── SortDropdown.tsx                  ← Client-only sort select
│   └── Nav.tsx                           ← New navigation component
├── lib/
│   ├── listings.ts                       ← Data loader
│   ├── formatters.ts                     ← Ported from frontend
│   ├── scoring.ts                        ← Ported from frontend
│   └── filters.ts                        ← Filter logic (server + client)
├── types/
│   └── property.ts                       ← Ported from frontend
└── __tests__/
    ├── formatters.test.ts
    ├── scoring.test.ts
    ├── filters.test.ts
    └── listings.test.ts
```

Files at the repo root this plan modifies:

- `vercel.json` — Vercel project config (root directory, build command)
- `.gitignore` — add `web/node_modules`, `web/.next`
- `context/ROLLING_CONTEXT.md` — update with session notes

**Unchanged (this plan does NOT touch):**
- `frontend/` — legacy Vite app stays working
- `scraper/` — Python scraper unchanged
- `data/` — data files unchanged, read by `web/` via relative import

---

## Task 1: Scaffold Next.js Project

**Files:**
- Create: `web/package.json`
- Create: `web/tsconfig.json`
- Create: `web/next.config.ts`
- Create: `web/postcss.config.mjs`
- Create: `web/app/layout.tsx` (placeholder)
- Create: `web/app/page.tsx` (placeholder)
- Create: `web/app/globals.css`
- Create: `web/.gitignore`
- Modify: `.gitignore` (repo root)

- [ ] **Step 1: Create the web directory and verify it doesn't conflict**

```bash
cd /workspaces/homestead-finder && ls web 2>/dev/null
```

Expected: `ls: cannot access 'web': No such file or directory`

- [ ] **Step 2: Run the Next.js scaffold command**

```bash
cd /workspaces/homestead-finder && npx create-next-app@latest web \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir=false \
  --turbopack \
  --import-alias='@/*' \
  --no-install \
  --yes
```

Expected: Output ending with "Initializing project with template: app-tw" (or similar). The `--no-install` flag skips npm install — we'll do that manually.

- [ ] **Step 3: Install dependencies (including dev deps we'll need)**

```bash
cd /workspaces/homestead-finder/web && npm install && npm install -D vitest @vitejs/plugin-react @testing-library/react @testing-library/jest-dom jsdom
```

Expected: Output ending with `added N packages in Ns`. Creates `web/node_modules/` and `web/package-lock.json`.

- [ ] **Step 4: Verify the scaffold builds**

```bash
cd /workspaces/homestead-finder/web && npm run build
```

Expected: Output ending with `✓ Compiled successfully` and a summary of routes. If it fails, check Node version (must be 20+).

- [ ] **Step 5: Update repo-level .gitignore**

Add these lines to `/workspaces/homestead-finder/.gitignore`:

```
# Next.js (in web/ subdirectory)
web/node_modules
web/.next
web/out
web/.env.local
```

- [ ] **Step 6: Commit**

```bash
cd /workspaces/homestead-finder && git add web/ .gitignore && git commit -m "feat(web): scaffold Next.js app in web/ subdirectory"
```

---

## Task 2: Set Up Vitest Test Infrastructure

**Files:**
- Create: `web/vitest.config.ts`
- Create: `web/vitest.setup.ts`
- Create: `web/__tests__/sanity.test.ts`
- Modify: `web/package.json` (add test script)

- [ ] **Step 1: Create vitest config**

Create `/workspaces/homestead-finder/web/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
});
```

- [ ] **Step 2: Create vitest setup file**

Create `/workspaces/homestead-finder/web/vitest.setup.ts`:

```typescript
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 3: Add test script to package.json**

In `/workspaces/homestead-finder/web/package.json`, add to the `scripts` object:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Write a sanity test**

Create `/workspaces/homestead-finder/web/__tests__/sanity.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';

describe('sanity', () => {
  it('runs vitest', () => {
    expect(2 + 2).toBe(4);
  });
});
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd /workspaces/homestead-finder/web && npm test
```

Expected: `✓ __tests__/sanity.test.ts (1 test)` and exit code 0.

- [ ] **Step 6: Commit**

```bash
cd /workspaces/homestead-finder && git add web/ && git commit -m "feat(web): add vitest test infrastructure"
```

---

## Task 3: Port Property Types from Frontend

**Files:**
- Create: `web/types/property.ts`
- Reference: `frontend/src/types/property.ts`

- [ ] **Step 1: Read the existing types file**

```bash
cat /workspaces/homestead-finder/frontend/src/types/property.ts
```

Expected: Shows the existing Property, FilterState, PropertyFeature definitions.

- [ ] **Step 2: Create the ported types file**

Create `/workspaces/homestead-finder/web/types/property.ts`:

```typescript
export interface PropertyLocation {
  lat: number;
  lng: number;
  state: string;
  county: string;
  address?: string;
}

export type PropertyFeature =
  | 'water_well'
  | 'water_creek'
  | 'water_pond'
  | 'road_paved'
  | 'road_dirt'
  | 'electric'
  | 'septic'
  | 'structures'
  | 'timber'
  | 'pasture'
  | 'hunting'
  | 'mineral_rights'
  | 'no_hoa'
  | 'off_grid_ready'
  | 'owner_financing';

/**
 * Listing status reflects whether the source URL is still valid.
 * - 'active' — URL has been validated and returns 200
 * - 'expired' — URL was validated previously but now returns 404/410
 * - 'unverified' — URL has not yet been checked (default for fresh scrapes)
 */
export type ListingStatus = 'active' | 'expired' | 'unverified';

export interface Property {
  id: string;
  title: string;
  price: number;
  acreage: number;
  pricePerAcre: number;
  location: PropertyLocation;
  features: PropertyFeature[];
  source: string;
  url: string;
  dateFound: string;
  dealScore: number;
  description?: string;
  daysOnMarket?: number;
  imageUrl?: string;
  validated?: boolean;
  validatedAt?: string;
  status?: ListingStatus;
}

/**
 * Sort options for the deals browse page.
 * Matches the 6 options in the Dashboard's sort dropdown.
 */
export type SortOption =
  | 'score'
  | 'price_asc'
  | 'price_desc'
  | 'ppa_asc'
  | 'acreage_desc'
  | 'newest';

export const SORT_OPTION_LABELS: Record<SortOption, string> = {
  score: 'Best Deal (Score)',
  price_asc: 'Price: Low to High',
  price_desc: 'Price: High to Low',
  ppa_asc: 'Price/Acre: Low to High',
  acreage_desc: 'Acreage: Most',
  newest: 'Newest First',
};

export interface FilterState {
  minPrice: number;
  maxPrice: number;
  minAcreage: number;
  maxAcreage: number;
  maxPricePerAcre: number;
  states: string[];
  features: PropertyFeature[];
  minDealScore: number;
  sources: string[];
}

export const DEFAULT_FILTERS: FilterState = {
  minPrice: 0,
  maxPrice: 2_000_000,
  minAcreage: 0,
  maxAcreage: 10_000,
  maxPricePerAcre: 10_000,
  states: [],
  features: [],
  minDealScore: 0,
  sources: [],
};

export const FEATURE_LABELS: Record<PropertyFeature, string> = {
  water_well: 'Water Well',
  water_creek: 'Creek/Stream',
  water_pond: 'Pond/Lake',
  road_paved: 'Paved Road',
  road_dirt: 'Dirt Road',
  electric: 'Electric',
  septic: 'Septic',
  structures: 'Structures',
  timber: 'Timber',
  pasture: 'Pasture',
  hunting: 'Hunting',
  mineral_rights: 'Mineral Rights',
  no_hoa: 'No HOA',
  off_grid_ready: 'Off-Grid Ready',
  owner_financing: 'Owner Financing',
};

export const US_STATES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri',
  MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio',
  OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont',
  VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /workspaces/homestead-finder/web && npx tsc --noEmit
```

Expected: No output (success).

- [ ] **Step 4: Commit**

```bash
cd /workspaces/homestead-finder && git add web/types/ && git commit -m "feat(web): port Property types from frontend"
```

---

## Task 4: Port Formatter Utilities (TDD)

**Files:**
- Create: `web/lib/formatters.ts`
- Create: `web/__tests__/formatters.test.ts`

- [ ] **Step 1: Write failing tests for all formatter functions**

Create `/workspaces/homestead-finder/web/__tests__/formatters.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  formatPrice,
  formatPricePerAcre,
  formatAcreage,
  formatDate,
  formatDaysAgo,
  formatSourceName,
} from '@/lib/formatters';

describe('formatPrice', () => {
  it('formats millions', () => {
    expect(formatPrice(2_500_000)).toBe('$2.5M');
  });
  it('formats thousands', () => {
    expect(formatPrice(50_000)).toBe('$50k');
  });
  it('formats small values with comma', () => {
    expect(formatPrice(500)).toBe('$500');
  });
});

describe('formatPricePerAcre', () => {
  it('formats positive per-acre value', () => {
    expect(formatPricePerAcre(1234)).toBe('$1,234/ac');
  });
  it('returns empty string for zero or negative', () => {
    expect(formatPricePerAcre(0)).toBe('');
    expect(formatPricePerAcre(-10)).toBe('');
  });
});

describe('formatAcreage', () => {
  it('returns empty string for zero acres', () => {
    expect(formatAcreage(0)).toBe('');
  });
  it('formats thousands as k acres', () => {
    expect(formatAcreage(1500)).toBe('1.5k acres');
  });
  it('formats whole acres without decimals', () => {
    expect(formatAcreage(40)).toBe('40 acres');
  });
  it('formats fractional acres with one decimal', () => {
    expect(formatAcreage(2.5)).toBe('2.5 acres');
  });
});

describe('formatDate', () => {
  it('formats ISO date to readable format', () => {
    const result = formatDate('2026-04-07');
    expect(result).toMatch(/Apr \d+, 2026/);
  });
});

describe('formatDaysAgo', () => {
  it('returns "Today" for same-day dates', () => {
    const today = new Date().toISOString().slice(0, 10);
    expect(formatDaysAgo(today)).toBe('Today');
  });
});

describe('formatSourceName', () => {
  it('maps known source to display name', () => {
    expect(formatSourceName('govease')).toBe('GovEase Tax Sale');
    expect(formatSourceName('landwatch')).toBe('LandWatch');
  });
  it('returns original for unknown source', () => {
    expect(formatSourceName('unknown')).toBe('unknown');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /workspaces/homestead-finder/web && npm test -- formatters
```

Expected: `FAIL` with "Cannot find module '@/lib/formatters'".

- [ ] **Step 3: Implement formatters**

Create `/workspaces/homestead-finder/web/lib/formatters.ts`:

```typescript
export const formatPrice = (price: number): string => {
  if (price >= 1_000_000) {
    return `$${(price / 1_000_000).toFixed(1)}M`;
  }
  if (price >= 1_000) {
    return `$${(price / 1_000).toFixed(0)}k`;
  }
  return `$${price.toLocaleString()}`;
};

export const formatPricePerAcre = (pricePerAcre: number): string => {
  if (pricePerAcre <= 0) return '';
  return `$${Math.round(pricePerAcre).toLocaleString()}/ac`;
};

export const formatAcreage = (acreage: number): string => {
  if (acreage <= 0) return '';
  if (acreage >= 1000) {
    return `${(acreage / 1000).toFixed(1)}k acres`;
  }
  return `${acreage % 1 === 0 ? acreage : acreage.toFixed(1)} acres`;
};

export const formatDate = (isoDate: string): string => {
  const date = new Date(isoDate);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export const formatDaysAgo = (isoDate: string): string => {
  const date = new Date(isoDate);
  const now = new Date();
  const days = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (days === 0) return 'Today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
};

export const formatSourceName = (source: string): string => {
  const names: Record<string, string> = {
    landwatch: 'LandWatch',
    lands_of_america: 'Lands of America',
    zillow: 'Zillow',
    realtor: 'Realtor.com',
    county_tax: 'County Tax Sale',
    govease: 'GovEase Tax Sale',
    auction: 'Auction',
    blm: 'BLM/USDA',
  };
  return names[source] ?? source;
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /workspaces/homestead-finder/web && npm test -- formatters
```

Expected: All 9+ tests pass.

- [ ] **Step 5: Commit**

```bash
cd /workspaces/homestead-finder && git add web/lib/formatters.ts web/__tests__/formatters.test.ts && git commit -m "feat(web): port formatter utilities with tests"
```

---

## Task 5: Port Scoring Helpers (TDD)

**Files:**
- Create: `web/lib/scoring.ts`
- Create: `web/__tests__/scoring.test.ts`

- [ ] **Step 1: Write failing tests**

Create `/workspaces/homestead-finder/web/__tests__/scoring.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  getDealScoreColor,
  getDealScoreBorderColor,
  getDealScoreLabel,
  getDealScoreTextColor,
} from '@/lib/scoring';

describe('getDealScoreColor', () => {
  it('returns green for hot deals (>= 80)', () => {
    expect(getDealScoreColor(95)).toContain('green');
  });
  it('returns yellow for good deals (65-79)', () => {
    expect(getDealScoreColor(70)).toContain('yellow');
  });
  it('returns orange for fair deals (50-64)', () => {
    expect(getDealScoreColor(55)).toContain('orange');
  });
  it('returns gray for below average (<50)', () => {
    expect(getDealScoreColor(30)).toContain('gray');
  });
});

describe('getDealScoreLabel', () => {
  it('labels hot deals', () => {
    expect(getDealScoreLabel(85)).toBe('Hot Deal');
  });
  it('labels good deals', () => {
    expect(getDealScoreLabel(70)).toBe('Good Deal');
  });
  it('labels fair deals', () => {
    expect(getDealScoreLabel(55)).toBe('Fair');
  });
  it('labels below average', () => {
    expect(getDealScoreLabel(30)).toBe('Below Avg');
  });
});

describe('getDealScoreBorderColor', () => {
  it('returns appropriate border class', () => {
    expect(getDealScoreBorderColor(85)).toContain('green');
    expect(getDealScoreBorderColor(30)).toContain('gray');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /workspaces/homestead-finder/web && npm test -- scoring
```

Expected: `FAIL` with "Cannot find module '@/lib/scoring'".

- [ ] **Step 3: Implement scoring helpers**

Create `/workspaces/homestead-finder/web/lib/scoring.ts`:

```typescript
export const getDealScoreColor = (score: number): string => {
  if (score >= 80) return 'bg-green-500 text-white';
  if (score >= 65) return 'bg-yellow-400 text-gray-900';
  if (score >= 50) return 'bg-orange-400 text-white';
  return 'bg-gray-400 text-white';
};

export const getDealScoreBorderColor = (score: number): string => {
  if (score >= 80) return 'border-green-500';
  if (score >= 65) return 'border-yellow-400';
  if (score >= 50) return 'border-orange-400';
  return 'border-gray-300';
};

export const getDealScoreLabel = (score: number): string => {
  if (score >= 80) return 'Hot Deal';
  if (score >= 65) return 'Good Deal';
  if (score >= 50) return 'Fair';
  return 'Below Avg';
};

export const getDealScoreTextColor = (score: number): string => {
  if (score >= 80) return 'text-green-600';
  if (score >= 65) return 'text-yellow-600';
  if (score >= 50) return 'text-orange-500';
  return 'text-gray-500';
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /workspaces/homestead-finder/web && npm test -- scoring
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
cd /workspaces/homestead-finder && git add web/lib/scoring.ts web/__tests__/scoring.test.ts && git commit -m "feat(web): port scoring helpers with tests"
```

---

## Task 6: Build Listings Data Loader (TDD)

**Files:**
- Create: `web/lib/listings.ts`
- Create: `web/__tests__/listings.test.ts`
- Create: `web/lib/sample-listings.ts`
- Reference: `frontend/src/data/sample-listings.json`

**Context for this task:** The listings data loader is the bridge between the raw JSON data and the pages. There's a design decision here about what happens when `data/listings.json` is empty or missing — a common case during early development and after a failed scrape run.

- [ ] **Step 1: Create the sample data fallback module**

Read the existing sample data file:

```bash
cat /workspaces/homestead-finder/frontend/src/data/sample-listings.json | head -50
```

Then create `/workspaces/homestead-finder/web/lib/sample-listings.ts`:

```typescript
import type { Property } from '@/types/property';

// Minimal sample fallback used when data/listings.json is empty or missing.
// Real samples are in frontend/src/data/sample-listings.json for the legacy app.
export const SAMPLE_LISTINGS: Property[] = [
  {
    id: 'sample_1',
    title: '40 Acres — Madison County, MT',
    price: 65_000,
    acreage: 40,
    pricePerAcre: 1625,
    location: { lat: 45.84, lng: -111.5, state: 'MT', county: 'Madison' },
    features: ['water_creek', 'timber', 'hunting', 'off_grid_ready'],
    source: 'landwatch',
    url: 'https://example.com/sample-1',
    dateFound: new Date().toISOString().slice(0, 10),
    dealScore: 78,
    description: 'Sample listing for development. Real data will appear here once the scraper runs.',
    status: 'unverified',
  },
  {
    id: 'sample_2',
    title: '15 Acres — Klamath County, OR',
    price: 28_500,
    acreage: 15,
    pricePerAcre: 1900,
    location: { lat: 42.22, lng: -121.78, state: 'OR', county: 'Klamath' },
    features: ['water_well', 'pasture', 'electric'],
    source: 'county_tax',
    url: 'https://example.com/sample-2',
    dateFound: new Date().toISOString().slice(0, 10),
    dealScore: 72,
    description: 'Sample listing for development. Real data will appear here once the scraper runs.',
    status: 'unverified',
  },
];
```

- [ ] **Step 2: Write failing tests for the data loader**

Create `/workspaces/homestead-finder/web/__tests__/listings.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  loadListings,
  getListingById,
  getListingsByState,
  getStateStats,
} from '@/lib/listings';
import type { Property } from '@/types/property';

// Mock the raw data import
vi.mock('../../data/listings.json', () => ({
  default: [
    {
      id: 'test_1',
      title: 'Test Listing 1',
      price: 100_000,
      acreage: 50,
      pricePerAcre: 2000,
      location: { lat: 45, lng: -111, state: 'MT', county: 'Madison' },
      features: ['water_well'],
      source: 'landwatch',
      url: 'https://example.com/1',
      dateFound: '2026-04-01',
      dealScore: 85,
    },
    {
      id: 'test_2',
      title: 'Test Listing 2',
      price: 50_000,
      acreage: 20,
      pricePerAcre: 2500,
      location: { lat: 42, lng: -121, state: 'OR', county: 'Klamath' },
      features: ['water_creek'],
      source: 'county_tax',
      url: 'https://example.com/2',
      dateFound: '2026-04-02',
      dealScore: 72,
    },
  ] satisfies Property[],
}));

describe('loadListings', () => {
  it('returns all listings from the data file', () => {
    const listings = loadListings();
    expect(listings.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to sample data when data file is empty', async () => {
    // Re-mock with empty array
    vi.doMock('../../data/listings.json', () => ({ default: [] }));
    const { loadListings: loadFresh } = await import('@/lib/listings');
    const listings = loadFresh();
    expect(listings.length).toBeGreaterThan(0);
    expect(listings[0].id.startsWith('sample_')).toBe(true);
  });
});

describe('getListingById', () => {
  it('finds a listing by id', () => {
    const listing = getListingById('test_1');
    expect(listing?.title).toBe('Test Listing 1');
  });

  it('returns undefined for unknown id', () => {
    expect(getListingById('nonexistent')).toBeUndefined();
  });
});

describe('getListingsByState', () => {
  it('filters by state code', () => {
    const mt = getListingsByState('MT');
    expect(mt.every((l) => l.location.state === 'MT')).toBe(true);
    expect(mt.length).toBeGreaterThan(0);
  });

  it('returns empty array for state with no listings', () => {
    const xx = getListingsByState('XX');
    expect(xx).toEqual([]);
  });
});

describe('getStateStats', () => {
  it('computes stats for a state', () => {
    const stats = getStateStats('MT');
    expect(stats.count).toBeGreaterThan(0);
    expect(stats.avgScore).toBeGreaterThanOrEqual(0);
    expect(stats.minPrice).toBeGreaterThan(0);
  });

  it('returns zero stats for state with no listings', () => {
    const stats = getStateStats('XX');
    expect(stats.count).toBe(0);
    expect(stats.avgScore).toBe(0);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd /workspaces/homestead-finder/web && npm test -- listings
```

Expected: `FAIL` with "Cannot find module '@/lib/listings'".

- [ ] **Step 4: Implement the listings data loader**

Create `/workspaces/homestead-finder/web/lib/listings.ts`:

```typescript
import type { Property } from '@/types/property';
import { SAMPLE_LISTINGS } from './sample-listings';
// The data file is imported at build time. When we migrate to Turso,
// this single import becomes a DB query.
import rawListings from '../../data/listings.json';

// Cached listings — loaded once per process
let _cache: Property[] | null = null;

/**
 * Load all listings from the data file, falling back to sample data
 * when the file is empty (common during development or after failed scrapes).
 */
export function loadListings(): Property[] {
  if (_cache !== null) return _cache;

  const raw = rawListings as Property[];
  if (Array.isArray(raw) && raw.length > 0) {
    _cache = raw;
  } else {
    _cache = SAMPLE_LISTINGS;
  }
  return _cache;
}

/** Find a single listing by its id. */
export function getListingById(id: string): Property | undefined {
  return loadListings().find((l) => l.id === id);
}

/** Get all listings for a given state (2-letter code, case-insensitive). */
export function getListingsByState(state: string): Property[] {
  const upper = state.toUpperCase();
  return loadListings().filter((l) => l.location.state.toUpperCase() === upper);
}

export interface StateStats {
  count: number;
  avgScore: number;
  minPrice: number;
  maxPrice: number;
  totalAcreage: number;
  topSources: string[];
}

/** Compute aggregated statistics for a state. */
export function getStateStats(state: string): StateStats {
  const listings = getListingsByState(state);
  if (listings.length === 0) {
    return {
      count: 0,
      avgScore: 0,
      minPrice: 0,
      maxPrice: 0,
      totalAcreage: 0,
      topSources: [],
    };
  }

  const prices = listings.map((l) => l.price).filter((p) => p > 0);
  const totalAcreage = listings.reduce((sum, l) => sum + (l.acreage || 0), 0);
  const scoreSum = listings.reduce((sum, l) => sum + l.dealScore, 0);

  // Top 3 sources by listing count
  const sourceCount = new Map<string, number>();
  for (const l of listings) {
    sourceCount.set(l.source, (sourceCount.get(l.source) ?? 0) + 1);
  }
  const topSources = [...sourceCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([source]) => source);

  return {
    count: listings.length,
    avgScore: Math.round(scoreSum / listings.length),
    minPrice: prices.length > 0 ? Math.min(...prices) : 0,
    maxPrice: prices.length > 0 ? Math.max(...prices) : 0,
    totalAcreage: Math.round(totalAcreage),
    topSources,
  };
}

/** Reset the cache (used by tests). */
export function _resetCache(): void {
  _cache = null;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd /workspaces/homestead-finder/web && npm test -- listings
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
cd /workspaces/homestead-finder && git add web/lib/ web/__tests__/listings.test.ts && git commit -m "feat(web): add listings data loader with state stats"
```

---

## Task 7: Build Filter Logic (LEARNING OPPORTUNITY)

**Files:**
- Create: `web/lib/filters.ts`
- Create: `web/__tests__/filters.test.ts`

**Context for this task:** The filter logic translates a `FilterState` object into a predicate that checks each listing. This is business logic with real choices — for example, how to treat the `features` array (must the listing have ALL selected features, or ANY of them?). The existing frontend uses ALL-match semantics. You'll implement this yourself because the choice affects the product UX.

- [ ] **Step 1: Write failing tests for filter logic**

Create `/workspaces/homestead-finder/web/__tests__/filters.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { applyFilters, DEFAULT_FILTERS_STATE } from '@/lib/filters';
import type { Property, FilterState } from '@/types/property';
import { DEFAULT_FILTERS } from '@/types/property';

const makeProperty = (overrides: Partial<Property>): Property => ({
  id: 'p1',
  title: 'Test',
  price: 50_000,
  acreage: 20,
  pricePerAcre: 2500,
  location: { lat: 0, lng: 0, state: 'MT', county: 'Madison' },
  features: [],
  source: 'landwatch',
  url: 'https://example.com',
  dateFound: '2026-04-01',
  dealScore: 70,
  ...overrides,
});

describe('applyFilters', () => {
  it('returns all listings with default filters', () => {
    const listings = [makeProperty({}), makeProperty({ id: 'p2' })];
    expect(applyFilters(listings, DEFAULT_FILTERS).length).toBe(2);
  });

  it('filters by minimum price', () => {
    const listings = [
      makeProperty({ price: 10_000 }),
      makeProperty({ id: 'p2', price: 100_000 }),
    ];
    const filters: FilterState = { ...DEFAULT_FILTERS, minPrice: 50_000 };
    expect(applyFilters(listings, filters).length).toBe(1);
  });

  it('filters by maximum price', () => {
    const listings = [
      makeProperty({ price: 10_000 }),
      makeProperty({ id: 'p2', price: 100_000 }),
    ];
    const filters: FilterState = { ...DEFAULT_FILTERS, maxPrice: 50_000 };
    expect(applyFilters(listings, filters).length).toBe(1);
  });

  it('filters by acreage range', () => {
    const listings = [
      makeProperty({ acreage: 5 }),
      makeProperty({ id: 'p2', acreage: 50 }),
      makeProperty({ id: 'p3', acreage: 500 }),
    ];
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      minAcreage: 10,
      maxAcreage: 100,
    };
    expect(applyFilters(listings, filters).length).toBe(1);
  });

  it('filters by maxPricePerAcre', () => {
    const listings = [
      makeProperty({ pricePerAcre: 1000 }),
      makeProperty({ id: 'p2', pricePerAcre: 5000 }),
    ];
    const filters: FilterState = { ...DEFAULT_FILTERS, maxPricePerAcre: 2000 };
    expect(applyFilters(listings, filters).length).toBe(1);
  });

  it('filters by minimum deal score', () => {
    const listings = [
      makeProperty({ dealScore: 50 }),
      makeProperty({ id: 'p2', dealScore: 85 }),
    ];
    const filters: FilterState = { ...DEFAULT_FILTERS, minDealScore: 75 };
    expect(applyFilters(listings, filters).length).toBe(1);
  });

  it('filters by states (OR match)', () => {
    const listings = [
      makeProperty({ location: { lat: 0, lng: 0, state: 'MT', county: 'X' } }),
      makeProperty({
        id: 'p2',
        location: { lat: 0, lng: 0, state: 'OR', county: 'Y' },
      }),
      makeProperty({
        id: 'p3',
        location: { lat: 0, lng: 0, state: 'CA', county: 'Z' },
      }),
    ];
    const filters: FilterState = { ...DEFAULT_FILTERS, states: ['MT', 'OR'] };
    expect(applyFilters(listings, filters).length).toBe(2);
  });

  it('filters by features (AND match — must have all selected)', () => {
    const listings = [
      makeProperty({ features: ['water_well'] }),
      makeProperty({ id: 'p2', features: ['water_well', 'electric'] }),
      makeProperty({
        id: 'p3',
        features: ['water_well', 'electric', 'road_paved'],
      }),
    ];
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      features: ['water_well', 'electric'],
    };
    const result = applyFilters(listings, filters);
    expect(result.length).toBe(2);
    expect(result.map((p) => p.id)).toEqual(['p2', 'p3']);
  });

  it('filters by source', () => {
    const listings = [
      makeProperty({ source: 'landwatch' }),
      makeProperty({ id: 'p2', source: 'govease' }),
    ];
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      sources: ['govease'],
    };
    expect(applyFilters(listings, filters).length).toBe(1);
  });

  it('combines multiple filters with AND', () => {
    const listings = [
      makeProperty({ price: 50_000, dealScore: 60 }),
      makeProperty({ id: 'p2', price: 50_000, dealScore: 85 }),
      makeProperty({ id: 'p3', price: 200_000, dealScore: 85 }),
    ];
    const filters: FilterState = {
      ...DEFAULT_FILTERS,
      maxPrice: 100_000,
      minDealScore: 75,
    };
    expect(applyFilters(listings, filters).length).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /workspaces/homestead-finder/web && npm test -- filters
```

Expected: `FAIL` with "Cannot find module '@/lib/filters'".

- [ ] **Step 3: Create the file skeleton with TODO marker**

Create `/workspaces/homestead-finder/web/lib/filters.ts`:

```typescript
import type { Property, FilterState } from '@/types/property';
import { DEFAULT_FILTERS } from '@/types/property';

// Re-export for convenience
export const DEFAULT_FILTERS_STATE = DEFAULT_FILTERS;

/**
 * Apply a FilterState to a list of properties and return the matches.
 *
 * Filter semantics:
 * - price / acreage / pricePerAcre / dealScore → numeric range checks
 * - states → OR match (listing in ANY selected state)
 * - features → AND match (listing must have ALL selected features)
 * - sources → OR match (listing from ANY selected source)
 * - All filter groups combine with AND (listing must pass every group)
 */
export function applyFilters(
  properties: Property[],
  filters: FilterState,
): Property[] {
  // TODO(user): Implement the filter predicate.
  // See the tests in web/__tests__/filters.test.ts for the exact semantics.
  return [];
}
```

- [ ] **Step 4: USER CONTRIBUTION — Implement applyFilters**

**This is a learning opportunity.** The filter logic has real business choices baked in:

1. **Features: ALL vs. ANY** — when a user selects "Water Well" AND "Electric", should we show listings that have both, or listings that have either? The existing frontend uses ALL-match semantics (`every`), which means users get fewer but more precise results. I've written the tests to assume this behavior.

2. **States: OR vs. AND** — selecting multiple states uses OR (a listing from MT OR OR matches). This is intuitive.

3. **Empty filter arrays** — if `filters.states = []`, should we filter everything out, or show all states? Standard practice: empty array = "no filter, show all".

4. **Numeric bounds** — `price >= minPrice AND price <= maxPrice`. Inclusive bounds.

Implement the function body in `web/lib/filters.ts`. Aim for ~15 lines. Use `Array.prototype.filter` with a single predicate. The function signature and tests are already written for you.

When you're done, run the tests.

- [ ] **Step 5: Run tests to verify the implementation passes**

```bash
cd /workspaces/homestead-finder/web && npm test -- filters
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
cd /workspaces/homestead-finder && git add web/lib/filters.ts web/__tests__/filters.test.ts && git commit -m "feat(web): add filter logic with AND/OR semantics"
```

---

## Task 8a: Create ValidationBadge Component

**Files:**
- Create: `web/components/ValidationBadge.tsx`

**Context:** The frontend has a `ValidationBadge` inline component duplicated in `PropertyCard.tsx` and `PropertyDetail.tsx`. In the Next.js port, extract it into a shared component. This is a server component (no interactivity), so it stays fast and cacheable.

- [ ] **Step 1: Create the ValidationBadge component**

Create `/workspaces/homestead-finder/web/components/ValidationBadge.tsx`:

```typescript
import type { ListingStatus } from '@/types/property';

interface ValidationBadgeProps {
  status?: ListingStatus;
  /** Size variant — compact for cards, normal for detail page */
  size?: 'sm' | 'md';
}

/**
 * Shows a listing's validation status as a colored pill.
 * Defaults to 'unverified' (yellow) when status is undefined.
 */
export const ValidationBadge = ({
  status,
  size = 'sm',
}: ValidationBadgeProps) => {
  const s = status ?? 'unverified';
  const padding = size === 'md' ? 'px-2 py-0.5' : 'px-1.5 py-0.5';
  const gap = size === 'md' ? 'gap-1' : 'gap-0.5';

  if (s === 'active') {
    return (
      <span
        className={`inline-flex items-center ${gap} rounded-full bg-green-50 border border-green-200 ${padding} text-xs font-medium text-green-700`}
      >
        ✓ Verified
      </span>
    );
  }

  if (s === 'expired') {
    return (
      <span
        className={`inline-flex items-center ${gap} rounded-full bg-red-50 border border-red-200 ${padding} text-xs font-medium text-red-600`}
      >
        ✗ Expired
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center ${gap} rounded-full bg-yellow-50 border border-yellow-200 ${padding} text-xs font-medium text-yellow-700`}
    >
      ⚠ Unverified
    </span>
  );
};
```

- [ ] **Step 2: Verify it type-checks**

```bash
cd /workspaces/homestead-finder/web && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /workspaces/homestead-finder && git add web/components/ValidationBadge.tsx && git commit -m "feat(web): add shared ValidationBadge component"
```

---

## Task 8: Port PropertyCard Component (with ValidationBadge)

**Files:**
- Create: `web/components/PropertyCard.tsx`
- Reference: `frontend/src/components/PropertyCard.tsx`

**Context:** The Next.js version of PropertyCard differs from the Vite version in one important way: it becomes a `<Link>` that navigates to `/deals/[id]` instead of an `onClick` handler that opens a modal. This is the SEO win — each listing gets its own URL that Google can index. The component visually matches the current frontend (validation badge in top-right stacked with score).

- [ ] **Step 1: Read the existing component for reference**

```bash
cat /workspaces/homestead-finder/frontend/src/components/PropertyCard.tsx
```

- [ ] **Step 2: Create the Next.js version**

Create `/workspaces/homestead-finder/web/components/PropertyCard.tsx`:

```typescript
import Link from 'next/link';
import type { Property } from '@/types/property';
import { FEATURE_LABELS } from '@/types/property';
import {
  formatPrice,
  formatAcreage,
  formatPricePerAcre,
  formatDaysAgo,
  formatSourceName,
} from '@/lib/formatters';
import {
  getDealScoreColor,
  getDealScoreLabel,
  getDealScoreBorderColor,
} from '@/lib/scoring';
import { ValidationBadge } from './ValidationBadge';

interface PropertyCardProps {
  property: Property;
}

const extractFromDescription = (description: string, field: string): string => {
  const match = description.match(new RegExp(`${field}:\\s*([^.]+)`));
  return match ? match[1].trim() : '';
};

const getSaleTypeBadge = (
  description: string,
): { label: string; className: string } | null => {
  const type = extractFromDescription(description, 'Type');
  if (!type) return null;
  if (type.toLowerCase().includes('lien'))
    return {
      label: 'Tax Lien',
      className: 'bg-blue-50 text-blue-700 border-blue-200',
    };
  if (type.toLowerCase().includes('deed'))
    return {
      label: 'Tax Deed',
      className: 'bg-purple-50 text-purple-700 border-purple-200',
    };
  if (type.toLowerCase().includes('foreclosure'))
    return {
      label: 'Foreclosure',
      className: 'bg-red-50 text-red-700 border-red-200',
    };
  return {
    label: type,
    className: 'bg-gray-50 text-gray-700 border-gray-200',
  };
};

export const PropertyCard = ({ property }: PropertyCardProps) => {
  const scoreColor = getDealScoreColor(property.dealScore);
  const scoreBorder = getDealScoreBorderColor(property.dealScore);
  const parcel = extractFromDescription(property.description ?? '', 'Parcel');
  const saleType = getSaleTypeBadge(property.description ?? '');

  return (
    <Link
      href={`/deals/${encodeURIComponent(property.id)}`}
      className={`block rounded-lg border-2 bg-white p-4 transition-all hover:shadow-md border-gray-200 hover:${scoreBorder}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 text-sm leading-tight truncate">
            {property.title}
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {property.location.county} County, {property.location.state} &middot;{' '}
            {formatSourceName(property.source)}
          </p>
          {parcel && (
            <p className="text-xs text-gray-400 mt-0.5 font-mono truncate">
              Parcel: {parcel}
            </p>
          )}
        </div>
        {/* Score + ValidationBadge stacked (matches current frontend layout) */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <div
            className={`rounded-full px-2 py-1 text-xs font-bold ${scoreColor}`}
          >
            {property.dealScore}
          </div>
          <ValidationBadge status={property.status} />
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <div>
          <p className="text-lg font-bold text-gray-900">
            {formatPrice(property.price)}
          </p>
          <p className="text-xs text-gray-500">
            {formatPricePerAcre(property.pricePerAcre) || 'Face value'}
          </p>
        </div>
        {property.acreage > 0 && (
          <>
            <div className="text-gray-300">|</div>
            <div>
              <p className="text-base font-semibold text-gray-700">
                {formatAcreage(property.acreage)}
              </p>
            </div>
          </>
        )}
        <div className="ml-auto">
          <p className="text-xs text-gray-500">
            {getDealScoreLabel(property.dealScore)}
          </p>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-1">
        {saleType && (
          <span
            className={`inline-block rounded px-1.5 py-0.5 text-xs border font-medium ${saleType.className}`}
          >
            {saleType.label}
          </span>
        )}
        {property.features.slice(0, 3).map((feature) => (
          <span
            key={feature}
            className="inline-block rounded bg-green-50 px-1.5 py-0.5 text-xs text-green-700 border border-green-200"
          >
            {FEATURE_LABELS[feature]}
          </span>
        ))}
        {property.features.length > 3 && (
          <span className="inline-block rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
            +{property.features.length - 3}
          </span>
        )}
      </div>

      <p className="mt-2 text-xs text-gray-400">
        {formatDaysAgo(property.dateFound)}
      </p>
    </Link>
  );
};
```

- [ ] **Step 3: Verify it type-checks**

```bash
cd /workspaces/homestead-finder/web && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
cd /workspaces/homestead-finder && git add web/components/PropertyCard.tsx && git commit -m "feat(web): port PropertyCard component with Next.js Link"
```

---

## Task 9: Port FilterPanel Component (with `hideHeader` prop)

**Files:**
- Create: `web/components/FilterPanel.tsx`
- Reference: `frontend/src/components/FilterPanel.tsx`

**Context:** The current frontend has a `hideHeader` prop on FilterPanel so the parent layout (the collapsible sidebar and mobile drawer) can render its own header with collapse button and active-filter count. We match that API.

**Note:** The current frontend also has a "Sort By" button row inside FilterPanel that writes to `filters.sortBy`, but that state is unused — the actual sorting happens in `Dashboard.tsx` with a separate local `sortBy` state. The Next.js port skips this dead button row and uses only the working dropdown.

- [ ] **Step 1: Create the FilterPanel**

Create `/workspaces/homestead-finder/web/components/FilterPanel.tsx`:

```typescript
'use client';

import type { FilterState, PropertyFeature } from '@/types/property';
import { FEATURE_LABELS } from '@/types/property';

interface FilterPanelProps {
  filters: FilterState;
  onUpdateFilter: <K extends keyof FilterState>(
    key: K,
    value: FilterState[K],
  ) => void;
  onToggleState: (state: string) => void;
  onToggleFeature: (feature: PropertyFeature) => void;
  onReset: () => void;
  hasActiveFilters: boolean;
  resultCount: number;
  /** When true, the panel's built-in header is suppressed so the parent can render its own */
  hideHeader?: boolean;
}

const TARGET_STATES = [
  'AL', 'AZ', 'CO', 'ID', 'ME', 'MN', 'MT', 'NM',
  'OK', 'OR', 'TN', 'TX', 'UT', 'WA', 'WI', 'WY',
];

export const FilterPanel = ({
  filters,
  onUpdateFilter,
  onToggleState,
  onToggleFeature,
  onReset,
  hasActiveFilters,
  resultCount,
  hideHeader = false,
}: FilterPanelProps) => {
  return (
    <div className="bg-white h-full">
      {!hideHeader && (
        <div className="p-4 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white z-10">
          <div>
            <h2 className="font-semibold text-gray-900">Filters</h2>
            <p className="text-xs text-gray-500">{resultCount} properties</p>
          </div>
          {hasActiveFilters && (
            <button
              onClick={onReset}
              className="text-xs text-green-600 hover:text-green-700 font-medium"
            >
              Clear all
            </button>
          )}
        </div>
      )}

      <div className="p-4 space-y-6">
        {/* Deal Score */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Min Deal Score:{' '}
            <span className="text-green-600 font-bold">
              {filters.minDealScore}
            </span>
          </label>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={filters.minDealScore}
            onChange={(e) =>
              onUpdateFilter('minDealScore', Number(e.target.value))
            }
            className="w-full accent-green-600"
          />
        </div>

        {/* Price Range */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Price Range
          </label>
          <div className="flex gap-2">
            <input
              type="number"
              min={0}
              value={filters.minPrice}
              onChange={(e) =>
                onUpdateFilter('minPrice', Number(e.target.value))
              }
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              placeholder="Min"
            />
            <input
              type="number"
              min={filters.minPrice}
              value={filters.maxPrice}
              onChange={(e) =>
                onUpdateFilter('maxPrice', Number(e.target.value))
              }
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              placeholder="Max"
            />
          </div>
        </div>

        {/* Acreage */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Acreage
          </label>
          <div className="flex gap-2 items-center">
            <input
              type="number"
              min={0}
              value={filters.minAcreage}
              onChange={(e) =>
                onUpdateFilter('minAcreage', Number(e.target.value))
              }
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              placeholder="Min"
            />
            <span className="text-gray-400 text-sm">–</span>
            <input
              type="number"
              min={0}
              value={filters.maxAcreage}
              onChange={(e) =>
                onUpdateFilter('maxAcreage', Number(e.target.value))
              }
              className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
              placeholder="Max"
            />
          </div>
        </div>

        {/* States */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            States
          </label>
          <div className="flex flex-wrap gap-1.5">
            {TARGET_STATES.map((state) => (
              <button
                key={state}
                onClick={() => onToggleState(state)}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                  filters.states.includes(state)
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {state}
              </button>
            ))}
          </div>
        </div>

        {/* Features */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Features (must have all)
          </label>
          <div className="space-y-1.5">
            {(Object.keys(FEATURE_LABELS) as PropertyFeature[]).map((feature) => (
              <label
                key={feature}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={filters.features.includes(feature)}
                  onChange={() => onToggleFeature(feature)}
                  className="rounded border-gray-300 text-green-600 focus:ring-green-500"
                />
                <span className="text-sm text-gray-700">
                  {FEATURE_LABELS[feature]}
                </span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Verify it type-checks**

```bash
cd /workspaces/homestead-finder/web && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /workspaces/homestead-finder && git add web/components/FilterPanel.tsx && git commit -m "feat(web): port FilterPanel as client component"
```

---

## Task 10: Root Layout with Navigation

**Files:**
- Create: `web/components/Nav.tsx`
- Modify: `web/app/layout.tsx`
- Modify: `web/app/globals.css` (if needed)

- [ ] **Step 1: Create Nav component**

Create `/workspaces/homestead-finder/web/components/Nav.tsx`:

```typescript
import Link from 'next/link';

export const Nav = () => {
  return (
    <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-4 flex-shrink-0">
      <Link href="/" className="flex items-center gap-2">
        <span className="text-xl">🌿</span>
        <h1 className="font-bold text-gray-900 text-lg">Homestead Finder</h1>
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link
          href="/deals"
          className="text-gray-600 hover:text-gray-900 font-medium"
        >
          Browse Deals
        </Link>
        <Link
          href="/states/MT"
          className="text-gray-600 hover:text-gray-900 font-medium"
        >
          By State
        </Link>
      </nav>
    </header>
  );
};
```

- [ ] **Step 2: Update the root layout**

Replace the contents of `/workspaces/homestead-finder/web/app/layout.tsx`:

```typescript
import type { Metadata } from 'next';
import { Nav } from '@/components/Nav';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Homestead Finder — Tax sales, auctions, and land deals',
    template: '%s | Homestead Finder',
  },
  description:
    'Find affordable rural land deals across 11 states. Tax sales, auctions, and BLM disposals aggregated from hundreds of sources.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-50 flex flex-col">
        <Nav />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Build to verify**

```bash
cd /workspaces/homestead-finder/web && npm run build
```

Expected: Builds without errors.

- [ ] **Step 4: Commit**

```bash
cd /workspaces/homestead-finder && git add web/components/Nav.tsx web/app/layout.tsx && git commit -m "feat(web): root layout with nav"
```

---

## Task 11: Landing Page

**Files:**
- Modify: `web/app/page.tsx`

- [ ] **Step 1: Replace the landing page**

Replace the contents of `/workspaces/homestead-finder/web/app/page.tsx`:

```typescript
import Link from 'next/link';
import { loadListings } from '@/lib/listings';

export default function HomePage() {
  const listings = loadListings();
  const totalCount = listings.length;
  const hotDeals = listings.filter((l) => l.dealScore >= 80).length;
  const states = new Set(listings.map((l) => l.location.state)).size;

  return (
    <div className="max-w-4xl mx-auto px-4 py-16">
      <div className="text-center mb-12">
        <h1 className="text-4xl sm:text-5xl font-bold text-gray-900 mb-4">
          Find affordable rural land before anyone else.
        </h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          We scrape tax sales, government auctions, and surplus land programs
          across 11 states. Every deal scored 0-100, updated daily.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-6 max-w-2xl mx-auto mb-12">
        <div className="bg-white rounded-lg p-6 text-center border border-gray-200">
          <p className="text-3xl font-bold text-gray-900">{totalCount}</p>
          <p className="text-sm text-gray-500 mt-1">Listings tracked</p>
        </div>
        <div className="bg-white rounded-lg p-6 text-center border border-gray-200">
          <p className="text-3xl font-bold text-green-600">{hotDeals}</p>
          <p className="text-sm text-gray-500 mt-1">Hot deals (80+ score)</p>
        </div>
        <div className="bg-white rounded-lg p-6 text-center border border-gray-200">
          <p className="text-3xl font-bold text-gray-900">{states}</p>
          <p className="text-sm text-gray-500 mt-1">States covered</p>
        </div>
      </div>

      <div className="text-center">
        <Link
          href="/deals"
          className="inline-block bg-green-600 hover:bg-green-700 text-white font-semibold px-8 py-3 rounded-lg transition-colors"
        >
          Browse all deals →
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Test the build**

```bash
cd /workspaces/homestead-finder/web && npm run build
```

Expected: Builds with the landing page listed in the output.

- [ ] **Step 3: Commit**

```bash
cd /workspaces/homestead-finder && git add web/app/page.tsx && git commit -m "feat(web): landing page with live stats"
```

---

## Task 12: Deals Browse Page (with sidebar, mobile drawer, sort)

**Files:**
- Create: `web/app/deals/page.tsx`
- Create: `web/app/deals/DealsClient.tsx`

**Context:** This page is the most complex client component in the plan. It has:
1. **Collapsible desktop sidebar** — the FilterPanel lives in an aside that collapses from `w-72` to `w-10` via a `‹/›` toggle button
2. **Mobile drawer** — on screens below `lg`, filters appear in a slide-from-left drawer with backdrop overlay
3. **Floating action button (FAB)** — bottom-left "Filters" button on mobile to open the drawer
4. **Sort dropdown** — 6 sort options in a `<select>` above the grid
5. **Active filter count** — shown in the sidebar header and FAB label

The page file itself is a server component (loads data). The DealsClient inside it is a client component (all state + interactivity).

**Tailwind gotcha:** the `hover:${scoreBorder}` pattern in PropertyCard won't work at runtime because Tailwind scans class strings statically at build time. Use explicit conditional classes instead. This is already handled in PropertyCard Task 8 — I'm flagging it here because the same rule applies to DealsClient's dynamic classes.

- [ ] **Step 1: Create the DealsClient with full sidebar/drawer/sort logic**

Create `/workspaces/homestead-finder/web/app/deals/DealsClient.tsx`:

```typescript
'use client';

import { useState, useMemo } from 'react';
import type {
  Property,
  FilterState,
  PropertyFeature,
  SortOption,
} from '@/types/property';
import { DEFAULT_FILTERS } from '@/types/property';
import { PropertyCard } from '@/components/PropertyCard';
import { FilterPanel } from '@/components/FilterPanel';
import { applyFilters } from '@/lib/filters';

interface DealsClientProps {
  allListings: Property[];
}

export function DealsClient({ allListings }: DealsClientProps) {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showFilters, setShowFilters] = useState(false); // mobile drawer
  const [sortBy, setSortBy] = useState<SortOption>('score');

  const updateFilter = <K extends keyof FilterState>(
    key: K,
    value: FilterState[K],
  ) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const toggleState = (state: string) => {
    setFilters((prev) => ({
      ...prev,
      states: prev.states.includes(state)
        ? prev.states.filter((s) => s !== state)
        : [...prev.states, state],
    }));
  };

  const toggleFeature = (feature: PropertyFeature) => {
    setFilters((prev) => ({
      ...prev,
      features: prev.features.includes(feature)
        ? prev.features.filter((f) => f !== feature)
        : [...prev.features, feature],
    }));
  };

  const resetFilters = () => setFilters(DEFAULT_FILTERS);

  // Cheap boolean — no useMemo needed
  // (react-best-practices: rerender-simple-expression-in-memo)
  const hasActiveFilters =
    filters.minPrice !== DEFAULT_FILTERS.minPrice ||
    filters.maxPrice !== DEFAULT_FILTERS.maxPrice ||
    filters.minAcreage !== DEFAULT_FILTERS.minAcreage ||
    filters.maxAcreage !== DEFAULT_FILTERS.maxAcreage ||
    filters.maxPricePerAcre !== DEFAULT_FILTERS.maxPricePerAcre ||
    filters.minDealScore !== DEFAULT_FILTERS.minDealScore ||
    filters.states.length > 0 ||
    filters.features.length > 0 ||
    filters.sources.length > 0;

  // Count active filters for the sidebar/FAB badge
  const activeFilterCount =
    (filters.minPrice !== DEFAULT_FILTERS.minPrice ? 1 : 0) +
    (filters.maxPrice !== DEFAULT_FILTERS.maxPrice ? 1 : 0) +
    (filters.minAcreage !== DEFAULT_FILTERS.minAcreage ? 1 : 0) +
    (filters.maxAcreage !== DEFAULT_FILTERS.maxAcreage ? 1 : 0) +
    (filters.maxPricePerAcre !== DEFAULT_FILTERS.maxPricePerAcre ? 1 : 0) +
    (filters.minDealScore !== DEFAULT_FILTERS.minDealScore ? 1 : 0) +
    filters.states.length +
    filters.features.length +
    filters.sources.length;

  // Filter is O(n) — cache with useMemo
  const filtered = useMemo(
    () => applyFilters(allListings, filters),
    [allListings, filters],
  );

  // Sort is O(n log n) — cache with useMemo, depends on sortBy + filtered
  const sorted = useMemo(
    () =>
      [...filtered].sort((a, b) => {
        switch (sortBy) {
          case 'price_asc':
            return a.price - b.price;
          case 'price_desc':
            return b.price - a.price;
          case 'ppa_asc':
            return a.pricePerAcre - b.pricePerAcre;
          case 'acreage_desc':
            return b.acreage - a.acreage;
          case 'newest':
            return (
              new Date(b.dateFound).getTime() - new Date(a.dateFound).getTime()
            );
          case 'score':
          default:
            return b.dealScore - a.dealScore;
        }
      }),
    [filtered, sortBy],
  );

  return (
    <div className="flex h-[calc(100vh-57px)]">
      {/* Desktop collapsible sidebar */}
      <aside
        className={`hidden lg:flex flex-col flex-shrink-0 bg-white border-r border-gray-200 overflow-hidden transition-[width] duration-300 ease-in-out ${
          sidebarOpen ? 'w-72' : 'w-10'
        }`}
      >
        {/* Inner container stays w-72 so content clips when outer collapses */}
        <div className="w-72 flex flex-col h-full">
          <div className="flex-shrink-0 flex items-center gap-2 px-2 h-12 border-b border-gray-100">
            <button
              onClick={() => setSidebarOpen((s) => !s)}
              className="flex-shrink-0 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded p-1 transition-colors"
              title={sidebarOpen ? 'Collapse filters' : 'Expand filters'}
            >
              {sidebarOpen ? '‹' : '›'}
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">
                Filters
                {activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </p>
              <p className="text-xs text-gray-500">
                {sorted.length} properties
              </p>
            </div>
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                className="flex-shrink-0 text-xs text-green-600 hover:text-green-700 font-medium"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto">
            <FilterPanel
              filters={filters}
              onUpdateFilter={updateFilter}
              onToggleState={toggleState}
              onToggleFeature={toggleFeature}
              onReset={resetFilters}
              hasActiveFilters={hasActiveFilters}
              resultCount={sorted.length}
              hideHeader
            />
          </div>
        </div>
      </aside>

      {/* Mobile drawer backdrop */}
      <div
        className={`lg:hidden fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${
          showFilters ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={() => setShowFilters(false)}
      />

      {/* Mobile drawer */}
      <div
        className={`lg:hidden fixed top-0 left-0 bottom-0 z-50 w-80 max-w-[85vw] bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${
          showFilters ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <div>
            <h2 className="font-semibold text-gray-900">
              Filters
              {activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ''}
            </h2>
            <p className="text-xs text-gray-500">{sorted.length} properties</p>
          </div>
          <div className="flex items-center gap-3">
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                className="text-xs text-green-600 hover:text-green-700 font-medium"
              >
                Clear all
              </button>
            )}
            <button
              onClick={() => setShowFilters(false)}
              className="text-gray-400 hover:text-gray-600 text-xl font-light leading-none"
            >
              ✕
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <FilterPanel
            filters={filters}
            onUpdateFilter={updateFilter}
            onToggleState={toggleState}
            onToggleFeature={toggleFeature}
            onReset={resetFilters}
            hasActiveFilters={hasActiveFilters}
            resultCount={sorted.length}
            hideHeader
          />
        </div>
      </div>

      {/* Main content */}
      <section className="flex-1 overflow-hidden">
        <div className="h-full overflow-y-auto p-4">
          {/* Sort + count bar */}
          <div className="flex items-center justify-between mb-4 max-w-6xl mx-auto">
            <p className="text-sm text-gray-500">
              {sorted.length} properties
            </p>
            <div className="flex items-center gap-2">
              <label
                className="text-sm text-gray-600 hidden sm:block"
                htmlFor="sort-select"
              >
                Sort:
              </label>
              <select
                id="sort-select"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-1 focus:ring-green-500 focus:outline-none"
              >
                <option value="score">Best Deal (Score)</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="ppa_asc">Price/Acre: Low to High</option>
                <option value="acreage_desc">Acreage: Most</option>
                <option value="newest">Newest First</option>
              </select>
            </div>
          </div>

          {sorted.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <p className="text-4xl mb-3">🌾</p>
              <p className="text-gray-600 font-medium">
                No properties match your filters
              </p>
              <button
                onClick={resetFilters}
                className="mt-3 text-green-600 hover:text-green-700 text-sm font-medium"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-w-6xl mx-auto">
              {sorted.map((property) => (
                <PropertyCard key={property.id} property={property} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Mobile FAB */}
      <button
        onClick={() => setShowFilters(true)}
        className={`lg:hidden fixed bottom-6 left-4 z-30 flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-full shadow-lg font-medium text-sm transition-all duration-200 ${
          showFilters ? 'opacity-0 pointer-events-none' : 'opacity-100'
        }`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="4" y1="6" x2="20" y2="6" />
          <line x1="8" y1="12" x2="16" y2="12" />
          <line x1="11" y1="18" x2="13" y2="18" />
        </svg>
        Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create the server component page**

Create `/workspaces/homestead-finder/web/app/deals/page.tsx`:

```typescript
import type { Metadata } from 'next';
import { loadListings } from '@/lib/listings';
import { DealsClient } from './DealsClient';

export const metadata: Metadata = {
  title: 'Browse all deals',
  description:
    'Browse tax sales, auctions, and government land deals across 11 states. Filter by price, acreage, features, and deal score.',
};

export default function DealsPage() {
  const listings = loadListings();
  return <DealsClient allListings={listings} />;
}
```

- [ ] **Step 3: Build to verify**

```bash
cd /workspaces/homestead-finder/web && npm run build
```

Expected: `/deals` appears in the route list. No TypeScript errors.

- [ ] **Step 4: Run the dev server and check visually**

```bash
cd /workspaces/homestead-finder/web && npm run dev
```

Expected: Open http://localhost:3000/deals and verify:
- Desktop: filter sidebar collapses/expands with `‹/›` button
- Desktop: sort dropdown reorders listings (try "Price: Low to High")
- Mobile: resize browser to <1024px, FAB appears, click opens drawer with backdrop

Press Ctrl+C to stop.

- [ ] **Step 5: Commit**

```bash
cd /workspaces/homestead-finder && git add web/app/deals/ && git commit -m "feat(web): deals page with collapsible sidebar, mobile drawer, and sort"
```

---

## Task 12a: Create UrlCopyButton Client Component

**Files:**
- Create: `web/components/UrlCopyButton.tsx`

**Context:** The listing detail page (a server component for SEO) needs a button that copies the listing URL to the clipboard and shows "Copied!" feedback. The clipboard API and the state transition both require client-side JavaScript, so we extract this into a tiny client component that the server-rendered detail page embeds as a leaf.

- [ ] **Step 1: Create the UrlCopyButton**

Create `/workspaces/homestead-finder/web/components/UrlCopyButton.tsx`:

```typescript
'use client';

import { useState } from 'react';

interface UrlCopyButtonProps {
  url: string;
}

export const UrlCopyButton = ({ url }: UrlCopyButtonProps) => {
  const [copied, setCopied] = useState(false);

  const copyUrl = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={copyUrl}
      title="Copy URL"
      className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
    >
      {copied ? (
        <span className="text-xs text-green-600 font-medium whitespace-nowrap">
          Copied!
        </span>
      ) : (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
};
```

- [ ] **Step 2: Verify type check**

```bash
cd /workspaces/homestead-finder/web && npx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd /workspaces/homestead-finder && git add web/components/UrlCopyButton.tsx && git commit -m "feat(web): add UrlCopyButton client component for clipboard"
```

---

## Task 13: Listing Detail Page (LEARNING OPPORTUNITY)

**Files:**
- Create: `web/app/deals/[id]/page.tsx`

**Context for this task:** This page is the SEO engine. Every listing gets its own URL that Google can index. The `generateMetadata` function controls what Google sees — title, description, Open Graph tags, canonical URL. There are real choices here about what's in the title and description, which affects search ranking and click-through rate. You'll implement `generateMetadata` yourself.

**Architecture:** The page itself is a server component (for SEO). The `UrlCopyButton` from Task 12a is imported as a leaf — it "opts into" client rendering without forcing the whole page to be a client component.

- [ ] **Step 1: Create the detail page with a TODO for metadata**

Create `/workspaces/homestead-finder/web/app/deals/[id]/page.tsx`:

```typescript
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { getListingById } from '@/lib/listings';
import { FEATURE_LABELS } from '@/types/property';
import {
  formatPrice,
  formatAcreage,
  formatPricePerAcre,
  formatDate,
  formatSourceName,
} from '@/lib/formatters';
import { getDealScoreColor, getDealScoreLabel } from '@/lib/scoring';
import { ValidationBadge } from '@/components/ValidationBadge';
import { UrlCopyButton } from '@/components/UrlCopyButton';

interface PageProps {
  params: Promise<{ id: string }>;
}

/**
 * SEO metadata for this listing.
 *
 * This is the function Google crawlers use to build search result snippets.
 * Good metadata means more clicks from search — the title is the blue link,
 * the description is the gray preview text.
 *
 * You're implementing this yourself because the specific wording affects
 * real product outcomes (search ranking, click-through rate).
 */
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const listing = getListingById(decodeURIComponent(id));
  if (!listing) {
    return { title: 'Listing not found' };
  }

  // TODO(user): Build SEO-optimized metadata from the listing.
  // See the guidance below Step 2.
  return {
    title: listing.title,
    description: 'A listing on Homestead Finder.',
  };
}

export default async function ListingDetailPage({ params }: PageProps) {
  const { id } = await params;
  const listing = getListingById(decodeURIComponent(id));
  if (!listing) notFound();

  const scoreColor = getDealScoreColor(listing.dealScore);
  const status = listing.status ?? 'unverified';

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <Link
        href="/deals"
        className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block"
      >
        ← Back to all deals
      </Link>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {/* Header with title, validation badge, and score */}
        <div className="flex items-start gap-3 mb-6">
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">
              {listing.title}
            </h1>
            <p className="text-gray-500 mt-1">
              {listing.location.county} County, {listing.location.state} &middot;{' '}
              {formatSourceName(listing.source)}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <ValidationBadge status={listing.status} size="md" />
            <div
              className={`rounded-full px-4 py-2 text-lg font-bold ${scoreColor}`}
            >
              {listing.dealScore}
            </div>
          </div>
        </div>

        {/* Key stats — adapts to whether acreage is known */}
        <div
          className={`grid gap-4 mb-6 ${
            listing.acreage > 0 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1'
          }`}
        >
          <div className="bg-gray-50 rounded-lg p-4 text-center">
            <p className="text-2xl font-bold text-gray-900">
              {formatPrice(listing.price)}
            </p>
            <p className="text-sm text-gray-500 mt-1">
              {listing.acreage > 0 ? 'Asking Price' : 'Face Value'}
            </p>
          </div>
          {listing.acreage > 0 && (
            <>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">
                  {formatAcreage(listing.acreage)}
                </p>
                <p className="text-sm text-gray-500 mt-1">Total Acreage</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-2xl font-bold text-gray-900">
                  {formatPricePerAcre(listing.pricePerAcre)}
                </p>
                <p className="text-sm text-gray-500 mt-1">Price / Acre</p>
              </div>
            </>
          )}
        </div>

        {listing.description && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">
              Description
            </h2>
            <p className="text-sm text-gray-600 leading-relaxed">
              {listing.description}
            </p>
          </div>
        )}

        {listing.features.length > 0 && (
          <div className="mb-6">
            <h2 className="text-sm font-semibold text-gray-700 mb-2">
              Features
            </h2>
            <div className="flex flex-wrap gap-2">
              {listing.features.map((feature) => (
                <span
                  key={feature}
                  className="rounded-full bg-green-50 border border-green-200 px-3 py-1 text-sm text-green-700 font-medium"
                >
                  {FEATURE_LABELS[feature]}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Metadata grid — skip lat/lng if unset */}
        <div className="border-t border-gray-100 pt-4 grid grid-cols-2 gap-3 text-sm mb-6">
          <div>
            <p className="text-gray-500 text-xs">Source</p>
            <p className="text-gray-800 font-medium">
              {formatSourceName(listing.source)}
            </p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">Found</p>
            <p className="text-gray-800 font-medium">
              {formatDate(listing.dateFound)}
            </p>
          </div>
          <div>
            <p className="text-gray-500 text-xs">Score</p>
            <p className="text-gray-800 font-medium">
              {listing.dealScore} — {getDealScoreLabel(listing.dealScore)}
            </p>
          </div>
          {(listing.location.lat !== 0 || listing.location.lng !== 0) && (
            <div>
              <p className="text-gray-500 text-xs">Location</p>
              <p className="text-gray-800 font-medium">
                {listing.location.lat.toFixed(4)},{' '}
                {listing.location.lng.toFixed(4)}
              </p>
            </div>
          )}
        </div>

        {/* Listing URL with copy button (client component leaf) */}
        <div className="border-t border-gray-100 pt-4 mb-6">
          <p className="text-gray-500 text-xs mb-1">Listing URL</p>
          <div className="flex items-center gap-2 min-w-0">
            <a
              href={listing.url}
              target="_blank"
              rel="noopener noreferrer"
              title={listing.url}
              className="text-blue-600 hover:underline text-sm truncate min-w-0 flex-1"
            >
              {listing.url}
            </a>
            <UrlCopyButton url={listing.url} />
          </div>
        </div>

        {/* Status-aware CTA */}
        <div>
          {status === 'unverified' && (
            <p className="text-xs text-yellow-700 text-center mb-2">
              ⚠ Sample listing — link may not work
            </p>
          )}
          {status === 'expired' && (
            <p className="text-xs text-red-600 text-center mb-2">
              ✗ This listing has expired or is no longer available
            </p>
          )}
          <a
            href={listing.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`block w-full text-center font-semibold py-3 rounded-lg transition-colors ${
              status === 'expired'
                ? 'bg-gray-200 text-gray-500'
                : 'bg-green-600 hover:bg-green-700 text-white'
            }`}
          >
            View Full Listing →
          </a>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: USER CONTRIBUTION — Write the `generateMetadata` body**

**This is a learning opportunity.** The SEO metadata has real product impact. When someone searches "40 acres Montana tax sale", Google uses your `title` and `description` to build the search result snippet. Good metadata = more clicks.

Guidance:
- **Title** should include the most valuable keywords: acreage, state/county, sale type, and price. Example: `"40 Acres Autauga County, AL — Tax Lien $286 | Homestead Finder"`. Keep under 60 characters for Google.
- **Description** should be 140-160 characters. Summarize: acreage, location, price, score, source. Example: `"40 acres in Autauga County, AL. Tax lien auction starting at $286. Deal score: 65/100. Source: GovEase."`
- **Consider the case when `listing.acreage === 0`** (tax sale with no acreage data). The title shouldn't say "0 Acres".
- **Consider the `openGraph` field** — Facebook/Twitter use this when the link is shared. Optional but nice.

Implement the `generateMetadata` function body. Aim for ~15-20 lines. Reference what the existing listing data looks like by running:

```bash
cat /workspaces/homestead-finder/data/listings.json | head -40
```

- [ ] **Step 3: Build and verify**

```bash
cd /workspaces/homestead-finder/web && npm run build
```

Expected: Build succeeds, `/deals/[id]` listed as a dynamic route.

- [ ] **Step 4: Commit**

```bash
cd /workspaces/homestead-finder && git add web/app/deals/[id]/ && git commit -m "feat(web): listing detail page with SEO metadata"
```

---

## Task 14: State Landing Page

**Files:**
- Create: `web/app/states/[state]/page.tsx`

- [ ] **Step 1: Create the state page**

Create `/workspaces/homestead-finder/web/app/states/[state]/page.tsx`:

```typescript
import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import {
  getListingsByState,
  getStateStats,
} from '@/lib/listings';
import { US_STATES } from '@/types/property';
import { PropertyCard } from '@/components/PropertyCard';
import { formatPrice } from '@/lib/formatters';

interface PageProps {
  params: Promise<{ state: string }>;
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { state } = await params;
  const upper = state.toUpperCase();
  const stateName = US_STATES[upper];
  if (!stateName) return { title: 'State not found' };

  const stats = getStateStats(upper);
  const count = stats.count;
  return {
    title: `${stateName} land deals — ${count} listings`,
    description: `Browse ${count} land deals in ${stateName}. Tax sales, auctions, and government disposals. Prices from ${formatPrice(stats.minPrice || 0)}.`,
  };
}

export default async function StatePage({ params }: PageProps) {
  const { state } = await params;
  const upper = state.toUpperCase();
  const stateName = US_STATES[upper];
  if (!stateName) notFound();

  const listings = getListingsByState(upper);
  const stats = getStateStats(upper);

  // Sort by score descending, show top 12
  const topListings = [...listings]
    .sort((a, b) => b.dealScore - a.dealScore)
    .slice(0, 12);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <Link
        href="/deals"
        className="text-sm text-gray-500 hover:text-gray-700 mb-4 inline-block"
      >
        ← Back to all deals
      </Link>

      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          {stateName} land deals
        </h1>
        <p className="text-gray-600">
          {stats.count} listings across tax sales, auctions, and government
          programs
        </p>
      </div>

      {stats.count > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-2xl font-bold text-gray-900">{stats.count}</p>
            <p className="text-sm text-gray-500">Listings</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-2xl font-bold text-green-600">
              {stats.avgScore}
            </p>
            <p className="text-sm text-gray-500">Avg deal score</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-2xl font-bold text-gray-900">
              {formatPrice(stats.minPrice)}
            </p>
            <p className="text-sm text-gray-500">Lowest price</p>
          </div>
          <div className="bg-white rounded-lg p-4 border border-gray-200">
            <p className="text-2xl font-bold text-gray-900">
              {stats.totalAcreage.toLocaleString()}
            </p>
            <p className="text-sm text-gray-500">Total acres</p>
          </div>
        </div>
      )}

      {topListings.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-4xl mb-3">🌾</p>
          <p className="text-gray-600 font-medium">
            No listings yet for {stateName}
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Check back soon — new deals are scraped daily.
          </p>
        </div>
      ) : (
        <>
          <h2 className="text-xl font-semibold text-gray-900 mb-4">
            Top {topListings.length} deals
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {topListings.map((listing) => (
              <PropertyCard key={listing.id} property={listing} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Build and verify**

```bash
cd /workspaces/homestead-finder/web && npm run build
```

Expected: Build succeeds, `/states/[state]` listed as a dynamic route.

- [ ] **Step 3: Manual test in dev server**

```bash
cd /workspaces/homestead-finder/web && npm run dev
```

Visit http://localhost:3000/states/MT and http://localhost:3000/states/AL — should show stats + listings for each state.

Press Ctrl+C to stop.

- [ ] **Step 4: Commit**

```bash
cd /workspaces/homestead-finder && git add web/app/states/ && git commit -m "feat(web): state landing page with SEO metadata and stats"
```

---

## Task 15: Vercel Configuration and Deploy

**Files:**
- Create: `vercel.json` (repo root — for now, `vercel.ts` requires CLI install)
- Modify: `README.md` (optional — add deploy notes)

**Context:** Because the Vercel CLI is not installed in this Codespace, we use `vercel.json` (the older config format) which Vercel reads without any CLI. The session-reminder mentions `vercel.ts` is the newer recommended format, but it requires the Vercel CLI. You can install it later with `npm i -g vercel` and migrate, or keep using `vercel.json`.

- [ ] **Step 1: Create vercel.json at the repo root**

Create `/workspaces/homestead-finder/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "buildCommand": "cd web && npm run build",
  "devCommand": "cd web && npm run dev",
  "installCommand": "cd web && npm install",
  "outputDirectory": "web/.next",
  "framework": "nextjs"
}
```

**Note:** Vercel auto-detects Next.js apps in subdirectories, but specifying these commands explicitly makes the build deterministic.

- [ ] **Step 2: Verify local production build still works**

```bash
cd /workspaces/homestead-finder/web && npm run build
```

Expected: Build succeeds. Note the output showing all routes.

- [ ] **Step 3: Commit the config**

```bash
cd /workspaces/homestead-finder && git add vercel.json && git commit -m "feat: add Vercel config for web/ subdirectory deployment"
```

- [ ] **Step 4: Push to trigger deploy (if repo is connected to Vercel)**

```bash
cd /workspaces/homestead-finder && git push
```

Expected: Push succeeds. If the repo is already connected to Vercel, a deployment will start automatically — check the Vercel dashboard.

**If the repo is NOT yet connected to Vercel:** Follow these manual steps (one-time setup):

1. Go to https://vercel.com/new
2. Import the `cloudcodetree/homestead-finder` repository
3. In "Configure Project":
   - Framework preset: **Next.js**
   - Root directory: **`web`** (click "Edit" and select)
   - Build/install commands: auto-detected from vercel.json
4. Click "Deploy"
5. Wait 1-2 minutes for the first deploy

- [ ] **Step 5: Verify the preview URL works**

Open the Vercel-provided preview URL and check:
- Landing page shows live stats
- `/deals` shows listings with filters
- Clicking a listing loads `/deals/[id]` with SEO title
- `/states/MT` shows Montana stats (or sample data)

- [ ] **Step 6: Update context and final commit**

Edit `/workspaces/homestead-finder/context/ROLLING_CONTEXT.md` to note the Next.js migration milestone. Add a short entry under "Recent Sessions" with the session date, what was built, and the Vercel preview URL.

```bash
cd /workspaces/homestead-finder && git add context/ROLLING_CONTEXT.md && git commit -m "docs: update rolling context after Next.js foundation milestone"
```

---

## Verification Checklist

After all tasks, run this final check:

**Build & tests:**
- [ ] `cd web && npm test` — all tests pass
- [ ] `cd web && npm run build` — production build succeeds
- [ ] `cd web && npm run dev` — dev server starts, all routes load without errors
- [ ] Vercel preview URL shows the same data as the local dev server

**SEO:**
- [ ] `/deals/[id]` pages have unique titles in `<head>` (view source to confirm)
- [ ] `/states/MT` shows Montana-specific meta description

**Feature parity with legacy frontend:**
- [ ] ValidationBadge appears on every PropertyCard (top-right, stacked with score)
- [ ] ValidationBadge appears in PropertyDetail header
- [ ] PropertyDetail has URL display with copy button; clicking shows "Copied!" for 2s
- [ ] PropertyDetail CTA is gray for `status='expired'`, warning text for `'unverified'`
- [ ] Desktop filter sidebar collapses from w-72 to w-10 with `‹/›` button
- [ ] Mobile: resize browser to <1024px, FAB "Filters (N)" button appears bottom-left
- [ ] Mobile drawer slides from left with backdrop overlay
- [ ] Active filter count appears in sidebar header and FAB label when filters are active
- [ ] Sort dropdown has 6 options and reorders listings correctly

**Non-regression:**
- [ ] The legacy `frontend/` app still works (`cd frontend && npm run dev` on a different port)

---

## What's Next

After this plan, the next plan (**Workstream 1B: Turso Migration**) will:

1. Create a Turso database
2. Define the `listings` schema
3. Replace `import rawListings from '../../data/listings.json'` with a DB query
4. Update the scraper to dual-write (JSON + Turso) so the legacy app keeps working
5. Deploy the DB-connected version to Vercel

The data flow stays the same; only the source of `loadListings()` changes. All the pages, components, and tests from this plan stay exactly as written.
