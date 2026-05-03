import { useCallback, useMemo } from 'react';
import { Property, FilterState } from '../types/property';
import { pointInPolygon } from '../utils/geometry';
import { getListingTypeStyle } from '../utils/listingType';
import { useJsonAsset } from './useJsonAsset';

export const applyFilters = (properties: Property[], filters: FilterState): Property[] => {
  return properties.filter((p) => {
    // `<= 0` on a max means "no cap" — UI lets the user clear or
    // set a max input to 0 to disable that side of the range. Same
    // convention for minPrice / minAcreage where 0 already meant
    // "no min" (kept for symmetry).
    if (filters.minPrice > 0 && p.price < filters.minPrice) return false;
    // maxPrice uses the slider's top stop (250,000) as the "no cap"
    // sentinel — at that value we skip the upper-bound check.
    if (
      filters.maxPrice > 0 &&
      filters.maxPrice < 250_000 &&
      p.price > filters.maxPrice
    )
      return false;
    if (filters.minAcreage > 0 && p.acreage < filters.minAcreage) return false;
    // maxAcreage uses the slider's top stop (100) as the "no cap"
    // sentinel — at that value we skip the upper-bound check.
    if (
      filters.maxAcreage > 0 &&
      filters.maxAcreage < 100 &&
      p.acreage > filters.maxAcreage
    )
      return false;
    if (filters.minPricePerAcre > 0 && p.pricePerAcre < filters.minPricePerAcre)
      return false;
    // maxPricePerAcre uses the slider's top stop (10,000) as the
    // "no cap" sentinel — at that value we skip the upper-bound check.
    if (
      filters.maxPricePerAcre > 0 &&
      filters.maxPricePerAcre < 10_000 &&
      p.pricePerAcre > filters.maxPricePerAcre
    )
      return false;
    if (p.dealScore < filters.minDealScore) return false;
    if (filters.maxDealScore < 100 && p.dealScore > filters.maxDealScore) return false;
    if (filters.states.length > 0 && !filters.states.includes(p.location.state)) return false;
    if (filters.listingVariants.length > 0) {
      const variant = getListingTypeStyle(p).variant;
      if (!filters.listingVariants.includes(variant)) return false;
    }
    if (filters.features.length > 0) {
      const hasAll = filters.features.every((f) => p.features.includes(f));
      if (!hasAll) return false;
    }
    if (filters.sources.length > 0 && !filters.sources.includes(p.source)) return false;
    // AI-derived filters — skip any listing that hasn't been enriched yet
    // when an AI filter is active, rather than treating missing = passing.
    if (filters.minHomesteadFit > 0 || filters.maxHomesteadFit < 100) {
      if (p.homesteadFitScore === undefined) return false;
      if (p.homesteadFitScore < filters.minHomesteadFit) return false;
      if (p.homesteadFitScore > filters.maxHomesteadFit) return false;
    }
    if (filters.minInvestmentScore > 0 || filters.maxInvestmentScore < 100) {
      if (p.investmentScore === undefined) return false;
      if (p.investmentScore < filters.minInvestmentScore) return false;
      if (p.investmentScore > filters.maxInvestmentScore) return false;
    }
    if (filters.aiTags.length > 0) {
      const tags = p.aiTags ?? [];
      const hasAll = filters.aiTags.every((t) => tags.includes(t));
      if (!hasAll) return false;
    }
    if (filters.hideWithRedFlags && (p.redFlags?.length ?? 0) > 0) return false;
    // Drawn-boundary filter — listing must fall inside the user's
    // map polygon. Listings without coords are excluded (they can't
    // be in any drawn area). The polygon is closed implicitly by
    // pointInPolygon.
    if (filters.drawnArea && filters.drawnArea.length >= 3) {
      const lat = p.location?.lat;
      const lng = p.location?.lng;
      if (
        typeof lat !== 'number' ||
        typeof lng !== 'number' ||
        lat === 0 ||
        lng === 0
      ) {
        return false;
      }
      if (!pointInPolygon([lat, lng], filters.drawnArea)) return false;
    }
    // Hide listings marked expired/pending/under-contract by the
    // source. Tax-sale rows keep their own `status="tax_sale"` which
    // is never treated as inactive.
    if (filters.hideInactive && (p.status === 'expired' || p.status === 'pending')) {
      return false;
    }
    // Improvement tier — respects the user's shopping mode. Rows that
    // haven't been through improvements.py yet (no `improvements` key)
    // pass through on 'any' but are treated as bare_land otherwise.
    if (filters.improvementTier !== 'any') {
      const hasAnyImprovement =
        !!p.improvements && Object.keys(p.improvements).length > 0;
      if (filters.improvementTier === 'move_in_ready' && !p.moveInReady) return false;
      if (filters.improvementTier === 'improved' && !hasAnyImprovement) return false;
      if (filters.improvementTier === 'bare_land' && hasAnyImprovement) return false;
    }
    // Free-text search — multi-word AND match across the listing's
    // searchable fields. Each whitespace-split term must appear
    // somewhere; case-insensitive. Cheap because it's a JS substring
    // check on already-loaded data.
    if (filters.searchText && filters.searchText.trim()) {
      const haystack = [
        p.title,
        p.description ?? '',
        p.location.county,
        p.location.state,
        ...(p.features ?? []),
        ...Object.keys(p.improvements ?? {}),
        ...(p.aiTags ?? []),
        p.aiSummary ?? '',
      ]
        .join(' ')
        .toLowerCase();
      const terms = filters.searchText.toLowerCase().trim().split(/\s+/);
      if (!terms.every((t) => haystack.includes(t))) return false;
    }
    return true;
  });
};

// Module-scoped so useCallback sees a stable reference and the useJsonAsset
// effect doesn't re-fire every render. Cast narrows the JSON's inferred
// literal types to the runtime Property[] shape.
const loadSample = async () => {
  const mod = await import('../data/sample-listings.json');
  return { default: mod.default as unknown as Property[] };
};

const isEmptyArray = (d: Property[]) => d.length === 0;

/**
 * Cross-row deduplication for the loaded corpus.
 *
 * The scraper sometimes emits two rows for the same listing when a
 * re-discovery pass uses a different ID suffix (e.g.
 * `craigslist_3221688` and `craigslist_3221688_MO_38084` both
 * pointing at the same source URL). Until that's fixed in the
 * scraper, dedupe in the loader: prefer the row with more data
 * (longer description, more images, has coords, has AI summary).
 *
 * Exposed as a pure function so it can be tested in isolation;
 * `useProperties` calls it inside a useMemo over the raw fetch.
 */
const dedupeKey = (p: Property): string => {
  const u = (p.url ?? '').trim().toLowerCase();
  return u || p.id;
};

const richness = (p: Property): number => {
  let s = 0;
  if (p.images && p.images.length > 0) s += 10 + p.images.length;
  if (p.imageUrl) s += 5;
  if ((p.description ?? '').length > 0) {
    s += Math.min(5, Math.floor(p.description!.length / 100));
  }
  if (p.location?.lat && p.location?.lng && p.location.lat !== 0) s += 3;
  if (p.aiSummary) s += 5;
  return s;
};

export const dedupeListings = (rows: Property[]): Property[] => {
  if (rows.length === 0) return rows;
  const best = new Map<string, Property>();
  for (const p of rows) {
    if (!p.id) continue;
    const k = dedupeKey(p);
    const existing = best.get(k);
    if (!existing || richness(p) > richness(existing)) best.set(k, p);
  }
  return Array.from(best.values());
};

export const useProperties = (filters: FilterState) => {
  const { data, loading, error, isSample } = useJsonAsset<Property[]>({
    assetPath: 'data/listings.json',
    loadFallback: useCallback(loadSample, []),
    isEmpty: isEmptyArray,
  });
  const allProperties = useMemo(() => dedupeListings(data ?? []), [data]);

  const filtered = useMemo(() => applyFilters(allProperties, filters), [allProperties, filters]);

  const sorted = useMemo(
    () =>
      [...filtered].sort((a: Property, b: Property) => {
        switch (filters.sortBy) {
          case 'priceAsc':
            return a.price - b.price;
          case 'priceDesc':
            return b.price - a.price;
          case 'pricePerAcre':
            return a.pricePerAcre - b.pricePerAcre;
          case 'residualPricePerAcre':
            // Fall back to pricePerAcre when residual isn't computed
            // yet (older rows predating improvements.py).
            return (
              (a.residualPricePerAcre ?? a.pricePerAcre) -
              (b.residualPricePerAcre ?? b.pricePerAcre)
            );
          case 'acreage':
            return b.acreage - a.acreage;
          case 'dateFound':
            return new Date(b.dateFound).getTime() - new Date(a.dateFound).getTime();
          case 'title':
            return a.title.localeCompare(b.title);
          case 'homesteadFit':
            return (b.homesteadFitScore ?? -1) - (a.homesteadFitScore ?? -1);
          case 'investmentScore':
            // Tie-break by price asc so two equally-strong fundamentals
            // surface the cheaper option first — matches the "best
            // value" instinct most users have when sorting by score.
            return (
              (b.investmentScore ?? -1) - (a.investmentScore ?? -1) ||
              a.price - b.price
            );
          case 'dealScore':
          default:
            return b.dealScore - a.dealScore;
        }
      }),
    [filtered, filters.sortBy]
  );

  const stats = useMemo(
    () => ({
      total: allProperties.length,
      filtered: filtered.length,
      hotDeals: allProperties.filter((p) => p.dealScore >= 80).length,
      avgScore:
        allProperties.length > 0
          ? Math.round(
              allProperties.reduce((sum, p) => sum + p.dealScore, 0) / allProperties.length
            )
          : 0,
    }),
    [allProperties, filtered]
  );

  return {
    /** Filtered + sorted listings — what the list view renders. */
    properties: sorted,
    /** All loaded listings regardless of filters — used by Top Picks and
     *  Ask-Claude so their results aren't silently hidden by a narrow
     *  filter state the user may not remember setting. */
    allProperties,
    loading,
    error,
    stats,
    isSample,
  };
};
