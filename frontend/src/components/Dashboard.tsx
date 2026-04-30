import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DEFAULT_FILTERS, type FilterState } from '../types/property';
import { FilterPanel } from './FilterPanel';
import { TopPicks } from './TopPicks';
import { HomesteadDeals } from './HomesteadDeals';
import { AskClaude } from './AskClaude';
import { ErrorBoundary } from './ErrorBoundary';
import { ListToolbar } from './browse/ListToolbar';
import { ListingsGrid } from './browse/ListingsGrid';
import { QueryResults } from './browse/QueryResults';
import { applyFilters, useProperties } from '../hooks/useProperties';
import { useFilters } from '../hooks/useFilters';
import { useCurated } from '../hooks/useCurated';
import { useHomesteadDeals } from '../hooks/useHomesteadDeals';
import { QueryResponse } from '../hooks/useQueryServer';
import { useAuth } from '../hooks/useAuth';
import { useHiddenListings } from '../hooks/useHiddenListings';
import { useSavedListings } from '../hooks/useSavedListings';
import { useRankingWeights } from '../hooks/useRankingWeights';
import { useUserPreferences } from '../hooks/useUserPreferences';
import {
  isDefaultFilters,
  preferencesToFilters,
} from '../utils/preferencesToFilters';
import { getListingTypeStyle } from '../utils/listingType';
import { scoreWithWeights } from '../utils/personalRank';
import { preferenceMatchScore } from '../utils/preferenceMatch';

const MapView = lazy(() => import('./MapView').then((m) => ({ default: m.MapView })));

type ViewMode = 'list' | 'map' | 'picks' | 'deals';

export const Dashboard = () => {
  const {
    filters,
    updateFilter,
    toggleState,
    toggleFeature,
    toggleAITag,
    toggleListingVariant,
    toggleSource,
    resetFilters,
    replaceFilters,
    hasActiveFilters,
  } = useFilters();
  const {
    properties,
    allProperties,
    loading,
    error,
    stats,
    isSample: listingsAreSample,
  } = useProperties(filters);
  const { curation, isSample: curationIsSample } = useCurated();
  const { deals, isSample: dealsIsSample } = useHomesteadDeals();
  // When real listings are loaded but the curation is still from the
  // bundled sample, the sample picks reference IDs that don't exist —
  // suppress the Picks view in that case and show the "run curate" nudge.
  const curationMatchesListings = curation && !(curationIsSample && !listingsAreSample);
  const dealsMatchListings = deals && !(dealsIsSample && !listingsAreSample);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [showFilters, setShowFilters] = useState(false);
  const [queryResult, setQueryResult] = useState<QueryResponse | null>(null);
  const [onlySaved, setOnlySaved] = useState(false);
  const { user: currentUser } = useAuth();
  const { savedIds } = useSavedListings();
  const { hiddenIds } = useHiddenListings();
  const [showHidden, setShowHidden] = useState(false);
  /** When on, the list view shows ONLY hidden listings (user opened
   * "My hidden listings" from the account menu). Different from
   * `showHidden` which mixes hidden rows back into the normal sort. */
  const [onlyHidden, setOnlyHidden] = useState(false);
  const { weights: rankingWeights, hasEnoughData: hasRankingData } =
    useRankingWeights();
  const { preferences: userPrefs, isComplete: prefsComplete } =
    useUserPreferences();

  /**
   * One-shot application of saved preferences to filters. Runs once
   * per session when:
   *   - the user has completed onboarding,
   *   - filters are still at the app defaults (i.e. user hasn't yet
   *     tweaked anything this session).
   * Gated by a ref so navigating around or editing filters later
   * doesn't re-clobber. If the user hits "Clear all" to return to
   * defaults, we deliberately don't re-seed — they asked for a clean
   * slate. They can re-apply via Preferences → Save.
   */
  const prefsAppliedRef = useMemo(() => ({ done: false }), []);
  useEffect(() => {
    if (prefsAppliedRef.done) return;
    if (!prefsComplete) return;
    if (!isDefaultFilters(filters)) {
      // User has already edited filters this session — respect that
      // and mark as done so we don't fight them later.
      prefsAppliedRef.done = true;
      return;
    }
    // Wait for the corpus to load — we use it below to drop stale
    // preferences that would zero the result set (e.g. a user with
    // `targetStates: ['MO','AR']` from before the 2026-04-29 Austin
    // pivot, against a TX-only corpus).
    if (allProperties.length === 0) return;
    // Stale-prefs detection. If the user's `targetStates` doesn't
    // overlap the loaded corpus at all (typical right after a
    // geography pivot — old prefs reference MO/AR; the corpus is
    // now TX-only), the entire prefs row is "from a different era"
    // and using ANY of it (budget, acreage, features) would
    // overcrop the new corpus. Skip the whole seed; let defaults
    // apply. The user can re-pick prefs from Settings → Preferences.
    if (userPrefs.targetStates && userPrefs.targetStates.length > 0) {
      const corpusStates = new Set(
        allProperties
          .map((p) => p.location?.state)
          .filter((s): s is string => Boolean(s)),
      );
      const validTargets = userPrefs.targetStates.filter((s) =>
        corpusStates.has(s.includes('|') ? s.split('|')[0] : s),
      );
      if (validTargets.length === 0) {
        prefsAppliedRef.done = true;
        return;
      }
    }
    const patch = preferencesToFilters(userPrefs);
    // Validate the seeded `states` filter against the loaded corpus.
    if (patch.states && patch.states.length > 0) {
      const corpusStates = new Set(
        allProperties
          .map((p) => p.location?.state)
          .filter((s): s is string => Boolean(s)),
      );
      const valid = patch.states.filter((s) => corpusStates.has(s));
      if (valid.length === 0) {
        delete patch.states;
      } else if (valid.length !== patch.states.length) {
        patch.states = valid;
      }
    }
    // Dry-run the merged filter against the corpus; if it kills
    // everything, drop the must-have-features list (the next-most-
    // common offender for over-restrictive prefs).
    const wouldFilters = { ...filters, ...patch } as FilterState;
    const wouldMatch = applyFilters(allProperties, wouldFilters).length;
    if (wouldMatch === 0 && patch.features && patch.features.length > 0) {
      delete patch.features;
    }
    if (Object.keys(patch).length === 0) {
      // User completed onboarding but left everything blank — nothing
      // to seed. Still mark done so we stop watching.
      prefsAppliedRef.done = true;
      return;
    }
    replaceFilters(patch);
    prefsAppliedRef.done = true;
  }, [
    prefsComplete,
    userPrefs,
    filters,
    replaceFilters,
    prefsAppliedRef,
    allProperties,
  ]);

  // URL ↔ state sync.
  //   `?view=…` and `?saved=1` live IN the URL as the source of truth
  //   so the AppShell nav rail can highlight the correct entry. We
  //   keep `viewMode` and `onlySaved` as local state for ergonomics
  //   inside the component, but a single effect mirrors URL → state
  //   on every URL change. The tab buttons / "show only saved" toggle
  //   write back via the `changeView` / `changeOnlySaved` helpers
  //   below — those push to the URL, which then updates the state on
  //   the next render. There is no state → URL effect; that creates a
  //   classic ping-pong loop with the URL → state effect.
  //
  //   `?hidden=1` and `?q=…` are one-shot deep-links — consumed once
  //   into local state and stripped from the URL so reloading doesn't
  //   re-apply them.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const view = searchParams.get('view');
    const desiredView: ViewMode =
      view === 'picks' || view === 'deals' || view === 'map' || view === 'list'
        ? (view as ViewMode)
        : 'list';
    setViewMode((prev) => (prev === desiredView ? prev : desiredView));
    const desiredSaved = searchParams.get('saved') === '1';
    setOnlySaved((prev) => (prev === desiredSaved ? prev : desiredSaved));
  }, [searchParams]);
  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    let changed = false;
    if (params.get('hidden') === '1') {
      setOnlyHidden(true);
      setOnlySaved(false);
      params.delete('hidden');
      changed = true;
    }
    const q = params.get('q');
    if (typeof q === 'string') {
      updateFilter('searchText', q);
      params.delete('q');
      changed = true;
    }
    if (changed) setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams, updateFilter]);
  const changeView = useCallback(
    (next: ViewMode) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === 'list') p.delete('view');
          else p.set('view', next);
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  const changeOnlySaved = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          const v =
            typeof next === 'function' ? next(p.get('saved') === '1') : next;
          if (v) p.set('saved', '1');
          else p.delete('saved');
          return p;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );
  // States present in the loaded corpus — feeds the state filter so it
  // reflects actual inventory (not a hardcoded list). Stable reference
  // via useMemo so FilterPanel doesn't thrash.
  const availableStates = useMemo(
    () =>
      Array.from(
        new Set(
          allProperties
            .map((p) => p.location?.state)
            .filter((s): s is string => typeof s === 'string' && s.length > 0)
        )
      ),
    [allProperties]
  );
  // Listing-type variants present in the corpus — drives which
  // Listing Type filter buttons render (hides categories with zero
  // inventory, e.g. "Tax Lien" when there are no WY parcels).
  const availableListingVariants = useMemo(
    () => Array.from(new Set(allProperties.map((p) => getListingTypeStyle(p).variant))),
    [allProperties]
  );
  // Source → count map for the Sources filter pill row. Stable
  // reference via useMemo so FilterPanel doesn't re-render on every
  // filter change (only when allProperties changes).
  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of allProperties) {
      const s = p.source || 'unknown';
      counts[s] = (counts[s] ?? 0) + 1;
    }
    return counts;
  }, [allProperties]);

  // PropertyDetail is now its own route at /p/:id (PropertyDetailPage)
  // so we just navigate there on card click. No more in-place stacking.
  const navigate = useNavigate();
  const openProperty = useCallback(
    (id: string) => navigate(`/p/${encodeURIComponent(id)}`),
    [navigate]
  );
  const selectedId = null;

  const activeFilterCount = [
    filters.minPrice !== DEFAULT_FILTERS.minPrice ? 1 : 0,
    filters.maxPrice !== DEFAULT_FILTERS.maxPrice ? 1 : 0,
    filters.minAcreage !== DEFAULT_FILTERS.minAcreage ? 1 : 0,
    filters.maxAcreage !== DEFAULT_FILTERS.maxAcreage ? 1 : 0,
    filters.maxPricePerAcre !== DEFAULT_FILTERS.maxPricePerAcre ? 1 : 0,
    filters.minDealScore !== DEFAULT_FILTERS.minDealScore ? 1 : 0,
    filters.minHomesteadFit !== DEFAULT_FILTERS.minHomesteadFit ? 1 : 0,
    filters.hideWithRedFlags ? 1 : 0,
    filters.states.length,
    filters.features.length,
    filters.aiTags.length,
    filters.sources.length,
  ].reduce((a, b) => a + b, 0);

  // `properties` is already sorted by useProperties using filters.sortBy
  // for the server-known sort keys. We layer two local sort strategies
  // on top:
  //   1. `onlySaved` filter (per-user Supabase state — orthogonal to
  //      the shareable filter URL state in useFilters).
  //   2. `recommended` sort when the user has fitted personalization
  //      weights. We re-sort here because it depends on a user-specific
  //      model that the corpus-level useProperties hook doesn't see.
  const sortedProperties = useMemo(() => {
    let arr = properties;
    if (onlyHidden) {
      // Dedicated "hidden view" — show every listing the user has
      // hidden, in any sort order. No implicit un-hide; they click
      // the eye-off on the card to restore.
      arr = arr.filter((p) => hiddenIds.has(p.id));
    } else if (onlySaved) {
      arr = arr.filter((p) => savedIds.has(p.id));
    } else if (!showHidden) {
      // Default: hide "not interested" listings. Saved always wins
      // over hidden — if a listing is in both tables, it still
      // shows so the user doesn't lose track of it.
      arr = arr.filter((p) => !hiddenIds.has(p.id) || savedIds.has(p.id));
    }
    if (filters.sortBy === 'recommended' && hasRankingData && rankingWeights) {
      arr = [...arr].sort(
        (a, b) => scoreWithWeights(b, rankingWeights) - scoreWithWeights(a, rankingWeights),
      );
    } else if (filters.sortBy === 'dealScore' && prefsComplete) {
      // Preference-aware deal sort — listings matching the user's
      // stated preferences get a bounded bonus (max ~20 points on
      // 100-point scale). Nudges without hijacking. Only kicks in
      // after onboarding is complete to avoid surprising anonymous
      // users with a sort that doesn't match the title ("Best Deal").
      arr = [...arr].sort((a, b) => {
        const aScore = a.dealScore + preferenceMatchScore(a, userPrefs);
        const bScore = b.dealScore + preferenceMatchScore(b, userPrefs);
        return bScore - aScore;
      });
    }
    return arr;
  }, [
    onlyHidden,
    onlySaved,
    properties,
    savedIds,
    hiddenIds,
    showHidden,
    filters.sortBy,
    rankingWeights,
    hasRankingData,
    prefsComplete,
    userPrefs,
  ]);
  // Offer a "Saved" toggle whenever the user is signed in — always
  // visible but functionally off when their saved list is empty.
  const showSavedToggle = currentUser !== null;

  return (
    <div className="flex flex-col h-full">
      {/* Page sub-header — stats + view-mode tabs. The global chrome
          (logo, search, account menu) lives in AppShell. */}
      <div className="bg-white border-b border-gray-200 px-3 sm:px-4 py-2 flex items-center gap-2 sm:gap-3 flex-shrink-0">
        <button
          onClick={() => setShowFilters(true)}
          className="flex-shrink-0 flex items-center gap-1.5 border border-gray-300 hover:border-green-500 hover:text-green-700 text-gray-700 text-sm font-medium px-2.5 sm:px-3 py-1 rounded-md bg-white transition-colors"
          title="Open filters"
          aria-label="Open filters"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3.5 w-3.5"
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
          <span>Filter{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
        </button>
        <div className="hidden md:flex items-center gap-4">
          <div className="text-xs text-gray-500">
            <span className="font-semibold text-gray-900">{stats.total}</span> listings
          </div>
          <div className="text-xs text-gray-500">
            <span className="font-semibold text-green-600">{stats.hotDeals}</span> hot
          </div>
          <div className="text-xs text-gray-500">
            Avg <span className="font-semibold text-gray-900">{stats.avgScore}</span>
          </div>
        </div>
        <div className="ml-auto flex bg-gray-100 rounded-lg p-0.5 overflow-hidden">
          <button
            onClick={() => changeView('list')}
            className={`px-2 sm:px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              viewMode === 'list'
                ? 'bg-white shadow text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            title="List"
          >
            List
          </button>
          <button
            onClick={() => changeView('map')}
            className={`px-2 sm:px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              viewMode === 'map'
                ? 'bg-white shadow text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            title="Map"
          >
            Map
          </button>
          <button
            onClick={() => changeView('picks')}
            className={`px-2 sm:px-3 py-1 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${
              viewMode === 'picks'
                ? 'bg-white shadow text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            title="AI-curated top picks"
          >
            <span>Picks</span>
            {curationMatchesListings && curation && curation.picks.length > 0 && (
              <span className="hidden sm:inline text-[10px] px-1 bg-purple-100 text-purple-700 rounded font-medium">
                {curation.picks.length}
              </span>
            )}
          </button>
          <button
            onClick={() => changeView('deals')}
            className={`px-2 sm:px-3 py-1 rounded-md text-sm font-medium transition-colors flex items-center gap-1 ${
              viewMode === 'deals'
                ? 'bg-white shadow text-gray-900'
                : 'text-gray-500 hover:text-gray-700'
            }`}
            title="Homestead-specific curated deals"
          >
            <span>Deals</span>
            {dealsMatchListings && deals && deals.picks.length > 0 && (
              <span className="hidden sm:inline text-[10px] px-1 bg-emerald-100 text-emerald-700 rounded font-medium">
                {deals.picks.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* Filter drawer — slides in from the left at every breakpoint.
            Triggered from the sub-header's "Filter" button and the
            mobile floating FAB. The shell's left rail handles app
            navigation; this drawer handles in-page filtering, so
            they no longer compete for the same column. */}
        <div
          className={`fixed inset-0 z-40 bg-black/50 transition-opacity duration-300 ${showFilters ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
          onClick={() => setShowFilters(false)}
        />
        <div
          className={`fixed top-0 left-0 bottom-0 z-50 w-80 max-w-[85vw] bg-white shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${showFilters ? 'translate-x-0' : '-translate-x-full'}`}
        >
          <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <div>
              <h2 className="font-semibold text-gray-900">
                Filters{activeFilterCount > 0 ? ` (${activeFilterCount} active)` : ''}
              </h2>
              <p className="text-xs text-gray-500">{properties.length} properties</p>
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
              onToggleAITag={toggleAITag}
              onToggleListingVariant={toggleListingVariant}
              onToggleSource={toggleSource}
              onReset={resetFilters}
              hasActiveFilters={hasActiveFilters}
              resultCount={properties.length}
              availableStates={availableStates}
              availableListingVariants={availableListingVariants}
              sourceCounts={sourceCounts}
              hideHeader
            />
          </div>
        </div>

        {/* Main content */}
        <main className="flex-1 overflow-hidden">
          {loading && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="inline-block w-8 h-8 border-4 border-green-200 border-t-green-600 rounded-full animate-spin" />
                <p className="mt-3 text-gray-500 text-sm">Loading listings...</p>
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-red-600">
                <p className="text-lg">⚠️ Error loading listings</p>
                <p className="text-sm mt-1">{error}</p>
              </div>
            </div>
          )}

          {!loading && !error && viewMode === 'list' && (
            <div className="h-full overflow-y-auto p-4">
              <ErrorBoundary label="Ask Claude">
                <AskClaude
                  onResult={setQueryResult}
                  activeQuestion={queryResult?.question ?? null}
                />
              </ErrorBoundary>

              {/* Claude query results — pinned section above the normal list.
                  Hidden when no query is active. */}
              {queryResult && (
                <QueryResults
                  result={queryResult}
                  allProperties={allProperties}
                  selectedId={selectedId}
                  onOpenProperty={openProperty}
                />
              )}

              <ListToolbar
                headline={
                  queryResult ? 'All listings' : `${sortedProperties.length} properties`
                }
                onlyHidden={onlyHidden}
                onExitHiddenMode={() => setOnlyHidden(false)}
                showSavedChip={showSavedToggle}
                onlySaved={onlySaved}
                onToggleOnlySaved={() => changeOnlySaved((v) => !v)}
                savedCount={savedIds.size}
                showHiddenChip={!!currentUser && hiddenIds.size > 0}
                showHidden={showHidden}
                onToggleShowHidden={() => setShowHidden((v) => !v)}
                hiddenCount={hiddenIds.size}
                sortBy={filters.sortBy}
                onChangeSort={(s) => updateFilter('sortBy', s)}
                hasRankingData={hasRankingData}
              />

              <ListingsGrid
                properties={sortedProperties}
                selectedId={selectedId}
                onOpenProperty={openProperty}
                onResetFilters={resetFilters}
              />
            </div>
          )}

          {!loading && !error && viewMode === 'map' && (
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-full">
                  <p className="text-gray-500">Loading map...</p>
                </div>
              }
            >
              <MapView
                properties={properties}
                selectedId={selectedId}
                onSelectProperty={openProperty}
                drawnArea={filters.drawnArea}
                onAreaChange={(poly) => updateFilter('drawnArea', poly)}
              />
            </Suspense>
          )}

          {!loading &&
            !error &&
            viewMode === 'deals' &&
            (dealsMatchListings && deals ? (
              <ErrorBoundary label="Homestead Deals">
                <HomesteadDeals
                  deals={deals}
                  properties={allProperties}
                  onSelectProperty={openProperty}
                />
              </ErrorBoundary>
            ) : (
              <div className="flex items-center justify-center h-full p-6 text-center">
                <div className="max-w-md">
                  <p className="text-4xl mb-3">🌾</p>
                  <p className="text-gray-600 font-medium">No homestead deals yet</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Run{' '}
                    <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">
                      python -m scraper.deals
                    </code>{' '}
                    locally to generate the curated homestead list, then commit{' '}
                    <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">
                      data/homestead_deals.json
                    </code>
                    .
                  </p>
                  {dealsIsSample && !listingsAreSample && (
                    <p className="text-xs text-gray-400 mt-3">
                      (The bundled sample was hidden because it references listing IDs that
                      don&apos;t match your real data.)
                    </p>
                  )}
                </div>
              </div>
            ))}

          {!loading &&
            !error &&
            viewMode === 'picks' &&
            (curationMatchesListings && curation ? (
              <ErrorBoundary label="Top Picks">
                <TopPicks
                  picks={curation.picks}
                  properties={allProperties}
                  curatedAt={curation.curatedAt}
                  model={curation.model}
                  onSelectProperty={openProperty}
                />
              </ErrorBoundary>
            ) : (
              <div className="flex items-center justify-center h-full p-6 text-center">
                <div className="max-w-md">
                  <p className="text-4xl mb-3">✨</p>
                  <p className="text-gray-600 font-medium">No curated picks yet</p>
                  <p className="text-sm text-gray-500 mt-1">
                    Run{' '}
                    <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">
                      python -m scraper.curate
                    </code>{' '}
                    locally to generate top picks and commit{' '}
                    <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">
                      data/curated.json
                    </code>
                    .
                  </p>
                  {curationIsSample && !listingsAreSample && (
                    <p className="text-xs text-gray-400 mt-3">
                      (The bundled sample curation was hidden because it references sample listing
                      IDs that don&apos;t match your real data.)
                    </p>
                  )}
                </div>
              </div>
            ))}
        </main>
      </div>

      {/* Mobile floating Filters button */}
      <button
        onClick={() => setShowFilters(true)}
        className={`lg:hidden fixed bottom-6 left-4 z-30 flex items-center gap-2 px-4 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-full shadow-lg font-medium text-sm transition-all duration-200 ${showFilters ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
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
};
