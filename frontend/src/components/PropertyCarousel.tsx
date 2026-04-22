import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Image carousel with swipe + arrow nav. Takes a list of image URLs,
 * renders one at a time, and lets the user thumb through. Used in
 * two spots:
 *   - PropertyCard (small, on the card thumbnail)
 *   - PropertyDetail (large, as the hero banner)
 *
 * Behavior:
 *   - Single image (images.length === 1) → no chrome, just renders
 *     as a plain <img> for zero visual noise in that common case.
 *   - Multiple images → previous / next arrows visible on hover
 *     (desktop) or always (touch), plus dot indicators. Swipe left/
 *     right on touch devices advances.
 *   - On image load error, silently skip that slot and advance to
 *     the next. Keeps a "failed" set so we never loop back to a
 *     broken URL.
 *   - Click-through behavior: the `onSelect` callback fires when the
 *     user clicks the image itself (not the nav controls), so
 *     PropertyCard's "click to open detail modal" still works —
 *     navigating the carousel doesn't open the modal.
 */
interface PropertyCarouselProps {
  images: string[];
  alt: string;
  className?: string;
  /** If provided, clicking the image (not the nav) triggers this. */
  onSelect?: () => void;
  /** Renders when all images fail to load. */
  fallback?: React.ReactNode;
}

export const PropertyCarousel = ({
  images,
  alt,
  className,
  onSelect,
  fallback,
}: PropertyCarouselProps) => {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Set<number>>(new Set());
  const touchStartX = useRef<number | null>(null);

  // Reset when the image list identity changes (e.g. switching cards).
  useEffect(() => {
    setIndex(0);
    setFailed(new Set());
  }, [images]);

  // Map the "virtual" index (skipping failures) back to the raw images array
  const liveIndices = images.map((_, i) => i).filter((i) => !failed.has(i));
  const currentRawIndex = liveIndices.length > 0 ? liveIndices[index % liveIndices.length] : -1;
  const currentUrl = currentRawIndex >= 0 ? images[currentRawIndex] : '';

  const advance = useCallback(
    (delta: number) =>
      setIndex((prev) => {
        const len = liveIndices.length;
        if (len === 0) return 0;
        return (prev + delta + len) % len;
      }),
    [liveIndices.length]
  );

  const handleError = useCallback(() => {
    if (currentRawIndex < 0) return;
    setFailed((prev) => {
      const next = new Set(prev);
      next.add(currentRawIndex);
      return next;
    });
    // Don't bump index — the filter re-runs and the next valid image
    // becomes `index`'s new slot automatically.
  }, [currentRawIndex]);

  if (liveIndices.length === 0) {
    return <>{fallback ?? null}</>;
  }

  const stop = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };

  // Touch swipe — 40px threshold. Preserves the card click-through
  // unless the user actually swiped.
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const delta = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) > 40 && liveIndices.length > 1) {
      stop(e);
      advance(delta < 0 ? 1 : -1);
    }
  };

  const showChrome = liveIndices.length > 1;

  return (
    <div
      className={`relative overflow-hidden group ${className ?? ''}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <img
        src={currentUrl}
        alt={alt}
        loading="lazy"
        decoding="async"
        onError={handleError}
        onClick={onSelect}
        className="w-full h-full object-cover"
      />

      {showChrome && (
        <>
          <button
            type="button"
            aria-label="Previous image"
            onClick={(e) => {
              stop(e);
              advance(-1);
            }}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white text-sm flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next image"
            onClick={(e) => {
              stop(e);
              advance(1);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-sm text-white text-sm flex items-center justify-center opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          >
            ›
          </button>

          {/* Dot indicators — subtle, bottom-center. Keep small so they
              don't crowd card layouts. */}
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 flex items-center gap-1">
            {liveIndices.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={`Go to image ${i + 1}`}
                onClick={(e) => {
                  stop(e);
                  setIndex(i);
                }}
                className={`h-1.5 rounded-full transition-all ${
                  i === index % liveIndices.length
                    ? 'bg-white w-4'
                    : 'bg-white/60 hover:bg-white/80 w-1.5'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
};
