import { ChevronLeft, ChevronRight, Star } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCurated } from '../hooks/useCurated';
import { useProperties } from '../hooks/useProperties';
import { DEFAULT_FILTERS, type CuratedPick, type Property } from '../types/property';
import { formatPrice } from '../utils/formatters';
import { PropertyThumbnail } from './PropertyThumbnail';

/**
 * Horizontal-scroll carousel of the 12 curated Top Picks. Snap-aligned
 * cards (one screen-width worth visible per "page") with prev/next
 * chevrons that scroll by one card. The Sonnet-generated headline +
 * short reason render alongside the price/acreage so the user gets a
 * one-line "why" without opening the listing.
 *
 * Self-gates on `useCurated` returning real data (not a sample); when
 * the curated file is missing or empty, renders nothing rather than
 * a placeholder so the page collapses cleanly.
 */
const CARD_WIDTH = 320; // px — also drives the scrollBy step

interface CarouselCard {
  pick: CuratedPick;
  property: Property;
}

const PickCard = ({ pick, property }: CarouselCard) => {
  return (
    <Link
      to={`/p/${property.id}`}
      className="flex-shrink-0 w-[320px] snap-start rounded-xl overflow-hidden border border-gray-200 bg-white hover:border-emerald-300 hover:shadow-md transition-all"
    >
      <div className="relative h-40 bg-gray-100">
        <PropertyThumbnail
          property={property}
          width={320}
          className="w-full h-full object-cover"
        />
        <span className="absolute top-2 left-2 inline-flex items-center gap-1 rounded-full bg-emerald-600/95 backdrop-blur-sm text-white text-[11px] font-bold px-2 py-0.5">
          <Star className="w-3 h-3 fill-white" aria-hidden="true" />
          #{pick.rank} pick
        </span>
      </div>
      <div className="p-3">
        <h4 className="text-sm font-semibold text-gray-900 line-clamp-2 min-h-[2.5rem]">
          {pick.headline}
        </h4>
        <div className="mt-1 flex items-baseline justify-between gap-2 text-xs text-gray-500">
          <span className="truncate">
            {property.location.county
              ? `${property.location.county}, ${property.location.state}`
              : property.location.state}
          </span>
          <span className="font-semibold text-gray-900 tabular-nums flex-shrink-0">
            {formatPrice(property.price)}
            <span className="text-gray-500 font-normal"> · {property.acreage} ac</span>
          </span>
        </div>
        <p className="mt-2 text-xs text-gray-600 line-clamp-3 leading-relaxed">
          {pick.reason}
        </p>
      </div>
    </Link>
  );
};

export const TopPicksCarousel = () => {
  const { curation, isSample } = useCurated();
  const { allProperties, loading } = useProperties(DEFAULT_FILTERS);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  // Resolve each pick's listing record from the loaded corpus.
  // Picks whose IDs no longer match (corpus drift between curation
  // and now) are dropped silently — better than rendering empty cards.
  const cards = useMemo<CarouselCard[]>(() => {
    if (!curation?.picks?.length || allProperties.length === 0) return [];
    const byId = new Map(allProperties.map((p) => [p.id, p]));
    return curation.picks.flatMap((pick) => {
      const property = byId.get(pick.id);
      return property ? [{ pick, property }] : [];
    });
  }, [curation, allProperties]);

  const updateScrollState = () => {
    const el = scrollerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 8);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  };

  useEffect(() => {
    updateScrollState();
  }, [cards.length]);

  const scrollByCard = (direction: 1 | -1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * (CARD_WIDTH + 16), behavior: 'smooth' });
  };

  if (loading || isSample || cards.length === 0) return null;

  return (
    <section
      className="relative"
      aria-labelledby="top-picks-heading"
    >
      <div className="flex items-end justify-between gap-2 mb-3">
        <div>
          <h3
            id="top-picks-heading"
            className="text-base font-semibold text-gray-900"
          >
            Top Picks
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            {curation?.pickCount ?? cards.length} listings hand-picked by{' '}
            Claude {curation?.model ?? 'sonnet'} from the full corpus.{' '}
            <Link
              to="/browse?view=picks"
              className="text-emerald-700 hover:text-emerald-900 font-medium"
            >
              See all →
            </Link>
          </p>
        </div>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => scrollByCard(-1)}
            disabled={!canScrollLeft}
            aria-label="Scroll left"
            className="rounded-full p-1.5 border border-gray-200 bg-white text-gray-600 hover:text-gray-900 hover:border-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollByCard(1)}
            disabled={!canScrollRight}
            aria-label="Scroll right"
            className="rounded-full p-1.5 border border-gray-200 bg-white text-gray-600 hover:text-gray-900 hover:border-gray-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div
        ref={scrollerRef}
        onScroll={updateScrollState}
        className="flex gap-4 overflow-x-auto snap-x snap-mandatory pb-2 -mx-1 px-1 scrollbar-thin scrollbar-thumb-gray-300"
      >
        {cards.map((c) => (
          <PickCard key={c.pick.id} pick={c.pick} property={c.property} />
        ))}
      </div>
    </section>
  );
};
